import { FrappeApp } from "frappe-js-sdk";
import { handleApiError } from './errors.js';
import * as docApi from './document-api-parameterized.js';

/**
 * Parameterized schema operations that accept a Frappe client
 */

export async function getDocTypeSchema(client: FrappeApp, doctype: string): Promise<any> {
  try {
    if (!doctype) throw new Error("DocType name is required");

    console.error(`Getting full DocType document for ${doctype}`);
    let response;

    try {
      // Get the meta which includes both standard and custom fields
      response = await client.call().get('frappe.get_meta', { doctype: doctype });
      console.error(`Got meta response for ${doctype}`);
    } catch (error) {
      console.error(`Error getting meta for ${doctype}:`, error);
      throw error;
    }

    const docTypeData = response;

    if (docTypeData && docTypeData.message) {
      const meta = docTypeData.message;
      const allFields = meta.fields || [];

      const customFieldsCount = allFields.filter((f: any) => f.is_custom_field === 1).length;
      const standardFieldsCount = allFields.length - customFieldsCount;

      console.error(`Total fields: ${allFields.length} (${standardFieldsCount} standard, ${customFieldsCount} custom)`);

      return {
        name: doctype,
        label: meta.name || doctype,
        description: meta.description,
        module: meta.module,
        issingle: meta.issingle === 1,
        istable: meta.istable === 1,
        custom: meta.custom === 1,
        fields: allFields.map((field: any) => ({
          fieldname: field.fieldname,
          label: field.label,
          fieldtype: field.fieldtype,
          required: field.reqd === 1,
          description: field.description,
          default: field.default,
          options: field.options,
          min_length: field.min_length,
          max_length: field.max_length,
          min_value: field.min_value,
          max_value: field.max_value,
          linked_doctype: field.fieldtype === "Link" ? field.options : null,
          child_doctype: field.fieldtype === "Table" ? field.options : null,
          in_list_view: field.in_list_view === 1,
          in_standard_filter: field.in_standard_filter === 1,
          in_global_search: field.in_global_search === 1,
          bold: field.bold === 1,
          hidden: field.hidden === 1,
          read_only: field.read_only === 1,
          allow_on_submit: field.allow_on_submit === 1,
          set_only_once: field.set_only_once === 1,
          allow_bulk_edit: field.allow_bulk_edit === 1,
          translatable: field.translatable === 1,
          is_custom_field: field.is_custom_field === 1,
        })),
        permissions: docTypeData.permissions || [],
        autoname: meta.autoname,
        name_case: meta.name_case,
        workflow: docTypeData.workflow || null,
        is_submittable: meta.is_submittable === 1,
        quick_entry: meta.quick_entry === 1,
        track_changes: meta.track_changes === 1,
        track_views: meta.track_views === 1,
        has_web_view: meta.has_web_view === 1,
      };
    }

    throw new Error(`Invalid response format for DocType schema ${doctype}`);
  } catch (error) {
    handleApiError(error, `get_doctype_schema(${doctype})`);
  }
}

export async function getFieldOptions(
  client: FrappeApp,
  doctype: string,
  fieldname: string
): Promise<any> {
  try {
    if (!doctype) throw new Error("DocType name is required");
    if (!fieldname) throw new Error("Field name is required");

    const schema = await getDocTypeSchema(client, doctype);

    if (!schema || !schema.fields) {
      throw new Error(`Could not get schema for DocType ${doctype}`);
    }

    const field = schema.fields.find((f: any) => f.fieldname === fieldname);

    if (!field) {
      throw new Error(`Field ${fieldname} not found in DocType ${doctype}`);
    }

    if (field.fieldtype === "Link" && field.options) {
      const linkedDoctype = field.options;
      const documents = await docApi.listDocuments(
        client,
        linkedDoctype,
        undefined,
        ["name"],
        100
      );

      return {
        fieldtype: "Link",
        linked_doctype: linkedDoctype,
        options: documents.map((doc: any) => doc.name)
      };
    }

    if (field.fieldtype === "Select" && field.options) {
      const options = field.options.split('\n').map((opt: string) => opt.trim()).filter((opt: string) => opt);
      return {
        fieldtype: "Select",
        options: options
      };
    }

    return {
      fieldtype: field.fieldtype,
      options: field.options || []
    };
  } catch (error) {
    handleApiError(error, `get_field_options(${doctype}, ${fieldname})`);
  }
}

export async function getAllDocTypes(client: FrappeApp): Promise<any[]> {
  try {
    const docTypes = await docApi.listDocuments(
      client,
      "DocType",
      undefined,
      ["name", "module", "custom", "issingle", "istable"],
      1000,
      "name asc"
    );
    return docTypes;
  } catch (error) {
    handleApiError(error, "get_all_doctypes()");
  }
}

export async function getAllModules(client: FrappeApp): Promise<any[]> {
  try {
    const modules = await docApi.listDocuments(
      client,
      "Module Def",
      undefined,
      ["name", "module_name"],
      1000,
      "name asc"
    );
    return modules;
  } catch (error) {
    handleApiError(error, "get_all_modules()");
  }
}
