import { frappe } from './api-client.js';
import { handleApiError } from './errors.js';
import { getDocument } from './document-api.js';

// Schema operations
/**
 * Get the schema for a DocType
 * @param doctype The DocType name
 * @returns The DocType schema
 */
export async function getDocTypeSchema(doctype: string): Promise<any> {
  try {
    if (!doctype) throw new Error("DocType name is required");

    // Use the Document API to get a cleaner, more lightweight schema
    console.error(`Using document API to get schema for ${doctype}`);
    
    try {
      // 1. Get the DocType document
      const doctypeDoc = await getDocument("DocType", doctype);

      if (!doctypeDoc) {
        throw new Error(`DocType ${doctype} not found`);
      }

      return {
        name: doctype,
        label: doctypeDoc.name || doctype,
        description: doctypeDoc.description,
        module: doctypeDoc.module,
        issingle: doctypeDoc.issingle === 1,
        istable: doctypeDoc.istable === 1,
        custom: doctypeDoc.custom === 1,
        fields: doctypeDoc.fields || [],
        permissions: doctypeDoc.permissions || [],
        autoname: doctypeDoc.autoname,
        name_case: doctypeDoc.name_case,
        // Add other properties from the DocType document as needed
      };
    } catch (error) {
      console.error(`Error using document API for ${doctype}:`, error);
      throw new Error(`Could not retrieve schema for DocType ${doctype} using document API`);
    }
  } catch (error) {
    return handleApiError(error, `get_doctype_schema(${doctype})`);
  }
}

export async function getFieldOptions(
  doctype: string,
  fieldname: string,
  filters?: Record<string, any>
): Promise<Array<{ value: string; label: string }>> {
  try {
    if (!doctype) throw new Error("DocType name is required");
    if (!fieldname) throw new Error("Field name is required");

    // First get the field metadata to determine the type and linked DocType
    const schema = await getDocTypeSchema(doctype);

    if (!schema || !schema.fields || !Array.isArray(schema.fields)) {
      throw new Error(`Invalid schema returned for DocType ${doctype}`);
    }

    const field = schema.fields.find((f: any) => f.fieldname === fieldname);

    if (!field) {
      throw new Error(`Field ${fieldname} not found in DocType ${doctype}`);
    }

    if (field.fieldtype === "Link") {
      // For Link fields, get the list of documents from the linked DocType
      const linkedDocType = field.options;
      if (!linkedDocType) {
        throw new Error(`Link field ${fieldname} has no options (linked DocType) specified`);
      }

      console.error(`Getting options for Link field ${fieldname} from DocType ${linkedDocType}`);

      try {
        // Try to get the title field for the linked DocType
        const linkedSchema = await getDocTypeSchema(linkedDocType);
        const titleField = linkedSchema.fields.find((f: any) => f.fieldname === "title" || f.bold === 1);
        const displayFields = titleField ? ["name", titleField.fieldname] : ["name"];

        const response = await frappe.db().getDocList(linkedDocType, { limit: 50, fields: displayFields, filters: filters as any });

        if (!response) {
          throw new Error(`Invalid response for DocType ${linkedDocType}`);
        }

        return response.map((item: any) => {
          const label = titleField && item[titleField.fieldname]
            ? `${item.name} - ${item[titleField.fieldname]}`
            : item.name;

          return {
            value: item.name,
            label: label,
          };
        });
      } catch (error) {
        console.error(`Error fetching options for Link field ${fieldname}:`, error);
        // Try a simpler approach as fallback
        const response = await frappe.db().getDocList(linkedDocType, { limit: 50, fields: ["name"], filters: filters as any });

        if (!response) {
          throw new Error(`Invalid response for DocType ${linkedDocType}`);
        }

        return response.map((item: any) => ({
          value: item.name,
          label: item.name,
        }));
      }
    } else if (field.fieldtype === "Select") {
      // For Select fields, parse the options string
      console.error(`Getting options for Select field ${fieldname}: ${field.options}`);

      if (!field.options) {
        return [];
      }

      return field.options.split("\n")
        .filter((option: string) => option.trim() !== '')
        .map((option: string) => ({
          value: option.trim(),
          label: option.trim(),
        }));
    } else if (field.fieldtype === "Table") {
      // For Table fields, return an empty array with a message
      console.error(`Field ${fieldname} is a Table field, no options available`);
      return [];
    } else {
      console.error(`Field ${fieldname} is type ${field.fieldtype}, not Link or Select`);
      return [];
    }
  } catch (error) {
    console.error(`Error in getFieldOptions for ${doctype}.${fieldname}:`, error);
    return handleApiError(error, `get_field_options(${doctype}, ${fieldname})`);
  }
}

/**
 * Get a list of all DocTypes in the system
 * @returns Array of DocType names
 */
export async function getAllDocTypes(): Promise<string[]> {
  try {
    const response = await frappe.db().getDocList('DocType', { limit: 1000, fields: ["name"] });

    if (!response) {
      throw new Error('Invalid response format for DocType list');
    }

    return response.map((item: any) => item.name);
  } catch (error) {
    return handleApiError(error, 'get_all_doctypes');
  }
}

/**
 * Get a list of all modules in the system
 * @returns Array of module names
 */
export async function getAllModules(): Promise<string[]> {
  try {
    const response = await frappe.db().getDocList('Module Def', { limit: 100, fields: ["name", "module_name"] });

    if (!response) {
      throw new Error('Invalid response format for Module list');
    }

    return response.map((item: any) => item.name || item.module_name);
  } catch (error) {
    return handleApiError(error, 'get_all_modules');
  }
}