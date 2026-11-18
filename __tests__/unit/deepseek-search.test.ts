#!/usr/bin/env tsx

/**
 * Unit Tests: deepseek-search.ts
 *
 * 只覆盖纯函数（query 操作符拼接），不发起真实网络请求。
 */

import { strict as assert } from 'node:assert';
import { buildDeepseekQuery } from '../../src/deepseek-search.js';
import { testFunction, createTestResults, printTestSummary } from '../helpers/test-utils.js';

const results = createTestResults();

// 固定时间，保证 after: 日期断言可复现
const NOW = new Date('2026-11-19T00:00:00Z');

async function runTests() {
  console.log('🧪 Testing: deepseek-search.ts\n');

  await testFunction('无过滤条件时保持原查询', () => {
    assert.equal(buildDeepseekQuery('MCP 协议', {}, NOW), 'MCP 协议');
  }, results);

  await testFunction('site 转为 site: 操作符', () => {
    assert.equal(buildDeepseekQuery('RAG', { site: 'github.com' }, NOW), 'RAG site:github.com');
  }, results);

  await testFunction('lang 转为 lang: 操作符，all 视为不过滤', () => {
    assert.equal(buildDeepseekQuery('RAG', { lang: 'zh' }, NOW), 'RAG lang:zh');
    assert.equal(buildDeepseekQuery('RAG', { lang: 'all' }, NOW), 'RAG');
  }, results);

  await testFunction('time_range 转为 after: 日期', () => {
    assert.equal(buildDeepseekQuery('RAG', { time_range: 'day' }, NOW), 'RAG after:2026-11-18');
    assert.equal(buildDeepseekQuery('RAG', { time_range: 'month' }, NOW), 'RAG after:2026-10-20');
    assert.equal(buildDeepseekQuery('RAG', { time_range: 'year' }, NOW), 'RAG after:2025-11-19');
  }, results);

  await testFunction('多个操作符按 site / lang / after 顺序拼接', () => {
    const query = buildDeepseekQuery('RAG', { site: 'github.com', lang: 'en', time_range: 'day' }, NOW);
    assert.equal(query, 'RAG site:github.com lang:en after:2026-11-18');
  }, results);

  await testFunction('超长查询截断关键词但保留操作符', () => {
    const longQuery = 'x'.repeat(200);
    const query = buildDeepseekQuery(longQuery, { site: 'example.com' }, NOW);

    assert.ok(query.length <= 128, `长度应 <=128，实际 ${query.length}`);
    assert.ok(query.endsWith('site:example.com'), '操作符应被完整保留');
  }, results);

  printTestSummary(results, 'DeepSeek Search Module');
  return results;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  }).catch(console.error);
}

export { runTests };
