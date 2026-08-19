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

// ============ Rerank 相关配置 ============
// 唯一的重排方式：cross-encoder rerank，协议兼容 Jina/Cohere/SiliconFlow/Together/本地推理服务的 /rerank 端点。
// MCP 服务模式（mcp-main.ts）要求至少配置 RERANK_BASE_URL 或 RERANK_API_KEY 才能启动。
export const RERANK_BASE_URL = process.env.RERANK_BASE_URL || '';
export const RERANK_API_KEY = process.env.RERANK_API_KEY || '';
export const RERANK_MODEL = process.env.RERANK_MODEL || 'jina-reranker-v2-base-multilingual';
export const RERANK_TIMEOUT_MS = parseInt(process.env.RERANK_TIMEOUT_MS || '30000', 10);
export const RERANK_MAX_TEXT_LENGTH = parseInt(process.env.RERANK_MAX_TEXT_LENGTH || '150', 10);
export const RERANK_CACHE_SIZE = parseInt(process.env.RERANK_CACHE_SIZE || '100', 10);
// 动态过滤：真实 rerank 分数低于「最高分 × 该比例」的结果被剔除（0 = 关闭过滤）
export const RERANK_MIN_SCORE_RATIO = parseFloat(process.env.RERANK_MIN_SCORE_RATIO || '0.5');
// 绝对下限：真实 rerank 分数低于该值的直接剔除（0 = 关闭）。
// 注意：不同 rerank 模型分数分布不同（gte-reranker 实测 0~4+，无关 <1.2），需按模型调。
export const RERANK_MIN_SCORE = parseFloat(process.env.RERANK_MIN_SCORE || '1.0');
export const isRerankEnabled = !!(RERANK_BASE_URL || RERANK_API_KEY);

// ============ 搜索相关配置 ============
// 默认每个关键词只抓 1 页：SearXNG 首页即为其认定最相关的约 10 条，
// 抓更多页多为长尾、还会成倍增加 rerank 的计算量。
// 需要更大候选池时可用环境变量 SEARCH_PAGES 覆盖。
export const DEFAULT_SEARCH_PAGES = 1;
export const SEARCH_PAGES = parseInt(process.env.SEARCH_PAGES || String(DEFAULT_SEARCH_PAGES), 10);
export const SEARCH_ENGINES = process.env.SEARCH_ENGINES || '';
export const SEARCH_TIMEOUT_MS = parseInt(process.env.SEARCH_TIMEOUT_MS || '60000', 10);
export const SEARCH_LANGUAGE = process.env.SEARCH_LANGUAGE || 'all';
export const SAFE_SEARCH = parseInt(process.env.SAFE_SEARCH || '0', 10);

// ============ Rerank 结果数量 ============
export const TOP_K = parseInt(process.env.TOP_K || '5', 10);

// ============ Research 相关配置 ============
export const MAX_KEYWORDS = parseInt(process.env.MAX_KEYWORDS || '3', 10);
export const MAX_DESCRIPTION_LENGTH = parseInt(process.env.MAX_DESCRIPTION_LENGTH || '150', 10);

// ============ URL 读取相关配置 ============
export const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || '30000', 10);
export const ENABLE_READABILITY = process.env.ENABLE_READABILITY !== 'false';

// ============ 缓存相关配置 ============
export const LINK_DEDUP_TTL = parseInt(process.env.LINK_DEDUP_TTL || '86400', 10);
// URL 内容缓存 TTL（秒）：quick-lru 要求 maxAge > 0，钳制最小值为 1（等效"基本不缓存"）
export const URL_CACHE_TTL = Math.max(1, parseInt(process.env.URL_CACHE_TTL || '3600', 10));
export const URL_CACHE_SIZE = parseInt(process.env.URL_CACHE_SIZE || '100', 10);

// ============ HTTP 服务相关配置 ============
export const MCP_HTTP_PORT = process.env.MCP_HTTP_PORT;
// MCP HTTP 会话模式：
// - stateful（默认）：有状态，initialize 返回 mcp-session-id，依赖会话的客户端（如 Hermes）
//   可正常注册工具；适合单实例 / 粘性会话场景
// - stateless：无状态，每次请求由 factory 新建 Server 实例；适合多副本 / 负载均衡 Docker 部署
// 注意：http-server.ts 在调用时实时读取本环境变量（便于测试切换），此处仅作集中声明。
export const MCP_SESSION_MODE = (process.env.MCP_SESSION_MODE || 'stateful').toLowerCase();
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
