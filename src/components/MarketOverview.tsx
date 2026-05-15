"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { isTradingTime, getPollingInterval } from "@/lib/trading-hours";

interface IndexData {
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
}

interface MarketData {
  shIndex: IndexData;
  szIndex: IndexData;
  cybIndex: IndexData;
  riseCount: number;
  fallCount: number;
  flatCount: number;
  limitUp: number;
  limitDown: number;
}

export default function MarketOverview() {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isLive, setIsLive] = useState(false);
  const [flashMap, setFlashMap] = useState<Record<string, "up" | "down" | "">>({});
  const prevPrices = useRef<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/api/market");
      if (!resp.ok) throw new Error();
      const json: MarketData = await resp.json();

      // 检测价格变动 → 触发闪烁
      const newFlash: Record<string, "up" | "down" | ""> = {};
      const indices = [
        { key: "sh", price: json.shIndex.price },
        { key: "sz", price: json.szIndex.price },
        { key: "cyb", price: json.cybIndex.price },
      ];
      for (const idx of indices) {
        const prev = prevPrices.current[idx.key];
        if (prev !== undefined && prev !== idx.price) {
          newFlash[idx.key] = idx.price > prev ? "up" : "down";
        }
        prevPrices.current[idx.key] = idx.price;
      }
      if (Object.keys(newFlash).length > 0) {
        setFlashMap(newFlash);
        setTimeout(() => setFlashMap({}), 900);
      }

      setData(json);
      setError("");
    } catch {
      setError("获取大盘数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();

    // 智能轮询：交易时段每15秒，非交易时段不轮询
    const pollCheck = setInterval(() => {
      const trading = isTradingTime();
      setIsLive(trading);
      if (trading) load();
    }, 15000);

    // 初始检查
    setIsLive(isTradingTime());

    return () => clearInterval(pollCheck);
  }, [load]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card animate-pulse h-28" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return <div className="card text-center py-8 text-[var(--accent-red)]">{error || "暂无数据"}</div>;
  }

  const indices = [
    { name: "上证指数", code: "000001", key: "sh", data: data.shIndex },
    { name: "深证成指", code: "399001", key: "sz", data: data.szIndex },
    { name: "创业板指", code: "399006", key: "cyb", data: data.cybIndex },
  ];

  return (
    <div className="space-y-2">
      {/* 实时状态指示 */}
      <div className="flex items-center justify-end gap-2 px-1">
        {isLive ? (
          <div className="flex items-center gap-1.5">
            <span className="live-dot" />
            <span className="text-[10px] text-[#10b981] font-medium">盘中实时</span>
          </div>
        ) : (
          <span className="text-[10px] text-[var(--text-secondary)]">非交易时段</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {indices.map((idx) => {
          const isUp = idx.data.changePercent >= 0;
          const color = isUp ? "var(--accent-red)" : "var(--accent-green)";
          const flash = flashMap[idx.key];
          const flashClass = flash === "up" ? "price-up" : flash === "down" ? "price-down" : "";
          return (
            <div
              key={idx.code}
              className={`rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5 hover:border-[#2d4a7a] transition-colors ${flashClass}`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-[var(--text-secondary)] text-sm font-medium">{idx.name}</span>
                <span className="text-xs text-[var(--text-secondary)]">{idx.code}</span>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <span className="text-2xl font-bold tabular-nums" style={{ color }}>
                    {idx.data.price.toFixed(2)}
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm tabular-nums" style={{ color }}>
                      {isUp ? "+" : ""}
                      {idx.data.change.toFixed(2)}
                    </span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded font-medium tabular-nums"
                      style={{ background: `${color}20`, color }}
                    >
                      {isUp ? "+" : ""}
                      {idx.data.changePercent.toFixed(2)}%
                    </span>
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--text-secondary)]">
                  <div>成交额</div>
                  <div className="text-[var(--text-primary)] tabular-nums">
                    {(idx.data.amount / 1e8).toFixed(0)}亿
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
