import { describe, it, expect, beforeEach } from 'vitest';
import { TenantRateLimiter } from '../../src/core/ratelimit/tenant-rate-limiter.js';

describe('TenantRateLimiter (Token Bucket Rate Limiting)', () => {
  let limiter: TenantRateLimiter;

  beforeEach(() => {
    limiter = new TenantRateLimiter({ maxRpm: 3, maxTpm: 500 });
  });

  it('permits requests within RPM limits', () => {
    const res1 = limiter.checkLimit('tenant_a', 50);
    expect(res1.allowed).toBe(true);
    limiter.recordUsage('tenant_a', 50);

    const res2 = limiter.checkLimit('tenant_a', 50);
    expect(res2.allowed).toBe(true);
    limiter.recordUsage('tenant_a', 50);

    const res3 = limiter.checkLimit('tenant_a', 50);
    expect(res3.allowed).toBe(true);
    limiter.recordUsage('tenant_a', 50);

    // 4th request exceeds maxRpm of 3
    const res4 = limiter.checkLimit('tenant_a', 50);
    expect(res4.allowed).toBe(false);
    expect(res4.retryAfterSeconds).toBeGreaterThan(0);
    expect(res4.reason).toContain('RPM limit exceeded');
  });

  it('rejects requests when TPM token ceiling is breached', () => {
    const res1 = limiter.checkLimit('tenant_b', 300);
    expect(res1.allowed).toBe(true);
    limiter.recordUsage('tenant_b', 300);

    // 2nd request with 300 tokens exceeds 500 TPM
    const res2 = limiter.checkLimit('tenant_b', 300);
    expect(res2.allowed).toBe(false);
    expect(res2.reason).toContain('TPM limit exceeded');
  });

  it('supports per-tenant custom limit overrides', () => {
    limiter.setTenantLimits('vip_tenant', { maxRpm: 500, maxTpm: 1_000_000 });

    const limits = limiter.getLimits('vip_tenant');
    expect(limits.maxRpm).toBe(500);
    expect(limits.maxTpm).toBe(1_000_000);
  });
});
