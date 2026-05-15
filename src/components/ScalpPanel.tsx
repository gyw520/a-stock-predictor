"use client";
import { useState, useEffect, useCallback } from "react";

// ==================== 类型 ====================

interface ScalpHolding {
  code: string; name: string;
  buyDate: string; buyTime: string; buyPrice: number;
  currentPrice: number; shares: number; costAmount: number;
  currentValue: number; pnl: number; pnlPercent: number;
  holdDays: number; canSellToday: boolean; peakPrice: number;
  buyReason: string; targetSellPrice: number; stopLossPrice: number;
  qualityScore: number;
}

interface ScalpTrade {
  date: string; time: string; code: string; name: string;
  type: "买入" | "卖出"; price: number; shares: number; amount: number;
  commission: number; stampTax: number; totalCost: number;
  reason: string; pnl?: number; pnlPercent?: number;
  holdDays?: number; strategy: string;
}

interface ScalpSnapshot {
  date: string; totalValue: number; cash: number; holdingValue: number;
  dailyPnl: number; dailyPnlPercent: number;
  totalPnl: number; totalPnlPercent: number;
  emotion: string; weekWinCount: number; weekLossCount: number;
}

interface EmotionEntry {
  date: string; emotion: string; score: number;
}

interface ScalpData {
  initialCapital: number; cash: number;
  holdings: ScalpHolding[]; trades: ScalpTrade[];
  snapshots: ScalpSnapshot[];
  currentEmotion: string;
  emotionHistory: EmotionEntry[];
  weekStartDate: string; weekStartValue: number;
  weekWinCount: number; weekLossCount: number;
  consecutiveLoss: number; pausedUntil: string;
  totalCommission: number; totalStampTax: number;
  totalValue: number; totalPnl: number; totalPnlPercent: number;
  weekPnlPercent: number;
}

interface ScalpAction {
  type: "买入" | "卖出" | "观望";
  code: string; name: string;
  shares: number; amount: number;
  reason: string; strategy: string;
}

// ==================== 情绪颜色/图标 ====================

const EMOTION_MAP: Record<string, { icon: string; color: string; bg: string; label: string }> = {
  "冰点": { icon: "🧊", color: "#3b82f6", bg: "#3b82f618", label: "冰点" },
  "回暖": { icon: "🌅", color: "#10b981", bg: "#10b98118", label: "回暖" },
  "高潮": { icon: "🔥", color: "#ef4444", bg: "#ef444418", label: "高潮" },
  "退潮": { icon: "🌊", color: "#8b5cf6", bg: "#8b5cf618", label: "退潮" },
  "分歧": { icon: "⚖️", color: "#f59e0b", bg: "#f59e0b18", label: "分歧" },
};

// ==================== 主面板 ====================

export default function ScalpPanel() {
  const [data, setData] = useState<ScalpData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [lastActions, setLastActions] = useState<ScalpAction[]>([]);
  const [lastReasoning, setLastReasoning] = useState("");
  const [tab, setTab] = useState<"overview" | "holdings" | "trades" | "emotion" | "backtest">("overview");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/scalp");
      if (!res.ok) throw new Error();
      const json = await res.json();
      if (!json.error) setData(json);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 盘中自动扫描（每15秒）
  useEffect(() => {
    if (!data) return;
    const runScan = async () => {
      const now = new Date();
      const utc = now.getTime() + now.getTimezoneOffset() * 60000;
      const bj = new Date(utc + 8 * 3600000);
      const day = bj.getDay();
      if (day === 0 || day === 6) return;
      const t = bj.getHours() * 60 + bj.getMinutes();
      // 竞价开始到收盘：9:15-15:00
      const isTrading = t >= 555 && t <= 900;
      if (!isTrading) { setScanStatus("非交易时段"); return; }

      try {
        const res = await fetch("/api/scalp", { method: "PUT" });
        const json = await res.json();
        if (json.portfolio) setData({ ...json.portfolio, totalValue: json.portfolio.totalValue, totalPnl: json.portfolio.totalPnl, totalPnlPercent: json.portfolio.totalPnlPercent, weekPnlPercent: json.portfolio.weekPnlPercent });
        if (json.triggered && json.actions) {
          setLastActions(json.actions);
          setLastReasoning(json.reasoning || "");
          setScanStatus(`⚡ ${json.reasoning?.slice(0, 60) || "有操作"}`);
        } else {
          setScanStatus(`✅ ${bj.toTimeString().slice(0, 8)} ${json.emotion || ""}${json.emotionDetail ? ` | ${json.emotionDetail.slice(0, 40)}` : ""}`);
          if (json.reasoning) setLastReasoning(json.reasoning);
        }
      } catch { setScanStatus("扫描失败"); }
    };

    runScan();
    const interval = setInterval(runScan, 15 * 1000);
    return () => clearInterval(interval);
  }, [data?.holdings?.length]);

  const triggerScan = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/scalp", { method: "PUT" });
      const json = await res.json();
      if (json.portfolio) setData({ ...json.portfolio, totalValue: json.portfolio.totalValue, totalPnl: json.portfolio.totalPnl, totalPnlPercent: json.portfolio.totalPnlPercent, weekPnlPercent: json.portfolio.weekPnlPercent });
      if (json.actions) setLastActions(json.actions);
      if (json.reasoning) setLastReasoning(json.reasoning);
      setScanStatus(json.reasoning?.slice(0, 60) || "扫描完成");
    } catch {} finally { setScanning(false); }
  };

  if (loading) return (
    <div className="space-y-4">
      {[1,2,3].map(i => <div key={i} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] animate-pulse h-32" />)}
    </div>
  );

  if (!data) return (
    <div className="text-center py-20">
      <div className="text-4xl mb-3">⚡</div>
      <p className="text-[var(--text-secondary)] mb-4">超短线模拟盘尚未初始化</p>
      <button onClick={triggerScan} disabled={scanning}
        className="px-6 py-3 rounded-xl bg-gradient-to-r from-[#ef4444] to-[#f59e0b] text-white font-bold text-sm hover:opacity-90 disabled:opacity-50">
        {scanning ? "初始化中..." : "⚡ 启动超短线模拟盘（1万元）"}
      </button>
    </div>
  );

  const totalValue = data.totalValue || (data.cash + data.holdings.reduce((s, h) => s + h.currentValue, 0));
  const totalPnl = data.totalPnl || (totalValue - data.initialCapital);
  const totalPnlPct = data.totalPnlPercent || (totalPnl / data.initialCapital * 100);
  const weekPnl = data.weekPnlPercent || 0;
  const holdingValue = data.holdings.reduce((s, h) => s + h.currentValue, 0);
  const positionPct = totalValue > 0 ? (holdingValue / totalValue * 100) : 0;
  const emotion = data.currentEmotion || "分歧";
  const emo = EMOTION_MAP[emotion] || EMOTION_MAP["分歧"];
  const winRate = (data.weekWinCount + data.weekLossCount) > 0
    ? (data.weekWinCount / (data.weekWinCount + data.weekLossCount) * 100) : 0;
  const isPaused = data.pausedUntil && data.pausedUntil >= new Date().toISOString().slice(0, 10);

  const innerTabs = [
    { key: "overview" as const, label: "总览", icon: "📊" },
    { key: "holdings" as const, label: `持仓(${data.holdings.length})`, icon: "⚡" },
    { key: "trades" as const, label: "交易记录", icon: "📜" },
    { key: "emotion" as const, label: "情绪周期", icon: "🎭" },
    { key: "backtest" as const, label: "回测验证", icon: "🧪" },
  ];

  return (
    <div className="space-y-4">
      {/* 顶部大卡 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚡</span>
            <div>
              <h2 className="text-lg font-bold">超短线模拟盘</h2>
              <p className="text-[10px] text-[var(--text-secondary)]">
                初始1万 · 只持1票 · 最长3天 · 情绪周期择时 · 极优板竞价/首板打板/龙头低吸
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* 情绪标签 */}
            <span className="text-[10px] px-2.5 py-1 rounded-full font-bold" style={{ background: emo.bg, color: emo.color }}>
              {emo.icon} {emo.label}
            </span>
            {isPaused && (
              <span className="text-[9px] px-2 py-1 rounded-full bg-[#ef444418] text-[#ef4444] font-bold">
                ⛔ 暂停至{data.pausedUntil}
              </span>
            )}
            {scanStatus && (
              <span className="text-[9px] px-2 py-1 rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)] font-mono max-w-[200px] truncate">
                🔍 {scanStatus}
              </span>
            )}
            <button onClick={triggerScan} disabled={scanning}
              className="px-4 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 bg-gradient-to-r from-[#ef4444] to-[#f59e0b] text-white hover:opacity-90">
              {scanning ? "⏳ 扫描中..." : "🔄 手动扫描"}
            </button>
          </div>
        </div>

        {/* 核心指标 */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          <MetricCard label="总资产" value={`¥${totalValue.toFixed(2)}`}
            color={totalPnl >= 0 ? "#ef4444" : "#10b981"} sub={`初始¥${data.initialCapital}`} />
          <MetricCard label="累计盈亏" value={`${totalPnl >= 0 ? "+" : ""}¥${totalPnl.toFixed(2)}`}
            color={totalPnl >= 0 ? "#ef4444" : "#10b981"} sub={`${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%`} />
          <MetricCard label="本周收益" value={`${weekPnl >= 0 ? "+" : ""}${weekPnl.toFixed(2)}%`}
            color={weekPnl >= 2.5 ? "#ef4444" : weekPnl >= 0 ? "#f59e0b" : "#10b981"}
            sub={weekPnl >= 2.5 ? "✅ 已达标" : "目标2.5%"} />
          <MetricCard label="本周胜负" value={`${data.weekWinCount}胜${data.weekLossCount}负`}
            color={winRate >= 60 ? "#10b981" : winRate >= 40 ? "#f59e0b" : "#ef4444"}
            sub={`胜率${winRate.toFixed(0)}% | 连亏${data.consecutiveLoss}`} />
          <MetricCard label="仓位" value={`${positionPct.toFixed(0)}%`}
            color={positionPct > 0 ? "#ef4444" : "#94a3b8"}
            sub={`${data.holdings.length}/1票 | ¥${data.cash.toFixed(0)}`} />
          <MetricCard label="累计费用" value={`¥${((data.totalCommission || 0) + (data.totalStampTax || 0)).toFixed(2)}`}
            color="#94a3b8" sub={`佣金¥${(data.totalCommission||0).toFixed(1)} 税¥${(data.totalStampTax||0).toFixed(1)}`} />
        </div>
      </div>

      {/* 六大铁律 */}
      <div className="rounded-xl border border-[#f59e0b40] bg-[#f59e0b06] p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">📋</span>
          <span className="text-xs font-bold text-[#f59e0b]">超短线六大铁律</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] text-[var(--text-secondary)]">
          <div>① 只做主板（60/00）</div>
          <div>② 单票最多1只，集中火力</div>
          <div>③ 持股不过3天</div>
          <div>④ <span className="text-[#ef4444] font-bold">亏2%无条件止损</span></div>
          <div>⑤ 高开&gt;7%不追，低开&gt;3%割</div>
          <div>⑥ 每周最多亏3次就休息</div>
        </div>
      </div>

      {/* 最近操作 */}
      {lastReasoning && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">📡</span>
            <span className="text-xs font-bold">最新信号</span>
          </div>
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed break-all">{lastReasoning}</p>
          {lastActions.length > 0 && (
            <div className="mt-2 space-y-1">
              {lastActions.map((a, i) => (
                <div key={i} className={`text-[11px] px-3 py-1.5 rounded-lg ${
                  a.type === "买入" ? "bg-[#ef444412] text-[#ef4444]" : "bg-[#10b98112] text-[#10b981]"
                }`}>
                  {a.type === "买入" ? "🟢" : "🔴"} <b>{a.type}</b> {a.name}({a.code}) {a.shares}股 ¥{a.amount.toFixed(0)} [{a.strategy}]
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 子Tab */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)]">
        <div className="flex border-b border-[var(--border-color)]">
          {innerTabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-xs font-medium transition-colors relative ${
                tab === t.key ? "text-[var(--accent-blue)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}>
              <span className="mr-1">{t.icon}</span>{t.label}
              {tab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent-blue)] rounded-t" />}
            </button>
          ))}
        </div>

        <div className="p-4">
          {tab === "overview" && <OverviewTab data={data} />}
          {tab === "holdings" && <HoldingsTab holdings={data.holdings} />}
          {tab === "trades" && <TradesTab trades={data.trades} />}
          {tab === "emotion" && <EmotionTab history={data.emotionHistory} snapshots={data.snapshots} />}
          {tab === "backtest" && <BacktestTab />}
        </div>
      </div>
    </div>
  );
}

// ==================== 子组件 ====================

function MetricCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="p-3 rounded-lg bg-[var(--bg-secondary)]">
      <div className="text-[10px] text-[var(--text-secondary)] mb-1">{label}</div>
      <div className="text-sm font-bold font-mono" style={{ color }}>{value}</div>
      {sub && <div className="text-[9px] text-[var(--text-secondary)] mt-0.5">{sub}</div>}
    </div>
  );
}

function OverviewTab({ data }: { data: ScalpData }) {
  const recent5 = data.snapshots.slice(-5).reverse();
  const recentTrades = data.trades.slice(-5).reverse();
  const totalTrades = data.trades.length;
  const wins = data.trades.filter(t => t.type === "卖出" && (t.pnl ?? 0) > 0).length;
  const losses = data.trades.filter(t => t.type === "卖出" && (t.pnl ?? 0) < 0).length;
  const sells = data.trades.filter(t => t.type === "卖出");
  const avgWin = sells.filter(t => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0) / (wins || 1);
  const avgLoss = sells.filter(t => (t.pnl ?? 0) < 0).reduce((s, t) => s + (t.pnl ?? 0), 0) / (losses || 1);
  const allTimeWinRate = sells.length > 0 ? (wins / sells.length * 100) : 0;
  const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;

  return (
    <div className="space-y-4">
      {/* 统计概览 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-[var(--bg-secondary)]">
          <div className="text-[10px] text-[var(--text-secondary)]">总交易次数</div>
          <div className="text-sm font-bold font-mono">{totalTrades}笔</div>
          <div className="text-[9px] text-[var(--text-secondary)]">买{data.trades.filter(t=>t.type==="买入").length} 卖{sells.length}</div>
        </div>
        <div className="p-3 rounded-lg bg-[var(--bg-secondary)]">
          <div className="text-[10px] text-[var(--text-secondary)]">总胜率</div>
          <div className="text-sm font-bold font-mono" style={{ color: allTimeWinRate >= 50 ? "#10b981" : "#ef4444" }}>
            {allTimeWinRate.toFixed(1)}%
          </div>
          <div className="text-[9px] text-[var(--text-secondary)]">{wins}胜{losses}负</div>
        </div>
        <div className="p-3 rounded-lg bg-[var(--bg-secondary)]">
          <div className="text-[10px] text-[var(--text-secondary)]">盈亏比</div>
          <div className="text-sm font-bold font-mono" style={{ color: profitFactor >= 1.5 ? "#10b981" : "#f59e0b" }}>
            {profitFactor.toFixed(2)}
          </div>
          <div className="text-[9px] text-[var(--text-secondary)]">均盈¥{avgWin.toFixed(0)} 均亏¥{avgLoss.toFixed(0)}</div>
        </div>
        <div className="p-3 rounded-lg bg-[var(--bg-secondary)]">
          <div className="text-[10px] text-[var(--text-secondary)]">连续亏损</div>
          <div className="text-sm font-bold font-mono" style={{ color: data.consecutiveLoss >= 2 ? "#ef4444" : "#94a3b8" }}>
            {data.consecutiveLoss}次
          </div>
          <div className="text-[9px] text-[var(--text-secondary)]">{data.consecutiveLoss >= 2 ? "⚠️ 即将暂停" : "正常"}</div>
        </div>
      </div>

      {/* 近5日净值 */}
      {recent5.length > 0 && (
        <div>
          <h3 className="text-xs font-bold mb-2">📈 近期净值</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                  <th className="text-left py-1.5 px-2">日期</th>
                  <th className="text-right py-1.5 px-2">净值</th>
                  <th className="text-right py-1.5 px-2">日盈亏</th>
                  <th className="text-right py-1.5 px-2">累计</th>
                  <th className="text-center py-1.5 px-2">情绪</th>
                  <th className="text-center py-1.5 px-2">胜负</th>
                </tr>
              </thead>
              <tbody>
                {recent5.map((s, i) => {
                  const sEmo = EMOTION_MAP[s.emotion] || EMOTION_MAP["分歧"];
                  return (
                    <tr key={i} className="border-b border-[var(--border-color)] border-opacity-30">
                      <td className="py-1.5 px-2 font-mono">{s.date.slice(5)}</td>
                      <td className="py-1.5 px-2 text-right font-mono">¥{s.totalValue.toFixed(0)}</td>
                      <td className="py-1.5 px-2 text-right font-mono" style={{ color: s.dailyPnl >= 0 ? "#ef4444" : "#10b981" }}>
                        {s.dailyPnl >= 0 ? "+" : ""}{s.dailyPnl.toFixed(0)}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono" style={{ color: s.totalPnlPercent >= 0 ? "#ef4444" : "#10b981" }}>
                        {s.totalPnlPercent >= 0 ? "+" : ""}{s.totalPnlPercent.toFixed(2)}%
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: sEmo.bg, color: sEmo.color }}>
                          {sEmo.icon} {sEmo.label}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-center text-[10px]">{s.weekWinCount}胜{s.weekLossCount}负</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 最近交易 */}
      {recentTrades.length > 0 && (
        <div>
          <h3 className="text-xs font-bold mb-2">📜 最近交易</h3>
          <div className="space-y-1">
            {recentTrades.map((t, i) => (
              <div key={i} className={`text-[11px] px-3 py-2 rounded-lg ${
                t.type === "买入" ? "bg-[#ef444408]" : (t.pnl ?? 0) >= 0 ? "bg-[#10b98108]" : "bg-[#ef444408]"
              }`}>
                <div className="flex items-center justify-between">
                  <span>
                    {t.type === "买入" ? "🟢" : "🔴"} <b>{t.type}</b> {t.name} {t.shares}股 @{t.price.toFixed(2)}
                  </span>
                  <span className="text-[9px] text-[var(--text-secondary)]">{t.date.slice(5)} [{t.strategy}]</span>
                </div>
                <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                  {t.reason}
                  {t.type === "卖出" && t.pnl != null && (
                    <span style={{ color: t.pnl >= 0 ? "#ef4444" : "#10b981", fontWeight: "bold", marginLeft: 8 }}>
                      {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(0)}元({t.pnlPercent?.toFixed(1)}%)
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HoldingsTab({ holdings }: { holdings: ScalpHolding[] }) {
  if (holdings.length === 0) return (
    <div className="text-center py-10">
      <div className="text-3xl mb-2">🏖️</div>
      <p className="text-sm text-[var(--text-secondary)]">当前空仓，等待信号...</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {holdings.map(h => (
        <div key={h.code} className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-sm font-bold">{h.name}</span>
              <span className="text-[10px] text-[var(--text-secondary)] ml-2">{h.code}</span>
              {h.qualityScore > 0 && (
                <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-[#f59e0b18] text-[#f59e0b] font-bold">
                  质量{h.qualityScore}分
                </span>
              )}
            </div>
            <span className="text-lg font-bold font-mono" style={{ color: h.pnlPercent >= 0 ? "#ef4444" : "#10b981" }}>
              {h.pnlPercent >= 0 ? "+" : ""}{h.pnlPercent.toFixed(2)}%
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div>
              <span className="text-[var(--text-secondary)]">买入价</span>
              <span className="ml-1 font-mono">{h.buyPrice.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">现价</span>
              <span className="ml-1 font-mono" style={{ color: h.currentPrice >= h.buyPrice ? "#ef4444" : "#10b981" }}>
                {h.currentPrice.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">止损</span>
              <span className="ml-1 font-mono text-[#ef4444]">{h.stopLossPrice.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">目标</span>
              <span className="ml-1 font-mono text-[#10b981]">{h.targetSellPrice.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">持有</span>
              <span className="ml-1">{h.holdDays}天 {h.canSellToday ? "✅可卖" : "🔒T+1"}</span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">数量</span>
              <span className="ml-1 font-mono">{h.shares}股</span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">盈亏</span>
              <span className="ml-1 font-mono" style={{ color: h.pnl >= 0 ? "#ef4444" : "#10b981" }}>
                {h.pnl >= 0 ? "+" : ""}¥{h.pnl.toFixed(0)}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-secondary)]">最高</span>
              <span className="ml-1 font-mono">{h.peakPrice.toFixed(2)}</span>
            </div>
          </div>

          <div className="mt-2 text-[10px] text-[var(--text-secondary)]">
            💡 {h.buyReason}
          </div>

          {/* 盈亏进度条 */}
          <div className="mt-2 h-1.5 rounded-full bg-[var(--bg-card)] overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, Math.max(5, Math.abs(h.pnlPercent) * 10))}%`,
                background: h.pnlPercent >= 0
                  ? `linear-gradient(90deg, #ef4444, #f59e0b)`
                  : `linear-gradient(90deg, #10b981, #3b82f6)`,
              }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TradesTab({ trades }: { trades: ScalpTrade[] }) {
  const sorted = [...trades].reverse();
  if (sorted.length === 0) return (
    <div className="text-center py-10">
      <p className="text-sm text-[var(--text-secondary)]">暂无交易记录</p>
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[var(--text-secondary)] border-b border-[var(--border-color)]">
            <th className="text-left py-2 px-2">日期</th>
            <th className="text-left py-2 px-2">操作</th>
            <th className="text-left py-2 px-2">股票</th>
            <th className="text-right py-2 px-2">价格</th>
            <th className="text-right py-2 px-2">数量</th>
            <th className="text-right py-2 px-2">金额</th>
            <th className="text-right py-2 px-2">盈亏</th>
            <th className="text-left py-2 px-2">策略</th>
            <th className="text-left py-2 px-2">原因</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 30).map((t, i) => (
            <tr key={i} className="border-b border-[var(--border-color)] border-opacity-30 hover:bg-[var(--bg-secondary)]">
              <td className="py-1.5 px-2 font-mono">{t.date.slice(5)}</td>
              <td className="py-1.5 px-2">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                  t.type === "买入" ? "bg-[#ef444418] text-[#ef4444]" : "bg-[#10b98118] text-[#10b981]"
                }`}>{t.type}</span>
              </td>
              <td className="py-1.5 px-2 font-bold">{t.name}</td>
              <td className="py-1.5 px-2 text-right font-mono">{t.price.toFixed(2)}</td>
              <td className="py-1.5 px-2 text-right font-mono">{t.shares}</td>
              <td className="py-1.5 px-2 text-right font-mono">¥{t.amount.toFixed(0)}</td>
              <td className="py-1.5 px-2 text-right font-mono" style={{
                color: t.pnl != null ? (t.pnl >= 0 ? "#ef4444" : "#10b981") : "#94a3b8"
              }}>
                {t.pnl != null ? `${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(0)}` : "-"}
              </td>
              <td className="py-1.5 px-2">
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)]">{t.strategy}</span>
              </td>
              <td className="py-1.5 px-2 text-[var(--text-secondary)] max-w-[200px] truncate">{t.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmotionTab({ history, snapshots }: { history: EmotionEntry[]; snapshots: ScalpSnapshot[] }) {
  const recent = history.slice(-14).reverse();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-bold mb-2">🎭 情绪周期历史</h3>
        <p className="text-[10px] text-[var(--text-secondary)] mb-3">
          超短线的核心：冰点时大胆 → 回暖时进攻 → 高潮时谨慎 → 退潮时空仓
        </p>
        {recent.length === 0 ? (
          <p className="text-[11px] text-[var(--text-secondary)]">暂无情绪数据（开盘后自动采集）</p>
        ) : (
          <div className="space-y-1">
            {recent.map((e, i) => {
              const em = EMOTION_MAP[e.emotion] || EMOTION_MAP["分歧"];
              const snap = snapshots.find(s => s.date === e.date);
              return (
                <div key={i} className="flex items-center gap-3 text-[11px] py-1.5 px-3 rounded-lg bg-[var(--bg-secondary)]">
                  <span className="font-mono w-14">{e.date.slice(5)}</span>
                  <span className="px-2 py-0.5 rounded text-[9px] font-bold w-16 text-center" style={{ background: em.bg, color: em.color }}>
                    {em.icon} {em.label}
                  </span>
                  <span className="font-mono text-[var(--text-secondary)] w-16 text-right">得分{e.score}</span>
                  {snap && (
                    <span className="font-mono" style={{ color: snap.dailyPnl >= 0 ? "#ef4444" : "#10b981" }}>
                      {snap.dailyPnl >= 0 ? "+" : ""}{snap.dailyPnl.toFixed(0)}元
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 情绪策略说明 */}
      <div className="p-4 rounded-xl bg-[var(--bg-secondary)]">
        <h3 className="text-xs font-bold mb-3">📖 情绪周期操作手册</h3>
        <div className="space-y-2 text-[11px]">
          {Object.entries(EMOTION_MAP).map(([key, em]) => {
            const desc: Record<string, string> = {
              "冰点": "涨停<15家，亏钱效应严重 → 试探性买首板龙头，半仓（别人恐惧我贪婪）",
              "回暖": "赚钱效应恢复，封板率上升 → 最佳出手时机！满仓龙头和首板",
              "高潮": "涨停>80家，大赚效应 → 只做最强龙头，见好就收，控制仓位",
              "退潮": "封板率下降，高位股崩 → 空仓观望！严禁抄底，等冰点再出手",
              "分歧": "方向不明确 → 轻仓试错，快进快出",
            };
            return (
              <div key={key} className="flex items-start gap-2">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 w-14 text-center" style={{ background: em.bg, color: em.color }}>
                  {em.icon} {em.label}
                </span>
                <span className="text-[var(--text-secondary)]">{desc[key]}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ==================== 回测Tab ====================

interface BacktestResult {
  success?: boolean;
  stocksUsed?: number;
  period?: string;
  tradingDays?: number;
  totalTrades?: number;
  winRate?: number;
  avgWin?: number;
  avgLoss?: number;
  profitFactor?: number;
  expectancy?: number;
  avgHoldDays?: number;
  totalReturn?: number;
  maxDrawdown?: number;
  weeklyReturn?: number;
  strategyStats?: { strategy: string; trades: number; winRate: number; avgPnl: number; profitFactor: number }[];
  factorAnalysis?: { factor: string; bins: { range: string; trades: number; winRate: number; avgPnl: number }[]; bestBin: string }[];
  trades?: { buyDate: string; sellDate: string; code: string; name: string; strategy: string; buyPrice: number; sellPrice: number; holdDays: number; pnlPct: number; sellReason: string }[];
  suggestions?: string[];
  error?: string;
}

function BacktestTab() {
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [days, setDays] = useState(60);
  const [stockCount, setStockCount] = useState(80);

  const runBacktest = async () => {
    setRunning(true);
    setResult(null);
    setProgress("获取股票列表...");
    try {
      // Step1: 浏览器端获取活跃股票列表
      const listUrl = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${stockCount}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f5,f6,f8,f12,f14`;
      const listResp = await fetch(listUrl);
      const listJson = await listResp.json();
      const allStocks = (listJson.data?.diff || []).map((item: Record<string, number | string>) => ({
        code: String(item.f12), name: String(item.f14),
        price: Number(item.f2) || 0, turnoverRate: Number(item.f8) || 0,
      }));

      // 过滤主板+去ST
      const filtered = allStocks.filter((s: { code: string; name: string; price: number; turnoverRate: number }) =>
        s.price > 0 && (s.code.startsWith("60") || s.code.startsWith("00")) &&
        !s.name.includes("ST") && !s.name.includes("退") && s.turnoverRate >= 1
      );

      if (filtered.length < 5) {
        setResult({ error: `主板活跃股不足(${filtered.length}只)` });
        return;
      }

      // Step2: 浏览器端批量拉取K线
      const klineMap: Record<string, { name: string; klines: { date: string; open: number; close: number; high: number; low: number; volume: number; amount: number }[] }> = {};
      const BATCH = 8;
      let fetched = 0;

      for (let i = 0; i < filtered.length; i += BATCH) {
        const batch = filtered.slice(i, i + BATCH);
        setProgress(`获取K线 ${Math.min(i + BATCH, filtered.length)}/${filtered.length}...`);
        const results = await Promise.all(
          batch.map(async (s: { code: string; name: string }) => {
            try {
              const m = s.code.startsWith("6") ? 1 : 0;
              const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${m}.${s.code}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=${days}`;
              const resp = await fetch(url);
              const json = await resp.json();
              const klines = (json.data?.klines || []).map((line: string) => {
                const p = line.split(",");
                return { date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4], volume: +p[5], amount: +p[6] };
              });
              return { code: s.code, name: s.name, klines };
            } catch { return { code: s.code, name: s.name, klines: [] }; }
          })
        );
        for (const r of results) {
          if (r.klines.length >= 20) { klineMap[r.code] = { name: r.name, klines: r.klines }; fetched++; }
        }
        // 小延迟防限流
        if (i + BATCH < filtered.length) await new Promise(r => setTimeout(r, 80));
      }

      if (fetched < 5) {
        setResult({ error: `K线获取不足(仅${fetched}只有效)` });
        return;
      }

      // Step3: 发送K线数据到后端做回测计算
      setProgress(`${fetched}只K线就绪，计算回测中...`);
      const res = await fetch("/api/scalp-backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ klineMap }),
      });
      const json = await res.json();
      if (!res.ok) {
        setResult({ error: json.error || `计算失败(${res.status})` });
      } else {
        setResult(json);
      }
    } catch (e: any) {
      setResult({ error: `回测失败: ${e?.message || "未知错误"}` });
    } finally { setRunning(false); setProgress(""); }
  };

  return (
    <div className="space-y-4">
      {/* 回测控制 */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text-secondary)]">回测天数:</span>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="text-[11px] px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)]">
            <option value={30}>30天</option>
            <option value={60}>60天</option>
            <option value={90}>90天</option>
            <option value={120}>120天</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text-secondary)]">股票池:</span>
          <select value={stockCount} onChange={e => setStockCount(Number(e.target.value))}
            className="text-[11px] px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)]">
            <option value={50}>50只</option>
            <option value={80}>80只</option>
            <option value={120}>120只</option>
            <option value={150}>150只</option>
          </select>
        </div>
        <button onClick={runBacktest} disabled={running}
          className="px-4 py-2 rounded-lg text-xs font-bold bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50">
          {running ? "⏳ 回测中..." : "🧪 执行回测"}
        </button>
        {progress && <span className="text-[11px] text-[var(--text-secondary)] animate-pulse">{progress}</span>}
      </div>

      {result?.error && (
        <div className="p-3 rounded-lg bg-[#ef444418] text-[#ef4444] text-[11px]">❌ {result.error}</div>
      )}

      {result?.success && (
        <div className="space-y-4">
          {/* 回测概览 */}
          <div className="p-4 rounded-xl bg-[var(--bg-secondary)]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold">📊 回测结果</h3>
              <span className="text-[9px] text-[var(--text-secondary)]">{result.period} | {result.stocksUsed}只股 | {result.tradingDays}交易日</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-2 rounded bg-[var(--bg-card)]">
                <div className="text-[9px] text-[var(--text-secondary)]">胜率</div>
                <div className="text-sm font-bold" style={{ color: (result.winRate||0) >= 50 ? "#10b981" : "#ef4444" }}>
                  {result.winRate}%
                </div>
              </div>
              <div className="p-2 rounded bg-[var(--bg-card)]">
                <div className="text-[9px] text-[var(--text-secondary)]">盈亏比</div>
                <div className="text-sm font-bold" style={{ color: (result.profitFactor||0) >= 1.5 ? "#10b981" : "#f59e0b" }}>
                  {result.profitFactor}
                </div>
              </div>
              <div className="p-2 rounded bg-[var(--bg-card)]">
                <div className="text-[9px] text-[var(--text-secondary)]">总收益</div>
                <div className="text-sm font-bold" style={{ color: (result.totalReturn||0) >= 0 ? "#ef4444" : "#10b981" }}>
                  {(result.totalReturn||0) >= 0 ? "+" : ""}{result.totalReturn}%
                </div>
              </div>
              <div className="p-2 rounded bg-[var(--bg-card)]">
                <div className="text-[9px] text-[var(--text-secondary)]">最大回撤</div>
                <div className="text-sm font-bold text-[#ef4444]">-{result.maxDrawdown}%</div>
              </div>
              <div className="p-2 rounded bg-[var(--bg-card)]">
                <div className="text-[9px] text-[var(--text-secondary)]">总交易</div>
                <div className="text-sm font-bold">{result.totalTrades}笔</div>
              </div>
              <div className="p-2 rounded bg-[var(--bg-card)]">
                <div className="text-[9px] text-[var(--text-secondary)]">期望值</div>
                <div className="text-sm font-bold" style={{ color: (result.expectancy||0) > 0 ? "#10b981" : "#ef4444" }}>
                  {(result.expectancy||0) > 0 ? "+" : ""}{result.expectancy}%/笔
                </div>
              </div>
              <div className="p-2 rounded bg-[var(--bg-card)]">
                <div className="text-[9px] text-[var(--text-secondary)]">周均收益</div>
                <div className="text-sm font-bold" style={{ color: (result.weeklyReturn||0) > 0 ? "#ef4444" : "#10b981" }}>
                  {(result.weeklyReturn||0) > 0 ? "+" : ""}{result.weeklyReturn}%
                </div>
              </div>
              <div className="p-2 rounded bg-[var(--bg-card)]">
                <div className="text-[9px] text-[var(--text-secondary)]">均持有</div>
                <div className="text-sm font-bold">{result.avgHoldDays}天</div>
              </div>
            </div>
          </div>

          {/* 分策略统计 */}
          {result.strategyStats && result.strategyStats.length > 0 && (
            <div className="p-4 rounded-xl bg-[var(--bg-secondary)]">
              <h3 className="text-xs font-bold mb-3">📋 分策略统计</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                      <th className="text-left py-1.5 px-2">策略</th>
                      <th className="text-right py-1.5 px-2">交易数</th>
                      <th className="text-right py-1.5 px-2">胜率</th>
                      <th className="text-right py-1.5 px-2">均盈亏</th>
                      <th className="text-right py-1.5 px-2">盈亏比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.strategyStats.map((ss, i) => (
                      <tr key={i} className="border-b border-[var(--border-color)] border-opacity-30">
                        <td className="py-1.5 px-2 font-bold">{ss.strategy}</td>
                        <td className="py-1.5 px-2 text-right">{ss.trades}</td>
                        <td className="py-1.5 px-2 text-right font-mono" style={{ color: ss.winRate >= 50 ? "#10b981" : "#ef4444" }}>
                          {ss.winRate.toFixed(0)}%
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono" style={{ color: ss.avgPnl >= 0 ? "#ef4444" : "#10b981" }}>
                          {ss.avgPnl >= 0 ? "+" : ""}{ss.avgPnl.toFixed(2)}%
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono" style={{ color: ss.profitFactor >= 1.5 ? "#10b981" : "#f59e0b" }}>
                          {ss.profitFactor.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 因子分析 */}
          {result.factorAnalysis && result.factorAnalysis.length > 0 && (
            <div className="p-4 rounded-xl bg-[var(--bg-secondary)]">
              <h3 className="text-xs font-bold mb-3">📊 因子分析（哪些特征胜率最高）</h3>
              <div className="space-y-3">
                {result.factorAnalysis.map((fa, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-bold">{fa.factor}</span>
                      {fa.bestBin && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#10b98118] text-[#10b981]">最优: {fa.bestBin}</span>}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                      {fa.bins.map((b, j) => (
                        <div key={j} className={`p-1.5 rounded text-[10px] ${b.range === fa.bestBin ? "bg-[#10b98112] border border-[#10b98140]" : "bg-[var(--bg-card)]"}`}>
                          <div className="font-mono">{b.range}</div>
                          <div className="flex justify-between mt-0.5">
                            <span>{b.trades}笔</span>
                            <span style={{ color: b.winRate >= 50 ? "#10b981" : b.winRate >= 40 ? "#f59e0b" : "#ef4444" }}>
                              {b.winRate}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 建议 */}
          {result.suggestions && result.suggestions.length > 0 && (
            <div className="p-4 rounded-xl border border-[#3b82f640] bg-[#3b82f608]">
              <h3 className="text-xs font-bold mb-2 text-[#3b82f6]">💡 优化建议</h3>
              <div className="space-y-1">
                {result.suggestions.map((s, i) => (
                  <div key={i} className="text-[11px] text-[var(--text-secondary)]">{s}</div>
                ))}
              </div>
            </div>
          )}

          {/* 近期交易明细 */}
          {result.trades && result.trades.length > 0 && (
            <div className="p-4 rounded-xl bg-[var(--bg-secondary)]">
              <h3 className="text-xs font-bold mb-3">📜 回测交易明细（近20笔）</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                      <th className="text-left py-1 px-1.5">买入日</th>
                      <th className="text-left py-1 px-1.5">卖出日</th>
                      <th className="text-left py-1 px-1.5">股票</th>
                      <th className="text-left py-1 px-1.5">策略</th>
                      <th className="text-right py-1 px-1.5">买价</th>
                      <th className="text-right py-1 px-1.5">卖价</th>
                      <th className="text-right py-1 px-1.5">盈亏</th>
                      <th className="text-right py-1 px-1.5">持有</th>
                      <th className="text-left py-1 px-1.5">卖出原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.slice(-20).reverse().map((t, i) => (
                      <tr key={i} className="border-b border-[var(--border-color)] border-opacity-30">
                        <td className="py-1 px-1.5 font-mono">{t.buyDate.slice(5)}</td>
                        <td className="py-1 px-1.5 font-mono">{t.sellDate.slice(5)}</td>
                        <td className="py-1 px-1.5 font-bold">{t.name || t.code}</td>
                        <td className="py-1 px-1.5"><span className="px-1 py-0.5 rounded bg-[var(--bg-card)] text-[9px]">{t.strategy}</span></td>
                        <td className="py-1 px-1.5 text-right font-mono">{t.buyPrice.toFixed(2)}</td>
                        <td className="py-1 px-1.5 text-right font-mono">{t.sellPrice.toFixed(2)}</td>
                        <td className="py-1 px-1.5 text-right font-mono" style={{ color: t.pnlPct >= 0 ? "#ef4444" : "#10b981" }}>
                          {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%
                        </td>
                        <td className="py-1 px-1.5 text-right">{t.holdDays}天</td>
                        <td className="py-1 px-1.5 text-[var(--text-secondary)] max-w-[120px] truncate">{t.sellReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {!result && !running && (
        <div className="text-center py-10">
          <div className="text-3xl mb-3">🧪</div>
          <p className="text-sm text-[var(--text-secondary)] mb-2">用真实历史K线验证超短线策略</p>
          <p className="text-[10px] text-[var(--text-secondary)]">
            回测会获取最近活跃股的历史数据，模拟极优板竞价、首板打板、龙头低吸三大策略，
            分析胜率、盈亏比、因子有效性，给出优化建议
          </p>
        </div>
      )}
    </div>
  );
}
