/**
 * 四维交叉验证分析引擎
 * 
 * 第一维度：趋势方向 (40%) — 均线排列、指数对比、宏观背景
 * 第二维度：动能强弱 (25%) — MACD背离、量价关系、红绿柱
 * 第三维度：资金流向 (20%) — 北向资金、主力资金、ETF份额
 * 第四维度：基本面与情绪 (15%) — 拥挤度、估值、情绪极端
 */

import type { KLineData, NorthboundFlow, SectorMoneyFlow, EnrichedSectorData } from "./stock-api";

// ==================== 类型定义 ====================

export type DimensionDirection = "强看多" | "看多" | "中性" | "看空" | "强看空";
export type MarketPhase = "健康上升" | "上升末期" | "趋势反转" | "下跌寻底" | "横盘震荡";
export type OperationAdvice = "持仓不动，回调加仓" | "分批止盈，不加新仓" | "大幅减仓，转防御" | "小额定投，等待企稳" | "控制仓位，等待方向";

export interface DimensionResult {
  name: string;
  weight: number;
  score: number;           // -100 ~ 100
  direction: DimensionDirection;
  signals: DimensionSignal[];
  details: string;
}

export interface DimensionSignal {
  indicator: string;
  value: string;
  interpretation: string;
  bullish: boolean;        // true=利多, false=利空
}

export interface CrossValidation {
  bullishCount: number;    // 看多维度数
  bearishCount: number;    // 看空维度数
  neutralCount: number;    // 中性维度数
  agreement: "四维共振" | "三多一空" | "两多两空" | "一多三空" | "四维看空" | "三多一中" | "其他";
  confidence: number;      // 置信度 0-100
}

export interface FourDimensionReport {
  sectorName: string;
  sectorCode: string;
  timestamp: string;

  // 四个维度
  trend: DimensionResult;       // 趋势方向 40%
  momentum: DimensionResult;    // 动能强弱 25%
  capitalFlow: DimensionResult; // 资金流向 20%
  fundamental: DimensionResult; // 基本面情绪 15%

  // 综合判断
  compositeScore: number;       // 加权综合分 -100~100
  marketPhase: MarketPhase;
  operation: OperationAdvice;
  crossValidation: CrossValidation;

  // 关键结论
  conclusion: string;
  keyRisks: string[];
  keyOpportunities: string[];
  actionPlan: string;
}

// ==================== 第一维度：趋势方向 (40%) ====================

function analyzeTrend(klines: KLineData[], benchmarkKlines?: KLineData[]): DimensionResult {
  const signals: DimensionSignal[] = [];
  let score = 0;

  if (klines.length < 20) {
    return { name: "趋势方向", weight: 40, score: 0, direction: "中性", signals: [], details: "数据不足，无法判断趋势" };
  }

  const closes = klines.map(k => k.close);
  const len = closes.length;

  // 1. 均线计算
  const calcMA = (period: number) => {
    const slice = closes.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  };
  const ma5 = calcMA(5);
  const ma10 = calcMA(10);
  const ma20 = calcMA(20);
  const currentPrice = closes[len - 1];

  // 均线排列判断
  const bullishAlign = ma5 > ma10 && ma10 > ma20;
  const bearishAlign = ma5 < ma10 && ma10 < ma20;

  // 均线发散度（斜率）
  const ma5_prev = closes.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
  const ma10_prev = closes.slice(-15, -5).reduce((a, b) => a + b, 0) / 10;
  const ma5Slope = ((ma5 - ma5_prev) / ma5_prev) * 100;
  const ma10Slope = ((ma10 - ma10_prev) / ma10_prev) * 100;

  if (bullishAlign) {
    const slopeStr = ma5Slope > 1 ? "向上发散" : "走平";
    signals.push({
      indicator: "均线排列",
      value: `MA5(${ma5.toFixed(2)}) > MA10(${ma10.toFixed(2)}) > MA20(${ma20.toFixed(2)})`,
      interpretation: `多头排列${slopeStr}，上升趋势确立，回调是机会`,
      bullish: true,
    });
    score += ma5Slope > 1 ? 35 : 20;
  } else if (bearishAlign) {
    signals.push({
      indicator: "均线排列",
      value: `MA5(${ma5.toFixed(2)}) < MA10(${ma10.toFixed(2)}) < MA20(${ma20.toFixed(2)})`,
      interpretation: `空头排列，下降趋势，反弹是减仓机会`,
      bullish: false,
    });
    score -= ma5Slope < -1 ? 35 : 20;
  } else {
    // 均线缠绕
    const spread = Math.abs(ma5 - ma20) / ma20 * 100;
    signals.push({
      indicator: "均线排列",
      value: `MA5/MA10/MA20缠绕，价差${spread.toFixed(1)}%`,
      interpretation: `均线缠绕，方向不明，等待突破`,
      bullish: spread < 1,
    });
    score += currentPrice > ma20 ? 5 : -5;
  }

  // 2. 价格位置（相对MA20）
  const priceVsMa20 = ((currentPrice - ma20) / ma20) * 100;
  if (priceVsMa20 > 5) {
    signals.push({
      indicator: "价格位置",
      value: `现价高于MA20 ${priceVsMa20.toFixed(1)}%`,
      interpretation: `价格运行在均线上方较远处，短期有回调压力`,
      bullish: priceVsMa20 < 10,
    });
    score += priceVsMa20 > 10 ? -5 : 10;
  } else if (priceVsMa20 < -5) {
    signals.push({
      indicator: "价格位置",
      value: `现价低于MA20 ${Math.abs(priceVsMa20).toFixed(1)}%`,
      interpretation: `价格偏离均线较大，可能超跌`,
      bullish: priceVsMa20 > -10,
    });
    score += priceVsMa20 < -10 ? -10 : -5;
  }

  // 3. 指数对比（相对强弱）
  if (benchmarkKlines && benchmarkKlines.length >= 20) {
    const benchCloses = benchmarkKlines.map(k => k.close);
    const benchLen = benchCloses.length;
    const sectorChange5d = ((closes[len - 1] - closes[Math.max(0, len - 6)]) / closes[Math.max(0, len - 6)]) * 100;
    const benchChange5d = ((benchCloses[benchLen - 1] - benchCloses[Math.max(0, benchLen - 6)]) / benchCloses[Math.max(0, benchLen - 6)]) * 100;
    const relativeStrength = sectorChange5d - benchChange5d;

    if (relativeStrength > 2) {
      signals.push({
        indicator: "相对强弱",
        value: `跑赢大盘 ${relativeStrength.toFixed(1)}%`,
        interpretation: `板块明显强于大盘，资金在此方向，主线未变`,
        bullish: true,
      });
      score += 15;
    } else if (relativeStrength < -2) {
      signals.push({
        indicator: "相对强弱",
        value: `跑输大盘 ${Math.abs(relativeStrength).toFixed(1)}%`,
        interpretation: `板块弱于大盘，可能面临风格切换`,
        bullish: false,
      });
      score -= 10;
    }
  }

  // 4. 近期趋势稳定性（连续上涨/下跌天数）
  let consecutiveUp = 0, consecutiveDown = 0;
  for (let i = len - 1; i >= 1; i--) {
    if (closes[i] > closes[i - 1]) { if (consecutiveDown > 0) break; consecutiveUp++; }
    else if (closes[i] < closes[i - 1]) { if (consecutiveUp > 0) break; consecutiveDown++; }
    else break;
  }
  if (consecutiveUp >= 4) {
    signals.push({ indicator: "趋势连续性", value: `连涨${consecutiveUp}天`, interpretation: `上升趋势动力充足`, bullish: true });
    score += 10;
  }
  if (consecutiveDown >= 4) {
    signals.push({ indicator: "趋势连续性", value: `连跌${consecutiveDown}天`, interpretation: `下降趋势未止，需等企稳信号`, bullish: false });
    score -= 10;
  }

  score = Math.max(-100, Math.min(100, score));
  const direction = scoreToDirection(score);

  return {
    name: "趋势方向",
    weight: 40,
    score,
    direction,
    signals,
    details: signals.map(s => s.interpretation).join("；"),
  };
}

// ==================== 第二维度：动能强弱 (25%) ====================

function analyzeMomentum(klines: KLineData[]): DimensionResult {
  const signals: DimensionSignal[] = [];
  let score = 0;

  if (klines.length < 26) {
    return { name: "动能强弱", weight: 25, score: 0, direction: "中性", signals: [], details: "数据不足" };
  }

  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const len = closes.length;

  // 1. MACD计算
  const ema = (data: number[], period: number): number[] => {
    const result: number[] = [data[0]];
    const k = 2 / (period + 1);
    for (let i = 1; i < data.length; i++) {
      result.push(data[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  };

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const dif = ema12.map((v, i) => v - ema26[i]);
  const dea = ema(dif, 9);
  const macdHist = dif.map((v, i) => (v - dea[i]) * 2);

  const currentDif = dif[len - 1];
  const currentDea = dea[len - 1];
  const currentMacd = macdHist[len - 1];

  // 2. MACD顶底背离检测
  // 顶背离：价格新高但DIF高点降低
  const recentPeakPrice = Math.max(...closes.slice(-15));
  const prevPeakPrice = Math.max(...closes.slice(-30, -15));
  const recentPeakDif = Math.max(...dif.slice(-15));
  const prevPeakDif = Math.max(...dif.slice(-30, -15));

  const recentTroughPrice = Math.min(...closes.slice(-15));
  const prevTroughPrice = Math.min(...closes.slice(-30, -15));
  const recentTroughDif = Math.min(...dif.slice(-15));
  const prevTroughDif = Math.min(...dif.slice(-30, -15));

  if (recentPeakPrice > prevPeakPrice && recentPeakDif < prevPeakDif * 0.85) {
    signals.push({
      indicator: "MACD顶背离",
      value: `价格新高但DIF高点降低`,
      interpretation: `⚠️ 顶背离出现，上涨动能衰竭，分批止盈预警信号（准确率70-80%）`,
      bullish: false,
    });
    score -= 30;
  } else if (recentTroughPrice < prevTroughPrice && recentTroughDif > prevTroughDif * 0.85) {
    signals.push({
      indicator: "MACD底背离",
      value: `价格新低但DIF低点抬升`,
      interpretation: `底背离出现，下跌动能衰竭，可考虑左侧小额定投`,
      bullish: true,
    });
    score += 25;
  }

  // 3. 金叉死叉
  const prevDif = dif[len - 2];
  const prevDea = dea[len - 2];
  if (prevDif <= prevDea && currentDif > currentDea) {
    signals.push({ indicator: "MACD金叉", value: `DIF上穿DEA`, interpretation: `短期买入信号`, bullish: true });
    score += 15;
  } else if (prevDif >= prevDea && currentDif < currentDea) {
    signals.push({ indicator: "MACD死叉", value: `DIF下穿DEA`, interpretation: `短期卖出信号`, bullish: false });
    score -= 15;
  }

  // 4. 红绿柱变化
  const recentHist = macdHist.slice(-5);
  if (recentHist.every(v => v > 0)) {
    const shrinking = recentHist[4] < recentHist[3] && recentHist[3] < recentHist[2];
    if (shrinking) {
      signals.push({ indicator: "红柱变化", value: `红柱连续缩短`, interpretation: `上涨动能在减弱，即使价格还在涨也要准备减仓`, bullish: false });
      score -= 10;
    } else {
      signals.push({ indicator: "红柱变化", value: `红柱健康`, interpretation: `上涨动能充足`, bullish: true });
      score += 10;
    }
  } else if (recentHist.every(v => v < 0)) {
    const shrinking = Math.abs(recentHist[4]) < Math.abs(recentHist[3]) && Math.abs(recentHist[3]) < Math.abs(recentHist[2]);
    if (shrinking) {
      signals.push({ indicator: "绿柱变化", value: `绿柱连续缩短`, interpretation: `下跌动能在减弱，即使价格还在跌也不宜盲目割肉`, bullish: true });
      score += 10;
    } else {
      signals.push({ indicator: "绿柱变化", value: `绿柱扩大`, interpretation: `下跌动能增强`, bullish: false });
      score -= 10;
    }
  }

  // 5. 成交量分析
  const vol5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const vol10 = volumes.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
  const volRatio = vol10 > 0 ? vol5 / vol10 : 1;

  const last5Change = ((closes[len - 1] - closes[len - 6]) / closes[len - 6]) * 100;

  if (last5Change > 0 && volRatio > 1.3) {
    signals.push({ indicator: "量价关系", value: `上涨放量(量比${volRatio.toFixed(1)})`, interpretation: `上涨放量，趋势健康`, bullish: true });
    score += 15;
  } else if (last5Change > 0 && volRatio < 0.7) {
    signals.push({ indicator: "量价关系", value: `上涨缩量(量比${volRatio.toFixed(1)})`, interpretation: `⚠️ 价量背离，上涨乏力，追高意愿不足`, bullish: false });
    score -= 15;
  } else if (last5Change < 0 && volRatio < 0.7) {
    signals.push({ indicator: "量价关系", value: `下跌缩量(量比${volRatio.toFixed(1)})`, interpretation: `下跌缩量，正常获利回吐，非恐慌性抛售`, bullish: true });
    score += 10;
  } else if (last5Change < 0 && volRatio > 1.5) {
    signals.push({ indicator: "量价关系", value: `下跌放量(量比${volRatio.toFixed(1)})`, interpretation: `⚠️ 放量暴跌，警惕资金出逃`, bullish: false });
    score -= 20;
  }

  score = Math.max(-100, Math.min(100, score));
  return { name: "动能强弱", weight: 25, score, direction: scoreToDirection(score), signals, details: signals.map(s => s.interpretation).join("；") };
}

// ==================== 第三维度：资金流向 (20%) ====================

function analyzeCapitalFlow(
  northbound: NorthboundFlow[],
  sectorFlow: SectorMoneyFlow | null,
  sectorName: string
): DimensionResult {
  const signals: DimensionSignal[] = [];
  let score = 0;

  // 1. 北向资金
  if (northbound.length >= 3) {
    const recent3 = northbound.slice(-3);
    const netBuy3d = recent3.reduce((s, n) => s + n.total, 0);
    const consecutiveBuy = recent3.filter(n => n.total > 0).length;
    const consecutiveSell = recent3.filter(n => n.total < 0).length;

    const latest = northbound[northbound.length - 1];

    if (consecutiveBuy === 3) {
      signals.push({
        indicator: "北向资金",
        value: `连续3日净买入，合计${(netBuy3d / 10000).toFixed(1)}亿`,
        interpretation: `外资连续流入看好，是重要的做多信号`,
        bullish: true,
      });
      score += 25;
    } else if (consecutiveSell === 3) {
      signals.push({
        indicator: "北向资金",
        value: `连续3日净卖出，合计${(Math.abs(netBuy3d) / 10000).toFixed(1)}亿`,
        interpretation: `外资连续流出，需警惕，考虑降低仓位`,
        bullish: false,
      });
      score -= 25;
    } else if (latest.total > 0) {
      signals.push({
        indicator: "北向资金",
        value: `最近一日净买入${(latest.total / 10000).toFixed(1)}亿`,
        interpretation: `外资单日流入，但尚需观察持续性`,
        bullish: true,
      });
      score += 8;
    } else {
      signals.push({
        indicator: "北向资金",
        value: `最近一日净卖出${(Math.abs(latest.total) / 10000).toFixed(1)}亿`,
        interpretation: `外资单日流出，需持续观察`,
        bullish: false,
      });
      score -= 8;
    }

    // 10日累计
    if (northbound.length >= 5) {
      const net5d = northbound.slice(-5).reduce((s, n) => s + n.total, 0);
      if (net5d > 50000) { // >5亿
        signals.push({ indicator: "北向5日累计", value: `5日净买入${(net5d / 10000).toFixed(1)}亿`, interpretation: `中期资金持续流入`, bullish: true });
        score += 10;
      } else if (net5d < -50000) {
        signals.push({ indicator: "北向5日累计", value: `5日净卖出${(Math.abs(net5d) / 10000).toFixed(1)}亿`, interpretation: `中期资金持续流出`, bullish: false });
        score -= 10;
      }
    }
  }

  // 2. 板块主力资金
  if (sectorFlow) {
    const mainIn = sectorFlow.mainNetInflow;
    const mainPct = sectorFlow.mainNetInflowPercent;

    if (mainIn > 0) {
      signals.push({
        indicator: "主力资金",
        value: `${sectorName}主力净流入${(mainIn / 1e8).toFixed(1)}亿(占比${mainPct.toFixed(1)}%)`,
        interpretation: `主力资金看好该板块，积极布局`,
        bullish: true,
      });
      score += Math.min(25, mainPct * 3);
    } else {
      signals.push({
        indicator: "主力资金",
        value: `${sectorName}主力净流出${(Math.abs(mainIn) / 1e8).toFixed(1)}亿(占比${Math.abs(mainPct).toFixed(1)}%)`,
        interpretation: `主力资金离场，这是板块短期起不来的核心原因`,
        bullish: false,
      });
      score -= Math.min(25, Math.abs(mainPct) * 3);
    }
  }

  score = Math.max(-100, Math.min(100, score));
  return { name: "资金流向", weight: 20, score, direction: scoreToDirection(score), signals, details: signals.map(s => s.interpretation).join("；") };
}

// ==================== 第四维度：基本面与情绪 (15%) ====================

function analyzeFundamental(
  klines: KLineData[],
  amountRatio: number,     // 板块成交额占全市场比例
  sectorChangePercent: number,  // 板块今日涨跌幅
  riseRatio: number        // 上涨家数占比
): DimensionResult {
  const signals: DimensionSignal[] = [];
  let score = 0;

  if (klines.length < 20) {
    return { name: "基本面与情绪", weight: 15, score: 0, direction: "中性", signals: [], details: "数据不足" };
  }

  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const len = closes.length;

  // 1. 拥挤度 — 成交额占比
  if (amountRatio > 20) {
    signals.push({
      indicator: "拥挤度",
      value: `板块成交额占比${amountRatio.toFixed(1)}%`,
      interpretation: `⚠️ 短期过热信号，成交过于集中，注意回调风险`,
      bullish: false,
    });
    score -= 20;
  } else if (amountRatio > 12) {
    signals.push({
      indicator: "拥挤度",
      value: `板块成交额占比${amountRatio.toFixed(1)}%`,
      interpretation: `关注度较高，活跃但未到极端`,
      bullish: true,
    });
    score += 5;
  } else if (amountRatio < 3) {
    signals.push({
      indicator: "拥挤度",
      value: `板块成交额占比${amountRatio.toFixed(1)}%`,
      interpretation: `板块关注度偏低，等待催化剂`,
      bullish: false,
    });
    score -= 5;
  }

  // 2. 换手率/波动率（用近期波动估算）
  const returns5 = [];
  for (let i = len - 5; i < len; i++) {
    returns5.push(Math.abs((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
  }
  const avgVolatility = returns5.reduce((a, b) => a + b, 0) / returns5.length;

  if (avgVolatility > 3) {
    signals.push({ indicator: "波动率", value: `近5日平均波动${avgVolatility.toFixed(1)}%`, interpretation: `波动剧烈，风险较高`, bullish: false });
    score -= 10;
  } else if (avgVolatility < 0.8) {
    signals.push({ indicator: "波动率", value: `近5日平均波动${avgVolatility.toFixed(1)}%`, interpretation: `波动极低，可能在蓄势`, bullish: true });
    score += 5;
  }

  // 3. 估值位置（用20日涨幅估算相对高低位）
  const change20d = ((closes[len - 1] - closes[Math.max(0, len - 21)]) / closes[Math.max(0, len - 21)]) * 100;
  if (change20d > 15) {
    signals.push({
      indicator: "短期涨幅",
      value: `20日涨幅${change20d.toFixed(1)}%`,
      interpretation: `短期涨幅过大，获利盘压力增加，情绪可能偏热`,
      bullish: false,
    });
    score -= 15;
  } else if (change20d < -15) {
    signals.push({
      indicator: "短期跌幅",
      value: `20日跌幅${Math.abs(change20d).toFixed(1)}%`,
      interpretation: `短期跌幅较深，情绪悲观，可能接近底部区域`,
      bullish: true,
    });
    score += 15;
  }

  // 4. 板块内部一致性
  if (riseRatio > 0.8) {
    signals.push({ indicator: "板块一致性", value: `上涨家数占比${(riseRatio * 100).toFixed(0)}%`, interpretation: `板块全面上涨，做多情绪一致`, bullish: true });
    score += 10;
  } else if (riseRatio < 0.2) {
    signals.push({ indicator: "板块一致性", value: `上涨家数占比${(riseRatio * 100).toFixed(0)}%`, interpretation: `板块全面下跌，恐慌情绪蔓延`, bullish: false });
    score -= 10;
  } else if (riseRatio > 0.4 && riseRatio < 0.6) {
    signals.push({ indicator: "板块一致性", value: `上涨家数占比${(riseRatio * 100).toFixed(0)}%`, interpretation: `板块分化明显，无一致方向`, bullish: false });
    score -= 3;
  }

  score = Math.max(-100, Math.min(100, score));
  return { name: "基本面与情绪", weight: 15, score, direction: scoreToDirection(score), signals, details: signals.map(s => s.interpretation).join("；") };
}

// ==================== 交叉验证 ====================

function crossValidate(dimensions: DimensionResult[]): CrossValidation {
  let bullish = 0, bearish = 0, neutral = 0;
  for (const d of dimensions) {
    if (d.score > 15) bullish++;
    else if (d.score < -15) bearish++;
    else neutral++;
  }

  let agreement: CrossValidation["agreement"];
  if (bullish === 4) agreement = "四维共振";
  else if (bullish === 3 && bearish === 0) agreement = "三多一中";
  else if (bullish === 3) agreement = "三多一空";
  else if (bullish === 2 && bearish === 2) agreement = "两多两空";
  else if (bearish === 3) agreement = "一多三空";
  else if (bearish === 4) agreement = "四维看空";
  else agreement = "其他";

  // 置信度：维度越一致越高
  const maxSide = Math.max(bullish, bearish);
  const confidence = maxSide === 4 ? 95 : maxSide === 3 ? 75 : maxSide === 2 ? 50 : 30;

  return { bullishCount: bullish, bearishCount: bearish, neutralCount: neutral, agreement, confidence };
}

function determinePhase(trend: DimensionResult, momentum: DimensionResult, capital: DimensionResult, fundamental: DimensionResult): MarketPhase {
  const t = trend.score, m = momentum.score;

  if (t > 20 && m > 10) return "健康上升";
  if (t > 10 && m < -10) return "上升末期";
  if (t < -10 && t > -30 && m < 0) return "趋势反转";
  if (t < -20) return "下跌寻底";
  return "横盘震荡";
}

function determineOperation(phase: MarketPhase, cv: CrossValidation): OperationAdvice {
  switch (phase) {
    case "健康上升": return "持仓不动，回调加仓";
    case "上升末期": return "分批止盈，不加新仓";
    case "趋势反转": return "大幅减仓，转防御";
    case "下跌寻底": return "小额定投，等待企稳";
    case "横盘震荡": return "控制仓位，等待方向";
  }
}

function generateConclusion(phase: MarketPhase, cv: CrossValidation, trend: DimensionResult, momentum: DimensionResult, capital: DimensionResult, fundamental: DimensionResult, sectorName: string): { conclusion: string; risks: string[]; opportunities: string[]; plan: string } {
  const risks: string[] = [];
  const opportunities: string[] = [];
  let conclusion = "";
  let plan = "";

  // 依据交叉验证结果
  switch (cv.agreement) {
    case "四维共振":
      if (cv.bullishCount === 4) {
        conclusion = `${sectorName}四个维度全部看多，共振做多信号极强（置信度${cv.confidence}%）。趋势向上、动能健康、资金流入、情绪适中——这是最佳的重仓/加大定投时机。`;
        plan = `可重仓配置或加大定投额度。回调5日均线附近是最佳加仓点。`;
        opportunities.push("四维共振看多，最强做多信号");
      } else {
        conclusion = `${sectorName}四个维度全部看空，共振做空信号极强。建议果断离场。`;
        plan = `立即减仓至1成以下，等待至少两个维度转正再考虑回补。`;
        risks.push("四维共振看空，最强风险信号");
      }
      break;
    case "三多一空":
    case "三多一中":
      conclusion = `${sectorName}三个维度看多、一个有矛盾，总体偏多但需谨慎操作、分批执行。`;
      plan = `建议5-6成仓位，分批买入而非一次性重仓。注意矛盾维度的变化。`;
      // 找到矛盾维度
      const weakDim = [trend, momentum, capital, fundamental].find(d => d.score < -15);
      if (weakDim) risks.push(`${weakDim.name}维度发出警告：${weakDim.details.slice(0, 50)}...`);
      opportunities.push("三维看多，整体趋势偏强");
      break;
    case "两多两空":
      conclusion = `${sectorName}多空各半，两个维度指向相反方向，信号矛盾，观望为主。`;
      plan = `建议3成以下仓位，等待更多维度形成一致后再加仓。不追高不抄底。`;
      risks.push("多空分歧大，方向不明确");
      break;
    case "一多三空":
      conclusion = `${sectorName}三个维度看空，风险信号明确，当前基本面即使有支撑也难逆转短期压力。`;
      plan = `减仓至2成以下。只有等资金流向企稳+技术面底背离出现后才考虑回补。`;
      risks.push("三维看空，短期风险较大");
      break;
    default:
      conclusion = `${sectorName}各维度信号混杂，市场处于震荡状态，等待信号明确化。`;
      plan = `控制仓位在3-4成，以均线方向为主要参考。`;
  }

  // 特殊情况：趋势和动能矛盾
  if (trend.score > 20 && momentum.score < -20) {
    risks.push("趋势向上但动能衰竭（顶背离），关键规则：以趋势为主但开始分批减仓");
  }

  // 资金持续流出
  if (capital.score < -20) {
    risks.push("资金持续流出是板块起不来的核心原因，即使基本面好也短期难涨");
  }

  // 基本面好但情绪差
  if (fundamental.score > 15 && capital.score < -10 && trend.score < 0) {
    opportunities.push("基本面逻辑未被破坏，下跌是情绪冲击，属于左侧机会区域");
  }

  return { conclusion, risks, opportunities, plan };
}

// ==================== 辅助函数 ====================

function scoreToDirection(score: number): DimensionDirection {
  if (score >= 40) return "强看多";
  if (score >= 15) return "看多";
  if (score <= -40) return "强看空";
  if (score <= -15) return "看空";
  return "中性";
}

// ==================== 板块快照数据fallback分析 ====================

// 当K线数据不可用时，用板块快照数据做趋势分析
function analyzeTrendFromSnapshot(sector: EnrichedSectorData): DimensionResult {
  const signals: DimensionSignal[] = [];
  let score = 0;

  const { changePercent, change5d, change10d, amplitude, high, low, open: sOpen, prevClose } = sector;

  // 1. 均线替代：用5d和10d涨跌幅判断趋势方向
  if (change5d > 3 && change10d > 5) {
    signals.push({
      indicator: "均线排列(估算)",
      value: `5日+${change5d.toFixed(1)}% / 10日+${change10d.toFixed(1)}%`,
      interpretation: `短中期持续上涨，等同于均线多头排列，上升趋势确立`,
      bullish: true,
    });
    score += 35;
  } else if (change5d > 1 && change10d > 2) {
    signals.push({
      indicator: "均线排列(估算)",
      value: `5日+${change5d.toFixed(1)}% / 10日+${change10d.toFixed(1)}%`,
      interpretation: `温和上涨趋势，均线偏多头`,
      bullish: true,
    });
    score += 18;
  } else if (change5d < -3 && change10d < -5) {
    signals.push({
      indicator: "均线排列(估算)",
      value: `5日${change5d.toFixed(1)}% / 10日${change10d.toFixed(1)}%`,
      interpretation: `短中期持续下跌，等同于均线空头排列，下降趋势`,
      bullish: false,
    });
    score -= 35;
  } else if (change5d < -1 && change10d < -2) {
    signals.push({
      indicator: "均线排列(估算)",
      value: `5日${change5d.toFixed(1)}% / 10日${change10d.toFixed(1)}%`,
      interpretation: `偏弱走势，均线偏空头`,
      bullish: false,
    });
    score -= 18;
  } else {
    signals.push({
      indicator: "均线排列(估算)",
      value: `5日${change5d >= 0 ? "+" : ""}${change5d.toFixed(1)}% / 10日${change10d >= 0 ? "+" : ""}${change10d.toFixed(1)}%`,
      interpretation: `方向不明确，均线缠绕震荡`,
      bullish: false,
    });
  }

  // 2. 今日趋势强度
  if (changePercent > 3) {
    signals.push({ indicator: "日内强度", value: `今日+${changePercent.toFixed(2)}%`, interpretation: `日内大涨，多头强势`, bullish: true });
    score += 15;
  } else if (changePercent > 1) {
    signals.push({ indicator: "日内强度", value: `今日+${changePercent.toFixed(2)}%`, interpretation: `日内上涨，偏多`, bullish: true });
    score += 8;
  } else if (changePercent < -3) {
    signals.push({ indicator: "日内强度", value: `今日${changePercent.toFixed(2)}%`, interpretation: `日内大跌，空头强势`, bullish: false });
    score -= 15;
  } else if (changePercent < -1) {
    signals.push({ indicator: "日内强度", value: `今日${changePercent.toFixed(2)}%`, interpretation: `日内下跌，偏空`, bullish: false });
    score -= 8;
  }

  // 3. 5日 vs 10日 趋势加速/减速
  if (change5d > 0 && change10d > 0 && change5d > change10d * 0.6) {
    signals.push({ indicator: "趋势加速", value: `5日涨幅占10日${((change5d / Math.max(0.1, change10d)) * 100).toFixed(0)}%`, interpretation: `近期趋势加速，动力充足`, bullish: true });
    score += 10;
  } else if (change5d < 0 && change10d > 3) {
    signals.push({ indicator: "趋势减速", value: `10日涨${change10d.toFixed(1)}%但5日跌${Math.abs(change5d).toFixed(1)}%`, interpretation: `⚠️ 短期回调开始，上涨趋势可能减速`, bullish: false });
    score -= 10;
  }

  score = Math.max(-100, Math.min(100, score));
  return { name: "趋势方向", weight: 40, score, direction: scoreToDirection(score), signals, details: signals.map(s => s.interpretation).join("；") };
}

// 当K线不可用时，用快照数据做动能分析
function analyzeMomentumFromSnapshot(sector: EnrichedSectorData): DimensionResult {
  const signals: DimensionSignal[] = [];
  let score = 0;

  const { changePercent, change5d, change10d, amplitude, turnoverRate } = sector;

  // 1. 量价关系估算：用换手率判断
  if (turnoverRate > 8 && changePercent > 1) {
    signals.push({ indicator: "量价关系", value: `换手率${turnoverRate.toFixed(1)}%，涨${changePercent.toFixed(1)}%`, interpretation: `放量上涨，动能充足`, bullish: true });
    score += 20;
  } else if (turnoverRate > 8 && changePercent < -1) {
    signals.push({ indicator: "量价关系", value: `换手率${turnoverRate.toFixed(1)}%，跌${Math.abs(changePercent).toFixed(1)}%`, interpretation: `⚠️ 放量下跌，警惕资金出逃`, bullish: false });
    score -= 25;
  } else if (turnoverRate < 2 && changePercent > 1) {
    signals.push({ indicator: "量价关系", value: `换手率${turnoverRate.toFixed(1)}%，涨${changePercent.toFixed(1)}%`, interpretation: `⚠️ 缩量上涨，追高意愿不足`, bullish: false });
    score -= 10;
  } else if (turnoverRate < 2 && changePercent < -1) {
    signals.push({ indicator: "量价关系", value: `换手率${turnoverRate.toFixed(1)}%，跌${Math.abs(changePercent).toFixed(1)}%`, interpretation: `缩量下跌，恐慌情绪有限`, bullish: true });
    score += 8;
  }

  // 2. 振幅分析
  if (amplitude > 5) {
    signals.push({ indicator: "振幅", value: `日振幅${amplitude.toFixed(1)}%`, interpretation: `波动剧烈，多空分歧大`, bullish: false });
    score -= 5;
  } else if (amplitude < 1.5 && Math.abs(changePercent) < 0.5) {
    signals.push({ indicator: "振幅", value: `日振幅${amplitude.toFixed(1)}%`, interpretation: `极低波动，可能在蓄势`, bullish: true });
    score += 5;
  }

  // 3. 顶/底背离估算：5日大涨但今天弱 or 5日大跌但今天强
  if (change5d > 5 && changePercent < -1) {
    signals.push({ indicator: "短期背离", value: `5日涨${change5d.toFixed(1)}%但今日跌${Math.abs(changePercent).toFixed(1)}%`, interpretation: `⚠️ 短期冲高后回落，可能出现顶背离信号`, bullish: false });
    score -= 20;
  } else if (change5d < -5 && changePercent > 1) {
    signals.push({ indicator: "短期背离", value: `5日跌${Math.abs(change5d).toFixed(1)}%但今日涨${changePercent.toFixed(1)}%`, interpretation: `连跌后反弹，可能出现底背离信号`, bullish: true });
    score += 20;
  }

  // 4. 持续性：10日和5日同向且强度
  if (change5d > 2 && change10d > 4 && changePercent > 0) {
    signals.push({ indicator: "上涨持续性", value: `连续多周期上涨`, interpretation: `红柱健康，上涨动能保持`, bullish: true });
    score += 10;
  } else if (change5d < -2 && change10d < -4 && changePercent < 0) {
    signals.push({ indicator: "下跌持续性", value: `连续多周期下跌`, interpretation: `绿柱扩大，下跌动能增强`, bullish: false });
    score -= 10;
  }

  score = Math.max(-100, Math.min(100, score));
  return { name: "动能强弱", weight: 25, score, direction: scoreToDirection(score), signals, details: signals.map(s => s.interpretation).join("；") };
}

// 当K线不可用时的基本面分析
function analyzeFundamentalFromSnapshot(sector: EnrichedSectorData, amountRatio: number): DimensionResult {
  const signals: DimensionSignal[] = [];
  let score = 0;

  const riseRatio = sector.stockCount > 0 ? sector.riseCount / sector.stockCount : 0;

  // 1. 拥挤度
  if (amountRatio > 15) {
    signals.push({ indicator: "拥挤度", value: `成交额占比${amountRatio.toFixed(1)}%`, interpretation: `⚠️ 短期过热，成交过于集中`, bullish: false });
    score -= 20;
  } else if (amountRatio > 8) {
    signals.push({ indicator: "拥挤度", value: `成交额占比${amountRatio.toFixed(1)}%`, interpretation: `活跃度较高，关注度集中`, bullish: true });
    score += 5;
  } else if (amountRatio < 2) {
    signals.push({ indicator: "拥挤度", value: `成交额占比${amountRatio.toFixed(1)}%`, interpretation: `关注度偏低，缺乏催化剂`, bullish: false });
    score -= 5;
  }

  // 2. 换手率
  if (sector.turnoverRate > 10) {
    signals.push({ indicator: "换手率", value: `${sector.turnoverRate.toFixed(1)}%`, interpretation: `换手极高，交投过热`, bullish: false });
    score -= 10;
  } else if (sector.turnoverRate < 1) {
    signals.push({ indicator: "换手率", value: `${sector.turnoverRate.toFixed(1)}%`, interpretation: `极低换手，市场冷淡`, bullish: false });
    score -= 5;
  }

  // 3. 涨幅过大
  if (sector.change10d > 15) {
    signals.push({ indicator: "短期涨幅", value: `10日涨${sector.change10d.toFixed(1)}%`, interpretation: `短期涨幅过大，获利盘压力增加，情绪偏热`, bullish: false });
    score -= 15;
  } else if (sector.change10d < -15) {
    signals.push({ indicator: "短期跌幅", value: `10日跌${Math.abs(sector.change10d).toFixed(1)}%`, interpretation: `短期跌幅较深，情绪悲观，可能接近底部区域`, bullish: true });
    score += 15;
  }

  // 4. 板块一致性
  if (riseRatio > 0.8) {
    signals.push({ indicator: "板块一致性", value: `上涨占比${(riseRatio * 100).toFixed(0)}%`, interpretation: `板块全面上涨，做多情绪一致`, bullish: true });
    score += 10;
  } else if (riseRatio < 0.2) {
    signals.push({ indicator: "板块一致性", value: `上涨占比${(riseRatio * 100).toFixed(0)}%`, interpretation: `板块全面下跌，恐慌情绪蔓延`, bullish: false });
    score -= 10;
  } else if (riseRatio > 0.4 && riseRatio < 0.6) {
    signals.push({ indicator: "板块一致性", value: `上涨占比${(riseRatio * 100).toFixed(0)}%`, interpretation: `板块分化明显，无一致方向`, bullish: false });
    score -= 3;
  }

  score = Math.max(-100, Math.min(100, score));
  return { name: "基本面与情绪", weight: 15, score, direction: scoreToDirection(score), signals, details: signals.map(s => s.interpretation).join("；") };
}

// ==================== 主入口 ====================

export function analyzeFourDimensions(
  sectorName: string,
  sectorCode: string,
  klines: KLineData[],
  northbound: NorthboundFlow[],
  sectorFlow: SectorMoneyFlow | null,
  amountRatio: number,
  sectorChangePercent: number,
  riseRatio: number,
  benchmarkKlines?: KLineData[],
  enrichedSector?: EnrichedSectorData
): FourDimensionReport {
  // 如果有K线数据(>=20条)则用K线分析，否则用板块快照数据fallback
  const hasKlines = klines.length >= 20;

  const trend = hasKlines
    ? analyzeTrend(klines, benchmarkKlines)
    : (enrichedSector ? analyzeTrendFromSnapshot(enrichedSector) : analyzeTrend(klines, benchmarkKlines));

  const momentumResult = hasKlines
    ? analyzeMomentum(klines)
    : (enrichedSector ? analyzeMomentumFromSnapshot(enrichedSector) : analyzeMomentum(klines));

  const capitalFlowResult = analyzeCapitalFlow(northbound, sectorFlow, sectorName);

  const fundamentalResult = hasKlines
    ? analyzeFundamental(klines, amountRatio, sectorChangePercent, riseRatio)
    : (enrichedSector ? analyzeFundamentalFromSnapshot(enrichedSector, amountRatio) : analyzeFundamental(klines, amountRatio, sectorChangePercent, riseRatio));

  // 加权综合分
  const compositeScore = Math.round(
    trend.score * 0.40 +
    momentumResult.score * 0.25 +
    capitalFlowResult.score * 0.20 +
    fundamentalResult.score * 0.15
  );

  const dimensions = [trend, momentumResult, capitalFlowResult, fundamentalResult];
  const cv = crossValidate(dimensions);
  const phase = determinePhase(trend, momentumResult, capitalFlowResult, fundamentalResult);
  const operation = determineOperation(phase, cv);
  const { conclusion, risks, opportunities, plan } = generateConclusion(
    phase, cv, trend, momentumResult, capitalFlowResult, fundamentalResult, sectorName
  );

  return {
    sectorName, sectorCode, timestamp: new Date().toISOString(),
    trend, momentum: momentumResult, capitalFlow: capitalFlowResult, fundamental: fundamentalResult,
    compositeScore: Math.max(-100, Math.min(100, compositeScore)),
    marketPhase: phase, operation, crossValidation: cv,
    conclusion, keyRisks: risks.length > 0 ? risks : ["暂无明显风险信号"],
    keyOpportunities: opportunities.length > 0 ? opportunities : ["等待信号确认"],
    actionPlan: plan || "保持观望",
  };
}
