import React from 'react';
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, XCircle, Flame } from 'lucide-react';
import type { ProviderCircuitStatus } from '../../core/types.js';

interface Props {
  circuits: ProviderCircuitStatus[];
  onTrip: (providerId: string, reason?: string) => Promise<void>;
  onReset: (providerId: string) => Promise<void>;
}

export const CircuitStatusGrid: React.FC<Props> = ({ circuits, onTrip, onReset }) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>Multi-Provider Circuit Breakers</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Three-state automated failover monitors diverting traffic at 3 consecutive 5xx/429 errors
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {circuits.map((c) => {
          const isClosed = c.state === 'CLOSED';
          const isOpen = c.state === 'OPEN';
          const isHalfOpen = c.state === 'HALF_OPEN';

          return (
            <div
              key={c.providerId}
              className={`rounded-xl border p-4 bg-[#111622]/90 backdrop-blur-sm transition-all flex flex-col justify-between ${
                isOpen
                  ? 'border-rose-500/50 shadow-rose-950/20 shadow-lg'
                  : isHalfOpen
                  ? 'border-amber-500/50 shadow-amber-950/20 shadow-lg'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-sm text-slate-100">{c.name}</h3>
                    <span className="text-[11px] font-mono text-slate-400">{c.providerId}</span>
                  </div>

                  {isClosed && (
                    <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950/60 border border-emerald-500/40 text-emerald-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      CLOSED (Healthy)
                    </span>
                  )}

                  {isOpen && (
                    <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-950/70 border border-rose-500/50 text-rose-300 animate-pulse">
                      <XCircle className="w-3.5 h-3.5 text-rose-400" />
                      OPEN (Tripped)
                    </span>
                  )}

                  {isHalfOpen && (
                    <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-950/70 border border-amber-500/50 text-amber-300">
                      <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
                      HALF-OPEN (Probing)
                    </span>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-2.5">
                    <span className="text-slate-400 block text-[11px]">Sliding Window Errors</span>
                    <span className={`font-mono text-base font-bold ${c.failureCount > 0 ? 'text-rose-400' : 'text-slate-200'}`}>
                      {c.failureCount} / 3
                    </span>
                  </div>

                  <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg p-2.5">
                    <span className="text-slate-400 block text-[11px]">Latency P50 / P95</span>
                    <span className="font-mono text-base font-bold text-slate-200">
                      {c.latencyMsP50}ms <span className="text-xs text-slate-500">/ {c.latencyMsP95}ms</span>
                    </span>
                  </div>
                </div>

                {c.isManuallyTripped && (
                  <div className="mt-2.5 text-[11px] text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded px-2 py-1">
                    <span className="font-semibold">Operator Trip:</span> {c.manualTripReason || 'Manual lock'}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                {isClosed && (
                  <button
                    onClick={() => onTrip(c.providerId, 'Operator manual drill')}
                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800/80 text-rose-300 hover:bg-rose-950/40 hover:text-rose-200 hover:border-rose-500/40 border border-slate-700/60 transition"
                  >
                    <Flame className="w-3.5 h-3.5 text-rose-400" />
                    <span>Trip Circuit (Test Failover)</span>
                  </button>
                )}

                {(isOpen || isHalfOpen) && (
                  <button
                    onClick={() => onReset(c.providerId)}
                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50 border border-emerald-500/40 transition"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Reset Circuit (CLOSED)</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
