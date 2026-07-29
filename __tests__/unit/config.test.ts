#!/usr/bin/env tsx

/**
 * Unit Tests: config.ts
 *
 * Tests for configuration management module
 */

import { strict as assert } from 'node:assert';
import {
  EMBEDDING_MODEL,
  EMBEDDING_TIMEOUT_MS,
  DEFAULT_SEARCH_PAGES,
  SEARCH_PAGES,
  SEARCH_LANGUAGE,
  SAFE_SEARCH,
  TOP_K,
  RRF_K,
  MAX_KEYWORDS,
  MAX_DESCRIPTION_LENGTH,
  FETCH_TIMEOUT_MS,
  ENABLE_JS_RENDER,
  ENABLE_READABILITY,
  LINK_DEDUP_TTL,
  URL_CACHE_TTL,
  URL_CACHE_SIZE,
  EMBEDDING_CACHE_SIZE,
  EMBEDDING_MODEL as EMBEDDING_MODEL_CHECK,
  SEARCH_TIMEOUT_MS,
  SEARCH_ENGINES,
} from '../../src/config.js';
import { validateEnvironment } from '../../src/error-handler.js';
import { testFunction, createTestResults, printTestSummary } from '../helpers/test-utils.js';
import { EnvManager } from '../helpers/env-utils.js';

const results = createTestResults();
const envManager = new EnvManager();

async function runTests() {
  console.log('🧪 Testing: config.ts\n');

  // ============ 默认值测试 ============

  await testFunction('EMBEDDING_MODEL default value', () => {
    assert.ok(typeof EMBEDDING_MODEL === 'string' && EMBEDDING_MODEL.length > 0);
  }, results);

  await testFunction('EMBEDDING_TIMEOUT_MS default value', () => {
    assert.ok(EMBEDDING_TIMEOUT_MS >= 90000, `EMBEDDING_TIMEOUT_MS should be >= 90000, got ${EMBEDDING_TIMEOUT_MS}`);
  }, results);

  await testFunction('RRF_K constant value', () => {
    assert.equal(RRF_K, 60);
  }, results);

  await testFunction('TOP_K default value', () => {
    assert.equal(TOP_K, 5);
  }, results);

  await testFunction('MAX_KEYWORDS default value', () => {
    assert.equal(MAX_KEYWORDS, 3);
  }, results);

  await testFunction('MAX_DESCRIPTION_LENGTH default value', () => {
    assert.equal(MAX_DESCRIPTION_LENGTH, 200);
  }, results);

  await testFunction('FETCH_TIMEOUT_MS default value', () => {
    assert.equal(FETCH_TIMEOUT_MS, 30000);
  }, results);

  await testFunction('ENABLE_JS_RENDER default is true', () => {
    assert.equal(ENABLE_JS_RENDER, true);
  }, results);

  await testFunction('ENABLE_READABILITY default is true', () => {
    assert.equal(ENABLE_READABILITY, true);
  }, results);

  await testFunction('LINK_DEDUP_TTL default value', () => {
    assert.equal(LINK_DEDUP_TTL, 86400);
  }, results);

  await testFunction('URL_CACHE_TTL default value', () => {
    assert.equal(URL_CACHE_TTL, 3600);
  }, results);

  await testFunction('URL_CACHE_SIZE default value', () => {
    assert.equal(URL_CACHE_SIZE, 100);
  }, results);

  await testFunction('EMBEDDING_CACHE_SIZE default value', () => {
    assert.equal(EMBEDDING_CACHE_SIZE, 1000);
  }, results);

  await testFunction('SEARCH_LANGUAGE default value', () => {
    assert.equal(SEARCH_LANGUAGE, 'all');
  }, results);

  await testFunction('SAFE_SEARCH default value', () => {
    assert.equal(SAFE_SEARCH, 0);
  }, results);

  await testFunction('DEFAULT_SEARCH_PAGES default value', () => {
    assert.equal(DEFAULT_SEARCH_PAGES, 1);
  }, results);

  await testFunction('SEARCH_PAGES is a positive number', () => {
    assert.ok(SEARCH_PAGES >= 1, `SEARCH_PAGES should be >= 1, got ${SEARCH_PAGES}`);
  }, results);

  // ============ 衍生配置测试 ============

  await testFunction('EMBEDDING_MODEL is consistent', () => {
    assert.equal(EMBEDDING_MODEL_CHECK, EMBEDDING_MODEL);
  }, results);

  await testFunction('SEARCH_TIMEOUT_MS is a positive number', () => {
    assert.ok(SEARCH_TIMEOUT_MS > 0, `SEARCH_TIMEOUT_MS should be > 0, got ${SEARCH_TIMEOUT_MS}`);
  }, results);

  await testFunction('SEARCH_ENGINES is a string', () => {
    assert.ok(typeof SEARCH_ENGINES === 'string');
  }, results);

  // ============ validateEnvironment 测试 ============

  await testFunction('validateEnvironment returns error when SEARXNG_URL is missing', () => {
    envManager.delete('SEARXNG_URL');

    const result = validateEnvironment();
    assert.ok(result !== null, 'validateEnvironment should return an error when SEARXNG_URL is missing');
    assert.ok(result!.includes('SEARXNG_URL'), `Error message should mention SEARXNG_URL, got: ${result}`);

    envManager.restore();
  }, results);

  await testFunction('validateEnvironment passes when SEARXNG_URL is set', () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');

    const result = validateEnvironment();
    assert.equal(result, null, `validateEnvironment should return null when SEARXNG_URL is valid, got: ${result}`);

    envManager.restore();
  }, results);

  await testFunction('validateEnvironment returns error for invalid SEARXNG_URL format', () => {
    envManager.set('SEARXNG_URL', 'not-a-valid-url');

    const result = validateEnvironment();
    assert.ok(result !== null, 'validateEnvironment should return an error for invalid SEARXNG_URL');
    assert.ok(result!.includes('SEARXNG_URL'), `Error message should mention SEARXNG_URL, got: ${result}`);

    envManager.restore();
  }, results);

  await testFunction('validateEnvironment returns error for invalid SEARXNG_URL protocol', () => {
    envManager.set('SEARXNG_URL', 'ftp://example.com');

    const result = validateEnvironment();
    assert.ok(result !== null, 'validateEnvironment should return an error for invalid protocol');
    assert.ok(result!.includes('SEARXNG_URL') || result!.includes('protocol'), `Error message should mention protocol issue, got: ${result}`);

    envManager.restore();
  }, results);

  await testFunction('validateEnvironment returns error when AUTH_USERNAME set but AUTH_PASSWORD missing', () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('AUTH_USERNAME', 'testuser');
    envManager.delete('AUTH_PASSWORD');

    const result = validateEnvironment();
    assert.ok(result !== null, 'validateEnvironment should return an error for partial auth config');
    assert.ok(result!.includes('AUTH_PASSWORD'), `Error message should mention AUTH_PASSWORD, got: ${result}`);

    envManager.restore();
  }, results);

  await testFunction('validateEnvironment returns error when AUTH_PASSWORD set but AUTH_USERNAME missing', () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.delete('AUTH_USERNAME');
    envManager.set('AUTH_PASSWORD', 'testpass');

    const result = validateEnvironment();
    assert.ok(result !== null, 'validateEnvironment should return an error for partial auth config');
    assert.ok(result!.includes('AUTH_USERNAME'), `Error message should mention AUTH_USERNAME, got: ${result}`);

    envManager.restore();
  }, results);

  printTestSummary(results, 'Config Module');
  return results;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  }).catch(console.error);
}

export { runTests };
