/**
 * 回测引擎
 *
 * 用历史K线数据模拟量化策略执行，输出：
 *   - 每日净值曲线
 *   - 累计收益率 / 年化收益率
 *   - 夏普比率 / 索提诺比率
 *   - 最大回撤 + 最大回撤持续天数
 *   - 胜率 / 盈亏比
 *   - 每笔交易明细
 */

import type { KLineData, EnrichedSectorData, NorthboundFlow } from "./stock-api";

// ================================================================
//  类型定义
// ================================================================

export interface BacktestConfig {
  initialCapital: number;        // 初始资金
  maxHoldings: number;           // 最大持仓数
  buyThreshold: number;          // finalScore 买入阈值
  sellThreshold: number;         // finalScore 卖出阈值
  stopLossPct: number;           // 止损%
  takeProfitPct: number;         // 止盈%
  trailingStopPct: number;       // 移动止损%
  slippage: number;              // 滑点（单程，如 0.001 = 0.1%）
  commission: number;            // 手续费率（单程）
}

export interface BacktestTrade {
  date: string;
  code: string;
  name: string;
  type: "买入" | "卖出";
  price: number;
  amount: number;
  reason: string;
  pnl: number;                   // 卖出时的盈亏
  pnlPct: number;
  holdDays: number;
}

export interface BacktestDailySnapshot {
  date: string;
  totalValue: number;
  cash: number;
  holdingValue: number;
  holdingCount: number;
  dailyReturn: number;           // 日收益率%
}

export interface BacktestResult {
  config: BacktestConfig;
  startDate: string;
  endDate: string;
  tradingDays: number;

  // 收益指标
  totalReturn: number;           // 总收益%
  annualizedReturn: number;      // 年化收益%
  benchmarkReturn: number;       // 基准（等权持有）收益%
  alpha: number;                 // 超额收益%

  // 风险指标
  sharpeRatio: number;           // 夏普比率（年化）
  sortinoRatio: number;          // 索提诺比率
  maxDrawdown: number;           // 最大回撤%
  maxDrawdownDuration: number;   // 最大回撤持续天数
  volatility: number;            // 年化波动率%
  calmarRatio: number;           // Calmar比率（年化收益/最大回撤）

  // 交易统计
  totalTrades: number;
  winRate: number;               // 胜率%
  avgWin: number;                // 平均盈利%
  avgLoss: number;               // 平均亏损%
  profitFactor: number;          // 盈亏比
  avgHoldDays: number;           // 平均持仓天数

  // 明细
  trades: BacktestTrade[];
  dailySnapshots: BacktestDailySnapshot[];
  equityCurve: { date: string; value: number }[];
}

// ================================================================
//  默认配置
// ================================================================

const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 10000,
  maxHoldings: 3,
  buyThreshold: 15,
  sellThreshold: -5,
  stopLossPct: 5,
  takeProfitPct: 8,
  trailingStopPct: 3,
  slippage: 0.001,
  commission: 0.0003,
};

// ================================================================
//  回测引擎
// ================================================================

interface BacktestHolding {
  code: string;
  name: string;
  buyDate: string;
  buyPrice: number;
  shares: number;
  costAmount: number;
  peakPrice: number;
}

/**
 * 简化回测：用K线收盘价模拟
 * 输入：每只ETF的完整历史K线 + 每日量化分数
 */
export function runBacktest(
  dailyScores: Map<string, { date: string; code: string; name: string; score: number }[]>,
  klineMap: Record<string, KLineData[]>,
  config?: Partial<BacktestConfig>,
): BacktestResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const allDates = extractSortedDates(klineMap);

  if (allDates.length < 20) {
    return emptyResult(cfg);
  }

  // 构建价格查找表
  const priceMap = new Map<string, Map<string, number>>(); // code -> date -> close
  for (const [code, klines] of Object.entries(klineMap)) {
    const m = new Map<string, number>();
    for (const k of klines) m.set(k.date, k.close);
    priceMap.set(code, m);
  }

  // 构建分数查找表: date -> code -> score
  const scoreByDate = new Map<string, Map<string, { code: string; name: string; score: number }>>();
  for (const [code, entries] of dailyScores) {
    for (const e of entries) {
      if (!scoreByDate.has(e.date)) scoreByDate.set(e.date, new Map());
      scoreByDate.get(e.date)!.set(e.code, e);
    }
  }

  let cash = cfg.initialCapital;
  const holdings: BacktestHolding[] = [];
  const trades: BacktestTrade[] = [];
  const dailySnapshots: BacktestDailySnapshot[] = [];
  const equityCurve: { date: string; value: number }[] = [];
  let prevTotalValue = cfg.initialCapital;

  // 从第21天开始交易（留20天给因子计算）
  const tradeDates = allDates.slice(20);

  for (const date of tradeDates) {
    const scores = scoreByDate.get(date);

    // 1. 更新持仓市值
    for (const h of holdings) {
      const price = priceMap.get(h.code)?.get(date);
      if (price && price > h.peakPrice) h.peakPrice = price;
    }

    // 2. 卖出逻辑
    const toRemove: number[] = [];
    for (let i = 0; i < holdings.length; i++) {
      const h = holdings[i];
      const price = priceMap.get(h.code)?.get(date);
      if (!price) continue;

      const pnlPct = ((price - h.buyPrice) / h.buyPrice) * 100;
      const drawdownFromPeak = ((h.peakPrice - price) / h.peakPrice) * 100;
      const score = scores?.get(h.code)?.score || 0;
      const holdDays = daysBetween(h.buyDate, date);

      let sellReason = "";
      if (pnlPct <= -cfg.stopLossPct) {
        sellReason = `止损${pnlPct.toFixed(1)}%`;
      } else if (pnlPct >= cfg.takeProfitPct) {
        sellReason = `止盈+${pnlPct.toFixed(1)}%`;
      } else if (drawdownFromPeak >= cfg.trailingStopPct && holdDays >= 1) {
        sellReason = `移动止损(峰值回撤${drawdownFromPeak.toFixed(1)}%)`;
      } else if (score < cfg.sellThreshold && holdDays >= 2) {
        sellReason = `信号恶化(分${score})`;
      }

      if (sellReason) {
        const sellPrice = price * (1 - cfg.slippage);
        const proceeds = h.shares * sellPrice * (1 - cfg.commission);
        const pnl = proceeds - h.costAmount;
        cash += proceeds;
        trades.push({
          date, code: h.code, name: h.name, type: "卖出",
          price: sellPrice, amount: proceeds, reason: sellReason,
          pnl, pnlPct: (pnl / h.costAmount) * 100, holdDays,
        });
        toRemove.push(i);
      }
    }
    // 从后往前删除
    for (let i = toRemove.length - 1; i >= 0; i--) {
      holdings.splice(toRemove[i], 1);
    }

    // 3. 买入逻辑
    if (scores && holdings.length < cfg.maxHoldings) {
      const holdCodes = new Set(holdings.map(h => h.code));
      const holdSectors = new Set(holdings.map(h => h.name)); // 简化：用name近似sector

      const candidates = [...scores.values()]
        .filter(s => s.score >= cfg.buyThreshold && !holdCodes.has(s.code))
        .sort((a, b) => b.score - a.score);

      const slotsLeft = cfg.maxHoldings - holdings.length;
      const topN = candidates.slice(0, slotsLeft);

      for (const c of topN) {
        const price = priceMap.get(c.code)?.get(date);
        if (!price || cash < 100) continue;

        const buyPrice = price * (1 + cfg.slippage);
        const totalScoreSum = topN.reduce((s, x) => s + Math.max(x.score, 10), 0);
        const weight = Math.max(c.score, 10) / totalScoreSum;
        let buyAmount = Math.min(cash * 0.95 * weight, cash * 0.95 / topN.length * 1.5);
        buyAmount = Math.max(100, Math.floor(buyAmount));
        if (buyAmount > cash - 50) buyAmount = cash - 50;
        if (buyAmount < 100) continue;

        const costWithCommission = buyAmount * (1 + cfg.commission);
        const shares = buyAmount / buyPrice;
        cash -= costWithCommission;

        holdings.push({
          code: c.code, name: c.name, buyDate: date,
          buyPrice, shares, costAmount: costWithCommission, peakPrice: buyPrice,
        });
        trades.push({
          date, code: c.code, name: c.name, type: "买入",
          price: buyPrice, amount: costWithCommission,
          reason: `量化分${c.score}`, pnl: 0, pnlPct: 0, holdDays: 0,
        });
      }
    }

    // 4. 日终快照
    const holdingValue = holdings.reduce((s, h) => {
      const price = priceMap.get(h.code)?.get(date) || h.buyPrice;
      return s + h.shares * price;
    }, 0);
    const totalValue = cash + holdingValue;
    const dailyReturn = prevTotalValue > 0 ? ((totalValue - prevTotalValue) / prevTotalValue) * 100 : 0;

    dailySnapshots.push({
      date, totalValue: r2(totalValue), cash: r2(cash),
      holdingValue: r2(holdingValue), holdingCount: holdings.length,
      dailyReturn: r2(dailyReturn),
    });
    equityCurve.push({ date, value: r2(totalValue) });
    prevTotalValue = totalValue;
  }

  // 强制清仓（回测结束）
  const lastDate = tradeDates[tradeDates.length - 1];
  for (const h of holdings) {
    const price = priceMap.get(h.code)?.get(lastDate) || h.buyPrice;
    const proceeds = h.shares * price;
    const pnl = proceeds - h.costAmount;
    cash += proceeds;
    trades.push({
      date: lastDate, code: h.code, name: h.name, type: "卖出",
      price, amount: proceeds, reason: "回测结束清仓",
      pnl, pnlPct: (pnl / h.costAmount) * 100,
      holdDays: daysBetween(h.buyDate, lastDate),
    });
  }

  // ===== 计算指标 =====
  return calcMetrics(cfg, trades, dailySnapshots, equityCurve, klineMap, tradeDates);
}

// ================================================================
//  指标计算
// ================================================================

function calcMetrics(
  cfg: BacktestConfig,
  trades: BacktestTrade[],
  dailySnapshots: BacktestDailySnapshot[],
  equityCurve: { date: string; value: number }[],
  klineMap: Record<string, KLineData[]>,
  tradeDates: string[],
): BacktestResult {
  const startDate = tradeDates[0] || "";
  const endDate = tradeDates[tradeDates.length - 1] || "";
  const tradingDays = tradeDates.length;
  const years = tradingDays / 252;

  const finalValue = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].value : cfg.initialCapital;
  const totalReturn = ((finalValue - cfg.initialCapital) / cfg.initialCapital) * 100;
  const annualizedReturn = years > 0 ? (Math.pow(finalValue / cfg.initialCapital, 1 / years) - 1) * 100 : 0;

  // 基准收益（等权持有所有ETF）
  let benchmarkReturn = 0;
  const codes = Object.keys(klineMap);
  if (codes.length > 0 && tradeDates.length > 0) {
    let benchSum = 0;
    let benchCount = 0;
    for (const code of codes) {
      const klines = klineMap[code];
      const first = klines.find(k => k.date >= tradeDates[0]);
      const last = klines.find(k => k.date >= tradeDates[tradeDates.length - 1]) || klines[klines.length - 1];
      if (first && last) {
        benchSum += ((last.close - first.close) / first.close) * 100;
        benchCount++;
      }
    }
    benchmarkReturn = benchCount > 0 ? benchSum / benchCount : 0;
  }

  // 日收益序列
  const dailyReturns = dailySnapshots.map(s => s.dailyReturn / 100);

  // 波动率
  const avgDailyRet = dailyReturns.length > 0 ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length : 0;
  const variance = dailyReturns.length > 1
    ? dailyReturns.reduce((s, r) => s + (r - avgDailyRet) ** 2, 0) / (dailyReturns.length - 1) : 0;
  const dailyVol = Math.sqrt(variance);
  const volatility = dailyVol * Math.sqrt(252) * 100;

  // 夏普比率（无风险利率假设2%年化）
  const rfDaily = 0.02 / 252;
  const sharpeRatio = dailyVol > 0 ? (avgDailyRet - rfDaily) / dailyVol * Math.sqrt(252) : 0;

  // 索提诺比率（只看下行波动）
  const downsideReturns = dailyReturns.filter(r => r < rfDaily);
  const downsideVar = downsideReturns.length > 1
    ? downsideReturns.reduce((s, r) => s + (r - rfDaily) ** 2, 0) / (downsideReturns.length - 1) : 0;
  const downsideVol = Math.sqrt(downsideVar);
  const sortinoRatio = downsideVol > 0 ? (avgDailyRet - rfDaily) / downsideVol * Math.sqrt(252) : 0;

  // 最大回撤
  let peak = cfg.initialCapital;
  let maxDD = 0;
  let maxDDDuration = 0;
  let currentDDStart = 0;
  for (let i = 0; i < equityCurve.length; i++) {
    const v = equityCurve[i].value;
    if (v > peak) {
      peak = v;
      currentDDStart = i;
    }
    const dd = ((peak - v) / peak) * 100;
    if (dd > maxDD) {
      maxDD = dd;
      maxDDDuration = i - currentDDStart;
    }
  }

  const calmarRatio = maxDD > 0 ? annualizedReturn / maxDD : 0;

  // 交易统计
  const sellTrades = trades.filter(t => t.type === "卖出");
  const wins = sellTrades.filter(t => t.pnl > 0);
  const losses = sellTrades.filter(t => t.pnl <= 0);
  const winRate = sellTrades.length > 0 ? (wins.length / sellTrades.length) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
  const totalWin = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 999 : 0;
  const avgHoldDays = sellTrades.length > 0 ? sellTrades.reduce((s, t) => s + t.holdDays, 0) / sellTrades.length : 0;

  return {
    config: cfg,
    startDate, endDate, tradingDays,
    totalReturn: r2(totalReturn),
    annualizedReturn: r2(annualizedReturn),
    benchmarkReturn: r2(benchmarkReturn),
    alpha: r2(totalReturn - benchmarkReturn),
    sharpeRatio: r2(sharpeRatio),
    sortinoRatio: r2(sortinoRatio),
    maxDrawdown: r2(maxDD),
    maxDrawdownDuration: maxDDDuration,
    volatility: r2(volatility),
    calmarRatio: r2(calmarRatio),
    totalTrades: sellTrades.length,
    winRate: r2(winRate),
    avgWin: r2(avgWin),
    avgLoss: r2(avgLoss),
    profitFactor: r2(profitFactor),
    avgHoldDays: r2(avgHoldDays),
    trades,
    dailySnapshots,
    equityCurve,
  };
}

// ================================================================
//  工具
// ================================================================

function extractSortedDates(klineMap: Record<string, KLineData[]>): string[] {
  const dateSet = new Set<string>();
  for (const klines of Object.values(klineMap)) {
    for (const k of klines) dateSet.add(k.date);
  }
  return [...dateSet].sort();
}

function daysBetween(d1: string, d2: string): number {
  return Math.max(0, Math.round((new Date(d2).getTime() - new Date(d1).getTime()) / 86400000));
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyResult(cfg: BacktestConfig): BacktestResult {
  return {
    config: cfg, startDate: "", endDate: "", tradingDays: 0,
    totalReturn: 0, annualizedReturn: 0, benchmarkReturn: 0, alpha: 0,
    sharpeRatio: 0, sortinoRatio: 0, maxDrawdown: 0, maxDrawdownDuration: 0,
    volatility: 0, calmarRatio: 0,
    totalTrades: 0, winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, avgHoldDays: 0,
    trades: [], dailySnapshots: [], equityCurve: [],
  };
}

// ================================================================
//  Walk-Forward 回测（滚动窗口，避免过拟合）
// ================================================================

export interface WalkForwardConfig {
  trainDays: number;         // 训练窗口（天）
  testDays: number;          // 测试窗口（天）
  paramGrid: Partial<BacktestConfig>[]; // 参数网格
}

export interface WalkForwardWindow {
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  bestParams: Partial<BacktestConfig>;
  trainSharpe: number;
  testSharpe: number;
  testReturn: number;
  overfitRatio: number;     // testSharpe / trainSharpe (越接近1越好)
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  aggregateTestReturn: number;     // 所有测试窗口累计收益
  aggregateTestSharpe: number;     // 测试期综合夏普
  avgOverfitRatio: number;         // 平均过拟合比率
  robustParams: Partial<BacktestConfig>; // 鲁棒性最高的参数组合
  paramStability: { param: string; values: number[]; cv: number }[];
}

/**
 * Walk-Forward回测：用训练窗口选最优参数，在测试窗口验证
 * 滚动前进，测量样本外表现
 */
export function runWalkForward(
  dailyScores: Map<string, { date: string; code: string; name: string; score: number }[]>,
  klineMap: Record<string, KLineData[]>,
  wfConfig?: Partial<WalkForwardConfig>,
): WalkForwardResult {
  const cfg: WalkForwardConfig = {
    trainDays: wfConfig?.trainDays || 60,
    testDays: wfConfig?.testDays || 20,
    paramGrid: wfConfig?.paramGrid || DEFAULT_PARAM_GRID,
  };

  const allDates = extractSortedDates(klineMap);
  if (allDates.length < cfg.trainDays + cfg.testDays + 20) {
    return { windows: [], aggregateTestReturn: 0, aggregateTestSharpe: 0, avgOverfitRatio: 0, robustParams: {}, paramStability: [] };
  }

  const windows: WalkForwardWindow[] = [];
  let cursor = 20; // 跳过因子需要的20天数据

  while (cursor + cfg.trainDays + cfg.testDays <= allDates.length) {
    const trainStart = allDates[cursor];
    const trainEnd = allDates[cursor + cfg.trainDays - 1];
    const testStart = allDates[cursor + cfg.trainDays];
    const testEnd = allDates[Math.min(cursor + cfg.trainDays + cfg.testDays - 1, allDates.length - 1)];

    // 切分K线和分数到训练窗口
    const trainKlines = sliceKlineMap(klineMap, allDates.slice(0, cursor + cfg.trainDays));
    const testKlines = sliceKlineMap(klineMap, allDates.slice(0, cursor + cfg.trainDays + cfg.testDays));

    const trainScores = sliceScores(dailyScores, trainStart, trainEnd);
    const testScores = sliceScores(dailyScores, testStart, testEnd);

    // 在训练集上跑所有参数组合，选最高夏普
    let bestSharpe = -Infinity;
    let bestParams: Partial<BacktestConfig> = {};

    for (const params of cfg.paramGrid) {
      const result = runBacktest(trainScores, trainKlines, params);
      if (result.sharpeRatio > bestSharpe) {
        bestSharpe = result.sharpeRatio;
        bestParams = params;
      }
    }

    // 用最佳参数在测试集上验证
    const testResult = runBacktest(testScores, testKlines, bestParams);
    const overfitRatio = bestSharpe > 0 ? testResult.sharpeRatio / bestSharpe : 0;

    windows.push({
      trainStart, trainEnd, testStart, testEnd,
      bestParams,
      trainSharpe: r2(bestSharpe),
      testSharpe: r2(testResult.sharpeRatio),
      testReturn: r2(testResult.totalReturn),
      overfitRatio: r2(overfitRatio),
    });

    cursor += cfg.testDays; // 滚动前进
  }

  // 汇总指标
  const aggregateTestReturn = windows.reduce((s, w) => s + w.testReturn, 0);
  const testSharpes = windows.map(w => w.testSharpe).filter(s => s !== 0);
  const aggregateTestSharpe = testSharpes.length > 0 ? testSharpes.reduce((s, v) => s + v, 0) / testSharpes.length : 0;
  const avgOverfitRatio = windows.length > 0 ? windows.reduce((s, w) => s + w.overfitRatio, 0) / windows.length : 0;

  // 找鲁棒参数（出现最频繁 + 过拟合比率最高的）
  const robustParams = findRobustParams(windows);

  // 参数稳定性分析
  const paramStability = analyzeParamStability(windows);

  return {
    windows,
    aggregateTestReturn: r2(aggregateTestReturn),
    aggregateTestSharpe: r2(aggregateTestSharpe),
    avgOverfitRatio: r2(avgOverfitRatio),
    robustParams,
    paramStability,
  };
}

// 默认参数网格
const DEFAULT_PARAM_GRID: Partial<BacktestConfig>[] = [
  { buyThreshold: 10, sellThreshold: -5, stopLossPct: 5, trailingStopPct: 3 },
  { buyThreshold: 15, sellThreshold: -5, stopLossPct: 5, trailingStopPct: 3 },
  { buyThreshold: 20, sellThreshold: -10, stopLossPct: 5, trailingStopPct: 3 },
  { buyThreshold: 15, sellThreshold: -5, stopLossPct: 3, trailingStopPct: 2 },
  { buyThreshold: 15, sellThreshold: -5, stopLossPct: 8, trailingStopPct: 5 },
  { buyThreshold: 10, sellThreshold: -10, stopLossPct: 5, trailingStopPct: 4 },
  { buyThreshold: 20, sellThreshold: -5, stopLossPct: 3, trailingStopPct: 2 },
  { buyThreshold: 15, sellThreshold: 0, stopLossPct: 5, trailingStopPct: 3 },
];

function sliceKlineMap(klineMap: Record<string, KLineData[]>, dates: string[]): Record<string, KLineData[]> {
  const dateSet = new Set(dates);
  const result: Record<string, KLineData[]> = {};
  for (const [code, klines] of Object.entries(klineMap)) {
    result[code] = klines.filter(k => dateSet.has(k.date));
  }
  return result;
}

function sliceScores(
  dailyScores: Map<string, { date: string; code: string; name: string; score: number }[]>,
  startDate: string,
  endDate: string,
): Map<string, { date: string; code: string; name: string; score: number }[]> {
  const result = new Map<string, { date: string; code: string; name: string; score: number }[]>();
  for (const [code, entries] of dailyScores) {
    result.set(code, entries.filter(e => e.date >= startDate && e.date <= endDate));
  }
  return result;
}

function findRobustParams(windows: WalkForwardWindow[]): Partial<BacktestConfig> {
  if (windows.length === 0) return {};
  // 选过拟合比率最高的几个窗口中最常出现的参数
  const goodWindows = windows.filter(w => w.overfitRatio > 0.5).sort((a, b) => b.overfitRatio - a.overfitRatio);
  const source = goodWindows.length > 0 ? goodWindows : windows;

  // 对每个参数取中位数
  const buyThresholds = source.map(w => w.bestParams.buyThreshold).filter((v): v is number => v !== undefined);
  const sellThresholds = source.map(w => w.bestParams.sellThreshold).filter((v): v is number => v !== undefined);
  const stopLosses = source.map(w => w.bestParams.stopLossPct).filter((v): v is number => v !== undefined);
  const trailingStops = source.map(w => w.bestParams.trailingStopPct).filter((v): v is number => v !== undefined);

  return {
    buyThreshold: median(buyThresholds),
    sellThreshold: median(sellThresholds),
    stopLossPct: median(stopLosses),
    trailingStopPct: median(trailingStops),
  };
}

function analyzeParamStability(windows: WalkForwardWindow[]): { param: string; values: number[]; cv: number }[] {
  if (windows.length < 2) return [];
  const params: { param: string; extract: (w: WalkForwardWindow) => number | undefined }[] = [
    { param: "buyThreshold", extract: w => w.bestParams.buyThreshold },
    { param: "sellThreshold", extract: w => w.bestParams.sellThreshold },
    { param: "stopLossPct", extract: w => w.bestParams.stopLossPct },
    { param: "trailingStopPct", extract: w => w.bestParams.trailingStopPct },
  ];

  return params.map(p => {
    const values = windows.map(w => p.extract(w)).filter((v): v is number => v !== undefined);
    const mean = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    const stdVal = values.length > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)) : 0;
    const cv = mean !== 0 ? Math.abs(stdVal / mean) : 0; // 变异系数: 越小越稳定
    return { param: p.param, values, cv: r2(cv) };
  });
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ================================================================
//  动态滑点模型
// ================================================================

/**
 * 基于波动率和成交量动态估算滑点
 * 高波动+低成交量 → 滑点大
 * 低波动+高成交量 → 滑点小
 */
export function estimateSlippage(
  volatility20d: number,  // 20日年化波动率%
  volumeRatio: number,    // 当日量/20日均量
  orderSize: number,      // 订单金额
  avgDailyTurnover: number, // 日均成交额
): number {
  // 基础滑点 0.05%
  let slippage = 0.0005;

  // 波动率调整：波动率每增加10%年化，滑点+0.02%
  slippage += Math.max(0, (volatility20d - 15) / 10) * 0.0002;

  // 成交量调整：缩量时滑点增大
  if (volumeRatio < 0.5) slippage *= 2;
  else if (volumeRatio < 0.8) slippage *= 1.3;
  else if (volumeRatio > 2) slippage *= 0.7; // 放量时滑点缩小

  // 订单冲击：订单占日均成交额比例
  if (avgDailyTurnover > 0) {
    const impactRatio = orderSize / avgDailyTurnover;
    if (impactRatio > 0.01) slippage += impactRatio * 0.5; // >1%日成交有冲击
    else if (impactRatio > 0.005) slippage += impactRatio * 0.2;
  }

  return Math.min(0.01, Math.max(0.0002, slippage)); // 限制在0.02%~1%
}
