#!/usr/bin/env tsx

/**
 * Unit Tests: url-normalize.ts
 *
 * Tests for URL normalization (tracking params stripping, www, anchor, trailing slash)
 */

import { strict as assert } from 'node:assert';
import { normalizeUrl } from '../../src/url-normalize.js';
import { testFunction, createTestResults, printTestSummary } from '../helpers/test-utils.js';

const results = createTestResults();

async function runTests() {
  console.log('🧪 Testing: url-normalize.ts\n');

  await testFunction('去掉 utm 参数', () => {
    assert.equal(
      normalizeUrl('https://example.com/article?utm_source=twitter&utm_medium=social&id=42'),
      'https://example.com/article?id=42'
    );
  }, results);

  await testFunction('去掉 fbclid/gclid', () => {
    assert.equal(
      normalizeUrl('https://example.com/p?fbclid=abc123&gclid=xyz&page=2'),
      'https://example.com/p?page=2'
    );
  }, results);

  await testFunction('去掉 spm（阿里系）', () => {
    assert.equal(
      normalizeUrl('https://example.com/item?id=1&spm=2014.123.456.789&scm=1007'),
      'https://example.com/item?id=1'
    );
  }, results);

  await testFunction('去 www 前缀', () => {
    assert.equal(
      normalizeUrl('https://www.example.com/path'),
      'https://example.com/path'
    );
  }, results);

  await testFunction('去锚点', () => {
    assert.equal(
      normalizeUrl('https://example.com/path#section'),
      'https://example.com/path'
    );
  }, results);

  await testFunction('规整末尾斜杠', () => {
    assert.equal(
      normalizeUrl('https://example.com/path/'),
      'https://example.com/path'
    );
  }, results);

  await testFunction('保留根路径斜杠', () => {
    assert.equal(
      normalizeUrl('https://example.com/'),
      'https://example.com/'
    );
  }, results);

  await testFunction('组合场景：www+utm+锚点+斜杠', () => {
    assert.equal(
      normalizeUrl('https://www.example.com/blog/2024/rag/?utm_source=news&utm_campaign=launch#top'),
      'https://example.com/blog/2024/rag'
    );
  }, results);

  await testFunction('保留业务参数（page、id）', () => {
    assert.equal(
      normalizeUrl('https://example.com/list?page=3&id=99'),
      'https://example.com/list?page=3&id=99'
    );
  }, results);

  await testFunction('非法 URL 原样返回（尽力清理）', () => {
    const raw = 'not-a-url';
    assert.equal(normalizeUrl(raw), raw);
  }, results);

  await testFunction('大小写不敏感跟踪参数', () => {
    assert.equal(
      normalizeUrl('https://example.com/p?UTM_SOURCE=x'),
      'https://example.com/p'
    );
  }, results);

  printTestSummary(results, 'URL Normalize Module');
  return results;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  }).catch(console.error);
}

export { runTests };
