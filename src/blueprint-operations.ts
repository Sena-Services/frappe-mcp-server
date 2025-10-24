/**
 * Blueprint Operations for MCP Server
 * Allows AI agents to execute and manage Frappe blueprints
 */

import { callMethod } from "./frappe-api.js";
import { CallToolRequest, Tool } from "@modelcontextprotocol/sdk/types.js";

export const BLUEPRINT_TOOLS: Tool[] = [
    {
        name: "execute_blueprint",
        description: "Execute a Frappe blueprint/workflow with document data. Returns execution result with status and context variables.",
        inputSchema: {
            type: "object",
            properties: {
                blueprint_name: {
                    type: "string",
                    description: "Name of the blueprint to execute"
                },
                doc_data: {
                    type: "object",
                    description: "Document data to pass to the blueprint (with doctype field)",
                    additionalProperties: true
                }
            },
            required: ["blueprint_name", "doc_data"]
        }
    },
    {
        name: "list_blueprints",
        description: "Get list of active blueprints available in the system",
        inputSchema: {
            type: "object",
            properties: {
                filters: {
                    type: "object",
                    description: "Optional filters (default: is_active=1)",
                    additionalProperties: true
                }
            }
        }
    },
    {
        name: "get_blueprint_info",
        description: "Get detailed information about a specific blueprint including actions and conditions",
        inputSchema: {
            type: "object",
            properties: {
                blueprint_name: {
                    type: "string",
                    description: "Name of the blueprint"
                }
            },
            required: ["blueprint_name"]
        }
    }
];

export async function handleBlueprintToolCall(request: CallToolRequest): Promise<any> {
    const { name, arguments: args } = request.params;

    try {
        if (name === "execute_blueprint") {
            if (!args) {
                throw new Error("Missing arguments for execute_blueprint");
            }
            const result = await callMethod(
                "sentra_core.bl_engine.core.blueprint_executor.execute_blueprint_manually",
                {
                    blueprint_name: args.blueprint_name,
                    doc: args.doc_data
                }
            );

            return {
                content: [{
                    type: "text",
                    text: `Blueprint executed successfully:\n\n${JSON.stringify(result, null, 2)}`
                }],
                isError: false
            };
        }

        if (name === "list_blueprints") {
            const result = await callMethod(
                "frappe.client.get_list",
                {
                    doctype: "BL Blueprint",
                    filters: args?.filters || { is_active: 1 },
                    fields: ["name", "blueprint_description"]
                }
            );

            return {
                content: [{
                    type: "text",
                    text: `Available blueprints:\n\n${JSON.stringify(result, null, 2)}`
                }],
                isError: false
            };
        }

        if (name === "get_blueprint_info") {
            if (!args) {
                throw new Error("Missing arguments for get_blueprint_info");
            }
            const result = await callMethod(
                "frappe.client.get",
                {
                    doctype: "BL Blueprint",
                    name: args.blueprint_name
                }
            );

            return {
                content: [{
                    type: "text",
                    text: `Blueprint details:\n\n${JSON.stringify(result, null, 2)}`
                }],
                isError: false
            };
        }

        return {
            content: [{
                type: "text",
                text: `Unknown blueprint tool: ${name}`
            }],
            isError: true
        };

    } catch (error: any) {
        console.error(`Error in blueprint tool ${name}:`, error);
        return {
            content: [{
                type: "text",
                text: `Error: ${error.message}`
            }],
            isError: true
        };
    }
}
