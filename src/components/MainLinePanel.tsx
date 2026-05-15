"use client";

import { useState, useEffect } from "react";

type SignalType = "入场" | "离场" | "加仓" | "减仓" | "观望";
type SignalStrength = "强" | "中" | "弱";
type LineType = "主线" | "副线" | "轮动热点" | "退潮板块";

interface TradeSignal {
  type: SignalType;
  strength: SignalStrength;
  price?: number;
  reason: string;
  timestamp: string;
}

interface MainLineItem {
  sector: string;
  lineType: LineType;
  rank: number;
  consecutiveUpDays: number;
  weekChangePercent: number;
  monthChangePercent: number;
  avgDailyAmount: number;
  amountTrend: string;
  riseRatio: number;
  leadingStocks: string[];
  currentSignal: TradeSignal;
  recentSignals: TradeSignal[];
  strengthScore: number;
  momentum: string;
  analysis: string;
  keyLevels: { entry: number[]; exit: number[] };
}

interface MainLineReport {
  period: string;
  generatedAt: string;
  marketPhase: string;
  mainLines: MainLineItem[];
  subLines: MainLineItem[];
  rotationHots: MainLineItem[];
  fadingLines: MainLineItem[];
  summary: string;
  tradingPlan: string;
}

// ==================== 小组件 ====================

function SignalTag({ signal }: { signal: TradeSignal }) {
  const config: Record<SignalType, { bg: string; border: string; text: string; icon: string }> = {
    "入场": { bg: "#ef444418", border: "#ef4444", text: "#ef4444", icon: "🔺" },
    "加仓": { bg: "#f59e0b18", border: "#f59e0b", text: "#f59e0b", icon: "△" },
    "离场": { bg: "#10b98118", border: "#10b981", text: "#10b981", icon: "🔻" },
    "减仓": { bg: "#3b82f618", border: "#3b82f6", text: "#3b82f6", icon: "▽" },
    "观望": { bg: "#6b728018", border: "#6b7280", text: "#94a3b8", icon: "◆" },
  };
  const c = config[signal.type] || config["观望"];
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-bold"
      style={{ background: c.bg, borderColor: c.border, color: c.text }}>
      <span>{c.icon}</span>
      <span>{signal.type}</span>
      <span className="text-xs font-normal opacity-75">({signal.strength})</span>
    </div>
  );
}

function LineTypeBadge({ type }: { type: LineType }) {
  const config: Record<LineType, { bg: string; text: string }> = {
    "主线": { bg: "#ef444425", text: "#ef4444" },
    "副线": { bg: "#f59e0b25", text: "#f59e0b" },
    "轮动热点": { bg: "#3b82f625", text: "#3b82f6" },
    "退潮板块": { bg: "#6b728025", text: "#94a3b8" },
  };
  const c = config[type];
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: c.bg, color: c.text }}>
      {type}
    </span>
  );
}

function MomentumTag({ momentum }: { momentum: string }) {
  const colors: Record<string, string> = {
    "加速": "#ef4444", "高位震荡": "#f59e0b", "减速": "#3b82f6",
    "见顶回落": "#10b981", "底部企稳": "#8b5cf6", "持续走弱": "#6b7280",
  };
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded border"
      style={{ borderColor: `${colors[momentum] || "#6b7280"}50`, color: colors[momentum] || "#6b7280" }}>
      {momentum}
    </span>
  );
}

function StrengthMeter({ score }: { score: number }) {
  const color = score >= 70 ? "#ef4444" : score >= 50 ? "#f59e0b" : score >= 30 ? "#3b82f6" : "#6b7280";
  const segments = 10;
  const filled = Math.round((score / 100) * segments);
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {Array.from({ length: segments }).map((_, i) => (
          <div key={i} className="w-2.5 h-4 rounded-sm transition-all"
            style={{ background: i < filled ? color : "#1e2d4a" }} />
        ))}
      </div>
      <span className="text-xs font-bold w-8" style={{ color }}>{score}</span>
    </div>
  );
}

function KeyLevelDisplay({ levels, type }: { levels: number[]; type: "entry" | "exit" }) {
  if (levels.length === 0) return <span className="text-xs text-[var(--text-secondary)]">—</span>;
  const color = type === "entry" ? "#10b981" : "#ef4444";
  const icon = type === "entry" ? "▸" : "◂";
  return (
    <div className="flex flex-wrap gap-1">
      {levels.map((p, i) => (
        <span key={i} className="text-[11px] font-mono px-1.5 py-0.5 rounded"
          style={{ background: `${color}15`, color }}>
          {icon} {p}
        </span>
      ))}
    </div>
  );
}

// ==================== 板块卡片 ====================

function SectorCard({ item, showDetail }: { item: MainLineItem; showDetail?: boolean }) {
  const [expanded, setExpanded] = useState(showDetail || false);
  const changeColor = item.weekChangePercent >= 0 ? "var(--accent-red)" : "var(--accent-green)";

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden hover:border-[#2d4a7a] transition-all">
      {/* 头部 */}
      <div className="px-4 py-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-secondary)] font-mono w-5">#{item.rank}</span>
            <h3 className="font-bold text-base">{item.sector}</h3>
            <LineTypeBadge type={item.lineType} />
            <MomentumTag momentum={item.momentum} />
          </div>
          <SignalTag signal={item.currentSignal} />
        </div>

        {/* 指标行 */}
        <div className="flex items-center gap-4 mb-2">
          <div className="flex items-center gap-1">
            <span className="text-xs text-[var(--text-secondary)]">周涨幅</span>
            <span className="text-sm font-bold font-mono" style={{ color: changeColor }}>
              {item.weekChangePercent >= 0 ? "+" : ""}{item.weekChangePercent}%
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-[var(--text-secondary)]">连涨</span>
            <span className="text-sm font-bold">{item.consecutiveUpDays}天</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-[var(--text-secondary)]">上涨占比</span>
            <span className="text-sm font-bold">{(item.riseRatio * 100).toFixed(0)}%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-[var(--text-secondary)]">量能</span>
            <span className={`text-sm font-bold ${item.amountTrend === "放量" ? "text-[var(--accent-red)]" : item.amountTrend === "缩量" ? "text-[var(--accent-green)]" : ""}`}>
              {item.amountTrend}
            </span>
          </div>
        </div>

        {/* 强度条 */}
        <StrengthMeter score={item.strengthScore} />
      </div>

      {/* 信号原因（始终显示） */}
      <div className="px-4 pb-3">
        <div className="rounded-lg px-3 py-2" style={{
          background: item.currentSignal.type === "入场" || item.currentSignal.type === "加仓"
            ? "#ef444410" : item.currentSignal.type === "离场" || item.currentSignal.type === "减仓"
            ? "#10b98110" : "#6b728010"
        }}>
          <p className="text-xs">
            <span className="font-bold" style={{
              color: item.currentSignal.type === "入场" || item.currentSignal.type === "加仓"
                ? "#ef4444" : item.currentSignal.type === "离场" || item.currentSignal.type === "减仓"
                ? "#10b981" : "#94a3b8"
            }}>
              {item.currentSignal.type}信号：
            </span>
            <span className="text-[var(--text-secondary)]">{item.currentSignal.reason}</span>
          </p>
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-[var(--border-color)] space-y-3">
          {/* 关键价位 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <h4 className="text-xs text-[var(--text-secondary)] mb-1.5 font-medium">📍 入场参考价位（支撑位）</h4>
              <KeyLevelDisplay levels={item.keyLevels.entry} type="entry" />
            </div>
            <div>
              <h4 className="text-xs text-[var(--text-secondary)] mb-1.5 font-medium">🎯 离场参考价位（阻力位）</h4>
              <KeyLevelDisplay levels={item.keyLevels.exit} type="exit" />
            </div>
          </div>

          {/* 详细分析 */}
          <div>
            <h4 className="text-xs text-[var(--text-secondary)] mb-1 font-medium">📊 板块分析</h4>
            <p className="text-xs text-[var(--text-primary)] leading-relaxed">{item.analysis}</p>
          </div>

          {/* 领涨股 */}
          {item.leadingStocks.length > 0 && (
            <div>
              <h4 className="text-xs text-[var(--text-secondary)] mb-1 font-medium">🔥 领涨个股</h4>
              <div className="flex flex-wrap gap-1">
                {item.leadingStocks.map((s, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-primary)]">{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== 主面板 ====================

export default function MainLinePanel() {
  const [report, setReport] = useState<MainLineReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [viewMode, setViewMode] = useState<"cards" | "signals">("cards");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const resp = await fetch(`/api/mainline?period=${period}`);
        const data = await resp.json();
        if (!data.error) setReport(data);
      } catch {} finally {
        setLoading(false);
      }
    }
    load();
  }, [period]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] animate-pulse h-32" />
        ))}
      </div>
    );
  }

  if (!report) {
    return <div className="card text-center py-12 text-[var(--text-secondary)]">暂无数据</div>;
  }

  // 提取所有入场和离场信号
  const allItems = [...report.mainLines, ...report.subLines, ...report.rotationHots, ...report.fadingLines];
  const entrySignals = allItems.filter(i => i.currentSignal.type === "入场" || i.currentSignal.type === "加仓");
  const exitSignals = allItems.filter(i => i.currentSignal.type === "离场" || i.currentSignal.type === "减仓");

  return (
    <div className="space-y-6">
      {/* 顶部控制栏 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setPeriod("week")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${period === "week" ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-color)]"}`}>
            📅 本周主线
          </button>
          <button onClick={() => setPeriod("month")}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${period === "month" ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-color)]"}`}>
            🗓️ 本月主线
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setViewMode("cards")}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${viewMode === "cards" ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-color)]"}`}>
            卡片视图
          </button>
          <button onClick={() => setViewMode("signals")}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${viewMode === "signals" ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-color)]"}`}>
            信号总览
          </button>
        </div>
      </div>

      {/* 市场阶段 + 总结 */}
      <div className="rounded-xl border-2 border-[var(--accent-blue)] bg-[#3b82f608] p-5">
        <div className="flex items-start gap-3 mb-3">
          <span className="text-2xl">🎯</span>
          <div className="flex-1">
            <h2 className="text-base font-bold mb-1">{report.marketPhase}</h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{report.summary}</p>
          </div>
        </div>
        <div className="rounded-lg bg-[var(--bg-card)] p-3 mt-3">
          <h3 className="text-xs font-bold text-[var(--accent-yellow)] mb-1">📋 交易计划</h3>
          <p className="text-xs text-[var(--text-primary)] leading-relaxed">{report.tradingPlan}</p>
        </div>
      </div>

      {viewMode === "signals" ? (
        /* ======== 信号总览视图 ======== */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 入场信号 */}
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
            <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[var(--accent-red)]" />
              入场 / 加仓信号
              <span className="text-xs text-[var(--text-secondary)] font-normal">({entrySignals.length}个)</span>
            </h3>
            {entrySignals.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] py-4 text-center">当前暂无入场信号</p>
            ) : (
              <div className="space-y-3">
                {entrySignals.map(item => (
                  <div key={item.sector} className="rounded-lg bg-[#ef444408] border border-[#ef444420] p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm">{item.sector}</span>
                        <LineTypeBadge type={item.lineType} />
                      </div>
                      <SignalTag signal={item.currentSignal} />
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mb-2">{item.currentSignal.reason}</p>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-[var(--text-secondary)]">强度 {item.strengthScore}</span>
                      <span className="text-[10px] text-[var(--text-secondary)]">连涨 {item.consecutiveUpDays}天</span>
                      <span className="text-[10px] text-[var(--text-secondary)]">{item.amountTrend}</span>
                    </div>
                    {item.keyLevels.entry.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[#ef444415]">
                        <span className="text-[10px] text-[var(--text-secondary)]">参考入场价：</span>
                        <KeyLevelDisplay levels={item.keyLevels.entry} type="entry" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 离场信号 */}
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
            <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[var(--accent-green)]" />
              离场 / 减仓信号
              <span className="text-xs text-[var(--text-secondary)] font-normal">({exitSignals.length}个)</span>
            </h3>
            {exitSignals.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)] py-4 text-center">当前暂无离场信号</p>
            ) : (
              <div className="space-y-3">
                {exitSignals.map(item => (
                  <div key={item.sector} className="rounded-lg bg-[#10b98108] border border-[#10b98120] p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm">{item.sector}</span>
                        <LineTypeBadge type={item.lineType} />
                      </div>
                      <SignalTag signal={item.currentSignal} />
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mb-2">{item.currentSignal.reason}</p>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-[var(--text-secondary)]">强度 {item.strengthScore}</span>
                      <span className="text-[10px] text-[var(--text-secondary)]">周涨 {item.weekChangePercent}%</span>
                      <span className="text-[10px] text-[var(--text-secondary)]">{item.momentum}</span>
                    </div>
                    {item.keyLevels.exit.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[#10b98115]">
                        <span className="text-[10px] text-[var(--text-secondary)]">参考离场价：</span>
                        <KeyLevelDisplay levels={item.keyLevels.exit} type="exit" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ======== 卡片视图 ======== */
        <div className="space-y-6">
          {/* 主线 */}
          {report.mainLines.length > 0 && (
            <div>
              <h2 className="text-sm font-bold mb-3 flex items-center gap-2">
                <span className="w-1.5 h-5 rounded-full bg-[var(--accent-red)]" />
                主线板块
                <span className="text-xs text-[var(--text-secondary)] font-normal">— 持续性最强，重仓方向</span>
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {report.mainLines.map(item => <SectorCard key={item.sector} item={item} showDetail />)}
              </div>
            </div>
          )}

          {/* 副线 */}
          {report.subLines.length > 0 && (
            <div>
              <h2 className="text-sm font-bold mb-3 flex items-center gap-2">
                <span className="w-1.5 h-5 rounded-full bg-[var(--accent-yellow)]" />
                副线板块
                <span className="text-xs text-[var(--text-secondary)] font-normal">— 有一定持续性，可适当参与</span>
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {report.subLines.map(item => <SectorCard key={item.sector} item={item} />)}
              </div>
            </div>
          )}

          {/* 轮动热点 */}
          {report.rotationHots.length > 0 && (
            <div>
              <h2 className="text-sm font-bold mb-3 flex items-center gap-2">
                <span className="w-1.5 h-5 rounded-full bg-[var(--accent-blue)]" />
                轮动热点
                <span className="text-xs text-[var(--text-secondary)] font-normal">— 短线机会，快进快出</span>
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                {report.rotationHots.map(item => <SectorCard key={item.sector} item={item} />)}
              </div>
            </div>
          )}

          {/* 退潮板块 */}
          {report.fadingLines.length > 0 && (
            <div>
              <h2 className="text-sm font-bold mb-3 flex items-center gap-2">
                <span className="w-1.5 h-5 rounded-full bg-[#6b7280]" />
                退潮板块
                <span className="text-xs text-[var(--text-secondary)] font-normal">— 走弱回避，等待企稳</span>
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                {report.fadingLines.map(item => <SectorCard key={item.sector} item={item} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 底部免责 */}
      <div className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] p-4">
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          ⚠️ <strong>免责声明：</strong>主线/副线判断基于板块涨跌幅、连续性、量能等客观数据计算，
          入场/离场信号基于技术面分析，仅供参考。市场受政策、资金、情绪等多重因素影响，
          信号存在滞后性和局限性。请结合自身判断，独立做出投资决策。
        </p>
      </div>
    </div>
  );
}
