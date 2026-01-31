/**
 * Web Operations - Live browser-based web search and content extraction tools
 *
 * Replaces Tavily with Playwright-driven browsing. Intended to mirror
 * computer-use style browsing while remaining tool compatible.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const WEB_TOOLS: Tool[] = [
  {
    name: "web_search",
    description: `Search the web for current, real-time information using a live browser.

Use this when you need:
- Up-to-date information not in training data
- Current events, recent news, product info
- Data to populate tables (countries, companies, movies, etc.)
- Weather, prices, or time-sensitive data

Returns:
- answer: (optional) summary, may be null
- results: Array of sources with URLs, titles, and content snippets

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
    description: `Extract and read content from specific web URLs using a live browser.

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
 * Execute web search using Playwright
 */
export async function executeWebSearch(
  args: {
    query: string;
    topic?: string;
    max_results?: number;
    search_depth?: string;
  },
  _unusedApiKey: string
): Promise<any> {
  const maxResults = Math.min(args.max_results || 5, 10);
  const { chromium } = await import("playwright");

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1280, height: 720 },
  });

  await context.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
    Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
    Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});
    window.chrome = { runtime: {} };
  `);

  const page = await context.newPage();
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);

  const results = await page.$$eval("div.result", (items) => {
    return items.slice(0, 10).map((item) => {
      const titleEl = item.querySelector("a.result__a");
      const snippetEl = item.querySelector(".result__snippet");
      return {
        title: (titleEl && (titleEl as any).innerText ? (titleEl as any).innerText.trim() : "") || "",
        url: (titleEl && (titleEl as any).href) || "",
        content: (snippetEl && (snippetEl as any).innerText ? (snippetEl as any).innerText.trim() : "") || "",
        score: null
      };
    });
  });

  await page.close();
  await context.close();
  await browser.close();

  return {
    success: true,
    answer: null,
    results: results.slice(0, maxResults),
    query: args.query,
    provider: "browser"
  };
}

/**
 * Execute web content extraction using Playwright
 */
export async function executeWebExtract(
  args: {
    urls: string[];
  },
  _unusedApiKey: string
): Promise<any> {
  const { chromium } = await import("playwright");

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1280, height: 720 },
  });

  await context.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
    Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
    Object.defineProperty(navigator, 'platform', {get: () => 'Win32'});
    window.chrome = { runtime: {} };
  `);

  const page = await context.newPage();
  const urls = args.urls.slice(0, 5);
  const results: Array<{ url: string; title: string; extracted_content: string }> = [];
  const failed_urls: string[] = [];

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
      const title = await page.title();
      const text = await page.textContent("body");
      let extracted = (text || "").replace(/\s+/g, " ").trim();
      if (extracted.length > 4000) {
        extracted = extracted.slice(0, 4000) + "...";
      }
      results.push({ url, title, extracted_content: extracted });
    } catch (e) {
      failed_urls.push(url);
    }
  }

  await page.close();
  await context.close();
  await browser.close();

  return {
    success: true,
    results,
    failed_urls
  };
}
