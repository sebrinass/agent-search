#!/usr/bin/env tsx

/**
 * Unit Tests: resources.ts
 * 
 * Tests for resource generation
 */

import { strict as assert } from 'node:assert';
import { createConfigResource } from '../../src/resources.js';
import { testFunction, createTestResults, printTestSummary } from '../helpers/test-utils.js';

const results = createTestResults();

async function runTests() {
  console.log('🧪 Testing: resources.ts\n');

  await testFunction('createConfigResource returns valid JSON string', () => {
    const config = createConfigResource();
    
    assert.ok(typeof config === 'string');
    assert.ok(config.length > 0);
    
    // Should be valid JSON
    const parsed = JSON.parse(config);
    assert.ok(typeof parsed === 'object');
  }, results);

  await testFunction('createConfigResource includes environment variables', () => {
    const config = createConfigResource();
    const parsed = JSON.parse(config);
    
    // Check that config includes environment information
    assert.ok(parsed.environment);
    assert.ok(parsed.environment.searxngUrl || parsed.environment.hasOwnProperty('searxngUrl'));
    assert.ok(parsed.environment.currentLogLevel || parsed.environment.hasOwnProperty('currentLogLevel'));
  }, results);

  await testFunction('createConfigResource capabilities list always includes base tools', () => {
    const parsed = JSON.parse(createConfigResource());

    // 工具清单必须是动态生成的：写死会随新增 provider 静默过期
    assert.ok(Array.isArray(parsed.capabilities.tools));
    assert.ok(parsed.capabilities.tools.includes('web_search'));
    assert.ok(parsed.capabilities.tools.includes('urls_read'));
  }, results);

  await testFunction('createConfigResource reports cloud search availability', () => {
    const parsed = JSON.parse(createConfigResource());

    assert.ok(parsed.cloudSearch);
    assert.equal(typeof parsed.cloudSearch.deepseek, 'boolean');
    assert.equal(typeof parsed.cloudSearch.minimax, 'boolean');
    assert.equal(typeof parsed.cloudSearch.exa, 'boolean');
  }, results);

  printTestSummary(results, 'Resources Module');
  return results;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  }).catch(console.error);
}

export { runTests };
