import type {
  ChatMessage,
  NormalizedLLMRequest,
  NormalizedLLMResponse,
  ToolCall,
  ToolDefinition
} from '../types.js';

export class PayloadTranslator {
  /**
   * Normalizes an incoming OpenAI Chat Completions payload into internal format.
   */
  public static fromOpenAIRequest(
    body: any,
    tenantId: string = 'default'
  ): NormalizedLLMRequest {
    const messages: ChatMessage[] = (body.messages || []).map((m: any) => {
      let role: ChatMessage['role'] = m.role;
      if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') {
        // Valid
      } else {
        role = 'user';
      }

      return {
        role,
        content: m.content || '',
        name: m.name,
        tool_call_id: m.tool_call_id,
        tool_calls: m.tool_calls
      };
    });

    const tools: ToolDefinition[] | undefined = body.tools
      ? body.tools.map((t: any) => ({
          type: 'function',
          function: {
            name: t.function?.name || t.name,
            description: t.function?.description || t.description,
            parameters: t.function?.parameters || t.input_schema || {}
          }
        }))
      : undefined;

    return {
      model: body.model || 'gpt-4o',
      messages,
      temperature: body.temperature,
      max_tokens: body.max_tokens || body.max_completion_tokens || 4096,
      stream: Boolean(body.stream),
      tools,
      tool_choice: body.tool_choice,
      tenantId,
      traceId: body.trace_id || body.traceId
    };
  }

  /**
   * Normalizes an incoming Anthropic Messages payload into internal format.
   */
  public static fromAnthropicRequest(
    body: any,
    tenantId: string = 'default'
  ): NormalizedLLMRequest {
    const messages: ChatMessage[] = [];

    // Anthropic separates system prompt
    let systemPrompt: string | undefined;
    if (typeof body.system === 'string') {
      systemPrompt = body.system;
      messages.push({
        role: 'system',
        content: body.system
      });
    } else if (Array.isArray(body.system)) {
      systemPrompt = body.system.map((s: any) => s.text || '').join('\n');
      messages.push({
        role: 'system',
        content: systemPrompt || ''
      });
    }

    for (const m of body.messages || []) {
      if (Array.isArray(m.content)) {
        const textParts: string[] = [];
        const toolCalls: ToolCall[] = [];

        for (const block of m.content) {
          if (block.type === 'text') {
            textParts.push(block.text);
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input || {})
              }
            });
          } else if (block.type === 'tool_result') {
            messages.push({
              role: 'tool',
              content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              tool_call_id: block.tool_use_id
            });
          }
        }

        if (textParts.length > 0 || toolCalls.length > 0) {
          messages.push({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: textParts.join('\n'),
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined
          });
        }
      } else {
        messages.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content || ''
        });
      }
    }

    const tools: ToolDefinition[] | undefined = body.tools
      ? body.tools.map((t: any) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema || {}
          }
        }))
      : undefined;

    return {
      model: body.model || 'claude-3-5-sonnet-20241022',
      messages,
      systemPrompt,
      temperature: body.temperature,
      max_tokens: body.max_tokens || 4096,
      stream: Boolean(body.stream),
      tools,
      tool_choice: body.tool_choice,
      tenantId,
      traceId: body.trace_id || body.traceId
    };
  }

  /**
   * Converts normalized request into an OpenAI Chat Completions payload.
   */
  public static toOpenAIPayload(request: NormalizedLLMRequest, modelOverride?: string): any {
    const messages = request.messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          tool_call_id: m.tool_call_id
        };
      }

      const msg: any = {
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      };

      if (m.tool_calls && m.tool_calls.length > 0) {
        msg.tool_calls = m.tool_calls;
      }

      return msg;
    });

    const payload: any = {
      model: modelOverride || request.model,
      messages,
      stream: request.stream
    };

    if (request.temperature !== undefined) payload.temperature = request.temperature;
    if (request.max_tokens !== undefined) payload.max_tokens = request.max_tokens;
    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools;
    }

    return payload;
  }

  /**
   * Converts normalized request into an Anthropic Messages payload.
   */
  public static toAnthropicPayload(request: NormalizedLLMRequest, modelOverride?: string): any {
    let systemText = request.systemPrompt;
    const anthropicMessages: any[] = [];

    for (const m of request.messages) {
      if (m.role === 'system') {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        systemText = systemText ? `${systemText}\n${text}` : text;
        continue;
      }

      if (m.role === 'tool') {
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: m.tool_call_id,
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
            }
          ]
        });
        continue;
      }

      if (m.tool_calls && m.tool_calls.length > 0) {
        const contentBlocks: any[] = [];
        if (m.content) {
          contentBlocks.push({
            type: 'text',
            text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          });
        }
        for (const tc of m.tool_calls) {
          let inputObj = {};
          try {
            inputObj = JSON.parse(tc.function.arguments);
          } catch {
            inputObj = { raw: tc.function.arguments };
          }
          contentBlocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: inputObj
          });
        }
        anthropicMessages.push({
          role: 'assistant',
          content: contentBlocks
        });
        continue;
      }

      anthropicMessages.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      });
    }

    const payload: any = {
      model: modelOverride || request.model,
      messages: anthropicMessages,
      max_tokens: request.max_tokens || 4096,
      stream: request.stream
    };

    if (systemText) payload.system = systemText;
    if (request.temperature !== undefined) payload.temperature = request.temperature;
    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: 'object', properties: {} }
      }));
    }

    return payload;
  }

  /**
   * Formats a normalized response for an OpenAI client.
   */
  public static toOpenAIResponse(
    response: NormalizedLLMResponse,
    requestedModel: string
  ): any {
    const choice: any = {
      index: 0,
      message: {
        role: 'assistant',
        content: response.content || null
      },
      finish_reason: response.finishReason
    };

    if (response.tool_calls && response.tool_calls.length > 0) {
      choice.message.tool_calls = response.tool_calls;
    }

    return {
      id: response.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [choice],
      usage: {
        prompt_tokens: response.usage.promptTokens,
        completion_tokens: response.usage.completionTokens,
        total_tokens: response.usage.totalTokens
      }
    };
  }

  /**
   * Formats a normalized response for an Anthropic client.
   */
  public static toAnthropicResponse(
    response: NormalizedLLMResponse,
    requestedModel: string
  ): any {
    const contentBlocks: any[] = [];

    if (response.content) {
      contentBlocks.push({
        type: 'text',
        text: response.content
      });
    }

    if (response.tool_calls) {
      for (const tc of response.tool_calls) {
        let inputObj = {};
        try {
          inputObj = JSON.parse(tc.function.arguments);
        } catch {
          inputObj = { raw: tc.function.arguments };
        }
        contentBlocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: inputObj
        });
      }
    }

    let stopReason = 'end_turn';
    if (response.finishReason === 'tool_calls') stopReason = 'tool_use';
    else if (response.finishReason === 'length') stopReason = 'max_tokens';

    return {
      id: response.id,
      type: 'message',
      role: 'assistant',
      model: requestedModel,
      content: contentBlocks,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: response.usage.promptTokens,
        output_tokens: response.usage.completionTokens
      }
    };
  }
}
