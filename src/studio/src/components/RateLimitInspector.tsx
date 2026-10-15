import React, { useState } from 'react';
import { Gauge, ShieldCheck, AlertTriangle, Edit2, Check, X, RefreshCw } from 'lucide-react';

export interface TenantRateLimitInfo {
  tenantId: string;
  currentRpm: number;
  currentTpm: number;
  maxRpm: number;
  maxTpm: number;
}

interface Props {
  limits: TenantRateLimitInfo[];
  onRefresh: () => Promise<void>;
}

export const RateLimitInspector: React.FC<Props> = ({ limits, onRefresh }) => {
  const [editingTenant, setEditingTenant] = useState<string | null>(null);
  const [editRpm, setEditRpm] = useState<number>(60);
  const [editTpm, setEditTpm] = useState<number>(100000);
  const [saving, setSaving] = useState(false);

  const startEdit = (tenant: TenantRateLimitInfo) => {
    setEditingTenant(tenant.tenantId);
    setEditRpm(tenant.maxRpm);
    setEditTpm(tenant.maxTpm);
  };

  const cancelEdit = () => {
    setEditingTenant(null);
  };

  const saveEdit = async (tenantId: string) => {
    setSaving(true);
    try {
      await fetch('/api/studio/ratelimit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          maxRpm: editRpm,
          maxTpm: editTpm
        })
      });
      await onRefresh();
      setEditingTenant(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-[#111622]/90 backdrop-blur-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-cyan-400" />
          <span>Tenant Rate Limiter (RPM / TPM Sliding Windows)</span>
        </h3>
        <span className="text-xs text-slate-400">Enforces 429 backoff before upstream saturation</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {limits.length === 0 ? (
          <div className="col-span-full py-4 text-center text-xs text-slate-500">
            No tenant rate limit activity recorded yet.
          </div>
        ) : (
          limits.map((tenant) => {
            const isEditing = editingTenant === tenant.tenantId;
            const rpmPercent = Math.min(100, Math.round((tenant.currentRpm / (tenant.maxRpm || 1)) * 100));
            const tpmPercent = Math.min(100, Math.round((tenant.currentTpm / (tenant.maxTpm || 1)) * 100));

            const rpmColor =
              rpmPercent >= 90 ? 'bg-rose-500' : rpmPercent >= 70 ? 'bg-amber-500' : 'bg-cyan-500';
            const tpmColor =
              tpmPercent >= 90 ? 'bg-rose-500' : tpmPercent >= 70 ? 'bg-amber-500' : 'bg-emerald-500';

            return (
              <div
                key={tenant.tenantId}
                className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/80 flex flex-col justify-between space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-200">
                      {tenant.tenantId}
                    </span>
                    {rpmPercent >= 90 || tpmPercent >= 90 ? (
                      <span className="flex items-center gap-1 text-[10px] text-rose-400 font-mono">
                        <AlertTriangle className="w-3 h-3 text-rose-400" />
                        THROTTLED
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        NORMAL
                      </span>
                    )}
                  </div>

                  {!isEditing ? (
                    <button
                      onClick={() => startEdit(tenant)}
                      className="p-1 text-slate-500 hover:text-slate-200 rounded transition"
                      title="Adjust rate limits"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  ) : null}
                </div>

                {/* RPM Meter */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>RPM (Requests/min)</span>
                    <span className="font-mono text-slate-300">
                      {tenant.currentRpm} / {tenant.maxRpm}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${rpmColor}`}
                      style={{ width: `${rpmPercent}%` }}
                    />
                  </div>
                </div>

                {/* TPM Meter */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>TPM (Tokens/min)</span>
                    <span className="font-mono text-slate-300">
                      {tenant.currentTpm.toLocaleString()} / {tenant.maxTpm.toLocaleString()}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${tpmColor}`}
                      style={{ width: `${tpmPercent}%` }}
                    />
                  </div>
                </div>

                {/* Inline Edit Form */}
                {isEditing && (
                  <div className="pt-2 border-t border-slate-800 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-0.5">Max RPM</label>
                        <input
                          type="number"
                          value={editRpm}
                          onChange={(e) => setEditRpm(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-xs text-slate-100 font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-0.5">Max TPM</label>
                        <input
                          type="number"
                          value={editTpm}
                          onChange={(e) => setEditTpm(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-xs text-slate-100 font-mono"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-1.5 pt-1">
                      <button
                        onClick={cancelEdit}
                        disabled={saving}
                        className="px-2 py-0.5 rounded text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-400 flex items-center gap-1"
                      >
                        <X className="w-3 h-3" />
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(tenant.tenantId)}
                        disabled={saving}
                        className="px-2.5 py-0.5 rounded text-[11px] bg-cyan-600 hover:bg-cyan-500 text-white flex items-center gap-1 font-medium"
                      >
                        <Check className="w-3 h-3" />
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
