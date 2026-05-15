"use client";
import { useState, useEffect, useCallback } from "react";

// ==================== 类型 ====================

type Grade = "S" | "A" | "B" | "C" | "D";
type Momentum = "加速" | "启动" | "震荡" | "走弱" | "暴跌";
type MoneyDir = "主力大幅流入" | "主力流入" | "中性" | "主力流出" | "主力大幅流出";
type Outlook = "看涨" | "看跌" | "震荡";
type Sentiment = "极度恐慌" | "恐慌" | "偏弱" | "中性" | "偏强" | "亢奋" | "极度亢奋";

interface SectorReview {
  sector: string;
  changePercent: number;
  amplitude: number;
  change5d: number;
  mainNetInflow: number;
  mainNetInflowPercent: number;
  riseCount: number;
  fallCount: number;
  leadingStock: string;
  leadingStockChange: number;
  grade: Grade;
  tag: string;
  momentum: Momentum;
  moneyDirection: MoneyDir;
  tomorrowOutlook: Outlook;
  tomorrowReason: string;
}

interface SentimentDimension {
  name: string;
  icon: string;
  score: number;
  label: string;
  detail: string;
  color: "red" | "green" | "yellow" | "gray";
}

type MoneyEffect = "赚钱效应爆棚" | "赚钱效应好" | "赚钱效应一般" | "亏钱效应" | "亏钱效应严重";

interface SentimentPanel {
  sentiment: Sentiment;
  sentimentScore: number;
  sentimentEmoji: string;
  dimensions: SentimentDimension[];
  limitUp: number;
  limitDown: number;
  riseCount: number;
  fallCount: number;
  flatCount: number;
  rise5pct: number;
  fall5pct: number;
  rise7pct: number;
  fall7pct: number;
  avgChange: number;
  medianChange: number;
  moneyEffect: MoneyEffect;
  moneyEffectDesc: string;
  maxGainStock: { code: string; name: string; change: number };
  maxLossStock: { code: string; name: string; change: number };
  summary: string;
}

interface MarketReview {
  shChange: number;
  szChange: number;
  cybChange: number;
  totalAmount: number;
  sentimentPanel: SentimentPanel;
  northboundToday: number;
  northbound3d: number;
  northboundTrend: string;
  volumeVsPrev: "放量" | "缩量" | "平量";
  volumeComment: string;
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

interface DailyReviewReport {
  date: string;
  marketReview: MarketReview;
  topGainers: SectorReview[];
  topLosers: SectorReview[];
  topMoneyIn: SectorReview[];
  topMoneyOut: SectorReview[];
  allSectors: SectorReview[];
  hotEvents: EventSignal[];
  tomorrowOverall: Outlook;
  tomorrowAdvice: string;
  tomorrowFocus: string[];
  summary: string;
  timestamp: string;
}

// ==================== 样式 ====================

const gradeStyle: Record<Grade, { bg: string; text: string }> = {
  S: { bg: "#ef444425", text: "#ef4444" },
  A: { bg: "#f59e0b25", text: "#f59e0b" },
  B: { bg: "#6b728020", text: "#94a3b8" },
  C: { bg: "#3b82f620", text: "#3b82f6" },
  D: { bg: "#10b98120", text: "#10b981" },
};

const momentumStyle: Record<Momentum, { bg: string; text: string }> = {
  "加速": { bg: "#ef444420", text: "#ef4444" },
  "启动": { bg: "#f59e0b20", text: "#f59e0b" },
  "震荡": { bg: "#6b728015", text: "#94a3b8" },
  "走弱": { bg: "#3b82f615", text: "#3b82f6" },
  "暴跌": { bg: "#10b98115", text: "#10b981" },
};

const outlookIcon: Record<Outlook, string> = { "看涨": "📈", "看跌": "📉", "震荡": "〰️" };
const outlookColor: Record<Outlook, string> = { "看涨": "#ef4444", "看跌": "#10b981", "震荡": "#f59e0b" };

const sentimentGradient: Record<Sentiment, { color: string; emoji: string }> = {
  "极度恐慌": { color: "#10b981", emoji: "😱" },
  "恐慌": { color: "#059669", emoji: "😰" },
  "偏弱": { color: "#3b82f6", emoji: "😟" },
  "中性": { color: "#94a3b8", emoji: "😐" },
  "偏强": { color: "#f59e0b", emoji: "😊" },
  "亢奋": { color: "#ef4444", emoji: "🔥" },
  "极度亢奋": { color: "#dc2626", emoji: "🚀" },
};

// ==================== 组件 ====================

type TabKey = "overview" | "sentiment" | "sectors" | "money" | "events" | "tomorrow";

export default function DailyReviewPanel() {
  const [data, setData] = useState<DailyReviewReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("overview");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/daily-review");
      if (!res.ok) throw new Error("fetch failed");
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error("Daily review fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-[var(--text-secondary)]">
      <span className="animate-spin mr-2">⏳</span> 正在生成复盘数据...
    </div>
  );

  if (!data) return (
    <div className="text-center py-20 text-[var(--text-secondary)]">
      <p className="text-lg mb-2">📊</p>
      <p>复盘数据暂不可用</p>
      <button onClick={fetchData} className="mt-3 text-xs text-[var(--accent-blue)] hover:underline">重试</button>
    </div>
  );

  const sp = data.marketReview.sentimentPanel;

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: "overview", label: "大盘总览", icon: "📊" },
    { key: "sentiment", label: "情绪面", icon: "🧠" },
    { key: "sectors", label: "板块评级", icon: "🏷️" },
    { key: "money", label: "资金流向", icon: "💰" },
    { key: "events", label: "今日事件", icon: "📰" },
    { key: "tomorrow", label: "明日前瞻", icon: "🔮" },
  ];

  return (
    <div className="space-y-4">
      {/* 顶部日期 + 情绪 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold">📋 {data.date} 复盘</h2>
            <span className="text-sm px-3 py-1 rounded-full font-bold"
              style={{ background: sentimentGradient[sp.sentiment].color + "20", color: sentimentGradient[sp.sentiment].color }}>
              {sp.sentimentEmoji} {sp.sentiment} ({sp.sentimentScore})
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
              style={{ background: sp.moneyEffect.includes("赚") ? "#ef444418" : "#10b98118", color: sp.moneyEffect.includes("赚") ? "#ef4444" : "#10b981" }}>
              {sp.moneyEffect}
            </span>
          </div>
          <button onClick={fetchData} className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent-blue)]">🔄 刷新</button>
        </div>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{data.summary}</p>
      </div>

      {/* 子标签 */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`shrink-0 px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
              tab === t.key ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      {tab === "overview" && <OverviewTab market={data.marketReview} topGainers={data.topGainers} topLosers={data.topLosers} />}
      {tab === "sentiment" && <SentimentTab panel={sp} />}
      {tab === "sectors" && <SectorsTab sectors={data.allSectors} />}
      {tab === "money" && <MoneyTab topIn={data.topMoneyIn} topOut={data.topMoneyOut} market={data.marketReview} />}
      {tab === "events" && <EventsTab events={data.hotEvents} />}
      {tab === "tomorrow" && <TomorrowTab outlook={data.tomorrowOverall} advice={data.tomorrowAdvice} focus={data.tomorrowFocus} sectors={data.allSectors} />}
    </div>
  );
}

// ==================== 大盘总览 ====================

function OverviewTab({ market, topGainers, topLosers }: { market: MarketReview; topGainers: SectorReview[]; topLosers: SectorReview[] }) {
  const sp = market.sentimentPanel;
  return (
    <div className="space-y-4">
      {/* 三大指数 */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "上证指数", change: market.shChange },
          { label: "深证成指", change: market.szChange },
          { label: "创业板指", change: market.cybChange },
        ].map(idx => (
          <div key={idx.label} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 text-center">
            <div className="text-[11px] text-[var(--text-secondary)] mb-1">{idx.label}</div>
            <div className={`text-xl font-bold tabular-nums ${idx.change >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}`}>
              {idx.change >= 0 ? "+" : ""}{idx.change.toFixed(2)}%
            </div>
          </div>
        ))}
      </div>

      {/* 市场数据网格 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="涨跌比" value={`${sp.riseCount} : ${sp.fallCount}`}
          color={sp.riseCount > sp.fallCount ? "#ef4444" : "#10b981"} />
        <StatCard label="涨停/跌停" value={`${sp.limitUp} / ${sp.limitDown}`}
          color={sp.limitUp > sp.limitDown ? "#ef4444" : "#10b981"} />
        <StatCard label="两市成交" value={`${(market.totalAmount / 1e8).toFixed(0)}亿`}
          sub={market.volumeVsPrev} color="#f59e0b" />
        <StatCard label="北向资金" value={`${market.northboundToday > 0 ? "+" : ""}${(market.northboundToday / 1e8).toFixed(1)}亿`}
          sub={market.northboundTrend} color={market.northboundToday >= 0 ? "#ef4444" : "#10b981"} />
      </div>

      {/* 核心情绪数据 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="中位数" value={`${sp.medianChange >= 0 ? "+" : ""}${sp.medianChange.toFixed(2)}%`}
          sub={sp.medianChange > 0 ? "大部分人赚" : sp.medianChange < 0 ? "大部分人亏" : "持平"}
          color={sp.medianChange >= 0 ? "#ef4444" : "#10b981"} />
        <StatCard label="涨>5%/跌>5%" value={`${sp.rise5pct} / ${sp.fall5pct}`}
          color={sp.rise5pct > sp.fall5pct ? "#ef4444" : "#10b981"} />
        <StatCard label="准涨停/准跌停" value={`${sp.rise7pct} / ${sp.fall7pct}`}
          color={sp.rise7pct > sp.fall7pct ? "#ef4444" : "#10b981"} />
        <StatCard label="平均涨幅" value={`${sp.avgChange >= 0 ? "+" : ""}${sp.avgChange.toFixed(2)}%`}
          color={sp.avgChange >= 0 ? "#ef4444" : "#10b981"} />
      </div>

      {/* 情绪条 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm">🧠</span>
          <h3 className="text-sm font-bold">市场情绪</h3>
          <span className="text-[10px] text-[var(--accent-blue)] cursor-pointer hover:underline ml-auto"
            onClick={() => { /* 可以跳到情绪面tab */ }}>详细分析 →</span>
        </div>
        <SentimentBar score={sp.sentimentScore} sentiment={sp.sentiment} />
        <p className="text-[11px] text-[var(--text-secondary)] mt-2 leading-relaxed">{sp.summary}</p>
      </div>

      {/* 今日之最 */}
      {(sp.maxGainStock.code || sp.maxLossStock.code) && (
        <div className="grid grid-cols-2 gap-3">
          {sp.maxGainStock.code && (
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
              <div className="text-[10px] text-[var(--text-secondary)] mb-1">🏆 今日最强</div>
              <div className="text-xs font-bold">{sp.maxGainStock.name} <span className="text-[#ef4444]">+{sp.maxGainStock.change.toFixed(1)}%</span></div>
              <div className="text-[9px] text-[var(--text-secondary)]">{sp.maxGainStock.code}</div>
            </div>
          )}
          {sp.maxLossStock.code && (
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3">
              <div className="text-[10px] text-[var(--text-secondary)] mb-1">💀 今日最弱</div>
              <div className="text-xs font-bold">{sp.maxLossStock.name} <span className="text-[#10b981]">{sp.maxLossStock.change.toFixed(1)}%</span></div>
              <div className="text-[9px] text-[var(--text-secondary)]">{sp.maxLossStock.code}</div>
            </div>
          )}
        </div>
      )}

      {/* 涨幅/跌幅榜 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
          <h3 className="text-sm font-bold mb-3 text-[#ef4444]">🔥 涨幅榜 TOP5</h3>
          <SectorList sectors={topGainers} showChange />
        </div>
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
          <h3 className="text-sm font-bold mb-3 text-[#10b981]">📉 跌幅榜 TOP5</h3>
          <SectorList sectors={topLosers} showChange />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 text-center">
      <div className="text-[10px] text-[var(--text-secondary)] mb-1">{label}</div>
      <div className="text-sm font-bold tabular-nums" style={{ color }}>{value}</div>
      {sub && <div className="text-[9px] text-[var(--text-secondary)] mt-0.5">{sub}</div>}
    </div>
  );
}

function SentimentBar({ score, sentiment }: { score: number; sentiment: Sentiment }) {
  const pct = ((score + 100) / 200) * 100;
  const sg = sentimentGradient[sentiment];
  return (
    <div className="relative h-6 rounded-full bg-gradient-to-r from-[#10b981] via-[#94a3b8] to-[#ef4444] overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow z-10">
        {sg.emoji} {sentiment} ({score > 0 ? "+" : ""}{score})
      </div>
      <div className="absolute top-0 h-full w-1 bg-white rounded shadow-lg z-20" style={{ left: `${pct}%`, transform: "translateX(-50%)" }} />
    </div>
  );
}

// ==================== 情绪面详情 ====================

const dimColorMap: Record<string, string> = { red: "#ef4444", green: "#10b981", yellow: "#f59e0b", gray: "#94a3b8" };

function SentimentTab({ panel: sp }: { panel: SentimentPanel }) {
  return (
    <div className="space-y-4">
      {/* 情绪总分 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">{sp.sentimentEmoji}</span>
          <div>
            <div className="text-sm font-bold">{sp.sentiment}</div>
            <div className="text-[10px] text-[var(--text-secondary)]">情绪综合得分</div>
          </div>
          <div className="ml-auto text-2xl font-black tabular-nums"
            style={{ color: sp.sentimentScore >= 0 ? "#ef4444" : "#10b981" }}>
            {sp.sentimentScore > 0 ? "+" : ""}{sp.sentimentScore}
          </div>
        </div>
        <SentimentBar score={sp.sentimentScore} sentiment={sp.sentiment} />
        <p className="text-[11px] text-[var(--text-secondary)] mt-3 leading-relaxed">{sp.summary}</p>
      </div>

      {/* 8维雷达（条形图替代） */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-4">📊 八维情绪拆解</h3>
        <div className="space-y-3">
          {sp.dimensions.map(dim => {
            const pct = ((dim.score + 20) / 40) * 100; // -20~+20 → 0~100%
            const barColor = dimColorMap[dim.color] || "#94a3b8";
            return (
              <div key={dim.name}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm w-5 text-center">{dim.icon}</span>
                  <span className="text-[11px] font-bold w-16">{dim.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: barColor + "20", color: barColor }}>
                    {dim.label}
                  </span>
                  <span className="text-[10px] font-bold tabular-nums ml-auto" style={{ color: barColor }}>
                    {dim.score > 0 ? "+" : ""}{dim.score}
                  </span>
                </div>
                <div className="relative h-4 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                  {/* 中线 */}
                  <div className="absolute top-0 left-1/2 w-px h-full bg-[var(--text-secondary)] opacity-30 z-10" />
                  {/* 条 */}
                  {dim.score >= 0 ? (
                    <div className="absolute top-0 h-full rounded-r-full transition-all"
                      style={{ left: "50%", width: `${(dim.score / 20) * 50}%`, background: barColor }} />
                  ) : (
                    <div className="absolute top-0 h-full rounded-l-full transition-all"
                      style={{ right: "50%", width: `${(Math.abs(dim.score) / 20) * 50}%`, background: barColor }} />
                  )}
                </div>
                <p className="text-[9px] text-[var(--text-secondary)] mt-0.5 ml-7">{dim.detail}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 赚钱效应面板 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-3">💰 赚钱效应</h3>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-lg px-3 py-1.5 rounded-lg font-bold"
            style={{ background: sp.moneyEffect.includes("赚") ? "#ef444418" : "#10b98118", color: sp.moneyEffect.includes("赚") ? "#ef4444" : "#10b981" }}>
            {sp.moneyEffect}
          </span>
          <p className="text-[11px] text-[var(--text-secondary)] flex-1">{sp.moneyEffectDesc}</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MiniStat label="涨>5%" value={sp.rise5pct} color="#ef4444" />
          <MiniStat label="跌>5%" value={sp.fall5pct} color="#10b981" />
          <MiniStat label="准涨停>7%" value={sp.rise7pct} color="#ef4444" />
          <MiniStat label="准跌停>7%" value={sp.fall7pct} color="#10b981" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
          <MiniStat label="涨停" value={sp.limitUp} color="#ef4444" />
          <MiniStat label="跌停" value={sp.limitDown} color="#10b981" />
          <MiniStat label="平均涨幅" value={`${sp.avgChange >= 0 ? "+" : ""}${sp.avgChange.toFixed(2)}%`} color={sp.avgChange >= 0 ? "#ef4444" : "#10b981"} />
          <MiniStat label="中位数" value={`${sp.medianChange >= 0 ? "+" : ""}${sp.medianChange.toFixed(2)}%`} color={sp.medianChange >= 0 ? "#ef4444" : "#10b981"} />
        </div>
      </div>

      {/* 今日之最 */}
      <div className="grid grid-cols-2 gap-3">
        {sp.maxGainStock.code && (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] text-[var(--text-secondary)] mb-1">🏆 今日最强</div>
            <div className="text-sm font-bold">{sp.maxGainStock.name}</div>
            <div className="text-lg font-black text-[#ef4444] tabular-nums">+{sp.maxGainStock.change.toFixed(1)}%</div>
            <div className="text-[9px] text-[var(--text-secondary)]">{sp.maxGainStock.code}</div>
          </div>
        )}
        {sp.maxLossStock.code && (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
            <div className="text-[10px] text-[var(--text-secondary)] mb-1">💀 今日最弱</div>
            <div className="text-sm font-bold">{sp.maxLossStock.name}</div>
            <div className="text-lg font-black text-[#10b981] tabular-nums">{sp.maxLossStock.change.toFixed(1)}%</div>
            <div className="text-[9px] text-[var(--text-secondary)]">{sp.maxLossStock.code}</div>
          </div>
        )}
      </div>

      <p className="text-[10px] text-[var(--text-secondary)] text-center">
        💡 大A更多是情绪驱动。中位数和赚钱效应比指数更能反映真实体感。情绪冰点往往是反转信号，亢奋期需警惕回调。
      </p>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="rounded-lg bg-[var(--bg-secondary)] px-2.5 py-1.5 text-center">
      <div className="text-[9px] text-[var(--text-secondary)]">{label}</div>
      <div className="text-xs font-bold tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

// ==================== 板块评级 ====================

function SectorsTab({ sectors }: { sectors: SectorReview[] }) {
  const [sortBy, setSortBy] = useState<"change" | "grade" | "inflow">("change");
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = [...sectors].sort((a, b) => {
    if (sortBy === "change") return b.changePercent - a.changePercent;
    if (sortBy === "grade") {
      const go: Record<Grade, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };
      return go[a.grade] - go[b.grade];
    }
    return b.mainNetInflow - a.mainNetInflow;
  });

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-bold">🏷️ 全板块评级</h3>
        <div className="flex-1" />
        {(["change", "grade", "inflow"] as const).map(k => (
          <button key={k} onClick={() => setSortBy(k)}
            className={`text-[10px] px-2 py-0.5 rounded ${sortBy === k ? "bg-[var(--accent-blue)] text-white font-bold" : "text-[var(--text-secondary)]"}`}>
            {k === "change" ? "涨跌" : k === "grade" ? "评级" : "资金"}
          </button>
        ))}
      </div>

      <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
        {sorted.map(sec => {
          const gs = gradeStyle[sec.grade];
          const ms = momentumStyle[sec.momentum];
          const isExp = expanded === sec.sector;
          return (
            <div key={sec.sector}
              className="rounded-lg border border-[var(--border-color)] overflow-hidden cursor-pointer hover:border-[var(--accent-blue)] transition-colors"
              onClick={() => setExpanded(isExp ? null : sec.sector)}>
              <div className="flex items-center gap-2 px-3 py-2.5">
                {/* 评级 */}
                <span className="text-xs w-7 h-7 flex items-center justify-center rounded-lg font-black shrink-0"
                  style={{ background: gs.bg, color: gs.text }}>{sec.grade}</span>
                {/* 板块名 */}
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] font-bold truncate block">{sec.sector}</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: ms.bg, color: ms.text }}>{sec.momentum}</span>
                    <span className="text-[9px] text-[var(--text-secondary)]">{sec.riseCount}涨 {sec.fallCount}跌</span>
                  </div>
                </div>
                {/* 涨跌幅 */}
                <div className="text-right shrink-0 w-16">
                  <div className={`text-xs font-bold tabular-nums ${sec.changePercent >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}`}>
                    {sec.changePercent >= 0 ? "+" : ""}{sec.changePercent.toFixed(2)}%
                  </div>
                </div>
                {/* 资金 */}
                <div className="text-right shrink-0 w-16">
                  <div className={`text-[10px] font-bold tabular-nums ${sec.mainNetInflow >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}`}>
                    {sec.mainNetInflow >= 0 ? "+" : ""}{sec.mainNetInflow.toFixed(1)}亿
                  </div>
                  <div className="text-[9px] text-[var(--text-secondary)]">主力</div>
                </div>
                {/* 明日 */}
                <span className="text-[10px] shrink-0" style={{ color: outlookColor[sec.tomorrowOutlook] }}>
                  {outlookIcon[sec.tomorrowOutlook]}
                </span>
                <span className="text-[10px] text-[var(--text-secondary)] shrink-0">{isExp ? "▲" : "▼"}</span>
              </div>
              {isExp && (
                <div className="px-3 pb-3 pt-0 border-t border-[var(--border-color)] space-y-2">
                  <p className="text-[11px] text-[var(--text-primary)] leading-relaxed mt-2">{sec.tag}</p>
                  <div className="flex flex-wrap gap-3 text-[10px] text-[var(--text-secondary)]">
                    <span>振幅: {sec.amplitude.toFixed(1)}%</span>
                    <span className={sec.change5d >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}>
                      5日: {sec.change5d >= 0 ? "+" : ""}{sec.change5d.toFixed(1)}%
                    </span>
                    <span>领涨: {sec.leadingStock} ({sec.leadingStockChange >= 0 ? "+" : ""}{sec.leadingStockChange.toFixed(1)}%)</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] bg-[var(--bg-secondary)] rounded px-2 py-1.5">
                    <span style={{ color: outlookColor[sec.tomorrowOutlook] }}>
                      {outlookIcon[sec.tomorrowOutlook]} 明日{sec.tomorrowOutlook}
                    </span>
                    <span className="text-[var(--text-secondary)]">{sec.tomorrowReason}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectorList({ sectors, showChange }: { sectors: SectorReview[]; showChange?: boolean }) {
  return (
    <div className="space-y-1.5">
      {sectors.map((sec, i) => {
        const gs = gradeStyle[sec.grade];
        return (
          <div key={sec.sector} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-secondary)]">
            <span className="text-[10px] w-5 h-5 flex items-center justify-center rounded font-bold shrink-0"
              style={{ background: gs.bg, color: gs.text }}>{i + 1}</span>
            <span className="text-[11px] font-bold flex-1 truncate">{sec.sector}</span>
            {showChange && (
              <span className={`text-xs font-bold tabular-nums ${sec.changePercent >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}`}>
                {sec.changePercent >= 0 ? "+" : ""}{sec.changePercent.toFixed(2)}%
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: gs.bg, color: gs.text }}>{sec.grade}</span>
          </div>
        );
      })}
    </div>
  );
}

// ==================== 资金流向 ====================

function MoneyTab({ topIn, topOut, market }: { topIn: SectorReview[]; topOut: SectorReview[]; market: MarketReview }) {
  return (
    <div className="space-y-4">
      {/* 北向资金 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-3">🌏 北向资金</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center">
            <div className="text-[10px] text-[var(--text-secondary)]">今日</div>
            <div className={`text-lg font-bold tabular-nums ${market.northboundToday >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}`}>
              {market.northboundToday >= 0 ? "+" : ""}{(market.northboundToday / 1e8).toFixed(1)}亿
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-[var(--text-secondary)]">近3日</div>
            <div className={`text-lg font-bold tabular-nums ${market.northbound3d >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}`}>
              {market.northbound3d >= 0 ? "+" : ""}{(market.northbound3d / 1e8).toFixed(1)}亿
            </div>
          </div>
        </div>
        <div className="text-[10px] text-center text-[var(--text-secondary)] mt-2">趋势: {market.northboundTrend}</div>
      </div>

      {/* 资金流入/流出 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
          <h3 className="text-sm font-bold mb-3 text-[#ef4444]">💹 主力流入 TOP5</h3>
          <div className="space-y-1.5">
            {topIn.map((sec, i) => (
              <div key={sec.sector} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-secondary)]">
                <span className="text-[10px] w-5 h-5 flex items-center justify-center rounded font-bold bg-[#ef444420] text-[#ef4444] shrink-0">{i + 1}</span>
                <span className="text-[11px] font-bold flex-1 truncate">{sec.sector}</span>
                <span className="text-xs font-bold tabular-nums text-[#ef4444]">+{sec.mainNetInflow.toFixed(1)}亿</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
          <h3 className="text-sm font-bold mb-3 text-[#10b981]">💸 主力流出 TOP5</h3>
          <div className="space-y-1.5">
            {topOut.map((sec, i) => (
              <div key={sec.sector} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-secondary)]">
                <span className="text-[10px] w-5 h-5 flex items-center justify-center rounded font-bold bg-[#10b98120] text-[#10b981] shrink-0">{i + 1}</span>
                <span className="text-[11px] font-bold flex-1 truncate">{sec.sector}</span>
                <span className="text-xs font-bold tabular-nums text-[#10b981]">{sec.mainNetInflow.toFixed(1)}亿</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== 今日事件 ====================

function EventsTab({ events }: { events: EventSignal[] }) {
  if (events.length === 0) return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-8 text-center text-[var(--text-secondary)]">
      <p className="text-lg mb-2">📰</p>
      <p className="text-xs">今日暂无重大事件</p>
    </div>
  );

  const impactStyle: Record<string, { bg: string; text: string }> = {
    "利好": { bg: "#ef444418", text: "#ef4444" },
    "利空": { bg: "#10b98118", text: "#10b981" },
    "关注": { bg: "#f59e0b18", text: "#f59e0b" },
  };

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
      <h3 className="text-sm font-bold mb-3">📰 今日重要事件</h3>
      <div className="space-y-2">
        {events.map((evt, i) => {
          const es = impactStyle[evt.impact] || impactStyle["关注"];
          return (
            <div key={i} className="rounded-lg bg-[var(--bg-secondary)] px-3 py-2.5">
              <div className="flex items-start gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 mt-0.5" style={{ background: es.bg, color: es.text }}>
                  {evt.impact}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-[var(--text-primary)] leading-snug">{evt.title}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-[9px] text-[var(--text-secondary)]">
                    <span>{evt.category}</span>
                    <span>权重: {evt.weight}/10</span>
                    <span>影响: {evt.sectors.slice(0, 3).join("/")}</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-1">{evt.reason}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==================== 明日前瞻 ====================

function TomorrowTab({ outlook, advice, focus, sectors }: {
  outlook: Outlook; advice: string; focus: string[]; sectors: SectorReview[];
}) {
  const bullSectors = sectors.filter(s => s.tomorrowOutlook === "看涨").slice(0, 5);
  const bearSectors = sectors.filter(s => s.tomorrowOutlook === "看跌").slice(0, 5);

  return (
    <div className="space-y-4">
      {/* 总体展望 */}
      <div className={`rounded-xl border-2 bg-[var(--bg-card)] p-4 ${
        outlook === "看涨" ? "border-[#ef444480]" : outlook === "看跌" ? "border-[#10b98180]" : "border-[#f59e0b80]"
      }`}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🔮</span>
          <h3 className="text-sm font-bold">明日展望</h3>
          <span className="text-sm px-3 py-1 rounded-full font-bold"
            style={{ background: outlookColor[outlook] + "20", color: outlookColor[outlook] }}>
            {outlookIcon[outlook]} {outlook}
          </span>
        </div>
        <p className="text-xs text-[var(--text-primary)] leading-relaxed">{advice}</p>
      </div>

      {/* 明日关注板块 */}
      {focus.length > 0 && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
          <h3 className="text-sm font-bold mb-3">🎯 明日关注板块</h3>
          <div className="flex flex-wrap gap-2">
            {focus.map(f => {
              const sec = sectors.find(s => s.sector === f);
              return (
                <div key={f} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                  <span className="text-xs font-bold">{f}</span>
                  {sec && (
                    <>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                        style={{ background: gradeStyle[sec.grade].bg, color: gradeStyle[sec.grade].text }}>{sec.grade}</span>
                      <span className={`text-[10px] tabular-nums ${sec.changePercent >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}`}>
                        {sec.changePercent >= 0 ? "+" : ""}{sec.changePercent.toFixed(1)}%
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 看涨/看跌板块 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {bullSectors.length > 0 && (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
            <h3 className="text-sm font-bold mb-3 text-[#ef4444]">📈 明日看涨板块</h3>
            <div className="space-y-1.5">
              {bullSectors.map(sec => (
                <div key={sec.sector} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-secondary)]">
                  <span className="text-xs w-6 h-6 flex items-center justify-center rounded font-bold"
                    style={{ background: gradeStyle[sec.grade].bg, color: gradeStyle[sec.grade].text }}>{sec.grade}</span>
                  <span className="text-[11px] font-bold flex-1 truncate">{sec.sector}</span>
                  <span className="text-[10px] text-[var(--text-secondary)]">{sec.tomorrowReason.slice(0, 15)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {bearSectors.length > 0 && (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
            <h3 className="text-sm font-bold mb-3 text-[#10b981]">📉 明日看跌板块</h3>
            <div className="space-y-1.5">
              {bearSectors.map(sec => (
                <div key={sec.sector} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-secondary)]">
                  <span className="text-xs w-6 h-6 flex items-center justify-center rounded font-bold"
                    style={{ background: gradeStyle[sec.grade].bg, color: gradeStyle[sec.grade].text }}>{sec.grade}</span>
                  <span className="text-[11px] font-bold flex-1 truncate">{sec.sector}</span>
                  <span className="text-[10px] text-[var(--text-secondary)]">{sec.tomorrowReason.slice(0, 15)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
