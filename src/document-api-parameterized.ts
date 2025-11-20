import { FrappeApp } from "frappe-js-sdk";
import { handleApiError } from './errors.js';

/**
 * Parameterized document operations that accept a Frappe client
 * These allow using different credentials per call
 */

export async function getDocument(
  client: FrappeApp,
  doctype: string,
  name: string,
  fields?: string[]
): Promise<any> {
  if (!doctype) throw new Error("DocType is required");
  if (!name) throw new Error("Document name is required");

  try {
    const response = await client.db().getDoc(doctype, name);

    if (!response) {
      throw new Error(`Invalid response format for document ${doctype}/${name}`);
    }

    return response;
  } catch (error) {
    handleApiError(error, `get_document(${doctype}, ${name})`);
  }
}

export async function createDocument(
  client: FrappeApp,
  doctype: string,
  values: Record<string, any>
): Promise<any> {
  try {
    if (!doctype) throw new Error("DocType is required");
    if (!values || Object.keys(values).length === 0) {
      throw new Error("Document values are required");
    }

    const response = await client.db().createDoc(doctype, values);

    if (!response) {
      throw new Error(`Invalid response format for creating ${doctype}`);
    }

    return response;
  } catch (error) {
    handleApiError(error, `create_document(${doctype})`);
  }
}

export async function updateDocument(
  client: FrappeApp,
  doctype: string,
  name: string,
  values: Record<string, any>
): Promise<any> {
  try {
    if (!doctype) throw new Error("DocType is required");
    if (!name) throw new Error("Document name is required");
    if (!values || Object.keys(values).length === 0) {
      throw new Error("Update values are required");
    }

    const response = await client.db().updateDoc(doctype, name, values);

    if (!response) {
      throw new Error(`Invalid response format for updating ${doctype}/${name}`);
    }

    return response;
  } catch (error) {
    handleApiError(error, `update_document(${doctype}, ${name})`);
  }
}

export async function deleteDocument(
  client: FrappeApp,
  doctype: string,
  name: string
): Promise<any> {
  try {
    if (!doctype) throw new Error("DocType is required");
    if (!name) throw new Error("Document name is required");

    const response = await client.db().deleteDoc(doctype, name);

    if (!response) {
      return response;
    }
    return response;

  } catch (error) {
    handleApiError(error, `delete_document(${doctype}, ${name})`);
  }
}

export async function listDocuments(
  client: FrappeApp,
  doctype: string,
  filters?: Record<string, any>,
  fields?: string[],
  limit?: number,
  order_by?: string,
  limit_start?: number
): Promise<any[]> {
  try {
    if (!doctype) throw new Error("DocType is required");

    let orderByOption: { field: string; order?: "asc" | "desc" } | undefined = undefined;
    if (order_by) {
      const parts = order_by.trim().split(/\s+/);
      const field = parts[0];
      const order = parts[1]?.toLowerCase() === "desc" ? "desc" : "asc";
      orderByOption = { field, order };
    }

    const optionsForGetDocList = {
      fields: fields,
      filters: filters as any[],
      orderBy: orderByOption,
      limit_start: limit_start,
      limit: limit
    };

    const response = await client.db().getDocList(doctype, optionsForGetDocList as any);

    if (!response) {
      throw new Error(`Invalid response format for listing ${doctype}`);
    }

    return response;
  } catch (error) {
    handleApiError(error, `list_documents(${doctype})`);
  }
}

export async function callMethod(
  client: FrappeApp,
  method: string,
  params?: Record<string, any>
): Promise<any> {
  try {
    if (!method) throw new Error("Method name is required");

    const response = await client.call().post(method, params);

    if (!response) {
      throw new Error(`Invalid response format for method ${method}`);
    }

    return response;
  } catch (error) {
    handleApiError(error, `call_method(${method})`);
  }
}
