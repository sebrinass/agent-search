# Agent Search



为 Agent 提供高效的本地联网搜索能力。支持并发检索多个关键词，通过 Embedding 重排序将相关性，大幅减少搜索轮次和上下文消耗。

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
- **🎯 混合检索** — Embedding 重排序
- **🔒 本地部署** — 数据不出本地，隐私安全可控

## 快速开始

### 前置条件

需要一个 SearXNG 实例。如果没有，可以用 Docker 快速启动：

```bash
docker run -d --name searxng -p 8080:8080 searxng/searxng:latest
```

### 环境变量配置

支持通过 `.env` 文件配置环境变量（推荐）：

```bash
cp .env.example .env
# 编辑 .env 文件填入你的配置
```

### 方式一：Docker（推荐）

```bash
docker run -d --name agent-search -p 3000:3000 \
  -e SEARXNG_URL=http://host.docker.internal:8080 \
  ghcr.io/sebrinass/agent-search:latest
```

### 方式二：npm

```bash
npm install -g agent-local-search
agent-search
```

### 方式三：Agent 一键添加

阅读 [SKILL.md](skill/SKILL.md) 获取 Agent 安装指南。

## 提供的工具

### search — 并发搜索

支持混合检索和链接去重，一次请求最多搜索 3 个关键词。

**必填参数：**
- `searchedKeywords` — 搜索关键词列表（最多 3 个并发）

**可选参数：**
- `category` — 搜索分类（general, news, science, it, images, videos, files, music）
- `site` — 限制搜索域名
- `time_range` — 时间范围过滤（day, month, year）
- `lang` — 搜索语言（如 en, zh, all）
- `safeSearch` — 安全搜索级别（0=关闭，1=中等，2=严格）

### read — URL 内容提取

读取网页内容，支持 JS 渲染降级和正文提取。

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

### 常用可选

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `EMBEDDING_BASE_URL` | - | Embedding API 端点（启用混合检索），推荐配合 **jina-embeddings-v5-text-nano** 模型使用 |

> **智能模式切换**：无需手动指定搜索模式。当配置了 `EMBEDDING_BASE_URL` 时，自动启用混合检索（Embedding 重排序）；未配置时自动使用纯文本检索模式。
| `EMBEDDING_TIMEOUT_MS` | 90000 | 嵌入模型超时（毫秒），超时后降级为纯文本检索 |
| `MCP_HTTP_PORT` | - | HTTP 模式端口 |
| `SEARCH_TIMEOUT_MS` | EMBEDDING_TIMEOUT + 10s | 搜索超时（毫秒） |

完整配置请参阅 [docs/configuration.md](docs/configuration.md)。

## 性能参考

| 模式 | 页数 | 超时 | 相关性 |
|------|------|------|--------|
| 纯文本 | 1 | 10-15秒 | ~50% |
| 混合检索 | 3 | 30-60秒 | ~80% |

**优化建议：**
- 搜索关键词并发不超过 3 个
- 在 SearXNG 配置中过滤视频网站以提升结果质量

## CLI 使用

安装后可通过 `agent-search` 命令使用 CLI 工具。

### 子命令列表

| 命令 | 说明 |
|------|------|
| `search` | 通用网络搜索 |
| `read` | 读取 URL 内容 |
| `serve` | 启动 MCP Server |

### search — 网络搜索

```bash
# 基本搜索
SEARXNG_URL=http://localhost:8080 agent-search search -q "RAG 技术"

# 多关键词并发搜索
SEARXNG_URL=http://localhost:8080 agent-search search -q "RAG" "向量数据库" "Embedding"

# 限制域名和时间范围
SEARXNG_URL=http://localhost:8080 agent-search search -q "React 19" --site github.com --time-range month

# 指定语言和安全搜索
SEARXNG_URL=http://localhost:8080 agent-search search -q "TypeScript" --lang en --safe-search 1

# JSON 格式输出
SEARXNG_URL=http://localhost:8080 agent-search search -q "RAG 技术" --json

# 详细输出
SEARXNG_URL=http://localhost:8080 agent-search -v search -q "RAG 技术"
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

### read — URL 内容读取

```bash
# 读取单个 URL
agent-search read https://example.com

# 读取多个 URL
agent-search read https://example.com https://example.org

# 分页读取
agent-search read https://example.com --start-char 1000 --max-length 5000

# 提取指定章节
agent-search read https://example.com --section "Installation"

# 段落范围
agent-search read https://example.com --paragraph-range 1-5

# 仅返回标题列表
agent-search read https://example.com --headings

# 自定义超时
agent-search read https://example.com --timeout 15000
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

# HTTP 模式
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
| `SEARXNG_URL` | search 命令必填 | SearXNG 实例地址 |
| `EMBEDDING_BASE_URL` | 否 | Embedding API 端点（启用混合检索） |
| `EMBEDDING_TIMEOUT_MS` | 否 | 嵌入模型超时（毫秒），默认 90000 |
| `SEARCH_TIMEOUT_MS` | 否 | 搜索超时（毫秒），默认 EMBEDDING_TIMEOUT + 10s |
| `MCP_HTTP_PORT` | serve 命令 | HTTP 模式端口 |

## HTTP 模式

设置 `MCP_HTTP_PORT` 启用 HTTP 模式：

```bash
MCP_HTTP_PORT=3000 agent-search
```

可用端点：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/mcp` | POST/GET/DELETE | MCP 协议 |
| `/health` | GET | 健康检查 |

## 更多资源

- [Skill 文档](skill/SKILL.md) — Agent 安装指南
- [配置参考](docs/configuration.md) — 完整环境变量说明
- [安装指南](skill/reference/installation.md) — SearXNG 配置、OpenClaw 集成
- [SearXNG 文档](https://docs.searxng.org)

## 许可证

MIT License
