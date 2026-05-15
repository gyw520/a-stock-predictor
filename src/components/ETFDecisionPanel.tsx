"use client";

import { useState, useEffect, useCallback } from "react";
import { isTradingTime, isNearClose } from "@/lib/trading-hours";

// ==================== Types ====================
type ETFAction = "重仓加仓" | "小额加仓" | "持仓不动" | "分批减仓" | "清仓跑路" | "首次入场" | "定投买入" | "观望等待";

interface ETFSignal {
  category: string;
  indicator: string;
  value: string;
  judgment: string;
  bullish: boolean;
  weight: number;
}

interface ETFDecision {
  etfCode: string;
  etfName: string;
  sector: string;
  price: number;
  changePercent: number;
  trendScore: number;
  capitalScore: number;
  valuationScore: number;
  sentimentScore: number;
  eventScore: number;
  compositeScore: number;
  action: ETFAction;
  urgency: string;
  riskLevel: string;
  confidence: number;
  signals: ETFSignal[];
  summary: string;
  reason: string;
  actionDetail: string;
  stopLoss: string;
  targetProfit: string;
  supportPrice: number;
  resistancePrice: number;
  navDate: string;
  isEstimated: boolean;
}

interface EventSignal {
  title: string;
  time: string;
  category: string;
  sectors: string[];
  impact: "利好" | "利空" | "关注";
  weight: number;
  reason: string;
}

interface SectorEventSummary {
  sector: string;
  bullishEvents: EventSignal[];
  bearishEvents: EventSignal[];
  watchEvents: EventSignal[];
  netImpact: number;
  summary: string;
}

interface Report {
  timestamp: string;
  isPreClose: boolean;
  marketSentiment: string;
  northboundTrend: string;
  strongBuy: ETFDecision[];
  buy: ETFDecision[];
  hold: ETFDecision[];
  sell: ETFDecision[];
  runAway: ETFDecision[];
  allDecisions: ETFDecision[];
  eventSummaries: SectorEventSummary[];
  topEvents: EventSignal[];
  overallAdvice: string;
}

// ==================== 颜色配置 ====================
const actionConfig: Record<ETFAction, { bg: string; border: string; text: string; icon: string }> = {
  "重仓加仓": { bg: "#ef444420", border: "#ef4444", text: "#ef4444", icon: "🔥" },
  "小额加仓": { bg: "#f59e0b20", border: "#f59e0b", text: "#f59e0b", icon: "📈" },
  "首次入场": { bg: "#8b5cf620", border: "#8b5cf6", text: "#8b5cf6", icon: "🎯" },
  "定投买入": { bg: "#06b6d420", border: "#06b6d4", text: "#06b6d4", icon: "💰" },
  "持仓不动": { bg: "#6b728020", border: "#6b7280", text: "#94a3b8", icon: "⏸️" },
  "观望等待": { bg: "#6b728020", border: "#6b7280", text: "#94a3b8", icon: "👀" },
  "分批减仓": { bg: "#3b82f620", border: "#3b82f6", text: "#3b82f6", icon: "📉" },
  "清仓跑路": { bg: "#10b98120", border: "#10b981", text: "#10b981", icon: "🚨" },
};

const urgencyColor: Record<string, string> = {
  "立即执行": "#ef4444",
  "今日执行": "#f59e0b",
  "本周关注": "#3b82f6",
  "长期跟踪": "#94a3b8",
};

// ==================== ETF卡片 ====================
function ETFCard({ d, holding, onSaveHolding, onRemoveHolding }: {
  d: ETFDecision; holding?: Holding;
  onSaveHolding?: (h: Holding) => void; onRemoveHolding?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = actionConfig[d.action];
  const scoreColor = d.compositeScore > 20 ? "#ef4444" : d.compositeScore < -20 ? "#10b981" : "#94a3b8";

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: `${cfg.border}40`, background: "var(--bg-card)" }}>
      {/* 头部 */}
      <div className="p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-bold">{d.etfName}</span>
              <span className="text-[10px] text-[var(--text-secondary)] font-mono">{d.etfCode}</span>
              {d.etfCode.length === 6 && /^0[0-2]/.test(d.etfCode) ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f59e0b20] text-[#f59e0b] font-medium">场外</span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#3b82f620] text-[#3b82f6] font-medium">场内</span>
              )}
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)]">{d.sector}</span>
              {holding && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#8b5cf620] text-[#8b5cf6] font-medium">已持有</span>}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-lg font-bold tabular-nums" style={{ color: d.changePercent >= 0 ? "#ef4444" : "#10b981" }}>
                {d.price.toFixed(3)}
              </span>
              <span className="text-xs tabular-nums px-1.5 py-0.5 rounded" style={{
                background: d.changePercent >= 0 ? "#ef444415" : "#10b98115",
                color: d.changePercent >= 0 ? "#ef4444" : "#10b981",
              }}>
                {d.changePercent >= 0 ? "+" : ""}{d.changePercent.toFixed(2)}%
              </span>
              {d.isEstimated && <span className="text-[9px] px-1 py-0.5 rounded bg-[#f59e0b20] text-[#f59e0b]">盘中估算</span>}
              {d.navDate && <span className="text-[9px] text-[var(--text-secondary)]">净值:{d.navDate.slice(5)}</span>}
            </div>
          </div>
          <div className="text-right shrink-0 ml-3">
            <div className="text-2xl font-black tabular-nums" style={{ color: scoreColor }}>{d.compositeScore}</div>
            <div className="text-[10px] text-[var(--text-secondary)]">综合分</div>
          </div>
        </div>

        {/* 操作建议 */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border" style={{ borderColor: cfg.border, background: cfg.bg }}>
            <span className="text-sm">{cfg.icon}</span>
            <span className="text-sm font-bold" style={{ color: cfg.text }}>{d.action}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-1 rounded-full font-medium" style={{
              background: `${urgencyColor[d.urgency] || "#94a3b8"}15`,
              color: urgencyColor[d.urgency] || "#94a3b8",
            }}>
              {d.urgency}
            </span>
            <span className="text-[10px] text-[var(--text-secondary)]">置信{d.confidence}%</span>
            <span className="text-xs text-[var(--text-secondary)]">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>

        {/* 一句话总结 */}
        <p className="text-xs text-[var(--text-primary)] mt-2 leading-relaxed">{d.summary}</p>

        {/* 四维迷你条 */}
        <div className="grid grid-cols-5 gap-1.5 mt-3">
          {[
            { name: "趋势", score: d.trendScore },
            { name: "资金", score: d.capitalScore },
            { name: "估值", score: d.valuationScore },
            { name: "情绪", score: d.sentimentScore },
            { name: "事件", score: d.eventScore },
          ].map(dim => (
            <div key={dim.name} className="text-center">
              <div className="text-[10px] text-[var(--text-secondary)]">{dim.name}</div>
              <div className="h-1.5 rounded-full bg-[#1e2d4a] mt-0.5 overflow-hidden relative">
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--text-secondary)] opacity-20" />
                {dim.score >= 0 ? (
                  <div className="absolute top-0 bottom-0 rounded-r-full" style={{ left: "50%", width: `${(dim.score / 100) * 50}%`, background: "#ef4444" }} />
                ) : (
                  <div className="absolute top-0 bottom-0 rounded-l-full" style={{ right: "50%", width: `${(Math.abs(dim.score) / 100) * 50}%`, background: "#10b981" }} />
                )}
              </div>
              <div className="text-[10px] font-bold tabular-nums mt-0.5" style={{ color: dim.score > 0 ? "#ef4444" : dim.score < 0 ? "#10b981" : "#94a3b8" }}>{dim.score}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[var(--border-color)] pt-3">
          {/* 核心理由 */}
          <div className="rounded-lg bg-[var(--bg-secondary)] p-3">
            <h4 className="text-xs font-bold text-[var(--text-secondary)] mb-1">📋 核心理由</h4>
            <p className="text-xs text-[var(--text-primary)] leading-relaxed">{d.reason}</p>
          </div>

          {/* 操作细节 */}
          <div className="rounded-lg border-2 p-3" style={{ borderColor: `${cfg.border}50`, background: `${cfg.bg}` }}>
            <h4 className="text-xs font-bold mb-1" style={{ color: cfg.text }}>🎯 具体操作</h4>
            <p className="text-xs text-[var(--text-primary)] leading-relaxed">{d.actionDetail}</p>
          </div>

          {/* 止损止盈 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-[#10b98108] border border-[#10b98120] p-2.5">
              <div className="text-[10px] text-[#10b981] font-bold mb-0.5">🛡️ 止损</div>
              <p className="text-[11px] text-[var(--text-secondary)]">{d.stopLoss}</p>
            </div>
            <div className="rounded-lg bg-[#ef444408] border border-[#ef444420] p-2.5">
              <div className="text-[10px] text-[#ef4444] font-bold mb-0.5">🎯 止盈</div>
              <p className="text-[11px] text-[var(--text-secondary)]">{d.targetProfit}</p>
            </div>
          </div>

          {/* 关键价位 */}
          <div className="flex items-center gap-4 text-xs">
            <span className="text-[var(--text-secondary)]">参考价位：</span>
            <span>支撑 <strong className="text-[#10b981] tabular-nums">{d.supportPrice.toFixed(3)}</strong></span>
            <span>阻力 <strong className="text-[#ef4444] tabular-nums">{d.resistancePrice.toFixed(3)}</strong></span>
          </div>

          {/* 信号明细 */}
          <div className="rounded-lg border border-[var(--border-color)] overflow-hidden">
            <div className="px-3 py-2 bg-[var(--bg-secondary)] text-xs font-bold text-[var(--text-secondary)]">📊 分析信号明细</div>
            <div className="divide-y divide-[var(--border-color)]">
              {d.signals.map((s, i) => (
                <div key={i} className="px-3 py-2 flex items-start gap-2">
                  <span className={`mt-0.5 text-[10px] ${s.bullish ? "text-[#ef4444]" : "text-[#10b981]"}`}>
                    {s.bullish ? "▲" : "▼"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] font-medium">{s.category}</span>
                      <span className="text-[10px] font-bold">{s.indicator}</span>
                      <span className="text-[10px] font-mono text-[var(--text-secondary)]">{s.value}</span>
                    </div>
                    <p className="text-[11px] text-[var(--text-primary)] mt-0.5">{s.judgment}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 持仓管理 */}
      {onSaveHolding && (
        <div className="px-4 pb-3">
          <HoldingEditor d={d} holding={holding} onSave={onSaveHolding} onRemove={() => onRemoveHolding?.()} />
        </div>
      )}
    </div>
  );
}

// ==================== 分组面板 ====================
function ActionGroup({ title, icon, color, items, holdings, onSave, onRemove }: {
  title: string; icon: string; color: string; items: ETFDecision[];
  holdings: Holding[]; onSave: (h: Holding) => void; onRemove: (code: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <h3 className="text-sm font-bold" style={{ color }}>{title}</h3>
        <span className="text-xs text-[var(--text-secondary)]">({items.length}只)</span>
      </div>
      {items.map(d => <ETFCard key={d.etfCode} d={d} holding={holdings.find(h => h.code === d.etfCode)}
        onSaveHolding={onSave} onRemoveHolding={() => onRemove(d.etfCode)} />)}
    </div>
  );
}

// ==================== 板块分类标签 ====================
const SECTOR_GROUPS: { label: string; sectors: string[] }[] = [
  { label: "全部", sectors: [] },
  { label: "科技", sectors: ["半导体芯片", "人工智能", "通信5G", "军工", "游戏传媒"] },
  { label: "新能源", sectors: ["新能源车", "光伏风电", "电力能源"] },
  { label: "消费", sectors: ["食品饮料", "大消费", "家电", "旅游", "农业"] },
  { label: "金融地产", sectors: ["银行", "券商", "保险", "房地产"] },
  { label: "医药", sectors: ["医药综合", "创新药", "医疗器械"] },
  { label: "周期资源", sectors: ["煤炭", "有色金属", "商品", "建材基建", "环保", "化工"] },
  { label: "红利", sectors: ["红利策略"] },
  { label: "宽基指数", sectors: ["沪深300", "中证500", "中证1000", "上证50", "创业板", "科创板"] },
  { label: "跨境", sectors: ["港股", "美股", "MSCI"] },
];

// ==================== 持仓管理 ====================
interface Holding {
  code: string;
  amount: number;      // 持有金额（元）
  costPrice: number;   // 买入时净值（自动记录）
}

function loadHoldings(): Holding[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("etf_holdings") || "[]"); } catch { return []; }
}
function saveHoldings(h: Holding[]) {
  localStorage.setItem("etf_holdings", JSON.stringify(h));
}

// ==================== 持仓编辑弹窗 ====================
function HoldingEditor({ d, holding, onSave, onRemove }: {
  d: ETFDecision; holding?: Holding;
  onSave: (h: Holding) => void; onRemove: () => void;
}) {
  const [amount, setAmount] = useState(holding?.amount?.toString() || "");
  const [show, setShow] = useState(false);

  const isHeld = !!holding;
  const currentValue = isHeld && holding!.costPrice > 0
    ? holding!.amount / holding!.costPrice * d.price : 0;
  const pnlAmount = currentValue - (holding?.amount || 0);
  const pnlPct = isHeld && holding!.amount > 0
    ? (pnlAmount / holding!.amount * 100) : 0;

  return (
    <div className="mt-2">
      {isHeld && !show && (
        <div className="flex items-center gap-3 text-[11px] bg-[var(--bg-secondary)] rounded-lg px-3 py-2">
          <span className="text-[var(--text-secondary)]">💼 持有</span>
          <span className="font-mono font-bold">{holding!.amount.toFixed(0)}元</span>
          <span className="text-[var(--text-secondary)]">现值 {currentValue.toFixed(0)}</span>
          <span className={`font-bold ${pnlPct >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}`}>
            {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
          </span>
          <span className={`font-mono ${pnlAmount >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}`}>
            {pnlAmount >= 0 ? "+" : ""}{pnlAmount.toFixed(2)}元
          </span>
          <button onClick={() => setShow(true)} className="ml-auto text-[var(--accent-blue)] hover:underline">修改</button>
        </div>
      )}
      {!isHeld && !show && (
        <button onClick={() => setShow(true)}
          className="text-[11px] px-3 py-1.5 rounded-lg border border-dashed border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-blue)] transition-colors w-full">
          + 加入持仓
        </button>
      )}
      {show && (
        <div className="flex items-center gap-2 bg-[var(--bg-secondary)] rounded-lg px-3 py-2 flex-wrap">
          <label className="text-[11px] text-[var(--text-secondary)]">持有金额(元)</label>
          <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="例: 5000"
            className="w-28 text-xs px-2 py-1 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)] tabular-nums" />
          <button onClick={() => {
            const a = parseFloat(amount) || 0;
            if (a > 0) { onSave({ code: d.etfCode, amount: a, costPrice: holding?.costPrice || d.price }); setShow(false); }
          }} className="text-[11px] px-3 py-1 rounded bg-[var(--accent-blue)] text-white font-medium">保存</button>
          {isHeld && <button onClick={() => { onRemove(); setShow(false); }} className="text-[11px] px-3 py-1 rounded bg-[#ef444420] text-[#ef4444] font-medium">删除</button>}
          <button onClick={() => setShow(false)} className="text-[11px] text-[var(--text-secondary)]">取消</button>
        </div>
      )}
    </div>
  );
}

// ==================== 主面板 ====================
export default function ETFDecisionPanel() {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"group" | "all" | "sector" | "holding">("group");
  const [sectorFilter, setSectorFilter] = useState("全部");
  const [marketType, setMarketType] = useState<"all" | "otc" | "onmarket">("all");
  const [search, setSearch] = useState("");
  const [holdings, setHoldings] = useState<Holding[]>(loadHoldings);

  const updateHolding = (h: Holding) => {
    const next = holdings.filter(x => x.code !== h.code).concat(h);
    setHoldings(next); saveHoldings(next);
  };
  const removeHolding = (code: string) => {
    const next = holdings.filter(x => x.code !== code);
    setHoldings(next); saveHoldings(next);
  };

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/api/etf-decision");
      const json = await resp.json();
      if (!json.error) setData(json);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // 交易时段自动刷新（2分钟一次）
    const timer = setInterval(() => {
      if (isTradingTime()) load();
    }, 120000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] animate-pulse h-32" />
        {[1, 2, 3].map(i => <div key={i} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] animate-pulse h-48" />)}
      </div>
    );
  }

  if (!data) return <div className="card text-center py-12 text-[var(--text-secondary)]">暂无数据</div>;

  const isOTC = (code: string) => code.length === 6 && /^0[0-2]/.test(code);
  const activeSectors = SECTOR_GROUPS.find(g => g.label === sectorFilter)?.sectors || [];
  const searchLower = search.trim().toLowerCase();
  const filtered = (list: ETFDecision[]) => {
    let r = list;
    if (searchLower) r = r.filter(d => d.etfName.toLowerCase().includes(searchLower) || d.etfCode.includes(searchLower) || d.sector.includes(searchLower));
    if (sectorFilter !== "全部") r = r.filter(d => activeSectors.includes(d.sector));
    if (marketType === "otc") r = r.filter(d => isOTC(d.etfCode));
    if (marketType === "onmarket") r = r.filter(d => !isOTC(d.etfCode));
    return r;
  };
  const filterList = filtered;
  const filteredAll = filtered(data.allDecisions);
  const otcCount = data.allDecisions.filter(d => isOTC(d.etfCode)).length;
  const onMarketCount = data.allDecisions.length - otcCount;
  const heldCodes = new Set(holdings.map(h => h.code));
  const heldDecisions = data.allDecisions.filter(d => heldCodes.has(d.etfCode));
  const totalPnlAmount = heldDecisions.reduce((s, d) => {
    const h = holdings.find(x => x.code === d.etfCode);
    if (!h || h.costPrice <= 0) return s;
    const curVal = h.amount / h.costPrice * d.price;
    return s + (curVal - h.amount);
  }, 0);
  const totalCost = holdings.reduce((s, h) => s + h.amount, 0);
  const totalPnlPct = totalCost > 0 ? (totalPnlAmount / totalCost * 100) : 0;

  const totalBuy = data.strongBuy.length + data.buy.length;
  const totalSell = data.sell.length + data.runAway.length;

  return (
    <div className="space-y-6">
      {/* 收盘前紧急提醒 */}
      {data.isPreClose && (
        <div className="rounded-xl border-2 border-[#ef4444] bg-[#ef444410] p-5 animate-pulse">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">🔔</span>
            <h2 className="text-base font-bold text-[#ef4444]">收盘前决策时间！(14:30-15:00)</h2>
          </div>
          <p className="text-sm text-[var(--text-primary)] leading-relaxed">
            场外基金申购/赎回需在<strong>15:00前</strong>提交！当前场外基金涨跌为<strong>盘中实时估算</strong>，
            基于对应场内ETF走势推算。请立即确认操作：
          </p>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center text-[11px]">
            <div className="rounded-lg bg-[#ef444420] py-2">
              <div className="font-bold text-[#ef4444]">需要加仓</div>
              <div className="text-[var(--text-secondary)]">立即申购</div>
            </div>
            <div className="rounded-lg bg-[#f59e0b20] py-2">
              <div className="font-bold text-[#f59e0b]">需要减仓</div>
              <div className="text-[var(--text-secondary)]">立即赎回</div>
            </div>
            <div className="rounded-lg bg-[#10b98120] py-2">
              <div className="font-bold text-[#10b981]">持仓不动</div>
              <div className="text-[var(--text-secondary)]">无需操作</div>
            </div>
          </div>
          {/* 收盘前：持仓基金操作提醒 */}
          {heldDecisions.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#ef444430]">
              <div className="text-[11px] font-bold text-[#ef4444] mb-2">📋 你的持仓操作清单：</div>
              <div className="space-y-1">
                {heldDecisions.sort((a, b) => {
                  const urgOrder: Record<string, number> = { "立即执行": 0, "今日执行": 1, "本周关注": 2, "长期跟踪": 3 };
                  return (urgOrder[a.urgency] ?? 9) - (urgOrder[b.urgency] ?? 9);
                }).map(d => {
                  const h = holdings.find(x => x.code === d.etfCode);
                  const pnl = h && h.costPrice > 0 ? ((d.price - h.costPrice) / h.costPrice * 100) : 0;
                  return (
                    <div key={d.etfCode} className="flex items-center gap-2 text-[11px] bg-[#ef444408] rounded px-2 py-1.5">
                      <span className="font-bold">{d.etfName.replace("(估)", "")}</span>
                      <span className={`tabular-nums ${pnl >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}`}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}%
                      </span>
                      <div className="flex-1" />
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{
                        background: actionConfig[d.action]?.bg, color: actionConfig[d.action]?.text
                      }}>{d.action}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 盘中估算提示 */}
      {data.allDecisions.some(d => d.etfName.includes("(估)")) && (
        <div className="rounded-lg border border-[#f59e0b40] bg-[#f59e0b08] px-4 py-3">
          <p className="text-[11px] text-[#f59e0b]">
            ⏱️ 当前为交易时段，场外联接基金标注"(估)"表示今日涨跌为实时估算值（基于同板块场内ETF走势×95%仓位），
            最终净值以基金公司收盘后公布为准。<strong>3点前可据此做出申购/赎回决策。</strong>
          </p>
        </div>
      )}

      {/* 全局概览 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
        <div className="flex items-start gap-3 mb-4">
          <span className="text-2xl">💼</span>
          <div className="flex-1">
            <h2 className="text-base font-bold mb-1">场外ETF全面决策分析</h2>
            <p className="text-xs text-[var(--text-primary)] leading-relaxed">{data.overallAdvice}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg bg-[var(--bg-secondary)] p-3">
            <div className="text-[10px] text-[var(--text-secondary)] mb-1">🌍 大盘情绪</div>
            <p className="text-xs text-[var(--text-primary)]">{data.marketSentiment}</p>
          </div>
          <div className="rounded-lg bg-[var(--bg-secondary)] p-3">
            <div className="text-[10px] text-[var(--text-secondary)] mb-1">💰 北向资金</div>
            <p className="text-xs text-[var(--text-primary)]">{data.northboundTrend}</p>
          </div>
        </div>

        {/* 事件驱动 */}
        {data.topEvents && data.topEvents.length > 0 && (
          <div className="rounded-lg border border-[var(--border-color)] p-3 mb-4">
            <div className="text-[10px] text-[var(--text-secondary)] mb-2 font-bold">📰 今日事件驱动（影响板块判断）</div>
            <div className="space-y-1.5">
              {data.topEvents.slice(0, 6).map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    e.impact === "利好" ? "bg-[#ef444415] text-[#ef4444]" :
                    e.impact === "利空" ? "bg-[#10b98115] text-[#10b981]" :
                    "bg-[#f59e0b15] text-[#f59e0b]"
                  }`}>{e.impact}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] shrink-0">{e.category}</span>
                  <span className="text-[var(--text-primary)] flex-1 leading-relaxed">{e.title}</span>
                  <span className="text-[10px] text-[var(--text-secondary)] shrink-0">{e.sectors.slice(0, 3).join("/")}</span>
                </div>
              ))}
            </div>
            {data.eventSummaries && data.eventSummaries.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-[var(--border-color)]">
                {data.eventSummaries.slice(0, 8).map(s => (
                  <span key={s.sector} className={`text-[10px] px-2 py-0.5 rounded-full ${
                    s.netImpact > 10 ? "bg-[#ef444415] text-[#ef4444]" :
                    s.netImpact < -10 ? "bg-[#10b98115] text-[#10b981]" :
                    "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                  }`}>
                    {s.sector} {s.netImpact > 0 ? "+" : ""}{s.netImpact}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 汇总统计 */}
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: "重仓加仓", count: data.strongBuy.length, color: "#ef4444", icon: "🔥" },
            { label: "建议买入", count: data.buy.length, color: "#f59e0b", icon: "📈" },
            { label: "持仓观望", count: data.hold.length, color: "#94a3b8", icon: "⏸️" },
            { label: "分批减仓", count: data.sell.length, color: "#3b82f6", icon: "📉" },
            { label: "清仓跑路", count: data.runAway.length, color: "#10b981", icon: "🚨" },
          ].map(item => (
            <div key={item.label} className="text-center rounded-lg border border-[var(--border-color)] py-2.5">
              <div className="text-lg">{item.icon}</div>
              <div className="text-xl font-black tabular-nums" style={{ color: item.color }}>{item.count}</div>
              <div className="text-[10px] text-[var(--text-secondary)]">{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 搜索 + 场内/场外筛选 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-[360px]">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜索基金名称/代码/板块..."
            className="w-full text-xs px-3 py-2 pl-8 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)]"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] text-xs">🔍</span>
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] text-xs hover:text-[var(--text-primary)]">✕</button>}
        </div>
        {([
          { key: "all", label: `全部 ${data.allDecisions.length}` },
          { key: "otc", label: `场外 ${otcCount}` },
          { key: "onmarket", label: `场内 ${onMarketCount}` },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setMarketType(t.key)}
            className={`text-[11px] px-3 py-1.5 rounded-lg transition-colors font-medium ${
              marketType === t.key
                ? t.key === "otc" ? "bg-[#f59e0b] text-white" : t.key === "onmarket" ? "bg-[#3b82f6] text-white" : "bg-[var(--accent-blue)] text-white"
                : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 板块筛选 */}
      <div className="flex flex-wrap gap-1.5">
        {SECTOR_GROUPS.map(g => (
          <button
            key={g.label}
            onClick={() => setSectorFilter(g.label)}
            className={`text-[11px] px-2.5 py-1 rounded-full transition-colors ${
              sectorFilter === g.label
                ? "bg-[var(--accent-blue)] text-white"
                : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {g.label}
            {g.label !== "全部" && (
              <span className="ml-1 opacity-60">
                {g.sectors.reduce((n, s) => n + filtered(data.allDecisions).filter(d => d.sector === s).length, 0) || g.sectors.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 视图切换 */}
      <div className="flex items-center gap-2">
        <button onClick={() => setView("group")} className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${view === "group" ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"}`}>
          按操作分组
        </button>
        <button onClick={() => setView("all")} className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${view === "all" ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"}`}>
          综合分排序
        </button>
        <button onClick={() => setView("sector")} className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${view === "sector" ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"}`}>
          按板块
        </button>
        <button onClick={() => setView("holding")} className={`text-xs px-3 py-1.5 rounded-lg transition-colors font-medium ${view === "holding" ? "bg-[#8b5cf6] text-white" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"}`}>
          💼 我的持仓{holdings.length > 0 ? ` (${holdings.length})` : ""}
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-[var(--text-secondary)]">{filteredAll.length}只ETF</span>
        <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
          🔄 刷新
        </button>
      </div>

      {/* 内容 */}
      {view === "holding" ? (
        <div className="space-y-4">
          {/* 持仓汇总 */}
          {holdings.length > 0 ? (
            <>
              <div className="rounded-xl border border-[#8b5cf640] bg-[var(--bg-card)] p-4">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xl">💼</span>
                  <h3 className="text-sm font-bold">我的持仓</h3>
                  <span className="text-[11px] text-[var(--text-secondary)]">{holdings.length}只基金</span>
                  <div className="flex-1" />
                  <div className="text-right">
                    <div className={`text-lg font-black tabular-nums ${totalPnlAmount >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}`}>
                      {totalPnlAmount >= 0 ? "+" : ""}{totalPnlAmount.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-[var(--text-secondary)]">
                      总盈亏 <span className={totalPnlPct >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}>
                        {totalPnlPct >= 0 ? "+" : ""}{totalPnlPct.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                  <div className="rounded-lg bg-[var(--bg-secondary)] py-2">
                    <div className="text-[var(--text-secondary)]">总投入</div>
                    <div className="font-bold tabular-nums">{totalCost.toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg bg-[var(--bg-secondary)] py-2">
                    <div className="text-[var(--text-secondary)]">当前市值</div>
                    <div className="font-bold tabular-nums">{(totalCost + totalPnlAmount).toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg bg-[var(--bg-secondary)] py-2">
                    <div className="text-[var(--text-secondary)]">需操作</div>
                    <div className="font-bold text-[#f59e0b]">
                      {heldDecisions.filter(d => d.action !== "持仓不动" && d.action !== "观望等待").length}只
                    </div>
                  </div>
                </div>
              </div>

              {/* 需要操作的持仓优先显示 */}
              {(() => {
                const needAction = heldDecisions.filter(d => d.action !== "持仓不动" && d.action !== "观望等待")
                  .sort((a, b) => {
                    const urgOrder: Record<string, number> = { "立即执行": 0, "今日执行": 1, "本周关注": 2, "长期跟踪": 3 };
                    return (urgOrder[a.urgency] ?? 9) - (urgOrder[b.urgency] ?? 9);
                  });
                const noAction = heldDecisions.filter(d => d.action === "持仓不动" || d.action === "观望等待");
                return (
                  <>
                    {needAction.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">⚡</span>
                          <h4 className="text-xs font-bold text-[#f59e0b]">需要操作 ({needAction.length}只)</h4>
                        </div>
                        {needAction.map(d => <ETFCard key={d.etfCode} d={d} holding={holdings.find(h => h.code === d.etfCode)}
                          onSaveHolding={updateHolding} onRemoveHolding={() => removeHolding(d.etfCode)} />)}
                      </div>
                    )}
                    {noAction.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">⏸️</span>
                          <h4 className="text-xs font-bold text-[var(--text-secondary)]">持仓不动 ({noAction.length}只)</h4>
                        </div>
                        {noAction.map(d => <ETFCard key={d.etfCode} d={d} holding={holdings.find(h => h.code === d.etfCode)}
                          onSaveHolding={updateHolding} onRemoveHolding={() => removeHolding(d.etfCode)} />)}
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-card)] p-8 text-center">
              <div className="text-3xl mb-3">💼</div>
              <h3 className="text-sm font-bold mb-1">还没有添加持仓</h3>
              <p className="text-[11px] text-[var(--text-secondary)] mb-4">在任意基金卡片上点击"+ 加入持仓"来添加</p>
              <button onClick={() => setView("all")} className="text-xs px-4 py-2 rounded-lg bg-[var(--accent-blue)] text-white">浏览全部基金</button>
            </div>
          )}
        </div>
      ) : view === "group" ? (
        <div className="space-y-8">
          <ActionGroup title="立即加仓" icon="🔥" color="#ef4444" items={filterList(data.strongBuy)} holdings={holdings} onSave={updateHolding} onRemove={removeHolding} />
          <ActionGroup title="建议买入/入场" icon="📈" color="#f59e0b" items={filterList(data.buy)} holdings={holdings} onSave={updateHolding} onRemove={removeHolding} />
          <ActionGroup title="持仓观望" icon="⏸️" color="#94a3b8" items={filterList(data.hold)} holdings={holdings} onSave={updateHolding} onRemove={removeHolding} />
          <ActionGroup title="分批减仓" icon="📉" color="#3b82f6" items={filterList(data.sell)} holdings={holdings} onSave={updateHolding} onRemove={removeHolding} />
          <ActionGroup title="清仓跑路" icon="🚨" color="#10b981" items={filterList(data.runAway)} holdings={holdings} onSave={updateHolding} onRemove={removeHolding} />
        </div>
      ) : view === "sector" ? (
        <div className="space-y-6">
          {(sectorFilter === "全部" ? SECTOR_GROUPS.slice(1) : SECTOR_GROUPS.filter(g => g.label === sectorFilter)).map(group => {
            const items = data.allDecisions.filter(d => group.sectors.includes(d.sector)).sort((a, b) => b.compositeScore - a.compositeScore);
            if (items.length === 0) return null;
            return (
              <div key={group.label} className="space-y-3">
                <div className="flex items-center gap-2 border-b border-[var(--border-color)] pb-2">
                  <h3 className="text-sm font-bold">{group.label}</h3>
                  <span className="text-[10px] text-[var(--text-secondary)]">{items.length}只</span>
                  <div className="flex-1" />
                  <span className="text-[10px] text-[var(--text-secondary)]">
                    均分 {Math.round(items.reduce((s, d) => s + d.compositeScore, 0) / items.length)}
                  </span>
                </div>
                {items.map(d => <ETFCard key={d.etfCode} d={d} holding={holdings.find(h => h.code === d.etfCode)}
                  onSaveHolding={updateHolding} onRemoveHolding={() => removeHolding(d.etfCode)} />)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAll.map(d => <ETFCard key={d.etfCode} d={d} holding={holdings.find(h => h.code === d.etfCode)}
            onSaveHolding={updateHolding} onRemoveHolding={() => removeHolding(d.etfCode)} />)}
        </div>
      )}

      {/* 场外基金操作提示 */}
      <div className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] p-4">
        <h4 className="text-xs font-bold mb-2">📝 场外基金操作须知</h4>
        <div className="grid grid-cols-2 gap-3 text-[11px] text-[var(--text-secondary)]">
          <div>
            <p>• <strong>申购/赎回截止</strong>：交易日15:00前</p>
            <p>• <strong>确认时间</strong>：T+1日确认份额</p>
            <p>• <strong>赎回到账</strong>：T+1~T+3日到账</p>
          </div>
          <div>
            <p>• <strong>定投策略</strong>：下跌加大定投额，上涨减少</p>
            <p>• <strong>止损纪律</strong>：总仓位亏损8%必须执行止损</p>
            <p>• <strong>仓位控制</strong>：单个板块不超过总仓位30%</p>
          </div>
        </div>
        <p className="text-[10px] text-[var(--text-secondary)] mt-2">
          ⚠️ 以上分析基于技术指标和公开数据计算，不构成投资建议。投资有风险，决策需谨慎。
        </p>
      </div>
    </div>
  );
}
