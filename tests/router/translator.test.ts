import { describe, it, expect } from 'vitest';
import { PayloadTranslator } from '../../src/core/router/translator.js';

describe('PayloadTranslator (Bidirectional Cross-Provider Translation)', () => {
  it('converts OpenAI request envelope to Anthropic payload', () => {
    const openAIRequest = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a resilient coding assistant.' },
        { role: 'user', content: 'Explain circuit breaking.' }
      ],
      temperature: 0.7,
      max_tokens: 1024
    };

    const normalized = PayloadTranslator.fromOpenAIRequest(openAIRequest);
    expect(normalized.model).toBe('gpt-4o');
    expect(normalized.messages.length).toBe(2);

    const anthropicPayload = PayloadTranslator.toAnthropicPayload(
      normalized,
      'claude-3-5-sonnet-20241022'
    );

    expect(anthropicPayload.model).toBe('claude-3-5-sonnet-20241022');
    expect(anthropicPayload.system).toBe('You are a resilient coding assistant.');
    expect(anthropicPayload.messages).toEqual([
      { role: 'user', content: 'Explain circuit breaking.' }
    ]);
    expect(anthropicPayload.max_tokens).toBe(1024);
  });

  it('converts Anthropic request envelope to OpenAI payload', () => {
    const anthropicRequest = {
      model: 'claude-3-5-sonnet-20241022',
      system: 'Strict JSON responses only.',
      messages: [
        { role: 'user', content: 'Provide server metrics.' }
      ],
      max_tokens: 500
    };

    const normalized = PayloadTranslator.fromAnthropicRequest(anthropicRequest);
    expect(normalized.messages.length).toBe(2);
    expect(normalized.messages[0].role).toBe('system');
    expect(normalized.messages[0].content).toBe('Strict JSON responses only.');

    const openAIPayload = PayloadTranslator.toOpenAIPayload(normalized, 'gpt-4o');
    expect(openAIPayload.model).toBe('gpt-4o');
    expect(openAIPayload.messages[0]).toEqual({
      role: 'system',
      content: 'Strict JSON responses only.'
    });
    expect(openAIPayload.messages[1]).toEqual({
      role: 'user',
      content: 'Provide server metrics.'
    });
  });

  it('translates normalized responses accurately for both clients', () => {
    const mockInternalResponse = {
      id: 'res_123',
      model: 'claude-3-5-sonnet-20241022',
      content: 'Circuit breaker is closed and operational.',
      role: 'assistant' as const,
      usage: {
        promptTokens: 25,
        completionTokens: 8,
        totalTokens: 33
      },
      finishReason: 'stop' as const
    };

    const openAIResp = PayloadTranslator.toOpenAIResponse(mockInternalResponse, 'gpt-4o');
    expect(openAIResp.choices[0].message.content).toBe('Circuit breaker is closed and operational.');
    expect(openAIResp.usage.total_tokens).toBe(33);

    const anthropicResp = PayloadTranslator.toAnthropicResponse(
      mockInternalResponse,
      'claude-3-5-sonnet'
    );
    expect(anthropicResp.content[0].text).toBe('Circuit breaker is closed and operational.');
    expect(anthropicResp.usage.input_tokens).toBe(25);
  });
});
