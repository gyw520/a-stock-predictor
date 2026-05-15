/**
 * 场内ETF模拟盘引擎
 *
 * 与场外模拟盘的核心差异：
 *   - 实时价格成交（非净值申购赎回）
 *   - T+1：当日买入次日才能卖出
 *   - 佣金：万0.5（单笔最低5元）
 *   - 滑点：0.05%
 *   - 做T策略：正T（高卖明低接）/ 反T（低买明高卖），多档网格，自动接回
 *   - 交易单位：100股整手
 *   - 初始资金 50,000 元
 *   - 最多持有 5 只
 */

import * as fs from "fs";
import * as path from "path";
import { kvLoad, kvSave } from "./kv-store";
import type { QuantDecision, QuantReport } from "./quant-engine";
import { loadCurrentThresholds } from "./param-feedback";

// ================================================================
//  类型
// ================================================================

export interface OnMarketHolding {
  code: string;
  name: string;
  sector: string;
  buyDate: string;
  buyPrice: number;          // 成交均价
  currentPrice: number;
  shares: number;            // 持有股数（100整数倍）
  costAmount: number;        // 含佣金的总成本
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  quantScore: number;
  holdDays: number;
  action: string;
  tags: string[];
  peakPrice: number;
  trailingStopPct: number;
  canSellToday: boolean;     // T+1: 今日是否可卖
}

export interface OnMarketTrade {
  date: string;
  time: string;
  code: string;
  name: string;
  sector: string;
  type: "买入" | "卖出" | "加仓" | "减仓";
  price: number;             // 成交价
  shares: number;
  amount: number;            // 成交金额
  commission: number;        // 佣金
  slippage: number;          // 滑点成本
  totalCost: number;         // 总成本 = amount + commission + slippage
  reason: string;
  quantScore: number;
}

export interface OnMarketSnapshot {
  date: string;
  totalValue: number;
  cash: number;
  holdingValue: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  totalPnl: number;
  totalPnlPercent: number;
  holdingCount: number;
  weekPnlPercent: number;
}

export type RiskLevel = "正常" | "警告" | "降仓" | "熔断";

// 做T待执行第二腿订单
export interface PendingTOrder {
  code: string;
  name: string;
  sector: string;
  type: "正T接回" | "反T卖出";  // 正T: 昨天卖了今天接回; 反T: 昨天买了今天卖旧仓
  triggerDate: string;           // 做T触发日期
  triggerPrice: number;          // 触发时价格
  targetShares: number;          // 目标股数
  targetPrice: number;           // 目标价格（正T接回价 / 反T卖出价）
  maxPrice: number;              // 最高接受价（正T）/ 最低接受价（反T）
  expireDays: number;            // 过期天数（默认2天）
  status: "待执行" | "已执行" | "已过期";
  quantScore: number;
}

export interface OnMarketState {
  initialCapital: number;
  cash: number;
  holdings: OnMarketHolding[];
  trades: OnMarketTrade[];
  snapshots: OnMarketSnapshot[];
  lastRebalanceDate: string;
  createdAt: string;
  weekStartValue: number;
  weekStartDate: string;
  // 风控
  peakTotalValue: number;
  maxDrawdownPct: number;
  consecutiveLossDays: number;
  riskLevel: RiskLevel;
  circuitBreakerUntil: string;
  // 统计
  totalCommission: number;    // 累计佣金
  totalSlippage: number;      // 累计滑点
  // 做T待执行队列
  pendingTOrders: PendingTOrder[];
  // 做T统计
  tStats?: {
    totalCount: number;       // 做T总次数
    winCount: number;         // 做T盈利次数
    totalProfit: number;      // 做T累计收益
    consecutiveLoss: number;  // 做T连续亏损次数
    lastTDate: string;        // 上次做T日期
  };
  tPausedUntil?: string;       // 做T暂停至日期（连亏后自动暂停）
}

export interface OnMarketRebalanceResult {
  actions: OnMarketAction[];
  portfolio: OnMarketState;
  reasoning: string;
}

export interface OnMarketAction {
  type: "买入" | "卖出" | "加仓" | "减仓" | "持仓";
  code: string;
  name: string;
  sector: string;
  shares: number;
  amount: number;
  reason: string;
  quantScore: number;
}

// ================================================================
//  交易参数
// ================================================================

const INITIAL_CAPITAL = 10000;
const MAX_HOLDINGS = 2;
const WEEKLY_TARGET_PCT = 2.5;   // 周目标提高到2.5%
const STOP_LOSS_PCT = -5;
const TAKE_PROFIT_PCT = 8;       // 降低止盈→更快落袋
const MIN_TRADE_AMOUNT = 2000;    // 最小交易2000（1万本金适配）
const CASH_RESERVE_PCT = 0.20;   // 降至20%→更多资金参与
const LOT_SIZE = 100;             // 场内ETF最小交易100股

// 交易费用（按真实费率）
const COMMISSION_RATE = 0.00005;  // 万0.5
const MIN_COMMISSION = 5;         // 最低佣金5元
const SLIPPAGE_RATE = 0.0005;     // 0.05% 滑点（场内ETF流动性好）

// 风控
const TRAILING_STOP_BASE = 3;
const TRAILING_STOP_MAX = 8;
const DRAWDOWN_WARN = 3;
const DRAWDOWN_REDUCE = 5;
const DRAWDOWN_CIRCUIT = 8;
const CIRCUIT_BREAKER_DAYS = 3;
const CONSECUTIVE_LOSS_THRESHOLD = 3;
const POSITION_SCALE_WARN = 0.7;
const POSITION_SCALE_REDUCE = 0.4;

// ================================================================
//  费用计算
// ================================================================

function calcCommission(amount: number): number {
  return Math.max(MIN_COMMISSION, amount * COMMISSION_RATE);
}

function calcSlippage(amount: number): number {
  return amount * SLIPPAGE_RATE;
}

function calcBuyShares(cash: number, price: number): number {
  // 扣除佣金和滑点后能买的最大整手数
  const effectivePrice = price * (1 + SLIPPAGE_RATE);
  const maxAmount = cash / (1 + COMMISSION_RATE + SLIPPAGE_RATE);
  const maxShares = Math.floor(maxAmount / effectivePrice / LOT_SIZE) * LOT_SIZE;
  return Math.max(0, maxShares);
}

// ================================================================
//  持久化
// ================================================================

function defaultOnMarketState(): OnMarketState {
  const now = new Date().toISOString().slice(0, 10);
  return {
    initialCapital: INITIAL_CAPITAL,
    cash: INITIAL_CAPITAL,
    holdings: [],
    trades: [],
    snapshots: [],
    lastRebalanceDate: "",
    createdAt: now,
    weekStartValue: INITIAL_CAPITAL,
    weekStartDate: now,
    peakTotalValue: INITIAL_CAPITAL,
    maxDrawdownPct: 0,
    consecutiveLossDays: 0,
    riskLevel: "正常" as RiskLevel,
    circuitBreakerUntil: "",
    totalCommission: 0,
    totalSlippage: 0,
    pendingTOrders: [],
  };
}

export async function loadOnMarketPortfolio(): Promise<OnMarketState> {
  return kvLoad("onmarket-portfolio", defaultOnMarketState());
}

export async function saveOnMarketPortfolio(state: OnMarketState): Promise<void> {
  return kvSave("onmarket-portfolio", state);
}

// ================================================================
//  场内报价接口
// ================================================================

export interface OnMarketQuote {
  code: string;
  name: string;
  sector: string;
  price: number;
  changePercent: number;
  mainNetInflow?: number;    // 主力净流入(万)
  sectorChange?: number;     // 板块整体涨跌%
  northboundBuy?: boolean;   // 北向资金是否净买入
  amplitude?: number;        // 今日振幅%
  change5d?: number;         // 5日涨跌%
}

// ================================================================
//  核心调仓
// ================================================================

export async function onMarketRebalance(
  state: OnMarketState,
  quantReport: QuantReport,
  quotes: OnMarketQuote[],
): Promise<OnMarketRebalanceResult> {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const actions: OnMarketAction[] = [];
  const reasoning: string[] = [];

  // 兼容旧数据
  if (state.peakTotalValue == null) state.peakTotalValue = state.initialCapital;
  if (state.maxDrawdownPct == null) state.maxDrawdownPct = 0;
  if (state.consecutiveLossDays == null) state.consecutiveLossDays = 0;
  if (state.riskLevel == null) state.riskLevel = "正常";
  if (state.circuitBreakerUntil == null) state.circuitBreakerUntil = "";
  if (state.totalCommission == null) state.totalCommission = 0;
  if (state.totalSlippage == null) state.totalSlippage = 0;

  const quoteMap = new Map(quotes.map(q => [q.code, q]));
  const decisionMap = new Map(quantReport.decisions.map(d => [d.code, d]));

  // -- 更新持仓市值 + T+1判定 --
  for (const h of state.holdings) {
    if (h.peakPrice == null) h.peakPrice = h.buyPrice;
    if (h.trailingStopPct == null) h.trailingStopPct = TRAILING_STOP_BASE;

    const quote = quoteMap.get(h.code);
    if (quote) {
      h.currentPrice = quote.price;
      h.currentValue = h.shares * h.currentPrice;
      h.pnl = h.currentValue - h.costAmount;
      h.pnlPercent = h.costAmount > 0 ? (h.pnl / h.costAmount) * 100 : 0;

      // 移动止损追踪
      if (h.currentPrice > h.peakPrice) {
        h.peakPrice = h.currentPrice;
        if (h.pnlPercent > 5) h.trailingStopPct = Math.min(TRAILING_STOP_MAX, TRAILING_STOP_BASE + 1);
        if (h.pnlPercent > 10) h.trailingStopPct = Math.min(TRAILING_STOP_MAX, TRAILING_STOP_BASE + 2);
      }
    }

    // 普通行业ETF为T+1，当日买入次日方可卖出
    h.canSellToday = h.buyDate < today;
    h.holdDays = daysBetween(h.buyDate, today);

    const qd = decisionMap.get(h.code) || quantReport.decisions.find(d => d.sector === h.sector);
    h.quantScore = qd?.finalScore || 0;
    h.tags = qd?.tags || [];
    h.action = "";
  }

  const totalValue = state.cash + state.holdings.reduce((s, h) => s + h.currentValue, 0);

  // ==================== 风控引擎 ====================
  if (totalValue > state.peakTotalValue) state.peakTotalValue = totalValue;
  const currentDrawdown = state.peakTotalValue > 0
    ? ((state.peakTotalValue - totalValue) / state.peakTotalValue) * 100 : 0;
  state.maxDrawdownPct = Math.max(state.maxDrawdownPct, currentDrawdown);

  const prevSnapshot = state.snapshots[state.snapshots.length - 1];
  if (prevSnapshot && totalValue < prevSnapshot.totalValue) {
    state.consecutiveLossDays = (state.consecutiveLossDays || 0) + 1;
  } else {
    state.consecutiveLossDays = 0;
  }

  let riskLevel: RiskLevel = "正常";
  // 熔断期已过则解除熔断状态
  if (state.circuitBreakerUntil && today > state.circuitBreakerUntil) {
    state.circuitBreakerUntil = "";
  }
  if (state.circuitBreakerUntil && today <= state.circuitBreakerUntil) {
    riskLevel = "熔断";
  } else if (currentDrawdown >= DRAWDOWN_CIRCUIT) {
    riskLevel = "熔断";
    const cbDate = new Date();
    cbDate.setDate(cbDate.getDate() + CIRCUIT_BREAKER_DAYS + 2);
    state.circuitBreakerUntil = cbDate.toISOString().slice(0, 10);
    reasoning.push(`🚨 总回撤${currentDrawdown.toFixed(1)}%触发熔断`);
  } else if (currentDrawdown >= DRAWDOWN_REDUCE || state.consecutiveLossDays >= CONSECUTIVE_LOSS_THRESHOLD + 2) {
    riskLevel = "降仓";
    reasoning.push(`⚠️ 回撤${currentDrawdown.toFixed(1)}%→降仓`);
  } else if (currentDrawdown >= DRAWDOWN_WARN || state.consecutiveLossDays >= CONSECUTIVE_LOSS_THRESHOLD) {
    riskLevel = "警告";
    reasoning.push(`⚡ 回撤${currentDrawdown.toFixed(1)}%→警告`);
  }
  state.riskLevel = riskLevel;

  // 熔断清仓
  if (riskLevel === "熔断") {
    for (const h of state.holdings) {
      if (!h.canSellToday) continue; // T+1 今日买入不可卖
      const sellAmount = h.shares * h.currentPrice;
      const commission = calcCommission(sellAmount);
      const slippage = calcSlippage(sellAmount);
      state.cash += sellAmount - commission - slippage;
      state.totalCommission += commission;
      state.totalSlippage += slippage;
      actions.push({ type: "卖出", code: h.code, name: h.name, sector: h.sector, shares: h.shares, amount: sellAmount, reason: `熔断清仓`, quantScore: h.quantScore });
      state.trades.push({
        date: today, time: now, code: h.code, name: h.name, sector: h.sector,
        type: "卖出", price: h.currentPrice, shares: h.shares, amount: sellAmount,
        commission, slippage, totalCost: commission + slippage,
        reason: `熔断清仓`, quantScore: h.quantScore,
      });
    }
    state.holdings = state.holdings.filter(h => !h.canSellToday); // T+1的今日新买留着
    const newTV = state.cash + state.holdings.reduce((s, h) => s + h.currentValue, 0);
    // 熔断清仓后重置峰值起点，避免无限熔断循环
    state.peakTotalValue = newTV;
    state.maxDrawdownPct = 0;
    state.circuitBreakerUntil = "";
    updateOnMarketSnapshot(state, today, newTV);
    state.lastRebalanceDate = today;
    saveOnMarketPortfolio(state);
    return { actions, portfolio: state, reasoning: reasoning.join(" | ") };
  }

  const positionScale = riskLevel === "降仓" ? POSITION_SCALE_REDUCE
    : riskLevel === "警告" ? POSITION_SCALE_WARN : 1.0;

  // 周初记录
  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 1 || !state.weekStartDate || state.weekStartDate < getMondayDate(today)) {
    state.weekStartValue = totalValue;
    state.weekStartDate = getMondayDate(today);
  }
  const weekPnlPct = state.weekStartValue > 0 ? ((totalValue - state.weekStartValue) / state.weekStartValue) * 100 : 0;

  // -- Step 1: 止损/止盈（仅限T+1可卖标的，自适应参数） --
  const adaptiveThresholds = await loadCurrentThresholds();
  const adaptiveStopLoss = -(adaptiveThresholds.stopLossPct);
  const adaptiveTakeProfit = adaptiveThresholds.takeProfitPct;
  const toSell: string[] = [];
  for (const h of state.holdings) {
    if (!h.canSellToday) continue; // T+1限制
    const drawdownFromPeak = h.peakPrice > 0 ? ((h.peakPrice - h.currentPrice) / h.peakPrice) * 100 : 0;
    if (drawdownFromPeak >= h.trailingStopPct && h.holdDays >= 1) {
      toSell.push(h.code);
      actions.push({ type: "卖出", code: h.code, name: h.name, sector: h.sector, shares: h.shares, amount: h.currentValue, reason: `移动止损: 距峰值回撤${drawdownFromPeak.toFixed(1)}%`, quantScore: h.quantScore });
      reasoning.push(`🔴 ${h.name} 移动止损(${drawdownFromPeak.toFixed(1)}%)`);
    } else if (h.pnlPercent <= adaptiveStopLoss) {
      toSell.push(h.code);
      actions.push({ type: "卖出", code: h.code, name: h.name, sector: h.sector, shares: h.shares, amount: h.currentValue, reason: `固定止损: 亏${h.pnlPercent.toFixed(1)}%`, quantScore: h.quantScore });
      reasoning.push(`🔴 ${h.name} 止损(${h.pnlPercent.toFixed(1)}%)`);
    } else if (h.pnlPercent >= adaptiveTakeProfit) {
      toSell.push(h.code);
      actions.push({ type: "卖出", code: h.code, name: h.name, sector: h.sector, shares: h.shares, amount: h.currentValue, reason: `止盈: +${h.pnlPercent.toFixed(1)}%`, quantScore: h.quantScore });
      reasoning.push(`🟢 ${h.name} 止盈(+${h.pnlPercent.toFixed(1)}%)`);
    }
  }

  // -- Step 2: 量化恶化 --
  for (const h of state.holdings) {
    if (toSell.includes(h.code) || !h.canSellToday) continue;
    if (h.quantScore < -20) {
      toSell.push(h.code);
      actions.push({ type: "卖出", code: h.code, name: h.name, sector: h.sector, shares: h.shares, amount: h.currentValue, reason: `量化恶化(${h.quantScore})`, quantScore: h.quantScore });
      reasoning.push(`⚠️ ${h.name} 量化恶化清仓`);
    } else if (h.quantScore < -5 && h.holdDays >= 3) {
      const sellRatio = riskLevel === "降仓" ? 0.7 : 0.5;
      const sellShares = Math.floor(h.shares * sellRatio / LOT_SIZE) * LOT_SIZE;
      if (sellShares >= LOT_SIZE) {
        const sellAmount = sellShares * h.currentPrice;
        actions.push({ type: "减仓", code: h.code, name: h.name, sector: h.sector, shares: sellShares, amount: sellAmount, reason: `量化转弱(${h.quantScore})减${Math.round(sellRatio*100)}%`, quantScore: h.quantScore });
        reasoning.push(`🟡 ${h.name} 减仓${sellShares}股`);
      }
    }
  }

  // 执行卖出
  for (const code of toSell) {
    const idx = state.holdings.findIndex(h => h.code === code);
    if (idx >= 0) {
      const h = state.holdings[idx];
      const sellAmount = h.shares * h.currentPrice;
      const commission = calcCommission(sellAmount);
      const slippage = calcSlippage(sellAmount);
      state.cash += sellAmount - commission - slippage;
      state.totalCommission += commission;
      state.totalSlippage += slippage;
      state.trades.push({
        date: today, time: now, code: h.code, name: h.name, sector: h.sector,
        type: "卖出", price: h.currentPrice, shares: h.shares, amount: sellAmount,
        commission, slippage, totalCost: commission + slippage,
        reason: actions.find(a => a.code === code && a.type === "卖出")?.reason || "",
        quantScore: h.quantScore,
      });
      state.holdings.splice(idx, 1);
    }
  }

  // 执行减仓
  for (const a of actions.filter(x => x.type === "减仓")) {
    const h = state.holdings.find(x => x.code === a.code);
    if (h) {
      const sellAmount = a.shares * h.currentPrice;
      const commission = calcCommission(sellAmount);
      const slippage = calcSlippage(sellAmount);
      const costRatio = a.shares / (h.shares + a.shares); // 减仓前的占比
      h.shares -= a.shares;
      h.costAmount -= h.costAmount * costRatio;
      h.currentValue = h.shares * h.currentPrice;
      h.pnl = h.currentValue - h.costAmount;
      state.cash += sellAmount - commission - slippage;
      state.totalCommission += commission;
      state.totalSlippage += slippage;
      state.trades.push({
        date: today, time: now, code: h.code, name: h.name, sector: h.sector,
        type: "减仓", price: h.currentPrice, shares: a.shares, amount: sellAmount,
        commission, slippage, totalCost: commission + slippage,
        reason: a.reason, quantScore: a.quantScore,
      });
    }
  }

  // -- Step 3: 选股建仓 --
  const holdCodes = new Set(state.holdings.map(h => h.code));
  const holdSectors = new Set(state.holdings.map(h => h.sector));
  const candidates = await getOnMarketCandidates(quantReport, quotes, holdCodes, weekPnlPct, holdSectors);

  const slotsAvailable = MAX_HOLDINGS - state.holdings.length;
  // 留30%现金作为补仓弹药
  const reserveCash = state.initialCapital * CASH_RESERVE_PCT;
  const allocatableCash = Math.max(0, state.cash - reserveCash) * 0.95;

  if (slotsAvailable > 0 && allocatableCash >= MIN_TRADE_AMOUNT && candidates.length > 0 && riskLevel !== "降仓") {
    // 集中火力：只选最强的1-2个
    const topN = candidates.slice(0, Math.min(slotsAvailable, 1)); // 一次最多买1只，精选
    const totalScore = topN.reduce((s, c) => s + Math.max(c.score, 10), 0);

    for (const c of topN) {
      const quote = quoteMap.get(c.code);
      if (!quote || quote.price <= 0) continue;

      // 集中仓位：单票最多用可分配资金的70%
      const weight = Math.max(c.score, 10) / totalScore;
      let budgetAmount = Math.min(allocatableCash * weight * 0.7, allocatableCash);
      budgetAmount = budgetAmount * positionScale;

      const buyShares = calcBuyShares(budgetAmount, quote.price);
      if (buyShares < LOT_SIZE) continue;

      const execPrice = quote.price * (1 + SLIPPAGE_RATE); // 买入滑点上移
      const amount = buyShares * execPrice;
      const commission = calcCommission(amount);
      const slippageCost = calcSlippage(buyShares * quote.price);
      const totalCost = amount + commission;

      if (totalCost > state.cash - 200) continue; // 留200缓冲

      state.holdings.push({
        code: c.code, name: c.name, sector: c.sector,
        buyDate: today, buyPrice: execPrice, currentPrice: quote.price,
        shares: buyShares, costAmount: totalCost,
        currentValue: buyShares * quote.price,
        pnl: -commission - slippageCost, pnlPercent: 0,
        quantScore: c.score, holdDays: 0, action: "买入", tags: c.tags,
        peakPrice: quote.price, trailingStopPct: TRAILING_STOP_BASE,
        canSellToday: false, // T+1: 当日买入次日才能卖
      });
      state.cash -= totalCost;
      state.totalCommission += commission;
      state.totalSlippage += slippageCost;

      state.trades.push({
        date: today, time: now, code: c.code, name: c.name, sector: c.sector,
        type: "买入", price: execPrice, shares: buyShares, amount,
        commission, slippage: slippageCost, totalCost,
        reason: c.reason + (positionScale < 1 ? ` [风控${Math.round(positionScale*100)}%]` : ""),
        quantScore: c.score,
      });
      actions.push({ type: "买入", code: c.code, name: c.name, sector: c.sector, shares: buyShares, amount, reason: c.reason, quantScore: c.score });
      reasoning.push(`🟢 买入 ${c.name} ${buyShares}股 ¥${amount.toFixed(0)}(佣金¥${commission.toFixed(2)})`);
    }
  }

  // -- Step 4: 补仓/加仓（用预留的30%现金） --
  // 策略：量化分高+已持有→趋势确认后大胆加仓，用好预留弹药
  if (riskLevel === "正常" && state.holdings.length > 0 && state.cash > MIN_TRADE_AMOUNT) {
    for (const h of state.holdings) {
      if (h.quantScore >= 25 && h.pnlPercent > -2 && h.holdDays >= 1) {
        const quote = quoteMap.get(h.code);
        if (!quote || quote.price <= 0) continue;
        // 预留资金的50%用于单次补仓
        const addBudget = Math.min(state.cash * 0.5 * positionScale, state.cash - 500);
        const addShares = calcBuyShares(addBudget, quote.price);
        if (addShares < LOT_SIZE) continue;

        const execPrice = quote.price * (1 + SLIPPAGE_RATE);
        const amount = addShares * execPrice;
        const commission = calcCommission(amount);
        const slippageCost = calcSlippage(addShares * quote.price);
        const totalCost = amount + commission;
        if (totalCost > state.cash - 200) continue;

        h.shares += addShares;
        h.costAmount += totalCost;
        h.currentValue = h.shares * h.currentPrice;
        h.pnl = h.currentValue - h.costAmount;
        state.cash -= totalCost;
        state.totalCommission += commission;
        state.totalSlippage += slippageCost;

        state.trades.push({
          date: today, time: now, code: h.code, name: h.name, sector: h.sector,
          type: "加仓", price: execPrice, shares: addShares, amount,
          commission, slippage: slippageCost, totalCost,
          reason: `强势追加(分${h.quantScore}+盈${h.pnlPercent.toFixed(1)}%)`, quantScore: h.quantScore,
        });
        actions.push({ type: "加仓", code: h.code, name: h.name, sector: h.sector, shares: addShares, amount, reason: `强势加仓`, quantScore: h.quantScore });
        reasoning.push(`🔷 加仓 ${h.name} ${addShares}股`);
      }
    }
  }

  // -- Step 5: 持仓标注 --
  for (const h of state.holdings) {
    if (!actions.find(a => a.code === h.code)) {
      h.action = "持仓";
      actions.push({ type: "持仓", code: h.code, name: h.name, sector: h.sector, shares: 0, amount: 0, reason: `分${h.quantScore}持仓${h.canSellToday ? "" : "(T+1锁定)"}`, quantScore: h.quantScore });
    }
  }

  // -- 快照 --
  const newTV = state.cash + state.holdings.reduce((s, h) => s + h.currentValue, 0);
  updateOnMarketSnapshot(state, today, newTV);
  state.lastRebalanceDate = today;
  saveOnMarketPortfolio(state);

  if (actions.filter(a => a.type !== "持仓").length === 0) {
    reasoning.push("📊 今日无操作");
  }

  return { actions, portfolio: state, reasoning: reasoning.join(" | ") || "今日无操作" };
}

// ================================================================
//  选股
// ================================================================

interface OnMarketCandidate {
  code: string;
  name: string;
  sector: string;
  score: number;
  reason: string;
  tags: string[];
}

async function getOnMarketCandidates(
  report: QuantReport,
  quotes: OnMarketQuote[],
  holdCodes: Set<string>,
  weekPnlPct: number,
  holdSectors: Set<string>,
): Promise<OnMarketCandidate[]> {
  const quoteMap = new Map(quotes.map(q => [q.code, q]));
  const candidates: OnMarketCandidate[] = [];

  // 自适应参数：从Walk-Forward反馈中加载
  const thresholds = await loadCurrentThresholds();
  const adaptiveBuyThreshold = thresholds.buyScoreThreshold;

  for (const d of report.decisions) {
    if (holdCodes.has(d.code)) continue;
    if (holdSectors.has(d.sector)) continue;
    if (!quoteMap.has(d.code)) continue;

    const score = d.finalScore;
    // 降低门槛：从25分降到20分，增加交易机会
    const minScore = Math.max(20, adaptiveBuyThreshold);
    if (score < minScore) continue;
    if (weekPnlPct >= WEEKLY_TARGET_PCT && score < 40) continue;
    if (report.regime === "趋势下行" && score < 35) continue;
    // 必须有多策略共识，不买分歧票
    if (d.matrixConsensus === "分歧") continue;

    const reasons: string[] = [];
    if (score >= 40) reasons.push("量化强力看多");
    else if (score >= 30) reasons.push("量化看多");
    else reasons.push("量化偏多");
    if (d.matrixConsensus === "强共识") reasons.push("多策略共振");
    if (d.tags.includes("量价齐升")) reasons.push("量价齐升");
    if (d.tags.includes("强趋势")) reasons.push("强趋势");

    candidates.push({ code: d.code, name: d.name, sector: d.sector, score, reason: reasons.join("+"), tags: d.tags });
  }

  candidates.sort((a, b) => b.score - a.score);

  const sectorUsed = new Set<string>();
  const diversified: OnMarketCandidate[] = [];
  for (const c of candidates) {
    if (sectorUsed.has(c.sector)) continue;
    sectorUsed.add(c.sector);
    diversified.push(c);
  }

  return diversified.slice(0, 8);
}

// ================================================================
//  工具
// ================================================================

function updateOnMarketSnapshot(state: OnMarketState, today: string, newTV: number) {
  const prevSnap = state.snapshots[state.snapshots.length - 1];
  const prevValue = prevSnap?.totalValue || state.initialCapital;
  const dailyPnl = newTV - prevValue;
  const dailyPnlPct = prevValue > 0 ? (dailyPnl / prevValue) * 100 : 0;
  const totalPnl = newTV - state.initialCapital;
  const totalPnlPct = (totalPnl / state.initialCapital) * 100;
  const weekPnlPct = state.weekStartValue > 0 ? ((newTV - state.weekStartValue) / state.weekStartValue) * 100 : 0;

  state.snapshots.push({
    date: today, totalValue: r2(newTV), cash: r2(state.cash),
    holdingValue: r2(state.holdings.reduce((s, h) => s + h.currentValue, 0)),
    dailyPnl: r2(dailyPnl), dailyPnlPercent: r2(dailyPnlPct),
    totalPnl: r2(totalPnl), totalPnlPercent: r2(totalPnlPct),
    holdingCount: state.holdings.length, weekPnlPercent: r2(weekPnlPct),
  });
  if (state.snapshots.length > 60) state.snapshots = state.snapshots.slice(-60);
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

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ================================================================
//  盘中实时扫描 + T+1做T
//
//  三种操作：
//  1. 风控卖出：止损/止盈/急跌（全量卖出昨日仓位）
//  2. 正T（高卖）：今日涨≥1.5%且有盈利 → 卖出1/3昨日仓 → 明日低点接回
//  3. 反T（低买）：今日跌≥1.5%且量化分正 → 加仓1/3 → 明日高点卖昨日仓
//
//  做T限制：
//  - 同一标的每天只做一次T（防止频繁操作佣金吃利润）
//  - 单笔≥1万（最低佣金5元）
//  - 只对持仓≥1天的标的做T
// ================================================================

export interface IntradayScanResult {
  triggered: boolean;
  actions: OnMarketAction[];
  reasoning: string;
  portfolio: OnMarketState;
}

// 做T基础网格（会被波动率自适应调整）
const T_BASE_GRID = [
  { pctMultiple: 0.6, ratio: 0.25 },   // 振幅×0.6 → 做1/4
  { pctMultiple: 1.2, ratio: 0.25 },   // 振幅×1.2 → 再做1/4
];
const T_FALLBACK_PCT = 1.5;     // 无振幅数据时的默认阈值%
const T_MIN_PCT = 0.8;          // 动态阈值下限%
const T_MAX_PCT = 4.0;          // 动态阈值上限%
const T_PENDING_EXPIRE_DAYS = 2;
const T_MIN_PROFIT_RATIO = 0.005;
const T_CONSECUTIVE_LOSS_PAUSE = 3;  // 连亏3次暂停
const T_PAUSE_DAYS = 2;              // 暂停2个交易日

// 动态计算做T是否划算（扣除双向佣金后净收益>0.5%）
function isTWorthIt(amount: number, pctDiff: number): boolean {
  const doubleCom = calcCommission(amount) * 2;
  const expectedProfit = amount * (pctDiff / 100);
  return expectedProfit > doubleCom && (expectedProfit - doubleCom) / amount > T_MIN_PROFIT_RATIO;
}

// 波动率自适应：用振幅生成当前ETF的动态做T网格
function getDynamicGrid(amplitude: number | undefined): { pct: number; ratio: number }[] {
  const baseAmp = amplitude && amplitude > 0.3 ? amplitude : T_FALLBACK_PCT / 0.6;
  return T_BASE_GRID.map(g => ({
    pct: Math.max(T_MIN_PCT, Math.min(T_MAX_PCT, r2(baseAmp * g.pctMultiple))),
    ratio: g.ratio,
  }));
}

// 日内价格位置判断（0=日内最低, 1=日内最高）
// 近似计算：用振幅和涨跌幅推断
function intradayPosition(changePercent: number, amplitude: number | undefined): number {
  if (!amplitude || amplitude <= 0) return 0.5;
  // 振幅 = 最高-最低 的百分比；changePercent = 收盘-昨收
  // 近似：涨幅越接近振幅/2的上端，价格越在日内高位
  const halfAmp = amplitude / 2;
  if (halfAmp <= 0) return 0.5;
  const pos = (changePercent + halfAmp) / amplitude;
  return Math.max(0, Math.min(1, pos));
}

// 更新做T统计
function updateTStats(state: OnMarketState, profit: number, date: string) {
  if (!state.tStats) {
    state.tStats = { totalCount: 0, winCount: 0, totalProfit: 0, consecutiveLoss: 0, lastTDate: "" };
  }
  state.tStats.totalCount++;
  state.tStats.totalProfit += profit;
  state.tStats.lastTDate = date;
  if (profit > 0) {
    state.tStats.winCount++;
    state.tStats.consecutiveLoss = 0;
  } else {
    state.tStats.consecutiveLoss++;
    // 连亏→暂停
    if (state.tStats.consecutiveLoss >= T_CONSECUTIVE_LOSS_PAUSE) {
      const pause = new Date();
      pause.setDate(pause.getDate() + T_PAUSE_DAYS);
      state.tPausedUntil = pause.toISOString().slice(0, 10);
    }
  }
}

export async function intradayScan(
  state: OnMarketState,
  quotes: OnMarketQuote[],
  quantReport?: QuantReport,
): Promise<IntradayScanResult> {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const actions: OnMarketAction[] = [];
  const reasoning: string[] = [];
  const quoteMap = new Map(quotes.map(q => [q.code, q]));
  let changed = false;

  // 做T时段限制：10:00后才触发做T操作（早盘波动不稳定）
  // 风控止损不受此限制（9:30起即可触发）
  const bjNow = new Date(Date.now() + 8 * 3600000);
  const minutesInDay = bjNow.getUTCHours() * 60 + bjNow.getUTCMinutes();
  const timeOk = minutesInDay >= 600; // 10:00 = 600分钟
  const tPaused = state.tPausedUntil && state.tPausedUntil >= today;
  const canDoT = timeOk && !tPaused;

  // 兼容
  if (state.totalCommission == null) state.totalCommission = 0;
  if (state.totalSlippage == null) state.totalSlippage = 0;
  if (state.pendingTOrders == null) state.pendingTOrders = [];
  if (!state.tStats) state.tStats = { totalCount: 0, winCount: 0, totalProfit: 0, consecutiveLoss: 0, lastTDate: "" };

  if (tPaused) reasoning.push(`⏸️ 做T暂停中(至${state.tPausedUntil})`);

  // 今日已做T的标的（从trades中检测）
  const todayTCodes = new Set<string>();
  for (const t of state.trades) {
    if (t.date === today && (t.reason.includes("正T") || t.reason.includes("反T"))) {
      todayTCodes.add(t.code);
    }
  }

  // 更新持仓市值
  for (const h of state.holdings) {
    if (h.peakPrice == null) h.peakPrice = h.buyPrice;
    if (h.trailingStopPct == null) h.trailingStopPct = TRAILING_STOP_BASE;

    const q = quoteMap.get(h.code);
    if (q && q.price > 0) {
      h.currentPrice = q.price;
      h.currentValue = h.shares * h.currentPrice;
      h.pnl = h.currentValue - h.costAmount;
      h.pnlPercent = h.costAmount > 0 ? (h.pnl / h.costAmount) * 100 : 0;

      if (h.currentPrice > h.peakPrice) {
        h.peakPrice = h.currentPrice;
        if (h.pnlPercent > 5) h.trailingStopPct = Math.min(TRAILING_STOP_MAX, TRAILING_STOP_BASE + 1);
        if (h.pnlPercent > 10) h.trailingStopPct = Math.min(TRAILING_STOP_MAX, TRAILING_STOP_BASE + 2);
      }
    }
    h.canSellToday = h.buyDate < today;
    h.holdDays = daysBetween(h.buyDate, today);
  }

  // ==================== 0. 执行待接回/待卖出订单（做T第二腿） ====================
  if (canDoT) for (const order of state.pendingTOrders) {
    if (order.status !== "待执行") continue;
    if (order.triggerDate >= today) continue; // 当天触发的不执行，至少等到次日

    const elapsed = daysBetween(order.triggerDate, today);
    if (elapsed > order.expireDays) {
      order.status = "已过期";
      reasoning.push(`⏰ ${order.name} 做T订单过期(${elapsed}天)`);
      changed = true;
      continue;
    }

    const q = quoteMap.get(order.code);
    if (!q || q.price <= 0) continue;

    if (order.type === "正T接回") {
      // 正T第二腿：低点买回来。当前价 ≤ 目标价 才执行
      if (q.price <= order.maxPrice) {
        const buyShares = order.targetShares;
        const execPrice = q.price * (1 + SLIPPAGE_RATE);
        const amount = buyShares * execPrice;
        const commission = calcCommission(amount);
        const totalCost = amount + commission;
        if (totalCost > state.cash - 500) continue;

        // 找到持仓加回去，或创建新持仓
        const h = state.holdings.find(hh => hh.code === order.code);
        if (h) {
          h.shares += buyShares;
          h.costAmount += totalCost;
          h.currentValue = h.shares * h.currentPrice;
          h.pnl = h.currentValue - h.costAmount;
        } else {
          state.holdings.push({
            code: order.code, name: order.name, sector: order.sector,
            buyDate: today, buyPrice: execPrice, currentPrice: q.price,
            shares: buyShares, costAmount: totalCost,
            currentValue: buyShares * q.price,
            pnl: -commission, pnlPercent: 0,
            quantScore: order.quantScore, holdDays: 0, action: "买入", tags: [],
            peakPrice: q.price, trailingStopPct: TRAILING_STOP_BASE,
            canSellToday: false,
          });
        }
        state.cash -= totalCost;
        state.totalCommission += commission;
        order.status = "已执行";

        state.trades.push({
          date: today, time: now, code: order.code, name: order.name, sector: order.sector,
          type: "买入", price: execPrice, shares: buyShares, amount,
          commission, slippage: calcSlippage(buyShares * q.price), totalCost,
          reason: `正T接回: 目标价${order.targetPrice.toFixed(3)}，成交${q.price.toFixed(3)}`,
          quantScore: order.quantScore,
        });
        // 做T收益 = 卖出价-买回价(均按每股) * 股数 - 佣金
        const tProfit = (order.triggerPrice - q.price) * buyShares - commission - calcCommission(order.triggerPrice * buyShares);
        updateTStats(state, tProfit, today);
        actions.push({ type: "买入", code: order.code, name: order.name, sector: order.sector, shares: buyShares, amount, reason: `正T接回(${q.price.toFixed(3)}) 做T损益:${tProfit>=0?"+":""}${tProfit.toFixed(0)}`, quantScore: order.quantScore });
        reasoning.push(`🔄 正T接回 ${order.name}: ${buyShares}股@${q.price.toFixed(3)} ${tProfit>=0?"🟢":"🔴"}${tProfit.toFixed(0)}元`);
        changed = true;
      }
    } else if (order.type === "反T卖出") {
      // 反T第二腿：高点卖旧仓。当前价 ≥ 目标价 才执行
      const h = state.holdings.find(hh => hh.code === order.code);
      if (!h || !h.canSellToday) continue;
      if (q.price >= order.maxPrice) {
        const sellShares = Math.min(order.targetShares, h.shares);
        if (sellShares < LOT_SIZE) continue;
        const sellAmount = sellShares * h.currentPrice;
        const commission = calcCommission(sellAmount);
        const slippage = calcSlippage(sellAmount);
        const costRatio = sellShares / h.shares;

        state.cash += sellAmount - commission - slippage;
        state.totalCommission += commission;
        state.totalSlippage += slippage;
        h.costAmount -= h.costAmount * costRatio;
        h.shares -= sellShares;
        if (h.shares <= 0) {
          state.holdings = state.holdings.filter(hh => hh.code !== h.code);
        } else {
          h.currentValue = h.shares * h.currentPrice;
          h.pnl = h.currentValue - h.costAmount;
        }
        order.status = "已执行";

        state.trades.push({
          date: today, time: now, code: order.code, name: order.name, sector: order.sector,
          type: "卖出", price: h.currentPrice, shares: sellShares, amount: sellAmount,
          commission, slippage, totalCost: commission + slippage,
          reason: `反T卖出: 目标价${order.targetPrice.toFixed(3)}，成交${q.price.toFixed(3)}`,
          quantScore: order.quantScore,
        });
        const tProfit2 = (q.price - order.triggerPrice) * sellShares - commission - calcCommission(order.triggerPrice * sellShares);
        updateTStats(state, tProfit2, today);
        actions.push({ type: "卖出", code: order.code, name: order.name, sector: order.sector, shares: sellShares, amount: sellAmount, reason: `反T卖出(${q.price.toFixed(3)}) 做T损益:${tProfit2>=0?"+":""}${tProfit2.toFixed(0)}`, quantScore: order.quantScore });
        reasoning.push(`🔄 反T卖出 ${order.name}: ${sellShares}股@${q.price.toFixed(3)} ${tProfit2>=0?"🟢":"🔴"}${tProfit2.toFixed(0)}元`);
        changed = true;
      }
    }
  }
  // 清理已完成/过期订单
  state.pendingTOrders = state.pendingTOrders.filter(o => o.status === "待执行");

  // ==================== 1. 风控卖出 ====================
  const toSell: string[] = [];
  for (const h of state.holdings) {
    if (!h.canSellToday) continue;
    const drawdownFromPeak = h.peakPrice > 0 ? ((h.peakPrice - h.currentPrice) / h.peakPrice) * 100 : 0;

    if (drawdownFromPeak >= h.trailingStopPct) {
      toSell.push(h.code);
      actions.push({ type: "卖出", code: h.code, name: h.name, sector: h.sector, shares: h.shares, amount: h.currentValue, reason: `盘中移动止损: 距峰值-${drawdownFromPeak.toFixed(1)}%`, quantScore: h.quantScore });
      reasoning.push(`🔴 止损 ${h.name} (峰值回撤${drawdownFromPeak.toFixed(1)}%)`);
    } else if (h.pnlPercent <= STOP_LOSS_PCT) {
      toSell.push(h.code);
      actions.push({ type: "卖出", code: h.code, name: h.name, sector: h.sector, shares: h.shares, amount: h.currentValue, reason: `盘中固定止损: 亏${h.pnlPercent.toFixed(1)}%`, quantScore: h.quantScore });
      reasoning.push(`🔴 止损 ${h.name} (${h.pnlPercent.toFixed(1)}%)`);
    } else if (h.pnlPercent >= TAKE_PROFIT_PCT) {
      toSell.push(h.code);
      actions.push({ type: "卖出", code: h.code, name: h.name, sector: h.sector, shares: h.shares, amount: h.currentValue, reason: `盘中止盈: +${h.pnlPercent.toFixed(1)}%`, quantScore: h.quantScore });
      reasoning.push(`🟢 止盈 ${h.name} (+${h.pnlPercent.toFixed(1)}%)`);
    }
    const q = quoteMap.get(h.code);
    if (q && q.changePercent <= -3 && h.pnlPercent < -1 && !toSell.includes(h.code)) {
      toSell.push(h.code);
      actions.push({ type: "卖出", code: h.code, name: h.name, sector: h.sector, shares: h.shares, amount: h.currentValue, reason: `盘中急跌: 今日${q.changePercent.toFixed(1)}%`, quantScore: h.quantScore });
      reasoning.push(`⚡ 急跌 ${h.name} (${q.changePercent.toFixed(1)}%)`);
    }
  }

  // 执行风控卖出
  for (const code of toSell) {
    const idx = state.holdings.findIndex(h => h.code === code);
    if (idx >= 0) {
      const h = state.holdings[idx];
      const sellAmount = h.shares * h.currentPrice;
      const commission = calcCommission(sellAmount);
      const slippage = calcSlippage(sellAmount);
      state.cash += sellAmount - commission - slippage;
      state.totalCommission += commission;
      state.totalSlippage += slippage;
      state.trades.push({
        date: today, time: now, code: h.code, name: h.name, sector: h.sector,
        type: "卖出", price: h.currentPrice, shares: h.shares, amount: sellAmount,
        commission, slippage, totalCost: commission + slippage,
        reason: actions.find(a => a.code === code && a.type === "卖出")?.reason || "盘中卖出",
        quantScore: h.quantScore,
      });
      state.holdings.splice(idx, 1);
      // 取消该标的的pendingT订单
      state.pendingTOrders = state.pendingTOrders.filter(o => o.code !== code);
      changed = true;
    }
  }

  // ==================== 2. 正T：动态网格高卖（10:00后触发） ====================
  if (canDoT) for (const h of state.holdings) {
    if (!h.canSellToday) continue;
    if (toSell.includes(h.code)) continue;
    if (todayTCodes.has(h.code)) continue;
    if (h.holdDays < 1) continue;

    const q = quoteMap.get(h.code);
    if (!q) continue;

    // 日内位置：>0.7 表示价格在日内高位（适合卖）
    const pos = intradayPosition(q.changePercent, q.amplitude);
    if (pos < 0.6) continue; // 不在高位不做正T

    // 板块联动：涨但北向没跟/主力流出 → 更容易触发正T
    const sectorBearish = (q.mainNetInflow != null && q.mainNetInflow < -500)
      || (q.northboundBuy === false)
      || (q.sectorChange != null && q.sectorChange > 2 && q.changePercent > q.sectorChange * 1.5);
    // 连涨形态：5日涨幅>5% → 回调概率高，更积极做T
    const overbought = (q.change5d != null && q.change5d > 5);
    const sellThresholdAdj = (sectorBearish ? 0.3 : 0) + (overbought ? 0.2 : 0);

    // 波动率自适应网格
    const dynamicGrid = getDynamicGrid(q.amplitude);

    for (const grid of dynamicGrid) {
      const effectiveThreshold = Math.max(T_MIN_PCT, grid.pct - sellThresholdAdj);
      if (q.changePercent >= effectiveThreshold && h.pnlPercent > 0) {
        const sellShares = Math.floor(h.shares * grid.ratio / LOT_SIZE) * LOT_SIZE;
        if (sellShares < LOT_SIZE) continue;
        const sellAmount = sellShares * h.currentPrice;
        if (sellAmount < MIN_TRADE_AMOUNT) continue;
        if (!isTWorthIt(sellAmount, effectiveThreshold * 0.6)) continue;

        const commission = calcCommission(sellAmount);
        const slippage = calcSlippage(sellAmount);
        const costRatio = sellShares / h.shares;

        state.cash += sellAmount - commission - slippage;
        state.totalCommission += commission;
        state.totalSlippage += slippage;
        h.costAmount -= h.costAmount * costRatio;
        h.shares -= sellShares;
        h.currentValue = h.shares * h.currentPrice;
        h.pnl = h.currentValue - h.costAmount;

        const notes = [sectorBearish ? "板块偏空" : "", overbought ? "5日超买" : "", `位置${Math.round(pos*100)}%`].filter(Boolean).join(",");
        state.trades.push({
          date: today, time: now, code: h.code, name: h.name, sector: h.sector,
          type: "减仓", price: h.currentPrice, shares: sellShares, amount: sellAmount,
          commission, slippage, totalCost: commission + slippage,
          reason: `正T高卖: +${q.changePercent.toFixed(1)}%(档${effectiveThreshold.toFixed(1)}% ${notes})`,
          quantScore: h.quantScore,
        });
        actions.push({ type: "减仓", code: h.code, name: h.name, sector: h.sector, shares: sellShares, amount: sellAmount, reason: `正T高卖(+${q.changePercent.toFixed(1)}% ${notes})`, quantScore: h.quantScore });
        reasoning.push(`📈 正T ${h.name}: +${q.changePercent.toFixed(1)}%卖${sellShares}股(${notes})`);

        const targetBuyBack = h.currentPrice * (1 - effectiveThreshold * 0.005);
        state.pendingTOrders.push({
          code: h.code, name: h.name, sector: h.sector,
          type: "正T接回",
          triggerDate: today,
          triggerPrice: h.currentPrice,
          targetShares: sellShares,
          targetPrice: r2(targetBuyBack),
          maxPrice: r2(h.currentPrice * 0.998),
          expireDays: T_PENDING_EXPIRE_DAYS,
          status: "待执行",
          quantScore: h.quantScore,
        });

        todayTCodes.add(h.code);
        changed = true;
        break;
      }
    }
  }

  // ==================== 3. 反T：动态网格低买（10:00后触发） ====================
  if (canDoT) for (const h of state.holdings) {
    if (todayTCodes.has(h.code)) continue;
    if (h.holdDays < 1) continue;

    const q = quoteMap.get(h.code);
    if (!q) continue;

    // 日内位置：<0.4 表示价格在日内低位（适合买）
    const pos = intradayPosition(q.changePercent, q.amplitude);
    if (pos > 0.4) continue; // 不在低位不做反T

    // 板块联动：跌但北向净买入/主力流入 → 更容易触发反T抄底
    const sectorBullish = (q.mainNetInflow != null && q.mainNetInflow > 500)
      || (q.northboundBuy === true)
      || (q.sectorChange != null && q.sectorChange > -0.5 && q.changePercent < q.sectorChange - 1);
    // 连跌形态：5日跌幅>5% → 反弹概率高
    const oversold = (q.change5d != null && q.change5d < -5);
    const buyThresholdAdj = (sectorBullish ? 0.3 : 0) + (oversold ? 0.2 : 0);

    // 波动率自适应网格
    const dynamicGrid = getDynamicGrid(q.amplitude);

    for (const grid of dynamicGrid) {
      const effectiveThreshold = Math.max(T_MIN_PCT, grid.pct - buyThresholdAdj);
      if (q.changePercent <= -effectiveThreshold && h.quantScore > -10) {
        const addBudget = h.currentValue * grid.ratio;
        if (addBudget < MIN_TRADE_AMOUNT) continue;
        if (addBudget > state.cash - 500) continue;
        if (!isTWorthIt(addBudget, effectiveThreshold * 0.6)) continue;

        const addShares = calcBuyShares(addBudget, q.price);
        if (addShares < LOT_SIZE) continue;

        const execPrice = q.price * (1 + SLIPPAGE_RATE);
        const amount = addShares * execPrice;
        const commission = calcCommission(amount);
        const slippageCost = calcSlippage(addShares * q.price);
        const totalCost = amount + commission;
        if (totalCost > state.cash - 500) continue;

        h.shares += addShares;
        h.costAmount += totalCost;
        h.currentValue = h.shares * h.currentPrice;
        h.pnl = h.currentValue - h.costAmount;
        state.cash -= totalCost;
        state.totalCommission += commission;
        state.totalSlippage += slippageCost;

        const notes = [sectorBullish ? "板块偏多" : "", oversold ? "5日超卖" : "", `位置${Math.round(pos*100)}%`].filter(Boolean).join(",");
        state.trades.push({
          date: today, time: now, code: h.code, name: h.name, sector: h.sector,
          type: "加仓", price: execPrice, shares: addShares, amount,
          commission, slippage: slippageCost, totalCost,
          reason: `反T低买: ${q.changePercent.toFixed(1)}%(档${effectiveThreshold.toFixed(1)}% ${notes})`,
          quantScore: h.quantScore,
        });
        actions.push({ type: "加仓", code: h.code, name: h.name, sector: h.sector, shares: addShares, amount, reason: `反T低买(${q.changePercent.toFixed(1)}% ${notes})`, quantScore: h.quantScore });
        reasoning.push(`📉 反T ${h.name}: ${q.changePercent.toFixed(1)}%加${addShares}股(${notes})`);

        const targetSellPrice = q.price * (1 + effectiveThreshold * 0.005);
        state.pendingTOrders.push({
          code: h.code, name: h.name, sector: h.sector,
          type: "反T卖出",
          triggerDate: today,
          triggerPrice: q.price,
          targetShares: addShares,
          targetPrice: r2(targetSellPrice),
          maxPrice: r2(q.price * 1.002),
          expireDays: T_PENDING_EXPIRE_DAYS,
          status: "待执行",
          quantScore: h.quantScore,
        });

        todayTCodes.add(h.code);
        changed = true;
        break;
      }
    }
  }

  // ==================== 盘中机会买入 ====================
  // 条件：有量化报告 + 10:00后 + 有空余仓位 + 有现金 + 信号足够强
  const INTRADAY_BUY_THRESHOLD = 28; // 降低盘中买入门槛→更积极
  const INTRADAY_MAX_BUY_PER_DAY = 1; // 盘中最多新买1只，防止冲动
  if (quantReport && timeOk && state.holdings.length < MAX_HOLDINGS && state.cash > MIN_TRADE_AMOUNT * 1.5) {
    const holdCodes = new Set(state.holdings.map(h => h.code));
    const holdSectors = new Set(state.holdings.map(h => h.sector));
    // 今日盘中已买入次数
    const todayIntradayBuys = state.trades.filter(t => t.date === today && t.type === "买入" && t.reason.includes("盘中")).length;

    if (todayIntradayBuys < INTRADAY_MAX_BUY_PER_DAY) {
      // 找高分机会
      const adaptiveThresholds = await loadCurrentThresholds();
      const intradayThreshold = Math.max(INTRADAY_BUY_THRESHOLD, adaptiveThresholds.buyScoreThreshold + 8);

      const opportunities = quantReport.decisions
        .filter(d =>
          d.finalScore >= intradayThreshold &&
          !holdCodes.has(d.code) &&
          !holdSectors.has(d.sector) &&
          d.matrixConsensus !== "分歧" &&
          quoteMap.has(d.code)
        )
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, 1); // 只取最强1个

      // 跨周期确认：如果有weeklyConfirmation，排除周线矛盾的
      const weeklyMap = new Map((quantReport.weeklyConfirmations || []).map(w => [w.code, w]));

      for (const opp of opportunities) {
        const weekly = weeklyMap.get(opp.code);
        if (weekly && !weekly.confirmed && weekly.confidenceAdj < 0) {
          reasoning.push(`⏸️ ${opp.name} 盘中高分(${opp.finalScore})但周线矛盾，跳过`);
          continue;
        }

        const q = quoteMap.get(opp.code)!;
        if (q.price <= 0) continue;

        // 日内低位优先买入：价格在日内下半区更好
        const pos = intradayPosition(q.changePercent, q.amplitude);
        if (pos > 0.8) {
          reasoning.push(`⏸️ ${opp.name} 高分(${opp.finalScore})但日内极高位(${(pos*100).toFixed(0)}%)，等回落`);
          continue;
        }

        // 控制仓位：盘中买入用更小仓位（正常的60-80%）
        const posScale = adaptiveThresholds.positionSizeMultiplier * (pos < 0.3 ? 0.9 : 0.7);
        const maxBuyAmount = Math.min(state.cash * 0.45 * posScale, state.cash - 500);
        if (maxBuyAmount < MIN_TRADE_AMOUNT) continue;

        const buyPrice = q.price * (1 + SLIPPAGE_RATE);
        const buyShares = Math.floor(maxBuyAmount / buyPrice / LOT_SIZE) * LOT_SIZE;
        if (buyShares < LOT_SIZE) continue;

        const amount = buyShares * buyPrice;
        const commission = calcCommission(amount);
        const slippage = amount * SLIPPAGE_RATE;
        const totalCost = amount + commission + slippage;
        if (totalCost > state.cash - 500) continue;

        // 执行买入
        state.cash -= totalCost;
        state.totalCommission += commission;
        state.totalSlippage += slippage;

        const posBonus = weekly?.confirmed ? " +周线共振" : "";
        state.holdings.push({
          code: opp.code, name: opp.name, sector: opp.sector,
          buyDate: today, buyPrice, currentPrice: q.price,
          shares: buyShares, costAmount: totalCost,
          currentValue: buyShares * q.price,
          pnl: 0, pnlPercent: 0,
          canSellToday: false, // T+1
          holdDays: 0, peakPrice: buyPrice,
          trailingStopPct: TRAILING_STOP_BASE,
          quantScore: opp.finalScore,
          action: opp.action,
          tags: opp.tags,
        });

        state.trades.push({
          date: today, time: now, code: opp.code, name: opp.name, sector: opp.sector,
          type: "买入", price: buyPrice, shares: buyShares, amount: totalCost,
          commission, slippage, totalCost: commission + slippage,
          reason: `盘中机会买入: 量化${opp.finalScore}分 ${opp.matrixConsensus}${posBonus}`,
          quantScore: opp.finalScore,
        });

        actions.push({
          type: "买入", code: opp.code, name: opp.name, sector: opp.sector,
          shares: buyShares, amount: totalCost,
          reason: `盘中机会: ${opp.finalScore}分 ${opp.matrixConsensus} 日内位${(pos*100).toFixed(0)}%${posBonus}`,
          quantScore: opp.finalScore,
        });
        reasoning.push(`🚀 盘中买入 ${opp.name} ${buyShares}股 @${buyPrice.toFixed(3)} (${opp.finalScore}分)`);
        changed = true;
      }
    }
  }

  if (changed) {
    saveOnMarketPortfolio(state);
  }

  return {
    triggered: changed,
    actions,
    reasoning: reasoning.join(" | ") || "盘中无异常",
    portfolio: state,
  };
}
