import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { TokenCircuitGateway } from '../../src/server/gateway-server.js';
import { OpenAIProvider } from '../../src/providers/openai.js';
import { AnthropicProvider } from '../../src/providers/anthropic.js';

describe('TokenCircuitGateway Server Integration', () => {
  let gateway: TokenCircuitGateway;
  let mockUpstreamServer: http.Server;
  let upstreamPort: number;

  beforeEach(async () => {
    // Spin up a real local HTTP server to receive upstream calls over TCP sockets
    mockUpstreamServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        if (req.url === '/v1/chat/completions') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'chatcmpl_live_upstream_123',
              model: 'gpt-4o',
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: 'Real HTTP wire response from upstream OpenAI endpoint'
                  },
                  finish_reason: 'stop'
                }
              ],
              usage: {
                prompt_tokens: 15,
                completion_tokens: 10,
                total_tokens: 25
              }
            })
          );
        } else if (req.url === '/v1/messages') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'msg_live_upstream_456',
              model: 'claude-3-5-sonnet-20241022',
              content: [
                {
                  type: 'text',
                  text: 'Real HTTP wire response from upstream Anthropic endpoint'
                }
              ],
              stop_reason: 'end_turn',
              usage: {
                input_tokens: 20,
                output_tokens: 12
              }
            })
          );
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

    await new Promise<void>((resolve) => {
      mockUpstreamServer.listen(0, '127.0.0.1', () => {
        upstreamPort = (mockUpstreamServer.address() as AddressInfo).port;
        resolve();
      });
    });

    gateway = new TokenCircuitGateway({
      dbPath: ':memory:',
      port: 50099
    });

    // Configure real providers pointing to the live local HTTP socket
    const testOpenAI = new OpenAIProvider({
      apiKey: 'test-real-sk-openai-live',
      endpoint: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`
    });
    const testAnthropic = new AnthropicProvider({
      apiKey: 'test-real-sk-ant-live',
      endpoint: `http://127.0.0.1:${upstreamPort}/v1/messages`
    });

    gateway.failoverChain.registerProvider(testAnthropic, 1);
    gateway.failoverChain.registerProvider(testOpenAI, 2);
    gateway.failoverChain.setPriorityOrder(['anthropic', 'openai']);

    await gateway.setupRoutes();
  });

  afterEach(async () => {
    await gateway.stop();
    await new Promise<void>((resolve) => mockUpstreamServer.close(() => resolve()));
  });

  it('responds to GET /health', async () => {
    const res = await gateway.app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('healthy');
    expect(body.killSwitch).toBe(false);
  });

  it('processes OpenAI /v1/chat/completions through fallback chain with custom headers', async () => {
    const res = await gateway.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': 'test-org'
      },
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Ping resilience gateway' }]
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-tokencircuit-id']).toBeDefined();
    expect(res.headers['x-tokencircuit-cost-usd']).toBeDefined();
    expect(res.headers['x-tokencircuit-provider']).toBeDefined();

    const body = JSON.parse(res.payload);
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.content).toContain('Real HTTP wire response');
  });

  it('processes Anthropic /v1/messages through fallback chain', async () => {
    const res = await gateway.app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': 'test-org'
      },
      payload: {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Ping resilience gateway' }]
      }
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-tokencircuit-id']).toBeDefined();

    const body = JSON.parse(res.payload);
    expect(body.type).toBe('message');
    expect(body.content[0].text).toContain('Real HTTP wire response');
  });

  it('halts all outbound traffic when emergency kill-switch is activated', async () => {
    // Activate kill-switch via Studio API
    const killRes = await gateway.app.inject({
      method: 'POST',
      url: '/api/studio/killswitch',
      headers: { 'content-type': 'application/json' },
      payload: { active: true }
    });
    expect(killRes.statusCode).toBe(200);

    // Inbound inference should now immediately be rejected with 503
    const blockedRes = await gateway.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      payload: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Should be blocked' }]
      }
    });

    expect(blockedRes.statusCode).toBe(503);
    const body = JSON.parse(blockedRes.payload);
    expect(body.error.type).toBe('killswitch_active');
  });

  it('exposes circuit breaker control via Studio API', async () => {
    // Trip Anthropic
    const tripRes = await gateway.app.inject({
      method: 'POST',
      url: '/api/studio/circuit/trip',
      headers: { 'content-type': 'application/json' },
      payload: { providerId: 'anthropic', reason: 'Scheduled cloud drill' }
    });

    expect(tripRes.statusCode).toBe(200);
    const tripBody = JSON.parse(tripRes.payload);
    expect(tripBody.circuit.state).toBe('OPEN');
    expect(tripBody.circuit.isManuallyTripped).toBe(true);

    // Reset Anthropic
    const resetRes = await gateway.app.inject({
      method: 'POST',
      url: '/api/studio/circuit/reset',
      headers: { 'content-type': 'application/json' },
      payload: { providerId: 'anthropic' }
    });

    expect(resetRes.statusCode).toBe(200);
    const resetBody = JSON.parse(resetRes.payload);
    expect(resetBody.circuit.state).toBe('CLOSED');
  });
});
