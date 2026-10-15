import React, { useState } from 'react';
import { ShieldAlert, ShieldCheck, Power } from 'lucide-react';

interface Props {
  isActive: boolean;
  onToggle: (active: boolean) => Promise<void>;
}

export const EmergencyKillSwitch: React.FC<Props> = ({ isActive, onToggle }) => {
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    setLoading(true);
    try {
      await onToggle(!isActive);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleToggle}
        disabled={loading}
        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all shadow-sm ${
          isActive
            ? 'bg-rose-600 text-white hover:bg-rose-500 animate-pulse border border-rose-400'
            : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700/80'
        }`}
        title={isActive ? 'Emergency traffic halt is engaged' : 'Emergency global kill-switch'}
      >
        <Power className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
        <span>{isActive ? 'KILL-SWITCH ENGAGED' : 'EMERGENCY HALT'}</span>
      </button>

      {isActive && (
        <span className="flex items-center gap-1.5 text-xs text-rose-400 font-medium bg-rose-950/60 px-2.5 py-1 rounded border border-rose-800/60 animate-bounce">
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>All Outbound LLM Requests Blocked (HTTP 503)</span>
        </span>
      )}
    </div>
  );
};
