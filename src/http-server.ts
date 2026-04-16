import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { packageVersion } from "./version.js";
import { ResearchServer } from "./research.js";
import { registerRequestHandlers } from "./tool-handlers.js";
import { ALLOWED_ORIGINS } from "./config.js";

function createServerInstance(): { server: Server; researchServer: ResearchServer } {
  const server = new Server(
    {
      name: "augmented-search",
      version: packageVersion,
    },
    {
      capabilities: {
        logging: {},
        resources: {},
        tools: {},
      },
    }
  );

  const researchServer = new ResearchServer();
  researchServer.setServer(server);

  registerRequestHandlers(server, researchServer);

  return { server, researchServer };
}

interface SessionState {
  server: Server;
  researchServer: ResearchServer;
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export async function createHttpServer(): Promise<express.Application> {
  const app = express();
  app.use(express.json());
  
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    exposedHeaders: ['Mcp-Session-Id'],
    allowedHeaders: ['Content-Type', 'mcp-session-id'],
  }));

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
      
      const { server: newServer, researchServer } = createServerInstance();
      
      const transport = new StreamableHTTPServerTransport({
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
      res.status(400).send('Invalid or missing session ID');
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
      res.status(400).send('Invalid or missing session ID');
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
