import React, { useState } from 'react';
import { Bell, CheckCircle2, AlertCircle, Send, Globe, Shield, RefreshCw } from 'lucide-react';

interface WebhookHistoryItem {
  id: string;
  timestamp: number;
  eventType: string;
  statusCode: number;
  success: boolean;
  attempt: number;
  url: string;
}

interface Props {
  webhookConfigured: boolean;
  history: WebhookHistoryItem[];
  onRefresh: () => Promise<void>;
}

export const WebhookSettings: React.FC<Props> = ({
  webhookConfigured,
  history,
  onRefresh
}) => {
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleSaveAndTest = async () => {
    if (!url.trim()) return;
    setTesting(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/studio/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: url.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage('Test alert successfully dispatched to endpoint.');
      } else {
        setStatusMessage('Webhook configured, but remote test ping returned an error or non-2xx status.');
      }
      await onRefresh();
    } catch {
      setStatusMessage('Failed to connect to TokenCircuit webhook service.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-[#111622]/90 backdrop-blur-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Bell className="w-4 h-4 text-amber-400" />
          <span>Incident Webhooks & On-Call Alerts</span>
        </h3>
        <div className="flex items-center gap-2">
          {webhookConfigured ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>ALERTS ACTIVE</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-500 font-mono">
              <AlertCircle className="w-3.5 h-3.5 text-slate-500" />
              <span>UNCONFIGURED</span>
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400">
        TokenCircuit dispatches automatic webhook payloads to Slack, Discord, PagerDuty, or custom receivers
        whenever circuits trip, budgets reach 80% downgrade or 100% exhaustion, or runaway loops are terminated.
      </p>

      {/* Webhook URL Input & Test Ping */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Globe className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/... or https://discord.com/api/webhooks/..."
            className="w-full bg-slate-900 border border-slate-800 pl-9 pr-3 py-2 rounded-lg text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
          />
        </div>
        <button
          onClick={handleSaveAndTest}
          disabled={testing || !url.trim()}
          className="px-4 py-2 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 flex items-center justify-center gap-2 transition"
        >
          {testing ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Verifying Drill...</span>
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              <span>Set & Drill Test</span>
            </>
          )}
        </button>
      </div>

      {statusMessage && (
        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300">
          {statusMessage}
        </div>
      )}

      {/* Recent Dispatches */}
      {history.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
            Recent Alert Dispatches
          </span>
          <div className="space-y-1.5 max-h-32 overflow-y-auto font-mono text-[11px]">
            {history.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-2 rounded bg-slate-900/60 border border-slate-800/80"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      item.success ? 'bg-emerald-400' : 'bg-rose-400'
                    }`}
                  />
                  <span className="text-slate-300">{item.eventType}</span>
                </div>
                <div className="flex items-center gap-3 text-slate-500">
                  <span>HTTP {item.statusCode || 0}</span>
                  <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
