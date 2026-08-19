# Agent Search

为 Agent 提供高效的本地联网搜索能力。支持并发检索多个关键词，通过 cross-encoder **rerank 重排**返回最相关结果，大幅减少搜索轮次和上下文消耗。

## 这能帮你做什么？

**场景一：快速调研陌生领域**

> "帮我调研一下 2024 年 RAG 技术的最新进展"

传统方式需要多轮搜索、逐个打开链接。agent-search 一次并发搜索多个关键词，自动重排序返回最相关结果。

**场景二：快速查阅资料**

> "帮我看看最近关于 AI 编程有什么新闻？"

**场景三：隐私敏感搜索**

所有搜索请求通过本地 SearXNG 实例发出，数据不出本地。

## 核心特性

- **🚀 并发检索** — 多关键词同时搜索，效率翻倍
- **🎯 Rerank 重排** — cross-encoder 相关性重排，结果更精准（支持本地推理服务，零成本）
- **📄 PDF 读取** — `urls_read` 直接读 PDF，本地解析不上传
- **🔒 本地部署** — 数据不出本地，隐私安全可控
- **🔄 MCP 双时代 + 会话模式** — 同一端点同时支持 MCP 2026-07-28 与 2025 协议；默认**有状态**（返回 mcp-session-id，Hermes 等客户端可正常注册工具），可环境变量切换无状态（多副本部署友好）

## 快速开始

### 前置条件

1. 一个 SearXNG 实例：

```bash
docker run -d --name searxng -p 8080:8080 searxng/searxng:latest
```

2. 一个 rerank 服务（二选一）：
   - 本地推理（如 Ollama 跑 reranker 模型）：`RERANK_BASE_URL=http://localhost:11434`
   - 云端 API（Jina/Cohere/SiliconFlow/Together 等）：配置 `RERANK_BASE_URL` + `RERANK_API_KEY`

> **注意**：rerank 是唯一的搜索排序方式，`RERANK_BASE_URL` 或 `RERANK_API_KEY` 为必填（MCP 服务模式启动时强制校验）。

### 环境变量配置

支持通过 `.env` 文件配置环境变量（推荐）：

```bash
cp .env.example .env
# 编辑 .env 文件填入你的配置
```

### 方式一：Docker（推荐，HTTP 部署）

```bash
docker run -d --name agent-search -p 3000:3000 \
  -e SEARXNG_URL=http://host.docker.internal:8080 \
  -e RERANK_BASE_URL=http://host.docker.internal:11434 \
  -e MCP_HTTP_PORT=3000 \
  ghcr.io/sebrinass/agent-search:latest
```

HTTP 模式默认**有状态**（initialize 返回 mcp-session-id，兼容 Hermes 等依赖会话的客户端）；
如需多副本/负载均衡部署，设置 `MCP_SESSION_MODE=stateless` 切换为无状态（无会话 ID，无需粘性会话）。

### 方式二：npm

```bash
npm install -g agent-local-search
agent-search
```

### 方式三：Agent 一键添加

阅读 [SKILL.md](skill/SKILL.md) 获取 Agent 安装指南。

## 提供的工具

### web_search — 通用网络搜索

并发搜索 + rerank 重排 + 链接去重，一次请求最多搜索 3 个关键词。

**必填参数：**
- `searchedKeywords` — 搜索关键词列表（最多 3 个并发）

**可选参数：**
- `category` — 搜索分类（general, news, science, it, images, videos, files, music）
- `site` — 限制搜索域名
- `time_range` — 时间范围过滤（day, month, year）
- `lang` — 搜索语言（如 en, zh, all）
- `safeSearch` — 安全搜索级别（0=关闭，1=中等，2=严格）

### urls_read — URL 内容读取

读取网页（自动转 Markdown）或 PDF（本地解析），支持批量、分页、章节提取。

**参数：**
- `urls` — URL 数组（支持批量读取）
- `startChar` / `maxLength` — 分页读取
- `section` — 提取指定章节
- `paragraphRange` — 段落范围
- `readHeadings` — 仅返回标题列表

## 配置

### 必填

| 变量 | 说明 |
|------|------|
| `SEARXNG_URL` | SearXNG 实例地址 |
| `RERANK_BASE_URL` 或 `RERANK_API_KEY` | rerank 服务地址（或云端 API 密钥），二选一 |

### 常用可选

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RERANK_MODEL` | jina-reranker-v2-base-multilingual | rerank 模型名 |
| `RERANK_API_KEY` | - | 云端 rerank API 密钥 |
| `RERANK_TIMEOUT_MS` | 30000 | rerank 调用超时（毫秒），失败自动降级为 SearXNG 原始排序 |
| `RERANK_MAX_TEXT_LENGTH` | 300 | 发给 rerank 的单条文档最大字符数 |
| `MCP_HTTP_PORT` | - | HTTP 模式端口 |
| `MCP_SESSION_MODE` | stateful | HTTP 会话模式：`stateful`（默认，返回 mcp-session-id）/ `stateless`（无会话，多副本部署） |
| `SEARCH_PAGES` | 1 | 每关键词抓取页数 |
| `SEARCH_TIMEOUT_MS` | 60000 | 搜索超时（毫秒） |
| `TOP_K` | 5 | 返回结果条数 |

完整配置请参阅 [docs/configuration.md](docs/configuration.md)。

## CLI 使用

安装后可通过 `agent-search` 命令使用 CLI 工具（命令名与 MCP 工具名对齐）。

### 子命令列表

| 命令 | 说明 |
|------|------|
| `web-search` | 通用网络搜索（rerank 重排） |
| `urls-read` | 读取 URL 内容（网页/PDF） |
| `serve` | 启动 MCP Server |

### web-search — 网络搜索

```bash
# 基本搜索（配好 .env 后直接使用）
agent-search web-search -q "RAG 技术"

# 多关键词并发搜索（推荐）
agent-search web-search -q "RAG" "向量数据库" "Embedding"

# 限制域名和时间范围
agent-search web-search -q "React 19" --site github.com --time-range month

# 指定分类和语言
agent-search web-search -q "TypeScript" --category it --lang en

# JSON 格式输出
agent-search web-search -q "RAG 技术" --json

# 详细输出
agent-search -v web-search -q "RAG 技术"

# 未配置 .env 时，也可通过环境变量指定
SEARXNG_URL=http://localhost:8080 RERANK_BASE_URL=http://localhost:11434 agent-search web-search -q "RAG 技术"
```

**选项：**

| 选项 | 说明 |
|------|------|
| `-q, --query <keywords...>` | 搜索关键词（必填，最多 3 个） |
| `-s, --site <domain>` | 限制搜索域名 |
| `--time-range <range>` | 时间范围: day, month, year |
| `--lang <language>` | 搜索语言（默认 all） |
| `--safe-search <level>` | 安全搜索级别: 0, 1, 2（默认 0） |
| `--json` | 以 JSON 格式输出结果 |

### 全局选项

| 选项 | 说明 |
|------|------|
| `-v, --verbose` | 显示详细输出（适用于所有子命令） |

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

# 自定义超时
agent-search urls-read https://example.com --timeout 15000
```

**选项：**

| 选项 | 说明 |
|------|------|
| `urls` | URL 列表（必填） |
| `--start-char <number>` | 起始字符位置（默认 0） |
| `--max-length <number>` | 最大返回字符数 |
| `--section <heading>` | 提取指定章节 |
| `--paragraph-range <range>` | 段落范围（如 1-5, 3, 10-） |
| `--headings` | 仅返回标题列表 |
| `--timeout <ms>` | 超时时间（毫秒） |

### serve — 启动 MCP Server

```bash
# stdio 模式（默认）
agent-search serve

# HTTP 模式（默认有状态，推荐容器部署）
agent-search serve --transport http --port 3000
```

**选项：**

| 选项 | 说明 |
|------|------|
| `--transport <type>` | 传输模式: stdio, http（默认 stdio） |
| `--port <number>` | HTTP 模式端口（需 --transport http） |

### 环境变量

CLI 命令依赖以下环境变量：

| 变量 | 必填 | 说明 |
|------|------|------|
| `SEARXNG_URL` | web-search 必填 | SearXNG 实例地址 |
| `RERANK_BASE_URL` 或 `RERANK_API_KEY` | 是 | rerank 服务地址/密钥 |
| `SEARCH_TIMEOUT_MS` | 否 | 搜索超时（毫秒），默认 60000 |
| `MCP_HTTP_PORT` | serve 命令 | HTTP 模式端口 |

## HTTP 模式（MCP 双时代）

设置 `MCP_HTTP_PORT` 启用 HTTP 模式：

```bash
MCP_HTTP_PORT=3000 agent-search
```

- **有状态（默认）**：initialize 返回 mcp-session-id，Hermes 等依赖会话的客户端可正常注册工具；设 `MCP_SESSION_MODE=stateless` 切无状态（无会话 ID，多副本无需粘性会话）
- **双协议兼容**：同一 `/mcp` 端点同时服务 MCP 2026-07-28（modern）与 2025-11-25（legacy）客户端，自动识别

可用端点：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/mcp` | POST/GET/DELETE | MCP 协议（双时代） |
| `/health` | GET | 健康检查 |

## 更多资源

- [Skill 文档](skill/SKILL.md) — Agent 安装指南
- [配置参考](docs/configuration.md) — 完整环境变量说明
- [安装指南](skill/reference/installation.md) — SearXNG 配置、OpenClaw 集成
- [SearXNG 文档](https://docs.searxng.org)

## 许可证

MIT License
