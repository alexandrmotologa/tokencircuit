import React, { useState } from 'react';
import { Database, Zap, Trash2, ShieldCheck, RefreshCw } from 'lucide-react';

interface CacheStats {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  totalCostSavedUsd: number;
}

interface Props {
  stats: CacheStats;
  onRefresh: () => Promise<void>;
}

export const CacheInspector: React.FC<Props> = ({ stats, onRefresh }) => {
  const [clearing, setClearing] = useState(false);

  const handleClear = async () => {
    setClearing(true);
    try {
      await fetch('/api/studio/cache/clear', { method: 'POST' });
      await onRefresh();
    } finally {
      setClearing(false);
    }
  };

  const totalLookups = (stats.hitCount || 0) + (stats.missCount || 0);
  const hitRatio = totalLookups > 0 ? Math.round((stats.hitCount / totalLookups) * 100) : 0;

  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-[#111622]/90 backdrop-blur-sm space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Database className="w-4 h-4 text-emerald-400" />
          <span>Prompt & Token Cache (Zero-Cost Hits)</span>
        </h3>

        <button
          onClick={handleClear}
          disabled={clearing}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-400 border border-slate-700 transition"
        >
          <Trash2 className="w-3 h-3" />
          <span>Clear Cache</span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
          <span className="text-[11px] text-slate-400 block">Cached Prompts</span>
          <span className="font-mono text-base font-bold text-slate-100">{stats.totalEntries || 0}</span>
        </div>

        <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
          <span className="text-[11px] text-slate-400 block">Cache Hits</span>
          <span className="font-mono text-base font-bold text-emerald-400">{stats.hitCount || 0}</span>
        </div>

        <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
          <span className="text-[11px] text-slate-400 block">Hit Ratio</span>
          <span className="font-mono text-base font-bold text-slate-100">{hitRatio}%</span>
        </div>

        <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
          <span className="text-[11px] text-slate-400 block">Saved Budget (USD)</span>
          <span className="font-mono text-base font-bold text-emerald-400">
            ${stats.totalCostSavedUsd?.toFixed(4) || '0.0000'}
          </span>
        </div>
      </div>
    </div>
  );
};
