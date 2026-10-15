import { describe, it, expect } from 'vitest';
import { AuditExporter } from '../../src/core/export/audit-exporter.js';

describe('AuditExporter (CSV and JSON Export)', () => {
  const sampleTransactions = [
    {
      id: 'tx_101',
      tenant_id: 'enterprise_app',
      timestamp: 1739634000000,
      model: 'gpt-4o',
      provider: 'openai',
      prompt_tokens: 150,
      completion_tokens: 45,
      cost_usd: 0.000825,
      downgraded: 0,
      failover_occurred: 0,
      latency_ms: 42,
      status_code: 200
    }
  ];

  it('generates valid CSV format with standard headers', () => {
    const csv = AuditExporter.exportTransactionsToCsv(sampleTransactions);

    expect(csv).toContain('Transaction ID,Tenant ID,Timestamp (ISO),Model,Provider');
    expect(csv).toContain('tx_101,enterprise_app,');
    expect(csv).toContain('gpt-4o,openai,150,45,195,0.000825,FALSE,FALSE,42,200');
  });

  it('escapes comma-containing strings in CSV properly', () => {
    const customTx = [
      {
        ...sampleTransactions[0],
        id: 'tx,"quoted",val'
      }
    ];

    const csv = AuditExporter.exportTransactionsToCsv(customTx);
    expect(csv).toContain('"tx,""quoted"",val"');
  });

  it('generates complete JSON audit structure', () => {
    const jsonStr = AuditExporter.exportFullAuditToJson({
      transactions: sampleTransactions,
      failovers: [],
      circuitEvents: [],
      metrics: { totalSpendUsd: 10 },
      tenants: []
    });

    const parsed = JSON.parse(jsonStr);
    expect(parsed.version).toBe('1.0.0');
    expect(parsed.transactions.length).toBe(1);
    expect(parsed.metrics.totalSpendUsd).toBe(10);
  });
});
