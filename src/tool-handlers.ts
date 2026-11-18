import { Server, LoggingLevel } from "@modelcontextprotocol/server";
import { Tool } from "@modelcontextprotocol/server";
import { READ_URL_TOOL, isWebUrlReadArgs } from "./types.js";
import { logMessage, setLogLevel } from "./logging.js";
import { fetchAndConvertToMarkdown, PaginationOptions } from "./url-reader.js";
import { ResearchServer, SearchInput, SEARCH_TOOL } from "./research.js";
import { minimaxSearch } from "./minimax-search.js";
import { exaSearch } from "./exa-search.js";
import { deepseekSearch } from "./deepseek-search.js";
import { createConfigResource } from "./resources.js";
import { FETCH_TIMEOUT_MS, isMinimaxEnabled, isExaEnabled, isDeepseekEnabled } from "./config.js";

/**
 * 向 MCP Server 注册所有请求处理器（工具列表、工具调用、日志级别、资源列表、资源读取）。
 * 集中管理，避免在 mcp-main.ts / http-server.ts 中重复定义。
 */
export function registerRequestHandlers(server: Server, researchServer: ResearchServer): void {
  let currentLogLevel: LoggingLevel = "info";

  server.setRequestHandler('tools/list', async () => {
    logMessage(server, "debug", "Handling list_tools request");
    return {
      tools: [SEARCH_TOOL, ...getToolDefinitions(), ...getCloudSearchTools()],
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

      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  });
}

export function getToolDefinitions() {
  return [READ_URL_TOOL];
}

/**
 * 云端搜索工具定义（DeepSeek / MiniMax / Exa）。
 * 按环境变量动态注册：DeepSeek / MiniMax 配 key 即注册；Exa 由 ENABLE_EXA_SEARCH 控制。
 */
export function getCloudSearchTools(): Tool[] {
  const tools: Tool[] = [];

  if (isDeepseekEnabled) {
    tools.push({
      name: "deepseek_search",
      description: `DeepSeek 自研搜索引擎（商业索引，已过滤 SEO 作弊与低质 AIGC）。单关键词搜索，自带质量信号：rerankScore（0-3，>=1.5 为高质量）、authority（0-4，>=3 为高权威源）；snippet 为面向模型的长摘要（约400字），可直接据此判断是否值得 urls_read，省一轮读取。支持 site:/lang:/after:/before: 操作符（由参数转换）。适合：需要权威来源、需要时效过滤、或 web_search 结果里垃圾站过多的场景。`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词（单个字符串，最长 128 字符）",
          },
          count: {
            type: "number",
            description: "返回结果数量（默认10，最大50）",
            minimum: 1,
            maximum: 50,
          },
          site: {
            type: "string",
            description: "限制搜索范围到具体网站域名（转换为 site: 操作符）",
          },
          time_range: {
            type: "string",
            enum: ["day", "month", "year"],
            description: "时间范围过滤，转换为 after: 日期操作符",
          },
          lang: {
            type: "string",
            description: "搜索语言代码，如 zh / en，可逗号分隔多个（转换为 lang: 操作符）",
          },
        },
        required: ["query"],
      },
    });
  }

  if (isMinimaxEnabled) {
    tools.push({
      name: "minimax_search",
      description: `MiniMax 商业搜索工具（Coding Plan Token）。单关键词搜索，中文覆盖好，返回官方排序结果（含标题、链接、摘要、日期）。适合中文/国内外站点检索、实时信息查询。返回结构：{ keyword, results: [{title, link, snippet, publishedDate}], related }`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词（单个字符串）",
          },
          count: {
            type: "number",
            description: "返回结果数量（默认10，最大10）",
            minimum: 1,
            maximum: 10,
          },
        },
        required: ["query"],
      },
    });
  }

  if (isExaEnabled) {
    tools.push({
      name: "exa_search",
      description: `Exa 语义搜索工具。单关键词搜索，基于语义相似度（neural），能发现关键词字面不同但语义相近的页面，补足传统搜索引擎的长尾盲区。适合语义发现、新话题调研、技术文档检索。返回结构：{ keyword, results: [{title, link, snippet, publishedDate}] }`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词（单个字符串）",
          },
          count: {
            type: "number",
            description: "返回结果数量（默认10，最大10）",
            minimum: 1,
            maximum: 10,
          },
        },
        required: ["query"],
      },
    });
  }

  return tools;
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

  // 不把 isError 转成 throw：processSearch 已把可读原因（尤其是 degraded 时的
  // 故障说明）放在 content 里，throw 会把它替换成一句无信息的通用错误，
  // agent 就分不清「确实没有结果」和「引擎挂了」了。
  return await researchServer.processSearch(searchInput);
}

/**
 * deepseek_search 工具调用：参数校验 + 调用 + 归一化输出壳
 */
export async function handleDeepseekSearchTool(
  server: Server,
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const typedArgs = args as Record<string, unknown>;

  if (typeof typedArgs.query !== "string" || typedArgs.query.trim() === "") {
    throw new Error(`deepseek_search 参数错误：query 必须是非空字符串。实际值：${JSON.stringify(typedArgs.query)}`);
  }

  let count = 10;
  if (typedArgs.count !== undefined) {
    if (typeof typedArgs.count !== "number" || typedArgs.count < 1 || typedArgs.count > 50) {
      throw new Error("deepseek_search 参数错误：count 必须是 1-50 之间的数字");
    }
    count = typedArgs.count;
  }

  for (const field of ["site", "time_range", "lang"] as const) {
    const value = typedArgs[field];
    if (value !== undefined && typeof value !== "string") {
      throw new Error(`deepseek_search 参数错误：${field} 必须是字符串。实际值：${JSON.stringify(value)}`);
    }
  }

  const result = await deepseekSearch(server, typedArgs.query, count, {
    site: typedArgs.site as string | undefined,
    time_range: typedArgs.time_range as string | undefined,
    lang: typedArgs.lang as string | undefined,
  });

  if (result.error) {
    return {
      content: [{ type: "text", text: JSON.stringify({ source: "deepseek", error: result.error }, null, 2) }],
      isError: true,
    };
  }

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        source: "deepseek",
        keyword: result.keyword,
        appliedQuery: result.appliedQuery,
        results: result.results,
      }, null, 2),
    }],
  };
}

/**
 * minimax_search 工具调用：参数校验 + 调用 + 归一化输出壳
 */
export async function handleMinimaxSearchTool(
  server: Server,
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const typedArgs = args as Record<string, unknown>;

  if (typeof typedArgs.query !== "string" || typedArgs.query.trim() === "") {
    throw new Error(`minimax_search 参数错误：query 必须是非空字符串。实际值：${JSON.stringify(typedArgs.query)}`);
  }

  let count = 10;
  if (typedArgs.count !== undefined) {
    if (typeof typedArgs.count !== "number" || typedArgs.count < 1 || typedArgs.count > 10) {
      throw new Error("minimax_search 参数错误：count 必须是 1-10 之间的数字");
    }
    count = typedArgs.count;
  }

  const result = await minimaxSearch(server, typedArgs.query, count);

  if (result.error) {
    return {
      content: [{ type: "text", text: JSON.stringify({ source: "minimax", error: result.error }, null, 2) }],
      isError: true,
    };
  }

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        source: "minimax",
        keyword: result.keyword,
        results: result.results,
        related: result.related,
      }, null, 2),
    }],
  };
}

/**
 * exa_search 工具调用：参数校验 + 调用 + 归一化输出壳
 */
export async function handleExaSearchTool(
  server: Server,
  args: unknown
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const typedArgs = args as Record<string, unknown>;

  if (typeof typedArgs.query !== "string" || typedArgs.query.trim() === "") {
    throw new Error(`exa_search 参数错误：query 必须是非空字符串。实际值：${JSON.stringify(typedArgs.query)}`);
  }

  let count = 10;
  if (typedArgs.count !== undefined) {
    if (typeof typedArgs.count !== "number" || typedArgs.count < 1 || typedArgs.count > 10) {
      throw new Error("exa_search 参数错误：count 必须是 1-10 之间的数字");
    }
    count = typedArgs.count;
  }

  const result = await exaSearch(server, typedArgs.query, count);

  if (result.error) {
    return {
      content: [{ type: "text", text: JSON.stringify({ source: "exa", error: result.error }, null, 2) }],
      isError: true,
    };
  }

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        source: "exa",
        keyword: result.keyword,
        results: result.results,
      }, null, 2),
    }],
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
      case "urls_read":
        return await handleReadTool(server, args);

      case "web_search":
        return await handleSearchTool(researchServer, args);

      case "deepseek_search":
        return await handleDeepseekSearchTool(server, args);

      case "minimax_search":
        return await handleMinimaxSearchTool(server, args);

      case "exa_search":
        return await handleExaSearchTool(server, args);

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
