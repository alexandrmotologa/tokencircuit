/**
 * TokenCircuit Core Data Contracts & Domain Types
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type ProviderId = 'bedrock' | 'anthropic' | 'openai' | 'mock-sandbox' | string;

export interface ProviderCircuitStatus {
  providerId: string;
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTimestamp?: number;
  lastSuccessTimestamp?: number;
  lastStateChangeTimestamp: number;
  successiveProbeSuccesses: number;
  latencyMsP50: number;
  latencyMsP95: number;
  isManuallyTripped: boolean;
  manualTripReason?: string;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  windowMs: number;
  recoveryTimeMs: number;
  halfOpenProbes: number;
  errorCodes: number[];
  maxP95LatencyMs?: number;
}

export interface TenantBudget {
  tenantId: string;
  name: string;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  currentDailySpendUsd: number;
  currentMonthlySpendUsd: number;
  autoDowngradeEnabled: boolean;
  fallbackModel?: string;
  status: 'ACTIVE' | 'DOWNGRADED' | 'EXHAUSTED';
  updatedAt: number;
}

export interface ModelPricing {
  modelId: string;
  provider: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheReadPerMillionUsd?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

export interface ToolCallFingerprint {
  toolName: string;
  argumentHash: string;
  timestamp: number;
  callCount: number;
}

export interface LoopDetectionResult {
  isLooping: boolean;
  repeatedCycleCount: number;
  detectedToolName?: string;
  actionTaken: 'ALLOW' | 'TERMINATE_WITH_WARNING';
  reason?: string;
}

export interface FailoverHop {
  providerId: string;
  model: string;
  timestamp: number;
  statusCode?: number;
  errorMessage?: string;
  latencyMs: number;
}

export interface RequestTelemetry {
  id: string;
  tenantId: string;
  clientProtocol: 'openai' | 'anthropic';
  requestedModel: string;
  dispatchedModel: string;
  downgraded: boolean;
  primaryProvider: string;
  resolvedProvider: string;
  failoverOccurred: boolean;
  failoverHops: FailoverHop[];
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  latencyMs: number;
  timestamp: number;
  statusCode: number;
  errorMessage?: string;
  loopBlocked?: boolean;
}

// Normalized Chat Messages
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentBlock[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ChatContentBlock {
  type: 'text' | 'image_url' | 'tool_use' | 'tool_result';
  text?: string;
  image_url?: { url: string };
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  tool_use_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

// Standard Request & Response Envelopes
export interface NormalizedLLMRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  tool_choice?: unknown;
  systemPrompt?: string;
  tenantId: string;
  traceId?: string;
}

export interface NormalizedLLMResponse {
  id: string;
  model: string;
  content: string;
  role: 'assistant';
  tool_calls?: ToolCall[];
  usage: TokenUsage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
}

export interface ProviderConfig {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  timeoutMs: number;
  apiKeyEnv?: string;
  endpoint?: string;
  models: string[];
}

export interface TokenCircuitConfig {
  version: string;
  server: {
    port: number;
    host: string;
  };
  providers: ProviderConfig[];
  circuitBreaker: CircuitBreakerConfig;
  budget: {
    defaultDailyLimitUsd: number;
    defaultMonthlyLimitUsd: number;
    downgradeThresholdRatio: number;
    downgradeMappings: Record<string, string>;
  };
  loopDetector: {
    enabled: boolean;
    windowSeconds: number;
    maxIdenticalCalls: number;
    blockAction: 'TERMINATE_WITH_WARNING' | 'ALLOW';
  };
  database: {
    path: string;
  };
}
