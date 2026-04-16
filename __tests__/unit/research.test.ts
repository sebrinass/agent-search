#!/usr/bin/env tsx

/**
 * Unit Tests: research.ts
 *
 * Tests for ResearchServer core search logic
 */

process.env.SEARXNG_URL = process.env.SEARXNG_URL || 'https://test-searx.example.com';

import { strict as assert } from 'node:assert';
import { ResearchServer, SearchInput } from '../../src/research.js';
import { testFunction, createTestResults, printTestSummary } from '../helpers/test-utils.js';
import { FetchMocker, createMockFetch, createCapturingMockFetch } from '../helpers/mock-fetch.js';

const results = createTestResults();
const fetchMocker = new FetchMocker();

/**
 * Create a minimal mock MCP server for ResearchServer.setServer()
 * The server only needs a notification method for logging
 */
function createMockServer() {
  return {
    notification: async () => {}
  } as any;
}

async function runTests() {
  console.log('🧪 Testing: research.ts\n');

  // ============ ResearchServer 构造函数 ============

  await testFunction('ResearchServer can be constructed', () => {
    const server = new ResearchServer();
    assert.ok(server instanceof ResearchServer);
  }, results);

  // ============ processSearch 方法 ============

  await testFunction('processSearch returns empty result when no keywords provided', async () => {
    const server = new ResearchServer();
    const input: SearchInput = {};
    const result = await server.processSearch(input);

    assert.ok(result.content);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'text');

    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.searchResults, undefined);
  }, results);

  await testFunction('processSearch returns message when keywords exceed MAX_KEYWORDS', async () => {
    const server = new ResearchServer();
    // MAX_KEYWORDS defaults to 3, provide 5 keywords
    const input: SearchInput = {
      searchedKeywords: ['kw1', 'kw2', 'kw3', 'kw4', 'kw5']
    };

    // Mock fetch to avoid real network calls
    fetchMocker.mock(createMockFetch({ json: { results: [] } }));

    const result = await server.processSearch(input);

    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.message, 'Should have a message about skipped keywords');
    assert.ok(parsed.message.includes('3'), 'Message should mention the keyword limit');

    fetchMocker.restore();
  }, results);

  // ============ SearchInput 接口 ============

  await testFunction('SearchInput with all fields specified', async () => {
    const server = new ResearchServer();

    fetchMocker.mock(createMockFetch({ json: { results: [] } }));

    const input: SearchInput = {
      searchedKeywords: [],
      site: 'example.com',
      time_range: 'day',
      lang: 'en',
      safeSearch: 1
    };
    const result = await server.processSearch(input);

    assert.ok(result.content);
    assert.equal(result.content.length, 1);

    fetchMocker.restore();
  }, results);

  // ============ searchKeywords 方法（通过 processSearch 间接测试） ============

  await testFunction('searchKeywords returns empty when no keywords provided', async () => {
    const server = new ResearchServer();
    const input: SearchInput = {
      searchedKeywords: []
    };
    const result = await server.processSearch(input);

    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.searchResults, undefined, 'Should not have searchResults with empty keywords');
  }, results);

  await testFunction('searchKeywords performs search with mocked fetch', async () => {
    const server = new ResearchServer();

    fetchMocker.mock(createMockFetch({
      json: {
        results: [
          { title: 'Test Result', content: 'Test content', url: 'https://example.com/test', score: 0.9 }
        ]
      }
    }));

    const input: SearchInput = {
      searchedKeywords: ['test query']
    };
    const result = await server.processSearch(input);

    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.searchResults, 'Should have searchResults');
    assert.equal(parsed.searchResults.length, 1);
    assert.equal(parsed.searchResults[0].keyword, 'test query');

    fetchMocker.restore();
  }, results);

  // ============ fetchSinglePage URL 构造测试（通过 processSearch 间接测试） ============

  await testFunction('fetchSinglePage constructs correct URL and parameters', async () => {
    const server = new ResearchServer();
    server.setServer(createMockServer());

    const { mockFetch, getCapturedUrl } = createCapturingMockFetch();
    fetchMocker.mock(mockFetch);

    const input: SearchInput = {
      searchedKeywords: ['test query'],
      lang: 'en',
      safeSearch: 1,
      time_range: 'day'
    };
    await server.processSearch(input);

    const capturedUrl = getCapturedUrl();
    const url = new URL(capturedUrl);
    assert.ok(url.pathname.includes('search'), `Path should contain 'search', got: ${url.pathname}`);
    assert.equal(url.searchParams.get('q'), 'test query');
    assert.equal(url.searchParams.get('format'), 'json');
    assert.equal(url.searchParams.get('language'), 'en');
    assert.equal(url.searchParams.get('safesearch'), '1');
    assert.equal(url.searchParams.get('time_range'), 'day');

    fetchMocker.restore();
  }, results);

  await testFunction('fetchSinglePage adds site: prefix when site is specified', async () => {
    const server = new ResearchServer();
    server.setServer(createMockServer());

    const { mockFetch, getCapturedUrl } = createCapturingMockFetch();
    fetchMocker.mock(mockFetch);

    const input: SearchInput = {
      searchedKeywords: ['react hooks'],
      site: 'github.com'
    };
    await server.processSearch(input);

    const capturedUrl = getCapturedUrl();
    const url = new URL(capturedUrl);
    assert.equal(url.searchParams.get('q'), 'site:github.com react hooks');

    fetchMocker.restore();
  }, results);

  await testFunction('fetchSinglePage URL construction with trailing slash', () => {
    const baseUrlWithSlash = 'https://test-searx.example.com/searx/';
    const urlWithSlash = new URL('search', baseUrlWithSlash);
    assert.ok(urlWithSlash.pathname.includes('/searx/search'),
      `Expected path to contain /searx/search, got ${urlWithSlash.pathname}`);

    const baseUrlNoSlash = 'https://test-searx.example.com';
    const urlNoSlash = new URL('search', baseUrlNoSlash + '/');
    assert.ok(urlNoSlash.pathname.includes('/search'),
      `Expected path to contain /search, got ${urlNoSlash.pathname}`);
  }, results);

  await testFunction('fetchSinglePage uses default language when lang not specified', async () => {
    const server = new ResearchServer();
    server.setServer(createMockServer());

    const { mockFetch, getCapturedUrl } = createCapturingMockFetch();
    fetchMocker.mock(mockFetch);

    const input: SearchInput = {
      searchedKeywords: ['test']
    };
    await server.processSearch(input);

    const capturedUrl = getCapturedUrl();
    const url = new URL(capturedUrl);
    // When lang is not specified, SEARCH_LANGUAGE (default 'all') is used
    // 'all' should not set the language parameter
    assert.equal(url.searchParams.has('language'), false,
      'Should not set language param when lang is "all"');

    fetchMocker.restore();
  }, results);

  // ============ 错误处理 ============

  await testFunction('processSearch returns error result on exception', async () => {
    const server = new ResearchServer();
    // Force an error by making searchedKeywords trigger a failure
    fetchMocker.mock(async () => { throw new Error('Network failure'); });

    const input: SearchInput = {
      searchedKeywords: ['fail query']
    };
    const result = await server.processSearch(input);

    // The searchKeyword catches errors internally and returns them in the result
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.searchResults, 'Should have searchResults even on error');
    assert.ok(parsed.searchResults[0].error, 'Search result should have an error');

    fetchMocker.restore();
  }, results);

  printTestSummary(results, 'Research Module');
  return results;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  }).catch(console.error);
}

export { runTests };
