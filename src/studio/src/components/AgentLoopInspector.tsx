import React from 'react';
import { AlertCircle, Ban, ShieldCheck, Terminal } from 'lucide-react';

interface Props {
  totalLoopsBlocked: number;
  totalSavingsUsd: number;
}

export const AgentLoopInspector: React.FC<Props> = ({ totalLoopsBlocked, totalSavingsUsd }) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Ban className="w-4 h-4 text-emerald-400" />
            <span>Agent Runaway Loop Breaker</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Sliding window SHA-256 fingerprinting intercepting repetitive tool calls and ping-pong cycles before token exhaustion
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-slate-800 bg-[#111622]/90 backdrop-blur-sm">
          <span className="text-xs text-slate-400 block">Total Loops Terminated</span>
          <span className="text-2xl font-bold font-mono text-slate-100 mt-1 block">
            {totalLoopsBlocked}
          </span>
          <span className="text-[11px] text-slate-500 mt-1 block">Threshold: &ge; 3 identical cycles / 60s</span>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-[#111622]/90 backdrop-blur-sm">
          <span className="text-xs text-slate-400 block">Prevented Token Spend</span>
          <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
            ${totalSavingsUsd.toFixed(2)}
          </span>
          <span className="text-[11px] text-slate-500 mt-1 block">Saved from infinite agent reasoning recursion</span>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-[#111622]/90 backdrop-blur-sm flex flex-col justify-between">
          <div>
            <span className="text-xs text-slate-400 block">Active Protection Modes</span>
            <div className="mt-2 space-y-1 text-xs text-slate-300">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Deterministic Argument Hash Matching</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Alternating A-B Ping-Pong Interceptor</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
