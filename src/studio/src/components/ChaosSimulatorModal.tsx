import React, { useState } from 'react';
import { Play, Sparkles, AlertTriangle, ArrowRight, CheckCircle2, ShieldAlert } from 'lucide-react';

interface Props {
  onRefresh: () => Promise<void>;
}

export const ChaosSimulatorModal: React.FC<Props> = ({ onRefresh }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [scenarioOutput, setScenarioOutput] = useState<string | null>(null);

  const runScenario = async (scenario: 'failover' | 'budget' | 'loop' | 'chat') => {
    setIsRunning(true);
    setScenarioOutput(null);

    try {
      if (scenario === 'chat') {
        const res = await fetch('/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-tenant-id': 'default'
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: 'What is high-availability LLM circuit breaking?' }]
          })
        });

        const headers = {
          'x-tokencircuit-provider': res.headers.get('x-tokencircuit-provider'),
          'x-tokencircuit-model': res.headers.get('x-tokencircuit-model'),
          'x-tokencircuit-cost-usd': res.headers.get('x-tokencircuit-cost-usd'),
          'x-tokencircuit-failover': res.headers.get('x-tokencircuit-failover'),
          'x-tokencircuit-hops': res.headers.get('x-tokencircuit-hops'),
          'x-tokencircuit-downgraded': res.headers.get('x-tokencircuit-downgraded')
        };

        const data = await res.json();
        setScenarioOutput(
          `Status: ${res.status} OK\nHeaders:\n${JSON.stringify(headers, null, 2)}\n\nResponse:\n${JSON.stringify(data, null, 2)}`
        );
      } else {
        const res = await fetch('/api/studio/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scenario })
        });
        const data = await res.json();
        setScenarioOutput(JSON.stringify(data, null, 2));
      }

      await onRefresh();
    } catch (err: any) {
      setScenarioOutput(`Error running scenario: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>Interactive Chaos Lab & Traffic Generator</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Safely test cross-provider failover, loop interruption, and budget caps without consuming production credits
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <button
          onClick={() => runScenario('chat')}
          disabled={isRunning}
          className="p-3 text-left rounded-xl border border-slate-800 bg-[#111622]/90 hover:border-emerald-500/50 hover:bg-slate-900 transition flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Play className="w-3.5 h-3.5 text-emerald-400" />
              <span>Send Live Request</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Dispatches real /v1/chat/completions through gateway proxy and records telemetry.
            </p>
          </div>
          <span className="text-[10px] text-emerald-400 font-mono mt-2 block">&rarr; Run Inference</span>
        </button>

        <button
          onClick={() => runScenario('failover')}
          disabled={isRunning}
          className="p-3 text-left rounded-xl border border-slate-800 bg-[#111622]/90 hover:border-amber-500/50 hover:bg-slate-900 transition flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>Trip Bedrock Outage</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Simulates consecutive 503 errors on Bedrock, tripping circuit and triggering failover.
            </p>
          </div>
          <span className="text-[10px] text-amber-400 font-mono mt-2 block">&rarr; Test Failover</span>
        </button>

        <button
          onClick={() => runScenario('loop')}
          disabled={isRunning}
          className="p-3 text-left rounded-xl border border-slate-800 bg-[#111622]/90 hover:border-rose-500/50 hover:bg-slate-900 transition flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
              <span>Simulate Runaway Loop</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Fires identical tool call repetitions to trigger AgentLoopGuard termination.
            </p>
          </div>
          <span className="text-[10px] text-rose-400 font-mono mt-2 block">&rarr; Intercept Loop</span>
        </button>

        <button
          onClick={() => runScenario('budget')}
          disabled={isRunning}
          className="p-3 text-left rounded-xl border border-slate-800 bg-[#111622]/90 hover:border-blue-500/50 hover:bg-slate-900 transition flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />
              <span>Test Budget Cap</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Configures tenant with $0.05 cap to verify auto-downgrade and 402 rejection.
            </p>
          </div>
          <span className="text-[10px] text-blue-400 font-mono mt-2 block">&rarr; Test Budget</span>
        </button>
      </div>

      {scenarioOutput && (
        <div className="p-3 rounded-xl border border-slate-800 bg-slate-950 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-56">
          <pre>{scenarioOutput}</pre>
        </div>
      )}
    </div>
  );
};
