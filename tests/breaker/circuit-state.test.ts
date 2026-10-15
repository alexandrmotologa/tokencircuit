import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreakerManager } from '../../src/core/breaker/circuit-state.js';

describe('CircuitBreakerManager (Three-State State Machine)', () => {
  let breaker: CircuitBreakerManager;

  beforeEach(() => {
    breaker = new CircuitBreakerManager({
      failureThreshold: 3,
      windowMs: 1000,
      recoveryTimeMs: 500,
      halfOpenProbes: 2,
      errorCodes: [429, 500, 502, 503, 504]
    });
    breaker.registerProvider('bedrock', 'AWS Bedrock');
  });

  it('starts in CLOSED state with execution permitted', () => {
    expect(breaker.getState('bedrock')).toBe('CLOSED');
    expect(breaker.canExecute('bedrock')).toBe(true);
  });

  it('trips to OPEN after 3 consecutive failures', () => {
    breaker.recordFailure('bedrock', 503, 'Service Unavailable', 10);
    expect(breaker.getState('bedrock')).toBe('CLOSED');

    breaker.recordFailure('bedrock', 503, 'Service Unavailable', 10);
    expect(breaker.getState('bedrock')).toBe('CLOSED');

    breaker.recordFailure('bedrock', 503, 'Service Unavailable', 10);
    expect(breaker.getState('bedrock')).toBe('OPEN');
    expect(breaker.canExecute('bedrock')).toBe(false);
  });

  it('transitions from OPEN to HALF_OPEN after recovery cooldown', async () => {
    breaker.recordFailure('bedrock', 503, 'Outage', 10);
    breaker.recordFailure('bedrock', 503, 'Outage', 10);
    breaker.recordFailure('bedrock', 503, 'Outage', 10);
    expect(breaker.getState('bedrock')).toBe('OPEN');

    // Wait for recovery cooldown (500ms)
    await new Promise((r) => setTimeout(r, 550));

    expect(breaker.getState('bedrock')).toBe('HALF_OPEN');
    expect(breaker.canExecute('bedrock')).toBe(true);
  });

  it('resets from HALF_OPEN to CLOSED after consecutive canary probe successes', async () => {
    breaker.recordFailure('bedrock', 429, 'Rate limit', 10);
    breaker.recordFailure('bedrock', 429, 'Rate limit', 10);
    breaker.recordFailure('bedrock', 429, 'Rate limit', 10);
    expect(breaker.getState('bedrock')).toBe('OPEN');

    await new Promise((r) => setTimeout(r, 550));
    expect(breaker.getState('bedrock')).toBe('HALF_OPEN');

    // First canary probe
    breaker.recordSuccess('bedrock', 45);
    expect(breaker.getState('bedrock')).toBe('HALF_OPEN');

    // Second canary probe (meets halfOpenProbes = 2)
    breaker.recordSuccess('bedrock', 40);
    expect(breaker.getState('bedrock')).toBe('CLOSED');
    expect(breaker.canExecute('bedrock')).toBe(true);
  });

  it('immediately re-trips to OPEN if canary probe in HALF_OPEN fails', async () => {
    breaker.recordFailure('bedrock', 500, 'Internal Error', 10);
    breaker.recordFailure('bedrock', 500, 'Internal Error', 10);
    breaker.recordFailure('bedrock', 500, 'Internal Error', 10);

    await new Promise((r) => setTimeout(r, 550));
    expect(breaker.getState('bedrock')).toBe('HALF_OPEN');

    // Canary probe fails
    breaker.recordFailure('bedrock', 500, 'Still failing', 10);
    expect(breaker.getState('bedrock')).toBe('OPEN');
    expect(breaker.canExecute('bedrock')).toBe(false);
  });

  it('supports manual force trip and reset overrides', () => {
    expect(breaker.getState('bedrock')).toBe('CLOSED');

    breaker.forceTrip('bedrock', 'Emergency maintenance');
    expect(breaker.getState('bedrock')).toBe('OPEN');
    expect(breaker.canExecute('bedrock')).toBe(false);

    const status = breaker.getStatus('bedrock');
    expect(status.isManuallyTripped).toBe(true);
    expect(status.manualTripReason).toBe('Emergency maintenance');

    breaker.forceReset('bedrock');
    expect(breaker.getState('bedrock')).toBe('CLOSED');
    expect(breaker.canExecute('bedrock')).toBe(true);
  });
});
