import type { CircuitBreakerManager } from '../breaker/circuit-state.js';
import type { SQLiteLedger } from '../storage/ledger.js';
import type { PromptCache } from '../cache/prompt-cache.js';

export class PrometheusExporter {
  private circuitBreaker: CircuitBreakerManager;
  private ledger: SQLiteLedger;
  private cache?: PromptCache;
  private startTime = Date.now();

  constructor(
    circuitBreaker: CircuitBreakerManager,
    ledger: SQLiteLedger,
    cache?: PromptCache
  ) {
    this.circuitBreaker = circuitBreaker;
    this.ledger = ledger;
    this.cache = cache;
  }

  public generateMetrics(killSwitchActive: boolean = false): string {
    const lines: string[] = [];
    const metrics = this.ledger.getMetrics();
    const tenants = this.ledger.listTenants();
    const circuits = this.circuitBreaker.getAllStatuses();
    const cacheStats = this.cache?.getStats();

    // 1. Process uptime
    lines.push('# HELP tokencircuit_uptime_seconds Uptime of TokenCircuit gateway');
    lines.push('# TYPE tokencircuit_uptime_seconds counter');
    lines.push(`tokencircuit_uptime_seconds ${Math.floor((Date.now() - this.startTime) / 1000)}`);
    lines.push('');

    // 2. Kill switch state
    lines.push('# HELP tokencircuit_killswitch_active State of emergency killswitch (0=inactive, 1=active)');
    lines.push('# TYPE tokencircuit_killswitch_active gauge');
    lines.push(`tokencircuit_killswitch_active ${killSwitchActive ? 1 : 0}`);
    lines.push('');

    // 3. Circuit breaker states
    lines.push('# HELP tokencircuit_circuit_state State of provider circuit (0=CLOSED, 1=HALF_OPEN, 2=OPEN)');
    lines.push('# TYPE tokencircuit_circuit_state gauge');
    for (const c of circuits) {
      let stateVal = 0;
      if (c.state === 'HALF_OPEN') stateVal = 1;
      else if (c.state === 'OPEN') stateVal = 2;
      lines.push(`tokencircuit_circuit_state{provider="${c.providerId}"} ${stateVal}`);
      lines.push(`tokencircuit_provider_failures_window{provider="${c.providerId}"} ${c.failureCount}`);
      lines.push(`tokencircuit_provider_latency_p50_ms{provider="${c.providerId}"} ${c.latencyMsP50}`);
      lines.push(`tokencircuit_provider_latency_p95_ms{provider="${c.providerId}"} ${c.latencyMsP95}`);
    }
    lines.push('');

    // 4. Request and Spend totals
    lines.push('# HELP tokencircuit_requests_total Total number of routed requests');
    lines.push('# TYPE tokencircuit_requests_total counter');
    lines.push(`tokencircuit_requests_total ${metrics.totalRequests}`);
    lines.push('');

    lines.push('# HELP tokencircuit_failovers_total Total cross-provider failovers diverted');
    lines.push('# TYPE tokencircuit_failovers_total counter');
    lines.push(`tokencircuit_failovers_total ${metrics.totalFailovers}`);
    lines.push('');

    lines.push('# HELP tokencircuit_spend_usd_total Total spend in USD across all tenants');
    lines.push('# TYPE tokencircuit_spend_usd_total counter');
    lines.push(`tokencircuit_spend_usd_total ${metrics.totalSpendUsd.toFixed(6)}`);
    lines.push('');

    // 5. Per-tenant gauges
    lines.push('# HELP tokencircuit_tenant_daily_spend_usd Current daily spend in USD per tenant');
    lines.push('# TYPE tokencircuit_tenant_daily_spend_usd gauge');
    for (const t of tenants) {
      lines.push(`tokencircuit_tenant_daily_spend_usd{tenant="${t.tenantId}"} ${t.currentDailySpendUsd.toFixed(6)}`);
      lines.push(`tokencircuit_tenant_daily_limit_usd{tenant="${t.tenantId}"} ${t.dailyLimitUsd.toFixed(2)}`);
      lines.push(`tokencircuit_tenant_is_downgraded{tenant="${t.tenantId}"} ${t.status === 'DOWNGRADED' ? 1 : 0}`);
      lines.push(`tokencircuit_tenant_is_exhausted{tenant="${t.tenantId}"} ${t.status === 'EXHAUSTED' ? 1 : 0}`);
    }
    lines.push('');

    // 6. Savings & Protection
    lines.push('# HELP tokencircuit_savings_usd_total Total estimated savings in USD prevented from runaway loops or cache');
    lines.push('# TYPE tokencircuit_savings_usd_total counter');
    lines.push(`tokencircuit_savings_usd_total{type="agent_loop"} ${metrics.totalSavingsUsd.toFixed(4)}`);
    if (cacheStats) {
      lines.push(`tokencircuit_savings_usd_total{type="cache_hit"} ${cacheStats.totalCostSavedUsd.toFixed(6)}`);
      lines.push(`tokencircuit_cache_hits_total ${cacheStats.hitCount}`);
      lines.push(`tokencircuit_cache_misses_total ${cacheStats.missCount}`);
    }
    lines.push(`tokencircuit_loops_blocked_total ${metrics.totalLoopsBlocked}`);
    lines.push('');

    return lines.join('\n');
  }
}
