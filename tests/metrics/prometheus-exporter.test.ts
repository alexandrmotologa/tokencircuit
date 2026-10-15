import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrometheusExporter } from '../../src/core/metrics/prometheus-exporter.js';
import { CircuitBreakerManager } from '../../src/core/breaker/circuit-state.js';
import { SQLiteLedger } from '../../src/core/storage/ledger.js';

describe('PrometheusExporter (OpenMetrics Generation)', () => {
  let ledger: SQLiteLedger;
  let breaker: CircuitBreakerManager;
  let exporter: PrometheusExporter;

  beforeEach(() => {
    ledger = new SQLiteLedger(':memory:');
    breaker = new CircuitBreakerManager();
    breaker.registerProvider('bedrock', 'AWS Bedrock');
    breaker.registerProvider('anthropic', 'Anthropic Direct');
    exporter = new PrometheusExporter(breaker, ledger);
  });

  afterEach(() => {
    ledger.close();
  });

  it('outputs valid OpenMetrics format containing key counters and gauges', () => {
    const output = exporter.generateMetrics(false);

    expect(output).toContain('# HELP tokencircuit_uptime_seconds');
    expect(output).toContain('# TYPE tokencircuit_uptime_seconds counter');
    expect(output).toContain('tokencircuit_circuit_state{provider="bedrock"} 0');
    expect(output).toContain('tokencircuit_circuit_state{provider="anthropic"} 0');
    expect(output).toContain('tokencircuit_requests_total 0');
    expect(output).toContain('tokencircuit_killswitch_active 0');
  });

  it('reflects emergency killswitch state when active', () => {
    const output = exporter.generateMetrics(true);
    expect(output).toContain('tokencircuit_killswitch_active 1');
  });
});
