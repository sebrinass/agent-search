---
name: "performing-searches"
description: "Provides concurrent web search capabilities for Agents with hybrid retrieval. Supports searching multiple keywords simultaneously, Embedding re-ranking to improve relevance to ~80%. Use when users need to search the web, look up information, or mention SearXNG, MCP search, or local search."
version: "0.1.0"
author: "sebrinass"
tags: ["search", "mcp", "searxng", "agent", "local"]
category: "search"
tools:
  - name: search
    description: "并发搜索工具，支持多关键词并发搜索、站点/时间/语言过滤，以及 fast/embedding 两种搜索模式"
    inputSchema:
      type: "object"
      properties:
        searchedKeywords:
          type: "array"
          items:
            type: "string"
          minItems: 1
          maxItems: 3
          description: "搜索关键词列表（最多3个并发）"
        mode:
          type: "string"
          enum: ["fast", "embedding"]
          default: "fast"
          description: "搜索模式：fast=快速搜索(默认)，embedding=精准搜索(需配置嵌入模型)"
        site:
          type: "string"
          description: "限制搜索范围到具体网站域名"
        time_range:
          type: "string"
          enum: ["day", "month", "year"]
          description: "时间范围过滤：day=最近一天，month=最近一月，year=最近一年"
        lang:
          type: "string"
          description: "搜索语言（如 en, zh, all）"
        safeSearch:
          type: "number"
          enum: [0, 1, 2]
          description: "安全搜索级别：0=关闭，1=中等，2=严格"
      required: ["searchedKeywords"]
  - name: read
    description: "读取 URL 内容，支持 JS 渲染降级和正文提取"
    inputSchema:
      type: "object"
      properties:
        urls:
          type: "array"
          items:
            type: "string"
          description: "URL 数组（支持批量读取）"
        startChar:
          type: "number"
          description: "起始字符位置（默认 0）"
        maxLength:
          type: "number"
          description: "最大读取字符数"
        section:
          type: "string"
          description: "提取指定章节"
        paragraphRange:
          type: "string"
          description: "段落范围（如 1-5, 3, 10-）"
        readHeadings:
          type: "boolean"
          description: "仅返回标题列表"
      required: ["urls"]
env:
  required:
    - name: "SEARXNG_URL"
      description: "SearXNG 实例地址"
      example: "http://localhost:8080"
  optional:
    - name: "EMBEDDING_API_KEY"
      description: "Embedding API 密钥（启用混合检索）"
    - name: "EMBEDDING_BASE_URL"
      description: "Embedding API 端点（OpenAI 兼容）"
    - name: "EMBEDDING_MODEL"
      description: "嵌入模型名称"
      default: "nomic-embed-text"
    - name: "MCP_HTTP_PORT"
      description: "HTTP 模式端口"
      default: "3000"
    - name: "AUTH_USERNAME"
      description: "Basic Auth 用户名"
    - name: "AUTH_PASSWORD"
      description: "Basic Auth 密码"
    - name: "SEARCH_TIMEOUT_MS"
      description: "搜索超时（毫秒）"
      default: "100000"
    - name: "SEARCH_PAGES"
      description: "搜索页数"
      default: "1"
    - name: "SEARCH_ENGINES"
      description: "指定搜索引擎（逗号分隔）"
    - name: "SEARCH_LANGUAGE"
      description: "搜索语言"
      default: "all"
    - name: "HTTP_PROXY"
      description: "HTTP 代理地址"
    - name: "HTTPS_PROXY"
      description: "HTTPS 代理地址"
source: "https://github.com/sebrinass/agent-search"
homepage: "https://github.com/sebrinass/agent-search"
---

# Agent Search

为 Agent 提供高效的本地联网搜索能力。

## 快速开始

**前置条件**: SearXNG 实例（必需）

**Docker 方式（推荐）**:

```bash
docker run -d --name searxng -p 8080:8080 searxng/searxng:latest
docker run -d --name agent-search -p 3000:3000 \
  -e SEARXNG_URL=http://host.docker.internal:8080 \
  ghcr.io/sebrinass/agent-search:latest
```

**npm 方式**:

```bash
npm install -g agent-search
SEARXNG_URL=http://localhost:8080 agent-search
```

## 提供的工具

### search — 并发搜索

支持混合检索和链接去重，一次请求最多搜索 3 个关键词。

**必填参数：**
- `searchedKeywords` — 搜索关键词列表（最多 3 个并发）

**可选参数：**
- `mode` — 搜索模式，`fast`=快速搜索(默认)，`embedding`=精准搜索(需配置嵌入模型)
- `site` — 限制搜索域名
- `time_range` — 时间范围过滤（day, month, year）
- `lang` — 搜索语言（如 en, zh, all）
- `safeSearch` — 安全搜索级别（0=关闭，1=中等，2=严格）

**使用建议：** 一般问题或简单搜索用 `fast` 模式（默认），需要深度搜索时可启用 `embedding` 模式。

### read — URL 内容提取

读取网页内容，支持 JS 渲染降级和正文提取。

**参数：**
- `urls` — URL 数组
- `startChar` / `maxLength` — 分页读取
- `section` — 提取指定章节
- `paragraphRange` — 段落范围
- `readHeadings` — 仅返回标题列表

## 配置

### 必填

| 变量 | 说明 |
|------|------|
| `SEARXNG_URL` | SearXNG 实例地址 |

### 常用可选

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `EMBEDDING_BASE_URL` | - | Embedding API 端点（启用混合检索） |
| `MCP_HTTP_PORT` | - | HTTP 模式端口 |
| `SEARCH_TIMEOUT_MS` | 100000 | 搜索超时（毫秒） |

完整配置请参阅 [GitHub 仓库配置文档](https://github.com/sebrinass/agent-search/blob/main/docs/configuration.md)。

## 性能建议

| 模式 | 页数 | 超时 | 相关性 |
|------|------|------|--------|
| 纯文本 | 1 | 10-15秒 | ~50% |
| 混合检索 | 3 | 30-60秒 | ~80% |

**其他建议：**
- 搜索关键词并发不超过 3 个
- 在 SearXNG 配置中过滤视频网站以提升结果质量

## 工具使用示例

### 使用 mcporter 调用

```bash
# 列出工具
mcporter list http://localhost:3000/mcp

# 调用搜索
mcporter call http://localhost:3000/mcp.search \
  searchedKeywords='["hello world"]'

# 调用 URL 读取
mcporter call http://localhost:3000/mcp.read \
  urls='["https://example.com"]'
```

## 详细安装

完整安装指南请参阅 [GitHub 安装文档](https://github.com/sebrinass/agent-search/blob/main/skill/reference/installation.md)，包含：
- Docker 完整安装
- npm + 已有 SearXNG
- SearXNG 配置详解
- OpenClaw 集成
- 常见问题

## 资源链接

- [安装指南](https://github.com/sebrinass/agent-search/blob/main/skill/reference/installation.md) — 完整安装说明
- [配置参考](https://github.com/sebrinass/agent-search/blob/main/docs/configuration.md) — 完整环境变量说明
- [GitHub 仓库](https://github.com/sebrinass/agent-search)
- [SearXNG 文档](https://docs.searxng.org)
- [Docker 镜像](https://ghcr.io/sebrinass/agent-search)
