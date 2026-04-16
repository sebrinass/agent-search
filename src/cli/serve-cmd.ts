import { Command } from "commander";
import { main as mcpMain } from "../mcp-main.js";

export function registerServeCommand(program: Command) {
  program
    .command("serve")
    .description("启动 MCP Server（默认 stdio 传输）")
    .option("--transport <type>", "传输模式: stdio, http", "stdio")
    .option("--port <number>", "HTTP 模式端口 (需 --transport http)")
    .action(async (opts) => {
      if (opts.transport === "http" && opts.port) {
        process.env.MCP_HTTP_PORT = opts.port;
      } else if (opts.transport === "http" && !opts.port) {
        console.error("❌ HTTP 模式需要指定 --port");
        console.error("例如: agent-search serve --transport http --port 3000");
        process.exit(1);
      }

      await mcpMain();
    });
}
