/**
 * 混合检索模块 - RRF 融合 BM25 + 语义嵌入
 * 
 * 核心算法：RRF (Reciprocal Rank Fusion)
 * RRF_score(d) = Σ 1/(k + rank(d))
 * - k = 60（业界标准，无需调参）
 * - 只看排名，不看分数，天然解决量纲问题
 */

import { embeddingCache } from './cache.js';

// ============ 环境变量配置 ============
const ENABLE_EMBEDDING = process.env.ENABLE_EMBEDDING !== 'false'; // 默认开启
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
const TOP_K = parseInt(process.env.TOP_K || '5', 10);
const RRF_K = 60; // RRF 常数，业界标准

// ============ 类型定义 ============
export interface SearchResult {
  title: string;
  content: string;
  url: string;
  score: number;
}

export interface ScoredResult extends SearchResult {
  rrfScore: number;
  bm25Rank: number;
  semanticRank: number;
}

// ============ Ollama 客户端 ============
let ollamaHost: string | null = null;

function getOllamaHost(): string {
  if (!ollamaHost) {
    ollamaHost = OLLAMA_HOST;
  }
  return ollamaHost;
}

// ============ 中文分词 ============
/**
 * 使用 Intl.Segmenter 进行中文分词
 * 支持中英文混合文本
 */
function tokenize(text: string): string[] {
  if (!text) return [];

  // 移除特殊字符，保留中文、英文、数字
  const cleanText = text.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, '');

  // 使用 Intl.Segmenter 进行分词（支持中英文混合）
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  const segments = segmenter.segment(cleanText);

  const tokens: string[] = [];
  for (const segment of segments) {
    if (segment.isWordLike) {
      tokens.push(segment.segment);
    }
  }

  return tokens;
}

// ============ BM25 相关计算 ============
/**
 * 计算词频 (TF)
 */
function calculateTF(tokens: string[], term: string): number {
  const termCount = tokens.filter(t => t === term).length;
  return tokens.length > 0 ? termCount / tokens.length : 0;
}

/**
 * 计算逆文档频率 (IDF)
 */
function calculateIDF(documents: string[][], term: string): number {
  const docsWithTerm = documents.filter(doc => doc.includes(term)).length;
  if (docsWithTerm === 0) return 0;
  return Math.log(documents.length / docsWithTerm);
}

/**
 * 计算 BM25 分数
 * 参数：k1 = 1.5, b = 0.75（业界标准）
 */
function calculateBM25(query: string, document: string, allDocuments: string[][]): number {
  const queryTerms = tokenize(query);
  const docTerms = tokenize(document);
  const docLength = docTerms.length;

  if (docLength === 0 || queryTerms.length === 0) return 0;

  // 计算平均文档长度
  const totalLength = allDocuments.reduce((sum, doc) => sum + doc.length, 0);
  const avgDocLength = totalLength / allDocuments.length;

  // BM25 参数
  const k1 = 1.5;
  const b = 0.75;

  let score = 0;

  for (const term of queryTerms) {
    const tf = calculateTF(docTerms, term);
    const idf = calculateIDF(allDocuments, term);

    // BM25 公式
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));

    score += idf * (numerator / denominator);
  }

  return score;
}

/**
 * BM25 检索 - 返回排序后的结果
 */
function bm25Retrieve(
  query: string,
  results: SearchResult[]
): { result: SearchResult; score: number; rank: number }[] {
  // 准备所有文档内容（title + content）
  const allDocuments = results.map(r => tokenize(`${r.title} ${r.content}`));

  // 计算每个结果的 BM25 分数
  const scored = results.map((result, index) => {
    const docText = `${result.title} ${result.content}`;
    const score = calculateBM25(query, docText, allDocuments);
    return { result, score, originalIndex: index };
  });

  // 按分数降序排序
  scored.sort((a, b) => b.score - a.score);

  // 添加排名
  return scored.map((item, rank) => ({
    result: item.result,
    score: item.score,
    rank: rank + 1 // 排名从 1 开始
  }));
}

// ============ 语义嵌入 ============
/**
 * 获取文本的嵌入向量
 * 使用 Ollama API
 */
export async function getEmbedding(text: string): Promise<number[]> {
  // 检查是否启用
  if (!ENABLE_EMBEDDING) {
    return [];
  }

  // 空文本检查
  if (!text || text.trim() === '') {
    return [];
  }

  // 检查缓存
  const cached = embeddingCache.get(text);
  if (cached) {
    return Array.from(cached);
  }

  try {
    const host = getOllamaHost();
    const response = await fetch(`${host}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: text,
      }),
    });

    if (!response.ok) {
      console.error(`[Embedding] Ollama API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json() as { embedding?: number[] };
    
    if (!data.embedding || data.embedding.length === 0) {
      console.error('[Embedding] No embedding returned from Ollama');
      return [];
    }

    // 缓存结果
    embeddingCache.set(text, data.embedding);

    return data.embedding;
  } catch (error) {
    console.error('[Embedding] Error getting embedding:', error);
    return [];
  }
}

/**
 * 计算余弦相似度
 */
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

/**
 * 语义检索 - 返回排序后的结果
 */
async function semanticRetrieve(
  query: string,
  results: SearchResult[]
): Promise<{ result: SearchResult; score: number; rank: number }[]> {
  // 获取查询的嵌入向量
  const queryEmbedding = await getEmbedding(query);

  if (queryEmbedding.length === 0) {
    // 如果无法获取嵌入，返回原始顺序
    return results.map((result, rank) => ({
      result,
      score: 0,
      rank: rank + 1
    }));
  }

  // 计算每个结果的语义相似度
  const scored = await Promise.all(
    results.map(async (result) => {
      const docText = `${result.title} ${result.content}`;
      const docEmbedding = await getEmbedding(docText);
      const score = cosineSimilarity(queryEmbedding, docEmbedding);
      return { result, score };
    })
  );

  // 按分数降序排序
  scored.sort((a, b) => b.score - a.score);

  // 添加排名
  return scored.map((item, rank) => ({
    result: item.result,
    score: item.score,
    rank: rank + 1
  }));
}

// ============ RRF 融合 ============
/**
 * RRF (Reciprocal Rank Fusion) 融合算法
 * 
 * 公式：RRF_score(d) = Σ 1/(k + rank(d))
 * - k = 60（业界标准）
 * - 只看排名，不看分数
 */
function rrfFusion(
  bm25Results: { result: SearchResult; score: number; rank: number }[],
  semanticResults: { result: SearchResult; score: number; rank: number }[]
): ScoredResult[] {
  // 构建 URL -> 排名 的映射
  const bm25RankMap = new Map<string, number>();
  const semanticRankMap = new Map<string, number>();
  const resultMap = new Map<string, SearchResult>();

  // BM25 排名映射
  for (const item of bm25Results) {
    bm25RankMap.set(item.result.url, item.rank);
    resultMap.set(item.result.url, item.result);
  }

  // 语义排名映射
  for (const item of semanticResults) {
    semanticRankMap.set(item.result.url, item.rank);
    resultMap.set(item.result.url, item.result);
  }

  // 计算 RRF 分数
  const fusedResults: ScoredResult[] = [];

  for (const [url, result] of resultMap) {
    const bm25Rank = bm25RankMap.get(url) || Infinity;
    const semanticRank = semanticRankMap.get(url) || Infinity;

    // RRF 公式：对每个检索系统，计算 1/(k + rank)
    let rrfScore = 0;

    // BM25 贡献
    if (bm25Rank !== Infinity) {
      rrfScore += 1 / (RRF_K + bm25Rank);
    }

    // 语义检索贡献
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

  // 按 RRF 分数降序排序
  fusedResults.sort((a, b) => b.rrfScore - a.rrfScore);

  return fusedResults;
}

// ============ 主函数 ============
/**
 * 对搜索结果进行混合检索重排序
 * 
 * @param query - 搜索查询
 * @param results - SearXNG 返回的搜索结果
 * @param enableEmbedding - 是否启用语义嵌入（可选，默认从环境变量读取）
 * @returns 重排序后的结果
 */
export async function rerankWithHybridSearch(
  query: string,
  results: SearchResult[],
  enableEmbedding?: boolean
): Promise<ScoredResult[]> {
  // 确定是否启用语义嵌入
  const useEmbedding = enableEmbedding !== undefined ? enableEmbedding : ENABLE_EMBEDDING;

  // 如果结果数量小于等于 TOP_K，直接返回
  if (results.length <= TOP_K) {
    return results.map((result, index) => ({
      ...result,
      rrfScore: results.length - index, // 简单的排名分数
      bm25Rank: index + 1,
      semanticRank: index + 1
    }));
  }

  // 如果禁用语义嵌入，只使用 BM25
  if (!useEmbedding) {
    const bm25Results = bm25Retrieve(query, results);
    return bm25Results.slice(0, TOP_K).map(item => ({
      ...item.result,
      rrfScore: 1 / (RRF_K + item.rank),
      bm25Rank: item.rank,
      semanticRank: 0
    }));
  }

  // 并行执行 BM25 和语义检索
  const [bm25Results, semanticResults] = await Promise.all([
    Promise.resolve(bm25Retrieve(query, results)),
    semanticRetrieve(query, results)
  ]);

  // RRF 融合
  const fusedResults = rrfFusion(bm25Results, semanticResults);

  // 返回 TOP_K 结果
  return fusedResults.slice(0, TOP_K);
}

// ============ 导出配置信息 ============
export function getEmbeddingConfig() {
  return {
    enabled: ENABLE_EMBEDDING,
    ollamaHost: OLLAMA_HOST,
    model: EMBEDDING_MODEL,
    topK: TOP_K,
    rrfK: RRF_K
  };
}
