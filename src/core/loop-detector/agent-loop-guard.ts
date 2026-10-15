import { createHash } from 'node:crypto';
import type { ChatMessage, LoopDetectionResult, ToolCallFingerprint } from '../types.js';

export interface LoopGuardConfig {
  enabled: boolean;
  windowSeconds: number;
  maxIdenticalCalls: number;
  blockAction: 'TERMINATE_WITH_WARNING' | 'ALLOW';
}

export class AgentLoopGuard {
  private config: LoopGuardConfig;
  private fingerprints: Map<string, ToolCallFingerprint[]> = new Map();
  private callSequences: Map<string, string[]> = new Map();

  constructor(
    config: LoopGuardConfig = {
      enabled: true,
      windowSeconds: 60,
      maxIdenticalCalls: 3,
      blockAction: 'TERMINATE_WITH_WARNING'
    }
  ) {
    this.config = config;
  }

  /**
   * Normalizes argument objects and generates a deterministic SHA-256 hash.
   */
  public hashArguments(args: unknown): string {
    if (!args) return 'empty';
    let str: string;
    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args);
        str = JSON.stringify(this.sortObjectKeys(parsed));
      } catch {
        str = args.trim();
      }
    } else {
      str = JSON.stringify(this.sortObjectKeys(args));
    }
    return createHash('sha256').update(str).digest('hex').slice(0, 16);
  }

  private sortObjectKeys(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sortObjectKeys(item));
    }
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = this.sortObjectKeys(obj[key]);
    }
    return sorted;
  }

  private cleanOldEntries(sessionKey: string): void {
    const list = this.fingerprints.get(sessionKey);
    if (!list) return;

    const cutoff = Date.now() - this.config.windowSeconds * 1000;
    const filtered = list.filter((item) => item.timestamp >= cutoff);
    this.fingerprints.set(sessionKey, filtered);
  }

  /**
   * Inspects incoming request messages for runaway tool calls or repetitive patterns.
   */
  public inspectRequest(
    sessionKey: string,
    messages: ChatMessage[]
  ): LoopDetectionResult {
    if (!this.config.enabled) {
      return { isLooping: false, repeatedCycleCount: 0, actionTaken: 'ALLOW' };
    }

    this.cleanOldEntries(sessionKey);

    // Extract tool calls and tool results from recent messages
    const recentToolCalls: Array<{ name: string; args: unknown }> = [];

    for (let i = messages.length - 1; i >= 0 && i >= messages.length - 6; i--) {
      const msg = messages[i];
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          recentToolCalls.push({
            name: tc.function.name,
            args: tc.function.arguments
          });
        }
      }

      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use' && block.name) {
            recentToolCalls.push({
              name: block.name,
              args: block.input
            });
          }
        }
      }
    }

    if (recentToolCalls.length === 0) {
      // Check for prompt trigram repetition in the last message
      const lastMsg = messages[messages.length - 1];
      const text = typeof lastMsg?.content === 'string' ? lastMsg.content : '';
      if (text.length > 200 && this.hasRepetitiveTrigrams(text)) {
        return {
          isLooping: true,
          repeatedCycleCount: 4,
          actionTaken: this.config.blockAction,
          reason: 'Severe token trigram repetition loop detected in agent context.'
        };
      }
      return { isLooping: false, repeatedCycleCount: 0, actionTaken: 'ALLOW' };
    }

    let history = this.fingerprints.get(sessionKey);
    if (!history) {
      history = [];
      this.fingerprints.set(sessionKey, history);
    }

    let maxCycleCount = 0;
    let loopingToolName: string | undefined;

    for (const tc of recentToolCalls) {
      const argHash = this.hashArguments(tc.args);
      const existing = history.find(
        (f) => f.toolName === tc.name && f.argumentHash === argHash
      );

      if (existing) {
        existing.callCount += 1;
        existing.timestamp = Date.now();
        if (existing.callCount > maxCycleCount) {
          maxCycleCount = existing.callCount;
          loopingToolName = tc.name;
        }
      } else {
        history.push({
          toolName: tc.name,
          argumentHash: argHash,
          timestamp: Date.now(),
          callCount: 1
        });
      }
    }

    // Ping-pong sequence detection (A -> B -> A -> B -> A -> B)
    let seq = this.callSequences.get(sessionKey);
    if (!seq) {
      seq = [];
      this.callSequences.set(sessionKey, seq);
    }

    for (const tc of recentToolCalls) {
      seq.push(tc.name);
    }
    if (seq.length > 12) {
      seq = seq.slice(seq.length - 12);
      this.callSequences.set(sessionKey, seq);
    }

    if (this.isPingPongSequence(seq)) {
      return {
        isLooping: true,
        repeatedCycleCount: 3,
        detectedToolName: seq[seq.length - 1],
        actionTaken: this.config.blockAction,
        reason: `Alternating ping-pong tool cycle detected between [${seq.slice(-4).join(', ')}]`
      };
    }

    if (maxCycleCount >= this.config.maxIdenticalCalls) {
      return {
        isLooping: true,
        repeatedCycleCount: maxCycleCount,
        detectedToolName: loopingToolName,
        actionTaken: this.config.blockAction,
        reason: `Tool "${loopingToolName}" invoked ${maxCycleCount} times with identical arguments within ${this.config.windowSeconds}s window.`
      };
    }

    return {
      isLooping: false,
      repeatedCycleCount: maxCycleCount,
      actionTaken: 'ALLOW'
    };
  }

  private isPingPongSequence(seq: string[]): boolean {
    if (seq.length < 6) return false;
    const last6 = seq.slice(-6);
    return (
      last6[0] === last6[2] &&
      last6[2] === last6[4] &&
      last6[1] === last6[3] &&
      last6[3] === last6[5] &&
      last6[0] !== last6[1]
    );
  }

  private hasRepetitiveTrigrams(text: string): boolean {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length < 30) return false;

    const trigrams: Record<string, number> = {};
    for (let i = 0; i < words.length - 2; i++) {
      const tri = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      trigrams[tri] = (trigrams[tri] ?? 0) + 1;
      if (trigrams[tri] >= 6) {
        return true;
      }
    }
    return false;
  }

  public reset(sessionKey: string): void {
    this.fingerprints.delete(sessionKey);
    this.callSequences.delete(sessionKey);
  }

  public clearAll(): void {
    this.fingerprints.clear();
    this.callSequences.clear();
  }
}
