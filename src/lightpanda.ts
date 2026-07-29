import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { logMessage } from "./logging.js";
import {
  ENABLE_JS_RENDER,
  LIGHTPANDA_EXECUTABLE_PATH,
  HTTPS_PROXY,
  HTTP_PROXY,
} from "./config.js";

/**
 * Lightpanda 动态渲染层
 *
 * 作为 Read 工具第 2 层兜底：当第 1 层（curl-cffi / 原生 fetch）拿到的是
 * 需要 JS 渲染的空壳页面（SPA）时，用 Lightpanda 轻量无头浏览器执行 JS
 * 拿到渲染后的 HTML。
 *
 * 采用一次性 spawn 模式：每次读动态页临时启动 Lightpanda，读完即退，闲时零内存，
 * 最省 NAS 资源；崩溃只影响当次请求（天然隔离），无需健康检查/进程管理。
 *
 * 未配置可执行文件（或文件不存在）时自动跳过，与 curl-cffi 装不上就降级同风格。
 *
 * 注意：Lightpanda 的命令行参数以官方文档为准，需在实际运行环境用真实二进制校准。
 */

// 渲染输出的安全上限（10MB），防止异常巨量 stdout 撑爆内存；超出即视为失败降级。
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

// 可用性探测结果缓存（首次探测后复用，避免每次读页面都做一次 fs 检查）
let lightpandaAvailable: boolean | null = null;

/**
 * 探测 Lightpanda 是否可用：配置了可执行路径且该文件存在且可执行。
 * 结果缓存，仅首次真正检查。
 */
async function isLightpandaAvailable(): Promise<boolean> {
  if (lightpandaAvailable !== null) {
    return lightpandaAvailable;
  }

  if (!LIGHTPANDA_EXECUTABLE_PATH) {
    lightpandaAvailable = false;
    return false;
  }

  try {
    await access(LIGHTPANDA_EXECUTABLE_PATH, constants.X_OK);
    lightpandaAvailable = true;
    logMessage(null, "info", `Lightpanda available at ${LIGHTPANDA_EXECUTABLE_PATH}`);
  } catch {
    lightpandaAvailable = false;
    logMessage(
      null,
      "warning",
      `Lightpanda executable not found or not executable at "${LIGHTPANDA_EXECUTABLE_PATH}". Dynamic rendering disabled.`
    );
  }

  return lightpandaAvailable;
}

/**
 * 重置可用性缓存（仅供测试使用，便于在不同环境变量下重新探测）。
 */
export function resetLightpandaAvailabilityCache(): void {
  lightpandaAvailable = null;
}

export interface LightpandaResult {
  htmlContent: string;
}

/**
 * 组装 Lightpanda fetch 子命令的参数。
 *
 * 基础：fetch --dump html <url>  → 渲染后把 HTML 打到 stdout
 * --wait-until networkidle       → 等待 AJAX 等网络活动结束再取 HTML（SPA 必需）
 * --log-level err                → 只输出错误日志，避免污染 stdout
 * --block-private-networks       → SSRF 防护：拦截 DNS 解析到内网/重定向到内网
 *                                  （与 assertUrlAllowed 的策略对齐）
 * --http-proxy <url>             → 复用项目代理配置
 *
 * 参数名以 Lightpanda 0.3.6 的 help.zon 为准：多词参数用连字符（非下划线）。
 */
export function buildLightpandaArgs(url: string): string[] {
  const args = ["fetch", "--dump", "html", "--wait-until", "networkidle", "--log-level", "err"];

  if (process.env.MCP_HTTP_ALLOW_PRIVATE_URLS !== "true") {
    args.push("--block-private-networks");
  }

  const proxy = HTTPS_PROXY || HTTP_PROXY;
  if (proxy) {
    args.push("--http-proxy", proxy);
  }

  args.push(url);
  return args;
}

/**
 * 用 Lightpanda 渲染动态页面，返回渲染后的 HTML。
 *
 * 任何失败（未配置/未安装、超时、进程报错、退出码非 0、输出为空、输出超限）
 * 都返回 null，由上层走降级逻辑（返回"请用浏览器 MCP"提示，交给上层 agent）。
 *
 * @param url       目标 URL（调用前应已通过 assertUrlAllowed 的字面地址检查）
 * @param timeoutMs 硬超时；到点强制杀进程，视为失败
 */
export async function fetchWithLightpanda(url: string, timeoutMs: number): Promise<LightpandaResult | null> {
  if (!ENABLE_JS_RENDER) {
    return null;
  }

  if (!(await isLightpandaAvailable())) {
    return null;
  }

  return new Promise<LightpandaResult | null>((resolve) => {
    const args = buildLightpandaArgs(url);

    let child;
    try {
      child = spawn(LIGHTPANDA_EXECUTABLE_PATH, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error: any) {
      logMessage(null, "warning", `Lightpanda spawn failed for ${url}: ${error.message}`);
      resolve(null);
      return;
    }

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let settled = false;

    const finish = (result: LightpandaResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      logMessage(null, "warning", `Lightpanda timed out after ${timeoutMs}ms for: ${url}`);
      try {
        child.kill("SIGKILL");
      } catch {
        /* 进程可能已退出，忽略 */
      }
      finish(null);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        logMessage(null, "warning", `Lightpanda output exceeded ${MAX_OUTPUT_BYTES} bytes for ${url}, aborting`);
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        finish(null);
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: Error) => {
      logMessage(null, "warning", `Lightpanda process error for ${url}: ${error.message}`);
      finish(null);
    });

    child.on("close", (code: number | null) => {
      if (settled) return;

      if (code !== 0) {
        logMessage(
          null,
          "warning",
          `Lightpanda exited with code ${code} for ${url}: ${stderr.trim().slice(0, 200)}`
        );
        finish(null);
        return;
      }

      const htmlContent = Buffer.concat(stdoutChunks).toString("utf-8");
      if (!htmlContent || htmlContent.trim().length === 0) {
        logMessage(null, "warning", `Lightpanda returned empty content for ${url}`);
        finish(null);
        return;
      }

      finish({ htmlContent });
    });
  });
}
