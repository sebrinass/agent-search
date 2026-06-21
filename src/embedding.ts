/**
 * 混合检索模块 - RRF 融合 MiniSearch(BM25+) + 语义嵌入
 * 
 * 核心算法：RRF (Reciprocal Rank Fusion)
 * RRF_score(d) = Σ 1/(k + rank(d))
 * - k = 60（业界标准，无需调参）
 * - 只看排名，不看分数，天然解决量纲问题
 * 
 * 支持 OpenAI 兼容 API：
 * - OpenAI (text-embedding-3-small/large)
 * - Ollama (nomic-embed-text, mxbai-embed-large)
 * - Jina (jina-embeddings-v5)
 * - 任何 OpenAI 兼容服务
 */

import MiniSearch from 'minisearch';
import { embeddingCache } from './cache.js';
import {
  EMBEDDING_API_KEY,
  EMBEDDING_BASE_URL,
  EMBEDDING_MODEL,
  TOP_K,
  RRF_K,
  isEmbeddingEnabled,
  EMBEDDING_TIMEOUT_MS
} from './config.js';
import { logMessage } from './logging.js';

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

// ============ CJK 分词器 ============
function cjkTokenizer(text: string): string[] {
  if (!text) return [];
  
  const tokens: string[] = [];
  const cjkRegex = /[\u4e00-\u9fff]/;
  const wordRegex = /[a-zA-Z0-9]+/g;
  
  const lowerText = text.toLowerCase();
  const parts = lowerText.split(/[\s\p{P}]+/u).filter(Boolean);
  
  for (const part of parts) {
    const cjkChars = part.split('').filter(c => cjkRegex.test(c));
    const nonCjkMatch = part.match(wordRegex);
    
    if (nonCjkMatch) {
      tokens.push(...nonCjkMatch);
    }
    
    for (let i = 0; i < cjkChars.length - 1; i++) {
      tokens.push(cjkChars[i] + cjkChars[i + 1]);
    }
    
    if (cjkChars.length > 0) {
      tokens.push(...cjkChars);
    }
  }
  
  return tokens;
}

// ============ MiniSearch 检索 ============
function miniSearchRetrieve(
  query: string,
  results: SearchResult[]
): { result: SearchResult; score: number; rank: number }[] {
  if (results.length === 0) return [];
  
  const miniSearch = new MiniSearch({
    fields: ['title', 'content'],
    storeFields: ['title', 'content', 'url', 'score'],
    tokenize: cjkTokenizer,
    searchOptions: {
      tokenize: cjkTokenizer,
      prefix: true,
      fuzzy: 0.2,
      boost: { title: 2 }
    }
  });
  
  results.forEach((result, index) => {
    miniSearch.add({
      id: index,
      title: result.title,
      content: result.content,
      url: result.url,
      score: result.score
    });
  });
  
  const searchResults = miniSearch.search(query);
  const limitedResults = searchResults.slice(0, results.length);
  const resultMap = new Map<string, SearchResult>();
  results.forEach(r => resultMap.set(r.url, r));
  
  return limitedResults.map((item, rank) => ({
    result: resultMap.get(item.url) || results[item.id as number],
    score: item.score,
    rank: rank + 1
  }));
}

// ============ Jina v5 Task LoRA 前缀 ============

/** 检测是否为 Jina v5 模型（需要 Task LoRA 前缀） */
let _jinaV5Detected: boolean | null = null;
function isJinaV5(): boolean {
  if (_jinaV5Detected === null) {
    const model = EMBEDDING_MODEL.toLowerCase();
    _jinaV5Detected = model.includes('jina') && model.includes('v5');
    if (_jinaV5Detected) {
      logMessage(null, 'info', `Jina v5 Task LoRA: 已激活 (模型: ${EMBEDDING_MODEL}，Query/Document 前缀自动添加)`);
    }
  }
  return _jinaV5Detected;
}

/** 为 Jina v5 添加 Task LoRA 前缀 */
function applyTaskLoRAPrefix(text: string, type: 'query' | 'document'): string {
  if (!isJinaV5()) return text;
  return type === 'query' ? `Query: ${text}` : `Document: ${text}`;
}

// ============ 嵌入文本最大长度 ============
/** 发送给嵌入 API 的文本最大字符数，超出部分截断 */
const EMBEDDING_MAX_TEXT_LENGTH = 800;

// ============ OpenAI 兼容 API 嵌入 ============
async function getOpenAIEmbedding(text: string, type: 'query' | 'document' = 'query'): Promise<number[]> {
  if (!text || text.trim() === '') {
    return [];
  }

  // 文本截断：在添加 Task LoRA 前缀之前截断，避免超长文本浪费 token
  if (text.length > EMBEDDING_MAX_TEXT_LENGTH) {
    text = text.slice(0, EMBEDDING_MAX_TEXT_LENGTH);
  }

  // Jina v5 Task LoRA: 自动添加前缀
  const prefixedText = applyTaskLoRAPrefix(text, type);

  const cached = embeddingCache.get(text);
  if (cached) {
    return Array.from(cached);
  }

  let baseUrl = EMBEDDING_BASE_URL;
  if (baseUrl && !baseUrl.includes('/v1')) {
    baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
  }
  
  const endpoint = baseUrl 
    ? `${baseUrl}/embeddings`
    : 'https://api.openai.com/v1/embeddings';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (EMBEDDING_API_KEY) {
    headers['Authorization'] = `Bearer ${EMBEDDING_API_KEY}`;
  }

  // 429 重试：最多重试3次，指数退避（1秒、2秒、4秒）
  const MAX_429_RETRIES = 3;

  try {
    let response!: Response;

    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: prefixedText,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // 429 限流：指数退避重试
      if (response.status === 429 && attempt < MAX_429_RETRIES) {
        const waitMs = 1000 * Math.pow(2, attempt); // 1秒、2秒、4秒
        logMessage(null, 'info', `嵌入 API 限流(429)，第${attempt + 1}次重试，等待${waitMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }

      // 非429或已达到最大重试次数，跳出循环
      break;
    }

    if (!response.ok) {
      const errorText = await response.text();
      logMessage(null, 'error', `Embedding API error: ${response.status} ${response.statusText} - ${errorText}`);
      return [];
    }

    const data = await response.json() as {
      data?: Array<{ embedding?: number[] }>
    };

    const embedding = data.data?.[0]?.embedding;

    if (!embedding || embedding.length === 0) {
      logMessage(null, 'error', 'No embedding returned from API');
      return [];
    }

    embeddingCache.set(text, embedding);

    return embedding;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logMessage(null, 'warning', `⚠️ 嵌入模型超时(${EMBEDDING_TIMEOUT_MS}ms)，已降级为纯文本检索`);
      return [];
    }
    logMessage(null, 'error', `Error getting embedding: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export async function getEmbedding(text: string, type: 'query' | 'document' = 'query'): Promise<number[]> {
  return getOpenAIEmbedding(text, type);
}

// ============ 批量嵌入 ============
/**
 * 批量调用嵌入 API - 一次 HTTP 请求处理多条文本
 * 性能优化：减少 HTTP 请求次数，让 Ollama 内部做 GPU batch forward
 * 关键优势：30 条文档从 30 次请求 → 1 次请求
 */
async function getOpenAIEmbeddings(
  texts: string[],
  type: 'query' | 'document' = 'document'
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  // 文本截断 + Jina v5 Task LoRA 前缀
  const prepared = texts.map(t => {
    let txt = t || '';
    if (txt.length > EMBEDDING_MAX_TEXT_LENGTH) {
      txt = txt.slice(0, EMBEDDING_MAX_TEXT_LENGTH);
    }
    return applyTaskLoRAPrefix(txt, type);
  });

  // 缓存检查：分离已缓存和未缓存的
  const cacheKeys = texts; // 缓存 key 用原始文本（不含前缀，避免前缀变化导致缓存失效）
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const uncachedIndices: number[] = [];
  const uncachedInputs: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const cached = embeddingCache.get(cacheKeys[i]);
    if (cached) {
      results[i] = Array.from(cached);
    } else {
      uncachedIndices.push(i);
      uncachedInputs.push(prepared[i]);
    }
  }

  if (uncachedInputs.length === 0) {
    return results as number[][];
  }

  let baseUrl = EMBEDDING_BASE_URL;
  if (baseUrl && !baseUrl.includes('/v1')) {
    baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
  }

  const endpoint = baseUrl
    ? `${baseUrl}/embeddings`
    : 'https://api.openai.com/v1/embeddings';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (EMBEDDING_API_KEY) {
    headers['Authorization'] = `Bearer ${EMBEDDING_API_KEY}`;
  }

  const MAX_429_RETRIES = 3;

  try {
    let response!: Response;

    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: uncachedInputs, // 一次发送多条
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429 && attempt < MAX_429_RETRIES) {
        const waitMs = 1000 * Math.pow(2, attempt);
        logMessage(null, 'info', `嵌入 API 限流(429)，批量请求第${attempt + 1}次重试，等待${waitMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }

      break;
    }

    if (!response.ok) {
      const errorText = await response.text();
      logMessage(null, 'error', `Embedding API batch error: ${response.status} ${response.statusText} - ${errorText}`);
      return results.map(r => r || []);
    }

    const data = await response.json() as {
      data?: Array<{ embedding?: number[] }>
    };

    if (!data.data || data.data.length !== uncachedInputs.length) {
      logMessage(null, 'error', `Embedding API batch: 期望 ${uncachedInputs.length} 个向量，实际返回 ${data.data?.length || 0}`);
      return results.map(r => r || []);
    }

    // 填回结果 + 写缓存
    for (let i = 0; i < uncachedIndices.length; i++) {
      const vec = data.data[i].embedding;
      if (vec && vec.length > 0) {
        results[uncachedIndices[i]] = vec;
        embeddingCache.set(cacheKeys[uncachedIndices[i]], vec);
      }
    }

    return results as number[][];
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logMessage(null, 'warning', `⚠️ 批量嵌入超时(${EMBEDDING_TIMEOUT_MS}ms)，已降级为纯文本检索`);
      return results.map(r => r || []);
    }
    logMessage(null, 'error', `Error batch getting embeddings: ${error instanceof Error ? error.message : String(error)}`);
    return results.map(r => r || []);
  }
}

export async function getEmbeddings(
  texts: string[],
  type: 'query' | 'document' = 'document'
): Promise<number[][]> {
  return getOpenAIEmbeddings(texts, type);
}

// ============ 余弦相似度 ============
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }
  
  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);
  
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }
  
  return dotProduct / (magnitudeA * magnitudeB);
}

// ============ 并发控制 ============
/**
 * 限制异步任务的并发数
 * 使用信号量模式，最多同时运行 limit 个任务
 */
async function limitConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0; // 下一个待执行的任务索引

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  // 启动 limit 个工作协程，它们会自行从队列中取任务
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ============ 语义检索 ============
async function semanticRetrieve(
  query: string,
  results: SearchResult[]
): Promise<{ result: SearchResult; score: number; rank: number }[]> {
  const queryEmbedding = await getEmbedding(query, 'query');

  if (queryEmbedding.length === 0) {
    return results.map((result, rank) => ({
      result,
      score: 0,
      rank: rank + 1
    }));
  }

  // 批量嵌入：一次 HTTP 请求发送所有文档，让 Ollama 内部做 GPU batch forward
  // 性能优化：30 条文档从 30 次请求 → 1 次请求
  const docTexts = results.map(result => `${result.title} ${result.content}`);
  const docEmbeddings = await getEmbeddings(docTexts, 'document');

  const scored: { result: SearchResult; score: number }[] = results.map((result, i) => {
    const docEmbedding = docEmbeddings[i];
    if (!docEmbedding || docEmbedding.length === 0) {
      return { result, score: 0 };
    }
    const score = cosineSimilarity(queryEmbedding, docEmbedding);
    return { result, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.map((item, rank) => ({
    result: item.result,
    score: item.score,
    rank: rank + 1
  }));
}

// ============ RRF 融合 ============
function rrfFusion(
  bm25Results: { result: SearchResult; score: number; rank: number }[],
  semanticResults: { result: SearchResult; score: number; rank: number }[]
): ScoredResult[] {
  const bm25RankMap = new Map<string, number>();
  const semanticRankMap = new Map<string, number>();
  const resultMap = new Map<string, SearchResult>();
  
  for (const item of bm25Results) {
    bm25RankMap.set(item.result.url, item.rank);
    resultMap.set(item.result.url, item.result);
  }
  
  for (const item of semanticResults) {
    semanticRankMap.set(item.result.url, item.rank);
    resultMap.set(item.result.url, item.result);
  }
  
  const fusedResults: ScoredResult[] = [];
  
  for (const [url, result] of resultMap) {
    const bm25Rank = bm25RankMap.get(url) || Infinity;
    const semanticRank = semanticRankMap.get(url) || Infinity;
    
    let rrfScore = 0;
    
    if (bm25Rank !== Infinity) {
      rrfScore += 1 / (RRF_K + bm25Rank);
    }
    
    if (semanticRank !== Infinity) {
      rrfScore += 1 / (RRF_K + semanticRank);
    }
    
    fusedResults.push({
      ...result,
      rrfScore,
      bm25Rank: bm25Rank === Infinity ? 0 : bm25Rank,
      semanticRank: semanticRank === Infinity ? 0 : semanticRank
    });
  }
  
  fusedResults.sort((a, b) => b.rrfScore - a.rrfScore);
  
  return fusedResults;
}

// ============ 主函数 ============
/**
 * 混合检索重排序
 * 自动根据 isEmbeddingEnabled 决定检索策略：
 * - 已配置嵌入模型 → BM25+语义 RRF 融合
 * - 未配置 → 仅 BM25
 */
export async function rerankWithHybridSearch(
  query: string,
  results: SearchResult[]
): Promise<ScoredResult[]> {
  if (results.length <= TOP_K) {
    return results.map((result, index) => ({
      ...result,
      rrfScore: results.length - index,
      bm25Rank: index + 1,
      semanticRank: index + 1
    }));
  }

  // 未配置嵌入模型，仅使用 BM25 检索
  if (!isEmbeddingEnabled) {
    const bm25Results = miniSearchRetrieve(query, results);
    return bm25Results.slice(0, TOP_K).map(item => ({
      ...item.result,
      rrfScore: 1 / (RRF_K + item.rank),
      bm25Rank: item.rank,
      semanticRank: 0
    }));
  }

  // 已配置嵌入模型，使用 BM25+语义 RRF 融合
  const [bm25Results, semanticResults] = await Promise.all([
    Promise.resolve(miniSearchRetrieve(query, results)),
    semanticRetrieve(query, results)
  ]);

  const fusedResults = rrfFusion(bm25Results, semanticResults);

  return fusedResults.slice(0, TOP_K);
}
