#!/usr/bin/env node
import express from 'express';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequest, CallToolRequestSchema, ListToolsRequestSchema, Tool, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { DOCUMENT_TOOLS, handleDocumentToolCall } from "./document-operations.js";
import { SCHEMA_TOOLS, setupSchemaTools, handleSchemaToolCall } from "./schema-operations.js";
import { HELPER_TOOLS } from "./frappe-instructions.js";
import { handleHelperToolCall } from "./index-helpers.js";
import { BLUEPRINT_TOOLS, handleBlueprintToolCall } from "./blueprint-operations.js";
import { DOCTYPE_OPERATIONS_TOOLS, handleDoctypeOperationsToolCall } from "./doctype-operations.js";
import { WORKFLOW_TOOLS, handleWorkflowToolCall } from "./workflow-operations.js";
import { validateApiCredentials } from './auth.js';
import { isJSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";

function createMcpServer(): Server {
    const mcpServer = new Server(
        { name: "frappe-mcp-server", version: "0.2.16" },
        { capabilities: { resources: {}, tools: {} } }
    );

    setupSchemaTools(mcpServer);
    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
        console.error("MCP Test: 'list_tools' request handler was triggered inside createMcpServer.");
        const tools = [
        ...DOCUMENT_TOOLS, ...SCHEMA_TOOLS, ...HELPER_TOOLS, ...BLUEPRINT_TOOLS, ...DOCTYPE_OPERATIONS_TOOLS, ...WORKFLOW_TOOLS, { name: "ping", description: "A simple tool to check if the server is responding.", inputSchema: { type: "object", properties: {} } }] as Tool[];
        return { tools };
    });
    mcpServer.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
        const { name } = request.params;
        console.error(`Received tool call for: ${name}`);
        if (DOCUMENT_TOOLS.find(tool => tool.name === name)) return await handleDocumentToolCall(request);
        if (SCHEMA_TOOLS.find(tool => tool.name === name)) return await handleSchemaToolCall(request);
        if (HELPER_TOOLS.find(tool => tool.name === name)) return await handleHelperToolCall(request);
        if (BLUEPRINT_TOOLS.find(tool => tool.name === name)) return await handleBlueprintToolCall(request);
        if (DOCTYPE_OPERATIONS_TOOLS.find(tool => tool.name === name)) return await handleDoctypeOperationsToolCall(request);
        if (WORKFLOW_TOOLS.find(tool => tool.name === name)) return await handleWorkflowToolCall(request);
        if (name === "ping") return { content: [{ type: "text", text: "pong" }], isError: false };
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    });
    return mcpServer;
}

async function main() {
    console.error("Starting Frappe MCP server in HTTP mode...");
    validateApiCredentials();

    const app = express();

    // Add a logging middleware at the very top
    app.use((req, res, next) => {
        console.error(`MCP Test: Incoming request: ${req.method} ${req.url}`);
        next();
    });

    app.use(express.json());

    app.post('/mcp', async (req, res) => {
      // In stateless mode, create a new instance of transport and server for each request
      // to ensure complete isolation. A single instance would cause request ID collisions
      // when multiple clients connect concurrently.
      console.error("MCP Test: Received POST request on /mcp. Body:", JSON.stringify(req.body, null, 2));
      try {
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on('close', () => {
          console.log('Request closed');
          transport.close();
          server.close();
        });
        await server.connect(transport);

        // Wrap the onmessage to log when the server dispatcher is called
        const originalOnMessage = transport.onmessage;
        transport.onmessage = (message, extra) => {
            if (isJSONRPCRequest(message)) {
                console.error("MCP Test: transport.onmessage is being called. This means the server dispatcher is about to run for method:", message.method);
            }
            if (originalOnMessage) {
                originalOnMessage(message, extra);
            }
        };

        console.error("MCP Test: About to call transport.handleRequest");
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    });
    
    app.get('/mcp', async (req, res) => {
      console.log('Received GET MCP request');
      res.writeHead(405).end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed."
        },
        id: null
      }));
    });
    
    app.delete('/mcp', async (req, res) => {
      console.log('Received DELETE MCP request');
      res.writeHead(405).end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed."
        },
        id: null
      }));
    });

    const port = parseInt(process.env.MCP_PORT || '4000', 10);
    const server = app.listen(port, '127.0.0.1', () => {
        console.error(`Frappe MCP server listening on http://127.0.0.1:${port}`);
    });

    process.on("SIGINT", () => {
        console.error("Shutting down Frappe MCP server...");
        server.close();
        process.exit(0);
    });
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
