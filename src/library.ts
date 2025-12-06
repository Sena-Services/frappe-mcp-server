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
import { HELPER_TOOLS } from './frappe-instructions.js';
import { BLUEPRINT_TOOLS } from './blueprint-operations.js';
import { DOCTYPE_OPERATIONS_TOOLS } from './doctype-operations.js';
import { WORKFLOW_TOOLS } from './workflow-operations.js';
import { UI_TOOLS } from './ui-operations.js';

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
      "sentra_core.bl_engine.core.blueprint_executor.execute_blueprint_manually",
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
  if (toolName === "explore_system") {
    console.error(`[explore_system] Called with args: ${JSON.stringify(args)}`);

    // FIX 4: Clear Frappe cache before exploration to ensure fresh data
    // This is critical when DocTypes have been created/modified in parallel
    try {
      await docApi.callMethod(client, "frappe.clear_cache", {});
      console.error(`[explore_system] Cache cleared successfully`);
    } catch (cacheError) {
      console.error(`[explore_system] Cache clear failed (non-fatal):`, cacheError);
    }

    const doctypesToCheck: string[] = args.doctypes || [];
    const documentsToCheck: Array<{doctype: string, name: string}> = args.documents || [];
    const blueprintsToCheck: string[] = args.blueprints || [];
    const listQueries: Array<{doctype: string, filters?: any, limit?: number}> = args.list_queries || [];
    const findDoctypesPattern: string | undefined = args.find_doctypes;
    const listModules: boolean = args.modules || false;
    const doctypesInModule: string | undefined = args.doctypes_in_module;
    const countQueries: Array<{doctype: string, filters?: any}> = args.count_queries || [];

    const results: Record<string, any> = {
      doctypes: {},
      documents: {},
      blueprints: {},
      lists: {},
      modules: null,
      doctypesInModule: null,
      foundDoctypes: null,
      counts: {}
    };

    // Run all checks in parallel
    await Promise.all([
      // 1. Check DocTypes (with schema)
      // IMPORTANT: First check if DocType exists in DB using frappe.db.exists
      // This avoids cache issues where getdoctype returns stale data for deleted DocTypes
      ...doctypesToCheck.map(async (doctype) => {
        try {
          // First, verify DocType actually exists in database (not just in cache)
          // Use frappe.client.get_count which is cache-free
          // FIX: frappe-js-sdk returns {message: <count>}, not the count directly
          const countResult = await client.call().get('frappe.client.get_count', {
            doctype: 'DocType',
            filters: { name: doctype }
          });
          // Extract count from response - handle both {message: N} and direct N formats
          const count = typeof countResult === 'object' && countResult !== null
            ? (countResult.message ?? countResult.data ?? 0)
            : (typeof countResult === 'number' ? countResult : 0);
          const exists = count > 0;

          console.error(`[explore_system] DocType ${doctype} DB exists check: ${exists} (raw: ${JSON.stringify(countResult)}, parsed count: ${count})`);

          if (!exists) {
            results.doctypes[doctype] = { exists: false };
            return;
          }

          // DocType exists in DB, now get schema
          const schema = await schemaApi.getDocTypeSchema(client, doctype);
          const requiredFields = schema.fields
            .filter((f: any) => f.reqd || f.required)
            .map((f: any) => ({ name: f.fieldname, type: f.fieldtype }));
          const linkFields = schema.fields
            .filter((f: any) => f.fieldtype === "Link")
            .map((f: any) => ({ name: f.fieldname, target: f.options }));
          const tableFields = schema.fields
            .filter((f: any) => f.fieldtype === "Table")
            .map((f: any) => ({ name: f.fieldname, childTable: f.options }));

          results.doctypes[doctype] = {
            exists: true,
            isTable: schema.istable || false,
            isSingle: schema.issingle || false,
            isCustom: schema.custom || false,
            module: schema.module,
            autoname: schema.autoname,
            fieldCount: schema.fields.length,
            requiredFields,
            linkFields,
            tableFields
          };
        } catch (error: any) {
          console.error(`[explore_system] Error checking ${doctype}:`, error.message);
          results.doctypes[doctype] = { exists: false };
        }
      }),

      // 2. Check specific documents
      ...documentsToCheck.map(async (doc) => {
        const key = `${doc.doctype}:${doc.name}`;
        try {
          const document = await docApi.getDocument(client, doc.doctype, doc.name);
          results.documents[key] = {
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
          results.documents[key] = { exists: false, doctype: doc.doctype, name: doc.name };
        }
      }),

      // 3. Check blueprints
      ...blueprintsToCheck.map(async (bpName) => {
        try {
          const bp = await docApi.getDocument(client, "BL Blueprint", bpName);
          results.blueprints[bpName] = {
            exists: true,
            name: bp.name,
            description: bp.blueprint_description,
            isActive: bp.is_active
          };
        } catch (error: any) {
          results.blueprints[bpName] = { exists: false };
        }
      }),

      // 4. List queries
      ...listQueries.map(async (query, idx) => {
        const key = `${query.doctype}_query_${idx}`;
        try {
          const docs = await docApi.listDocuments(
            client,
            query.doctype,
            query.filters,
            ["name"],
            query.limit || 20
          );
          results.lists[key] = {
            doctype: query.doctype,
            filters: query.filters,
            count: docs.length,
            names: docs.map((d: any) => d.name)
          };
        } catch (error: any) {
          results.lists[key] = {
            doctype: query.doctype,
            error: error?.message || "Query failed"
          };
        }
      }),

      // 5. Find DocTypes by pattern
      (async () => {
        if (findDoctypesPattern) {
          try {
            const found = await frappeHelpers.findDocTypes(client, findDoctypesPattern, { limit: 30 });
            results.foundDoctypes = found.map((d: any) => ({
              name: d.name,
              module: d.module,
              isTable: d.istable,
              isCustom: d.custom
            }));
          } catch (error: any) {
            results.foundDoctypes = { error: error?.message || "Search failed" };
          }
        }
      })(),

      // 6. List all modules
      (async () => {
        if (listModules) {
          try {
            const modules = await schemaApi.getAllModules(client);
            results.modules = modules.map((m: any) => m.name || m);
          } catch (error: any) {
            results.modules = { error: error?.message || "Failed to list modules" };
          }
        }
      })(),

      // 7. List DocTypes in a specific module
      (async () => {
        if (doctypesInModule) {
          try {
            const docs = await docApi.listDocuments(
              client,
              "DocType",
              { module: doctypesInModule },
              ["name", "istable", "issingle", "custom"],
              100
            );
            results.doctypesInModule = {
              module: doctypesInModule,
              count: docs.length,
              doctypes: docs.map((d: any) => ({
                name: d.name,
                isTable: d.istable,
                isSingle: d.issingle,
                isCustom: d.custom
              }))
            };
          } catch (error: any) {
            results.doctypesInModule = { module: doctypesInModule, error: error?.message || "Query failed" };
          }
        }
      })(),

      // 8. Count queries
      ...countQueries.map(async (query) => {
        const key = query.filters ? `${query.doctype}:${JSON.stringify(query.filters)}` : query.doctype;
        try {
          const docs = await docApi.listDocuments(
            client,
            query.doctype,
            query.filters,
            ["name"],
            0  // We just need the count
          );
          results.counts[key] = {
            doctype: query.doctype,
            filters: query.filters,
            count: docs.length
          };
        } catch (error: any) {
          results.counts[key] = {
            doctype: query.doctype,
            error: error?.message || "Count failed"
          };
        }
      })
    ]);

    // Build summary
    const doctypeNames = Object.keys(results.doctypes);
    const existingDoctypes = doctypeNames.filter(k => results.doctypes[k].exists);
    const missingDoctypes = doctypeNames.filter(k => !results.doctypes[k].exists);

    const documentKeys = Object.keys(results.documents);
    const existingDocs = documentKeys.filter(k => results.documents[k].exists);
    const missingDocs = documentKeys.filter(k => !results.documents[k].exists);

    const blueprintNames = Object.keys(results.blueprints);
    const existingBlueprints = blueprintNames.filter(k => results.blueprints[k].exists);
    const missingBlueprints = blueprintNames.filter(k => !results.blueprints[k].exists);

    // Build clean response (omit null/empty sections)
    const response: Record<string, any> = {
      summary: {
        existingDoctypes,
        missingDoctypes,
        existingBlueprints,
        missingBlueprints
      }
    };

    if (Object.keys(results.doctypes).length > 0) response.doctypes = results.doctypes;
    if (Object.keys(results.documents).length > 0) response.documents = results.documents;
    if (Object.keys(results.blueprints).length > 0) response.blueprints = results.blueprints;
    if (Object.keys(results.lists).length > 0) response.lists = results.lists;
    if (results.modules) response.modules = results.modules;
    if (results.doctypesInModule) response.doctypesInModule = results.doctypesInModule;
    if (results.foundDoctypes) response.foundDoctypes = results.foundDoctypes;
    if (Object.keys(results.counts).length > 0) response.counts = results.counts;

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
      "sentra_core.builder.tools.data_tools.create_doctype_util",
      {
        name: args.name,
        fields: args.fields,
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
      "sentra_core.builder.tools.data_tools.create_child_table_util",
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
      "sentra_core.builder.tools.data_tools.add_fields_to_doctype_util",
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
      "sentra_core.builder.tools.data_tools.delete_doctype",
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
      "sentra_core.builder.tools.workflow_tools.create_blueprint_util",
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
      "sentra_core.builder.tools.workflow_tools.read_blueprint_util",
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
      "sentra_core.builder.tools.workflow_tools.update_blueprint_util",
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
      "sentra_core.builder.tools.workflow_tools.delete_blueprint_util",
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
      "sentra_core.builder.tools.workflow_tools.validate_blueprint_util",
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
      "sentra_core.builder.tools.workflow_tools.get_available_events_util",
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
      "sentra_core.builder.tools.workflow_tools.get_available_actions_util",
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
      "sentra_core.builder.ui_agent.get_preview_config",
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
      "sentra_core.builder.ui_agent.update_preview_config_util",
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

  // Unknown tool
  throw new Error(`Unknown tool: ${toolName}`);
}

// Re-export for convenience
export { createFrappeClient, FrappeClientConfig };
