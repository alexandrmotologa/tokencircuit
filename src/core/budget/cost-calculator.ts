import type { ModelPricing, TokenUsage } from '../types.js';

/**
 * Standard token-to-USD pricing catalog per 1,000,000 tokens.
 */
export const MODEL_PRICING_TABLE: Record<string, ModelPricing> = {
  // Anthropic Models
  'claude-3-5-sonnet-20241022': {
    modelId: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    inputPerMillionUsd: 3.00,
    outputPerMillionUsd: 15.00,
    cacheReadPerMillionUsd: 0.30
  },
  'claude-3-5-sonnet-latest': {
    modelId: 'claude-3-5-sonnet-latest',
    provider: 'anthropic',
    inputPerMillionUsd: 3.00,
    outputPerMillionUsd: 15.00,
    cacheReadPerMillionUsd: 0.30
  },
  'claude-3-5-haiku-20241022': {
    modelId: 'claude-3-5-haiku-20241022',
    provider: 'anthropic',
    inputPerMillionUsd: 0.80,
    outputPerMillionUsd: 4.00,
    cacheReadPerMillionUsd: 0.08
  },
  'claude-3-5-haiku-latest': {
    modelId: 'claude-3-5-haiku-latest',
    provider: 'anthropic',
    inputPerMillionUsd: 0.80,
    outputPerMillionUsd: 4.00,
    cacheReadPerMillionUsd: 0.08
  },
  'claude-3-opus-20240229': {
    modelId: 'claude-3-opus-20240229',
    provider: 'anthropic',
    inputPerMillionUsd: 15.00,
    outputPerMillionUsd: 75.00,
    cacheReadPerMillionUsd: 1.50
  },

  // AWS Bedrock Models
  'anthropic.claude-3-5-sonnet-20241022-v2:0': {
    modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    provider: 'bedrock',
    inputPerMillionUsd: 3.00,
    outputPerMillionUsd: 15.00,
    cacheReadPerMillionUsd: 0.30
  },
  'anthropic.claude-3-5-haiku-20241022-v1:0': {
    modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    provider: 'bedrock',
    inputPerMillionUsd: 0.80,
    outputPerMillionUsd: 4.00,
    cacheReadPerMillionUsd: 0.08
  },
  'meta.llama3-3-70b-instruct-v1:0': {
    modelId: 'meta.llama3-3-70b-instruct-v1:0',
    provider: 'bedrock',
    inputPerMillionUsd: 0.72,
    outputPerMillionUsd: 0.72
  },

  // OpenAI Models
  'gpt-4o': {
    modelId: 'gpt-4o',
    provider: 'openai',
    inputPerMillionUsd: 2.50,
    outputPerMillionUsd: 10.00,
    cacheReadPerMillionUsd: 1.25
  },
  'gpt-4o-2024-08-06': {
    modelId: 'gpt-4o-2024-08-06',
    provider: 'openai',
    inputPerMillionUsd: 2.50,
    outputPerMillionUsd: 10.00,
    cacheReadPerMillionUsd: 1.25
  },
  'gpt-4o-mini': {
    modelId: 'gpt-4o-mini',
    provider: 'openai',
    inputPerMillionUsd: 0.15,
    outputPerMillionUsd: 0.60,
    cacheReadPerMillionUsd: 0.075
  },
  'gpt-4o-mini-2024-07-18': {
    modelId: 'gpt-4o-mini-2024-07-18',
    provider: 'openai',
    inputPerMillionUsd: 0.15,
    outputPerMillionUsd: 0.60,
    cacheReadPerMillionUsd: 0.075
  },
  'o1': {
    modelId: 'o1',
    provider: 'openai',
    inputPerMillionUsd: 15.00,
    outputPerMillionUsd: 60.00,
    cacheReadPerMillionUsd: 7.50
  },
  'o3-mini': {
    modelId: 'o3-mini',
    provider: 'openai',
    inputPerMillionUsd: 1.10,
    outputPerMillionUsd: 4.40,
    cacheReadPerMillionUsd: 0.55
  }
};

const DEFAULT_PRICING: ModelPricing = {
  modelId: 'default',
  provider: 'unknown',
  inputPerMillionUsd: 2.00,
  outputPerMillionUsd: 8.00,
  cacheReadPerMillionUsd: 0.50
};

export class CostCalculator {
  private pricingTable: Map<string, ModelPricing>;

  constructor(customPricing?: Record<string, ModelPricing>) {
    this.pricingTable = new Map(Object.entries(MODEL_PRICING_TABLE));
    if (customPricing) {
      for (const [key, val] of Object.entries(customPricing)) {
        this.pricingTable.set(key, val);
      }
    }
  }

  public getModelPricing(model: string): ModelPricing {
    const direct = this.pricingTable.get(model);
    if (direct) return direct;

    // Fuzzy matching for versioned model names
    const normalized = model.toLowerCase();
    for (const [key, val] of this.pricingTable.entries()) {
      if (normalized.includes(key.toLowerCase()) || key.toLowerCase().includes(normalized)) {
        return val;
      }
    }

    if (normalized.includes('haiku')) return MODEL_PRICING_TABLE['claude-3-5-haiku-20241022'];
    if (normalized.includes('sonnet')) return MODEL_PRICING_TABLE['claude-3-5-sonnet-20241022'];
    if (normalized.includes('opus')) return MODEL_PRICING_TABLE['claude-3-opus-20240229'];
    if (normalized.includes('mini')) return MODEL_PRICING_TABLE['gpt-4o-mini'];
    if (normalized.includes('gpt-4o')) return MODEL_PRICING_TABLE['gpt-4o'];

    return DEFAULT_PRICING;
  }

  /**
   * Calculates total USD cost for a request with 6-decimal microdollar precision.
   */
  public calculateCostUsd(model: string, usage: TokenUsage): number {
    const pricing = this.getModelPricing(model);
    const cachedTokens = usage.cachedTokens ?? 0;
    const standardInputTokens = Math.max(0, usage.promptTokens - cachedTokens);

    const inputCost = (standardInputTokens / 1_000_000) * pricing.inputPerMillionUsd;
    const cacheCost = (cachedTokens / 1_000_000) * (pricing.cacheReadPerMillionUsd ?? pricing.inputPerMillionUsd * 0.1);
    const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputPerMillionUsd;

    const total = inputCost + cacheCost + outputCost;
    return Number(total.toFixed(6));
  }

  /**
   * Calculates dollar savings achieved when downgrading a model.
   */
  public calculateSavingsUsd(originalModel: string, downgradedModel: string, usage: TokenUsage): number {
    const originalCost = this.calculateCostUsd(originalModel, usage);
    const downgradedCost = this.calculateCostUsd(downgradedModel, usage);
    return Math.max(0, Number((originalCost - downgradedCost).toFixed(6)));
  }

  public static formatUsd(amount: number): string {
    if (amount < 0.01 && amount > 0) {
      return `$${amount.toFixed(6)}`;
    }
    return `$${amount.toFixed(4)}`;
  }
}

export const globalCostCalculator = new CostCalculator();
