"use client";

import { useState, useEffect, useCallback } from "react";
import { isTradingTime } from "@/lib/trading-hours";

// ==================== Types ====================

interface SectorMomentum {
  sector: string;
  change1d: number;
  change3d: number;
  change5d: number;
  momentum: number;
  capitalFlow: number;
  mainNetInflow: number;
  volatility: number;
  amplitude: number;
  eventScore: number;
  shortTermScore: number;
  bestETF: { code: string; name: string; changePercent: number; score: number } | null;
}

type DayAction = "重仓买入" | "加仓" | "持有" | "减仓" | "清仓" | "观望";

interface DailyPlan {
  day: string;
  date: string;
  action: DayAction;
  sector: string;
  etfCode: string;
  etfName: string;
  reason: string;
  targetGain: number;
  stopLoss: number;
  timing: string;
}

interface WeeklyStrategy {
  weekLabel: string;
  targetReturn: number;
  topSectors: SectorMomentum[];
  weeklyPlan: DailyPlan[];
  currentPhase: "启动期" | "加速期" | "高潮期" | "衰退期";
  rotationSignal: string;
  maxDrawdown: number;
  positionAdvice: string;
  summary: string;
  riskWarning: string;
  todayAction: {
    primary: { sector: string; etf: string; etfName: string; action: DayAction; reason: string };
    secondary: { sector: string; etf: string; etfName: string; action: DayAction; reason: string } | null;
  };
  otcAlerts: OTCAlert[];
  isPreClose: boolean;
  mondayForecast: MondayForecast | null;
  isNextWeekPreview: boolean;
  lastUpdated: string;
  updateMode: "实时" | "收盘后" | "下周预览";
  intradayAdjustment: string | null;
  timestamp: string;
}

interface WeekendRisk {
  event: string;
  category: string;
  impactSectors: string[];
  impact: "利空" | "利好" | "不确定";
  probability: "高" | "中" | "低";
  severity: number;
  advice: string;
}

interface MondayFundForecast {
  fundCode: string;
  fundName: string;
  sector: string;
  predictedChange: number;
  confidence: number;
  action: "周五赎回" | "周五申购" | "持有过周末" | "观望";
  reason: string;
}

interface MondayForecast {
  marketOutlook: "看涨" | "看跌" | "震荡";
  marketReason: string;
  weekendRisks: WeekendRisk[];
  fundForecasts: MondayFundForecast[];
  overallAdvice: string;
  shouldReduceBeforeWeekend: boolean;
}

type OTCAction = "申购" | "赎回" | "持有" | "观望";

interface OTCAlert {
  fundCode: string;
  fundName: string;
  sector: string;
  action: OTCAction;
  urgency: "立即" | "今日" | "关注";
  estimatedChange: number;
  change5d: number;
  sectorScore: number;
  reason: string;
  timing: string;
  amountAdvice: string;
}

// ==================== 配色 ====================

const actionStyle: Record<DayAction, { bg: string; text: string; icon: string }> = {
  "重仓买入": { bg: "#ef444420", text: "#ef4444", icon: "🔥" },
  "加仓": { bg: "#f59e0b20", text: "#f59e0b", icon: "📈" },
  "持有": { bg: "#6b728020", text: "#94a3b8", icon: "⏸️" },
  "减仓": { bg: "#3b82f620", text: "#3b82f6", icon: "📉" },
  "清仓": { bg: "#10b98120", text: "#10b981", icon: "🚨" },
  "观望": { bg: "#6b728020", text: "#94a3b8", icon: "👀" },
};

const phaseStyle: Record<string, { color: string; icon: string }> = {
  "启动期": { color: "#f59e0b", icon: "🌱" },
  "加速期": { color: "#ef4444", icon: "🚀" },
  "高潮期": { color: "#8b5cf6", icon: "🎆" },
  "衰退期": { color: "#10b981", icon: "🌧️" },
};

// ==================== 主面板 ====================

export default function WeeklyStrategyPanel() {
  const [data, setData] = useState<WeeklyStrategy | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/api/weekly-strategy");
      const json = await resp.json();
      if (!json.error) setData(json);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (isTradingTime()) load();
    }, 180000); // 3分钟刷新
    return () => clearInterval(timer);
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] animate-pulse h-40" />
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] animate-pulse h-60" />
      </div>
    );
  }

  if (!data) return <div className="card text-center py-12 text-[var(--text-secondary)]">暂无数据</div>;

  const dayOfWeek = new Date().getDay();
  const todayIdx = dayOfWeek === 0 ? -1 : dayOfWeek - 1; // -1 = 非交易日
  const ps = phaseStyle[data.currentPhase] || phaseStyle["启动期"];

  return (
    <div className="space-y-5">
      {/* 顶部策略总览 */}
      <div className="rounded-xl border-2 border-[var(--accent-blue)] bg-[var(--bg-card)] p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚡</span>
            <div>
              <h2 className="text-base font-bold">短线周策略</h2>
              <span className="text-[11px] text-[var(--text-secondary)]">{data.weekLabel} · 目标收益 {data.targetReturn.toFixed(1)}%+</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg">{ps.icon}</span>
            <span className="text-sm font-bold px-3 py-1 rounded-full" style={{ background: `${ps.color}20`, color: ps.color }}>
              {data.currentPhase}
            </span>
            <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-2">
              🔄
            </button>
          </div>
        </div>

        {/* 更新状态 */}
        <div className="flex items-center gap-2 mb-3 text-[10px]">
          <span className={`px-2 py-0.5 rounded-full font-bold ${
            data.updateMode === "实时" ? "bg-[#ef444420] text-[#ef4444] animate-pulse" :
            data.updateMode === "下周预览" ? "bg-[#8b5cf620] text-[#8b5cf6]" :
            "bg-[#3b82f620] text-[#3b82f6]"
          }`}>
            {data.updateMode === "实时" ? "🟢 盘中实时" : data.updateMode === "下周预览" ? "🔮 下周预案" : "📊 收盘后"}
          </span>
          <span className="text-[var(--text-secondary)]">更新于 {data.lastUpdated}</span>
          {data.updateMode === "实时" && <span className="text-[var(--text-secondary)]">· 每3分钟自动刷新</span>}
          {data.updateMode === "下周预览" && <span className="text-[var(--text-secondary)]">· 周一开盘后转为实时模式</span>}
          {data.updateMode === "收盘后" && <span className="text-[var(--text-secondary)]">· 明日开盘后自动更新</span>}
        </div>

        {/* 下周预览横幅 */}
        {data.isNextWeekPreview && (
          <div className="rounded-lg bg-[#8b5cf610] border border-[#8b5cf630] px-4 py-3 mb-3">
            <p className="text-xs text-[#8b5cf6] font-bold mb-1">🔮 这是下周预案</p>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              基于本周收盘数据提前生成，周一开盘后会根据实时行情自动调整。请在开盘后再次查看确认。
            </p>
          </div>
        )}

        {/* 盘中动态调整 */}
        {data.intradayAdjustment && (
          <div className="rounded-lg bg-[#ef444410] border border-[#ef444440] px-4 py-3 mb-3 animate-pulse">
            <p className="text-xs font-bold text-[#ef4444] mb-1">🚨 盘中策略调整</p>
            <p className="text-[11px] text-[var(--text-primary)] leading-relaxed">{data.intradayAdjustment}</p>
          </div>
        )}

        <p className="text-xs text-[var(--text-primary)] leading-relaxed mb-3">{data.summary}</p>

        {/* 轮动信号 */}
        <div className="rounded-lg bg-[var(--bg-secondary)] px-4 py-3 mb-3">
          <p className="text-xs text-[var(--text-primary)] leading-relaxed">{data.rotationSignal}</p>
        </div>

        {/* 仓位与风控 */}
        <div className="grid grid-cols-3 gap-3 text-center text-[11px]">
          <div className="rounded-lg bg-[var(--bg-secondary)] py-2.5">
            <div className="text-[var(--text-secondary)]">仓位建议</div>
            <div className="font-bold text-[var(--text-primary)] mt-0.5">{data.positionAdvice}</div>
          </div>
          <div className="rounded-lg bg-[var(--bg-secondary)] py-2.5">
            <div className="text-[var(--text-secondary)]">最大回撤</div>
            <div className="font-bold text-[#10b981] mt-0.5">{data.maxDrawdown}%</div>
          </div>
          <div className="rounded-lg bg-[var(--bg-secondary)] py-2.5">
            <div className="text-[var(--text-secondary)]">目标周收益</div>
            <div className="font-bold text-[#ef4444] mt-0.5">+{data.targetReturn.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {/* 今日操作推荐 */}
      <div className="rounded-xl border-2 border-[#f59e0b] bg-[var(--bg-card)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🎯</span>
          <h3 className="text-sm font-bold text-[#f59e0b]">今日操作推荐</h3>
          <span className="text-[10px] text-[var(--text-secondary)]">
            {todayIdx >= 0 ? `周${["一","二","三","四","五"][todayIdx]}` : "非交易日"}
          </span>
        </div>

        <div className="space-y-3">
          {/* 主推 */}
          <div className="rounded-lg border px-4 py-3" style={{ borderColor: `${actionStyle[data.todayAction.primary.action]?.text || "#94a3b8"}40` }}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm">{actionStyle[data.todayAction.primary.action]?.icon}</span>
              <span className="text-sm font-bold" style={{ color: actionStyle[data.todayAction.primary.action]?.text }}>
                {data.todayAction.primary.action}
              </span>
              <span className="text-xs font-bold text-[var(--text-primary)]">{data.todayAction.primary.sector}</span>
              {data.todayAction.primary.etfName && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                  {data.todayAction.primary.etfName}
                </span>
              )}
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#ef444415] text-[#ef4444] font-bold ml-auto">主推</span>
            </div>
            <p className="text-[11px] text-[var(--text-primary)] leading-relaxed">{data.todayAction.primary.reason}</p>
          </div>

          {/* 备选 */}
          {data.todayAction.secondary && (
            <div className="rounded-lg border border-[var(--border-color)] px-4 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm">{actionStyle[data.todayAction.secondary.action]?.icon}</span>
                <span className="text-sm font-bold" style={{ color: actionStyle[data.todayAction.secondary.action]?.text }}>
                  {data.todayAction.secondary.action}
                </span>
                <span className="text-xs font-bold text-[var(--text-primary)]">{data.todayAction.secondary.sector}</span>
                {data.todayAction.secondary.etfName && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                    {data.todayAction.secondary.etfName}
                  </span>
                )}
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)] font-medium ml-auto">备选</span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{data.todayAction.secondary.reason}</p>
            </div>
          )}
        </div>
      </div>

      {/* 场外ETF 3点前操作提醒 */}
      <OTCAlertSection alerts={data.otcAlerts} isPreClose={data.isPreClose} />

      {/* 周五→周一预测 */}
      {data.mondayForecast && <MondayForecastSection forecast={data.mondayForecast} />}

      {/* 本周每日计划 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">📅</span>
          <h3 className="text-sm font-bold">本周操作计划</h3>
          <span className="text-[10px] text-[var(--text-secondary)]">点击查看详情</span>
        </div>

        <div className="space-y-2">
          {data.weeklyPlan.map((plan, i) => {
            const isToday = i === todayIdx;
            const isPast = todayIdx >= 0 && i < todayIdx;
            const style = actionStyle[plan.action] || actionStyle["观望"];

            return (
              <DayPlanCard key={i} plan={plan} isToday={isToday} isPast={isPast} style={style} />
            );
          })}
        </div>
      </div>

      {/* 板块动量排行 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">📊</span>
          <h3 className="text-sm font-bold">板块短线动量排行</h3>
          <span className="text-[10px] text-[var(--text-secondary)]">动量+资金+事件综合</span>
        </div>

        <div className="space-y-2">
          {data.topSectors.map((sec, i) => (
            <div key={sec.sector} className="flex items-center gap-3 rounded-lg bg-[var(--bg-secondary)] px-3 py-2.5">
              <span className={`text-sm font-black tabular-nums w-5 ${i < 3 ? "text-[#ef4444]" : "text-[var(--text-secondary)]"}`}>
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold">{sec.sector}</span>
                  {sec.bestETF && (
                    <span className="text-[10px] text-[var(--text-secondary)] truncate">{sec.bestETF.name}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px]">
                  <span className={sec.change1d >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}>
                    今日 {sec.change1d >= 0 ? "+" : ""}{sec.change1d.toFixed(2)}%
                  </span>
                  <span className={sec.change5d >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}>
                    5日 {sec.change5d >= 0 ? "+" : ""}{sec.change5d.toFixed(2)}%
                  </span>
                  <span className={sec.mainNetInflow >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}>
                    资金 {sec.mainNetInflow >= 0 ? "+" : ""}{sec.mainNetInflow.toFixed(1)}亿
                  </span>
                </div>
              </div>
              {/* 动量条 */}
              <div className="w-20 text-right">
                <div className="text-xs font-black tabular-nums" style={{
                  color: sec.shortTermScore > 30 ? "#ef4444" : sec.shortTermScore < -30 ? "#10b981" : "#94a3b8"
                }}>
                  {sec.shortTermScore}
                </div>
                <div className="h-1.5 rounded-full bg-[#1e2d4a] mt-0.5 overflow-hidden relative">
                  <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--text-secondary)] opacity-20" />
                  {sec.shortTermScore >= 0 ? (
                    <div className="absolute top-0 bottom-0 rounded-r-full" style={{ left: "50%", width: `${Math.min(sec.shortTermScore, 100) / 100 * 50}%`, background: "#ef4444" }} />
                  ) : (
                    <div className="absolute top-0 bottom-0 rounded-l-full" style={{ right: "50%", width: `${Math.min(Math.abs(sec.shortTermScore), 100) / 100 * 50}%`, background: "#10b981" }} />
                  )}
                </div>
                <div className="text-[9px] text-[var(--text-secondary)] mt-0.5">短线分</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 风险提示 */}
      <div className="rounded-lg bg-[#f59e0b08] border border-[#f59e0b30] px-4 py-3">
        <p className="text-[11px] text-[#f59e0b] leading-relaxed">
          ⚠️ {data.riskWarning}
        </p>
        <p className="text-[10px] text-[var(--text-secondary)] mt-1">
          短线策略高风险高收益，严格执行止损纪律。本分析仅供参考，不构成投资建议。
        </p>
      </div>
    </div>
  );
}

// ==================== 每日计划卡片 ====================

function DayPlanCard({ plan, isToday, isPast, style }: {
  plan: DailyPlan; isToday: boolean; isPast: boolean;
  style: { bg: string; text: string; icon: string };
}) {
  const [expanded, setExpanded] = useState(isToday);

  return (
    <div
      className={`rounded-lg border overflow-hidden transition-colors cursor-pointer ${
        isToday ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]05" :
        isPast ? "border-[var(--border-color)] opacity-60" :
        "border-[var(--border-color)]"
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="text-center w-12 shrink-0">
          <div className={`text-xs font-bold ${isToday ? "text-[var(--accent-blue)]" : "text-[var(--text-secondary)]"}`}>
            {plan.day}
          </div>
          <div className="text-[10px] text-[var(--text-secondary)]">{plan.date}</div>
        </div>

        {isToday && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--accent-blue)] text-white font-bold">TODAY</span>}

        <span className="text-sm px-2.5 py-1 rounded font-bold" style={{ background: style.bg, color: style.text }}>
          {style.icon} {plan.action}
        </span>

        <div className="flex-1 min-w-0">
          <span className="text-xs font-bold">{plan.sector}</span>
          {plan.etfName && plan.etfName !== "空仓等待" && (
            <span className="text-[10px] text-[var(--text-secondary)] ml-2">{plan.etfName}</span>
          )}
        </div>

        {plan.targetGain > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#ef444410] text-[#ef4444] font-bold tabular-nums shrink-0">
            +{plan.targetGain.toFixed(1)}%
          </span>
        )}

        <span className="text-[10px] text-[var(--text-secondary)]">{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div className="px-4 pb-3 pt-0 border-t border-[var(--border-color)] space-y-2">
          <p className="text-[11px] text-[var(--text-primary)] leading-relaxed mt-2">{plan.reason}</p>
          <div className="flex items-center gap-4 text-[10px] text-[var(--text-secondary)]">
            <span>🕐 {plan.timing}</span>
            {plan.stopLoss !== 0 && <span className="text-[#10b981]">止损: {plan.stopLoss}%</span>}
            {plan.targetGain > 0 && <span className="text-[#ef4444]">目标: +{plan.targetGain}%</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 场外ETF操作提醒 ====================

const otcActionStyle: Record<OTCAction, { bg: string; text: string; icon: string }> = {
  "申购": { bg: "#ef444418", text: "#ef4444", icon: "🔴" },
  "赎回": { bg: "#10b98118", text: "#10b981", icon: "🟢" },
  "持有": { bg: "#6b728018", text: "#94a3b8", icon: "⏸️" },
  "观望": { bg: "#6b728010", text: "#6b7280", icon: "👀" },
};

function OTCAlertSection({ alerts, isPreClose }: { alerts: OTCAlert[]; isPreClose: boolean }) {
  const [filter, setFilter] = useState<"action" | "all">("action");
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!alerts || alerts.length === 0) return null;

  const actionAlerts = alerts.filter(a => a.action === "申购" || a.action === "赎回");
  const displayed = filter === "action" ? actionAlerts : alerts;

  return (
    <div className={`rounded-xl border-2 bg-[var(--bg-card)] p-4 ${
      isPreClose ? "border-[#ef4444] animate-pulse" : "border-[#f59e0b80]"
    }`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{isPreClose ? "🚨" : "💰"}</span>
        <h3 className={`text-sm font-bold ${isPreClose ? "text-[#ef4444]" : "text-[#f59e0b]"}`}>
          场外基金操作提醒
        </h3>
        {isPreClose && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#ef444420] text-[#ef4444] font-bold animate-pulse">
            3点前截止
          </span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button onClick={() => setFilter("action")}
            className={`text-[10px] px-2 py-0.5 rounded ${filter === "action" ? "bg-[#ef444420] text-[#ef4444] font-bold" : "text-[var(--text-secondary)]"}`}>
            需操作 ({actionAlerts.length})
          </button>
          <button onClick={() => setFilter("all")}
            className={`text-[10px] px-2 py-0.5 rounded ${filter === "all" ? "bg-[var(--accent-blue)] text-white font-bold" : "text-[var(--text-secondary)]"}`}>
            全部 ({alerts.length})
          </button>
        </div>
      </div>

      {/* 快速摘要 */}
      {actionAlerts.length > 0 && filter === "action" && (
        <div className="flex flex-wrap gap-2 mb-3">
          {actionAlerts.filter(a => a.action === "申购").length > 0 && (
            <span className="text-[10px] px-2 py-1 rounded-lg bg-[#ef444415] text-[#ef4444] font-bold">
              📈 建议申购 {actionAlerts.filter(a => a.action === "申购").length}只
            </span>
          )}
          {actionAlerts.filter(a => a.action === "赎回").length > 0 && (
            <span className="text-[10px] px-2 py-1 rounded-lg bg-[#10b98115] text-[#10b981] font-bold">
              📉 建议赎回 {actionAlerts.filter(a => a.action === "赎回").length}只
            </span>
          )}
        </div>
      )}

      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {displayed.map(alert => {
          const as = otcActionStyle[alert.action];
          const isExpanded = expanded === alert.fundCode;
          return (
            <div key={alert.fundCode}
              className="rounded-lg border border-[var(--border-color)] overflow-hidden cursor-pointer hover:border-[var(--accent-blue)] transition-colors"
              onClick={() => setExpanded(isExpanded ? null : alert.fundCode)}>
              <div className="flex items-center gap-2 px-3 py-2.5">
                {/* 紧急标记 */}
                {alert.urgency === "立即" && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#ef4444] text-white font-bold shrink-0 animate-pulse">急</span>
                )}
                {/* 操作标签 */}
                <span className="text-[10px] px-2 py-0.5 rounded font-bold shrink-0" style={{ background: as.bg, color: as.text }}>
                  {as.icon} {alert.action}
                </span>
                {/* 基金名 */}
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] font-bold truncate block">{alert.fundName}</span>
                  <span className="text-[9px] text-[var(--text-secondary)]">{alert.fundCode} · {alert.sector}</span>
                </div>
                {/* 估值 */}
                <div className="text-right shrink-0">
                  <div className={`text-[11px] font-bold tabular-nums ${alert.estimatedChange >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}`}>
                    {alert.estimatedChange >= 0 ? "+" : ""}{alert.estimatedChange.toFixed(2)}%
                  </div>
                  <div className="text-[9px] text-[var(--text-secondary)]">今日估</div>
                </div>
                <span className="text-[10px] text-[var(--text-secondary)] shrink-0">{isExpanded ? "▲" : "▼"}</span>
              </div>
              {isExpanded && (
                <div className="px-3 pb-3 pt-0 border-t border-[var(--border-color)] space-y-2">
                  <p className="text-[11px] text-[var(--text-primary)] leading-relaxed mt-2">{alert.reason}</p>
                  <div className="flex flex-wrap gap-3 text-[10px]">
                    <span className={alert.change5d >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}>
                      5日: {alert.change5d >= 0 ? "+" : ""}{alert.change5d.toFixed(2)}%
                    </span>
                    <span className="text-[var(--text-secondary)]">板块分: {alert.sectorScore}</span>
                    <span className="text-[#f59e0b]">🕐 {alert.timing}</span>
                  </div>
                  <div className="text-[10px] text-[var(--text-secondary)] bg-[var(--bg-secondary)] rounded px-2 py-1.5">
                    💰 {alert.amountAdvice}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!isPreClose && (
        <p className="text-[10px] text-[var(--text-secondary)] mt-3 pt-2 border-t border-[var(--border-color)]">
          💡 场外基金申购/赎回截止时间为交易日15:00，操作后T+1确认。盘中提醒基于同板块场内ETF走势实时估算。
        </p>
      )}
    </div>
  );
}

// ==================== 周五→周一预测 ====================

const outlookStyle: Record<string, { bg: string; text: string; icon: string }> = {
  "看涨": { bg: "#ef444418", text: "#ef4444", icon: "📈" },
  "看跌": { bg: "#10b98118", text: "#10b981", icon: "📉" },
  "震荡": { bg: "#f59e0b18", text: "#f59e0b", icon: "〰️" },
};

const mondayActionStyle: Record<string, { bg: string; text: string; icon: string }> = {
  "周五赎回": { bg: "#10b98118", text: "#10b981", icon: "🏃" },
  "周五申购": { bg: "#ef444418", text: "#ef4444", icon: "💰" },
  "持有过周末": { bg: "#6b728018", text: "#94a3b8", icon: "🛌" },
  "观望": { bg: "#6b728010", text: "#6b7280", icon: "👀" },
};

const probStyle: Record<string, string> = { "高": "#ef4444", "中": "#f59e0b", "低": "#94a3b8" };

function MondayForecastSection({ forecast }: { forecast: MondayForecast }) {
  const [showAllFunds, setShowAllFunds] = useState(false);
  const [expandedFund, setExpandedFund] = useState<string | null>(null);

  const os = outlookStyle[forecast.marketOutlook] || outlookStyle["震荡"];
  const actionFunds = forecast.fundForecasts.filter(f => f.action === "周五赎回" || f.action === "周五申购");
  const displayFunds = showAllFunds ? forecast.fundForecasts : actionFunds;

  return (
    <div className={`rounded-xl border-2 bg-[var(--bg-card)] p-4 ${
      forecast.shouldReduceBeforeWeekend ? "border-[#ef4444]" : "border-[#8b5cf680]"
    }`}>
      {/* 标题 */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🔮</span>
        <h3 className="text-sm font-bold text-[#8b5cf6]">周一预测</h3>
        <span className="text-sm px-2.5 py-0.5 rounded-full font-bold" style={{ background: os.bg, color: os.text }}>
          {os.icon} {forecast.marketOutlook}
        </span>
        {forecast.shouldReduceBeforeWeekend && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#ef444420] text-[#ef4444] font-bold animate-pulse ml-auto">
            ⚠️ 建议减仓过周末
          </span>
        )}
      </div>

      {/* 总体建议 */}
      <div className={`rounded-lg px-4 py-3 mb-3 ${
        forecast.shouldReduceBeforeWeekend ? "bg-[#ef444410] border border-[#ef444430]" : "bg-[var(--bg-secondary)]"
      }`}>
        <p className={`text-xs leading-relaxed font-medium ${
          forecast.shouldReduceBeforeWeekend ? "text-[#ef4444]" : "text-[var(--text-primary)]"
        }`}>{forecast.overallAdvice}</p>
        <p className="text-[10px] text-[var(--text-secondary)] mt-1 leading-relaxed">{forecast.marketReason}</p>
      </div>

      {/* 周末风险/利好事件 */}
      {forecast.weekendRisks.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-bold text-[var(--text-primary)] mb-2">📋 周末关注事件</div>
          <div className="space-y-1.5">
            {forecast.weekendRisks.map((risk, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg bg-[var(--bg-secondary)] px-3 py-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 mt-0.5 ${
                  risk.impact === "利空" ? "bg-[#10b98120] text-[#10b981]"
                  : risk.impact === "利好" ? "bg-[#ef444420] text-[#ef4444]"
                  : "bg-[#f59e0b20] text-[#f59e0b]"
                }`}>
                  {risk.impact}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-[var(--text-primary)] leading-snug">{risk.event}</p>
                  <div className="flex items-center gap-2 mt-1 text-[9px] text-[var(--text-secondary)]">
                    <span>{risk.category}</span>
                    <span style={{ color: probStyle[risk.probability] }}>概率: {risk.probability}</span>
                    <span>影响: {risk.impactSectors.slice(0, 3).join("/")}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-bold" style={{ color: probStyle[risk.probability] }}>
                    {risk.severity}/10
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 场外基金周一预测 */}
      <div className="mb-2">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-bold text-[var(--text-primary)]">💰 场外基金周一预测</span>
          <div className="flex-1" />
          <button onClick={() => setShowAllFunds(false)}
            className={`text-[10px] px-2 py-0.5 rounded ${!showAllFunds ? "bg-[#ef444420] text-[#ef4444] font-bold" : "text-[var(--text-secondary)]"}`}>
            需操作 ({actionFunds.length})
          </button>
          <button onClick={() => setShowAllFunds(true)}
            className={`text-[10px] px-2 py-0.5 rounded ${showAllFunds ? "bg-[var(--accent-blue)] text-white font-bold" : "text-[var(--text-secondary)]"}`}>
            全部 ({forecast.fundForecasts.length})
          </button>
        </div>

        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
          {displayFunds.map(fund => {
            const ms = mondayActionStyle[fund.action] || mondayActionStyle["观望"];
            const isExp = expandedFund === fund.fundCode;
            return (
              <div key={fund.fundCode}
                className="rounded-lg border border-[var(--border-color)] overflow-hidden cursor-pointer hover:border-[var(--accent-blue)] transition-colors"
                onClick={() => setExpandedFund(isExp ? null : fund.fundCode)}>
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="text-[10px] px-2 py-0.5 rounded font-bold shrink-0" style={{ background: ms.bg, color: ms.text }}>
                    {ms.icon} {fund.action}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] font-bold truncate block">{fund.fundName}</span>
                    <span className="text-[9px] text-[var(--text-secondary)]">{fund.fundCode} · {fund.sector}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-[11px] font-bold tabular-nums ${fund.predictedChange >= 0 ? "text-[#ef4444]" : "text-[#10b981]"}`}>
                      {fund.predictedChange >= 0 ? "+" : ""}{fund.predictedChange.toFixed(2)}%
                    </div>
                    <div className="text-[9px] text-[var(--text-secondary)]">预测涨跌</div>
                  </div>
                  <div className="shrink-0">
                    <div className="text-[10px] font-bold tabular-nums text-[var(--text-secondary)]">{fund.confidence}%</div>
                    <div className="text-[9px] text-[var(--text-secondary)]">置信度</div>
                  </div>
                  <span className="text-[10px] text-[var(--text-secondary)] shrink-0">{isExp ? "▲" : "▼"}</span>
                </div>
                {isExp && (
                  <div className="px-3 pb-2.5 pt-0 border-t border-[var(--border-color)]">
                    <p className="text-[11px] text-[var(--text-primary)] leading-relaxed mt-2">{fund.reason}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[10px] text-[var(--text-secondary)] mt-2 pt-2 border-t border-[var(--border-color)]">
        💡 预测基于本周走势、新闻事件及板块动量综合分析。周末若有重大突发事件，周一开盘后请立即查看实时策略。
      </p>
    </div>
  );
}
