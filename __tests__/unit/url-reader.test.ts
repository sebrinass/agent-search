#!/usr/bin/env tsx

/**
 * Unit Tests: url-reader.ts
 * 
 * Tests for URL fetching and markdown conversion
 */

import { strict as assert } from 'node:assert';
import { fetchAndConvertToMarkdown, isUrlReadFailure } from '../../src/url-reader.js';
import { urlContentCache } from '../../src/cache.js';
import { testFunction, createTestResults, printTestSummary } from '../helpers/test-utils.js';
import { createMockServer } from '../helpers/mock-server.js';
import { FetchMocker, createMockFetch, createAbortableMockFetch } from '../helpers/mock-fetch.js';
import { EnvManager } from '../helpers/env-utils.js';

const results = createTestResults();
const fetchMocker = new FetchMocker();
const envManager = new EnvManager();

// 禁用 curl-cffi，强制走原生 fetch，保证 FetchMocker 能拦截请求
process.env.DISABLE_CURL_CFFI = 'true';

async function runTests() {
  console.log('🧪 Testing: url-reader.ts\n');

  await testFunction('Error handling for invalid URL', async () => {
    const mockServer = createMockServer();
    
    try {
      await fetchAndConvertToMarkdown(mockServer as any, 'not-a-valid-url');
      assert.fail('Should have thrown URL format error');
    } catch (error: any) {
      assert.ok(error.message.includes('URL Format Error') || error.message.includes('Invalid URL'));
    }
  }, results);

  await testFunction('Various invalid URL formats', async () => {
    const mockServer = createMockServer();
    const invalidUrls = ['', 'not-a-url'];

    for (const invalidUrl of invalidUrls) {
      try {
        await fetchAndConvertToMarkdown(mockServer as any, invalidUrl);
        assert.fail(`Should have thrown error for invalid URL: ${invalidUrl}`);
      } catch (error: any) {
        assert.ok(
          error.message.includes('URL Format Error') ||
          error.message.includes('Invalid URL') ||
          error.name === 'MCPSearXNGError',
          `Expected URL format error, got: ${error.message}`
        );
      }
    }

    // 'invalid://protocol' passes URL parsing but fails on fetch,
    // fetchSingleUrl catches the error and returns a fallback string instead of throwing
    const result = await fetchAndConvertToMarkdown(mockServer as any, 'invalid://protocol');
    assert.ok(typeof result === 'string', 'Should return a string for unreachable protocol');
  }, results);

  await testFunction('Network error handling', async () => {
    const mockServer = createMockServer();
    const networkErrors = [
      { code: 'ECONNREFUSED', message: 'Connection refused' },
      { code: 'ETIMEDOUT', message: 'Request timeout' },
      { code: 'ENOTFOUND', message: 'DNS resolution failed' },
      { code: 'ECONNRESET', message: 'Connection reset' }
    ];

    for (const networkError of networkErrors) {
      const error = new Error(networkError.message);
      (error as any).code = networkError.code;
      
      fetchMocker.mock(createMockFetch({ throwError: error }));

      // fetchSingleUrl catches fetch errors and tries Happy DOM fallback,
      // if both fail it returns a fallback string instead of throwing
      const result = await fetchAndConvertToMarkdown(mockServer as any, 'https://example.com');
      assert.ok(typeof result === 'string', `Should return a string for ${networkError.code}`);

      fetchMocker.restore();
    }
  }, results);

  await testFunction('HTTP error status codes', async () => {
    const mockServer = createMockServer();
    const statusCodes = [404, 403, 500, 502, 503, 429];

    for (const statusCode of statusCodes) {
      fetchMocker.mock(createMockFetch({
        ok: false,
        status: statusCode,
        statusText: `HTTP ${statusCode}`,
        body: `Error ${statusCode} response body`
      }));

      try {
        await fetchAndConvertToMarkdown(mockServer as any, 'https://example.com');
        assert.fail(`Should have thrown server error for status ${statusCode}`);
      } catch (error: any) {
        assert.ok(error.message.includes('Server Error') || error.message.includes(`${statusCode}`) || error.name === 'MCPSearXNGError');
      }

      fetchMocker.restore();
    }
  }, results);

  await testFunction('Timeout handling', async () => {
    const mockServer = createMockServer();
    
    fetchMocker.mock(createAbortableMockFetch(50));

    try {
      await fetchAndConvertToMarkdown(mockServer as any, 'https://example.com', 100);
      assert.fail('Should have thrown timeout error');
    } catch (error: any) {
      assert.ok(error.message.includes('Timeout Error') || error.message.includes('timeout') || error.name === 'MCPSearXNGError');
    }

    fetchMocker.restore();
  }, results);

  await testFunction('Empty content handling', async () => {
    const mockServer = createMockServer();
    
    // Test empty HTML content
    fetchMocker.mock(createMockFetch({ body: '' }));

    try {
      await fetchAndConvertToMarkdown(mockServer as any, 'https://example.com');
      assert.fail('Should have thrown content error for empty content');
    } catch (error: any) {
      assert.ok(error.message.includes('Content Error') || error.message.includes('empty') || error.name === 'MCPSearXNGError');
    }

    fetchMocker.restore();
  }, results);

  await testFunction('Whitespace-only content handling', async () => {
    const mockServer = createMockServer();
    
    fetchMocker.mock(createMockFetch({ body: '   \n\t   ' }));

    // fetchSingleUrl catches content errors and tries Happy DOM fallback,
    // if both fail it returns a fallback string instead of throwing
    const result = await fetchAndConvertToMarkdown(mockServer as any, 'https://example.com');
    assert.ok(typeof result === 'string', 'Should return a string for whitespace-only content');

    fetchMocker.restore();
  }, results);

  await testFunction('Successful HTML to Markdown conversion', async () => {
    const mockServer = createMockServer();
    urlContentCache.clear();
    
    const testHtml = `
      <html>
        <head><title>Test Page</title></head>
        <body>
          <h1>Main Title</h1>
          <p>This is a test paragraph with <strong>bold text</strong>.</p>
          <ul>
            <li>First item</li>
            <li>Second item</li>
          </ul>
          <a href="https://example.com">Test Link</a>
        </body>
      </html>
    `;

    fetchMocker.mock(createMockFetch({ body: testHtml }));

    const result = await fetchAndConvertToMarkdown(mockServer as any, 'https://example.com');
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
    // Check for markdown conversion
    assert.ok(result.includes('Main Title') || result.includes('#'));

    fetchMocker.restore();
  }, results);

  await testFunction('Character pagination - maxLength', async () => {
    const mockServer = createMockServer();
    urlContentCache.clear();

    const testHtml = '<html><body><h1>Test Title</h1><p>This is a long paragraph with lots of content that we can paginate through.</p></body></html>';
    fetchMocker.mock(createMockFetch({ body: testHtml }));

    const result = await fetchAndConvertToMarkdown(mockServer as any, 'https://test-char-pagination.com', 10000, { maxLength: 20 });
    assert.ok(typeof result === 'string');
    assert.ok(result.length <= 20, `Expected length <= 20, got ${result.length}`);

    fetchMocker.restore();
  }, results);

  await testFunction('Character pagination - startChar', async () => {
    const mockServer = createMockServer();
    urlContentCache.clear();

    const testHtml = '<html><body><h1>Test Title</h1><p>Content here.</p></body></html>';
    fetchMocker.mock(createMockFetch({ body: testHtml }));

    const result = await fetchAndConvertToMarkdown(mockServer as any, 'https://test-start.com', 10000, { startChar: 10 });
    assert.ok(typeof result === 'string');

    fetchMocker.restore();
  }, results);

  await testFunction('Character pagination - both startChar and maxLength', async () => {
    const mockServer = createMockServer();
    urlContentCache.clear();

    const testHtml = '<html><body><p>Content for pagination test.</p></body></html>';
    fetchMocker.mock(createMockFetch({ body: testHtml }));

    const result = await fetchAndConvertToMarkdown(mockServer as any, 'https://test-both.com', 10000, { startChar: 5, maxLength: 15 });
    assert.ok(typeof result === 'string');
    assert.ok(result.length <= 15, `Expected length <= 15, got ${result.length}`);

    fetchMocker.restore();
  }, results);

  await testFunction('Cache integration with pagination', async () => {
    const mockServer = createMockServer();
    urlContentCache.clear();

    let fetchCount = 0;
    const testHtml = '<html><body><h1>Cached Content</h1><p>This content should be cached.</p></body></html>';

    fetchMocker.mock(async (url: string | URL | Request, options?: RequestInit) => {
      // HEAD 预检不计入抓取次数，只统计正式 GET
      if (options?.method !== 'HEAD') {
        fetchCount++;
      }
      return createMockFetch({ body: testHtml })('', undefined);
    });

    // First request should fetch from network
    const result1 = await fetchAndConvertToMarkdown(mockServer as any, 'https://cache-test.com', 10000, { maxLength: 50 });
    assert.equal(fetchCount, 1);
    assert.ok(typeof result1 === 'string');

    // Second request with different pagination should use cache
    const result2 = await fetchAndConvertToMarkdown(mockServer as any, 'https://cache-test.com', 10000, { startChar: 10, maxLength: 30 });
    assert.equal(fetchCount, 1); // Should not have fetched again

    fetchMocker.restore();
    urlContentCache.clear();
  }, results);

  await testFunction('Proxy agent integration', async () => {
    const mockServer = createMockServer();
    urlContentCache.clear();

    envManager.set('HTTPS_PROXY', 'https://proxy.example.com:8080');
    
    let capturedOptions: RequestInit | undefined;
    fetchMocker.mock(async (url: string | URL | Request, options?: RequestInit) => {
      capturedOptions = options;
      return createMockFetch({ body: '<html><body><h1>Test with proxy</h1></body></html>' })('', undefined);
    });

    await fetchAndConvertToMarkdown(mockServer as any, 'https://example.com');
    assert.ok(capturedOptions !== undefined);
    assert.ok(capturedOptions?.signal instanceof AbortSignal);

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('Anti-bot page detection returns failure message', async () => {
    const mockServer = createMockServer();
    urlContentCache.clear();

    // 模拟 36kr 反爬拦截页：短内容 + 安全检测字样
    const antiBotHtml = `
      <html>
        <head><title>安全检测</title></head>
        <body>
          <div class="antibot">
            <h1>安全检测</h1>
            <p>系统检测到您的请求异常，正在验证您的身份，请稍候...</p>
          </div>
        </body>
      </html>
    `;
    fetchMocker.mock(createMockFetch({ body: antiBotHtml }));

    const result = await fetchAndConvertToMarkdown(mockServer as any, 'https://antibot-example.com');
    assert.ok(
      typeof result === 'string' && result.includes('反爬拦截'),
      `Anti-bot page should return anti-bot failure message, got: ${result.slice(0, 100)}`
    );
    // 反爬页不应被缓存
    assert.equal(urlContentCache.get('https://antibot-example.com'), null, 'Anti-bot page should not be cached');

    fetchMocker.restore();
  }, results);

  await testFunction('Normal page is NOT flagged as anti-bot', async () => {
    const mockServer = createMockServer();
    urlContentCache.clear();

    // 长文章中出现"验证码"字样不应误伤
    const longHtml = `
      <html>
        <head><title>如何安全登录</title></head>
        <body>
          <h1>如何安全登录</h1>
          <p>${'这是一篇很长的正常文章内容，讲述了网站登录的安全注意事项。'.repeat(80)}</p>
          <p>注册时可能需要输入验证码，这是正常流程。</p>
        </body>
      </html>
    `;
    fetchMocker.mock(createMockFetch({ body: longHtml }));

    const result = await fetchAndConvertToMarkdown(mockServer as any, 'https://normal-example.com');
    assert.ok(
      typeof result === 'string' && !result.includes('反爬拦截'),
      `Normal long page should not be flagged as anti-bot, got: ${result.slice(0, 100)}`
    );

    fetchMocker.restore();
  }, results);

  await testFunction('isUrlReadFailure detects failure markers', () => {
    assert.equal(isUrlReadFailure(''), true, 'Empty content is failure');
    assert.equal(isUrlReadFailure('   \n  '), true, 'Whitespace is failure');
    assert.equal(isUrlReadFailure('⚠️ 页面内容疑似反爬拦截页（安全检测/人机验证/验证码），非真实文章内容，读取视为失败。\n建议：改用浏览器 MCP 处理此页面，或换其他来源 URL。'), true, 'Anti-bot message is failure');
    assert.equal(isUrlReadFailure('📄 Content Warning: Page fetched but appears empty after conversion'), true, 'Content warning is failure');
    assert.equal(isUrlReadFailure('这是一篇正常的文章内容，包含足够信息。'), false, 'Normal content is not failure');
  }, results);

  printTestSummary(results, 'URL Reader Module');
  return results;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  }).catch(console.error);
}

export { runTests };
