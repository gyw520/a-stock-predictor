"use client";

import { useState, useEffect } from "react";

// ==================== Types ====================
type DimensionDirection = "强看多" | "看多" | "中性" | "看空" | "强看空";
type MarketPhase = "健康上升" | "上升末期" | "趋势反转" | "下跌寻底" | "横盘震荡";

interface DimensionSignal {
  indicator: string;
  value: string;
  interpretation: string;
  bullish: boolean;
}

interface DimensionResult {
  name: string;
  weight: number;
  score: number;
  direction: DimensionDirection;
  signals: DimensionSignal[];
  details: string;
}

interface CrossValidation {
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  agreement: string;
  confidence: number;
}

interface FourDimReport {
  sectorName: string;
  sectorCode: string;
  timestamp: string;
  trend: DimensionResult;
  momentum: DimensionResult;
  capitalFlow: DimensionResult;
  fundamental: DimensionResult;
  compositeScore: number;
  marketPhase: MarketPhase;
  operation: string;
  crossValidation: CrossValidation;
  conclusion: string;
  keyRisks: string[];
  keyOpportunities: string[];
  actionPlan: string;
}

interface NorthboundFlow { date: string; total: number; shConnect: number; szConnect: number; }

interface APIResponse {
  timestamp: string;
  northboundSummary: NorthboundFlow[];
  reports: FourDimReport[];
}

// ==================== Sub-components ====================

const dimColors: Record<string, string> = {
  "趋势方向": "#3b82f6", "动能强弱": "#f59e0b", "资金流向": "#10b981", "基本面与情绪": "#8b5cf6",
};

const dirColors: Record<DimensionDirection, { bg: string; text: string }> = {
  "强看多": { bg: "#ef444425", text: "#ef4444" },
  "看多": { bg: "#f59e0b25", text: "#f59e0b" },
  "中性": { bg: "#6b728025", text: "#94a3b8" },
  "看空": { bg: "#3b82f625", text: "#3b82f6" },
  "强看空": { bg: "#10b98125", text: "#10b981" },
};

const phaseConfig: Record<MarketPhase, { icon: string; color: string; bg: string }> = {
  "健康上升": { icon: "✅", color: "#ef4444", bg: "#ef444410" },
  "上升末期": { icon: "⚠️", color: "#f59e0b", bg: "#f59e0b10" },
  "趋势反转": { icon: "🔻", color: "#3b82f6", bg: "#3b82f610" },
  "下跌寻底": { icon: "🟢", color: "#10b981", bg: "#10b98110" },
  "横盘震荡": { icon: "⚠️", color: "#94a3b8", bg: "#6b728010" },
};

function DirectionBadge({ dir }: { dir: DimensionDirection }) {
  const c = dirColors[dir];
  return <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: c.bg, color: c.text }}>{dir}</span>;
}

function RadarChart({ dims }: { dims: DimensionResult[] }) {
  // 简化的四维雷达图 — 用四个方向的条形表示
  const ordered = [dims[0], dims[1], dims[2], dims[3]]; // 趋势,动能,资金,基本面
  const labels = ["趋势40%", "动能25%", "资金20%", "情绪15%"];
  const icons = ["🔭", "⚡", "💰", "📊"];

  return (
    <div className="space-y-2">
      {ordered.map((d, i) => {
        const normalized = (d.score + 100) / 200; // 0-1
        const color = d.score > 15 ? "#ef4444" : d.score < -15 ? "#10b981" : "#94a3b8";
        return (
          <div key={d.name} className="flex items-center gap-2">
            <span className="text-sm w-5">{icons[i]}</span>
            <span className="text-[10px] text-[var(--text-secondary)] w-14 shrink-0">{labels[i]}</span>
            <div className="flex-1 h-3 rounded-full bg-[#1e2d4a] overflow-hidden relative">
              {/* 中线 */}
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--text-secondary)] opacity-30" />
              {/* 填充条 */}
              {d.score >= 0 ? (
                <div className="absolute top-0 bottom-0 rounded-r-full" style={{
                  left: "50%", width: `${(d.score / 100) * 50}%`, background: "#ef4444",
                }} />
              ) : (
                <div className="absolute top-0 bottom-0 rounded-l-full" style={{
                  right: "50%", width: `${(Math.abs(d.score) / 100) * 50}%`, background: "#10b981",
                }} />
              )}
            </div>
            <span className="text-xs font-bold w-8 text-right" style={{ color }}>{d.score}</span>
            <DirectionBadge dir={d.direction} />
          </div>
        );
      })}
    </div>
  );
}

function SignalList({ signals }: { signals: DimensionSignal[] }) {
  return (
    <div className="space-y-1.5">
      {signals.map((s, i) => (
        <div key={i} className="flex items-start gap-2 py-1">
          <span className={`mt-0.5 text-xs ${s.bullish ? "text-[#ef4444]" : "text-[#10b981]"}`}>
            {s.bullish ? "▲" : "▼"}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold text-[var(--text-secondary)] bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded">{s.indicator}</span>
              <span className="text-[10px] font-mono text-[var(--text-secondary)]">{s.value}</span>
            </div>
            <p className="text-xs text-[var(--text-primary)] mt-0.5 leading-relaxed">{s.interpretation}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function CrossValidationBadge({ cv }: { cv: CrossValidation }) {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    "四维共振": { bg: "#ef444420", border: "#ef4444", text: "#ef4444" },
    "三多一中": { bg: "#f59e0b20", border: "#f59e0b", text: "#f59e0b" },
    "三多一空": { bg: "#f59e0b20", border: "#f59e0b", text: "#f59e0b" },
    "两多两空": { bg: "#6b728020", border: "#6b7280", text: "#94a3b8" },
    "一多三空": { bg: "#3b82f620", border: "#3b82f6", text: "#3b82f6" },
    "四维看空": { bg: "#10b98120", border: "#10b981", text: "#10b981" },
  };
  const c = colors[cv.agreement] || colors["两多两空"];
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border" style={{ background: c.bg, borderColor: c.border }}>
      <span className="text-sm font-bold" style={{ color: c.text }}>{cv.agreement}</span>
      <span className="text-[10px]" style={{ color: c.text }}>置信度 {cv.confidence}%</span>
      <div className="flex gap-0.5 ml-1">
        {Array.from({ length: cv.bullishCount }).map((_, i) => <span key={`b${i}`} className="w-2 h-2 rounded-full bg-[#ef4444]" />)}
        {Array.from({ length: cv.neutralCount }).map((_, i) => <span key={`n${i}`} className="w-2 h-2 rounded-full bg-[#6b7280]" />)}
        {Array.from({ length: cv.bearishCount }).map((_, i) => <span key={`s${i}`} className="w-2 h-2 rounded-full bg-[#10b981]" />)}
      </div>
    </div>
  );
}

function NorthboundChart({ data }: { data: NorthboundFlow[] }) {
  if (data.length === 0) return null;
  const maxAbs = Math.max(...data.map(d => Math.abs(d.total)), 1);
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
      <h3 className="text-xs font-semibold text-[var(--text-secondary)] mb-3">💰 北向资金近期流向（万元）</h3>
      <div className="flex items-end gap-1 h-20">
        {data.map((d, i) => {
          const height = (Math.abs(d.total) / maxAbs) * 100;
          const isPositive = d.total >= 0;
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full relative group">
              <div className="absolute -top-5 bg-[var(--bg-card)] px-1 py-0.5 rounded text-[9px] text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                {d.date.slice(5)} {(d.total / 10000).toFixed(1)}亿
              </div>
              {isPositive ? (
                <div className="w-full rounded-t" style={{ height: `${height}%`, background: "#ef4444", minHeight: "2px" }} />
              ) : (
                <div className="w-full rounded-b" style={{ height: `${height}%`, background: "#10b981", minHeight: "2px" }} />
              )}
              <span className="text-[8px] text-[var(--text-secondary)] mt-1">{d.date.slice(5)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==================== 单个板块报告卡片 ====================

function ReportCard({ report }: { report: FourDimReport }) {
  const [expanded, setExpanded] = useState(false);
  const pc = phaseConfig[report.marketPhase];
  const scoreColor = report.compositeScore > 20 ? "#ef4444" : report.compositeScore < -20 ? "#10b981" : "#94a3b8";

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden">
      {/* 头部 */}
      <div className="p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold">{report.sectorName}</h3>
            <span className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: `${pc.color}50`, color: pc.color, background: pc.bg }}>
              {pc.icon} {report.marketPhase}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-2xl font-black" style={{ color: scoreColor }}>{report.compositeScore}</div>
              <div className="text-[10px] text-[var(--text-secondary)]">综合评分</div>
            </div>
            <span className="text-xs text-[var(--text-secondary)]">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>

        {/* 四维条 */}
        <RadarChart dims={[report.trend, report.momentum, report.capitalFlow, report.fundamental]} />

        {/* 交叉验证 + 操作建议 */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border-color)]">
          <CrossValidationBadge cv={report.crossValidation} />
          <span className="text-xs font-bold px-3 py-1.5 rounded-lg" style={{
            background: report.compositeScore > 15 ? "#ef444415" : report.compositeScore < -15 ? "#10b98115" : "#6b728015",
            color: report.compositeScore > 15 ? "#ef4444" : report.compositeScore < -15 ? "#10b981" : "#94a3b8",
          }}>
            {report.operation}
          </span>
        </div>
      </div>

      {/* 结论区（始终显示） */}
      <div className="px-4 pb-3">
        <div className="rounded-lg bg-[var(--bg-secondary)] p-3">
          <p className="text-xs text-[var(--text-primary)] leading-relaxed">{report.conclusion}</p>
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-[var(--border-color)] pt-4">
          {/* 操作计划 */}
          <div className="rounded-lg border-2 border-[var(--accent-blue)] bg-[#3b82f608] p-3">
            <h4 className="text-xs font-bold text-[var(--accent-blue)] mb-1">📋 操作计划</h4>
            <p className="text-xs text-[var(--text-primary)] leading-relaxed">{report.actionPlan}</p>
          </div>

          {/* 风险与机会 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-[#f59e0b08] border border-[#f59e0b20] p-3">
              <h4 className="text-xs font-bold text-[var(--accent-yellow)] mb-2">⚠️ 风险提示</h4>
              {report.keyRisks.map((r, i) => (
                <div key={i} className="flex items-start gap-1.5 mb-1">
                  <span className="text-[var(--accent-yellow)] text-[10px] mt-0.5">●</span>
                  <span className="text-[11px] text-[var(--text-secondary)]">{r}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-[#10b98108] border border-[#10b98120] p-3">
              <h4 className="text-xs font-bold text-[#10b981] mb-2">💡 机会提示</h4>
              {report.keyOpportunities.map((o, i) => (
                <div key={i} className="flex items-start gap-1.5 mb-1">
                  <span className="text-[#10b981] text-[10px] mt-0.5">●</span>
                  <span className="text-[11px] text-[var(--text-secondary)]">{o}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 四个维度详细信号 */}
          {[report.trend, report.momentum, report.capitalFlow, report.fundamental].map(dim => (
            <div key={dim.name} className="rounded-lg border border-[var(--border-color)] overflow-hidden">
              <div className="px-3 py-2 flex items-center justify-between" style={{ background: `${dimColors[dim.name]}08`, borderBottom: `1px solid ${dimColors[dim.name]}20` }}>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-4 rounded-full" style={{ background: dimColors[dim.name] }} />
                  <span className="text-xs font-bold">{dim.name}</span>
                  <span className="text-[10px] text-[var(--text-secondary)]">权重{dim.weight}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold" style={{ color: dim.score > 0 ? "#ef4444" : dim.score < 0 ? "#10b981" : "#94a3b8" }}>{dim.score}分</span>
                  <DirectionBadge dir={dim.direction} />
                </div>
              </div>
              <div className="px-3 py-2">
                <SignalList signals={dim.signals} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== 主面板 ====================

export default function FourDimPanel() {
  const [data, setData] = useState<APIResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "bullish" | "bearish">("all");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const resp = await fetch("/api/four-dim");
        const json = await resp.json();
        if (!json.error) setData(json);
      } catch {} finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] animate-pulse h-24" />
        {[1, 2, 3].map(i => <div key={i} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] animate-pulse h-60" />)}
      </div>
    );
  }

  if (!data) return <div className="card text-center py-12 text-[var(--text-secondary)]">暂无数据</div>;

  const reports = data.reports;
  const bullish = reports.filter(r => r.compositeScore > 15);
  const bearish = reports.filter(r => r.compositeScore < -15);
  const neutral = reports.filter(r => r.compositeScore >= -15 && r.compositeScore <= 15);

  const filtered = filter === "bullish" ? bullish : filter === "bearish" ? bearish : reports;

  // 四维共振统计
  const strongBuy = reports.filter(r => r.crossValidation.agreement === "四维共振" && r.compositeScore > 0);
  const strongSell = reports.filter(r => r.crossValidation.agreement === "四维看空");

  return (
    <div className="space-y-6">
      {/* 框架说明 */}
      <div className="rounded-xl border-2 border-[var(--accent-blue)] bg-[#3b82f608] p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🧩</span>
          <div className="flex-1">
            <h2 className="text-base font-bold mb-2">四维交叉验证分析系统</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              {[
                { icon: "🔭", name: "趋势方向", weight: "40%", desc: "均线排列、相对强弱" },
                { icon: "⚡", name: "动能强弱", weight: "25%", desc: "MACD背离、量价关系" },
                { icon: "💰", name: "资金流向", weight: "20%", desc: "北向资金、主力资金" },
                { icon: "📊", name: "基本面情绪", weight: "15%", desc: "拥挤度、波动率" },
              ].map(d => (
                <div key={d.name} className="rounded-lg bg-[var(--bg-card)] p-2.5 border border-[var(--border-color)]">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-sm">{d.icon}</span>
                    <span className="text-xs font-bold">{d.name}</span>
                    <span className="text-[10px] text-[var(--accent-blue)]">{d.weight}</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-secondary)]">{d.desc}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              <strong>核心规则：</strong>四维指向同一方向→重仓 | 三维一致一维矛盾→谨慎分批 | 两维相反→观望 | 三维看空→果断离场
            </p>
          </div>
        </div>
      </div>

      {/* 北向资金 */}
      <NorthboundChart data={data.northboundSummary} />

      {/* 总览统计 */}
      <div className="grid grid-cols-3 gap-3">
        <button onClick={() => setFilter("bullish")}
          className={`rounded-xl border p-4 text-center transition-all ${filter === "bullish" ? "border-[#ef4444] bg-[#ef444410]" : "border-[var(--border-color)] bg-[var(--bg-card)]"}`}>
          <div className="text-2xl font-black text-[#ef4444]">{bullish.length}</div>
          <div className="text-xs text-[var(--text-secondary)]">看多板块</div>
          {strongBuy.length > 0 && <div className="text-[10px] text-[#ef4444] mt-1">含{strongBuy.length}个四维共振</div>}
        </button>
        <button onClick={() => setFilter("all")}
          className={`rounded-xl border p-4 text-center transition-all ${filter === "all" ? "border-[var(--accent-blue)] bg-[#3b82f610]" : "border-[var(--border-color)] bg-[var(--bg-card)]"}`}>
          <div className="text-2xl font-black text-[var(--text-secondary)]">{neutral.length}</div>
          <div className="text-xs text-[var(--text-secondary)]">中性/震荡</div>
          <div className="text-[10px] text-[var(--text-secondary)] mt-1">点击显示全部</div>
        </button>
        <button onClick={() => setFilter("bearish")}
          className={`rounded-xl border p-4 text-center transition-all ${filter === "bearish" ? "border-[#10b981] bg-[#10b98110]" : "border-[var(--border-color)] bg-[var(--bg-card)]"}`}>
          <div className="text-2xl font-black text-[#10b981]">{bearish.length}</div>
          <div className="text-xs text-[var(--text-secondary)]">看空板块</div>
          {strongSell.length > 0 && <div className="text-[10px] text-[#10b981] mt-1">含{strongSell.length}个四维看空</div>}
        </button>
      </div>

      {/* 板块报告列表 */}
      <div className="space-y-4">
        {filtered.map(r => <ReportCard key={r.sectorCode} report={r} />)}
      </div>

      {/* 底部规则 */}
      <div className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] p-4">
        <h4 className="text-xs font-bold mb-2">📝 四维交叉验证操作规则</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                <th className="text-left py-1.5 pr-2 font-medium">市场阶段</th>
                <th className="text-center py-1.5 px-1 font-medium">趋势</th>
                <th className="text-center py-1.5 px-1 font-medium">动能</th>
                <th className="text-center py-1.5 px-1 font-medium">资金</th>
                <th className="text-center py-1.5 px-1 font-medium">情绪</th>
                <th className="text-left py-1.5 pl-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="text-[var(--text-primary)]">
              {[
                { phase: "健康上升", t: "↑", m: "无背离", c: "流入", f: "未过热", op: "持仓不动，回调加仓", color: "#ef4444" },
                { phase: "上升末期", t: "↑", m: "顶背离", c: "减缓", f: "偏热", op: "分批止盈，不加新仓", color: "#f59e0b" },
                { phase: "趋势反转", t: "→", m: "多次背离", c: "流出", f: "放缓", op: "大幅减仓，转防御", color: "#3b82f6" },
                { phase: "下跌寻底", t: "↓", m: "底背离", c: "减缓", f: "悲观", op: "小额定投，等企稳", color: "#10b981" },
                { phase: "横盘震荡", t: "→", m: "频繁交叉", c: "无方向", f: "等催化", op: "控制仓位，等方向", color: "#94a3b8" },
              ].map(row => (
                <tr key={row.phase} className="border-b border-[var(--border-color)]">
                  <td className="py-1.5 pr-2 font-medium" style={{ color: row.color }}>{row.phase}</td>
                  <td className="py-1.5 px-1 text-center">{row.t}</td>
                  <td className="py-1.5 px-1 text-center">{row.m}</td>
                  <td className="py-1.5 px-1 text-center">{row.c}</td>
                  <td className="py-1.5 px-1 text-center">{row.f}</td>
                  <td className="py-1.5 pl-2" style={{ color: row.color }}>{row.op}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-[var(--text-secondary)] mt-2 leading-relaxed">
          ⚠️ 免责声明：以上分析基于技术指标和公开数据的数学计算，不构成投资建议。当趋势和动能出现矛盾时以趋势为主但要开始分批减仓。资金持续流出的板块短期内很难涨。基本面没坏的下跌是机会，基本面恶化即使情绪恐慌也别抄底。
        </p>
      </div>
    </div>
  );
}
