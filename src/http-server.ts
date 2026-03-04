import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  SetLevelRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";
import { logMessage, setLogLevel } from "./logging.js";
import { packageVersion } from "./index.js";
import { createApiRouter } from "./api-routes.js";
import { ResearchServer, SEARCH_TOOL } from "./research.js";
import { createConfigResource, createHelpResource } from "./resources.js";
import { ALLOWED_ORIGINS } from "./config.js";
import { handleToolCall, getToolDefinitions } from "./tool-handlers.js";

export interface HttpServerOptions {
  researchServer?: ResearchServer;
}

type ServerFactory = () => { server: Server; researchServer: ResearchServer };

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

  let currentLogLevel: LoggingLevel = "info";

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logMessage(server, "debug", "Handling list_tools request");
    return {
      tools: [SEARCH_TOOL, ...getToolDefinitions()],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(server, researchServer, name, args);
  });

  server.setRequestHandler(SetLevelRequestSchema, async (request) => {
    const { level } = request.params;
    logMessage(server, "info", `Setting log level to: ${level}`);
    currentLogLevel = level;
    setLogLevel(level);
    return {};
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    logMessage(server, "debug", "Handling list_resources request");
    return {
      resources: [
        {
          uri: "config://server-config",
          mimeType: "application/json",
          name: "Server Configuration",
          description: "Current server configuration and environment variables"
        },
        {
          uri: "help://usage-guide",
          mimeType: "text/markdown",
          name: "Usage Guide",
          description: "How to use the Augmented Search server effectively"
        }
      ]
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    logMessage(server, "debug", `Handling read_resource request for: ${uri}`);

    switch (uri) {
      case "config://server-config":
        return {
          contents: [
            {
              uri: uri,
              mimeType: "application/json",
              text: createConfigResource()
            }
          ]
        };

      case "help://usage-guide":
        return {
          contents: [
            {
              uri: uri,
              mimeType: "text/markdown",
              text: createHelpResource()
            }
          ]
        };

      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  });

  return { server, researchServer };
}

interface SessionState {
  server: Server;
  researchServer: ResearchServer;
  transport: StreamableHTTPServerTransport;
}

export async function createHttpServer(_server: Server, options?: HttpServerOptions): Promise<express.Application> {
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

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let session: SessionState;

    if (sessionId && sessions.has(sessionId)) {
      session = sessions.get(sessionId)!;
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
            transport
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
        session = { server: newServer, researchServer, transport };
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
      server: 'augmented-search',
      version: packageVersion,
      transport: 'http',
      activeSessions: sessions.size
    });
  });

  const apiRouter = createApiRouter();
  app.use('/api', apiRouter);

  if (options?.researchServer) {
    console.warn("[HTTP] Warning: researchServer option is deprecated in HTTP mode. Each session creates its own ResearchServer.");
  }

  return app;
}
