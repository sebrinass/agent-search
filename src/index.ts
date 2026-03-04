#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  SetLevelRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";
import { validateEnvironment as validateEnv } from "./error-handler.js";
import { logMessage, setLogLevel } from "./logging.js";
import { createHttpServer } from "./http-server.js";
import { createConfigResource, createHelpResource } from "./resources.js";
import { SEARCH_TOOL, ResearchServer } from "./research.js";
import { handleToolCall, getToolDefinitions } from "./tool-handlers.js";

const packageVersion = "1.1.2";

// Export the version for use in other modules
export { packageVersion };

// Global state for logging level
let currentLogLevel: LoggingLevel = "info";

// Server implementation
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

// Initialize research server
const researchServer = new ResearchServer();
researchServer.setServer(server);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logMessage(server, "debug", "Handling list_tools request");
  return {
    tools: [SEARCH_TOOL, ...getToolDefinitions()],
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(server, researchServer, name, args);
});

// Logging level handler
server.setRequestHandler(SetLevelRequestSchema, async (request) => {
  const { level } = request.params;
  logMessage(server, "info", `Setting log level to: ${level}`);
  currentLogLevel = level;
  setLogLevel(level);
  return {};
});

// List resources handler
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

// Read resource handler
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

// Main function
async function main() {
  // Environment validation
  const validationError = validateEnv();
  if (validationError) {
    console.error(`❌ ${validationError}`);
    process.exit(1);
  }

  // Check for HTTP transport mode
  const httpPort = process.env.MCP_HTTP_PORT;
  if (httpPort) {
    const port = parseInt(httpPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(`Invalid HTTP port: ${httpPort}. Must be between 1-65535.`);
      process.exit(1);
    }

    console.log(`Starting HTTP transport on port ${port}`);
    const app = await createHttpServer(server);
    
    const httpServer = app.listen(port, () => {
      console.log(`HTTP server listening on port ${port}`);
      console.log(`Health check: http://localhost:${port}/health`);
      console.log(`MCP endpoint: http://localhost:${port}/mcp`);
    });

    // Handle graceful shutdown
    const shutdown = (signal: string) => {
      console.log(`Received ${signal}. Shutting down HTTP server...`);
      httpServer.close(() => {
        console.log("HTTP server closed");
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } else {
    // Default STDIO transport
    // Show helpful message when running in terminal
    if (process.stdin.isTTY) {
      console.error(`🔍 Augmented Search Server v${packageVersion} - Ready`);
      console.error("✅ Configuration valid");
      console.error(`🌐 SearXNG URL: ${process.env.SEARXNG_URL}`);
      console.error("📡 Waiting for MCP client connection via STDIO...\n");
    }
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    // Log after connection is established
    logMessage(server, "info", `Augmented Search Server v${packageVersion} connected via STDIO`);
    logMessage(server, "info", `Log level: ${currentLogLevel}`);
    logMessage(server, "info", `Environment: ${process.env.NODE_ENV || 'development'}`);
    logMessage(server, "info", `SearXNG URL: ${process.env.SEARXNG_URL || 'not configured'}`);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server (CLI entrypoint)
main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
