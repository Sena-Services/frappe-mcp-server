/**
 * UI Operations for MCP Server
 * Tools for UI preview configuration management
 *
 * These tools are specific to Express Builder / Sentra Core for managing
 * UI preview configurations programmatically via AI agents.
 *
 * MCP calls these methods:
 * - sena_backend.builder.ui_agent.get_preview_config
 * - sena_backend.builder.ui_agent.update_preview_config_util
 */

import { CallToolRequest, Tool } from "@modelcontextprotocol/sdk/types.js";
import { callMethod, createFrappeClient, FrappeClientConfig } from "./frappe-api.js";

export const UI_TOOLS: Tool[] = [
    {
        name: "get_preview_config",
        description: "Get the UI preview configuration for a specific page. Use this to fetch the current UI layout configuration before making edits.",
        inputSchema: {
            type: "object",
            properties: {
                page_id: {
                    type: "string",
                    description: "Unique ID for the page (e.g., 'schools', 'bug-tracker-dashboard', 'travel-dashboard-analytics')"
                }
            },
            required: ["page_id"]
        }
    },
    {
        name: "update_preview_config",
        description: "Create or update a UI preview configuration for a specific page. Use this to save UI layouts, component configurations, and preview settings. ALWAYS fetch the existing config first using get_preview_config before updating.",
        inputSchema: {
            type: "object",
            properties: {
                page_id: {
                    type: "string",
                    description: "Unique ID for the page being configured (e.g., 'schools', 'products', 'dashboard')"
                },
                config_json: {
                    type: "string",
                    description: "JSON string containing the complete UI configuration for the page"
                }
            },
            required: ["page_id", "config_json"]
        }
    }
];

/**
 * Handle UI tool calls
 * @param request - MCP request object
 * @param credentials - Site-specific credentials (url, api_key, api_secret)
 */
export async function handleUIToolCall(request: CallToolRequest, credentials?: FrappeClientConfig): Promise<any> {
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
        console.error(`Handling UI tool: ${name} with args:`, args);

        if (name === "get_preview_config") {
            if (!args || !args.page_id) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ success: false, error: "Missing required argument: page_id" }) }],
                    isError: true
                };
            }

            const result = await callMethod(
                client,
                "sena_backend.builder.ui_agent.get_preview_config",
                {
                    page_id: args.page_id
                }
            );

            const data = result?.message || result;
            return {
                content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
                isError: !data?.success
            };
        }

        if (name === "update_preview_config") {
            if (!args || !args.page_id || !args.config_json) {
                return {
                    content: [{ type: "text", text: JSON.stringify({ success: false, error: "Missing required arguments: page_id and config_json are required" }) }],
                    isError: true
                };
            }

            const result = await callMethod(
                client,
                "sena_backend.builder.ui_agent.update_preview_config_util",
                {
                    page_id: args.page_id,
                    config_json: args.config_json
                }
            );

            const data = result?.message || result;
            return {
                content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
                isError: !data?.success
            };
        }

        return {
            content: [{ type: "text", text: `Unknown UI tool: ${name}` }],
            isError: true
        };

    } catch (error) {
        console.error(`Error in UI tool ${name}:`, error);
        return {
            content: [{
                type: "text",
                text: `Error executing ${name}: ${(error as Error).message}`
            }],
            isError: true
        };
    }
}
