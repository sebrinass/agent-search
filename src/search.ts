import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SearXNGWeb } from "./types.js";
import { createProxyAgent } from "./proxy.js";
import { logMessage } from "./logging.js";
import {
  createConfigurationError,
  createNetworkError,
  createServerError,
  createJSONError,
  createDataError,
  createNoResultsMessage,
  type ErrorContext
} from "./error-handler.js";

const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || '';
const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || process.env.OLLAMA_HOST || '';
const isEmbeddingEnabled = !!(EMBEDDING_API_KEY || EMBEDDING_BASE_URL);
const DEFAULT_SEARCH_PAGES = isEmbeddingEnabled ? 3 : 1;
const SEARCH_PAGES = parseInt(process.env.SEARCH_PAGES || String(DEFAULT_SEARCH_PAGES), 10);
const SEARCH_ENGINES = process.env.SEARCH_ENGINES || '';

function getEnginesParam(): string | null {
  const engines = SEARCH_ENGINES.trim().toLowerCase();
  if (!engines || engines === 'all') {
    return null;
  }
  return engines;
}

async function fetchSinglePage(
  server: Server,
  query: string,
  pageno: number,
  time_range?: string,
  language: string = "all",
  safesearch?: number,
  site?: string
): Promise<Array<{ title: string; content: string; url: string; score: number }>> {
  const searxngUrl = process.env.SEARXNG_URL;

  if (!searxngUrl) {
    throw createConfigurationError(
      "SEARXNG_URL not set. Set it to your SearXNG instance (e.g., http://localhost:8080 or https://search.example.com)"
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(searxngUrl.endsWith('/') ? searxngUrl : searxngUrl + '/');
  } catch (error) {
    throw createConfigurationError(
      `Invalid SEARXNG_URL format: ${searxngUrl}. Use format: http://localhost:8080`
    );
  }

  const url = new URL('search', parsedUrl);

  let searchQuery = query;
  if (site) {
    searchQuery = `site:${site} ${query}`;
  }

  url.searchParams.set("q", searchQuery);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageno", pageno.toString());
  
  const enginesParam = getEnginesParam();
  if (enginesParam) {
    url.searchParams.set("engines", enginesParam);
  }

  if (
    time_range !== undefined &&
    ["day", "month", "year"].includes(time_range)
  ) {
    url.searchParams.set("time_range", time_range);
  }

  if (language && language !== "all") {
    url.searchParams.set("language", language);
  }

  if (safesearch !== undefined && [0, 1, 2].includes(safesearch)) {
    url.searchParams.set("safesearch", safesearch.toString());
  }

  const requestOptions: RequestInit = {
    method: "GET"
  };

  const proxyAgent = createProxyAgent(url.toString());
  if (proxyAgent) {
    requestOptions.dispatcher = proxyAgent;
  }

  const username = process.env.AUTH_USERNAME;
  const password = process.env.AUTH_PASSWORD;

  if (username && password) {
    const base64Auth = Buffer.from(`${username}:${password}`).toString('base64');
    requestOptions.headers = {
      ...requestOptions.headers,
      'Authorization': `Basic ${base64Auth}`
    };
  }

  const userAgent = process.env.USER_AGENT;
  if (userAgent) {
    requestOptions.headers = {
      ...requestOptions.headers,
      'User-Agent': userAgent
    };
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), requestOptions);
  } catch (error: any) {
    const context: ErrorContext = {
      url: url.toString(),
      searxngUrl,
      proxyAgent: !!proxyAgent,
      username
    };
    throw createNetworkError(error, context);
  }

  if (!response.ok) {
    let responseBody: string;
    try {
      responseBody = await response.text();
    } catch {
      responseBody = '[Could not read response body]';
    }

    const context: ErrorContext = {
      url: url.toString(),
      searxngUrl
    };
    throw createServerError(response.status, response.statusText, responseBody, context);
  }

  let data: SearXNGWeb;
  try {
    data = (await response.json()) as SearXNGWeb;
  } catch (error: any) {
    let responseText: string;
    try {
      responseText = await response.text();
    } catch {
      responseText = '[Could not read response text]';
    }

    const context: ErrorContext = { url: url.toString() };
    throw createJSONError(responseText, context);
  }

  if (!data.results) {
    return [];
  }

  return data.results.map((result) => ({
    title: result.title || "",
    content: result.content || "",
    url: result.url || "",
    score: result.score || 0,
  }));
}

export async function performWebSearch(
  server: Server,
  query: string,
  pageno: number = 1,
  time_range?: string,
  language: string = "all",
  safesearch?: number,
  site?: string
) {
  const startTime = Date.now();
  
  const searchParams = [
    `pages: ${SEARCH_PAGES}`,
    `lang: ${language}`,
    time_range ? `time: ${time_range}` : null,
    safesearch ? `safesearch: ${safesearch}` : null
  ].filter(Boolean).join(", ");
  
  logMessage(server, "info", `Starting web search: "${query}" (${searchParams})`);

  const pagePromises: Promise<Array<{ title: string; content: string; url: string; score: number }>>[] = [];
  
  for (let page = 1; page <= SEARCH_PAGES; page++) {
    pagePromises.push(fetchSinglePage(server, query, page, time_range, language, safesearch, site));
  }

  const pageResults = await Promise.all(pagePromises);
  
  const seenUrls = new Set<string>();
  const allResults: Array<{ title: string; content: string; url: string; score: number }> = [];
  
  for (const results of pageResults) {
    for (const result of results) {
      if (!seenUrls.has(result.url)) {
        seenUrls.add(result.url);
        allResults.push(result);
      }
    }
  }

  if (allResults.length === 0) {
    logMessage(server, "info", `No results found for query: "${query}"`);
    return createNoResultsMessage(query);
  }

  const duration = Date.now() - startTime;
  logMessage(server, "info", `Search completed: "${query}" (${searchParams}) - ${allResults.length} results in ${duration}ms`);

  return allResults
    .map((r) => `Title: ${r.title}\nDescription: ${r.content}\nURL: ${r.url}\nRelevance Score: ${r.score.toFixed(3)}`)
    .join("\n\n");
}

export async function performWebSearchRaw(
  server: Server,
  query: string,
  time_range?: string,
  language: string = "all",
  safesearch?: number,
  site?: string
): Promise<Array<{ title: string; content: string; url: string; score: number }>> {
  const pagePromises: Promise<Array<{ title: string; content: string; url: string; score: number }>>[] = [];
  
  for (let page = 1; page <= SEARCH_PAGES; page++) {
    pagePromises.push(fetchSinglePage(server, query, page, time_range, language, safesearch, site));
  }

  const pageResults = await Promise.all(pagePromises);
  
  const seenUrls = new Set<string>();
  const allResults: Array<{ title: string; content: string; url: string; score: number }> = [];
  
  for (const results of pageResults) {
    for (const result of results) {
      if (!seenUrls.has(result.url)) {
        seenUrls.add(result.url);
        allResults.push(result);
      }
    }
  }

  return allResults;
}
