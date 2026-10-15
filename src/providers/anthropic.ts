import type { NormalizedLLMRequest, NormalizedLLMResponse } from '../core/types.js';
import type { LLMProvider, ProviderExecutionError } from './base.js';
import { PayloadTranslator } from '../core/router/translator.js';
import type { KeyVault } from '../core/vault/key-vault.js';

export class AnthropicProvider implements LLMProvider {
  public id = 'anthropic';
  public name = 'Anthropic Direct';
  private apiKey?: string;
  private endpoint: string;
  private timeoutMs: number;
  private keyVault?: KeyVault;

  constructor(options?: { apiKey?: string; endpoint?: string; timeoutMs?: number; keyVault?: KeyVault }) {
    this.apiKey = options?.apiKey || process.env.ANTHROPIC_API_KEY;
    this.endpoint = options?.endpoint || 'https://api.anthropic.com/v1/messages';
    this.timeoutMs = options?.timeoutMs || 15000;
    this.keyVault = options?.keyVault;
  }

  public async execute(
    request: NormalizedLLMRequest,
    modelOverride?: string
  ): Promise<NormalizedLLMResponse> {
    const payload = PayloadTranslator.toAnthropicPayload(request, modelOverride);

    const activeKey = this.keyVault?.getActiveKey(this.id) || this.apiKey;

    if (!activeKey || activeKey.startsWith('sk-ant-api03-...')) {
      // Mock execution if real key is not supplied
      await new Promise((r) => setTimeout(r, 60));
      return {
        id: `mock-anthropic-${Date.now()}`,
        model: payload.model,
        content: `[Anthropic ${payload.model}] Synthetic resilient response: Processed ${request.messages.length} messages successfully.`,
        role: 'assistant',
        usage: {
          promptTokens: 110,
          completionTokens: 42,
          totalTokens: 152
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
          'x-api-key': activeKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) {
        const text = await res.text();
        if (res.status === 429 && this.keyVault) {
          this.keyVault.markKeyRateLimited(this.id, activeKey);
        }
        const err = new Error(
          `Anthropic API error (${res.status}): ${text}`
        ) as ProviderExecutionError;
        err.statusCode = res.status;
        err.providerId = this.id;
        err.isRetryable = [429, 500, 502, 503, 504].includes(res.status);
        err.rawResponse = text;
        throw err;
      }

      const data = await res.json();
      let textContent = '';
      const toolCalls: any[] = [];

      for (const block of data.content || []) {
        if (block.type === 'text') {
          textContent += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {})
            }
          });
        }
      }

      let finishReason: NormalizedLLMResponse['finishReason'] = 'stop';
      if (data.stop_reason === 'tool_use') finishReason = 'tool_calls';
      else if (data.stop_reason === 'max_tokens') finishReason = 'length';

      return {
        id: data.id,
        model: data.model,
        content: textContent,
        role: 'assistant',
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          promptTokens: data.usage?.input_tokens || 0,
          completionTokens: data.usage?.output_tokens || 0,
          totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
          cachedTokens: data.usage?.cache_read_input_tokens
        },
        finishReason
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        const err = new Error(`Anthropic request timed out after ${this.timeoutMs}ms`) as ProviderExecutionError;
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
