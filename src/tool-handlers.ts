import { Server, LoggingLevel } from "@modelcontextprotocol/server";
import { READ_URL_TOOL, isWebUrlReadArgs } from "./types.js";
import { logMessage, setLogLevel } from "./logging.js";
import { fetchAndConvertToMarkdown, PaginationOptions } from "./url-reader.js";
import { ResearchServer, SearchInput, SEARCH_TOOL } from "./research.js";
import { createConfigResource, createHelpResource } from "./resources.js";
import { FETCH_TIMEOUT_MS } from "./config.js";

/**
 * 向 MCP Server 注册所有请求处理器（工具列表、工具调用、日志级别、资源列表、资源读取）。
 * 集中管理，避免在 mcp-main.ts / http-server.ts 中重复定义。
 */
export function registerRequestHandlers(server: Server, researchServer: ResearchServer): void {
  let currentLogLevel: LoggingLevel = "info";

  server.setRequestHandler('tools/list', async () => {
    logMessage(server, "debug", "Handling list_tools request");
    return {
      tools: [SEARCH_TOOL, ...getToolDefinitions()],
    };
  });

  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(server, researchServer, name, args);
  });

  server.setRequestHandler('logging/setLevel', async (request) => {
    const { level } = request.params;
    logMessage(server, "info", `Setting log level to: ${level}`);
    currentLogLevel = level;
    setLogLevel(level);
    return {};
  });

  server.setRequestHandler('resources/list', async () => {
    logMessage(server, "debug", "Handling list_resources request");
    return {
      resources: [
        {
          uri: "config://server-config",
          mimeType: "application/json",
          name: "Server Configuration",
          description: "Current server configuration and environment variables"
        },
        {
          uri: "help://usage-guide",
          mimeType: "text/markdown",
          name: "Usage Guide",
          description: "How to use the Augmented Search server effectively"
        }
      ]
    };
  });

  server.setRequestHandler('resources/read', async (request) => {
    const { uri } = request.params;
    logMessage(server, "debug", `Handling read_resource request for: ${uri}`);

    switch (uri) {
      case "config://server-config":
        return {
          contents: [
            {
              uri: uri,
              mimeType: "application/json",
              text: createConfigResource()
            }
          ]
        };

      case "help://usage-guide":
        return {
          contents: [
            {
              uri: uri,
              mimeType: "text/markdown",
              text: createHelpResource()
            }
          ]
        };

      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  });
}

export function getToolDefinitions() {
  return [READ_URL_TOOL];
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
    maxLength: typeof args.maxLength === 'number' ? args.maxLength : 2000,
    section: typeof args.section === 'string' ? args.section : undefined,
    paragraphRange: typeof args.paragraphRange === 'string' ? args.paragraphRange : undefined,
    readHeadings: args.readHeadings === true,
    extractLinks: args.extractLinks === true,
    forceRefresh: args.forceRefresh === true,
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
  const typedArgs = args as Record<string, unknown>;

  // ============ 运行时类型校验（防 agent 传错格式） ============
  // 实测中 LLM 常把 searchedKeywords 传成字符串（如 "关键词1 关键词2"），
  // 直接透传会被 Array.from 按字符拆成单字，返回一堆垃圾结果。
  // 这里在入口处显式校验并返回明确错误，而不是默默接受错误类型。
  const rawKeywords = typedArgs.searchedKeywords;
  if (rawKeywords !== undefined && rawKeywords !== null) {
    if (!Array.isArray(rawKeywords)) {
      throw new Error(
        `searchedKeywords 参数类型错误：期望字符串数组，实际收到 ${typeof rawKeywords}。` +
        `正确格式示例：{"searchedKeywords": ["关键词1", "关键词2"]}。` +
        `实际值：${JSON.stringify(rawKeywords)}`
      );
    }
    const nonStringItems = rawKeywords.filter(item => typeof item !== 'string' || item.trim().length === 0);
    if (nonStringItems.length > 0) {
      throw new Error(
        `searchedKeywords 数组包含非法元素：所有元素必须是非空字符串。` +
        `非法元素：${JSON.stringify(nonStringItems)}`
      );
    }
  }

  const searchInput: SearchInput = {
    searchedKeywords: typedArgs.searchedKeywords as string[] | undefined,
    site: typedArgs.site as string | undefined,
    time_range: typedArgs.time_range as string | undefined,
    lang: typedArgs.lang as string | undefined,
    safeSearch: typedArgs.safeSearch as number | undefined,
    category: typedArgs.category as string | undefined,
  };

  const result = await researchServer.processSearch(searchInput);

  if (result.isError) {
    throw new Error("Search tool execution failed");
  }

  return result;
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
      case "urls_read":
        return await handleReadTool(server, args);

      case "web_search":
        return await handleSearchTool(researchServer, args);

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
