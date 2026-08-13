import { getCurrentLogLevel } from "./logging.js";
import { packageVersion } from "./version.js";
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
  MCP_HTTP_PORT
} from "./config.js";

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
      tools: ["web_search", "urls_read"],
      transports: MCP_HTTP_PORT ? ["stdio", "http"] : ["stdio"]
    },
    rerank: {
      enabled: !!(RERANK_BASE_URL || RERANK_API_KEY),
      model: RERANK_MODEL,
      topK: TOP_K
    }
  };
  
  return JSON.stringify(config, null, 2);
}

export function createHelpResource() {
  return `# agent-search MCP Server 帮助

## 概述
增强型 MCP 搜索服务器：SearXNG 搜索 + cross-encoder rerank 重排 + URL 内容读取（含 PDF）。

## 可用工具

### 1. web_search
通用网络搜索工具，并发搜索多个关键词，经 rerank 重排后返回最相关结果。

**必填参数：**
- \`searchedKeywords\`: 要搜索的关键词列表（最多3个并发）

**可选参数：**
- \`site\`: 限制搜索域名
- \`time_range\`: 时间范围过滤（day, month, year）
- \`lang\`: 搜索语言（如 en, zh, all）
- \`safeSearch\`: 安全搜索级别（0=关闭，1=中等，2=严格）
- \`category\`: 搜索分类（general, news, science, it, images, videos, files, music）

### 2. urls_read
读取 URL 内容（网页自动转 Markdown，PDF 自动本地解析），支持批量、分页、章节提取。

**参数：**
- \`urls\`: URL 数组（如 \`["https://a.com", "https://b.com"]\`），最少1个
- \`startChar\`: 起始字符位置
- \`maxLength\`: 最大字符数
- \`section\`: 提取指定章节
- \`paragraphRange\`: 段落范围
- \`readHeadings\`: 仅返回标题列表

## 配置

### 必填环境变量
- \`SEARXNG_URL\`: SearXNG 实例地址
- \`RERANK_BASE_URL\` 或 \`RERANK_API_KEY\`: rerank 服务地址（或 API 密钥）

### 可选环境变量
- \`RERANK_MODEL\`: rerank 模型（默认 jina-reranker-v2-base-multilingual）
- \`RERANK_API_KEY\`: rerank API 密钥
- \`MCP_HTTP_PORT\`: HTTP 模式端口
- \`SEARCH_PAGES\`: 搜索页数（默认 1）
- \`SEARCH_ENGINES\`: 搜索引擎（默认空=使用SearXNG默认配置）
  - 留空或 "all": 使用 SearXNG 默认全部引擎
  - "google,baidu,bing": 指定引擎列表

## 传输模式

### STDIO（默认）
标准输入输出传输，适用于桌面客户端。

### HTTP（推荐，容器部署）
设置 \`MCP_HTTP_PORT\` 启用，无状态设计，适合 Docker 容器部署。

## 使用日志
设置日志级别 "debug" 获取详细请求信息。

## 当前配置
查看 "Current Configuration" 资源获取实时设置。
`;
}
