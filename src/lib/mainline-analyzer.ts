// 主线/副线追踪引擎
// 通过板块连续涨幅、资金流入持续性、领涨频次来识别当周/当月的主线和副线
// 并基于技术指标给出入场/离场信号

import type { SectorData, KLineData } from "./stock-api";

export type LineType = "主线" | "副线" | "轮动热点" | "退潮板块";
export type SignalType = "入场" | "离场" | "加仓" | "减仓" | "观望";
export type SignalStrength = "强" | "中" | "弱";

export interface TradeSignal {
  type: SignalType;
  strength: SignalStrength;
  price?: number;
  reason: string;
  timestamp: string;
}

export interface MainLineItem {
  sector: string;
  lineType: LineType;
  rank: number;
  // 连续性指标
  consecutiveUpDays: number;       // 连续上涨天数
  weekChangePercent: number;       // 本周累计涨幅
  monthChangePercent: number;      // 本月累计涨幅
  avgDailyAmount: number;          // 日均成交额
  amountTrend: "放量" | "缩量" | "平量"; // 量能趋势
  // 板块内部强度
  riseRatio: number;               // 上涨家数占比
  leadingStocks: string[];         // 领涨个股
  // 信号
  currentSignal: TradeSignal;
  recentSignals: TradeSignal[];    // 最近的信号历史
  // 分析
  strengthScore: number;           // 强度评分 0-100
  momentum: "加速" | "高位震荡" | "减速" | "见顶回落" | "底部企稳" | "持续走弱";
  analysis: string;                // 文字分析
  keyLevels: {
    entry: number[];               // 建议入场价位（支撑位）
    exit: number[];                // 建议离场价位（阻力位）
  };
}

export interface MainLineReport {
  period: "本周" | "本月";
  generatedAt: string;
  marketPhase: string;             // 当前市场阶段描述
  mainLines: MainLineItem[];       // 主线
  subLines: MainLineItem[];        // 副线
  rotationHots: MainLineItem[];    // 轮动热点
  fadingLines: MainLineItem[];     // 退潮板块
  summary: string;                 // 总结
  tradingPlan: string;             // 交易计划建议
}

// 从板块K线数据计算连续上涨天数
function calcConsecutiveUpDays(klines: KLineData[]): number {
  let count = 0;
  for (let i = klines.length - 1; i >= 0; i--) {
    if (klines[i].close > klines[i].open) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// 计算一段时间的累计涨幅
function calcPeriodChange(klines: KLineData[], days: number): number {
  if (klines.length < 2) return 0;
  const start = Math.max(0, klines.length - days);
  const startPrice = klines[start].open;
  const endPrice = klines[klines.length - 1].close;
  if (startPrice === 0) return 0;
  return ((endPrice - startPrice) / startPrice) * 100;
}

// 量能趋势分析
function calcAmountTrend(klines: KLineData[]): "放量" | "缩量" | "平量" {
  if (klines.length < 10) return "平量";
  const recent5 = klines.slice(-5).reduce((s, k) => s + k.volume, 0) / 5;
  const prev5 = klines.slice(-10, -5).reduce((s, k) => s + k.volume, 0) / 5;
  if (prev5 === 0) return "平量";
  const ratio = recent5 / prev5;
  if (ratio > 1.3) return "放量";
  if (ratio < 0.7) return "缩量";
  return "平量";
}

// 判断动量状态
function calcMomentum(
  klines: KLineData[],
  consecutiveUp: number,
  weekChange: number,
  amountTrend: string
): "加速" | "高位震荡" | "减速" | "见顶回落" | "底部企稳" | "持续走弱" {
  if (klines.length < 10) return "底部企稳";

  const last5Change = calcPeriodChange(klines, 5);
  const prev5Change = calcPeriodChange(klines.slice(0, -5), 5);

  // 加速上涨：近5日涨幅 > 前5日涨幅，且放量
  if (last5Change > 2 && last5Change > prev5Change && amountTrend === "放量") return "加速";
  // 高位震荡：周涨幅大但近期涨幅收窄
  if (weekChange > 3 && Math.abs(last5Change) < 1.5) return "高位震荡";
  // 见顶回落：之前涨幅大，近期开始下跌
  if (prev5Change > 2 && last5Change < -1) return "见顶回落";
  // 减速：还在涨但涨幅收窄
  if (last5Change > 0 && last5Change < prev5Change * 0.5) return "减速";
  // 底部企稳：之前跌，近期企稳
  if (prev5Change < -2 && last5Change > -0.5) return "底部企稳";
  // 持续走弱
  if (last5Change < -1 && prev5Change < 0) return "持续走弱";

  return consecutiveUp >= 3 ? "加速" : weekChange > 0 ? "高位震荡" : "底部企稳";
}

// 生成交易信号
function generateSignal(
  momentum: string,
  strengthScore: number,
  weekChange: number,
  consecutiveUp: number,
  amountTrend: string,
  klines: KLineData[]
): TradeSignal {
  const now = new Date().toISOString();
  const price = klines.length > 0 ? klines[klines.length - 1].close : 0;

  // 强入场信号：加速上涨 + 高强度 + 放量
  if (momentum === "加速" && strengthScore >= 70 && amountTrend === "放量") {
    return { type: "入场", strength: "强", price, reason: "板块加速上攻，量能配合良好，主线确立", timestamp: now };
  }

  // 中入场信号：底部企稳 + 开始放量
  if (momentum === "底部企稳" && amountTrend === "放量" && strengthScore >= 40) {
    return { type: "入场", strength: "中", price, reason: "板块触底回升迹象，量能开始回暖，可试探性建仓", timestamp: now };
  }

  // 弱入场信号：连续上涨但量能一般
  if (consecutiveUp >= 3 && strengthScore >= 50 && amountTrend !== "缩量") {
    return { type: "加仓", strength: "弱", price, reason: `连涨${consecutiveUp}天，趋势延续但需确认量能`, timestamp: now };
  }

  // 强离场信号：见顶回落 + 缩量
  if (momentum === "见顶回落" && amountTrend === "缩量") {
    return { type: "离场", strength: "强", price, reason: "板块冲高回落，量能萎缩，主升浪可能结束", timestamp: now };
  }

  // 中离场/减仓信号：高位震荡 + 涨幅已大
  if (momentum === "高位震荡" && weekChange > 5) {
    return { type: "减仓", strength: "中", price, reason: "短期涨幅较大，高位震荡加剧，建议逐步止盈", timestamp: now };
  }

  // 离场信号：持续走弱
  if (momentum === "持续走弱" && strengthScore < 30) {
    return { type: "离场", strength: "中", price, reason: "板块持续走弱，资金流出明显，建议离场观望", timestamp: now };
  }

  // 减速时减仓
  if (momentum === "减速") {
    return { type: "减仓", strength: "弱", price, reason: "上涨动能减弱，可适当降低仓位锁定利润", timestamp: now };
  }

  return { type: "观望", strength: "弱", price, reason: "信号不明确，建议持币观望等待方向确认", timestamp: now };
}

// 计算关键价位
function calcKeyLevels(klines: KLineData[]): { entry: number[]; exit: number[] } {
  if (klines.length < 20) return { entry: [], exit: [] };

  const recent20 = klines.slice(-20);
  const closes = recent20.map(k => k.close);
  const lows = recent20.map(k => k.low);
  const highs = recent20.map(k => k.high);

  const currentPrice = closes[closes.length - 1];

  // MA支撑/阻力
  const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const ma20 = closes.reduce((a, b) => a + b, 0) / 20;

  // 近期高低点
  const recentLow = Math.min(...lows);
  const recentHigh = Math.max(...highs);
  const prevLow = Math.min(...klines.slice(-10, -5).map(k => k.low));
  const prevHigh = Math.max(...klines.slice(-10, -5).map(k => k.high));

  // 入场价位（支撑位）：取低于当前价的
  const entryLevels = [ma5, ma10, ma20, recentLow, prevLow]
    .filter(p => p < currentPrice && p > currentPrice * 0.9)
    .sort((a, b) => b - a)
    .slice(0, 3)
    .map(p => Number(p.toFixed(2)));

  // 离场价位（阻力位）：取高于当前价的
  const exitLevels = [recentHigh, prevHigh, currentPrice * 1.05, currentPrice * 1.1]
    .filter(p => p > currentPrice)
    .sort((a, b) => a - b)
    .slice(0, 3)
    .map(p => Number(p.toFixed(2)));

  return { entry: entryLevels, exit: exitLevels };
}

// 判断板块类型（主线/副线/轮动/退潮）
function classifyLine(
  strengthScore: number,
  weekChange: number,
  monthChange: number,
  consecutiveUp: number,
  momentum: string,
  rank: number  // 按强度排名，用于限制主线数量
): LineType {
  // 主线条件极严格：真正的主线一个市场最多1-2条
  // 必须同时满足：排名前2 + 高强度 + 持续性 + 月涨幅显著
  if (rank <= 2 && strengthScore >= 78 && consecutiveUp >= 3 && monthChange > 8) return "主线";
  if (rank === 1 && strengthScore >= 82 && monthChange > 10) return "主线";

  // 副线：最多2-3条，必须排名前4且满足多个条件
  if (rank <= 3 && strengthScore >= 68 && weekChange > 4 && consecutiveUp >= 2) return "副线";
  if (rank <= 3 && monthChange > 8 && strengthScore >= 65 && weekChange > 2) return "副线";

  // 退潮：明确走弱
  if (momentum === "见顶回落" || momentum === "持续走弱") return "退潮板块";
  if (weekChange < -3 || (monthChange < -5 && strengthScore < 30)) return "退潮板块";

  return "轮动热点";
}

// 主入口：生成主线报告
export function generateMainLineReport(
  sectors: SectorData[],
  sectorKlines: Record<string, KLineData[]>,
  period: "本周" | "本月" = "本周"
): MainLineReport {
  const now = new Date().toISOString();
  const periodDays = period === "本周" ? 5 : 22;

  const allItems: MainLineItem[] = sectors
    .filter(s => s.stockCount > 10) // 过滤掉太小的板块
    .map(sector => {
      const klines = sectorKlines[sector.code] || [];
      const consecutiveUpDays = klines.length > 0 ? calcConsecutiveUpDays(klines) : 0;
      const weekChange = klines.length >= 5 ? calcPeriodChange(klines, 5) : sector.changePercent;
      const monthChange = klines.length >= 22 ? calcPeriodChange(klines, 22) : weekChange * 3;
      const amountTrend = klines.length >= 10 ? calcAmountTrend(klines) : "平量";
      const avgDailyAmount = klines.length >= 5
        ? klines.slice(-5).reduce((s, k) => s + k.amount, 0) / 5
        : sector.amount;

      const riseRatio = sector.stockCount > 0 ? sector.riseCount / sector.stockCount : 0;
      const momentum = klines.length >= 10
        ? calcMomentum(klines, consecutiveUpDays, weekChange, amountTrend)
        : (weekChange > 2 ? "加速" : weekChange < -2 ? "持续走弱" : "底部企稳");

      // 强度评分
      let strengthScore = 50; // 基准
      strengthScore += Math.min(20, weekChange * 3);                    // 周涨幅贡献
      strengthScore += Math.min(15, consecutiveUpDays * 4);             // 连涨天数
      strengthScore += (riseRatio - 0.5) * 30;                         // 上涨家数占比
      if (amountTrend === "放量") strengthScore += 10;
      if (amountTrend === "缩量") strengthScore -= 8;
      if (momentum === "加速") strengthScore += 10;
      if (momentum === "见顶回落") strengthScore -= 15;
      if (momentum === "持续走弱") strengthScore -= 20;
      strengthScore = Math.max(0, Math.min(100, Math.round(strengthScore)));

      const currentSignal = klines.length >= 10
        ? generateSignal(momentum, strengthScore, weekChange, consecutiveUpDays, amountTrend, klines)
        : { type: "观望" as SignalType, strength: "弱" as SignalStrength, reason: "数据不足", timestamp: now };

      const keyLevels = klines.length >= 20 ? calcKeyLevels(klines) : { entry: [], exit: [] };

      return {
        sector: sector.name,
        lineType: "轮动热点" as LineType, // 临时，排序后再分类
        rank: 0,
        consecutiveUpDays,
        weekChangePercent: Number(weekChange.toFixed(2)),
        monthChangePercent: Number(monthChange.toFixed(2)),
        avgDailyAmount,
        amountTrend,
        riseRatio: Number(riseRatio.toFixed(3)),
        leadingStocks: sector.leadingStock ? [sector.leadingStock] : [],
        currentSignal,
        recentSignals: [currentSignal],
        strengthScore,
        momentum,
        analysis: "", // 排序分类后再生成
        keyLevels,
      };
    })
    .sort((a, b) => b.strengthScore - a.strengthScore);

  // 先排名，再基于排名分类（确保主线最多1-2条）
  allItems.forEach((item, i) => {
    item.rank = i + 1;
    item.lineType = classifyLine(
      item.strengthScore, item.weekChangePercent, item.monthChangePercent,
      item.consecutiveUpDays, item.momentum, item.rank
    );
    // 生成文字分析
    const analysisLines: string[] = [];
    if (item.lineType === "主线") {
      analysisLines.push(`${item.sector}是当前市场${period}主线，持续性强`);
    } else if (item.lineType === "副线") {
      analysisLines.push(`${item.sector}是当前市场副线，可适度参与`);
    }
    analysisLines.push(`${period === "本周" ? "周" : "月"}涨幅${item.weekChangePercent >= 0 ? "+" : ""}${(period === "本周" ? item.weekChangePercent : item.monthChangePercent).toFixed(2)}%`);
    if (item.consecutiveUpDays >= 3) analysisLines.push(`已连续上涨${item.consecutiveUpDays}天`);
    analysisLines.push(`板块上涨家数占比${(item.riseRatio * 100).toFixed(0)}%，${item.amountTrend}`);
    analysisLines.push(`动量状态：${item.momentum}`);
    item.analysis = analysisLines.join("；");
  });

  const mainLines = allItems.filter(i => i.lineType === "主线");
  const subLines = allItems.filter(i => i.lineType === "副线");
  const rotationHots = allItems.filter(i => i.lineType === "轮动热点");
  const fadingLines = allItems.filter(i => i.lineType === "退潮板块");

  // 市场阶段判断
  const avgScore = allItems.reduce((s, i) => s + i.strengthScore, 0) / Math.max(1, allItems.length);
  let marketPhase: string;
  if (mainLines.length === 2 && avgScore > 60) {
    marketPhase = "强势上攻期 — 双主线并进，市场赚钱效应强，重仓主线方向";
  } else if (mainLines.length === 1) {
    marketPhase = "结构性行情 — 单一主线明确，跟紧主线板块，分化加剧";
  } else if (mainLines.length === 0 && subLines.length >= 2) {
    marketPhase = "热点轮动期 — 无明确主线，板块快速轮动，短线操作为主";
  } else if (fadingLines.length > allItems.length * 0.5) {
    marketPhase = "退潮调整期 — 多数板块走弱，建议控制仓位等待企稳";
  } else if (mainLines.length === 0 && subLines.length <= 1) {
    marketPhase = "震荡蓄势期 — 市场方向不明，等待主线信号确认";
  } else {
    marketPhase = "震荡蓄势期 — 市场方向不明，等待主线信号确认";
  }

  // 总结
  const summaryParts: string[] = [];
  if (mainLines.length > 0) {
    summaryParts.push(`当前主线：${mainLines.map(m => m.sector).join("、")}，建议重点配置`);
  }
  if (subLines.length > 0) {
    summaryParts.push(`副线关注：${subLines.map(m => m.sector).join("、")}，可适当参与`);
  }
  if (fadingLines.length > 0) {
    summaryParts.push(`退潮板块：${fadingLines.map(m => m.sector).join("、")}，建议回避`);
  }
  const entrySignals = allItems.filter(i => i.currentSignal.type === "入场" || i.currentSignal.type === "加仓");
  const exitSignals = allItems.filter(i => i.currentSignal.type === "离场" || i.currentSignal.type === "减仓");
  if (entrySignals.length > 0) {
    summaryParts.push(`入场信号：${entrySignals.map(s => `${s.sector}(${s.currentSignal.strength})`).join("、")}`);
  }
  if (exitSignals.length > 0) {
    summaryParts.push(`离场信号：${exitSignals.map(s => `${s.sector}(${s.currentSignal.strength})`).join("、")}`);
  }

  // 交易计划
  const planParts: string[] = [];
  if (mainLines.length > 0) {
    const best = mainLines[0];
    planParts.push(`主攻方向: ${best.sector}，信号${best.currentSignal.type}(${best.currentSignal.strength})，${best.currentSignal.reason}`);
  }
  if (entrySignals.length > 0) {
    planParts.push(`可操作板块: ${entrySignals.map(s => s.sector).join("、")}，逢回调在支撑位附近分批介入`);
  }
  if (exitSignals.length > 0) {
    planParts.push(`需离场板块: ${exitSignals.map(s => s.sector).join("、")}，逢反弹减仓，不追高`);
  }
  planParts.push("仓位建议: " + (avgScore > 60 ? "7-8成仓位，主线板块重仓" : avgScore > 45 ? "5-6成仓位，主线为主副线为辅" : "3成以下仓位，以防守为主"));

  return {
    period,
    generatedAt: now,
    marketPhase,
    mainLines,
    subLines,
    rotationHots,
    fadingLines,
    summary: summaryParts.join("。"),
    tradingPlan: planParts.join("。"),
  };
}
