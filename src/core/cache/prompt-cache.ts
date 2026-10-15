import { createHash } from 'node:crypto';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { ChatMessage, NormalizedLLMResponse, ToolDefinition } from '../types.js';

export interface CacheEntry {
  hash: string;
  model: string;
  response: NormalizedLLMResponse;
  costSavedUsd: number;
  createdAt: number;
  expiresAt: number;
}

export interface CacheStats {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  totalCostSavedUsd: number;
}

export class PromptCache {
  private db: DatabaseSyncType;
  private defaultTtlSeconds: number;
  private hitCount = 0;
  private missCount = 0;
  private totalCostSavedUsd = 0;

  constructor(db: DatabaseSyncType, defaultTtlSeconds: number = 3600) {
    this.db = db;
    this.defaultTtlSeconds = defaultTtlSeconds;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_cache (
        hash TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        response_json TEXT NOT NULL,
        cost_saved_usd REAL NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_prompt_cache_expiry ON prompt_cache(expires_at);
    `);
  }

  public computeHash(model: string, messages: ChatMessage[], tools?: ToolDefinition[]): string {
    const normalizedData = {
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content.trim() : JSON.stringify(m.content),
        name: m.name,
        tool_call_id: m.tool_call_id
      })),
      tools: tools ? tools.map((t) => t.function.name).sort() : []
    };

    return createHash('sha256')
      .update(JSON.stringify(normalizedData))
      .digest('hex');
  }

  public get(
    model: string,
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): { response: NormalizedLLMResponse; costSavedUsd: number } | null {
    const hash = this.computeHash(model, messages, tools);
    const now = Date.now();

    const row = this.db.prepare(`
      SELECT response_json, cost_saved_usd, expires_at
      FROM prompt_cache
      WHERE hash = ? AND expires_at > ?
    `).get(hash, now) as { response_json: string; cost_saved_usd: number; expires_at: number } | undefined;

    if (!row) {
      this.missCount++;
      return null;
    }

    try {
      const response = JSON.parse(row.response_json) as NormalizedLLMResponse;
      this.hitCount++;
      this.totalCostSavedUsd += row.cost_saved_usd;
      return {
        response,
        costSavedUsd: row.cost_saved_usd
      };
    } catch {
      return null;
    }
  }

  public set(
    model: string,
    messages: ChatMessage[],
    response: NormalizedLLMResponse,
    costUsd: number,
    tools?: ToolDefinition[],
    ttlSeconds?: number
  ): void {
    const hash = this.computeHash(model, messages, tools);
    const now = Date.now();
    const ttl = (ttlSeconds || this.defaultTtlSeconds) * 1000;
    const expiresAt = now + ttl;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO prompt_cache (
        hash, model, response_json, cost_saved_usd, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(hash, model, JSON.stringify(response), costUsd, now, expiresAt);
  }

  public clear(): void {
    this.db.exec('DELETE FROM prompt_cache;');
  }

  public pruneExpired(): number {
    const now = Date.now();
    const beforeCount = (this.db.prepare('SELECT COUNT(*) as count FROM prompt_cache').get() as { count: number }).count;
    this.db.prepare('DELETE FROM prompt_cache WHERE expires_at <= ?').run(now);
    const afterCount = (this.db.prepare('SELECT COUNT(*) as count FROM prompt_cache').get() as { count: number }).count;
    return beforeCount - afterCount;
  }

  public getStats(): CacheStats {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM prompt_cache WHERE expires_at > ?').get(Date.now()) as { count: number };
    return {
      totalEntries: row?.count || 0,
      hitCount: this.hitCount,
      missCount: this.missCount,
      totalCostSavedUsd: Number(this.totalCostSavedUsd.toFixed(6))
    };
  }
}
