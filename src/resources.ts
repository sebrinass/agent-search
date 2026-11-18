import { getCurrentLogLevel } from "./logging.js";
import { packageVersion } from "./version.js";
import { SEARCH_TOOL } from "./research.js";
import { READ_URL_TOOL } from "./types.js";
import {
  SEARXNG_URL,
  RERANK_BASE_URL,
  RERANK_API_KEY,
  RERANK_MODEL,
  TOP_K,
  AUTH_USERNAME,
  AUTH_PASSWORD,
  HTTP_PROXY,
  HTTPS_PROXY,
  MCP_HTTP_PORT,
  LINK_DEDUP_TTL,
  SEARCH_PAGES,
  isDeepseekEnabled,
  isMinimaxEnabled,
  isExaEnabled,
} from "./config.js";

/**
 * 已注册的工具名列表。
 * 必须与实际注册逻辑保持一致——写死列表会随新增 provider 静默过期，
 * 而 config resource 是 agent 判断「服务具备哪些能力」的依据。
 */
function enabledToolNames(): string[] {
  const names = [SEARCH_TOOL.name, READ_URL_TOOL.name];
  if (isDeepseekEnabled) names.push("deepseek_search");
  if (isMinimaxEnabled) names.push("minimax_search");
  if (isExaEnabled) names.push("exa_search");
  return names;
}

export function createConfigResource() {
  const config = {
    serverInfo: {
      name: "agent-search",
      version: packageVersion,
      description: "增强型 MCP 搜索服务器"
    },
    environment: {
      searxngUrl: SEARXNG_URL || "(not configured)",
      rerankBaseUrl: RERANK_BASE_URL || "(not configured)",
      rerankModel: RERANK_MODEL,
      hasAuth: !!(AUTH_USERNAME && AUTH_PASSWORD),
      hasProxy: !!(HTTP_PROXY || HTTPS_PROXY),
      nodeVersion: process.version,
      currentLogLevel: getCurrentLogLevel()
    },
    capabilities: {
      tools: enabledToolNames(),
      transports: MCP_HTTP_PORT ? ["stdio", "http"] : ["stdio"]
    },
    rerank: {
      enabled: !!(RERANK_BASE_URL || RERANK_API_KEY),
      model: RERANK_MODEL,
      topK: TOP_K
    },
    search: {
      searxngPages: SEARCH_PAGES,
      // 去重池为进程级共享，TTL 过长会导致跨会话重复搜索被滤空
      linkDedupTtlSeconds: LINK_DEDUP_TTL
    },
    cloudSearch: {
      deepseek: isDeepseekEnabled,
      minimax: isMinimaxEnabled,
      exa: isExaEnabled
    }
  };

  return JSON.stringify(config, null, 2);
}
