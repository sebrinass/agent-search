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

### code_resolve
解析库名为 Context7 兼容的库 ID。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | 是 | 用户问题（用于相关性排序） |
| libraryName | string | 是 | 库名，如 react |

### code_query
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
| `ENABLE_EMBEDDING` | true | 启用混合检索 |
| `OLLAMA_HOST` | http://localhost:11434 | Ollama 地址 |
| `EMBEDDING_MODEL` | nomic-embed-text | 嵌入模型 |
| `TOP_K` | 3 | 返回结果数量 |
| `SEARCH_TIMEOUT_MS` | 30000 | 搜索超时时间（毫秒） |

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
        "OLLAMA_HOST": "http://localhost:11434",
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
        "OLLAMA_HOST": "http://host.docker.internal:11434"
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
└── proxy.ts          # 代理配置
```

## 许可证

MIT License
