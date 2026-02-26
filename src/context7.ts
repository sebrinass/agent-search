/**
 * Context7 代码搜索集成
 * 提供库文档和代码示例搜索功能
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";

// ============== 类型定义 ==============

export interface SearchResult {
  id: string;
  title: string;
  description: string;
  branch: string;
  lastUpdateDate: string;
  state: DocumentState;
  totalTokens: number;
  totalSnippets: number;
  stars?: number;
  trustScore?: number;
  benchmarkScore?: number;
  versions?: string[];
}

export interface SearchResponse {
  error?: string;
  results: SearchResult[];
}

export type DocumentState = "initial" | "finalized" | "error" | "delete";

export interface ContextResponse {
  data: string;
}

// ============== 常量 ==============

const CONTEXT7_API_BASE_URL = process.env.CONTEXT7_API_URL || "https://context7.com/api";

// ============== 错误处理 ==============

/**
 * 解析 API 错误响应
 */
async function parseErrorResponse(response: Response, apiKey?: string): Promise<string> {
  try {
    const json = (await response.json()) as { message?: string };
    if (json.message) {
      return json.message;
    }
  } catch {
    // JSON 解析失败，使用默认消息
  }

  const status = response.status;
  if (status === 429) {
    return apiKey
      ? "速率限制或配额超限。请访问 https://context7.com/plans 升级计划以获取更高限制。"
      : "速率限制或配额超限。请访问 https://context7.com/dashboard 创建免费 API Key 以获取更高限制。";
  }
  if (status === 404) {
    return "您尝试访问的库不存在。请尝试使用不同的库 ID。";
  }
  if (status === 401) {
    return "无效的 API Key。请检查您的 API Key。API Key 应以 'ctx7sk' 前缀开头。";
  }
  return `请求失败，状态码 ${status}。请稍后重试。`;
}

// ============== 请求头生成 ==============

/**
 * 生成 Context7 API 请求头
 */
function generateHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Context7-Source": "mcp-search",
    "X-Context7-Server-Version": "0.9.1",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  return headers;
}

// ============== API 函数 ==============

/**
 * 搜索库
 * 将库名解析为 Context7 兼容的库 ID
 * @param query 用户问题（用于相关性排序）
 * @param libraryName 库名，如 "react"
 * @returns 搜索结果
 */
export async function searchLibraries(
  query: string,
  libraryName: string
): Promise<SearchResponse> {
  const apiKey = process.env.CONTEXT7_API_KEY;

  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/libs/search`);
    url.searchParams.set("query", query);
    url.searchParams.set("libraryName", libraryName);

    const headers = generateHeaders(apiKey);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorMessage = await parseErrorResponse(response, apiKey);
      console.error(`[Context7] ${errorMessage}`);
      return { results: [], error: errorMessage };
    }

    const searchData = await response.json();
    return searchData as SearchResponse;
  } catch (error) {
    const errorMessage = `搜索库时出错: ${error}`;
    console.error(`[Context7] ${errorMessage}`);
    return { results: [], error: errorMessage };
  }
}

/**
 * 获取库文档上下文
 * 查询库的文档和代码示例
 * @param libraryId 库 ID，如 "/facebook/react"
 * @param query 用户问题
 * @returns 文档内容
 */
export async function fetchLibraryContext(
  libraryId: string,
  query: string
): Promise<ContextResponse> {
  const apiKey = process.env.CONTEXT7_API_KEY;

  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/context`);
    url.searchParams.set("query", query);
    url.searchParams.set("libraryId", libraryId);

    const headers = generateHeaders(apiKey);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorMessage = await parseErrorResponse(response, apiKey);
      console.error(`[Context7] ${errorMessage}`);
      return { data: errorMessage };
    }

    const text = await response.text();
    if (!text) {
      return {
        data: "未找到该库的文档或文档尚未完成。这可能是因为您使用了无效的 Context7 兼容库 ID。要获取有效的 Context7 兼容库 ID，请先使用 'code_resolve' 工具搜索包名。",
      };
    }
    return { data: text };
  } catch (error) {
    const errorMessage = `获取库文档时出错，请稍后重试。${error}`;
    console.error(`[Context7] ${errorMessage}`);
    return { data: errorMessage };
  }
}

// ============== 格式化函数 ==============

/**
 * 格式化搜索结果为可读文本
 */
export function formatSearchResults(response: SearchResponse): string {
  if (!response.results || response.results.length === 0) {
    return response.error || "未找到匹配的库。";
  }

  const lines: string[] = [];

  response.results.forEach((result, index) => {
    lines.push(`## ${index + 1}. ${result.title}`);
    lines.push(`**库 ID**: ${result.id}`);
    lines.push(`**描述**: ${result.description}`);
    lines.push(`**代码片段数**: ${result.totalSnippets}`);
    
    if (result.benchmarkScore !== undefined) {
      lines.push(`**质量评分**: ${result.benchmarkScore}/100`);
    }
    
    if (result.trustScore !== undefined) {
      const reputation = result.trustScore >= 80 ? "高" : result.trustScore >= 50 ? "中" : "低";
      lines.push(`**可信度**: ${reputation} (${result.trustScore})`);
    }
    
    if (result.versions && result.versions.length > 0) {
      lines.push(`**可用版本**: ${result.versions.slice(0, 5).join(", ")}${result.versions.length > 5 ? "..." : ""}`);
    }
    
    lines.push("");
  });

  return lines.join("\n");
}

// ============== 工具定义 ==============

export const CODE_RESOLVE_TOOL: Tool = {
  name: "code_resolve",
  description: `将库名解析为 Context7 兼容的库 ID 并返回匹配的库列表。

在调用 'code_query' 工具之前，必须先调用此函数获取有效的 Context7 兼容库 ID，除非用户在查询中明确提供了 '/org/project' 或 '/org/project/version' 格式的库 ID。

每个结果包含：
- 库 ID: Context7 兼容标识符（格式: /org/project）
- 名称: 库或包名
- 描述: 简短摘要
- 代码片段数: 可用代码示例数量
- 可信度: 权威性指标（高、中、低或未知）
- 质量评分: 质量指标（100 为最高分）
- 版本: 可用版本列表

选择建议：
1. 分析查询以理解用户需要什么库/包
2. 根据以下因素返回最相关的匹配：
   - 名称与查询的相似度（优先精确匹配）
   - 描述与查询意图的相关性
   - 文档覆盖率（优先代码片段数较多的库）
   - 可信度（优先高或中等可信度的库）
   - 质量评分（越高越好）

响应格式：
- 在明确标记的部分返回选定的库 ID
- 简要说明选择该库的原因
- 如果有多个好的匹配，承认这一点但继续使用最相关的那个
- 如果没有好的匹配，明确说明并建议优化查询

重要提示：每个问题最多调用此工具 3 次。如果 3 次调用后仍未找到所需内容，请使用已有的最佳结果。`,
  annotations: {
    readOnlyHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "您需要帮助的问题或任务。用于按相关性对库结果进行排序。不要在查询中包含任何敏感或机密信息，如 API Key、密码、凭据、个人数据或专有代码。",
      },
      libraryName: {
        type: "string",
        description: "要搜索并获取 Context7 兼容库 ID 的库名。",
      },
    },
    required: ["query", "libraryName"],
  },
};

export const CODE_QUERY_TOOL: Tool = {
  name: "code_query",
  description: `从 Context7 检索和查询任何编程库或框架的最新文档和代码示例。

必须先调用 'code_resolve' 工具获取准确的 Context7 兼容库 ID，除非用户在查询中明确提供了 '/org/project' 或 '/org/project/version' 格式的库 ID。

重要提示：每个问题最多调用此工具 3 次。如果 3 次调用后仍未找到所需内容，请使用已有的最佳信息。`,
  annotations: {
    readOnlyHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      libraryId: {
        type: "string",
        description:
          "准确的 Context7 兼容库 ID（例如 '/mongodb/docs'、'/vercel/next.js'、'/supabase/supabase'、'/vercel/next.js/v14.3.0-canary.87'），从 'code_resolve' 获取或直接从用户查询中以 '/org/project' 或 '/org/project/version' 格式提供。",
      },
      query: {
        type: "string",
        description:
          "您需要帮助的问题或任务。请具体并包含相关细节。好的示例：'如何在 Express.js 中使用 JWT 设置身份验证' 或 'React useEffect 清理函数示例'。不好的示例：'auth' 或 'hooks'。不要在查询中包含任何敏感或机密信息。",
      },
    },
    required: ["libraryId", "query"],
  },
};

// ============== 类型守卫 ==============

export function isCodeResolveArgs(args: unknown): args is {
  query: string;
  libraryName: string;
} {
  return (
    typeof args === "object" &&
    args !== null &&
    "query" in args &&
    typeof (args as { query: string }).query === "string" &&
    "libraryName" in args &&
    typeof (args as { libraryName: string }).libraryName === "string"
  );
}

export function isCodeQueryArgs(args: unknown): args is {
  libraryId: string;
  query: string;
} {
  return (
    typeof args === "object" &&
    args !== null &&
    "libraryId" in args &&
    typeof (args as { libraryId: string }).libraryId === "string" &&
    "query" in args &&
    typeof (args as { query: string }).query === "string"
  );
}
