#!/usr/bin/env tsx

/**
 * Unit Tests: cache.ts
 * 
 * Tests for caching functionality
 */

import { strict as assert } from 'node:assert';
import {
  urlContentCache,
  embeddingCache,
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
const clearEmbeddingCache = () => embeddingCache.clear();
const setEmbeddingCache = (text: string, emb: Float32Array | number[]) => embeddingCache.set(text, emb);
const getEmbeddingCache = (text: string) => embeddingCache.get(text);
const hasEmbeddingCache = (text: string) => embeddingCache.has(text);
const getEmbeddingCacheStats = () => embeddingCache.getStats();
const clearLinkDedup = () => linkDedupPool.clear();
const getLinkDedupStats = () => linkDedupPool.getStats();
const clearAllCaches = () => {
  urlContentCache.clear();
  embeddingCache.clear();
  linkDedupPool.clear();
};
void getEmbeddingCacheStats;

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

  await testFunction('Embedding cache - set and get', () => {
    clearEmbeddingCache();

    const testEmbedding = new Float32Array([0.1, 0.2, 0.3]);
    setEmbeddingCache('test text', testEmbedding);
    
    const cached = getEmbeddingCache('test text');
    assert.ok(cached);
    assert.equal(cached.length, testEmbedding.length);
    for (let i = 0; i < cached.length; i++) {
      assert.ok(Math.abs(cached[i] - testEmbedding[i]) < 1e-7,
        `Value at index ${i}: expected ${testEmbedding[i]}, got ${cached[i]}`);
    }

    clearEmbeddingCache();
  }, results);

  await testFunction('Embedding cache - has and check', () => {
    clearEmbeddingCache();

    assert.equal(hasEmbeddingCache('test'), false);
    setEmbeddingCache('test', new Float32Array([1, 2, 3]));
    assert.equal(hasEmbeddingCache('test'), true);

    clearEmbeddingCache();
  }, results);

  await testFunction('Clear all caches', () => {
    setUrlCache('https://test.com', '<html>test</html>', '# Test');
    addLinksToDedup(['https://link.com']);
    setEmbeddingCache('test', new Float32Array([1, 2, 3]));

    clearAllCaches();

    assert.equal(hasUrlCache('https://test.com'), false);
    assert.equal(isLinkDuplicate('https://link.com'), false);
    assert.equal(hasEmbeddingCache('test'), false);
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
