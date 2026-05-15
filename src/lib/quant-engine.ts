/**
 * 量化策略引擎
 *
 * 成熟量化三层架构：
 *   Layer 1 — 多因子打底（6因子族，20+子因子）
 *   Layer 2 — AI增强（非线性组合 + 市场状态自适应权重）
 *   Layer 3 — 复合策略矩阵（4策略并行 → 信号融合）
 *
 * 适配标的：A股板块ETF（场内+场外），可扩展至个股
 */

import type { KLineData, EnrichedSectorData, NorthboundFlow, MarketBreadthData, MarginData, ValuationData, TurnoverTrend } from "./stock-api";
import type { SectorEventSummary, EventSignal } from "./event-driven";
import { getSectorEventScore } from "./event-driven";
import type { FactorDelta } from "./factor-memory";
import type { ICWeightAdjustment } from "./factor-ic";

// ================================================================
//  类型定义
// ================================================================

/** 单因子评分 */
export interface FactorScore {
  name: string;            // 因子名
  category: FactorCategory;
  raw: number;             // 原始值
  zScore: number;          // 标准化（-3~3）
  percentile: number;      // 百分位 0-100
  weight: number;          // 当前权重（AI自适应后）
  weighted: number;        // 加权得分
  desc: string;            // 人话描述
}

export type FactorCategory = "动量" | "价值" | "质量" | "波动率" | "资金流" | "技术面";

/** 单策略信号 */
export interface StrategySignal {
  strategy: StrategyName;
  direction: "long" | "short" | "neutral";
  strength: number;        // -100~100
  confidence: number;      // 0-100
  reason: string;
  triggers: string[];      // 触发条件列表
}

export type StrategyName = "趋势跟踪" | "均值回归" | "事件驱动" | "动量反转";

export type MarketRegime = "趋势上行" | "趋势下行" | "震荡区间" | "波动放大" | "低波横盘";

/** 单标的量化决策 */
export interface QuantDecision {
  code: string;
  name: string;
  sector: string;

  // Layer 1: 多因子
  factors: FactorScore[];
  factorComposite: number;         // 综合因子分 -100~100

  // Layer 2: AI增强
  regime: MarketRegime;            // 识别的市场状态
  aiAdjustedScore: number;         // AI调整后总分 -100~100
  aiBoost: number;                 // AI相对因子的增减
  aiReason: string;

  // Layer 3: 策略矩阵
  strategies: StrategySignal[];
  matrixScore: number;             // 策略矩阵融合分 -100~100
  matrixConsensus: "强共识" | "弱共识" | "分歧";

  // 因子时序记忆
  trendBoost: number;              // 因子趋势加减分
  trendSignal: string;             // 因子趋势信号

  // 最终输出
  finalScore: number;              // 三层加权最终分
  action: QuantAction;
  position: number;                // 建议仓位% 0-100
  stopLoss: number;                // 止损比例%
  takeProfit: number;              // 止盈比例%
  summary: string;
  tags: string[];                  // 标签：如"量价齐升","资金共振"
}

export type QuantAction = "强力做多" | "做多" | "轻仓试多" | "观望" | "轻仓试空" | "做空" | "强力做空";

/** 因子暴露集中度警告 */
export interface FactorConcentrationAlert {
  category: FactorCategory;
  exposure: number;           // 平均暴露分
  hhi: number;                // 赫芬达尔指数 0-1 (越高越集中)
  risk: "低" | "中" | "高";
  warning: string;
}

/** 跨周期确认 */
export interface WeeklyConfirmation {
  code: string;
  name: string;
  weeklyTrend: "多" | "空" | "中性";
  dailyTrend: "多" | "空" | "中性";
  confirmed: boolean;          // 日线周线方向一致
  confidenceAdj: number;      // 信心加减分 -10~+10
}

/** 全局量化报告 */
export interface QuantReport {
  timestamp: string;
  regime: MarketRegime;
  regimeDetail: string;
  factorExposure: { category: FactorCategory; avgScore: number }[];
  strategyPerformance: { name: StrategyName; avgStrength: number; consensus: number }[];
  decisions: QuantDecision[];
  topLong: QuantDecision[];
  topShort: QuantDecision[];
  marketScore: number;             // 全市场综合分
  riskBudget: number;              // 建议总仓位%
  summary: string;
  factorConcentration?: FactorConcentrationAlert[];
  weeklyConfirmations?: WeeklyConfirmation[];
}

// ================================================================
//  Layer 1: 多因子模型
// ================================================================

export interface RawFactors {
  // 动量族
  ret5d: number;      // 5日收益率
  ret10d: number;     // 10日收益率
  ret20d: number;     // 20日收益率
  retRelative: number; // 相对大盘超额

  // 价值族
  amplitude20d: number;  // 20日振幅（低振幅=稳定价值）
  distFromHigh: number;  // 距20日高点距离%（负值=回调幅度）
  distFromLow: number;   // 距20日低点距离%（正值=反弹幅度）

  // 质量族
  winRate: number;        // 近20日上涨天数比例
  avgVolRatio: number;    // 均量比（近5日/近20日）
  trendConsistency: number; // 趋势一致性（收盘价线性回归R²）

  // 波动率族
  volatility20d: number;  // 20日波动率（日收益std）
  maxDrawdown20d: number; // 20日最大回撤%
  atr14: number;          // ATR14 / 价格

  // 资金流族
  mainNetInflow: number;    // 主力净流入占比%
  northboundScore: number;  // 北向资金评分
  volumeTrend: number;      // 量能趋势（5日均量/20日均量）
  moneyFlowTrend: number;   // 多日资金流向趋势分（正=持续流入）
  moneyFlowMomentum: number; // 资金加速度（近期vs远期）
  marginTrend: number;      // 融资余额变化趋势分

  // 技术面族
  maScore: number;       // 均线排列分（MA5>10>20>60各+1）
  rsi14: number;         // RSI14
  macdSignal: number;    // MACD柱状（正=多，负=空）
  bollingerPos: number;  // 布林带位置 0-1（0=下轨，1=上轨）

  // 情绪面族（新增）
  sentimentScore: number;     // 市场情绪综合分 -100~100
  breadthScore: number;       // 市场宽度分（涨跌比+强弱股比）

  // 估值+筹码族（新增）
  valuationScore: number;     // 估值安全边际分（PE/PB分位越低越好）
  turnoverRatio: number;      // 换手率比（放量=积极）
  chipConcentration: number;  // 筹码集中度 0-100

  // 量价形态族（新增）
  volumePattern: number;      // 量价形态分 -50~50
  sectorRotation: number;     // 板块轮动分 -50~50（排名上升=正）
}

export const FACTOR_DEFS: {
  name: string;
  category: FactorCategory;
  key: keyof RawFactors;
  higherIsBetter: boolean;
  baseWeight: number;
}[] = [
  // 动量
  { name: "5日动量", category: "动量", key: "ret5d", higherIsBetter: true, baseWeight: 8 },
  { name: "10日动量", category: "动量", key: "ret10d", higherIsBetter: true, baseWeight: 7 },
  { name: "20日动量", category: "动量", key: "ret20d", higherIsBetter: true, baseWeight: 6 },
  { name: "超额收益", category: "动量", key: "retRelative", higherIsBetter: true, baseWeight: 9 },
  // 价值
  { name: "波动稳定性", category: "价值", key: "amplitude20d", higherIsBetter: false, baseWeight: 5 },
  { name: "回调深度", category: "价值", key: "distFromHigh", higherIsBetter: false, baseWeight: 6 },
  { name: "反弹力度", category: "价值", key: "distFromLow", higherIsBetter: true, baseWeight: 5 },
  // 质量
  { name: "胜率", category: "质量", key: "winRate", higherIsBetter: true, baseWeight: 7 },
  { name: "量比", category: "质量", key: "avgVolRatio", higherIsBetter: true, baseWeight: 5 },
  { name: "趋势一致性", category: "质量", key: "trendConsistency", higherIsBetter: true, baseWeight: 8 },
  // 波动率
  { name: "波动率", category: "波动率", key: "volatility20d", higherIsBetter: false, baseWeight: 6 },
  { name: "最大回撤", category: "波动率", key: "maxDrawdown20d", higherIsBetter: false, baseWeight: 7 },
  { name: "ATR", category: "波动率", key: "atr14", higherIsBetter: false, baseWeight: 4 },
  // 资金流
  { name: "主力资金", category: "资金流", key: "mainNetInflow", higherIsBetter: true, baseWeight: 9 },
  { name: "北向资金", category: "资金流", key: "northboundScore", higherIsBetter: true, baseWeight: 7 },
  { name: "量能趋势", category: "资金流", key: "volumeTrend", higherIsBetter: true, baseWeight: 6 },
  { name: "资金流向趋势", category: "资金流", key: "moneyFlowTrend", higherIsBetter: true, baseWeight: 8 },
  { name: "资金加速度", category: "资金流", key: "moneyFlowMomentum", higherIsBetter: true, baseWeight: 6 },
  { name: "融资趋势", category: "资金流", key: "marginTrend", higherIsBetter: true, baseWeight: 5 },
  // 技术面
  { name: "均线排列", category: "技术面", key: "maScore", higherIsBetter: true, baseWeight: 8 },
  { name: "RSI", category: "技术面", key: "rsi14", higherIsBetter: false, baseWeight: 5 }, // 中性好
  { name: "MACD", category: "技术面", key: "macdSignal", higherIsBetter: true, baseWeight: 7 },
  { name: "布林位置", category: "技术面", key: "bollingerPos", higherIsBetter: false, baseWeight: 4 }, // 中性
  // 情绪面（新增）
  { name: "市场情绪", category: "质量", key: "sentimentScore", higherIsBetter: true, baseWeight: 7 },
  { name: "市场宽度", category: "质量", key: "breadthScore", higherIsBetter: true, baseWeight: 6 },
  // 估值+筹码（新增）
  { name: "估值安全边际", category: "价值", key: "valuationScore", higherIsBetter: true, baseWeight: 7 },
  { name: "换手率活跃度", category: "质量", key: "turnoverRatio", higherIsBetter: true, baseWeight: 5 },
  { name: "筹码集中度", category: "价值", key: "chipConcentration", higherIsBetter: true, baseWeight: 6 },
  // 量价形态+板块轮动（新增）
  { name: "量价形态", category: "技术面", key: "volumePattern", higherIsBetter: true, baseWeight: 8 },
  { name: "板块轮动", category: "资金流", key: "sectorRotation", higherIsBetter: true, baseWeight: 7 },
];

interface EnhancedContext {
  breadth?: MarketBreadthData;
  margin?: MarginData[];
  valuation?: ValuationData;
  turnover?: TurnoverTrend;
}

export function calcRawFactors(klines: KLineData[], sectorData: EnrichedSectorData | null, northbound: NorthboundFlow[], marketChange: number, enhanced?: EnhancedContext): RawFactors {
  const len = klines.length;
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);

  // 收益率
  const ret = (n: number) => len >= n + 1 ? ((closes[len - 1] - closes[len - 1 - n]) / closes[len - 1 - n]) * 100 : 0;
  const ret5d = ret(5);
  const ret10d = ret(10);
  const ret20d = ret(20);
  const retRelative = ret5d - marketChange;

  // 价值
  const last20h = highs.slice(-20);
  const last20l = lows.slice(-20);
  const high20 = last20h.length > 0 ? Math.max(...last20h) : closes[len - 1];
  const low20 = last20l.length > 0 ? Math.min(...last20l) : closes[len - 1];
  const amplitude20d = high20 > 0 ? ((high20 - low20) / low20) * 100 : 0;
  const distFromHigh = high20 > 0 ? ((closes[len - 1] - high20) / high20) * 100 : 0;
  const distFromLow = low20 > 0 ? ((closes[len - 1] - low20) / low20) * 100 : 0;

  // 质量
  const last20c = closes.slice(-20);
  const upDays = last20c.filter((c, i) => i > 0 && c > last20c[i - 1]).length;
  const winRate = last20c.length > 1 ? (upDays / (last20c.length - 1)) * 100 : 50;

  const vol5 = avg(volumes.slice(-5));
  const vol20 = avg(volumes.slice(-20));
  const avgVolRatio = vol20 > 0 ? vol5 / vol20 : 1;

  const trendConsistency = calcR2(last20c);

  // 波动率
  const dailyRets = last20c.slice(1).map((c, i) => (c - last20c[i]) / last20c[i]);
  const volatility20d = std(dailyRets) * 100;
  const maxDrawdown20d = calcMaxDrawdown(last20c);
  const atr14 = calcATR(klines.slice(-15)) / (closes[len - 1] || 1) * 100;

  // 资金流
  const mainNetInflow = sectorData?.mainNetInflowPercent || 0;
  const nbTotal = northbound.slice(-3).reduce((s, n) => s + n.total, 0);
  const northboundScore = nbTotal > 50e8 ? 80 : nbTotal > 20e8 ? 60 : nbTotal > 0 ? 40 : nbTotal > -20e8 ? 20 : 0;
  const volumeTrend = vol20 > 0 ? vol5 / vol20 : 1;

  // 技术面
  const ma5 = avg(closes.slice(-5));
  const ma10 = avg(closes.slice(-10));
  const ma20 = avg(closes.slice(-20));
  const ma60 = len >= 60 ? avg(closes.slice(-60)) : ma20;
  let maScore = 0;
  if (ma5 > ma10) maScore++;
  if (ma10 > ma20) maScore++;
  if (ma20 > ma60) maScore++;
  if (closes[len - 1] > ma5) maScore++;

  const rsi14 = calcRSI(closes.slice(-15));
  const macdSignal = calcMACDHist(closes);
  const bollingerPos = calcBollingerPosition(closes);

  // 新增：资金流趋势（利用K线成交量推算）
  const vol3 = avg(volumes.slice(-3));
  const volPrev3 = avg(volumes.slice(-6, -3));
  const moneyFlowTrend = sectorData ? (sectorData.mainNetInflow > 0 ? 30 : sectorData.mainNetInflow < -1e8 ? -30 : 0)
    + (vol5 > vol20 ? 20 : -10) : (vol5 > vol20 ? 15 : -5);
  const moneyFlowMomentum = volPrev3 > 0 ? ((vol3 - volPrev3) / volPrev3) * 50 : 0;

  // 新增：融资趋势
  let marginTrend = 0;
  if (enhanced?.margin && enhanced.margin.length >= 3) {
    const recent3 = enhanced.margin.slice(0, 3);
    const netBuy3 = recent3.reduce((s, m) => s + m.netMarginBuy, 0);
    marginTrend = netBuy3 > 30 ? 40 : netBuy3 > 10 ? 20 : netBuy3 > 0 ? 5 : netBuy3 > -10 ? -5 : netBuy3 > -30 ? -20 : -40;
  }

  // 新增：市场情绪+宽度
  const sentimentScore = enhanced?.breadth?.sentimentScore || 0;
  const breadthScore = enhanced?.breadth
    ? clamp((enhanced.breadth.upDownRatio - 1) * 20 + (enhanced.breadth.strongStockRatio - enhanced.breadth.weakStockRatio) * 0.5, -60, 60)
    : 0;

  // 新增：估值安全边际（PE/PB分位越低=越安全=越高分）
  let valuationScore = 0;
  if (enhanced?.valuation) {
    const pePct = enhanced.valuation.pePercentile;
    const pbPct = enhanced.valuation.pbPercentile;
    // 低估值=高安全边际=高分
    valuationScore = (100 - (pePct * 0.6 + pbPct * 0.4)) - 50; // -50~50
  }

  // 新增：换手率+筹码
  const turnoverRatioVal = enhanced?.turnover?.turnoverRatio || (vol20 > 0 ? vol5 / vol20 : 1);
  const chipConc = enhanced?.turnover?.chipConcentration || 50;

  // 新增：量价形态识别
  const volumePattern = calcVolumePattern(klines);

  // 新增：板块轮动（由sectorData的changePercent与板块排名变化推算）
  const sectorRotation = calcSectorRotation(sectorData);

  return {
    ret5d, ret10d, ret20d, retRelative,
    amplitude20d, distFromHigh, distFromLow,
    winRate, avgVolRatio, trendConsistency,
    volatility20d, maxDrawdown20d, atr14,
    mainNetInflow, northboundScore, volumeTrend,
    moneyFlowTrend, moneyFlowMomentum, marginTrend,
    maScore, rsi14, macdSignal, bollingerPos,
    sentimentScore, breadthScore,
    valuationScore, turnoverRatio: turnoverRatioVal, chipConcentration: chipConc,
    volumePattern, sectorRotation,
  };
}

/** 截面标准化：z-score + percentile */
function crossSectionalNormalize(allRaw: { code: string; factors: RawFactors }[]): Map<string, Map<keyof RawFactors, { z: number; pct: number }>> {
  const result = new Map<string, Map<keyof RawFactors, { z: number; pct: number }>>();
  const keys = Object.keys(allRaw[0]?.factors || {}) as (keyof RawFactors)[];

  for (const key of keys) {
    const vals = allRaw.map(r => r.factors[key]);
    const m = avg(vals);
    const s = std(vals) || 1;
    const sorted = [...vals].sort((a, b) => a - b);

    for (let i = 0; i < allRaw.length; i++) {
      const code = allRaw[i].code;
      const z = clamp((vals[i] - m) / s, -3, 3);
      const rank = sorted.indexOf(vals[i]);
      const pct = (rank / Math.max(sorted.length - 1, 1)) * 100;
      if (!result.has(code)) result.set(code, new Map());
      result.get(code)!.set(key, { z, pct });
    }
  }
  return result;
}

function buildFactorScores(raw: RawFactors, norm: Map<keyof RawFactors, { z: number; pct: number }>, regime: MarketRegime, icWeights?: Map<string, ICWeightAdjustment>): FactorScore[] {
  const regimeWeightAdj = getRegimeWeightAdj(regime);

  return FACTOR_DEFS.map(def => {
    const n = norm.get(def.key) || { z: 0, pct: 50 };
    let z = n.z;
    // RSI和布林位置用"距50的偏差"（50附近最好）
    if (def.key === "rsi14") z = -Math.abs(z); // 越极端越差
    if (def.key === "bollingerPos") z = -Math.abs(z); // 越极端越差
    if (!def.higherIsBetter && def.key !== "rsi14" && def.key !== "bollingerPos") z = -z;

    const categoryAdj = regimeWeightAdj[def.category] || 1;
    const icAdj = icWeights?.get(def.key)?.multiplier || 1;
    const weight = def.baseWeight * categoryAdj * icAdj;
    const weighted = z * weight;

    let desc = "";
    const rawVal = raw[def.key];
    if (def.category === "动量") desc = `${rawVal >= 0 ? "+" : ""}${rawVal.toFixed(2)}%`;
    else if (def.key === "winRate") desc = `${rawVal.toFixed(0)}%胜率`;
    else if (def.key === "rsi14") desc = `RSI=${rawVal.toFixed(1)}`;
    else if (def.key === "mainNetInflow") desc = `净流入占比${rawVal.toFixed(2)}%`;
    else if (def.key === "maScore") desc = `${rawVal}/4 排列`;
    else desc = `${rawVal.toFixed(2)}`;

    return {
      name: def.name,
      category: def.category,
      raw: rawVal,
      zScore: Math.round(z * 100) / 100,
      percentile: Math.round(n.pct),
      weight: Math.round(weight * 10) / 10,
      weighted: Math.round(weighted * 10) / 10,
      desc,
    };
  });
}

// ================================================================
//  Layer 2: AI增强（市场状态识别 + 非线性组合）
// ================================================================

function identifyRegime(
  klines: KLineData[], northbound: NorthboundFlow[], marketChange: number,
  breadth?: MarketBreadthData, margin?: MarginData[],
): { regime: MarketRegime; detail: string } {
  if (klines.length < 20) return { regime: "震荡区间", detail: "数据不足" };

  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const last20 = closes.slice(-20);
  const ret20 = ((last20[last20.length - 1] - last20[0]) / last20[0]) * 100;

  const dailyRets = last20.slice(1).map((c, i) => (c - last20[i]) / last20[i]);
  const vol = std(dailyRets) * 100;
  const r2 = calcR2(last20);
  const volRatio = avg(volumes.slice(-5)) / (avg(volumes.slice(-20)) || 1);

  // ===== 多维度评分 =====
  // 维度1: 价格趋势 (-100~100)
  const priceTrend = clamp(ret20 * 5, -100, 100);

  // 维度2: 北向资金 (-100~100)
  const nbTotal = northbound.slice(-5).reduce((s, n) => s + n.total, 0);
  const nbScore = clamp(nbTotal / 1e8, -60, 60); // 万→百分比

  // 维度3: 市场情绪 (-100~100)
  const sentimentScore = breadth?.sentimentScore || 0;
  const upDownRatio = breadth?.upDownRatio || 1;

  // 维度4: 融资趋势 (-50~50)
  let marginScore = 0;
  if (margin && margin.length >= 3) {
    const netBuy3 = margin.slice(0, 3).reduce((s, m) => s + m.netMarginBuy, 0);
    marginScore = clamp(netBuy3 * 2, -50, 50);
  }

  // 维度5: 量能 (-30~30)
  const volumeScore = clamp((volRatio - 1) * 30, -30, 30);

  // 综合多维度得分
  const compositeScore = priceTrend * 0.3 + nbScore * 0.2 + sentimentScore * 0.2 + marginScore * 0.15 + volumeScore * 0.15;

  // 构建详情
  const dims: string[] = [
    `价格${ret20 > 0 ? "+" : ""}${ret20.toFixed(1)}%(R²${r2.toFixed(2)})`,
    nbTotal !== 0 ? `北向${nbTotal > 0 ? "+" : ""}${(nbTotal / 1e4).toFixed(0)}万` : "",
    sentimentScore !== 0 ? `情绪${sentimentScore > 0 ? "+" : ""}${sentimentScore.toFixed(0)}` : "",
    marginScore !== 0 ? `融资${marginScore > 0 ? "+" : ""}${marginScore.toFixed(0)}` : "",
    `量比${volRatio.toFixed(2)}`,
  ].filter(Boolean);
  const detailBase = dims.join(" | ");

  // 判定regime（多维度综合，不再单纯依赖价格）
  if (compositeScore > 25 && r2 > 0.4) {
    return { regime: "趋势上行", detail: `综合+${compositeScore.toFixed(0)} | ${detailBase}` };
  }
  if (compositeScore < -25 && r2 > 0.4) {
    return { regime: "趋势下行", detail: `综合${compositeScore.toFixed(0)} | ${detailBase}` };
  }
  if (vol > 2.5 || (Math.abs(compositeScore) > 15 && r2 < 0.3)) {
    return { regime: "波动放大", detail: `波动率${vol.toFixed(2)}% | ${detailBase}` };
  }
  if (vol < 1 && Math.abs(ret20) < 3 && Math.abs(compositeScore) < 10) {
    return { regime: "低波横盘", detail: `低波${vol.toFixed(2)}% | ${detailBase}` };
  }
  return { regime: "震荡区间", detail: `综合${compositeScore.toFixed(0)} | ${detailBase}` };
}

function getRegimeWeightAdj(regime: MarketRegime): Record<FactorCategory, number> {
  switch (regime) {
    case "趋势上行":
      return { "动量": 1.4, "价值": 0.7, "质量": 1.0, "波动率": 0.6, "资金流": 1.3, "技术面": 1.2 };
    case "趋势下行":
      return { "动量": 0.6, "价值": 1.3, "质量": 1.2, "波动率": 1.4, "资金流": 1.0, "技术面": 1.1 };
    case "波动放大":
      return { "动量": 0.8, "价值": 1.0, "质量": 1.3, "波动率": 1.5, "资金流": 0.9, "技术面": 1.0 };
    case "低波横盘":
      return { "动量": 0.7, "价值": 1.4, "质量": 1.0, "波动率": 0.8, "资金流": 1.3, "技术面": 1.0 };
    case "震荡区间":
    default:
      return { "动量": 1.0, "价值": 1.0, "质量": 1.0, "波动率": 1.0, "资金流": 1.0, "技术面": 1.0 };
  }
}

function aiEnhance(factorComposite: number, factors: FactorScore[], regime: MarketRegime): { score: number; boost: number; reason: string } {
  let boost = 0;
  const reasons: string[] = [];

  // 1. 因子共振检测：多个大类因子同方向 → 非线性加成
  const catScores: Record<string, number> = {};
  for (const f of factors) {
    catScores[f.category] = (catScores[f.category] || 0) + f.weighted;
  }
  const bullCats = Object.entries(catScores).filter(([, v]) => v > 5).length;
  const bearCats = Object.entries(catScores).filter(([, v]) => v < -5).length;

  if (bullCats >= 4) {
    boost += 15;
    reasons.push(`${bullCats}大因子族共振看多`);
  } else if (bearCats >= 4) {
    boost -= 15;
    reasons.push(`${bearCats}大因子族共振看空`);
  }

  // 2. 市场状态适配奖惩
  const momentum = catScores["动量"] || 0;
  if (regime === "趋势上行" && momentum > 10) {
    boost += 10;
    reasons.push("趋势市+强动量=顺势加分");
  }
  if (regime === "趋势下行" && momentum > 10) {
    boost -= 5;
    reasons.push("下行趋势中逆势动量需谨慎");
  }
  if (regime === "波动放大") {
    const volFactor = catScores["波动率"] || 0;
    if (volFactor < -5) {
      boost -= 8;
      reasons.push("高波环境+波动率因子看空=风险加大");
    }
  }

  // 3. 资金动量共振
  const capitalScore = catScores["资金流"] || 0;
  if (momentum > 5 && capitalScore > 5) {
    boost += 8;
    reasons.push("量价齐升+资金流入共振");
  }
  if (momentum < -5 && capitalScore < -5) {
    boost -= 8;
    reasons.push("价跌量缩+资金流出共振");
  }

  // 4. 极端值检测（均值回归信号）
  const rsiF = factors.find(f => f.name === "RSI");
  if (rsiF && rsiF.raw > 75) {
    boost -= 5;
    reasons.push("RSI超买区域警告");
  }
  if (rsiF && rsiF.raw < 25) {
    boost += 5;
    reasons.push("RSI超卖区域反弹概率增大");
  }

  const score = clamp(factorComposite + boost, -100, 100);
  return { score, boost, reason: reasons.join("；") || "无明显非线性信号" };
}

// ================================================================
//  Layer 3: 复合策略矩阵
// ================================================================

function trendFollowingStrategy(klines: KLineData[], factors: RawFactors): StrategySignal {
  const triggers: string[] = [];
  let strength = 0;

  // MA排列
  if (factors.maScore >= 3) { strength += 30; triggers.push("均线多头排列"); }
  else if (factors.maScore <= 1) { strength -= 30; triggers.push("均线空头排列"); }

  // 20日动量
  if (factors.ret20d > 5) { strength += 25; triggers.push(`20日涨${factors.ret20d.toFixed(1)}%`); }
  else if (factors.ret20d < -5) { strength -= 25; triggers.push(`20日跌${factors.ret20d.toFixed(1)}%`); }

  // 量能配合
  if (factors.volumeTrend > 1.3 && factors.ret5d > 0) { strength += 20; triggers.push("放量上涨"); }
  if (factors.volumeTrend > 1.3 && factors.ret5d < 0) { strength -= 15; triggers.push("放量下跌"); }

  // MACD精细化确认
  const macd = calcMACDFull(klines.map(k => k.close));
  if (macd.crossSignal === "金叉" && macd.crossDaysAgo <= 3) {
    strength += 20; triggers.push(`MACD金叉(${macd.crossDaysAgo}日前)`);
    if (macd.aboveZero) { strength += 5; triggers.push("零轴上方金叉(强)"); }
  } else if (macd.crossSignal === "死叉" && macd.crossDaysAgo <= 3) {
    strength -= 20; triggers.push(`MACD死叉(${macd.crossDaysAgo}日前)`);
    if (!macd.aboveZero) { strength -= 5; triggers.push("零轴下方死叉(弱)"); }
  } else if (factors.macdSignal > 0) { strength += 10; triggers.push("MACD多头"); }
  else if (factors.macdSignal < 0) { strength -= 10; triggers.push("MACD空头"); }
  if (macd.histogramExpanding && macd.histogram > 0) { strength += 8; triggers.push("MACD柱放大"); }
  if (macd.histogramExpanding && macd.histogram < 0) { strength -= 8; triggers.push("MACD绿柱放大"); }

  // 趋势一致性
  if (factors.trendConsistency > 0.6) { strength += 10; triggers.push("趋势一致性强"); }

  strength = clamp(strength, -100, 100);

  return {
    strategy: "趋势跟踪",
    direction: strength > 15 ? "long" : strength < -15 ? "short" : "neutral",
    strength,
    confidence: Math.min(90, 40 + Math.abs(strength) * 0.5),
    reason: strength > 15 ? "趋势向上确认，顺势做多" : strength < -15 ? "趋势向下确认，回避或做空" : "趋势不明确，观望",
    triggers,
  };
}

function meanReversionStrategy(klines: KLineData[], factors: RawFactors): StrategySignal {
  const triggers: string[] = [];
  let strength = 0;

  // 超跌反弹信号
  if (factors.distFromHigh < -10 && factors.rsi14 < 30) {
    strength += 35;
    triggers.push(`距高点${factors.distFromHigh.toFixed(1)}%+RSI超卖`);
  }
  if (factors.distFromHigh < -15) {
    strength += 20;
    triggers.push(`深度回调${factors.distFromHigh.toFixed(1)}%`);
  }

  // 超涨回调信号
  if (factors.distFromLow > 15 && factors.rsi14 > 70) {
    strength -= 35;
    triggers.push(`距低点涨${factors.distFromLow.toFixed(1)}%+RSI超买`);
  }
  if (factors.bollingerPos > 0.9) {
    strength -= 20;
    triggers.push("触及布林上轨");
  }
  if (factors.bollingerPos < 0.1) {
    strength += 20;
    triggers.push("触及布林下轨");
  }

  // 波动率收敛后方向选择
  if (factors.volatility20d < 1.5 && Math.abs(factors.ret5d) > 3) {
    const dir = factors.ret5d > 0 ? 1 : -1;
    strength += dir * 15;
    triggers.push("低波突破");
  }

  strength = clamp(strength, -100, 100);

  return {
    strategy: "均值回归",
    direction: strength > 15 ? "long" : strength < -15 ? "short" : "neutral",
    strength,
    confidence: Math.min(85, 35 + Math.abs(strength) * 0.5),
    reason: strength > 15 ? "超跌反弹概率大，逆势做多" : strength < -15 ? "超涨回调风险，注意止盈" : "估值中性区间",
    triggers,
  };
}

function eventDrivenStrategy(sector: string, eventSummaries: SectorEventSummary[], topEvents: EventSignal[]): StrategySignal {
  const triggers: string[] = [];
  let strength = 0;

  const eventResult = getSectorEventScore(sector, eventSummaries);
  const eventScore = typeof eventResult === "number" ? eventResult : eventResult.score;
  if (eventScore > 30) { strength += 30; triggers.push(`事件驱动强(${eventScore}分)`); }
  else if (eventScore > 15) { strength += 15; triggers.push(`事件偏多(${eventScore}分)`); }
  else if (eventScore < -15) { strength -= 15; triggers.push(`事件利空(${eventScore}分)`); }
  else if (eventScore < -30) { strength -= 30; triggers.push(`重大利空(${eventScore}分)`); }

  const sectorEvents = topEvents.filter(e =>
    e.sectors.some(s => sector.includes(s) || s.includes(sector))
  ).slice(0, 3);

  for (const ev of sectorEvents) {
    if (ev.impact === "利好" && ev.weight >= 7) {
      strength += 15;
      triggers.push(`利好:${ev.title.slice(0, 15)}`);
    }
    if (ev.impact === "利空" && ev.weight >= 7) {
      strength -= 15;
      triggers.push(`利空:${ev.title.slice(0, 15)}`);
    }
  }

  strength = clamp(strength, -100, 100);

  return {
    strategy: "事件驱动",
    direction: strength > 10 ? "long" : strength < -10 ? "short" : "neutral",
    strength,
    confidence: Math.min(80, 30 + Math.abs(strength) * 0.6),
    reason: strength > 10 ? "事件催化偏多" : strength < -10 ? "事件偏空需回避" : "无重大催化",
    triggers,
  };
}

function momentumReversalStrategy(factors: RawFactors): StrategySignal {
  const triggers: string[] = [];
  let strength = 0;

  // 短期动量与中期动量背离
  if (factors.ret5d > 3 && factors.ret20d < -3) {
    strength += 25;
    triggers.push("短强长弱=反弹初期");
  }
  if (factors.ret5d < -3 && factors.ret20d > 3) {
    strength -= 25;
    triggers.push("短弱长强=见顶回调");
  }

  // 量价背离
  if (factors.ret5d > 2 && factors.volumeTrend < 0.8) {
    strength -= 15;
    triggers.push("价涨量缩背离");
  }
  if (factors.ret5d < -2 && factors.volumeTrend > 1.3) {
    strength += 10;
    triggers.push("放量下跌接近底部");
  }

  // 资金与价格背离
  if (factors.mainNetInflow > 2 && factors.ret5d < 0) {
    strength += 15;
    triggers.push("价跌资金流入=吸筹");
  }
  if (factors.mainNetInflow < -2 && factors.ret5d > 0) {
    strength -= 15;
    triggers.push("价涨资金流出=派发");
  }

  // 超额收益反转
  if (factors.retRelative > 5) {
    strength -= 10;
    triggers.push("大幅跑赢大盘后回归概率大");
  }
  if (factors.retRelative < -5) {
    strength += 10;
    triggers.push("大幅跑输大盘后补涨概率大");
  }

  strength = clamp(strength, -100, 100);

  return {
    strategy: "动量反转",
    direction: strength > 15 ? "long" : strength < -15 ? "short" : "neutral",
    strength,
    confidence: Math.min(75, 25 + Math.abs(strength) * 0.6),
    reason: strength > 15 ? "反转做多信号出现" : strength < -15 ? "动量衰竭需防转向" : "动量延续无反转信号",
    triggers,
  };
}

/** 策略矩阵融合 (支持策略绩效自评估动态调权) */
function fuseStrategies(strategies: StrategySignal[], regime: MarketRegime, strategyPerfAdj?: Map<string, number>): { score: number; consensus: "强共识" | "弱共识" | "分歧" } {
  // 各策略在不同市场状态下的基础权重
  const weights: Record<MarketRegime, Record<StrategyName, number>> = {
    "趋势上行": { "趋势跟踪": 0.40, "均值回归": 0.15, "事件驱动": 0.25, "动量反转": 0.20 },
    "趋势下行": { "趋势跟踪": 0.35, "均值回归": 0.20, "事件驱动": 0.20, "动量反转": 0.25 },
    "震荡区间": { "趋势跟踪": 0.20, "均值回归": 0.30, "事件驱动": 0.25, "动量反转": 0.25 },
    "波动放大": { "趋势跟踪": 0.25, "均值回归": 0.25, "事件驱动": 0.20, "动量反转": 0.30 },
    "低波横盘": { "趋势跟踪": 0.15, "均值回归": 0.35, "事件驱动": 0.30, "动量反转": 0.20 },
  };

  const w = { ...weights[regime] };

  // 策略绩效自评估：根据历史胜率动态调节权重
  if (strategyPerfAdj && strategyPerfAdj.size > 0) {
    for (const s of strategies) {
      const key = `${s.strategy}|${regime}`;
      const adj = strategyPerfAdj.get(key);
      if (adj !== undefined) {
        w[s.strategy] = (w[s.strategy] || 0.25) * adj;
      }
    }
    // 重新归一化权重总和为1
    const total = Object.values(w).reduce((s, v) => s + v, 0);
    if (total > 0) {
      for (const key of Object.keys(w) as StrategyName[]) {
        w[key] = w[key] / total;
      }
    }
  }

  let score = 0;
  for (const s of strategies) {
    score += s.strength * (w[s.strategy] || 0.25);
  }

  const longCount = strategies.filter(s => s.direction === "long").length;
  const shortCount = strategies.filter(s => s.direction === "short").length;
  let consensus: "强共识" | "弱共识" | "分歧";
  if (longCount >= 3 || shortCount >= 3) consensus = "强共识";
  else if (longCount >= 2 && shortCount === 0 || shortCount >= 2 && longCount === 0) consensus = "弱共识";
  else consensus = "分歧";

  return { score: clamp(Math.round(score), -100, 100), consensus };
}

// ================================================================
//  决策输出
// ================================================================

function makeQuantDecision(
  code: string, name: string, sector: string,
  factors: FactorScore[], factorComposite: number,
  aiScore: number, aiBoost: number, aiReason: string,
  regime: MarketRegime,
  strategies: StrategySignal[], matrixScore: number,
  matrixConsensus: "强共识" | "弱共识" | "分歧",
  factorDelta?: FactorDelta,
): QuantDecision {
  // 因子时序记忆加减分
  let trendBoost = 0;
  let trendSignal = factorDelta?.signal || "横盘";
  if (factorDelta) {
    // 加速上升 / 连续上升 → 加分
    if (factorDelta.signal === "加速上升") trendBoost = 8;
    else if (factorDelta.signal === "稳步上升" && factorDelta.trendDays >= 3) trendBoost = 6;
    else if (factorDelta.signal === "稳步上升") trendBoost = 3;
    else if (factorDelta.signal === "拐点向上") trendBoost = 5;
    // 减速上升 = 即将见顶预警
    else if (factorDelta.signal === "减速上升") trendBoost = -2;
    // 下降信号
    else if (factorDelta.signal === "加速下降") trendBoost = -8;
    else if (factorDelta.signal === "稳步下降" && factorDelta.trendDays <= -3) trendBoost = -6;
    else if (factorDelta.signal === "稳步下降") trendBoost = -3;
    else if (factorDelta.signal === "拐点向下") trendBoost = -5;
    else if (factorDelta.signal === "减速下降") trendBoost = 2; // 跌势放缓，可能反弹
  }

  // 三层加权：因子35% + AI增弰25% + 策略矩阵25% + 因子趋势15%
  const rawFinal = factorComposite * 0.35 + aiScore * 0.25 + matrixScore * 0.25 + trendBoost * 1.875;
  const finalScore = clamp(Math.round(rawFinal), -100, 100);

  let action: QuantAction;
  let position: number;
  if (finalScore >= 60) { action = "强力做多"; position = 80; }
  else if (finalScore >= 30) { action = "做多"; position = 50; }
  else if (finalScore >= 10) { action = "轻仓试多"; position = 20; }
  else if (finalScore >= -10) { action = "观望"; position = 0; }
  else if (finalScore >= -30) { action = "轻仓试空"; position = 10; }
  else if (finalScore >= -60) { action = "做空"; position = 30; }
  else { action = "强力做空"; position = 50; }

  // 根据共识度调整仓位
  if (matrixConsensus === "强共识") position = Math.min(100, position * 1.2);
  if (matrixConsensus === "分歧") position = Math.max(0, position * 0.6);

  // 止损止盈
  const volatility = factors.find(f => f.name === "波动率")?.raw || 2;
  const stopLoss = Math.max(3, Math.min(10, volatility * 2));
  const takeProfit = Math.max(5, Math.min(20, volatility * 3));

  // 标签
  const tags: string[] = [];
  const catMap: Record<string, number> = {};
  for (const f of factors) catMap[f.category] = (catMap[f.category] || 0) + f.weighted;
  if ((catMap["动量"] || 0) > 10 && (catMap["资金流"] || 0) > 5) tags.push("量价齐升");
  if ((catMap["动量"] || 0) < -10 && (catMap["资金流"] || 0) < -5) tags.push("量价齐跌");
  if (matrixConsensus === "强共识" && finalScore > 20) tags.push("多策略共振");
  if (aiBoost > 10) tags.push("AI增强看多");
  if (aiBoost < -10) tags.push("AI增强看空");
  const trendS = strategies.find(s => s.strategy === "趋势跟踪");
  if (trendS && trendS.strength > 50) tags.push("强趋势");
  const revertS = strategies.find(s => s.strategy === "均值回归");
  if (revertS && revertS.strength > 30) tags.push("超跌反弹");

  // 一句话总结
  const stratNames = strategies.filter(s => s.direction !== "neutral").map(s => `${s.strategy}${s.direction === "long" ? "多" : "空"}`);
  const summary = `${name} ${action}(${finalScore}分) | 因子${factorComposite > 0 ? "+" : ""}${factorComposite} → AI${aiBoost >= 0 ? "+" : ""}${aiBoost} → 矩阵${matrixScore > 0 ? "+" : ""}${matrixScore} | ${matrixConsensus} | ${stratNames.join("+")}`;

  // 趋势相关标签
  if (trendBoost >= 5) tags.push("因子连升");
  if (trendBoost <= -5) tags.push("因子连跌");
  if (factorDelta?.signal === "拐点向上") tags.push("拐点反转");
  if (factorDelta?.signal === "拐点向下") tags.push("拐点见顶");

  return {
    code, name, sector,
    factors, factorComposite,
    regime, aiAdjustedScore: aiScore, aiBoost, aiReason,
    strategies, matrixScore, matrixConsensus,
    trendBoost, trendSignal,
    finalScore, action, position: Math.round(position),
    stopLoss: Math.round(stopLoss * 10) / 10,
    takeProfit: Math.round(takeProfit * 10) / 10,
    summary, tags,
  };
}

// ================================================================
//  主入口
// ================================================================

export function generateQuantReport(
  targets: { code: string; name: string; sector: string; klines: KLineData[]; sectorData: EnrichedSectorData | null }[],
  northbound: NorthboundFlow[],
  marketChangePercent: number,
  eventSummaries: SectorEventSummary[],
  topEvents: EventSignal[],
  enhancedData?: { breadth?: MarketBreadthData; margin?: MarginData[]; valuations?: Map<string, ValuationData>; turnovers?: Map<string, TurnoverTrend> },
  factorDeltas?: Map<string, FactorDelta>,
  icWeights?: Map<string, ICWeightAdjustment>,
  strategyPerfAdj?: Map<string, number>,
): QuantReport {
  if (targets.length === 0) {
    return {
      timestamp: new Date().toISOString(),
      regime: "震荡区间",
      regimeDetail: "无数据",
      factorExposure: [],
      strategyPerformance: [],
      decisions: [],
      topLong: [],
      topShort: [],
      marketScore: 0,
      riskBudget: 0,
      summary: "无分析标的",
    };
  }

  // 全局市场状态（用第一个或最大的K线集合）
  const largestKlines = targets.reduce((a, b) => a.klines.length > b.klines.length ? a : b).klines;
  const { regime, detail: regimeDetail } = identifyRegime(largestKlines, northbound, marketChangePercent, enhancedData?.breadth, enhancedData?.margin);

  // Step 1: 计算所有标的的原始因子
  const allRaw = targets.map(t => ({
    code: t.code,
    factors: calcRawFactors(t.klines, t.sectorData, northbound, marketChangePercent, {
      breadth: enhancedData?.breadth,
      margin: enhancedData?.margin,
      valuation: enhancedData?.valuations?.get(t.code),
      turnover: enhancedData?.turnovers?.get(t.code),
    }),
  }));

  // Step 2: 截面标准化
  const normMap = crossSectionalNormalize(allRaw);

  // Step 3: 逐个标的跑三层流程
  const decisions: QuantDecision[] = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const raw = allRaw[i].factors;
    const norm = normMap.get(t.code) || new Map();

    // Layer 1 (IC自适应权重)
    const factors = buildFactorScores(raw, norm, regime, icWeights);
    const totalWeight = factors.reduce((s, f) => s + Math.abs(f.weight), 0) || 1;
    const factorComposite = clamp(Math.round(factors.reduce((s, f) => s + f.weighted, 0) / totalWeight * 30), -100, 100);

    // Layer 2
    const { score: aiScore, boost: aiBoost, reason: aiReason } = aiEnhance(factorComposite, factors, regime);

    // Layer 3
    const strats: StrategySignal[] = [
      trendFollowingStrategy(t.klines, raw),
      meanReversionStrategy(t.klines, raw),
      eventDrivenStrategy(t.sector, eventSummaries, topEvents),
      momentumReversalStrategy(raw),
    ];
    const { score: matrixScore, consensus: matrixConsensus } = fuseStrategies(strats, regime, strategyPerfAdj);

    decisions.push(makeQuantDecision(
      t.code, t.name, t.sector,
      factors, factorComposite,
      aiScore, aiBoost, aiReason,
      regime, strats, matrixScore, matrixConsensus,
      factorDeltas?.get(t.code),
    ));
  }

  decisions.sort((a, b) => b.finalScore - a.finalScore);

  // 聚合统计
  const catScores: Record<FactorCategory, number[]> = { "动量": [], "价值": [], "质量": [], "波动率": [], "资金流": [], "技术面": [] };
  for (const d of decisions) {
    for (const f of d.factors) {
      catScores[f.category].push(f.weighted);
    }
  }
  const factorExposure = Object.entries(catScores).map(([cat, vals]) => ({
    category: cat as FactorCategory,
    avgScore: Math.round(avg(vals) * 10) / 10,
  }));

  const stratNames: StrategyName[] = ["趋势跟踪", "均值回归", "事件驱动", "动量反转"];
  const strategyPerformance = stratNames.map(name => {
    const signals = decisions.map(d => d.strategies.find(s => s.strategy === name)!).filter(Boolean);
    const avgStr = avg(signals.map(s => s.strength));
    const consensusPct = signals.filter(s => s.direction !== "neutral").length / Math.max(signals.length, 1) * 100;
    return { name, avgStrength: Math.round(avgStr), consensus: Math.round(consensusPct) };
  });

  const marketScore = Math.round(avg(decisions.map(d => d.finalScore)));
  const longCount = decisions.filter(d => d.finalScore > 10).length;
  const shortCount = decisions.filter(d => d.finalScore < -10).length;
  const riskBudget = marketScore > 30 ? 80 : marketScore > 10 ? 60 : marketScore > -10 ? 40 : marketScore > -30 ? 20 : 10;

  const summary = `市场状态:${regime} | 全市场量化分${marketScore} | ${longCount}标的看多 ${shortCount}标的看空 | 建议仓位${riskBudget}% | ${strategyPerformance.filter(s => s.avgStrength > 10).map(s => s.name + "偏多").join("、") || "各策略分歧"}`;

  // 因子暴露集中度监控（仅对做多标的）
  const longDecisions = decisions.filter(d => d.finalScore > 10);
  const factorConcentration = calcFactorConcentration(longDecisions);

  // 跨周期确认（用K线数据计算周线趋势）
  const weeklyConfirmations = targets.map(t => {
    const d = decisions.find(dd => dd.code === t.code);
    return calcWeeklyConfirmation(t.code, t.name, t.klines, d);
  }).filter((w): w is WeeklyConfirmation => w !== null);

  // 如果因子集中度高，降低riskBudget
  const highConcAlerts = factorConcentration.filter(a => a.risk === "高");
  const adjustedRiskBudget = highConcAlerts.length > 0 ? Math.max(10, riskBudget - highConcAlerts.length * 10) : riskBudget;

  return {
    timestamp: new Date().toISOString(),
    regime, regimeDetail,
    factorExposure, strategyPerformance,
    decisions,
    topLong: decisions.filter(d => d.finalScore > 10).slice(0, 10),
    topShort: [...decisions].reverse().filter(d => d.finalScore < -10).slice(0, 10),
    marketScore, riskBudget: adjustedRiskBudget,
    summary,
    factorConcentration: factorConcentration.length > 0 ? factorConcentration : undefined,
    weeklyConfirmations: weeklyConfirmations.length > 0 ? weeklyConfirmations : undefined,
  };
}

// ================================================================
//  因子暴露集中度监控
// ================================================================

/**
 * 检测持仓组合的因子暴露是否过度集中
 * HHI (赫芬达尔指数) > 0.4 → 高集中度警告
 */
function calcFactorConcentration(longDecisions: QuantDecision[]): FactorConcentrationAlert[] {
  if (longDecisions.length < 2) return [];

  const categories: FactorCategory[] = ["动量", "价值", "质量", "波动率", "资金流", "技术面"];
  const alerts: FactorConcentrationAlert[] = [];

  for (const cat of categories) {
    // 每个标的在该因子族的暴露
    const exposures: number[] = [];
    for (const d of longDecisions) {
      const catFactors = d.factors.filter(f => f.category === cat);
      const catScore = catFactors.reduce((s, f) => s + f.weighted, 0);
      exposures.push(catScore);
    }

    const avgExposure = exposures.reduce((s, v) => s + v, 0) / exposures.length;

    // HHI: 各标的暴露占总暴露的份额平方和
    const totalAbs = exposures.reduce((s, v) => s + Math.abs(v), 0) || 1;
    const hhi = exposures.reduce((s, v) => s + (Math.abs(v) / totalAbs) ** 2, 0);

    // 同方向集中度：所有标的在该因子上同方向 = 拥挤
    const allPositive = exposures.every(v => v > 2);
    const allNegative = exposures.every(v => v < -2);
    const directionalCrowding = allPositive || allNegative;

    let risk: "低" | "中" | "高" = "低";
    let warning = "";

    if (hhi > 0.5 && directionalCrowding && Math.abs(avgExposure) > 5) {
      risk = "高";
      warning = `${cat}因子高度集中(HHI=${hhi.toFixed(2)})，所有持仓同方向暴露，需分散`;
    } else if ((hhi > 0.35 && directionalCrowding) || Math.abs(avgExposure) > 8) {
      risk = "中";
      warning = `${cat}因子偏集中(HHI=${hhi.toFixed(2)})，关注因子拥挤风险`;
    }

    if (risk !== "低") {
      alerts.push({
        category: cat,
        exposure: Math.round(avgExposure * 10) / 10,
        hhi: Math.round(hhi * 100) / 100,
        risk,
        warning,
      });
    }
  }

  return alerts;
}

// ================================================================
//  跨周期确认（周线验证日线）
// ================================================================

function calcWeeklyConfirmation(
  code: string, name: string, klines: KLineData[],
  decision: QuantDecision | undefined,
): WeeklyConfirmation | null {
  if (klines.length < 30 || !decision) return null;

  // 构造周线：按周分组取OHLCV
  const weeklyCloses: number[] = [];
  const weeklyVolumes: number[] = [];
  let weekStart = 0;
  for (let i = 1; i < klines.length; i++) {
    const d = new Date(klines[i].date);
    const prevD = new Date(klines[i - 1].date);
    // 周一或跨周
    if (d.getDay() <= prevD.getDay() || i === klines.length - 1) {
      // 本周结束
      const weekSlice = klines.slice(weekStart, i);
      if (weekSlice.length > 0) {
        weeklyCloses.push(weekSlice[weekSlice.length - 1].close);
        weeklyVolumes.push(weekSlice.reduce((s, k) => s + k.volume, 0));
      }
      weekStart = i;
    }
  }

  if (weeklyCloses.length < 5) return null;

  // 周线趋势判定：MA5 vs MA10 + 近4周方向
  const wLen = weeklyCloses.length;
  const wMA5 = avg(weeklyCloses.slice(-5));
  const wMA10 = weeklyCloses.length >= 10 ? avg(weeklyCloses.slice(-10)) : wMA5;
  const wRet4 = wLen >= 5 ? ((weeklyCloses[wLen - 1] - weeklyCloses[wLen - 5]) / weeklyCloses[wLen - 5]) * 100 : 0;
  const wMACD = weeklyCloses.length >= 26 ? calcMACDFull(weeklyCloses) : null;

  let weeklyTrend: "多" | "空" | "中性" = "中性";
  let weeklyScore = 0;

  if (wMA5 > wMA10) weeklyScore += 1;
  else weeklyScore -= 1;
  if (wRet4 > 2) weeklyScore += 1;
  else if (wRet4 < -2) weeklyScore -= 1;
  if (wMACD && wMACD.histogram > 0) weeklyScore += 1;
  else if (wMACD && wMACD.histogram < 0) weeklyScore -= 1;

  if (weeklyScore >= 2) weeklyTrend = "多";
  else if (weeklyScore <= -2) weeklyTrend = "空";

  // 日线趋势
  const dailyTrend: "多" | "空" | "中性" = decision.finalScore > 10 ? "多" : decision.finalScore < -10 ? "空" : "中性";

  // 确认判定
  const confirmed = (weeklyTrend === dailyTrend) || weeklyTrend === "中性";

  // 信心加减分
  let confidenceAdj = 0;
  if (weeklyTrend === dailyTrend && weeklyTrend !== "中性") {
    confidenceAdj = 8; // 日线周线共振 → 大加分
  } else if (weeklyTrend !== "中性" && dailyTrend !== "中性" && weeklyTrend !== dailyTrend) {
    confidenceAdj = -8; // 日线周线矛盾 → 大减分
  } else if (weeklyTrend === "中性") {
    confidenceAdj = 0; // 周线中性不影响
  }

  return { code, name, weeklyTrend, dailyTrend, confirmed, confidenceAdj };
}

// ================================================================
//  数学工具
// ================================================================

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function calcR2(values: number[]): number {
  if (values.length < 3) return 0;
  const n = values.length;
  const xs = values.map((_, i) => i);
  const xm = avg(xs), ym = avg(values);
  let ssxy = 0, ssxx = 0, ssyy = 0;
  for (let i = 0; i < n; i++) {
    ssxy += (xs[i] - xm) * (values[i] - ym);
    ssxx += (xs[i] - xm) ** 2;
    ssyy += (values[i] - ym) ** 2;
  }
  if (ssxx === 0 || ssyy === 0) return 0;
  const r = ssxy / Math.sqrt(ssxx * ssyy);
  return r * r;
}

function calcMaxDrawdown(values: number[]): number {
  let peak = values[0];
  let maxDD = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = ((peak - v) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function calcATR(klines: KLineData[]): number {
  if (klines.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < klines.length; i++) {
    const tr = Math.max(
      klines[i].high - klines[i].low,
      Math.abs(klines[i].high - klines[i - 1].close),
      Math.abs(klines[i].low - klines[i - 1].close),
    );
    sum += tr;
  }
  return sum / (klines.length - 1);
}

function calcRSI(closes: number[]): number {
  if (closes.length < 2) return 50;
  let gain = 0, loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gain += diff;
    else loss -= diff;
  }
  const n = closes.length - 1;
  const avgGain = gain / n;
  const avgLoss = loss / n;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

interface MACDResult {
  dif: number;
  dea: number;
  histogram: number;
  crossSignal: "金叉" | "死叉" | "无";
  crossDaysAgo: number;      // 最近交叉距今天数
  aboveZero: boolean;        // DIF在零轴上方
  histogramExpanding: boolean; // 柱状放大中
}

function calcMACDFull(closes: number[]): MACDResult {
  const defaultResult: MACDResult = { dif: 0, dea: 0, histogram: 0, crossSignal: "无", crossDaysAgo: 99, aboveZero: false, histogramExpanding: false };
  if (closes.length < 35) return defaultResult;

  // 计算DIF序列 (EMA12 - EMA26)
  const ema12s = calcEMASeries(closes, 12);
  const ema26s = calcEMASeries(closes, 26);
  const difSeries = ema12s.map((v, i) => v - ema26s[i]);

  // DEA = DIF的9日EMA
  const deas = calcEMASeries(difSeries.slice(26), 9); // 从第26天开始有效DIF
  const histSeries = difSeries.slice(26).map((d, i) => i < deas.length ? (d - deas[i]) * 2 : 0);

  const n = deas.length;
  if (n < 3) return defaultResult;

  const dif = difSeries[difSeries.length - 1];
  const dea = deas[n - 1];
  const histogram = (dif - dea) * 2;

  // 检测金叉/死叉（DIF穿越DEA）
  let crossSignal: "金叉" | "死叉" | "无" = "无";
  let crossDaysAgo = 99;
  for (let i = n - 1; i >= Math.max(0, n - 10); i--) {
    const difI = difSeries[26 + i];
    const deaI = deas[i];
    const difPrev = difSeries[26 + i - 1];
    const deaPrev = i > 0 ? deas[i - 1] : deaI;
    if (difPrev <= deaPrev && difI > deaI) {
      crossSignal = "金叉";
      crossDaysAgo = n - 1 - i;
      break;
    }
    if (difPrev >= deaPrev && difI < deaI) {
      crossSignal = "死叉";
      crossDaysAgo = n - 1 - i;
      break;
    }
  }

  // 柱状是否放大
  const histogramExpanding = histSeries.length >= 3 &&
    Math.abs(histSeries[histSeries.length - 1]) > Math.abs(histSeries[histSeries.length - 2]) &&
    Math.abs(histSeries[histSeries.length - 2]) > Math.abs(histSeries[histSeries.length - 3]);

  return { dif, dea, histogram, crossSignal, crossDaysAgo, aboveZero: dif > 0, histogramExpanding };
}

function calcMACDHist(closes: number[]): number {
  return calcMACDFull(closes).histogram;
}

function calcEMASeries(data: number[], period: number): number[] {
  if (data.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function calcEMA(data: number[], period: number): number {
  if (data.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = data[0];
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcBollingerPosition(closes: number[]): number {
  const slice = closes.slice(-20);
  if (slice.length < 5) return 0.5;
  const m = avg(slice);
  const s = std(slice);
  if (s === 0) return 0.5;
  const upper = m + 2 * s;
  const lower = m - 2 * s;
  return clamp((closes[closes.length - 1] - lower) / (upper - lower), 0, 1);
}

// ================================================================
//  量价形态识别
// ================================================================

/**
 * 经典量价形态打分 (-50~50):
 *   放量突破前高: +40~50
 *   缩量回调(健康): +20~30
 *   放量下跌(恐慌): -30~-40
 *   天量见顶: -40~-50
 *   地量见底: +30~40
 *   缩量上涨(背离): -10~-20
 */
function calcVolumePattern(klines: KLineData[]): number {
  if (klines.length < 20) return 0;
  const len = klines.length;
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const highs = klines.map(k => k.high);

  const vol5 = avg(volumes.slice(-5));
  const vol20 = avg(volumes.slice(-20));
  const volRatio = vol20 > 0 ? vol5 / vol20 : 1;
  const volToday = volumes[len - 1];
  const volYesterday = volumes[len - 2];
  const volRatioToday = vol20 > 0 ? volToday / vol20 : 1;

  const ret5 = ((closes[len - 1] - closes[len - 6]) / closes[len - 6]) * 100;
  const ret1 = ((closes[len - 1] - closes[len - 2]) / closes[len - 2]) * 100;
  const high20 = Math.max(...highs.slice(-20));
  const breakoutHigh = closes[len - 1] > high20 * 0.99; // 接近或突破前高

  let score = 0;

  // 放量突破前高 (超强信号)
  if (breakoutHigh && volRatioToday > 1.5 && ret1 > 0.5) {
    score += 40 + Math.min(10, (volRatioToday - 1.5) * 10);
  }
  // 地量见底: 成交量极度萎缩 + 价格近低位
  else if (volRatioToday < 0.5 && closes[len - 1] < avg(closes.slice(-20)) * 0.98) {
    score += 30 + Math.min(10, (0.5 - volRatioToday) * 40);
  }
  // 缩量回调(健康回调): 近5日缩量 + 小幅回调(不超过-3%)
  else if (volRatio < 0.8 && ret5 > -3 && ret5 < 0 && closes[len - 1] > avg(closes.slice(-20))) {
    score += 20 + Math.min(10, (0.8 - volRatio) * 30);
  }
  // 天量见顶: 单日放巨量 + 涨幅缩小或收上影线
  else if (volRatioToday > 2.5 && ret1 < 1 && closes[len - 1] < highs[len - 1] * 0.98) {
    score -= 40 - Math.min(10, (volRatioToday - 2.5) * 5);
  }
  // 放量下跌(恐慌抛售)
  else if (volRatio > 1.5 && ret5 < -3) {
    score -= 30 - Math.min(10, Math.abs(ret5) * 2);
  }
  // 缩量上涨(量价背离)
  else if (volRatio < 0.7 && ret5 > 2) {
    score -= 10 - Math.min(10, (ret5 - 2) * 3);
  }

  return clamp(score, -50, 50);
}

// ================================================================
//  板块轮动评分
// ================================================================

/**
 * 基于板块涨跌幅和资金流推算轮动位置 (-50~50):
 *   板块近5日表现从弱转强 → 正分（资金流入中）
 *   板块近5日表现从强转弱 → 负分（资金流出中）
 */
function calcSectorRotation(sectorData: EnrichedSectorData | null): number {
  if (!sectorData) return 0;

  let score = 0;
  const change = sectorData.changePercent || 0;
  const change5d = sectorData.change5d || 0;
  const mainInflow = sectorData.mainNetInflowPercent || 0;

  // 近5日涨幅加速（今日>均值意味着在板块上升周期）
  if (change > 0 && change5d > 0) {
    // 板块持续上涨，且今日涨幅占5日涨幅比例大 → 加速
    const todayShare = change5d !== 0 ? change / change5d : 0;
    if (todayShare > 0.3) score += 20; // 今日贡献5日涨幅>30% → 加速
    else score += 10;
  } else if (change < 0 && change5d < 0) {
    // 持续下跌
    const todayShare = change5d !== 0 ? change / change5d : 0;
    if (todayShare > 0.3) score -= 20;
    else score -= 10;
  } else if (change > 0 && change5d < 0) {
    // 从跌转涨 → 轮动启动信号
    score += 25;
  } else if (change < 0 && change5d > 0) {
    // 从涨转跌 → 资金撤出
    score -= 15;
  }

  // 主力资金流向加成
  if (mainInflow > 3) score += 15;
  else if (mainInflow > 1) score += 8;
  else if (mainInflow < -3) score -= 15;
  else if (mainInflow < -1) score -= 8;

  return clamp(score, -50, 50);
}
