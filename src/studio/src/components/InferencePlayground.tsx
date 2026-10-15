import React, { useState } from 'react';
import { Play, Sparkles, Zap, ShieldAlert, CheckCircle2, RefreshCw, Send, Terminal } from 'lucide-react';
import type { TenantBudget } from '../../core/types.js';

interface Props {
  tenants: TenantBudget[];
  onExecutionComplete: () => Promise<void>;
}

export const InferencePlayground: React.FC<Props> = ({ tenants, onExecutionComplete }) => {
  const [protocol, setProtocol] = useState<'openai' | 'anthropic'>('openai');
  const [model, setModel] = useState('gpt-4o');
  const [tenantId, setTenantId] = useState('default');
  const [systemPrompt, setSystemPrompt] = useState('You are an enterprise AI assistant running behind TokenCircuit gateway.');
  const [userPrompt, setUserPrompt] = useState('Explain how TokenCircuit protects LLM applications from multi-provider 5xx outages and 429 rate limit cascades.');
  const [isStreaming, setIsStreaming] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [streamOutput, setStreamOutput] = useState('');
  const [resultMetadata, setResultMetadata] = useState<{
    provider?: string;
    model?: string;
    costUsd?: string;
    failover?: string;
    hops?: string;
    downgraded?: string;
    cacheHit?: string;
    latencyMs?: number;
    status?: number;
  } | null>(null);

  const handleSend = async () => {
    setIsLoading(true);
    setStreamOutput('');
    setResultMetadata(null);

    const startTime = Date.now();
    const endpoint = protocol === 'openai' ? '/v1/chat/completions' : '/v1/messages';

    const payload =
      protocol === 'openai'
        ? {
            model,
            messages: [
              ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
              { role: 'user', content: userPrompt }
            ],
            stream: isStreaming
          }
        : {
            model,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
            stream: isStreaming
          };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId
        },
        body: JSON.stringify(payload)
      });

      const latencyMs = Date.now() - startTime;

      const meta = {
        provider: res.headers.get('x-tokencircuit-provider') || 'unknown',
        model: res.headers.get('x-tokencircuit-model') || model,
        costUsd: res.headers.get('x-tokencircuit-cost-usd') || '0.000000',
        failover: res.headers.get('x-tokencircuit-failover') || 'false',
        hops: res.headers.get('x-tokencircuit-hops') || '0',
        downgraded: res.headers.get('x-tokencircuit-downgraded') || 'false',
        cacheHit: res.headers.get('x-tokencircuit-cache-hit') || 'false',
        latencyMs,
        status: res.status
      };

      setResultMetadata(meta);

      if (isStreaming && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const textChunk = decoder.decode(value, { stream: true });
          const lines = textChunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ') && !line.includes('[DONE]')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                const delta = parsed.choices?.[0]?.delta?.content || '';
                accumulated += delta;
                setStreamOutput(accumulated);
              } catch {
                // Stream parsing
              }
            }
          }
        }
      } else {
        const data = await res.json();
        if (protocol === 'openai') {
          setStreamOutput(data.choices?.[0]?.message?.content || JSON.stringify(data, null, 2));
        } else {
          setStreamOutput(data.content?.[0]?.text || JSON.stringify(data, null, 2));
        }
      }

      await onExecutionComplete();
    } catch (err: any) {
      setStreamOutput(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>Interactive Inference Playground & Failover Inspector</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Test live proxy routing, streaming failover buffering, prompt caching, and auto-downgrade in real time
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Controls & Prompt Form */}
        <div className="lg:col-span-6 space-y-3 p-4 rounded-xl border border-slate-800 bg-[#111622]/90 backdrop-blur-sm">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Protocol</label>
              <select
                value={protocol}
                onChange={(e) => setProtocol(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 font-mono text-xs focus:border-emerald-500 focus:outline-none"
              >
                <option value="openai">OpenAI (/v1/chat)</option>
                <option value="anthropic">Anthropic (/v1/messages)</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Target Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 font-mono text-xs focus:border-emerald-500 focus:outline-none"
              >
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="claude-3-5-sonnet-20241022">claude-3-5-sonnet</option>
                <option value="claude-3-5-haiku-20241022">claude-3-5-haiku</option>
                <option value="anthropic.claude-3-5-sonnet-20241022-v2:0">bedrock-sonnet</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Tenant ID</label>
              <select
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 font-mono text-xs focus:border-emerald-500 focus:outline-none"
              >
                {tenants.map((t) => (
                  <option key={t.tenantId} value={t.tenantId}>
                    {t.tenantId}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Streaming</label>
              <button
                type="button"
                onClick={() => setIsStreaming(!isStreaming)}
                className={`w-full py-1.5 rounded-lg border text-xs font-semibold transition ${
                  isStreaming
                    ? 'bg-emerald-950 border-emerald-500 text-emerald-300'
                    : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {isStreaming ? 'SSE Active' : 'Off'}
              </button>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">System Prompt</label>
            <input
              type="text"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[11px] text-slate-400 block mb-1">User Prompt</label>
            <textarea
              rows={3}
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none resize-none font-sans"
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span>Overhead &lt; 1.5ms &bull; Zero downtime fallback</span>
            </span>

            <button
              onClick={handleSend}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Routing...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Request</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Output & Diagnostic Telemetry */}
        <div className="lg:col-span-6 space-y-3 p-4 rounded-xl border border-slate-800 bg-[#111622]/90 backdrop-blur-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-blue-400" />
                <span>Response Stream & Diagnostics</span>
              </span>

              {resultMetadata && (
                <div className="flex items-center gap-2 text-[11px] font-mono">
                  {resultMetadata.cacheHit === 'true' && (
                    <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">
                      CACHE HIT ($0.00)
                    </span>
                  )}
                  {resultMetadata.failover === 'true' && (
                    <span className="px-2 py-0.5 rounded bg-amber-950/80 border border-amber-500/40 text-amber-300">
                      FAILOVER ({resultMetadata.hops} hops)
                    </span>
                  )}
                  {resultMetadata.downgraded === 'true' && (
                    <span className="px-2 py-0.5 rounded bg-blue-950/80 border border-blue-500/40 text-blue-300">
                      DOWNGRADED
                    </span>
                  )}
                  <span className="text-slate-400">{resultMetadata.latencyMs}ms</span>
                </div>
              )}
            </div>

            <div className="h-44 overflow-y-auto bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 whitespace-pre-wrap leading-relaxed">
              {streamOutput || (
                <span className="text-slate-600 font-sans italic">
                  Waiting for request execution... Output and streaming tokens will render here.
                </span>
              )}
            </div>
          </div>

          {resultMetadata && (
            <div className="pt-2 border-t border-slate-800/80 grid grid-cols-4 gap-2 text-[11px] font-mono">
              <div className="bg-slate-900/60 p-2 rounded border border-slate-800">
                <span className="text-slate-500 block text-[10px]">RESOLVED</span>
                <span className="font-semibold text-slate-200">{resultMetadata.provider}</span>
              </div>
              <div className="bg-slate-900/60 p-2 rounded border border-slate-800">
                <span className="text-slate-500 block text-[10px]">MODEL</span>
                <span className="font-semibold text-slate-200 truncate block">{resultMetadata.model}</span>
              </div>
              <div className="bg-slate-900/60 p-2 rounded border border-slate-800">
                <span className="text-slate-500 block text-[10px]">COST</span>
                <span className="font-semibold text-emerald-400">${resultMetadata.costUsd}</span>
              </div>
              <div className="bg-slate-900/60 p-2 rounded border border-slate-800">
                <span className="text-slate-500 block text-[10px]">STATUS</span>
                <span className="font-semibold text-emerald-400">{resultMetadata.status} OK</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
