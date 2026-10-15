import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QuotaEnforcer } from '../../src/core/budget/quota-enforcer.js';
import { SQLiteLedger } from '../../src/core/storage/ledger.js';

describe('QuotaEnforcer & Adaptive Model Downgrading', () => {
  let ledger: SQLiteLedger;
  let enforcer: QuotaEnforcer;

  beforeEach(() => {
    ledger = new SQLiteLedger(':memory:');
    enforcer = new QuotaEnforcer(ledger, {
      defaultDailyLimitUsd: 10.0,
      defaultMonthlyLimitUsd: 100.0,
      downgradeThresholdRatio: 0.8,
      downgradeMappings: {
        'claude-3-5-sonnet-20241022': 'claude-3-5-haiku-20241022',
        'gpt-4o': 'gpt-4o-mini'
      }
    });

    // Create test tenant with $10 limit
    ledger.setTenantBudget('tenant-acme', {
      dailyLimitUsd: 10.0,
      monthlyLimitUsd: 100.0,
      autoDowngradeEnabled: true
    });
  });

  afterEach(() => {
    ledger.close();
  });

  it('permits original model when under 80% quota', () => {
    const result = enforcer.evaluateBudget('tenant-acme', 'claude-3-5-sonnet-20241022');
    expect(result.allowed).toBe(true);
    expect(result.model).toBe('claude-3-5-sonnet-20241022');
    expect(result.isDowngraded).toBe(false);
  });

  it('automatically downgrades model when spend reaches >= 80% quota', () => {
    // Record $8.50 spend for tenant-acme (85% of $10 cap)
    ledger.recordTransaction({
      id: 'tx_seed',
      tenantId: 'tenant-acme',
      clientProtocol: 'openai',
      requestedModel: 'claude-3-5-sonnet-20241022',
      dispatchedModel: 'claude-3-5-sonnet-20241022',
      downgraded: false,
      primaryProvider: 'anthropic',
      resolvedProvider: 'anthropic',
      failoverOccurred: false,
      failoverHops: [],
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 0,
      costUsd: 8.50,
      latencyMs: 150,
      timestamp: Date.now(),
      statusCode: 200
    });

    const result = enforcer.evaluateBudget('tenant-acme', 'claude-3-5-sonnet-20241022');
    expect(result.allowed).toBe(true);
    expect(result.model).toBe('claude-3-5-haiku-20241022');
    expect(result.isDowngraded).toBe(true);
  });

  it('strictly halts traffic with HTTP 402 when spend reaches 100% quota', () => {
    // Record $10.50 spend (105% of $10 cap)
    ledger.recordTransaction({
      id: 'tx_cap',
      tenantId: 'tenant-acme',
      clientProtocol: 'openai',
      requestedModel: 'claude-3-5-sonnet-20241022',
      dispatchedModel: 'claude-3-5-sonnet-20241022',
      downgraded: false,
      primaryProvider: 'anthropic',
      resolvedProvider: 'anthropic',
      failoverOccurred: false,
      failoverHops: [],
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 0,
      costUsd: 10.50,
      latencyMs: 150,
      timestamp: Date.now(),
      statusCode: 200
    });

    const result = enforcer.evaluateBudget('tenant-acme', 'claude-3-5-sonnet-20241022');
    expect(result.allowed).toBe(false);
    expect(result.statusCode).toBe(402);
    expect(result.reason).toContain('Hard budget ceiling reached');
  });
});
