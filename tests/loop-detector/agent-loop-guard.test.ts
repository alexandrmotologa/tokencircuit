import { describe, it, expect, beforeEach } from 'vitest';
import { AgentLoopGuard } from '../../src/core/loop-detector/agent-loop-guard.js';
import type { ChatMessage } from '../../src/core/types.js';

describe('AgentLoopGuard (Runaway Agent Loop Breaker)', () => {
  let loopGuard: AgentLoopGuard;

  beforeEach(() => {
    loopGuard = new AgentLoopGuard({
      enabled: true,
      windowSeconds: 60,
      maxIdenticalCalls: 3,
      blockAction: 'TERMINATE_WITH_WARNING'
    });
  });

  it('permits distinct tool calls without blocking', () => {
    const messages1: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/app.ts' }) }
          }
        ]
      }
    ];

    const res1 = loopGuard.inspectRequest('session_1', messages1);
    expect(res1.isLooping).toBe(false);
    expect(res1.actionTaken).toBe('ALLOW');

    const messages2: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_2',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/utils.ts' }) }
          }
        ]
      }
    ];

    const res2 = loopGuard.inspectRequest('session_1', messages2);
    expect(res2.isLooping).toBe(false);
    expect(res2.actionTaken).toBe('ALLOW');
  });

  it('detects and terminates 3 identical tool calls with identical arguments', () => {
    const duplicateMessage: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_x',
            type: 'function',
            function: { name: 'search_query', arguments: JSON.stringify({ q: 'error_log' }) }
          }
        ]
      }
    ];

    // Call 1
    const res1 = loopGuard.inspectRequest('session_loop', duplicateMessage);
    expect(res1.isLooping).toBe(false);

    // Call 2
    const res2 = loopGuard.inspectRequest('session_loop', duplicateMessage);
    expect(res2.isLooping).toBe(false);

    // Call 3 (breaches threshold of 3)
    const res3 = loopGuard.inspectRequest('session_loop', duplicateMessage);
    expect(res3.isLooping).toBe(true);
    expect(res3.actionTaken).toBe('TERMINATE_WITH_WARNING');
    expect(res3.detectedToolName).toBe('search_query');
    expect(res3.repeatedCycleCount).toBe(3);
    expect(res3.reason).toContain('search_query');
  });

  it('detects alternating ping-pong tool cycles [A, B, A, B, A, B]', () => {
    const makeToolMsg = (name: string, argVal: string): ChatMessage[] => [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: `call_${Math.random()}`,
            type: 'function',
            function: { name, arguments: JSON.stringify({ v: argVal }) }
          }
        ]
      }
    ];

    loopGuard.inspectRequest('ping_pong_session', makeToolMsg('toolA', '1'));
    loopGuard.inspectRequest('ping_pong_session', makeToolMsg('toolB', '2'));
    loopGuard.inspectRequest('ping_pong_session', makeToolMsg('toolA', '3'));
    loopGuard.inspectRequest('ping_pong_session', makeToolMsg('toolB', '4'));
    loopGuard.inspectRequest('ping_pong_session', makeToolMsg('toolA', '5'));
    const res = loopGuard.inspectRequest('ping_pong_session', makeToolMsg('toolB', '6'));

    expect(res.isLooping).toBe(true);
    expect(res.reason).toContain('ping-pong');
  });
});
