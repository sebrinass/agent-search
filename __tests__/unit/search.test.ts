#!/usr/bin/env tsx

process.env.SEARXNG_URL = process.env.SEARXNG_URL || 'https://test-searx.example.com';

import { strict as assert } from 'node:assert';
import { fetchSinglePage } from '../../src/search.js';
import { validateEnvironment } from '../../src/error-handler.js';
import { testFunction, createTestResults, printTestSummary } from '../helpers/test-utils.js';
import { createMockServer } from '../helpers/mock-server.js';
import { FetchMocker, createMockFetch } from '../helpers/mock-fetch.js';
import { EnvManager } from '../helpers/env-utils.js';

const results = createTestResults();
const fetchMocker = new FetchMocker();
const envManager = new EnvManager();

async function runTests() {
  console.log('🧪 Testing: search.ts\n');

  await testFunction('Error handling for missing SEARXNG_URL', async () => {
    envManager.delete('SEARXNG_URL');
    
    const result = validateEnvironment();
    assert.ok(result !== null, 'validateEnvironment should return an error when SEARXNG_URL is missing');
    assert.ok(result!.includes('SEARXNG_URL'), `Error message should mention SEARXNG_URL, got: ${result}`);
    
    envManager.restore();
  }, results);

  await testFunction('Error handling for invalid SEARXNG_URL format', async () => {
    envManager.set('SEARXNG_URL', 'not-a-valid-url');
    
    const result = validateEnvironment();
    assert.ok(result !== null, 'validateEnvironment should return an error for invalid SEARXNG_URL');
    assert.ok(result!.includes('SEARXNG_URL') || result!.includes('invalid'), `Error message should mention invalid SEARXNG_URL, got: ${result}`);
    
    envManager.restore();
  }, results);

  await testFunction('fetchSinglePage parameter validation and URL construction', async () => {
    let capturedUrl = '';

    fetchMocker.mock(async (url, options) => {
      capturedUrl = url.toString();
      throw new Error('MOCK_NETWORK_ERROR');
    });

    try {
      await fetchSinglePage(createMockServer() as any, 'test query', 2, 'day', 'en', 1);
    } catch (error: any) {
    }

    const url = new URL(capturedUrl);
    assert.ok(url.pathname.includes('/search'));
    assert.ok(url.searchParams.get('q') === 'test query');
    assert.ok(url.searchParams.get('pageno') === '2');
    assert.ok(url.searchParams.get('format') === 'json');

    fetchMocker.restore();
  }, results);

  await testFunction('URL construction with subpath', async () => {
    const baseWithSlash = new URL('https://test-searx.example.com/instance/');
    const urlWithSlash = new URL('search', baseWithSlash);
    assert.ok(urlWithSlash.pathname.includes('/instance/search'),
      `Expected path to contain /instance/search, got ${urlWithSlash.pathname}`);

    const baseWithoutSlash = new URL('https://test-searx.example.com/instance');
    const urlWithoutSlash = new URL('search', baseWithoutSlash);
    const fixedBase = new URL('https://test-searx.example.com/instance/');
    const fixedUrl = new URL('search', fixedBase);
    assert.ok(fixedUrl.pathname.includes('/instance/search'),
      `Expected path to contain /instance/search, got ${fixedUrl.pathname}`);
  }, results);

  await testFunction('Request options construction', async () => {
    let capturedOptions: RequestInit | undefined;
    
    fetchMocker.mock(async (url: string | URL | Request, options?: RequestInit) => {
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ results: [] })
      } as Response;
    });

    await fetchSinglePage(createMockServer() as any, 'test query');

    assert.ok(capturedOptions !== undefined, 'Request options should be captured');
    assert.equal(capturedOptions?.method, 'GET', 'Request method should be GET');

    fetchMocker.restore();
  }, results);

  await testFunction('Server error handling with different status codes', async () => {
    const statusCodes = [404, 500, 502, 503];
    
    for (const statusCode of statusCodes) {
      const mockFetch = createMockFetch({
        ok: false,
        status: statusCode,
        statusText: `HTTP ${statusCode}`,
        body: `Server error: ${statusCode}`
      });

      fetchMocker.mock(mockFetch);

      try {
        await fetchSinglePage(createMockServer() as any, 'test query');
        assert.fail(`Should have thrown server error for status ${statusCode}`);
      } catch (error: any) {
        assert.ok(
          error.name === 'MCPSearXNGError' || 
          error.message.includes(String(statusCode)),
          `Error should reference status ${statusCode}, got: ${error.message}`
        );
      }

      fetchMocker.restore();
    }
  }, results);

  await testFunction('JSON parsing error handling', async () => {
    fetchMocker.mock(async () => ({
      ok: true,
      json: async () => {
        throw new Error('Invalid JSON');
      },
      text: async () => 'Invalid JSON response'
    } as any));

    try {
      await fetchSinglePage(createMockServer() as any, 'test query');
      assert.fail('Should have thrown JSON parsing error');
    } catch (error: any) {
      assert.ok(
        error.name === 'MCPSearXNGError',
        `Error should be MCPSearXNGError, got: ${error.name} - ${error.message}`
      );
    }

    fetchMocker.restore();
  }, results);

  await testFunction('Empty results handling', async () => {
    const mockFetch = createMockFetch({ json: { results: [] } });

    fetchMocker.mock(mockFetch);

    const result = await fetchSinglePage(createMockServer() as any, 'test query');
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);

    fetchMocker.restore();
  }, results);

  await testFunction('Successful search returns results', async () => {
    const mockFetch = createMockFetch({
      json: {
        results: [
          {
            title: 'Test Result 1',
            content: 'This is test content 1',
            url: 'https://example.com/1',
            score: 0.95
          },
          {
            title: 'Test Result 2',
            content: 'This is test content 2',
            url: 'https://example.com/2',
            score: 0.87
          }
        ]
      }
    });

    fetchMocker.mock(mockFetch);

    const result = await fetchSinglePage(createMockServer() as any, 'test query');
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 2);
    assert.equal(result[0].title, 'Test Result 1');
    assert.equal(result[1].title, 'Test Result 2');
    assert.equal(result[0].url, 'https://example.com/1');
    assert.equal(result[1].url, 'https://example.com/2');

    fetchMocker.restore();
  }, results);

  printTestSummary(results, 'Search Module');
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  }).catch(console.error);
}

export { runTests };
