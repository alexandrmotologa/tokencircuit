import { describe, it, expect } from 'vitest';
import { CostCalculator, globalCostCalculator } from '../../src/core/budget/cost-calculator.js';

describe('CostCalculator & Pricing Catalog', () => {
  it('correctly matches models and calculates token costs', () => {
    // Claude 3.5 Sonnet: $3.00/M input, $15.00/M output
    const usage = {
      promptTokens: 10_000,
      completionTokens: 2_000,
      totalTokens: 12_000
    };

    // Input: (10,000 / 1,000,000) * 3 = $0.03
    // Output: (2,000 / 1,000,000) * 15 = $0.03
    // Total = $0.060000
    const cost = globalCostCalculator.calculateCostUsd('claude-3-5-sonnet-20241022', usage);
    expect(cost).toBe(0.06);
  });

  it('accurately accounts for prompt caching discount (90% off)', () => {
    const usage = {
      promptTokens: 100_000,
      completionTokens: 5_000,
      totalTokens: 105_000,
      cachedTokens: 80_000
    };

    // Standard input: 20,000 * $3 / 1M = $0.06
    // Cached input: 80,000 * $0.30 / 1M = $0.024
    // Output: 5,000 * $15 / 1M = $0.075
    // Total = $0.159
    const cost = globalCostCalculator.calculateCostUsd('claude-3-5-sonnet-20241022', usage);
    expect(cost).toBe(0.159);
  });

  it('calculates dollar savings between original and downgraded model', () => {
    const usage = {
      promptTokens: 50_000,
      completionTokens: 10_000,
      totalTokens: 60_000
    };

    // Sonnet cost: (50k * 3 + 10k * 15) / 1M = (0.15 + 0.15) = $0.30
    // Haiku cost: (50k * 0.8 + 10k * 4) / 1M = (0.04 + 0.04) = $0.08
    // Savings = $0.22
    const savings = globalCostCalculator.calculateSavingsUsd(
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      usage
    );
    expect(savings).toBe(0.22);
  });

  it('formats microdollar amounts cleanly', () => {
    expect(CostCalculator.formatUsd(0.000456)).toBe('$0.000456');
    expect(CostCalculator.formatUsd(12.5)).toBe('$12.5000');
  });
});
