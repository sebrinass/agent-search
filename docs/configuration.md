# 配置参考

agent-search 的完整环境变量配置。

## 必填配置

### SEARXNG_URL

SearXNG 实例地址。

```bash
SEARXNG_URL=http://localhost:8080
```

**示例值：**
- 本地 Docker: `http://localhost:8080`
- Docker 内部通信: `http://searxng:8080`
- 远程实例: `https://search.example.com`

### RERANK_BASE_URL / RERANK_API_KEY

rerank 服务地址或 API 密钥（二选一，MCP 服务模式启动时强制校验）。

**本地推理（推荐，零成本）：**

```bash
RERANK_BASE_URL=http://localhost:11434
```

**云端 API（Jina/Cohere/SiliconFlow/Together 等）：**

```bash
RERANK_BASE_URL=https://api.jina.ai/v1
RERANK_API_KEY=jina_xxxxx
```

---

## Rerank 重排配置（必填）

### RERANK_MODEL

rerank 模型名称。

```bash
RERANK_MODEL=jina-reranker-v2-base-multilingual
```

**默认值：** `jina-reranker-v2-base-multilingual`

### RERANK_TIMEOUT_MS

rerank 调用超时（毫秒）。超时或失败时自动降级为 SearXNG 原始排序，搜索不中断。

```bash
RERANK_TIMEOUT_MS=30000
```

**默认值：** `30000`（30 秒）

### RERANK_MAX_TEXT_LENGTH

发给 rerank 的单条文档最大字符数（title 完整保留 + content 截断）。

```bash
RERANK_MAX_TEXT_LENGTH=300
```

**默认值：** `300`

### RERANK_CACHE_SIZE

rerank 结果缓存条目数（同一 query + 同一批 URL 直接命中，避免重复推理）。

```bash
RERANK_CACHE_SIZE=100
```

**默认值：** `100`

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
SEARCH_PAGES=1
```

**默认值：** `1`

### SEARCH_ENGINES

指定搜索引擎，逗号分隔。

```bash
SEARCH_ENGINES=google,baidu,bing
```

**默认值：** 空（使用 SearXNG 默认全部引擎）

### SEARCH_TIMEOUT_MS

单关键词整体搜索最坏情况兜底（毫秒，含抓页 + rerank）。

```bash
SEARCH_TIMEOUT_MS=50000
```

**默认值：** `50000`（50 秒）

**实际生效规则：** `max(SEARCH_TIMEOUT_MS, SEARCH_PAGE_TIMEOUT_MS + RERANK_TIMEOUT_MS + 5000)`。即无论显式配多少，兜底都不会小于「单页抓取 + rerank 超时 + 5s 余量」——保证 rerank 永远有完整超时时间，rerank 超时后自行降级为 SearXNG 原始排序（结果不丢失），整词兜底不会抢在降级前截断。

### SEARCH_PAGE_TIMEOUT_MS

单次 SearXNG 页面请求的独立超时（毫秒），应小于 `SEARCH_TIMEOUT_MS`。一页慢只丢该页（该页返回空结果），不拖死整个关键词的并发抓取。

```bash
SEARCH_PAGE_TIMEOUT_MS=15000
```

**默认值：** `15000`（15 秒）

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

### MAX_KEYWORDS

单次搜索最大关键词数量。

```bash
MAX_KEYWORDS=3
```

**默认值：** `3`

### MAX_DESCRIPTION_LENGTH

搜索结果描述最大长度（有意的保守值：控制返回体量，信息已足够）。

```bash
MAX_DESCRIPTION_LENGTH=200
```

**默认值：** `200`

---

## URL 读取配置（可选）

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

### URL_READ_MAX_CONTENT_LENGTH_BYTES

URL 读取最大内容长度（字节），超出即报错并建议用分页/章节提取。

```bash
URL_READ_MAX_CONTENT_LENGTH_BYTES=5242880
```

**默认值：** `5242880`（5 MB）

### DISABLE_CURL_CFFI

设为 `true` 可禁用 curl-cffi（浏览器 TLS 指纹抓取），回退原生 fetch（便于测试/mock）。

### USER_AGENT

HTTP 请求 User-Agent。

**默认值：** 内置默认 User-Agent

---

## HTTP 服务配置（可选）

### MCP_HTTP_PORT

启用 HTTP 模式并指定端口。HTTP 模式默认**有状态**（initialize 返回 mcp-session-id，兼容 Hermes 等依赖会话的客户端）；双协议兼容（2026-07-28 + 2025）。

```bash
MCP_HTTP_PORT=3000
```

**默认值：** 空（使用 STDIO 模式）

启用后可访问：
- MCP 端点: `http://localhost:3000/mcp`（同时支持 MCP 2026-07-28 与 2025 协议）
- 健康检查: `http://localhost:3000/health`

### MCP_SESSION_MODE

HTTP 模式下的 MCP 会话管理方式：

| 值 | 说明 |
|----|------|
| `stateful`（默认） | **有状态**：initialize 返回 `mcp-session-id`，后续请求需携带。兼容 Hermes 等依赖会话的客户端（否则其 MCP 工具注册失败，表现为直接调用报 `does not exist`）。会话空闲 30 分钟自动清理 |
| `stateless` | **无状态**：每次请求由 factory 新建 Server 实例，不返回 session id。容器重启/水平扩展/负载均衡无需粘性会话，适合多副本 Docker 部署 |

```bash
# 有状态（默认，无需显式设置）
MCP_SESSION_MODE=stateful

# 无状态（多副本/负载均衡场景）
MCP_SESSION_MODE=stateless
```

### AUTH_USERNAME / AUTH_PASSWORD

Basic Auth 认证凭据。

```bash
AUTH_USERNAME=admin
AUTH_PASSWORD=your-secret-password
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

### 最小配置（本地推理）

```bash
SEARXNG_URL=http://localhost:8080
RERANK_BASE_URL=http://localhost:11434
```

### 完整配置（云端 rerank + HTTP 模式）

```bash
# 必填
SEARXNG_URL=http://localhost:8080
RERANK_BASE_URL=https://api.jina.ai/v1
RERANK_API_KEY=jina_xxxxx
RERANK_MODEL=jina-reranker-v2-base-multilingual
TOP_K=5

# HTTP 模式（默认有状态）
MCP_HTTP_PORT=3000
AUTH_USERNAME=admin
AUTH_PASSWORD=your-secret-password

# 搜索控制
SEARCH_PAGES=1
```

### Docker Compose 配置

```yaml
services:
  agent-search:
    image: ghcr.io/sebrinass/agent-search:latest
    environment:
      - SEARXNG_URL=http://searxng:8080
      - RERANK_BASE_URL=http://host.docker.internal:11434
      - MCP_HTTP_PORT=3000
```

---

## 性能参考

| 模式 | SEARCH_PAGES | 相关性 |
|------|--------------|--------|
| SearXNG 原始排序（rerank 失败降级） | 1 | ~50% |
| Rerank 重排 | 1 | ~80% |

**优化建议：**
- 搜索关键词并发不超过 3 个
- 在 SearXNG 配置中过滤视频网站以提升结果质量
- rerank 超时失败会自动降级为原始排序，不会中断搜索
