import { EventEmitter } from 'node:events';
import type { TenantBudget, TokenCircuitConfig } from '../types.js';
import type { SQLiteLedger } from '../storage/ledger.js';

export interface BudgetCheckResult {
  allowed: boolean;
  model: string;
  isDowngraded: boolean;
  statusCode?: number;
  reason?: string;
  budget: TenantBudget;
}

export class QuotaEnforcer extends EventEmitter {
  private ledger: SQLiteLedger;
  private downgradeMappings: Map<string, string>;
  private downgradeThresholdRatio: number;

  constructor(
    ledger: SQLiteLedger,
    config?: TokenCircuitConfig['budget']
  ) {
    super();
    this.ledger = ledger;
    this.downgradeThresholdRatio = config?.downgradeThresholdRatio ?? 0.8;
    this.downgradeMappings = new Map(
      Object.entries(
        config?.downgradeMappings ?? {
          'claude-3-5-sonnet-20241022': 'claude-3-5-haiku-20241022',
          'claude-3-5-sonnet-latest': 'claude-3-5-haiku-latest',
          'anthropic.claude-3-5-sonnet-20241022-v2:0': 'anthropic.claude-3-5-haiku-20241022-v1:0',
          'gpt-4o': 'gpt-4o-mini',
          'gpt-4o-2024-08-06': 'gpt-4o-mini-2024-07-18',
          'claude-3-opus-20240229': 'claude-3-5-haiku-20241022'
        }
      )
    );
  }

  /**
   * Pre-flight check to enforce hard budget ceiling and perform model auto-downgrade.
   */
  public evaluateBudget(tenantId: string, requestedModel: string): BudgetCheckResult {
    const budget = this.ledger.getTenantBudget(tenantId);

    // Hard ceiling check (100% of daily or monthly limit)
    if (budget.status === 'EXHAUSTED') {
      const isDaily = budget.currentDailySpendUsd >= budget.dailyLimitUsd;
      const limitType = isDaily ? 'daily' : 'monthly';
      const currentSpend = isDaily ? budget.currentDailySpendUsd : budget.currentMonthlySpendUsd;
      const limit = isDaily ? budget.dailyLimitUsd : budget.monthlyLimitUsd;

      return {
        allowed: false,
        model: requestedModel,
        isDowngraded: false,
        statusCode: 402,
        reason: `Hard budget ceiling reached for tenant "${tenantId}". Current ${limitType} spend $${currentSpend.toFixed(2)} exceeds limit of $${limit.toFixed(2)}.`,
        budget
      };
    }

    // Adaptive auto-downgrade check (>= 80% of limit)
    if (budget.status === 'DOWNGRADED' && budget.autoDowngradeEnabled) {
      const downgradedModel = this.resolveDowngradedModel(requestedModel, budget.fallbackModel);
      const isDifferent = downgradedModel !== requestedModel;

      if (isDifferent) {
        this.emit('modelDowngraded', {
          tenantId,
          originalModel: requestedModel,
          downgradedModel,
          budget
        });
      }

      return {
        allowed: true,
        model: downgradedModel,
        isDowngraded: isDifferent,
        budget
      };
    }

    // Standard active state
    return {
      allowed: true,
      model: requestedModel,
      isDowngraded: false,
      budget
    };
  }

  public resolveDowngradedModel(requestedModel: string, tenantFallback?: string): string {
    if (tenantFallback) {
      return tenantFallback;
    }

    const direct = this.downgradeMappings.get(requestedModel);
    if (direct) return direct;

    const lower = requestedModel.toLowerCase();
    for (const [key, fallback] of this.downgradeMappings.entries()) {
      if (lower.includes(key.toLowerCase())) {
        return fallback;
      }
    }

    if (lower.includes('sonnet') || lower.includes('opus')) {
      return 'claude-3-5-haiku-20241022';
    }
    if (lower.includes('gpt-4o')) {
      return 'gpt-4o-mini';
    }

    return requestedModel;
  }
}
