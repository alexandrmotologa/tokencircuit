import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';

import type { TokenCircuitConfig, RequestTelemetry } from '../core/types.js';
import { CircuitBreakerManager } from '../core/breaker/circuit-state.js';
import { SQLiteLedger } from '../core/storage/ledger.js';
import { CostCalculator } from '../core/budget/cost-calculator.js';
import { QuotaEnforcer } from '../core/budget/quota-enforcer.js';
import { AgentLoopGuard } from '../core/loop-detector/agent-loop-guard.js';
import { FailoverChain } from '../core/router/failover-chain.js';
import { PayloadTranslator } from '../core/router/translator.js';
import { BedrockProvider } from '../providers/bedrock.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { OpenAIProvider } from '../providers/openai.js';
import { MockSandboxProvider } from '../providers/mock-sandbox.js';

import { PromptCache } from '../core/cache/prompt-cache.js';
import { TenantRateLimiter } from '../core/ratelimit/tenant-rate-limiter.js';
import { KeyVault } from '../core/vault/key-vault.js';
import { WebhookDispatcher } from '../core/alerts/webhook-dispatcher.js';
import { PrometheusExporter } from '../core/metrics/prometheus-exporter.js';
import { AuditExporter } from '../core/export/audit-exporter.js';

export interface TokenCircuitServerOptions {
  config?: Partial<TokenCircuitConfig>;
  dbPath?: string;
  port?: number;
  host?: string;
  webhookUrl?: string;
}

export class TokenCircuitGateway {
  public app: FastifyInstance;
  public circuitBreaker: CircuitBreakerManager;
  public ledger: SQLiteLedger;
  public costCalculator: CostCalculator;
  public quotaEnforcer: QuotaEnforcer;
  public loopGuard: AgentLoopGuard;
  public failoverChain: FailoverChain;
  public mockSandbox: MockSandboxProvider;
  public promptCache: PromptCache;
  public rateLimiter: TenantRateLimiter;
  public keyVault: KeyVault;
  public webhookDispatcher: WebhookDispatcher;
  public prometheusExporter: PrometheusExporter;

  private isKillSwitchActive = false;
  private config: TokenCircuitConfig;

  constructor(options?: TokenCircuitServerOptions) {
    this.config = this.buildConfig(options?.config);
    this.ledger = new SQLiteLedger(options?.dbPath || this.config.database.path);
    this.costCalculator = new CostCalculator();
    this.circuitBreaker = new CircuitBreakerManager(this.config.circuitBreaker);
    this.quotaEnforcer = new QuotaEnforcer(this.ledger, this.config.budget);
    this.loopGuard = new AgentLoopGuard(this.config.loopDetector);

    // Advanced Resilience & Control Components
    this.promptCache = new PromptCache(this.ledger.getRawDb(), 3600);
    this.rateLimiter = new TenantRateLimiter({ maxRpm: 120, maxTpm: 250000 });
    this.keyVault = new KeyVault(60000);
    this.webhookDispatcher = new WebhookDispatcher(options?.webhookUrl || process.env.WEBHOOK_URL);
    this.prometheusExporter = new PrometheusExporter(
      this.circuitBreaker,
      this.ledger,
      this.promptCache
    );

    this.failoverChain = new FailoverChain(
      this.circuitBreaker,
      this.costCalculator,
      this.ledger
    );

    // Register primary providers with KeyVault integration
    const bedrock = new BedrockProvider();
    const anthropic = new AnthropicProvider({ keyVault: this.keyVault });
    const openai = new OpenAIProvider({ keyVault: this.keyVault });
    this.mockSandbox = new MockSandboxProvider();

    this.failoverChain.registerProvider(bedrock, 1);
    this.failoverChain.registerProvider(anthropic, 2);
    this.failoverChain.registerProvider(openai, 3);
    this.failoverChain.registerProvider(this.mockSandbox, 4);

    this.failoverChain.setPriorityOrder(['bedrock', 'anthropic', 'openai']);

    // Log circuit breaker state changes & trigger webhooks
    this.circuitBreaker.on('stateChange', (ev) => {
      this.ledger.recordCircuitEvent(ev.providerId, ev.fromState, ev.toState, ev.reason);

      if (ev.toState === 'OPEN') {
        this.webhookDispatcher.dispatch({
          eventType: 'circuit_tripped',
          title: `Circuit Breaker TRIPPED for ${ev.providerId.toUpperCase()}`,
          summary: `Provider circuit transitioned from ${ev.fromState} to OPEN. Outbound requests are now automatically diverted.`,
          severity: 'CRITICAL',
          metadata: {
            provider: ev.providerId,
            reason: ev.reason,
            timestamp: new Date().toISOString()
          }
        });
      } else if (ev.toState === 'CLOSED') {
        this.webhookDispatcher.dispatch({
          eventType: 'circuit_recovered',
          title: `Circuit Breaker RECOVERED for ${ev.providerId.toUpperCase()}`,
          summary: `Canary probe succeeded. Provider circuit has normalized back to CLOSED.`,
          severity: 'INFO',
          metadata: {
            provider: ev.providerId,
            reason: ev.reason
          }
        });
      }
    });

    this.app = Fastify({
      logger: false,
      bodyLimit: 15 * 1024 * 1024 // 15MB
    });
  }

  private buildConfig(userConfig?: Partial<TokenCircuitConfig>): TokenCircuitConfig {
    return {
      version: '1.0',
      server: {
        port: userConfig?.server?.port || 50098,
        host: userConfig?.server?.host || '0.0.0.0'
      },
      providers: userConfig?.providers || [
        {
          id: 'bedrock',
          name: 'AWS Bedrock',
          enabled: true,
          priority: 1,
          timeoutMs: 10000,
          models: ['anthropic.claude-3-5-sonnet-20241022-v2:0', 'anthropic.claude-3-5-haiku-20241022-v1:0']
        },
        {
          id: 'anthropic',
          name: 'Anthropic Direct',
          enabled: true,
          priority: 2,
          timeoutMs: 10000,
          models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022']
        },
        {
          id: 'openai',
          name: 'OpenAI Direct',
          enabled: true,
          priority: 3,
          timeoutMs: 12000,
          models: ['gpt-4o', 'gpt-4o-mini']
        }
      ],
      circuitBreaker: userConfig?.circuitBreaker || {
        failureThreshold: 3,
        windowMs: 30000,
        recoveryTimeMs: 30000,
        halfOpenProbes: 2,
        errorCodes: [429, 500, 502, 503, 504],
        maxP95LatencyMs: 6000
      },
      budget: userConfig?.budget || {
        defaultDailyLimitUsd: 50.0,
        defaultMonthlyLimitUsd: 500.0,
        downgradeThresholdRatio: 0.8,
        downgradeMappings: {
          'claude-3-5-sonnet-20241022': 'claude-3-5-haiku-20241022',
          'anthropic.claude-3-5-sonnet-20241022-v2:0': 'anthropic.claude-3-5-haiku-20241022-v1:0',
          'gpt-4o': 'gpt-4o-mini'
        }
      },
      loopDetector: userConfig?.loopDetector || {
        enabled: true,
        windowSeconds: 60,
        maxIdenticalCalls: 3,
        blockAction: 'TERMINATE_WITH_WARNING'
      },
      database: userConfig?.database || {
        path: './data/tokencircuit.db'
      }
    };
  }

  public async setupRoutes(): Promise<void> {
    await this.app.register(cors, {
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    });

    // Health check
    this.app.get('/health', async () => {
      return { status: 'healthy', timestamp: Date.now(), killSwitch: this.isKillSwitchActive };
    });

    // OpenMetrics / Prometheus Exporter
    this.app.get('/metrics', async (req, reply) => {
      const output = this.prometheusExporter.generateMetrics(this.isKillSwitchActive);
      reply.header('Content-Type', 'text/plain; version=0.0.4').send(output);
    });

    // ==========================================
    // 1. OpenAI Chat Completions Ingestion Route
    // ==========================================
    this.app.post('/v1/chat/completions', async (request, reply) => {
      const requestId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const tenantId = (request.headers['x-tenant-id'] as string) || 'default';

      if (this.isKillSwitchActive) {
        return reply.status(503).send({
          error: {
            message: 'TokenCircuit emergency global kill-switch is active. Outbound LLM traffic halted.',
            type: 'killswitch_active',
            code: 'service_unavailable'
          }
        });
      }

      // Tenant Rate Limiter Check (RPM / TPM)
      const rateCheck = this.rateLimiter.checkLimit(tenantId);
      if (!rateCheck.allowed) {
        reply.header('Retry-After', rateCheck.retryAfterSeconds?.toString() || '60');
        return reply.status(429).send({
          error: {
            message: `[TokenCircuit Rate Limiter] ${rateCheck.reason}`,
            type: 'rate_limit_exceeded',
            code: 'tenant_rate_limit',
            retryAfterSeconds: rateCheck.retryAfterSeconds
          }
        });
      }

      const normalizedReq = PayloadTranslator.fromOpenAIRequest(request.body, tenantId);

      // Loop Guard Check
      const loopResult = this.loopGuard.inspectRequest(tenantId, normalizedReq.messages);
      if (loopResult.isLooping && loopResult.actionTaken === 'TERMINATE_WITH_WARNING') {
        const preventedCost = 1.25;
        this.ledger.recordLoopDetection(
          tenantId,
          loopResult.detectedToolName || 'unknown',
          'cyclic_repetition',
          loopResult.repeatedCycleCount,
          preventedCost
        );

        this.webhookDispatcher.dispatch({
          eventType: 'loop_terminated',
          title: `Runaway Agent Loop Terminated (${tenantId})`,
          summary: loopResult.reason || 'Cyclic tool repetition blocked',
          severity: 'WARNING',
          metadata: {
            tenantId,
            tool: loopResult.detectedToolName || 'tool',
            cycles: loopResult.repeatedCycleCount,
            savedCost: `$${preventedCost.toFixed(2)}`
          }
        });

        return reply.status(429).send({
          error: {
            message: `[TokenCircuit Loop Breaker] ${loopResult.reason}`,
            type: 'agent_loop_detected',
            code: 'runaway_loop_terminated',
            cycles: loopResult.repeatedCycleCount,
            tool: loopResult.detectedToolName
          }
        });
      }

      // Check Exact Prompt Cache (non-streaming requests)
      if (!normalizedReq.stream) {
        const cached = this.promptCache.get(normalizedReq.model, normalizedReq.messages, normalizedReq.tools);
        if (cached) {
          const openAICached = PayloadTranslator.toOpenAIResponse(cached.response, normalizedReq.model);
          this.rateLimiter.recordUsage(tenantId, cached.response.usage.totalTokens);

          return reply
            .header('x-tokencircuit-id', requestId)
            .header('x-tokencircuit-provider', 'cache')
            .header('x-tokencircuit-model', normalizedReq.model)
            .header('x-tokencircuit-cost-usd', '0.000000')
            .header('x-tokencircuit-cache-hit', 'true')
            .header('x-tokencircuit-saved-usd', cached.costSavedUsd.toFixed(6))
            .send(openAICached);
        }
      }

      // Budget & Downgrade Check
      const budgetResult = this.quotaEnforcer.evaluateBudget(tenantId, normalizedReq.model);
      if (!budgetResult.allowed) {
        this.webhookDispatcher.dispatch({
          eventType: 'budget_exhausted',
          title: `Hard Budget Exhausted for Tenant "${tenantId}"`,
          summary: budgetResult.reason || 'Spend limit reached',
          severity: 'CRITICAL',
          metadata: {
            tenantId,
            dailySpend: `$${budgetResult.budget.currentDailySpendUsd.toFixed(2)}`,
            dailyLimit: `$${budgetResult.budget.dailyLimitUsd.toFixed(2)}`
          }
        });

        return reply.status(budgetResult.statusCode || 402).send({
          error: {
            message: budgetResult.reason,
            type: 'budget_exceeded',
            code: 'quota_exhausted',
            budget: budgetResult.budget
          }
        });
      }

      if (budgetResult.isDowngraded) {
        this.webhookDispatcher.dispatch({
          eventType: 'budget_downgrade',
          title: `Adaptive Model Downgrade (${tenantId})`,
          summary: `Tenant reached 80% quota. Rewriting model to ${budgetResult.model}.`,
          severity: 'WARNING',
          metadata: {
            tenantId,
            originalModel: normalizedReq.model,
            downgradedModel: budgetResult.model
          }
        });
      }

      // Handle Streaming SSE vs Non-Streaming
      if (normalizedReq.stream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('x-tokencircuit-id', requestId);

        try {
          const routeResult = await this.failoverChain.routeRequestStream(
            normalizedReq,
            budgetResult.model,
            requestId,
            (delta) => {
              const chunkPayload = {
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: routeResult?.dispatchedModel || budgetResult.model,
                choices: [
                  {
                    index: 0,
                    delta: { content: delta },
                    finish_reason: null
                  }
                ]
              };
              reply.raw.write(`data: ${JSON.stringify(chunkPayload)}\n\n`);
            }
          );

          // Final stop chunk
          const finalChunk = {
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: routeResult.dispatchedModel,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
          };
          reply.raw.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();

          // Record telemetry
          this.ledger.recordTransaction({
            id: requestId,
            tenantId,
            clientProtocol: 'openai',
            requestedModel: normalizedReq.model,
            dispatchedModel: routeResult.dispatchedModel,
            downgraded: budgetResult.isDowngraded,
            primaryProvider: routeResult.primaryProvider,
            resolvedProvider: routeResult.resolvedProvider,
            failoverOccurred: routeResult.failoverOccurred,
            failoverHops: routeResult.failoverHops,
            inputTokens: routeResult.response.usage.promptTokens,
            outputTokens: routeResult.response.usage.completionTokens,
            cachedTokens: 0,
            costUsd: routeResult.costUsd,
            latencyMs: routeResult.latencyMs,
            timestamp: Date.now(),
            statusCode: 200
          });

          this.rateLimiter.recordUsage(tenantId, routeResult.response.usage.totalTokens);
        } catch (err: any) {
          reply.raw.write(
            `data: ${JSON.stringify({ error: { message: err.message, type: 'failover_exhaustion' } })}\n\n`
          );
          reply.raw.end();
        }
        return;
      }

      // Non-Streaming Request Execution
      try {
        const routeResult = await this.failoverChain.routeRequest(
          normalizedReq,
          budgetResult.model,
          requestId
        );

        const telemetry: RequestTelemetry = {
          id: requestId,
          tenantId,
          clientProtocol: 'openai',
          requestedModel: normalizedReq.model,
          dispatchedModel: routeResult.dispatchedModel,
          downgraded: budgetResult.isDowngraded,
          primaryProvider: routeResult.primaryProvider,
          resolvedProvider: routeResult.resolvedProvider,
          failoverOccurred: routeResult.failoverOccurred,
          failoverHops: routeResult.failoverHops,
          inputTokens: routeResult.response.usage.promptTokens,
          outputTokens: routeResult.response.usage.completionTokens,
          cachedTokens: routeResult.response.usage.cachedTokens || 0,
          costUsd: routeResult.costUsd,
          latencyMs: routeResult.latencyMs,
          timestamp: Date.now(),
          statusCode: 200
        };

        this.ledger.recordTransaction(telemetry);
        this.rateLimiter.recordUsage(tenantId, routeResult.response.usage.totalTokens);

        // Store in prompt cache
        this.promptCache.set(
          normalizedReq.model,
          normalizedReq.messages,
          routeResult.response,
          routeResult.costUsd,
          normalizedReq.tools
        );

        const openAIResponse = PayloadTranslator.toOpenAIResponse(
          routeResult.response,
          normalizedReq.model
        );

        reply
          .header('x-tokencircuit-id', requestId)
          .header('x-tokencircuit-provider', routeResult.resolvedProvider)
          .header('x-tokencircuit-model', routeResult.dispatchedModel)
          .header('x-tokencircuit-cost-usd', routeResult.costUsd.toFixed(6))
          .header('x-tokencircuit-failover', routeResult.failoverOccurred ? 'true' : 'false')
          .header('x-tokencircuit-hops', routeResult.failoverHops.length.toString())
          .header('x-tokencircuit-downgraded', budgetResult.isDowngraded ? 'true' : 'false')
          .header('x-tokencircuit-cache-hit', 'false')
          .send(openAIResponse);
      } catch (err: any) {
        return reply.status(err.statusCode || 500).send({
          error: {
            message: err.message || 'All providers failed',
            type: 'failover_exhaustion',
            code: 'upstream_unavailable',
            hops: err.failoverHops || []
          }
        });
      }
    });

    // ==========================================
    // 2. Anthropic Messages Ingestion Route
    // ==========================================
    this.app.post('/v1/messages', async (request, reply) => {
      const requestId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const tenantId = (request.headers['x-tenant-id'] as string) || 'default';

      if (this.isKillSwitchActive) {
        return reply.status(503).send({
          type: 'error',
          error: {
            type: 'killswitch_active',
            message: 'TokenCircuit emergency global kill-switch is active. Outbound LLM traffic halted.'
          }
        });
      }

      // Rate limit check
      const rateCheck = this.rateLimiter.checkLimit(tenantId);
      if (!rateCheck.allowed) {
        reply.header('Retry-After', rateCheck.retryAfterSeconds?.toString() || '60');
        return reply.status(429).send({
          type: 'error',
          error: {
            type: 'rate_limit_error',
            message: `[TokenCircuit Rate Limiter] ${rateCheck.reason}`
          }
        });
      }

      const normalizedReq = PayloadTranslator.fromAnthropicRequest(request.body, tenantId);

      // Loop Guard Check
      const loopResult = this.loopGuard.inspectRequest(tenantId, normalizedReq.messages);
      if (loopResult.isLooping && loopResult.actionTaken === 'TERMINATE_WITH_WARNING') {
        const preventedCost = 1.25;
        this.ledger.recordLoopDetection(
          tenantId,
          loopResult.detectedToolName || 'unknown',
          'cyclic_repetition',
          loopResult.repeatedCycleCount,
          preventedCost
        );

        return reply.status(429).send({
          type: 'error',
          error: {
            type: 'agent_loop_detected',
            message: `[TokenCircuit Loop Breaker] ${loopResult.reason}`
          }
        });
      }

      // Check Exact Prompt Cache
      if (!normalizedReq.stream) {
        const cached = this.promptCache.get(normalizedReq.model, normalizedReq.messages, normalizedReq.tools);
        if (cached) {
          const anthropicCached = PayloadTranslator.toAnthropicResponse(cached.response, normalizedReq.model);
          this.rateLimiter.recordUsage(tenantId, cached.response.usage.totalTokens);

          return reply
            .header('x-tokencircuit-id', requestId)
            .header('x-tokencircuit-provider', 'cache')
            .header('x-tokencircuit-model', normalizedReq.model)
            .header('x-tokencircuit-cost-usd', '0.000000')
            .header('x-tokencircuit-cache-hit', 'true')
            .header('x-tokencircuit-saved-usd', cached.costSavedUsd.toFixed(6))
            .send(anthropicCached);
        }
      }

      // Budget & Downgrade Check
      const budgetResult = this.quotaEnforcer.evaluateBudget(tenantId, normalizedReq.model);
      if (!budgetResult.allowed) {
        return reply.status(budgetResult.statusCode || 402).send({
          type: 'error',
          error: {
            type: 'budget_exceeded',
            message: budgetResult.reason
          }
        });
      }

      try {
        const routeResult = await this.failoverChain.routeRequest(
          normalizedReq,
          budgetResult.model,
          requestId
        );

        const telemetry: RequestTelemetry = {
          id: requestId,
          tenantId,
          clientProtocol: 'anthropic',
          requestedModel: normalizedReq.model,
          dispatchedModel: routeResult.dispatchedModel,
          downgraded: budgetResult.isDowngraded,
          primaryProvider: routeResult.primaryProvider,
          resolvedProvider: routeResult.resolvedProvider,
          failoverOccurred: routeResult.failoverOccurred,
          failoverHops: routeResult.failoverHops,
          inputTokens: routeResult.response.usage.promptTokens,
          outputTokens: routeResult.response.usage.completionTokens,
          cachedTokens: routeResult.response.usage.cachedTokens || 0,
          costUsd: routeResult.costUsd,
          latencyMs: routeResult.latencyMs,
          timestamp: Date.now(),
          statusCode: 200
        };

        this.ledger.recordTransaction(telemetry);
        this.rateLimiter.recordUsage(tenantId, routeResult.response.usage.totalTokens);

        this.promptCache.set(
          normalizedReq.model,
          normalizedReq.messages,
          routeResult.response,
          routeResult.costUsd,
          normalizedReq.tools
        );

        const anthropicResponse = PayloadTranslator.toAnthropicResponse(
          routeResult.response,
          normalizedReq.model
        );

        reply
          .header('x-tokencircuit-id', requestId)
          .header('x-tokencircuit-provider', routeResult.resolvedProvider)
          .header('x-tokencircuit-model', routeResult.dispatchedModel)
          .header('x-tokencircuit-cost-usd', routeResult.costUsd.toFixed(6))
          .header('x-tokencircuit-failover', routeResult.failoverOccurred ? 'true' : 'false')
          .header('x-tokencircuit-hops', routeResult.failoverHops.length.toString())
          .header('x-tokencircuit-downgraded', budgetResult.isDowngraded ? 'true' : 'false')
          .header('x-tokencircuit-cache-hit', 'false')
          .send(anthropicResponse);
      } catch (err: any) {
        return reply.status(err.statusCode || 503).send({
          type: 'error',
          error: {
            type: 'upstream_unavailable',
            message: err.message || 'All providers failed',
            hops: err.failoverHops || []
          }
        });
      }
    });

    // ==========================================
    // 3. Web Studio & Administrative REST API
    // ==========================================
    this.app.get('/api/studio/status', async () => {
      return {
        killSwitch: this.isKillSwitchActive,
        circuits: this.circuitBreaker.getAllStatuses(),
        metrics: this.ledger.getMetrics(),
        tenants: this.ledger.listTenants(),
        cacheStats: this.promptCache.getStats(),
        webhookConfigured: Boolean(this.webhookDispatcher.getWebhookUrl())
      };
    });

    this.app.post<{ Body: { providerId: string; reason?: string } }>(
      '/api/studio/circuit/trip',
      async (req) => {
        const { providerId, reason } = req.body;
        this.circuitBreaker.forceTrip(providerId, reason || 'Manual operator trip');
        return { success: true, circuit: this.circuitBreaker.getStatus(providerId) };
      }
    );

    this.app.post<{ Body: { providerId: string } }>(
      '/api/studio/circuit/reset',
      async (req) => {
        const { providerId } = req.body;
        this.circuitBreaker.forceReset(providerId);
        return { success: true, circuit: this.circuitBreaker.getStatus(providerId) };
      }
    );

    this.app.get('/api/studio/tenants', async () => {
      return this.ledger.listTenants();
    });

    this.app.post<{
      Body: {
        tenantId: string;
        name?: string;
        dailyLimitUsd?: number;
        monthlyLimitUsd?: number;
        autoDowngradeEnabled?: boolean;
        fallbackModel?: string;
      };
    }>('/api/studio/tenants', async (req) => {
      const { tenantId, ...updates } = req.body;
      return this.ledger.setTenantBudget(tenantId, updates);
    });

    this.app.get('/api/studio/logs', async () => {
      return {
        transactions: this.ledger.getRecentTransactions(50),
        failovers: this.ledger.getRecentFailoverLogs(50),
        circuitEvents: this.ledger.getRecentCircuitEvents(50)
      };
    });

    this.app.post<{ Body: { active: boolean } }>('/api/studio/killswitch', async (req) => {
      this.isKillSwitchActive = Boolean(req.body.active);
      this.webhookDispatcher.dispatch({
        eventType: 'killswitch_toggled',
        title: this.isKillSwitchActive
          ? 'EMERGENCY KILL-SWITCH ENGAGED'
          : 'Emergency Kill-Switch Disengaged',
        summary: this.isKillSwitchActive
          ? 'All outbound LLM traffic has been immediately blocked.'
          : 'Normal traffic routing has resumed.',
        severity: this.isKillSwitchActive ? 'CRITICAL' : 'INFO',
        metadata: {
          active: this.isKillSwitchActive,
          timestamp: new Date().toISOString()
        }
      });
      return { killSwitch: this.isKillSwitchActive };
    });

    // Cache endpoints
    this.app.get('/api/studio/cache', async () => {
      return this.promptCache.getStats();
    });

    this.app.post('/api/studio/cache/clear', async () => {
      this.promptCache.clear();
      return { success: true, stats: this.promptCache.getStats() };
    });

    // Rate Limiting endpoints
    this.app.get('/api/studio/ratelimit', async (req) => {
      const tenants = this.ledger.listTenants();
      return tenants.map((t) => ({
        tenantId: t.tenantId,
        ...this.rateLimiter.getTenantUsage(t.tenantId)
      }));
    });

    this.app.post<{ Body: { tenantId: string; maxRpm?: number; maxTpm?: number } }>(
      '/api/studio/ratelimit',
      async (req) => {
        const { tenantId, maxRpm, maxTpm } = req.body;
        this.rateLimiter.setTenantLimits(tenantId, {
          maxRpm: maxRpm ? Number(maxRpm) : undefined,
          maxTpm: maxTpm ? Number(maxTpm) : undefined
        });
        return { success: true, limits: this.rateLimiter.getLimits(tenantId) };
      }
    );

    // Webhook settings & test
    this.app.get('/api/studio/webhooks', async () => {
      return {
        configured: Boolean(this.webhookDispatcher.getWebhookUrl()),
        history: this.webhookDispatcher.getHistory()
      };
    });

    this.app.post<{ Body: { webhookUrl: string } }>('/api/studio/webhooks', async (req) => {
      this.webhookDispatcher.setWebhookUrl(req.body.webhookUrl);
      const testSuccess = await this.webhookDispatcher.dispatch({
        eventType: 'circuit_tripped',
        title: 'TokenCircuit Webhook Verification Drill',
        summary: 'Verification ping confirming webhook connectivity.',
        severity: 'INFO',
        metadata: { status: 'CONNECTED', gateway: 'TokenCircuit v1.0.0' }
      });
      return { success: testSuccess, configured: Boolean(req.body.webhookUrl) };
    });

    // Audit Export Endpoints (CSV & JSON)
    this.app.get('/api/studio/export/csv', async (req, reply) => {
      const txs = this.ledger.getRecentTransactions(500);
      const csv = AuditExporter.exportTransactionsToCsv(txs);
      reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', 'attachment; filename="tokencircuit_audit.csv"')
        .send(csv);
    });

    this.app.get('/api/studio/export/json', async () => {
      const data = {
        transactions: this.ledger.getRecentTransactions(500),
        failovers: this.ledger.getRecentFailoverLogs(100),
        circuitEvents: this.ledger.getRecentCircuitEvents(100),
        metrics: this.ledger.getMetrics(),
        tenants: this.ledger.listTenants()
      };
      return AuditExporter.exportFullAuditToJson(data);
    });

    // Chaos simulation endpoint
    this.app.post<{ Body: { scenario: 'failover' | 'budget' | 'loop' } }>(
      '/api/studio/simulate',
      async (req, reply) => {
        const scenario = req.body.scenario;

        if (scenario === 'failover') {
          this.mockSandbox.injectError(503, 'Simulated Bedrock 503 Service Unavailable', 1);
          this.circuitBreaker.recordFailure('bedrock', 503, 'AWS Bedrock service outage simulated');
          this.circuitBreaker.recordFailure('bedrock', 503, 'AWS Bedrock service outage simulated');
          this.circuitBreaker.recordFailure('bedrock', 503, 'AWS Bedrock service outage simulated');

          return {
            scenario: 'failover',
            status: 'Bedrock circuit tripped to OPEN. Next requests will auto-divert to Anthropic.'
          };
        }

        if (scenario === 'budget') {
          this.ledger.setTenantBudget('demo-budget-tenant', {
            dailyLimitUsd: 0.05,
            autoDowngradeEnabled: true
          });
          return {
            scenario: 'budget',
            status: 'Tenant "demo-budget-tenant" configured with $0.05 cap for auto-downgrade testing.'
          };
        }

        if (scenario === 'loop') {
          const demoMessages: any = [
            {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'search_database', arguments: JSON.stringify({ query: 'lost_token' }) }
                }
              ]
            }
          ];
          this.loopGuard.inspectRequest('simulated-agent', demoMessages);
          this.loopGuard.inspectRequest('simulated-agent', demoMessages);
          const result = this.loopGuard.inspectRequest('simulated-agent', demoMessages);

          return {
            scenario: 'loop',
            result
          };
        }

        return reply.status(400).send({ error: 'Unknown scenario' });
      }
    );

    // ==========================================
    // 4. Static React 19 Studio Bundle Serving
    // ==========================================
    const studioDistPath = path.resolve(process.cwd(), 'dist', 'studio');
    if (fs.existsSync(studioDistPath)) {
      await this.app.register(fastifyStatic, {
        root: studioDistPath,
        prefix: '/'
      });

      this.app.setNotFoundHandler((req, reply) => {
        if (!req.raw.url?.startsWith('/api') && !req.raw.url?.startsWith('/v1')) {
          reply.sendFile('index.html');
        } else {
          reply.status(404).send({ error: 'Not found' });
        }
      });
    }
  }

  public async start(port?: number, host?: string): Promise<string> {
    await this.setupRoutes();
    const listenPort = port || this.config.server.port || 50098;
    const listenHost = host || this.config.server.host || '0.0.0.0';

    const address = await this.app.listen({ port: listenPort, host: listenHost });
    return address;
  }

  public async stop(): Promise<void> {
    await this.app.close();
    this.ledger.close();
  }
}
