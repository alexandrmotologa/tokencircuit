import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PromptCache } from '../../src/core/cache/prompt-cache.js';
import { SQLiteLedger } from '../../src/core/storage/ledger.js';
import type { ChatMessage, NormalizedLLMResponse } from '../../src/core/types.js';

describe('PromptCache (Exact Prompt & Token Caching)', () => {
  let ledger: SQLiteLedger;
  let cache: PromptCache;

  beforeEach(() => {
    ledger = new SQLiteLedger(':memory:');
    cache = new PromptCache(ledger.getRawDb(), 3600);
  });

  afterEach(() => {
    ledger.close();
  });

  const sampleMessages: ChatMessage[] = [
    { role: 'user', content: 'What is high-availability circuit breaking?' }
  ];

  const sampleResponse: NormalizedLLMResponse = {
    id: 'res_sample_1',
    model: 'claude-3-5-sonnet-20241022',
    content: 'Circuit breaking prevents cascading failures.',
    role: 'assistant',
    usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
    finishReason: 'stop'
  };

  it('returns null on cache miss', () => {
    const result = cache.get('claude-3-5-sonnet-20241022', sampleMessages);
    expect(result).toBeNull();
    expect(cache.getStats().missCount).toBe(1);
  });

  it('stores and retrieves cached response with zero dollar cost', () => {
    cache.set('claude-3-5-sonnet-20241022', sampleMessages, sampleResponse, 0.0054);

    const hit = cache.get('claude-3-5-sonnet-20241022', sampleMessages);
    expect(hit).not.toBeNull();
    expect(hit?.response.content).toBe('Circuit breaking prevents cascading failures.');
    expect(hit?.costSavedUsd).toBe(0.0054);

    const stats = cache.getStats();
    expect(stats.hitCount).toBe(1);
    expect(stats.totalCostSavedUsd).toBe(0.0054);
    expect(stats.totalEntries).toBe(1);
  });

  it('prunes expired entries and handles TTL', async () => {
    // 1-second TTL
    cache.set('claude-3-5-sonnet-20241022', sampleMessages, sampleResponse, 0.002, undefined, 1);

    await new Promise((r) => setTimeout(r, 1100));

    const pruned = cache.pruneExpired();
    expect(pruned).toBe(1);

    const result = cache.get('claude-3-5-sonnet-20241022', sampleMessages);
    expect(result).toBeNull();
  });

  it('clears all cache entries on demand', () => {
    cache.set('claude-3-5-sonnet-20241022', sampleMessages, sampleResponse, 0.002);
    expect(cache.getStats().totalEntries).toBe(1);

    cache.clear();
    expect(cache.getStats().totalEntries).toBe(0);
  });
});
