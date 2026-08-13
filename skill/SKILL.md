---
name: "performing-searches"
description: "Provides concurrent web search capabilities for Agents with cross-encoder rerank re-ranking. Supports searching multiple keywords simultaneously, rerank to improve relevance to ~80%. Use when users need to search the web, look up information, or mention SearXNG, MCP search, or local search."
version: "0.3.0"
author: "sebrinass"
tags: ["search", "mcp", "searxng", "agent", "local"]
category: "search"
tools:
  - name: web_search
    description: "通用网络搜索工具，并发搜索多个关键词，经 cross-encoder rerank 重排后返回最相关结果"
    inputSchema:
      type: "object"
      properties:
        searchedKeywords:
          type: "array"
          items:
            type: "string"
          minItems: 1
          maxItems: 3
          description: "必须提供 2-3 个不同角度的关键词以获得最佳效果。单关键词搜索效率较低，多个关键词可并行搜索不同角度。最多3个并发"
        category:
          type: "string"
          enum: ["general", "news", "science", "it", "images", "videos", "files", "music"]
          description: "搜索分类：general=通用，news=新闻，science=学术，it=技术/编程，images=图片，videos=视频，files=文件，music=音乐"
        site:
          type: "string"
          description: "限制搜索范围到具体网站域名"
        lang:
          type: "string"
          description: "搜索语言（如 en, zh, all）"
        safeSearch:
          type: "number"
          enum: [0, 1, 2]
          description: "安全搜索级别：0=关闭，1=中等，2=严格"
        time_range:
          type: "string"
          enum: ["day", "month", "year"]
          description: "时间范围过滤：day=最近一天，month=最近一月，year=最近一年"
      required: ["searchedKeywords"]
  - name: urls_read
    description: "读取 URL 内容（网页自动转 Markdown，PDF 自动本地解析），支持批量、分页、章节提取"
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
        readHeadings:
          type: "boolean"
          description: "仅返回标题列表"
        paragraphRange:
          type: "string"
          description: "段落范围（如 1-5, 3, 10-）"
        timeoutMs:
          type: "number"
          description: "请求超时（毫秒）"
      required: ["urls"]
env:
  required:
    - name: "SEARXNG_URL"
      description: "SearXNG 实例地址"
      example: "http://localhost:8080"
    - name: "RERANK_BASE_URL"
      description: "rerank 服务地址（或 RERANK_API_KEY 二选一）"
      example: "http://localhost:11434"
  optional:
    - name: "RERANK_API_KEY"
      description: "云端 rerank API 密钥（与 RERANK_BASE_URL 二选一）"
    - name: "MCP_HTTP_PORT"
      description: "HTTP 模式端口（未设置时不启用 HTTP 模式）"
    - name: "SEARCH_TIMEOUT_MS"
      description: "搜索超时（毫秒）"
      default: "60000"
source: "https://github.com/sebrinass/agent-search"
homepage: "https://github.com/sebrinass/agent-search"
---

# Agent Search

为 Agent 提供高效的本地联网搜索能力，支持 rerank 重排和链接去重。

## 快速开始

**前置条件**: SearXNG 实例 + rerank 服务（必需）

**Docker 方式（推荐）**:

```bash
docker run -d --name searxng -p 8080:8080 searxng/searxng:latest
docker run -d --name agent-search -p 3000:3000 \
  -e SEARXNG_URL=http://host.docker.internal:8080 \
  -e RERANK_BASE_URL=http://host.docker.internal:11434 \
  -e MCP_HTTP_PORT=3000 \
  ghcr.io/sebrinass/agent-search:latest
```

**npm 方式**:

```bash
npm install -g agent-local-search
SEARXNG_URL=http://localhost:8080 RERANK_BASE_URL=http://localhost:11434 agent-search
```

## 工具概览

### web_search — 通用网络搜索

并发搜索多个关键词，经 cross-encoder **rerank 重排**后返回最相关结果（相关性约 80%）。
rerank 服务不可用时自动降级为 SearXNG 原始排序（约 50%），搜索不中断。

**必填参数：**
- `searchedKeywords` — **必须提供 2-3 个不同角度的关键词**以获得最佳效果（最多 3 个并发）

**常用可选参数：**
- `category` — 搜索分类（general, news, science, it, images, videos, files, music）
- `site` — 限制搜索域名
- `lang` — 搜索语言（如 en, zh, all）
- `safeSearch` — 安全搜索级别（0=关闭，1=中等，2=严格）
- `time_range` — 时间范围（day, month, year）

### urls_read — URL 内容读取

读取网页内容（自动转 Markdown）或 PDF（本地解析），支持批量、分页、章节提取。

**必填参数：**
- `urls` — URL 数组（支持批量读取）

**常用可选参数：**
- `startChar` / `maxLength` — 分页读取
- `section` — 提取指定章节
- `readHeadings` — 仅返回标题列表

## 最佳实践

### 🔑 关键词策略（重要！）

**必须提供 2-3 个不同角度的关键词**，这是获得高质量搜索结果的关键：

- ✅ **好**: `["React 性能优化", "React rendering optimization", "React slow component"]`
- ❌ **差**: `["React"]`

多关键词可以并行搜索不同角度，显著提升结果覆盖面和相关性。

### 分类选择建议

根据任务类型选择合适的分类：
- 学术研究 → `science`
- 技术问题/编程 → `it`
- 新闻资讯 → `news`
- 通用搜索 → 不指定（默认 `general`）

## CLI 使用

安装后通过 `agent-search` 命令使用（CLI 命令名与 MCP 工具名对齐），支持 `.env` 文件配置环境变量。

### web-search — 网络搜索

```bash
# 基本搜索
agent-search web-search -q "RAG 技术"

# 多关键词并发搜索（优先推荐）
agent-search web-search -q "RAG" "向量数据库" "Embedding"

# 限制域名和时间范围
agent-search web-search -q "React 19" --site github.com --time-range month

# 指定分类和语言
agent-search web-search -q "TypeScript" --category it --lang en

# JSON 格式输出
agent-search web-search -q "RAG 技术" --json

# 详细输出
agent-search -v web-search -q "RAG 技术"
```

**选项：**

| 选项 | 说明 |
|------|------|
| `-q, --query <keywords...>` | 搜索关键词（必填，最多 3 个） |
| `-c, --category <cat>` | 搜索分类: general, news, science, it, images, videos, files, music |
| `-s, --site <domain>` | 限制搜索域名 |
| `--time-range <range>` | 时间范围: day, month, year |
| `--lang <language>` | 搜索语言（默认 all） |
| `--safe-search <level>` | 安全搜索级别: 0, 1, 2（默认 0） |
| `--json` | 以 JSON 格式输出结果 |

### urls-read — URL 内容读取

```bash
# 读取单个 URL
agent-search urls-read https://example.com

# 读取多个 URL
agent-search urls-read https://example.com https://example.org

# 读取 PDF（自动本地解析）
agent-search urls-read https://example.com/paper.pdf

# 分页读取
agent-search urls-read https://example.com --start-char 1000 --max-length 5000

# 提取指定章节
agent-search urls-read https://example.com --section "Installation"

# 段落范围
agent-search urls-read https://example.com --paragraph-range 1-5

# 仅返回标题列表
agent-search urls-read https://example.com --headings
```

### 全局选项

| 选项 | 说明 |
|------|------|
| `-v, --verbose` | 显示详细输出（适用于所有子命令） |

## 配置

### 必填

| 变量 | 说明 |
|------|------|
| `SEARXNG_URL` | SearXNG 实例地址 |
| `RERANK_BASE_URL` 或 `RERANK_API_KEY` | rerank 服务地址/密钥（二选一） |

### 常用可选

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RERANK_MODEL` | jina-reranker-v2-base-multilingual | rerank 模型名 |
| `RERANK_API_KEY` | - | 云端 rerank API 密钥 |
| `RERANK_TIMEOUT_MS` | 30000 | rerank 调用超时，失败自动降级原始排序 |
| `MCP_HTTP_PORT` | - | HTTP 模式端口（无状态，未设置时不启用） |
| `SEARCH_TIMEOUT_MS` | 60000 | 搜索超时（毫秒） |

完整配置请参阅 [GitHub 配置参考](https://github.com/sebrinass/agent-search/blob/main/docs/configuration.md)。

### 域名黑名单

项目根目录的 `blacklist.md` 文件支持域名过滤，搜索结果中匹配的 URL 将被自动排除。

**格式规则：**
- 每行一个一级域名（支持子域名匹配）
- 以 `#` 开头的行为注释
- 修改后下一轮搜索立即生效（无需重启）

**特殊说明：**
- `bilibili.com` — **只过滤 `/video/` 开头的URL**（视频页面），其他页面（如专栏、动态）正常显示
- 默认包含 `douyin.com` + 字典网站等常见低质量域名

```markdown
# 域名黑名单示例
bilibili.com  # 只过滤视频页面
douyin.com
```

## 参考链接

- [安装指南](https://github.com/sebrinass/agent-search/blob/main/skill/reference/installation.md) — 完整安装说明和 SearXNG 配置
- [配置参考](https://github.com/sebrinass/agent-search/blob/main/docs/configuration.md) — 完整环境变量说明
- [GitHub 仓库](https://github.com/sebrinass/agent-search) — 源码和 Issue
- [SearXNG 文档](https://docs.searxng.org) — 搜索引擎配置
