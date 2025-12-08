/**
 * Web Operations - Tavily-based web search and content extraction tools
 *
 * Provides real-time web search and URL content extraction capabilities
 * for AI agents to gather data from the internet.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const WEB_TOOLS: Tool[] = [
  {
    name: "web_search",
    description: `Search the web for current, real-time information using Tavily AI search.

Use this when you need:
- Up-to-date information not in training data
- Current events, recent news, product info
- Data to populate tables (countries, companies, movies, etc.)
- Weather, prices, or time-sensitive data

Returns:
- answer: AI-summarized answer with key facts
- results: Array of sources with URLs, titles, and content

Example: web_search(query="list of Fortune 500 companies 2024 with revenue")`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query. Be specific for better results."
        },
        topic: {
          type: "string",
          enum: ["general", "news"],
          description: "Search topic: 'general' for broad search, 'news' for recent news only"
        },
        max_results: {
          type: "number",
          description: "Maximum number of results (1-10, default: 5)"
        },
        search_depth: {
          type: "string",
          enum: ["basic", "advanced"],
          description: "'basic' for quick search, 'advanced' for more thorough results"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "web_extract",
    description: `Extract and read full content from specific web URLs using Tavily Extract.

Use this when you have a URL and need to read its contents in detail.
Useful for reading articles, documentation, tables, or any web page content.

Returns the extracted text content from the URL(s).

Example: web_extract(urls=["https://example.com/data-table"])`,
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "Array of URLs to extract content from (max 5)"
        }
      },
      required: ["urls"]
    }
  }
];

/**
 * Execute web search using Tavily API
 */
export async function executeWebSearch(
  args: {
    query: string;
    topic?: string;
    max_results?: number;
    search_depth?: string;
  },
  tavilyApiKey: string
): Promise<any> {
  const axios = (await import('axios')).default;

  const response = await axios.post(
    'https://api.tavily.com/search',
    {
      api_key: tavilyApiKey,
      query: args.query,
      topic: args.topic || 'general',
      max_results: Math.min(args.max_results || 5, 10),
      search_depth: args.search_depth || 'basic',
      include_answer: true,
      include_raw_content: false
    },
    {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    }
  );

  return {
    success: true,
    answer: response.data.answer || null,
    results: (response.data.results || []).map((r: any) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score
    })),
    query: args.query
  };
}

/**
 * Execute web content extraction using Tavily API
 */
export async function executeWebExtract(
  args: {
    urls: string[];
  },
  tavilyApiKey: string
): Promise<any> {
  const axios = (await import('axios')).default;

  // Limit to 5 URLs
  const urls = args.urls.slice(0, 5);

  const response = await axios.post(
    'https://api.tavily.com/extract',
    {
      api_key: tavilyApiKey,
      urls: urls
    },
    {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );

  return {
    success: true,
    results: (response.data.results || []).map((r: any) => ({
      url: r.url,
      raw_content: r.raw_content,
      extracted_content: r.extracted_content || r.raw_content
    })),
    failed_urls: response.data.failed_results || []
  };
}
