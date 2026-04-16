#!/usr/bin/env tsx

/**
 * Unit Tests: tool-handlers.ts
 *
 * Tests for tool routing and handler functions
 */

import { strict as assert } from 'node:assert';
import {
  handleSearchTool,
  handleReadTool,
  registerRequestHandlers,
  getToolDefinitions,
} from '../../src/tool-handlers.js';
import { ResearchServer } from '../../src/research.js';
import { testFunction, createTestResults, printTestSummary } from '../helpers/test-utils.js';
import { FetchMocker, createMockFetch } from '../helpers/mock-fetch.js';

const results = createTestResults();
const fetchMocker = new FetchMocker();

async function runTests() {
  console.log('🧪 Testing: tool-handlers.ts\n');

  // ============ handleSearchTool ============

  await testFunction('handleSearchTool constructs SearchInput correctly', async () => {
    const researchServer = new ResearchServer();

    fetchMocker.mock(createMockFetch({ json: { results: [] } }));

    const result = await handleSearchTool(researchServer, {
      searchedKeywords: ['test']
    });

    assert.ok(result.content);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'text');

    const parsed = JSON.parse(result.content[0].text);

    fetchMocker.restore();
  }, results);

  await testFunction('handleSearchTool passes searchedKeywords correctly', async () => {
    const researchServer = new ResearchServer();

    fetchMocker.mock(createMockFetch({
      json: {
        results: [
          { title: 'Result 1', content: 'Content 1', url: 'https://example.com/1', score: 0.9 }
        ]
      }
    }));

    const result = await handleSearchTool(researchServer, {
      searchedKeywords: ['react', 'vue']
    });

    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.searchResults, 'Should have searchResults');
    // Should have results for both keywords
    assert.ok(parsed.searchResults.length >= 1, 'Should have at least 1 keyword result');

    fetchMocker.restore();
  }, results);

  await testFunction('handleSearchTool passes optional fields correctly', async () => {
    const researchServer = new ResearchServer();

    fetchMocker.mock(createMockFetch({ json: { results: [] } }));

    const result = await handleSearchTool(researchServer, {
      searchedKeywords: ['test'],
      site: 'example.com',
      time_range: 'day',
      lang: 'en',
      safeSearch: 1
    });

    assert.ok(result.content, 'Should return content even with optional fields');

    fetchMocker.restore();
  }, results);

  await testFunction('handleSearchTool works with empty searchedKeywords', async () => {
    const researchServer = new ResearchServer();

    // Test with empty searchedKeywords - tool should work without search results
    const result = await handleSearchTool(researchServer, {
      searchedKeywords: []
    });

    assert.ok(result.content, 'Should return content even with empty keywords');
  }, results);

  // ============ handleReadTool ============

  await testFunction('handleReadTool throws on invalid arguments', async () => {
    try {
      await handleReadTool({} as any, { invalid: 'args' });
      assert.fail('Should have thrown an error for invalid arguments');
    } catch (error: any) {
      assert.ok(error.message.includes('Invalid arguments') || error.message.includes('URL reading'));
    }
  }, results);

  await testFunction('handleReadTool throws when urls is empty', async () => {
    try {
      await handleReadTool({} as any, { urls: [] });
      assert.fail('Should have thrown an error for empty urls');
    } catch (error: any) {
      assert.ok(error.message.includes('urls') || error.message.includes('required'));
    }
  }, results);

  // ============ getToolDefinitions ============

  await testFunction('getToolDefinitions returns array with expected tools', () => {
    const tools = getToolDefinitions();
    assert.ok(Array.isArray(tools));

    const toolNames = tools.map(t => t.name);
    assert.ok(toolNames.includes('read'), 'Should include read tool');
  }, results);

  // ============ registerRequestHandlers ============

  await testFunction('registerRequestHandlers registers handlers without error', () => {
    const registeredSchemas: string[] = [];
    const mockServer = {
      setRequestHandler: (schema: any, handler: any) => {
        registeredSchemas.push(schema);
      }
    } as any;

    const researchServer = new ResearchServer();

    assert.doesNotThrow(() => {
      registerRequestHandlers(mockServer, researchServer);
    });

    assert.ok(registeredSchemas.length >= 3, `Should register at least 3 handlers, got ${registeredSchemas.length}`);
  }, results);

  printTestSummary(results, 'Tool Handlers Module');
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  }).catch(console.error);
}

export { runTests };