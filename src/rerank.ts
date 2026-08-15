/**
 * 重排模块 - cross-encoder rerank
 *
 * 唯一策略：调用 RERANK_BASE_URL 的 /rerank 端点对候选做相关性重排。
 * API 失败时降级为 SearXNG 原始排序，保证搜索不中断。
 *
 * Rerank API 协议：Jina/Cohere/SiliconFlow/Together/本地推理服务 通用 /rerank 端点
 *   请求：{ model, query, documents: string[], top_n }
 *   响应：{ results: [{ index, relevance_score }] }
 */

import {
  RERANK_BASE_URL,
  RERANK_API_KEY,
  RERANK_MODEL,
  RERANK_TIMEOUT_MS,
  RERANK_MAX_TEXT_LENGTH,
  RERANK_MIN_SCORE_RATIO,
  RERANK_MIN_SCORE,
  isRerankEnabled,
  TOP_K,
} from './config.js';
import { logMessage } from './logging.js';
import { rerankCache } from './cache.js';

// ============ 类型定义 ============
export interface SearchResult {
  title: string;
  content: string;
  url: string;
  score: number;
  publishedDate?: string;
}

export interface ScoredResult extends SearchResult {
  rrfScore: number;
  bm25Rank: number;
  semanticRank: number;
}

// ============ SearXNG 原始排序降级 ============
function fallbackToOriginal(results: SearchResult[]): ScoredResult[] {
  return results.slice(0, TOP_K).map((result, index) => ({
    ...result,
    rrfScore: results.length - index,
    bm25Rank: index + 1,
    semanticRank: 0,
  }));
}

// ============ 短路：候选数 <= TOP_K ============
function passThrough(results: SearchResult[]): ScoredResult[] {
  return results.map((result, index) => ({
    ...result,
    rrfScore: results.length - index,
    bm25Rank: index + 1,
    semanticRank: index + 1,
  }));
}

// ============ Rerank API 调用 ============
interface RerankApiResponse {
  results?: Array<{ index?: number; relevance_score?: number }>;
}

async function callRerankApi(query: string, documents: string[], topN: number): Promise<RerankApiResponse | null> {
  let baseUrl = RERANK_BASE_URL;
  if (baseUrl && !baseUrl.includes('/v1')) {
    baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
  }

  const endpoint = baseUrl ? `${baseUrl}/rerank` : 'https://api.jina.ai/v1/rerank';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (RERANK_API_KEY) {
    headers['Authorization'] = `Bearer ${RERANK_API_KEY}`;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: RERANK_MODEL,
          query,
          documents,
          top_n: topN,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text();
      logMessage(null, 'error', `Rerank API error: ${response.status} ${response.statusText} - ${errorText}`);
      return null;
    }

    return await response.json() as RerankApiResponse;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logMessage(null, 'warning', `⚠️ Rerank API 超时(${RERANK_TIMEOUT_MS}ms)，已降级为 SearXNG 原始排序`);
      return null;
    }
    logMessage(null, 'error', `Error calling rerank API: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// ============ 纯 cross-encoder rerank ============
/**
 * 拼装发送给 rerank API 的文档文本。
 * cross-encoder 计算量正比于输入长度，且模型自带 max sequence length，
 * 发超长正文会被模型内部截断，纯属浪费。故：
 * - title 完整保留（对相关性判断权重最大）
 * - content 截前 RERANK_MAX_TEXT_LENGTH 字符
 * - 不再对拼接结果整体截断（避免长标题挤掉正文额度）
 */
function buildRerankDocument(result: SearchResult): string {
  const title = result.title ?? '';
  const content = (result.content ?? '').slice(0, RERANK_MAX_TEXT_LENGTH);
  return `${title} ${content}`.trim();
}

// ============ 相对阈值过滤 ============
/**
 * 动态剔除低分结果，双保险：
 * 1. 相对阈值：真实分数低于「最高分 × RERANK_MIN_SCORE_RATIO」的剔除
 *    （解决"不同模型分数分布不同"，跟自己的最高分比，跨模型稳定）
 * 2. 绝对下限：真实分数低于 RERANK_MIN_SCORE 的直接剔除
 *    （解决"搜索结果整体稀烂时矮子里拔高个"，保证绝对相关性）
 * 两条都过了才算合格（取两者中更严格的那个）。
 * - 只作用于真实分数条目；兜底补齐条目（rrfScore=0，无真实分数）不参与过滤
 * - 至少保底 1 条（最高分那条），避免全部过滤光
 * - RERANK_MIN_SCORE_RATIO<=0 且 RERANK_MIN_SCORE<=0 时关闭过滤
 */
function applyScoreFilter(scored: ScoredResult[]): ScoredResult[] {
  const filteringDisabled = RERANK_MIN_SCORE_RATIO <= 0 && RERANK_MIN_SCORE <= 0;
  if (filteringDisabled || scored.length <= 1) {
    return scored;
  }

  // 区分真实分数条目与兜底补齐条目
  const realHits = scored.filter(s => s.rrfScore > 0);
  if (realHits.length === 0) {
    return scored; // 全是兜底/伪分数，无从过滤
  }

  const maxScore = Math.max(...realHits.map(s => s.rrfScore));
  // 双保险取更严格的那个
  const relativeThreshold = maxScore * RERANK_MIN_SCORE_RATIO;
  const threshold = Math.max(relativeThreshold, RERANK_MIN_SCORE);
  const kept = realHits.filter(s => s.rrfScore >= threshold);

  // 保底：过滤后为空则保留最高分那条
  const filtered = kept.length > 0 ? kept : [realHits[0]];
  const fallbacks = scored.filter(s => s.rrfScore === 0);

  return [...filtered, ...fallbacks];
}

async function rerankWithCrossEncoder(query: string, results: SearchResult[]): Promise<ScoredResult[]> {
  // 拼装文档文本：title 完整 + content 截断
  const documents = results.map(buildRerankDocument);

  // 缓存命中：同一 query + 同一批 URL 直接返回，避免重复推理
  const docUrls = results.map(r => r.url);
  const cached = rerankCache.get(query, docUrls);
  if (cached) {
    logMessage(null, 'info', `Rerank 缓存命中（query: "${query}"）`);
    return applyScoreFilter(cached as ScoredResult[]).slice(0, TOP_K);
  }

  const data = await callRerankApi(query, documents, TOP_K);

  // API 失败：降级到 SearXNG 原始排序
  if (!data || !data.results || data.results.length === 0) {
    logMessage(null, 'warning', 'Rerank API 返回空结果，降级为 SearXNG 原始排序');
    return fallbackToOriginal(results);
  }

  // 按 relevance_score 还原为 ScoredResult
  const scored: ScoredResult[] = [];
  for (const item of data.results) {
    const idx = item.index;
    const score = item.relevance_score ?? 0;
    if (typeof idx !== 'number' || idx < 0 || idx >= results.length) {
      continue;
    }
    scored.push({
      ...results[idx],
      rrfScore: score, // 复用字段承载 rerank 分数
      bm25Rank: 0,
      semanticRank: scored.length + 1,
    });
  }

  // 兜底：若返回不足，用未命中的候选按原顺序补齐到 TOP_K
  if (scored.length < Math.min(TOP_K, results.length)) {
    const seen = new Set(scored.map(s => s.url));
    for (const r of results) {
      if (scored.length >= TOP_K) break;
      if (!seen.has(r.url)) {
        scored.push({
          ...r,
          rrfScore: 0,
          bm25Rank: 0,
          semanticRank: scored.length + 1,
        });
      }
    }
  }

  // 动态剔除低分（相对阈值）
  const filtered = applyScoreFilter(scored);

  // 写入缓存（缓存全量结果，过滤在读取/返回时进行）
  rerankCache.set(query, docUrls, filtered);

  return filtered.slice(0, TOP_K);
}

// ============ 主入口 ============
/**
 * 重排结果 - cross-encoder rerank
 *
 * - rerank 启用 → 纯 cross-encoder rerank
 * - 未配置 rerank（仅 CLI 场景允许）→ SearXNG 原始排序（MCP 模式启动时已强制要求配置）
 * - API 调用失败 → 降级为 SearXNG 原始排序，不中断搜索
 */
export async function rerankResults(query: string, results: SearchResult[]): Promise<ScoredResult[]> {
  // 空结果
  if (results.length === 0) {
    return [];
  }

  // 短路：候选数不足，直接透传
  if (results.length <= TOP_K) {
    return passThrough(results);
  }

  // rerank 模式
  if (isRerankEnabled) {
    try {
      return await rerankWithCrossEncoder(query, results);
    } catch (error) {
      logMessage(null, 'error', `Rerank 异常，降级为 SearXNG 原始排序: ${error instanceof Error ? error.message : String(error)}`);
      return fallbackToOriginal(results);
    }
  }

  // 未配置 rerank：信任 SearXNG 原始排序（仅 CLI 宽松场景）
  return fallbackToOriginal(results);
}
