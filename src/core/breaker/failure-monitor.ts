export interface RequestOutcome {
  timestamp: number;
  success: boolean;
  statusCode?: number;
  errorMessage?: string;
  latencyMs: number;
}

export class FailureMonitor {
  private windowMs: number;
  private errorCodes: Set<number>;
  private history: Map<string, RequestOutcome[]> = new Map();
  private consecutiveFailures: Map<string, number> = new Map();

  constructor(windowMs: number = 30000, errorCodes: number[] = [429, 500, 502, 503, 504]) {
    this.windowMs = windowMs;
    this.errorCodes = new Set(errorCodes);
  }

  private cleanOldEntries(providerId: string): void {
    const list = this.history.get(providerId);
    if (!list) return;

    const cutoff = Date.now() - this.windowMs;
    const filtered = list.filter((item) => item.timestamp >= cutoff);
    this.history.set(providerId, filtered);
  }

  public recordSuccess(providerId: string, latencyMs: number = 0): void {
    this.cleanOldEntries(providerId);
    let list = this.history.get(providerId);
    if (!list) {
      list = [];
      this.history.set(providerId, list);
    }

    list.push({
      timestamp: Date.now(),
      success: true,
      latencyMs
    });

    this.consecutiveFailures.set(providerId, 0);
  }

  public recordFailure(
    providerId: string,
    statusCode?: number,
    errorMessage?: string,
    latencyMs: number = 0
  ): void {
    this.cleanOldEntries(providerId);
    let list = this.history.get(providerId);
    if (!list) {
      list = [];
      this.history.set(providerId, list);
    }

    list.push({
      timestamp: Date.now(),
      success: false,
      statusCode,
      errorMessage,
      latencyMs
    });

    const currentConsecutive = this.consecutiveFailures.get(providerId) ?? 0;
    this.consecutiveFailures.set(providerId, currentConsecutive + 1);
  }

  public isTripConditionMet(providerId: string, threshold: number = 3): boolean {
    this.cleanOldEntries(providerId);
    const consecutive = this.consecutiveFailures.get(providerId) ?? 0;
    if (consecutive >= threshold) {
      return true;
    }

    const list = this.history.get(providerId) ?? [];
    const windowFailures = list.filter((item) => !item.success).length;
    return windowFailures >= threshold;
  }

  public getConsecutiveFailures(providerId: string): number {
    return this.consecutiveFailures.get(providerId) ?? 0;
  }

  public getWindowFailureCount(providerId: string): number {
    this.cleanOldEntries(providerId);
    const list = this.history.get(providerId) ?? [];
    return list.filter((item) => !item.success).length;
  }

  public getWindowSuccessCount(providerId: string): number {
    this.cleanOldEntries(providerId);
    const list = this.history.get(providerId) ?? [];
    return list.filter((item) => item.success).length;
  }

  public getLatencyMetrics(providerId: string): { p50: number; p95: number } {
    this.cleanOldEntries(providerId);
    const list = this.history.get(providerId) ?? [];
    if (list.length === 0) return { p50: 0, p95: 0 };

    const sorted = list.map((item) => item.latencyMs).sort((a, b) => a - b);
    const p50Index = Math.floor(sorted.length * 0.5);
    const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));

    return {
      p50: sorted[p50Index] ?? 0,
      p95: sorted[p95Index] ?? 0
    };
  }

  public isErrorCodeCircuitBreakerTrigger(statusCode?: number): boolean {
    if (!statusCode) return true; // Network/timeout error
    return this.errorCodes.has(statusCode);
  }

  public reset(providerId: string): void {
    this.history.delete(providerId);
    this.consecutiveFailures.delete(providerId);
  }
}
