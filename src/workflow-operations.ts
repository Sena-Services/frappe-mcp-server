/**
 * Workflow Operations for MCP Server
 * Allows AI agents to create and manage BL Blueprints (business logic workflows)
 *
 * All implementation delegated to builder/tools/workflow_tools.py
 */

import { CallToolRequest, Tool } from "@modelcontextprotocol/sdk/types.js";
import { callMethod } from "./frappe-api.js";

export const WORKFLOW_TOOLS: Tool[] = [
    {
        name: "create_blueprint",
        description: "Create a new BL Blueprint (business logic workflow) with triggers and actions",
        inputSchema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Blueprint name (alphanumeric + underscores, e.g., 'welcome_customer')"
                },
                triggers: {
                    type: "string",
                    description: "JSON string array of trigger definitions. Each trigger must have: doctype (string), event (string like 'after_insert', 'on_update')"
                },
                actions: {
                    type: "string",
                    description: "JSON string array of action definitions. Each action must have: action_type (string), execution_order (optional number), parameters (object)"
                },
                description: {
                    type: "string",
                    description: "Human-readable description of what this workflow does (optional)"
                },
                parameters: {
                    type: "string",
                    description: "JSON string object for blueprint-level variables (optional)"
                }
            },
            required: ["name", "triggers", "actions"]
        }
    },
    {
        name: "read_blueprint",
        description: "Get an existing blueprint configuration",
        inputSchema: {
            type: "object",
            properties: {
                blueprint_id: {
                    type: "string",
                    description: "Name of the blueprint to retrieve"
                }
            },
            required: ["blueprint_id"]
        }
    },
    {
        name: "update_blueprint",
        description: "Update an existing blueprint configuration",
        inputSchema: {
            type: "object",
            properties: {
                blueprint_id: {
                    type: "string",
                    description: "Name of the blueprint to update"
                },
                triggers: {
                    type: "string",
                    description: "JSON string array of new trigger definitions (optional, pass empty to keep existing)"
                },
                actions: {
                    type: "string",
                    description: "JSON string array of new action definitions (optional, pass empty to keep existing)"
                },
                description: {
                    type: "string",
                    description: "New description (optional, pass empty to keep existing)"
                },
                parameters: {
                    type: "string",
                    description: "JSON string object for new parameters (optional, pass empty to keep existing)"
                }
            },
            required: ["blueprint_id"]
        }
    },
    {
        name: "delete_blueprint",
        description: "Delete a blueprint from the system",
        inputSchema: {
            type: "object",
            properties: {
                blueprint_id: {
                    type: "string",
                    description: "Name of the blueprint to delete"
                }
            },
            required: ["blueprint_id"]
        }
    },
    {
        name: "list_blueprints",
        description: "List all active blueprints in the system",
        inputSchema: {
            type: "object",
            properties: {
                filters: {
                    type: "object",
                    description: "Optional filters for blueprint query (default: is_active=1)",
                    additionalProperties: true
                }
            }
        }
    },
    {
        name: "validate_blueprint",
        description: "Validate a blueprint JSON structure before creation",
        inputSchema: {
            type: "object",
            properties: {
                blueprint_json: {
                    type: "string",
                    description: "JSON string of the complete blueprint to validate"
                }
            },
            required: ["blueprint_json"]
        }
    },
    {
        name: "get_available_events",
        description: "Get list of valid Frappe event types for blueprint triggers (24 events like after_insert, on_update, before_save, etc.)",
        inputSchema: {
            type: "object",
            properties: {}
        }
    },
    {
        name: "get_available_actions",
        description: "Get list of valid action types for blueprint actions (CRUD operations, conditionals, notifications, etc.)",
        inputSchema: {
            type: "object",
            properties: {}
        }
    }
];

/**
 * Handle workflow tool calls
 * All implementation delegated to sentra_core.builder.tools.workflow_tools
 */
export async function handleWorkflowToolCall(request: CallToolRequest): Promise<any> {
    const { name, arguments: args } = request.params;

    try {
        console.error(`Handling workflow tool: ${name} with args:`, args);

        // All workflow tools delegate to builder/tools/workflow_tools.py
        if (name === "create_blueprint") {
            if (!args || !args.name || !args.triggers || !args.actions) {
                throw new Error("Missing required arguments: name, triggers, and actions are required");
            }

            const result = await callMethod(
                "sentra_core.builder.tools.workflow_tools.create_blueprint_util",
                {
                    name: args.name,
                    triggers: args.triggers,
                    actions: args.actions,
                    description: args.description || null,
                    parameters: args.parameters || null
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

        if (name === "read_blueprint") {
            if (!args || !args.blueprint_id) {
                throw new Error("Missing required argument: blueprint_id");
            }

            const result = await callMethod(
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
                isError: !result.success
            };
        }

        if (name === "update_blueprint") {
            if (!args || !args.blueprint_id) {
                throw new Error("Missing required argument: blueprint_id");
            }

            const result = await callMethod(
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
                isError: !result.success
            };
        }

        if (name === "delete_blueprint") {
            if (!args || !args.blueprint_id) {
                throw new Error("Missing required argument: blueprint_id");
            }

            const result = await callMethod(
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
                isError: !result.success
            };
        }

        if (name === "list_blueprints") {
            const result = await callMethod(
                "sentra_core.builder.tools.workflow_tools.list_blueprints_util",
                {
                    filters: args?.filters || null
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

        if (name === "validate_blueprint") {
            if (!args || !args.blueprint_json) {
                throw new Error("Missing required argument: blueprint_json");
            }

            const result = await callMethod(
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
                isError: !result.success
            };
        }

        if (name === "get_available_events") {
            const result = await callMethod(
                "sentra_core.builder.tools.workflow_tools.get_available_events_util",
                {}
            );

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                }],
                isError: !result.success
            };
        }

        if (name === "get_available_actions") {
            const result = await callMethod(
                "sentra_core.builder.tools.workflow_tools.get_available_actions_util",
                {}
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
                text: `Unknown workflow tool: ${name}`
            }],
            isError: true
        };

    } catch (error: any) {
        console.error(`Error in workflow tool ${name}:`, error);
        return {
            content: [{
                type: "text",
                text: `Error: ${error.message}\n\nStack: ${error.stack}`
            }],
            isError: true
        };
    }
}
