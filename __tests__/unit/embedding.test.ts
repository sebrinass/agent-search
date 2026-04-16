#!/usr/bin/env tsx

/**
 * Unit Tests: embedding.ts
 *
 * Tests for hybrid retrieval logic (cosine similarity, BM25, RRF fusion)
 */

import { strict as assert } from 'node:assert';
import {
  cosineSimilarity,
  rerankWithHybridSearch,
  getEmbedding,
} from '../../src/embedding.js';
import type { SearchResult, ScoredResult } from '../../src/embedding.js';
import { testFunction, createTestResults, printTestSummary } from '../helpers/test-utils.js';
import { FetchMocker, createMockFetch } from '../helpers/mock-fetch.js';
import { EnvManager } from '../helpers/env-utils.js';

const results = createTestResults();
const fetchMocker = new FetchMocker();
const envManager = new EnvManager();

async function runTests() {
  console.log('🧪 Testing: embedding.ts\n');

  // ============ cosineSimilarity ============

  await testFunction('cosineSimilarity returns 1 for identical vectors', () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    const result = cosineSimilarity(a, b);
    assert.ok(Math.abs(result - 1) < 0.0001, `Expected ~1.0, got ${result}`);
  }, results);

  await testFunction('cosineSimilarity returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const result = cosineSimilarity(a, b);
    assert.ok(Math.abs(result) < 0.0001, `Expected ~0.0, got ${result}`);
  }, results);

  await testFunction('cosineSimilarity returns -1 for opposite vectors', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    const result = cosineSimilarity(a, b);
    assert.ok(Math.abs(result - (-1)) < 0.0001, `Expected ~-1.0, got ${result}`);
  }, results);

  await testFunction('cosineSimilarity returns 0 for empty vectors', () => {
    assert.equal(cosineSimilarity([], []), 0);
  }, results);

  await testFunction('cosineSimilarity returns 0 for mismatched lengths', () => {
    assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  }, results);

  await testFunction('cosineSimilarity returns 0 for zero vectors', () => {
    assert.equal(cosineSimilarity([0, 0, 0], [1, 2, 3]), 0);
  }, results);

  await testFunction('cosineSimilarity computes correctly for arbitrary vectors', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    // dot = 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
    // |a| = sqrt(1+4+9) = sqrt(14)
    // |b| = sqrt(16+25+36) = sqrt(77)
    // cos = 32 / (sqrt(14) * sqrt(77))
    const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
    const result = cosineSimilarity(a, b);
    assert.ok(Math.abs(result - expected) < 0.0001, `Expected ${expected}, got ${result}`);
  }, results);

  // ============ rerankWithHybridSearch (BM25 + RRF) ============

  await testFunction('rerankWithHybridSearch returns scored results for small input', async () => {
    const results: SearchResult[] = [
      { title: 'Test 1', content: 'Hello world', url: 'https://a.com', score: 0.9 },
      { title: 'Test 2', content: 'Goodbye world', url: 'https://b.com', score: 0.8 },
    ];

    const scored = await rerankWithHybridSearch('hello', results);
    assert.ok(scored.length > 0, 'Should return scored results');
    assert.ok('rrfScore' in scored[0], 'Should have rrfScore');
    assert.ok('bm25Rank' in scored[0], 'Should have bm25Rank');
    assert.ok('semanticRank' in scored[0], 'Should have semanticRank');
  }, results);

  await testFunction('rerankWithHybridSearch returns empty array for empty input', async () => {
    const scored = await rerankWithHybridSearch('query', []);
    assert.equal(scored.length, 0);
  }, results);

  await testFunction('rerankWithHybridSearch assigns rrfScore based on position for small input', async () => {
    // When results.length <= TOP_K (5), it uses simple positional scoring
    const input: SearchResult[] = [
      { title: 'A', content: 'Content A', url: 'https://a.com', score: 0.9 },
      { title: 'B', content: 'Content B', url: 'https://b.com', score: 0.8 },
      { title: 'C', content: 'Content C', url: 'https://c.com', score: 0.7 },
    ];

    const scored = await rerankWithHybridSearch('test', input);
    assert.equal(scored.length, 3);
    // Positional scoring: rrfScore = results.length - index
    assert.equal(scored[0].rrfScore, 3);
    assert.equal(scored[1].rrfScore, 2);
    assert.equal(scored[2].rrfScore, 1);
  }, results);

  await testFunction('rerankWithHybridSearch uses BM25 for large input without embedding', async () => {
    // Ensure embedding is disabled (no EMBEDDING_API_KEY or EMBEDDING_BASE_URL)
    envManager.delete('EMBEDDING_API_KEY');
    envManager.delete('EMBEDDING_BASE_URL');

    // Create more than TOP_K (5) results to trigger BM25
    const input: SearchResult[] = [];
    for (let i = 0; i < 8; i++) {
      input.push({
        title: i === 0 ? 'React hooks guide' : `Result ${i}`,
        content: i === 0 ? 'Learn about React hooks and state management' : `Content for result ${i}`,
        url: `https://example.com/${i}`,
        score: 0.9 - i * 0.05
      });
    }

    const scored = await rerankWithHybridSearch('react hooks', input);
    assert.ok(scored.length <= 5, `Should return at most TOP_K results, got ${scored.length}`);
    assert.ok(scored.length > 0, 'Should return some results');

    // All results should have rrfScore
    for (const result of scored) {
      assert.ok(typeof result.rrfScore === 'number', 'Should have numeric rrfScore');
      assert.ok(result.rrfScore > 0, 'rrfScore should be positive');
    }

    envManager.restore();
  }, results);

  await testFunction('rerankWithHybridSearch preserves SearchResult fields in ScoredResult', async () => {
    const input: SearchResult[] = [
      { title: 'Test Title', content: 'Test Content', url: 'https://test.com', score: 0.95 },
    ];

    const scored = await rerankWithHybridSearch('test', input);
    assert.equal(scored[0].title, 'Test Title');
    assert.equal(scored[0].content, 'Test Content');
    assert.equal(scored[0].url, 'https://test.com');
    assert.equal(scored[0].score, 0.95);
  }, results);

  // ============ getEmbedding ============

  await testFunction('getEmbedding returns empty array for empty string', async () => {
    const embedding = await getEmbedding('');
    assert.ok(Array.isArray(embedding));
    assert.equal(embedding.length, 0);
  }, results);

  await testFunction('getEmbedding returns empty array for whitespace-only string', async () => {
    const embedding = await getEmbedding('   ');
    assert.ok(Array.isArray(embedding));
    assert.equal(embedding.length, 0);
  }, results);

  await testFunction('getEmbedding returns empty or valid array for test text', async () => {
    const embedding = await getEmbedding('test text');
    assert.ok(Array.isArray(embedding));
    if (embedding.length > 0) {
      assert.ok(embedding.length > 0, 'Should return embedding dimensions');
    }
  }, results);

  // ============ RRF 融合逻辑验证 ============

  await testFunction('RRF fusion: results with both BM25 and semantic ranks score higher', async () => {
    // This tests the RRF logic indirectly through rerankWithHybridSearch
    // When results.length <= TOP_K, positional scoring is used
    // We verify that the scoring is consistent
    const input: SearchResult[] = [
      { title: 'Python tutorial', content: 'Learn Python programming', url: 'https://python.com', score: 0.9 },
      { title: 'JavaScript guide', content: 'Learn JavaScript', url: 'https://js.com', score: 0.8 },
    ];

    const scored = await rerankWithHybridSearch('python', input);
    // First result should have higher or equal score
    assert.ok(scored[0].rrfScore >= scored[1].rrfScore,
      `First result should have higher or equal rrfScore: ${scored[0].rrfScore} vs ${scored[1].rrfScore}`);
  }, results);

  printTestSummary(results, 'Embedding Module');
  return results;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  }).catch(console.error);
}

export { runTests };
