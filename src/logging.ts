import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";

// Logging state — 启动时从 LOG_LEVEL 环境变量读取（兼容 CLI / stdio / HTTP 启动路径），
// 未设置或值不合法时回退为 info。
const VALID_LEVELS: LoggingLevel[] = ["debug", "info", "warning", "error"];
const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LoggingLevel | undefined;
let currentLogLevel: LoggingLevel = envLevel && VALID_LEVELS.includes(envLevel) ? envLevel : "info";

// Logging helper function
export function logMessage(server: Server | null, level: LoggingLevel, message: string, data?: unknown): void {
  if (!shouldLog(level)) {
    return;
  }

  const notificationData = data !== undefined
    ? (typeof data === 'object' && data !== null ? { message, ...data } : { message, data })
    : { message };

  if (!server) {
    // CLI 模式：只输出 warning 和 error（除非开启 verbose）
    if (level === 'warning' || level === 'error') {
      console.error(`[${level.toUpperCase()}] ${message}`);
    } else if (currentLogLevel === 'debug') {
      console.error(`[${level.toUpperCase()}] ${message}`);
    }
    return;
  }

  try {
    server.notification({
      method: "notifications/message",
      params: {
        level,
        data: notificationData
      }
    }).catch((error) => {
      if (error instanceof Error && error.message !== "Not connected") {
        console.error("Logging error:", error);
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message !== "Not connected") {
      console.error("Logging error:", error);
    }
  }
}

export function shouldLog(level: LoggingLevel): boolean {
  return VALID_LEVELS.indexOf(level) >= VALID_LEVELS.indexOf(currentLogLevel);
}

export function setLogLevel(level: LoggingLevel): void {
  currentLogLevel = level;
}

export function getCurrentLogLevel(): LoggingLevel {
  return currentLogLevel;
}
