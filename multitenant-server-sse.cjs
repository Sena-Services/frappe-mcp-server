#!/usr/bin/env node

/**
 * Multi-Tenant MCP Server with SSE Support
 * Handles multiple Frappe sites from a single process with SSE transport
 */

const express = require('express');
const fs = require('fs');

const SITES_CONFIG_PATH = process.env.SITES_CONFIG_PATH || '/home/SenaERP/bench/mcp-sites.json';
const MCP_PORT = parseInt(process.env.MCP_PORT || '4000', 10);

// Load sites configuration
function loadSitesConfig() {
    try {
        if (!fs.existsSync(SITES_CONFIG_PATH)) {
            console.error(`Sites config not found at ${SITES_CONFIG_PATH}, creating empty config...`);
            fs.writeFileSync(SITES_CONFIG_PATH, JSON.stringify({ sites: {} }, null, 2));
            return { sites: {} };
        }

        const configData = fs.readFileSync(SITES_CONFIG_PATH, 'utf8');
        const config = JSON.parse(configData);
        console.log(`Loaded configuration for ${Object.keys(config.sites || {}).length} sites`);
        return config;
    } catch (error) {
        console.error(`Error loading sites config: ${error.message}`);
        return { sites: {} };
    }
}

// Reload sites configuration periodically
let sitesConfig = loadSitesConfig();
setInterval(() => {
    sitesConfig = loadSitesConfig();
}, 30000); // Reload every 30 seconds

const app = express();
app.use(express.json());

// Import frappe-mcp-server library
let mcpLibrary;

// Health check endpoint
app.get('/health', (req, res) => {
    const siteCount = Object.keys(sitesConfig.sites || {}).length;
    res.json({
        status: 'healthy',
        sites: siteCount,
        timestamp: new Date().toISOString()
    });
});

// List configured sites
app.get('/sites', (req, res) => {
    const sites = Object.keys(sitesConfig.sites || {});
    res.json({ sites });
});

// SSE endpoint for MCP protocol
app.post(['/mcp', '/mcp/:siteName'], async (req, res) => {
    // Get site name from URL param, header, or body
    const siteName = req.params.siteName || req.headers['x-frappe-site-name'] || req.body.siteName;

    if (!siteName) {
        return res.status(400).json({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message: 'Missing site name in URL, X-Frappe-Site-Name header, or siteName in body'
            },
            id: null
        });
    }

    const siteConfig = sitesConfig.sites[siteName];

    if (!siteConfig) {
        console.error(`Site not found in config: ${siteName}`);
        return res.status(404).json({
            jsonrpc: '2.0',
            error: {
                code: -32001,
                message: `Site not found: ${siteName}`
            },
            id: null
        });
    }

    console.log(`Processing MCP request for site: ${siteName}`);

    try {
        const mcpRequest = req.body;

        // Handle initialize
        if (mcpRequest.method === 'initialize') {
            return res.json({
                jsonrpc: '2.0',
                result: {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        tools: {}
                    },
                    serverInfo: {
                        name: 'frappe-mcp-server',
                        version: '0.2.16'
                    }
                },
                id: mcpRequest.id
            });
        }

        // Handle tools/list
        if (mcpRequest.method === 'tools/list') {
            const tools = mcpLibrary.listTools();
            return res.json({
                jsonrpc: '2.0',
                result: { tools },
                id: mcpRequest.id
            });
        }

        // Handle tools/call
        if (mcpRequest.method === 'tools/call') {
            const { name, arguments: args } = mcpRequest.params;

            // Execute tool with site-specific credentials
            const result = await mcpLibrary.executeTool(name, args, {
                url: siteConfig.url,
                api_key: siteConfig.api_key,
                api_secret: siteConfig.api_secret
            });

            return res.json({
                jsonrpc: '2.0',
                result: result,
                id: mcpRequest.id
            });
        }

        // Unknown method
        return res.status(400).json({
            jsonrpc: '2.0',
            error: {
                code: -32601,
                message: `Unknown method: ${mcpRequest.method}`
            },
            id: mcpRequest.id
        });

    } catch (error) {
        console.error(`Error processing MCP request:`, error);
        return res.status(500).json({
            jsonrpc: '2.0',
            error: {
                code: -32603,
                message: error.message || 'Internal server error',
                data: error.stack
            },
            id: req.body.id || null
        });
    }
});

// Start server
async function startServer() {
    try {
        console.log('Loading frappe-mcp-server library...');
        mcpLibrary = await import('./build/library.js');
        console.log('Successfully loaded frappe-mcp-server library');

        const server = app.listen(MCP_PORT, '127.0.0.1', () => {
            console.log(`Multi-Tenant MCP Server listening on http://127.0.0.1:${MCP_PORT}`);
            console.log(`Sites config: ${SITES_CONFIG_PATH}`);
            console.log(`Configured sites: ${Object.keys(sitesConfig.sites || {}).length}`);
        });

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('Shutting down Multi-Tenant MCP Server...');
            server.close();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            console.log('Received SIGTERM, shutting down...');
            server.close();
            process.exit(0);
        });
    } catch (error) {
        console.error('Failed to load frappe-mcp-server library:', error);
        process.exit(1);
    }
}

startServer();
