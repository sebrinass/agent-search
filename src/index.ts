#!/usr/bin/env node

export { packageVersion } from "./version.js";

import { main } from "./mcp-main.js";

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
