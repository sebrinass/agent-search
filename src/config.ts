/**
 * 统一配置管理模块
 * 集中管理所有环境变量，避免重复定义
 */

// ============ 嵌入相关配置 ============
export const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || '';
export const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || process.env.OLLAMA_HOST || '';
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
export const isEmbeddingEnabled = !!(EMBEDDING_API_KEY || EMBEDDING_BASE_URL);

// ============ 嵌入超时配置 ============
export const EMBEDDING_TIMEOUT_MS = parseInt(process.env.EMBEDDING_TIMEOUT_MS || '30000', 10);

// ============ 搜索相关配置 ============
export const DEFAULT_SEARCH_PAGES = isEmbeddingEnabled ? 3 : 1;
export const SEARCH_PAGES = parseInt(process.env.SEARCH_PAGES || String(DEFAULT_SEARCH_PAGES), 10);
export const SEARCH_ENGINES = process.env.SEARCH_ENGINES || '';
export const SEARCH_TIMEOUT_MS = parseInt(process.env.SEARCH_TIMEOUT_MS || String(EMBEDDING_TIMEOUT_MS + 10000), 10);
export const SEARCH_LANGUAGE = process.env.SEARCH_LANGUAGE || 'all';
export const SAFE_SEARCH = parseInt(process.env.SAFE_SEARCH || '0', 10);

// ============ RRF 相关配置 ============
export const TOP_K = parseInt(process.env.TOP_K || '5', 10);
export const RRF_K = 60;

// ============ Research 相关配置 ============
export const MAX_THOUGHTS = parseInt(process.env.MAX_THOUGHTS || '5', 10);
export const MAX_KEYWORDS = parseInt(process.env.MAX_KEYWORDS || '3', 10);
export const MAX_DESCRIPTION_LENGTH = parseInt(process.env.MAX_DESCRIPTION_LENGTH || '200', 10);

// ============ URL 读取相关配置 ============
export const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || '30000', 10);
export const ENABLE_JS_RENDER = process.env.ENABLE_JS_RENDER !== 'false';
export const ENABLE_READABILITY = process.env.ENABLE_READABILITY !== 'false';

// ============ 缓存相关配置 ============
export const LINK_DEDUP_TTL = parseInt(process.env.LINK_DEDUP_TTL || '86400', 10);
export const URL_CACHE_TTL = parseInt(process.env.URL_CACHE_TTL || '3600', 10);
export const URL_CACHE_SIZE = parseInt(process.env.URL_CACHE_SIZE || '100', 10);
export const EMBEDDING_CACHE_SIZE = parseInt(process.env.EMBEDDING_CACHE_SIZE || '1000', 10);

// ============ Context7 相关配置 ============
export const CONTEXT7_API_KEY = process.env.CONTEXT7_API_KEY || '';
export const CONTEXT7_API_URL = process.env.CONTEXT7_API_URL || 'https://api.context7.com/v1';

// ============ HTTP 服务相关配置 ============
export const MCP_HTTP_PORT = process.env.MCP_HTTP_PORT;
export const AUTH_USERNAME = process.env.AUTH_USERNAME;
export const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

// ============ 代理相关配置 ============
export const HTTP_PROXY = process.env.HTTP_PROXY || process.env.http_proxy;
export const HTTPS_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
export const NO_PROXY = process.env.NO_PROXY || process.env.no_proxy;

// ============ 其他配置 ============
export const USER_AGENT = process.env.USER_AGENT;
export const SEARXNG_URL = process.env.SEARXNG_URL;

// ============ 配置导出函数 ============
export function getEmbeddingConfig() {
  return {
    enabled: isEmbeddingEnabled,
    baseUrl: EMBEDDING_BASE_URL || 'not configured',
    model: EMBEDDING_MODEL,
    timeoutMs: EMBEDDING_TIMEOUT_MS,
    topK: TOP_K,
    rrfK: RRF_K
  };
}

export function getResearchConfig() {
  return {
    maxThoughts: MAX_THOUGHTS,
    maxKeywords: MAX_KEYWORDS,
    searchTimeoutMs: SEARCH_TIMEOUT_MS,
    maxDescriptionLength: MAX_DESCRIPTION_LENGTH
  };
}

export function getSearchConfig() {
  return {
    searchPages: SEARCH_PAGES,
    searchEngines: SEARCH_ENGINES,
    searchTimeoutMs: SEARCH_TIMEOUT_MS,
    searchLanguage: SEARCH_LANGUAGE,
    safeSearch: SAFE_SEARCH
  };
}

export function getUrlReaderConfig() {
  return {
    fetchTimeoutMs: FETCH_TIMEOUT_MS,
    enableJsRender: ENABLE_JS_RENDER,
    enableReadability: ENABLE_READABILITY
  };
}

export function getCacheConfig() {
  return {
    linkDedupTtl: LINK_DEDUP_TTL,
    urlCacheTtl: URL_CACHE_TTL,
    urlCacheSize: URL_CACHE_SIZE,
    embeddingCacheSize: EMBEDDING_CACHE_SIZE
  };
}
