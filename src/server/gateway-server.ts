import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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

export interface TokenCircuitServerOptions {
  config?: Partial<TokenCircuitConfig>;
  dbPath?: string;
  port?: number;
  host?: string;
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
  private isKillSwitchActive = false;
  private config: TokenCircuitConfig;

  constructor(options?: TokenCircuitServerOptions) {
    this.config = this.buildConfig(options?.config);
    this.ledger = new SQLiteLedger(options?.dbPath || this.config.database.path);
    this.costCalculator = new CostCalculator();
    this.circuitBreaker = new CircuitBreakerManager(this.config.circuitBreaker);
    this.quotaEnforcer = new QuotaEnforcer(this.ledger, this.config.budget);
    this.loopGuard = new AgentLoopGuard(this.config.loopDetector);

    this.failoverChain = new FailoverChain(
      this.circuitBreaker,
      this.costCalculator,
      this.ledger
    );

    // Register primary providers
    const bedrock = new BedrockProvider();
    const anthropic = new AnthropicProvider();
    const openai = new OpenAIProvider();
    this.mockSandbox = new MockSandboxProvider();

    this.failoverChain.registerProvider(bedrock, 1);
    this.failoverChain.registerProvider(anthropic, 2);
    this.failoverChain.registerProvider(openai, 3);
    this.failoverChain.registerProvider(this.mockSandbox, 4);

    this.failoverChain.setPriorityOrder(['bedrock', 'anthropic', 'openai']);

    // Log circuit breaker state changes into SQLite
    this.circuitBreaker.on('stateChange', (ev) => {
      this.ledger.recordCircuitEvent(ev.providerId, ev.fromState, ev.toState, ev.reason);
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
        errorCodes: [429, 500, 502, 503, 504]
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

      const normalizedReq = PayloadTranslator.fromOpenAIRequest(request.body, tenantId);

      // Loop Guard Check
      const loopResult = this.loopGuard.inspectRequest(tenantId, normalizedReq.messages);
      if (loopResult.isLooping && loopResult.actionTaken === 'TERMINATE_WITH_WARNING') {
        const preventedCost = 1.25; // Estimated conservative savings per blocked runaway burst
        this.ledger.recordLoopDetection(
          tenantId,
          loopResult.detectedToolName || 'unknown',
          'cyclic_repetition',
          loopResult.repeatedCycleCount,
          preventedCost
        );

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

      // Budget & Downgrade Check
      const budgetResult = this.quotaEnforcer.evaluateBudget(tenantId, normalizedReq.model);
      if (!budgetResult.allowed) {
        return reply.status(budgetResult.statusCode || 402).send({
          error: {
            message: budgetResult.reason,
            type: 'budget_exceeded',
            code: 'quota_exhausted',
            budget: budgetResult.budget
          }
        });
      }

      try {
        const routeResult = await this.failoverChain.routeRequest(
          normalizedReq,
          budgetResult.model,
          requestId
        );

        // Record telemetry in ledger
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
    // 3. Web Studio REST API
    // ==========================================
    this.app.get('/api/studio/status', async () => {
      return {
        killSwitch: this.isKillSwitchActive,
        circuits: this.circuitBreaker.getAllStatuses(),
        metrics: this.ledger.getMetrics(),
        tenants: this.ledger.listTenants()
      };
    });

    this.app.post<{ Body: { providerId: string; reason?: string } }>(
      '/api/studio/circuit/trip',
      async (req, reply) => {
        const { providerId, reason } = req.body;
        this.circuitBreaker.forceTrip(providerId, reason || 'Manual operator trip');
        return { success: true, circuit: this.circuitBreaker.getStatus(providerId) };
      }
    );

    this.app.post<{ Body: { providerId: string } }>(
      '/api/studio/circuit/reset',
      async (req, reply) => {
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
      return { killSwitch: this.isKillSwitchActive };
    });

    this.app.post<{ Body: { scenario: 'failover' | 'budget' | 'loop' } }>(
      '/api/studio/simulate',
      async (req, reply) => {
        const scenario = req.body.scenario;

        if (scenario === 'failover') {
          // Trip or simulate 503 on Bedrock, causing instant failover to Anthropic/OpenAI
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
          // Set tenant demo-budget to $0.05
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
          // Simulate an agent loop
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
