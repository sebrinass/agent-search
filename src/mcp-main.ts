import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { validateEnvironment as validateEnv } from "./error-handler.js";
import { logMessage } from "./logging.js";
import { createHttpServer } from "./http-server.js";
import { ResearchServer } from "./research.js";
import { registerRequestHandlers } from "./tool-handlers.js";
import { packageVersion } from "./version.js";

export function createMcpServer(): { server: Server; researchServer: ResearchServer } {
  const server = new Server(
    {
      name: "agent-search",
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

export async function main() {
  const validationError = validateEnv();
  if (validationError) {
    console.error(`❌ ${validationError}`);
    process.exit(1);
  }

  const { server } = createMcpServer();

  const httpPort = process.env.MCP_HTTP_PORT;
  if (httpPort) {
    const port = parseInt(httpPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error(`Invalid HTTP port: ${httpPort}. Must be between 1-65535.`);
      process.exit(1);
    }

    console.log(`Starting HTTP transport on port ${port}`);
    const app = await createHttpServer();

    const httpServer = app.listen(port, () => {
      console.log(`HTTP server listening on port ${port}`);
      console.log(`Health check: http://localhost:${port}/health`);
      console.log(`MCP endpoint: http://localhost:${port}/mcp`);
    });

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
    if (process.stdin.isTTY) {
      console.error(`🔍 Augmented Search Server v${packageVersion} - Ready`);
      console.error("✅ Configuration valid");
      console.error(`🌐 SearXNG URL: ${process.env.SEARXNG_URL}`);
      console.error("📡 Waiting for MCP client connection via STDIO...\n");
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);

    logMessage(server, "info", `Augmented Search Server v${packageVersion} connected via STDIO`);
    logMessage(server, "info", `SearXNG URL: ${process.env.SEARXNG_URL || 'not configured'}`);
  }
}
