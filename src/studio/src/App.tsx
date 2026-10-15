import React, { useEffect, useState } from 'react';
import {
  Zap,
  Activity,
  DollarSign,
  Layers,
  Ban,
  RefreshCw,
  Server,
  ShieldCheck,
  TrendingUp,
  Clock
} from 'lucide-react';
import type { ProviderCircuitStatus, TenantBudget } from '../../core/types.js';
import { CircuitStatusGrid } from './components/CircuitStatusGrid.js';
import { BudgetMeters } from './components/BudgetMeters.js';
import { FailoverLogStream } from './components/FailoverLogStream.js';
import { EmergencyKillSwitch } from './components/EmergencyKillSwitch.js';
import { AgentLoopInspector } from './components/AgentLoopInspector.js';
import { ChaosSimulatorModal } from './components/ChaosSimulatorModal.js';

export default function App() {
  const [circuits, setCircuits] = useState<ProviderCircuitStatus[]>([]);
  const [tenants, setTenants] = useState<TenantBudget[]>([]);
  const [metrics, setMetrics] = useState({
    totalSpendUsd: 0,
    totalRequests: 0,
    totalFailovers: 0,
    totalLoopsBlocked: 0,
    totalSavingsUsd: 0,
    uptimeSeconds: 0
  });
  const [killSwitch, setKillSwitch] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [failovers, setFailovers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const [statusRes, logsRes] = await Promise.all([
        fetch('/api/studio/status'),
        fetch('/api/studio/logs')
      ]);

      if (statusRes.ok) {
        const data = await statusRes.json();
        setCircuits(data.circuits || []);
        setTenants(data.tenants || []);
        setMetrics(data.metrics || {});
        setKillSwitch(Boolean(data.killSwitch));
      }

      if (logsRes.ok) {
        const logs = await logsRes.json();
        setTransactions(logs.transactions || []);
        setFailovers(logs.failovers || []);
      }
    } catch {
      // Server may be in initialization
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2500);
    return () => clearInterval(interval);
  }, []);

  const handleTrip = async (providerId: string, reason?: string) => {
    await fetch('/api/studio/circuit/trip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, reason })
    });
    await fetchStatus();
  };

  const handleReset = async (providerId: string) => {
    await fetch('/api/studio/circuit/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId })
    });
    await fetchStatus();
  };

  const handleKillSwitch = async (active: boolean) => {
    await fetch('/api/studio/killswitch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active })
    });
    await fetchStatus();
  };

  const handleUpdateTenant = async (data: any) => {
    await fetch('/api/studio/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    await fetchStatus();
  };

  const formatUptime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    if (mins > 0) return `${mins}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col">
      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-[#0e131f]/90 backdrop-blur-md sticky top-0 z-30 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-sm">
            <Zap className="w-4 h-4 fill-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-white">TokenCircuit</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700/80 text-emerald-400">
                v1.0.0
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Enterprise LLM Circuit Breaker & Budget Gateway</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono bg-slate-900 border border-slate-800 px-3 py-1 rounded-lg text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Proxy: :50098</span>
          </div>

          <EmergencyKillSwitch isActive={killSwitch} onToggle={handleKillSwitch} />

          <button
            onClick={fetchStatus}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            title="Refresh Live Metrics"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Telemetry Summary Ribbon */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3.5 rounded-xl border border-slate-800 bg-[#111622]/80">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Total Spend</span>
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <span className="text-xl font-bold font-mono text-slate-100">
              ${metrics.totalSpendUsd?.toFixed(4)}
            </span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-800 bg-[#111622]/80">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Inbound Requests</span>
              <Activity className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <span className="text-xl font-bold font-mono text-slate-100">
              {metrics.totalRequests || 0}
            </span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-800 bg-[#111622]/80">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Failovers Diverted</span>
              <Zap className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <span className="text-xl font-bold font-mono text-amber-400">
              {metrics.totalFailovers || 0}
            </span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-800 bg-[#111622]/80">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Loops Intercepted</span>
              <Ban className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <span className="text-xl font-bold font-mono text-rose-400">
              {metrics.totalLoopsBlocked || 0}
            </span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-800 bg-[#111622]/80">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Prevented Spend</span>
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <span className="text-xl font-bold font-mono text-emerald-400">
              ${metrics.totalSavingsUsd?.toFixed(2)}
            </span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-800 bg-[#111622]/80">
            <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
              <span>Gateway Uptime</span>
              <Clock className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <span className="text-xl font-bold font-mono text-slate-100">
              {formatUptime(metrics.uptimeSeconds || 0)}
            </span>
          </div>
        </section>

        {/* Circuit Breakers Section */}
        <CircuitStatusGrid circuits={circuits} onTrip={handleTrip} onReset={handleReset} />

        {/* Chaos Lab & Simulator */}
        <ChaosSimulatorModal onRefresh={fetchStatus} />

        {/* Budget Ledgers Section */}
        <BudgetMeters tenants={tenants} onUpdateTenant={handleUpdateTenant} />

        {/* Live Transaction & Failover Log Stream */}
        <FailoverLogStream transactions={transactions} failovers={failovers} />

        {/* Runaway Agent Loop Breaker Stats */}
        <AgentLoopInspector
          totalLoopsBlocked={metrics.totalLoopsBlocked}
          totalSavingsUsd={metrics.totalSavingsUsd}
        />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 px-6 text-center text-xs text-slate-500 font-sans">
        <span>TokenCircuit &bull; High-Availability LLM Circuit Breaker & Financial Control Gateway</span>
      </footer>
    </div>
  );
}
