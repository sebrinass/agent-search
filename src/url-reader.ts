import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { createProxyAgent } from "./proxy.js";
import { logMessage } from "./logging.js";
import { urlContentCache, linkDedupPool } from "./cache.js";
import {
  assertUrlAllowed,
  isUrlSecurityPolicyDnsError,
  createUrlSecurityPolicyDnsError,
} from "./url-security.js";
import {
  createURLFormatError,
  createURLSecurityPolicyError,
  createNetworkError,
  createServerError,
  createContentError,
  createConversionError,
  createEmptyContentWarning,
  type ErrorContext
} from "./error-handler.js";
import {
  FETCH_TIMEOUT_MS,
  ENABLE_READABILITY,
  LIGHTPANDA_MIN_CONTENT_LENGTH
} from "./config.js";
import { fetchWithLightpanda } from "./lightpanda.js";

// ============ 安全限制常量 ============
// URL 读取最大内容长度（默认 5MB），可通过 URL_READ_MAX_CONTENT_LENGTH_BYTES 环境变量覆盖
export const DEFAULT_MAX_CONTENT_LENGTH_BYTES = 5 * 1024 * 1024;
// HEAD 预检请求超时上限（3秒），避免 HEAD 卡死
const HEAD_TIMEOUT_CAP_MS = 3000;

// ============ curl-cffi 懒加载 ============
let curlCffiModule: typeof import('curl-cffi') | null = null;
let curlCffiAvailable: boolean | null = null;

async function getCurlCffi() {
  // 测试/调试开关：禁用 curl-cffi，强制回退到原生 fetch（便于 mock 拦截）
  if (process.env.DISABLE_CURL_CFFI === 'true') {
    return null;
  }
  if (curlCffiAvailable !== null) {
    return curlCffiAvailable ? curlCffiModule : null;
  }
  try {
    curlCffiModule = await import('curl-cffi');
    curlCffiAvailable = true;
    logMessage(null, 'info', 'curl-cffi loaded successfully, using browser TLS fingerprint for requests');
  } catch (e) {
    curlCffiAvailable = false;
    logMessage(null, 'info', 'curl-cffi not available, falling back to native fetch');
  }
  return curlCffiAvailable ? curlCffiModule : null;
}

// ============ 类型定义 ============
export interface PaginationOptions {
  startChar?: number;
  maxLength?: number;
  section?: string;
  paragraphRange?: string;
  readHeadings?: boolean;
}

interface FetchResult {
  htmlContent: string;
  source: 'fetch' | 'lightpanda';
}

// 所有抓取层都失败时返回的提示：告诉上层 agent 改用浏览器 MCP 处理此页面。
const BROWSER_FALLBACK_MESSAGE = `无法获取页面内容。

可能的原因：
1. 页面需要完整浏览器渲染（如 SPA 应用）
2. 页面有反爬虫保护
3. 网络连接问题

建议：请使用浏览器 MCP 处理此页面。`;

// ============ Happy DOM 懒加载 ============
let happyDomModule: typeof import('happy-dom') | null = null;
let readabilityModule: typeof import('@mozilla/readability') | null = null;

async function getHappyDom() {
  if (!happyDomModule) {
    try {
      happyDomModule = await import('happy-dom');
    } catch (e) {
      logMessage(null, 'warning', 'Happy DOM not installed. JS rendering disabled.');
      return null;
    }
  }
  return happyDomModule;
}

async function getReadability() {
  if (!readabilityModule) {
    try {
      readabilityModule = await import('@mozilla/readability');
    } catch (e) {
      logMessage(null, 'warning', '@mozilla/readability not installed. Content extraction disabled.');
      return null;
    }
  }
  return readabilityModule;
}

let happyDomErrorHandlerInstalled = false;
let isProcessingException = false;

function installHappyDomErrorHandler() {
  if (happyDomErrorHandlerInstalled) return;
  happyDomErrorHandlerInstalled = true;

  process.on('uncaughtException', (error: Error) => {
    if (isProcessingException) return;

    if (error.name === 'DOMException' || error.message?.includes('navigationStart')) {
      logMessage(null, 'warning', `Happy DOM caught exception: ${error.message}`);
      return;
    }

    isProcessingException = true;
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    if (reason instanceof Error && (reason.name === 'DOMException' || reason.message?.includes('navigationStart'))) {
      logMessage(null, 'warning', `Happy DOM caught rejection: ${reason.message}`);
      return;
    }
    console.error('Unhandled Rejection:', reason);
  });
}

// ============ 5MB 内容上限相关辅助函数 ============
type BoundedBodyReadResult =
  | { exceeded: false; text: string; bytesRead: number }
  | { exceeded: true; bytesRead: number };

/**
 * 读取环境变量 URL_READ_MAX_CONTENT_LENGTH_BYTES，超过 0 的整数即生效。
 * 默认 5MB。非法值会记录 warning 并使用默认。
 */
function getMaxContentLengthBytes(server: Server | null): number {
  const rawValue = process.env.URL_READ_MAX_CONTENT_LENGTH_BYTES;
  if (rawValue === undefined || rawValue.trim() === "") {
    return DEFAULT_MAX_CONTENT_LENGTH_BYTES;
  }

  const parsed = parseInt(rawValue, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    logMessage(
      server,
      "warning",
      `Ignoring invalid URL_READ_MAX_CONTENT_LENGTH_BYTES="${rawValue}". Expected a positive integer; using default ${DEFAULT_MAX_CONTENT_LENGTH_BYTES}.`,
    );
    return DEFAULT_MAX_CONTENT_LENGTH_BYTES;
  }

  return parsed;
}

function createContentTooLargeMessage(contentLength: number, maxBytes: number): string {
  const sizeMB = (contentLength / (1024 * 1024)).toFixed(1);
  const limitMB = (maxBytes / (1024 * 1024)).toFixed(1);
  return (
    `Content too large: server reports ${sizeMB} MB (limit: ${limitMB} MB). ` +
    `Try using readHeadings or section to fetch only the relevant parts.`
  );
}

/**
 * 用流式读取器逐块读取 response body，超出 maxBytes 立即取消。
 * 这样可防止 chunked 编码或缺失 Content-Length 时把整个 body 读进内存（DoS 防护）。
 */
async function readResponseBodyWithLimit(response: Response, maxBytes: number): Promise<BoundedBodyReadResult> {
  if (response.body === null) {
    return { exceeded: false, text: "", bytesRead: 0 };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        return { exceeded: true, bytesRead };
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const bodyBytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { exceeded: false, text: new TextDecoder("utf-8").decode(bodyBytes), bytesRead };
}

/**
 * HEAD 预检：先发一次 HEAD 请求获取 Content-Length，超出限制就提前返回错误。
 * HEAD 失败（如某些服务器不允许）不视为错误，继续走 GET。
 */
async function checkContentLength(
  server: Server | null,
  url: string,
  timeoutMs: number,
  requestOptions: RequestInit
): Promise<number | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.min(timeoutMs, HEAD_TIMEOUT_CAP_MS));

  try {
    const headOptions: RequestInit = {
      ...requestOptions,
      method: "HEAD",
      signal: controller.signal,
      redirect: "manual",
    };

    const response = await fetch(url, headOptions);
    const contentLength = response.headers.get("content-length");
    if (!contentLength) {
      return null;
    }

    const parsed = parseInt(contentLength, 10);
    return Number.isNaN(parsed) || parsed < 0 ? null : parsed;
  } catch (error: any) {
    if (isUrlSecurityPolicyDnsError(error)) {
      throw createURLSecurityPolicyError(url);
    }

    logMessage(server, "warning", `HEAD check failed (proceeding with GET): ${error.message}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============ 字符分页 / 章节提取辅助函数 ============
function applyCharacterPagination(content: string, startChar: number = 0, maxLength?: number): string {
  if (startChar >= content.length) {
    return "";
  }

  const start = Math.max(0, startChar);
  const end = maxLength ? Math.min(content.length, start + maxLength) : content.length;

  return content.slice(start, end);
}

function extractSection(markdownContent: string, sectionHeading: string): string {
  const lines = markdownContent.split('\n');
  const sectionRegex = new RegExp(`^#{1,6}\s*.*${sectionHeading}.*$`, 'i');

  let startIndex = -1;
  let currentLevel = 0;

  // Find the section start
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (sectionRegex.test(line)) {
      startIndex = i;
      currentLevel = (line.match(/^#+/) || [''])[0].length;
      break;
    }
  }

  if (startIndex === -1) {
    return "";
  }

  // Find the section end (next heading of same or higher level)
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^#+/);
    if (match && match[0].length <= currentLevel) {
      endIndex = i;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join('\n');
}

function extractParagraphRange(markdownContent: string, range: string): string {
  const paragraphs = markdownContent.split('\n\n').filter(p => p.trim().length > 0);

  // Parse range (e.g., "1-5", "3", "10-")
  const rangeMatch = range.match(/^(\d+)(?:-(\d*))?$/);
  if (!rangeMatch) {
    return "";
  }

  const start = parseInt(rangeMatch[1]) - 1; // Convert to 0-based index
  const endStr = rangeMatch[2];

  if (start < 0 || start >= paragraphs.length) {
    return "";
  }

  if (endStr === undefined) {
    // Single paragraph (e.g., "3")
    return paragraphs[start] || "";
  } else if (endStr === "") {
    // Range to end (e.g., "10-")
    return paragraphs.slice(start).join('\n\n');
  } else {
    // Specific range (e.g., "1-5")
    const end = parseInt(endStr);
    return paragraphs.slice(start, end).join('\n\n');
  }
}

function extractHeadings(markdownContent: string): string {
  const lines = markdownContent.split('\n');
  const headings = lines.filter(line => /^#{1,6}\s/.test(line));

  if (headings.length === 0) {
    return "No headings found in the content.";
  }

  return headings.join('\n');
}

function applyPaginationOptions(markdownContent: string, options: PaginationOptions): string {
  let result = markdownContent;

  // Apply heading extraction first if requested
  if (options.readHeadings) {
    return extractHeadings(result);
  }

  // Apply section extraction
  if (options.section) {
    result = extractSection(result, options.section);
    if (result === "") {
      return `Section "${options.section}" not found in the content.`;
    }
  }

  // Apply paragraph range filtering
  if (options.paragraphRange) {
    result = extractParagraphRange(result, options.paragraphRange);
    if (result === "") {
      return `Paragraph range "${options.paragraphRange}" is invalid or out of bounds.`;
    }
  }

  // Apply character-based pagination last
  if (options.startChar !== undefined || options.maxLength !== undefined) {
    result = applyCharacterPagination(result, options.startChar, options.maxLength);
  }

  return result;
}

// ============ Readability 提取 ============
async function extractWithReadability(htmlContent: string, url: string): Promise<string | null> {
  if (!ENABLE_READABILITY) {
    return null;
  }

  const readability = await getReadability();
  if (!readability) {
    return null;
  }

  const happyDom = await getHappyDom();
  if (!happyDom) {
    return null;
  }

  // 安装 happy-dom 异常兜底（其 DOM 解析可能抛出异步 DOMException/navigationStart）
  installHappyDomErrorHandler();

  try {
    const { Window } = happyDom;
    const win = new Window({
      url,
      settings: {
        disableJavaScriptEvaluation: true,
        disableJavaScriptFileLoading: true,
        disableCSSFileLoading: true,
        disableIframePageLoading: true,
      }
    });
    const doc = win.document;
    doc.write(htmlContent);
    const reader = new readability.Readability(doc as any);
    const article = reader.parse();
    win.close();

    if (article && article.content) {
      return article.content;
    }
    return null;
  } catch (error: any) {
    logMessage(null, 'warning', `Readability extraction failed: ${error.message}`);
    return null;
  }
}

// ============ 核心 Fetch 逻辑 ============
async function fetchHtmlContent(
  server: Server,
  url: string,
  timeoutMs: number
): Promise<FetchResult> {
  const maxContentLengthBytes = getMaxContentLengthBytes(server);

  // 准备基础请求选项（curl-cffi 和原生 fetch 共用）
  const baseHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  // HEAD 预检：检查 Content-Length 是否超过上限
  // 注意：HEAD 失败不视为错误（部分服务器不允许 HEAD），继续走 GET
  try {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    const headRequestOptions: RequestInit = { headers: baseHeaders };
    if (proxyUrl) {
      // HEAD 也走代理，保证一致性
      try {
        const proxyAgent = createProxyAgent(url);
        if (proxyAgent) {
          (headRequestOptions as any).dispatcher = proxyAgent;
        }
      } catch {
        // 代理配置错误不影响 HEAD
      }
    }
    const contentLength = await checkContentLength(server, url, timeoutMs, headRequestOptions);
    if (contentLength !== null && contentLength > maxContentLengthBytes) {
      throw new Error(createContentTooLargeMessage(contentLength, maxContentLengthBytes));
    }
  } catch (error: any) {
    // 抛出的可能是"内容过大"的友好消息，也可能是 SSRF 错误
    if (error.message && error.message.startsWith("Content too large:")) {
      throw error;
    }
    if (error.name === 'MCPSearXNGError') {
      throw error;
    }
    // 其他 HEAD 错误已在 checkContentLength 内记录 warning，继续走 GET
  }

  // 尝试使用 curl-cffi
  const curlCffi = await getCurlCffi();

  if (curlCffi) {
    try {
      const requestOptions: Record<string, unknown> = {
        impersonate: "chrome136",
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      };

      // Add proxy if configured
      const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
      if (proxyUrl) {
        requestOptions.proxy = proxyUrl;
      }

      const response = await curlCffi.fetch(url, requestOptions);

      if (response.status !== 200) {
        let responseBody: string;
        try {
          responseBody = response.text || '[Could not read response body]';
        } catch {
          responseBody = '[Could not read response body]';
        }

        const context: ErrorContext = { url };
        throw createServerError(response.status, '', responseBody, context);
      }

      // curl-cffi 二次检查 Content-Length（HEAD 被跳过或漏报的情况）
      const contentLengthHeader = (response.headers as any)?.['content-length'];
      if (contentLengthHeader) {
        const reportedLength = parseInt(String(contentLengthHeader), 10);
        if (!Number.isNaN(reportedLength) && reportedLength > maxContentLengthBytes) {
          throw new Error(createContentTooLargeMessage(reportedLength, maxContentLengthBytes));
        }
      }

      const htmlContent = response.text;

      if (!htmlContent || htmlContent.trim().length === 0) {
        throw createContentError("Website returned empty content.", url);
      }

      // 二次检查：实际 body 字节数（防止 chunked 编码或 Content-Length 缺失/伪造）
      const actualBytes = Buffer.byteLength(htmlContent, 'utf8');
      if (actualBytes > maxContentLengthBytes) {
        throw new Error(createContentTooLargeMessage(actualBytes, maxContentLengthBytes));
      }

      return {
        htmlContent,
        source: 'fetch'
      };
    } catch (error: any) {
      if (error.message && error.message.startsWith("Content too large:")) {
        throw error;
      }
      if (error.name === 'MCPSearXNGError') {
        throw error;
      }
      // curl-cffi 失败，降级到原生 fetch
      logMessage(server, 'warning', `curl-cffi failed for: ${url} - ${error.message}, falling back to native fetch`);
    }
  }

  // 降级：使用原生 fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Prepare request options with proxy support
    const requestOptions: RequestInit = {
      signal: controller.signal,
      headers: baseHeaders
    };

    // Add proxy dispatcher if proxy is configured
    const proxyAgent = createProxyAgent(url);
    if (proxyAgent) {
      requestOptions.dispatcher = proxyAgent;
    }

    let response: Response;
    try {
      response = await fetch(url, requestOptions);
    } catch (error: any) {
      if (isUrlSecurityPolicyDnsError(error)) {
        throw createURLSecurityPolicyError(url);
      }
      const context: ErrorContext = {
        url,
        proxyAgent: !!proxyAgent,
        timeout: timeoutMs
      };
      throw createNetworkError(error, context);
    }

    if (!response.ok) {
      let responseBody: string;
      try {
        const bodyRead = await readResponseBodyWithLimit(response, maxContentLengthBytes);
        responseBody = bodyRead.exceeded
          ? createContentTooLargeMessage(bodyRead.bytesRead, maxContentLengthBytes)
          : bodyRead.text;
      } catch {
        responseBody = '[Could not read response body]';
      }

      const context: ErrorContext = { url };
      throw createServerError(response.status, response.statusText, responseBody, context);
    }

    // Retrieve HTML content (with bounded stream to prevent OOM)
    let htmlContent: string;
    try {
      const bodyRead = await readResponseBodyWithLimit(response, maxContentLengthBytes);
      if (bodyRead.exceeded) {
        throw new Error(createContentTooLargeMessage(bodyRead.bytesRead, maxContentLengthBytes));
      }
      htmlContent = bodyRead.text;
    } catch (error: any) {
      if (error.message && error.message.startsWith("Content too large:")) {
        throw error;
      }
      throw createContentError(
        `Failed to read website content: ${error.message || 'Unknown error reading content'}`,
        url
      );
    }

    if (!htmlContent || htmlContent.trim().length === 0) {
      throw createContentError("Website returned empty content.", url);
    }

    return {
      htmlContent,
      source: 'fetch'
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============ 单个 URL 读取 ============
async function fetchSingleUrl(
  server: Server,
  url: string,
  timeoutMs: number,
  paginationOptions: PaginationOptions
): Promise<string> {
  const startTime = Date.now();
  logMessage(server, "info", `Fetching URL: ${url}`);

  // Check cache first
  const cachedEntry = urlContentCache.get(url);
  if (cachedEntry) {
    logMessage(server, "info", `Using cached content for URL: ${url}`);
    const result = applyPaginationOptions(cachedEntry.markdownContent, paginationOptions);
    const duration = Date.now() - startTime;
    logMessage(server, "info", `Processed cached URL: ${url} (${result.length} chars in ${duration}ms)`);
    return result;
  }

  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    logMessage(server, "error", `Invalid URL format: ${url}`);
    throw createURLFormatError(url);
  }

  // SSRF 防护：拒绝内网/loopback/link-local 地址
  // 可通过 MCP_HTTP_ALLOW_PRIVATE_URLS=true 临时放行（仅限本地开发）
  assertUrlAllowed(parsedUrl);

  // 添加到去重池
  linkDedupPool.add(url);

  let fetchResult: FetchResult | null = null;
  let lastError: Error | null = null;

  // 提取正文并转 Markdown（Readability + node-html-markdown）。
  // 抽成局部函数：第1层结果需要先算出正文长度用于 SPA 空壳判断，第2层结果复用同一逻辑。
  const convertToMarkdown = async (
    htmlContent: string
  ): Promise<{ processedHtml: string; markdownContent: string }> => {
    let processedHtml = htmlContent;
    if (ENABLE_READABILITY) {
      const extractedContent = await extractWithReadability(htmlContent, url);
      if (extractedContent) {
        processedHtml = extractedContent;
        logMessage(server, "info", `Readability extracted content for: ${url}`);
      }
    }
    let markdownContent: string;
    try {
      markdownContent = NodeHtmlMarkdown.translate(processedHtml);
    } catch (error: any) {
      throw createConversionError(error, url, processedHtml);
    }
    return { processedHtml, markdownContent };
  };

  // 第1层：fetch 获取原始 HTML
  // 诊断开关：FORCE_LIGHTPANDA=true 时跳过第1层直接走 Lightpanda，验证浏览器竞底能力。
  // 默认 false，不影响正式使用。
  const forceLightpanda = process.env.FORCE_LIGHTPANDA === 'true';
  if (forceLightpanda) {
    logMessage(server, "info", `FORCE_LIGHTPANDA=true, skipping Layer 1 for: ${url}`);
  } else {
    try {
      fetchResult = await fetchHtmlContent(server, url, timeoutMs);
      logMessage(server, "info", `Layer 1 (fetch) succeeded for: ${url}`);
    } catch (error: any) {
      lastError = error;
      logMessage(server, "warning", `Layer 1 (fetch) failed for: ${url} - ${error.message}`);
    }
  }

  // 第1层结果先转 Markdown，用正文长度判断是否为 SPA 空壳
  let converted: { processedHtml: string; markdownContent: string } | null = null;
  let conversionError: Error | null = null;
  if (fetchResult && fetchResult.htmlContent.trim().length > 0) {
    try {
      converted = await convertToMarkdown(fetchResult.htmlContent);
    } catch (error: any) {
      conversionError = error;
      logMessage(server, "warning", `Layer 1 conversion failed for: ${url} - ${error.message}`);
    }
  }

  // 第2层：Lightpanda 动态渲染。触发条件：
  // a) 第1层失败/内容为空/转换失败；
  // b) 第1层正文过短（SPA 空壳：原始 HTML 只有导航骨架，正文靠 JS 渲染）。
  const layer1TooShort =
    converted !== null && converted.markdownContent.trim().length < LIGHTPANDA_MIN_CONTENT_LENGTH;
  if (!converted || layer1TooShort) {
    const reason = layer1TooShort
      ? "layer 1 content too short, possible SPA shell"
      : "layer 1 failed or empty";
    logMessage(server, "info", `Trying Layer 2 (Lightpanda) for: ${url} (${reason})`);
    try {
      const rendered = await fetchWithLightpanda(url, timeoutMs);
      if (rendered) {
        const renderedConverted = await convertToMarkdown(rendered.htmlContent);
        // 第1层完全失败时直接采用渲染结果（后续空壳检测兜底）；
        // 第1层有短内容时，仅当渲染正文达到空壳阈值且更充实才替换，避免用更差的结果覆盖。
        const renderedLength = renderedConverted.markdownContent.trim().length;
        const shouldAdopt = !converted
          ? true
          : renderedLength >= LIGHTPANDA_MIN_CONTENT_LENGTH &&
            renderedLength > converted.markdownContent.trim().length;
        if (shouldAdopt) {
          fetchResult = { htmlContent: rendered.htmlContent, source: 'lightpanda' };
          converted = renderedConverted;
          logMessage(server, "info", `Layer 2 (Lightpanda) succeeded for: ${url}`);
        } else {
          logMessage(server, "info", `Layer 2 (Lightpanda) content not better for: ${url}, keeping layer 1 result`);
        }
      }
    } catch (error: any) {
      logMessage(server, "warning", `Layer 2 (Lightpanda) failed for: ${url} - ${error.message}`);
    }
  }

  // 如果两层都失败
  if (!fetchResult || !converted) {
    // 第1层拿到了 HTML 但转换失败、且第2层也没救回来：保持原有的转换错误语义
    if (conversionError) {
      throw conversionError;
    }
    logMessage(server, "error", `All layers failed for: ${url}`);
    return BROWSER_FALLBACK_MESSAGE;
  }

  const { processedHtml, markdownContent } = converted;

  if (!markdownContent || markdownContent.trim().length === 0) {
    logMessage(server, "warning", `Empty content after conversion: ${url}`);
    return createEmptyContentWarning(url, processedHtml.length, processedHtml);
  }

  // 空壳检测：Lightpanda 渲染成功但正文过短，多为渲染不全/被反爬拦截，
  // 视为失败，降级交给上层 agent（且不缓存空壳）。
  if (fetchResult.source === 'lightpanda' && markdownContent.trim().length < LIGHTPANDA_MIN_CONTENT_LENGTH) {
    logMessage(server, "warning", `Lightpanda content too short (${markdownContent.trim().length} chars) for: ${url}, treating as empty shell`);
    return BROWSER_FALLBACK_MESSAGE;
  }

  // Cache successful result
  urlContentCache.set(url, fetchResult.htmlContent, markdownContent);

  // Apply pagination options
  const result = applyPaginationOptions(markdownContent, paginationOptions);

  const duration = Date.now() - startTime;
  const sourceLabel = fetchResult.source === 'lightpanda' ? 'Lightpanda' : 'fetch';
  logMessage(server, "info", `Successfully fetched URL via ${sourceLabel}: ${url} (${result.length} chars in ${duration}ms)`);

  return result;
}

// ============ 批量 URL 读取 ============
async function fetchMultipleUrls(
  server: Server,
  urls: string[],
  timeoutMs: number,
  paginationOptions: PaginationOptions
): Promise<string> {
  const startTime = Date.now();
  logMessage(server, "info", `Starting batch URL fetch: ${urls.length} URLs`);

  if (urls.length === 0) {
    return "No URLs provided for batch reading.";
  }

  // 去重
  const uniqueUrls = [...new Set(urls)];
  if (uniqueUrls.length < urls.length) {
    logMessage(server, "info", `Removed ${urls.length - uniqueUrls.length} duplicate URLs`);
  }

  // 并发读取
  const results: Array<{ url: string; content: string; error?: string }> = [];

  const fetchPromises = uniqueUrls.map(async (url) => {
    try {
      const content = await fetchSingleUrl(server, url, timeoutMs, paginationOptions);
      results.push({ url, content });
    } catch (error: any) {
      const errorMessage = error?.message as string | undefined;
      results.push({
        url,
        content: "",
        error: errorMessage ?? "Unknown error"
      });
    }
  });

  await Promise.all(fetchPromises);

  const duration = Date.now() - startTime;
  const successCount = results.filter(r => !r.error).length;
  const errorCount = results.filter(r => r.error).length;

  logMessage(server, "info", `Batch URL fetch completed: ${successCount}/${uniqueUrls.length} successful in ${duration}ms`);

  // 格式化输出
  let output = `=== 批量读取结果 (${uniqueUrls.length} 个URL, ${successCount} 成功, ${errorCount} 失败) ===\n\n`;

  for (const result of results) {
    if (result.error) {
      output += `[URL: ${result.url}]\n错误: ${result.error}\n\n---\n\n`;
    } else {
      output += `[URL: ${result.url}]\n${result.content}\n\n---\n\n`;
    }
  }

  return output;
}

// ============ 主函数：统一接口 ============
/**
 * 读取单个或多个 URL 内容
 * 
 * @param server - MCP Server 实例
 * @param urlOrUrls - URL 字符串或 URL 数组
 *   - "https://a.com" → 读取单个
 *   - "https://a.com | https://b.com" → 读取多个（用 | 分隔）
 *   - ["https://a.com", "https://b.com"] → 数组形式
 * @param timeoutMs - 超时时间（毫秒），默认使用 FETCH_TIMEOUT_MS 环境变量（30000）
 * @param options - 分页选项
 */
export async function fetchAndConvertToMarkdown(
  server: Server,
  urlOrUrls: string | string[],
  timeoutMs: number = FETCH_TIMEOUT_MS,
  options: PaginationOptions = {}
): Promise<string> {
  // 解析输入
  let urls: string[];

  if (typeof urlOrUrls === 'string') {
    // 检查是否为多 URL 格式（用 | 分隔）
    if (urlOrUrls.includes('|')) {
      urls = urlOrUrls.split('|').map(u => u.trim()).filter(u => u.length > 0);
    } else {
      urls = [urlOrUrls];
    }
  } else {
    urls = urlOrUrls;
  }

  // 单个 URL
  if (urls.length === 1) {
    return fetchSingleUrl(server, urls[0], timeoutMs, options);
  }

  // 多个 URL
  return fetchMultipleUrls(server, urls, timeoutMs, options);
}


