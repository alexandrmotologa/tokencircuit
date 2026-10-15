import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TokenCircuitGateway } from '../../src/server/gateway-server.js';

describe('TokenCircuitGateway Server Integration', () => {
  let gateway: TokenCircuitGateway;

  beforeEach(async () => {
    gateway = new TokenCircuitGateway({
      dbPath: ':memory:',
      port: 50099
    });
    await gateway.setupRoutes();
  });

  afterEach(async () => {
    await gateway.stop();
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
    expect(body.choices[0].message.content).toBeDefined();
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
    expect(body.content[0].text).toBeDefined();
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
    // Trip Bedrock
    const tripRes = await gateway.app.inject({
      method: 'POST',
      url: '/api/studio/circuit/trip',
      headers: { 'content-type': 'application/json' },
      payload: { providerId: 'bedrock', reason: 'Scheduled cloud drill' }
    });

    expect(tripRes.statusCode).toBe(200);
    const tripBody = JSON.parse(tripRes.payload);
    expect(tripBody.circuit.state).toBe('OPEN');
    expect(tripBody.circuit.isManuallyTripped).toBe(true);

    // Reset Bedrock
    const resetRes = await gateway.app.inject({
      method: 'POST',
      url: '/api/studio/circuit/reset',
      headers: { 'content-type': 'application/json' },
      payload: { providerId: 'bedrock' }
    });

    expect(resetRes.statusCode).toBe(200);
    const resetBody = JSON.parse(resetRes.payload);
    expect(resetBody.circuit.state).toBe('CLOSED');
  });
});
