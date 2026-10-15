import { EventEmitter } from 'node:events';
import type { CircuitBreakerConfig, CircuitState, ProviderCircuitStatus } from '../types.js';
import { FailureMonitor } from './failure-monitor.js';

export interface CircuitChangeEvent {
  providerId: string;
  fromState: CircuitState;
  toState: CircuitState;
  reason: string;
  timestamp: number;
}

export class CircuitBreakerManager extends EventEmitter {
  private config: CircuitBreakerConfig;
  private monitor: FailureMonitor;
  private states: Map<string, CircuitState> = new Map();
  private lastStateChange: Map<string, number> = new Map();
  private successiveProbeSuccesses: Map<string, number> = new Map();
  private manualTrips: Map<string, { tripped: boolean; reason?: string }> = new Map();
  private providerNames: Map<string, string> = new Map();

  constructor(
    config: CircuitBreakerConfig = {
      failureThreshold: 3,
      windowMs: 30000,
      recoveryTimeMs: 30000,
      halfOpenProbes: 2,
      errorCodes: [429, 500, 502, 503, 504]
    }
  ) {
    super();
    this.config = config;
    this.monitor = new FailureMonitor(config.windowMs, config.errorCodes);
  }

  public registerProvider(providerId: string, name: string): void {
    if (!this.states.has(providerId)) {
      this.states.set(providerId, 'CLOSED');
      this.lastStateChange.set(providerId, Date.now());
      this.successiveProbeSuccesses.set(providerId, 0);
      this.providerNames.set(providerId, name);
    }
  }

  public getState(providerId: string): CircuitState {
    const manual = this.manualTrips.get(providerId);
    if (manual?.tripped) {
      return 'OPEN';
    }

    const currentState = this.states.get(providerId) ?? 'CLOSED';

    // Check if recovery cooldown has expired for an OPEN circuit
    if (currentState === 'OPEN') {
      const lastChange = this.lastStateChange.get(providerId) ?? 0;
      if (Date.now() - lastChange >= this.config.recoveryTimeMs) {
        this.transitionTo(providerId, 'HALF_OPEN', 'Recovery cooldown elapsed; probing provider health');
        return 'HALF_OPEN';
      }
    }

    return currentState;
  }

  public canExecute(providerId: string): boolean {
    const state = this.getState(providerId);
    if (state === 'CLOSED') return true;
    if (state === 'HALF_OPEN') return true; // Allows canary probe
    return false; // OPEN trips immediately
  }

  public recordSuccess(providerId: string, latencyMs: number = 0): void {
    this.monitor.recordSuccess(providerId, latencyMs);
    const currentState = this.getState(providerId);

    // Check Latency SLA breach
    if (this.config.maxP95LatencyMs && this.config.maxP95LatencyMs > 0 && currentState === 'CLOSED') {
      const metrics = this.monitor.getLatencyMetrics(providerId);
      if (metrics.p95 >= this.config.maxP95LatencyMs) {
        this.transitionTo(
          providerId,
          'OPEN',
          `Latency SLA breached: P95 latency ${metrics.p95}ms exceeds SLA cap of ${this.config.maxP95LatencyMs}ms`
        );
        return;
      }
    }

    if (currentState === 'HALF_OPEN') {
      const probeCount = (this.successiveProbeSuccesses.get(providerId) ?? 0) + 1;
      this.successiveProbeSuccesses.set(providerId, probeCount);

      if (probeCount >= this.config.halfOpenProbes) {
        this.transitionTo(
          providerId,
          'CLOSED',
          `Canary probe passed with ${probeCount} consecutive successes`
        );
        this.successiveProbeSuccesses.set(providerId, 0);
      }
    }
  }

  public recordFailure(
    providerId: string,
    statusCode?: number,
    errorMessage?: string,
    latencyMs: number = 0
  ): void {
    // Only count as breaker failure if status code is in monitored error list or timeout
    if (!this.monitor.isErrorCodeCircuitBreakerTrigger(statusCode)) {
      return;
    }

    this.monitor.recordFailure(providerId, statusCode, errorMessage, latencyMs);
    const currentState = this.getState(providerId);

    if (currentState === 'HALF_OPEN') {
      // In HALF_OPEN, even a single failure immediately trips back to OPEN
      this.transitionTo(
        providerId,
        'OPEN',
        `Canary probe failed (Status ${statusCode || 'Timeout'}: ${errorMessage || 'Unknown error'})`
      );
      this.successiveProbeSuccesses.set(providerId, 0);
      return;
    }

    if (currentState === 'CLOSED') {
      if (this.monitor.isTripConditionMet(providerId, this.config.failureThreshold)) {
        const failureCount = this.monitor.getConsecutiveFailures(providerId);
        this.transitionTo(
          providerId,
          'OPEN',
          `Threshold breached: ${failureCount} failures within ${this.config.windowMs / 1000}s`
        );
      }
    }
  }

  public forceTrip(providerId: string, reason: string = 'Manual operator trip'): void {
    this.manualTrips.set(providerId, { tripped: true, reason });
    this.transitionTo(providerId, 'OPEN', `[MANUAL TRIP] ${reason}`);
  }

  public forceReset(providerId: string): void {
    this.manualTrips.delete(providerId);
    this.monitor.reset(providerId);
    this.successiveProbeSuccesses.set(providerId, 0);
    this.transitionTo(providerId, 'CLOSED', '[MANUAL RESET] Operator cleared circuit status');
  }

  private transitionTo(providerId: string, newState: CircuitState, reason: string): void {
    const oldState = this.states.get(providerId) ?? 'CLOSED';
    if (oldState === newState) return;

    this.states.set(providerId, newState);
    this.lastStateChange.set(providerId, Date.now());

    const event: CircuitChangeEvent = {
      providerId,
      fromState: oldState,
      toState: newState,
      reason,
      timestamp: Date.now()
    };

    this.emit('stateChange', event);
  }

  public getStatus(providerId: string): ProviderCircuitStatus {
    const state = this.getState(providerId);
    const latency = this.monitor.getLatencyMetrics(providerId);
    const manual = this.manualTrips.get(providerId);

    return {
      providerId,
      name: this.providerNames.get(providerId) ?? providerId,
      state,
      failureCount: this.monitor.getWindowFailureCount(providerId),
      successCount: this.monitor.getWindowSuccessCount(providerId),
      lastStateChangeTimestamp: this.lastStateChange.get(providerId) ?? Date.now(),
      successiveProbeSuccesses: this.successiveProbeSuccesses.get(providerId) ?? 0,
      latencyMsP50: latency.p50,
      latencyMsP95: latency.p95,
      isManuallyTripped: Boolean(manual?.tripped),
      manualTripReason: manual?.reason
    };
  }

  public getAllStatuses(): ProviderCircuitStatus[] {
    return Array.from(this.states.keys()).map((id) => this.getStatus(id));
  }
}
