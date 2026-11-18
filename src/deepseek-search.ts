/**
 * DeepSeek 搜索模块 - deepseek_search 工具
 *
 * 直连 DeepSeek 自研搜索 API（POST https://api.deepseek.com/v1/tools/search）。
 *
 * 计费口径（官方文档 api-docs.deepseek.com/guides/search 已核实）：
 * - 按「成功请求」计费，$0.75 / 1000 次 ≈ 0.005 元/次
 * - 与返回条数、正文字数无关；count 只控制返回几条，不影响价格
 * - 失败 / 空结果 / 超时不收费
 * - 只有「模型通过服务端 web tools 调用」才不计搜索费（需付 token）；
 *   本工具属于客户端直连，走按次计费
 *
 * 相比其他搜索源的结构性优势：
 * - rerank_score (0-3)：相关性 + 权威度 + 时效性的综合分，>=1.5 为高质量
 * - authority (0-4)：权威度分级，>=3 为高权威源（天然过滤 SEO 作弊与低质 AIGC）
 * - summary (600-800 字)：面向模型撰写的长摘要，可直接据此判断是否值得 urls_read
 */
import {
  DEEPSEEK_API_KEY,
  DEEPSEEK_API_HOST,
  DEEPSEEK_SEARCH_TIMEOUT_MS,
  DEEPSEEK_SUMMARY_MAX_LENGTH,
} from "./config.js";
import { logMessage } from "./logging.js";
import { Server } from "@modelcontextprotocol/server";

/** 单个搜索结果（基础字段与 web_search 对齐，额外带 DeepSeek 独有评分） */
export interface DeepseekSearchResultItem {
  title: string;
  link: string;
  snippet: string;
  publishedDate?: string;
  /** 相关性综合分 0-3，>=1.5 为高质量 */
  rerankScore?: number;
  /** 权威度 0-4，>=3 为高权威源；-1 表示未知 */
  authority?: number;
  siteName?: string;
}

/** DeepSeek Search API 原始响应 */
interface DeepseekSearchResponse {
  results?: Array<{
    rerank_score?: number;
    title?: string;
    url?: string;
    snippet?: string;
    summary?: string;
    content?: string;
    site_name?: string | null;
    site_icon?: string | null;
    date?: string | null;
    authority?: number;
  }>;
}

/** 搜索可选过滤条件（会被拼成 DeepSeek query 操作符） */
export interface DeepseekSearchFilters {
  site?: string;
  /** day / month / year，转为 after: 日期 */
  time_range?: string;
  /** 语言代码，如 zh / en，可逗号分隔多个 */
  lang?: string;
}

/** API 限制：query 1-128 Unicode 字符 */
const QUERY_MAX_LENGTH = 128;

/**
 * time_range → after: 日期（YYYY-MM-DD）。
 * DeepSeek 没有独立的 time_range 字段，只支持 after: / before: 操作符。
 */
function timeRangeToAfterDate(timeRange: string | undefined, now: Date): string | null {
  const days = timeRange === "day" ? 1 : timeRange === "month" ? 30 : timeRange === "year" ? 365 : 0;
  if (days === 0) return null;

  const target = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return target.toISOString().slice(0, 10);
}

/**
 * 把过滤条件拼成 DeepSeek 支持的 query 操作符。
 * 操作符会占用 query 的 128 字符配额，因此超出时优先截断原始关键词、保留操作符
 * （操作符是硬过滤条件，关键词被截断只是召回变宽，语义损失更小）。
 */
export function buildDeepseekQuery(
  query: string,
  filters: DeepseekSearchFilters = {},
  now: Date = new Date()
): string {
  const operators: string[] = [];

  if (filters.site && filters.site.trim() !== "") {
    operators.push(`site:${filters.site.trim()}`);
  }

  if (filters.lang && filters.lang.trim() !== "" && filters.lang.trim().toLowerCase() !== "all") {
    operators.push(`lang:${filters.lang.trim().toLowerCase()}`);
  }

  const afterDate = timeRangeToAfterDate(filters.time_range, now);
  if (afterDate) {
    operators.push(`after:${afterDate}`);
  }

  const suffix = operators.length > 0 ? ` ${operators.join(" ")}` : "";
  const budget = QUERY_MAX_LENGTH - suffix.length;

  if (budget <= 0) {
    // 操作符本身已吃满配额，只能放弃原始关键词（实际不可能发生，操作符长度远小于 128）
    return suffix.trim().slice(0, QUERY_MAX_LENGTH);
  }

  return `${query.trim().slice(0, budget)}${suffix}`.trim();
}

/**
 * 执行一次 DeepSeek 搜索（单关键词）。
 * 失败返回 { error }，由调用方决定如何提示（不中断服务，agent 可换其他工具）。
 */
export async function deepseekSearch(
  server: Server,
  query: string,
  count: number = 10,
  filters: DeepseekSearchFilters = {}
): Promise<{
  keyword: string;
  appliedQuery: string;
  results: DeepseekSearchResultItem[];
  error?: string;
}> {
  const appliedQuery = buildDeepseekQuery(query, filters);

  if (!DEEPSEEK_API_KEY) {
    return {
      keyword: query,
      appliedQuery,
      results: [],
      error: "DEEPSEEK_API_KEY 未配置，无法使用 deepseek_search",
    };
  }

  if (!query || query.trim() === "") {
    return {
      keyword: query,
      appliedQuery,
      results: [],
      error: "搜索关键词不能为空",
    };
  }

  const url = `${DEEPSEEK_API_HOST.replace(/\/$/, "")}/v1/tools/search`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEEPSEEK_SEARCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
        },
        // 不拉 content：summary 已足够 agent 判断相关性，content 会让响应体膨胀数倍
        body: JSON.stringify({ query: appliedQuery, count }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const hint = response.status === 402
        ? "（账户余额不足，请先充值）"
        : response.status === 429
          ? "（触发 QPS 限流）"
          : "";
      return {
        keyword: query,
        appliedQuery,
        results: [],
        error: `DeepSeek 搜索 HTTP ${response.status}${hint}: ${bodyText.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as DeepseekSearchResponse;

    const results: DeepseekSearchResultItem[] = (data.results || [])
      .filter((r) => r.url)
      .slice(0, count)
      .map((r) => {
        // summary 面向模型撰写（600-800字），信息量远大于 snippet（100-200字）；
        // 优先用 summary 并截断，避免单条结果吃掉过多上下文。
        const snippetSource = r.summary || r.snippet || "";
        return {
          title: r.title || "",
          link: r.url || "",
          snippet: snippetSource.length > DEEPSEEK_SUMMARY_MAX_LENGTH
            ? snippetSource.slice(0, DEEPSEEK_SUMMARY_MAX_LENGTH) + "..."
            : snippetSource,
          publishedDate: r.date || undefined,
          rerankScore: typeof r.rerank_score === "number" ? r.rerank_score : undefined,
          authority: typeof r.authority === "number" ? r.authority : undefined,
          siteName: r.site_name || undefined,
        };
      });

    logMessage(server, "info", `DeepSeek 搜索完成: "${appliedQuery}" 返回 ${results.length} 条`);

    return { keyword: query, appliedQuery, results };
  } catch (error: any) {
    const isTimeout = error?.name === "AbortError";
    return {
      keyword: query,
      appliedQuery,
      results: [],
      error: isTimeout
        ? `DeepSeek 搜索超时(${DEEPSEEK_SEARCH_TIMEOUT_MS}ms)`
        : `DeepSeek 搜索失败: ${error?.message || String(error)}`,
    };
  }
}
