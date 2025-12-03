# Frappe MCP Server

A Model Context Protocol (MCP) server for Frappe Framework that exposes Frappe's functionality to AI assistants through the official REST API, with a focus on document CRUD operations, schema handling, and detailed API instructions.

## Overview

This MCP server allows AI assistants to interact with Frappe applications through a standardized interface using the official Frappe REST API. It provides tools for:

- Document operations (create, read, update, delete, list)
- Schema and metadata handling
- DocType discovery and exploration
- Detailed API usage instructions and examples

The server includes comprehensive error handling, validation, and helpful responses to make it easier for AI assistants to work with Frappe.

## Installation

### Prerequisites

- Node.js 18 or higher
- A running Frappe instance (version 15 or higher)
- API key and secret from Frappe (**required**)

### Setup

1. Install via npm:

```bash
npm install -g frappe-mcp-server
```

Alternatively, run directly with npx:

```bash
npx frappe-mcp-server
```

## Configuration

The server uses a multi-tenant configuration file (`mcp-sites.json`) to manage credentials for one or more Frappe sites.

### Required Environment Variables

- `MCP_PORT`: Port to run the server on (default: `4000`)
- `SITES_CONFIG_PATH`: Path to the `mcp-sites.json` configuration file

### Site Configuration File

Create a `mcp-sites.json` file with your Frappe site credentials:

```json
{
  "sites": {
    "localhost": {
      "url": "http://localhost:8000",
      "api_key": "your_api_key",
      "api_secret": "your_api_secret"
    },
    "production.example.com": {
      "url": "https://production.example.com",
      "api_key": "your_api_key",
      "api_secret": "your_api_secret"
    }
  }
}
```

### Getting API Credentials

To get API credentials from your Frappe instance:

1. Go to User > API Access > New API Key
2. Select the user for whom you want to create the key
3. Click "Generate Keys"
4. Copy the API Key and API Secret

## Usage

### Starting the Server

```bash
MCP_PORT=4000 \
SITES_CONFIG_PATH=/path/to/mcp-sites.json \
node mcp-server.cjs
```

Or using npm scripts:

```bash
npm start
```

### Server Features

- **Multi-tenant support**: Each site has isolated credentials and sessions
- **Session management**: Persistent sessions across requests for better performance
- **Config caching**: 5-minute cache with on-demand loading (no polling)
- **Health endpoints**: `/health`, `/sites`, `/sessions` for monitoring

### API Endpoints

- `POST /mcp/:siteName` - Main MCP endpoint (siteName in URL)
- `POST /mcp` - Main MCP endpoint (siteName in `X-Frappe-Site-Name` header)
- `GET /health` - Health check
- `GET /sites` - List available sites
- `GET /sessions` - List active sessions

### Making Requests

Specify the site in one of these ways:
1. **URL parameter**: `POST /mcp/localhost`
2. **Header**: `X-Frappe-Site-Name: localhost`

Example with curl:
```bash
curl -X POST http://localhost:4000/mcp/localhost \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "params": {...}, "id": 1}'
```

### Integrating with LangChain/LangGraph

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

client = MultiServerMCPClient({
    "frappe": {
        "transport": "streamable_http",
        "url": "http://127.0.0.1:4000/mcp",
        "headers": {"X-Frappe-Site-Name": "localhost"}
    }
})

tools = await client.get_tools()
```

### Integrating with Google ADK

```python
from google.adk.tools.mcp_tool import MCPToolset, StreamableHTTPConnectionParams

toolset = MCPToolset(
    connection_params=StreamableHTTPConnectionParams(
        url="http://127.0.0.1:4000/mcp",
        headers={
            "X-Frappe-Site-Name": "localhost",
            "Authorization": "token api_key:api_secret"
        }
    )
)

tools = await toolset.get_tools()
```

## Available Tools

### Document Operations

- `create_document`: Create a new document in Frappe
- `get_document`: Retrieve a document from Frappe
- `update_document`: Update an existing document in Frappe
- `delete_document`: Delete a document from Frappe
- `list_documents`: List documents from Frappe with filters
- `call_method`: Execute a whitelisted Frappe method

### Schema Operations

- `get_doctype_schema`: Get the complete schema for a DocType including field definitions, validations, and linked DocTypes
- `get_field_options`: Get available options for a Link or Select field

### Helper Tools

- `find_doctypes`: Find DocTypes in the system matching a search term
- `get_module_list`: Get a list of all modules in the system
- `get_doctypes_in_module`: Get a list of DocTypes in a specific module
- `check_doctype_exists`: Check if a DocType exists in the system
- `check_document_exists`: Check if a document exists
- `get_document_count`: Get a count of documents matching filters
- `get_naming_info`: Get the naming series information for a DocType
- `get_required_fields`: Get a list of required fields for a DocType

### DocType Operations (for custom apps)

- `create_doctype`: Create a new custom DocType
- `create_child_table`: Create a child table DocType
- `add_fields_to_doctype`: Add fields to an existing DocType
- `delete_doctype`: Delete a custom DocType

### Workflow/Blueprint Operations

- `create_blueprint`: Create a new workflow blueprint
- `read_blueprint`: Get blueprint details
- `update_blueprint`: Update an existing blueprint
- `delete_blueprint`: Delete a blueprint
- `validate_blueprint`: Validate blueprint JSON
- `execute_blueprint`: Execute a blueprint manually

## Examples

### Creating a Document

```javascript
// Example of using the create_document tool
const result = await mcp.call("create_document", {
  doctype: "Customer",
  values: {
    customer_name: "John Doe",
    customer_type: "Individual",
    customer_group: "All Customer Groups",
    territory: "All Territories",
  },
});
```

### Getting a Document

```javascript
// Example of using the get_document tool
const customer = await mcp.call("get_document", {
  doctype: "Customer",
  name: "CUST-00001",
  fields: ["customer_name", "customer_type", "email_id"],
});
```

### Listing Documents with Filters

```javascript
// Example of using the list_documents tool with filters
const customers = await mcp.call("list_documents", {
  doctype: "Customer",
  filters: {
    customer_type: "Individual",
    territory: "United States",
  },
  fields: ["name", "customer_name", "email_id"],
  limit: 10,
  order_by: "creation desc",
});
```

## Error Handling

The server provides detailed error messages with context to help diagnose issues:

- Missing required parameters
- Invalid field values
- Permission errors
- Network issues
- Server errors

Each error includes:

- A descriptive message
- HTTP status code (when applicable)
- Endpoint information
- Additional details from the Frappe server

## Best Practices

1. **Check DocType Schema First**: Before creating or updating documents, get the schema to understand required fields and validations.

2. **Use Pagination**: When listing documents, use `limit` and `limit_start` parameters to paginate results.

3. **Specify Fields**: Only request the fields you need to improve performance.

4. **Validate Before Creating**: Use `get_required_fields` to ensure you have all required fields before creating a document.

5. **Check Existence**: Use `check_document_exists` before updating or deleting to ensure the document exists.

## Architecture

The server uses a multi-tenant architecture:

```
                    ┌─────────────────────┐
                    │   mcp-server.cjs    │
                    │  (Express server)   │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │   ConfigManager │ │  MCP Server     │ │  Session Pool   │
    │ (mcp-sites.json)│ │  (shared)       │ │  (per-site)     │
    └─────────────────┘ └─────────────────┘ └─────────────────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │     library.ts      │
                    │ (executeTool, etc.) │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │   Document API  │ │   Schema API    │ │   Frappe API    │
    │ (parameterized) │ │ (parameterized) │ │   (helpers)     │
    └─────────────────┘ └─────────────────┘ └─────────────────┘
```

- **ConfigManager**: Loads site credentials from `mcp-sites.json` with 5-minute caching
- **MCP Server**: Single global instance shared across all sessions
- **Session Pool**: Per-site sessions with transport caching
- **library.ts**: Core tool execution logic with credentials injection

## License

ISC
