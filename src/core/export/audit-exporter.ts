export class AuditExporter {
  public static exportTransactionsToCsv(transactions: any[]): string {
    const headers = [
      'Transaction ID',
      'Tenant ID',
      'Timestamp (ISO)',
      'Model',
      'Provider',
      'Prompt Tokens',
      'Completion Tokens',
      'Total Tokens',
      'Cost USD',
      'Downgraded',
      'Failover Occurred',
      'Latency (ms)',
      'HTTP Status'
    ];

    const rows = transactions.map((t) => [
      t.id,
      t.tenant_id,
      new Date(t.timestamp).toISOString(),
      t.model,
      t.provider,
      t.prompt_tokens,
      t.completion_tokens,
      (t.prompt_tokens || 0) + (t.completion_tokens || 0),
      Number(t.cost_usd).toFixed(6),
      t.downgraded === 1 ? 'TRUE' : 'FALSE',
      t.failover_occurred === 1 ? 'TRUE' : 'FALSE',
      t.latency_ms,
      t.status_code
    ]);

    const csvLines = [
      headers.join(','),
      ...rows.map((row) =>
        row
          .map((field) => {
            const str = String(field ?? '');
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          })
          .join(',')
      )
    ];

    return csvLines.join('\n');
  }

  public static exportFullAuditToJson(data: {
    transactions: any[];
    failovers: any[];
    circuitEvents: any[];
    metrics: any;
    tenants: any[];
  }): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        version: '1.0.0',
        metrics: data.metrics,
        tenants: data.tenants,
        circuitEvents: data.circuitEvents,
        failoverLogs: data.failovers,
        transactions: data.transactions
      },
      null,
      2
    );
  }
}
