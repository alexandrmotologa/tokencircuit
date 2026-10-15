import { describe, it, expect, beforeEach } from 'vitest';
import { KeyVault } from '../../src/core/vault/key-vault.js';

describe('KeyVault (Multi-Key Provider Vault & Rotation)', () => {
  let vault: KeyVault;

  beforeEach(() => {
    vault = new KeyVault(500); // 500ms cooldown for tests
    vault.registerKeys('anthropic', ['sk-key-1', 'sk-key-2', 'sk-key-3']);
  });

  it('selects available key and balances distribution', () => {
    const key1 = vault.getActiveKey('anthropic');
    expect(key1).toBeDefined();
    expect(['sk-key-1', 'sk-key-2', 'sk-key-3']).toContain(key1);

    const stats = vault.getStats('anthropic');
    expect(stats.totalKeys).toBe(3);
    expect(stats.availableKeys).toBe(3);
  });

  it('rotates away from a rate-limited key on HTTP 429', () => {
    const key1 = vault.getActiveKey('anthropic')!;

    // Mark key1 rate-limited
    const nextKey = vault.markKeyRateLimited('anthropic', key1, 500);
    expect(nextKey).toBeDefined();
    expect(nextKey).not.toBe(key1);

    const stats = vault.getStats('anthropic');
    expect(stats.rateLimitedKeys).toBe(1);
    expect(stats.availableKeys).toBe(2);
  });

  it('re-enables key after rate-limit cooldown expires', async () => {
    const key1 = vault.getActiveKey('anthropic')!;
    vault.markKeyRateLimited('anthropic', key1, 200);

    expect(vault.getStats('anthropic').rateLimitedKeys).toBe(1);

    await new Promise((r) => setTimeout(r, 250));

    expect(vault.getStats('anthropic').rateLimitedKeys).toBe(0);
    expect(vault.getStats('anthropic').availableKeys).toBe(3);
  });
});
