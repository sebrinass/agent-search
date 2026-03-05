# 配置参考

augmented-search 的完整环境变量配置。

## 必填配置

### SEARXNG_URL

SearXNG 实例地址，这是唯一必需的配置项。

```bash
SEARXNG_URL=http://localhost:8080
```

**示例值：**
- 本地 Docker: `http://localhost:8080`
- Docker 内部通信: `http://searxng:8080`
- 远程实例: `https://search.example.com`

---

## 混合检索配置（可选）

启用 Embedding 重排序可将搜索相关性从 ~50% 提升至 ~80%。

### EMBEDDING_API_KEY

OpenAI 兼容 API 密钥。使用 Ollama 本地部署时无需配置。

```bash
EMBEDDING_API_KEY=sk-xxxxx
```

### EMBEDDING_BASE_URL

Embedding API 端点地址。

```bash
EMBEDDING_BASE_URL=http://localhost:11434
```

**默认值：** 使用 `OLLAMA_HOST` 环境变量

**常用端点：**
| 服务 | 端点地址 |
|------|----------|
| Ollama | `http://localhost:11434` |
| OpenAI | `https://api.openai.com/v1` |
| Jina | `https://api.jina.ai/v1` |

### OLLAMA_HOST

Ollama 服务地址。当未设置 `EMBEDDING_BASE_URL` 时，将使用此值。

```bash
OLLAMA_HOST=http://localhost:11434
```

### EMBEDDING_MODEL

嵌入模型名称。

```bash
EMBEDDING_MODEL=nomic-embed-text
```

**默认值：** `nomic-embed-text`

**推荐模型：**
| 服务 | 推荐模型 |
|------|----------|
| Ollama | `nomic-embed-text`, `mxbai-embed-large` |
| OpenAI | `text-embedding-3-small` |
| Jina | `jina-embeddings-v2-base-en` |

### TOP_K

返回结果数量。

```bash
TOP_K=5
```

**默认值：** `5`

---

## 搜索控制配置（可选）

### SEARCH_PAGES

搜索页数，每页约 10 条结果。

```bash
SEARCH_PAGES=3
```

**默认值：** 智能调整（纯文本 1 页，混合检索 3 页）

### SEARCH_ENGINES

指定搜索引擎，逗号分隔。

```bash
SEARCH_ENGINES=google,baidu,bing
```

**默认值：** 空（使用 SearXNG 默认全部引擎）

### SEARCH_TIMEOUT_MS

MCP 搜索工具超时时间（毫秒）。

```bash
SEARCH_TIMEOUT_MS=30000
```

**默认值：** `30000`（30 秒）

**建议：**
- 纯文本模式：10-15 秒
- 混合检索模式：30-60 秒

### SEARCH_LANGUAGE

搜索语言。

```bash
SEARCH_LANGUAGE=zh-CN
```

**默认值：** `all`（所有语言）

### SAFE_SEARCH

安全搜索级别。

```bash
SAFE_SEARCH=0
```

**默认值：** `0`（关闭）

**可选值：** `0`（关闭）、`1`（中等）、`2`（严格）

### MAX_THOUGHTS

搜索工具最大思考步骤数。

```bash
MAX_THOUGHTS=5
```

**默认值：** `5`

### MAX_KEYWORDS

单次搜索最大关键词数量。

```bash
MAX_KEYWORDS=3
```

**默认值：** `3`

### MAX_DESCRIPTION_LENGTH

搜索结果描述最大长度。

```bash
MAX_DESCRIPTION_LENGTH=200
```

**默认值：** `200`

---

## URL 读取配置（可选）

### ENABLE_JS_RENDER

启用 JS 渲染降级。当普通请求失败时，尝试用无头浏览器渲染。

```bash
ENABLE_JS_RENDER=true
```

**默认值：** `true`

### ENABLE_READABILITY

启用正文提取。使用 Readability.js 提取网页主要内容。

```bash
ENABLE_READABILITY=true
```

**默认值：** `true`

### FETCH_TIMEOUT_MS

URL 读取超时时间（毫秒）。

```bash
FETCH_TIMEOUT_MS=30000
```

**默认值：** `30000`（30 秒）

### USER_AGENT

HTTP 请求 User-Agent。

```bash
USER_AGENT=Mozilla/5.0 ...
```

**默认值：** 内置默认 User-Agent

---

## HTTP 服务配置（可选）

### MCP_HTTP_PORT

启用 HTTP 模式并指定端口。

```bash
MCP_HTTP_PORT=3000
```

**默认值：** 空（使用 STDIO 模式）

启用后可访问：
- MCP 端点: `http://localhost:3000/mcp`
- 健康检查: `http://localhost:3000/health`
- REST API: `http://localhost:3000/api/*`

### AUTH_USERNAME / AUTH_PASSWORD

Basic Auth 认证凭据。

```bash
AUTH_USERNAME=admin
AUTH_PASSWORD=secret
```

**默认值：** 空（无认证）

### ALLOWED_ORIGINS

CORS 白名单，逗号分隔。

```bash
ALLOWED_ORIGINS=localhost:3000,example.com
```

**默认值：** `localhost:3000`

---

## 缓存配置（可选）

### LINK_DEDUP_TTL

链接去重缓存 TTL（秒）。

```bash
LINK_DEDUP_TTL=86400
```

**默认值：** `86400`（24 小时）

### URL_CACHE_TTL

URL 内容缓存 TTL（秒）。

```bash
URL_CACHE_TTL=3600
```

**默认值：** `3600`（1 小时）

### URL_CACHE_SIZE

URL 缓存最大条目数。

```bash
URL_CACHE_SIZE=100
```

**默认值：** `100`

### EMBEDDING_CACHE_SIZE

Embedding 缓存最大条目数。

```bash
EMBEDDING_CACHE_SIZE=1000
```

**默认值：** `1000`

---

## Context7 配置（可选）

### CONTEXT7_API_KEY

Context7 API 密钥，用于代码库搜索功能。

```bash
CONTEXT7_API_KEY=your-api-key
```

### CONTEXT7_API_URL

Context7 API 地址。

```bash
CONTEXT7_API_URL=https://api.context7.com/v1
```

**默认值：** `https://api.context7.com/v1`

---

## 代理配置（可选）

### HTTP_PROXY / HTTPS_PROXY

HTTP 代理地址。

```bash
HTTP_PROXY=http://proxy.example.com:8080
HTTPS_PROXY=http://proxy.example.com:8080
```

### NO_PROXY

不使用代理的地址，逗号分隔。

```bash
NO_PROXY=localhost,127.0.0.1
```

---

## 配置示例

### 最小配置

```bash
SEARXNG_URL=http://localhost:8080
```

### 完整配置（混合检索 + HTTP 模式）

```bash
# 必填
SEARXNG_URL=http://localhost:8080

# 混合检索
EMBEDDING_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
TOP_K=5

# HTTP 模式
MCP_HTTP_PORT=3000
AUTH_USERNAME=admin
AUTH_PASSWORD=secret

# 搜索控制
SEARCH_PAGES=3
SEARCH_TIMEOUT_MS=60000
```

### Docker Compose 配置

```yaml
services:
  augmented-search:
    image: ghcr.io/sebrinass/mcp-augmented-search:latest
    environment:
      - SEARXNG_URL=http://searxng:8080
      - EMBEDDING_BASE_URL=http://host.docker.internal:11434
      - MCP_HTTP_PORT=3000
```

---

## 性能参考

| 模式 | SEARCH_PAGES | SEARCH_TIMEOUT_MS | 相关性 |
|------|--------------|-------------------|--------|
| 纯文本 | 1 | 10000-15000 | ~50% |
| 混合检索 | 3 | 30000-60000 | ~80% |

**优化建议：**
- 搜索关键词并发不超过 3 个
- 在 SearXNG 配置中过滤视频网站以提升结果质量
- 确保 SearXNG 超时小于 MCP 超时 5-10 秒
