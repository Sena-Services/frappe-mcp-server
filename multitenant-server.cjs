#!/usr/bin/env node

/**
 * Multi-Tenant MCP Server with Session Management
 * Architecture:
 * - ONE MCP Server instance (reused across all sessions)
 * - MULTIPLE Transports (one per session, cached)
 * - Per-site config from site_config.json (5-minute cache, no polling)
 */

const express = require('express');
const { randomUUID } = require('crypto');

// Environment variables (required)
const MCP_PORT = parseInt(process.env.MCP_PORT, 10);
const SITES_CONFIG_PATH = process.env.SITES_CONFIG_PATH;

// Validate required environment variables
if (!MCP_PORT || isNaN(MCP_PORT)) {
  console.error('ERROR: MCP_PORT environment variable is required');
  process.exit(1);
}

if (!SITES_CONFIG_PATH) {
  console.error('ERROR: SITES_CONFIG_PATH environment variable is required');
  console.error('Example: export SITES_CONFIG_PATH=/home/SenaERP/bench/mcp-sites.json');
  process.exit(1);
}

const app = express();
app.use(express.json());

// Import components
let mcpLibrary, Server, StreamableHTTPServerTransport, ListToolsRequestSchema, CallToolRequestSchema;
let ConfigManager, configManager;

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================
// Session map: { "siteName:sessionId" → { transport, tenant, created } }
const sessions = {};

// Session cleanup interval (every 5 minutes)
const SESSION_TTL = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// MCP SERVER INSTANCE (ONE GLOBAL INSTANCE, REUSED)
// ============================================================================
let mcpServer = null;

/**
 * Initialize global MCP server (called once on startup)
 */
function initializeMCPServer() {
  if (mcpServer) return mcpServer;

  console.log('[MCP] Initializing global MCP server instance...');

  mcpServer = new Server(
    { name: 'frappe-mcp-server', version: '0.2.16' },
    { capabilities: { tools: {} } }
  );

  // Register handlers (once, globally)
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = mcpLibrary.listTools();
    return { tools };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    // Get credentials from authInfo (passed via req.auth by the transport)
    const credentials = extra?.authInfo?.credentials;

    if (!credentials) {
      console.error('[MCP] ERROR: No credentials found in authInfo!');
      console.error('[MCP] extra.authInfo:', extra?.authInfo);
      console.error('[MCP] extra.sessionId:', extra?.sessionId);
      throw new Error('No credentials found in request context');
    }

    console.log(`[MCP] Executing tool: ${name} for site: ${extra?.authInfo?.siteName}`);
    return await mcpLibrary.executeTool(name, args, credentials);
  });

  console.log('[MCP] Global MCP server initialized');
  return mcpServer;
}

/**
 * Helper to check if request is an initialize request
 */
function isInitializeRequest(body) {
  return body && body.method === 'initialize';
}

// ============================================================================
// HEALTH CHECK ENDPOINTS
// ============================================================================

app.get('/health', async (req, res) => {
  try {
    const cacheStats = configManager.getCacheStats();
    const availableSites = await configManager.listAvailableSites();

    res.json({
      status: 'healthy',
      sessions: Object.keys(sessions).length,
      cachedConfigs: cacheStats.cachedSites,
      availableSites: availableSites.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

app.get('/sites', async (req, res) => {
  try {
    const sites = await configManager.listAvailableSites();
    const cacheStats = configManager.getCacheStats();

    res.json({
      availableSites: sites,
      cachedSites: cacheStats.sites
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get('/sessions', (req, res) => {
  const sessionList = Object.entries(sessions).map(([key, session]) => ({
    key,
    tenant: session.tenant,
    age: Date.now() - session.created
  }));

  res.json({
    total: sessionList.length,
    sessions: sessionList
  });
});

// ============================================================================
// MAIN MCP ENDPOINT WITH SESSION MANAGEMENT
// ============================================================================

app.post(['/mcp', '/mcp/:siteName'], async (req, res) => {
  // Step 1: Identify tenant (required BEFORE session)
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

  console.log(`[MCP] Processing request for site: ${siteName}`);

  try {
    // Step 2: Get tenant credentials from ConfigManager
    const siteConfig = await configManager.getConfig(siteName);

    const credentials = {
      url: siteConfig.url,
      api_key: siteConfig.api_key,
      api_secret: siteConfig.api_secret
    };

    // Step 3: Handle session
    const sessionId = req.headers['mcp-session-id'];
    const cacheKey = sessionId ? `${siteName}:${sessionId}` : null;

    let session;

    if (cacheKey && sessions[cacheKey]) {
      // CASE A: Reuse existing session (FAST PATH)
      console.log(`[MCP] Reusing session: ${cacheKey}`);
      session = sessions[cacheKey];

      // Update credentials in session (in case they changed)
      session.credentials = credentials;
    }
    else if (!sessionId && isInitializeRequest(req.body)) {
      // CASE B: Create new session
      console.log(`[MCP] Creating new session for site: ${siteName}`);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newSessionId) => {
          const key = `${siteName}:${newSessionId}`;
          console.log(`[MCP] Session initialized: ${key}`);

          sessions[key] = {
            transport,
            tenant: siteName,
            created: Date.now(),
            credentials
          };
        }
      });

      // Handle transport cleanup
      transport.onclose = () => {
        if (transport.sessionId) {
          const key = `${siteName}:${transport.sessionId}`;
          console.log(`[MCP] Transport closed, cleaning up session: ${key}`);
          delete sessions[key];
        }
      };

      // Connect transport to global MCP server
      await mcpServer.connect(transport);

      session = {
        transport,
        tenant: siteName,
        created: Date.now(),
        credentials
      };
    }
    else if (sessionId && !sessions[cacheKey]) {
      // CASE C: Invalid session (session expired or doesn't exist)
      console.error(`[MCP] Invalid session ID: ${sessionId} for site: ${siteName}`);
      return res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Invalid or expired session. Please initialize a new session.'
        },
        id: req.body.id || null
      });
    }
    else {
      // CASE D: Missing session ID for non-initialize request
      console.error(`[MCP] Missing session ID for non-initialize request`);
      return res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Session ID required. Please initialize a session first.'
        },
        id: req.body.id || null
      });
    }

    // Step 4: Set credentials in req.auth so the transport can pass them to the handler
    req.auth = {
      credentials,
      siteName
    };

    // Step 5: Handle request with the transport
    await session.transport.handleRequest(req, res, req.body);

  } catch (error) {
    console.error(`[MCP] Error processing request:`, error);

    if (!res.headersSent) {
      res.status(error.message.includes('not found') ? 404 : 500).json({
        jsonrpc: '2.0',
        error: {
          code: error.message.includes('not found') ? -32001 : -32603,
          message: error.message || 'Internal server error',
          data: error.stack
        },
        id: req.body?.id || null
      });
    }
  }
});

// ============================================================================
// SESSION CLEANUP JOB
// ============================================================================

function cleanupExpiredSessions() {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [key, session] of Object.entries(sessions)) {
    const age = now - session.created;

    if (age > SESSION_TTL) {
      console.log(`[MCP] Cleaning up expired session: ${key} (age: ${Math.round(age / 1000)}s)`);

      try {
        session.transport.close();
      } catch (error) {
        console.error(`[MCP] Error closing transport for ${key}:`, error.message);
      }

      delete sessions[key];
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`[MCP] Cleaned up ${cleanedCount} expired session(s)`);
  }
}

// ============================================================================
// CONFIG INVALIDATION ENDPOINT (WEBHOOK FOR FUTURE)
// ============================================================================

app.post('/config/invalidate/:siteName', (req, res) => {
  const siteName = req.params.siteName;

  if (!siteName) {
    return res.status(400).json({ error: 'Missing site name' });
  }

  configManager.invalidateCache(siteName);

  res.json({
    success: true,
    message: `Cache invalidated for site: ${siteName}`
  });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

async function startServer() {
  try {
    console.log('[MCP] Loading frappe-mcp-server library...');

    // Import library
    mcpLibrary = await import('./build/library.js');

    // Import MCP SDK components
    const sdkServer = await import('@modelcontextprotocol/sdk/server/index.js');
    const sdkStreamable = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const sdkTypes = await import('@modelcontextprotocol/sdk/types.js');

    Server = sdkServer.Server;
    StreamableHTTPServerTransport = sdkStreamable.StreamableHTTPServerTransport;
    ListToolsRequestSchema = sdkTypes.ListToolsRequestSchema;
    CallToolRequestSchema = sdkTypes.CallToolRequestSchema;

    // Import and initialize ConfigManager
    const configModule = await import('./build/config-manager.js');
    ConfigManager = configModule.ConfigManager;
    configManager = new ConfigManager(SITES_CONFIG_PATH);

    console.log('[MCP] Successfully loaded frappe-mcp-server library');

    // Initialize global MCP server
    initializeMCPServer();

    // Start session cleanup job
    setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL);
    console.log(`[MCP] Session cleanup job started (interval: ${CLEANUP_INTERVAL / 1000}s, TTL: ${SESSION_TTL / 1000}s)`);

    // Start HTTP server
    const server = app.listen(MCP_PORT, '127.0.0.1', () => {
      console.log(`[MCP] Multi-Tenant MCP Server listening on http://127.0.0.1:${MCP_PORT}`);
      console.log(`[MCP] Config path: ${SITES_CONFIG_PATH}`);
      console.log(`[MCP] Architecture: Session-based with transport caching`);
    });

    // Graceful shutdown
    const shutdown = () => {
      console.log('[MCP] Shutting down Multi-Tenant MCP Server...');

      // Close all sessions
      for (const [key, session] of Object.entries(sessions)) {
        try {
          session.transport.close();
        } catch (error) {
          console.error(`[MCP] Error closing session ${key}:`, error.message);
        }
      }

      // Close MCP server
      if (mcpServer) {
        try {
          mcpServer.close();
        } catch (error) {
          console.error('[MCP] Error closing MCP server:', error.message);
        }
      }

      server.close(() => {
        console.log('[MCP] Server closed');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error('[MCP] Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
