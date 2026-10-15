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
    this.endpoint = options?.endpoint || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1/messages';
    this.timeoutMs = options?.timeoutMs || 15000;
    this.keyVault = options?.keyVault;
  }

  public async execute(
    request: NormalizedLLMRequest,
    modelOverride?: string
  ): Promise<NormalizedLLMResponse> {
    const payload = PayloadTranslator.toAnthropicPayload(request, modelOverride);
    const activeKey = this.keyVault?.getActiveKey(this.id) || this.apiKey;

    if (!activeKey) {
      const err = new Error(
        `Anthropic API key missing or unconfigured. Provide a valid ANTHROPIC_API_KEY environment variable or KeyVault entry.`
      ) as ProviderExecutionError;
      err.statusCode = 401;
      err.providerId = this.id;
      err.isRetryable = false;
      throw err;
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
      const textBlock = data.content?.find((c: any) => c.type === 'text');

      return {
        id: data.id,
        model: data.model,
        content: textBlock?.text || '',
        role: 'assistant',
        usage: {
          promptTokens: data.usage?.input_tokens || 0,
          completionTokens: data.usage?.output_tokens || 0,
          totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
        },
        finishReason: data.stop_reason === 'max_tokens' ? 'length' : data.stop_reason === 'tool_use' ? 'tool_calls' : 'stop'
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

  public async executeStream(
    request: NormalizedLLMRequest,
    modelOverride?: string,
    onChunk?: (delta: string) => void
  ): Promise<NormalizedLLMResponse> {
    const payload = {
      ...PayloadTranslator.toAnthropicPayload(request, modelOverride),
      stream: true
    };
    const activeKey = this.keyVault?.getActiveKey(this.id) || this.apiKey;

    if (!activeKey) {
      const err = new Error(
        `Anthropic API key missing or unconfigured for streaming. Provide ANTHROPIC_API_KEY.`
      ) as ProviderExecutionError;
      err.statusCode = 401;
      err.providerId = this.id;
      err.isRetryable = false;
      throw err;
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
          `Anthropic Streaming error (${res.status}): ${text}`
        ) as ProviderExecutionError;
        err.statusCode = res.status;
        err.providerId = this.id;
        err.isRetryable = [429, 500, 502, 503, 504].includes(res.status);
        err.rawResponse = text;
        throw err;
      }

      if (!res.body) {
        throw new Error('Anthropic returned empty response body for streaming');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';
      let completionTokens = 0;
      let modelUsed = payload.model;
      let responseId = `msg_${Date.now()}`;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              if (parsed.message?.id) responseId = parsed.message.id;
              if (parsed.message?.model) modelUsed = parsed.message.model;

              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                accumulatedContent += parsed.delta.text;
                completionTokens++;
                if (onChunk) onChunk(parsed.delta.text);
              }
            } catch {
              // Non-JSON SSE line
            }
          }
        }
      }

      return {
        id: responseId,
        model: modelUsed,
        content: accumulatedContent,
        role: 'assistant',
        usage: {
          promptTokens: Math.ceil(request.messages.reduce((acc, m) => acc + m.content.length, 0) / 4),
          completionTokens,
          totalTokens: Math.ceil(request.messages.reduce((acc, m) => acc + m.content.length, 0) / 4) + completionTokens
        },
        finishReason: 'stop'
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        const err = new Error(`Anthropic streaming request timed out after ${this.timeoutMs}ms`) as ProviderExecutionError;
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
