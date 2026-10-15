import React, { useState } from 'react';
import { Download, FileSpreadsheet, FileCode, Activity, Check } from 'lucide-react';

export const AuditExportBar: React.FC = () => {
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [downloadingJson, setDownloadingJson] = useState(false);

  const handleDownloadCsv = async () => {
    setDownloadingCsv(true);
    try {
      const res = await fetch('/api/studio/export/csv');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tokencircuit_audit_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } finally {
      setDownloadingCsv(false);
    }
  };

  const handleDownloadJson = async () => {
    setDownloadingJson(true);
    try {
      const res = await fetch('/api/studio/export/json');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tokencircuit_dump_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } finally {
      setDownloadingJson(false);
    }
  };

  return (
    <div className="p-4 rounded-xl border border-slate-800 bg-[#111622]/90 backdrop-blur-sm flex flex-col sm:flex-row items-center justify-between gap-4">
      <div className="space-y-0.5 text-center sm:text-left">
        <h3 className="text-sm font-semibold text-slate-100 flex items-center justify-center sm:justify-start gap-2">
          <Download className="w-4 h-4 text-emerald-400" />
          <span>Audit & Compliance Exports</span>
        </h3>
        <p className="text-xs text-slate-400">
          SOC2 & FinOps ready transaction ledgers, failover hop records, and Prometheus metrics.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* CSV Export Button */}
        <button
          onClick={handleDownloadCsv}
          disabled={downloadingCsv}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-200 hover:bg-slate-800 transition"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
          <span>{downloadingCsv ? 'Exporting...' : 'Export CSV Ledger'}</span>
        </button>

        {/* JSON Export Button */}
        <button
          onClick={handleDownloadJson}
          disabled={downloadingJson}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-200 hover:bg-slate-800 transition"
        >
          <FileCode className="w-3.5 h-3.5 text-blue-400" />
          <span>{downloadingJson ? 'Dumping...' : 'Full JSON Dump'}</span>
        </button>

        {/* Prometheus Metrics Endpoint Link */}
        <a
          href="/metrics"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-200 hover:bg-slate-800 transition"
        >
          <Activity className="w-3.5 h-3.5 text-purple-400" />
          <span>OpenMetrics /metrics</span>
        </a>
      </div>
    </div>
  );
};
