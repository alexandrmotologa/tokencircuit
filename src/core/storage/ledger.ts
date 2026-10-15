import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { CircuitState, RequestTelemetry, TenantBudget } from '../types.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

export interface LedgerMetrics {
  totalSpendUsd: number;
  totalRequests: number;
  totalFailovers: number;
  totalLoopsBlocked: number;
  totalSavingsUsd: number;
  uptimeSeconds: number;
}

export class SQLiteLedger {
  private db: DatabaseSyncType;
  private startTime = Date.now();

  constructor(dbPath: string = './data/tokencircuit.db') {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init(): void {
    // High-performance concurrency settings
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    // Load schema
    const schema = `
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        daily_limit_usd REAL NOT NULL DEFAULT 50.0,
        monthly_limit_usd REAL NOT NULL DEFAULT 500.0,
        auto_downgrade_enabled INTEGER NOT NULL DEFAULT 1,
        fallback_model TEXT DEFAULT 'claude-3-5-haiku-20241022',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL,
        downgraded INTEGER NOT NULL DEFAULT 0,
        failover_occurred INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL,
        status_code INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_tenant_time ON transactions(tenant_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);

      CREATE TABLE IF NOT EXISTS circuit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        reason TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_circuit_events_time ON circuit_events(provider_id, timestamp);

      CREATE TABLE IF NOT EXISTS failover_logs (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        attempted_provider TEXT NOT NULL,
        failed_status_code INTEGER,
        error_message TEXT,
        next_provider TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 1,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_failover_logs_time ON failover_logs(timestamp);

      CREATE TABLE IF NOT EXISTS loop_detections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        argument_hash TEXT NOT NULL,
        cycle_count INTEGER NOT NULL,
        prevented_cost_usd REAL NOT NULL DEFAULT 0.0,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_loop_detections_time ON loop_detections(timestamp);
    `;

    this.db.exec(schema);

    // Create default tenant if not exists
    const existing = this.db.prepare('SELECT id FROM tenants WHERE id = ?').get('default');
    if (!existing) {
      const now = Date.now();
      const insert = this.db.prepare(`
        INSERT INTO tenants (id, name, daily_limit_usd, monthly_limit_usd, auto_downgrade_enabled, fallback_model, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run('default', 'Default Workspace', 50.0, 500.0, 1, 'claude-3-5-haiku-20241022', now, now);
    }
  }

  private getStartOfDayUtc(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  private getStartOfMonthUtc(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  }

  public getTenantBudget(tenantId: string): TenantBudget {
    let tenantRow = this.db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId) as {
      id: string;
      name: string;
      daily_limit_usd: number;
      monthly_limit_usd: number;
      auto_downgrade_enabled: number;
      fallback_model?: string;
      updated_at: number;
    } | undefined;

    if (!tenantRow) {
      // Auto-create on demand with standard default limits
      const now = Date.now();
      this.db.prepare(`
        INSERT INTO tenants (id, name, daily_limit_usd, monthly_limit_usd, auto_downgrade_enabled, fallback_model, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(tenantId, `Tenant ${tenantId}`, 50.0, 500.0, 1, 'claude-3-5-haiku-20241022', now, now);

      tenantRow = {
        id: tenantId,
        name: `Tenant ${tenantId}`,
        daily_limit_usd: 50.0,
        monthly_limit_usd: 500.0,
        auto_downgrade_enabled: 1,
        fallback_model: 'claude-3-5-haiku-20241022',
        updated_at: now
      };
    }

    const startOfDay = this.getStartOfDayUtc();
    const startOfMonth = this.getStartOfMonthUtc();

    const dailyRow = this.db.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0.0) as spend
      FROM transactions
      WHERE tenant_id = ? AND timestamp >= ?
    `).get(tenantId, startOfDay) as { spend: number };

    const monthlyRow = this.db.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0.0) as spend
      FROM transactions
      WHERE tenant_id = ? AND timestamp >= ?
    `).get(tenantId, startOfMonth) as { spend: number };

    const currentDailySpendUsd = Number((dailyRow?.spend ?? 0).toFixed(6));
    const currentMonthlySpendUsd = Number((monthlyRow?.spend ?? 0).toFixed(6));

    let status: 'ACTIVE' | 'DOWNGRADED' | 'EXHAUSTED' = 'ACTIVE';
    if (
      currentDailySpendUsd >= tenantRow.daily_limit_usd ||
      currentMonthlySpendUsd >= tenantRow.monthly_limit_usd
    ) {
      status = 'EXHAUSTED';
    } else if (
      Boolean(tenantRow.auto_downgrade_enabled) &&
      (currentDailySpendUsd >= tenantRow.daily_limit_usd * 0.8 ||
       currentMonthlySpendUsd >= tenantRow.monthly_limit_usd * 0.8)
    ) {
      status = 'DOWNGRADED';
    }

    return {
      tenantId: tenantRow.id,
      name: tenantRow.name,
      dailyLimitUsd: tenantRow.daily_limit_usd,
      monthlyLimitUsd: tenantRow.monthly_limit_usd,
      currentDailySpendUsd,
      currentMonthlySpendUsd,
      autoDowngradeEnabled: Boolean(tenantRow.auto_downgrade_enabled),
      fallbackModel: tenantRow.fallback_model || undefined,
      status,
      updatedAt: tenantRow.updated_at
    };
  }

  public listTenants(): TenantBudget[] {
    const rows = this.db.prepare('SELECT id FROM tenants ORDER BY created_at ASC').all() as Array<{ id: string }>;
    return rows.map((r) => this.getTenantBudget(r.id));
  }

  public setTenantBudget(
    tenantId: string,
    updates: {
      name?: string;
      dailyLimitUsd?: number;
      monthlyLimitUsd?: number;
      autoDowngradeEnabled?: boolean;
      fallbackModel?: string;
    }
  ): TenantBudget {
    // Ensure tenant exists
    this.getTenantBudget(tenantId);

    const now = Date.now();
    const fields: string[] = ['updated_at = ?'];
    const values: (string | number)[] = [now];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.dailyLimitUsd !== undefined) {
      fields.push('daily_limit_usd = ?');
      values.push(updates.dailyLimitUsd);
    }
    if (updates.monthlyLimitUsd !== undefined) {
      fields.push('monthly_limit_usd = ?');
      values.push(updates.monthlyLimitUsd);
    }
    if (updates.autoDowngradeEnabled !== undefined) {
      fields.push('auto_downgrade_enabled = ?');
      values.push(updates.autoDowngradeEnabled ? 1 : 0);
    }
    if (updates.fallbackModel !== undefined) {
      fields.push('fallback_model = ?');
      values.push(updates.fallbackModel);
    }

    values.push(tenantId);
    this.db.prepare(`UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return this.getTenantBudget(tenantId);
  }

  public recordTransaction(telemetry: RequestTelemetry): void {
    const stmt = this.db.prepare(`
      INSERT INTO transactions (
        id, tenant_id, model, provider, prompt_tokens, completion_tokens,
        cached_tokens, cost_usd, downgraded, failover_occurred, latency_ms,
        status_code, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      telemetry.id,
      telemetry.tenantId,
      telemetry.dispatchedModel,
      telemetry.resolvedProvider,
      telemetry.inputTokens,
      telemetry.outputTokens,
      telemetry.cachedTokens,
      telemetry.costUsd,
      telemetry.downgraded ? 1 : 0,
      telemetry.failoverOccurred ? 1 : 0,
      telemetry.latencyMs,
      telemetry.statusCode,
      telemetry.timestamp
    );
  }

  public recordCircuitEvent(
    providerId: string,
    fromState: CircuitState,
    toState: CircuitState,
    reason: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO circuit_events (provider_id, from_state, to_state, reason, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(providerId, fromState, toState, reason, Date.now());
  }

  public recordFailover(log: {
    requestId: string;
    tenantId: string;
    attemptedProvider: string;
    failedStatusCode?: number;
    errorMessage?: string;
    nextProvider: string;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO failover_logs (
        id, request_id, tenant_id, attempted_provider, failed_status_code,
        error_message, next_provider, resolved, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const id = `fo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    stmt.run(
      id,
      log.requestId,
      log.tenantId,
      log.attemptedProvider,
      log.failedStatusCode ?? null,
      log.errorMessage ?? null,
      log.nextProvider,
      1,
      Date.now()
    );
  }

  public recordLoopDetection(
    tenantId: string,
    toolName: string,
    argumentHash: string,
    cycleCount: number,
    preventedCostUsd: number
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO loop_detections (
        tenant_id, tool_name, argument_hash, cycle_count, prevented_cost_usd, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(tenantId, toolName, argumentHash, cycleCount, preventedCostUsd, Date.now());
  }

  public getRecentTransactions(limit: number = 50): any[] {
    return this.db.prepare(`
      SELECT * FROM transactions ORDER BY timestamp DESC LIMIT ?
    `).all(limit);
  }

  public getRecentFailoverLogs(limit: number = 50): any[] {
    return this.db.prepare(`
      SELECT * FROM failover_logs ORDER BY timestamp DESC LIMIT ?
    `).all(limit);
  }

  public getRecentCircuitEvents(limit: number = 50): any[] {
    return this.db.prepare(`
      SELECT * FROM circuit_events ORDER BY timestamp DESC LIMIT ?
    `).all(limit);
  }

  public getMetrics(): LedgerMetrics {
    const txRow = this.db.prepare(`
      SELECT 
        COUNT(*) as total_requests,
        COALESCE(SUM(cost_usd), 0.0) as total_spend,
        COALESCE(SUM(CASE WHEN failover_occurred = 1 THEN 1 ELSE 0 END), 0) as total_failovers
      FROM transactions
    `).get() as { total_requests: number; total_spend: number; total_failovers: number };

    const loopRow = this.db.prepare(`
      SELECT 
        COUNT(*) as total_loops,
        COALESCE(SUM(prevented_cost_usd), 0.0) as total_loop_savings
      FROM loop_detections
    `).get() as { total_loops: number; total_loop_savings: number };

    return {
      totalSpendUsd: Number((txRow?.total_spend ?? 0).toFixed(4)),
      totalRequests: txRow?.total_requests ?? 0,
      totalFailovers: txRow?.total_failovers ?? 0,
      totalLoopsBlocked: loopRow?.total_loops ?? 0,
      totalSavingsUsd: Number((loopRow?.total_loop_savings ?? 0).toFixed(4)),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000)
    };
  }

  public getRawDb(): DatabaseSyncType {
    return this.db;
  }

  public close(): void {
    this.db.close();
  }
}
