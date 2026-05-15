/**
 * 模型盘引擎
 *
 * 规则：
 *   - 初始资金 10000 元
 *   - 最多持有 3 只场外ETF
 *   - 每周目标利润 ≥ 2.5%（250元）
 *   - 每日自动决策：建仓 / 加仓 / 减仓 / 清仓 / 持仓不动
 *   - 决策依据：量化引擎三层打分 + 趋势/动量/资金共振
 *
 * 持仓状态持久化到 JSON 文件
 */

import * as fs from "fs";
import * as path from "path";
import type { QuantDecision, QuantReport, MarketRegime } from "./quant-engine";

// ================================================================
//  类型
// ================================================================

export interface PortfolioHolding {
  code: string;
  name: string;
  sector: string;
  buyDate: string;           // 建仓日期
  buyNav: number;            // 建仓净值
  currentNav: number;        // 当前净值
  shares: number;            // 持有份额
  costAmount: number;        // 投入金额
  currentValue: number;      // 当前市值
  pnl: number;               // 浮动盈亏
  pnlPercent: number;        // 浮动盈亏%
  quantScore: number;        // 最新量化分
  holdDays: number;          // 持有天数
  action: string;            // 最新决策
  tags: string[];
  peakNav: number;           // 持仓期间最高净值（移动止损用）
  trailingStopPct: number;   // 动态止损线%（距峰值）
}

export interface TradeRecord {
  date: string;
  time: string;
  code: string;
  name: string;
  sector: string;
  type: "买入" | "卖出" | "加仓" | "减仓";
  nav: number;
  amount: number;            // 交易金额
  shares: number;            // 交易份额
  reason: string;
  quantScore: number;
}

export interface DailySnapshot {
  date: string;
  totalValue: number;
  cash: number;
  holdingValue: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  totalPnl: number;
  totalPnlPercent: number;
  holdingCount: number;
  weekPnlPercent: number;    // 本周累计收益%
}

export interface PortfolioState {
  initialCapital: number;
  cash: number;
  holdings: PortfolioHolding[];
  trades: TradeRecord[];
  snapshots: DailySnapshot[];
  lastRebalanceDate: string;
  createdAt: string;
  weekStartValue: number;    // 本周起始净值（周一记录）
  weekStartDate: string;
  // 风控状态
  peakTotalValue: number;          // 历史最高总资产
  maxDrawdownPct: number;          // 当前最大回撤%
  consecutiveLossDays: number;     // 连续亏损天数
  riskLevel: RiskLevel;            // 当前风控等级
  circuitBreakerUntil: string;     // 熔断截止日期（空=无熔断）
}

export type RiskLevel = "正常" | "警告" | "降仓" | "熔断";

export interface RebalanceResult {
  actions: RebalanceAction[];
  portfolio: PortfolioState;
  reasoning: string;
}

export interface RebalanceAction {
  type: "买入" | "卖出" | "加仓" | "减仓" | "持仓";
  code: string;
  name: string;
  sector: string;
  amount: number;
  reason: string;
  quantScore: number;
}

// ================================================================
//  持久化
// ================================================================

const DATA_DIR = path.join(process.cwd(), ".data");
const STATE_FILE = path.join(DATA_DIR, "model-portfolio.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadPortfolio(): PortfolioState {
  ensureDataDir();
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    } catch { /* fall through */ }
  }
  // 初始状态
  const now = new Date().toISOString().slice(0, 10);
  return {
    initialCapital: 10000,
    cash: 10000,
    holdings: [],
    trades: [],
    snapshots: [],
    lastRebalanceDate: "",
    createdAt: now,
    weekStartValue: 10000,
    weekStartDate: now,
    peakTotalValue: 10000,
    maxDrawdownPct: 0,
    consecutiveLossDays: 0,
    riskLevel: "正常" as RiskLevel,
    circuitBreakerUntil: "",
  };
}

export function savePortfolio(state: PortfolioState) {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

// ================================================================
//  核心决策：每日调仓
// ================================================================

const MAX_HOLDINGS = 3;
const WEEKLY_TARGET_PCT = 2.5;
const STOP_LOSS_PCT = -5;       // 单票固定止损线（兜底）
const TAKE_PROFIT_PCT = 8;      // 单票止盈线
const MIN_TRADE_AMOUNT = 100;   // 最小交易金额

// ========== 风控参数 ==========
const TRAILING_STOP_BASE = 3;      // 移动止损基础比例%（距峰值回撤X%触发）
const TRAILING_STOP_MAX = 8;       // 移动止损最大比例%
const DRAWDOWN_WARN = 3;           // 总资产回撤≥3%进入警告
const DRAWDOWN_REDUCE = 5;         // 总资产回撤≥5%进入降仓
const DRAWDOWN_CIRCUIT = 8;        // 总资产回撤≥8%触发熔断
const CIRCUIT_BREAKER_DAYS = 3;    // 熔断后暂停交易天数
const CONSECUTIVE_LOSS_THRESHOLD = 3; // 连续亏损≥3天降低仓位
const POSITION_SCALE_WARN = 0.7;   // 警告时仓位缩放系数
const POSITION_SCALE_REDUCE = 0.4; // 降仓时仓位缩放系数

interface OTCQuote {
  code: string;
  name: string;
  sector: string;
  nav: number;
  navDate: string;
  changePercent: number;       // 今日涨跌 or 估值涨跌
  isEstimated: boolean;
}

export function rebalance(
  state: PortfolioState,
  quantReport: QuantReport,
  otcQuotes: OTCQuote[],
): RebalanceResult {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const actions: RebalanceAction[] = [];
  const reasoning: string[] = [];

  // 兼容旧数据：补充新字段默认值
  if (state.peakTotalValue == null) state.peakTotalValue = state.initialCapital;
  if (state.maxDrawdownPct == null) state.maxDrawdownPct = 0;
  if (state.consecutiveLossDays == null) state.consecutiveLossDays = 0;
  if (state.riskLevel == null) state.riskLevel = "正常";
  if (state.circuitBreakerUntil == null) state.circuitBreakerUntil = "";

  // 构建快速查找
  const quoteMap = new Map(otcQuotes.map(q => [q.code, q]));
  const decisionMap = new Map(quantReport.decisions.map(d => [d.code, d]));

  // -- 更新当前持仓市值 + 峰值追踪 --
  for (const h of state.holdings) {
    // 兼容旧持仓
    if (h.peakNav == null) h.peakNav = h.buyNav;
    if (h.trailingStopPct == null) h.trailingStopPct = TRAILING_STOP_BASE;

    const quote = quoteMap.get(h.code);
    if (quote) {
      if (quote.isEstimated) {
        h.currentNav = quote.nav * (1 + quote.changePercent / 100);
      } else {
        h.currentNav = quote.nav;
      }
      h.currentValue = h.shares * h.currentNav;
      h.pnl = h.currentValue - h.costAmount;
      h.pnlPercent = h.costAmount > 0 ? (h.pnl / h.costAmount) * 100 : 0;

      // 移动止损：追踪峰值
      if (h.currentNav > h.peakNav) {
        h.peakNav = h.currentNav;
        // 盈利越多，止损线收紧（保护利润）
        if (h.pnlPercent > 5) h.trailingStopPct = Math.min(TRAILING_STOP_MAX, TRAILING_STOP_BASE + 1);
        if (h.pnlPercent > 10) h.trailingStopPct = Math.min(TRAILING_STOP_MAX, TRAILING_STOP_BASE + 2);
      }
    }
    const qd = findQuantDecision(h.code, h.sector, quantReport, decisionMap);
    h.quantScore = qd?.finalScore || 0;
    h.tags = qd?.tags || [];
    h.action = "";
    h.holdDays = daysBetween(h.buyDate, today);
  }

  const totalValue = state.cash + state.holdings.reduce((s, h) => s + h.currentValue, 0);

  // ==================== 风控引擎 ====================
  // 1. 更新峰值和回撤
  if (totalValue > state.peakTotalValue) {
    state.peakTotalValue = totalValue;
  }
  const currentDrawdown = state.peakTotalValue > 0
    ? ((state.peakTotalValue - totalValue) / state.peakTotalValue) * 100 : 0;
  state.maxDrawdownPct = Math.max(state.maxDrawdownPct, currentDrawdown);

  // 2. 更新连续亏损天数
  const prevSnapshot = state.snapshots[state.snapshots.length - 1];
  if (prevSnapshot && totalValue < prevSnapshot.totalValue) {
    state.consecutiveLossDays = (state.consecutiveLossDays || 0) + 1;
  } else {
    state.consecutiveLossDays = 0;
  }

  // 3. 判定风控等级
  let riskLevel: RiskLevel = "正常";
  // 熔断期已过则解除熔断状态
  if (state.circuitBreakerUntil && today > state.circuitBreakerUntil) {
    state.circuitBreakerUntil = "";
  }
  if (state.circuitBreakerUntil && today <= state.circuitBreakerUntil) {
    riskLevel = "熔断";
  } else if (currentDrawdown >= DRAWDOWN_CIRCUIT) {
    riskLevel = "熔断";
    // 设置熔断截止日：从今天起暂停N个交易日
    const cbDate = new Date();
    cbDate.setDate(cbDate.getDate() + CIRCUIT_BREAKER_DAYS + 2); // +2补偿周末
    state.circuitBreakerUntil = cbDate.toISOString().slice(0, 10);
    reasoning.push(`🚨 总回撤${currentDrawdown.toFixed(1)}%触发熔断，暂停交易至${state.circuitBreakerUntil}`);
  } else if (currentDrawdown >= DRAWDOWN_REDUCE || state.consecutiveLossDays >= CONSECUTIVE_LOSS_THRESHOLD + 2) {
    riskLevel = "降仓";
    reasoning.push(`⚠️ 回撤${currentDrawdown.toFixed(1)}%/连亏${state.consecutiveLossDays}天→降仓模式`);
  } else if (currentDrawdown >= DRAWDOWN_WARN || state.consecutiveLossDays >= CONSECUTIVE_LOSS_THRESHOLD) {
    riskLevel = "警告";
    reasoning.push(`⚡ 回撤${currentDrawdown.toFixed(1)}%/连亏${state.consecutiveLossDays}天→警告模式`);
  }
  state.riskLevel = riskLevel;

  // 4. 熔断模式：清仓所有持仓
  if (riskLevel === "熔断" && state.holdings.length > 0) {
    for (const h of state.holdings) {
      state.cash += h.currentValue;
      actions.push({ type: "卖出", code: h.code, name: h.name, sector: h.sector, amount: h.currentValue, reason: `熔断清仓: 回撤${currentDrawdown.toFixed(1)}%`, quantScore: h.quantScore });
      state.trades.push({
        date: today, time: now, code: h.code, name: h.name, sector: h.sector,
        type: "卖出", nav: h.currentNav, amount: h.currentValue, shares: h.shares,
        reason: `熔断清仓`, quantScore: h.quantScore,
      });
    }
    state.holdings = [];
    reasoning.push(`🚨 熔断清仓完成，全部转为现金`);
    // 熔断清仓后重置峰值起点，避免无限熔断循环
    const newTotalValue = state.cash;
    state.peakTotalValue = newTotalValue;
    state.maxDrawdownPct = 0;
    state.circuitBreakerUntil = "";
    updateSnapshot(state, today, newTotalValue);
    state.lastRebalanceDate = today;
    savePortfolio(state);
    return { actions, portfolio: state, reasoning: reasoning.join(" | ") };
  }

  // 仓位缩放系数（风控降级时减小仓位）
  const positionScale = riskLevel === "降仓" ? POSITION_SCALE_REDUCE
    : riskLevel === "警告" ? POSITION_SCALE_WARN : 1.0;

  // -- 周初记录 --
  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 1 || !state.weekStartDate || state.weekStartDate < getMondayDate(today)) {
    state.weekStartValue = totalValue;
    state.weekStartDate = getMondayDate(today);
  }
  const weekPnlPct = state.weekStartValue > 0 ? ((totalValue - state.weekStartValue) / state.weekStartValue) * 100 : 0;

  // -- Step 1: 移动止损 / 固定止损 / 止盈 --
  const toSell: string[] = [];
  for (const h of state.holdings) {
    // 移动止损：从峰值回撤超过阈值
    const drawdownFromPeak = h.peakNav > 0 ? ((h.peakNav - h.currentNav) / h.peakNav) * 100 : 0;
    if (drawdownFromPeak >= h.trailingStopPct && h.holdDays >= 1) {
      toSell.push(h.code);
      actions.push({ type: "卖出", code: h.code, name: h.name, sector: h.sector, amount: h.currentValue, reason: `移动止损: 距峰值回撤${drawdownFromPeak.toFixed(1)}%超过${h.trailingStopPct}%线`, quantScore: h.quantScore });
      reasoning.push(`🔴 ${h.name} 移动止损(峰值回撤${drawdownFromPeak.toFixed(1)}%)`);
    } else if (h.pnlPercent <= STOP_LOSS_PCT) {
      // 固定止损兜底
      toSell.push(h.code);
      actions.push({ type: "卖出", code: h.code, name: h.name, sector: h.sector, amount: h.currentValue, reason: `固定止损: 亏损${h.pnlPercent.toFixed(1)}%触及${STOP_LOSS_PCT}%线`, quantScore: h.quantScore });
      reasoning.push(`🔴 ${h.name} 固定止损(${h.pnlPercent.toFixed(1)}%)`);
    } else if (h.pnlPercent >= TAKE_PROFIT_PCT) {
      toSell.push(h.code);
      actions.push({ type: "卖出", code: h.code, name: h.name, sector: h.sector, amount: h.currentValue, reason: `止盈: 盈利${h.pnlPercent.toFixed(1)}%达到${TAKE_PROFIT_PCT}%目标`, quantScore: h.quantScore });
      reasoning.push(`🟢 ${h.name} 止盈清仓(+${h.pnlPercent.toFixed(1)}%)`);
    }
  }

  // -- Step 2: 量化信号恶化 → 减仓/清仓 --
  for (const h of state.holdings) {
    if (toSell.includes(h.code)) continue;
    if (h.quantScore < -20) {
      toSell.push(h.code);
      actions.push({ type: "卖出", code: h.code, name: h.name, sector: h.sector, amount: h.currentValue, reason: `量化分${h.quantScore}严重恶化，清仓`, quantScore: h.quantScore });
      reasoning.push(`⚠️ ${h.name} 量化恶化(${h.quantScore})清仓`);
    } else if (h.quantScore < -5 && h.holdDays >= 3) {
      const sellRatio = riskLevel === "降仓" ? 0.7 : 0.5; // 降仓模式更激进减仓
      const sellAmount = h.currentValue * sellRatio;
      if (sellAmount >= MIN_TRADE_AMOUNT) {
        actions.push({ type: "减仓", code: h.code, name: h.name, sector: h.sector, amount: sellAmount, reason: `量化分${h.quantScore}转弱+${riskLevel}模式，减${Math.round(sellRatio * 100)}%`, quantScore: h.quantScore });
        reasoning.push(`🟡 ${h.name} 减仓${Math.round(sellRatio * 100)}%(分${h.quantScore})`);
      }
    }
  }

  // 执行卖出
  for (const code of toSell) {
    const idx = state.holdings.findIndex(h => h.code === code);
    if (idx >= 0) {
      const h = state.holdings[idx];
      state.cash += h.currentValue;
      state.trades.push({
        date: today, time: now, code: h.code, name: h.name, sector: h.sector,
        type: "卖出", nav: h.currentNav, amount: h.currentValue, shares: h.shares,
        reason: actions.find(a => a.code === code && (a.type === "卖出"))?.reason || "",
        quantScore: h.quantScore,
      });
      state.holdings.splice(idx, 1);
    }
  }

  // 执行减仓
  for (const a of actions.filter(x => x.type === "减仓")) {
    const h = state.holdings.find(x => x.code === a.code);
    if (h) {
      const sellShares = a.amount / h.currentNav;
      h.shares -= sellShares;
      h.costAmount -= a.amount * (h.costAmount / (h.costAmount + h.pnl)); // 按比例减成本
      h.currentValue = h.shares * h.currentNav;
      h.pnl = h.currentValue - h.costAmount;
      state.cash += a.amount;
      state.trades.push({
        date: today, time: now, code: h.code, name: h.name, sector: h.sector,
        type: "减仓", nav: h.currentNav, amount: a.amount, shares: sellShares,
        reason: a.reason, quantScore: a.quantScore,
      });
    }
  }

  // -- Step 3: 选股 → 找最强的场外ETF（含相关性控制） --
  const holdCodes = new Set(state.holdings.map(h => h.code));
  const holdSectors = new Set(state.holdings.map(h => h.sector));
  const candidates = getCandidates(quantReport, otcQuotes, holdCodes, weekPnlPct, holdSectors);

  // -- Step 4: 计算资金分配 → 建仓 / 加仓 --
  const slotsAvailable = MAX_HOLDINGS - state.holdings.length;
  const allocatableCash = state.cash * 0.95; // 留5%现金缓冲

  if (slotsAvailable > 0 && allocatableCash >= MIN_TRADE_AMOUNT && candidates.length > 0 && riskLevel !== "降仓") {
    // 降仓模式禁止新建仓，仅允许警告/正常时建仓
    const topN = candidates.slice(0, slotsAvailable);
    const totalScore = topN.reduce((s, c) => s + Math.max(c.score, 10), 0);

    for (const c of topN) {
      const weight = Math.max(c.score, 10) / totalScore;
      let buyAmount = Math.min(allocatableCash * weight, allocatableCash / topN.length * 1.5);
      buyAmount = Math.floor(buyAmount * positionScale); // 风控缩放
      buyAmount = Math.max(MIN_TRADE_AMOUNT, buyAmount);
      if (buyAmount > state.cash - 50) buyAmount = state.cash - 50;
      if (buyAmount < MIN_TRADE_AMOUNT) continue;

      const quote = quoteMap.get(c.code);
      if (!quote) continue;

      const nav = quote.isEstimated ? quote.nav * (1 + quote.changePercent / 100) : quote.nav;
      const shares = buyAmount / nav;

      state.holdings.push({
        code: c.code, name: c.name, sector: c.sector,
        buyDate: today, buyNav: nav, currentNav: nav,
        shares, costAmount: buyAmount, currentValue: buyAmount,
        pnl: 0, pnlPercent: 0, quantScore: c.score,
        holdDays: 0, action: "买入", tags: c.tags,
        peakNav: nav, trailingStopPct: TRAILING_STOP_BASE,
      });
      state.cash -= buyAmount;
      state.trades.push({
        date: today, time: now, code: c.code, name: c.name, sector: c.sector,
        type: "买入", nav, amount: buyAmount, shares,
        reason: `${c.reason}${positionScale < 1 ? ` [风控缩放${Math.round(positionScale*100)}%]` : ""}`, quantScore: c.score,
      });
      actions.push({ type: "买入", code: c.code, name: c.name, sector: c.sector, amount: buyAmount, reason: c.reason, quantScore: c.score });
      reasoning.push(`� 买入 ${c.name} ${buyAmount.toFixed(0)}元(分${c.score}${positionScale < 1 ? `,风控${Math.round(positionScale*100)}%` : ""})`);
    }
  } else if (riskLevel === "降仓" && candidates.length > 0) {
    reasoning.push(`⛔ 降仓模式禁止新建仓，等待风控抬升`);
  }

  // -- Step 5: 已持仓标的加仓逻辑（风控模式下禁止加仓） --
  if (riskLevel === "正常" && state.holdings.length > 0 && state.holdings.length <= MAX_HOLDINGS && state.cash > MIN_TRADE_AMOUNT * 2) {
    for (const h of state.holdings) {
      if (h.quantScore >= 30 && h.pnlPercent > 0 && h.holdDays >= 1) {
        // 强信号+已盈利 → 追加
        const addAmount = Math.min(state.cash * 0.3 * positionScale, 2000);
        if (addAmount >= MIN_TRADE_AMOUNT) {
          const newShares = addAmount / h.currentNav;
          h.shares += newShares;
          h.costAmount += addAmount;
          h.currentValue = h.shares * h.currentNav;
          h.pnl = h.currentValue - h.costAmount;
          state.cash -= addAmount;
          state.trades.push({
            date: today, time: now, code: h.code, name: h.name, sector: h.sector,
            type: "加仓", nav: h.currentNav, amount: addAmount, shares: newShares,
            reason: `量化分${h.quantScore}强势+浮盈${h.pnlPercent.toFixed(1)}%追加`, quantScore: h.quantScore,
          });
          actions.push({ type: "加仓", code: h.code, name: h.name, sector: h.sector, amount: addAmount, reason: `强势追加(分${h.quantScore})`, quantScore: h.quantScore });
          reasoning.push(`🔷 加仓 ${h.name} ${addAmount.toFixed(0)}元`);
        }
      }
    }
  }

  // -- Step 6: 持仓不动的标注 --
  for (const h of state.holdings) {
    if (!actions.find(a => a.code === h.code)) {
      h.action = "持仓";
      actions.push({ type: "持仓", code: h.code, name: h.name, sector: h.sector, amount: 0, reason: `量化分${h.quantScore}，继续持有`, quantScore: h.quantScore });
    }
  }

  // -- 快照 --
  const newTotalValue = state.cash + state.holdings.reduce((s, h) => s + h.currentValue, 0);
  updateSnapshot(state, today, newTotalValue);

  state.lastRebalanceDate = today;
  savePortfolio(state);

  if (actions.filter(a => a.type !== "持仓").length === 0) {
    reasoning.push("📊 今日无操作，继续持仓观望");
  }

  return {
    actions,
    portfolio: state,
    reasoning: reasoning.join(" | ") || "今日无操作",
  };
}

// ================================================================
//  选股逻辑
// ================================================================

interface Candidate {
  code: string;
  name: string;
  sector: string;
  score: number;
  reason: string;
  tags: string[];
}

function getCandidates(
  report: QuantReport,
  otcQuotes: OTCQuote[],
  holdCodes: Set<string>,
  weekPnlPct: number,
  holdSectors?: Set<string>,
): Candidate[] {
  const otcCodes = new Set(otcQuotes.map(q => q.code));
  const quoteMap = new Map(otcQuotes.map(q => [q.code, q]));

  // 从量化报告中找场外ETF对应的场内ETF决策
  // 场外ETF和场内ETF共享sector，通过sector匹配
  const sectorBestScore = new Map<string, { score: number; decision: QuantDecision }>();
  for (const d of report.decisions) {
    const prev = sectorBestScore.get(d.sector);
    if (!prev || d.finalScore > prev.score) {
      sectorBestScore.set(d.sector, { score: d.finalScore, decision: d });
    }
  }

  const candidates: Candidate[] = [];

  for (const q of otcQuotes) {
    if (holdCodes.has(q.code)) continue;

    // 相关性控制：已持有同板块标的则跳过（避免集中度过高）
    if (holdSectors && holdSectors.has(q.sector)) continue;

    const sectorBest = sectorBestScore.get(q.sector);
    if (!sectorBest) continue;

    const d = sectorBest.decision;
    const score = d.finalScore;

    // 筛选条件
    if (score < 15) continue; // 至少轻仓试多以上

    // 周收益已达标时更严格
    if (weekPnlPct >= WEEKLY_TARGET_PCT && score < 40) continue;

    // 趋势下行时更严格
    if (report.regime === "趋势下行" && score < 30) continue;

    const reasons: string[] = [];
    if (score >= 40) reasons.push("量化强力看多");
    else if (score >= 25) reasons.push("量化看多");
    else reasons.push("量化偏多");

    if (d.matrixConsensus === "强共识") reasons.push("多策略共振");
    if (d.tags.includes("量价齐升")) reasons.push("量价齐升");
    if (d.tags.includes("强趋势")) reasons.push("强趋势");
    if (d.tags.includes("超跌反弹")) reasons.push("超跌反弹");

    candidates.push({
      code: q.code,
      name: q.name,
      sector: q.sector,
      score,
      reason: reasons.join("+"),
      tags: d.tags,
    });
  }

  // 按分数排序，同分看板块分散
  candidates.sort((a, b) => b.score - a.score);

  // 板块分散：同板块最多选1只
  const sectorUsed = new Set<string>();
  const diversified: Candidate[] = [];
  for (const c of candidates) {
    if (sectorUsed.has(c.sector)) continue;
    sectorUsed.add(c.sector);
    diversified.push(c);
  }

  return diversified.slice(0, 5);
}

function findQuantDecision(
  code: string, sector: string,
  report: QuantReport,
  decisionMap: Map<string, QuantDecision>,
): QuantDecision | undefined {
  // 直接匹配code
  if (decisionMap.has(code)) return decisionMap.get(code);
  // 同sector匹配
  return report.decisions.find(d => d.sector === sector);
}

// ================================================================
//  工具
// ================================================================

function updateSnapshot(state: PortfolioState, today: string, newTotalValue: number) {
  const prevSnap = state.snapshots[state.snapshots.length - 1];
  const prevValue = prevSnap?.totalValue || state.initialCapital;
  const dailyPnl = newTotalValue - prevValue;
  const dailyPnlPct = prevValue > 0 ? (dailyPnl / prevValue) * 100 : 0;
  const totalPnl = newTotalValue - state.initialCapital;
  const totalPnlPct = (totalPnl / state.initialCapital) * 100;
  const newWeekPnlPct = state.weekStartValue > 0 ? ((newTotalValue - state.weekStartValue) / state.weekStartValue) * 100 : 0;

  state.snapshots.push({
    date: today,
    totalValue: round2(newTotalValue),
    cash: round2(state.cash),
    holdingValue: round2(state.holdings.reduce((s, h) => s + h.currentValue, 0)),
    dailyPnl: round2(dailyPnl),
    dailyPnlPercent: round2(dailyPnlPct),
    totalPnl: round2(totalPnl),
    totalPnlPercent: round2(totalPnlPct),
    holdingCount: state.holdings.length,
    weekPnlPercent: round2(newWeekPnlPct),
  });

  // 限制快照历史60天
  if (state.snapshots.length > 60) state.snapshots = state.snapshots.slice(-60);
  // 限制交易记录200条
  if (state.trades.length > 200) state.trades = state.trades.slice(-200);
}

function daysBetween(d1: string, d2: string): number {
  const a = new Date(d1), b = new Date(d2);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

function getMondayDate(date: string): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
