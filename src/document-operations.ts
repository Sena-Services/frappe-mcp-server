import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createFrappeClient,
  FrappeClientConfig,
  callMethod,
  createDocument,
  getDocument,
  updateDocument,
  deleteDocument,
  listDocuments,
  FrappeApiError
} from "./frappe-api.js";
import { getRequiredFields, formatFilters } from "./frappe-helpers.js";
import { FrappeApp } from "frappe-js-sdk";
import { FRAPPE_INSTRUCTIONS } from "./frappe-instructions.js";

/**
 * Format error response with detailed information
 */
function formatErrorResponse(error: any, operation: string): any {
  // Include all error diagnostics directly in the response
  const apiKey = process.env.FRAPPE_API_KEY;
  const apiSecret = process.env.FRAPPE_API_SECRET;
  
  // Build a detailed diagnostic message
  let diagnostics = [
    `Error in ${operation}`,
    `Error type: ${typeof error}`,
    `Constructor: ${error.constructor?.name || 'unknown'}`,
    `Is FrappeApiError: ${error instanceof FrappeApiError}`,
    `Error properties: ${Object.keys(error).join(', ')}`,
    `API Key available: ${!!apiKey}`,
    `API Secret available: ${!!apiSecret}`
  ].join('\n');
  
  let errorMessage = '';
  let errorDetails = null;

  // Check for missing credentials first as this is likely the issue
  if (!apiKey || !apiSecret) {
    errorMessage = `Authentication failed: ${!apiKey && !apiSecret ? 'Both API key and API secret are missing' :
                    !apiKey ? 'API key is missing' : 'API secret is missing'}. API key/secret is the only supported authentication method.`;
    errorDetails = {
      error: "Missing credentials",
      apiKeyAvailable: !!apiKey,
      apiSecretAvailable: !!apiSecret,
      authMethod: "API key/secret (token)",
      diagnostics: diagnostics
    };
  }
  // Then check if it's a FrappeApiError
  else if (error instanceof FrappeApiError) {
    errorMessage = error.message;
    // Include the full error object properties for debugging
    errorDetails = {
      statusCode: error.statusCode,
      endpoint: error.endpoint,
      details: error.details,
      message: error.message,
      name: error.name,
      stack: error.stack?.split('\n').slice(0, 3).join('\n'),
      diagnostics: diagnostics,
      authError: false  // Initialize the property
    };
    
    // If it's an authentication error, provide more specific guidance
    if (error.message.includes('Authentication') ||
        error.message.includes('auth') ||
        error.statusCode === 401 ||
        error.statusCode === 403) {
      
      errorMessage = `Authentication error: ${error.message}. Please check your API key and secret.`;
      errorDetails.authError = true;
    }
  }
  // Check for Axios errors
  else if (error.isAxiosError) {
    errorMessage = `API request error: ${error.message}`;
    errorDetails = {
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: error.config?.url,
      method: error.config?.method,
      responseData: error.response?.data,
      diagnostics: diagnostics
    };
  }
  // Check for frappe-js-sdk errors (thrown as plain objects with httpStatus)
  else if (error.httpStatus !== undefined) {
    // frappe-js-sdk throws objects with httpStatus, httpStatusText, message, exception
    // The actual Frappe error is in the rest of the object
    const frappeError = error.exc || error._server_messages || error.exception || '';
    const serverMessages = error._server_messages ?
      (typeof error._server_messages === 'string' ?
        JSON.parse(error._server_messages).map((m: string) => JSON.parse(m).message || m).join('; ') :
        error._server_messages) :
      null;

    errorMessage = `Error in ${operation}: ${serverMessages || error.exception || error.message || 'Unknown error'}`;
    errorDetails = {
      httpStatus: error.httpStatus,
      httpStatusText: error.httpStatusText,
      exception: error.exception,
      serverMessages: serverMessages,
      exc: frappeError ? String(frappeError).substring(0, 500) : null,
      diagnostics: diagnostics
    };
  }
  // Default error handling
  else {
    errorMessage = `Error in ${operation}: ${error.message || 'Unknown error'}`;
    errorDetails = {
      errorKeys: Object.keys(error),
      diagnostics: diagnostics
    };
  }

  return {
    content: [
      {
        type: "text",
        text: errorMessage,
      },
      ...(errorDetails ? [
        {
          type: "text",
          text: `\nDetails: ${JSON.stringify(errorDetails, null, 2)}`,
        }
      ] : [])
    ],
    isError: true,
  };
}

/**
 * Validate document values against required fields
 */
async function validateDocumentValues(client: FrappeApp, doctype: string, values: Record<string, any>): Promise<string[]> {
  try {
    const requiredFields = await getRequiredFields(client, doctype);
    const missingFields = requiredFields
      .filter(field => !values.hasOwnProperty(field.fieldname))
      .map(field => field.fieldname);

    return missingFields;
  } catch (error) {
    console.error(`Error validating document values for ${doctype}:`, error);
    return []; // Return empty array on error to avoid blocking the operation
  }
}

// Define document tools
export const DOCUMENT_TOOLS = [
  {
    name: "create_document",
    description: "Create a new document in Frappe",
    inputSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name" },
        values: {
          type: "object",
          description: "Document field values. Required fields must be included. For Link fields, provide the exact document name. For Table fields, provide an array of row objects.",
          additionalProperties: true
        },
      },
      required: ["doctype", "values"],
    },
  },
  {
    name: "get_document",
    description: "Retrieve a document from Frappe",
    inputSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name" },
        name: { type: "string", description: "Document name (case-sensitive)" },
        fields: {
          type: "array",
          items: { type: "string" },
          description: "Fields to retrieve (optional). If not specified, all fields will be returned.",
        },
      },
      required: ["doctype", "name"],
    },
  },
  {
    name: "update_document",
    description: "Update an existing document in Frappe",
    inputSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name" },
        name: { type: "string", description: "Document name (case-sensitive)" },
        values: {
          type: "object",
          description: "Document field values to update. Only include fields that need to be updated. For Table fields, provide the entire table data including row IDs for existing rows.",
          additionalProperties: true
        },
      },
      required: ["doctype", "name", "values"],
    },
  },
  {
    name: "delete_document",
    description: "Delete a document from Frappe",
    inputSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name" },
        name: { type: "string", description: "Document name (case-sensitive)" },
      },
      required: ["doctype", "name"],
    },
  },
  {
    name: "list_documents",
    description: "List documents from Frappe with filters",
    inputSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name" },
        filters: {
          type: "object",
          description: "Filters to apply (optional). Simple format: {\"field\": \"value\"} or with operators: {\"field\": [\">\", \"value\"]}. Available operators: =, !=, <, >, <=, >=, like, not like, in, not in, is, is not, between.",
          additionalProperties: true
        },
        fields: {
          type: "array",
          items: { type: "string" },
          description: "Fields to retrieve (optional). For better performance, specify only the fields you need.",
        },
        limit: {
          type: "number",
          description: "Maximum number of documents to retrieve. Default is 20. To get ALL records, omit this parameter or set to 0. Do NOT use -1. Use with limit_start for pagination.",
        },
        limit_start: {
          type: "number",
          description: "Starting offset for pagination (optional). Use with limit for pagination.",
        },
        order_by: {
          type: "string",
          description: "Field to order by (optional). Format: \"field_name asc\" or \"field_name desc\".",
        },
      },
      required: ["doctype"],
    },
  },
  {
    name: "rename_document",
    description: `Rename a document (change its primary key/name). Use this when you need to change a document's name field, especially when the DocType uses autoname based on a field (e.g., autoname="field:driver_name").

IMPORTANT: When a DocType has autoname="field:X", you CANNOT change field X via update_document. You MUST use rename_document instead, which will:
1. Change the document's primary key (name)
2. Update the field that autoname is based on
3. Update all references to this document in other DocTypes

Example: To change "Esteban Ocon" to "Ocon" in a DocType with autoname="field:driver_name":
rename_document(doctype="F1 Driver Championship", old_name="Esteban Ocon", new_name="Ocon")`,
    inputSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name" },
        old_name: { type: "string", description: "Current document name (the value to change FROM)" },
        new_name: { type: "string", description: "New document name (the value to change TO)" },
        merge: { type: "boolean", description: "If true, merge with existing document of new_name (if it exists). Default: false" },
      },
      required: ["doctype", "old_name", "new_name"],
    },
  },
  {
    name: "bulk_delete_documents",
    description: `Delete multiple documents at once based on filters.

Use this when you need to delete many documents matching certain criteria.
Much more efficient than calling delete_document in a loop.

CAUTION: This is a destructive operation. Make sure your filters are correct!

Examples:
- Delete all drivers with 0 points: bulk_delete_documents(doctype="F1 Driver", filters={"points": 0})
- Delete all inactive products: bulk_delete_documents(doctype="Product", filters={"status": "Inactive"})
- Delete specific documents by name: bulk_delete_documents(doctype="Customer", names=["CUST-001", "CUST-002"])`,
    inputSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name" },
        filters: {
          type: "object",
          description: "Filters to match documents for deletion. Same format as list_documents filters.",
          additionalProperties: true
        },
        names: {
          type: "array",
          items: { type: "string" },
          description: "Alternative: List of specific document names to delete (instead of filters)"
        },
        limit: {
          type: "number",
          description: "Maximum number of documents to delete (safety limit). Default: 100"
        }
      },
      required: ["doctype"],
    },
  },
  {
    name: "bulk_update_documents",
    description: `Update multiple documents at once based on filters.

Use this when you need to update the same field(s) on many documents.
Much more efficient than calling update_document in a loop.

Examples:
- Set all products to inactive: bulk_update_documents(doctype="Product", filters={"status": "Active"}, values={"status": "Inactive"})
- Update all drivers' team: bulk_update_documents(doctype="F1 Driver", filters={"team": "Alpine"}, values={"team": "Renault"})
- Update specific documents: bulk_update_documents(doctype="Customer", names=["CUST-001", "CUST-002"], values={"status": "VIP"})`,
    inputSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name" },
        filters: {
          type: "object",
          description: "Filters to match documents for update. Same format as list_documents filters.",
          additionalProperties: true
        },
        names: {
          type: "array",
          items: { type: "string" },
          description: "Alternative: List of specific document names to update (instead of filters)"
        },
        values: {
          type: "object",
          description: "Field values to set on ALL matching documents",
          additionalProperties: true
        },
        limit: {
          type: "number",
          description: "Maximum number of documents to update (safety limit). Default: 100"
        }
      },
      required: ["doctype", "values"],
    },
  },
  {
    name: "bulk_create_documents",
    description: `Create multiple documents at once.

Use this when you need to create many documents from a list.
More efficient than calling create_document in a loop.

Example:
bulk_create_documents(doctype="Product", documents=[
  {"product_name": "Widget A", "price": 10},
  {"product_name": "Widget B", "price": 20},
  {"product_name": "Widget C", "price": 30}
])`,
    inputSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name" },
        documents: {
          type: "array",
          items: { type: "object" },
          description: "Array of document objects to create. Each object should have the field values for one document."
        }
      },
      required: ["doctype", "documents"],
    },
  },
  {
    name: "duplicate_document",
    description: `Create a copy of an existing document with a new name.

Useful for cloning templates or creating similar documents.
All fields are copied except the name (which uses autoname or the provided new_name).

Example:
duplicate_document(doctype="Product Template", source_name="TEMPLATE-001", new_name="PROD-NEW")`,
    inputSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType name" },
        source_name: { type: "string", description: "Name of the document to copy" },
        new_name: { type: "string", description: "Name for the new document (optional - uses autoname if not provided)" },
        override_values: {
          type: "object",
          description: "Field values to override in the copy (optional)",
          additionalProperties: true
        }
      },
      required: ["doctype", "source_name"],
    },
  },
  {
    name: "get_linked_documents",
    description: `Find all documents that link TO a specific document.

Useful for understanding dependencies before deleting, or finding related records.

Example: Find all Orders that link to Customer "CUST-001":
get_linked_documents(doctype="Customer", name="CUST-001")

Returns: {"Order": ["ORD-001", "ORD-002"], "Invoice": ["INV-001"]}`,
    inputSchema: {
      type: "object",
      properties: {
        doctype: { type: "string", description: "DocType of the target document" },
        name: { type: "string", description: "Name of the target document" },
        link_doctype: { type: "string", description: "Optional: Only check links from this specific DocType" }
      },
      required: ["doctype", "name"],
    },
  },
  {
    name: "reconcile_bank_transaction_with_vouchers",
    description: "Reconciles a Bank Transaction document with specified vouchers by calling a specific Frappe method.",
    inputSchema: {
      type: "object",
      properties: {
        bank_transaction_name: {
          type: "string",
          description: "The ID (name) of the Bank Transaction document to reconcile.",
        },
        vouchers: {
          type: "array",
          description: "An array of voucher objects to reconcile against the bank transaction.",
          items: {
            type: "object",
            properties: {
              payment_doctype: {
                type: "string",
                description: "The DocType of the payment voucher (e.g., Payment Entry, Journal Entry).",
              },
              payment_name: {
                type: "string",
                description: "The ID (name) of the payment voucher document.",
              },
              amount: {
                type: "number",
                description: "The amount from the voucher to reconcile.",
              },
            },
            required: ["payment_doctype", "payment_name", "amount"],
          },
        },
      },
      required: ["bank_transaction_name", "vouchers"],
    },
  },
  {
    name: "add_child_table_row",
    description: `Add a row to a child table of an existing document.

Use this to add records to child tables (one-to-many relationships) without updating the entire parent.
This is more efficient than get_document + update_document for appending rows.

Example - Add a task to an AI Agent:
add_child_table_row(
  child_doctype="AI Agent Task",
  parent_doctype="AI Agent",
  parent_name="data_agent",
  parentfield="tasks",
  values={"task_id": "task_001", "frontend_text": "Creating Customer", "status": "running"}
)`,
    inputSchema: {
      type: "object",
      properties: {
        child_doctype: {
          type: "string",
          description: "The child table DocType name (e.g., 'AI Agent Task', 'Sales Order Item')"
        },
        parent_doctype: {
          type: "string",
          description: "The parent DocType name (e.g., 'AI Agent', 'Sales Order')"
        },
        parent_name: {
          type: "string",
          description: "The name of the parent document to add the row to"
        },
        parentfield: {
          type: "string",
          description: "The field name on the parent that holds this child table (e.g., 'tasks', 'items')"
        },
        values: {
          type: "object",
          description: "Field values for the new child row",
          additionalProperties: true
        }
      },
      required: ["child_doctype", "parent_doctype", "parent_name", "parentfield", "values"],
    },
  },
  {
    name: "update_child_table_row",
    description: `Update an existing child table row by its row name (primary key).

Use this to update specific fields on a child table row without touching the parent.

Example - Update a task status:
update_child_table_row(
  child_doctype="AI Agent Task",
  row_name="abc123xyz",
  values={"status": "completed", "result": "Task completed successfully"}
)`,
    inputSchema: {
      type: "object",
      properties: {
        child_doctype: {
          type: "string",
          description: "The child table DocType name (e.g., 'AI Agent Task')"
        },
        row_name: {
          type: "string",
          description: "The name (primary key) of the child row to update"
        },
        values: {
          type: "object",
          description: "Field values to update on the child row",
          additionalProperties: true
        }
      },
      required: ["child_doctype", "row_name", "values"],
    },
  },
];

/**
 * Handler function for document tool calls
 * @param request - MCP request object
 * @param credentials - Site-specific credentials (url, api_key, api_secret)
 */
export async function handleDocumentToolCall(request: any, credentials?: FrappeClientConfig): Promise<any> {
  const { name, arguments: args } = request.params;

  if (!args) {
    return {
      content: [
        {
          type: "text",
          text: "Missing arguments for tool call",
        },
      ],
      isError: true,
    };
  }

  // Create Frappe client with credentials
  if (!credentials) {
    return {
      content: [
        {
          type: "text",
          text: "Error: No credentials provided for API call",
        },
      ],
      isError: true,
    };
  }

  const client = createFrappeClient(credentials);

  try {
    console.error("Handling document tool:", name, "with args:", args);

    // Handle document operations
    if (name === "create_document") {
      const doctype = args.doctype as string;
      const values = args.values as Record<string, any>;

      if (!doctype || !values) {
        return {
          content: [
            {
              type: "text",
              text: "Missing required parameters: doctype and values",
            },
          ],
          isError: true,
        };
      }

      // Validate required fields
      const missingFields = await validateDocumentValues(client, doctype, values);
      if (missingFields.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `Missing required fields: ${missingFields.join(', ')}`,
            },
            {
              type: "text",
              text: "\nTip: Use get_required_fields tool to see all required fields for this DocType.",
            },
          ],
          isError: true,
        };
      }

      try {
        console.error(`Calling createDocument for ${doctype} with values:`, JSON.stringify(values, null, 2));

        let result;
        let authMethod = "api_key";
        let verificationSuccess = false;
        let verificationMessage = "";

        // Use API key/secret authentication with site-specific client
        result = await createDocument(client, doctype, values);
        console.error(`Result from createDocument:`, JSON.stringify(result, null, 2));

        // Check for verification result
        if (result._verification && result._verification.success === false) {
          verificationSuccess = false;
          verificationMessage = result._verification.message;
          delete result._verification; // Remove internal property before returning to client
        } else {
          verificationSuccess = true;
        }

        // IMPROVED: Return error if verification failed
        if (!verificationSuccess) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Document creation reported success but verification failed. The document may not have been created.\n\nDetails: ${verificationMessage}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Document created successfully using ${authMethod} authentication:\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        console.error(`Error in create_document handler:`, error);
        return formatErrorResponse(error, `create_document(${doctype})`);
      }
    } else if (name === "get_document") {
      const doctype = args.doctype as string;
      const docName = args.name as string;
      const fields = args.fields as string[] | undefined;

      if (!doctype || !docName) {
        return {
          content: [
            {
              type: "text",
              text: "Missing required parameters: doctype and name",
            },
          ],
          isError: true,
        };
      }

      try {
        const document = await getDocument(client, doctype, docName, fields);
        console.error(`Retrieved document:`, JSON.stringify(document, null, 2));

        return {
          content: [
            {
              type: "text",
              text: `Document retrieved:\n\n${JSON.stringify(document, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return formatErrorResponse(error, `get_document(${doctype}, ${docName})`);
      }
    } else if (name === "update_document") {
      const doctype = args.doctype as string;
      const docName = args.name as string;
      const values = args.values as Record<string, any>;

      if (!doctype || !docName || !values) {
        return {
          content: [
            {
              type: "text",
              text: "Missing required parameters: doctype, name, and values",
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await updateDocument(client, doctype, docName, values);
        console.error(`Result from updateDocument:`, JSON.stringify(result, null, 2));

        return {
          content: [
            {
              type: "text",
              text: `Document updated successfully:\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        return formatErrorResponse(error, `update_document(${doctype}, ${docName})`);
      }
    } else if (name === "delete_document") {
      const doctype = args.doctype as string;
      const docName = args.name as string;

      if (!doctype || !docName) {
        return {
          content: [
            {
              type: "text",
              text: "Missing required parameters: doctype and name",
            },
          ],
          isError: true,
        };
      }

      try {
        await deleteDocument(client, doctype, docName);
        console.error(`Document deleted`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `Document ${doctype}/${docName} deleted successfully`
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        return formatErrorResponse(error, `delete_document(${doctype}, ${docName})`);
      }
    } else if (name === "list_documents") {
      const doctype = args.doctype as string;
      const filters = args.filters as Record<string, any> | undefined;
      const fields = args.fields as string[] | undefined;
      const limit = args.limit as number | undefined;
      const order_by = args.order_by as string | undefined;
      const limit_start = args.limit_start as number | undefined;

      if (!doctype) {
        return {
          content: [
            {
              type: "text",
              text: "Missing required parameter: doctype",
            },
          ],
          isError: true,
        };
      }

      try {
        // Format filters if provided
        const formattedFilters = filters ? formatFilters(filters) : undefined;

        const documents = await listDocuments(
          client,
          doctype,
          formattedFilters,
          fields,
          limit,
          order_by,
          limit_start
        );
        console.error(`Retrieved ${documents.length} documents`);

        // Add pagination info if applicable
        let paginationInfo = "";
        if (limit) {
          const startIndex = limit_start || 0;
          const endIndex = startIndex + documents.length;
          paginationInfo = `\n\nShowing items ${startIndex + 1}-${endIndex}`;

          if (documents.length === limit) {
            paginationInfo += ` (more items may be available, use limit_start=${endIndex} to see next page)`;
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Documents retrieved:\n\n${JSON.stringify(documents, null, 2)}${paginationInfo}`,
            },
          ],
        };
      } catch (error) {
        return formatErrorResponse(error, `list_documents(${doctype})`);
      }
    } else if (name === "rename_document") {
      const doctype = args.doctype as string;
      const oldName = args.old_name as string;
      const newName = args.new_name as string;
      const merge = args.merge as boolean || false;

      if (!doctype || !oldName || !newName) {
        return {
          content: [
            {
              type: "text",
              text: "Missing required parameters: doctype, old_name, and new_name",
            },
          ],
          isError: true,
        };
      }

      try {
        // Use frappe.rename_doc via call_method
        const result = await callMethod(client, "frappe.client.rename_doc", {
          doctype: doctype,
          old: oldName,
          new: newName,
          merge: merge ? 1 : 0
        });
        console.error(`Document renamed from '${oldName}' to '${newName}':`, JSON.stringify(result, null, 2));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `Document renamed from '${oldName}' to '${newName}'`,
                doctype: doctype,
                old_name: oldName,
                new_name: newName,
                result: result
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        return formatErrorResponse(error, `rename_document(${doctype}, ${oldName} -> ${newName})`);
      }
    } else if (name === "bulk_delete_documents") {
      const doctype = args.doctype as string;
      const filters = args.filters as Record<string, any> | undefined;
      const names = args.names as string[] | undefined;
      const limit = (args.limit as number) || 100;

      if (!doctype) {
        return {
          content: [{ type: "text", text: "Missing required parameter: doctype" }],
          isError: true,
        };
      }

      if (!filters && !names) {
        return {
          content: [{ type: "text", text: "Must provide either 'filters' or 'names' parameter" }],
          isError: true,
        };
      }

      try {
        let docsToDelete: string[] = [];

        if (names) {
          docsToDelete = names.slice(0, limit);
        } else if (filters) {
          const formattedFilters = formatFilters(filters);
          const docs = await listDocuments(client, doctype, formattedFilters, ["name"], limit);
          docsToDelete = docs.map((d: any) => d.name);
        }

        if (docsToDelete.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, message: "No documents matched the criteria", deleted_count: 0 }, null, 2) }],
          };
        }

        // Delete each document
        const results: { deleted: string[], failed: { name: string, error: string }[] } = { deleted: [], failed: [] };
        for (const docName of docsToDelete) {
          try {
            await deleteDocument(client, doctype, docName);
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
        };
      } catch (error) {
        return formatErrorResponse(error, `bulk_delete_documents(${doctype})`);
      }
    } else if (name === "bulk_update_documents") {
      const doctype = args.doctype as string;
      const filters = args.filters as Record<string, any> | undefined;
      const names = args.names as string[] | undefined;
      const values = args.values as Record<string, any>;
      const limit = (args.limit as number) || 100;

      if (!doctype || !values) {
        return {
          content: [{ type: "text", text: "Missing required parameters: doctype and values" }],
          isError: true,
        };
      }

      if (!filters && !names) {
        return {
          content: [{ type: "text", text: "Must provide either 'filters' or 'names' parameter" }],
          isError: true,
        };
      }

      try {
        let docsToUpdate: string[] = [];

        if (names) {
          docsToUpdate = names.slice(0, limit);
        } else if (filters) {
          const formattedFilters = formatFilters(filters);
          const docs = await listDocuments(client, doctype, formattedFilters, ["name"], limit);
          docsToUpdate = docs.map((d: any) => d.name);
        }

        if (docsToUpdate.length === 0) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, message: "No documents matched the criteria", updated_count: 0 }, null, 2) }],
          };
        }

        // Update each document
        const results: { updated: string[], failed: { name: string, error: string }[] } = { updated: [], failed: [] };
        for (const docName of docsToUpdate) {
          try {
            await updateDocument(client, doctype, docName, values);
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
        };
      } catch (error) {
        return formatErrorResponse(error, `bulk_update_documents(${doctype})`);
      }
    } else if (name === "bulk_create_documents") {
      const doctype = args.doctype as string;
      const documents = args.documents as Record<string, any>[];

      if (!doctype || !documents || !Array.isArray(documents)) {
        return {
          content: [{ type: "text", text: "Missing required parameters: doctype and documents (array)" }],
          isError: true,
        };
      }

      try {
        const results: { created: string[], failed: { index: number, error: string }[] } = { created: [], failed: [] };

        for (let i = 0; i < documents.length; i++) {
          try {
            const result = await createDocument(client, doctype, documents[i]);
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
        };
      } catch (error) {
        return formatErrorResponse(error, `bulk_create_documents(${doctype})`);
      }
    } else if (name === "duplicate_document") {
      const doctype = args.doctype as string;
      const sourceName = args.source_name as string;
      const newName = args.new_name as string | undefined;
      const overrideValues = args.override_values as Record<string, any> | undefined;

      if (!doctype || !sourceName) {
        return {
          content: [{ type: "text", text: "Missing required parameters: doctype and source_name" }],
          isError: true,
        };
      }

      try {
        // Get the source document
        const sourceDoc = await getDocument(client, doctype, sourceName);

        // Remove system fields that shouldn't be copied
        const systemFields = ['name', 'owner', 'creation', 'modified', 'modified_by', 'docstatus', 'idx', 'doctype', '_user_tags', '_comments', '_assign', '_liked_by'];
        const newDocValues: Record<string, any> = {};

        for (const [key, value] of Object.entries(sourceDoc)) {
          if (!systemFields.includes(key) && !key.startsWith('_')) {
            newDocValues[key] = value;
          }
        }

        // Apply override values
        if (overrideValues) {
          Object.assign(newDocValues, overrideValues);
        }

        // If new_name provided and doctype uses field-based autoname, set that field
        if (newName) {
          newDocValues['name'] = newName;
        }

        // Create the new document
        const result = await createDocument(client, doctype, newDocValues);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Duplicated '${sourceName}' to '${result.name}'`,
              source_name: sourceName,
              new_name: result.name,
              new_document: result
            }, null, 2)
          }],
        };
      } catch (error) {
        return formatErrorResponse(error, `duplicate_document(${doctype}, ${sourceName})`);
      }
    } else if (name === "get_linked_documents") {
      const doctype = args.doctype as string;
      const docName = args.name as string;
      const linkDoctype = args.link_doctype as string | undefined;

      if (!doctype || !docName) {
        return {
          content: [{ type: "text", text: "Missing required parameters: doctype and name" }],
          isError: true,
        };
      }

      try {
        // Use frappe.client.get_linked_docs or a custom method
        const result = await callMethod(client, "frappe.client.get_count", {
          doctype: doctype,
          filters: { name: docName }
        });

        // For now, use a simpler approach - call a method to get links
        // This would need a custom Frappe method for full implementation
        const linkInfo = await callMethod(client, "frappe.model.meta.get_link_fields", {
          doctype: doctype
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `Link information for ${doctype}/${docName}`,
              doctype: doctype,
              name: docName,
              note: "Full linked document listing requires custom Frappe method. Link fields info shown below.",
              link_fields: linkInfo
            }, null, 2)
          }],
        };
      } catch (error) {
        return formatErrorResponse(error, `get_linked_documents(${doctype}, ${docName})`);
      }
    } else if (name === "reconcile_bank_transaction_with_vouchers") {
      const bankTransactionName = args.bank_transaction_name as string;
      const vouchers = args.vouchers as Array<{ payment_doctype: string; payment_name: string; amount: number }>;

      if (!bankTransactionName || !vouchers) {
        return {
          content: [
            {
              type: "text",
              text: "Missing required parameters: bank_transaction_name and vouchers",
            },
          ],
          isError: true,
        };
      }
      if (!Array.isArray(vouchers) || vouchers.some(v => !v.payment_doctype || !v.payment_name || typeof v.amount !== 'number')) {
        return {
          content: [
            {
              type: "text",
              text: "Invalid format for 'vouchers' parameter. It must be an array of objects, each with 'payment_doctype' (string), 'payment_name' (string), and 'amount' (number).",
            },
          ],
          isError: true,
        };
      }

      try {
        const frappeMethod = "erpnext.accounts.doctype.bank_reconciliation_tool.bank_reconciliation_tool.reconcile_vouchers";
        const params = {
          bank_transaction_name: bankTransactionName,
          vouchers: JSON.stringify(vouchers), // Frappe method expects vouchers as a JSON string
        };

        console.error(`Calling Frappe method '${frappeMethod}' with params:`, JSON.stringify(params, null, 2));
        const result = await callMethod(client, frappeMethod, params);
        console.error(`Result from '${frappeMethod}':`, JSON.stringify(result, null, 2));

        return {
          content: [
            {
              type: "text",
              text: `Bank transaction '${bankTransactionName}' reconciled successfully with vouchers:\n\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        console.error(`Error in reconcile_bank_transaction_with_vouchers handler:`, error);
        return formatErrorResponse(error, `reconcile_bank_transaction_with_vouchers(${bankTransactionName})`);
      }
    } else if (name === "add_child_table_row") {
      const childDoctype = args.child_doctype as string;
      const parentDoctype = args.parent_doctype as string;
      const parentName = args.parent_name as string;
      const parentfield = args.parentfield as string;
      const values = args.values as Record<string, any>;

      if (!childDoctype || !parentDoctype || !parentName || !parentfield || !values) {
        return {
          content: [{
            type: "text",
            text: "Missing required parameters: child_doctype, parent_doctype, parent_name, parentfield, and values"
          }],
          isError: true,
        };
      }

      try {
        const result = await callMethod(client, "sena_backend.builder.tools.data_tools.add_child_table_row", {
          child_doctype: childDoctype,
          parent_doctype: parentDoctype,
          parent_name: parentName,
          parentfield: parentfield,
          values: JSON.stringify(values)
        });
        console.error(`Result from add_child_table_row:`, JSON.stringify(result, null, 2));

        if (result.success === false) {
          return {
            content: [{
              type: "text",
              text: `Error adding child table row: ${result.error || result.message}`
            }],
            isError: true,
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }],
        };
      } catch (error) {
        console.error(`Error in add_child_table_row handler:`, error);
        return formatErrorResponse(error, `add_child_table_row(${childDoctype})`);
      }
    } else if (name === "update_child_table_row") {
      const childDoctype = args.child_doctype as string;
      const rowName = args.row_name as string;
      const values = args.values as Record<string, any>;

      if (!childDoctype || !rowName || !values) {
        return {
          content: [{
            type: "text",
            text: "Missing required parameters: child_doctype, row_name, and values"
          }],
          isError: true,
        };
      }

      try {
        const result = await callMethod(client, "sena_backend.builder.tools.data_tools.update_child_table_row", {
          child_doctype: childDoctype,
          row_name: rowName,
          values: JSON.stringify(values)
        });
        console.error(`Result from update_child_table_row:`, JSON.stringify(result, null, 2));

        if (result.success === false) {
          return {
            content: [{
              type: "text",
              text: `Error updating child table row: ${result.error || result.message}`
            }],
            isError: true,
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }],
        };
      } catch (error) {
        console.error(`Error in update_child_table_row handler:`, error);
        return formatErrorResponse(error, `update_child_table_row(${childDoctype}, ${rowName})`);
      }
    }


    return {
      content: [
        {
          type: "text",
          text: `Document operations module doesn't handle tool: ${name}`,
        },
      ],
      isError: true,
    };
  } catch (error) {
    return formatErrorResponse(error, `document_operations.${name}`);
  }
}

export function setupDocumentTools(server: Server): void {
  // We no longer register tools here
  // Tools are now registered in the central handler in index.ts

  // This function is kept as a no-op to prevent import errors
  console.error("Document tools are now registered in the central handler in index.ts");
}

/**
 * Handle call_method tool call
 * @param request - MCP request object
 * @param credentials - Site-specific credentials (url, api_key, api_secret)
 */
export async function handleCallMethodToolCall(request: any, credentials?: FrappeClientConfig): Promise<any> {
  const { name, arguments: args } = request.params;

  if (!args) {
    return {
      content: [
        {
          type: "text",
          text: "Missing arguments for tool call",
        },
      ],
      isError: true,
    };
  }

  // Create Frappe client with credentials
  if (!credentials) {
    return {
      content: [
        {
          type: "text",
          text: "Error: No credentials provided for API call",
        },
      ],
      isError: true,
    };
  }

  const client = createFrappeClient(credentials);

  try {
    console.error(`Handling call_method tool with args:`, args);
    const method = args.method as string;
    const params = args.params as Record<string, any> | undefined;

    if (!method) {
      return {
        content: [
          {
            type: "text",
            text: "Missing required parameter: method",
          },
        ],
        isError: true,
      };
    }

    const result = await callMethod(client, method, params);
    return {
      content: [
        {
          type: "text",
          text: `Method ${method} called successfully:\n\n${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    return formatErrorResponse(error, `call_method(${name})`);
  }
}