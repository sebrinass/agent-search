/**
 * Exa 搜索模块 - exa_search 工具
 *
 * 双模式：
 * 1. 配置了 EXA_API_KEY：直连 Exa HTTP API（POST https://api.exa.ai/search）
 *    - 返回 results[]: { title, url, publishedDate, author, score } 原排序
 * 2. 未配置 key：走 Exa 托管 MCP 匿名端点（https://mcp.exa.ai/mcp）
 *    - 匿名可用但有限流，返回结构各异；调用失败时返回 error，
 *      由 agent 自行切换其他搜索工具兜底（用户需求）
 */
import {
  EXA_API_KEY,
  EXA_SEARCH_TIMEOUT_MS,
} from "./config.js";
import { logMessage } from "./logging.js";
import { Server } from "@modelcontextprotocol/server";

/** 单个搜索结果的接口（与 web_search 的 SearchResultItem 对齐） */
export interface ExaSearchResultItem {
  title: string;
  link: string;
  snippet: string;
  publishedDate?: string;
}

/** Exa 直连模式原始响应（/v1/search） */
interface ExaSearchResponse {
  results?: Array<{
    title?: string | null;
    url?: string;
    publishedDate?: string;
    author?: string | null;
    score?: number;
    highlights?: string[];
    text?: string;
  }>;
  requestId?: string;
}

/** Exa 托管 MCP（streamable HTTP）匿名调用最小响应结构 */
interface ExaMcpResponse {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
  };
  jsonrpc?: string;
}

const EXA_MCP_ENDPOINT = "https://mcp.exa.ai/mcp";

/** 解析 streamable HTTP 的响应体（可能是 SSE 流或纯 JSON） */
async function parseStreamableResponse(resp: Response): Promise<any> {
  const contentType = resp.headers.get("content-type") || "";
  const raw = await resp.text();
  if (raw.trim() === "") return null;

  // SSE 流：event: message\ndata: {...}\n\n  → 取最后一个 data 行
  if (contentType.includes("text/event-stream") || raw.includes("event: message")) {
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    // 取最后一条 data（通常是完整响应）
    for (let i = dataLines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(dataLines[i]);
      } catch {
        // 继续向前找
      }
    }
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 从托管 MCP 返回的 text 里解析搜索结果（JSON 数组 或 Title:/URL:/Highlights: 行格式） */
function parseMcpText(raw: string): Array<{ title?: string; link?: string; snippet?: string; publishedDate?: string }> {
  const items: Array<{ title?: string; link?: string; snippet?: string; publishedDate?: string }> = [];

  // 先尝试 JSON
  try {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed
      : Array.isArray(parsed?.results) ? parsed.results
      : parsed?.data?.results ?? [];
    if (arr.length > 0) {
      for (const it of arr) {
        if (typeof it !== "object" || it === null) continue;
        const title = it.title ?? it.name ?? it.headline ?? "";
        const link = it.url ?? it.link ?? it.href ?? "";
        const snippet = it.snippet ?? it.summary ?? it.description ?? it.content ?? "";
        items.push({
          title: typeof title === "string" ? title : String(title),
          link: typeof link === "string" ? link : (link ? String(link) : ""),
          snippet: typeof snippet === "string" ? snippet : String(snippet || ""),
          publishedDate: it.publishedDate ?? it.date ?? undefined,
        });
      }
      return items.filter((i) => i.link);
    }
  } catch {
    // 不是 JSON，继续按文本行解析
  }

  // Exa 托管 MCP 实际返回的行格式：
  // Title: xxx\nURL: https://...\nPublished: 2026-...\nAuthor: N/A\nHighlights:\nxxx
  const blocks = raw.split(/\n(?=Title:)/g);
  for (const block of blocks) {
    const titleMatch = block.match(/^Title:\s*(.+)$/m);
    const urlMatch = block.match(/^URL:\s*(\S+)$/m);
    const dateMatch = block.match(/^Published:\s*(.+)$/m);
    const highlightsMatch = block.match(/^Highlights:\s*\n?([\s\S]*)$/m);
    if (!urlMatch) continue;
    items.push({
      title: titleMatch ? titleMatch[1].trim() : "",
      link: urlMatch ? urlMatch[1].trim() : "",
      snippet: highlightsMatch ? highlightsMatch[1].trim().slice(0, 500) : "",
      publishedDate: dateMatch ? dateMatch[1].trim() : undefined,
    });
  }

  return items.filter((i) => i.link);
}

/**
 * 模式 2：匿名走托管 MCP（有限流）。通过 streamable HTTP JSON-RPC 调 web_search_exa。
 */
async function searchViaHostedMcp(
  server: Server,
  query: string,
  numResults: number
): Promise<ExaSearchResultItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXA_SEARCH_TIMEOUT_MS);

  let sessionId: string | undefined;
  try {
    // 1) initialize
    const initResp = await fetch(EXA_MCP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "agent-search", version: "1.0.0" },
        },
      }),
      signal: controller.signal,
    });
    const initData = await parseStreamableResponse(initResp);
    sessionId = initData?.result?.sessionId;
    const serverCapabilities = initData?.result?.capabilities || {};
    const toolsAvailable = serverCapabilities?.tools !== undefined;

    // 2) tools/list（获取工具名，优先 web_search_exa）
    let toolName = "web_search_exa";
    if (toolsAvailable) {
      const toolsResp = await fetch(EXA_MCP_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
        signal: controller.signal,
      });
      const toolsData = await parseStreamableResponse(toolsResp);
      const names = ((toolsData?.result?.tools || []) as any[]).map((t: any) => t.name);
      if (names.includes("web_search_exa")) toolName = "web_search_exa";
      else if (names.length > 0) toolName = names[0];
    }

    // 3) tools/call
    const callResp = await fetch(EXA_MCP_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: toolName, arguments: { query, numResults } },
      }),
      signal: controller.signal,
    });
    const callData = (await parseStreamableResponse(callResp)) as ExaMcpResponse | null;
    const texts = (callData?.result?.content || [])
      .filter((c: { type?: string; text?: string }) => c?.type === "text" && c.text)
      .map((c: { type?: string; text?: string }) => c.text || "");

    const items: ExaSearchResultItem[] = [];
    for (const t of texts) {
      for (const it of parseMcpText(t)) {
        if (!it.link) continue;
        items.push({
          title: it.title || "",
          link: it.link,
          snippet: it.snippet || "",
          publishedDate: it.publishedDate || undefined,
        });
      }
    }
    return items.slice(0, numResults);
  } catch (error: any) {
    logMessage(server, "warning", `Exa 托管匿名搜索失败（可用 MINIMAX_API_KEY/EXA_API_KEY 换取更稳通道）: ${error?.message || error}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 执行一次 Exa 搜索（单关键词）。
 * 有 key 直连 HTTP API；无 key 走托管匿名通道。失败返回 { error }。
 */
export async function exaSearch(
  server: Server,
  query: string,
  count: number = 10
): Promise<{
  keyword: string;
  results: ExaSearchResultItem[];
  error?: string;
}> {
  if (!query || query.trim() === "") {
    return { keyword: query, results: [], error: "搜索关键词不能为空" };
  }

  // ---- 模式 1：有 key，直连 HTTP API ----
  if (EXA_API_KEY) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXA_SEARCH_TIMEOUT_MS);
    try {
      const resp = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${EXA_API_KEY}`,
        },
        body: JSON.stringify({
          query,
          numResults: count,
          type: "auto",
          contents: { highlights: true, numSentences: 2 },
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => "");
        return {
          keyword: query,
          results: [],
          error: `Exa 搜索 HTTP ${resp.status}: ${bodyText.slice(0, 200)}`,
        };
      }

      const data = (await resp.json()) as ExaSearchResponse;
      const results: ExaSearchResultItem[] = (data.results || []).map((r) => ({
        title: r.title || "",
        link: r.url || "",
        snippet: r.highlights?.join(" ") || (r.text ? r.text.slice(0, 250) : ""),
        publishedDate: r.publishedDate || undefined,
      }));

      logMessage(server, "info", `Exa 直连搜索完成: "${query}" 返回 ${results.length} 条`);
      return { keyword: query, results };
    } catch (error: any) {
      const isTimeout = error?.name === "AbortError";
      return {
        keyword: query,
        results: [],
        error: isTimeout
          ? `Exa 搜索超时(${EXA_SEARCH_TIMEOUT_MS}ms)`
          : `Exa 直连搜索失败: ${error?.message || String(error)}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---- 模式 2：无 key，托管匿名 ----
  logMessage(server, "info", `Exa 未配置 EXA_API_KEY，走托管匿名通道（可能限流）: "${query}"`);
  const results = await searchViaHostedMcp(server, query, count);
  if (results.length === 0) {
    return {
      keyword: query,
      results: [],
      error: "Exa 匿名通道无结果或限流。可在 EXA_API_KEY 填入免费 key 使用直连通道。",
    };
  }
  return { keyword: query, results };
}