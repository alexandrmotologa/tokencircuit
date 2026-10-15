# Engineering Specification & Implementation Blueprint: TokenCircuit
> Enterprise LLM Circuit Breaker, Multi-Provider Failover & Hard Budget Control Gateway

---

## 1. Executive Summary & Problem Space

### 1.1 The Operational Fragility of Production LLM Apps
When software systems integrate directly with proprietary LLM APIs (OpenAI, Anthropic Claude, AWS Bedrock, Google Gemini), they inherit three major production vulnerabilities:

1. **Provider Outages & Rate Limit Cascades:** AI providers frequently experience temporary outages (HTTP 500, 502, 503) and aggressive rate limits (HTTP 429 Too Many Requests). Without automated, low-latency cross-provider failover, customer-facing applications crash or become unresponsive.
2. **Runaway Agent Cost Spikes:** Autonomous agent workflows that enter unhandled reasoning loops or execute repetitive tool calls can easily burn through thousands of dollars in tokens within a few hours. Standard provider dashboards only report spend hours after it occurs, with no real-time hard kill-switches.
3. **Budget Overruns Across Multi-Tenant Teams:** Engineering departments lack granular, per-tenant or per-developer spending limits. A single rogue script or benchmark run can deplete the entire company's API quota, taking down production services for everyone.

### 1.2 The Solution: TokenCircuit
**TokenCircuit** is a lightweight, drop-in reverse proxy and embedded Web Studio built in **TypeScript and Node.js** that provides enterprise-grade circuit breaking, automated failover chains, and hard spending controls for LLM applications.

* **Three-State Circuit Breaker:** Implements standard `Closed`, `Open`, and `Half-Open` state machine semantics. If a provider experiences consecutive errors (e.g. 3 failures or 429 rate limits in a 30-second window), TokenCircuit trips the circuit and instantly diverts traffic to the secondary provider without client-side downtime.
* **Multi-Provider Failover Chains:** Define resilient priority chains (e.g. AWS Bedrock Claude 3.5 Sonnet -> Anthropic Direct -> OpenAI GPT-4o). TokenCircuit normalizes request and response envelopes on the fly.
* **Hard Budget Enforcement & Model Auto-Downgrade:** Configure hard daily and monthly dollar quotas per API key. When a tenant reaches 80% of their limit, TokenCircuit can automatically downgrade requests to an economical model (e.g. Sonnet -> Haiku); at 100%, it cleanly halts outbound calls with structured 402/429 responses.
* **Agent Loop Breaker:** Detects cyclic repetition patterns (identical tool calls or repeating token trigrams within a sliding 60-second window) and terminates the loop before token exhaustion occurs.
* **Embedded Control Studio:** A React 19 visual dashboard featuring real-time circuit state toggles, tenant spend meters, failover logs, and an emergency global kill-switch.

---

## 2. System Architecture & Tech Stack

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TokenCircuit Architecture                       │
└────────────────────────────────────────────────────────────────────────┘

[ Client Application / Agent ] ---> [ http://localhost:50098/v1/chat ]
                                              │
                                              ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      TokenCircuit Gateway Core                         │
├────────────────────────────────────────────────────────────────────────┤
│  Budget & Quota Controller                                             │
│    ├── Per-Tenant / Per-Key Token & Dollar Ledger (SQLite)             │
│    ├── Hard Ceiling Enforcer (Block at 100% budget)                    │
│    └── Adaptive Model Downgrader (Sonnet -> Haiku at 80% budget)       │
├────────────────────────────────────────────────────────────────────────┤
│  Runaway Loop Breaker                                                  │
│    ├── Sliding Window Tool-Call Fingerprint Cache                      │
│    └── Cycle Detector (Terminates identical loops > 3 cycles)          │
├────────────────────────────────────────────────────────────────────────┤
│  Circuit Breaker State Machine                                         │
│    ├── Provider Health Monitors (Success / Failure / 429 Counters)     │
│    ├── State Transitions: CLOSED -> OPEN -> HALF-OPEN                  │
│    └── Auto-Failover Dispatcher (Bedrock -> Anthropic -> OpenAI)       │
├────────────────────────────────────────────────────────────────────────┤
│  Provider Translation Adapters                                         │
│    ├── Anthropic Messages API Adapter                                  │
│    ├── AWS Bedrock Converse API Adapter                                │
│    └── OpenAI Chat Completions Adapter                                 │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
       [ AWS Bedrock ]  OR  [ Anthropic Direct ]  OR  [ OpenAI ]
                                    │
                                    ▼
                 [ React 19 Control Studio (Port 50098) ]
```

### Technology Stack Choices
* **Runtime:** Node.js 22 LTS / TypeScript 5.6+
* **Proxy Server:** Fastify 5.x for ultra-low latency routing (< 1.5ms proxy overhead)
* **Storage:** Embedded SQLite (`better-sqlite3`) for persistent budget ledgers and audit logs
* **Web Studio:** React 19 + Vite 6 + Tailwind CSS (bundled statically)
* **CLI Engine:** Commander.js + Picocolors + Ora + Table

---

## 3. Directory & File Structure

```
tokencircuit/
├── bin/
│   └── tokencircuit.js             # CLI executable entry point
├── src/
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── budget.ts           # tokencircuit budget set <tenant-id> --limit-usd 50.00
│   │   │   ├── serve.ts            # tokencircuit serve --config circuit.config.json
│   │   │   └── studio.ts           # tokencircuit studio (Launches embedded visual control plane)
│   │   └── index.ts
│   ├── core/
│   │   ├── breaker/
│   │   │   ├── circuit-state.ts    # Closed / Open / Half-Open state machine
│   │   │   └── failure-monitor.ts  # Sliding window error counter (HTTP 5xx / 429)
│   │   ├── budget/
│   │   │   ├── cost-calculator.ts  # Token-to-USD pricing table for all major models
│   │   │   └── quota-enforcer.ts   # Enforces hard spend ceilings and downgrades
│   │   ├── loop-detector/
│   │   │   └── agent-loop-guard.ts # Identifies infinite tool-calling and token loops
│   │   ├── router/
│   │   │   ├── failover-chain.ts   # Routes request across ordered provider fallbacks
│   │   │   └── translator.ts       # Cross-provider payload translation (OpenAI <-> Anthropic)
│   │   └── storage/
│   │       ├── ledger.ts           # SQLite ledger for tenant spend tracking
│   │       └── schema.sql
│   ├── providers/
│   │   ├── base.ts                 # BaseProvider interface
│   │   ├── anthropic.ts            # Direct Anthropic REST client
│   │   ├── bedrock.ts              # AWS Bedrock client
│   │   └── openai.ts               # Direct OpenAI REST client
│   ├── server/
│   │   ├── api-router.ts           # Studio management REST API
│   │   ├── gateway-server.ts       # Low-latency proxy server
│   │   └── middlewares/
│   │       ├── auth-check.ts
│   │       └── metrics-collector.ts
│   └── studio/                     # React 19 Frontend Web Studio
│       ├── index.html
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── BudgetMeters.tsx        # Tenant spend vs budget gauges
│       │   │   ├── CircuitStatusGrid.tsx   # Visual status of each provider
│       │   │   ├── EmergencyKillSwitch.tsx # Instant global traffic halt
│       │   │   └── FailoverLogStream.tsx   # Live list of diverted requests
│       │   ├── styles/
│       │   │   └── index.css
│       │   └── main.tsx
│       └── vite.config.ts
├── tests/
│   ├── breaker/
│   │   └── circuit-state.test.ts
│   ├── budget/
│   │   └── quota-enforcer.test.ts
│   └── loop-detector/
│       └── agent-loop-guard.test.ts
├── examples/
│   ├── circuit.config.json
│   └── loop-test-agent.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## 4. Core Data Contracts & Interfaces

```typescript
// src/core/breaker/circuit-state.ts
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface ProviderCircuitStatus {
  providerId: string;
  state: CircuitState;
  failureCount: number;
  lastFailureTimestamp?: number;
  lastStateChangeTimestamp: number;
  successiveProbeSuccesses: number;
}

// src/core/budget/quota-enforcer.ts
export interface TenantBudget {
  tenantId: string;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  currentDailySpendUsd: number;
  currentMonthlySpendUsd: number;
  autoDowngradeEnabled: boolean;
  fallbackModel?: string; // e.g. "claude-3-5-haiku" when Sonnet quota exceeded
  status: 'ACTIVE' | 'DOWNGRADED' | 'EXHAUSTED';
}

// src/core/loop-detector/agent-loop-guard.ts
export interface ToolCallFingerprint {
  toolName: string;
  argumentHash: string; // SHA-256 of normalized arguments
  timestamp: number;
}

export interface LoopDetectionResult {
  isLooping: boolean;
  repeatedCycleCount: number;
  detectedToolName?: string;
  actionTaken: 'ALLOW' | 'TERMINATE_WITH_WARNING';
}
```

---

## 5. Implementation Roadmap (Phases 1-5)

### Phase 1: Gateway Proxy & Provider Translation
* Build lightweight reverse proxy in Fastify receiving standard OpenAI/Anthropic format requests.
* Implement bidirectional payload translation (`translator.ts`) allowing an Anthropic Messages payload to execute on OpenAI or Bedrock when failover occurs.
* Implement model token cost table calculating accurate micro-dollar costs per input/output token.

### Phase 2: Three-State Circuit Breaker
* Implement standard circuit breaker logic:
  * 3 consecutive 5xx or 429 errors within 30s transitions circuit from `CLOSED` to `OPEN`.
  * `OPEN` state instantly routes requests to the next provider in the chain without waiting for timeouts.
  * After 60s cooldown, transition to `HALF_OPEN` to probe provider health with a single request.
* Write comprehensive unit tests for state transitions and recovery probing.

### Phase 3: Budget Control & Agent Loop Breaker
* Build SQLite budget ledger updating tenant spend in atomic transactions.
* Implement hard budget ceiling: return structured `402 Payment Required` when limit is hit.
* Implement model downgrading: rewrite model parameter (e.g. `claude-3-5-sonnet` -> `claude-3-5-haiku`) when budget is 80% consumed.
* Build `agent-loop-guard.ts` tracking tool call fingerprints in a sliding window to catch runaway loops.

### Phase 4: Embedded React 19 Control Studio
* Build real-time Circuit Status Grid displaying live badges (`CLOSED` in green, `OPEN` in red, `HALF_OPEN` in amber) with manual trip/reset toggles.
* Add Tenant Spend Meters showing progress bars toward daily and monthly caps.
* Build Live Failover Stream displaying requests that were saved by the circuit breaker.
* Add prominent Emergency Kill Switch button allowing immediate global traffic halt.

### Phase 5: Production Readiness & Documentation
* Support configuration via `circuit.config.json` and environment variables.
* Measure and optimize proxy overhead to ensure < 2ms latency addition.
* Write clean, humanized `README.md` with architectural diagrams, failover benchmarks, and Docker Compose deployment guides.
