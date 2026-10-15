export interface TenantRateLimitConfig {
  maxRpm: number;
  maxTpm: number;
}

interface RequestRecord {
  timestamp: number;
  tokens: number;
}

export class TenantRateLimiter {
  private defaultLimits: TenantRateLimitConfig;
  private customLimits: Map<string, TenantRateLimitConfig> = new Map();
  private requestHistory: Map<string, RequestRecord[]> = new Map();

  constructor(defaultLimits: TenantRateLimitConfig = { maxRpm: 60, maxTpm: 150000 }) {
    this.defaultLimits = defaultLimits;
  }

  public setTenantLimits(tenantId: string, limits: Partial<TenantRateLimitConfig>): void {
    const existing = this.getLimits(tenantId);
    this.customLimits.set(tenantId, {
      maxRpm: limits.maxRpm ?? existing.maxRpm,
      maxTpm: limits.maxTpm ?? existing.maxTpm
    });
  }

  public getLimits(tenantId: string): TenantRateLimitConfig {
    return this.customLimits.get(tenantId) || { ...this.defaultLimits };
  }

  private cleanOldRecords(tenantId: string): void {
    const records = this.requestHistory.get(tenantId);
    if (!records) return;

    const oneMinuteAgo = Date.now() - 60000;
    const active = records.filter((r) => r.timestamp >= oneMinuteAgo);
    this.requestHistory.set(tenantId, active);
  }

  public checkLimit(
    tenantId: string,
    estimatedTokens: number = 250
  ): {
    allowed: boolean;
    remainingRpm: number;
    remainingTpm: number;
    retryAfterSeconds?: number;
    reason?: string;
  } {
    this.cleanOldRecords(tenantId);
    const limits = this.getLimits(tenantId);
    const records = this.requestHistory.get(tenantId) || [];

    const currentRpm = records.length;
    const currentTpm = records.reduce((sum, r) => sum + r.tokens, 0);

    if (currentRpm >= limits.maxRpm) {
      const oldestRecord = records[0];
      const waitMs = oldestRecord ? Math.max(1000, 60000 - (Date.now() - oldestRecord.timestamp)) : 60000;
      const retryAfterSeconds = Math.ceil(waitMs / 1000);

      return {
        allowed: false,
        remainingRpm: 0,
        remainingTpm: Math.max(0, limits.maxTpm - currentTpm),
        retryAfterSeconds,
        reason: `RPM limit exceeded for tenant "${tenantId}". Allowed: ${limits.maxRpm} RPM, Current: ${currentRpm} RPM.`
      };
    }

    if (currentTpm + estimatedTokens > limits.maxTpm) {
      const oldestRecord = records[0];
      const waitMs = oldestRecord ? Math.max(1000, 60000 - (Date.now() - oldestRecord.timestamp)) : 60000;
      const retryAfterSeconds = Math.ceil(waitMs / 1000);

      return {
        allowed: false,
        remainingRpm: Math.max(0, limits.maxRpm - currentRpm),
        remainingTpm: 0,
        retryAfterSeconds,
        reason: `TPM limit exceeded for tenant "${tenantId}". Allowed: ${limits.maxTpm} TPM, Current: ${currentTpm} TPM.`
      };
    }

    return {
      allowed: true,
      remainingRpm: limits.maxRpm - currentRpm - 1,
      remainingTpm: limits.maxTpm - currentTpm - estimatedTokens
    };
  }

  public recordUsage(tenantId: string, tokens: number): void {
    this.cleanOldRecords(tenantId);
    let records = this.requestHistory.get(tenantId);
    if (!records) {
      records = [];
      this.requestHistory.set(tenantId, records);
    }

    records.push({
      timestamp: Date.now(),
      tokens: Math.max(1, tokens)
    });
  }

  public getTenantUsage(tenantId: string): {
    currentRpm: number;
    currentTpm: number;
    maxRpm: number;
    maxTpm: number;
  } {
    this.cleanOldRecords(tenantId);
    const limits = this.getLimits(tenantId);
    const records = this.requestHistory.get(tenantId) || [];

    const currentRpm = records.length;
    const currentTpm = records.reduce((sum, r) => sum + r.tokens, 0);

    return {
      currentRpm,
      currentTpm,
      maxRpm: limits.maxRpm,
      maxTpm: limits.maxTpm
    };
  }

  public reset(tenantId?: string): void {
    if (tenantId) {
      this.requestHistory.delete(tenantId);
    } else {
      this.requestHistory.clear();
    }
  }
}
