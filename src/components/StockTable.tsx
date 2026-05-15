"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { isTradingTime } from "@/lib/trading-hours";

interface StockQuote {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
  open: number;
  high: number;
  low: number;
  turnoverRate: number;
  pe: number;
}

export default function StockTable({
  onSelectStock,
}: {
  onSelectStock: (code: string, name: string) => void;
}) {
  const [stocks, setStocks] = useState<StockQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [flashCodes, setFlashCodes] = useState<Record<string, "up" | "down">>({});
  const prevPrices = useRef<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      const resp = await fetch(`/api/stocks?page=${page}&pageSize=30`);
      const data = await resp.json();
      if (Array.isArray(data)) {
        // 检测价格变动
        const flashes: Record<string, "up" | "down"> = {};
        for (const s of data) {
          const prev = prevPrices.current[s.code];
          if (prev !== undefined && prev !== s.price) {
            flashes[s.code] = s.price > prev ? "up" : "down";
          }
          prevPrices.current[s.code] = s.price;
        }
        if (Object.keys(flashes).length > 0) {
          setFlashCodes(flashes);
          setTimeout(() => setFlashCodes({}), 900);
        }
        setStocks(data);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (isTradingTime()) load();
    }, 10000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading) {
    return <div className="card animate-pulse h-96" />;
  }

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
        <h2 className="text-sm font-semibold">A股实时行情</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-2.5 py-1 text-xs rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 transition-colors"
          >
            上一页
          </button>
          <span className="text-xs text-[var(--text-secondary)]">第 {page} 页</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            className="px-2.5 py-1 text-xs rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            下一页
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--text-secondary)] border-b border-[var(--border-color)]">
              <th className="text-left px-4 py-2.5 font-medium">代码</th>
              <th className="text-left px-4 py-2.5 font-medium">名称</th>
              <th className="text-right px-4 py-2.5 font-medium">最新价</th>
              <th className="text-right px-4 py-2.5 font-medium">涨跌幅</th>
              <th className="text-right px-4 py-2.5 font-medium">涨跌额</th>
              <th className="text-right px-4 py-2.5 font-medium">成交量(手)</th>
              <th className="text-right px-4 py-2.5 font-medium">成交额</th>
              <th className="text-right px-4 py-2.5 font-medium">换手率</th>
              <th className="text-center px-4 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((s) => {
              const isUp = s.changePercent >= 0;
              const color = s.changePercent === 0 ? "var(--text-secondary)" : isUp ? "var(--accent-red)" : "var(--accent-green)";
              const flash = flashCodes[s.code];
              const flashClass = flash === "up" ? "price-up" : flash === "down" ? "price-down" : "";
              return (
                <tr
                  key={s.code}
                  className={`border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-colors ${flashClass}`}
                >
                  <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">{s.code}</td>
                  <td className="px-4 py-2.5 font-medium">{s.name}</td>
                  <td className="px-4 py-2.5 text-right font-mono" style={{ color }}>
                    {s.price.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className="text-xs px-1.5 py-0.5 rounded font-medium"
                      style={{ background: `${color}15`, color }}
                    >
                      {isUp ? "+" : ""}
                      {s.changePercent.toFixed(2)}%
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono" style={{ color }}>
                    {isUp ? "+" : ""}
                    {s.change.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--text-secondary)] font-mono">
                    {(s.volume / 10000).toFixed(0)}万
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--text-secondary)] font-mono">
                    {s.amount >= 1e8
                      ? `${(s.amount / 1e8).toFixed(1)}亿`
                      : `${(s.amount / 1e4).toFixed(0)}万`}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">
                    {s.turnoverRate.toFixed(2)}%
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => onSelectStock(s.code, s.name)}
                      className="text-xs text-[var(--accent-blue)] hover:text-blue-300 transition-colors"
                    >
                      分析预测
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
