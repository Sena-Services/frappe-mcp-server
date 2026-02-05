/**
 * Registry Operations for MCP Server
 * Tools for discovering and installing modules from the central Sena Registry
 *
 * These tools allow the Express Builder's Planner to:
 * 1. Search for existing modules before building custom
 * 2. Check if capabilities exist in the registry
 * 3. Install modules from registry
 * 4. Check installation status
 */

import { createFrappeClient, FrappeClientConfig, callMethod } from "./frappe-api.js";
import { CallToolRequest, Tool } from "@modelcontextprotocol/sdk/types.js";

export const REGISTRY_TOOLS: Tool[] = [
    {
        name: "search_registry",
        description: "Search the Sena Registry for available modules, agents, or workflows. Use this BEFORE creating custom DocTypes to check if a pre-built solution exists.",
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Search term (e.g., 'CRM', 'HR', 'inventory', 'invoice')"
                },
                item_type: {
                    type: "string",
                    description: "Filter by type: 'Module', 'Agent', or 'Workflow' (optional)",
                    enum: ["Module", "Agent", "Workflow"]
                }
            }
        }
    },
    {
        name: "get_registry_item_details",
        description: "Get detailed information about a specific registry item including description, type, installation status, and app_profile (if available).",
        inputSchema: {
            type: "object",
            properties: {
                item_name: {
                    type: "string",
                    description: "The name/title of the registry item"
                }
            },
            required: ["item_name"]
        }
    },
    {
        name: "check_capability_in_registry",
        description: "Check if a capability/feature exists in the registry. AI-friendly search that matches user intent to available solutions. Use this when user requests business domains like CRM, HR, Helpdesk, etc.",
        inputSchema: {
            type: "object",
            properties: {
                capability: {
                    type: "string",
                    description: "Natural language description of needed capability (e.g., 'track employee leave', 'manage invoices', 'CRM sales pipeline')"
                }
            },
            required: ["capability"]
        }
    },
    {
        name: "get_registry_installed_apps",
        description: "Get list of apps currently installed on this site compared to what's available in the registry.",
        inputSchema: {
            type: "object",
            properties: {}
        }
    },
    {
        name: "import_app",
        description: "Install an app from the registry. Queues the installation which runs asynchronously. Use get_install_status to check progress.",
        inputSchema: {
            type: "object",
            properties: {
                app_name: {
                    type: "string",
                    description: "The app name to install (e.g., 'hrms', 'crm', 'helpdesk')"
                },
                repo_url: {
                    type: "string",
                    description: "Optional custom repository URL (uses default if not provided)"
                }
            },
            required: ["app_name"]
        }
    },
    {
        name: "get_install_status",
        description: "Check the installation status of an app. Returns progress, status (queued, downloading, installing, completed, failed), and any error messages.",
        inputSchema: {
            type: "object",
            properties: {
                app_name: {
                    type: "string",
                    description: "The app name to check status for"
                }
            },
            required: ["app_name"]
        }
    }
];

/**
 * Handler function for Registry operation tool calls
 * @param request - MCP request object
 * @param credentials - Site-specific credentials (url, api_key, api_secret)
 */
export async function handleRegistryOperationsToolCall(request: CallToolRequest, credentials?: FrappeClientConfig): Promise<any> {
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
        console.error(`Handling Registry operation tool: ${name} with args:`, args);

        // Helper function to extract success from Frappe API response
        const getSuccess = (result: any): boolean => {
            return result?.message?.success ?? result?.success ?? false;
        };

        if (name === "search_registry") {
            const result = await callMethod(
                client,
                "sena_backend.api.registry.search_registry",
                {
                    query: args?.query || "",
                    item_type: args?.item_type || null
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

        if (name === "get_registry_item_details") {
            if (!args || !args.item_name) {
                throw new Error("Missing required argument: item_name");
            }

            const result = await callMethod(
                client,
                "sena_backend.api.registry.get_registry_item_details",
                {
                    item_name: args.item_name
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

        if (name === "check_capability_in_registry") {
            if (!args || !args.capability) {
                throw new Error("Missing required argument: capability");
            }

            const result = await callMethod(
                client,
                "sena_backend.api.registry.check_capability_in_registry",
                {
                    capability: args.capability
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

        if (name === "get_registry_installed_apps") {
            const result = await callMethod(
                client,
                "sena_backend.api.registry.get_registry_installed_apps",
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

        if (name === "import_app") {
            if (!args || !args.app_name) {
                throw new Error("Missing required argument: app_name");
            }

            const result = await callMethod(
                client,
                "sena_backend.api.registry.import_app",
                {
                    app_name: args.app_name,
                    repo_url: args.repo_url || null
                }
            );

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(result, null, 2)
                }],
                isError: false  // Queued is a valid state, not an error
            };
        }

        if (name === "get_install_status") {
            if (!args || !args.app_name) {
                throw new Error("Missing required argument: app_name");
            }

            const result = await callMethod(
                client,
                "sena_backend.api.registry.get_install_status",
                {
                    app_name: args.app_name
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

        return {
            content: [{
                type: "text",
                text: `Unknown Registry operations tool: ${name}`
            }],
            isError: true
        };

    } catch (error: any) {
        console.error(`Error in Registry operations tool ${name}:`, error);
        return {
            content: [{
                type: "text",
                text: `Error: ${error.message}\n\nStack: ${error.stack}`
            }],
            isError: true
        };
    }
}
