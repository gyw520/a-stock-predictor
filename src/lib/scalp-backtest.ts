/**
 * 超短线回测引擎
 *
 * 用历史K线数据模拟超短线策略，验证胜率和盈亏比
 *
 * 回测逻辑：
 *   1. 找出历史上每天的涨停股（收盘涨幅≥9.7%视为涨停）
 *   2. 模拟次日竞价买入（open价格），判断各种止损止盈条件
 *   3. 模拟首板打板（当天涨停买入，次日open卖出）
 *   4. 统计胜率、盈亏比、平均持有天数等
 *
 * 新增可回测的信号维度：
 *   - 竞价量比（开盘量/前5日均量）
 *   - 封板时间近似（以日内振幅推断）
 *   - 量价配合度（量升价升vs量增价滞）
 *   - 板块联动性（同板块涨停数）
 *   - 分时强度（(close-low)/(high-low) 在高位=强势）
 *   - 连板高度（连续涨停天数）
 */

import type { KLineData } from "./stock-api";

// ================================================================
//  类型定义
// ================================================================

export interface ScalpBacktestConfig {
  initialCapital: number;
  maxHoldings: number;
  stopLossPct: number;         // 止损线 (负数, 如 -2 表示亏2%止损)
  takeProfitPct: number;       // 止盈起始线
  trailingLockPct: number;     // 移动止盈回撤
  maxHoldDays: number;         // 最长持有天数
  maxChaseOpenPct: number;     // 竞价高开上限 (不追高开超过此值的)
  cutLossOpenPct: number;      // 竞价低开割肉线 (低开超过此值直接割)
  slippage: number;
  commission: number;
  stampTax: number;
  // 选股过滤
  minTurnoverRate: number;     // 最低换手率%
  maxTurnoverRate: number;     // 最高换手率%
  minAmount: number;           // 最低成交额(元)
  minQualityScore: number;     // 最低质量评分(0-100)
  // 新增策略开关
  enableAuctionBuy: boolean;   // 极优板竞价买入
  enableFirstBoard: boolean;   // 首板打板
  enableLeaderDip: boolean;    // 龙头低吸
  // 情绪过滤
  enableEmotionFilter: boolean;// 开启情绪过滤
  minLimitUpCount: number;     // 最少涨停家数才允许操作
}

export interface ScalpBacktestTrade {
  buyDate: string;
  sellDate: string;
  code: string;
  name: string;
  strategy: string;
  buyPrice: number;
  sellPrice: number;
  shares: number;
  holdDays: number;
  pnl: number;
  pnlPct: number;
  sellReason: string;
  // 买入时的因子值
  factors: {
    turnoverRate: number;       // 涨停日换手率
    volumeRatio: number;        // 量比(当日量/前5日均量)
    closeStrength: number;      // 分时强度 (c-l)/(h-l)
    amplitude: number;          // 振幅%
    consecutiveUp: number;      // 连涨天数
    prevDayChange: number;      // 前一日涨幅%
    gapOpenPct: number;         // 买入日开盘缺口%
    boardCount: number;         // 当天全市场涨停数(近似)
  };
}

export interface ScalpBacktestResult {
  config: ScalpBacktestConfig;
  period: string;              // "2024-01-01 ~ 2024-12-31"
  tradingDays: number;

  // 核心指标
  totalTrades: number;
  winRate: number;             // 胜率%
  avgWin: number;              // 平均盈利%
  avgLoss: number;             // 平均亏损%
  profitFactor: number;        // 盈亏比
  expectancy: number;          // 期望值(每笔平均收益%)
  avgHoldDays: number;

  // 收益
  totalReturn: number;         // 总收益%
  maxDrawdown: number;         // 最大回撤%
  weeklyReturn: number;        // 周均收益%

  // 分策略统计
  strategyStats: {
    strategy: string;
    trades: number;
    winRate: number;
    avgPnl: number;
    profitFactor: number;
  }[];

  // 因子分析：哪些因子值区间胜率最高
  factorAnalysis: {
    factor: string;
    bins: { range: string; trades: number; winRate: number; avgPnl: number }[];
    bestBin: string;
  }[];

  // 明细
  trades: ScalpBacktestTrade[];
  equityCurve: { date: string; value: number }[];

  // 建议
  suggestions: string[];
}

// ================================================================
//  默认配置
// ================================================================

const DEFAULT_CONFIG: ScalpBacktestConfig = {
  initialCapital: 10000,
  maxHoldings: 1,
  stopLossPct: -2,
  takeProfitPct: 5,
  trailingLockPct: 3,
  maxHoldDays: 3,
  maxChaseOpenPct: 7,
  cutLossOpenPct: -3,
  slippage: 0.001,
  commission: 0.00025,
  stampTax: 0.0005,
  minTurnoverRate: 3,
  maxTurnoverRate: 25,
  minAmount: 50000000,   // 5000万(回测用较低门槛)
  minQualityScore: 50,
  enableAuctionBuy: true,
  enableFirstBoard: true,
  enableLeaderDip: true,
  enableEmotionFilter: true,
  minLimitUpCount: 10,
};

// ================================================================
//  回测主函数
// ================================================================

/**
 * 跑超短线回测
 * @param klineMap  股票代码 -> K线数据 (需要至少30天)
 * @param config    回测配置
 */
export function runScalpBacktest(
  klineMap: Record<string, { name: string; klines: KLineData[] }>,
  config?: Partial<ScalpBacktestConfig>,
): ScalpBacktestResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // 构建每日数据
  const allDates = extractSortedDates(klineMap);
  if (allDates.length < 30) return emptyResult(cfg, allDates);

  // 价格映射: code -> date -> KLineData
  const dataMap = new Map<string, Map<string, KLineData>>();
  const nameMap = new Map<string, string>();
  for (const [code, { name, klines }] of Object.entries(klineMap)) {
    const m = new Map<string, KLineData>();
    for (const k of klines) m.set(k.date, k);
    dataMap.set(code, m);
    nameMap.set(code, name || code);
  }

  // 用于传递给findLimitUpStocks
  const nameMapRef = nameMap;

  // 从第6天开始(需要5日均量)
  const tradeDates = allDates.slice(5);

  let cash = cfg.initialCapital;
  const trades: ScalpBacktestTrade[] = [];
  const equityCurve: { date: string; value: number }[] = [];

  interface BTHolding {
    code: string; name: string; strategy: string;
    buyDate: string; buyPrice: number; shares: number;
    costAmount: number; peakPrice: number;
    factors: ScalpBacktestTrade["factors"];
  }
  let holdings: BTHolding[] = [];

  for (let dayIdx = 0; dayIdx < tradeDates.length; dayIdx++) {
    const today = tradeDates[dayIdx];
    const yesterday = dayIdx > 0 ? tradeDates[dayIdx - 1] : null;

    // ==== 计算今日市场情绪(涨停家数) ====
    let todayLimitUpCount = 0;
    for (const [code, dm] of dataMap) {
      const k = dm.get(today);
      if (k && k.close > 0) {
        const pct = getChangePercent(dm, today, allDates, dayIdx + 5); // offset by 5 for tradeDates
        if (pct >= 9.7) todayLimitUpCount++;
      }
    }

    // ==== 更新持仓,检查卖出 ====
    const toSell: number[] = [];
    for (let i = 0; i < holdings.length; i++) {
      const h = holdings[i];
      const k = dataMap.get(h.code)?.get(today);
      if (!k) continue;

      const holdDays = daysBetween(h.buyDate, today);
      // T+1: 买入当天不能卖
      if (holdDays < 1) {
        if (k.high > h.peakPrice) h.peakPrice = k.high;
        continue;
      }

      let sellPrice = 0;
      let sellReason = "";

      // 1. 竞价低开割肉
      const openPct = h.buyPrice > 0 ? ((k.open - h.buyPrice) / h.buyPrice) * 100 : 0;
      if (openPct <= cfg.cutLossOpenPct) {
        sellPrice = k.open * (1 - cfg.slippage);
        sellReason = `竞价低开${openPct.toFixed(1)}%割肉`;
      }

      // 2. 止损
      if (!sellReason) {
        const lowPct = h.buyPrice > 0 ? ((k.low - h.buyPrice) / h.buyPrice) * 100 : 0;
        if (lowPct <= cfg.stopLossPct) {
          sellPrice = h.buyPrice * (1 + cfg.stopLossPct / 100) * (1 - cfg.slippage);
          sellReason = `止损${cfg.stopLossPct}%`;
        }
      }

      // 3. 超期清仓（用收盘价模拟14:30卖出）
      if (!sellReason && holdDays >= cfg.maxHoldDays) {
        sellPrice = k.close * (1 - cfg.slippage);
        sellReason = `持股${holdDays}天超期`;
      }

      // 4. 移动止盈
      if (!sellReason) {
        const pnlPct = h.buyPrice > 0 ? ((k.high - h.buyPrice) / h.buyPrice) * 100 : 0;
        if (pnlPct >= cfg.takeProfitPct) {
          // 日内冲高后看收盘是否回落
          const dropFromHigh = k.high > 0 ? ((k.high - k.close) / k.high) * 100 : 0;
          if (dropFromHigh >= cfg.trailingLockPct) {
            sellPrice = k.close * (1 - cfg.slippage);
            sellReason = `移动止盈(高${k.high.toFixed(2)}回落${dropFromHigh.toFixed(1)}%)`;
          } else if (h.peakPrice > 0) {
            const dropFromPeak = ((h.peakPrice - k.close) / h.peakPrice) * 100;
            if (dropFromPeak >= cfg.trailingLockPct) {
              sellPrice = k.close * (1 - cfg.slippage);
              sellReason = `移动止盈(峰值${h.peakPrice.toFixed(2)}回落${dropFromPeak.toFixed(1)}%)`;
            }
          }
        }
      }

      // 5. 冲高回落分时卖 (盈利但当天收阴)
      if (!sellReason && holdDays >= 1) {
        const pnlPctClose = h.buyPrice > 0 ? ((k.close - h.buyPrice) / h.buyPrice) * 100 : 0;
        if (pnlPctClose > 2 && k.close < k.open && holdDays >= 2) {
          sellPrice = k.close * (1 - cfg.slippage);
          sellReason = `冲高回落(盈${pnlPctClose.toFixed(1)}%收阴)`;
        }
      }

      if (sellReason && sellPrice > 0) {
        const sellAmount = h.shares * sellPrice;
        const commission = Math.max(5, sellAmount * cfg.commission);
        const stampTax = sellAmount * cfg.stampTax;
        const netProceeds = sellAmount - commission - stampTax;
        const pnl = netProceeds - h.costAmount;
        const pnlPct = h.costAmount > 0 ? (pnl / h.costAmount) * 100 : 0;

        cash += netProceeds;
        trades.push({
          buyDate: h.buyDate, sellDate: today, code: h.code, name: h.name,
          strategy: h.strategy, buyPrice: h.buyPrice, sellPrice, shares: h.shares,
          holdDays: daysBetween(h.buyDate, today), pnl, pnlPct, sellReason,
          factors: h.factors,
        });
        toSell.push(i);
      } else {
        if (k.high > h.peakPrice) h.peakPrice = k.high;
      }
    }
    // 删除已卖出
    for (let i = toSell.length - 1; i >= 0; i--) holdings.splice(toSell[i], 1);

    // ==== 买入逻辑 ====
    if (holdings.length < cfg.maxHoldings && cash > 2000 && yesterday) {
      // 情绪过滤
      if (cfg.enableEmotionFilter && todayLimitUpCount < cfg.minLimitUpCount) {
        // 涨停太少，不操作
      } else {
        // 找昨日涨停股
        const yesterdayLimitUps = findLimitUpStocks(dataMap, yesterday, allDates, dayIdx + 4, cfg, nameMapRef);

        // ==== 策略A: 极优板竞价买入 ====
        if (cfg.enableAuctionBuy && holdings.length < cfg.maxHoldings) {
          // 从昨日涨停中找质量最高的
          const qualitySorted = yesterdayLimitUps
            .map(lu => ({ ...lu, qualityScore: calcQualityScore(lu) }))
            .filter(lu => lu.qualityScore >= cfg.minQualityScore)
            .sort((a, b) => b.qualityScore - a.qualityScore);

          for (const candidate of qualitySorted.slice(0, 1)) {
            if (holdings.length >= cfg.maxHoldings) break;
            const todayK = dataMap.get(candidate.code)?.get(today);
            if (!todayK) continue;

            // 检查高开
            const yesterdayK = dataMap.get(candidate.code)?.get(yesterday);
            if (!yesterdayK) continue;
            const gapPct = ((todayK.open - yesterdayK.close) / yesterdayK.close) * 100;
            if (gapPct > cfg.maxChaseOpenPct || gapPct < cfg.cutLossOpenPct) continue;

            const bought = executeBTBuy(cfg, cash, todayK.open, candidate, today, "极优板竞价", gapPct);
            if (bought) {
              holdings.push(bought.holding);
              cash -= bought.cost;
            }
          }
        }

        // ==== 策略B: 首板打板 (当天涨停买入) ====
        if (cfg.enableFirstBoard && holdings.length < cfg.maxHoldings) {
          const todayLimitUps = findLimitUpStocks(dataMap, today, allDates, dayIdx + 5, cfg, nameMapRef);
          // 找最好的一只
          const best = todayLimitUps
            .map(lu => ({ ...lu, qualityScore: calcQualityScore(lu) }))
            .filter(lu => lu.qualityScore >= cfg.minQualityScore * 0.8) // 打板门槛略低
            .sort((a, b) => b.qualityScore - a.qualityScore);

          for (const candidate of best.slice(0, 1)) {
            if (holdings.length >= cfg.maxHoldings) break;
            const todayK = dataMap.get(candidate.code)?.get(today);
            if (!todayK) continue;

            // 以涨停价买入
            const bought = executeBTBuy(cfg, cash, todayK.close, candidate, today, "首板打板", 0);
            if (bought) {
              holdings.push(bought.holding);
              cash -= bought.cost;
            }
          }
        }

        // ==== 策略C: 龙头低吸 ====
        if (cfg.enableLeaderDip && holdings.length < cfg.maxHoldings) {
          // 找前天涨停、昨天也强(涨>0%)、今天回调的
          const twoDaysAgo = dayIdx >= 2 ? tradeDates[dayIdx - 2] : null;
          if (twoDaysAgo) {
            const twoDayLimitUps = findLimitUpStocks(dataMap, twoDaysAgo, allDates, dayIdx + 3, cfg, nameMapRef);
            for (const candidate of twoDayLimitUps.slice(0, 3)) {
              if (holdings.length >= cfg.maxHoldings) break;
              const yesterdayK = dataMap.get(candidate.code)?.get(yesterday!);
              const todayK = dataMap.get(candidate.code)?.get(today);
              if (!yesterdayK || !todayK) continue;

              // 昨天还涨(确认强势)
              const twoDayK = dataMap.get(candidate.code)?.get(twoDaysAgo);
              if (!twoDayK) continue;
              const yestPct = ((yesterdayK.close - twoDayK.close) / twoDayK.close) * 100;
              if (yestPct < 0) continue; // 昨天也要涨

              // 今天回调0.5-3%
              const todayPct = ((todayK.close - yesterdayK.close) / yesterdayK.close) * 100;
              if (todayPct > -0.5 || todayPct < -3) continue;

              // 在日内低位买入
              const strength = todayK.high > todayK.low ? (todayK.close - todayK.low) / (todayK.high - todayK.low) : 0.5;
              if (strength > 0.4) continue; // 只在低位买

              const buyPrice = todayK.close; // 尾盘低吸
              const bought = executeBTBuy(cfg, cash, buyPrice, { ...candidate, turnoverRate: todayK.volume / 10000 }, today, "龙头低吸", todayPct);
              if (bought) {
                holdings.push(bought.holding);
                cash -= bought.cost;
              }
            }
          }
        }
      }
    }

    // ==== 日终净值 ====
    let holdValue = 0;
    for (const h of holdings) {
      const k = dataMap.get(h.code)?.get(today);
      holdValue += h.shares * (k?.close || h.buyPrice);
    }
    equityCurve.push({ date: today, value: Math.round((cash + holdValue) * 100) / 100 });
  }

  // 强制清仓
  const lastDate = tradeDates[tradeDates.length - 1];
  for (const h of holdings) {
    const k = dataMap.get(h.code)?.get(lastDate);
    const sellPrice = (k?.close || h.buyPrice) * (1 - cfg.slippage);
    const sellAmount = h.shares * sellPrice;
    const commission = Math.max(5, sellAmount * cfg.commission);
    const stampTax = sellAmount * cfg.stampTax;
    const netProceeds = sellAmount - commission - stampTax;
    const pnl = netProceeds - h.costAmount;
    cash += netProceeds;
    trades.push({
      buyDate: h.buyDate, sellDate: lastDate, code: h.code, name: h.name,
      strategy: h.strategy, buyPrice: h.buyPrice, sellPrice, shares: h.shares,
      holdDays: daysBetween(h.buyDate, lastDate), pnl,
      pnlPct: h.costAmount > 0 ? (pnl / h.costAmount) * 100 : 0,
      sellReason: "回测结束清仓", factors: h.factors,
    });
  }

  return buildResult(cfg, trades, equityCurve, tradeDates);
}

// ================================================================
//  涨停识别 & 质量评分
// ================================================================

interface LimitUpCandidate {
  code: string;
  name: string;
  closePrice: number;
  changePercent: number;
  turnoverRate: number;
  volumeRatio: number;      // 量比
  closeStrength: number;    // 分时强度
  amplitude: number;        // 振幅
  consecutiveUp: number;    // 连涨天数
  amount: number;           // 成交额
}

function findLimitUpStocks(
  dataMap: Map<string, Map<string, KLineData>>,
  date: string,
  allDates: string[],
  dateAbsIdx: number,
  cfg: ScalpBacktestConfig,
  nameMap?: Map<string, string>,
): LimitUpCandidate[] {
  const results: LimitUpCandidate[] = [];
  // 安全边界检查
  if (dateAbsIdx < 1 || dateAbsIdx >= allDates.length) return results;

  for (const [code, dm] of dataMap) {
    // 只做主板
    if (!code.startsWith("60") && !code.startsWith("00")) continue;

    const k = dm.get(date);
    if (!k || k.close <= 0 || k.volume <= 0) continue;

    // 前一日收盘
    const prevDate = dateAbsIdx > 0 ? allDates[dateAbsIdx - 1] : null;
    const prevK = prevDate ? dm.get(prevDate) : null;
    if (!prevK || prevK.close <= 0) continue;

    const changePct = ((k.close - prevK.close) / prevK.close) * 100;
    if (changePct < 9.7) continue; // 非涨停

    // 成交额过滤
    if (k.amount < cfg.minAmount) continue;

    // 换手率近似：用量比*基准换手估算（K线无真实换手率字段）
    // 粗略估计：成交额/（股价*假设流通盘5亿股）→ 不可靠
    // 改为跳过换手率过滤，仅用成交额+量比
    const turnoverRate = 8; // 默认中等换手，回测时不严格过滤

    // 量比
    let avgVol5 = 0;
    for (let j = 1; j <= 5; j++) {
      const d = dateAbsIdx - j >= 0 ? allDates[dateAbsIdx - j] : null;
      const dk = d ? dm.get(d) : null;
      if (dk) avgVol5 += dk.volume;
    }
    avgVol5 /= 5;
    const volumeRatio = avgVol5 > 0 ? k.volume / avgVol5 : 1;

    // 分时强度
    const closeStrength = k.high > k.low ? (k.close - k.low) / (k.high - k.low) : 1;

    // 振幅
    const amplitude = prevK.close > 0 ? ((k.high - k.low) / prevK.close) * 100 : 0;

    // 连涨天数
    let consecutiveUp = 0;
    for (let j = 0; j < 5; j++) {
      const d1 = dateAbsIdx - j >= 0 ? allDates[dateAbsIdx - j] : null;
      const d2 = dateAbsIdx - j - 1 >= 0 ? allDates[dateAbsIdx - j - 1] : null;
      if (!d1 || !d2) break;
      const k1 = dm.get(d1);
      const k2 = dm.get(d2);
      if (k1 && k2 && k1.close > k2.close) consecutiveUp++;
      else break;
    }

    results.push({
      code, name: nameMap?.get(code) || code, closePrice: k.close,
      changePercent: changePct, turnoverRate, volumeRatio,
      closeStrength, amplitude, consecutiveUp, amount: k.amount,
    });
  }

  return results.sort((a, b) => calcQualityScore(b) - calcQualityScore(a));
}

/**
 * 简化版质量评分（用K线数据推断）
 * 满分100分
 */
function calcQualityScore(c: LimitUpCandidate): number {
  let score = 0;

  // 1. 分时强度 (30分) — 收盘在最高位=封板不开
  if (c.closeStrength >= 0.99) score += 30;       // 完美封死
  else if (c.closeStrength >= 0.95) score += 25;  // 几乎封死
  else if (c.closeStrength >= 0.85) score += 15;  // 尾盘封板
  else score += 5;                                 // 炸板后回封

  // 2. 振幅 (20分) — 振幅小=一字板/早盘封板，质量高
  if (c.amplitude <= 2) score += 20;              // 几乎一字
  else if (c.amplitude <= 5) score += 15;         // 低振幅早封
  else if (c.amplitude <= 8) score += 10;         // 中等
  else score += 3;                                 // 大振幅=烂板

  // 3. 量比 (20分) — 适度放量好，极度放量不好
  if (c.volumeRatio >= 1.5 && c.volumeRatio <= 3) score += 20;  // 适度放量
  else if (c.volumeRatio >= 1 && c.volumeRatio <= 5) score += 12;
  else if (c.volumeRatio > 5) score += 5;         // 天量=分歧大
  else score += 8;                                 // 缩量=接力难度大

  // 4. 换手率 (15分) — 5-12%为最佳
  if (c.turnoverRate >= 5 && c.turnoverRate <= 12) score += 15;
  else if (c.turnoverRate >= 3 && c.turnoverRate <= 20) score += 8;
  else score += 3;

  // 5. 连板加分 (15分)
  if (c.consecutiveUp >= 3) score += 15;          // 3连板+
  else if (c.consecutiveUp >= 2) score += 10;     // 2板
  else score += 5;                                 // 首板

  return Math.min(100, score);
}

// ================================================================
//  买入执行
// ================================================================

function executeBTBuy(
  cfg: ScalpBacktestConfig,
  cash: number,
  buyPrice: number,
  candidate: LimitUpCandidate,
  today: string,
  strategy: string,
  gapOpenPct: number,
): { holding: any; cost: number } | null {
  const price = buyPrice * (1 + cfg.slippage);
  const maxAmount = cash - 500; // 留500缓冲
  if (maxAmount < 2000) return null;

  const shares = Math.floor(maxAmount / price / 100) * 100;
  if (shares < 100) return null;

  const amount = shares * price;
  const commission = Math.max(5, amount * cfg.commission);
  const totalCost = amount + commission;
  if (totalCost > cash - 500) return null;

  return {
    holding: {
      code: candidate.code, name: candidate.name, strategy,
      buyDate: today, buyPrice: price, shares,
      costAmount: totalCost, peakPrice: price,
      factors: {
        turnoverRate: candidate.turnoverRate,
        volumeRatio: candidate.volumeRatio,
        closeStrength: candidate.closeStrength,
        amplitude: candidate.amplitude,
        consecutiveUp: candidate.consecutiveUp,
        prevDayChange: candidate.changePercent,
        gapOpenPct,
        boardCount: 0,
      },
    },
    cost: totalCost,
  };
}

// ================================================================
//  结果计算
// ================================================================

function buildResult(
  cfg: ScalpBacktestConfig,
  trades: ScalpBacktestTrade[],
  equityCurve: { date: string; value: number }[],
  tradeDates: string[],
): ScalpBacktestResult {
  const sells = trades.filter(t => t.sellReason !== "");
  const wins = sells.filter(t => t.pnl > 0);
  const losses = sells.filter(t => t.pnl <= 0);

  const winRate = sells.length > 0 ? (wins.length / sells.length) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
  const totalWin = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : (totalWin > 0 ? 99 : 0);
  const expectancy = sells.length > 0 ? sells.reduce((s, t) => s + t.pnlPct, 0) / sells.length : 0;
  const avgHoldDays = sells.length > 0 ? sells.reduce((s, t) => s + t.holdDays, 0) / sells.length : 0;

  const finalValue = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].value : cfg.initialCapital;
  const totalReturn = ((finalValue - cfg.initialCapital) / cfg.initialCapital) * 100;
  const weeks = tradeDates.length / 5;
  const weeklyReturn = weeks > 0 ? totalReturn / weeks : 0;

  // 最大回撤
  let peak = cfg.initialCapital;
  let maxDD = 0;
  for (const p of equityCurve) {
    if (p.value > peak) peak = p.value;
    const dd = peak > 0 ? ((peak - p.value) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }

  // 分策略统计
  const strategyMap = new Map<string, ScalpBacktestTrade[]>();
  for (const t of sells) {
    const arr = strategyMap.get(t.strategy) || [];
    arr.push(t);
    strategyMap.set(t.strategy, arr);
  }
  const strategyStats = [...strategyMap.entries()].map(([strategy, ts]) => {
    const w = ts.filter(t => t.pnl > 0);
    const l = ts.filter(t => t.pnl <= 0);
    const tw = w.reduce((s, t) => s + t.pnl, 0);
    const tl = Math.abs(l.reduce((s, t) => s + t.pnl, 0));
    return {
      strategy, trades: ts.length,
      winRate: ts.length > 0 ? (w.length / ts.length) * 100 : 0,
      avgPnl: ts.length > 0 ? ts.reduce((s, t) => s + t.pnlPct, 0) / ts.length : 0,
      profitFactor: tl > 0 ? tw / tl : (tw > 0 ? 99 : 0),
    };
  });

  // 因子分析
  const factorAnalysis = analyzeFactors(sells);

  // 生成建议
  const suggestions = generateSuggestions(cfg, winRate, profitFactor, avgHoldDays, strategyStats, factorAnalysis);

  return {
    config: cfg,
    period: tradeDates.length > 0 ? `${tradeDates[0]} ~ ${tradeDates[tradeDates.length - 1]}` : "",
    tradingDays: tradeDates.length,
    totalTrades: sells.length,
    winRate: Math.round(winRate * 10) / 10,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    avgHoldDays: Math.round(avgHoldDays * 10) / 10,
    totalReturn: Math.round(totalReturn * 100) / 100,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    weeklyReturn: Math.round(weeklyReturn * 100) / 100,
    strategyStats,
    factorAnalysis,
    trades,
    equityCurve,
    suggestions,
  };
}

// ================================================================
//  因子分析
// ================================================================

function analyzeFactors(trades: ScalpBacktestTrade[]): ScalpBacktestResult["factorAnalysis"] {
  if (trades.length < 5) return [];

  const factors: { name: string; extract: (t: ScalpBacktestTrade) => number; bins: [string, number, number][] }[] = [
    {
      name: "换手率",
      extract: t => t.factors.turnoverRate,
      bins: [["0-5%", 0, 5], ["5-10%", 5, 10], ["10-15%", 10, 15], ["15-25%", 15, 25]],
    },
    {
      name: "量比",
      extract: t => t.factors.volumeRatio,
      bins: [["<1.5", 0, 1.5], ["1.5-3", 1.5, 3], ["3-5", 3, 5], [">5", 5, 100]],
    },
    {
      name: "分时强度",
      extract: t => t.factors.closeStrength,
      bins: [["<0.8", 0, 0.8], ["0.8-0.95", 0.8, 0.95], ["0.95-0.99", 0.95, 0.99], ["≥0.99", 0.99, 1.01]],
    },
    {
      name: "振幅",
      extract: t => t.factors.amplitude,
      bins: [["<3%", 0, 3], ["3-5%", 3, 5], ["5-8%", 5, 8], [">8%", 8, 100]],
    },
    {
      name: "连涨天数",
      extract: t => t.factors.consecutiveUp,
      bins: [["1天", 0, 2], ["2天", 2, 3], ["3天", 3, 4], ["≥4天", 4, 100]],
    },
    {
      name: "开盘缺口",
      extract: t => t.factors.gapOpenPct,
      bins: [["低开", -10, 0], ["平开0-2%", 0, 2], ["高开2-5%", 2, 5], ["高开>5%", 5, 100]],
    },
  ];

  return factors.map(f => {
    const bins = f.bins.map(([range, lo, hi]) => {
      const inBin = trades.filter(t => {
        const v = f.extract(t);
        return v >= lo && v < hi;
      });
      const w = inBin.filter(t => t.pnl > 0).length;
      return {
        range,
        trades: inBin.length,
        winRate: inBin.length > 0 ? Math.round((w / inBin.length) * 1000) / 10 : 0,
        avgPnl: inBin.length > 0 ? Math.round(inBin.reduce((s, t) => s + t.pnlPct, 0) / inBin.length * 100) / 100 : 0,
      };
    });

    const best = bins.reduce((b, c) => (c.winRate > b.winRate && c.trades >= 3) ? c : b, bins[0]);
    return { factor: f.name, bins, bestBin: best?.range || "" };
  });
}

// ================================================================
//  自动建议生成
// ================================================================

function generateSuggestions(
  cfg: ScalpBacktestConfig,
  winRate: number,
  profitFactor: number,
  avgHoldDays: number,
  strategyStats: ScalpBacktestResult["strategyStats"],
  factorAnalysis: ScalpBacktestResult["factorAnalysis"],
): string[] {
  const suggestions: string[] = [];

  // 胜率相关
  if (winRate < 40) {
    suggestions.push("⚠️ 胜率偏低(<40%)，建议：提高质量评分门槛(minQualityScore)或收紧止损");
  } else if (winRate >= 60) {
    suggestions.push("✅ 胜率优秀(≥60%)，策略有效");
  }

  // 盈亏比
  if (profitFactor < 1.2) {
    suggestions.push("⚠️ 盈亏比不足(< 1.2)，建议：放宽止盈或收紧止损");
  } else if (profitFactor >= 2) {
    suggestions.push("✅ 盈亏比出色(≥2.0)");
  }

  // 持有时间
  if (avgHoldDays > 2.5) {
    suggestions.push("💡 平均持有偏长，考虑缩短maxHoldDays或更积极止盈");
  }

  // 分策略建议
  for (const ss of strategyStats) {
    if (ss.trades >= 3 && ss.winRate < 30) {
      suggestions.push(`🚫 策略"${ss.strategy}"胜率仅${ss.winRate.toFixed(0)}%，建议禁用或优化`);
    }
    if (ss.trades >= 3 && ss.winRate >= 60 && ss.profitFactor >= 1.5) {
      suggestions.push(`✅ 策略"${ss.strategy}"表现优异(胜率${ss.winRate.toFixed(0)}% 盈亏比${ss.profitFactor.toFixed(1)})，可加大仓位`);
    }
  }

  // 因子建议
  for (const fa of factorAnalysis) {
    const best = fa.bins.filter(b => b.trades >= 3).sort((a, b) => b.winRate - a.winRate)[0];
    const worst = fa.bins.filter(b => b.trades >= 3).sort((a, b) => a.winRate - b.winRate)[0];
    if (best && worst && best.winRate - worst.winRate >= 20) {
      suggestions.push(`📊 因子"${fa.factor}"：最优区间${best.range}(胜率${best.winRate}%)，避开${worst.range}(胜率${worst.winRate}%)`);
    }
  }

  if (suggestions.length === 0) {
    suggestions.push("🔄 数据量不足，建议增加回测周期或标的数量");
  }

  return suggestions;
}

// ================================================================
//  辅助
// ================================================================

function extractSortedDates(klineMap: Record<string, { name: string; klines: KLineData[] }>): string[] {
  const dateSet = new Set<string>();
  for (const { klines } of Object.values(klineMap)) {
    for (const k of klines) dateSet.add(k.date);
  }
  return [...dateSet].sort();
}

function daysBetween(d1: string, d2: string): number {
  return Math.max(0, Math.floor((new Date(d2).getTime() - new Date(d1).getTime()) / 86400000));
}

function getChangePercent(
  dm: Map<string, KLineData>,
  date: string,
  allDates: string[],
  absIdx: number,
): number {
  const k = dm.get(date);
  const prevDate = absIdx > 0 ? allDates[absIdx - 1] : null;
  const prevK = prevDate ? dm.get(prevDate) : null;
  if (!k || !prevK || prevK.close <= 0) return 0;
  return ((k.close - prevK.close) / prevK.close) * 100;
}

function emptyResult(cfg: ScalpBacktestConfig, allDates: string[]): ScalpBacktestResult {
  return {
    config: cfg,
    period: allDates.length > 0 ? `${allDates[0]} ~ ${allDates[allDates.length - 1]}` : "",
    tradingDays: allDates.length,
    totalTrades: 0, winRate: 0, avgWin: 0, avgLoss: 0,
    profitFactor: 0, expectancy: 0, avgHoldDays: 0,
    totalReturn: 0, maxDrawdown: 0, weeklyReturn: 0,
    strategyStats: [], factorAnalysis: [],
    trades: [], equityCurve: [], suggestions: ["数据不足，无法回测"],
  };
}
