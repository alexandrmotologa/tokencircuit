import type { NormalizedLLMRequest, NormalizedLLMResponse } from '../core/types.js';
import type { LLMProvider, ProviderExecutionError } from './base.js';
import { PayloadTranslator } from '../core/router/translator.js';

export class OpenAIProvider implements LLMProvider {
  public id = 'openai';
  public name = 'OpenAI Direct';
  private apiKey?: string;
  private endpoint: string;
  private timeoutMs: number;

  constructor(options?: { apiKey?: string; endpoint?: string; timeoutMs?: number }) {
    this.apiKey = options?.apiKey || process.env.OPENAI_API_KEY;
    this.endpoint = options?.endpoint || 'https://api.openai.com/v1/chat/completions';
    this.timeoutMs = options?.timeoutMs || 15000;
  }

  public async execute(
    request: NormalizedLLMRequest,
    modelOverride?: string
  ): Promise<NormalizedLLMResponse> {
    const payload = PayloadTranslator.toOpenAIPayload(request, modelOverride);

    if (!this.apiKey || this.apiKey.startsWith('sk-proj-...')) {
      // Mock execution if real key is not supplied
      await new Promise((r) => setTimeout(r, 60));
      return {
        id: `mock-openai-${Date.now()}`,
        model: payload.model,
        content: `[OpenAI ${payload.model}] Synthetic resilient response: Processed ${request.messages.length} messages successfully.`,
        role: 'assistant',
        usage: {
          promptTokens: 120,
          completionTokens: 35,
          totalTokens: 155
        },
        finishReason: 'stop'
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) {
        const text = await res.text();
        const err = new Error(
          `OpenAI API error (${res.status}): ${text}`
        ) as ProviderExecutionError;
        err.statusCode = res.status;
        err.providerId = this.id;
        err.isRetryable = [429, 500, 502, 503, 504].includes(res.status);
        err.rawResponse = text;
        throw err;
      }

      const data = await res.json();
      const choice = data.choices?.[0];

      return {
        id: data.id,
        model: data.model,
        content: choice?.message?.content || '',
        role: 'assistant',
        tool_calls: choice?.message?.tool_calls,
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
          cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens
        },
        finishReason: choice?.finish_reason || 'stop'
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        const err = new Error(`OpenAI request timed out after ${this.timeoutMs}ms`) as ProviderExecutionError;
        err.statusCode = 504;
        err.providerId = this.id;
        err.isRetryable = true;
        throw err;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
