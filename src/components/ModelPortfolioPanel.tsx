"use client";
import { useState, useEffect, useCallback } from "react";

// ==================== 类型 ====================

interface PortfolioHolding {
  code: string; name: string; sector: string;
  buyDate: string; buyNav: number; currentNav: number;
  shares: number; costAmount: number; currentValue: number;
  pnl: number; pnlPercent: number; quantScore: number;
  holdDays: number; action: string; tags: string[];
}

interface TradeRecord {
  date: string; time: string; code: string; name: string; sector: string;
  type: "买入" | "卖出" | "加仓" | "减仓";
  nav: number; amount: number; shares: number; reason: string; quantScore: number;
}

interface DailySnapshot {
  date: string; totalValue: number; cash: number; holdingValue: number;
  dailyPnl: number; dailyPnlPercent: number;
  totalPnl: number; totalPnlPercent: number;
  holdingCount: number; weekPnlPercent: number;
}

interface PortfolioData {
  initialCapital: number; cash: number;
  holdings: PortfolioHolding[]; trades: TradeRecord[];
  snapshots: DailySnapshot[]; lastRebalanceDate: string;
  createdAt: string; weekStartValue: number; weekStartDate: string;
  totalValue: number; totalPnl: number; totalPnlPercent: number;
  weekPnlPercent: number;
}

interface RebalanceAction {
  type: "买入" | "卖出" | "加仓" | "减仓" | "持仓";
  code: string; name: string; sector: string;
  amount: number; reason: string; quantScore: number;
}

// ==================== 主面板 ====================

export default function ModelPortfolioPanel() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebalancing, setRebalancing] = useState(false);
  const [lastActions, setLastActions] = useState<RebalanceAction[]>([]);
  const [lastReasoning, setLastReasoning] = useState("");
  const [tab, setTab] = useState<"overview" | "holdings" | "trades" | "chart">("overview");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/model-portfolio");
      if (!res.ok) throw new Error();
      const json = await res.json();
      if (!json.error) setData(json);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 自动调仓：交易日14:30自动触发，或打开页面时发现今天未调仓且在交易时段自动执行
  useEffect(() => {
    if (!data || loading || rebalancing) return;
    const today = new Date().toISOString().slice(0, 10);
    const alreadyRebalanced = data.lastRebalanceDate === today;

    const checkAutoRebalance = () => {
      const now = new Date();
      const utc = now.getTime() + now.getTimezoneOffset() * 60000;
      const bj = new Date(utc + 8 * 3600000);
      const day = bj.getDay();
      if (day === 0 || day === 6) return; // 周末不操作
      const t = bj.getHours() * 60 + bj.getMinutes();
      const isTradingDay = t >= 555 && t <= 900; // 9:15-15:00
      const todayStr = bj.toISOString().slice(0, 10);
      const done = data.lastRebalanceDate === todayStr;
      // 交易日且未调仓 → 14:45后自动调仓（尾盘变化大，等稳定）
      if (isTradingDay && !done && t >= 885) {
        triggerRebalance(false);
      }
    };

    // 页面加载时立即检测一次
    if (!alreadyRebalanced) {
      const timer = setTimeout(checkAutoRebalance, 3000); // 3秒后检测，等数据加载
      return () => clearTimeout(timer);
    }

    // 定时轮询：每5分钟检测一次（覆盖14:00-15:00窗口）
    const interval = setInterval(checkAutoRebalance, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [data, loading, rebalancing]);

  const triggerRebalance = async (force = false) => {
    setRebalancing(true);
    try {
      const res = await fetch("/api/model-portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const json = await res.json();
      if (json.portfolio) {
        setData({
          ...json.portfolio,
          totalValue: json.portfolio.totalValue || 0,
          totalPnl: json.portfolio.totalPnl || 0,
          totalPnlPercent: json.portfolio.totalPnlPercent || 0,
          weekPnlPercent: json.portfolio.weekPnlPercent || 0,
        });
      }
      if (json.actions) setLastActions(json.actions);
      if (json.reasoning) setLastReasoning(json.reasoning);
    } catch {} finally { setRebalancing(false); }
  };

  if (loading) return (
    <div className="space-y-4">
      {[1,2,3].map(i => <div key={i} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] animate-pulse h-32" />)}
    </div>
  );

  if (!data) return (
    <div className="text-center py-20">
      <div className="text-4xl mb-3">🤖</div>
      <p className="text-[var(--text-secondary)] mb-4">模型盘尚未初始化</p>
      <button onClick={() => triggerRebalance(true)} disabled={rebalancing}
        className="px-6 py-3 rounded-xl bg-[var(--accent-blue)] text-white font-bold text-sm hover:opacity-90 disabled:opacity-50">
        {rebalancing ? "初始化中..." : "🚀 启动模型盘（1万元）"}
      </button>
    </div>
  );

  const totalValue = data.totalValue || (data.cash + data.holdings.reduce((s, h) => s + h.currentValue, 0));
  const totalPnl = data.totalPnl || (totalValue - data.initialCapital);
  const totalPnlPct = data.totalPnlPercent || (totalPnl / data.initialCapital * 100);
  const weekPnl = data.weekPnlPercent || 0;
  const holdingValue = data.holdings.reduce((s, h) => s + h.currentValue, 0);
  const positionPct = totalValue > 0 ? (holdingValue / totalValue * 100) : 0;
  const weekTarget = 2.5;
  const weekProgress = weekTarget > 0 ? Math.min(100, Math.max(0, weekPnl / weekTarget * 100)) : 0;

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
            <span className="text-2xl">🤖</span>
            <div>
              <h2 className="text-lg font-bold">AI量化模型盘</h2>
              <p className="text-[10px] text-[var(--text-secondary)]">初始1万 · 最多3票 · 周目标2.5% · 每日14:45自动调仓</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.lastRebalanceDate === new Date().toISOString().slice(0, 10)
              ? <span className="text-[9px] px-2 py-1 rounded-full bg-[#10b98118] text-[#10b981] font-bold">✅ 今日已调仓</span>
              : <span className="text-[9px] px-2 py-1 rounded-full bg-[#f59e0b18] text-[#f59e0b] font-bold">⏰ 14:45自动调仓</span>
            }
            <button onClick={() => triggerRebalance(true)} disabled={rebalancing}
              className="px-4 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 bg-[var(--accent-blue)] text-white hover:opacity-90">
              {rebalancing ? "⏳ 决策中..." : "🔄 手动调仓"}
            </button>
          </div>
        </div>

        {/* 核心数据 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricCard label="总资产" value={`¥${totalValue.toFixed(2)}`}
            color={totalPnl >= 0 ? "#ef4444" : "#10b981"} sub={`初始¥${data.initialCapital}`} />
          <MetricCard label="累计盈亏" value={`${totalPnl >= 0 ? "+" : ""}¥${totalPnl.toFixed(2)}`}
            color={totalPnl >= 0 ? "#ef4444" : "#10b981"} sub={`${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%`} />
          <MetricCard label="本周收益" value={`${weekPnl >= 0 ? "+" : ""}${weekPnl.toFixed(2)}%`}
            color={weekPnl >= weekTarget ? "#ef4444" : weekPnl >= 0 ? "#f59e0b" : "#10b981"}
            sub={weekPnl >= weekTarget ? "✅ 已达标" : `目标${weekTarget}%`} />
          <MetricCard label="仓位" value={`${positionPct.toFixed(0)}%`}
            color={positionPct > 70 ? "#ef4444" : positionPct > 30 ? "#f59e0b" : "#94a3b8"}
            sub={`${data.holdings.length}/3票 | 现金¥${data.cash.toFixed(0)}`} />
        </div>

        {/* 周目标进度条 */}
        <div className="mt-4">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-[var(--text-secondary)]">本周目标进度</span>
            <span className="font-bold" style={{ color: weekPnl >= weekTarget ? "#ef4444" : "#f59e0b" }}>
              {weekPnl.toFixed(2)}% / {weekTarget}%
            </span>
          </div>
          <div className="relative h-3 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
            <div className="absolute top-0 left-0 h-full rounded-full transition-all"
              style={{
                width: `${weekProgress}%`,
                background: weekPnl >= weekTarget ? "linear-gradient(90deg, #ef4444, #f97316)" : weekPnl >= 0 ? "linear-gradient(90deg, #f59e0b, #ef4444)" : "#10b981",
              }} />
            {/* 目标线 */}
            <div className="absolute top-0 h-full w-0.5 bg-white opacity-60" style={{ left: "100%" }} />
          </div>
        </div>
      </div>

      {/* 最新调仓动作 */}
      {lastReasoning && (
        <div className="rounded-xl border border-[#3b82f640] bg-[#3b82f608] p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">🤖</span>
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
                  <span className="text-[var(--text-secondary)]">¥{a.amount.toFixed(0)}</span>
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
              style={{ width: `${(h.currentValue / totalValue) * 100}%`, background: COLORS[i % COLORS.length] }} />
          ))}
          <div className="h-full bg-[var(--bg-secondary)]" style={{ width: `${(data.cash / totalValue) * 100}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
          {data.holdings.map((h, i) => (
            <span key={h.code} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
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

      {/* 今日快照 */}
      {snap && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
          <h3 className="text-sm font-bold mb-3">📅 最新快照 ({snap.date})</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SnapItem label="日盈亏" value={`${snap.dailyPnl >= 0 ? "+" : ""}¥${snap.dailyPnl.toFixed(2)}`}
              pct={snap.dailyPnlPercent} />
            <SnapItem label="累计盈亏" value={`${snap.totalPnl >= 0 ? "+" : ""}¥${snap.totalPnl.toFixed(2)}`}
              pct={snap.totalPnlPercent} />
            <SnapItem label="本周收益" value={`${snap.weekPnlPercent >= 0 ? "+" : ""}${snap.weekPnlPercent.toFixed(2)}%`}
              pct={snap.weekPnlPercent} />
            <SnapItem label="持仓数" value={`${snap.holdingCount}/3`} pct={0} />
          </div>
        </div>
      )}

      {/* 规则说明 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-2">📋 交易规则</h3>
        <div className="text-[11px] text-[var(--text-secondary)] space-y-1 leading-relaxed">
          <p>• <strong>初始资金</strong>：¥10,000，全部用于场外ETF（C类联接基金）</p>
          <p>• <strong>持仓上限</strong>：最多3只，板块分散</p>
          <p>• <strong>周目标</strong>：≥2.5%（¥250）</p>
          <p>• <strong>选股</strong>：量化引擎三层评分（多因子+AI增强+策略矩阵）Top标的</p>
          <p>• <strong>止损</strong>：单票亏损≥5%立即清仓</p>
          <p>• <strong>止盈</strong>：单票盈利≥8%止盈</p>
          <p>• <strong>加仓</strong>：量化分≥30且已浮盈的标的追加</p>
          <p>• <strong>清仓</strong>：量化分≤-20或触及止损线</p>
          <p>• <strong>调仓频率</strong>：每个交易日执行一次</p>
        </div>
      </div>
    </div>
  );
}

// ==================== 持仓 ====================

function HoldingsTab({ holdings }: { holdings: PortfolioHolding[] }) {
  if (holdings.length === 0) return (
    <div className="text-center py-12 text-[var(--text-secondary)]">
      <span className="text-3xl block mb-2">🏖️</span>
      <p className="text-sm">当前空仓，等待买入信号</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {holdings.map((h, i) => {
        const color = h.pnl >= 0 ? "#ef4444" : "#10b981";
        return (
          <div key={h.code} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-sm font-bold">{h.name}</span>
                  <span className="text-[9px] text-[var(--text-secondary)] font-mono">{h.code}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)]">{h.sector}</span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--text-secondary)]">
                  <span>买入 {h.buyDate}</span>
                  <span>·</span>
                  <span>持有 {h.holdDays}天</span>
                  <span>·</span>
                  <span>量化分 <strong style={{ color: h.quantScore >= 0 ? "#ef4444" : "#10b981" }}>{h.quantScore}</strong></span>
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

            {/* 详细数据 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] mt-2">
              <div className="rounded-lg bg-[var(--bg-secondary)] p-2">
                <span className="text-[var(--text-secondary)]">成本</span>
                <div className="font-bold tabular-nums">¥{h.costAmount.toFixed(2)}</div>
              </div>
              <div className="rounded-lg bg-[var(--bg-secondary)] p-2">
                <span className="text-[var(--text-secondary)]">市值</span>
                <div className="font-bold tabular-nums" style={{ color }}>¥{h.currentValue.toFixed(2)}</div>
              </div>
              <div className="rounded-lg bg-[var(--bg-secondary)] p-2">
                <span className="text-[var(--text-secondary)]">买入净值</span>
                <div className="font-bold tabular-nums">{h.buyNav.toFixed(4)}</div>
              </div>
              <div className="rounded-lg bg-[var(--bg-secondary)] p-2">
                <span className="text-[var(--text-secondary)]">当前净值</span>
                <div className="font-bold tabular-nums" style={{ color }}>{h.currentNav.toFixed(4)}</div>
              </div>
            </div>

            {/* 标签 */}
            {h.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {h.tags.map((t, j) => (
                  <span key={j} className="text-[8px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">{t}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ==================== 交易记录 ====================

function TradesTab({ trades }: { trades: TradeRecord[] }) {
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
      {sorted.map((t, i) => {
        const ts = typeStyle[t.type] || typeStyle["买入"];
        return (
          <div key={i} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded font-bold" style={{ background: ts.bg, color: ts.text }}>{t.type}</span>
                <span className="text-sm font-bold">{t.name}</span>
                <span className="text-[9px] text-[var(--text-secondary)]">{t.sector}</span>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold tabular-nums">¥{t.amount.toFixed(0)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-1 text-[9px] text-[var(--text-secondary)]">
              <span>{t.date} | 净值{t.nav.toFixed(4)} | 分{t.quantScore}</span>
              <span className="text-right max-w-[50%] truncate">{t.reason}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==================== 净值曲线 ====================

function ChartTab({ snapshots, initialCapital }: { snapshots: DailySnapshot[]; initialCapital: number }) {
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

  // SVG 路径
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
          {/* 基线 */}
          <line x1={pad} y1={baseLine} x2={w - pad} y2={baseLine} stroke="#6b7280" strokeWidth="0.5" strokeDasharray="4 2" />
          <text x={pad - 5} y={baseLine + 3} fill="#6b7280" fontSize="8" textAnchor="end">1万</text>

          {/* 填充区 */}
          <path d={`${pathD} L ${points[points.length - 1]?.x || pad} ${h - pad} L ${pad} ${h - pad} Z`}
            fill={lineColor} fillOpacity="0.08" />

          {/* 曲线 */}
          <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" />

          {/* 点 */}
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={snapshots.length > 30 ? 1.5 : 3}
              fill={lineColor} stroke="var(--bg-card)" strokeWidth="1" />
          ))}

          {/* X轴日期 */}
          {snapshots.filter((_, i) => i % Math.max(1, Math.floor(snapshots.length / 6)) === 0 || i === snapshots.length - 1).map((s, i) => {
            const idx = snapshots.indexOf(s);
            const x = pad + (idx / Math.max(snapshots.length - 1, 1)) * (w - pad * 2);
            return <text key={i} x={x} y={h - 5} fill="#6b7280" fontSize="7" textAnchor="middle">{s.date.slice(5)}</text>;
          })}

          {/* Y轴 */}
          {[minVal, (minVal + maxVal) / 2, maxVal].map((v, i) => {
            const y = pad + (1 - (v - minVal) / range) * (h - pad * 2);
            return <text key={i} x={pad - 5} y={y + 3} fill="#6b7280" fontSize="7" textAnchor="end">{v.toFixed(0)}</text>;
          })}
        </svg>
      </div>

      {/* 每日收益表 */}
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
                  <td className="text-right py-1.5 pl-2">{s.holdingCount}/3</td>
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

const COLORS = ["#ef4444", "#3b82f6", "#f59e0b", "#8b5cf6", "#10b981"];
