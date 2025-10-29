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

import { callMethod } from "./frappe-api.js";
import { CallToolRequest, Tool } from "@modelcontextprotocol/sdk/types.js";

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
                            fieldtype: { type: "string", description: "Frappe field type (Data, Select, Link, Text, Int, etc.)" },
                            label: { type: "string", description: "Human-readable label" },
                            reqd: { type: "number", description: "Required field (0 or 1)", default: 0 },
                            unique: { type: "number", description: "Unique field (0 or 1)", default: 0 },
                            options: { type: "string", description: "Options for Select/Link fields", default: "" }
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
            required: ["name", "fields"]
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
                    description: "Label for the field in parent DocType (optional, auto-generated if not provided)"
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

export async function handleDoctypeOperationsToolCall(request: CallToolRequest): Promise<any> {
    const { name, arguments: args } = request.params;

    try {
        console.error(`Handling DocType operation tool: ${name} with args:`, args);

        if (name === "create_doctype") {
            if (!args || !args.name || !args.fields) {
                throw new Error("Missing required arguments: name and fields are required");
            }

            // Call the Frappe backend method
            const result = await callMethod(
                "sentra_core.builder.tools.data_tools.create_doctype_util",
                {
                    name: args.name,
                    fields: args.fields,
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
                isError: !result.success
            };
        }

        if (name === "create_child_table") {
            if (!args || !args.parent_doctype || !args.child_doctype_name || !args.child_fields) {
                throw new Error("Missing required arguments: parent_doctype, child_doctype_name, and child_fields are required");
            }

            const result = await callMethod(
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
                isError: !result.success
            };
        }

        if (name === "add_fields_to_doctype") {
            if (!args || !args.doctype_name || !args.fields) {
                throw new Error("Missing required arguments: doctype_name and fields are required");
            }

            const result = await callMethod(
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
                isError: !result.success
            };
        }

        if (name === "delete_doctype") {
            if (!args || !args.doctype_name) {
                throw new Error("Missing required argument: doctype_name");
            }

            const result = await callMethod(
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
                isError: !result.success
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
