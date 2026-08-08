/**
 * 重排路由模块 - 三选一自动路由
 *
 * 优先级：
 * 1. 配置了 RERANK_BASE_URL/RERANK_API_KEY → 纯 cross-encoder rerank
 * 2. 配置了 EMBEDDING_*                  → 复用 embedding.ts 的 BM25+语义 RRF 融合
 * 3. 都没配                              → 信任 SearXNG 原始排序，取前 TOP_K
 *
 * 任何一档失败均自动降级：返回 SearXNG 原始排序的前 TOP_K，保证搜索不中断。
 *
 * Rerank API 协议：Jina/Cohere/SiliconFlow/Together 通用 /rerank 端点
 *   请求：{ model, query, documents: string[], top_n }
 *   响应：{ results: [{ index, relevance_score }] }
 */

import {
  RERANK_BASE_URL,
  RERANK_API_KEY,
  RERANK_MODEL,
  RERANK_TIMEOUT_MS,
  RERANK_MAX_TEXT_LENGTH,
  isRerankEnabled,
  isEmbeddingEnabled,
  TOP_K,
} from './config.js';
import { logMessage } from './logging.js';
import { rerankCache } from './cache.js';
import { rerankWithHybridSearch, type SearchResult, type ScoredResult } from './embedding.js';

// 复用 embedding.ts 的类型，保持 research.ts 调用处类型不变
export type { SearchResult, ScoredResult };

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

  const MAX_429_RETRIES = 3;

  try {
    let response!: Response;

    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);

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

      clearTimeout(timeoutId);

      // 429 限流：指数退避重试
      if (response.status === 429 && attempt < MAX_429_RETRIES) {
        const waitMs = 1000 * Math.pow(2, attempt);
        logMessage(null, 'info', `Rerank API 限流(429)，第${attempt + 1}次重试，等待${waitMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }

      break;
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
 * - 总长封顶 RERANK_MAX_TEXT_LENGTH，与 embedding 双塔口径对齐
 */
function buildRerankDocument(result: SearchResult): string {
  const title = result.title ?? '';
  const content = (result.content ?? '').slice(0, RERANK_MAX_TEXT_LENGTH);
  return `${title} ${content}`.trim().slice(0, RERANK_MAX_TEXT_LENGTH);
}

async function rerankWithCrossEncoder(query: string, results: SearchResult[]): Promise<ScoredResult[]> {
  // 拼装文档文本：title 完整 + content 截断，与 embedding 双塔保持一致口径
  const documents = results.map(buildRerankDocument);

  // 缓存命中：同一 query + 同一批 URL 直接返回，避免重复烧模型
  const docUrls = results.map(r => r.url);
  const cached = rerankCache.get(query, docUrls);
  if (cached) {
    logMessage(null, 'info', `Rerank 缓存命中（query: "${query}"）`);
    return cached as ScoredResult[];
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

  // 写入缓存
  rerankCache.set(query, docUrls, scored);

  return scored.slice(0, TOP_K);
}

// ============ 主入口：三选一自动路由 ============
/**
 * 重排结果 - 根据配置自动选择策略
 *
 * 优先级：
 * 1. rerank 启用 → 纯 cross-encoder rerank
 * 2. embedding 启用 → BM25 + 语义 RRF 融合（复用 embedding.ts）
 * 3. 都没配 → SearXNG 原始排序
 *
 * 任何失败均降级为 SearXNG 原始排序，不中断搜索。
 */
export async function rerankResults(query: string, results: SearchResult[]): Promise<ScoredResult[]> {
  // 短路：候选数不足，直接透传
  if (results.length <= TOP_K) {
    return passThrough(results);
  }

  // 空结果
  if (results.length === 0) {
    return [];
  }

  // 1) rerank 模式
  if (isRerankEnabled) {
    try {
      return await rerankWithCrossEncoder(query, results);
    } catch (error) {
      logMessage(null, 'error', `Rerank 异常，降级为 SearXNG 原始排序: ${error instanceof Error ? error.message : String(error)}`);
      return fallbackToOriginal(results);
    }
  }

  // 2) embedding 混合模式（复用 embedding.ts，逻辑完全不变）
  if (isEmbeddingEnabled) {
    return await rerankWithHybridSearch(query, results);
  }

  // 3) 无模型：信任 SearXNG 原始排序
  return fallbackToOriginal(results);
}
