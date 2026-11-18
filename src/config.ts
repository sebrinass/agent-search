import 'dotenv/config';

/**
 * 统一配置管理模块
 * 集中管理所有环境变量，避免重复定义
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { envInt, envFloat } from "./env-int.js";

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
export const RERANK_TIMEOUT_MS = envInt('RERANK_TIMEOUT_MS', 30000, { min: 1 });
export const RERANK_MAX_TEXT_LENGTH = envInt('RERANK_MAX_TEXT_LENGTH', 150, { min: 1 });
export const RERANK_CACHE_SIZE = envInt('RERANK_CACHE_SIZE', 100, { min: 1 });
// 动态过滤：真实 rerank 分数低于「最高分 × 该比例」的结果被剔除（0 = 关闭过滤）
export const RERANK_MIN_SCORE_RATIO = envFloat('RERANK_MIN_SCORE_RATIO', 0.5, { min: 0 });
// 绝对下限：真实 rerank 分数低于该值的直接剔除（0 = 关闭）。
// 注意：不同 rerank 模型分数分布不同（gte-reranker 实测 0~4+，无关 <1.2），需按模型调。
export const RERANK_MIN_SCORE = envFloat('RERANK_MIN_SCORE', 1.0, { min: 0 });
export const isRerankEnabled = !!(RERANK_BASE_URL || RERANK_API_KEY);

// ============ 搜索相关配置 ============
// 默认每个关键词只抓 1 页：SearXNG 首页即为其认定最相关的约 10 条，
// 抓更多页多为长尾、还会成倍增加 rerank 的计算量（rerank 逐条推理，
// 候选翻倍即推理时间翻倍）。需要更大候选池时可用 SEARCH_PAGES 覆盖。
export const DEFAULT_SEARCH_PAGES = 1;
export const SEARCH_PAGES = envInt('SEARCH_PAGES', DEFAULT_SEARCH_PAGES, { min: 1, max: 10 });
export const SEARCH_ENGINES = process.env.SEARCH_ENGINES || '';
// 整词最坏情况兜底 = 单页抓取(15s) + rerank(30s) + 余量(5s)：
// 保证 rerank 永远有完整超时时间，rerank 超时后会降级为 SearXNG 原始排序，结果不会丢失。
// 若抓页全部成功但 rerank 慢，整词不会提前截断。
export const SEARCH_TIMEOUT_MS = envInt('SEARCH_TIMEOUT_MS', 50000, { min: 1 });
// 单次 SearXNG 页面请求的独立超时（应小于 SEARCH_TIMEOUT_MS）：
// 一个慢页只影响该页，不拖死整个关键词的并发抓取。
// 注意：这是 fetch 抓页的超时，与 rerank 无关（rerank 走 RERANK_TIMEOUT_MS，本地模型慢可接受）。
export const SEARCH_PAGE_TIMEOUT_MS = envInt('SEARCH_PAGE_TIMEOUT_MS', 15000, { min: 1 });
export const SEARCH_LANGUAGE = process.env.SEARCH_LANGUAGE || 'all';
export const SAFE_SEARCH = envInt('SAFE_SEARCH', 0, { min: 0, max: 2 });

// ============ Rerank 结果数量 ============
export const TOP_K = envInt('TOP_K', 5, { min: 1, max: 50 });

// ============ Research 相关配置 ============
export const MAX_KEYWORDS = envInt('MAX_KEYWORDS', 3, { min: 1, max: 10 });
export const MAX_DESCRIPTION_LENGTH = envInt('MAX_DESCRIPTION_LENGTH', 150, { min: 1 });

// ============ URL 读取相关配置 ============
export const FETCH_TIMEOUT_MS = envInt('FETCH_TIMEOUT_MS', 30000, { min: 1 });
export const ENABLE_READABILITY = process.env.ENABLE_READABILITY !== 'false';

// ============ 缓存相关配置 ============
// 链接去重池 TTL（秒）：语义是「避免同一轮对话内重复返回同一条链接」，
// 而不是「永久去重」。该池是进程级共享的（HTTP 模式下所有会话共用一份），
// 设得过长会导致换会话 / 换 agent 再搜同一关键词时结果被静默滤空。
// 历史默认 86400（24h）与 cache.ts 注释「默认60秒」不符，属笔误导致的 bug，此处修正为 60。
export const LINK_DEDUP_TTL = envInt('LINK_DEDUP_TTL', 60, { min: 1 });
// 去重池容量：多关键词并发搜索一次就可能写入数十条，100 条太小，容易整池淘汰导致去重失效
export const LINK_DEDUP_SIZE = envInt('LINK_DEDUP_SIZE', 500, { min: 1 });
// URL 内容缓存 TTL（秒）：quick-lru 要求 maxAge > 0，钳制最小值为 1（等效"基本不缓存"）
export const URL_CACHE_TTL = envInt('URL_CACHE_TTL', 3600, { min: 1 });
export const URL_CACHE_SIZE = envInt('URL_CACHE_SIZE', 100, { min: 1 });

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

// ============ DeepSeek 搜索配置 ============
// 配了 DEEPSEEK_API_KEY 就自动注册 deepseek_search 工具（无需开关）。
// 计费：按成功请求 $0.75/1000 次（约 0.005 元/次），与返回条数、正文字数无关；
// 失败、空结果、超时不收费。限流：Search 100 QPS、Fetch 25 QPS（均为账号级）。
export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
export const DEEPSEEK_API_HOST = process.env.DEEPSEEK_API_HOST || 'https://api.deepseek.com';
export const DEEPSEEK_SEARCH_TIMEOUT_MS = envInt('DEEPSEEK_SEARCH_TIMEOUT_MS', 20000, { min: 1 });
// summary 面向模型撰写（600-800 字），截断到此长度后再返回，控制上下文占用
export const DEEPSEEK_SUMMARY_MAX_LENGTH = envInt('DEEPSEEK_SUMMARY_MAX_LENGTH', 400, { min: 1 });
export const isDeepseekEnabled = !!DEEPSEEK_API_KEY;

// ============ MiniMax 搜索（Coding Plan Token）配置 ============
// 配了 MINIMAX_API_KEY 就自动注册 minimax_search 工具（无需开关）。
// MINIMAX_API_HOST 默认国内区；海外订阅可改为 https://api.minimax.io
export const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
export const MINIMAX_API_HOST = process.env.MINIMAX_API_HOST || 'https://api.minimaxi.com';
export const MINIMAX_SEARCH_TIMEOUT_MS = envInt('MINIMAX_SEARCH_TIMEOUT_MS', 20000, { min: 1 });
export const isMinimaxEnabled = !!MINIMAX_API_KEY;

// ============ Exa 搜索配置 ============
// ENABLE_EXA_SEARCH 开关（默认 true）+ EXA_API_KEY（可空）：
// - 填了 EXA_API_KEY：直连 Exa HTTP API（快、额度高）
// - 没填：走 Exa 托管 MCP 匿名端点（限流，报错由 agent 自行切换其他工具兜底）
export const ENABLE_EXA_SEARCH = process.env.ENABLE_EXA_SEARCH !== 'false';
export const EXA_API_KEY = process.env.EXA_API_KEY || '';
export const EXA_SEARCH_TIMEOUT_MS = envInt('EXA_SEARCH_TIMEOUT_MS', 20000, { min: 1 });
export const isExaEnabled = ENABLE_EXA_SEARCH;

// ============ 黑名单相关配置 ============
/** 黑名单文件路径，默认为项目根目录的 blacklist.md，可通过环境变量覆盖 */
export const BLACKLIST_PATH = process.env.BLACKLIST_PATH || path.join(PROJECT_ROOT, "blacklist.md");

/** 导出项目根目录，供各模块使用 */
export { PROJECT_ROOT };
