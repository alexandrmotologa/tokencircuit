import type { NormalizedLLMRequest, NormalizedLLMResponse } from '../core/types.js';
import type { LLMProvider, ProviderExecutionError } from './base.js';
import { PayloadTranslator } from '../core/router/translator.js';
import type { KeyVault } from '../core/vault/key-vault.js';

export class OpenAIProvider implements LLMProvider {
  public id = 'openai';
  public name = 'OpenAI Direct';
  private apiKey?: string;
  private endpoint: string;
  private timeoutMs: number;
  private keyVault?: KeyVault;

  constructor(options?: { apiKey?: string; endpoint?: string; timeoutMs?: number; keyVault?: KeyVault }) {
    this.apiKey = options?.apiKey || process.env.OPENAI_API_KEY;
    this.endpoint = options?.endpoint || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
    this.timeoutMs = options?.timeoutMs || 15000;
    this.keyVault = options?.keyVault;
  }

  public async execute(
    request: NormalizedLLMRequest,
    modelOverride?: string
  ): Promise<NormalizedLLMResponse> {
    const payload = PayloadTranslator.toOpenAIPayload(request, modelOverride);
    const activeKey = this.keyVault?.getActiveKey(this.id) || this.apiKey;

    if (!activeKey) {
      const err = new Error(
        `OpenAI API key missing or unconfigured. Provide a valid OPENAI_API_KEY environment variable or KeyVault entry.`
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
          Authorization: `Bearer ${activeKey}`
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

  public async executeStream(
    request: NormalizedLLMRequest,
    modelOverride?: string,
    onChunk?: (delta: string) => void
  ): Promise<NormalizedLLMResponse> {
    const payload = {
      ...PayloadTranslator.toOpenAIPayload(request, modelOverride),
      stream: true
    };
    const activeKey = this.keyVault?.getActiveKey(this.id) || this.apiKey;

    if (!activeKey) {
      const err = new Error(
        `OpenAI API key missing or unconfigured for streaming. Provide OPENAI_API_KEY.`
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
          Authorization: `Bearer ${activeKey}`
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
          `OpenAI Streaming error (${res.status}): ${text}`
        ) as ProviderExecutionError;
        err.statusCode = res.status;
        err.providerId = this.id;
        err.isRetryable = [429, 500, 502, 503, 504].includes(res.status);
        err.rawResponse = text;
        throw err;
      }

      if (!res.body) {
        throw new Error('OpenAI returned empty response body for streaming');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';
      let completionTokens = 0;
      let modelUsed = payload.model;
      let responseId = `chatcmpl_${Date.now()}`;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') continue;

          if (trimmed.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              if (parsed.id) responseId = parsed.id;
              if (parsed.model) modelUsed = parsed.model;
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                accumulatedContent += delta;
                completionTokens++;
                if (onChunk) onChunk(delta);
              }
            } catch {
              // Non-JSON SSE line, continue
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
        const err = new Error(`OpenAI streaming request timed out after ${this.timeoutMs}ms`) as ProviderExecutionError;
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
