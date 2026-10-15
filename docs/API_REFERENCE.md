# TokenCircuit API Reference

The TokenCircuit gateway exposes drop-in endpoints compatible with OpenAI and Anthropic SDKs, alongside administrative endpoints powering the embedded Control Studio.

## Ingestion Endpoints

### 1. OpenAI Chat Completions

```http
POST /v1/chat/completions
Host: localhost:50098
Content-Type: application/json
x-tenant-id: engineering-team
```

#### Request Headers

* `x-tenant-id` (optional): Tenant identifier for spending ledgers and rate caps. Defaults to `default`.
* `Authorization` (optional): Forwarded to upstream providers if configured.

#### Request Body
Accepts standard OpenAI Chat Completions schemas including `model`, `messages`, `tools`, `temperature`, `max_tokens`, and `stream`.

#### Response Headers
* `x-tokencircuit-id`: Unique gateway request identifier.
* `x-tokencircuit-provider`: Actual provider that served the request (e.g. `bedrock`, `anthropic`, or `openai`).
* `x-tokencircuit-model`: Model executed (including auto-downgraded identifiers).
* `x-tokencircuit-cost-usd`: Precise cost in microdollars.
* `x-tokencircuit-failover`: `true` if fallback hops were executed; otherwise `false`.
* `x-tokencircuit-hops`: Number of failed provider attempts before success.
* `x-tokencircuit-downgraded`: `true` if the model was downgraded to preserve budget.

---

### 2. Anthropic Messages

```http
POST /v1/messages
Host: localhost:50098
Content-Type: application/json
x-tenant-id: research-agents
```

#### Request Body
Accepts standard Anthropic Messages schemas including `model`, `system`, `messages`, `tools`, `max_tokens`, and `stream`.

---

## Error Envelopes

### 1. Hard Budget Ceiling Reached (HTTP 402)
Returned when a tenant has exhausted 100% of their daily or monthly dollar quota:

```json
{
  "error": {
    "message": "Hard budget ceiling reached for tenant \"engineering-team\". Current daily spend $50.12 exceeds limit of $50.00.",
    "type": "budget_exceeded",
    "code": "quota_exhausted",
    "budget": {
      "tenantId": "engineering-team",
      "dailyLimitUsd": 50.0,
      "currentDailySpendUsd": 50.12,
      "status": "EXHAUSTED"
    }
  }
}
```

### 2. Runaway Agent Loop Terminated (HTTP 429)
Returned when repetitive tool calls or ping-pong cycles are identified:

```json
{
  "error": {
    "message": "[TokenCircuit Loop Breaker] Tool \"search_database\" invoked 3 times with identical arguments within 60s window.",
    "type": "agent_loop_detected",
    "code": "runaway_loop_terminated",
    "cycles": 3,
    "tool": "search_database"
  }
}
```

### 3. Emergency Kill-Switch Active (HTTP 503)
Returned when global emergency traffic halt is engaged:

```json
{
  "error": {
    "message": "TokenCircuit emergency global kill-switch is active. Outbound LLM traffic halted.",
    "type": "killswitch_active",
    "code": "service_unavailable"
  }
}
```

---

## Control Studio REST API

* `GET /health`: Basic health check and kill-switch status.
* `GET /api/studio/status`: System metrics, provider circuit states, tenant list, and kill-switch state.
* `POST /api/studio/circuit/trip`: Force a provider circuit to `OPEN`. Body: `{"providerId": "bedrock", "reason": "operator drill"}`.
* `POST /api/studio/circuit/reset`: Reset a provider circuit to `CLOSED`. Body: `{"providerId": "bedrock"}`.
* `GET /api/studio/tenants`: List all tenants and their spend meters.
* `POST /api/studio/tenants`: Create or update tenant limits and fallback model.
* `GET /api/studio/logs`: Returns recent transactions, failover hops, and circuit events.
* `POST /api/studio/killswitch`: Toggle global kill-switch (`{"active": true|false}`).
* `POST /api/studio/simulate`: Run simulated scenarios (`{"scenario": "failover"|"budget"|"loop"}`).
