// 技术指标计算 + 趋势预测引擎

import type { KLineData } from "./stock-api";

export interface TechnicalIndicators {
  ma5: number[];
  ma10: number[];
  ma20: number[];
  ma60: number[];
  macd: { dif: number[]; dea: number[]; macd: number[] };
  rsi: { rsi6: number[]; rsi12: number[]; rsi24: number[] };
  boll: { upper: number[]; mid: number[]; lower: number[] };
  kdj: { k: number[]; d: number[]; j: number[] };
  volumeMA5: number[];
  volumeMA10: number[];
}

export type Signal = "强烈看涨" | "看涨" | "中性" | "看跌" | "强烈看跌";

export interface PredictionResult {
  signal: Signal;
  score: number;           // -100 ~ 100
  shortTermTrend: string;  // 短期趋势描述
  mediumTermTrend: string; // 中期趋势描述
  supportPrice: number;    // 支撑位
  resistancePrice: number; // 阻力位
  reasons: string[];       // 判断依据
  indicators: {
    maSignal: { signal: string; detail: string };
    macdSignal: { signal: string; detail: string };
    rsiSignal: { signal: string; detail: string };
    bollSignal: { signal: string; detail: string };
    kdjSignal: { signal: string; detail: string };
    volumeSignal: { signal: string; detail: string };
  };
}

// 移动平均线
function calcMA(closes: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const sum = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(Number((sum / period).toFixed(2)));
    }
  }
  return result;
}

// MACD
function calcMACD(closes: number[], short = 12, long = 26, signal = 9) {
  const emaShort = calcEMA(closes, short);
  const emaLong = calcEMA(closes, long);
  const dif = emaShort.map((v, i) => Number((v - emaLong[i]).toFixed(4)));
  const dea = calcEMA(dif, signal);
  const macd = dif.map((v, i) => Number(((v - dea[i]) * 2).toFixed(4)));
  return { dif, dea, macd };
}

function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(Number((data[i] * k + result[i - 1] * (1 - k)).toFixed(4)));
  }
  return result;
}

// RSI
function calcRSI(closes: number[], period: number): number[] {
  const result: number[] = [NaN];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);

    if (i < period) {
      result.push(NaN);
    } else if (i === period) {
      const avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
      result.push(avgLoss === 0 ? 100 : Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2)));
    } else {
      const prevRSI = result[i - 1] || 50;
      const avgGain = (gains[gains.length - 1] + (period - 1) * (prevRSI / 100)) / period;
      const avgLoss = (losses[losses.length - 1] + (period - 1) * ((100 - prevRSI) / 100)) / period;
      result.push(avgLoss === 0 ? 100 : Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2)));
    }
  }
  return result;
}

// 布林带
function calcBOLL(closes: number[], period = 20, mult = 2) {
  const mid = calcMA(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      const slice = closes.slice(i - period + 1, i + 1);
      const avg = mid[i];
      const std = Math.sqrt(slice.reduce((sum, v) => sum + (v - avg) ** 2, 0) / period);
      upper.push(Number((avg + mult * std).toFixed(2)));
      lower.push(Number((avg - mult * std).toFixed(2)));
    }
  }
  return { upper, mid, lower };
}

// KDJ
function calcKDJ(klines: KLineData[], period = 9) {
  const k: number[] = [];
  const d: number[] = [];
  const j: number[] = [];

  for (let i = 0; i < klines.length; i++) {
    if (i < period - 1) {
      k.push(50); d.push(50); j.push(50);
    } else {
      const slice = klines.slice(i - period + 1, i + 1);
      const low = Math.min(...slice.map(s => s.low));
      const high = Math.max(...slice.map(s => s.high));
      const rsv = high === low ? 50 : ((klines[i].close - low) / (high - low)) * 100;
      const prevK = i > 0 ? k[i - 1] : 50;
      const prevD = i > 0 ? d[i - 1] : 50;
      const curK = Number(((2 / 3) * prevK + (1 / 3) * rsv).toFixed(2));
      const curD = Number(((2 / 3) * prevD + (1 / 3) * curK).toFixed(2));
      k.push(curK); d.push(curD); j.push(Number((3 * curK - 2 * curD).toFixed(2)));
    }
  }
  return { k, d, j };
}

// 计算所有技术指标
export function calculateIndicators(klines: KLineData[]): TechnicalIndicators {
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);

  return {
    ma5: calcMA(closes, 5),
    ma10: calcMA(closes, 10),
    ma20: calcMA(closes, 20),
    ma60: calcMA(closes, 60),
    macd: calcMACD(closes),
    rsi: { rsi6: calcRSI(closes, 6), rsi12: calcRSI(closes, 12), rsi24: calcRSI(closes, 24) },
    boll: calcBOLL(closes),
    kdj: calcKDJ(klines),
    volumeMA5: calcMA(volumes, 5),
    volumeMA10: calcMA(volumes, 10),
  };
}

// 综合预测
export function predict(klines: KLineData[]): PredictionResult {
  if (klines.length < 60) {
    return {
      signal: "中性", score: 0,
      shortTermTrend: "数据不足，无法判断", mediumTermTrend: "数据不足，无法判断",
      supportPrice: 0, resistancePrice: 0, reasons: ["历史数据不足60日，预测可信度低"],
      indicators: {
        maSignal: { signal: "中性", detail: "数据不足" },
        macdSignal: { signal: "中性", detail: "数据不足" },
        rsiSignal: { signal: "中性", detail: "数据不足" },
        bollSignal: { signal: "中性", detail: "数据不足" },
        kdjSignal: { signal: "中性", detail: "数据不足" },
        volumeSignal: { signal: "中性", detail: "数据不足" },
      },
    };
  }

  const ind = calculateIndicators(klines);
  const last = klines.length - 1;
  const price = klines[last].close;
  const reasons: string[] = [];
  let score = 0;

  // === 1. 均线分析 ===
  const ma5 = ind.ma5[last], ma10 = ind.ma10[last], ma20 = ind.ma20[last], ma60 = ind.ma60[last];
  let maDetail = "";
  let maSignalText = "中性";
  if (price > ma5 && ma5 > ma10 && ma10 > ma20) {
    score += 20; maSignalText = "看涨"; maDetail = "多头排列（价格>MA5>MA10>MA20）";
    reasons.push("均线多头排列，短中期趋势向上");
  } else if (price < ma5 && ma5 < ma10 && ma10 < ma20) {
    score -= 20; maSignalText = "看跌"; maDetail = "空头排列（价格<MA5<MA10<MA20）";
    reasons.push("均线空头排列，短中期趋势向下");
  } else if (price > ma20) {
    score += 5; maDetail = "价格在MA20上方";
  } else {
    score -= 5; maDetail = "价格在MA20下方";
  }

  // MA5/MA10 金叉死叉
  const prevMA5 = ind.ma5[last - 1], prevMA10 = ind.ma10[last - 1];
  if (prevMA5 < prevMA10 && ma5 > ma10) {
    score += 10; reasons.push("MA5上穿MA10形成金叉");
    maDetail += "，出现金叉";
  } else if (prevMA5 > prevMA10 && ma5 < ma10) {
    score -= 10; reasons.push("MA5下穿MA10形成死叉");
    maDetail += "，出现死叉";
  }

  // === 2. MACD 分析 ===
  const dif = ind.macd.dif[last], dea = ind.macd.dea[last], macdVal = ind.macd.macd[last];
  const prevDif = ind.macd.dif[last - 1], prevDea = ind.macd.dea[last - 1];
  let macdDetail = `DIF=${dif.toFixed(3)}, DEA=${dea.toFixed(3)}`;
  let macdSignalText = "中性";

  if (prevDif < prevDea && dif > dea) {
    score += 15; macdSignalText = "看涨"; macdDetail += "，MACD金叉";
    reasons.push("MACD金叉，买入信号");
  } else if (prevDif > prevDea && dif < dea) {
    score -= 15; macdSignalText = "看跌"; macdDetail += "，MACD死叉";
    reasons.push("MACD死叉，卖出信号");
  } else if (dif > 0 && dea > 0 && macdVal > 0) {
    score += 8; macdSignalText = "看涨"; macdDetail += "，零轴上方运行";
  } else if (dif < 0 && dea < 0 && macdVal < 0) {
    score -= 8; macdSignalText = "看跌"; macdDetail += "，零轴下方运行";
  }

  // === 3. RSI 分析 ===
  const rsi6 = ind.rsi.rsi6[last], rsi12 = ind.rsi.rsi12[last];
  let rsiDetail = `RSI6=${rsi6?.toFixed(1)}, RSI12=${rsi12?.toFixed(1)}`;
  let rsiSignalText = "中性";

  if (rsi6 > 80) {
    score -= 12; rsiSignalText = "看跌"; rsiDetail += "，超买区间";
    reasons.push("RSI进入超买区间（>80），注意回调风险");
  } else if (rsi6 < 20) {
    score += 12; rsiSignalText = "看涨"; rsiDetail += "，超卖区间";
    reasons.push("RSI进入超卖区间（<20），可能触底反弹");
  } else if (rsi6 > 60) {
    score += 5; rsiDetail += "，偏强势";
  } else if (rsi6 < 40) {
    score -= 5; rsiDetail += "，偏弱势";
  }

  // === 4. 布林带分析 ===
  const bollUpper = ind.boll.upper[last], bollMid = ind.boll.mid[last], bollLower = ind.boll.lower[last];
  let bollDetail = `上轨=${bollUpper}, 中轨=${bollMid}, 下轨=${bollLower}`;
  let bollSignalText = "中性";

  if (price >= bollUpper) {
    score -= 10; bollSignalText = "看跌"; bollDetail += "，触及上轨";
    reasons.push("价格触及布林带上轨，短期有回调压力");
  } else if (price <= bollLower) {
    score += 10; bollSignalText = "看涨"; bollDetail += "，触及下轨";
    reasons.push("价格触及布林带下轨，短期有反弹需求");
  } else if (price > bollMid) {
    score += 3; bollDetail += "，中轨上方";
  } else {
    score -= 3; bollDetail += "，中轨下方";
  }

  // === 5. KDJ 分析 ===
  const kVal = ind.kdj.k[last], dVal = ind.kdj.d[last], jVal = ind.kdj.j[last];
  const prevK = ind.kdj.k[last - 1], prevD = ind.kdj.d[last - 1];
  let kdjDetail = `K=${kVal.toFixed(1)}, D=${dVal.toFixed(1)}, J=${jVal.toFixed(1)}`;
  let kdjSignalText = "中性";

  if (jVal > 100) {
    score -= 8; kdjSignalText = "看跌"; kdjDetail += "，超买";
    reasons.push("KDJ指标J值超过100，短期超买");
  } else if (jVal < 0) {
    score += 8; kdjSignalText = "看涨"; kdjDetail += "，超卖";
    reasons.push("KDJ指标J值低于0，短期超卖");
  }
  if (prevK < prevD && kVal > dVal && kVal < 30) {
    score += 10; kdjSignalText = "看涨"; kdjDetail += "，低位金叉";
    reasons.push("KDJ低位金叉，买入信号");
  } else if (prevK > prevD && kVal < dVal && kVal > 70) {
    score -= 10; kdjSignalText = "看跌"; kdjDetail += "，高位死叉";
    reasons.push("KDJ高位死叉，卖出信号");
  }

  // === 6. 量能分析 ===
  const vol = klines[last].volume;
  const volMA5 = ind.volumeMA5[last];
  const volMA10 = ind.volumeMA10[last];
  let volumeDetail = "";
  let volumeSignalText = "中性";

  const priceChange = last > 0 ? klines[last].close - klines[last - 1].close : klines[last].close - klines[last].open;

  if (vol > volMA5 * 1.5 && priceChange > 0) {
    score += 8; volumeSignalText = "看涨"; volumeDetail = "放量上涨，资金积极入场";
    reasons.push("成交量明显放大且上涨，多头力量强");
  } else if (vol > volMA5 * 1.5 && priceChange < 0) {
    score -= 8; volumeSignalText = "看跌"; volumeDetail = "放量下跌，资金流出";
    reasons.push("放量下跌，抛压较大");
  } else if (vol < volMA5 * 0.7) {
    volumeDetail = "缩量整理，观望情绪浓";
  } else {
    volumeDetail = `量比=${(vol / volMA5).toFixed(2)}`;
  }

  // 计算支撑位和阻力位
  const recentLows = klines.slice(-20).map(k => k.low);
  const recentHighs = klines.slice(-20).map(k => k.high);
  const supportPrice = Number(Math.min(...recentLows).toFixed(2));
  const resistancePrice = Number(Math.max(...recentHighs).toFixed(2));

  // 限制得分范围
  score = Math.max(-100, Math.min(100, score));

  // 确定信号
  let signal: Signal;
  if (score >= 40) signal = "强烈看涨";
  else if (score >= 15) signal = "看涨";
  else if (score <= -40) signal = "强烈看跌";
  else if (score <= -15) signal = "看跌";
  else signal = "中性";

  // 趋势描述
  let shortTermTrend: string, mediumTermTrend: string;
  if (score > 25) {
    shortTermTrend = "短期偏多，预计震荡上行";
    mediumTermTrend = price > ma60 ? "中期趋势向上，多头格局延续" : "中期仍需突破MA60确认方向";
  } else if (score < -25) {
    shortTermTrend = "短期偏空，预计震荡下行";
    mediumTermTrend = price < ma60 ? "中期趋势向下，空头格局延续" : "中期关注MA60支撑情况";
  } else {
    shortTermTrend = "短期方向不明，以震荡整理为主";
    mediumTermTrend = "中期处于多空博弈阶段，等待方向选择";
  }

  if (reasons.length === 0) reasons.push("各指标信号不一致，建议观望");

  return {
    signal, score, shortTermTrend, mediumTermTrend, supportPrice, resistancePrice, reasons,
    indicators: {
      maSignal: { signal: maSignalText, detail: maDetail || "均线交织" },
      macdSignal: { signal: macdSignalText, detail: macdDetail },
      rsiSignal: { signal: rsiSignalText, detail: rsiDetail },
      bollSignal: { signal: bollSignalText, detail: bollDetail },
      kdjSignal: { signal: kdjSignalText, detail: kdjDetail },
      volumeSignal: { signal: volumeSignalText, detail: volumeDetail || "量能正常" },
    },
  };
}
