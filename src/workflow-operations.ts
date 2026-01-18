/**
 * Workflow Operations for MCP Server
 * Allows AI agents to create and manage BL Blueprints (business logic workflows)
 *
 * All implementation delegated to builder/tools/workflow_tools.py
 */

import { CallToolRequest, Tool } from "@modelcontextprotocol/sdk/types.js";
import { createFrappeClient, FrappeClientConfig, callMethod } from "./frappe-api.js";
import { FrappeApp } from "frappe-js-sdk";

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
                    description: "JSON string array of trigger definitions. For doc_event triggers: {\"doctype\": \"X\", \"event\": \"after_insert\"}. For schedule triggers: {\"trigger_type\": \"schedule\", \"cron\": \"0 9 * * *\"} (no doctype needed)"
                },
                actions: {
                    type: "string",
                    description: "JSON string array of action definitions. Each action is an object like {\"action_name\": {params}}. For complex nested logic, use @group_name references and define groups in action_groups parameter."
                },
                action_groups: {
                    type: "string",
                    description: "JSON string object mapping group names to action arrays. Use for complex nested IF/SWITCH logic. Example: {\"handle_bug\": [{\"send_notification\": {...}}]}. Reference groups in actions using \"@group_name\" strings."
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
        description: `Get all valid trigger event types for blueprint triggers. Returns events grouped by type.

RETURNS:
- doc_events: Document lifecycle events (after_insert, on_update, before_save, on_submit, on_cancel, on_trash, etc.)
- schedule_triggers: Time-based triggers (cron expressions)
- tool_triggers: Manual/API triggers
- common_events: Most frequently used events

TRIGGER FORMATS in blueprints:
1. Doc event: {"doctype": "Customer", "event": "after_insert"}
2. Schedule: {"trigger_type": "schedule", "cron": "0 9 * * *", "timezone": "Asia/Kolkata"} (timezone optional, no doctype needed)

COMMON EVENTS:
- after_insert: After new document is created and saved
- on_update: After existing document is modified
- before_save: Before document is saved (can modify values)
- on_submit: After document is submitted (for submittable DocTypes)
- on_trash: Before document is deleted`,
        inputSchema: {
            type: "object",
            properties: {}
        }
    },
    {
        name: "get_available_actions",
        description: `Get all valid action types for blueprint actions with full schema and syntax documentation.

RETURNS:
- by_category: Actions grouped by category (CRUD, Conditional, Communication, AI, Vendor, etc.)
- required_params: Required parameters for each action
- schemas: Full parameter schema for each action (types, descriptions, defaults)
- syntax_docs: Extended syntax documentation for complex actions (IMPORTANT - contains condition format!)

SYNTAX_DOCS includes (check 'if' and 'switch' actions):
- Condition format: ["field", "operator", "value"]
- Operators: ==, !=, >, <, >=, <=, in, not_in, is_empty, is_not_empty
- Compound conditions: {"AND": [...]} and {"OR": [...]}
- Nested conditions: {"AND": [[...], {"OR": [[...], [...]]}]}
- Interpolation: {{doc.field}}, {{context.var}}, {{doc.link_field.subfield}}, {{now}}

ACTION FORMAT in blueprints:
{"action_name": {"param1": "value1", "param2": "value2"}}

COMMON ACTIONS:
- create_document: Create new document {"doctype": "X", "fields": {...}}
- update_document: Update existing {"doctype": "X", "name": "Y", "fields": {...}}
- if: Conditional branching {"condition": [...], "then": [...], "else": [...]}
- switch: Multi-branch (exact value matching only, NOT for numeric comparisons)
- send_whatsapp_message: Send WhatsApp {"to": "phone", "message": "text"}
- ai_agent: Invoke AI agent {"agent_name": "X", "input": "prompt"}

IMPORTANT: Always call this tool before creating blueprints to get current action schemas and condition syntax.`,
        inputSchema: {
            type: "object",
            properties: {}
        }
    },
    {
        name: "get_available_ai_agents",
        description: "Get list of available AI Agents from AI Agent DocType. Use this when creating blueprints with ai_agent action to find appropriate agents. Returns categorized list of enabled agents (user_agents, system_agents, worker_agents, whatsapp_agents).",
        inputSchema: {
            type: "object",
            properties: {}
        }
    }
];

/**
 * Handle workflow tool calls
 * All implementation delegated to sena_backend.builder.tools.workflow_tools
 * @param request - MCP request object
 * @param credentials - Site-specific credentials (url, api_key, api_secret)
 */
export async function handleWorkflowToolCall(request: CallToolRequest, credentials?: FrappeClientConfig): Promise<any> {
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
        console.error(`Handling workflow tool: ${name} with args:`, args);

        // Helper function to extract success from Frappe API response
        // Frappe returns { message: { success: true/false, ... } }
        const getSuccess = (result: any): boolean => {
            return result?.message?.success ?? result?.success ?? false;
        };

        /**
         * Validate JSON string and return detailed error with fix suggestions
         */
        const validateJsonWithHelp = (jsonStr: string, fieldName: string): { valid: boolean; error?: string; suggestion?: string } => {
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
        };

        // All workflow tools delegate to builder/tools/workflow_tools.py
        if (name === "create_blueprint") {
            if (!args || !args.name || !args.triggers || !args.actions) {
                throw new Error("Missing required arguments: name, triggers, and actions are required");
            }

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
                            fix_hint: "Doc event triggers: [{\"doctype\": \"DocTypeName\", \"event\": \"after_insert\"}]. Schedule triggers: [{\"trigger_type\": \"schedule\", \"cron\": \"0 9 * * *\"}]"
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
                            fix_hint: "Each action needs proper closing: {\"action_name\": {\"param\": \"value\"}} - note the TWO closing braces }}"
                        }, null, 2)
                    }],
                    isError: true
                };
            }

            const result = await callMethod(client,
                "sena_backend.builder.tools.workflow_tools.create_blueprint_util",
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
                isError: !getSuccess(result)
            };
        }

        if (name === "read_blueprint") {
            if (!args || !args.blueprint_id) {
                throw new Error("Missing required argument: blueprint_id");
            }

            const result = await callMethod(client,
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

        if (name === "update_blueprint") {
            if (!args || !args.blueprint_id) {
                throw new Error("Missing required argument: blueprint_id");
            }

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
                                suggestion: actionsValidation.suggestion
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
            }

            const result = await callMethod(client,
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

        if (name === "delete_blueprint") {
            if (!args || !args.blueprint_id) {
                throw new Error("Missing required argument: blueprint_id");
            }

            const result = await callMethod(client,
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

        if (name === "list_blueprints") {
            const result = await callMethod(client,
                "sena_backend.builder.tools.workflow_tools.list_blueprints_util",
                {
                    filters: args?.filters || null
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

        if (name === "validate_blueprint") {
            if (!args || !args.blueprint_json) {
                throw new Error("Missing required argument: blueprint_json");
            }

            const result = await callMethod(client,
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

        if (name === "get_available_events") {
            const result = await callMethod(client,
                "sena_backend.builder.tools.workflow_tools.get_available_events_util",
                {}
            );

            // Helper tools return data directly - check for message.success or assume success if data exists
            const hasSuccess = result?.message?.success ?? result?.success ?? (result?.events || result?.message?.events);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                }],
                isError: !hasSuccess
            };
        }

        if (name === "get_available_actions") {
            const result = await callMethod(client,
                "sena_backend.builder.tools.workflow_tools.get_available_actions_util",
                {}
            );

            // Helper tools return data directly - check for message.success or assume success if data exists
            const hasSuccess = result?.message?.success ?? result?.success ?? (result?.actions || result?.message?.actions);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                }],
                isError: !hasSuccess
            };
        }

        if (name === "get_available_ai_agents") {
            const result = await callMethod(client,
                "sena_backend.builder.tools.workflow_tools.get_available_ai_agents_util",
                {}
            );

            // Helper tools return data directly - check for message.success or assume success if data exists
            const hasSuccess = result?.message?.success ?? result?.success ?? (result?.agents || result?.message?.agents);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                }],
                isError: !hasSuccess
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
