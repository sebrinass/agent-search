import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { createProxyAgent } from "./proxy.js";
import { logMessage } from "./logging.js";
import { urlContentCache, linkDedupPool } from "./cache.js";
import {
  createURLFormatError,
  createNetworkError,
  createServerError,
  createContentError,
  createConversionError,
  createTimeoutError,
  createEmptyContentWarning,
  createUnexpectedError,
  type ErrorContext
} from "./error-handler.js";

// ============ 环境变量配置 ============
const ENABLE_JS_RENDER = process.env.ENABLE_JS_RENDER !== 'false'; // 默认 true
const ENABLE_READABILITY = process.env.ENABLE_READABILITY !== 'false'; // 默认 true

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
  source: 'fetch' | 'happy-dom';
}

// ============ Happy DOM 懒加载 ============
let happyDomModule: typeof import('happy-dom') | null = null;
let readabilityModule: typeof import('@mozilla/readability') | null = null;

async function getHappyDom() {
  if (!happyDomModule) {
    try {
      happyDomModule = await import('happy-dom');
    } catch (e) {
      logMessage(null as any, 'warning', 'Happy DOM not installed. JS rendering disabled.');
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
      logMessage(null as any, 'warning', '@mozilla/readability not installed. Content extraction disabled.');
      return null;
    }
  }
  return readabilityModule;
}

// ============ 分页辅助函数 ============
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

  try {
    // 使用 JSDOM 解析 HTML（Readability 需要 DOM 文档）
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(htmlContent, { url });
    const reader = new readability.Readability(dom.window.document);
    const article = reader.parse();

    if (article && article.content) {
      return article.content;
    }
    return null;
  } catch (error: any) {
    logMessage(null as any, 'warning', `Readability extraction failed: ${error.message}`);
    return null;
  }
}

// ============ Happy DOM 渲染 ============
let happyDomErrorHandlerInstalled = false;

function installHappyDomErrorHandler() {
  if (happyDomErrorHandlerInstalled) return;
  happyDomErrorHandlerInstalled = true;

  process.on('uncaughtException', (error: Error) => {
    if (error.name === 'DOMException' || error.message?.includes('navigationStart')) {
      logMessage(null as any, 'warning', `Happy DOM caught exception: ${error.message}`);
      return;
    }
    throw error;
  });

  process.on('unhandledRejection', (reason: unknown) => {
    if (reason instanceof Error && (reason.name === 'DOMException' || reason.message?.includes('navigationStart'))) {
      logMessage(null as any, 'warning', `Happy DOM caught rejection: ${reason.message}`);
      return;
    }
    if (reason instanceof Error) {
      throw reason;
    }
  });
}

async function fetchWithHappyDom(
  url: string,
  timeoutMs: number
): Promise<FetchResult | null> {
  if (!ENABLE_JS_RENDER) {
    return null;
  }

  installHappyDomErrorHandler();

  const happyDom = await getHappyDom();
  if (!happyDom) {
    return null;
  }

  let browser: InstanceType<typeof happyDom.Browser> | null = null;

  try {
    const { Browser, BrowserErrorCaptureEnum } = happyDom;

    browser = new Browser({
      settings: {
        errorCapture: BrowserErrorCaptureEnum.processLevel,
        navigator: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        disableJavaScriptFileLoading: true,
        disableCSSFileLoading: true,
        disableIframePageLoading: true
      }
    });

    const page = browser.newPage();

    const timeoutPromise = new Promise<null>((_, reject) => {
      setTimeout(() => reject(new Error('Happy DOM timeout')), timeoutMs);
    });

    await Promise.race([
      page.goto(url),
      timeoutPromise
    ]);

    await page.waitUntilComplete();

    const document = page.mainFrame.document;
    const htmlContent = document.documentElement.outerHTML;

    await browser.close();
    browser = null;

    if (!htmlContent || htmlContent.trim().length === 0) {
      return null;
    }

    return {
      htmlContent,
      source: 'happy-dom'
    };
  } catch (error: any) {
    logMessage(null as any, 'warning', `Happy DOM render failed: ${error.message}`);
    return null;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

// ============ 核心 Fetch 逻辑 ============
async function fetchHtmlContent(
  server: Server,
  url: string,
  timeoutMs: number
): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Prepare request options with proxy support
    const requestOptions: RequestInit = {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };

    // Add proxy dispatcher if proxy is configured
    const proxyAgent = createProxyAgent(url);
    if (proxyAgent) {
      (requestOptions as any).dispatcher = proxyAgent;
    }

    let response: Response;
    try {
      response = await fetch(url, requestOptions);
    } catch (error: any) {
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
        responseBody = await response.text();
      } catch {
        responseBody = '[Could not read response body]';
      }

      const context: ErrorContext = { url };
      throw createServerError(response.status, response.statusText, responseBody, context);
    }

    // Retrieve HTML content
    let htmlContent: string;
    try {
      htmlContent = await response.text();
    } catch (error: any) {
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

  // 添加到去重池
  linkDedupPool.add(url);

  let fetchResult: FetchResult | null = null;
  let lastError: Error | null = null;

  // 第1层：fetch 获取原始 HTML
  try {
    fetchResult = await fetchHtmlContent(server, url, timeoutMs);
    logMessage(server, "info", `Layer 1 (fetch) succeeded for: ${url}`);
  } catch (error: any) {
    lastError = error;
    logMessage(server, "warning", `Layer 1 (fetch) failed for: ${url} - ${error.message}`);
  }

  // 第2层：Happy DOM 渲染（如果第1层失败或内容为空）
  if (!fetchResult || fetchResult.htmlContent.trim().length === 0) {
    logMessage(server, "info", `Trying Layer 2 (Happy DOM) for: ${url}`);
    try {
      fetchResult = await fetchWithHappyDom(url, timeoutMs);
      if (fetchResult) {
        logMessage(server, "info", `Layer 2 (Happy DOM) succeeded for: ${url}`);
      }
    } catch (error: any) {
      logMessage(server, "warning", `Layer 2 (Happy DOM) failed for: ${url} - ${error.message}`);
    }
  }

  // 如果两层都失败
  if (!fetchResult || !fetchResult.htmlContent || fetchResult.htmlContent.trim().length === 0) {
    logMessage(server, "error", `All layers failed for: ${url}`);
    // 返回提示信息
    return `无法获取页面内容。

可能的原因：
1. 页面需要完整浏览器渲染（如 SPA 应用）
2. 页面有反爬虫保护
3. 网络连接问题

建议：请使用浏览器 MCP 处理此页面。`;
  }

  // 提取正文内容（使用 Readability）
  let processedHtml = fetchResult.htmlContent;
  if (ENABLE_READABILITY && fetchResult.source === 'happy-dom') {
    const extractedContent = await extractWithReadability(fetchResult.htmlContent, url);
    if (extractedContent) {
      processedHtml = extractedContent;
      logMessage(server, "info", `Readability extracted content for: ${url}`);
    }
  }

  // Convert HTML to Markdown
  let markdownContent: string;
  try {
    markdownContent = NodeHtmlMarkdown.translate(processedHtml);
  } catch (error: any) {
    throw createConversionError(error, url, processedHtml);
  }

  if (!markdownContent || markdownContent.trim().length === 0) {
    logMessage(server, "warning", `Empty content after conversion: ${url}`);
    return createEmptyContentWarning(url, processedHtml.length, processedHtml);
  }

  // Cache successful result
  urlContentCache.set(url, fetchResult.htmlContent, markdownContent);

  // Apply pagination options
  const result = applyPaginationOptions(markdownContent, paginationOptions);

  const duration = Date.now() - startTime;
  const sourceLabel = fetchResult.source === 'happy-dom' ? 'Happy DOM' : 'fetch';
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
 * @param timeoutMs - 超时时间（毫秒），默认 10000
 * @param options - 分页选项
 */
export async function fetchAndConvertToMarkdown(
  server: Server,
  urlOrUrls: string | string[],
  timeoutMs: number = 10000,
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

// ============ 导出辅助函数 ============
/**
 * 解析 URL 输入为 URL 数组
 */
export function parseUrlInput(urlOrUrls: string | string[]): string[] {
  if (typeof urlOrUrls === 'string') {
    if (urlOrUrls.includes('|')) {
      return urlOrUrls.split('|').map(u => u.trim()).filter(u => u.length > 0);
    }
    return [urlOrUrls];
  }
  return urlOrUrls;
}

/**
 * 检查 URL 是否已缓存
 */
export function isUrlCached(url: string): boolean {
  return urlContentCache.has(url);
}

/**
 * 检查 URL 是否在去重池中
 */
export function isUrlDeduplicated(url: string): boolean {
  return linkDedupPool.isDuplicate(url);
}
