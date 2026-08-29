/**
 * MiniMax 搜索模块 - minimax_search 工具
 *
 * 直接调用 MiniMax Coding Plan 的 /v1/coding_plan/search 端点。
 * 返回字段（organic[]: title/link/snippet/date）与本地管道天然对齐。
 * 商业搜索排序，直接返回原排序，不做 rerank。
 */
import {
  MINIMAX_API_KEY,
  MINIMAX_API_HOST,
  MINIMAX_SEARCH_TIMEOUT_MS,
} from "./config.js";
import { logMessage } from "./logging.js";
import { Server } from "@modelcontextprotocol/server";

/** 单个搜索结果的接口（与 web_search 的 SearchResultItem 对齐） */
export interface MinimaxSearchResultItem {
  title: string;
  link: string;
  snippet: string;
  publishedDate?: string;
}

/** MiniMax 搜索的原始响应结构 */
interface MinimaxSearchResponse {
  organic?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    date?: string;
  }>;
  related_searches?: Array<{ query?: string }>;
  base_resp?: {
    status_code: number;
    status_msg?: string;
  };
}

/**
 * 执行一次 MiniMax 搜索（单关键词）。
 * 失败时返回 { error }，由调用方决定如何提示（不中断服务，agent 可换其他工具）。
 */
export async function minimaxSearch(
  server: Server,
  query: string,
  count: number = 10
): Promise<{
  keyword: string;
  results: MinimaxSearchResultItem[];
  related?: string[];
  error?: string;
}> {
  if (!MINIMAX_API_KEY) {
    return {
      keyword: query,
      results: [],
      error: "MINIMAX_API_KEY 未配置，无法使用 minimax_search",
    };
  }

  if (!query || query.trim() === "") {
    return {
      keyword: query,
      results: [],
      error: "搜索关键词不能为空",
    };
  }

  const url = `${MINIMAX_API_HOST}/v1/coding_plan/search`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MINIMAX_SEARCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${MINIMAX_API_KEY}`,
          "MM-API-Source": "Minimax-MCP",
        },
        body: JSON.stringify({ q: query }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      return {
        keyword: query,
        results: [],
        error: `MiniMax 搜索 HTTP ${response.status}: ${bodyText.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as MinimaxSearchResponse;

    if (data.base_resp && data.base_resp.status_code !== 0) {
      return {
        keyword: query,
        results: [],
        error: `MiniMax 搜索 API 错误 ${data.base_resp.status_code}: ${data.base_resp.status_msg || ""}`,
      };
    }

    const results: MinimaxSearchResultItem[] = (data.organic || [])
      .filter((r) => r.link)
      .slice(0, count)
      .map((r) => ({
        title: r.title || "",
        link: r.link || "",
        snippet: r.snippet || r.snippet || "",
        publishedDate: r.date || undefined,
      }));

    const related = (data.related_searches || [])
      .map((r) => r.query)
      .filter((q): q is string => !!q)
      .slice(0, 5);

    logMessage(server, "info", `MiniMax 搜索完成: "${query}" 返回 ${results.length} 条`);

    return { keyword: query, results, related };
  } catch (error: any) {
    const isTimeout = error?.name === "AbortError";
    return {
      keyword: query,
      results: [],
      error: isTimeout
        ? `MiniMax 搜索超时(${MINIMAX_SEARCH_TIMEOUT_MS}ms)`
        : `MiniMax 搜索失败: ${error?.message || String(error)}`,
    };
  }
}