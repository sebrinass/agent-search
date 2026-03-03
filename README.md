# Augmented Search MCP Server

[![MCP Badge](https://lobehub.com/badge/mcp/sebrinass-mcp-augmented-search)](https://lobehub.com/mcp/sebrinass-mcp-augmented-search)

基于 [ihor-sokoliuk/mcp-searxng](https://github.com/ihor-sokoliuk/mcp-searxng)v0.9.1修改的MCP 搜索服务器，集成混合检索、代码文档搜索等功能。

## 功能特性

### 核心功能
- **网络搜索**：通用查询、新闻、文章搜索，支持分页和时间过滤
- **URL 内容读取**：智能内容提取，支持 JS 渲染降级、正文提取
- **Research 工具**：思考 + 搜索融合，记录每一步决策过程
- **代码文档搜索**：集成 Context7，获取最新的库文档和代码示例

### 增强特性
- **混合检索**：RRF 融合 BM25 + 语义嵌入，提升搜索相关性
- **智能缓存**：链接去重、URL 缓存、嵌入缓存三层缓存系统
- **JS 渲染降级**：fetch → Happy DOM → 提示浏览器 MCP
- **站内搜索**：支持 `site:` 参数限制搜索域名

## 工具列表

### search
思考 + 并发搜索工具，支持混合检索和链接去重。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| thought | string | 是 | 当前思考内容 |
| thoughtNumber | number | 是 | 当前思考步骤编号 |
| totalThoughts | number | 是 | 预计总思考步骤数 |
| nextThoughtNeeded | boolean | 是 | 是否需要继续思考 |
| searchedKeywords | string[] | 否 | 要搜索的关键词（最多3个并发） |
| site | string | 否 | 限制搜索域名 |

### read
读取 URL 内容，支持 JS 渲染降级和正文提取。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | URL 地址（支持 `\|` 分隔多个，如 `https://a.com\|https://b.com`） |
| startChar | number | 否 | 起始字符位置 |
| maxLength | number | 否 | 最大字符数 |
| section | string | 否 | 提取指定章节 |
| paragraphRange | string | 否 | 段落范围，如 1-5 |
| readHeadings | boolean | 否 | 仅返回标题列表 |
| timeoutMs | number | 否 | 超时时间（毫秒），默认 30000 |

### library_search
搜索编程库，获取 Context7 兼容的库 ID。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | 是 | 用户问题（用于相关性排序） |
| libraryName | string | 是 | 库名，如 react |

### library_docs
查询库的文档和代码示例。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| libraryId | string | 是 | 库 ID，如 /facebook/react |
| query | string | 是 | 用户问题 |

## 环境变量配置

### 必填配置

| 变量 | 说明 |
|------|------|
| `SEARXNG_URL` | SearXNG 实例地址 |

### 可选配置

#### 混合检索

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `EMBEDDING_API_KEY` | - | OpenAI 兼容 API 密钥 |
| `EMBEDDING_BASE_URL` | `OLLAMA_HOST` | API 端点地址 |
| `EMBEDDING_MODEL` | nomic-embed-text | 嵌入模型名称 |
| `TOP_K` | 5 | 返回结果数量 |
| `EMBEDDING_CACHE_SIZE` | 500 | 嵌入缓存最大条数 |

**支持的 Embedding 服务**：

| 服务 | `EMBEDDING_BASE_URL` | `EMBEDDING_MODEL` 示例 |
|------|---------------------|------------------------|
| **Ollama** | `http://localhost:11434` | `nomic-embed-text`, `mxbai-embed-large` |
| **OpenAI** | `https://api.openai.com/v1` | `text-embedding-3-small`, `text-embedding-3-large` |
| **Jina** | `https://api.jina.ai/v1` | `jina-embeddings-v2-base-en` |
| **其他** | 自定义 | 任何 OpenAI 兼容模型 |

**注意**：`OLLAMA_HOST` 仍被支持，会自动作为 `EMBEDDING_BASE_URL` 的默认值。

#### 搜索控制

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SEARCH_PAGES` | 智能默认 | 搜索页数（见下方经验建议） |
| `SEARCH_ENGINES` | all | 指定搜索引擎，逗号分隔 |
| `SEARCH_TIMEOUT_MS` | 30000 | MCP 搜索超时（毫秒） |

## 经验建议

### SEARCH_PAGES 智能默认值

| 模式 | 默认值 | 说明 |
|------|--------|------|
| 纯文本检索（无 Embedding 配置） | 1 | 快速响应，基础相关性 |
| 混合检索（有 Embedding 配置） | 3 | 更多结果供 embedding 重排序 |

**启用混合检索条件**：设置 `EMBEDDING_API_KEY` 或 `EMBEDDING_BASE_URL` 或 `OLLAMA_HOST`

可手动覆盖：`SEARCH_PAGES=2` 或 `SEARCH_PAGES=5`

### MCP 超时配置建议

| 模式 | 建议超时 | 计算方式 |
|------|----------|----------|
| 纯文本检索 | 10-15秒 | SearXNG 全局超时 + 5-10秒 |
| 混合检索 | 30-60秒 | 视页数和机器配置调整 |

**SearXNG 全局超时**：在 `settings.yml` 中配置 `max_request_timeout: 5.0`

### 预期效果

| 配置 | 相关率 | 响应时间 |
|------|--------|----------|
| 1页 + 纯文本 | ~50% | 快（5-10秒） |
| 3页 + Embedding | ~80% | 中（15-30秒） |
| 5页 + Embedding | ~80% | 慢（30-60秒），可能超时 |

### 其他建议

1. **搜索词并发**：建议不超过 3 个关键词并发搜索
2. **模型预热**：Embedding 模型首次请求较慢，建议提前预热
3. **视频过滤**：建议在 SearXNG 配置中过滤视频网站以提升结果质量

#### URL 读取
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ENABLE_JS_RENDER` | true | 启用 JS 渲染降级 |
| `ENABLE_READABILITY` | true | 启用正文提取 |
| `FETCH_TIMEOUT_MS` | 30000 | URL 读取超时时间（毫秒） |

#### 缓存系统
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LINK_DEDUP_TTL` | 60 | 链接去重过期时间（秒） |
| `URL_CACHE_TTL` | 60 | URL 缓存过期时间（秒） |
| `URL_CACHE_SIZE` | 200 | URL 缓存最大条数 |
| `EMBEDDING_CACHE_SIZE` | 500 | 嵌入缓存最大条数 |

#### Context7
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CONTEXT7_API_KEY` | - | Context7 API Key（可选） |

#### 其他
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AUTH_USERNAME` | - | HTTP Basic Auth 用户名 |
| `AUTH_PASSWORD` | - | HTTP Basic Auth 密码 |
| `USER_AGENT` | - | 自定义 User-Agent |
| `HTTP_PROXY` | - | HTTP 代理地址 |
| `HTTPS_PROXY` | - | HTTPS 代理地址 |
| `MCP_HTTP_PORT` | - | HTTP 模式端口 |
| `ALLOWED_ORIGINS` | localhost:3000 | CORS 白名单，逗号分隔 |

## 安装配置

### NPX 方式

```json
{
  "mcpServers": {
    "augmented-search": {
      "command": "npx",
      "args": ["-y", "augmented-search"],
      "env": {
        "SEARXNG_URL": "YOUR_SEARXNG_INSTANCE_URL",
        "EMBEDDING_API_KEY": "YOUR_API_KEY",
        "EMBEDDING_BASE_URL": "http://localhost:11434",
        "CONTEXT7_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

### Docker 方式

```json
{
  "mcpServers": {
    "augmented-search": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "SEARXNG_URL",
        "-e", "OLLAMA_HOST",
        "ghcr.io/sebrinass/mcp-augmented-search:latest"
      ],
      "env": {
        "SEARXNG_URL": "YOUR_SEARXNG_INSTANCE_URL",
        "EMBEDDING_BASE_URL": "http://host.docker.internal:11434"
      }
    }
  }
}
```

### HTTP 模式

设置 `MCP_HTTP_PORT` 启用 HTTP 传输模式：

```json
{
  "mcpServers": {
    "augmented-search-http": {
      "command": "augmented-search",
      "env": {
        "SEARXNG_URL": "YOUR_SEARXNG_INSTANCE_URL",
        "MCP_HTTP_PORT": "3000"
      }
    }
  }
}
```

**HTTP 端点**：
- MCP 协议：`POST/GET/DELETE /mcp`
- 健康检查：`GET /health`
- REST API：`/api/*`

## REST API

启用 HTTP 模式后，可通过 REST API 直接调用所有功能，无需 MCP 客户端。

### API 端点列表

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api` | GET | API 信息 |
| `/api/search` | POST | 思考+搜索融合（对应 MCP search 工具） |
| `/api/read` | POST | URL 内容读取（对应 MCP read 工具） |
| `/api/library/search` | POST | 编程库搜索（对应 MCP library_search 工具） |
| `/api/library/docs` | POST | 库文档查询（对应 MCP library_docs 工具） |

### POST /api/search

思考 + 搜索融合，与 MCP search 工具完全一致。

**请求体**：
```json
{
  "thought": "当前思考内容",
  "thoughtNumber": 1,
  "totalThoughts": 3,
  "nextThoughtNeeded": true,
  "searchedKeywords": ["React hooks", "React 教程"],
  "site": "react.dev",
  "time_range": "month"
}
```

**响应**：
```json
{
  "success": true,
  "duration": "3000ms",
  "thoughtStatus": {
    "thoughtNumber": 1,
    "totalThoughts": 3,
    "nextThoughtNeeded": true,
    "thoughtHistoryLength": 1,
    "branches": []
  },
  "searchResults": [
    {
      "keyword": "React hooks",
      "cached": false,
      "resultCount": 10,
      "results": [
        {
          "title": "标题",
          "url": "https://...",
          "description": "描述",
          "relevance": 0.95
        }
      ]
    }
  ]
}
```

### POST /api/read

读取 URL 内容，支持批量。

**请求体**：
```json
{
  "urls": ["https://example.com"],
  "timeoutMs": 30000,
  "startChar": 0,
  "maxLength": 5000,
  "section": "Installation",
  "paragraphRange": "1-5",
  "readHeadings": false
}
```

**响应**：
```json
{
  "success": true,
  "urlCount": 1,
  "duration": "2345ms",
  "contentLength": 3000,
  "content": "Markdown 内容..."
}
```

### POST /api/library/search

搜索编程库，获取 Context7 库 ID。

**请求体**：
```json
{
  "query": "如何使用 React hooks",
  "libraryName": "react"
}
```

**响应**：
```json
{
  "success": true,
  "libraryName": "react",
  "resultCount": 5,
  "duration": "500ms",
  "results": [
    {
      "id": "/facebook/react",
      "title": "React",
      "description": "A JavaScript library for building UIs",
      "snippets": 1500,
      "benchmarkScore": 95,
      "trustScore": 98
    }
  ]
}
```

### POST /api/library/docs

查询库文档和代码示例。

**请求体**：
```json
{
  "libraryId": "/facebook/react",
  "query": "useEffect cleanup function"
}
```

**响应**：
```json
{
  "success": true,
  "libraryId": "/facebook/react",
  "query": "useEffect cleanup function",
  "duration": "800ms",
  "contentLength": 2000,
  "data": "文档内容..."
}
```

## 开发指南

### 本地开发

```bash
# 安装依赖
npm install

# 开发模式
npm run watch

# 构建
npm run build

# 测试
npm test

# MCP Inspector
npm run inspector
```

### 项目结构

```
src/
├── index.ts          # 主入口
├── search.ts         # 网络搜索
├── url-reader.ts     # URL 读取
├── research.ts       # Research 工具
├── embedding.ts      # 混合检索（RRF）
├── context7.ts       # Context7 集成
├── cache.ts          # 缓存系统
├── types.ts          # 类型定义
├── logging.ts        # 日志模块
├── error-handler.ts  # 错误处理
├── resources.ts      # 资源定义
├── http-server.ts    # HTTP 服务器
├── api-routes.ts     # REST API 路由
└── proxy.ts          # 代理配置
```

## 许可证

MIT License
