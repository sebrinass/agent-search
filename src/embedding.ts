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

// ============ 环境变量配置 ============
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || '';
const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || process.env.OLLAMA_HOST || '';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
const TOP_K = parseInt(process.env.TOP_K || '5', 10);
const RRF_K = 60;

const isEmbeddingEnabled = !!(EMBEDDING_API_KEY || EMBEDDING_BASE_URL);

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

// ============ OpenAI 兼容 API 嵌入 ============
async function getOpenAIEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim() === '') {
    return [];
  }

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

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Embedding] API error: ${response.status} ${response.statusText} - ${errorText}`);
      return [];
    }
    
    const data = await response.json() as { 
      data?: Array<{ embedding?: number[] }> 
    };
    
    const embedding = data.data?.[0]?.embedding;
    
    if (!embedding || embedding.length === 0) {
      console.error('[Embedding] No embedding returned from API');
      return [];
    }
    
    embeddingCache.set(text, embedding);
    
    return embedding;
  } catch (error) {
    console.error('[Embedding] Error getting embedding:', error);
    return [];
  }
}

export async function getEmbedding(text: string): Promise<number[]> {
  return getOpenAIEmbedding(text);
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

// ============ 语义检索 ============
async function semanticRetrieve(
  query: string,
  results: SearchResult[]
): Promise<{ result: SearchResult; score: number; rank: number }[]> {
  const queryEmbedding = await getEmbedding(query);
  
  if (queryEmbedding.length === 0) {
    return results.map((result, rank) => ({
      result,
      score: 0,
      rank: rank + 1
    }));
  }
  
  const scored = await Promise.all(
    results.map(async (result) => {
      const docText = `${result.title} ${result.content}`;
      const docEmbedding = await getEmbedding(docText);
      const score = cosineSimilarity(queryEmbedding, docEmbedding);
      return { result, score };
    })
  );
  
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
export async function rerankWithHybridSearch(
  query: string,
  results: SearchResult[],
  _enableEmbedding?: boolean
): Promise<ScoredResult[]> {
  const useEmbedding = isEmbeddingEnabled;
  
  if (results.length <= TOP_K) {
    return results.map((result, index) => ({
      ...result,
      rrfScore: results.length - index,
      bm25Rank: index + 1,
      semanticRank: index + 1
    }));
  }
  
  if (!useEmbedding) {
    const bm25Results = miniSearchRetrieve(query, results);
    return bm25Results.slice(0, TOP_K).map(item => ({
      ...item.result,
      rrfScore: 1 / (RRF_K + item.rank),
      bm25Rank: item.rank,
      semanticRank: 0
    }));
  }
  
  const [bm25Results, semanticResults] = await Promise.all([
    Promise.resolve(miniSearchRetrieve(query, results)),
    semanticRetrieve(query, results)
  ]);
  
  const fusedResults = rrfFusion(bm25Results, semanticResults);
  
  return fusedResults.slice(0, TOP_K);
}

// ============ 导出配置信息 ============
export function getEmbeddingConfig() {
  return {
    enabled: isEmbeddingEnabled,
    baseUrl: EMBEDDING_BASE_URL || 'not configured',
    model: EMBEDDING_MODEL,
    topK: TOP_K,
    rrfK: RRF_K
  };
}
