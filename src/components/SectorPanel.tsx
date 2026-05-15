"use client";

import { useState, useEffect, useCallback } from "react";
import { isTradingTime } from "@/lib/trading-hours";

interface SectorData {
  code: string;
  name: string;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
  leadingStock: string;
  leadingStockChange: number;
  stockCount: number;
  riseCount: number;
  fallCount: number;
}

export default function SectorPanel({
  onSelectStock,
}: {
  onSelectStock: (code: string, name: string) => void;
}) {
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"changePercent" | "amount">("changePercent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/api/sectors");
      const data = await resp.json();
      if (Array.isArray(data)) setSectors(data);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (isTradingTime()) load();
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const sorted = [...sectors].sort((a, b) => {
    const mul = sortDir === "desc" ? -1 : 1;
    return (a[sortBy] - b[sortBy]) * mul;
  });

  const topGainers = [...sectors].sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
  const topLosers = [...sectors].sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);

  if (loading) {
    return <div className="card animate-pulse h-96" />;
  }

  return (
    <div className="space-y-6">
      {/* 涨跌排行 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--accent-red)]" />
            领涨板块 TOP5
          </h3>
          <div className="space-y-2">
            {topGainers.map((s, i) => (
              <div key={s.code} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-[var(--accent-red)] w-5">{i + 1}</span>
                  <span className="text-sm font-medium">{s.name}</span>
                </div>
                <span className="text-sm font-mono text-[var(--accent-red)]">
                  +{s.changePercent.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--accent-green)]" />
            领跌板块 TOP5
          </h3>
          <div className="space-y-2">
            {topLosers.map((s, i) => (
              <div key={s.code} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-[var(--accent-green)] w-5">{i + 1}</span>
                  <span className="text-sm font-medium">{s.name}</span>
                </div>
                <span className="text-sm font-mono text-[var(--accent-green)]">
                  {s.changePercent.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 全部板块 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold">行业板块一览</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSortBy("changePercent"); setSortDir(d => d === "desc" ? "asc" : "desc"); }}
              className={`px-2.5 py-1 text-xs rounded border border-[var(--border-color)] transition-colors ${sortBy === "changePercent" ? "text-[var(--accent-blue)] border-[var(--accent-blue)]" : "text-[var(--text-secondary)]"}`}
            >
              按涨跌幅 {sortBy === "changePercent" ? (sortDir === "desc" ? "↓" : "↑") : ""}
            </button>
            <button
              onClick={() => { setSortBy("amount"); setSortDir(d => d === "desc" ? "asc" : "desc"); }}
              className={`px-2.5 py-1 text-xs rounded border border-[var(--border-color)] transition-colors ${sortBy === "amount" ? "text-[var(--accent-blue)] border-[var(--accent-blue)]" : "text-[var(--text-secondary)]"}`}
            >
              按成交额 {sortBy === "amount" ? (sortDir === "desc" ? "↓" : "↑") : ""}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                <th className="text-left px-4 py-2.5 font-medium">板块名称</th>
                <th className="text-right px-4 py-2.5 font-medium">涨跌幅</th>
                <th className="text-right px-4 py-2.5 font-medium">上涨/下跌</th>
                <th className="text-left px-4 py-2.5 font-medium">领涨股</th>
                <th className="text-right px-4 py-2.5 font-medium">领涨股涨幅</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => {
                const isUp = s.changePercent >= 0;
                const color = s.changePercent === 0 ? "var(--text-secondary)" : isUp ? "var(--accent-red)" : "var(--accent-green)";
                const riseRatio = s.stockCount > 0 ? s.riseCount / s.stockCount : 0;
                return (
                  <tr key={s.code} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-colors">
                    <td className="px-4 py-2.5 font-medium">{s.name}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: `${color}15`, color }}>
                        {isUp ? "+" : ""}{s.changePercent.toFixed(2)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="text-xs text-[var(--accent-red)]">{s.riseCount}</span>
                        <div className="w-16 h-1.5 rounded-full bg-[var(--bg-primary)] overflow-hidden">
                          <div className="h-full rounded-full bg-[var(--accent-red)]" style={{ width: `${riseRatio * 100}%` }} />
                        </div>
                        <span className="text-xs text-[var(--accent-green)]">{s.fallCount}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{s.leadingStock || "-"}</td>
                    <td className="px-4 py-2.5 text-right">
                      {s.leadingStockChange ? (
                        <span className="text-xs" style={{ color: s.leadingStockChange >= 0 ? "var(--accent-red)" : "var(--accent-green)" }}>
                          {s.leadingStockChange >= 0 ? "+" : ""}{s.leadingStockChange.toFixed(2)}%
                        </span>
                      ) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
