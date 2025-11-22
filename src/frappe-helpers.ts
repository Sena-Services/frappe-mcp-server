/**
 * Helper functions for interacting with the Frappe API
 * These functions provide additional functionality and better error handling
 */

import axios, { AxiosError } from "axios";
import { getDocument, listDocuments, getDocTypeSchema } from "./frappe-api.js";
import { FrappeApp } from "frappe-js-sdk";
import { FrappeApiError } from "./errors.js";

/**
 * Check if a DocType exists
 * @param client Frappe client instance
 * @param doctype The DocType name to check
 * @returns True if the DocType exists, false otherwise
 */
export async function doesDocTypeExist(client: FrappeApp, doctype: string): Promise<boolean> {
  try {
    await getDocTypeSchema(client, doctype);
    return true;
  } catch (error) {
    if (error instanceof Error &&
        (error.message.includes("not found") ||
         error.message.includes("does not exist"))) {
      return false;
    }
    throw error; // Re-throw other errors
  }
}

/**
 * Check if a document exists
 * @param doctype The DocType name
 * @param name The document name
 * @returns True if the document exists, false otherwise
 */
export async function doesDocumentExist(client: FrappeApp, doctype: string, name: string): Promise<boolean> {
  try {
    await getDocument(client, doctype, name, ["name"]);
    return true;
  } catch (error) {
    if (error instanceof Error && 
        (error.message.includes("not found") || 
         error.message.includes("does not exist"))) {
      return false;
    }
    throw error; // Re-throw other errors
  }
}

/**
 * Find DocTypes matching a search term
 * @param searchTerm The search term to look for in DocType names
 * @param options Additional options for the search
 * @returns Array of matching DocTypes with their details
 */
export async function findDocTypes(
  client: FrappeApp, searchTerm: string, 
  options: {
    module?: string;
    isTable?: boolean;
    isSingle?: boolean;
    isCustom?: boolean;
    limit?: number;
  } = {}
): Promise<any[]> {
  const filters: Record<string, any> = {};
  
  // Add name search filter
  if (searchTerm) {
    filters.name = ["like", `%${searchTerm}%`];
  }
  
  // Add optional filters
  if (options.module !== undefined) {
    filters.module = options.module;
  }
  
  if (options.isTable !== undefined) {
    filters.istable = options.isTable ? 1 : 0;
  }
  
  if (options.isSingle !== undefined) {
    filters.issingle = options.isSingle ? 1 : 0;
  }
  
  if (options.isCustom !== undefined) {
    filters.custom = options.isCustom ? 1 : 0;
  }
  
  return await listDocuments(client, 
    "DocType",
    filters,
    ["name", "module", "description", "istable", "issingle", "custom"],
    options.limit || 20
  );
}

/**
 * Get a list of all modules in the system
 * @returns Array of module names
 */
export async function getModuleList(client: FrappeApp): Promise<string[]> {
  try {
    const modules = await listDocuments(client, 
      "Module Def",
      {},
      ["name", "module_name"],
      100
    );
    
    return modules.map(m => m.name || m.module_name);
  } catch (error) {
    console.error("Error fetching module list:", error);
    throw new FrappeApiError(
      `Failed to fetch module list: ${(error as Error).message}`
    );
  }
}

/**
 * Get a list of DocTypes in a specific module
 * @param module The module name
 * @returns Array of DocTypes in the module
 */
export async function getDocTypesInModule(client: FrappeApp, module: string): Promise<any[]> {
  return await listDocuments(client, 
    "DocType",
    { module: module },
    ["name", "description", "istable", "issingle", "custom"],
    100
  );
}

/**
 * Get a count of documents matching filters
 * @param doctype The DocType name
 * @param filters Filters to apply
 * @returns The count of matching documents
 */
export async function getDocumentCount(
  client: FrappeApp, doctype: string,
  filters: Record<string, any> = {}
): Promise<number> {
  try {
    // Use count(*) to get the total count of documents
    const result = await listDocuments(client, 
      doctype,
      filters,
      ["count(name) as total_count"],
      1
    );
    
    // Extract the count from the result
    if (result && result.length > 0 && result[0].total_count !== undefined) {
      return result[0].total_count;
    }
    
    // Fallback: make another request to get all IDs and count them
    // This is less efficient but should work if the count query fails
    console.error(`Count query didn't return expected result, using fallback method`);
    const allIds = await listDocuments(client, doctype, filters, ["name"]);
    return allIds.length;
  } catch (error) {
    console.error(`Error getting document count for ${doctype}:`, error);
    throw new FrappeApiError(
      `Failed to get document count for ${doctype}: ${(error as Error).message}`
    );
  }
}

/**
 * Get the naming series for a DocType
 * @param doctype The DocType name
 * @returns The naming series information or null if not applicable
 */
export async function getNamingSeriesInfo(client: FrappeApp, doctype: string): Promise<any> {
  try {
    const schema = await getDocTypeSchema(client, doctype);
    
    // Return naming information from the schema
    return {
      autoname: schema.autoname,
      namingSeriesField: schema.fields.find((f: any) => f.fieldname === "naming_series"),
      isAutoNamed: !!schema.autoname && schema.autoname !== "prompt",
      isPromptNamed: schema.autoname === "prompt",
      hasNamingSeries: schema.fields.some((f: any) => f.fieldname === "naming_series")
    };
  } catch (error) {
    console.error(`Error getting naming series for ${doctype}:`, error);
    throw new FrappeApiError(
      `Failed to get naming series for ${doctype}: ${(error as Error).message}`
    );
  }
}

/**
 * Format filters for Frappe API
 * This helper converts various filter formats to the format expected by the API
 * @param filters The filters in various formats
 * @returns Properly formatted filters for the API
 */
export function formatFilters(filters: any): any {
  if (!filters) return {};
  
  // If already in the correct format, return as is
  if (Array.isArray(filters) && filters.every(f => Array.isArray(f))) {
    return filters;
  }
  
  // If it's an object, convert to the array format
  if (typeof filters === 'object' && !Array.isArray(filters)) {
    const formattedFilters = [];
    
    for (const [field, value] of Object.entries(filters)) {
      if (Array.isArray(value) && value.length === 2 && 
          typeof value[0] === 'string' && ['=', '!=', '<', '>', '<=', '>=', 'like', 'not like', 'in', 'not in', 'is', 'is not', 'between'].includes(value[0])) {
        // It's already in [operator, value] format
        formattedFilters.push([field, value[0], value[1]]);
      } else {
        // It's a simple equality filter
        formattedFilters.push([field, '=', value]);
      }
    }
    
    return formattedFilters;
  }
  
  // Return as is for other cases
  return filters;
}

/**
 * Get field metadata for a specific field in a DocType
 * @param doctype The DocType name
 * @param fieldname The field name
 * @returns The field metadata or null if not found
 */
export async function getFieldMetadata(client: FrappeApp, doctype: string, fieldname: string): Promise<any | null> {
  try {
    const schema = await getDocTypeSchema(client, doctype);
    
    if (!schema || !schema.fields) {
      throw new Error(`Could not get schema for DocType ${doctype}`);
    }
    
    const field = schema.fields.find((f: any) => f.fieldname === fieldname);
    return field || null;
  } catch (error) {
    console.error(`Error getting field metadata for ${doctype}.${fieldname}:`, error);
    throw new FrappeApiError(
      `Failed to get field metadata for ${doctype}.${fieldname}: ${(error as Error).message}`
    );
  }
}

/**
 * Get required fields for a DocType
 * @param doctype The DocType name
 * @returns Array of required field names and their metadata
 */
export async function getRequiredFields(client: FrappeApp, doctype: string): Promise<any[]> {
  try {
    const schema = await getDocTypeSchema(client, doctype);
    
    if (!schema || !schema.fields) {
      throw new Error(`Could not get schema for DocType ${doctype}`);
    }
    
    return schema.fields.filter((f: any) => f.reqd);
  } catch (error) {
    console.error(`Error getting required fields for ${doctype}:`, error);
    throw new FrappeApiError(
      `Failed to get required fields for ${doctype}: ${(error as Error).message}`
    );
  }
}