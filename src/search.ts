import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SearXNGWeb } from "./types.js";
import { createProxyAgent } from "./proxy.js";
import {
  createConfigurationError,
  createNetworkError,
  createServerError,
  createJSONError,
  type ErrorContext
} from "./error-handler.js";
import {
  SEARCH_ENGINES,
  SEARXNG_URL,
  AUTH_USERNAME,
  AUTH_PASSWORD,
  USER_AGENT
} from "./config.js";

function getEnginesParam(): string | null {
  const engines = SEARCH_ENGINES.trim().toLowerCase();
  if (!engines || engines === 'all') {
    return null;
  }
  return engines;
}

function isValidDomain(domain: string): boolean {
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/;
  return domainRegex.test(domain);
}

export async function fetchSinglePage(
  server: Server,
  query: string,
  pageno: number = 1,
  time_range?: string,
  language: string = "all",
  safesearch?: number,
  site?: string
): Promise<Array<{ title: string; content: string; url: string; score: number }>> {
  if (!SEARXNG_URL) {
    throw createConfigurationError(
      "SEARXNG_URL not set. Set it to your SearXNG instance (e.g., http://localhost:8080 or https://search.example.com)"
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(SEARXNG_URL.endsWith('/') ? SEARXNG_URL : SEARXNG_URL + '/');
  } catch (error) {
    throw createConfigurationError(
      `Invalid SEARXNG_URL format: ${SEARXNG_URL}. Use format: http://localhost:8080`
    );
  }

  const url = new URL('search', parsedUrl);

  let searchQuery = query;
  if (site) {
    if (!isValidDomain(site)) {
      throw createConfigurationError(`Invalid site domain format: ${site}. Expected format: example.com`);
    }
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

  const username = AUTH_USERNAME;
  const password = AUTH_PASSWORD;

  if (username && password) {
    const base64Auth = Buffer.from(`${username}:${password}`).toString('base64');
    requestOptions.headers = {
      ...requestOptions.headers,
      'Authorization': `Basic ${base64Auth}`
    };
  }

  if (USER_AGENT) {
    requestOptions.headers = {
      ...requestOptions.headers,
      'User-Agent': USER_AGENT
    };
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), requestOptions);
  } catch (error: any) {
    const context: ErrorContext = {
      url: url.toString(),
      searxngUrl: SEARXNG_URL,
      proxyAgent: !!proxyAgent,
      username: AUTH_USERNAME ? '[configured]' : undefined
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
      searxngUrl: SEARXNG_URL
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
