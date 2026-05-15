/**
 * 当日复盘引擎
 * 收盘后综合分析：板块涨跌排行、资金流向、涨停/跌停、情绪面、明日展望
 */

import type {
  EnrichedSectorData, MarketOverview, NorthboundFlow,
  SectorMoneyFlow, ETFData, MarketSentimentData,
} from "./stock-api";
import type { SectorEventSummary, EventSignal } from "./event-driven";

// ==================== 类型 ====================

export interface SectorReview {
  sector: string;
  changePercent: number;
  amplitude: number;
  change5d: number;
  mainNetInflow: number;       // 主力净流入（亿）
  mainNetInflowPercent: number;
  riseCount: number;
  fallCount: number;
  leadingStock: string;
  leadingStockChange: number;
  // 综合评价
  grade: "S" | "A" | "B" | "C" | "D";   // S最强 D最弱
  tag: string;                            // 一句话标签
  momentum: "加速" | "启动" | "震荡" | "走弱" | "暴跌";
  moneyDirection: "主力大幅流入" | "主力流入" | "中性" | "主力流出" | "主力大幅流出";
  // 明日展望
  tomorrowOutlook: "看涨" | "看跌" | "震荡";
  tomorrowReason: string;
}

export interface SentimentDimension {
  name: string;                // 维度名
  icon: string;
  score: number;               // -20 ~ +20
  label: string;               // 短标签 如"极度亢奋"
  detail: string;              // 一句话说明
  color: "red" | "green" | "yellow" | "gray";
}

export interface SentimentPanel {
  // 总情绪
  sentiment: "极度恐慌" | "恐慌" | "偏弱" | "中性" | "偏强" | "亢奋" | "极度亢奋";
  sentimentScore: number;        // -100 ~ 100
  sentimentEmoji: string;
  // 多维拆解
  dimensions: SentimentDimension[];
  // 关键数字
  limitUp: number;
  limitDown: number;
  riseCount: number;
  fallCount: number;
  flatCount: number;
  rise5pct: number;              // 涨>5%
  fall5pct: number;              // 跌>5%
  rise7pct: number;              // 准涨停
  fall7pct: number;              // 准跌停
  avgChange: number;             // 全市场平均涨幅
  medianChange: number;          // 中位数
  // 赚钱效应
  moneyEffect: "赚钱效应爆棚" | "赚钱效应好" | "赚钱效应一般" | "亏钱效应" | "亏钱效应严重";
  moneyEffectDesc: string;
  // 连板/炸板/高度（如果有数据）
  maxGainStock: { code: string; name: string; change: number };
  maxLossStock: { code: string; name: string; change: number };
  // 情绪总结（一段话）
  summary: string;
}

export interface MarketReview {
  // 大盘数据
  shChange: number;
  szChange: number;
  cybChange: number;
  totalAmount: number;         // 两市成交额（亿）
  // 情绪面板
  sentimentPanel: SentimentPanel;
  // 资金面
  northboundToday: number;     // 今日北向（亿）
  northbound3d: number;        // 3日北向（亿）
  northboundTrend: string;
  // 量能
  volumeVsPrev: "放量" | "缩量" | "平量";
  volumeComment: string;
}

export interface DailyReviewReport {
  date: string;
  marketReview: MarketReview;
  // 板块排行
  topGainers: SectorReview[];     // 涨幅前5
  topLosers: SectorReview[];      // 跌幅前5
  topMoneyIn: SectorReview[];     // 资金流入前5
  topMoneyOut: SectorReview[];    // 资金流出前5
  allSectors: SectorReview[];     // 全部板块（按涨幅排序）
  // 热点事件
  hotEvents: EventSignal[];
  // 明日前瞻
  tomorrowOverall: "看涨" | "看跌" | "震荡";
  tomorrowAdvice: string;
  tomorrowFocus: string[];        // 明日关注板块
  // 总结
  summary: string;
  timestamp: string;
}

// ==================== 情绪多维分析 ====================

function buildSentimentPanel(
  market: MarketOverview,
  sd: MarketSentimentData,
  northbound: NorthboundFlow[],
  totalAmount: number,
  sectors: EnrichedSectorData[],
): SentimentPanel {
  const dims: SentimentDimension[] = [];
  let total = 0;

  // --- 1. 涨跌比（散户体感） ---
  const totalStocks = sd.riseCount + sd.fallCount + sd.flatCount;
  const riseRatio = totalStocks > 0 ? sd.riseCount / totalStocks : 0.5;
  let d1Score = 0, d1Label = "", d1Detail = "";
  if (riseRatio > 0.8)       { d1Score = 18; d1Label = "普涨";   d1Detail = `${sd.riseCount}涨:${sd.fallCount}跌，全线飘红`; }
  else if (riseRatio > 0.65) { d1Score = 12; d1Label = "偏强";   d1Detail = `${sd.riseCount}涨:${sd.fallCount}跌，多数上涨`; }
  else if (riseRatio > 0.55) { d1Score = 6;  d1Label = "略强";   d1Detail = `涨多跌少`; }
  else if (riseRatio > 0.45) { d1Score = 0;  d1Label = "平衡";   d1Detail = `涨跌各半`; }
  else if (riseRatio > 0.35) { d1Score = -6; d1Label = "略弱";   d1Detail = `跌多涨少`; }
  else if (riseRatio > 0.2)  { d1Score = -12;d1Label = "偏弱";   d1Detail = `${sd.fallCount}跌:${sd.riseCount}涨，多数下跌`; }
  else                       { d1Score = -18;d1Label = "普跌";   d1Detail = `${sd.fallCount}跌:${sd.riseCount}涨，全线飘绿`; }
  dims.push({ name: "涨跌比", icon: "📊", score: d1Score, label: d1Label, detail: d1Detail, color: d1Score > 0 ? "red" : d1Score < 0 ? "green" : "gray" });
  total += d1Score;

  // --- 2. 涨停/跌停（赚钱效应核心） ---
  let d2Score = 0, d2Label = "", d2Detail = "";
  const netLimit = sd.limitUp - sd.limitDown;
  if (sd.limitUp >= 60 && sd.limitDown <= 5)      { d2Score = 20; d2Label = "涨停潮";   d2Detail = `${sd.limitUp}家涨停 ${sd.limitDown}家跌停，极强赚钱效应`; }
  else if (sd.limitUp >= 40)                       { d2Score = 15; d2Label = "涨停活跃"; d2Detail = `${sd.limitUp}家涨停，短线情绪高涨`; }
  else if (sd.limitUp >= 20 && sd.limitDown < 10)  { d2Score = 8;  d2Label = "尚可";     d2Detail = `${sd.limitUp}涨停 ${sd.limitDown}跌停，赚钱效应一般`; }
  else if (sd.limitUp < 10 && sd.limitDown < 10)   { d2Score = -3; d2Label = "冰点";     d2Detail = `仅${sd.limitUp}家涨停，市场情绪冰点`; }
  else if (sd.limitDown >= 20)                     { d2Score = -15;d2Label = "跌停潮";   d2Detail = `${sd.limitDown}家跌停！亏钱效应严重`; }
  else if (sd.limitDown >= 40)                     { d2Score = -20;d2Label = "千股跌停"; d2Detail = `${sd.limitDown}家跌停！极端恐慌`; }
  else { d2Score = Math.max(-10, Math.min(10, netLimit / 3)); d2Label = `${sd.limitUp}涨/${sd.limitDown}跌`; d2Detail = `涨停${sd.limitUp}家跌停${sd.limitDown}家`; }
  dims.push({ name: "涨停跌停", icon: "🔒", score: Math.round(d2Score), label: d2Label, detail: d2Detail, color: d2Score > 5 ? "red" : d2Score < -5 ? "green" : "yellow" });
  total += d2Score;

  // --- 3. 赚亏钱效应（>5%、>7%的分布） ---
  let d3Score = 0, d3Label = "", d3Detail = "";
  const strongUp = sd.rise5pct;    // 涨>5%
  const strongDown = sd.fall5pct;  // 跌>5%
  if (strongUp > 200 && strongDown < 20)      { d3Score = 18; d3Label = "爆棚";  d3Detail = `${strongUp}家涨超5%，仅${strongDown}家跌超5%，赚钱效应爆棚`; }
  else if (strongUp > 100 && strongDown < 50) { d3Score = 12; d3Label = "很好";  d3Detail = `${strongUp}家涨超5%，赚钱效应好`; }
  else if (strongUp > strongDown * 2)         { d3Score = 6;  d3Label = "正常";  d3Detail = `涨幅较大的多于跌幅较大的`; }
  else if (strongDown > strongUp * 2)         { d3Score = -10;d3Label = "亏钱";  d3Detail = `${strongDown}家跌超5%，亏钱效应显著`; }
  else if (strongDown > 200)                  { d3Score = -18;d3Label = "惨烈";  d3Detail = `${strongDown}家跌超5%！大面积亏损`; }
  else { d3Score = 0; d3Label = "一般"; d3Detail = `涨跌超5%各${strongUp}/${strongDown}家`; }
  dims.push({ name: "赚亏效应", icon: "💰", score: Math.round(d3Score), label: d3Label, detail: d3Detail, color: d3Score > 0 ? "red" : d3Score < 0 ? "green" : "gray" });
  total += d3Score;

  // --- 4. 中位数（真实体感：大部分人赚还是亏） ---
  let d4Score = 0, d4Label = "", d4Detail = "";
  const med = sd.medianChange;
  if (med > 3)       { d4Score = 15; d4Label = `+${med.toFixed(1)}%`; d4Detail = `中位数涨${med.toFixed(1)}%，大部分人赚钱`; }
  else if (med > 1)  { d4Score = 8;  d4Label = `+${med.toFixed(1)}%`; d4Detail = `中位数涨${med.toFixed(1)}%，多数人赚`; }
  else if (med > 0)  { d4Score = 3;  d4Label = `+${med.toFixed(1)}%`; d4Detail = `中位数微涨`; }
  else if (med > -1) { d4Score = -3; d4Label = `${med.toFixed(1)}%`;  d4Detail = `中位数微跌`; }
  else if (med > -3) { d4Score = -8; d4Label = `${med.toFixed(1)}%`;  d4Detail = `中位数跌${Math.abs(med).toFixed(1)}%，多数人亏`; }
  else               { d4Score = -15;d4Label = `${med.toFixed(1)}%`;  d4Detail = `中位数跌${Math.abs(med).toFixed(1)}%，大部分人亏钱`; }
  dims.push({ name: "中位数", icon: "📉", score: d4Score, label: d4Label, detail: d4Detail, color: d4Score > 0 ? "red" : d4Score < 0 ? "green" : "gray" });
  total += d4Score;

  // --- 5. 量能（成交额=情绪温度计） ---
  let d5Score = 0, d5Label = "", d5Detail = "";
  const amtBillion = totalAmount / 1e8; // 亿
  if (amtBillion > 15000)     { d5Score = 12; d5Label = "天量";   d5Detail = `成交${Math.round(amtBillion)}亿，资金疯狂入场`; }
  else if (amtBillion > 12000){ d5Score = 8;  d5Label = "放量";   d5Detail = `成交${Math.round(amtBillion)}亿，万亿放量`; }
  else if (amtBillion > 9000) { d5Score = 3;  d5Label = "适中";   d5Detail = `成交${Math.round(amtBillion)}亿`; }
  else if (amtBillion > 7000) { d5Score = -2; d5Label = "偏低";   d5Detail = `成交${Math.round(amtBillion)}亿，缩量`; }
  else if (amtBillion > 5000) { d5Score = -8; d5Label = "缩量";   d5Detail = `成交仅${Math.round(amtBillion)}亿，情绪低迷`; }
  else                        { d5Score = -12;d5Label = "地量";   d5Detail = `成交仅${Math.round(amtBillion)}亿，极度缩量，无人参与`; }
  dims.push({ name: "量能", icon: "📶", score: d5Score, label: d5Label, detail: d5Detail, color: d5Score > 0 ? "red" : d5Score < 0 ? "green" : "yellow" });
  total += d5Score;

  // --- 6. 北向资金（外资态度） ---
  let d6Score = 0, d6Label = "", d6Detail = "";
  const todayNB = northbound.length > 0 ? northbound[northbound.length - 1]?.total || 0 : 0;
  const nbBillion = todayNB / 1e8;
  if (nbBillion > 80)       { d6Score = 12; d6Label = "大幅流入"; d6Detail = `北向净买入${nbBillion.toFixed(0)}亿，外资抢筹`; }
  else if (nbBillion > 30)  { d6Score = 6;  d6Label = "流入";     d6Detail = `北向净买入${nbBillion.toFixed(0)}亿`; }
  else if (nbBillion > 0)   { d6Score = 2;  d6Label = "小幅流入"; d6Detail = `北向净买入${nbBillion.toFixed(0)}亿`; }
  else if (nbBillion > -30) { d6Score = -2; d6Label = "小幅流出"; d6Detail = `北向净卖出${Math.abs(nbBillion).toFixed(0)}亿`; }
  else if (nbBillion > -80) { d6Score = -6; d6Label = "流出";     d6Detail = `北向净卖出${Math.abs(nbBillion).toFixed(0)}亿`; }
  else                      { d6Score = -12;d6Label = "大幅流出"; d6Detail = `北向净卖出${Math.abs(nbBillion).toFixed(0)}亿，外资出逃`; }
  dims.push({ name: "北向资金", icon: "🌏", score: d6Score, label: d6Label, detail: d6Detail, color: d6Score > 0 ? "red" : d6Score < 0 ? "green" : "gray" });
  total += d6Score;

  // --- 7. 板块扩散度（是一个板块独涨还是多板块普涨 → 情绪广度） ---
  let d7Score = 0, d7Label = "", d7Detail = "";
  const risingSecCount = sectors.filter(s => s.changePercent > 1).length;
  const fallingSecCount = sectors.filter(s => s.changePercent < -1).length;
  const totalSec = sectors.length || 1;
  const riseSecRatio = risingSecCount / totalSec;
  if (riseSecRatio > 0.7)       { d7Score = 10; d7Label = "全面普涨"; d7Detail = `${risingSecCount}个板块涨超1%，全面开花`; }
  else if (riseSecRatio > 0.4)  { d7Score = 5;  d7Label = "多板块涨"; d7Detail = `${risingSecCount}个板块涨超1%，热点较广`; }
  else if (riseSecRatio > 0.15) { d7Score = 0;  d7Label = "分化";     d7Detail = `仅${risingSecCount}个板块涨超1%，分化明显`; }
  else                          { d7Score = -5; d7Label = "独木难支"; d7Detail = `仅${risingSecCount}个板块涨超1%，${fallingSecCount}个板块跌超1%`; }
  if (fallingSecCount > risingSecCount * 2 && fallingSecCount > 20) { d7Score -= 5; d7Detail += "，板块普跌"; }
  dims.push({ name: "板块扩散", icon: "🌐", score: d7Score, label: d7Label, detail: d7Detail, color: d7Score > 0 ? "red" : d7Score < 0 ? "green" : "yellow" });
  total += d7Score;

  // --- 8. 指数共振（上证/深证/创业板方向是否一致） ---
  const sh = market.shIndex.changePercent;
  const sz = market.szIndex.changePercent;
  const cyb = market.cybIndex.changePercent;
  const allUp = sh > 0 && sz > 0 && cyb > 0;
  const allDown = sh < 0 && sz < 0 && cyb < 0;
  let d8Score = 0, d8Label = "", d8Detail = "";
  if (allUp && Math.min(sh, sz, cyb) > 1)   { d8Score = 10; d8Label = "齐涨共振"; d8Detail = "三大指数齐涨超1%，强共振"; }
  else if (allUp)                            { d8Score = 5;  d8Label = "齐涨";     d8Detail = "三大指数齐涨"; }
  else if (allDown && Math.max(sh, sz, cyb) < -1) { d8Score = -10; d8Label = "齐跌共振"; d8Detail = "三大指数齐跌超1%，弱共振"; }
  else if (allDown)                          { d8Score = -5; d8Label = "齐跌";     d8Detail = "三大指数齐跌"; }
  else { d8Score = 0; d8Label = "分化"; d8Detail = `沪${sh > 0 ? "+" : ""}${sh.toFixed(1)}% 深${sz > 0 ? "+" : ""}${sz.toFixed(1)}% 创${cyb > 0 ? "+" : ""}${cyb.toFixed(1)}%`; }
  dims.push({ name: "指数共振", icon: "📈", score: d8Score, label: d8Label, detail: d8Detail, color: d8Score > 0 ? "red" : d8Score < 0 ? "green" : "yellow" });
  total += d8Score;

  // 总分钳位
  total = Math.max(-100, Math.min(100, total));

  // 总情绪判定
  let sentiment: SentimentPanel["sentiment"];
  let sentimentEmoji: string;
  if (total >= 60)       { sentiment = "极度亢奋"; sentimentEmoji = "🚀"; }
  else if (total >= 35)  { sentiment = "亢奋";     sentimentEmoji = "🔥"; }
  else if (total >= 15)  { sentiment = "偏强";     sentimentEmoji = "😊"; }
  else if (total >= -15) { sentiment = "中性";     sentimentEmoji = "😐"; }
  else if (total >= -35) { sentiment = "偏弱";     sentimentEmoji = "😟"; }
  else if (total >= -60) { sentiment = "恐慌";     sentimentEmoji = "😰"; }
  else                   { sentiment = "极度恐慌"; sentimentEmoji = "😱"; }

  // 赚钱效应
  let moneyEffect: SentimentPanel["moneyEffect"];
  let moneyEffectDesc: string;
  const r5 = sd.rise5pct, f5 = sd.fall5pct;
  if (r5 > 200 && f5 < 30)      { moneyEffect = "赚钱效应爆棚"; moneyEffectDesc = `${r5}家涨超5%仅${f5}家跌超5%，遍地机会`; }
  else if (r5 > 100 && f5 < 80)  { moneyEffect = "赚钱效应好";   moneyEffectDesc = `${r5}家涨超5%，大多数人今天赚`; }
  else if (r5 > f5)              { moneyEffect = "赚钱效应一般"; moneyEffectDesc = `涨超5%有${r5}家，跌超5%有${f5}家`; }
  else if (f5 > 100)             { moneyEffect = "亏钱效应严重"; moneyEffectDesc = `${f5}家跌超5%！大面杀跌`; }
  else                           { moneyEffect = "亏钱效应";     moneyEffectDesc = `跌超5%的(${f5})多于涨超5%的(${r5})`; }

  // 情绪总结
  const summaryParts: string[] = [];
  summaryParts.push(`今日市场情绪${sentiment}（${total}分）`);
  const topDim = [...dims].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 3);
  for (const d of topDim) {
    summaryParts.push(`${d.name}${d.label}`);
  }
  summaryParts.push(moneyEffectDesc);
  if (sd.medianChange !== 0) {
    summaryParts.push(`全市场中位数${sd.medianChange > 0 ? "+" : ""}${sd.medianChange.toFixed(2)}%${sd.medianChange > 0 ? "，大部分人赚" : "，大部分人亏"}`);
  }

  return {
    sentiment,
    sentimentScore: total,
    sentimentEmoji,
    dimensions: dims,
    limitUp: sd.limitUp,
    limitDown: sd.limitDown,
    riseCount: sd.riseCount,
    fallCount: sd.fallCount,
    flatCount: sd.flatCount,
    rise5pct: sd.rise5pct,
    fall5pct: sd.fall5pct,
    rise7pct: sd.rise7pct,
    fall7pct: sd.fall7pct,
    avgChange: sd.avgChangePercent,
    medianChange: sd.medianChange,
    moneyEffect,
    moneyEffectDesc,
    maxGainStock: sd.maxGain,
    maxLossStock: sd.maxLoss,
    summary: summaryParts.join("。") + "。",
  };
}

// ==================== 板块评级 ====================

function gradeSector(sec: EnrichedSectorData, moneyFlow: SectorMoneyFlow | undefined): SectorReview {
  const inflow = moneyFlow ? moneyFlow.mainNetInflow / 1e8 : sec.mainNetInflow / 1e8;
  const inflowPct = moneyFlow ? moneyFlow.mainNetInflowPercent : sec.mainNetInflowPercent;

  // 动量判定
  let momentum: SectorReview["momentum"];
  if (sec.changePercent > 3) momentum = "加速";
  else if (sec.changePercent > 1) momentum = "启动";
  else if (sec.changePercent > -1) momentum = "震荡";
  else if (sec.changePercent > -3) momentum = "走弱";
  else momentum = "暴跌";

  // 资金方向
  let moneyDirection: SectorReview["moneyDirection"];
  if (inflow > 5) moneyDirection = "主力大幅流入";
  else if (inflow > 1) moneyDirection = "主力流入";
  else if (inflow > -1) moneyDirection = "中性";
  else if (inflow > -5) moneyDirection = "主力流出";
  else moneyDirection = "主力大幅流出";

  // 综合评分→等级
  let points = 0;
  // 涨跌幅贡献
  if (sec.changePercent > 3) points += 4;
  else if (sec.changePercent > 1.5) points += 3;
  else if (sec.changePercent > 0.5) points += 2;
  else if (sec.changePercent > -0.5) points += 1;
  else if (sec.changePercent > -1.5) points += 0;
  else if (sec.changePercent > -3) points -= 1;
  else points -= 2;

  // 资金贡献
  if (inflow > 5) points += 3;
  else if (inflow > 1) points += 2;
  else if (inflow > 0) points += 1;
  else if (inflow > -1) points += 0;
  else if (inflow > -5) points -= 1;
  else points -= 2;

  // 涨跌家数
  const riseR = sec.riseCount / Math.max(sec.riseCount + sec.fallCount, 1);
  if (riseR > 0.7) points += 2;
  else if (riseR > 0.55) points += 1;
  else if (riseR < 0.3) points -= 1;

  // 5日趋势
  if (sec.change5d > 5) points += 1;
  else if (sec.change5d < -5) points -= 1;

  let grade: SectorReview["grade"];
  if (points >= 7) grade = "S";
  else if (points >= 4) grade = "A";
  else if (points >= 1) grade = "B";
  else if (points >= -2) grade = "C";
  else grade = "D";

  // 标签
  let tag: string;
  if (grade === "S") tag = `🔥 ${sec.name}强势领涨，涨${sec.changePercent.toFixed(1)}%资金抢筹`;
  else if (grade === "A") tag = `📈 ${sec.name}表现优秀，量价配合良好`;
  else if (grade === "B") tag = `〰️ ${sec.name}中规中矩，关注后续方向`;
  else if (grade === "C") tag = `📉 ${sec.name}走势偏弱，注意风险`;
  else tag = `⚠️ ${sec.name}大幅下跌，规避`;

  // 明日展望
  let tomorrowOutlook: SectorReview["tomorrowOutlook"];
  let tomorrowReason: string;
  if (sec.changePercent > 2 && inflow > 2 && riseR > 0.6) {
    tomorrowOutlook = "看涨";
    tomorrowReason = `今日强势+资金流入${inflow.toFixed(1)}亿，惯性看涨`;
  } else if (sec.changePercent > 3 && sec.change5d > 8) {
    tomorrowOutlook = "震荡";
    tomorrowReason = `连续上涨后获利盘较大，可能震荡消化`;
  } else if (sec.changePercent < -2 && inflow < -2) {
    tomorrowOutlook = "看跌";
    tomorrowReason = `今日弱势+资金流出${Math.abs(inflow).toFixed(1)}亿，惯性看跌`;
  } else if (sec.changePercent < -2 && inflow > 0) {
    tomorrowOutlook = "震荡";
    tomorrowReason = `虽然下跌但有资金抄底，或有反弹`;
  } else {
    tomorrowOutlook = "震荡";
    tomorrowReason = "方向不明确，观察量能变化";
  }

  return {
    sector: sec.name,
    changePercent: sec.changePercent,
    amplitude: sec.amplitude,
    change5d: sec.change5d,
    mainNetInflow: Math.round(inflow * 100) / 100,
    mainNetInflowPercent: inflowPct,
    riseCount: sec.riseCount,
    fallCount: sec.fallCount,
    leadingStock: sec.leadingStock,
    leadingStockChange: sec.leadingStockChange,
    grade,
    tag,
    momentum,
    moneyDirection,
    tomorrowOutlook,
    tomorrowReason,
  };
}

// ==================== 明日前瞻 ====================

function generateTomorrowOutlook(
  sentimentScore: number,
  sectorReviews: SectorReview[],
  northbound3d: number,
  market: MarketOverview,
): { outlook: "看涨" | "看跌" | "震荡"; advice: string; focus: string[] } {
  const strongSectors = sectorReviews.filter(s => s.grade === "S" || s.grade === "A");
  const weakSectors = sectorReviews.filter(s => s.grade === "D");
  const moneyInSectors = sectorReviews.filter(s => s.mainNetInflow > 2).slice(0, 3);

  let outlook: "看涨" | "看跌" | "震荡";
  const adviceParts: string[] = [];
  const focus: string[] = [];

  if (sentimentScore >= 30 && strongSectors.length >= 3) {
    outlook = "看涨";
    adviceParts.push(`市场情绪偏强，${strongSectors.length}个板块表现优秀`);
    adviceParts.push("可适当加仓强势板块，关注板块轮动机会");
  } else if (sentimentScore <= -30 && weakSectors.length >= 3) {
    outlook = "看跌";
    adviceParts.push(`市场情绪偏弱，${weakSectors.length}个板块大幅下跌`);
    adviceParts.push("建议控制仓位，等待企稳信号");
  } else {
    outlook = "震荡";
    adviceParts.push("多空博弈，方向不明确");
    adviceParts.push("建议轻仓观望，关注量能变化和板块轮动");
  }

  if (northbound3d > 30e8) {
    adviceParts.push("北向资金持续流入提振信心");
  } else if (northbound3d < -30e8) {
    adviceParts.push("北向资金持续流出需警惕");
  }

  // 明日关注板块
  if (moneyInSectors.length > 0) {
    focus.push(...moneyInSectors.map(s => s.sector));
  }
  strongSectors.forEach(s => {
    if (!focus.includes(s.sector)) focus.push(s.sector);
  });
  // 超跌反弹
  const oversold = sectorReviews.filter(s => s.change5d < -8 && s.changePercent > 0 && s.mainNetInflow > 0);
  oversold.forEach(s => {
    if (!focus.includes(s.sector)) focus.push(s.sector);
    adviceParts.push(`${s.sector}超跌反弹+资金回流，可关注`);
  });

  return {
    outlook,
    advice: adviceParts.join("。"),
    focus: focus.slice(0, 6),
  };
}

// ==================== 总结生成 ====================

function generateSummary(
  marketReview: MarketReview,
  topGainers: SectorReview[],
  topLosers: SectorReview[],
  tomorrowOutlook: string,
): string {
  const sp = marketReview.sentimentPanel;
  const parts: string[] = [];

  // 大盘概况
  const avg = ((marketReview.shChange + marketReview.szChange + marketReview.cybChange) / 3);
  if (avg > 1) parts.push(`今日三大指数齐涨，${sp.sentiment}，${sp.moneyEffect}`);
  else if (avg > 0) parts.push(`今日大盘小幅上涨，${sp.sentiment}`);
  else if (avg > -1) parts.push(`今日大盘小幅下跌，${sp.sentiment}`);
  else parts.push(`今日大盘普跌，${sp.sentiment}，注意控制仓位`);

  // 赚钱效应
  parts.push(sp.moneyEffectDesc);

  // 成交额
  parts.push(marketReview.volumeComment);

  // 热点板块
  if (topGainers.length > 0) {
    const top = topGainers.slice(0, 3).map(s => `${s.sector}(+${s.changePercent.toFixed(1)}%)`);
    parts.push(`领涨板块：${top.join("、")}`);
  }

  // 资金流向
  if (marketReview.northboundToday > 0) {
    parts.push(`北向资金净流入${(marketReview.northboundToday / 1e8).toFixed(1)}亿`);
  } else if (marketReview.northboundToday < 0) {
    parts.push(`北向资金净流出${(Math.abs(marketReview.northboundToday) / 1e8).toFixed(1)}亿`);
  }

  // 明日展望简述
  parts.push(`明日展望${tomorrowOutlook}`);

  return parts.join("。") + "。";
}

// ==================== 主入口 ====================

export function generateDailyReview(
  market: MarketOverview,
  sectors: EnrichedSectorData[],
  moneyFlows: SectorMoneyFlow[],
  northbound: NorthboundFlow[],
  etfs: ETFData[],
  eventSummaries: SectorEventSummary[],
  topEvents: EventSignal[],
  sentimentData: MarketSentimentData,
): DailyReviewReport {
  // 当前日期
  const bj = new Date(Date.now() + (480 + new Date().getTimezoneOffset()) * 60000);
  const dateStr = `${bj.getFullYear()}-${String(bj.getMonth() + 1).padStart(2, "0")}-${String(bj.getDate()).padStart(2, "0")}`;

  // 两市成交额
  const totalAmount = market.shIndex.amount + market.szIndex.amount;

  // 北向资金
  const todayNB = northbound.length > 0 ? northbound[northbound.length - 1].total : 0;
  const nb3d = northbound.slice(-3).reduce((s, n) => s + n.total, 0);
  let nbTrend: string;
  if (nb3d > 30e8) nbTrend = "持续流入";
  else if (nb3d < -30e8) nbTrend = "持续流出";
  else nbTrend = "震荡";

  // 量能
  let volumeVsPrev: MarketReview["volumeVsPrev"] = "平量";
  let volumeComment = `两市成交${(totalAmount / 1e8).toFixed(0)}亿`;
  if (totalAmount > 1.2e12) { volumeVsPrev = "放量"; volumeComment += "，明显放量"; }
  else if (totalAmount > 9e11) { volumeVsPrev = "平量"; volumeComment += "，量能适中"; }
  else if (totalAmount > 6e11) { volumeVsPrev = "缩量"; volumeComment += "，略有缩量"; }
  else { volumeVsPrev = "缩量"; volumeComment += "，严重缩量，观望情绪浓厚"; }

  // 情绪多维分析
  const sentimentPanel = buildSentimentPanel(market, sentimentData, northbound, totalAmount, sectors);

  const marketReview: MarketReview = {
    shChange: market.shIndex.changePercent,
    szChange: market.szIndex.changePercent,
    cybChange: market.cybIndex.changePercent,
    totalAmount,
    sentimentPanel,
    northboundToday: todayNB,
    northbound3d: nb3d,
    northboundTrend: nbTrend,
    volumeVsPrev,
    volumeComment,
  };

  // 板块评级
  const moneyMap = new Map(moneyFlows.map(m => [m.name, m]));
  const sectorReviews = sectors.map(sec => gradeSector(sec, moneyMap.get(sec.name)));
  sectorReviews.sort((a, b) => b.changePercent - a.changePercent);

  const topGainers = sectorReviews.slice(0, 5);
  const topLosers = [...sectorReviews].sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
  const topMoneyIn = [...sectorReviews].sort((a, b) => b.mainNetInflow - a.mainNetInflow).slice(0, 5);
  const topMoneyOut = [...sectorReviews].sort((a, b) => a.mainNetInflow - b.mainNetInflow).slice(0, 5);

  // 热点事件（当日前10条）
  const hotEvents = topEvents.filter(e => e.weight >= 5).slice(0, 10);

  // 明日前瞻
  const { outlook: tomorrowOverall, advice: tomorrowAdvice, focus: tomorrowFocus } =
    generateTomorrowOutlook(sentimentPanel.sentimentScore, sectorReviews, nb3d, market);

  // 总结
  const summary = generateSummary(marketReview, topGainers, topLosers, tomorrowOverall);

  return {
    date: dateStr,
    marketReview,
    topGainers,
    topLosers,
    topMoneyIn,
    topMoneyOut,
    allSectors: sectorReviews,
    hotEvents,
    tomorrowOverall,
    tomorrowAdvice,
    tomorrowFocus,
    summary,
    timestamp: new Date().toISOString(),
  };
}
