export interface KeyStatus {
  key: string;
  isRateLimited: boolean;
  rateLimitExpiry?: number;
  totalCalls: number;
  error429Count: number;
}

export class KeyVault {
  private keyPools: Map<string, KeyStatus[]> = new Map();
  private defaultCooldownMs: number;

  constructor(defaultCooldownMs: number = 60000) {
    this.defaultCooldownMs = defaultCooldownMs;
  }

  public registerKeys(providerId: string, keys: string[]): void {
    const list: KeyStatus[] = keys.filter(Boolean).map((k) => ({
      key: k.trim(),
      isRateLimited: false,
      totalCalls: 0,
      error429Count: 0
    }));

    if (list.length > 0) {
      this.keyPools.set(providerId, list);
    }
  }

  public getActiveKey(providerId: string): string | undefined {
    const pool = this.keyPools.get(providerId);
    if (!pool || pool.length === 0) return undefined;

    const now = Date.now();
    // Clear expired cooldowns
    for (const item of pool) {
      if (item.isRateLimited && item.rateLimitExpiry && now >= item.rateLimitExpiry) {
        item.isRateLimited = false;
        item.rateLimitExpiry = undefined;
      }
    }

    // Find first healthy available key (or least used)
    const available = pool.filter((k) => !k.isRateLimited);
    if (available.length === 0) return undefined;

    // Return the least used healthy key
    available.sort((a, b) => a.totalCalls - b.totalCalls);
    const chosen = available[0];
    chosen.totalCalls++;
    return chosen.key;
  }

  public markKeyRateLimited(
    providerId: string,
    key: string,
    cooldownMs?: number
  ): string | undefined {
    const pool = this.keyPools.get(providerId);
    if (!pool) return undefined;

    const cooldown = cooldownMs || this.defaultCooldownMs;
    const target = pool.find((k) => k.key === key);
    if (target) {
      target.isRateLimited = true;
      target.rateLimitExpiry = Date.now() + cooldown;
      target.error429Count++;
    }

    // Try to rotate to next available key
    return this.getActiveKey(providerId);
  }

  public getStats(providerId: string): {
    totalKeys: number;
    availableKeys: number;
    rateLimitedKeys: number;
  } {
    const pool = this.keyPools.get(providerId) || [];
    const now = Date.now();
    const available = pool.filter((k) => !k.isRateLimited || (k.rateLimitExpiry && now >= k.rateLimitExpiry)).length;

    return {
      totalKeys: pool.length,
      availableKeys: available,
      rateLimitedKeys: pool.length - available
    };
  }
}
