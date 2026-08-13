#!/usr/bin/env tsx

/**
 * Unit Tests: cache.ts
 * 
 * Tests for caching functionality
 */

import { strict as assert } from 'node:assert';
import {
  urlContentCache,
  linkDedupPool,
  addLinksToDedup,
  isLinkDuplicate
} from '../../src/cache.js';
import { testFunction, createTestResults, printTestSummary } from '../helpers/test-utils.js';

// 基于导出的缓存实例封装便捷函数，保持测试主体简洁
const clearUrlCache = () => urlContentCache.clear();
const setUrlCache = (url: string, html: string, md: string) => urlContentCache.set(url, html, md);
const getUrlCache = (url: string) => urlContentCache.get(url);
const hasUrlCache = (url: string) => urlContentCache.has(url);
const deleteUrlCache = (url: string) => urlContentCache.delete(url);
const getUrlCacheStats = () => urlContentCache.getStats();
const clearLinkDedup = () => linkDedupPool.clear();
const getLinkDedupStats = () => linkDedupPool.getStats();
const clearAllCaches = () => {
  urlContentCache.clear();
  linkDedupPool.clear();
};

const results = createTestResults();

async function runTests() {
  console.log('🧪 Testing: cache.ts\n');

  await testFunction('URL cache - set and get', () => {
    clearUrlCache();

    setUrlCache('https://test.com', '<html>test</html>', '# Test');
    const entry = getUrlCache('https://test.com');
    
    assert.ok(entry);
    assert.equal(entry.htmlContent, '<html>test</html>');
    assert.equal(entry.markdownContent, '# Test');

    clearUrlCache();
  }, results);

  await testFunction('URL cache - returns null for non-existent keys', () => {
    clearUrlCache();
    assert.equal(getUrlCache('https://non-existent.com'), null);
  }, results);

  await testFunction('URL cache - has and delete', () => {
    clearUrlCache();

    assert.equal(hasUrlCache('https://test.com'), false);
    setUrlCache('https://test.com', '<html>test</html>', '# Test');
    assert.equal(hasUrlCache('https://test.com'), true);
    
    assert.equal(deleteUrlCache('https://test.com'), true);
    assert.equal(hasUrlCache('https://test.com'), false);
    assert.equal(deleteUrlCache('https://test.com'), false);
  }, results);

  await testFunction('URL cache - statistics', () => {
    clearUrlCache();

    setUrlCache('https://url1.com', '<html>1</html>', '# 1');
    setUrlCache('https://url2.com', '<html>2</html>', '# 2');

    const stats = getUrlCacheStats();
    assert.equal(stats.size, 2);
    assert.equal(stats.maxSize > 0, true);
  }, results);

  await testFunction('Link dedup - add and check', () => {
    clearLinkDedup();

    assert.equal(isLinkDuplicate('https://test.com'), false);
    addLinksToDedup(['https://test.com']);
    assert.equal(isLinkDuplicate('https://test.com'), true);
    assert.equal(isLinkDuplicate('https://other.com'), false);

    clearLinkDedup();
  }, results);

  await testFunction('Link dedup - batch add', () => {
    clearLinkDedup();

    addLinksToDedup(['https://a.com', 'https://b.com', 'https://c.com']);
    
    assert.equal(isLinkDuplicate('https://a.com'), true);
    assert.equal(isLinkDuplicate('https://b.com'), true);
    assert.equal(isLinkDuplicate('https://c.com'), true);
    assert.equal(isLinkDuplicate('https://d.com'), false);

    const stats = getLinkDedupStats();
    assert.equal(stats.size, 3);

    clearLinkDedup();
  }, results);

  await testFunction('Clear all caches', () => {
    setUrlCache('https://test.com', '<html>test</html>', '# Test');
    addLinksToDedup(['https://link.com']);

    clearAllCaches();

    assert.equal(hasUrlCache('https://test.com'), false);
    assert.equal(isLinkDuplicate('https://link.com'), false);
  }, results);

  printTestSummary(results, 'Cache Module');
  return results;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  }).catch(console.error);
}

export { runTests };
