# 🔍 Augmented Search

[![MCP Badge](https://lobehub.com/badge/mcp/sebrinass-mcp-augmented-search)](https://lobehub.com/mcp/sebrinass-mcp-augmented-search)

为 Agent 提供高效的本地联网搜索和代码搜索能力。支持并发检索多个关键词，通过 Embedding 重排序将相关性，大幅减少搜索轮次和上下文消耗。

## 这能帮你做什么？

**场景一：快速调研陌生领域**

> "帮我调研一下 2024 年 RAG 技术的最新进展"

传统方式需要多轮搜索、逐个打开链接。augmented-search 一次并发搜索多个关键词，自动重排序返回最相关结果。

**场景二：查阅编程文档**

> "React useEffect 的 cleanup 函数怎么用？"

直接查询 Context7 代码库，无需打开浏览器翻文档。

**场景三：隐私敏感搜索**

所有搜索请求通过本地 SearXNG 实例发出，数据不出本地。

## 核心特性

- **🚀 并发检索** — 多关键词同时搜索，效率翻倍
- **🎯 混合检索** — Embedding 重排序
- **📚 代码搜索** — Context7 集成，直接查询库文档
- **🔒 本地部署** — 数据不出本地，隐私安全可控

## 快速开始

### 前置条件

需要一个 SearXNG 实例。如果没有，可以用 Docker 快速启动：

```bash
docker run -d --name searxng -p 8080:8080 searxng/searxng:latest
```

### 方式一：Docker（推荐）

```bash
docker run -d --name augmented-search -p 3000:3000 \
  -e SEARXNG_URL=http://host.docker.internal:8080 \
  ghcr.io/sebrinass/mcp-augmented-search:latest
```

### 方式二：npm

```bash
npm install -g augmented-search
SEARXNG_URL=http://localhost:8080 augmented-search
```

### 方式三：Agent 一键添加

阅读 [SKILL.md](skill/SKILL.md) 获取 Agent 安装指南。

## 提供的工具

### search — 思考 + 并发搜索

支持混合检索和链接去重，一次请求最多搜索 3 个关键词。

**必填参数：**
- `thought` — 当前思考内容
- `thoughtNumber` — 当前思考步骤编号
- `totalThoughts` — 预计总思考步骤数
- `nextThoughtNeeded` — 是否需要继续思考

**可选参数：**
- `searchedKeywords` — 搜索关键词列表（最多 3 个并发）
- `site` — 限制搜索域名

### read — URL 内容提取

读取网页内容，支持 JS 渲染降级和正文提取。

**参数：**
- `urls` — URL 数组（支持批量读取）
- `startChar` / `maxLength` — 分页读取
- `section` — 提取指定章节
- `paragraphRange` — 段落范围
- `readHeadings` — 仅返回标题列表

### library_search — 搜索编程库

搜索编程库，获取 Context7 兼容的库 ID。

**参数：**
- `query` — 用户问题（用于相关性排序）
- `libraryName` — 库名，如 `react`

### library_docs — 查询库文档

查询库的文档和代码示例。

**参数：**
- `libraryId` — 库 ID，如 `/facebook/react`
- `query` — 用户问题

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
| `SEARCH_TIMEOUT_MS` | 30000 | 搜索超时（毫秒） |

完整配置请参阅 [docs/configuration.md](docs/configuration.md)。

## 性能参考

| 模式 | 页数 | 超时 | 相关性 |
|------|------|------|--------|
| 纯文本 | 1 | 10-15秒 | ~50% |
| 混合检索 | 3 | 30-60秒 | ~80% |

**优化建议：**
- 搜索关键词并发不超过 3 个
- 在 SearXNG 配置中过滤视频网站以提升结果质量

## HTTP 模式

设置 `MCP_HTTP_PORT` 启用 HTTP 模式：

```bash
MCP_HTTP_PORT=3000 augmented-search
```

可用端点：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/mcp` | POST/GET/DELETE | MCP 协议 |
| `/health` | GET | 健康检查 |
| `/api/search` | POST | 搜索 |
| `/api/read` | POST | URL 读取 |
| `/api/library/search` | POST | 库搜索 |
| `/api/library/docs` | POST | 库文档 |

## 更多资源

- [Skill 文档](skill/SKILL.md) — Agent 安装指南
- [配置参考](docs/configuration.md) — 完整环境变量说明
- [安装指南](skill/reference/installation.md) — SearXNG 配置、OpenClaw 集成
- [SearXNG 文档](https://docs.searxng.org)

## 许可证

MIT License
