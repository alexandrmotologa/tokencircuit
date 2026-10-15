import { describe, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAIProvider } from '../../src/providers/openai.js';
import { AnthropicProvider } from '../../src/providers/anthropic.js';

describe('Real HTTP SSE Streaming Providers', () => {
  it('streams chunks in real-time from OpenAI SSE endpoint', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });

      res.write('data: {"id":"chatcmpl_s1","model":"gpt-4o","choices":[{"delta":{"content":"Hello"}}]}\n\n');
      res.write('data: {"id":"chatcmpl_s1","model":"gpt-4o","choices":[{"delta":{"content":" world"}}]}\n\n');
      res.write('data: {"id":"chatcmpl_s1","model":"gpt-4o","choices":[{"delta":{"content":" from TokenCircuit"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    const provider = new OpenAIProvider({
      apiKey: 'test-real-key',
      endpoint: `http://127.0.0.1:${port}/v1/chat/completions`
    });

    const receivedChunks: string[] = [];
    const response = await provider.executeStream(
      {
        tenantId: 'test',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Say hello' }]
      },
      undefined,
      (delta) => receivedChunks.push(delta)
    );

    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(receivedChunks).toEqual(['Hello', ' world', ' from TokenCircuit']);
    expect(response.content).toBe('Hello world from TokenCircuit');
    expect(response.usage.completionTokens).toBe(3);
  });

  it('streams chunks in real-time from Anthropic SSE endpoint', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });

      res.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123","model":"claude-3-5-sonnet-20241022"}}\n\n');
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Protected "}}\n\n');
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"by "}}\n\n');
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"TokenCircuit"}}\n\n');
      res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    const provider = new AnthropicProvider({
      apiKey: 'test-ant-key',
      endpoint: `http://127.0.0.1:${port}/v1/messages`
    });

    const receivedChunks: string[] = [];
    const response = await provider.executeStream(
      {
        tenantId: 'test',
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Say protected' }]
      },
      undefined,
      (delta) => receivedChunks.push(delta)
    );

    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(receivedChunks).toEqual(['Protected ', 'by ', 'TokenCircuit']);
    expect(response.content).toBe('Protected by TokenCircuit');
    expect(response.finishReason).toBe('stop');
  });
});
