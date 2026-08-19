import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import {
  Server,
  isInitializeRequest,
  createMcpHandler,
} from "@modelcontextprotocol/server";
import {
  NodeStreamableHTTPServerTransport,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { packageVersion } from "./version.js";
import { createMcpServer } from "./mcp-main.js";
import { ResearchServer } from "./research.js";
import { ALLOWED_ORIGINS } from "./config.js";

/**
 * MCP HTTP 入口，支持两种会话模式（由 MCP_SESSION_MODE 环境变量控制，默认 stateful）：
 *
 * - stateful（默认）：有状态。每个会话由 NodeStreamableHTTPServerTransport 管理，
 *   initialize 时生成并返回 mcp-session-id。依赖会话的客户端（如 Hermes）可正常
 *   注册工具；支持 GET（SSE 流）/ DELETE（会话终止）。会话空闲 30 分钟自动清理。
 *   适合单实例部署。
 *
 * - stateless：无状态。每次请求由 factory 新建 Server 实例，不返回 session id。
 *   容器重启 / 水平扩展 / 负载均衡均无需粘性会话，适合多副本 Docker 部署。
 *   业务缓存（URL/rerank/去重）为模块级单例，跨请求共享。
 */

interface SessionState {
  server: Server;
  researchServer: ResearchServer;
  transport: NodeStreamableHTTPServerTransport;
  lastActivity: number;
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

function applyCors(app: express.Application): void {
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    // 同时暴露新旧两种大小写的 session id 头，兼容不同客户端
    exposedHeaders: ['mcp-session-id', 'Mcp-Session-Id'],
    allowedHeaders: ['Content-Type', 'mcp-session-id', 'mcp-protocol-version', 'mcp-method', 'mcp-name'],
  }));
}

// ============ 有状态模式 ============

function createStatefulApp(): express.Application {
  const app = express();
  // 注意：有状态模式使用 NodeStreamableHTTPServerTransport（express 风格），
  // 需要 express.json() 预解析 body 供 isInitializeRequest 判断。
  app.use(express.json());

  applyCors(app);

  const sessions: Map<string, SessionState> = new Map();

  // 定时清理过期会话
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
        console.log(`[HTTP] Cleaning up expired session: ${id}`);
        try {
          session.transport.close?.();
        } catch {}
        sessions.delete(id);
      }
    }
  }, 5 * 60 * 1000);

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let session: SessionState;

    if (sessionId && sessions.has(sessionId)) {
      session = sessions.get(sessionId)!;
      session.lastActivity = Date.now();
      console.log(`[HTTP] Reusing session: ${sessionId}`);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      console.log("[HTTP] Creating new session");

      const { server: newServer, researchServer } = createMcpServer();

      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, {
            server: newServer,
            researchServer,
            transport,
            lastActivity: Date.now()
          });
          console.log(`[HTTP] Session initialized: ${newSessionId}`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          console.log(`[HTTP] Session closed: ${transport.sessionId}`);
          sessions.delete(transport.sessionId);
        }
      };

      transport.onerror = (error) => {
        console.error(`[HTTP] Transport error:`, error instanceof Error ? error.message : String(error));
      };

      try {
        await newServer.connect(transport);
        session = { server: newServer, researchServer, transport, lastActivity: Date.now() };
      } catch (error) {
        console.error(`[HTTP] Failed to connect server:`, error instanceof Error ? error.message : String(error));
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal error: Failed to initialize session',
          },
          id: null,
        });
        return;
      }
    } else if (sessionId && !sessions.has(sessionId)) {
      // MCP spec: expired/unknown session must return 404 so the client re-initializes
      console.warn(`[HTTP] POST request rejected - session not found:`, {
        clientIP: req.ip || req.connection.remoteAddress,
        sessionId,
      });
      res.status(404).json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Session not found: please re-initialize',
        },
        id: null,
      });
      return;
    } else {
      console.warn(`[HTTP] POST request rejected - invalid request:`, {
        clientIP: req.ip || req.connection.remoteAddress,
        sessionId: sessionId || 'undefined',
        hasInitializeRequest: isInitializeRequest(req.body),
      });
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (error instanceof Error && error.message.includes('accept')) {
        console.warn(`[HTTP] Connection rejected due to missing headers:`, {
          clientIP: req.ip || req.connection.remoteAddress,
          error: error.message
        });
      }
      throw error;
    }
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      console.warn(`[HTTP] GET request rejected - missing or invalid session ID:`, {
        clientIP: req.ip || req.connection.remoteAddress,
        sessionId: sessionId || 'undefined',
      });
      // MCP spec: unknown session → 404 (client should re-initialize); missing header → 400
      res.status(sessionId ? 404 : 400).send(sessionId ? 'Session not found: please re-initialize' : 'Invalid or missing session ID');
      return;
    }

    const session = sessions.get(sessionId)!;
    session.lastActivity = Date.now();
    try {
      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.warn(`[HTTP] GET request failed:`, {
        clientIP: req.ip || req.connection.remoteAddress,
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      console.warn(`[HTTP] DELETE request rejected - missing or invalid session ID:`, {
        clientIP: req.ip || req.connection.remoteAddress,
        sessionId: sessionId || 'undefined',
      });
      // MCP spec: unknown session → 404 (client should re-initialize); missing header → 400
      res.status(sessionId ? 404 : 400).send(sessionId ? 'Session not found: please re-initialize' : 'Invalid or missing session ID');
      return;
    }

    const session = sessions.get(sessionId)!;
    session.lastActivity = Date.now();
    try {
      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.warn(`[HTTP] DELETE request failed:`, {
        clientIP: req.ip || req.connection.remoteAddress,
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      server: 'agent-search',
      version: packageVersion,
      transport: 'http',
      mode: 'stateful',
      activeSessions: sessions.size
    });
  });

  // 关闭时清理定时器
  const originalListen = app.listen.bind(app);
  app.listen = (...args: any[]) => {
    const server = originalListen(...args);
    const originalClose = server.close.bind(server);
    server.close = (callback?: () => void) => {
      clearInterval(cleanupInterval);
      return originalClose(callback);
    };
    return server;
  };

  return app;
}

// ============ 无状态模式 ============

function createStatelessApp(): express.Application {
  const app = express();
  // 注意：不能全局挂 express.json()——toNodeHandler 需要读取原始请求流来解析 body，
  // 若被 express.json() 抢先消费，MCP 请求会因 body 为空报 Parse error。

  applyCors(app);

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

// ============ 入口 ============

/**
 * 会话模式在调用时实时读取（而非模块加载时快照），便于测试切换。
 * 环境变量取值：stateful（默认）/ stateless。
 */
function resolveSessionMode(): 'stateful' | 'stateless' {
  const mode = (process.env.MCP_SESSION_MODE || 'stateful').toLowerCase();
  return mode === 'stateless' ? 'stateless' : 'stateful';
}

export function createHttpServer(): express.Application {
  return resolveSessionMode() === 'stateful' ? createStatefulApp() : createStatelessApp();
}
