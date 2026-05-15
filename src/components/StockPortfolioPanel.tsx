"use client";
import { useState, useEffect, useCallback } from "react";

// ==================== 类型 ====================

interface Holding {
  code: string; name: string; sector: string;
  buyDate: string; buyPrice: number; currentPrice: number;
  shares: number; costAmount: number; currentValue: number;
  pnl: number; pnlPercent: number; quantScore: number;
  holdDays: number; peakPrice: number; trailingStopPct: number;
  canSellToday: boolean;
}

interface Trade {
  date: string; time: string; code: string; name: string; sector: string;
  type: "买入" | "卖出" | "加仓" | "减仓";
  price: number; shares: number; amount: number;
  commission: number; slippage: number; stampTax: number; totalCost: number;
  reason: string; quantScore: number;
}

interface Snapshot {
  date: string; totalValue: number; cash: number; holdingValue: number;
  dailyPnl: number; dailyPnlPercent: number;
  totalPnl: number; totalPnlPercent: number;
  holdingCount: number; weekPnlPercent: number;
}

interface TopPick {
  code: string; name: string; score: number; reason: string;
}

interface PortfolioData {
  initialCapital: number; cash: number;
  holdings: Holding[]; trades: Trade[];
  snapshots: Snapshot[]; lastRebalanceDate: string;
  createdAt: string; weekStartValue: number; weekStartDate: string;
  totalValue: number; totalPnl: number; totalPnlPercent: number;
  weekPnlPercent: number;
  totalCommission: number; totalSlippage: number; totalStampTax: number;
  riskLevel: string; maxDrawdownPct: number;
  dailyTopPick?: { date: string; code: string; name: string; score: number; reason: string };
}

interface RebalanceAction {
  type: "买入" | "卖出" | "加仓" | "减仓" | "持仓";
  code: string; name: string; sector: string;
  shares: number; amount: number; reason: string; quantScore: number;
}

interface LimitUpAlert {
  code: string; name: string; price: number;
  changePercent: number; limitPrice: number; distancePercent: number;
  turnoverRate: number; amount: number;
  phase: "冲刺" | "临门" | "触板" | "封板";
  momentum: string; detectedAt: string;
}

// ==================== 主面板 ====================

export default function StockPortfolioPanel() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebalancing, setRebalancing] = useState(false);
  const [lastActions, setLastActions] = useState<RebalanceAction[]>([]);
  const [lastReasoning, setLastReasoning] = useState("");
  const [topPicks, setTopPicks] = useState<TopPick[]>([]);
  const [limitUpAlerts, setLimitUpAlerts] = useState<LimitUpAlert[]>([]);
  const [tab, setTab] = useState<"overview" | "holdings" | "trades" | "chart">("overview");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/stock-portfolio");
      if (!res.ok) throw new Error();
      const json = await res.json();
      if (!json.error) setData(json);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 自动调仓（14:45执行）
  useEffect(() => {
    if (!data || loading || rebalancing) return;
    const checkAutoRebalance = () => {
      const now = new Date();
      const utc = now.getTime() + now.getTimezoneOffset() * 60000;
      const bj = new Date(utc + 8 * 3600000);
      const day = bj.getDay();
      if (day === 0 || day === 6) return;
      const t = bj.getHours() * 60 + bj.getMinutes();
      const todayStr = bj.toISOString().slice(0, 10);
      const done = data.lastRebalanceDate === todayStr;
      if (t >= 555 && t <= 900 && !done && t >= 885) {
        triggerRebalance(false);
      }
    };
    const today = new Date().toISOString().slice(0, 10);
    if (data.lastRebalanceDate !== today) {
      const timer = setTimeout(checkAutoRebalance, 3000);
      return () => clearTimeout(timer);
    }
    const interval = setInterval(checkAutoRebalance, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [data, loading, rebalancing]);

  // 盘中实时扫描（每60秒，个股扫描开销大一些）
  const [scanStatus, setScanStatus] = useState<string>("");
  useEffect(() => {
    if (!data) return;
    const runScan = async () => {
      const now = new Date();
      const utc = now.getTime() + now.getTimezoneOffset() * 60000;
      const bj = new Date(utc + 8 * 3600000);
      const day = bj.getDay();
      if (day === 0 || day === 6) return;
      const t = bj.getHours() * 60 + bj.getMinutes();
      const isTrading = (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
      if (!isTrading) { setScanStatus("非交易时段"); return; }

      try {
        const res = await fetch("/api/stock-portfolio", { method: "PUT" });
        const json = await res.json();
        if (json.limitUpAlerts) setLimitUpAlerts(json.limitUpAlerts);
        if (json.triggered && json.portfolio) {
          setData({ ...json.portfolio });
          if (json.actions) setLastActions(json.actions);
          if (json.reasoning) setLastReasoning(json.reasoning);
          setScanStatus(`⚡ ${json.reasoning}`);
        } else {
          const alertCount = (json.limitUpAlerts || []).filter((a: LimitUpAlert) => a.phase !== "封板").length;
          setScanStatus(`✅ ${bj.toTimeString().slice(0, 8)} 无异常${alertCount > 0 ? ` | 🔥${alertCount}只冲板` : ""}`);
          if (json.portfolio) setData({ ...json.portfolio });
        }
      } catch { setScanStatus("扫描失败"); }
    };

    runScan();
    const interval = setInterval(runScan, 15 * 1000); // 15秒刷新，抓涨停要快
    return () => clearInterval(interval);
  }, [data?.holdings.length]);

  const triggerRebalance = async (force = false) => {
    setRebalancing(true);
    try {
      const res = await fetch("/api/stock-portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const json = await res.json();
      if (json.portfolio) setData({ ...json.portfolio });
      if (json.actions) setLastActions(json.actions);
      if (json.reasoning) setLastReasoning(json.reasoning);
      if (json.topPicks) setTopPicks(json.topPicks);
    } catch {} finally { setRebalancing(false); }
  };

  if (loading) return (
    <div className="space-y-4">
      {[1,2,3].map(i => <div key={i} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] animate-pulse h-32" />)}
    </div>
  );

  if (!data) return (
    <div className="text-center py-20">
      <div className="text-4xl mb-3">🎯</div>
      <p className="text-[var(--text-secondary)] mb-4">个股量化模拟盘尚未初始化</p>
      <button onClick={() => triggerRebalance(true)} disabled={rebalancing}
        className="px-6 py-3 rounded-xl bg-[var(--accent-blue)] text-white font-bold text-sm hover:opacity-90 disabled:opacity-50">
        {rebalancing ? "初始化中..." : "🚀 启动个股模拟盘（1万元）"}
      </button>
    </div>
  );

  const totalValue = data.totalValue || (data.cash + data.holdings.reduce((s, h) => s + h.currentValue, 0));
  const totalPnl = data.totalPnl || (totalValue - data.initialCapital);
  const totalPnlPct = data.totalPnlPercent || (totalPnl / data.initialCapital * 100);
  const weekPnl = data.weekPnlPercent || 0;
  const holdingValue = data.holdings.reduce((s, h) => s + h.currentValue, 0);
  const positionPct = totalValue > 0 ? (holdingValue / totalValue * 100) : 0;
  const weekTarget = 3.0; // 个股周目标略高

  const tabs = [
    { key: "overview" as const, label: "总览", icon: "📊" },
    { key: "holdings" as const, label: `持仓(${data.holdings.length})`, icon: "💼" },
    { key: "trades" as const, label: "交易记录", icon: "📜" },
    { key: "chart" as const, label: "净值曲线", icon: "📈" },
  ];

  return (
    <div className="space-y-4">
      {/* 顶部大卡 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎯</span>
            <div>
              <h2 className="text-lg font-bold">个股量化模拟盘</h2>
              <p className="text-[10px] text-[var(--text-secondary)]">初始1万 · 最多1票 · T+1 · 量化29因子精选 · 实时操作 · 企微通知</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {scanStatus && (
              <span className="text-[9px] px-2 py-1 rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)] font-mono">
                🔍 {scanStatus}
              </span>
            )}
            {data.riskLevel && data.riskLevel !== "正常" && (
              <span className={`text-[9px] px-2 py-1 rounded-full font-bold ${
                data.riskLevel === "熔断" ? "bg-[#ef444418] text-[#ef4444]" :
                data.riskLevel === "降仓" ? "bg-[#f59e0b18] text-[#f59e0b]" :
                "bg-[#3b82f618] text-[#3b82f6]"
              }`}>⚠️ {data.riskLevel}</span>
            )}
            {data.lastRebalanceDate === new Date().toISOString().slice(0, 10)
              ? <span className="text-[9px] px-2 py-1 rounded-full bg-[#10b98118] text-[#10b981] font-bold">✅ 今日已调仓</span>
              : <span className="text-[9px] px-2 py-1 rounded-full bg-[#f59e0b18] text-[#f59e0b] font-bold">⏰ 14:45自动调仓</span>
            }
            <button onClick={() => triggerRebalance(true)} disabled={rebalancing}
              className="px-4 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 bg-[var(--accent-blue)] text-white hover:opacity-90">
              {rebalancing ? "⏳ 量化扫描中..." : "🔄 手动调仓"}
            </button>
          </div>
        </div>

        {/* 核心数据 */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <MetricCard label="总资产" value={`¥${totalValue.toFixed(2)}`}
            color={totalPnl >= 0 ? "#ef4444" : "#10b981"} sub={`初始¥${data.initialCapital}`} />
          <MetricCard label="累计盈亏" value={`${totalPnl >= 0 ? "+" : ""}¥${totalPnl.toFixed(2)}`}
            color={totalPnl >= 0 ? "#ef4444" : "#10b981"} sub={`${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%`} />
          <MetricCard label="本周收益" value={`${weekPnl >= 0 ? "+" : ""}${weekPnl.toFixed(2)}%`}
            color={weekPnl >= weekTarget ? "#ef4444" : weekPnl >= 0 ? "#f59e0b" : "#10b981"}
            sub={weekPnl >= weekTarget ? "✅ 已达标" : `目标${weekTarget}%`} />
          <MetricCard label="仓位" value={`${positionPct.toFixed(0)}%`}
            color={positionPct > 70 ? "#ef4444" : positionPct > 30 ? "#f59e0b" : "#94a3b8"}
            sub={`${data.holdings.length}/1票 | 现金¥${data.cash.toFixed(0)}`} />
          <MetricCard label="累计费用" value={`¥${((data.totalCommission || 0) + (data.totalSlippage || 0) + (data.totalStampTax || 0)).toFixed(2)}`}
            color="#94a3b8" sub={`佣金¥${(data.totalCommission||0).toFixed(1)} 印花税¥${(data.totalStampTax||0).toFixed(1)}`} />
        </div>
      </div>

      {/* 今日最强推荐 */}
      {data.dailyTopPick && data.dailyTopPick.date === new Date().toISOString().slice(0, 10) && (
        <div className="rounded-xl border border-[#f59e0b40] bg-[#f59e0b08] p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">⭐</span>
            <h3 className="text-xs font-bold text-[#f59e0b]">今日最强推荐</h3>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="font-bold">{data.dailyTopPick.name}</span>
            <span className="text-[var(--text-secondary)] font-mono text-xs">{data.dailyTopPick.code}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#ef444420] text-[#ef4444]">{data.dailyTopPick.score}分</span>
            <span className="text-[11px] text-[var(--text-secondary)]">{data.dailyTopPick.reason}</span>
          </div>
        </div>
      )}

      {/* Top5推荐 */}
      {topPicks.length > 0 && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">🏆</span>
            <h3 className="text-xs font-bold">量化Top5推荐</h3>
          </div>
          <div className="space-y-1">
            {topPicks.slice(0, 5).map((p, i) => (
              <div key={p.code} className="flex items-center gap-3 text-[11px]">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${
                  i === 0 ? "bg-[#ef4444]" : i === 1 ? "bg-[#f97316]" : i === 2 ? "bg-[#f59e0b]" : "bg-[#94a3b8]"
                }`}>{i + 1}</span>
                <span className="font-bold w-20">{p.name}</span>
                <span className="text-[var(--text-secondary)] font-mono w-16">{p.code}</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#ef444415] text-[#ef4444]">{p.score}分</span>
                <span className="text-[var(--text-secondary)] flex-1 truncate">{p.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 涨停预判 */}
      {limitUpAlerts.filter(a => a.phase !== "封板").length > 0 && (
        <div className="rounded-xl border border-[#ef444440] bg-[#ef444408] p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm">🔥</span>
            <h3 className="text-xs font-bold text-[#ef4444]">涨停预判实时监控</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#ef444420] text-[#ef4444] font-bold">
              {limitUpAlerts.filter(a => a.phase !== "封板").length}只冲板中
            </span>
            <span className="text-[9px] text-[var(--text-secondary)] ml-auto">
              每分钟刷新 · 涨幅≥7%+高换手+大成交
            </span>
          </div>
          <div className="space-y-2">
            {limitUpAlerts.filter(a => a.phase !== "封板").slice(0, 10).map(a => {
              const phaseColor: Record<string, string> = {
                "冲刺": "#f59e0b", "临门": "#f97316", "触板": "#ef4444",
              };
              const phaseEmoji: Record<string, string> = {
                "冲刺": "🏃", "临门": "🔥", "触板": "🚀",
              };
              const color = phaseColor[a.phase] || "#ef4444";
              const amountStr = a.amount >= 100000000
                ? `${(a.amount / 100000000).toFixed(1)}亿`
                : `${(a.amount / 10000).toFixed(0)}万`;
              return (
                <div key={a.code} className="flex items-center gap-2 text-[11px] py-1 border-b border-[var(--border-color)] last:border-0">
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: `${color}20`, color }}>
                    {phaseEmoji[a.phase]} {a.phase}
                  </span>
                  <span className="font-bold w-16">{a.name}</span>
                  <span className="text-[var(--text-secondary)] font-mono w-14">{a.code}</span>
                  <span className="font-bold tabular-nums" style={{ color: "#ef4444" }}>+{a.changePercent}%</span>
                  <span className="text-[var(--text-secondary)] tabular-nums">
                    {a.distancePercent > 0 ? `差${a.distancePercent}%` : "触板"}
                  </span>
                  <span className="text-[9px] text-[var(--text-secondary)]">换手{a.turnoverRate}%</span>
                  <span className="text-[9px] text-[var(--text-secondary)]">{amountStr}</span>
                  <span className="text-[9px] text-[var(--text-secondary)] ml-auto truncate max-w-[180px]">{a.momentum}</span>
                </div>
              );
            })}
          </div>
          {limitUpAlerts.filter(a => a.phase === "封板").length > 0 && (
            <div className="mt-2 pt-2 border-t border-[var(--border-color)]">
              <span className="text-[9px] text-[var(--text-secondary)]">
                🔒 已封板：{limitUpAlerts.filter(a => a.phase === "封板").slice(0, 8).map(a => a.name).join("、")}
                {limitUpAlerts.filter(a => a.phase === "封板").length > 8 ? ` 等${limitUpAlerts.filter(a => a.phase === "封板").length}只` : ""}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 最新决策 */}
      {lastReasoning && (
        <div className="rounded-xl border border-[#3b82f640] bg-[#3b82f608] p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">🎯</span>
            <h3 className="text-xs font-bold text-[#3b82f6]">最新决策</h3>
          </div>
          <p className="text-[11px] text-[var(--text-primary)] leading-relaxed">{lastReasoning}</p>
          {lastActions.filter(a => a.type !== "持仓").length > 0 && (
            <div className="mt-2 space-y-1">
              {lastActions.filter(a => a.type !== "持仓").map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                    a.type === "买入" || a.type === "加仓" ? "bg-[#ef444420] text-[#ef4444]" : "bg-[#10b98120] text-[#10b981]"
                  }`}>{a.type}</span>
                  <span className="font-bold">{a.name}</span>
                  <span className="text-[var(--text-secondary)]">{a.shares}股 ¥{a.amount.toFixed(0)}</span>
                  <span className="text-[var(--text-secondary)] text-[9px] ml-auto">{a.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 标签切换 */}
      <div className="flex gap-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
              tab === t.key ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}>{t.icon} {t.label}</button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab data={data} />}
      {tab === "holdings" && <HoldingsTab holdings={data.holdings} />}
      {tab === "trades" && <TradesTab trades={data.trades} />}
      {tab === "chart" && <ChartTab snapshots={data.snapshots} initialCapital={data.initialCapital} />}
    </div>
  );
}

// ==================== 总览 ====================

function OverviewTab({ data }: { data: PortfolioData }) {
  const totalValue = data.totalValue || (data.cash + data.holdings.reduce((s, h) => s + h.currentValue, 0));
  const snap = data.snapshots[data.snapshots.length - 1];

  return (
    <div className="space-y-4">
      {/* 资产构成 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-3">💰 资产构成</h3>
        <div className="relative h-6 rounded-full overflow-hidden flex mb-2">
          {data.holdings.map((h, i) => (
            <div key={h.code} className="h-full" title={`${h.name}: ¥${h.currentValue.toFixed(0)}`}
              style={{ width: `${(h.currentValue / totalValue) * 100}%`, background: "#ef4444" }} />
          ))}
          <div className="h-full bg-[var(--bg-secondary)]" style={{ width: `${(data.cash / totalValue) * 100}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
          {data.holdings.map(h => (
            <span key={h.code} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#ef4444]" />
              <span className="font-bold">{h.name}</span>
              <span className="text-[var(--text-secondary)] font-mono">{h.code}</span>
              <span className="text-[var(--text-secondary)]">{((h.currentValue / totalValue) * 100).toFixed(0)}%</span>
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[var(--bg-secondary)]" />
            <span className="font-bold">现金</span>
            <span className="text-[var(--text-secondary)]">{((data.cash / totalValue) * 100).toFixed(0)}%</span>
          </span>
        </div>
      </div>

      {/* 快照 */}
      {snap && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
          <h3 className="text-sm font-bold mb-3">📅 最新快照 ({snap.date})</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SnapItem label="日盈亏" value={`${snap.dailyPnl >= 0 ? "+" : ""}¥${snap.dailyPnl.toFixed(2)}`} pct={snap.dailyPnlPercent} />
            <SnapItem label="累计盈亏" value={`${snap.totalPnl >= 0 ? "+" : ""}¥${snap.totalPnl.toFixed(2)}`} pct={snap.totalPnlPercent} />
            <SnapItem label="本周收益" value={`${snap.weekPnlPercent >= 0 ? "+" : ""}${snap.weekPnlPercent.toFixed(2)}%`} pct={snap.weekPnlPercent} />
            <SnapItem label="持仓数" value={`${snap.holdingCount}/1`} pct={0} />
          </div>
        </div>
      )}

      {/* 规则说明 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-2">📋 交易规则</h3>
        <div className="text-[11px] text-[var(--text-secondary)] space-y-1 leading-relaxed">
          <p>• <strong>初始资金</strong>：¥10,000，全力以赴精选1只</p>
          <p>• <strong>持仓上限</strong>：最多1只个股，集中火力</p>
          <p>• <strong>选股范围</strong>：全市场数千只A股，量化29因子+3层策略矩阵精选</p>
          <p>• <strong>选股门槛</strong>：≥30分+多策略共识+过滤ST/停牌/涨停</p>
          <p>• <strong>交易规则</strong>：T+1，100股整手，佣金万2.5(最低5元)+印花税0.05%+滑点0.1%</p>
          <p>• <strong>建仓策略</strong>：留25%现金弹药，70%可用资金建仓</p>
          <p>• <strong>止损</strong>：固定止损-5% + 移动止损4-10% + 日内急跌-3%止损</p>
          <p>• <strong>止盈</strong>：单票盈利≥12%止盈</p>
          <p>• <strong>补仓</strong>：量化分≥30+未深亏→用50%现金加仓</p>
          <p>• <strong>盘中买入</strong>：每5分钟全量扫描，≥40分+不追高(涨幅&lt;3%)+周线确认</p>
          <p>• <strong>风控</strong>：回撤≥3%警告→≥5%降仓→≥8%熔断清仓</p>
          <p>• <strong>通知</strong>：所有操作（买入/卖出/止损）实时推送企微</p>
          <p>• <strong>每日推荐</strong>：Top5最强票推送企微，供参考</p>
        </div>
      </div>
    </div>
  );
}

// ==================== 持仓 ====================

function HoldingsTab({ holdings }: { holdings: Holding[] }) {
  if (holdings.length === 0) return (
    <div className="text-center py-12 text-[var(--text-secondary)]">
      <span className="text-3xl block mb-2">🏖️</span>
      <p className="text-sm">当前空仓，等待最强买入信号</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {holdings.map(h => {
        const color = h.pnl >= 0 ? "#ef4444" : "#10b981";
        return (
          <div key={h.code} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-[#ef4444]" />
                  <span className="text-sm font-bold">{h.name}</span>
                  <span className="text-[9px] text-[var(--text-secondary)] font-mono">{h.code}</span>
                  {!h.canSellToday && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#f59e0b18] text-[#f59e0b] font-bold">T+1锁定</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--text-secondary)]">
                  <span>买入 {h.buyDate}</span>
                  <span>·</span>
                  <span>持有 {h.holdDays}天</span>
                  <span>·</span>
                  <span>{h.shares}股</span>
                  <span>·</span>
                  <span>量化分 <strong style={{ color: h.quantScore >= 30 ? "#ef4444" : "#94a3b8" }}>{h.quantScore}</strong></span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-black tabular-nums" style={{ color }}>
                  {h.pnl >= 0 ? "+" : ""}{h.pnlPercent.toFixed(2)}%
                </div>
                <div className="text-[10px] text-[var(--text-secondary)]">
                  {h.pnl >= 0 ? "+" : ""}¥{h.pnl.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px] mt-2">
              <div className="rounded-lg bg-[var(--bg-secondary)] p-2">
                <span className="text-[var(--text-secondary)]">成本</span>
                <div className="font-bold tabular-nums">¥{h.costAmount.toFixed(2)}</div>
              </div>
              <div className="rounded-lg bg-[var(--bg-secondary)] p-2">
                <span className="text-[var(--text-secondary)]">市值</span>
                <div className="font-bold tabular-nums" style={{ color }}>¥{h.currentValue.toFixed(2)}</div>
              </div>
              <div className="rounded-lg bg-[var(--bg-secondary)] p-2">
                <span className="text-[var(--text-secondary)]">买入价</span>
                <div className="font-bold tabular-nums">{h.buyPrice.toFixed(2)}</div>
              </div>
              <div className="rounded-lg bg-[var(--bg-secondary)] p-2">
                <span className="text-[var(--text-secondary)]">现价</span>
                <div className="font-bold tabular-nums" style={{ color }}>{h.currentPrice.toFixed(2)}</div>
              </div>
              <div className="rounded-lg bg-[var(--bg-secondary)] p-2">
                <span className="text-[var(--text-secondary)]">止损线</span>
                <div className="font-bold tabular-nums text-[#f59e0b]">-{h.trailingStopPct}%</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==================== 交易记录 ====================

function TradesTab({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) return (
    <div className="text-center py-12 text-[var(--text-secondary)]">
      <span className="text-3xl block mb-2">📭</span>
      <p className="text-sm">暂无交易记录</p>
    </div>
  );

  const sorted = [...trades].reverse();
  const typeStyle: Record<string, { bg: string; text: string }> = {
    "买入": { bg: "#ef444420", text: "#ef4444" },
    "加仓": { bg: "#f9731620", text: "#f97316" },
    "减仓": { bg: "#3b82f620", text: "#3b82f6" },
    "卖出": { bg: "#10b98120", text: "#10b981" },
  };

  return (
    <div className="space-y-2">
      {sorted.slice(0, 30).map((t, i) => {
        const ts = typeStyle[t.type] || typeStyle["买入"];
        return (
          <div key={i} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded font-bold" style={{ background: ts.bg, color: ts.text }}>{t.type}</span>
                <span className="text-sm font-bold">{t.name}</span>
                <span className="text-[9px] text-[var(--text-secondary)] font-mono">{t.code}</span>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold tabular-nums">¥{t.amount.toFixed(0)}</span>
                <span className="text-[9px] text-[var(--text-secondary)] ml-1">{t.shares}股</span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-1 text-[9px] text-[var(--text-secondary)]">
              <span>{t.date} | ¥{t.price.toFixed(2)} | 佣金¥{t.commission.toFixed(2)}+印花税¥{t.stampTax.toFixed(2)} | 量化{t.quantScore}分</span>
              <span className="text-right max-w-[50%] truncate">{t.reason}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==================== 净值曲线 ====================

function ChartTab({ snapshots, initialCapital }: { snapshots: Snapshot[]; initialCapital: number }) {
  if (snapshots.length === 0) return (
    <div className="text-center py-12 text-[var(--text-secondary)]">
      <span className="text-3xl block mb-2">📈</span>
      <p className="text-sm">暂无历史数据，调仓后生成</p>
    </div>
  );

  const values = snapshots.map(s => s.totalValue);
  const maxVal = Math.max(...values) * 1.02;
  const minVal = Math.min(...values, initialCapital) * 0.98;
  const range = maxVal - minVal || 1;

  const w = 600, h = 200, pad = 30;
  const points = snapshots.map((s, i) => ({
    x: pad + (i / Math.max(snapshots.length - 1, 1)) * (w - pad * 2),
    y: pad + (1 - (s.totalValue - minVal) / range) * (h - pad * 2),
  }));
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const baseLine = pad + (1 - (initialCapital - minVal) / range) * (h - pad * 2);
  const latestPnl = snapshots[snapshots.length - 1]?.totalPnlPercent || 0;
  const lineColor = latestPnl >= 0 ? "#ef4444" : "#10b981";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-3">📈 净值曲线</h3>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 280 }}>
          <line x1={pad} y1={baseLine} x2={w - pad} y2={baseLine} stroke="#6b7280" strokeWidth="0.5" strokeDasharray="4 2" />
          <text x={pad - 5} y={baseLine + 3} fill="#6b7280" fontSize="8" textAnchor="end">1万</text>
          <path d={`${pathD} L ${points[points.length - 1]?.x || pad} ${h - pad} L ${pad} ${h - pad} Z`}
            fill={lineColor} fillOpacity="0.08" />
          <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" />
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={snapshots.length > 30 ? 1.5 : 3}
              fill={lineColor} stroke="var(--bg-card)" strokeWidth="1" />
          ))}
          {snapshots.filter((_, i) => i % Math.max(1, Math.floor(snapshots.length / 6)) === 0 || i === snapshots.length - 1).map((s, i) => {
            const idx = snapshots.indexOf(s);
            const x = pad + (idx / Math.max(snapshots.length - 1, 1)) * (w - pad * 2);
            return <text key={i} x={x} y={h - 5} fill="#6b7280" fontSize="7" textAnchor="middle">{s.date.slice(5)}</text>;
          })}
        </svg>
      </div>

      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-3">📅 每日明细</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                <th className="text-left py-1.5 pr-2">日期</th>
                <th className="text-right py-1.5 px-2">总资产</th>
                <th className="text-right py-1.5 px-2">日盈亏</th>
                <th className="text-right py-1.5 px-2">累计</th>
                <th className="text-right py-1.5 px-2">周收益</th>
                <th className="text-right py-1.5 pl-2">持仓</th>
              </tr>
            </thead>
            <tbody>
              {[...snapshots].reverse().slice(0, 20).map(s => (
                <tr key={s.date} className="border-b border-[var(--border-color)] last:border-0">
                  <td className="py-1.5 pr-2 font-mono">{s.date.slice(5)}</td>
                  <td className="text-right py-1.5 px-2 tabular-nums">¥{s.totalValue.toFixed(0)}</td>
                  <td className="text-right py-1.5 px-2 tabular-nums font-bold" style={{ color: s.dailyPnl >= 0 ? "#ef4444" : "#10b981" }}>
                    {s.dailyPnl >= 0 ? "+" : ""}{s.dailyPnlPercent.toFixed(2)}%
                  </td>
                  <td className="text-right py-1.5 px-2 tabular-nums" style={{ color: s.totalPnl >= 0 ? "#ef4444" : "#10b981" }}>
                    {s.totalPnlPercent >= 0 ? "+" : ""}{s.totalPnlPercent.toFixed(2)}%
                  </td>
                  <td className="text-right py-1.5 px-2 tabular-nums" style={{ color: s.weekPnlPercent >= 0 ? "#ef4444" : "#10b981" }}>
                    {s.weekPnlPercent >= 0 ? "+" : ""}{s.weekPnlPercent.toFixed(2)}%
                  </td>
                  <td className="text-right py-1.5 pl-2">{s.holdingCount}/1</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==================== 小组件 ====================

function MetricCard({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
      <div className="text-[10px] text-[var(--text-secondary)]">{label}</div>
      <div className="text-lg font-black tabular-nums mt-0.5" style={{ color }}>{value}</div>
      <div className="text-[9px] text-[var(--text-secondary)] mt-0.5">{sub}</div>
    </div>
  );
}

function SnapItem({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="rounded-lg bg-[var(--bg-secondary)] p-2.5 text-center">
      <div className="text-[9px] text-[var(--text-secondary)]">{label}</div>
      <div className="text-xs font-bold tabular-nums mt-0.5" style={{ color: pct > 0 ? "#ef4444" : pct < 0 ? "#10b981" : "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}
