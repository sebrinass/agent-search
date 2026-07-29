#!/usr/bin/env tsx

/**
 * Unit Tests: lightpanda.ts
 *
 * Tests for the Lightpanda dynamic-rendering layer (spawn mode).
 *
 * 说明：config 常量在模块加载时固定，测试环境默认未配置 LIGHTPANDA_EXECUTABLE_PATH，
 * 因此这里主要验证两个不依赖真实二进制的核心性质：
 *   1. 未配置/不可用时 fetchWithLightpanda 返回 null（优雅降级，绝不崩主流程）
 *   2. buildLightpandaArgs 的参数拼装逻辑（含 SSRF 开关的运行时行为）
 */

import { strict as assert } from 'node:assert';
import {
  fetchWithLightpanda,
  buildLightpandaArgs,
  resetLightpandaAvailabilityCache,
} from '../../src/lightpanda.js';
import { testFunction, createTestResults, printTestSummary } from '../helpers/test-utils.js';
import { EnvManager } from '../helpers/env-utils.js';

const results = createTestResults();
const envManager = new EnvManager();

async function runTests() {
  console.log('🧪 Testing: lightpanda.ts\n');

  // ============ fetchWithLightpanda: 降级安全性 ============

  await testFunction('fetchWithLightpanda returns null when not configured', async () => {
    // 测试环境未设置 LIGHTPANDA_EXECUTABLE_PATH，可用性探测应为 false
    resetLightpandaAvailabilityCache();
    const result = await fetchWithLightpanda('https://example.com', 5000);
    assert.equal(result, null, 'Should return null (graceful degrade) when Lightpanda not configured');
  }, results);

  await testFunction('fetchWithLightpanda does not throw on invalid url input', async () => {
    resetLightpandaAvailabilityCache();
    // 未配置时应在探测阶段就返回 null，不应抛异常
    const result = await fetchWithLightpanda('not-a-real-url', 1000);
    assert.equal(result, null);
  }, results);

  // ============ buildLightpandaArgs: 参数拼装 ============

  await testFunction('buildLightpandaArgs includes fetch --dump html and puts url last', () => {
    const args = buildLightpandaArgs('https://example.com/page');
    assert.equal(args[0], 'fetch', 'First arg should be the fetch subcommand');
    assert.ok(args.includes('--dump'), 'Should include --dump');
    assert.ok(args.includes('html'), 'Should dump html');
    assert.equal(args[args.length - 1], 'https://example.com/page', 'URL should be the last arg');
  }, results);

  await testFunction('buildLightpandaArgs waits for network idle', () => {
    const args = buildLightpandaArgs('https://example.com');
    const idx = args.indexOf('--wait-until');
    assert.ok(idx >= 0, 'Should include --wait-until');
    assert.equal(args[idx + 1], 'networkidle', 'Should wait until networkidle');
  }, results);

  await testFunction('buildLightpandaArgs blocks private networks by default (SSRF)', () => {
    envManager.delete('MCP_HTTP_ALLOW_PRIVATE_URLS');
    const args = buildLightpandaArgs('https://example.com');
    assert.ok(args.includes('--block-private-networks'), 'Should block private networks by default');
    envManager.restore();
  }, results);

  await testFunction('buildLightpandaArgs omits block flag when private URLs explicitly allowed', () => {
    envManager.set('MCP_HTTP_ALLOW_PRIVATE_URLS', 'true');
    const args = buildLightpandaArgs('https://example.com');
    assert.ok(!args.includes('--block-private-networks'), 'Should not block when MCP_HTTP_ALLOW_PRIVATE_URLS=true');
    envManager.restore();
  }, results);

  // ============ resetLightpandaAvailabilityCache ============

  await testFunction('resetLightpandaAvailabilityCache does not throw', () => {
    resetLightpandaAvailabilityCache();
  }, results);

  printTestSummary(results, 'Lightpanda Module');
  return results;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  }).catch(console.error);
}

export { runTests };
