import React, { useState } from 'react';
import { DollarSign, Shield, ArrowDownCircle, AlertOctagon, Plus, Check } from 'lucide-react';
import type { TenantBudget } from '../../core/types.js';

interface Props {
  tenants: TenantBudget[];
  onUpdateTenant: (data: {
    tenantId: string;
    dailyLimitUsd?: number;
    monthlyLimitUsd?: number;
    autoDowngradeEnabled?: boolean;
    fallbackModel?: string;
  }) => Promise<void>;
}

export const BudgetMeters: React.FC<Props> = ({ tenants, onUpdateTenant }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDaily, setEditDaily] = useState<string>('50');
  const [editMonthly, setEditMonthly] = useState<string>('500');
  const [editDowngrade, setEditDowngrade] = useState<boolean>(true);

  const [newTenantId, setNewTenantId] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const startEdit = (t: TenantBudget) => {
    setEditingId(t.tenantId);
    setEditDaily(t.dailyLimitUsd.toString());
    setEditMonthly(t.monthlyLimitUsd.toString());
    setEditDowngrade(t.autoDowngradeEnabled);
  };

  const saveEdit = async (tenantId: string) => {
    await onUpdateTenant({
      tenantId,
      dailyLimitUsd: parseFloat(editDaily),
      monthlyLimitUsd: parseFloat(editMonthly),
      autoDowngradeEnabled: editDowngrade
    });
    setEditingId(null);
  };

  const handleCreate = async () => {
    if (!newTenantId.trim()) return;
    await onUpdateTenant({
      tenantId: newTenantId.trim(),
      dailyLimitUsd: 25.0,
      monthlyLimitUsd: 250.0,
      autoDowngradeEnabled: true
    });
    setNewTenantId('');
    setIsAdding(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            <span>Tenant Spend Ledgers & Budget Ceilings</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Hard financial caps with automatic model downgrades (Sonnet &rarr; Haiku) at 80% quota
          </p>
        </div>

        <button
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
        >
          <Plus className="w-3.5 h-3.5 text-emerald-400" />
          <span>New Tenant</span>
        </button>
      </div>

      {isAdding && (
        <div className="p-3 bg-slate-900/90 border border-emerald-500/30 rounded-xl flex items-center gap-3">
          <input
            type="text"
            placeholder="tenant-id (e.g. acme-backend)"
            value={newTenantId}
            onChange={(e) => setNewTenantId(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500 flex-1"
          />
          <button
            onClick={handleCreate}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold"
          >
            Create Ledger
          </button>
          <button
            onClick={() => setIsAdding(false)}
            className="px-2.5 py-1.5 text-slate-400 hover:text-slate-200 text-xs"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tenants.map((t) => {
          const dailyPct = Math.min(100, Math.round((t.currentDailySpendUsd / (t.dailyLimitUsd || 1)) * 100));
          const monthlyPct = Math.min(100, Math.round((t.currentMonthlySpendUsd / (t.monthlyLimitUsd || 1)) * 100));

          const isExhausted = t.status === 'EXHAUSTED';
          const isDowngraded = t.status === 'DOWNGRADED';

          const isEditing = editingId === t.tenantId;

          return (
            <div
              key={t.tenantId}
              className={`rounded-xl border p-4 bg-[#111622]/90 backdrop-blur-sm transition-all ${
                isExhausted
                  ? 'border-rose-500/40 shadow-rose-950/20 shadow-md'
                  : isDowngraded
                  ? 'border-amber-500/40 shadow-amber-950/20 shadow-md'
                  : 'border-slate-800'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-sm text-slate-100">{t.name}</h3>
                  <span className="text-[11px] font-mono text-slate-400">{t.tenantId}</span>
                </div>

                {isExhausted && (
                  <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-950/70 border border-rose-500/50 text-rose-300">
                    <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
                    EXHAUSTED (Blocked)
                  </span>
                )}

                {isDowngraded && (
                  <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-950/70 border border-amber-500/50 text-amber-300">
                    <ArrowDownCircle className="w-3.5 h-3.5 text-amber-400" />
                    DOWNGRADED (80% Cap)
                  </span>
                )}

                {!isExhausted && !isDowngraded && (
                  <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950/60 border border-emerald-500/40 text-emerald-300">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                    ACTIVE
                  </span>
                )}
              </div>

              {/* Spend Meters */}
              <div className="mt-4 space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">Daily Spend:</span>
                    <span className="font-mono text-slate-200">
                      ${t.currentDailySpendUsd.toFixed(4)} <span className="text-slate-500">/ ${t.dailyLimitUsd.toFixed(2)}</span> ({dailyPct}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        dailyPct >= 100
                          ? 'bg-rose-500'
                          : dailyPct >= 80
                          ? 'bg-amber-400'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${dailyPct}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">Monthly Spend:</span>
                    <span className="font-mono text-slate-200">
                      ${t.currentMonthlySpendUsd.toFixed(4)} <span className="text-slate-500">/ ${t.monthlyLimitUsd.toFixed(2)}</span> ({monthlyPct}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        monthlyPct >= 100
                          ? 'bg-rose-500'
                          : monthlyPct >= 80
                          ? 'bg-amber-400'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${monthlyPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Inline Edit Form */}
              {isEditing ? (
                <div className="mt-3 pt-3 border-t border-slate-800 space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-0.5">Daily Cap ($)</label>
                      <input
                        type="number"
                        value={editDaily}
                        onChange={(e) => setEditDaily(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-0.5">Monthly Cap ($)</label>
                      <input
                        type="number"
                        value={editMonthly}
                        onChange={(e) => setEditMonthly(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="checkbox"
                      id={`auto-dg-${t.tenantId}`}
                      checked={editDowngrade}
                      onChange={(e) => setEditDowngrade(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-700 text-emerald-500"
                    />
                    <label htmlFor={`auto-dg-${t.tenantId}`} className="text-slate-300 text-[11px]">
                      Enable auto-downgrade to Haiku at 80% quota
                    </label>
                  </div>

                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-2 py-1 text-slate-400 hover:text-slate-200"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => saveEdit(t.tenantId)}
                      className="flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium"
                    >
                      <Check className="w-3 h-3" />
                      Save Caps
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                  <div className="text-[11px] text-slate-400">
                    Downgrade: <span className="text-slate-200 font-mono">{t.autoDowngradeEnabled ? 'Enabled (Haiku)' : 'Disabled'}</span>
                  </div>
                  <button
                    onClick={() => startEdit(t)}
                    className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
                  >
                    Adjust Caps
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
