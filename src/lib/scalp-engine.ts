/**
 * 超短线引擎（Scalp Engine）
 *
 * 核心策略逻辑：
 *   1. 情绪周期择时 — 判断市场处于冰点/回暖/高潮/退潮哪个阶段
 *   2. 龙头战法 — 只做辨识度最高的龙头，不做杂毛
 *   3. 首板/二板精选 — 首板打板+二板确认，严格筛选
 *   4. 竞价定生死 — 集合竞价决定当天操作，9:25-9:30是黄金窗口
 *   5. 日内分时买卖 — 分时图形态识别，量价配合
 *   6. 严格止损止盈 — 买入当天不对就次日竞价走人，绝不犹豫
 *
 * 超短线六大铁律：
 *   ① 只做主板（60/00开头）
 *   ② 单票最多1只，集中火力
 *   ③ 持股不过3天（T+1后最多再持1天）
 *   ④ 亏2%无条件止损，盈利5%+开始移动止盈
 *   ⑤ 竞价高开>7%不追，低开>3%直接割
 *   ⑥ 每周最多亏3次就休息
 *
 * 初始资金：10,000 元
 */

import * as fs from "fs";
import * as path from "path";
import { kvLoad, kvSave } from "./kv-store";
import { loadNextDayWatchlist } from "./limit-up-engine";
import type { LimitUpQuality } from "./limitup-quality";

// ================================================================
//  类型定义
// ================================================================

export interface ScalpHolding {
  code: string;
  name: string;
  buyDate: string;
  buyTime: string;        // 买入时刻
  buyPrice: number;
  currentPrice: number;
  shares: number;
  costAmount: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  holdDays: number;
  canSellToday: boolean;
  peakPrice: number;
  buyReason: string;       // 买入逻辑标记
  targetSellPrice: number; // 目标止盈价
  stopLossPrice: number;   // 止损价
  qualityScore: number;    // 涨停质量分（如适用）
}

export interface ScalpTrade {
  date: string;
  time: string;
  code: string;
  name: string;
  type: "买入" | "卖出";
  price: number;
  shares: number;
  amount: number;
  commission: number;
  stampTax: number;
  totalCost: number;
  reason: string;
  pnl?: number;           // 卖出时的盈亏
  pnlPercent?: number;
  holdDays?: number;
  strategy: ScalpStrategy;
}

export type ScalpStrategy =
  | "极优板竞价"    // 昨日极优板，今日竞价买入
  | "首板打板"      // 盘中首板封板买入
  | "二板确认"      // 二板确认后竞价买入
  | "龙头低吸"      // 龙头回调低吸
  | "情绪冰点反转"  // 市场冰点后首个涨停
  | "核按钮止损"    // 无条件止损
  | "止盈落袋"      // 止盈卖出
  | "竞价走人"      // 竞价不及预期走人
  | "尾盘清仓"      // 持股超期尾盘清仓
  | "分时卖点";     // 分时图卖点

export type MarketEmotion = "冰点" | "回暖" | "高潮" | "退潮" | "分歧";

export interface ScalpSnapshot {
  date: string;
  totalValue: number;
  cash: number;
  holdingValue: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  totalPnl: number;
  totalPnlPercent: number;
  emotion: MarketEmotion;
  weekWinCount: number;
  weekLossCount: number;
}

export interface ScalpState {
  initialCapital: number;
  cash: number;
  holdings: ScalpHolding[];
  trades: ScalpTrade[];
  snapshots: ScalpSnapshot[];
  createdAt: string;
  // 情绪周期
  currentEmotion: MarketEmotion;
  emotionHistory: { date: string; emotion: MarketEmotion; score: number }[];
  // 风控
  weekStartDate: string;
  weekStartValue: number;
  weekWinCount: number;
  weekLossCount: number;
  consecutiveLoss: number;
  pausedUntil: string;     // 连亏暂停至
  totalCommission: number;
  totalStampTax: number;
}

export interface ScalpQuote {
  code: string;
  name: string;
  price: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  changePercent: number;
  volume: number;
  amount: number;
  turnoverRate: number;
  // 涨停相关
  limitPrice: number;       // 涨停价
  isLimitUp: boolean;       // 是否涨停
  bidPrice?: number;        // 竞价价格
  bidVolume?: number;       // 竞价量
}

export interface ScalpAction {
  type: "买入" | "卖出" | "观望";
  code: string;
  name: string;
  shares: number;
  amount: number;
  reason: string;
  strategy: ScalpStrategy;
}

export interface ScalpScanResult {
  triggered: boolean;
  actions: ScalpAction[];
  reasoning: string;
  portfolio: ScalpState;
  emotion: MarketEmotion;
  emotionDetail: string;
}

// 市场情绪数据
export interface MarketEmotionData {
  limitUpCount: number;       // 涨停家数
  limitDownCount: number;     // 跌停家数
  upCount: number;            // 上涨家数
  downCount: number;          // 下跌家数
  sealRate: number;           // 封板率%（涨停封住/曾触及涨停）
  highLimitCount: number;     // 连板股数量
  brokenBoardCount: number;   // 炸板数量
  yesterdayLimitUpAvgOpen: number; // 昨日涨停股今日平均涨幅%
  mainNetInflow: number;      // 主力净流入（亿）
}

// ================================================================
//  可配置参数（支持回测优化 + Walk-Forward 自适应）
// ================================================================

export interface ScalpConfig {
  // 情绪阈值（基于市场容量自适应）
  emotion: {
    limitUpHot: number;         // 涨停≥N家 → 热
    limitUpNormal: number;      // 涨停≥N家 → 正常
    limitUpCold: number;        // 涨停≥N家 → 冷
    sealRateStrong: number;     // 封板率≥N% → 强
    sealRateWeak: number;       // 封板率≤N% → 弱
    yesterdayAvgStrong: number;  // 昨涨停今≥N% → 大赚效应
    yesterdayAvgNormal: number;  // 昨涨停今≥N% → 赚钱效应
    yesterdayAvgWeak: number;    // 昨涨停今≤N% → 亏钱效应
    highLimitStrong: number;    // 连板≥N只 → 有高度
    upDownStrong: number;       // 涨跌比≥N → 强势
    upDownWeak: number;         // 涨跌比≤N → 弱势
    // 情绪判定分数线
    scoreHighTide: number;      // ≥N分 → 高潮
    scoreWarm: number;          // ≥N分 → 回暖
    scoreDivergence: number;    // ≥N分 → 分歧
    scoreEbb: number;           // ≥N分 → 退潮（<则冰点）
  };
  // 交易风控参数
  trade: {
    stopLossPct: number;        // 止损%（负数）
    takeProfitStart: number;    // 移动止盈起点%
    takeProfitLock: number;     // 从最高回落N%卖出
    maxHoldDays: number;        // 最长持股天数
    maxChaseOpenPct: number;    // 竞价高开>N%不追
    cutLossOpenPct: number;     // 竞价低开>N%割
    weekMaxLoss: number;        // 每周最多亏损次数
    consecutiveLossPause: number; // 连亏N次暂停
    pauseDays: number;          // 暂停天数
    positionScale: {
      icePoint: number;         // 冰点仓位 0-1
      warm: number;             // 回暖仓位
      highTide: number;         // 高潮仓位
      divergence: number;       // 分歧仓位
    };
  };
}

export const DEFAULT_SCALP_CONFIG: ScalpConfig = {
  emotion: {
    limitUpHot: 80, limitUpNormal: 30, limitUpCold: 15,
    sealRateStrong: 80, sealRateWeak: 40,
    yesterdayAvgStrong: 5, yesterdayAvgNormal: 2, yesterdayAvgWeak: -3,
    highLimitStrong: 5,
    upDownStrong: 3, upDownWeak: 0.5,
    scoreHighTide: 50, scoreWarm: 25, scoreDivergence: 0, scoreEbb: -15,
  },
  trade: {
    stopLossPct: -2,
    takeProfitStart: 5, takeProfitLock: 3,
    maxHoldDays: 3, maxChaseOpenPct: 7, cutLossOpenPct: -3,
    weekMaxLoss: 3, consecutiveLossPause: 2, pauseDays: 2,
    positionScale: { icePoint: 0.5, warm: 1.0, highTide: 0.6, divergence: 0.3 },
  },
};

// ================================================================
//  交易参数
// ================================================================

const INITIAL_CAPITAL = 10000;
const MAX_HOLDINGS = 1;
const LOT_SIZE = 100;
const COMMISSION_RATE = 0.00025;
const MIN_COMMISSION = 5;
const STAMP_TAX_RATE = 0.0005;
const SLIPPAGE_RATE = 0.001;
const CASH_RESERVE = 500;
const MIN_TRADE_AMOUNT = 2000;

// ================================================================
//  持久化
// ================================================================

function defaultScalpState(): ScalpState {
  const now = new Date().toISOString();
  return {
    initialCapital: INITIAL_CAPITAL,
    cash: INITIAL_CAPITAL,
    holdings: [],
    trades: [],
    snapshots: [],
    createdAt: now,
    currentEmotion: "分歧",
    emotionHistory: [],
    weekStartDate: getMondayDate(now.slice(0, 10)),
    weekStartValue: INITIAL_CAPITAL,
    weekWinCount: 0,
    weekLossCount: 0,
    consecutiveLoss: 0,
    pausedUntil: "",
    totalCommission: 0,
    totalStampTax: 0,
  };
}

export async function loadScalpPortfolio(): Promise<ScalpState> {
  return kvLoad("scalp-portfolio", defaultScalpState());
}

async function saveScalpPortfolio(state: ScalpState): Promise<void> {
  return kvSave("scalp-portfolio", state);
}

export async function loadScalpConfig(): Promise<ScalpConfig> {
  const stored = await kvLoad<Partial<ScalpConfig> | null>("scalp-config", null);
  if (!stored) return { ...DEFAULT_SCALP_CONFIG };
  // 深度合并：用 stored 值覆盖默认值
  return deepMergeConfigs(DEFAULT_SCALP_CONFIG, stored);
}

export async function saveScalpConfig(config: ScalpConfig): Promise<void> {
  return kvSave("scalp-config", config);
}

function deepMergeConfigs(defaults: any, stored: any): any {
  const result = { ...defaults };
  for (const key of Object.keys(stored)) {
    if (stored[key] && typeof stored[key] === "object" && !Array.isArray(stored[key])) {
      result[key] = deepMergeConfigs(defaults[key] || {}, stored[key]);
    } else if (stored[key] != null) {
      result[key] = stored[key];
    }
  }
  return result;
}

// ================================================================
//  情绪周期判断（超短线核心中的核心）
// ================================================================

/**
 * 判断市场情绪周期
 *
 * 冰点 → 回暖 → 高潮 → 退潮 → 冰点（循环）
 *
 * 超短线的核心：
 *   - 冰点时大胆（别人恐惧我贪婪）
 *   - 高潮时谨慎（别人贪婪我恐惧）
 *   - 回暖时进攻（最佳出手时机）
 *   - 退潮时防守（减少操作）
 */
export function judgeMarketEmotion(
  data: MarketEmotionData,
  prevEmotion?: MarketEmotion,
  config: ScalpConfig = DEFAULT_SCALP_CONFIG,
): {
  emotion: MarketEmotion;
  score: number;
  detail: string;
} {
  const C = config.emotion;
  let score = 0;
  const details: string[] = [];

  // 1. 涨停家数（权重30%）
  if (data.limitUpCount >= C.limitUpHot) { score += 30; details.push(`涨停${data.limitUpCount}家(极热)`); }
  else if (data.limitUpCount >= C.limitUpNormal * 1.6) { score += 20; details.push(`涨停${data.limitUpCount}家(热)`); }
  else if (data.limitUpCount >= C.limitUpNormal) { score += 10; details.push(`涨停${data.limitUpCount}家(正常)`); }
  else if (data.limitUpCount >= C.limitUpCold) { score += 0; details.push(`涨停${data.limitUpCount}家(冷)`); }
  else { score -= 15; details.push(`涨停${data.limitUpCount}家(冰点)`); }

  // 2. 封板率（权重20%）
  if (data.sealRate >= C.sealRateStrong) { score += 15; details.push(`封板率${data.sealRate.toFixed(0)}%(强)`); }
  else if (data.sealRate >= 60) { score += 8; details.push(`封板率${data.sealRate.toFixed(0)}%`); }
  else if (data.sealRate >= 40) { score += 0; }
  else { score -= 10; details.push(`封板率${data.sealRate.toFixed(0)}%(弱)`); }

  // 3. 昨日涨停今日表现（权重25%）
  if (data.yesterdayLimitUpAvgOpen >= C.yesterdayAvgStrong) { score += 20; details.push(`昨涨停今+${data.yesterdayLimitUpAvgOpen.toFixed(1)}%(大赚效应)`); }
  else if (data.yesterdayLimitUpAvgOpen >= C.yesterdayAvgNormal) { score += 12; details.push(`昨涨停今+${data.yesterdayLimitUpAvgOpen.toFixed(1)}%(赚钱效应)`); }
  else if (data.yesterdayLimitUpAvgOpen >= 0) { score += 3; details.push(`昨涨停今+${data.yesterdayLimitUpAvgOpen.toFixed(1)}%`); }
  else if (data.yesterdayLimitUpAvgOpen >= C.yesterdayAvgWeak) { score -= 8; details.push(`昨涨停今${data.yesterdayLimitUpAvgOpen.toFixed(1)}%(亏钱效应)`); }
  else { score -= 20; details.push(`昨涨停今${data.yesterdayLimitUpAvgOpen.toFixed(1)}%(惨烈亏钱效应)`); }

  // 4. 连板高度（权重15%）
  if (data.highLimitCount >= C.highLimitStrong) { score += 12; details.push(`${data.highLimitCount}只连板(有高度)`); }
  else if (data.highLimitCount >= 3) { score += 6; }
  else if (data.highLimitCount >= 1) { score += 2; }
  else { score -= 5; details.push("无连板(无高度)"); }

  // 5. 涨跌家数（权重10%）
  const upDownRatio = data.downCount > 0 ? data.upCount / data.downCount : data.upCount;
  if (upDownRatio >= C.upDownStrong) { score += 8; }
  else if (upDownRatio >= 1.5) { score += 4; }
  else if (upDownRatio >= 1) { score += 0; }
  else if (upDownRatio >= C.upDownWeak) { score -= 5; }
  else { score -= 10; details.push("普跌"); }

  // 判定情绪阶段
  let emotion: MarketEmotion;
  if (score >= C.scoreHighTide) { emotion = "高潮"; }
  else if (score >= C.scoreWarm) { emotion = "回暖"; }
  else if (score >= C.scoreDivergence) { emotion = "分歧"; }
  else if (score >= C.scoreEbb) { emotion = "退潮"; }
  else { emotion = "冰点"; }

  // 结合前一天情绪做平滑
  if (prevEmotion) {
    if (prevEmotion === "高潮" && score >= C.scoreWarm + 5) emotion = "高潮";
    if (prevEmotion === "冰点" && score <= C.scoreEbb + 5) emotion = "冰点";
  }

  return { emotion, score, detail: details.join(" | ") };
}

/**
 * 情绪周期对应的操作策略
 */
function getEmotionStrategy(emotion: MarketEmotion, config: ScalpConfig = DEFAULT_SCALP_CONFIG): {
  allowBuy: boolean;
  positionScale: number;
  preferredStrategies: ScalpStrategy[];
  riskNote: string;
} {
  const PS = config.trade.positionScale;
  switch (emotion) {
    case "冰点":
      return {
        allowBuy: true,
        positionScale: PS.icePoint,
        preferredStrategies: ["情绪冰点反转", "龙头低吸"],
        riskNote: "🧊 冰点期：试探性参与首个涨停/龙头反包，半仓",
      };
    case "回暖":
      return {
        allowBuy: true,
        positionScale: PS.warm,
        preferredStrategies: ["极优板竞价", "首板打板", "二板确认"],
        riskNote: "🌅 回暖期：最佳出手时机！大胆参与龙头和首板",
      };
    case "高潮":
      return {
        allowBuy: true,
        positionScale: PS.highTide,
        preferredStrategies: ["极优板竞价", "二板确认"],
        riskNote: "🔥 高潮期：注意风险！只做最强龙头，见好就收",
      };
    case "退潮":
      return {
        allowBuy: false,
        positionScale: 0,
        preferredStrategies: [],
        riskNote: "🌊 退潮期：空仓观望！严禁抄底",
      };
    case "分歧":
    default:
      return {
        allowBuy: true,
        positionScale: PS.divergence,
        preferredStrategies: ["极优板竞价", "龙头低吸"],
        riskNote: "⚖️ 分歧期：轻仓试错，等方向明朗",
      };
  }
}

// ================================================================
//  超短线盘中扫描（核心）
// ================================================================

export async function scalpScan(
  state: ScalpState,
  quotes: ScalpQuote[],
  emotionData?: MarketEmotionData,
  config: ScalpConfig = DEFAULT_SCALP_CONFIG,
): Promise<ScalpScanResult> {
  const C = config.trade;
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const bjNow = new Date(Date.now() + 8 * 3600000);
  const minutesInDay = bjNow.getUTCHours() * 60 + bjNow.getUTCMinutes();
  const actions: ScalpAction[] = [];
  const reasoning: string[] = [];
  let changed = false;

  // 兼容旧数据
  if (!state.emotionHistory) state.emotionHistory = [];
  if (state.totalCommission == null) state.totalCommission = 0;
  if (state.totalStampTax == null) state.totalStampTax = 0;

  const quoteMap = new Map(quotes.map(q => [q.code, q]));

  // == 周重置 ==
  const monday = getMondayDate(today);
  if (state.weekStartDate !== monday) {
    const tv = state.cash + state.holdings.reduce((s, h) => s + h.currentValue, 0);
    state.weekStartDate = monday;
    state.weekStartValue = tv;
    state.weekWinCount = 0;
    state.weekLossCount = 0;
  }

  // == 情绪周期判断 ==
  let emotion = state.currentEmotion;
  let emotionDetail = "";
  if (emotionData) {
    const prevEmotion = state.emotionHistory.length > 0
      ? state.emotionHistory[state.emotionHistory.length - 1].emotion : undefined;
    const emo = judgeMarketEmotion(emotionData, prevEmotion, config);
    emotion = emo.emotion;
    emotionDetail = emo.detail;
    state.currentEmotion = emotion;

    // 记录情绪历史（去重同一天）
    const lastHist = state.emotionHistory[state.emotionHistory.length - 1];
    if (!lastHist || lastHist.date !== today) {
      state.emotionHistory.push({ date: today, emotion, score: emo.score });
      if (state.emotionHistory.length > 30) state.emotionHistory = state.emotionHistory.slice(-30);
    } else {
      lastHist.emotion = emotion;
      lastHist.score = emo.score;
    }
  }

  const emoStrategy = getEmotionStrategy(emotion, config);
  reasoning.push(emoStrategy.riskNote);

  // == 暂停检查 ==
  if (state.pausedUntil && state.pausedUntil >= today) {
    reasoning.push(`⛔ 连亏暂停中(至${state.pausedUntil})`);
    updateScalpSnapshot(state, today, emotion);
    saveScalpPortfolio(state);
    return { triggered: false, actions, reasoning: reasoning.join(" | "), portfolio: state, emotion, emotionDetail };
  }

  // == 周亏损次数检查 ==
  if (state.weekLossCount >= C.weekMaxLoss) {
    reasoning.push(`⛔ 本周已亏${state.weekLossCount}次，暂停操作`);
    updateScalpSnapshot(state, today, emotion);
    saveScalpPortfolio(state);
    return { triggered: false, actions, reasoning: reasoning.join(" | "), portfolio: state, emotion, emotionDetail };
  }

  // == 更新持仓 ==
  for (const h of state.holdings) {
    const q = quoteMap.get(h.code);
    if (q && q.price > 0) {
      h.currentPrice = q.price;
      h.currentValue = h.shares * h.currentPrice;
      h.pnl = h.currentValue - h.costAmount;
      h.pnlPercent = h.costAmount > 0 ? (h.pnl / h.costAmount) * 100 : 0;
      if (h.currentPrice > h.peakPrice) h.peakPrice = h.currentPrice;
    }
    h.canSellToday = h.buyDate < today;
    h.holdDays = daysBetween(h.buyDate, today);
  }

  // ==================== 1. 卖出逻辑 ====================

  for (const h of [...state.holdings]) {
    if (!h.canSellToday) continue;
    const q = quoteMap.get(h.code);
    if (!q || q.price <= 0) continue;

    let sellReason = "";
    let strategy: ScalpStrategy = "核按钮止损";

    // 铁律①：亏N%无条件止损
    if (h.pnlPercent <= C.stopLossPct) {
      sellReason = `核按钮止损: 亏${h.pnlPercent.toFixed(1)}%≤${C.stopLossPct}%`;
      strategy = "核按钮止损";
    }

    // 铁律②：竞价低开>N%直接割
    if (!sellReason && minutesInDay <= 575 && q.changePercent <= C.cutLossOpenPct) {
      sellReason = `竞价低开割肉: 低开${q.changePercent.toFixed(1)}%`;
      strategy = "竞价走人";
    }

    // 铁律③：持股超N天尾盘清仓
    if (!sellReason && h.holdDays >= C.maxHoldDays && minutesInDay >= 870) {
      sellReason = `持股${h.holdDays}天超期清仓`;
      strategy = "尾盘清仓";
    }

    // 移动止盈：从最高价回落
    if (!sellReason && h.pnlPercent >= C.takeProfitStart) {
      const dropFromPeak = h.peakPrice > 0 ? ((h.peakPrice - h.currentPrice) / h.peakPrice) * 100 : 0;
      if (dropFromPeak >= C.takeProfitLock) {
        sellReason = `移动止盈: 从最高${h.peakPrice.toFixed(2)}回落${dropFromPeak.toFixed(1)}%`;
        strategy = "止盈落袋";
      }
    }

    // 冲高回落分时卖点
    if (!sellReason && h.pnlPercent > 3 && q.changePercent < 0 && minutesInDay >= 630) { // 10:30后
      sellReason = `分时冲高回落: 盈${h.pnlPercent.toFixed(1)}%但今日转跌`;
      strategy = "分时卖点";
    }

    // 退潮期持仓直接走
    if (!sellReason && emotion === "退潮" && h.pnlPercent < 3) {
      sellReason = `退潮期不恋战: 盈${h.pnlPercent.toFixed(1)}%`;
      strategy = "竞价走人";
    }

    if (sellReason) {
      const sellPrice = h.currentPrice * (1 - SLIPPAGE_RATE);
      const sellAmount = h.shares * sellPrice;
      const commission = calcCommission(sellAmount);
      const stampTax = sellAmount * STAMP_TAX_RATE;

      const pnl = sellAmount - commission - stampTax - h.costAmount;
      const pnlPct = h.costAmount > 0 ? (pnl / h.costAmount) * 100 : 0;

      state.cash += sellAmount - commission - stampTax;
      state.totalCommission += commission;
      state.totalStampTax += stampTax;

      state.trades.push({
        date: today, time: now, code: h.code, name: h.name,
        type: "卖出", price: sellPrice, shares: h.shares, amount: sellAmount,
        commission, stampTax, totalCost: commission + stampTax,
        reason: sellReason, pnl, pnlPercent: Math.round(pnlPct * 100) / 100,
        holdDays: h.holdDays, strategy,
      });
      actions.push({
        type: "卖出", code: h.code, name: h.name,
        shares: h.shares, amount: sellAmount,
        reason: sellReason, strategy,
      });
      reasoning.push(`${pnl >= 0 ? "🟢" : "🔴"} ${sellReason}: ${h.name} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(0)}元(${pnlPct.toFixed(1)}%)`);

      // 更新胜负统计
      if (pnl >= 0) {
        state.weekWinCount++;
        state.consecutiveLoss = 0;
      } else {
        state.weekLossCount++;
        state.consecutiveLoss++;
        if (state.consecutiveLoss >= C.consecutiveLossPause) {
          const pauseDate = new Date();
          pauseDate.setDate(pauseDate.getDate() + C.pauseDays + 1);
          state.pausedUntil = pauseDate.toISOString().slice(0, 10);
          reasoning.push(`⛔ 连亏${state.consecutiveLoss}次，暂停至${state.pausedUntil}`);
        }
      }

      state.holdings = state.holdings.filter(x => x.code !== h.code);
      changed = true;
    }
  }

  // ==================== 2. 买入逻辑 ====================

  if (state.holdings.length >= MAX_HOLDINGS || !emoStrategy.allowBuy) {
    // 已满仓或情绪不允许
    if (!emoStrategy.allowBuy) reasoning.push("情绪周期不宜买入");
  } else if (state.cash < MIN_TRADE_AMOUNT) {
    reasoning.push("现金不足");
  } else {
    const todayBuys = state.trades.filter(t => t.date === today && t.type === "买入").length;
    if (todayBuys > 0) {
      // 今天已买过
    } else {
      let bought = false;

      // ====== 策略A：极优板竞价买入（9:25-9:40）======
      if (!bought && minutesInDay >= 565 && minutesInDay <= 580) {
        bought = await tryAuctionBuy(state, quoteMap, today, now, actions, reasoning, emoStrategy.positionScale, config);
        if (bought) changed = true;
      }

      // ====== 策略B：首板打板（10:00-14:00，盘中捕捉涨停）======
      if (!bought && minutesInDay >= 600 && minutesInDay <= 840) {
        bought = await tryFirstBoardBuy(state, quotes, today, now, actions, reasoning, emotion, emoStrategy.positionScale, config);
        if (bought) changed = true;
      }

      // ====== 策略C：龙头低吸（10:30-14:00，龙头回调买入）======
      if (!bought && minutesInDay >= 630 && minutesInDay <= 840 && (emotion === "冰点" || emotion === "回暖")) {
        bought = await tryLeaderDipBuy(state, quotes, today, now, actions, reasoning, emoStrategy.positionScale, config);
        if (bought) changed = true;
      }
    }
  }

  // == 更新快照 ==
  updateScalpSnapshot(state, today, emotion);
  if (changed || actions.length > 0) saveScalpPortfolio(state);

  return {
    triggered: changed,
    actions,
    reasoning: reasoning.join(" | ") || "超短线无信号",
    portfolio: state,
    emotion,
    emotionDetail,
  };
}

// ================================================================
//  策略A：极优板竞价买入
// ================================================================

async function tryAuctionBuy(
  state: ScalpState,
  quoteMap: Map<string, ScalpQuote>,
  today: string,
  now: string,
  actions: ScalpAction[],
  reasoning: string[],
  positionScale: number,
  config: ScalpConfig,
): Promise<boolean> {
  const C = config.trade;
  const watchlist = await loadNextDayWatchlist();
  if (!watchlist || !watchlist.picks) return false;

  const holdCodes = new Set(state.holdings.map(h => h.code));
  // 找极优板：qualityScore>=75 + 涨停 + 无禁止风控
  const qualityPicks = watchlist.picks.filter(p =>
    p.limitUpToday &&
    (p.qualityScore ?? 0) >= 75 &&
    (p.positionMultiplier ?? 0) > 0 &&
    !holdCodes.has(p.code) &&
    (p.code.startsWith("60") || p.code.startsWith("00")) &&
    !(p.qualityRiskFlags || []).some((f: string) => f.includes("⛔") || f.includes("🚫"))
  ).sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));

  if (qualityPicks.length === 0) return false;

  const pick = qualityPicks[0];
  const q = quoteMap.get(pick.code);
  if (!q || q.price <= 0) return false;

  // 竞价高开>N%不追
  const openPct = q.prevClose > 0 ? ((q.price - q.prevClose) / q.prevClose) * 100 : 0;
  if (openPct > C.maxChaseOpenPct) {
    reasoning.push(`⏸️ ${pick.name} 极优板但高开${openPct.toFixed(1)}%>${C.maxChaseOpenPct}%，不追`);
    return false;
  }
  // 低开>N%也不买
  if (openPct < C.cutLossOpenPct) {
    reasoning.push(`⏸️ ${pick.name} 极优板但低开${openPct.toFixed(1)}%，信号失效`);
    return false;
  }

  return executeBuy(state, q, pick.name, today, now, actions, reasoning, positionScale * (pick.positionMultiplier ?? 1), "极优板竞价",
    `极优板竞价: 质量${pick.qualityScore}分/${pick.qualityGrade} 开${openPct >= 0 ? "+" : ""}${openPct.toFixed(1)}%`,
    pick.qualityScore ?? 0, C);
}

// ================================================================
//  策略B：首板打板
// ================================================================

async function tryFirstBoardBuy(
  state: ScalpState,
  quotes: ScalpQuote[],
  today: string,
  now: string,
  actions: ScalpAction[],
  reasoning: string[],
  emotion: MarketEmotion,
  positionScale: number,
  config: ScalpConfig,
): Promise<boolean> {
  // 只在回暖/高潮期打板
  if (emotion !== "回暖" && emotion !== "高潮" && emotion !== "冰点") return false;

  const holdCodes = new Set(state.holdings.map(h => h.code));

  // 加载 watchlist 获取质量评分（与策略A/C统一数据源）
  let qualityMap: Map<string, { score: number; multiplier: number; flags: string[] }> = new Map();
  try {
    const watchlist = await loadNextDayWatchlist();
    if (watchlist?.picks) {
      for (const p of watchlist.picks) {
        if (p.limitUpToday && (p.qualityScore ?? 0) >= 50) {
          qualityMap.set(p.code, {
            score: p.qualityScore ?? 0,
            multiplier: p.positionMultiplier ?? 1,
            flags: p.qualityRiskFlags || [],
          });
        }
      }
    }
  } catch { /* 无 watchlist 时降级为纯行情筛选 */ }

  // 找刚封板的股票（涨停 + 换手合理 + 成交额够大）
  const boardCandidates = quotes.filter(q =>
    q.isLimitUp &&
    !holdCodes.has(q.code) &&
    (q.code.startsWith("60") || q.code.startsWith("00")) &&
    q.turnoverRate >= 3 && q.turnoverRate <= 20 &&
    q.amount >= 100000000 &&
    !q.name.includes("ST") && !q.name.includes("退") &&
    // 有 watchlist 时过滤低质量/有禁止标记的
    (!qualityMap.has(q.code) || !qualityMap.get(q.code)!.flags.some(f => f.includes("⛔") || f.includes("🚫")))
  );

  if (boardCandidates.length === 0) return false;

  // 打分选最强的一只（融入 watchlist 质量分）
  const scored = boardCandidates.map(q => {
    let score = 0;
    // 换手率适中
    if (q.turnoverRate >= 5 && q.turnoverRate <= 12) score += 10;
    // 成交额大
    if (q.amount >= 500000000) score += 10;
    else if (q.amount >= 200000000) score += 5;
    // 冰点期首板加分
    if (emotion === "冰点") score += 15;
    // watchlist 质量加分（核心改进：策略B现在认可质量因子）
    const qInfo = qualityMap.get(q.code);
    if (qInfo) {
      score += Math.round(qInfo.score / 10);     // 质量分 /10 加成
      if (qInfo.score >= 80) score += 5;         // 极优板额外加成
    }
    return { quote: q, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best.score < 10) return false;

  // 打板只用半仓（风险大）
  const scale = positionScale * 0.5;
  const qInfo = qualityMap.get(best.quote.code);
  const qualityTag = qInfo ? ` 质量${qInfo.score}分` : "";

  return executeBuy(state, best.quote, best.quote.name, today, now, actions, reasoning, scale, "首板打板",
    `首板打板: 换手${best.quote.turnoverRate.toFixed(1)}% 额${(best.quote.amount / 1e8).toFixed(1)}亿${qualityTag}`,
    qInfo?.score ?? 0, config.trade);
}

// ================================================================
//  策略C：龙头低吸
// ================================================================

async function tryLeaderDipBuy(
  state: ScalpState,
  quotes: ScalpQuote[],
  today: string,
  now: string,
  actions: ScalpAction[],
  reasoning: string[],
  positionScale: number,
  config: ScalpConfig,
): Promise<boolean> {
  const C = config.trade;
  const watchlist = await loadNextDayWatchlist();
  if (!watchlist || !watchlist.picks) return false;

  const holdCodes = new Set(state.holdings.map(h => h.code));

  // 找昨日涨停、今日回调的龙头
  const dipCandidates = watchlist.picks.filter(p => {
    if (!p.limitUpToday) return false;
    if (holdCodes.has(p.code)) return false;
    if (!(p.code.startsWith("60") || p.code.startsWith("00"))) return false;
    if ((p.qualityScore ?? 0) < 60) return false;  // 质量至少60分
    return true;
  });

  for (const pick of dipCandidates) {
    const q = quotes.find(qq => qq.code === pick.code);
    if (!q || q.price <= 0) continue;

    // 日内低吸条件：今日跌0.5-3%（从昨日涨停回调）
    if (q.changePercent > -0.5 || q.changePercent < -3) continue;

    // 分时位置在低位
    if (q.high > q.low) {
      const pos = (q.price - q.low) / (q.high - q.low);
      if (pos > 0.4) continue; // 只在日内下半区买
    }

    return executeBuy(state, q, pick.name, today, now, actions, reasoning, positionScale * 0.6, "龙头低吸",
      `龙头低吸: 昨涨停今回调${q.changePercent.toFixed(1)}% 质量${pick.qualityScore}分`,
      pick.qualityScore ?? 0, C);
  }

  return false;
}

// ================================================================
//  执行买入
// ================================================================

function executeBuy(
  state: ScalpState,
  q: ScalpQuote,
  name: string,
  today: string,
  now: string,
  actions: ScalpAction[],
  reasoning: string[],
  positionScale: number,
  strategy: ScalpStrategy,
  reason: string,
  qualityScore: number,
  C: ScalpConfig["trade"],
): boolean {
  const maxBuyAmount = Math.min(
    (state.cash - CASH_RESERVE) * positionScale,
    state.cash - CASH_RESERVE
  );
  if (maxBuyAmount < MIN_TRADE_AMOUNT) return false;

  const buyPrice = q.price * (1 + SLIPPAGE_RATE);
  const buyShares = Math.floor(maxBuyAmount / buyPrice / LOT_SIZE) * LOT_SIZE;
  if (buyShares < LOT_SIZE) return false;

  const amount = buyShares * buyPrice;
  const commission = calcCommission(amount);
  const totalCost = amount + commission;
  if (totalCost > state.cash - CASH_RESERVE) return false;

  // 计算止损止盈价
  const stopLossPrice = Math.round(buyPrice * (1 + C.stopLossPct / 100) * 100) / 100;
  const targetSellPrice = Math.round(buyPrice * (1 + C.takeProfitStart / 100) * 100) / 100;

  state.cash -= totalCost;
  state.totalCommission += commission;

  state.holdings.push({
    code: q.code, name,
    buyDate: today, buyTime: now,
    buyPrice, currentPrice: q.price,
    shares: buyShares, costAmount: totalCost,
    currentValue: buyShares * q.price,
    pnl: 0, pnlPercent: 0,
    holdDays: 0, canSellToday: false,
    peakPrice: buyPrice,
    buyReason: reason,
    targetSellPrice, stopLossPrice,
    qualityScore,
  });

  state.trades.push({
    date: today, time: now, code: q.code, name,
    type: "买入", price: buyPrice, shares: buyShares, amount,
    commission, stampTax: 0, totalCost: commission,
    reason, strategy,
  });

  actions.push({
    type: "买入", code: q.code, name,
    shares: buyShares, amount,
    reason, strategy,
  });

  reasoning.push(`🏆 ${strategy} ${name} ${buyShares}股 @${buyPrice.toFixed(2)} 止损${stopLossPrice.toFixed(2)} 目标${targetSellPrice.toFixed(2)}`);
  return true;
}

// ================================================================
//  辅助函数
// ================================================================

function calcCommission(amount: number): number {
  return Math.max(MIN_COMMISSION, amount * COMMISSION_RATE);
}

function updateScalpSnapshot(state: ScalpState, today: string, emotion: MarketEmotion) {
  const tv = state.cash + state.holdings.reduce((s, h) => s + h.currentValue, 0);
  const YESTERDAY_SNAP = state.snapshots.length > 0
    ? [...state.snapshots].reverse().find(s => s.date < today)
    : null;
  const prevDayValue = YESTERDAY_SNAP?.totalValue ?? state.initialCapital;
  const dailyPnl = tv - prevDayValue;

  const snap: ScalpSnapshot = {
    date: today,
    totalValue: Math.round(tv * 100) / 100,
    cash: Math.round(state.cash * 100) / 100,
    holdingValue: Math.round((tv - state.cash) * 100) / 100,
    dailyPnl: Math.round(dailyPnl * 100) / 100,
    dailyPnlPercent: prevDayValue > 0 ? Math.round((dailyPnl / prevDayValue) * 10000) / 100 : 0,
    totalPnl: Math.round((tv - state.initialCapital) * 100) / 100,
    totalPnlPercent: Math.round(((tv - state.initialCapital) / state.initialCapital) * 10000) / 100,
    emotion,
    weekWinCount: state.weekWinCount,
    weekLossCount: state.weekLossCount,
  };

  // 同日覆盖
  if (state.snapshots.length > 0 && state.snapshots[state.snapshots.length - 1].date === today) {
    state.snapshots[state.snapshots.length - 1] = snap;
  } else {
    state.snapshots.push(snap);
  }

  // 保留60天
  if (state.snapshots.length > 60) state.snapshots = state.snapshots.slice(-60);
}

function daysBetween(d1: string, d2: string): number {
  return Math.floor((new Date(d2).getTime() - new Date(d1).getTime()) / 86400000);
}

function getMondayDate(date: string): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}
