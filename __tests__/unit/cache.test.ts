#!/usr/bin/env tsx

/**
 * Unit Tests: cache.ts
 * 
 * Tests for caching functionality
 */

import { strict as assert } from 'node:assert';
import { 
  clearUrlCache,
  setUrlCache,
  getUrlCache,
  hasUrlCache,
  deleteUrlCache,
  clearEmbeddingCache,
  setEmbeddingCache,
  getEmbeddingCache,
  hasEmbeddingCache,
  clearLinkDedup,
  addLinkToDedup,
  addLinksToDedup,
  isLinkDuplicate,
  getUrlCacheStats,
  getEmbeddingCacheStats,
  getLinkDedupStats,
  clearAllCaches
} from '../../src/cache.js';
import { testFunction, createTestResults, printTestSummary } from '../helpers/test-utils.js';

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
    assert.equal(stats.entries.length, 2);
  }, results);

  await testFunction('Link dedup - add and check', () => {
    clearLinkDedup();

    assert.equal(isLinkDuplicate('https://test.com'), false);
    addLinkToDedup('https://test.com');
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
    assert.deepEqual(cached, testEmbedding);

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
    addLinkToDedup('https://link.com');
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
