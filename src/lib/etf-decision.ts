/**
 * 场外ETF收盘前决策引擎
 * 
 * 每个板块ETF综合分析：
 * 1. 趋势判断（均线/涨跌幅/相对强弱）
 * 2. 资金流向（主力资金/北向资金/ETF换手率）
 * 3. 估值位置（短期涨幅/振幅/拥挤度）
 * 4. 情绪面（板块一致性/量价关系/全局市场）
 * 
 * 最终输出：加仓/减仓/跑路/入场/持仓观望/定投
 */

import type { ETFData, KLineData, NorthboundFlow, EnrichedSectorData } from "./stock-api";
import type { SectorEventSummary, EventSignal } from "./event-driven";
import { getSectorEventScore } from "./event-driven";

// ==================== 类型 ====================

export type ETFAction = "重仓加仓" | "小额加仓" | "持仓不动" | "分批减仓" | "清仓跑路" | "首次入场" | "定投买入" | "观望等待";
export type RiskLevel = "极低" | "低" | "中等" | "高" | "极高";
export type Urgency = "立即执行" | "今日执行" | "本周关注" | "长期跟踪";

export interface ETFSignal {
  category: string;   // 趋势/资金/估值/情绪
  indicator: string;
  value: string;
  judgment: string;
  bullish: boolean;
  weight: number;      // 该信号权重 -10~10
}

export interface ETFDecision {
  etfCode: string;
  etfName: string;
  sector: string;
  price: number;
  changePercent: number;

  // 五维分数
  trendScore: number;        // -100~100
  capitalScore: number;
  valuationScore: number;
  sentimentScore: number;
  eventScore: number;          // 事件驱动分
  compositeScore: number;    // 加权综合分

  // 决策
  action: ETFAction;
  urgency: Urgency;
  riskLevel: RiskLevel;
  confidence: number;        // 0-100

  // 信号明细
  signals: ETFSignal[];

  // 文字建议
  summary: string;           // 一句话结论
  reason: string;            // 核心理由
  actionDetail: string;      // 具体操作建议
  stopLoss: string;          // 止损建议
  targetProfit: string;      // 目标盈利

  // 关键价位（场内参考）
  supportPrice: number;
  resistancePrice: number;

  // 数据日期（场外基金净值日期）
  navDate: string;
  isEstimated: boolean;      // 是否盘中估算
}

export interface ETFDecisionReport {
  timestamp: string;
  isPreClose: boolean;        // 是否收盘前
  marketSentiment: string;    // 大盘情绪
  northboundTrend: string;    // 北向资金趋势

  // 分类汇总
  strongBuy: ETFDecision[];   // 重仓加仓
  buy: ETFDecision[];         // 小额加仓/入场/定投
  hold: ETFDecision[];        // 持仓不动/观望
  sell: ETFDecision[];        // 分批减仓
  runAway: ETFDecision[];     // 清仓跑路

  allDecisions: ETFDecision[];

  // 事件驱动
  eventSummaries: SectorEventSummary[];
  topEvents: EventSignal[];

  // 全局建议
  overallAdvice: string;
}

// ==================== 分析逻辑 ====================

function analyzeETF(
  etf: ETFData,
  klines: KLineData[],
  sectorData: EnrichedSectorData | null,
  northbound: NorthboundFlow[],
  marketChangePercent: number,
  sectorEventSummaries: SectorEventSummary[]
): ETFDecision {
  const signals: ETFSignal[] = [];
  let trendScore = 0, capitalScore = 0, valuationScore = 0, sentimentScore = 0, eventScore = 0;

  const hasKlines = klines.length >= 20;
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const len = closes.length;

  // =============== 1. 趋势分析 ===============

  if (hasKlines) {
    const calcMA = (p: number) => closes.slice(-p).reduce((a, b) => a + b, 0) / Math.min(p, closes.length);
    const ma5 = calcMA(5);
    const ma10 = calcMA(10);
    const ma20 = calcMA(20);
    const curr = closes[len - 1];

    // 均线排列
    if (ma5 > ma10 && ma10 > ma20) {
      signals.push({ category: "趋势", indicator: "均线排列", value: "多头排列", judgment: "上升趋势确立，回调是加仓机会", bullish: true, weight: 8 });
      trendScore += 30;
    } else if (ma5 < ma10 && ma10 < ma20) {
      signals.push({ category: "趋势", indicator: "均线排列", value: "空头排列", judgment: "下降趋势中，反弹减仓", bullish: false, weight: -8 });
      trendScore -= 30;
    } else {
      signals.push({ category: "趋势", indicator: "均线排列", value: "均线缠绕", judgment: "方向不明，等待突破", bullish: false, weight: 0 });
    }

    // 价格位置
    const pctFromMa20 = ((curr - ma20) / ma20) * 100;
    if (pctFromMa20 > 8) {
      signals.push({ category: "趋势", indicator: "偏离度", value: `高于MA20 ${pctFromMa20.toFixed(1)}%`, judgment: "短期超买，有回调压力", bullish: false, weight: -5 });
      trendScore -= 15;
    } else if (pctFromMa20 < -8) {
      signals.push({ category: "趋势", indicator: "偏离度", value: `低于MA20 ${Math.abs(pctFromMa20).toFixed(1)}%`, judgment: "短期超卖，可能反弹", bullish: true, weight: 5 });
      trendScore += 15;
    }

    // 5日变化
    if (len >= 6) {
      const change5d = ((curr - closes[len - 6]) / closes[len - 6]) * 100;
      if (change5d > 5) {
        signals.push({ category: "趋势", indicator: "5日涨幅", value: `+${change5d.toFixed(1)}%`, judgment: "短期强势", bullish: true, weight: 4 });
        trendScore += 15;
      } else if (change5d < -5) {
        signals.push({ category: "趋势", indicator: "5日跌幅", value: `${change5d.toFixed(1)}%`, judgment: "短期弱势", bullish: false, weight: -4 });
        trendScore -= 15;
      }
    }
  } else {
    // 用ETF自身5日/10日涨跌幅代替K线分析
    const c5 = etf.change5d, c10 = etf.change10d;
    if (c5 > 3 && c10 > 5) {
      signals.push({ category: "趋势", indicator: "中期趋势", value: `5日+${c5.toFixed(1)}%/10日+${c10.toFixed(1)}%`, judgment: "多头趋势确立", bullish: true, weight: 7 });
      trendScore += 30;
    } else if (c5 > 1 && c10 > 2) {
      signals.push({ category: "趋势", indicator: "中期趋势", value: `5日+${c5.toFixed(1)}%/10日+${c10.toFixed(1)}%`, judgment: "温和上行", bullish: true, weight: 4 });
      trendScore += 15;
    } else if (c5 < -3 && c10 < -5) {
      signals.push({ category: "趋势", indicator: "中期趋势", value: `5日${c5.toFixed(1)}%/10日${c10.toFixed(1)}%`, judgment: "空头趋势", bullish: false, weight: -7 });
      trendScore -= 30;
    } else if (c5 < -1 && c10 < -2) {
      signals.push({ category: "趋势", indicator: "中期趋势", value: `5日${c5.toFixed(1)}%/10日${c10.toFixed(1)}%`, judgment: "温和下行", bullish: false, weight: -4 });
      trendScore -= 15;
    } else {
      signals.push({ category: "趋势", indicator: "中期趋势", value: `5日${c5 >= 0 ? "+" : ""}${c5.toFixed(1)}%/10日${c10 >= 0 ? "+" : ""}${c10.toFixed(1)}%`, judgment: "方向不明确", bullish: false, weight: 0 });
    }

    // 5日vs10日趋势加速/减速判断
    if (c5 > 0 && c10 > 0 && c5 > c10 * 0.6) {
      signals.push({ category: "趋势", indicator: "趋势加速", value: `5日涨幅占10日${((c5 / c10) * 100).toFixed(0)}%`, judgment: "近期加速上涨", bullish: true, weight: 3 });
      trendScore += 10;
    } else if (c5 < 0 && c10 > 3) {
      signals.push({ category: "趋势", indicator: "趋势减速", value: `10日涨${c10.toFixed(1)}%但近5日回调${c5.toFixed(1)}%`, judgment: "涨后回调，注意风险", bullish: false, weight: -3 });
      trendScore -= 10;
    }
  }

  // 今日表现（始终可用，不依赖K线或板块）
  if (etf.changePercent > 2) {
    signals.push({ category: "趋势", indicator: "今日表现", value: `+${etf.changePercent.toFixed(2)}%`, judgment: "日内强势", bullish: true, weight: 3 });
    trendScore += 10;
  } else if (etf.changePercent > 0.5) {
    signals.push({ category: "趋势", indicator: "今日表现", value: `+${etf.changePercent.toFixed(2)}%`, judgment: "日内偏多", bullish: true, weight: 1 });
    trendScore += 5;
  } else if (etf.changePercent < -2) {
    signals.push({ category: "趋势", indicator: "今日表现", value: `${etf.changePercent.toFixed(2)}%`, judgment: "日内弱势", bullish: false, weight: -3 });
    trendScore -= 10;
  } else if (etf.changePercent < -0.5) {
    signals.push({ category: "趋势", indicator: "今日表现", value: `${etf.changePercent.toFixed(2)}%`, judgment: "日内偏空", bullish: false, weight: -1 });
    trendScore -= 5;
  } else {
    signals.push({ category: "趋势", indicator: "今日表现", value: `${etf.changePercent >= 0 ? "+" : ""}${etf.changePercent.toFixed(2)}%`, judgment: "日内平淡", bullish: false, weight: 0 });
  }

  // 相对大盘强弱
  const relStrength = etf.changePercent - marketChangePercent;
  if (relStrength > 1.5) {
    signals.push({ category: "趋势", indicator: "相对强弱", value: `跑赢大盘${relStrength.toFixed(1)}%`, judgment: "资金偏好该方向", bullish: true, weight: 4 });
    trendScore += 10;
  } else if (relStrength < -1.5) {
    signals.push({ category: "趋势", indicator: "相对强弱", value: `跑输大盘${Math.abs(relStrength).toFixed(1)}%`, judgment: "该方向被抛弃", bullish: false, weight: -4 });
    trendScore -= 10;
  }

  // =============== 2. 资金分析 ===============

  // 北向资金
  if (northbound.length >= 3) {
    const net3d = northbound.slice(-3).reduce((s, n) => s + n.total, 0);
    const consecutive = northbound.slice(-3).filter(n => n.total > 0).length;
    if (consecutive === 3) {
      signals.push({ category: "资金", indicator: "北向资金", value: `连续3日净买入${(net3d / 10000).toFixed(1)}亿`, judgment: "外资看多大势", bullish: true, weight: 6 });
      capitalScore += 25;
    } else if (consecutive === 0) {
      signals.push({ category: "资金", indicator: "北向资金", value: `连续3日净卖出${(Math.abs(net3d) / 10000).toFixed(1)}亿`, judgment: "外资撤退", bullish: false, weight: -6 });
      capitalScore -= 25;
    } else {
      const latest = northbound[northbound.length - 1];
      signals.push({ category: "资金", indicator: "北向资金", value: `最新${latest.total > 0 ? "净买入" : "净卖出"}${(Math.abs(latest.total) / 10000).toFixed(1)}亿`, judgment: latest.total > 0 ? "单日流入" : "单日流出", bullish: latest.total > 0, weight: latest.total > 0 ? 2 : -2 });
      capitalScore += latest.total > 0 ? 8 : -8;
    }
  }

  // ETF主力资金流向（直接来自ETF自身数据）
  if (etf.mainNetInflow > 5e7) {
    signals.push({ category: "资金", indicator: "ETF主力资金", value: `净流入${(etf.mainNetInflow / 1e8).toFixed(2)}亿`, judgment: "大资金看好，积极流入", bullish: true, weight: 6 });
    capitalScore += 25;
  } else if (etf.mainNetInflow > 1e7) {
    signals.push({ category: "资金", indicator: "ETF主力资金", value: `净流入${(etf.mainNetInflow / 1e4).toFixed(0)}万`, judgment: "资金小幅流入", bullish: true, weight: 3 });
    capitalScore += 10;
  } else if (etf.mainNetInflow < -5e7) {
    signals.push({ category: "资金", indicator: "ETF主力资金", value: `净流出${(Math.abs(etf.mainNetInflow) / 1e8).toFixed(2)}亿`, judgment: "⚠️ 大资金撤退", bullish: false, weight: -7 });
    capitalScore -= 25;
  } else if (etf.mainNetInflow < -1e7) {
    signals.push({ category: "资金", indicator: "ETF主力资金", value: `净流出${(Math.abs(etf.mainNetInflow) / 1e4).toFixed(0)}万`, judgment: "资金小幅流出", bullish: false, weight: -3 });
    capitalScore -= 10;
  }

  // 板块主力资金（补充信号）
  if (sectorData) {
    if (sectorData.mainNetInflow > 1e8) {
      signals.push({ category: "资金", indicator: "板块主力", value: `板块净流入${(sectorData.mainNetInflow / 1e8).toFixed(1)}亿`, judgment: "板块整体资金看多", bullish: true, weight: 4 });
      capitalScore += 15;
    } else if (sectorData.mainNetInflow < -1e8) {
      signals.push({ category: "资金", indicator: "板块主力", value: `板块净流出${(Math.abs(sectorData.mainNetInflow) / 1e8).toFixed(1)}亿`, judgment: "板块资金离场", bullish: false, weight: -4 });
      capitalScore -= 15;
    }
  }

  // ETF换手率（始终可用）
  if (etf.turnoverRate > 5 && etf.changePercent > 0) {
    signals.push({ category: "资金", indicator: "ETF换手率", value: `${etf.turnoverRate.toFixed(1)}%放量上涨`, judgment: "资金活跃介入", bullish: true, weight: 3 });
    capitalScore += 10;
  } else if (etf.turnoverRate > 5 && etf.changePercent < 0) {
    signals.push({ category: "资金", indicator: "ETF换手率", value: `${etf.turnoverRate.toFixed(1)}%放量下跌`, judgment: "抛压明显", bullish: false, weight: -3 });
    capitalScore -= 10;
  } else if (etf.turnoverRate < 0.5) {
    signals.push({ category: "资金", indicator: "ETF换手率", value: `${etf.turnoverRate.toFixed(2)}%极低`, judgment: "市场关注度低", bullish: false, weight: -1 });
    capitalScore -= 5;
  }

  // ETF成交量异动
  if (hasKlines && len >= 10) {
    const avgVol = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const todayVol = volumes[len - 1];
    const volRatio = avgVol > 0 ? todayVol / avgVol : 1;
    if (volRatio > 2 && etf.changePercent > 0) {
      signals.push({ category: "资金", indicator: "成交量", value: `放量${volRatio.toFixed(1)}倍`, judgment: "资金大举进场", bullish: true, weight: 5 });
      capitalScore += 15;
    } else if (volRatio > 2 && etf.changePercent < 0) {
      signals.push({ category: "资金", indicator: "成交量", value: `放量下跌${volRatio.toFixed(1)}倍`, judgment: "⚠️ 恐慌抛售", bullish: false, weight: -7 });
      capitalScore -= 20;
    }
  }

  // =============== 3. 估值/位置 ===============

  if (hasKlines && len >= 20) {
    // 20日涨跌幅
    const change20d = ((closes[len - 1] - closes[Math.max(0, len - 21)]) / closes[Math.max(0, len - 21)]) * 100;
    if (change20d > 15) {
      signals.push({ category: "估值", indicator: "20日涨幅", value: `+${change20d.toFixed(1)}%`, judgment: "⚠️ 短期严重超涨，获利盘沉重", bullish: false, weight: -7 });
      valuationScore -= 30;
    } else if (change20d > 8) {
      signals.push({ category: "估值", indicator: "20日涨幅", value: `+${change20d.toFixed(1)}%`, judgment: "涨幅偏大，注意回调", bullish: false, weight: -3 });
      valuationScore -= 10;
    } else if (change20d < -15) {
      signals.push({ category: "估值", indicator: "20日跌幅", value: `${change20d.toFixed(1)}%`, judgment: "深度超跌，可能迎来反弹", bullish: true, weight: 6 });
      valuationScore += 25;
    } else if (change20d < -8) {
      signals.push({ category: "估值", indicator: "20日跌幅", value: `${change20d.toFixed(1)}%`, judgment: "跌幅较大，左侧机会区", bullish: true, weight: 4 });
      valuationScore += 15;
    }

    // 当前价在20日区间位置
    const high20 = Math.max(...closes.slice(-20));
    const low20 = Math.min(...closes.slice(-20));
    const range = high20 - low20;
    const position = range > 0 ? ((closes[len - 1] - low20) / range) * 100 : 50;

    if (position > 90) {
      signals.push({ category: "估值", indicator: "区间位置", value: `20日内${position.toFixed(0)}%高位`, judgment: "接近阶段高点，追高风险大", bullish: false, weight: -4 });
      valuationScore -= 15;
    } else if (position < 10) {
      signals.push({ category: "估值", indicator: "区间位置", value: `20日内${position.toFixed(0)}%低位`, judgment: "接近阶段低点，安全边际高", bullish: true, weight: 5 });
      valuationScore += 20;
    }
  } else {
    // 用ETF自身10日涨跌幅判断估值位置
    const c10 = etf.change10d;
    if (c10 > 15) {
      signals.push({ category: "估值", indicator: "10日涨幅", value: `+${c10.toFixed(1)}%`, judgment: "⚠️ 短期严重超涨，获利盘沉重", bullish: false, weight: -7 });
      valuationScore -= 30;
    } else if (c10 > 8) {
      signals.push({ category: "估值", indicator: "10日涨幅", value: `+${c10.toFixed(1)}%`, judgment: "涨幅较大，注意回调风险", bullish: false, weight: -4 });
      valuationScore -= 15;
    } else if (c10 < -15) {
      signals.push({ category: "估值", indicator: "10日跌幅", value: `${c10.toFixed(1)}%`, judgment: "深度超跌，可考虑左侧定投", bullish: true, weight: 6 });
      valuationScore += 25;
    } else if (c10 < -8) {
      signals.push({ category: "估值", indicator: "10日跌幅", value: `${c10.toFixed(1)}%`, judgment: "跌幅较大，接近布局区", bullish: true, weight: 4 });
      valuationScore += 15;
    } else if (c10 > 3) {
      signals.push({ category: "估值", indicator: "10日涨幅", value: `+${c10.toFixed(1)}%`, judgment: "温和上涨中", bullish: true, weight: 1 });
      valuationScore += 5;
    } else if (c10 < -3) {
      signals.push({ category: "估值", indicator: "10日跌幅", value: `${c10.toFixed(1)}%`, judgment: "温和下跌中", bullish: false, weight: -1 });
      valuationScore -= 5;
    }

    // 振幅判断
    if (etf.amplitude > 3) {
      signals.push({ category: "估值", indicator: "日内振幅", value: `${etf.amplitude.toFixed(2)}%`, judgment: "波动剧烈，短线风险高", bullish: false, weight: -2 });
      valuationScore -= 8;
    }
  }

  // ETF换手率
  if (etf.turnoverRate > 15) {
    signals.push({ category: "估值", indicator: "换手率", value: `${etf.turnoverRate.toFixed(1)}%`, judgment: "⚠️ 换手率异常高，投机氛围浓", bullish: false, weight: -4 });
    valuationScore -= 15;
  }

  // =============== 4. 情绪面 ===============

  // 板块内部一致性
  if (sectorData) {
    const riseRatio = sectorData.stockCount > 0 ? sectorData.riseCount / sectorData.stockCount : 0;
    if (riseRatio > 0.8) {
      signals.push({ category: "情绪", indicator: "板块一致性", value: `${(riseRatio * 100).toFixed(0)}%个股上涨`, judgment: "做多情绪一致", bullish: true, weight: 4 });
      sentimentScore += 20;
    } else if (riseRatio < 0.2) {
      signals.push({ category: "情绪", indicator: "板块一致性", value: `${(riseRatio * 100).toFixed(0)}%个股上涨`, judgment: "恐慌情绪蔓延", bullish: false, weight: -5 });
      sentimentScore -= 25;
    } else if (riseRatio > 0.35 && riseRatio < 0.65) {
      signals.push({ category: "情绪", indicator: "板块一致性", value: `${(riseRatio * 100).toFixed(0)}%个股上涨`, judgment: "板块分化，缺乏合力", bullish: false, weight: -1 });
      sentimentScore -= 5;
    }
  }

  // MACD方向（简化）
  if (hasKlines && len >= 26) {
    const ema = (data: number[], period: number): number[] => {
      const r: number[] = [data[0]];
      const k = 2 / (period + 1);
      for (let i = 1; i < data.length; i++) r.push(data[i] * k + r[i - 1] * (1 - k));
      return r;
    };
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const dif = ema12.map((v, i) => v - ema26[i]);
    const dea = ema(dif, 9);
    const currentDif = dif[len - 1], currentDea = dea[len - 1];
    const prevDif = dif[len - 2], prevDea = dea[len - 2];

    if (prevDif <= prevDea && currentDif > currentDea) {
      signals.push({ category: "情绪", indicator: "MACD", value: "金叉", judgment: "买入信号出现", bullish: true, weight: 5 });
      sentimentScore += 20;
    } else if (prevDif >= prevDea && currentDif < currentDea) {
      signals.push({ category: "情绪", indicator: "MACD", value: "死叉", judgment: "卖出信号出现", bullish: false, weight: -5 });
      sentimentScore -= 20;
    } else if (currentDif > currentDea && currentDif > 0) {
      signals.push({ category: "情绪", indicator: "MACD", value: "零轴上方运行", judgment: "中期偏多", bullish: true, weight: 2 });
      sentimentScore += 8;
    } else if (currentDif < currentDea && currentDif < 0) {
      signals.push({ category: "情绪", indicator: "MACD", value: "零轴下方运行", judgment: "中期偏空", bullish: false, weight: -2 });
      sentimentScore -= 8;
    }
  }

  // 量价背离检测
  if (hasKlines && len >= 10) {
    const price5dChg = ((closes[len - 1] - closes[len - 6]) / closes[len - 6]) * 100;
    const vol5 = volumes.slice(-5).reduce((a, b) => a + b, 0);
    const vol5prev = volumes.slice(-10, -5).reduce((a, b) => a + b, 0);
    if (price5dChg > 3 && vol5 < vol5prev * 0.7) {
      signals.push({ category: "情绪", indicator: "量价背离", value: "涨价缩量", judgment: "⚠️ 上涨乏力，追高意愿不足", bullish: false, weight: -5 });
      sentimentScore -= 15;
    } else if (price5dChg < -3 && vol5 > vol5prev * 1.5) {
      signals.push({ category: "情绪", indicator: "量价背离", value: "跌价放量", judgment: "⚠️ 恐慌性抛售", bullish: false, weight: -6 });
      sentimentScore -= 20;
    }
  }

  // =============== 5. 事件驱动 ===============

  const eventResult = getSectorEventScore(etf.sector, sectorEventSummaries);
  eventScore = eventResult.score;
  for (const es of eventResult.signals) {
    signals.push(es);
    if (es.bullish) eventScore += es.weight * 3;
    else eventScore -= Math.abs(es.weight) * 3;
  }
  eventScore = Math.max(-100, Math.min(100, eventScore));

  // =============== 综合决策 ===============

  trendScore = Math.max(-100, Math.min(100, trendScore));
  capitalScore = Math.max(-100, Math.min(100, capitalScore));
  valuationScore = Math.max(-100, Math.min(100, valuationScore));
  sentimentScore = Math.max(-100, Math.min(100, sentimentScore));

  // 五维加权：趋势30% 资金20% 估值15% 情绪15% 事件20%
  const compositeScore = Math.round(
    trendScore * 0.30 + capitalScore * 0.20 + valuationScore * 0.15 + sentimentScore * 0.15 + eventScore * 0.20
  );

  // 决定操作
  const { action, urgency, confidence, summary, reason, actionDetail, stopLoss, targetProfit } =
    makeDecision(compositeScore, trendScore, capitalScore, valuationScore, sentimentScore, signals, etf);

  // 风险等级
  const riskLevel: RiskLevel =
    compositeScore < -50 ? "极高" :
    compositeScore < -20 ? "高" :
    compositeScore < 20 ? "中等" :
    compositeScore < 50 ? "低" : "极低";

  // 支撑阻力
  let supportPrice = etf.price * 0.95, resistancePrice = etf.price * 1.05;
  if (hasKlines && len >= 20) {
    supportPrice = Math.min(...closes.slice(-20));
    resistancePrice = Math.max(...closes.slice(-20));
  }

  return {
    etfCode: etf.code, etfName: etf.name, sector: etf.sector,
    price: etf.price, changePercent: etf.changePercent,
    trendScore, capitalScore, valuationScore, sentimentScore, eventScore, compositeScore,
    action, urgency, riskLevel, confidence, signals,
    summary, reason, actionDetail, stopLoss, targetProfit,
    supportPrice: Number(supportPrice.toFixed(3)),
    resistancePrice: Number(resistancePrice.toFixed(3)),
    navDate: "",
    isEstimated: false,
  };
}

function makeDecision(composite: number, trend: number, capital: number, valuation: number, sentiment: number, signals: ETFSignal[], etf: ETFData) {
  let action: ETFAction, urgency: Urgency, confidence: number;
  let summary: string, reason: string, actionDetail: string, stopLoss: string, targetProfit: string;

  const bullCount = signals.filter(s => s.bullish && s.weight >= 3).length;
  const bearCount = signals.filter(s => !s.bullish && s.weight <= -3).length;

  if (composite >= 40 && trend > 20 && capital > 0) {
    action = "重仓加仓";
    urgency = "今日执行";
    confidence = Math.min(90, 60 + bullCount * 5);
    summary = `${etf.name}四维共振看多，趋势+资金+估值三重确认`;
    reason = `趋势向上(${trend}分)+资金流入(${capital}分)+估值合理(${valuation}分)，做多信号强烈`;
    actionDetail = `建议加仓至目标仓位的80%，今日场外申购确认。回调可追加至满仓`;
    stopLoss = `跌破5日均线减半仓，跌破20日均线清仓`;
    targetProfit = `目标上涨8-15%止盈一半`;
  } else if (composite >= 20) {
    action = capital > 10 ? "小额加仓" : "定投买入";
    urgency = "今日执行";
    confidence = Math.min(75, 50 + bullCount * 4);
    summary = `${etf.name}偏多但未形成强共振，适合小额或定投`;
    reason = `综合偏多(${composite}分)，但存在${bearCount}个风险信号需关注`;
    actionDetail = `建议本次加仓不超过目标仓位的20%，分2-3次建仓`;
    stopLoss = `总仓位浮亏超过5%时暂停加仓`;
    targetProfit = `目标涨5-8%开始分批止盈`;
  } else if (composite >= -10) {
    action = "持仓不动";
    urgency = "本周关注";
    confidence = 40;
    summary = `${etf.name}多空信号交织，保持现有仓位`;
    reason = `综合评分中性(${composite}分)，无明确方向`;
    actionDetail = `已持仓不动，未持仓继续观望。等待趋势或资金方向明确后再操作`;
    stopLoss = `持仓浮亏超过8%可考虑减仓`;
    targetProfit = `暂无明确目标`;
  } else if (composite >= -30) {
    action = "分批减仓";
    urgency = "今日执行";
    confidence = Math.min(80, 50 + bearCount * 5);
    summary = `${etf.name}多项指标转空，建议降低仓位`;
    reason = `趋势转弱(${trend}分)+${bearCount}个利空信号，继续持有风险加大`;
    actionDetail = `今日减仓30-50%。保留底仓等待企稳信号。场外赎回今日提交`;
    stopLoss = `若继续恶化，清至1成以下`;
    targetProfit = `反弹至减仓价回本即可`;
  } else if (composite >= -50) {
    action = "分批减仓";
    urgency = "立即执行";
    confidence = Math.min(85, 55 + bearCount * 5);
    summary = `⚠️ ${etf.name}风险信号密集，强烈建议减仓`;
    reason = `多维度看空(${composite}分)，资金离场+趋势走坏`;
    actionDetail = `立即提交场外赎回，减仓至2成以下。不要补仓抄底`;
    stopLoss = `不设止损直接减仓`;
    targetProfit = `保本出局`;
  } else {
    action = "清仓跑路";
    urgency = "立即执行";
    confidence = Math.min(95, 65 + bearCount * 5);
    summary = `🚨 ${etf.name}全面崩塌信号，立即清仓！`;
    reason = `极端看空(${composite}分)，趋势崩坏+资金出逃+情绪恐慌`;
    actionDetail = `立即提交全部赎回！场外基金T+1确认，越早越好`;
    stopLoss = `无需止损，全部卖出`;
    targetProfit = `保住本金`;
  }

  // 特殊情况：深度超跌时的入场机会
  if (valuation > 30 && trend < -10 && composite > -20) {
    action = "首次入场";
    urgency = "本周关注";
    confidence = 55;
    summary = `${etf.name}深度回调后进入左侧布局区，可小额试探`;
    reason = `估值便宜(${valuation}分)但趋势未企稳，属于左侧机会`;
    actionDetail = `可用定投方式小额入场(不超过计划仓位10%)，分批建仓`;
    stopLoss = `总投入浮亏超10%暂停`;
    targetProfit = `中长期目标15-25%`;
  }

  return { action, urgency, confidence, summary, reason, actionDetail, stopLoss, targetProfit };
}

// ==================== 全局判断 ====================

function analyzeMarketSentiment(marketChange: number, northbound: NorthboundFlow[]): { sentiment: string; nbTrend: string } {
  let sentiment: string;
  if (marketChange > 1.5) sentiment = "大盘强势上涨，做多氛围浓厚";
  else if (marketChange > 0.3) sentiment = "大盘温和上涨，偏多";
  else if (marketChange > -0.3) sentiment = "大盘窄幅震荡，观望";
  else if (marketChange > -1.5) sentiment = "大盘偏弱下跌，谨慎";
  else sentiment = "大盘大幅下跌，风险释放中";

  let nbTrend = "数据不足";
  if (northbound.length >= 3) {
    const net3 = northbound.slice(-3).reduce((s, n) => s + n.total, 0);
    const days = northbound.slice(-3).filter(n => n.total > 0).length;
    if (days === 3) nbTrend = `外资连续3日流入${(net3 / 10000).toFixed(1)}亿，看多`;
    else if (days === 0) nbTrend = `外资连续3日流出${(Math.abs(net3) / 10000).toFixed(1)}亿，看空`;
    else nbTrend = `外资近3日有进有出，无明确方向`;
  }

  return { sentiment, nbTrend };
}

// ==================== 板块匹配 ====================

const ETF_SECTOR_KEYWORDS: Record<string, string[]> = {
  "新能源": ["新能源", "光伏", "锂电"],
  "5G": ["通信", "5G"],
  "创新药": ["创新药", "医药", "生物"],
  "半导体": ["半导体", "芯片", "集成电路"],
  "军工": ["军工", "国防", "航天"],
  "人工智能": ["人工智能", "AI", "算力", "大模型"],
  "消费": ["消费", "食品", "白酒", "零售"],
  "食品饮料": ["食品", "饮料", "白酒"],
  "家电": ["家电", "家居"],
  "汽车": ["汽车", "新能源车"],
  "银行": ["银行"],
  "券商": ["券商", "证券"],
  "非银": ["非银", "保险"],
  "红利": ["红利", "高股息"],
  "医药": ["医药", "医疗", "生物"],
  "医疗器械": ["医疗器械", "器械"],
  "电力": ["电力", "电网"],
  "煤炭": ["煤炭", "能源"],
  "有色金属": ["有色", "金属", "铜", "铝"],
  "碳中和": ["碳中和", "环保", "绿电"],
  "沪深300": ["沪深300", "大盘"],
  "中证500": ["中证500", "中盘"],
  "上证50": ["上证50", "大蓝筹"],
  "创业板": ["创业板", "成长"],
  "科创50": ["科创", "科技"],
};

function cleanName(name: string): string {
  return name.replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/g, "").trim();
}

function findMatchingSector(etf: ETFData, sectors: EnrichedSectorData[]): EnrichedSectorData | null {
  // 1. 根据ETF名称关键字匹配
  for (const [key, keywords] of Object.entries(ETF_SECTOR_KEYWORDS)) {
    if (keywords.some(kw => etf.name.includes(kw))) {
      const match = sectors.find(s => {
        const cn = cleanName(s.name);
        return keywords.some(kw => cn.includes(kw)) || cn.includes(key);
      });
      if (match) return match;
    }
  }

  // 2. 用etf.sector字段匹配
  if (etf.sector) {
    const match = sectors.find(s => {
      const cn = cleanName(s.name);
      return cn.includes(etf.sector) || etf.sector.includes(cn);
    });
    if (match) return match;
  }

  // 3. 按ETF名称前缀模糊匹配
  const prefix = etf.name.replace(/ETF.*$/g, "").replace(/[A-Za-z0-9]/g, "");
  if (prefix.length >= 2) {
    const kws = [prefix, prefix.slice(0, 2)];
    const match = sectors.find(s => kws.some(kw => cleanName(s.name).includes(kw)));
    if (match) return match;
  }

  return null;
}

// ==================== 主入口 ====================

export function generateETFDecisionReport(
  etfs: ETFData[],
  etfKlines: Record<string, KLineData[]>,
  enrichedSectors: EnrichedSectorData[],
  northbound: NorthboundFlow[],
  marketChangePercent: number,
  isPreClose: boolean,
  eventSummaries: SectorEventSummary[] = [],
  topEvents: EventSignal[] = []
): ETFDecisionReport {
  const { sentiment, nbTrend } = analyzeMarketSentiment(marketChangePercent, northbound);

  const allDecisions = etfs.map(etf => {
    const klines = etfKlines[etf.code] || [];
    // 多种匹配策略找到对应板块
    const sectorMatch = findMatchingSector(etf, enrichedSectors);
    return analyzeETF(etf, klines, sectorMatch, northbound, marketChangePercent, eventSummaries);
  });

  // 按综合分排序
  allDecisions.sort((a, b) => b.compositeScore - a.compositeScore);

  return {
    timestamp: new Date().toISOString(),
    isPreClose,
    marketSentiment: sentiment,
    northboundTrend: nbTrend,
    strongBuy: allDecisions.filter(d => d.action === "重仓加仓"),
    buy: allDecisions.filter(d => ["小额加仓", "首次入场", "定投买入"].includes(d.action)),
    hold: allDecisions.filter(d => ["持仓不动", "观望等待"].includes(d.action)),
    sell: allDecisions.filter(d => d.action === "分批减仓"),
    runAway: allDecisions.filter(d => d.action === "清仓跑路"),
    allDecisions,
    eventSummaries,
    topEvents,
    overallAdvice: generateOverallAdvice(allDecisions, sentiment, isPreClose),
  };
}

function generateOverallAdvice(decisions: ETFDecision[], sentiment: string, isPreClose: boolean): string {
  const buyCount = decisions.filter(d => ["重仓加仓", "小额加仓", "首次入场", "定投买入"].includes(d.action)).length;
  const sellCount = decisions.filter(d => ["分批减仓", "清仓跑路"].includes(d.action)).length;
  const prefix = isPreClose ? "📢 收盘前紧急提醒：" : "📊 场外ETF操作建议：";

  if (sellCount > decisions.length * 0.6) {
    return `${prefix}${sellCount}只ETF发出减仓/跑路信号，市场风险加大。建议立即提交赎回，优先处理"清仓跑路"标记的品种。${sentiment}。`;
  }
  if (buyCount > decisions.length * 0.6) {
    return `${prefix}${buyCount}只ETF发出买入信号，市场做多氛围好。${isPreClose ? "收盘前" : "今日"}可积极申购加仓。${sentiment}。`;
  }
  if (buyCount > sellCount) {
    return `${prefix}多空略偏多（${buyCount}买 vs ${sellCount}卖），可选择性加仓优质方向，控制总仓位。${sentiment}。`;
  }
  if (sellCount > buyCount) {
    return `${prefix}多空偏空（${buyCount}买 vs ${sellCount}卖），减仓为主，保留强势品种底仓。${sentiment}。`;
  }
  return `${prefix}多空平衡，建议观望为主，等待方向明确后再操作。${sentiment}。`;
}
