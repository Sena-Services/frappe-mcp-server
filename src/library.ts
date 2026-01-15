/**
 * Library interface for frappe-mcp-server
 * Allows using MCP tools as a library with custom credentials per call
 */

import { FrappeApp } from "frappe-js-sdk";
import { createFrappeClient, FrappeClientConfig } from './api-client-factory.js';
import * as docApi from './document-api-parameterized.js';
import * as schemaApi from './schema-api-parameterized.js';
import * as frappeHelpers from './frappe-helpers.js';

import { DOCUMENT_TOOLS } from './document-operations.js';
import { SCHEMA_TOOLS } from './schema-operations.js';
import { HELPER_TOOLS, getInstructions, FRAPPE_INSTRUCTIONS } from './frappe-instructions.js';
import { BLUEPRINT_TOOLS } from './blueprint-operations.js';
import { DOCTYPE_OPERATIONS_TOOLS } from './doctype-operations.js';
import { WORKFLOW_TOOLS } from './workflow-operations.js';
import { UI_TOOLS } from './ui-operations.js';
import { WEB_TOOLS, executeWebSearch, executeWebExtract } from './web-operations.js';

/**
 * Helper function to extract success from Frappe API response
 * Frappe returns { message: { success: true/false, ... } } OR { success: true/false, ... }
 */
function getSuccess(result: any): boolean {
  return result?.message?.success ?? result?.success ?? false;
}

/**
 * Validate JSON string and return detailed error with fix suggestions.
 * Used for workflow blueprint triggers/actions validation.
 */
function validateJsonWithHelp(jsonStr: string, fieldName: string): { valid: boolean; error?: string; suggestion?: string } {
  try {
    JSON.parse(jsonStr);
    return { valid: true };
  } catch (e: any) {
    const errorMsg = e.message || 'Unknown JSON error';
    const match = errorMsg.match(/position (\d+)/i) || errorMsg.match(/column (\d+)/i);
    const position = match ? parseInt(match[1]) : null;

    // Count brackets to find mismatches
    let openCurly = 0, closeCurly = 0, openSquare = 0, closeSquare = 0;
    for (const c of jsonStr) {
      if (c === '{') openCurly++;
      if (c === '}') closeCurly++;
      if (c === '[') openSquare++;
      if (c === ']') closeSquare++;
    }

    let suggestion = '';
    if (openCurly > closeCurly) {
      suggestion = `Missing ${openCurly - closeCurly} closing brace(s) "}". Each action object needs: {"action_name": {...}} - make sure every { has a matching }.`;
    } else if (openCurly < closeCurly) {
      suggestion = `Extra ${closeCurly - openCurly} closing brace(s) "}". Remove the extra }.`;
    } else if (openSquare > closeSquare) {
      suggestion = `Missing ${openSquare - closeSquare} closing bracket(s) "]".`;
    } else if (openSquare < closeSquare) {
      suggestion = `Extra ${closeSquare - openSquare} closing bracket(s) "]".`;
    }

    // Show context around the error
    let context = '';
    if (position !== null && position < jsonStr.length) {
      const start = Math.max(0, position - 40);
      const end = Math.min(jsonStr.length, position + 40);
      context = `\n\nError location: ...${jsonStr.slice(start, position)}<<<HERE>>>${jsonStr.slice(position, end)}...`;
    }

    return {
      valid: false,
      error: `Invalid JSON in ${fieldName}: ${errorMsg}${context}`,
      suggestion: suggestion || 'Check that all brackets are properly matched and all strings are quoted with double quotes.'
    };
  }
}

export interface SiteCredentials {
  url: string;
  api_key: string;
  api_secret: string;
}

/**
 * List all available MCP tools
 */
export function listTools() {
  return [
    {
      name: "call_method",
      description: "Execute a whitelisted Frappe method",
      inputSchema: {
        type: "object",
        properties: {
          method: { type: "string", description: "Method name to call (whitelisted)" },
          params: {
            type: "object",
            description: "Parameters to pass to the method (optional)",
            additionalProperties: true
          },
        },
        required: ["method"],
      },
    },
    ...DOCUMENT_TOOLS,
    ...SCHEMA_TOOLS,
    ...HELPER_TOOLS,
    ...BLUEPRINT_TOOLS,
    ...DOCTYPE_OPERATIONS_TOOLS,
    ...WORKFLOW_TOOLS,
    ...UI_TOOLS,
    ...WEB_TOOLS,
    {
      name: "ping",
      description: "A simple tool to check if the server is responding.",
      inputSchema: { type: "object", properties: {} }
    }
  ];
}

/**
 * Execute an MCP tool with site-specific credentials
 */
export async function executeTool(
  toolName: string,
  args: any,
  credentials: SiteCredentials
): Promise<any> {
  // Create Frappe client with site-specific credentials
  const client = createFrappeClient({
    url: credentials.url,
    api_key: credentials.api_key,
    api_secret: credentials.api_secret
  });

  // Handle ping
  if (toolName === "ping") {
    return { content: [{ type: "text", text: "pong" }], isError: false };
  }

  // Handle web_search
  if (toolName === "web_search") {
    const tavilyApiKey = process.env.TAVILY_API_KEY;
    if (!tavilyApiKey) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "TAVILY_API_KEY not configured in environment"
          }, null, 2)
        }],
        isError: true
      };
    }
    try {
      const result = await executeWebSearch(args, tavilyApiKey);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }],
        isError: false
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message || "Web search failed"
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  // Handle web_extract
  if (toolName === "web_extract") {
    const tavilyApiKey = process.env.TAVILY_API_KEY;
    if (!tavilyApiKey) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "TAVILY_API_KEY not configured in environment"
          }, null, 2)
        }],
        isError: true
      };
    }
    try {
      const result = await executeWebExtract(args, tavilyApiKey);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }],
        isError: false
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message || "Web extract failed"
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  // Handle call_method
  if (toolName === "call_method") {
    const result = await docApi.callMethod(client, args.method, args.params);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: false
    };
  }

  // Handle document operations
  if (toolName === "create_document") {
    const result = await docApi.createDocument(client, args.doctype, args.values);
    return {
      content: [{
        type: "text",
        text: `Document created successfully:\n${JSON.stringify(result, null, 2)}`
      }],
      isError: false
    };
  }

  if (toolName === "get_document") {
    const result = await docApi.getDocument(client, args.doctype, args.name, args.fields);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: false
    };
  }

  if (toolName === "update_document") {
    const result = await docApi.updateDocument(client, args.doctype, args.name, args.values);
    return {
      content: [{
        type: "text",
        text: `Document updated successfully:\n${JSON.stringify(result, null, 2)}`
      }],
      isError: false
    };
  }

  if (toolName === "delete_document") {
    const result = await docApi.deleteDocument(client, args.doctype, args.name);
    return {
      content: [{
        type: "text",
        text: `Document deleted successfully`
      }],
      isError: false
    };
  }

  if (toolName === "list_documents") {
    const result = await docApi.listDocuments(
      client,
      args.doctype,
      args.filters,
      args.fields,
      args.limit,
      args.order_by,
      args.limit_start
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: false
    };
  }

  // rename_document - for renaming documents (especially with autoname fields)
  if (toolName === "rename_document") {
    const result = await docApi.callMethod(client, "frappe.client.rename_doc", {
      doctype: args.doctype,
      old_name: args.old_name,
      new_name: args.new_name,
      merge: args.merge ? 1 : 0
    });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          message: `Document renamed from '${args.old_name}' to '${args.new_name}'`,
          doctype: args.doctype,
          old_name: args.old_name,
          new_name: args.new_name,
          result: result
        }, null, 2)
      }],
      isError: false
    };
  }

  // bulk_create_documents - create multiple documents at once
  if (toolName === "bulk_create_documents") {
    const documents = args.documents as Record<string, any>[];
    const results: { created: string[], failed: { index: number, error: string }[] } = { created: [], failed: [] };

    for (let i = 0; i < documents.length; i++) {
      try {
        const result = await docApi.createDocument(client, args.doctype, documents[i]);
        results.created.push(result.name || `Document ${i + 1}`);
      } catch (err: any) {
        results.failed.push({ index: i, error: err.message || String(err) });
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: results.failed.length === 0,
          message: `Created ${results.created.length} of ${documents.length} documents`,
          created_count: results.created.length,
          created: results.created,
          failed: results.failed.length > 0 ? results.failed : undefined
        }, null, 2)
      }],
      isError: false
    };
  }

  // bulk_update_documents - update multiple documents at once
  if (toolName === "bulk_update_documents") {
    const values = args.values as Record<string, any>;
    const limit = (args.limit as number) || 100;
    let docsToUpdate: string[] = [];

    if (args.names) {
      docsToUpdate = (args.names as string[]).slice(0, limit);
    } else if (args.filters) {
      const docs = await docApi.listDocuments(client, args.doctype, args.filters, ["name"], limit);
      docsToUpdate = docs.map((d: any) => d.name);
    }

    if (docsToUpdate.length === 0) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, message: "No documents matched the criteria", updated_count: 0 }, null, 2) }],
        isError: false
      };
    }

    const results: { updated: string[], failed: { name: string, error: string }[] } = { updated: [], failed: [] };
    for (const docName of docsToUpdate) {
      try {
        await docApi.updateDocument(client, args.doctype, docName, values);
        results.updated.push(docName);
      } catch (err: any) {
        results.failed.push({ name: docName, error: err.message || String(err) });
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: results.failed.length === 0,
          message: `Updated ${results.updated.length} of ${docsToUpdate.length} documents`,
          updated_count: results.updated.length,
          updated: results.updated,
          values_applied: values,
          failed: results.failed.length > 0 ? results.failed : undefined
        }, null, 2)
      }],
      isError: false
    };
  }

  // bulk_delete_documents - delete multiple documents at once
  if (toolName === "bulk_delete_documents") {
    const limit = (args.limit as number) || 100;
    let docsToDelete: string[] = [];

    if (args.names) {
      docsToDelete = (args.names as string[]).slice(0, limit);
    } else if (args.filters) {
      const docs = await docApi.listDocuments(client, args.doctype, args.filters, ["name"], limit);
      docsToDelete = docs.map((d: any) => d.name);
    }

    if (docsToDelete.length === 0) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, message: "No documents matched the criteria", deleted_count: 0 }, null, 2) }],
        isError: false
      };
    }

    const results: { deleted: string[], failed: { name: string, error: string }[] } = { deleted: [], failed: [] };
    for (const docName of docsToDelete) {
      try {
        await docApi.deleteDocument(client, args.doctype, docName);
        results.deleted.push(docName);
      } catch (err: any) {
        results.failed.push({ name: docName, error: err.message || String(err) });
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: results.failed.length === 0,
          message: `Deleted ${results.deleted.length} of ${docsToDelete.length} documents`,
          deleted_count: results.deleted.length,
          deleted: results.deleted,
          failed: results.failed.length > 0 ? results.failed : undefined
        }, null, 2)
      }],
      isError: false
    };
  }

  // duplicate_document - copy a document with optional overrides
  if (toolName === "duplicate_document") {
    // Get the source document
    const sourceDoc = await docApi.getDocument(client, args.doctype, args.source_name);

    // Remove system fields that shouldn't be copied
    const systemFields = ['name', 'owner', 'creation', 'modified', 'modified_by', 'docstatus', 'idx', 'doctype', '_user_tags', '_comments', '_assign', '_liked_by'];
    const newDocValues: Record<string, any> = {};

    for (const [key, value] of Object.entries(sourceDoc)) {
      if (!systemFields.includes(key) && !key.startsWith('_')) {
        newDocValues[key] = value;
      }
    }

    // Apply override values
    if (args.override_values) {
      Object.assign(newDocValues, args.override_values);
    }

    // Create the new document
    const result = await docApi.createDocument(client, args.doctype, newDocValues);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          message: `Duplicated '${args.source_name}' to '${result.name}'`,
          source_name: args.source_name,
          new_name: result.name,
          new_document: result
        }, null, 2)
      }],
      isError: false
    };
  }

  // get_linked_documents - find documents that link to a specific document
  if (toolName === "get_linked_documents") {
    try {
      // Get link fields info for this DocType
      const linkInfo = await docApi.callMethod(client, "frappe.client.get_list", {
        doctype: "DocField",
        filters: {
          options: args.doctype,
          fieldtype: "Link"
        },
        fields: ["parent", "fieldname", "label"],
        limit_page_length: 100
      });

      // For each linking DocType, count how many docs link to our target
      const linkedDocs: Record<string, { count: number, field: string }> = {};

      for (const linkField of linkInfo) {
        if (linkField.parent && linkField.parent !== args.doctype) {
          try {
            const count = await docApi.callMethod(client, "frappe.client.get_count", {
              doctype: linkField.parent,
              filters: { [linkField.fieldname]: args.name }
            });
            if (count > 0) {
              linkedDocs[linkField.parent] = {
                count: count,
                field: linkField.fieldname
              };
            }
          } catch (e) {
            // Skip if we can't check this DocType
          }
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            doctype: args.doctype,
            name: args.name,
            linked_from: linkedDocs,
            total_linking_doctypes: Object.keys(linkedDocs).length,
            message: Object.keys(linkedDocs).length > 0
              ? `Found ${Object.keys(linkedDocs).length} DocTypes linking to this document`
              : "No documents link to this document"
          }, null, 2)
        }],
        isError: false
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message || String(error),
            doctype: args.doctype,
            name: args.name
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  // Reconcile bank transaction
  if (toolName === "reconcile_bank_transaction_with_vouchers") {
    const bankTransactionName = args.bank_transaction_name as string;
    const vouchers = args.vouchers as Array<{ payment_doctype: string; payment_name: string; amount: number }>;

    if (!bankTransactionName || !vouchers) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "Missing required parameters: bank_transaction_name and vouchers"
          }, null, 2)
        }],
        isError: true
      };
    }

    if (!Array.isArray(vouchers) || vouchers.some(v => !v.payment_doctype || !v.payment_name || typeof v.amount !== 'number')) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "Invalid format for 'vouchers' parameter. It must be an array of objects, each with 'payment_doctype' (string), 'payment_name' (string), and 'amount' (number)."
          }, null, 2)
        }],
        isError: true
      };
    }

    try {
      const result = await docApi.callMethod(
        client,
        "erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.reconcile_vouchers",
        {
          bank_transaction_name: bankTransactionName,
          vouchers: JSON.stringify(vouchers)
        }
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            message: `Bank transaction '${bankTransactionName}' reconciled successfully`,
            result: result?.message || result
          }, null, 2)
        }],
        isError: false
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message || String(error),
            bank_transaction_name: bankTransactionName
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  // Handle child table row operations
  if (toolName === "add_child_table_row") {
    try {
      const result = await docApi.callMethod(client, "sena_backend.builder.tools.data_tools.add_child_table_row", {
        child_doctype: args.child_doctype,
        parent_doctype: args.parent_doctype,
        parent_name: args.parent_name,
        parentfield: args.parentfield,
        values: args.values  // Pass as object, frappe-js-sdk handles serialization
      });
      // Result is wrapped in { message: { success, ... } }
      const data = result?.message || result;
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data, null, 2)
        }],
        isError: !data?.success
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message || String(error),
            operation: "add_child_table_row"
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  if (toolName === "update_child_table_row") {
    try {
      const result = await docApi.callMethod(client, "sena_backend.builder.tools.data_tools.update_child_table_row", {
        child_doctype: args.child_doctype,
        row_name: args.row_name,
        values: args.values  // Pass as object, frappe-js-sdk handles serialization
      });
      // Result is wrapped in { message: { success, ... } }
      const data = result?.message || result;
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data, null, 2)
        }],
        isError: !data?.success
      };
    } catch (error: any) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message || String(error),
            operation: "update_child_table_row"
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  // Handle schema operations
  if (toolName === "get_doctype_schema") {
    try {
      const result = await schemaApi.getDocTypeSchema(client, args.doctype);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }],
        isError: false
      };
    } catch (error: any) {
      // Return graceful error instead of throwing - allows agent to continue
      const errorMessage = error?.message || String(error);
      const is404 = errorMessage.includes('404') || errorMessage.includes('DoesNotExistError') || errorMessage.includes('not found');
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: true,
            exists: false,
            doctype: args.doctype,
            message: is404
              ? `DocType "${args.doctype}" does not exist. Check the exact DocType name.`
              : `Error getting schema for "${args.doctype}": ${errorMessage}`
          }, null, 2)
        }],
        isError: false  // Return false so agent can handle gracefully
      };
    }
  }

  if (toolName === "get_field_options") {
    const result = await schemaApi.getFieldOptions(client, args.doctype, args.fieldname);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: false
    };
  }

  // Handle blueprint operations
  if (toolName === "execute_blueprint") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.bl_engine.core.blueprint_executor.execute_blueprint_manually",
      {
        blueprint_name: args.blueprint_name,
        doc: args.doc_data
      }
    );
    return {
      content: [{
        type: "text",
        text: `Blueprint executed successfully:\n${JSON.stringify(result, null, 2)}`
      }],
      isError: false
    };
  }

  if (toolName === "list_blueprints") {
    const result = await docApi.listDocuments(
      client,
      "BL Blueprint",
      args.filters || { is_active: 1 },
      ["name", "blueprint_description"]
    );
    return {
      content: [{
        type: "text",
        text: `Available blueprints:\n${JSON.stringify(result, null, 2)}`
      }],
      isError: false
    };
  }

  if (toolName === "get_blueprint_info") {
    const result = await docApi.getDocument(client, "BL Blueprint", args.blueprint_name);
    return {
      content: [{
        type: "text",
        text: `Blueprint details:\n${JSON.stringify(result, null, 2)}`
      }],
      isError: false
    };
  }

  // Handle helper tools - these need to use callMethod or other Frappe APIs
  // For now, just handle a few common ones
  if (toolName === "find_doctypes") {
    const filters: any = {};
    if (args.search_term) {
      filters.name = ["like", `%${args.search_term}%`];
    }
    if (args.module) {
      filters.module = args.module;
    }
    if (args.is_table !== undefined) {
      filters.istable = args.is_table ? 1 : 0;
    }

    const result = await docApi.listDocuments(
      client,
      "DocType",
      filters,
      ["name", "module", "custom", "issingle", "istable"],
      args.limit || 50
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: false
    };
  }

  if (toolName === "get_module_list") {
    const result = await schemaApi.getAllModules(client);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: false
    };
  }

  if (toolName === "get_doctypes_in_module") {
    const result = await docApi.listDocuments(
      client,
      "DocType",
      { module: args.module },
      ["name", "module", "custom", "issingle", "istable"]
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: false
    };
  }

  if (toolName === "check_doctype_exists") {
    try {
      await schemaApi.getDocTypeSchema(client, args.doctype);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ exists: true, doctype: args.doctype }, null, 2)
        }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ exists: false, doctype: args.doctype }, null, 2)
        }],
        isError: false
      };
    }
  }

  if (toolName === "check_document_exists") {
    try {
      await docApi.getDocument(client, args.doctype, args.name);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ exists: true, doctype: args.doctype, name: args.name }, null, 2)
        }],
        isError: false
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ exists: false, doctype: args.doctype, name: args.name }, null, 2)
        }],
        isError: false
      };
    }
  }

  if (toolName === "get_document_count") {
    const result = await docApi.callMethod(
      client,
      "frappe.client.get_count",
      {
        doctype: args.doctype,
        filters: args.filters
      }
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ count: result }, null, 2)
      }],
      isError: false
    };
  }

  if (toolName === "get_required_fields") {
    const result = await frappeHelpers.getRequiredFields(client, args.doctype);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: false
    };
  }

  if (toolName === "get_naming_info") {
    const result = await frappeHelpers.getNamingSeriesInfo(client, args.doctype);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: false
    };
  }

  // Handle explore_system - MASTER exploration tool
  // 5 Parameters: doctypes, fields, relationships, documents, doctypes_full
  if (toolName === "explore_system") {
    console.error(`[explore_system] Called with args: ${JSON.stringify(args)}`);

    // Clear Frappe cache before exploration to ensure fresh data
    try {
      await docApi.callMethod(client, "frappe.clear_cache", {});
      console.error(`[explore_system] Cache cleared successfully`);
    } catch (cacheError) {
      console.error(`[explore_system] Cache clear failed (non-fatal):`, cacheError);
    }

    // Parse all parameters (now 11 top-level params)
    const doctypesToCheck: string[] = args.doctypes || [];
    const listAllDoctypes: boolean = args.list_all_doctypes || false;
    const findDoctypesSearches: Array<{search_term?: string, module?: string, is_custom?: boolean, limit?: number}> = args.find_doctypes || [];
    const fieldsToGet: string[] = args.fields || [];
    const relationshipsToGet: string[] = args.relationships || [];
    const documentsArg: { check?: Array<{doctype: string, name: string}>, list?: Array<{doctype: string, filters?: any, limit?: number}>, count?: Array<{doctype: string, filters?: any}> } = args.documents || {};
    const doctypesFullCheck: string[] = args.doctypes_full || [];

    // Workflow params (now top-level)
    const blueprintsToCheck: string[] = args.blueprints || [];
    const triggersForDoctype: string[] = args.triggers_for_doctype || [];
    const getSchedules: boolean = args.schedules || false;
    const getRoles: boolean = args.roles || false;
    const getAvailableEvents: boolean = args.available_events || false;
    const getAvailableActions: boolean = args.available_actions || false;

    // UI params
    const getUILayouts: boolean = args.ui_layouts || false;
    const getUITemplates: boolean = args.ui_templates || false;
    const getUIPages: boolean = args.ui_pages || false;
    const uiContractsToGet: string[] = args.ui_contracts || [];

    // Agent Builder params (16-21)
    const aiAgentsToCheck: string[] = args.ai_agents || [];
    const aiAgentsFullCheck: string[] = args.ai_agents_full || [];
    const getGraphArchitectures: boolean = args.graph_architectures || false;
    const getAvailableModels: boolean = args.available_models || false;
    const getAvailableAgentTools: boolean = args.available_agent_tools || false;
    const getSystemAgents: boolean = args.system_agents || false;
    const getAvailableFieldTypes: boolean = args.available_field_types || false;

    const results: Record<string, any> = {
      doctypes: {},
      all_doctypes: null,
      find_doctypes: {},
      fields: {},
      relationships: {},
      documents: { check: {}, list: {}, count: {} },
      doctypes_full: {},
      blueprints: {},
      triggers_for_doctype: {},
      schedules: null,
      roles: null,
      available_events: null,
      available_actions: null,
      // UI results
      ui_layouts: null,
      ui_templates: null,
      ui_pages: null,
      ui_contracts: {},
      // Agent Builder results
      ai_agents: {},
      ai_agents_full: {},
      graph_architectures: null,
      available_models: null,
      available_agent_tools: null,
      system_agents: null,
      available_field_types: null
    };

    // Helper function to check if DocType exists in DB and get its ACTUAL name
    // DocType names are case-sensitive, so we need to return the exact name from DB
    async function checkDoctypeExists(doctype: string): Promise<{ exists: boolean, actualName: string | null }> {
      try {
        // Use get_list to find the DocType with case-insensitive LIKE match
        const result = await client.call().get('frappe.client.get_list', {
          doctype: 'DocType',
          filters: [['name', 'like', doctype]],
          fields: ['name'],
          limit_page_length: 1
        });

        const docs = result?.message || result?.data || result || [];
        if (Array.isArray(docs) && docs.length > 0) {
          // Return the ACTUAL name from the database
          return { exists: true, actualName: docs[0].name };
        }
        return { exists: false, actualName: null };
      } catch (error) {
        console.error(`[checkDoctypeExists] Error checking ${doctype}:`, error);
        return { exists: false, actualName: null };
      }
    }

    // Helper function to get child table schema
    async function getChildTableSchema(childDoctype: string): Promise<any> {
      try {
        const checkResult = await checkDoctypeExists(childDoctype);
        if (!checkResult.exists) {
          return { exists: false, doctype: childDoctype };
        }
        const actualName = checkResult.actualName!;
        const schema = await schemaApi.getDocTypeSchema(client, actualName);
        return {
          exists: true,
          doctype: actualName,  // Use actual name from DB
          field_count: schema.fields.length,
          fields: schema.fields.map((f: any) => ({
            fieldname: f.fieldname,
            fieldtype: f.fieldtype,
            label: f.label,
            reqd: f.required ? 1 : 0,
            options: f.options || '',
            default: f.default || ''
          }))
        };
      } catch (error) {
        return { exists: false, doctype: childDoctype, error: 'Failed to get schema' };
      }
    }

    // Helper to get backlinks for a DocType
    async function getBacklinks(doctype: string): Promise<any[]> {
      const linked_from: any[] = [];
      try {
        const linkingDoctypes = await docApi.listDocuments(
          client,
          'DocField',
          {
            fieldtype: 'Link',
            options: doctype,
            parent: ['not like', 'Custom Field']
          },
          ['parent', 'fieldname'],
          50
        );

        const backlinkMap: Record<string, { fieldname: string }> = {};
        for (const lf of linkingDoctypes) {
          if (lf.parent && lf.parent !== doctype) {
            backlinkMap[lf.parent] = { fieldname: lf.fieldname };
          }
        }

        try {
          const customLinkFields = await docApi.listDocuments(
            client,
            'Custom Field',
            { fieldtype: 'Link', options: doctype },
            ['dt', 'fieldname'],
            50
          );
          for (const cf of customLinkFields) {
            if (cf.dt && cf.dt !== doctype) {
              backlinkMap[cf.dt] = { fieldname: cf.fieldname };
            }
          }
        } catch (e) { /* Custom Field may not exist */ }

        for (const [dt, info] of Object.entries(backlinkMap)) {
          linked_from.push({ doctype: dt, fieldname: info.fieldname });
        }
      } catch (e) {
        console.error(`[explore_system] Error getting backlinks for ${doctype}:`, e);
      }
      return linked_from;
    }

    // Run all checks in parallel
    await Promise.all([
      // 1. DOCTYPES - Quick existence check
      ...doctypesToCheck.map(async (doctype) => {
        try {
          const checkResult = await checkDoctypeExists(doctype);
          console.error(`[explore_system] DocType ${doctype} exists: ${checkResult.exists}, actualName: ${checkResult.actualName}`);

          if (!checkResult.exists) {
            results.doctypes[doctype] = { exists: false };
            return;
          }

          const actualName = checkResult.actualName!;
          const schema = await schemaApi.getDocTypeSchema(client, actualName);
          // Store under the ACTUAL name from DB, and include it in the result
          results.doctypes[actualName] = {
            exists: true,
            name: actualName,  // Include actual name for agents to use
            searchedAs: doctype !== actualName ? doctype : undefined,  // Only if different
            isTable: schema.istable || false,
            isSingle: schema.issingle || false,
            isCustom: schema.custom || false,
            autoname: schema.autoname,
            fieldCount: schema.fields.length
          };
        } catch (error: any) {
          console.error(`[explore_system] Error checking ${doctype}:`, error.message);
          results.doctypes[doctype] = { exists: false };
        }
      }),

      // 1a. LIST_ALL_DOCTYPES - Simple list of all custom DocTypes
      (async () => {
        if (!listAllDoctypes) return;
        try {
          const result: any = await docApi.listDocuments(
            client,
            "DocType",
            { custom: 1 },
            ["name"],
            200
          );
          const doctypeList = Array.isArray(result) ? result : (result.data || []);
          results.all_doctypes = doctypeList.map((d: any) => d.name);
        } catch (error: any) {
          console.error(`[explore_system] Error listing all doctypes:`, error.message);
          results.all_doctypes = { error: error.message };
        }
      })(),

      // 1b. FIND_DOCTYPES - Search for DocTypes by pattern/module
      ...findDoctypesSearches.map(async (search, idx) => {
        try {
          const filters: any = {};
          if (search.search_term) {
            filters.name = ["like", `%${search.search_term}%`];
          }
          if (search.module) {
            filters.module = search.module;
          }
          if (search.is_custom !== undefined) {
            filters.custom = search.is_custom ? 1 : 0;
          }

          const result: any = await docApi.listDocuments(
            client,
            "DocType",
            filters,
            ["name", "module", "custom", "issingle", "istable"],
            search.limit || 50
          );

          const key = search.search_term || search.module || `search_${idx}`;
          const doctypeList = Array.isArray(result) ? result : (result.data || []);
          results.find_doctypes[key] = {
            search_term: search.search_term,
            module: search.module,
            is_custom: search.is_custom,
            count: doctypeList.length,
            doctypes: doctypeList
          };
        } catch (error: any) {
          console.error(`[explore_system] Error in find_doctypes:`, error.message);
          const key = search.search_term || search.module || `search_${idx}`;
          results.find_doctypes[key] = { error: error.message, doctypes: [] };
        }
      }),

      // 2. FIELDS - Get all fields with properties
      ...fieldsToGet.map(async (doctype) => {
        try {
          const checkResult = await checkDoctypeExists(doctype);
          if (!checkResult.exists) {
            results.fields[doctype] = { exists: false };
            return;
          }

          const actualName = checkResult.actualName!;
          const schema = await schemaApi.getDocTypeSchema(client, actualName);
          const fields = schema.fields.map((f: any, idx: number) => ({
            fieldname: f.fieldname,
            fieldtype: f.fieldtype,
            label: f.label,
            reqd: f.required ? 1 : 0,
            unique: f.unique ? 1 : 0,
            hidden: f.hidden ? 1 : 0,
            read_only: f.read_only ? 1 : 0,
            in_list_view: f.in_list_view ? 1 : 0,
            in_standard_filter: f.in_standard_filter ? 1 : 0,
            default: f.default || '',
            description: f.description || '',
            options: f.options || '',
            idx: idx + 1
          }));

          const field_summary: Record<string, any> = { total: fields.length, by_type: {} };
          for (const f of fields) {
            field_summary.by_type[f.fieldtype] = (field_summary.by_type[f.fieldtype] || 0) + 1;
          }

          results.fields[actualName] = {
            exists: true,
            name: actualName,
            fields,
            field_summary,
            required_fields: fields.filter((f: any) => f.reqd === 1).map((f: any) => ({ fieldname: f.fieldname, fieldtype: f.fieldtype, label: f.label })),
            select_fields: fields.filter((f: any) => f.fieldtype === 'Select' && f.options).map((f: any) => ({
              fieldname: f.fieldname,
              options: f.options.split('\n').filter((o: string) => o.trim()),
              default: f.default || null
            }))
          };
        } catch (error: any) {
          console.error(`[explore_system] Error getting fields for ${doctype}:`, error.message);
          results.fields[doctype] = { exists: false, error: error.message };
        }
      }),

      // 3. RELATIONSHIPS - Get links, child tables, backlinks
      ...relationshipsToGet.map(async (doctype) => {
        try {
          const checkResult = await checkDoctypeExists(doctype);
          if (!checkResult.exists) {
            results.relationships[doctype] = { exists: false };
            return;
          }

          const actualName = checkResult.actualName!;
          const schema = await schemaApi.getDocTypeSchema(client, actualName);

          // Link fields (outgoing)
          const link_fields = schema.fields
            .filter((f: any) => f.fieldtype === 'Link')
            .map((f: any) => ({ fieldname: f.fieldname, target: f.options, reqd: f.required || false }));

          // Child tables with their schemas
          const tableFields = schema.fields.filter((f: any) => f.fieldtype === 'Table');
          const child_tables: any[] = [];
          for (const tf of tableFields) {
            if (tf.options) {
              const childSchema = await getChildTableSchema(tf.options);
              child_tables.push({
                fieldname: tf.fieldname,
                doctype: childSchema.doctype || tf.options,  // Use actual name from child schema
                label: tf.label,
                ...childSchema
              });
            }
          }

          // Backlinks (DocTypes that link TO this DocType)
          const linked_from = await getBacklinks(actualName);

          results.relationships[actualName] = {
            exists: true,
            name: actualName,
            link_fields,
            child_tables,
            linked_from
          };
        } catch (error: any) {
          console.error(`[explore_system] Error getting relationships for ${doctype}:`, error.message);
          results.relationships[doctype] = { exists: false, error: error.message };
        }
      }),

      // 4a. DOCUMENTS.CHECK - Check if specific documents exist
      ...(documentsArg.check || []).map(async (doc) => {
        const key = `${doc.doctype}:${doc.name}`;
        try {
          const document = await docApi.getDocument(client, doc.doctype, doc.name);
          results.documents.check[key] = {
            exists: true,
            doctype: doc.doctype,
            name: doc.name,
            preview: Object.fromEntries(
              Object.entries(document)
                .filter(([k]) => !k.startsWith('_') && !['doctype', 'owner', 'creation', 'modified', 'modified_by', 'docstatus', 'idx'].includes(k))
                .slice(0, 10)
            )
          };
        } catch (error: any) {
          results.documents.check[key] = { exists: false, doctype: doc.doctype, name: doc.name };
        }
      }),

      // 4b. DOCUMENTS.LIST - List documents matching filters
      ...(documentsArg.list || []).map(async (query, idx) => {
        const key = `${query.doctype}_${idx}`;
        try {
          const docs = await docApi.listDocuments(
            client,
            query.doctype,
            query.filters,
            ["name"],
            query.limit || 20
          );
          results.documents.list[key] = {
            doctype: query.doctype,
            filters: query.filters,
            count: docs.length,
            names: docs.map((d: any) => d.name)
          };
        } catch (error: any) {
          results.documents.list[key] = { doctype: query.doctype, error: error?.message || "Query failed" };
        }
      }),

      // 4c. DOCUMENTS.COUNT - Count documents matching filters
      ...(documentsArg.count || []).map(async (query) => {
        const key = query.filters ? `${query.doctype}:${Object.keys(query.filters).map(k => `${k}=${query.filters[k]}`).join(',')}` : query.doctype;
        try {
          const countResult = await client.call().get('frappe.client.get_count', {
            doctype: query.doctype,
            filters: query.filters || {}
          });
          const count = typeof countResult === 'object' && countResult !== null
            ? (countResult.message ?? countResult.data ?? 0)
            : (typeof countResult === 'number' ? countResult : 0);
          results.documents.count[key] = { doctype: query.doctype, filters: query.filters, count };
        } catch (error: any) {
          results.documents.count[key] = { doctype: query.doctype, error: error?.message || "Count failed" };
        }
      }),

      // 5. DOCTYPES_FULL - Complete schema (fields + relationships + document_count + permissions)
      ...doctypesFullCheck.map(async (doctype) => {
        try {
          const checkResult = await checkDoctypeExists(doctype);
          console.error(`[explore_system] DocType FULL ${doctype} exists: ${checkResult.exists}, actualName: ${checkResult.actualName}`);

          if (!checkResult.exists) {
            results.doctypes_full[doctype] = { exists: false };
            return;
          }

          const actualName = checkResult.actualName!;
          const schema = await schemaApi.getDocTypeSchema(client, actualName);

          // Fields with full properties
          const fields = schema.fields.map((f: any, idx: number) => ({
            fieldname: f.fieldname,
            fieldtype: f.fieldtype,
            label: f.label,
            reqd: f.required ? 1 : 0,
            unique: f.unique ? 1 : 0,
            hidden: f.hidden ? 1 : 0,
            read_only: f.read_only ? 1 : 0,
            in_list_view: f.in_list_view ? 1 : 0,
            in_standard_filter: f.in_standard_filter ? 1 : 0,
            default: f.default || '',
            description: f.description || '',
            options: f.options || '',
            idx: idx + 1
          }));

          const field_summary: Record<string, any> = { total: fields.length, by_type: {} };
          for (const f of fields) {
            field_summary.by_type[f.fieldtype] = (field_summary.by_type[f.fieldtype] || 0) + 1;
          }

          const required_fields = fields.filter((f: any) => f.reqd === 1).map((f: any) => ({ fieldname: f.fieldname, fieldtype: f.fieldtype, label: f.label }));
          const link_fields = fields.filter((f: any) => f.fieldtype === 'Link').map((f: any) => ({ fieldname: f.fieldname, target: f.options, reqd: f.reqd === 1 }));
          const select_fields = fields.filter((f: any) => f.fieldtype === 'Select' && f.options).map((f: any) => ({
            fieldname: f.fieldname,
            options: f.options.split('\n').filter((o: string) => o.trim()),
            default: f.default || null
          }));

          // Child tables
          const tableFields = schema.fields.filter((f: any) => f.fieldtype === 'Table');
          const child_tables: any[] = [];
          for (const tf of tableFields) {
            if (tf.options) {
              const childSchema = await getChildTableSchema(tf.options);
              child_tables.push({ fieldname: tf.fieldname, doctype: childSchema.doctype || tf.options, label: tf.label, ...childSchema });
            }
          }

          // Document count - use actual name
          let document_count = 0;
          try {
            const countResult = await client.call().get('frappe.client.get_count', { doctype: actualName });
            document_count = typeof countResult === 'object' && countResult !== null
              ? (countResult.message ?? countResult.data ?? 0)
              : (typeof countResult === 'number' ? countResult : 0);
          } catch (e) { /* ignore */ }

          // Backlinks - use actual name
          const linked_from = await getBacklinks(actualName);

          results.doctypes_full[actualName] = {
            exists: true,
            name: actualName,  // Actual name from DB
            searchedAs: doctype !== actualName ? doctype : undefined,
            isTable: schema.istable || false,
            isSingle: schema.issingle || false,
            isCustom: schema.custom || false,
            autoname: schema.autoname,
            naming_rule: schema.naming_rule || null,
            is_submittable: schema.is_submittable || false,
            track_changes: schema.track_changes || false,
            fields,
            field_summary,
            required_fields,
            link_fields,
            child_tables,
            select_fields,
            linked_from,
            document_count,
            permissions: schema.permissions || []
          };
        } catch (error: any) {
          console.error(`[explore_system] Error getting full schema for ${doctype}:`, error.message);
          results.doctypes_full[doctype] = { exists: false, error: error.message };
        }
      }),

      // 6. BLUEPRINTS - Check specific blueprints by name
      ...blueprintsToCheck.map(async (blueprintName) => {
        try {
          // Check if blueprint exists
          const blueprintDoc = await docApi.listDocuments(
            client,
            'BL Blueprint',
            { blueprint_name: blueprintName },
            ['blueprint_name', 'blueprint_description', 'is_active', 'workflow'],
            1
          );

          if (!blueprintDoc || blueprintDoc.length === 0) {
            results.blueprints[blueprintName] = { exists: false };
            return;
          }

          const bp = blueprintDoc[0];
          let workflowConfig: any = {};
          try {
            workflowConfig = typeof bp.workflow === 'string' ? JSON.parse(bp.workflow) : bp.workflow || {};
          } catch (e) {
            workflowConfig = {};
          }

          // Extract trigger summary
          const triggers = workflowConfig.triggers || [];
          const triggerSummary = triggers.map((t: any) => ({
            doctype: t.doctype,
            event: t.event,
            trigger_type: t.trigger_type || 'doc_event',
            cron: t.cron || null
          }));

          // Extract action types summary (just the action names, not full config)
          const actions = workflowConfig.actions || [];
          const actionTypes = actions.map((a: any) => {
            if (typeof a === 'object') {
              return Object.keys(a)[0];
            }
            return 'unknown';
          });

          // Check for action groups
          const hasActionGroups = !!workflowConfig.action_groups;
          const actionGroupNames = hasActionGroups ? Object.keys(workflowConfig.action_groups) : [];

          results.blueprints[blueprintName] = {
            exists: true,
            is_active: bp.is_active || false,
            description: bp.blueprint_description || '',
            triggers: triggerSummary,
            action_count: actions.length,
            action_types: [...new Set(actionTypes)],
            has_action_groups: hasActionGroups,
            action_group_names: actionGroupNames
          };
        } catch (error: any) {
          console.error(`[explore_system] Error checking blueprint ${blueprintName}:`, error.message);
          results.blueprints[blueprintName] = { exists: false, error: error.message };
        }
      }),

      // 7. TRIGGERS_FOR_DOCTYPE - Find all blueprints that trigger on specific DocTypes
      ...triggersForDoctype.map(async (doctype) => {
        try {
          // Query BL Hook Registry for this DocType
          const hookRegistries = await docApi.listDocuments(
            client,
            'BL Hook Registry',
            { doctype_name: doctype, is_registered: 1 },
            ['hook_key', 'event_type', 'dependent_blueprints'],
            50
          );

          if (!hookRegistries || hookRegistries.length === 0) {
            results.triggers_for_doctype[doctype] = {
              has_triggers: false,
              blueprints: []
            };
            return;
          }

          // Collect all blueprints and their events
          const blueprintEvents: Record<string, string[]> = {};
          for (const hr of hookRegistries) {
            let blueprintIds: string[] = [];
            try {
              blueprintIds = typeof hr.dependent_blueprints === 'string'
                ? JSON.parse(hr.dependent_blueprints)
                : hr.dependent_blueprints || [];
            } catch (e) {
              blueprintIds = [];
            }

            for (const bpId of blueprintIds) {
              if (!blueprintEvents[bpId]) {
                blueprintEvents[bpId] = [];
              }
              if (!blueprintEvents[bpId].includes(hr.event_type)) {
                blueprintEvents[bpId].push(hr.event_type);
              }
            }
          }

          results.triggers_for_doctype[doctype] = {
            has_triggers: Object.keys(blueprintEvents).length > 0,
            blueprint_count: Object.keys(blueprintEvents).length,
            blueprints: Object.entries(blueprintEvents).map(([name, events]) => ({
              name,
              events
            }))
          };
        } catch (error: any) {
          console.error(`[explore_system] Error getting triggers for ${doctype}:`, error.message);
          results.triggers_for_doctype[doctype] = { has_triggers: false, error: error.message };
        }
      }),

      // 8. SCHEDULES - List all scheduled workflows
      (async () => {
        if (!getSchedules) return;
        try {
          const schedules = await docApi.listDocuments(
            client,
            'BL Scheduled Workflow Registry',
            { is_active: 1 },
            ['schedule_key', 'cron_expression', 'timezone', 'dependent_blueprints'],
            100
          );

          results.schedules = {
            count: schedules?.length || 0,
            schedules: (schedules || []).map((s: any) => {
              let blueprintIds: string[] = [];
              try {
                blueprintIds = typeof s.dependent_blueprints === 'string'
                  ? JSON.parse(s.dependent_blueprints)
                  : s.dependent_blueprints || [];
              } catch (e) {
                blueprintIds = [];
              }
              return {
                schedule_key: s.schedule_key,
                cron: s.cron_expression,
                timezone: s.timezone,
                blueprint_count: blueprintIds.length,
                blueprints: blueprintIds
              };
            })
          };
        } catch (error: any) {
          console.error(`[explore_system] Error getting schedules:`, error.message);
          results.schedules = { count: 0, error: error.message };
        }
      })(),

      // 9. ROLES - List available roles for send_notification recipients
      (async () => {
        if (!getRoles) return;
        try {
          const roles = await docApi.listDocuments(
            client,
            'Role',
            { disabled: 0 },
            ['name', 'desk_access'],
            200
          );

          // Categorize roles
          const deskRoles = (roles || []).filter((r: any) => r.desk_access).map((r: any) => r.name);
          const allRoles = (roles || []).map((r: any) => r.name);

          results.roles = {
            count: allRoles.length,
            desk_roles: deskRoles,
            all_roles: allRoles,
            usage_hint: "Use 'role:RoleName' in recipients field, e.g., 'role:System Manager'"
          };
        } catch (error: any) {
          console.error(`[explore_system] Error getting roles:`, error.message);
          results.roles = { count: 0, error: error.message };
        }
      })(),

      // 10. AVAILABLE_EVENTS - Query BL Trigger Registry (source of truth)
      (async () => {
        if (!getAvailableEvents) return;
        try {
          const response = await docApi.callMethod(
            client,
            'sena_backend.builder.tools.workflow_tools.get_available_events_util',
            {}
          );
          if (response?.success) {
            results.available_events = response.events;
          } else {
            console.error(`[explore_system] Error getting available events:`, response?.error);
            results.available_events = { error: response?.error || 'Failed to get events' };
          }
        } catch (error: any) {
          console.error(`[explore_system] Error getting available events:`, error.message);
          results.available_events = { error: error.message };
        }
      })(),

      // 11. AVAILABLE_ACTIONS - Query BL Action Registry (source of truth)
      (async () => {
        if (!getAvailableActions) return;
        try {
          const response = await docApi.callMethod(
            client,
            'sena_backend.builder.tools.workflow_tools.get_available_actions_util',
            {}
          );
          if (response?.success) {
            results.available_actions = response.actions;
          } else {
            console.error(`[explore_system] Error getting available actions:`, response?.error);
            results.available_actions = { error: response?.error || 'Failed to get actions' };
          }
        } catch (error: any) {
          console.error(`[explore_system] Error getting available actions:`, error.message);
          results.available_actions = { error: error.message };
        }
      })(),

      // 12. UI_LAYOUTS - List available layout contracts
      (async () => {
        if (!getUILayouts) return;
        try {
          const layouts = await docApi.listDocuments(
            client,
            'UI Contract',
            { contract_type: 'Layout', is_active: 1 },
            ['contract_id', 'component_name', 'summary', 'minimal_example'],
            50
          );
          results.ui_layouts = {
            count: layouts.length,
            layouts: layouts.map((l: any) => ({
              contract_id: l.contract_id,
              component_name: l.component_name,
              summary: l.summary,
              minimal_example: l.minimal_example ? JSON.parse(l.minimal_example) : null
            }))
          };
        } catch (error: any) {
          console.error(`[explore_system] Error getting UI layouts:`, error.message);
          results.ui_layouts = { count: 0, error: error.message };
        }
      })(),

      // 13. UI_TEMPLATES - List available template contracts
      (async () => {
        if (!getUITemplates) return;
        try {
          const templates = await docApi.listDocuments(
            client,
            'UI Contract',
            { contract_type: 'Template', is_active: 1 },
            ['contract_id', 'component_name', 'summary', 'minimal_example'],
            100
          );
          results.ui_templates = {
            count: templates.length,
            templates: templates.map((t: any) => ({
              contract_id: t.contract_id,
              component_name: t.component_name,
              summary: t.summary,
              minimal_example: t.minimal_example ? JSON.parse(t.minimal_example) : null
            }))
          };
        } catch (error: any) {
          console.error(`[explore_system] Error getting UI templates:`, error.message);
          results.ui_templates = { count: 0, error: error.message };
        }
      })(),

      // 14. UI_PAGES - List existing pages in ERP Builder
      (async () => {
        if (!getUIPages) return;
        try {
          // Get active ERP Builder
          const builders = await docApi.listDocuments(
            client,
            'ERP Builder',
            { enabled: 1 },
            ['name', 'builder_name', 'ui_preview_configs'],
            1
          );

          if (builders.length === 0) {
            results.ui_pages = { count: 0, pages: [], message: 'No active ERP Builder found' };
            return;
          }

          const builder = builders[0];
          let pages: any[] = [];

          if (builder.ui_preview_configs) {
            try {
              const configs = JSON.parse(builder.ui_preview_configs);
              pages = configs.map((config: any) => ({
                page_id: config.page_id,
                page_title: config.page_title,
                sidebar_label: config.sidebar_label,
                sidebar_icon: config.sidebar_icon,
                layout: config.layout?.template || 'Unknown',
                section_count: config.sections?.length || 0,
                sections: (config.sections || []).map((s: any) => ({
                  placement: s.placement,
                  ui_template: s.ui_template
                }))
              }));
            } catch (parseErr) {
              console.error(`[explore_system] Error parsing ui_preview_configs:`, parseErr);
            }
          }

          results.ui_pages = {
            builder_name: builder.builder_name || builder.name,
            count: pages.length,
            pages: pages
          };
        } catch (error: any) {
          console.error(`[explore_system] Error getting UI pages:`, error.message);
          results.ui_pages = { count: 0, error: error.message };
        }
      })(),

      // 15. UI_CONTRACTS - Get detailed contract info by ID
      ...uiContractsToGet.map(async (contractId) => {
        try {
          const contracts = await docApi.listDocuments(
            client,
            'UI Contract',
            { contract_id: contractId },
            ['contract_id', 'contract_type', 'component_name', 'summary', 'config_contract', 'minimal_example', 'full_example', 'usage_instructions', 'decision_tree', 'common_patterns', 'anti_patterns'],
            1
          );

          if (contracts.length === 0) {
            results.ui_contracts[contractId] = { exists: false };
            return;
          }

          const contract = contracts[0];
          results.ui_contracts[contractId] = {
            exists: true,
            contract_id: contract.contract_id,
            contract_type: contract.contract_type,
            component_name: contract.component_name,
            summary: contract.summary,
            config_contract: contract.config_contract ? JSON.parse(contract.config_contract) : null,
            minimal_example: contract.minimal_example ? JSON.parse(contract.minimal_example) : null,
            full_example: contract.full_example ? JSON.parse(contract.full_example) : null,
            usage_instructions: contract.usage_instructions,
            decision_tree: contract.decision_tree,
            common_patterns: contract.common_patterns,
            anti_patterns: contract.anti_patterns
          };
        } catch (error: any) {
          console.error(`[explore_system] Error getting UI contract ${contractId}:`, error.message);
          results.ui_contracts[contractId] = { exists: false, error: error.message };
        }
      }),

      // 16. AI_AGENTS - Quick check of AI agents
      ...aiAgentsToCheck.map(async (agentName) => {
        try {
          const agents = await docApi.listDocuments(
            client,
            'AI Agent',
            { agent_name: agentName },
            ['agent_name', 'agent_type', 'graph_architecture', 'enabled', 'model', 'temperature', 'max_tokens', 'is_system_agent', 'is_worker_agent', 'is_whatsapp_agent', 'role_title', 'enable_mcp_tools'],
            1
          );

          if (agents.length === 0) {
            results.ai_agents[agentName] = { exists: false };
            return;
          }

          const agent = agents[0];
          // Get count of allowed tools
          let toolCount = 0;
          try {
            const tools = await docApi.listDocuments(
              client,
              'AI Agent Allowed Tool',
              { parent: agentName, parenttype: 'AI Agent' },
              ['tool_name'],
              100
            );
            toolCount = tools.length;
          } catch (e) {
            // Ignore tool count errors
          }

          results.ai_agents[agentName] = {
            exists: true,
            agent_name: agent.agent_name,
            agent_type: agent.agent_type,
            graph_architecture: agent.graph_architecture,
            enabled: agent.enabled || false,
            model: agent.model,
            temperature: agent.temperature,
            max_tokens: agent.max_tokens,
            is_system_agent: agent.is_system_agent || false,
            is_worker_agent: agent.is_worker_agent || false,
            is_whatsapp_agent: agent.is_whatsapp_agent || false,
            role_title: agent.role_title || '',
            enable_mcp_tools: agent.enable_mcp_tools || false,
            allowed_tools_count: toolCount
          };
        } catch (error: any) {
          console.error(`[explore_system] Error checking AI Agent ${agentName}:`, error.message);
          results.ai_agents[agentName] = { exists: false, error: error.message };
        }
      }),

      // 17. AI_AGENTS_FULL - Complete AI agent details
      ...aiAgentsFullCheck.map(async (agentName) => {
        try {
          const agents = await docApi.listDocuments(
            client,
            'AI Agent',
            { agent_name: agentName },
            ['*'],
            1
          );

          if (agents.length === 0) {
            results.ai_agents_full[agentName] = { exists: false };
            return;
          }

          const agent = agents[0];

          // Get allowed tools
          let allowedTools: any[] = [];
          try {
            allowedTools = await docApi.listDocuments(
              client,
              'AI Agent Allowed Tool',
              { parent: agentName, parenttype: 'AI Agent' },
              ['tool_name', 'enabled', 'description'],
              100
            );
          } catch (e) {}

          // Get workers (for planner_workers architecture)
          let workers: any[] = [];
          try {
            workers = await docApi.listDocuments(
              client,
              'AI Agent Worker',
              { parent: agentName, parenttype: 'AI Agent' },
              ['worker_name', 'agent', 'description', 'enabled'],
              50
            );
          } catch (e) {}

          // Get stages
          let stages: any[] = [];
          try {
            stages = await docApi.listDocuments(
              client,
              'AI Agent Stages',
              { parent: agentName, parenttype: 'AI Agent' },
              ['stage_id', 'stage_name', 'stage_description', 'stage_sequence', 'is_active'],
              50
            );
          } catch (e) {}

          // Get stage objectives
          let stageObjectives: any[] = [];
          try {
            stageObjectives = await docApi.listDocuments(
              client,
              'AI Agent Stage Objective',
              { parent: agentName, parenttype: 'AI Agent' },
              ['stage_id', 'objective_id', 'objective_name', 'objective_description', 'objective_sequence', 'is_active'],
              100
            );
          } catch (e) {}

          // Get stage transitions
          let stageTransitions: any[] = [];
          try {
            stageTransitions = await docApi.listDocuments(
              client,
              'AI Agent Stage Transition',
              { parent: agentName, parenttype: 'AI Agent' },
              ['from_stage_id', 'to_stage_id', 'transition_name', 'transition_description'],
              100
            );
          } catch (e) {}

          // Get stage tools
          let stageTools: any[] = [];
          try {
            stageTools = await docApi.listDocuments(
              client,
              'AI Agent Stage Tool',
              { parent: agentName, parenttype: 'AI Agent' },
              ['stage_id', 'tool_name', 'enabled', 'description'],
              100
            );
          } catch (e) {}

          results.ai_agents_full[agentName] = {
            exists: true,
            agent_name: agent.agent_name,
            agent_type: agent.agent_type,
            graph_architecture: agent.graph_architecture,
            enabled: agent.enabled || false,
            is_system_agent: agent.is_system_agent || false,
            is_worker_agent: agent.is_worker_agent || false,
            is_whatsapp_agent: agent.is_whatsapp_agent || false,
            accepts_files: agent.accepts_files || false,
            // Model config
            model: agent.model,
            temperature: agent.temperature,
            max_tokens: agent.max_tokens,
            // Thinking/reasoning
            thinking_enabled: agent.thinking_enabled || false,
            thinking_mode: agent.thinking_mode,
            thinking_budget: agent.thinking_budget,
            // Caching
            enable_caching: agent.enable_caching || false,
            cache_min_tokens: agent.cache_min_tokens,
            cache_ttl_seconds: agent.cache_ttl_seconds,
            // Role
            role_title: agent.role_title || '',
            role_description: agent.role_description || '',
            communication_style: agent.communication_style || '',
            // System prompt
            system_prompt_file: agent.system_prompt_file || '',
            system_prompt_text: agent.system_prompt_text || '',
            // MCP tools
            enable_mcp_tools: agent.enable_mcp_tools || false,
            // Child tables
            allowed_tools: allowedTools,
            workers: workers,
            stages: stages,
            stage_objectives: stageObjectives,
            stage_transitions: stageTransitions,
            stage_tools: stageTools,
            // Debug
            enable_debug: agent.enable_debug || false,
            enable_console: agent.enable_console || false
          };
        } catch (error: any) {
          console.error(`[explore_system] Error getting full AI Agent ${agentName}:`, error.message);
          results.ai_agents_full[agentName] = { exists: false, error: error.message };
        }
      }),

      // 18. GRAPH_ARCHITECTURES - List available architectures
      (async () => {
        if (!getGraphArchitectures) return;
        try {
          const architectures = await docApi.listDocuments(
            client,
            'Graph Architecture',
            {},
            ['architecture_name', 'display_name', 'enabled', 'description', 'nodes', 'edges', 'entry_node', 'exit_nodes', 'python_class'],
            20
          );

          results.graph_architectures = {
            count: architectures.length,
            architectures: architectures.map((a: any) => ({
              architecture_name: a.architecture_name,
              display_name: a.display_name,
              enabled: a.enabled || false,
              description: a.description || '',
              nodes: a.nodes ? JSON.parse(a.nodes) : [],
              edges: a.edges ? JSON.parse(a.edges) : [],
              entry_node: a.entry_node,
              exit_nodes: a.exit_nodes ? JSON.parse(a.exit_nodes) : [],
              python_class: a.python_class
            })),
            usage_hints: {
              'single_agent': 'Simple ReAct loop (think → act → observe). Best for straightforward tasks. Used by data_agent, ui_agent, workflow_agent.',
              'planner_workers': 'Complex multi-agent workflow. Planner decomposes → Dispatcher routes → Workers execute → Verifier validates. Workers MUST use single_agent architecture.'
            }
          };
        } catch (error: any) {
          console.error(`[explore_system] Error getting graph architectures:`, error.message);
          results.graph_architectures = { count: 0, error: error.message };
        }
      })(),

      // 19. AVAILABLE_MODELS - List AI models by provider
      (async () => {
        if (!getAvailableModels) return;
        // Static list of available models with thinking support info
        results.available_models = {
          providers: {
            openrouter: {
              models: [
                { model: 'openrouter/openai/gpt-4o-mini', thinking_support: false, description: 'Fast, cost-effective GPT-4o variant' },
                { model: 'openrouter/openai/gpt-oss-120b', thinking_support: false, description: '120B parameter open-source model' },
                { model: 'openrouter/openai/gpt-oss-20b', thinking_support: false, description: '20B parameter open-source model' },
                { model: 'openrouter/deepseek/deepseek-v3.2', thinking_support: false, description: 'DeepSeek v3.2 model' },
                { model: 'openrouter/moonshotai/kimi-k2', thinking_support: true, description: 'Kimi K2 with reasoning' },
                { model: 'openrouter/moonshotai/kimi-k2-thinking', thinking_support: true, description: 'Kimi K2 extended thinking mode' }
              ]
            },
            gemini: {
              models: [
                { model: 'gemini-2.0-flash', thinking_support: true, description: 'Gemini 2.0 Flash - fast with thinking' },
                { model: 'gemini-2.0-flash-exp', thinking_support: true, description: 'Gemini 2.0 Flash experimental' },
                { model: 'gemini/gemini-2.5-flash', thinking_support: true, description: 'Gemini 2.5 Flash' },
                { model: 'gemini/gemini-2.5-pro', thinking_support: true, description: 'Gemini 2.5 Pro - most capable' },
                { model: 'gemini/gemini-2.5-flash-lite', thinking_support: true, description: 'Gemini 2.5 Flash Lite - fastest' },
                { model: 'gemini/gemini-3-pro-preview', thinking_support: true, description: 'Gemini 3.0 Pro preview' }
              ],
              thinking_modes: ['Dynamic', 'Custom', 'Disabled'],
              thinking_budget_range: { min: -1, max: 24576 }
            },
            xai_grok: {
              models: [
                { model: 'xai/grok-4-1-fast-reasoning', thinking_support: true, description: 'Grok 4.1 with fast reasoning' },
                { model: 'xai/grok-4-1-fast-non-reasoning', thinking_support: false, description: 'Grok 4.1 without reasoning' }
              ]
            },
            openai: {
              models: [
                { model: 'openai/gpt-5-nano', thinking_support: false, description: 'GPT-5 Nano - smallest' },
                { model: 'openai/gpt-5-mini', thinking_support: false, description: 'GPT-5 Mini' },
                { model: 'openai/gpt-5', thinking_support: false, description: 'GPT-5 standard' },
                { model: 'openai/gpt-5.1', thinking_support: false, description: 'GPT-5.1 latest' }
              ]
            }
          },
          recommendations: {
            system_agents: 'openrouter/openai/gpt-oss-120b (temperature 0.3-0.7)',
            user_agents: 'gemini/gemini-2.5-flash or openrouter/openai/gpt-4o-mini',
            complex_reasoning: 'gemini/gemini-2.5-pro with thinking_mode: Dynamic',
            cost_effective: 'openrouter/openai/gpt-4o-mini or gemini/gemini-2.5-flash-lite'
          }
        };
      })(),

      // 20. AVAILABLE_AGENT_TOOLS - List all MCP tools assignable to agents
      (async () => {
        if (!getAvailableAgentTools) return;
        // Static list of available MCP tools categorized
        results.available_agent_tools = {
          schema_tools: [
            { tool: 'get_doctype_schema', description: 'Get complete schema for a DocType' },
            { tool: 'get_field_options', description: 'Get options for Link/Select fields' },
            { tool: 'find_doctypes', description: 'Search for DocTypes by name pattern' },
            { tool: 'get_module_list', description: 'List all Frappe modules' },
            { tool: 'get_doctypes_in_module', description: 'List DocTypes in a specific module' },
            { tool: 'check_doctype_exists', description: 'Check if a DocType exists' },
            { tool: 'get_naming_info', description: 'Get naming configuration for a DocType' },
            { tool: 'get_required_fields', description: 'Get required fields for a DocType' },
            { tool: 'get_frappe_usage_info', description: 'Get Frappe framework usage information' }
          ],
          document_tools: [
            { tool: 'create_document', description: 'Create a new document' },
            { tool: 'get_document', description: 'Get a document by name' },
            { tool: 'update_document', description: 'Update an existing document' },
            { tool: 'delete_document', description: 'Delete a document' },
            { tool: 'list_documents', description: 'List documents with filters' },
            { tool: 'check_document_exists', description: 'Check if a document exists' },
            { tool: 'get_document_count', description: 'Count documents matching filters' }
          ],
          doctype_tools: [
            { tool: 'create_doctype', description: 'Create a new DocType' },
            { tool: 'create_child_table', description: 'Create a child table DocType' },
            { tool: 'add_fields_to_doctype', description: 'Add fields to existing DocType' },
            { tool: 'rename_doctype', description: 'Rename a DocType (updates name, table, and all references)' },
            { tool: 'delete_doctype', description: 'Delete a DocType' }
          ],
          workflow_tools: [
            { tool: 'create_blueprint', description: 'Create a workflow blueprint' },
            { tool: 'read_blueprint', description: 'Read a workflow blueprint' },
            { tool: 'update_blueprint', description: 'Update a workflow blueprint' },
            { tool: 'delete_blueprint', description: 'Delete a workflow blueprint' },
            { tool: 'list_blueprints', description: 'List all workflow blueprints' },
            { tool: 'validate_blueprint', description: 'Validate blueprint configuration' },
            { tool: 'get_available_events', description: 'Get available trigger events' },
            { tool: 'get_available_actions', description: 'Get available action types' }
          ],
          ui_tools: [
            { tool: 'update_preview_config', description: 'Update ERP Builder UI config' },
            { tool: 'list_ui_contracts', description: 'List available UI contracts' },
            { tool: 'get_ui_contract', description: 'Get UI contract details' },
            { tool: 'get_erp_builder', description: 'Get ERP Builder configuration' }
          ],
          agent_tools: [
            { tool: 'create_ai_agent', description: 'Create a new AI agent' },
            { tool: 'get_ai_agent', description: 'Get AI agent configuration' },
            { tool: 'update_ai_agent', description: 'Update AI agent settings' },
            { tool: 'delete_ai_agent', description: 'Delete an AI agent' },
            { tool: 'list_ai_agents', description: 'List all AI agents' }
          ],
          messaging_tools: [
            { tool: 'send_whatsapp_message', description: 'Send WhatsApp message' },
            { tool: 'send_instagram_message', description: 'Send Instagram message' }
          ],
          usage_hint: 'Assign tools via the allowed_tools child table. Empty list = all tools allowed. System agents have pre-configured tool sets.'
        };
      })(),

      // 21. SYSTEM_AGENTS - List system agent configurations
      (async () => {
        if (!getSystemAgents) return;
        try {
          const systemAgents = await docApi.listDocuments(
            client,
            'AI Agent',
            { is_system_agent: 1 },
            ['agent_name', 'agent_type', 'graph_architecture', 'enabled', 'model', 'temperature', 'max_tokens', 'role_title', 'role_description', 'enable_mcp_tools'],
            20
          );

          // Get allowed tools for each system agent
          const agentConfigs = await Promise.all(systemAgents.map(async (agent: any) => {
            let tools: any[] = [];
            try {
              tools = await docApi.listDocuments(
                client,
                'AI Agent Allowed Tool',
                { parent: agent.agent_name, parenttype: 'AI Agent' },
                ['tool_name', 'enabled'],
                100
              );
            } catch (e) {}

            // Get workers for planner_workers agents
            let workers: any[] = [];
            if (agent.graph_architecture === 'planner_workers') {
              try {
                workers = await docApi.listDocuments(
                  client,
                  'AI Agent Worker',
                  { parent: agent.agent_name, parenttype: 'AI Agent' },
                  ['worker_name', 'agent', 'enabled'],
                  20
                );
              } catch (e) {}
            }

            return {
              agent_name: agent.agent_name,
              agent_type: agent.agent_type,
              graph_architecture: agent.graph_architecture,
              enabled: agent.enabled || false,
              model: agent.model,
              temperature: agent.temperature,
              max_tokens: agent.max_tokens,
              role_title: agent.role_title || '',
              role_description: agent.role_description || '',
              enable_mcp_tools: agent.enable_mcp_tools || false,
              tools: tools.filter((t: any) => t.enabled !== 0).map((t: any) => t.tool_name),
              tool_count: tools.length,
              workers: workers.map((w: any) => ({ name: w.worker_name, agent: w.agent, enabled: w.enabled }))
            };
          }));

          results.system_agents = {
            count: systemAgents.length,
            agents: agentConfigs,
            descriptions: {
              'Express Builder': 'Master orchestrator using planner_workers architecture. Routes tasks to specialized workers.',
              'data_agent': 'Handles DocType schema operations and document CRUD. Uses single_agent architecture.',
              'ui_agent': 'Generates UI pages and components using ERP Builder. Uses single_agent architecture.',
              'workflow_agent': 'Creates and manages workflow blueprints. Uses single_agent architecture.',
              'agent_builder': 'Creates and configures custom AI agents. Uses single_agent architecture.'
            }
          };
        } catch (error: any) {
          console.error(`[explore_system] Error getting system agents:`, error.message);
          results.system_agents = { count: 0, error: error.message };
        }
      })(),

      // 22. AVAILABLE_FIELD_TYPES - List all Frappe field types
      (async () => {
        if (!getAvailableFieldTypes) return;
        try {
          // Get field types from DocField meta
          const metaResult = await client.call().get('frappe.client.get', {
            doctype: 'DocField',
            name: 'DocField-fieldtype'
          });

          // Parse the options field which contains newline-separated field types
          const optionsField = metaResult?.message?.options || metaResult?.options || '';
          const fieldTypes = optionsField.split('\n').filter((t: string) => t.trim());

          // Categorize field types for easier understanding
          const categories = {
            text: ['Data', 'Small Text', 'Text', 'Long Text', 'Code', 'Text Editor', 'Markdown Editor', 'HTML Editor', 'JSON', 'Password', 'Read Only'],
            numeric: ['Int', 'Float', 'Currency', 'Percent', 'Rating'],
            date_time: ['Date', 'Datetime', 'Time', 'Duration'],
            selection: ['Select', 'Check', 'Autocomplete'],
            relationship: ['Link', 'Dynamic Link', 'Table', 'Table MultiSelect'],
            media: ['Attach', 'Attach Image', 'Image', 'Signature', 'Barcode'],
            layout: ['Section Break', 'Column Break', 'Tab Break', 'Fold', 'Heading'],
            special: ['Button', 'HTML', 'Geolocation', 'Color', 'Icon', 'Phone']
          };

          results.available_field_types = {
            total_count: fieldTypes.length,
            all_types: fieldTypes,
            by_category: categories,
            common_types: ['Data', 'Link', 'Select', 'Table', 'Int', 'Float', 'Currency', 'Check', 'Date', 'Datetime', 'Text', 'Attach', 'Phone', 'Attach Image', 'Rating'],
            data_field_validation_options: {
              description: "For Data fieldtype, set 'options' property to enable validation",
              valid_options: ['Email', 'URL', 'Name', 'Phone', 'Barcode', 'IBAN'],
              examples: [
                { fieldtype: 'Data', options: 'Email', description: 'Validates email format' },
                { fieldtype: 'Data', options: 'URL', description: 'Validates URL format' },
                { fieldtype: 'Data', options: 'Name', description: 'Validates name characters' },
                { fieldtype: 'Data', options: 'Phone', description: 'Validates phone format (prefer Phone fieldtype instead)' },
                { fieldtype: 'Data', options: 'Barcode', description: 'Validates barcode format' },
                { fieldtype: 'Data', options: 'IBAN', description: 'Validates bank account format' }
              ]
            },
            note: "Use these exact type names in fieldtype property when creating/adding fields. For email/url/name validation, use Data with options."
          };
        } catch (error: any) {
          console.error(`[explore_system] Error getting field types:`, error.message);
          // Fallback to static list if API fails
          results.available_field_types = {
            total_count: 43,
            all_types: [
              'Autocomplete', 'Attach', 'Attach Image', 'Barcode', 'Button', 'Check', 'Code', 'Color',
              'Column Break', 'Currency', 'Data', 'Date', 'Datetime', 'Duration', 'Dynamic Link', 'Float',
              'Fold', 'Geolocation', 'Heading', 'HTML', 'HTML Editor', 'Icon', 'Image', 'Int', 'JSON', 'Link',
              'Long Text', 'Markdown Editor', 'Password', 'Percent', 'Phone', 'Read Only', 'Rating',
              'Section Break', 'Select', 'Signature', 'Small Text', 'Tab Break', 'Table', 'Table MultiSelect',
              'Text', 'Text Editor', 'Time'
            ],
            by_category: {
              text: ['Data', 'Small Text', 'Text', 'Long Text', 'Code', 'Text Editor', 'Markdown Editor', 'HTML Editor', 'JSON', 'Password', 'Read Only'],
              numeric: ['Int', 'Float', 'Currency', 'Percent', 'Rating'],
              date_time: ['Date', 'Datetime', 'Time', 'Duration'],
              selection: ['Select', 'Check', 'Autocomplete'],
              relationship: ['Link', 'Dynamic Link', 'Table', 'Table MultiSelect'],
              media: ['Attach', 'Attach Image', 'Image', 'Signature', 'Barcode'],
              layout: ['Section Break', 'Column Break', 'Tab Break', 'Fold', 'Heading'],
              special: ['Button', 'HTML', 'Geolocation', 'Color', 'Icon', 'Phone']
            },
            common_types: ['Data', 'Link', 'Select', 'Table', 'Int', 'Float', 'Currency', 'Check', 'Date', 'Datetime', 'Text', 'Attach', 'Phone', 'Attach Image', 'Rating'],
            data_field_validation_options: {
              description: "For Data fieldtype, set 'options' property to enable validation",
              valid_options: ['Email', 'URL', 'Name', 'Phone', 'Barcode', 'IBAN'],
              examples: [
                { fieldtype: 'Data', options: 'Email', description: 'Validates email format' },
                { fieldtype: 'Data', options: 'URL', description: 'Validates URL format' },
                { fieldtype: 'Data', options: 'Name', description: 'Validates name characters' },
                { fieldtype: 'Data', options: 'Phone', description: 'Validates phone format (prefer Phone fieldtype instead)' },
                { fieldtype: 'Data', options: 'Barcode', description: 'Validates barcode format' },
                { fieldtype: 'Data', options: 'IBAN', description: 'Validates bank account format' }
              ]
            },
            note: "Use these exact type names in fieldtype property when creating/adding fields. For email/url/name validation, use Data with options. (fallback list used)"
          };
        }
      })()
    ]);

    // Build summary - collect all DocTypes checked across all parameters
    const allDoctypesChecked = [...new Set([...doctypesToCheck, ...fieldsToGet, ...relationshipsToGet, ...doctypesFullCheck])];
    const existingDoctypes: string[] = [];
    const missingDoctypes: string[] = [];

    for (const dt of allDoctypesChecked) {
      const existsInAny =
        results.doctypes[dt]?.exists ||
        results.fields[dt]?.exists ||
        results.relationships[dt]?.exists ||
        results.doctypes_full[dt]?.exists;
      if (existsInAny) {
        existingDoctypes.push(dt);
      } else {
        missingDoctypes.push(dt);
      }
    }

    // Build clean response (omit empty sections)
    const response: Record<string, any> = {
      summary: {
        existingDoctypes,
        missingDoctypes
      }
    };

    if (Object.keys(results.doctypes).length > 0) response.doctypes = results.doctypes;
    if (results.all_doctypes !== null) response.all_doctypes = results.all_doctypes;
    if (Object.keys(results.find_doctypes).length > 0) response.find_doctypes = results.find_doctypes;
    if (Object.keys(results.fields).length > 0) response.fields = results.fields;
    if (Object.keys(results.relationships).length > 0) response.relationships = results.relationships;

    // Only include documents if any sub-section has data
    const hasDocumentData =
      Object.keys(results.documents.check).length > 0 ||
      Object.keys(results.documents.list).length > 0 ||
      Object.keys(results.documents.count).length > 0;
    if (hasDocumentData) {
      response.documents = {};
      if (Object.keys(results.documents.check).length > 0) response.documents.check = results.documents.check;
      if (Object.keys(results.documents.list).length > 0) response.documents.list = results.documents.list;
      if (Object.keys(results.documents.count).length > 0) response.documents.count = results.documents.count;
    }

    if (Object.keys(results.doctypes_full).length > 0) response.doctypes_full = results.doctypes_full;

    // Workflow-related results (now top-level)
    if (Object.keys(results.blueprints).length > 0) {
      response.blueprints = results.blueprints;
      // Add to summary
      const existingBlueprints = Object.entries(results.blueprints)
        .filter(([_, v]: [string, any]) => v.exists)
        .map(([k]) => k);
      const missingBlueprints = Object.entries(results.blueprints)
        .filter(([_, v]: [string, any]) => !v.exists)
        .map(([k]) => k);
      if (existingBlueprints.length > 0 || missingBlueprints.length > 0) {
        response.summary.existingBlueprints = existingBlueprints;
        response.summary.missingBlueprints = missingBlueprints;
      }
    }
    if (Object.keys(results.triggers_for_doctype).length > 0) {
      response.triggers_for_doctype = results.triggers_for_doctype;
    }
    if (results.schedules !== null) {
      response.schedules = results.schedules;
    }
    if (results.roles !== null) {
      response.roles = results.roles;
    }
    if (results.available_events !== null) {
      response.available_events = results.available_events;
    }
    if (results.available_actions !== null) {
      response.available_actions = results.available_actions;
    }

    // UI results
    if (results.ui_layouts !== null) {
      response.ui_layouts = results.ui_layouts;
    }
    if (results.ui_templates !== null) {
      response.ui_templates = results.ui_templates;
    }
    if (results.ui_pages !== null) {
      response.ui_pages = results.ui_pages;
    }
    if (Object.keys(results.ui_contracts).length > 0) {
      response.ui_contracts = results.ui_contracts;
      // Add to summary
      const existingContracts = Object.entries(results.ui_contracts)
        .filter(([_, v]: [string, any]) => v.exists)
        .map(([k]) => k);
      const missingContracts = Object.entries(results.ui_contracts)
        .filter(([_, v]: [string, any]) => !v.exists)
        .map(([k]) => k);
      if (existingContracts.length > 0 || missingContracts.length > 0) {
        response.summary.existingUIContracts = existingContracts;
        response.summary.missingUIContracts = missingContracts;
      }
    }

    // Agent Builder results
    if (Object.keys(results.ai_agents).length > 0) {
      response.ai_agents = results.ai_agents;
      // Add to summary
      const existingAgents = Object.entries(results.ai_agents)
        .filter(([_, v]: [string, any]) => v.exists)
        .map(([k]) => k);
      const missingAgents = Object.entries(results.ai_agents)
        .filter(([_, v]: [string, any]) => !v.exists)
        .map(([k]) => k);
      if (existingAgents.length > 0 || missingAgents.length > 0) {
        response.summary.existingAIAgents = existingAgents;
        response.summary.missingAIAgents = missingAgents;
      }
    }
    if (Object.keys(results.ai_agents_full).length > 0) {
      response.ai_agents_full = results.ai_agents_full;
    }
    if (results.graph_architectures !== null) {
      response.graph_architectures = results.graph_architectures;
    }
    if (results.available_models !== null) {
      response.available_models = results.available_models;
    }
    if (results.available_agent_tools !== null) {
      response.available_agent_tools = results.available_agent_tools;
    }
    if (results.system_agents !== null) {
      response.system_agents = results.system_agents;
    }
    if (results.available_field_types !== null) {
      response.available_field_types = results.available_field_types;
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2)
      }],
      isError: false
    };
  }

  // Handle DocType operations
  if (toolName === "create_doctype") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.tools.data_tools.create_doctype_util",
      {
        name: args.name,
        fields: args.fields || [],  // Allow empty fields
        module: args.module || "Sentra Core",
        naming_rule: args.naming_rule || "By fieldname",
        autoname: args.autoname
      }
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: false
    };
  }

  if (toolName === "create_child_table") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.tools.data_tools.create_child_table_util",
      {
        parent_doctype: args.parent_doctype,
        child_doctype_name: args.child_doctype_name,
        child_fields: args.child_fields,
        parent_field_label: args.parent_field_label || null,
        parent_fieldname: args.parent_fieldname || null
      }
    );
    // Result is wrapped: { message: { success: true, ... } }
    const data = result?.message || result;
    return {
      content: [{
        type: "text",
        text: JSON.stringify(data, null, 2)
      }],
      isError: !data?.success
    };
  }

  if (toolName === "add_fields_to_doctype") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.tools.data_tools.add_fields_to_doctype_util",
      {
        doctype_name: args.doctype_name,
        fields: args.fields
      }
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: false
    };
  }

  if (toolName === "delete_doctype") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.tools.data_tools.delete_doctype",
      {
        doctype_name: args.doctype_name,
        force: args.force || false
      }
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: false
    };
  }

  if (toolName === "remove_fields_from_doctype") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.tools.data_tools.remove_fields_from_doctype_util",
      {
        doctype_name: args.doctype_name,
        fieldnames: args.fieldnames
      }
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: false
    };
  }

  if (toolName === "rename_field") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.tools.data_tools.rename_field_util",
      {
        doctype_name: args.doctype_name,
        old_fieldname: args.old_fieldname,
        new_fieldname: args.new_fieldname,
        new_label: args.new_label || null
      }
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: !getSuccess(result)
    };
  }

  if (toolName === "rename_doctype") {
    // Use the existing rename_doctype API from sena_backend
    const result = await docApi.callMethod(
      client,
      "sena_backend.api.builder.get_doctypes.rename_doctype",
      {
        old_name: args.old_name,
        new_name: args.new_name
      }
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: !getSuccess(result)
    };
  }

  // Handle workflow operations - Blueprint CRUD
  if (toolName === "create_blueprint") {
    // Pre-validate JSON before sending to backend
    const triggersValidation = validateJsonWithHelp(args.triggers as string, 'triggers');
    if (!triggersValidation.valid) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: triggersValidation.error,
            suggestion: triggersValidation.suggestion,
            fix_hint: "Triggers should be: [{\"doctype\": \"DocTypeName\", \"event\": \"after_insert\"}]",
            tip: "For complex workflows with nested IF/SWITCH, use action_groups to flatten the structure. See workflow_agent prompt for examples."
          }, null, 2)
        }],
        isError: true
      };
    }

    const actionsValidation = validateJsonWithHelp(args.actions as string, 'actions');
    if (!actionsValidation.valid) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: actionsValidation.error,
            suggestion: actionsValidation.suggestion,
            fix_hint: "Each action needs proper closing: {\"action_name\": {\"param\": \"value\"}} - note the TWO closing braces }}",
            tip: "For complex nested logic (IF inside SWITCH, etc.), USE ACTION GROUPS to flatten the JSON structure. Example: instead of deeply nested 'then' arrays, use \"then\": \"@group_name\" and define the group in action_groups object."
          }, null, 2)
        }],
        isError: true
      };
    }

    // If actions contains embedded action_groups, validate it's properly structured
    try {
      const parsedActions = JSON.parse(args.actions as string);
      if (typeof parsedActions === 'object' && !Array.isArray(parsedActions)) {
        if ('action_groups' in parsedActions) {
          // Validate the embedded structure
          if (!('actions' in parsedActions)) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: "When embedding action_groups in actions, you must also include an 'actions' array",
                  suggestion: "Format: {\"actions\": [...], \"action_groups\": {...}}"
                }, null, 2)
              }],
              isError: true
            };
          }

          // Validate action_groups structure - each group must be an array of objects
          const actionGroups = parsedActions.action_groups;
          if (typeof actionGroups === 'object' && actionGroups !== null) {
            for (const [groupName, groupValue] of Object.entries(actionGroups)) {
              // Each group value must be an array
              if (!Array.isArray(groupValue)) {
                return {
                  content: [{
                    type: "text",
                    text: JSON.stringify({
                      success: false,
                      error: `action_groups["${groupName}"] must be an array, got ${typeof groupValue}`,
                      suggestion: `Each action group must be an array of actions: "action_groups": {"${groupName}": [{...}, {...}]}`,
                      fix_hint: "COMMON MISTAKE: You might be putting group definitions INSIDE another group's array. All groups must be SIBLING KEYS at the action_groups level, not nested inside each other."
                    }, null, 2)
                  }],
                  isError: true
                };
              }

              // Each item in the array must be an object (action), not a string
              for (let i = 0; i < (groupValue as any[]).length; i++) {
                const item = (groupValue as any[])[i];
                if (typeof item !== 'object' || item === null || Array.isArray(item)) {
                  return {
                    content: [{
                      type: "text",
                      text: JSON.stringify({
                        success: false,
                        error: `action_groups["${groupName}"][${i}] must be an action object, got ${Array.isArray(item) ? 'array' : typeof item}`,
                        suggestion: "Each item in an action group array must be an action object like {\"create_document\": {...}} or {\"send_whatsapp_message\": {...}}",
                        fix_hint: "COMMON MISTAKE: After '[' you can ONLY have objects {...}, NOT 'key': value pairs. If you're trying to define another group, move it to be a sibling key in action_groups, not inside this array.",
                        example_wrong: '{"action_groups": {"group_a": [{"switch": {...}}, "group_b": [...]]}}',
                        example_correct: '{"action_groups": {"group_a": [{"switch": {...}}], "group_b": [...]}}'
                      }, null, 2)
                    }],
                    isError: true
                  };
                }
              }
            }
          }
        }
      }
    } catch (e) {
      // Already handled by validateJsonWithHelp above
    }

    // Handle action_groups - either as separate parameter or embedded in actions
    // The backend now handles both formats
    let finalActions = args.actions as string;

    // If action_groups provided as separate parameter, validate it
    if (args.action_groups) {
      const actionGroupsValidation = validateJsonWithHelp(args.action_groups as string, 'action_groups');
      if (!actionGroupsValidation.valid) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: actionGroupsValidation.error,
              suggestion: actionGroupsValidation.suggestion
            }, null, 2)
          }],
          isError: true
        };
      }

      // Merge action_groups with actions for backend
      try {
        const actionsArray = JSON.parse(args.actions as string);
        const actionGroupsObj = JSON.parse(args.action_groups as string);
        finalActions = JSON.stringify({
          actions: actionsArray,
          action_groups: actionGroupsObj
        });
      } catch (e: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Failed to merge action_groups: ${e.message}`,
              suggestion: "Ensure both actions and action_groups are valid JSON"
            }, null, 2)
          }],
          isError: true
        };
      }
    }

    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.tools.workflow_tools.create_blueprint_util",
      {
        name: args.name,
        triggers: args.triggers,
        actions: finalActions,
        description: args.description || null,
        parameters: args.parameters || null
      }
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: !getSuccess(result)
    };
  }

  if (toolName === "read_blueprint") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.tools.workflow_tools.read_blueprint_util",
      {
        blueprint_id: args.blueprint_id
      }
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: !getSuccess(result)
    };
  }

  if (toolName === "update_blueprint") {
    // Pre-validate JSON if provided
    if (args.triggers) {
      const triggersValidation = validateJsonWithHelp(args.triggers as string, 'triggers');
      if (!triggersValidation.valid) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: triggersValidation.error,
              suggestion: triggersValidation.suggestion
            }, null, 2)
          }],
          isError: true
        };
      }
    }

    if (args.actions) {
      const actionsValidation = validateJsonWithHelp(args.actions as string, 'actions');
      if (!actionsValidation.valid) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: actionsValidation.error,
              suggestion: actionsValidation.suggestion,
              tip: "For complex nested logic, USE ACTION GROUPS to flatten the JSON structure."
            }, null, 2)
          }],
          isError: true
        };
      }
    }

    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.tools.workflow_tools.update_blueprint_util",
      {
        blueprint_id: args.blueprint_id,
        triggers: args.triggers || null,
        actions: args.actions || null,
        description: args.description || null,
        parameters: args.parameters || null
      }
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: !getSuccess(result)
    };
  }

  if (toolName === "delete_blueprint") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.tools.workflow_tools.delete_blueprint_util",
      {
        blueprint_id: args.blueprint_id
      }
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: !getSuccess(result)
    };
  }

  if (toolName === "validate_blueprint") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.tools.workflow_tools.validate_blueprint_util",
      {
        blueprint_json: args.blueprint_json
      }
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: !getSuccess(result)
    };
  }

  if (toolName === "get_available_events") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.tools.workflow_tools.get_available_events_util",
      {}
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: !getSuccess(result)
    };
  }

  if (toolName === "get_available_actions") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.tools.workflow_tools.get_available_actions_util",
      {}
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: !getSuccess(result)
    };
  }

  if (toolName === "get_available_ai_agents") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.tools.workflow_tools.get_available_ai_agents_util",
      {}
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }],
      isError: !getSuccess(result)
    };
  }

  // Handle UI operations
  if (toolName === "get_preview_config") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.ui_agent.get_preview_config",
      {
        page_id: args.page_id
      }
    );
    const data = result?.message || result;
    return {
      content: [{
        type: "text",
        text: JSON.stringify(data, null, 2)
      }],
      isError: !data?.success
    };
  }

  if (toolName === "update_preview_config") {
    const result = await docApi.callMethod(
      client,
      "sena_backend.builder.ui_agent.update_preview_config_util",
      {
        page_id: args.page_id,
        config_json: args.config_json
      }
    );
    // Result is wrapped in { message: { success, ... } }
    const data = result?.message || result;
    return {
      content: [{
        type: "text",
        text: JSON.stringify(data, null, 2)
      }],
      isError: !data?.success
    };
  }

  // Messaging tools
  if (toolName === "send_whatsapp_message") {
    const result = await docApi.callMethod(
      client,
      "senaerp_integrations.whatsapp.doctype.whatsapp_message.whatsapp_message.send_whatsapp_message",
      {
        to: args.to,
        message: args.message,
        content_type: args.content_type || "text",
        attachment: args.attachment,
        reference_doctype: args.reference_doctype,
        reference_name: args.reference_name
      }
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result?.message || result, null, 2)
      }],
      isError: false
    };
  }

  if (toolName === "send_instagram_message") {
    const result = await docApi.callMethod(
      client,
      "senaerp_integrations.instagram.doctype.instagram_message.instagram_message.send_instagram_message",
      {
        to: args.to,
        message: args.message,
        content_type: args.content_type || "text",
        attachment: args.attachment,
        reference_doctype: args.reference_doctype,
        reference_name: args.reference_name
      }
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result?.message || result, null, 2)
      }],
      isError: false
    };
  }

  // Helper tools
  if (toolName === "get_api_instructions") {
    const category = args.category as string;
    const operation = args.operation as string;

    // Validate category
    const validCategories = Object.keys(FRAPPE_INSTRUCTIONS);
    if (!validCategories.includes(category)) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: `Invalid category '${category}'`,
            valid_categories: validCategories
          }, null, 2)
        }],
        isError: true
      };
    }

    // Get instructions using the helper function
    const instructions = getInstructions(category, operation);

    return {
      content: [{
        type: "text",
        text: instructions
      }],
      isError: false
    };
  }

  // Unknown tool
  throw new Error(`Unknown tool: ${toolName}`);
}

// Re-export for convenience
export { createFrappeClient, FrappeClientConfig };
