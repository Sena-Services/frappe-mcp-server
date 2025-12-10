/**
 * DocType Structure Operations for MCP Server
 * Tools for creating and modifying DocType schemas (not document CRUD)
 *
 * These tools are specific to Express Builder / Sentra Core for creating
 * custom DocTypes programmatically via AI agents.
 *
 * NOTE: CRUD Config operations use regular document CRUD tools since
 * DoctypeCrudConfig is itself a DocType. Use create_document, get_document,
 * update_document, delete_document, list_documents for CRUD configs.
 */

import { createFrappeClient, FrappeClientConfig, callMethod } from "./frappe-api.js";
import { CallToolRequest, Tool } from "@modelcontextprotocol/sdk/types.js";
import { FrappeApp } from "frappe-js-sdk";

export const DOCTYPE_OPERATIONS_TOOLS: Tool[] = [
    {
        name: "create_doctype",
        description: "Create a new custom DocType with specified fields. Use this to create new database tables/entities programmatically.",
        inputSchema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "DocType name in PascalCase (e.g., 'Customer', 'SalesOrder', 'WorkoutLog')"
                },
                fields: {
                    type: "array",
                    description: "Array of field definitions. Each field must have fieldname (snake_case), fieldtype (Data, Select, Link, etc.), and label. NEVER use reserved fieldnames: name, owner, creation, modified, docstatus, idx, parent. Use descriptive names like product_name, customer_name instead.",
                    items: {
                        type: "object",
                        properties: {
                            fieldname: { type: "string", description: "Field name in snake_case. NEVER use: name, owner, creation, modified, docstatus, idx, parent, parenttype, parentfield. Use product_name, customer_name, etc." },
                            fieldtype: {
                                type: "string",
                                description: "Frappe field type. Valid types: Data, Text, Small Text, Long Text, Int, Float, Currency, Percent, Check, Date, Datetime, Time, Duration, Select, Link, Dynamic Link, Table, Table MultiSelect, Attach, Attach Image, Image, Signature, Color, Barcode, Geolocation, Rating, Password, Read Only, HTML, HTML Editor, Text Editor, Markdown Editor, Code, JSON, Phone, Autocomplete, Icon. For Data fields, use 'options' for validation: Email, URL, Name, Phone, Barcode, IBAN."
                            },
                            label: { type: "string", description: "Human-readable label" },
                            reqd: { type: "number", description: "Required field (0 or 1)", default: 0 },
                            unique: { type: "number", description: "Unique field (0 or 1)", default: 0 },
                            options: { type: "string", description: "For Select: newline-separated options (e.g., 'Draft\\nActive\\nClosed'). For Link: target DocType name. For Data: validation type (Email, URL, Name, Phone, Barcode, IBAN). For Rating: max stars (e.g., '5').", default: "" },
                            read_only: { type: "number", description: "Read-only field - cannot be edited in forms (0 or 1)", default: 0 },
                            hidden: { type: "number", description: "Hidden field - not visible in UI (0 or 1)", default: 0 },
                            default: { type: "string", description: "Default value for the field" },
                            description: { type: "string", description: "Field help text shown below the field" },
                            in_list_view: { type: "number", description: "Show in list view (0 or 1)", default: 0 },
                            in_standard_filter: { type: "number", description: "Show in standard filters (0 or 1)", default: 0 },
                            bold: { type: "number", description: "Bold label (0 or 1)", default: 0 },
                            allow_on_submit: { type: "number", description: "Allow editing after submit (0 or 1)", default: 0 }
                        },
                        required: ["fieldname", "fieldtype", "label"]
                    }
                },
                module: {
                    type: "string",
                    description: "Frappe module name (default: 'Sentra Core')",
                    default: "Sentra Core"
                },
                naming_rule: {
                    type: "string",
                    description: "How to name documents (default: 'By fieldname')",
                    default: "By fieldname"
                },
                autoname: {
                    type: "string",
                    description: "Field to use for naming (e.g., 'field:customer_name'). If not provided, uses first field. IMPORTANT: Must reference a Data or Int field with unique=1. Do NOT use Date, Datetime, Text, or restricted fieldnames (name, owner, etc.). Prefer omitting this to auto-use first field, or use patterns like 'PROD-.####' for auto-increment."
                }
            },
            required: ["name"]
        }
    },
    {
        name: "create_child_table",
        description: "Create a child table DocType and link it to a parent DocType. Child tables are used for one-to-many relationships (e.g., Order Items in Sales Order).",
        inputSchema: {
            type: "object",
            properties: {
                parent_doctype: {
                    type: "string",
                    description: "Name of the parent DocType to link the child table to"
                },
                child_doctype_name: {
                    type: "string",
                    description: "Name for the new child table DocType (e.g., 'Order Item')"
                },
                child_fields: {
                    type: "array",
                    description: "Array of field definitions for the child table",
                    items: {
                        type: "object",
                        properties: {
                            fieldname: { type: "string" },
                            fieldtype: { type: "string" },
                            label: { type: "string" },
                            reqd: { type: "number", default: 0 },
                            options: { type: "string", default: "" }
                        },
                        required: ["fieldname", "fieldtype", "label"]
                    }
                },
                parent_field_label: {
                    type: "string",
                    description: "Label for the Table field in parent DocType (optional, auto-generated from child_doctype_name if not provided)"
                },
                parent_fieldname: {
                    type: "string",
                    description: "Fieldname for the Table field in parent DocType (e.g., 'milestones', 'attachments'). Optional - if not provided, derived from child_doctype_name (e.g., 'Project Milestone' → 'project_milestone')"
                }
            },
            required: ["parent_doctype", "child_doctype_name", "child_fields"]
        }
    },
    {
        name: "add_fields_to_doctype",
        description: "Add new fields to an existing DocType. Use this to extend existing DocTypes with additional fields.",
        inputSchema: {
            type: "object",
            properties: {
                doctype_name: {
                    type: "string",
                    description: "Name of the DocType to modify"
                },
                fields: {
                    type: "array",
                    description: "Array of field definitions to add",
                    items: {
                        type: "object",
                        properties: {
                            fieldname: { type: "string" },
                            fieldtype: { type: "string" },
                            label: { type: "string" },
                            reqd: { type: "number", default: 0 },
                            unique: { type: "number", default: 0 },
                            options: { type: "string", default: "" }
                        },
                        required: ["fieldname", "fieldtype", "label"]
                    }
                }
            },
            required: ["doctype_name", "fields"]
        }
    },
    {
        name: "delete_doctype",
        description: "Delete a custom DocType from the database. SAFETY: Only deletes custom DocTypes (custom=1), system DocTypes cannot be deleted.",
        inputSchema: {
            type: "object",
            properties: {
                doctype_name: {
                    type: "string",
                    description: "Name of the DocType to delete"
                }
            },
            required: ["doctype_name"]
        }
    }
];

/**
 * Handler function for DocType operation tool calls
 * @param request - MCP request object
 * @param credentials - Site-specific credentials (url, api_key, api_secret)
 */
export async function handleDoctypeOperationsToolCall(request: CallToolRequest, credentials?: FrappeClientConfig): Promise<any> {
    const { name, arguments: args } = request.params;

    // Validate credentials
    if (!credentials) {
        return {
            content: [{
                type: "text",
                text: "Error: No credentials provided for API call"
            }],
            isError: true
        };
    }

    // Create Frappe client with site-specific credentials
    const client = createFrappeClient(credentials);

    try {
        console.error(`Handling DocType operation tool: ${name} with args:`, args);

        // Helper function to extract success from Frappe API response
        // Frappe returns { message: { success: true/false, ... } } OR { success: true/false, ... }
        const getSuccess = (result: any): boolean => {
            return result?.message?.success ?? result?.success ?? false;
        };

        if (name === "create_doctype") {
            if (!args || !args.name) {
                throw new Error("Missing required argument: name is required");
            }

            // Call the Frappe backend method
            const result = await callMethod(
                client,
                "sentra_core.builder.tools.data_tools.create_doctype_util",
                {
                    name: args.name,
                    fields: args.fields || [],  // Allow empty fields
                    module: args.module || "Sentra Core",
                    naming_rule: args.naming_rule || "By fieldname",
                    autoname: args.autoname || null
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

        if (name === "create_child_table") {
            if (!args || !args.parent_doctype || !args.child_doctype_name || !args.child_fields) {
                throw new Error("Missing required arguments: parent_doctype, child_doctype_name, and child_fields are required");
            }

            const result = await callMethod(
                client,
                "sentra_core.builder.tools.data_tools.create_child_table_util",
                {
                    parent_doctype: args.parent_doctype,
                    child_doctype_name: args.child_doctype_name,
                    child_fields: args.child_fields,
                    parent_field_label: args.parent_field_label || null
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

        if (name === "add_fields_to_doctype") {
            if (!args || !args.doctype_name || !args.fields) {
                throw new Error("Missing required arguments: doctype_name and fields are required");
            }

            const result = await callMethod(
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
                isError: !getSuccess(result)
            };
        }

        if (name === "delete_doctype") {
            if (!args || !args.doctype_name) {
                throw new Error("Missing required argument: doctype_name");
            }

            const result = await callMethod(
                client,
                "sentra_core.builder.tools.data_tools.delete_doctype",
                {
                    doctype_name: args.doctype_name
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

        return {
            content: [{
                type: "text",
                text: `Unknown DocType operations tool: ${name}`
            }],
            isError: true
        };

    } catch (error: any) {
        console.error(`Error in DocType operations tool ${name}:`, error);
        return {
            content: [{
                type: "text",
                text: `Error: ${error.message}\n\nStack: ${error.stack}`
            }],
            isError: true
        };
    }
}
