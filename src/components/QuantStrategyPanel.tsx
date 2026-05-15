"use client";
import { useState, useEffect, useCallback } from "react";

// ==================== 类型 ====================

type FactorCategory = "动量" | "价值" | "质量" | "波动率" | "资金流" | "技术面";
type StrategyName = "趋势跟踪" | "均值回归" | "事件驱动" | "动量反转";
type MarketRegime = "趋势上行" | "趋势下行" | "震荡区间" | "波动放大" | "低波横盘";
type QuantAction = "强力做多" | "做多" | "轻仓试多" | "观望" | "轻仓试空" | "做空" | "强力做空";

interface FactorScore {
  name: string; category: FactorCategory;
  raw: number; zScore: number; percentile: number;
  weight: number; weighted: number; desc: string;
}
interface StrategySignal {
  strategy: StrategyName; direction: "long" | "short" | "neutral";
  strength: number; confidence: number; reason: string; triggers: string[];
}
interface QuantDecision {
  code: string; name: string; sector: string;
  factors: FactorScore[]; factorComposite: number;
  regime: MarketRegime; aiAdjustedScore: number; aiBoost: number; aiReason: string;
  strategies: StrategySignal[]; matrixScore: number;
  matrixConsensus: "强共识" | "弱共识" | "分歧";
  finalScore: number; action: QuantAction; position: number;
  stopLoss: number; takeProfit: number;
  summary: string; tags: string[];
}
interface QuantReport {
  timestamp: string; regime: MarketRegime; regimeDetail: string;
  factorExposure: { category: FactorCategory; avgScore: number }[];
  strategyPerformance: { name: StrategyName; avgStrength: number; consensus: number }[];
  decisions: QuantDecision[];
  topLong: QuantDecision[]; topShort: QuantDecision[];
  marketScore: number; riskBudget: number; summary: string;
}

// ==================== 样式 ====================

const regimeStyle: Record<MarketRegime, { bg: string; text: string; emoji: string }> = {
  "趋势上行": { bg: "#ef444418", text: "#ef4444", emoji: "🚀" },
  "趋势下行": { bg: "#10b98118", text: "#10b981", emoji: "📉" },
  "震荡区间": { bg: "#f59e0b18", text: "#f59e0b", emoji: "〰️" },
  "波动放大": { bg: "#8b5cf618", text: "#8b5cf6", emoji: "⚡" },
  "低波横盘": { bg: "#6b728018", text: "#94a3b8", emoji: "😴" },
};

const actionStyle: Record<QuantAction, { bg: string; text: string; border: string }> = {
  "强力做多": { bg: "#ef444420", text: "#ef4444", border: "#ef4444" },
  "做多":     { bg: "#f97316 18", text: "#f97316", border: "#f97316" },
  "轻仓试多": { bg: "#f59e0b15", text: "#f59e0b", border: "#f59e0b" },
  "观望":     { bg: "#6b728010", text: "#94a3b8", border: "#6b7280" },
  "轻仓试空": { bg: "#3b82f615", text: "#3b82f6", border: "#3b82f6" },
  "做空":     { bg: "#06b6d418", text: "#06b6d4", border: "#06b6d4" },
  "强力做空": { bg: "#10b98120", text: "#10b981", border: "#10b981" },
};

const catColor: Record<FactorCategory, string> = {
  "动量": "#ef4444", "价值": "#f59e0b", "质量": "#3b82f6",
  "波动率": "#8b5cf6", "资金流": "#10b981", "技术面": "#f97316",
};

const stratColor: Record<StrategyName, { color: string; icon: string }> = {
  "趋势跟踪": { color: "#ef4444", icon: "📈" },
  "均值回归": { color: "#3b82f6", icon: "🔄" },
  "事件驱动": { color: "#f59e0b", icon: "📰" },
  "动量反转": { color: "#8b5cf6", icon: "🔀" },
};

// ==================== 组件 ====================

type TabKey = "dashboard" | "factors" | "strategies" | "decisions" | "risk";

export default function QuantStrategyPanel() {
  const [data, setData] = useState<QuantReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("dashboard");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/quant-strategy");
      if (!res.ok) throw new Error("fetch failed");
      setData(await res.json());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return (
    <div className="space-y-4">
      {[1,2,3].map(i => <div key={i} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] animate-pulse h-40" />)}
    </div>
  );
  if (!data) return (
    <div className="text-center py-20 text-[var(--text-secondary)]">
      <p className="text-lg mb-2">🤖</p><p>量化数据暂不可用</p>
      <button onClick={fetchData} className="mt-3 text-xs text-[var(--accent-blue)] hover:underline">重试</button>
    </div>
  );

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: "dashboard", label: "量化仪表盘", icon: "🎯" },
    { key: "factors", label: "多因子分析", icon: "🧬" },
    { key: "strategies", label: "策略矩阵", icon: "🧮" },
    { key: "decisions", label: "全部决策", icon: "📋" },
    { key: "risk", label: "风险管理", icon: "🛡️" },
  ];

  return (
    <div className="space-y-4">
      {/* 顶部banner */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold">🤖 量化策略引擎</h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
              style={{ background: regimeStyle[data.regime].bg, color: regimeStyle[data.regime].text }}>
              {regimeStyle[data.regime].emoji} {data.regime}
            </span>
            <span className="text-xs font-bold tabular-nums"
              style={{ color: data.marketScore >= 0 ? "#ef4444" : "#10b981" }}>
              全市场 {data.marketScore > 0 ? "+" : ""}{data.marketScore}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-secondary)]">仓位建议 {data.riskBudget}%</span>
            <button onClick={fetchData} className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent-blue)]">🔄</button>
          </div>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{data.summary}</p>
      </div>

      {/* 标签 */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`shrink-0 px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
              tab === t.key ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}>{t.icon} {t.label}</button>
        ))}
      </div>

      {tab === "dashboard" && <DashboardTab data={data} />}
      {tab === "factors" && <FactorsTab data={data} />}
      {tab === "strategies" && <StrategiesTab data={data} />}
      {tab === "decisions" && <DecisionsTab data={data} />}
      {tab === "risk" && <RiskTab data={data} />}
    </div>
  );
}

// ==================== 仪表盘 ====================

function DashboardTab({ data }: { data: QuantReport }) {
  return (
    <div className="space-y-4">
      {/* 市场状态 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-3">🌐 市场状态识别</h3>
        <div className="flex items-center gap-4 mb-3">
          <div className="text-3xl">{regimeStyle[data.regime].emoji}</div>
          <div>
            <div className="text-lg font-bold" style={{ color: regimeStyle[data.regime].text }}>{data.regime}</div>
            <div className="text-[11px] text-[var(--text-secondary)]">{data.regimeDetail}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-2xl font-black tabular-nums" style={{ color: data.marketScore >= 0 ? "#ef4444" : "#10b981" }}>
              {data.marketScore > 0 ? "+" : ""}{data.marketScore}
            </div>
            <div className="text-[10px] text-[var(--text-secondary)]">量化综合分</div>
          </div>
        </div>
        {/* 三层架构流程 */}
        <div className="grid grid-cols-3 gap-2 mt-4">
          <LayerCard label="Layer 1" title="多因子" score={Math.round(avg(data.decisions.map(d => d.factorComposite)))} desc={`${data.factorExposure.filter(f => f.avgScore > 0).length}因子看多`} />
          <LayerCard label="Layer 2" title="AI增强" score={Math.round(avg(data.decisions.map(d => d.aiBoost)))} desc={data.regime} />
          <LayerCard label="Layer 3" title="策略矩阵" score={Math.round(avg(data.decisions.map(d => d.matrixScore)))} desc={`${data.strategyPerformance.filter(s => s.avgStrength > 0).length}/4策略偏多`} />
        </div>
      </div>

      {/* 因子暴露雷达 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-3">🧬 因子暴露</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {data.factorExposure.map(f => (
            <div key={f.category} className="rounded-lg bg-[var(--bg-secondary)] p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full" style={{ background: catColor[f.category] }} />
                <span className="text-[11px] font-bold">{f.category}</span>
              </div>
              <div className="text-lg font-black tabular-nums" style={{ color: f.avgScore >= 0 ? catColor[f.category] : "#94a3b8" }}>
                {f.avgScore > 0 ? "+" : ""}{f.avgScore.toFixed(1)}
              </div>
              <BarMini value={f.avgScore} max={20} color={catColor[f.category]} />
            </div>
          ))}
        </div>
      </div>

      {/* 策略共识度 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-3">🧮 策略共识</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {data.strategyPerformance.map(s => {
            const sc = stratColor[s.name];
            return (
              <div key={s.name} className="rounded-lg bg-[var(--bg-secondary)] p-3 text-center">
                <div className="text-lg mb-1">{sc.icon}</div>
                <div className="text-[11px] font-bold">{s.name}</div>
                <div className="text-sm font-black tabular-nums mt-1" style={{ color: s.avgStrength >= 0 ? sc.color : "#94a3b8" }}>
                  {s.avgStrength > 0 ? "+" : ""}{s.avgStrength}
                </div>
                <div className="text-[9px] text-[var(--text-secondary)] mt-0.5">共识 {s.consensus}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* TOP 看多/看空 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
          <h3 className="text-sm font-bold mb-3 text-[#ef4444]">🔥 做多前5</h3>
          {data.topLong.slice(0, 5).map(d => <MiniDecisionRow key={d.code} d={d} />)}
          {data.topLong.length === 0 && <p className="text-[11px] text-[var(--text-secondary)]">暂无做多信号</p>}
        </div>
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
          <h3 className="text-sm font-bold mb-3 text-[#10b981]">⚠️ 做空/回避前5</h3>
          {data.topShort.slice(0, 5).map(d => <MiniDecisionRow key={d.code} d={d} />)}
          {data.topShort.length === 0 && <p className="text-[11px] text-[var(--text-secondary)]">暂无做空信号</p>}
        </div>
      </div>
    </div>
  );
}

// ==================== 多因子分析 ====================

function FactorsTab({ data }: { data: QuantReport }) {
  const [selected, setSelected] = useState<string>(data.decisions[0]?.code || "");
  const d = data.decisions.find(x => x.code === selected) || data.decisions[0];
  if (!d) return <p className="text-[var(--text-secondary)] text-sm py-8 text-center">无数据</p>;

  const grouped: Record<FactorCategory, FactorScore[]> = { "动量": [], "价值": [], "质量": [], "波动率": [], "资金流": [], "技术面": [] };
  for (const f of d.factors) grouped[f.category].push(f);

  return (
    <div className="space-y-4">
      {/* 标的选择 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
        <select value={selected} onChange={e => setSelected(e.target.value)}
          className="w-full bg-transparent text-sm font-bold border-none outline-none text-[var(--text-primary)]">
          {data.decisions.map(dd => (
            <option key={dd.code} value={dd.code}>{dd.name} ({dd.sector}) [{dd.finalScore > 0 ? "+" : ""}{dd.finalScore}]</option>
          ))}
        </select>
      </div>

      {/* 因子综合分 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold">📊 因子综合分</h3>
          <span className="text-xl font-black tabular-nums" style={{ color: d.factorComposite >= 0 ? "#ef4444" : "#10b981" }}>
            {d.factorComposite > 0 ? "+" : ""}{d.factorComposite}
          </span>
        </div>
        <ScoreBar score={d.factorComposite} label="多因子" />
        <div className="grid grid-cols-3 gap-2 mt-3">
          <ScoreBar score={d.aiAdjustedScore} label="AI增强" />
          <ScoreBar score={d.matrixScore} label="策略矩阵" />
          <ScoreBar score={d.finalScore} label="最终得分" />
        </div>
      </div>

      {/* 6大因子族明细 */}
      {(Object.entries(grouped) as [FactorCategory, FactorScore[]][]).map(([cat, fs]) => (
        <div key={cat} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 rounded-full" style={{ background: catColor[cat] }} />
            <h4 className="text-sm font-bold">{cat}</h4>
            <span className="text-[10px] tabular-nums ml-auto font-bold"
              style={{ color: fs.reduce((s, f) => s + f.weighted, 0) >= 0 ? catColor[cat] : "#94a3b8" }}>
              合计 {fs.reduce((s, f) => s + f.weighted, 0).toFixed(1)}
            </span>
          </div>
          <div className="space-y-2">
            {fs.map(f => (
              <div key={f.name} className="flex items-center gap-2">
                <span className="text-[11px] w-20 shrink-0 font-medium">{f.name}</span>
                <div className="flex-1">
                  <div className="relative h-3 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                    <div className="absolute top-0 left-1/2 w-px h-full bg-[var(--text-secondary)] opacity-20" />
                    {f.zScore >= 0 ? (
                      <div className="absolute top-0 h-full rounded-r-full" style={{ left: "50%", width: `${Math.min(Math.abs(f.zScore) / 3 * 50, 50)}%`, background: catColor[cat] }} />
                    ) : (
                      <div className="absolute top-0 h-full rounded-l-full" style={{ right: "50%", width: `${Math.min(Math.abs(f.zScore) / 3 * 50, 50)}%`, background: catColor[cat], opacity: 0.6 }} />
                    )}
                  </div>
                </div>
                <span className="text-[10px] tabular-nums w-14 text-right" style={{ color: catColor[cat] }}>{f.desc}</span>
                <span className="text-[9px] tabular-nums w-8 text-right text-[var(--text-secondary)]">P{f.percentile}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ==================== 策略矩阵 ====================

function StrategiesTab({ data }: { data: QuantReport }) {
  const [selected, setSelected] = useState<string>(data.decisions[0]?.code || "");
  const d = data.decisions.find(x => x.code === selected) || data.decisions[0];
  if (!d) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
        <select value={selected} onChange={e => setSelected(e.target.value)}
          className="w-full bg-transparent text-sm font-bold border-none outline-none text-[var(--text-primary)]">
          {data.decisions.map(dd => (
            <option key={dd.code} value={dd.code}>{dd.name} ({dd.sector}) [{dd.finalScore > 0 ? "+" : ""}{dd.finalScore}]</option>
          ))}
        </select>
      </div>

      {/* 矩阵总览 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">🧮 策略矩阵融合</h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
              style={{ background: d.matrixConsensus === "强共识" ? "#ef444420" : d.matrixConsensus === "弱共识" ? "#f59e0b20" : "#6b728020",
                       color: d.matrixConsensus === "强共识" ? "#ef4444" : d.matrixConsensus === "弱共识" ? "#f59e0b" : "#94a3b8" }}>
              {d.matrixConsensus}
            </span>
            <span className="text-lg font-black tabular-nums" style={{ color: d.matrixScore >= 0 ? "#ef4444" : "#10b981" }}>
              {d.matrixScore > 0 ? "+" : ""}{d.matrixScore}
            </span>
          </div>
        </div>
        <div className="text-[11px] text-[var(--text-secondary)] mb-3">
          市场状态：<strong style={{ color: regimeStyle[d.regime].text }}>{d.regime}</strong> → 策略权重自动调整
        </div>
      </div>

      {/* 4策略详情 */}
      {d.strategies.map(s => {
        const sc = stratColor[s.strategy];
        const dirColor = s.direction === "long" ? "#ef4444" : s.direction === "short" ? "#10b981" : "#94a3b8";
        return (
          <div key={s.strategy} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{sc.icon}</span>
              <span className="text-sm font-bold">{s.strategy}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: dirColor + "20", color: dirColor }}>
                {s.direction === "long" ? "做多" : s.direction === "short" ? "做空" : "中性"}
              </span>
              <span className="ml-auto text-sm font-black tabular-nums" style={{ color: dirColor }}>
                {s.strength > 0 ? "+" : ""}{s.strength}
              </span>
            </div>
            <div className="relative h-4 rounded-full bg-[var(--bg-secondary)] overflow-hidden mb-2">
              <div className="absolute top-0 left-1/2 w-px h-full bg-[var(--text-secondary)] opacity-20" />
              {s.strength >= 0 ? (
                <div className="absolute top-0 h-full rounded-r-full" style={{ left: "50%", width: `${Math.abs(s.strength) / 2}%`, background: sc.color }} />
              ) : (
                <div className="absolute top-0 h-full rounded-l-full" style={{ right: "50%", width: `${Math.abs(s.strength) / 2}%`, background: sc.color, opacity: 0.6 }} />
              )}
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] mb-2">{s.reason}</p>
            <div className="flex flex-wrap gap-1">
              {s.triggers.map((t, i) => (
                <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">{t}</span>
              ))}
            </div>
            <div className="text-[9px] text-[var(--text-secondary)] mt-1">置信度 {s.confidence}%</div>
          </div>
        );
      })}

      {/* AI增强说明 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-2">🤖 AI增强调整</h3>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs text-[var(--text-secondary)]">因子基础分 {d.factorComposite}</span>
          <span className="text-xs">→</span>
          <span className="text-xs font-bold" style={{ color: d.aiBoost >= 0 ? "#ef4444" : "#10b981" }}>
            AI {d.aiBoost >= 0 ? "+" : ""}{d.aiBoost}
          </span>
          <span className="text-xs">→</span>
          <span className="text-xs font-bold" style={{ color: d.aiAdjustedScore >= 0 ? "#ef4444" : "#10b981" }}>
            = {d.aiAdjustedScore}
          </span>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)]">{d.aiReason}</p>
      </div>
    </div>
  );
}

// ==================== 全部决策 ====================

function DecisionsTab({ data }: { data: QuantReport }) {
  const [sortBy, setSortBy] = useState<"score" | "action" | "sector">("score");
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = [...data.decisions].sort((a, b) => {
    if (sortBy === "score") return b.finalScore - a.finalScore;
    if (sortBy === "sector") return a.sector.localeCompare(b.sector);
    const ao: Record<QuantAction, number> = { "强力做多": 0, "做多": 1, "轻仓试多": 2, "观望": 3, "轻仓试空": 4, "做空": 5, "强力做空": 6 };
    return ao[a.action] - ao[b.action];
  });

  return (
    <div className="space-y-3">
      {/* 排序 */}
      <div className="flex gap-1">
        {(["score", "action", "sector"] as const).map(s => (
          <button key={s} onClick={() => setSortBy(s)}
            className={`text-[10px] px-3 py-1.5 rounded-lg ${sortBy === s ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"}`}>
            {s === "score" ? "按得分" : s === "action" ? "按操作" : "按板块"}
          </button>
        ))}
        <span className="text-[10px] text-[var(--text-secondary)] ml-auto self-center">{data.decisions.length} 标的</span>
      </div>

      {sorted.map(d => {
        const as = actionStyle[d.action];
        const isExp = expanded === d.code;
        return (
          <div key={d.code} className="rounded-xl border overflow-hidden" style={{ borderColor: as.border + "40", background: "var(--bg-card)" }}>
            <div className="p-3 cursor-pointer" onClick={() => setExpanded(isExp ? null : d.code)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-bold truncate">{d.name}</span>
                  <span className="text-[9px] text-[var(--text-secondary)] font-mono">{d.code}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)] shrink-0">{d.sector}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-[10px] px-2 py-0.5 rounded font-bold" style={{ background: as.bg, color: as.text }}>
                    {d.action}
                  </span>
                  <span className="text-sm font-black tabular-nums" style={{ color: d.finalScore >= 0 ? "#ef4444" : "#10b981" }}>
                    {d.finalScore > 0 ? "+" : ""}{d.finalScore}
                  </span>
                </div>
              </div>
              {/* 标签 */}
              {d.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {d.tags.map((t, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">{t}</span>
                  ))}
                </div>
              )}
              {/* 三层分数简表 */}
              <div className="flex items-center gap-3 mt-2 text-[10px] text-[var(--text-secondary)]">
                <span>因子 <strong className="tabular-nums">{d.factorComposite > 0 ? "+" : ""}{d.factorComposite}</strong></span>
                <span>AI <strong className="tabular-nums" style={{ color: d.aiBoost >= 0 ? "#ef4444" : "#10b981" }}>{d.aiBoost >= 0 ? "+" : ""}{d.aiBoost}</strong></span>
                <span>矩阵 <strong className="tabular-nums">{d.matrixScore > 0 ? "+" : ""}{d.matrixScore}</strong></span>
                <span className="ml-auto">{d.matrixConsensus}</span>
                <span>仓位 {d.position}%</span>
              </div>
            </div>

            {isExp && (
              <div className="border-t border-[var(--border-color)] p-3 space-y-3">
                {/* 策略信号 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {d.strategies.map(s => {
                    const sc = stratColor[s.strategy];
                    const dirCol = s.direction === "long" ? "#ef4444" : s.direction === "short" ? "#10b981" : "#94a3b8";
                    return (
                      <div key={s.strategy} className="rounded-lg bg-[var(--bg-secondary)] p-2 text-center">
                        <div className="text-sm">{sc.icon}</div>
                        <div className="text-[10px] font-bold">{s.strategy}</div>
                        <div className="text-xs font-black tabular-nums" style={{ color: dirCol }}>
                          {s.strength > 0 ? "+" : ""}{s.strength}
                        </div>
                        <div className="text-[9px]" style={{ color: dirCol }}>
                          {s.direction === "long" ? "做多" : s.direction === "short" ? "做空" : "中性"}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* 操作建议 */}
                <div className="text-[11px] text-[var(--text-secondary)] space-y-1">
                  <p>🤖 AI：{d.aiReason}</p>
                  <p>📊 止损 {d.stopLoss}% | 止盈 {d.takeProfit}% | 建议仓位 {d.position}%</p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ==================== 风险管理 ====================

function RiskTab({ data }: { data: QuantReport }) {
  const longDecisions = data.decisions.filter(d => d.finalScore > 10);
  const shortDecisions = data.decisions.filter(d => d.finalScore < -10);
  const neutralDecisions = data.decisions.filter(d => d.finalScore >= -10 && d.finalScore <= 10);

  const avgVol = data.decisions.length > 0
    ? data.decisions.reduce((s, d) => s + (d.factors.find(f => f.name === "波动率")?.raw || 0), 0) / data.decisions.length : 0;

  const maxDD = data.decisions.length > 0
    ? Math.max(...data.decisions.map(d => d.factors.find(f => f.name === "最大回撤")?.raw || 0)) : 0;

  return (
    <div className="space-y-4">
      {/* 风险仪表 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-4">🛡️ 风险预算</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <RiskCard label="建议总仓位" value={`${data.riskBudget}%`} color={data.riskBudget > 60 ? "#ef4444" : data.riskBudget > 30 ? "#f59e0b" : "#10b981"} />
          <RiskCard label="平均波动率" value={`${avgVol.toFixed(2)}%`} color={avgVol > 3 ? "#ef4444" : avgVol > 1.5 ? "#f59e0b" : "#10b981"} />
          <RiskCard label="最大回撤风险" value={`${maxDD.toFixed(1)}%`} color={maxDD > 10 ? "#ef4444" : maxDD > 5 ? "#f59e0b" : "#10b981"} />
          <RiskCard label="多空比" value={`${longDecisions.length}:${shortDecisions.length}`} color={longDecisions.length > shortDecisions.length ? "#ef4444" : "#10b981"} />
        </div>
      </div>

      {/* 分布图 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-3">📊 决策分布</h3>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-6 rounded-full overflow-hidden flex">
            <div className="h-full bg-[#ef4444]" style={{ width: `${(longDecisions.length / Math.max(data.decisions.length, 1)) * 100}%` }} />
            <div className="h-full bg-[#94a3b8]" style={{ width: `${(neutralDecisions.length / Math.max(data.decisions.length, 1)) * 100}%` }} />
            <div className="h-full bg-[#10b981]" style={{ width: `${(shortDecisions.length / Math.max(data.decisions.length, 1)) * 100}%` }} />
          </div>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-[#ef4444]">做多 {longDecisions.length}</span>
          <span className="text-[#94a3b8]">观望 {neutralDecisions.length}</span>
          <span className="text-[#10b981]">做空 {shortDecisions.length}</span>
        </div>
      </div>

      {/* 仓位分配建议 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-3">💰 仓位分配建议</h3>
        {longDecisions.slice(0, 8).map(d => (
          <div key={d.code} className="flex items-center justify-between py-1.5 border-b border-[var(--border-color)] last:border-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold">{d.name}</span>
              <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: actionStyle[d.action].bg, color: actionStyle[d.action].text }}>
                {d.action}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-20 h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                <div className="h-full rounded-full bg-[#ef4444]" style={{ width: `${d.position}%` }} />
              </div>
              <span className="text-[10px] font-bold tabular-nums w-8 text-right">{d.position}%</span>
            </div>
          </div>
        ))}
        {longDecisions.length === 0 && <p className="text-[11px] text-[var(--text-secondary)]">当前无做多标的</p>}
      </div>

      {/* 风险提示 */}
      <div className="rounded-xl border border-[#f59e0b40] bg-[#f59e0b08] p-4">
        <h3 className="text-sm font-bold text-[#f59e0b] mb-2">⚠️ 风控提示</h3>
        <ul className="text-[11px] text-[var(--text-secondary)] space-y-1">
          {data.regime === "波动放大" && <li>• 当前波动放大，建议降低单标的仓位，分散风险</li>}
          {data.regime === "趋势下行" && <li>• 趋势下行期，严格止损，不要逆势抄底</li>}
          {avgVol > 2.5 && <li>• 平均波动率偏高({avgVol.toFixed(2)}%)，注意设置止损</li>}
          {maxDD > 8 && <li>• 存在最大回撤{maxDD.toFixed(1)}%的标的，控制持仓比例</li>}
          {shortDecisions.length > longDecisions.length && <li>• 做空标的多于做多，市场偏弱，控制总仓位</li>}
          <li>• 量化信号非投资建议，请结合自身判断</li>
        </ul>
      </div>
    </div>
  );
}

// ==================== 小组件 ====================

function LayerCard({ label, title, score, desc }: { label: string; title: string; score: number; desc: string }) {
  return (
    <div className="rounded-lg bg-[var(--bg-secondary)] p-3 text-center">
      <div className="text-[9px] text-[var(--text-secondary)]">{label}</div>
      <div className="text-xs font-bold mt-0.5">{title}</div>
      <div className="text-lg font-black tabular-nums mt-1" style={{ color: score >= 0 ? "#ef4444" : "#10b981" }}>
        {score > 0 ? "+" : ""}{score}
      </div>
      <div className="text-[9px] text-[var(--text-secondary)]">{desc}</div>
    </div>
  );
}

function BarMini({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.abs(value) / max * 100;
  return (
    <div className="relative h-2 rounded-full bg-[var(--bg-card)] overflow-hidden mt-1">
      <div className="absolute top-0 left-1/2 w-px h-full bg-[var(--text-secondary)] opacity-20" />
      {value >= 0 ? (
        <div className="absolute top-0 h-full rounded-r-full" style={{ left: "50%", width: `${Math.min(pct, 50)}%`, background: color }} />
      ) : (
        <div className="absolute top-0 h-full rounded-l-full" style={{ right: "50%", width: `${Math.min(pct, 50)}%`, background: color, opacity: 0.6 }} />
      )}
    </div>
  );
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const pct = (score + 100) / 200 * 100;
  return (
    <div>
      <div className="flex justify-between text-[9px] text-[var(--text-secondary)] mb-0.5">
        <span>{label}</span>
        <span className="font-bold tabular-nums" style={{ color: score >= 0 ? "#ef4444" : "#10b981" }}>
          {score > 0 ? "+" : ""}{score}
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-gradient-to-r from-[#10b981] via-[#94a3b8] to-[#ef4444] overflow-hidden">
        <div className="absolute top-0 h-full w-1 bg-white rounded shadow-lg z-10" style={{ left: `${pct}%`, transform: "translateX(-50%)" }} />
      </div>
    </div>
  );
}

function MiniDecisionRow({ d }: { d: QuantDecision }) {
  const as = actionStyle[d.action];
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[var(--border-color)] last:border-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[11px] font-bold truncate">{d.name}</span>
        <span className="text-[9px] text-[var(--text-secondary)]">{d.sector}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 ml-2">
        {d.tags.slice(0, 2).map((t, i) => (
          <span key={i} className="text-[8px] px-1 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">{t}</span>
        ))}
        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: as.bg, color: as.text }}>{d.action}</span>
        <span className="text-xs font-black tabular-nums w-8 text-right" style={{ color: d.finalScore >= 0 ? "#ef4444" : "#10b981" }}>
          {d.finalScore > 0 ? "+" : ""}{d.finalScore}
        </span>
      </div>
    </div>
  );
}

function RiskCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-center">
      <div className="text-[10px] text-[var(--text-secondary)] mb-1">{label}</div>
      <div className="text-sm font-bold tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}
