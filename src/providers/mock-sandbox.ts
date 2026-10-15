import type { NormalizedLLMRequest, NormalizedLLMResponse } from '../core/types.js';
import type { LLMProvider, ProviderExecutionError } from './base.js';

export interface ChaosRule {
  statusCode: number;
  errorMessage: string;
  remainingCalls: number;
}

export class MockSandboxProvider implements LLMProvider {
  public id: string;
  public name: string;
  private chaosRules: Map<string, ChaosRule> = new Map();
  private artificialLatencyMs: number = 20;

  constructor(id: string = 'mock-sandbox', name: string = 'Sandbox Provider') {
    this.id = id;
    this.name = name;
  }

  public injectError(statusCode: number, errorMessage: string, count: number = 1): void {
    this.chaosRules.set(this.id, {
      statusCode,
      errorMessage,
      remainingCalls: count
    });
  }

  public setLatency(ms: number): void {
    this.artificialLatencyMs = ms;
  }

  public clearChaos(): void {
    this.chaosRules.clear();
  }

  public async execute(
    request: NormalizedLLMRequest,
    modelOverride?: string
  ): Promise<NormalizedLLMResponse> {
    if (this.artificialLatencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.artificialLatencyMs));
    }

    const rule = this.chaosRules.get(this.id);
    if (rule && rule.remainingCalls > 0) {
      rule.remainingCalls -= 1;
      if (rule.remainingCalls <= 0) {
        this.chaosRules.delete(this.id);
      }

      const err = new Error(
        `Chaos simulated error from ${this.name}: ${rule.errorMessage} (HTTP ${rule.statusCode})`
      ) as ProviderExecutionError;
      err.statusCode = rule.statusCode;
      err.providerId = this.id;
      err.isRetryable = [429, 500, 502, 503, 504].includes(rule.statusCode);
      throw err;
    }

    const model = modelOverride || request.model || 'sandbox-model';
    const isDowngraded = model.includes('haiku') || model.includes('mini');

    return {
      id: `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      model,
      content: `[${this.name} | ${model}] Request completed successfully with ${request.messages.length} message turns.${isDowngraded ? ' (Economical Downgraded Tier)' : ''}`,
      role: 'assistant',
      usage: {
        promptTokens: 140,
        completionTokens: 45,
        totalTokens: 185
      },
      finishReason: 'stop'
    };
  }
}
