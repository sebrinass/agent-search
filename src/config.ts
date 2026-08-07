import 'dotenv/config';

/**
 * 统一配置管理模块
 * 集中管理所有环境变量，避免重复定义
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

// ============ 项目根目录 ============
// 从当前文件位置推导项目根目录（src/config.ts → 项目根）
const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..");

// ============ 嵌入相关配置 ============
export const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || '';
export const EMBEDDING_BASE_URL = process.env.EMBEDDING_BASE_URL || process.env.OLLAMA_HOST || '';
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
export const isEmbeddingEnabled = !!(EMBEDDING_API_KEY || EMBEDDING_BASE_URL);

// ============ 嵌入超时配置 ============
export const EMBEDDING_TIMEOUT_MS = parseInt(process.env.EMBEDDING_TIMEOUT_MS || '90000', 10);

// ============ Rerank 相关配置 ============
// 与 embedding 二选一：配置了 rerank 则优先走纯 cross-encoder 重排，忽略 embedding 设置。
// 协议兼容 Jina/Cohere/SiliconFlow/Together 的 /rerank 端点。
export const RERANK_BASE_URL = process.env.RERANK_BASE_URL || '';
export const RERANK_API_KEY = process.env.RERANK_API_KEY || '';
export const RERANK_MODEL = process.env.RERANK_MODEL || 'jina-reranker-v2-base-multilingual';
export const RERANK_TIMEOUT_MS = parseInt(process.env.RERANK_TIMEOUT_MS || '30000', 10);
export const isRerankEnabled = !!(RERANK_BASE_URL || RERANK_API_KEY);

// ============ 搜索相关配置 ============
// 默认每个关键词只抓 1 页：SearXNG 首页即为其认定最相关的约 10 条，
// 抓更多页多为长尾、还会成倍增加本地 embedding 的计算量（iGPU 低功耗环境敏感）。
// 需要更大候选池时可用环境变量 SEARCH_PAGES 覆盖。
export const DEFAULT_SEARCH_PAGES = 1;
export const SEARCH_PAGES = parseInt(process.env.SEARCH_PAGES || String(DEFAULT_SEARCH_PAGES), 10);
export const SEARCH_ENGINES = process.env.SEARCH_ENGINES || '';
export const SEARCH_TIMEOUT_MS = parseInt(process.env.SEARCH_TIMEOUT_MS || String(EMBEDDING_TIMEOUT_MS + 10000), 10);
export const SEARCH_LANGUAGE = process.env.SEARCH_LANGUAGE || 'all';
export const SAFE_SEARCH = parseInt(process.env.SAFE_SEARCH || '0', 10);

// ============ RRF 相关配置 ============
export const TOP_K = parseInt(process.env.TOP_K || '5', 10);
export const RRF_K = 60;

// ============ Research 相关配置 ============
export const MAX_KEYWORDS = parseInt(process.env.MAX_KEYWORDS || '3', 10);
export const MAX_DESCRIPTION_LENGTH = parseInt(process.env.MAX_DESCRIPTION_LENGTH || '200', 10);

// ============ URL 读取相关配置 ============
export const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || '30000', 10);
export const ENABLE_READABILITY = process.env.ENABLE_READABILITY !== 'false';

// ============ 缓存相关配置 ============
export const LINK_DEDUP_TTL = parseInt(process.env.LINK_DEDUP_TTL || '86400', 10);
export const URL_CACHE_TTL = parseInt(process.env.URL_CACHE_TTL || '3600', 10);
export const URL_CACHE_SIZE = parseInt(process.env.URL_CACHE_SIZE || '100', 10);
export const EMBEDDING_CACHE_SIZE = parseInt(process.env.EMBEDDING_CACHE_SIZE || '1000', 10);

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

// ============ 黑名单相关配置 ============
/** 黑名单文件路径，默认为项目根目录的 blacklist.md，可通过环境变量覆盖 */
export const BLACKLIST_PATH = process.env.BLACKLIST_PATH || path.join(PROJECT_ROOT, "blacklist.md");

/** 导出项目根目录，供其他模块使用 */
export { PROJECT_ROOT };
