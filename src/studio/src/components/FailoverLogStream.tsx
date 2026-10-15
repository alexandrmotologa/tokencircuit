import React, { useState } from 'react';
import { Layers, ArrowRight, ShieldCheck, Zap, AlertTriangle } from 'lucide-react';

interface Props {
  transactions: any[];
  failovers: any[];
}

export const FailoverLogStream: React.FC<Props> = ({ transactions, failovers }) => {
  const [filter, setFilter] = useState<'all' | 'failovers'>('all');

  const filteredTxs = filter === 'failovers'
    ? transactions.filter((t) => t.failover_occurred === 1)
    : transactions;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <span>Live Failover & Transaction Stream</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time audit log of routed inference requests, cross-provider failover hops, and cost ledger entries
          </p>
        </div>

        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs">
          <button
            onClick={() => setFilter('all')}
            className={`px-2.5 py-1 rounded-md font-medium transition ${
              filter === 'all'
                ? 'bg-slate-800 text-slate-100 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Requests ({transactions.length})
          </button>
          <button
            onClick={() => setFilter('failovers')}
            className={`px-2.5 py-1 rounded-md font-medium transition flex items-center gap-1 ${
              filter === 'failovers'
                ? 'bg-amber-950/80 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3 h-3 text-amber-400" />
            Failovers Only ({failovers.length})
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-[#111622]/90 backdrop-blur-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 border-b border-slate-800 text-slate-400 font-medium">
              <tr>
                <th className="py-2.5 px-3">Time</th>
                <th className="py-2.5 px-3">Tenant</th>
                <th className="py-2.5 px-3">Model</th>
                <th className="py-2.5 px-3">Resolved Route</th>
                <th className="py-2.5 px-3 text-right">Tokens</th>
                <th className="py-2.5 px-3 text-right">Cost (USD)</th>
                <th className="py-2.5 px-3 text-right">Latency</th>
                <th className="py-2.5 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredTxs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500 font-sans">
                    No transactions recorded yet. Send requests to /v1/chat/completions or /v1/messages to populate the live stream.
                  </td>
                </tr>
              ) : (
                filteredTxs.map((t) => {
                  const dateStr = new Date(t.timestamp).toLocaleTimeString();
                  const isFailover = t.failover_occurred === 1;
                  const isDowngraded = t.downgraded === 1;

                  return (
                    <tr
                      key={t.id}
                      className={`hover:bg-slate-900/40 transition-colors ${
                        isFailover ? 'bg-amber-950/10' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap">{dateStr}</td>
                      <td className="py-2.5 px-3 text-slate-300 font-sans">{t.tenant_id}</td>
                      <td className="py-2.5 px-3 text-slate-200">
                        <span>{t.model}</span>
                        {isDowngraded && (
                          <span className="ml-1.5 px-1.5 py-0.2 bg-amber-950/70 border border-amber-500/40 text-amber-300 rounded text-[10px] font-sans">
                            Downgraded
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300 font-sans">
                        {isFailover ? (
                          <span className="flex items-center gap-1.5 text-amber-300">
                            <Zap className="w-3 h-3 text-amber-400" />
                            <span>Failover &rarr; {t.provider}</span>
                          </span>
                        ) : (
                          <span className="text-slate-300">{t.provider}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        {t.prompt_tokens + t.completion_tokens}
                      </td>
                      <td className="py-2.5 px-3 text-right text-emerald-400 font-semibold">
                        ${t.cost_usd.toFixed(6)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-400">
                        {t.latency_ms}ms
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                          {t.status_code || 200} OK
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
