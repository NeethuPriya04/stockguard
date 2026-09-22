import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getAllLedger, getAllAudit } from './db.js';

export default function Dashboard() {
  const [ledgerList, setLedgerList] = useState([]);
  const [auditList, setAuditList] = useState([]);

  const loadData = async () => {
    try {
      const [ledger, audit] = await Promise.all([getAllLedger(), getAllAudit()]);
      setLedgerList(ledger || []);
      setAuditList(audit || []);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, []);

  // Compute stat metrics
  const totalBatches = ledgerList.length;
  const totalScans = ledgerList.reduce((acc, curr) => acc + (curr.scans || 0), 0);
  const redAlerts = auditList.filter((e) =>
    ['DUPLICATE_ALERT', 'REJECTED_SCAN', 'FORMAT_FAIL'].includes(e.type)
  ).length;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100 font-mono p-4 md:p-8 selection:bg-[#10b981]/30">
      <div className="max-w-[960px] mx-auto flex flex-col gap-6">
        
        {/* Top Navigation Link */}
        <div>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition tracking-wider"
          >
            ← back to scanner
          </Link>
        </div>

        {/* 1. Header */}
        <header className="border-b border-[#262626] pb-4">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">
            StockGuard · Reconciliation Dashboard
          </h1>
          <p className="text-xs text-neutral-500 mt-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse"></span>
            Live ledger · auto-refresh 2s · local IndexedDB
          </p>
        </header>

        {/* 2. Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-[#171717] border border-[#262626] shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Batches
            </div>
            <div className="text-3xl font-bold mt-2 text-[#10b981]">
              {totalBatches}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#171717] border border-[#262626] shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Total Scans
            </div>
            <div className="text-3xl font-bold mt-2 text-[#10b981]">
              {totalScans}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#171717] border border-[#262626] shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Red Alerts
            </div>
            <div className="text-3xl font-bold mt-2 text-[#ef4444]">
              {redAlerts}
            </div>
          </div>
        </div>

        {/* 3. Ledger Table */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs text-neutral-400 px-1">
            <span className="uppercase tracking-wider font-semibold">Ledger Register</span>
            <span>{ledgerList.length} records</span>
          </div>

          <div className="w-full overflow-x-auto rounded-xl border border-[#262626] bg-[#171717]/60">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#262626] bg-[#171717] text-neutral-400 uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Batch ID</th>
                  <th className="py-3 px-4">Brand</th>
                  <th className="py-3 px-4 text-center">Intake</th>
                  <th className="py-3 px-4 text-center">Sold</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#262626]">
                {ledgerList.length > 0 ? (
                  ledgerList.map((entry) => {
                    const isDuplicate = (entry.sold || 0) > (entry.intake || 0);
                    return (
                      <tr
                        key={entry.id}
                        className={`transition-colors ${
                          isDuplicate
                            ? 'bg-[rgba(127,29,29,0.2)] hover:bg-[rgba(127,29,29,0.3)]'
                            : 'hover:bg-neutral-900/60'
                        }`}
                      >
                        <td className="py-3 px-4 font-semibold text-neutral-200">
                          {entry.id}
                        </td>
                        <td className="py-3 px-4 text-neutral-400">
                          {entry.brand}
                        </td>
                        <td className="py-3 px-4 text-center text-neutral-200">
                          {entry.intake}
                        </td>
                        <td className="py-3 px-4 text-center text-neutral-200">
                          {entry.sold}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {isDuplicate ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold text-[#ef4444] bg-red-950/50 border border-red-900/40">
                              ⚠ DUPLICATE
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold text-[#10b981] bg-emerald-950/50 border border-emerald-900/40">
                              ✓ OK
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-8 text-center text-neutral-500 italic"
                    >
                      No data yet — scan from phone
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
