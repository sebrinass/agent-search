import express from "express";
import cors from "cors";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { packageVersion } from "./version.js";
import { createMcpServer } from "./mcp-main.js";
import { ALLOWED_ORIGINS } from "./config.js";

/**
 * 无状态 MCP HTTP 入口（createMcpHandler）：
 * - 同一 /mcp 端点同时服务 2026-07-28（modern）与 2025-era（legacy stateless）客户端
 * - 无会话状态 → 容器重启 / 水平扩展 / 负载均衡均无需粘性会话，适合 Docker 部署
 * - 每个请求由 factory 新建 Server 实例，业务缓存（URL/rerank/去重）为模块级单例，跨请求共享
 */
export async function createHttpServer(): Promise<express.Application> {
  const app = express();
  // 注意：不能全局挂 express.json()——toNodeHandler 需要读取原始请求流来解析 body，
  // 若被 express.json() 抢先消费，MCP 请求会因 body 为空报 Parse error。

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'mcp-session-id', 'mcp-protocol-version', 'mcp-method', 'mcp-name'],
  }));

  const mcpHandler = createMcpHandler(() => createMcpServer().server);

  app.all('/mcp', toNodeHandler(mcpHandler, {
    onerror: (error) => {
      console.error(`[HTTP] MCP handler error:`, error instanceof Error ? error.message : String(error));
    },
  }));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      server: 'agent-search',
      version: packageVersion,
      transport: 'http',
      mode: 'stateless',
    });
  });

  return app;
}
