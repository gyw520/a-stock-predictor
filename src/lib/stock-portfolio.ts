/**
 * 个股模拟盘引擎
 *
 * 1万本金，最多持1只，精选最强个股
 * 复用量化引擎29因子+3层策略矩阵
 * 支持盘中实时操作 + 企微通知
 */

import * as fs from "fs";
import * as path from "path";
import type { QuantReport } from "./quant-engine";
import { loadCurrentThresholds } from "./param-feedback";
import { loadNextDayWatchlist } from "./limit-up-engine";

// ================================================================
//  类型定义
// ================================================================

export interface StockHolding {
  code: string;
  name: string;
  sector: string;
  buyDate: string;
  buyPrice: number;
  currentPrice: number;
  shares: number;
  costAmount: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  quantScore: number;
  holdDays: number;
  peakPrice: number;
  trailingStopPct: number;
  canSellToday: boolean;
}

export interface StockTrade {
  date: string;
  time: string;
  code: string;
  name: string;
  sector: string;
  type: "买入" | "卖出" | "加仓" | "减仓";
  price: number;
  shares: number;
  amount: number;
  commission: number;
  slippage: number;
  stampTax: number;       // 印花税（卖出0.05%）
  totalCost: number;
  reason: string;
  quantScore: number;
}

export interface StockSnapshot {
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

export interface StockPortfolioState {
  initialCapital: number;
  cash: number;
  holdings: StockHolding[];
  trades: StockTrade[];
  snapshots: StockSnapshot[];
  lastRebalanceDate: string;
  createdAt: string;
  weekStartValue: number;
  weekStartDate: string;
  peakTotalValue: number;
  maxDrawdownPct: number;
  consecutiveLossDays: number;
  riskLevel: RiskLevel;
  circuitBreakerUntil: string;
  totalCommission: number;
  totalSlippage: number;
  totalStampTax: number;
  // 每日最强推荐
  dailyTopPick?: {
    date: string;
    code: string;
    name: string;
    score: number;
    reason: string;
  };
}

export interface StockQuoteInfo {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  amount: number;
  turnoverRate: number;
  pe: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
}

export interface StockRebalanceResult {
  actions: StockAction[];
  portfolio: StockPortfolioState;
  reasoning: string;
  topPicks: { code: string; name: string; score: number; reason: string }[];
}

export interface StockAction {
  type: "买入" | "卖出" | "加仓" | "减仓" | "持仓";
  code: string;
  name: string;
  sector: string;
  shares: number;
  amount: number;
  reason: string;
  quantScore: number;
}

export interface StockScanResult {
  triggered: boolean;
  actions: StockAction[];
  reasoning: string;
  portfolio: StockPortfolioState;
  limitUpAlerts?: LimitUpAlert[];
}

// ================================================================
//  涨停预判
// ================================================================

export interface LimitUpAlert {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  limitPrice: number;         // 涨停价
  distancePercent: number;    // 距涨停还差几%
  turnoverRate: number;
  amount: number;             // 成交额(万)
  phase: "冲刺" | "临门" | "触板" | "封板";  // 7-8%冲刺, 8-9%临门, 9-9.5%触板, 9.5%+封板
  momentum: string;           // 动量描述
  detectedAt: string;
}

export function scanLimitUpCandidates(quotes: StockQuoteInfo[]): LimitUpAlert[] {
  const alerts: LimitUpAlert[] = [];

  for (const q of quotes) {
    if (q.price <= 0 || q.prevClose <= 0 || q.volume <= 0) continue;
    if (q.name.includes("ST") || q.name.includes("退")) continue;
    // 只推荐沪市主板(60开头)+深市主板(00开头)
    if (!(q.code.startsWith("60") || q.code.startsWith("00"))) continue;

    // 计算涨停价（主板统一10%）
    const limitPct = 0.10;
    const actualLimitPct = limitPct;
    const limitPrice = Math.round(q.prevClose * (1 + actualLimitPct) * 100) / 100;

    const changePct = q.changePercent;
    // 主板10%涨停板：关注涨幅7%+ 的票
    const thresholdPct = 7;
    if (changePct < thresholdPct) continue;

    // 距离涨停的百分比
    const distPct = q.prevClose > 0 ? ((limitPrice - q.price) / q.prevClose) * 100 : 99;

    // 过滤：已经涨停封板的（买不到），跳过
    // 涨停封板 = 现价 >= 涨停价 且无法成交
    const isLimitUp = q.price >= limitPrice - 0.01;
    if (isLimitUp && q.high <= limitPrice + 0.01 && q.price >= limitPrice - 0.01) {
      // 可能封死了，但如果换手高说明可能开板
      if (q.turnoverRate < 3) continue; // 换手低=封死了,没机会
    }

    // 换手率要求：至少2%说明有足够参与度
    if (q.turnoverRate < 2) continue;
    // 成交额门槛：至少5000万，太小的票不可靠
    if (q.amount < 50000000) continue;

    // 判断阶段（主板10%涨停）
    let phase: LimitUpAlert["phase"];
    if (changePct >= 9.5) phase = "封板";
    else if (changePct >= 9) phase = "触板";
    else if (changePct >= 8) phase = "临门";
    else phase = "冲刺";

    // 动量分析
    const momentum: string[] = [];
    // 高换手=资金积极参与
    if (q.turnoverRate >= 10) momentum.push("极高换手");
    else if (q.turnoverRate >= 5) momentum.push("高换手");
    // 成交额大=主力资金
    if (q.amount >= 500000000) momentum.push("5亿+大资金");
    else if (q.amount >= 200000000) momentum.push("2亿+放量");
    else if (q.amount >= 100000000) momentum.push("亿元量");
    // 日内走势：最高价接近现价=强势冲顶
    if (q.high > 0 && q.price > 0) {
      const fromHigh = ((q.high - q.price) / q.high) * 100;
      if (fromHigh < 0.3) momentum.push("持续冲顶");
      else if (fromHigh < 1) momentum.push("高位强势");
    }
    // 开盘就冲=主力意图明确
    if (q.open > 0 && q.prevClose > 0) {
      const openGap = ((q.open - q.prevClose) / q.prevClose) * 100;
      if (openGap >= 5) momentum.push("高开冲板");
      else if (openGap >= 3) momentum.push("高开强势");
    }

    alerts.push({
      code: q.code,
      name: q.name,
      price: q.price,
      changePercent: r2(changePct),
      limitPrice,
      distancePercent: r2(distPct),
      turnoverRate: r2(q.turnoverRate),
      amount: q.amount,
      phase,
      momentum: momentum.join("+") || "正常攻板",
      detectedAt: new Date().toISOString(),
    });
  }

  // 按距涨停距离升序排（最接近涨停的排前面）
  alerts.sort((a, b) => a.distancePercent - b.distancePercent);

  return alerts;
}

// ================================================================
//  交易参数
// ================================================================

const INITIAL_CAPITAL = 10000;
const MAX_HOLDINGS = 1;          // 只持1只
const STOP_LOSS_PCT = -5;
const TAKE_PROFIT_PCT = 10;      // 降低止盈→更快落袋
const MIN_TRADE_AMOUNT = 2000;
const CASH_RESERVE_PCT = 0.15;   // 降至15%→更多资金参与
const LOT_SIZE = 100;            // 个股100股整手

// 交易费用
const COMMISSION_RATE = 0.00025; // 万2.5（个股佣金通常高于ETF）
const MIN_COMMISSION = 5;
const SLIPPAGE_RATE = 0.001;     // 0.1% 滑点（个股流动性比ETF差）
const STAMP_TAX_RATE = 0.0005;   // 印花税0.05%（卖出时收取）

// 风控
const TRAILING_STOP_BASE = 4;    // 个股波动大，基础止损稍宽
const TRAILING_STOP_MAX = 10;
const DRAWDOWN_WARN = 3;
const DRAWDOWN_REDUCE = 5;
const DRAWDOWN_CIRCUIT = 8;

// ================================================================
//  费用计算
// ================================================================

function calcCommission(amount: number): number {
  return Math.max(MIN_COMMISSION, amount * COMMISSION_RATE);
}

function calcSlippage(amount: number): number {
  return amount * SLIPPAGE_RATE;
}

function calcStampTax(amount: number): number {
  return amount * STAMP_TAX_RATE;
}

function calcBuyShares(budget: number, price: number): number {
  const execPrice = price * (1 + SLIPPAGE_RATE);
  const raw = Math.floor(budget / execPrice / LOT_SIZE) * LOT_SIZE;
  return Math.max(0, raw);
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysBetween(d1: string, d2: string): number {
  return Math.floor((new Date(d2).getTime() - new Date(d1).getTime()) / 86400000);
}

// ================================================================
//  持久化
// ================================================================

const DATA_DIR = path.join(process.cwd(), ".data");
const STATE_FILE = path.join(DATA_DIR, "stock-portfolio.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadStockPortfolio(): StockPortfolioState {
  ensureDataDir();
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  }
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
    totalStampTax: 0,
  };
}

export function saveStockPortfolio(state: StockPortfolioState) {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

// ================================================================
//  候选股筛选
// ================================================================

interface StockCandidate {
  code: string;
  name: string;
  sector: string;
  score: number;
  reason: string;
  tags: string[];
}

function getStockCandidates(
  report: QuantReport,
  quotes: StockQuoteInfo[],
  holdCodes: Set<string>,
): { candidates: StockCandidate[]; topPicks: StockCandidate[] } {
  const quoteMap = new Map(quotes.map(q => [q.code, q]));
  const candidates: StockCandidate[] = [];

  const thresholds = loadCurrentThresholds();
  // 降低个股门槛：从30降到25，增加交易机会
  const minScore = Math.max(25, thresholds.buyScoreThreshold + 5);

  for (const d of report.decisions) {
    if (holdCodes.has(d.code)) continue;
    if (!quoteMap.has(d.code)) continue;

    const q = quoteMap.get(d.code)!;
    // 过滤ST、停牌、价格异常
    if (q.name.includes("ST") || q.name.includes("退")) continue;
    if (q.price <= 0 || q.volume <= 0) continue;
    // 只选沪市主板(60开头)+深市主板(00开头)
    if (!(q.code.startsWith("60") || q.code.startsWith("00"))) continue;
    // 过滤涨停无法买入
    if (q.prevClose > 0 && (q.price - q.prevClose) / q.prevClose >= 0.095) continue;
    // 过滤市值太小（流动性差）
    if (q.turnoverRate < 0.5) continue;

    const score = d.finalScore;
    if (score < minScore) continue;
    if (d.matrixConsensus === "分歧") continue;

    const reasons: string[] = [];
    if (score >= 45) reasons.push("量化强力看多");
    else if (score >= 35) reasons.push("量化看多");
    else reasons.push("量化偏多");
    if (d.matrixConsensus === "强共识") reasons.push("多策略共振");
    if (d.tags.includes("量价齐升")) reasons.push("量价齐升");
    if (d.tags.includes("强趋势")) reasons.push("强趋势");

    candidates.push({
      code: d.code, name: d.name, sector: d.sector || "",
      score, reason: reasons.join("+"), tags: d.tags,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  // topPicks: 不管是否持有，返回Top 10供推荐
  const topPicks = candidates.slice(0, 10);

  return { candidates, topPicks };
}

// ================================================================
//  调仓核心
// ================================================================

export function stockRebalance(
  state: StockPortfolioState,
  quantReport: QuantReport,
  quotes: StockQuoteInfo[],
): StockRebalanceResult {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const actions: StockAction[] = [];
  const reasoning: string[] = [];
  const quoteMap = new Map(quotes.map(q => [q.code, q]));

  // 兼容
  if (state.totalCommission == null) state.totalCommission = 0;
  if (state.totalSlippage == null) state.totalSlippage = 0;
  if (state.totalStampTax == null) state.totalStampTax = 0;

  // == 周重置 ==
  const dow = new Date().getDay();
  if (dow === 1 && state.weekStartDate !== today) {
    const tv = state.cash + state.holdings.reduce((s, h) => s + h.currentValue, 0);
    state.weekStartValue = tv;
    state.weekStartDate = today;
  }

  // == 更新持仓市值 ==
  for (const h of state.holdings) {
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
        if (h.pnlPercent > 15) h.trailingStopPct = Math.min(TRAILING_STOP_MAX, TRAILING_STOP_BASE + 3);
      }
    }
    h.canSellToday = h.buyDate < today;
    h.holdDays = daysBetween(h.buyDate, today);
  }

  // == 风控 ==
  const totalValue = state.cash + state.holdings.reduce((s, h) => s + h.currentValue, 0);
  if (totalValue > state.peakTotalValue) state.peakTotalValue = totalValue;
  const drawdownPct = ((state.peakTotalValue - totalValue) / state.peakTotalValue) * 100;
  state.maxDrawdownPct = Math.max(state.maxDrawdownPct, drawdownPct);

  let riskLevel: RiskLevel = "正常";
  let positionScale = 1;
  if (drawdownPct >= DRAWDOWN_CIRCUIT) {
    riskLevel = "熔断";
    positionScale = 0;
    reasoning.push(`🚨 熔断：回撤${r2(drawdownPct)}%≥${DRAWDOWN_CIRCUIT}%`);
  } else if (drawdownPct >= DRAWDOWN_REDUCE) {
    riskLevel = "降仓";
    positionScale = 0.4;
    reasoning.push(`⚠️ 降仓：回撤${r2(drawdownPct)}%`);
  } else if (drawdownPct >= DRAWDOWN_WARN) {
    riskLevel = "警告";
    positionScale = 0.7;
    reasoning.push(`⚠️ 警告：回撤${r2(drawdownPct)}%`);
  }
  state.riskLevel = riskLevel;

  // == Step 1: 止盈止损 ==
  const thresholds = loadCurrentThresholds();
  const adaptiveStopLoss = thresholds.stopLossPct || STOP_LOSS_PCT;
  const adaptiveTakeProfit = thresholds.takeProfitPct || TAKE_PROFIT_PCT;

  for (const h of [...state.holdings]) {
    if (!h.canSellToday) continue;
    const q = quoteMap.get(h.code);
    if (!q || q.price <= 0) continue;

    let sellReason = "";
    // 固定止损
    if (h.pnlPercent <= adaptiveStopLoss) {
      sellReason = `固定止损(${r2(h.pnlPercent)}%≤${adaptiveStopLoss}%)`;
    }
    // 移动止损
    if (!sellReason && h.peakPrice > 0) {
      const dropFromPeak = ((h.peakPrice - h.currentPrice) / h.peakPrice) * 100;
      if (dropFromPeak >= h.trailingStopPct) {
        sellReason = `移动止损(从高点回撤${r2(dropFromPeak)}%≥${h.trailingStopPct}%)`;
      }
    }
    // 止盈
    if (!sellReason && h.pnlPercent >= adaptiveTakeProfit) {
      sellReason = `止盈(${r2(h.pnlPercent)}%≥${adaptiveTakeProfit}%)`;
    }
    // 熔断清仓
    if (!sellReason && riskLevel === "熔断") {
      sellReason = "组合熔断清仓";
    }

    if (sellReason) {
      const sellPrice = h.currentPrice * (1 - SLIPPAGE_RATE);
      const amount = h.shares * sellPrice;
      const commission = calcCommission(amount);
      const stampTax = calcStampTax(amount);
      const slippage = calcSlippage(h.shares * h.currentPrice);

      state.cash += amount - commission - stampTax;
      state.totalCommission += commission;
      state.totalSlippage += slippage;
      state.totalStampTax += stampTax;

      state.trades.push({
        date: today, time: now, code: h.code, name: h.name, sector: h.sector,
        type: "卖出", price: sellPrice, shares: h.shares, amount,
        commission, slippage, stampTax, totalCost: commission + slippage + stampTax,
        reason: sellReason, quantScore: h.quantScore,
      });
      actions.push({
        type: "卖出", code: h.code, name: h.name, sector: h.sector,
        shares: h.shares, amount, reason: sellReason, quantScore: h.quantScore,
      });
      reasoning.push(`🔴 卖出 ${h.name} ${h.shares}股: ${sellReason}`);
      state.holdings = state.holdings.filter(x => x.code !== h.code);
    }
  }

  // == Step 2: 选股建仓 ==
  const holdCodes = new Set(state.holdings.map(h => h.code));
  const { candidates, topPicks } = getStockCandidates(quantReport, quotes, holdCodes);

  const slotsAvailable = MAX_HOLDINGS - state.holdings.length;
  const reserveCash = state.initialCapital * CASH_RESERVE_PCT;
  const allocatableCash = Math.max(0, state.cash - reserveCash) * 0.95;

  if (slotsAvailable > 0 && allocatableCash >= MIN_TRADE_AMOUNT && candidates.length > 0 && riskLevel !== "降仓" && riskLevel !== "熔断") {
    // 精选第1名
    const best = candidates[0];
    const quote = quoteMap.get(best.code);
    if (quote && quote.price > 0) {
      // 用70%可分配资金建仓
      let budgetAmount = allocatableCash * 0.7 * positionScale;

      const buyShares = calcBuyShares(budgetAmount, quote.price);
      if (buyShares >= LOT_SIZE) {
        const execPrice = quote.price * (1 + SLIPPAGE_RATE);
        const amount = buyShares * execPrice;
        const commission = calcCommission(amount);
        const slippageCost = calcSlippage(buyShares * quote.price);
        const totalCost = amount + commission;

        if (totalCost <= state.cash - 200) {
          state.holdings.push({
            code: best.code, name: best.name, sector: best.sector,
            buyDate: today, buyPrice: execPrice, currentPrice: quote.price,
            shares: buyShares, costAmount: totalCost,
            currentValue: buyShares * quote.price,
            pnl: -commission - slippageCost, pnlPercent: 0,
            quantScore: best.score, holdDays: 0,
            peakPrice: quote.price, trailingStopPct: TRAILING_STOP_BASE,
            canSellToday: false,
          });
          state.cash -= totalCost;
          state.totalCommission += commission;
          state.totalSlippage += slippageCost;

          state.trades.push({
            date: today, time: now, code: best.code, name: best.name, sector: best.sector,
            type: "买入", price: execPrice, shares: buyShares, amount,
            commission, slippage: slippageCost, stampTax: 0, totalCost,
            reason: best.reason + (positionScale < 1 ? ` [风控${Math.round(positionScale * 100)}%]` : ""),
            quantScore: best.score,
          });
          actions.push({
            type: "买入", code: best.code, name: best.name, sector: best.sector,
            shares: buyShares, amount, reason: best.reason, quantScore: best.score,
          });
          reasoning.push(`🟢 买入 ${best.name} ${buyShares}股 ¥${amount.toFixed(0)} (${best.score}分)`);
        }
      }
    }
  }

  // == Step 3: 加仓 ==
  if (riskLevel === "正常" && state.holdings.length > 0 && state.cash > MIN_TRADE_AMOUNT) {
    for (const h of state.holdings) {
      if (h.quantScore >= 30 && h.pnlPercent > -2 && h.holdDays >= 1) {
        const quote = quoteMap.get(h.code);
        if (!quote || quote.price <= 0) continue;
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
          commission, slippage: slippageCost, stampTax: 0, totalCost,
          reason: `加仓: 量化${h.quantScore}分+趋势确认`, quantScore: h.quantScore,
        });
        actions.push({
          type: "加仓", code: h.code, name: h.name, sector: h.sector,
          shares: addShares, amount,
          reason: `加仓: ${h.quantScore}分`, quantScore: h.quantScore,
        });
        reasoning.push(`🟡 加仓 ${h.name} ${addShares}股 ¥${amount.toFixed(0)}`);
      }
    }
  }

  // == 快照 ==
  // 熔断清仓后重置峰值起点，避免无限熔断循环
  if (riskLevel === "熔断" && state.holdings.length === 0) {
    state.peakTotalValue = state.cash;
    state.maxDrawdownPct = 0;
  }
  const tv = state.cash + state.holdings.reduce((s, h) => s + h.currentValue, 0);
  const prevSnap = state.snapshots[state.snapshots.length - 1];
  const dailyPnl = prevSnap ? tv - prevSnap.totalValue : tv - state.initialCapital;
  const dailyPnlPct = prevSnap && prevSnap.totalValue > 0 ? (dailyPnl / prevSnap.totalValue) * 100 : 0;
  const weekPnlPct = state.weekStartValue > 0 ? ((tv - state.weekStartValue) / state.weekStartValue) * 100 : 0;

  state.snapshots.push({
    date: today, totalValue: r2(tv), cash: r2(state.cash),
    holdingValue: r2(state.holdings.reduce((s, h) => s + h.currentValue, 0)),
    dailyPnl: r2(dailyPnl), dailyPnlPercent: r2(dailyPnlPct),
    totalPnl: r2(tv - state.initialCapital),
    totalPnlPercent: r2(((tv - state.initialCapital) / state.initialCapital) * 100),
    holdingCount: state.holdings.length, weekPnlPercent: r2(weekPnlPct),
  });
  if (state.snapshots.length > 90) state.snapshots = state.snapshots.slice(-90);

  // 每日最强推荐
  if (topPicks.length > 0) {
    state.dailyTopPick = {
      date: today,
      code: topPicks[0].code,
      name: topPicks[0].name,
      score: topPicks[0].score,
      reason: topPicks[0].reason,
    };
  }

  state.lastRebalanceDate = today;
  saveStockPortfolio(state);

  return {
    actions,
    portfolio: state,
    reasoning: reasoning.join(" | ") || "无操作",
    topPicks: topPicks.map(t => ({ code: t.code, name: t.name, score: t.score, reason: t.reason })),
  };
}

// ================================================================
//  盘中扫描
// ================================================================

export function stockIntradayScan(
  state: StockPortfolioState,
  quotes: StockQuoteInfo[],
  quantReport?: QuantReport,
): StockScanResult {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const actions: StockAction[] = [];
  const reasoning: string[] = [];
  const quoteMap = new Map(quotes.map(q => [q.code, q]));
  let changed = false;

  const bjNow = new Date(Date.now() + 8 * 3600000);
  const minutesInDay = bjNow.getUTCHours() * 60 + bjNow.getUTCMinutes();
  const timeOk = minutesInDay >= 600; // 10:00后

  if (state.totalCommission == null) state.totalCommission = 0;
  if (state.totalSlippage == null) state.totalSlippage = 0;
  if (state.totalStampTax == null) state.totalStampTax = 0;

  // == 更新持仓市值 ==
  for (const h of state.holdings) {
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

  // == 风控止损（始终生效） ==
  const thresholds = loadCurrentThresholds();
  for (const h of [...state.holdings]) {
    if (!h.canSellToday) continue;
    const q = quoteMap.get(h.code);
    if (!q || q.price <= 0) continue;

    let sellReason = "";
    // 急跌止损：日内跌幅≥3%
    if (q.changePercent <= -3 && h.pnlPercent < -1) {
      sellReason = `急跌止损(日跌${r2(q.changePercent)}%)`;
    }
    // 固定止损
    if (!sellReason && h.pnlPercent <= (thresholds.stopLossPct || STOP_LOSS_PCT)) {
      sellReason = `固定止损(${r2(h.pnlPercent)}%)`;
    }
    // 移动止损
    if (!sellReason && h.peakPrice > 0) {
      const drop = ((h.peakPrice - h.currentPrice) / h.peakPrice) * 100;
      if (drop >= h.trailingStopPct) {
        sellReason = `移动止损(回撤${r2(drop)}%)`;
      }
    }
    // 止盈
    if (!sellReason && h.pnlPercent >= (thresholds.takeProfitPct || TAKE_PROFIT_PCT)) {
      sellReason = `止盈(${r2(h.pnlPercent)}%)`;
    }

    if (sellReason) {
      const sellPrice = h.currentPrice * (1 - SLIPPAGE_RATE);
      const amount = h.shares * sellPrice;
      const commission = calcCommission(amount);
      const stampTax = calcStampTax(amount);
      const slippage = calcSlippage(h.shares * h.currentPrice);

      state.cash += amount - commission - stampTax;
      state.totalCommission += commission;
      state.totalSlippage += slippage;
      state.totalStampTax += stampTax;

      state.trades.push({
        date: today, time: now, code: h.code, name: h.name, sector: h.sector,
        type: "卖出", price: sellPrice, shares: h.shares, amount,
        commission, slippage, stampTax, totalCost: commission + slippage + stampTax,
        reason: sellReason, quantScore: h.quantScore,
      });
      actions.push({
        type: "卖出", code: h.code, name: h.name, sector: h.sector,
        shares: h.shares, amount, reason: sellReason, quantScore: h.quantScore,
      });
      reasoning.push(`🔴 ${sellReason}: ${h.name} ${h.shares}股`);
      state.holdings = state.holdings.filter(x => x.code !== h.code);
      changed = true;
    }
  }

  // == 极优板次日竞价买入（9:25-9:40窗口） ==
  const isAuctionWindow = minutesInDay >= 565 && minutesInDay <= 580; // 9:25-9:40
  if (isAuctionWindow && state.holdings.length < MAX_HOLDINGS && state.cash > MIN_TRADE_AMOUNT * 1.5) {
    const todayAuctionBuys = state.trades.filter(t => t.date === today && t.reason.includes("极优板")).length;
    if (todayAuctionBuys === 0) {
      const watchlist = loadNextDayWatchlist();
      if (watchlist && watchlist.picks) {
        const holdCodes = new Set(state.holdings.map(h => h.code));
        // 找极优板：qualityScore>=80 + limitUpToday + 仓位倍数>0
        const qualityPicks = watchlist.picks.filter(p =>
          p.limitUpToday &&
          (p.qualityScore ?? 0) >= 80 &&
          (p.qualityGrade === "极优板") &&
          (p.positionMultiplier ?? 0) > 0 &&
          !holdCodes.has(p.code) &&
          (p.code.startsWith("60") || p.code.startsWith("00")) &&
          !(p.qualityRiskFlags || []).some((f: string) => f.includes("⛔") || f.includes("🚫"))
        ).sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));

        if (qualityPicks.length > 0) {
          const pick = qualityPicks[0];
          const q = quoteMap.get(pick.code);
          if (q && q.price > 0 && q.price < q.prevClose * 1.05) {
            // 竞价买入：高开不超5%才买
            const posMult = pick.positionMultiplier ?? 1.0;
            const reserveCash = state.initialCapital * CASH_RESERVE_PCT;
            const maxBuyAmount = Math.min((state.cash - reserveCash) * 0.85 * posMult, state.cash - 500);
            if (maxBuyAmount >= MIN_TRADE_AMOUNT) {
              const buyPrice = q.price * (1 + SLIPPAGE_RATE);
              const buyShares = Math.floor(maxBuyAmount / buyPrice / LOT_SIZE) * LOT_SIZE;
              if (buyShares >= LOT_SIZE) {
                const amount = buyShares * buyPrice;
                const commission = calcCommission(amount);
                const slippage = amount * SLIPPAGE_RATE;
                const totalCost = amount + commission;
                if (totalCost <= state.cash - 500) {
                  state.cash -= totalCost;
                  state.totalCommission += commission;
                  state.totalSlippage += slippage;

                  state.holdings.push({
                    code: pick.code, name: pick.name, sector: "",
                    buyDate: today, buyPrice, currentPrice: q.price,
                    shares: buyShares, costAmount: totalCost,
                    currentValue: buyShares * q.price,
                    pnl: 0, pnlPercent: 0,
                    canSellToday: false,
                    holdDays: 0, peakPrice: buyPrice,
                    trailingStopPct: TRAILING_STOP_BASE,
                    quantScore: pick.score || 0,
                  });

                  const qualityInfo = `质量${pick.qualityScore}分/${pick.qualityGrade}`;
                  state.trades.push({
                    date: today, time: now, code: pick.code, name: pick.name, sector: "",
                    type: "买入", price: buyPrice, shares: buyShares, amount,
                    commission, slippage, stampTax: 0, totalCost: commission + slippage,
                    reason: `极优板竞价买入: ${qualityInfo} 仓位${(posMult * 100).toFixed(0)}%`,
                    quantScore: pick.score || 0,
                  });
                  actions.push({
                    type: "买入", code: pick.code, name: pick.name, sector: "",
                    shares: buyShares, amount,
                    reason: `🏆极优板竞价: ${qualityInfo}`,
                    quantScore: pick.score || 0,
                  });
                  reasoning.push(`🏆 极优板竞价买入 ${pick.name} ${buyShares}股 @${buyPrice.toFixed(2)} (${qualityInfo})`);
                  changed = true;
                }
              }
            }
          } else if (q && q.price > 0) {
            reasoning.push(`⏸️ ${pick.name} 极优板但高开${((q.price / q.prevClose - 1) * 100).toFixed(1)}%过多，放弃`);
          }
        }
      }
    }
  }

  // == 盘中机会买入 ==
  const INTRADAY_BUY_THRESHOLD = 30; // 降低门槛→更积极出手
  if (quantReport && timeOk && state.holdings.length < MAX_HOLDINGS && state.cash > MIN_TRADE_AMOUNT * 1.5) {
    const holdCodes = new Set(state.holdings.map(h => h.code));
    const todayBuys = state.trades.filter(t => t.date === today && t.type === "买入" && t.reason.includes("盘中")).length;

    if (todayBuys === 0) {
      const adaptiveThreshold = Math.max(INTRADAY_BUY_THRESHOLD, (thresholds.buyScoreThreshold || 15) + 10);

      const opportunities = quantReport.decisions
        .filter(d =>
          d.finalScore >= adaptiveThreshold &&
          !holdCodes.has(d.code) &&
          d.matrixConsensus !== "分歧" &&
          quoteMap.has(d.code)
        )
        .filter(d => {
          const q = quoteMap.get(d.code)!;
          if (q.name.includes("ST") || q.name.includes("退")) return false;
          if (q.price <= 0 || q.volume <= 0) return false;
          // 只选沪市主板+深市主板
          if (!(d.code.startsWith("60") || d.code.startsWith("00"))) return false;
          if (q.prevClose > 0 && (q.price - q.prevClose) / q.prevClose >= 0.095) return false;
          if (q.turnoverRate < 0.5) return false;
          return true;
        })
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, 1);

      // 周线确认
      const weeklyMap = new Map((quantReport.weeklyConfirmations || []).map(w => [w.code, w]));

      for (const opp of opportunities) {
        const weekly = weeklyMap.get(opp.code);
        if (weekly && !weekly.confirmed && weekly.confidenceAdj < 0) {
          reasoning.push(`⏸️ ${opp.name} 盘中${opp.finalScore}分但周线矛盾`);
          continue;
        }

        const q = quoteMap.get(opp.code)!;
        // 放宽追涨限制：涨幅<5%可买（捕捉趋势票）
        if (q.changePercent > 5) {
          reasoning.push(`⏸️ ${opp.name} ${opp.finalScore}分但今日涨${r2(q.changePercent)}%，不追高`);
          continue;
        }

        const reserveCash = state.initialCapital * CASH_RESERVE_PCT;
        const posScale = thresholds.positionSizeMultiplier * (q.changePercent < 0 ? 0.9 : 0.75);
        const maxBuyAmount = Math.min((state.cash - reserveCash) * 0.85 * posScale, state.cash - 500);
        if (maxBuyAmount < MIN_TRADE_AMOUNT) continue;

        const buyPrice = q.price * (1 + SLIPPAGE_RATE);
        const buyShares = Math.floor(maxBuyAmount / buyPrice / LOT_SIZE) * LOT_SIZE;
        if (buyShares < LOT_SIZE) continue;

        const amount = buyShares * buyPrice;
        const commission = calcCommission(amount);
        const slippage = amount * SLIPPAGE_RATE;
        const totalCost = amount + commission;
        if (totalCost > state.cash - 500) continue;

        state.cash -= totalCost;
        state.totalCommission += commission;
        state.totalSlippage += slippage;

        const posBonus = weekly?.confirmed ? " +周线共振" : "";
        state.holdings.push({
          code: opp.code, name: opp.name, sector: opp.sector || "",
          buyDate: today, buyPrice, currentPrice: q.price,
          shares: buyShares, costAmount: totalCost,
          currentValue: buyShares * q.price,
          pnl: 0, pnlPercent: 0,
          canSellToday: false,
          holdDays: 0, peakPrice: buyPrice,
          trailingStopPct: TRAILING_STOP_BASE,
          quantScore: opp.finalScore,
        });

        state.trades.push({
          date: today, time: now, code: opp.code, name: opp.name, sector: opp.sector || "",
          type: "买入", price: buyPrice, shares: buyShares, amount: totalCost,
          commission, slippage, stampTax: 0, totalCost: commission + slippage,
          reason: `盘中机会买入: 量化${opp.finalScore}分 ${opp.matrixConsensus}${posBonus}`,
          quantScore: opp.finalScore,
        });

        actions.push({
          type: "买入", code: opp.code, name: opp.name, sector: opp.sector || "",
          shares: buyShares, amount: totalCost,
          reason: `盘中: ${opp.finalScore}分 ${opp.matrixConsensus}${posBonus}`,
          quantScore: opp.finalScore,
        });
        reasoning.push(`🚀 盘中买入 ${opp.name} ${buyShares}股 @${buyPrice.toFixed(2)} (${opp.finalScore}分)`);
        changed = true;
      }
    }
  }

  // == 涨停预判扫描 ==
  const limitUpAlerts = scanLimitUpCandidates(quotes);
  if (limitUpAlerts.length > 0) {
    const top3 = limitUpAlerts.filter(a => a.phase !== "封板").slice(0, 3);
    if (top3.length > 0) {
      reasoning.push(`🔥 涨停预判 ${top3.map(a => `${a.name}(${a.phase}${a.distancePercent > 0 ? ` 差${a.distancePercent}%` : " 触板"})`).join("、")}`);
    }
  }

  if (changed) {
    saveStockPortfolio(state);
  }

  return {
    triggered: changed || limitUpAlerts.filter(a => a.phase !== "封板").length > 0,
    actions,
    reasoning: reasoning.join(" | ") || "盘中无异常",
    portfolio: state,
    limitUpAlerts,
  };
}
