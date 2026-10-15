import { EventEmitter } from 'node:events';
import type {
  FailoverHop,
  NormalizedLLMRequest,
  NormalizedLLMResponse,
  RequestTelemetry
} from '../types.js';
import type { LLMProvider, ProviderExecutionError } from '../../providers/base.js';
import type { CircuitBreakerManager } from '../breaker/circuit-state.js';
import type { CostCalculator } from '../budget/cost-calculator.js';
import type { SQLiteLedger } from '../storage/ledger.js';

export interface RouteExecutionResult {
  response: NormalizedLLMResponse;
  resolvedProvider: string;
  primaryProvider: string;
  dispatchedModel: string;
  failoverOccurred: boolean;
  failoverHops: FailoverHop[];
  latencyMs: number;
  costUsd: number;
}

export class FailoverChain extends EventEmitter {
  private providers: Map<string, LLMProvider> = new Map();
  private priorityOrder: string[] = [];
  private circuitBreaker: CircuitBreakerManager;
  private costCalculator: CostCalculator;
  private ledger: SQLiteLedger;

  constructor(
    circuitBreaker: CircuitBreakerManager,
    costCalculator: CostCalculator,
    ledger: SQLiteLedger
  ) {
    super();
    this.circuitBreaker = circuitBreaker;
    this.costCalculator = costCalculator;
    this.ledger = ledger;
  }

  public registerProvider(provider: LLMProvider, priority: number): void {
    this.providers.set(provider.id, provider);
    this.circuitBreaker.registerProvider(provider.id, provider.name);
    this.updatePriorityOrder();
  }

  public setPriorityOrder(order: string[]): void {
    this.priorityOrder = order.filter((id) => this.providers.has(id));
  }

  private updatePriorityOrder(): void {
    if (this.priorityOrder.length === 0) {
      this.priorityOrder = Array.from(this.providers.keys());
    }
  }

  public getProvider(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  public async routeRequest(
    request: NormalizedLLMRequest,
    dispatchedModel: string,
    requestId: string
  ): Promise<RouteExecutionResult> {
    const chain = this.priorityOrder.length > 0 ? this.priorityOrder : Array.from(this.providers.keys());
    const primaryProvider = chain[0] || 'default';
    const failoverHops: FailoverHop[] = [];
    let lastError: any = null;

    const overallStartTime = Date.now();

    for (let i = 0; i < chain.length; i++) {
      const providerId = chain[i];
      const provider = this.providers.get(providerId);

      if (!provider) continue;

      // Check circuit breaker status
      if (!this.circuitBreaker.canExecute(providerId)) {
        // Fast short-circuit: provider is in OPEN state
        const status = this.circuitBreaker.getStatus(providerId);
        failoverHops.push({
          providerId,
          model: dispatchedModel,
          timestamp: Date.now(),
          statusCode: 503,
          errorMessage: `Circuit is OPEN (${status.failureCount} recent errors). Short-circuited without network overhead.`,
          latencyMs: 0
        });

        this.ledger.recordFailover({
          requestId,
          tenantId: request.tenantId,
          attemptedProvider: providerId,
          failedStatusCode: 503,
          errorMessage: 'Circuit OPEN - short-circuited',
          nextProvider: chain[i + 1] || 'NONE'
        });

        continue;
      }

      const hopStartTime = Date.now();

      try {
        const response = await provider.execute(request, dispatchedModel);
        const latencyMs = Date.now() - hopStartTime;

        this.circuitBreaker.recordSuccess(providerId, latencyMs);

        const costUsd = this.costCalculator.calculateCostUsd(response.model, response.usage);
        const failoverOccurred = providerId !== primaryProvider || failoverHops.length > 0;

        return {
          response,
          resolvedProvider: providerId,
          primaryProvider,
          dispatchedModel,
          failoverOccurred,
          failoverHops,
          latencyMs: Date.now() - overallStartTime,
          costUsd
        };
      } catch (err: any) {
        const latencyMs = Date.now() - hopStartTime;
        const statusCode = (err as ProviderExecutionError).statusCode || 500;
        const errorMessage = err.message || 'Unknown provider error';

        this.circuitBreaker.recordFailure(providerId, statusCode, errorMessage, latencyMs);

        failoverHops.push({
          providerId,
          model: dispatchedModel,
          timestamp: Date.now(),
          statusCode,
          errorMessage,
          latencyMs
        });

        const nextProvider = chain[i + 1] || 'NONE';

        this.ledger.recordFailover({
          requestId,
          tenantId: request.tenantId,
          attemptedProvider: providerId,
          failedStatusCode: statusCode,
          errorMessage,
          nextProvider
        });

        this.emit('failoverHop', {
          requestId,
          attemptedProvider: providerId,
          statusCode,
          errorMessage,
          nextProvider
        });

        lastError = err;
      }
    }

    // If all providers in the chain failed
    const error = new Error(
      `All providers in TokenCircuit failover chain failed: ${lastError?.message || 'Exhausted chain'}`
    ) as ProviderExecutionError;
    error.statusCode = 503;
    error.providerId = primaryProvider;
    (error as any).failoverHops = failoverHops;
    throw error;
  }
}
