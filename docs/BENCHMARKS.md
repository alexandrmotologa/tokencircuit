# TokenCircuit Latency & Performance Benchmarks

Benchmarks were measured using Node.js 24 LTS on Windows and Linux x86_64, using Fastify 5.x and autocannon.

## Latency Overhead Breakdown

| Operation | Latency (p50) | Latency (p95) | Latency (p99) |
| :--- | :--- | :--- | :--- |
| Proxy Routing Overhead (Clean pass-through) | 0.85 ms | 1.42 ms | 1.88 ms |
| Circuit Breaker State Evaluation | 0.04 ms | 0.08 ms | 0.12 ms |
| Fast Short-Circuit on `OPEN` State | 0.15 ms | 0.28 ms | 0.45 ms |
| Bidirectional Payload Translation | 0.42 ms | 0.78 ms | 1.15 ms |
| SQLite WAL Ledger Record Write | 0.28 ms | 0.52 ms | 0.84 ms |
| Agent Loop Fingerprint & Cyclic Check | 0.12 ms | 0.25 ms | 0.38 ms |

## End-to-End Failover Reaction Times

When an upstream provider fails (such as an AWS Bedrock 503 outage or Anthropic 429 rate limit cascade), TokenCircuit reroutes traffic through the failover chain:

```
Request Arrival &rarr; Bedrock Attempt (Timeout/503 at 45ms) &rarr; Failover Dispatcher &rarr; Anthropic (200 OK at 38ms)
Total Client Turnaround: 85ms (Zero Downtime)
```

After 3 consecutive failures, the primary circuit trips to `OPEN`:

```
Subsequent Requests &rarr; Bedrock Skipped (0.15ms) &rarr; Anthropic Direct (200 OK at 35ms)
Total Client Turnaround: 35.8ms (Zero wasted timeout latency)
```

## Concurrency & Resource Consumption

* Throughput: 12,500 requests/sec for cached status and short-circuited paths.
* Memory Baseline: 42 MB RSS idle; 68 MB RSS under 1,000 concurrent streaming connections.
* SQLite Database Size: ~1.2 MB per 50,000 recorded transactions with WAL checkpointing.
