import { Tool } from "@modelcontextprotocol/sdk/types.js";

declare global {
  interface RequestInit {
    dispatcher?: unknown;
  }
}

export interface SearXNGWeb {
  results: Array<{
    title: string;
    content: string;
    url: string;
    score: number;
  }>;
}

export const READ_URL_TOOL: Tool = {
  name: "read",
  description: "读取 URL 的内容",
  inputSchema: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: { type: "string" },
        description: "URLs to read. Array of URLs (e.g., ['https://a.com', 'https://b.com']). Minimum 1 URL required.",
        minItems: 1,
      },
      startChar: {
        type: "number",
        description: "Starting character position for content extraction (default: 0)",
        minimum: 0,
      },
      maxLength: {
        type: "number",
        description: "Maximum number of characters to return per URL",
        minimum: 1,
      },
      section: {
        type: "string",
        description: "Extract content under a specific heading (searches for heading text)",
      },
      paragraphRange: {
        type: "string",
        description: "Return specific paragraph ranges (e.g., '1-5', '3', '10-')",
      },
      readHeadings: {
        type: "boolean",
        description: "Return only a list of headings instead of full content",
      },
      timeoutMs: {
        type: "number",
        description: "Request timeout in milliseconds (default: 30000, from FETCH_TIMEOUT_MS env var)",
        minimum: 1000,
      },
    },
  },
};

export function isWebUrlReadArgs(args: unknown): args is {
  urls?: string[];
  startChar?: number;
  maxLength?: number;
  section?: string;
  paragraphRange?: string;
  readHeadings?: boolean;
  timeoutMs?: number;
} {
  if (
    typeof args !== "object" ||
    args === null
  ) {
    return false;
  }

  const urlArgs = args as Record<string, unknown>;

  if (!("urls" in urlArgs) || !Array.isArray(urlArgs.urls) || urlArgs.urls.length === 0) {
    return false;
  }

  for (const url of urlArgs.urls) {
    if (typeof url !== "string" || url.trim() === "") {
      return false;
    }
  }

  if (urlArgs.section === "") urlArgs.section = undefined;
  if (urlArgs.paragraphRange === "") urlArgs.paragraphRange = undefined;

  if (urlArgs.startChar !== undefined && (typeof urlArgs.startChar !== "number" || urlArgs.startChar < 0)) {
    return false;
  }
  if (urlArgs.maxLength !== undefined && (typeof urlArgs.maxLength !== "number" || urlArgs.maxLength < 1)) {
    return false;
  }
  if (urlArgs.section !== undefined && typeof urlArgs.section !== "string") {
    return false;
  }
  if (urlArgs.paragraphRange !== undefined && typeof urlArgs.paragraphRange !== "string") {
    return false;
  }
  if (urlArgs.readHeadings !== undefined && typeof urlArgs.readHeadings !== "boolean") {
    return false;
  }
  if (urlArgs.timeoutMs !== undefined && (typeof urlArgs.timeoutMs !== "number" || urlArgs.timeoutMs < 1000)) {
    return false;
  }

  return true;
}
