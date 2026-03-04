import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { READ_URL_TOOL, isWebUrlReadArgs } from "./types.js";
import { logMessage } from "./logging.js";
import { fetchAndConvertToMarkdown, PaginationOptions } from "./url-reader.js";
import { ResearchServer, ThoughtData } from "./research.js";
import {
  CODE_RESOLVE_TOOL,
  CODE_QUERY_TOOL,
  searchLibraries,
  fetchLibraryContext,
  formatSearchResults,
  isCodeResolveArgs,
  isCodeQueryArgs,
} from "./context7.js";
import { FETCH_TIMEOUT_MS } from "./config.js";

export interface ToolHandlerDeps {
  server: Server;
  researchServer: ResearchServer;
}

export function getToolDefinitions() {
  return [READ_URL_TOOL, CODE_RESOLVE_TOOL, CODE_QUERY_TOOL];
}

export async function handleReadTool(
  server: Server,
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  if (!isWebUrlReadArgs(args)) {
    logMessage(server, "error", `Read tool validation failed. Args: ${JSON.stringify(args)}`);
    throw new Error(`Invalid arguments for URL reading. Received: ${JSON.stringify(args)}`);
  }

  const paginationOptions: PaginationOptions = {
    startChar: typeof args.startChar === 'number' ? args.startChar : 0,
    maxLength: typeof args.maxLength === 'number' ? args.maxLength : undefined,
    section: typeof args.section === 'string' ? args.section : undefined,
    paragraphRange: typeof args.paragraphRange === 'string' ? args.paragraphRange : undefined,
    readHeadings: args.readHeadings === true,
  };

  if (!args.urls || args.urls.length === 0) {
    throw new Error("'urls' parameter is required with at least one URL");
  }

  const urls = args.urls;

  if (urls.length > 1) {
    logMessage(server, "info", `Batch URL reading: ${urls.length} URLs`);
  }

  const result = await fetchAndConvertToMarkdown(server, urls, args.timeoutMs || FETCH_TIMEOUT_MS, paginationOptions);

  return {
    content: [{ type: "text", text: result }],
  };
}

export async function handleSearchTool(
  researchServer: ResearchServer,
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const result = await researchServer.processThought(args as unknown as ThoughtData);

  if (result.isError) {
    throw new Error("Search tool execution failed");
  }

  return result;
}

export async function handleLibrarySearchTool(
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  if (!isCodeResolveArgs(args)) {
    throw new Error("Invalid arguments for library_search");
  }

  const searchResponse = await searchLibraries(args.query, args.libraryName);

  if (!searchResponse.results || searchResponse.results.length === 0) {
    return {
      content: [{ type: "text", text: searchResponse.error || "No libraries found matching the provided name." }],
    };
  }

  const resultsText = formatSearchResults(searchResponse);
  return {
    content: [{ type: "text", text: `Available Libraries:\n\n${resultsText}` }],
  };
}

export async function handleLibraryDocsTool(
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  if (!isCodeQueryArgs(args)) {
    throw new Error("Invalid arguments for library_docs");
  }

  const response = await fetchLibraryContext(args.libraryId, args.query);

  return {
    content: [{ type: "text", text: response.data }],
  };
}

export async function handleToolCall(
  server: Server,
  researchServer: ResearchServer,
  toolName: string,
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  logMessage(server, "debug", `Handling call_tool request: ${toolName}`);

  try {
    switch (toolName) {
      case "read":
        return await handleReadTool(server, args);

      case "search":
        return await handleSearchTool(researchServer, args);

      case "library_search":
        return await handleLibrarySearchTool(args);

      case "library_docs":
        return await handleLibraryDocsTool(args);

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    const sanitizedArgs = args
      ? JSON.stringify(args).replace(
          /"(api[_-]?key|token|password|secret|authorization)"\s*:\s*"[^"]*"/gi,
          '"$1":"[REDACTED]"'
        )
      : undefined;

    logMessage(server, "error", `Tool execution error: ${error instanceof Error ? error.message : String(error)}`, {
      tool: toolName,
      args: sanitizedArgs ? JSON.parse(sanitizedArgs) : args,
      error: error instanceof Error ? error.stack : String(error),
    });

    throw error;
  }
}
