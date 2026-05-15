// 综合板块分析引擎：美股隔夜 + 国际形势 → A股板块预判 + 收盘前风险提醒

import type { GlobalIndexData, ETFData, SectorData } from "./stock-api";
import type { PredictionResult } from "./predictor";

export type ActionAdvice = "加仓" | "减仓" | "持仓观望" | "逢低建仓" | "逢高减仓";
export type RiskLevel = "高风险" | "中风险" | "低风险";

export interface SectorForecast {
  sector: string;
  overallScore: number;          // -100 ~ 100
  riskLevel: RiskLevel;
  action: ActionAdvice;
  reasons: string[];
  globalImpact: string;          // 美股/国际对该板块的影响描述
  technicalSummary: string;      // 技术面总结
  etfPerformance: string;        // ETF 表现总结
  tomorrowOutlook: string;       // 明日展望
}

export interface DailyBriefing {
  timestamp: string;
  isBeforeClose: boolean;        // 是否为收盘前提醒
  marketSentiment: string;       // 市场整体情绪
  globalSummary: string;         // 全球市场概况
  sectorForecasts: SectorForecast[];
  keyRisks: string[];            // 全局风险提示
  keyOpportunities: string[];    // 全局机会提示
}

// 美股板块映射关系：美股哪些指数/走势影响A股哪些板块
const US_TO_A_SECTOR_MAP: Record<string, string[]> = {
  "NDX": ["科技", "半导体", "人工智能", "5G"],
  "DJIA": ["金融", "消费", "宽基"],
  "SPX": ["宽基", "金融", "消费"],
};

// 大宗商品/国际因素对板块的影响
const GLOBAL_FACTOR_MAP: Record<string, { sectors: string[]; direction: "positive" | "negative" }> = {
  "油价上涨": { sectors: ["周期", "能源"], direction: "positive" },
  "美元走强": { sectors: ["出口", "有色金属"], direction: "negative" },
  "黄金上涨": { sectors: ["有色金属", "周期"], direction: "positive" },
  "亚太市场走弱": { sectors: ["宽基", "金融"], direction: "negative" },
};

function getTimeInfo(): { hour: number; isTrading: boolean; isBeforeClose: boolean; isWeekday: boolean } {
  const now = new Date();
  // 北京时间 = UTC+8
  const utcHour = now.getUTCHours();
  const bjHour = (utcHour + 8) % 24;
  const bjMinute = now.getUTCMinutes();
  const day = now.getUTCDay();
  const isWeekday = day >= 1 && day <= 5;
  const timeNum = bjHour * 100 + bjMinute;
  const isTrading = isWeekday && ((timeNum >= 930 && timeNum <= 1130) || (timeNum >= 1300 && timeNum <= 1500));
  const isBeforeClose = isWeekday && (timeNum >= 1400 && timeNum <= 1500);

  return { hour: bjHour, isTrading, isBeforeClose, isWeekday };
}

// 分析美股隔夜对A股某板块的影响
function analyzeUSImpact(globalIndices: GlobalIndexData[], sector: string): { score: number; description: string } {
  let score = 0;
  const descriptions: string[] = [];

  // 找到美股三大指数
  const nasdaq = globalIndices.find(g => g.code === "NDX");
  const dow = globalIndices.find(g => g.code === "DJIA");
  const sp500 = globalIndices.find(g => g.code === "SPX");

  // 纳斯达克对科技板块影响最大
  if (nasdaq && ["科技"].includes(sector)) {
    const impact = nasdaq.changePercent * 3;  // 放大影响系数
    score += impact;
    if (nasdaq.changePercent > 1) {
      descriptions.push(`纳斯达克大涨${nasdaq.changePercent.toFixed(2)}%，利好科技板块`);
    } else if (nasdaq.changePercent < -1) {
      descriptions.push(`纳斯达克大跌${nasdaq.changePercent.toFixed(2)}%，科技板块承压`);
    } else {
      descriptions.push(`纳斯达克${nasdaq.changePercent >= 0 ? "微涨" : "微跌"}${Math.abs(nasdaq.changePercent).toFixed(2)}%，影响有限`);
    }
  }

  // 道琼斯对金融/消费影响较大
  if (dow && ["金融", "消费"].includes(sector)) {
    const impact = dow.changePercent * 2;
    score += impact;
    if (Math.abs(dow.changePercent) > 0.5) {
      descriptions.push(`道琼斯${dow.changePercent >= 0 ? "上涨" : "下跌"}${Math.abs(dow.changePercent).toFixed(2)}%，${dow.changePercent >= 0 ? "提振" : "拖累"}${sector}板块情绪`);
    }
  }

  // 标普500对所有板块的整体影响
  if (sp500) {
    const impact = sp500.changePercent * 1.5;
    score += impact;
    if (Math.abs(sp500.changePercent) > 1) {
      descriptions.push(`标普500${sp500.changePercent >= 0 ? "上涨" : "下跌"}${Math.abs(sp500.changePercent).toFixed(2)}%，对大盘情绪${sp500.changePercent >= 0 ? "偏正面" : "偏负面"}`);
    }
  }

  // 恒生指数对A股整体影响
  const hsi = globalIndices.find(g => g.code === "HSI");
  if (hsi && Math.abs(hsi.changePercent) > 0.8) {
    score += hsi.changePercent;
    descriptions.push(`恒生指数${hsi.changePercent >= 0 ? "上涨" : "下跌"}${Math.abs(hsi.changePercent).toFixed(2)}%`);
  }

  return {
    score: Math.max(-30, Math.min(30, score)),
    description: descriptions.length > 0 ? descriptions.join("；") : "隔夜外盘变化不大，影响有限",
  };
}

// 分析ETF在该板块的整体表现
function analyzeETFPerformance(etfs: ETFData[], sector: string): { score: number; description: string } {
  const sectorETFs = etfs.filter(e => e.sector === sector);
  if (sectorETFs.length === 0) return { score: 0, description: "暂无对应板块ETF数据" };

  const avgChange = sectorETFs.reduce((sum, e) => sum + e.changePercent, 0) / sectorETFs.length;
  const maxETF = sectorETFs.reduce((max, e) => e.changePercent > max.changePercent ? e : max);
  const minETF = sectorETFs.reduce((min, e) => e.changePercent < min.changePercent ? e : min);

  let score = avgChange * 5; // 放大为分数
  score = Math.max(-25, Math.min(25, score));

  const parts: string[] = [];
  parts.push(`板块ETF平均涨跌${avgChange >= 0 ? "+" : ""}${avgChange.toFixed(2)}%`);
  if (sectorETFs.length > 1) {
    parts.push(`领涨: ${maxETF.name}(${maxETF.changePercent >= 0 ? "+" : ""}${maxETF.changePercent.toFixed(2)}%)`);
    if (minETF.code !== maxETF.code) {
      parts.push(`领跌: ${minETF.name}(${minETF.changePercent >= 0 ? "+" : ""}${minETF.changePercent.toFixed(2)}%)`);
    }
  }

  return { score, description: parts.join("，") };
}

// 分析板块行情数据
function analyzeSectorData(sectors: SectorData[], sectorName: string): { score: number; description: string } {
  // 找到与该板块相关的行业
  const related = sectors.filter(s => s.name.includes(sectorName) || sectorName.includes(s.name));
  if (related.length === 0) return { score: 0, description: "暂无板块行情数据" };

  const best = related.reduce((max, s) => s.changePercent > max.changePercent ? s : max);
  const score = Math.max(-20, Math.min(20, best.changePercent * 5));

  const riseRatio = best.stockCount > 0 ? best.riseCount / best.stockCount : 0;
  let description = `${best.name}涨跌${best.changePercent >= 0 ? "+" : ""}${best.changePercent.toFixed(2)}%`;
  description += `，上涨${best.riseCount}家/下跌${best.fallCount}家(${(riseRatio * 100).toFixed(0)}%上涨)`;

  return { score, description };
}

// 生成操作建议
function getActionAdvice(score: number, riskLevel: RiskLevel): ActionAdvice {
  if (score >= 35) return "加仓";
  if (score >= 15) return "逢低建仓";
  if (score <= -35) return "减仓";
  if (score <= -15) return "逢高减仓";
  return "持仓观望";
}

function getRiskLevel(score: number, volatility: number): RiskLevel {
  const absScore = Math.abs(score);
  if (absScore > 40 || volatility > 3) return "高风险";
  if (absScore > 20 || volatility > 1.5) return "中风险";
  return "低风险";
}

// 主分析函数
export function generateDailyBriefing(
  globalIndices: GlobalIndexData[],
  etfs: ETFData[],
  sectors: SectorData[],
  etfPredictions: Record<string, { prediction: PredictionResult; lastPrice: number }>
): DailyBriefing {
  const timeInfo = getTimeInfo();
  const sectorNames = ["科技", "消费", "金融", "医药", "周期", "宽基"];

  // 全球市场概况
  const usIndices = globalIndices.filter(g => ["DJIA", "NDX", "SPX"].includes(g.code));
  const usAvgChange = usIndices.length > 0
    ? usIndices.reduce((s, i) => s + i.changePercent, 0) / usIndices.length
    : 0;

  let marketSentiment: string;
  if (usAvgChange > 1) marketSentiment = "偏乐观 — 隔夜美股大涨，市场情绪回暖";
  else if (usAvgChange > 0.3) marketSentiment = "谨慎乐观 — 隔夜外盘微涨，情绪偏暖";
  else if (usAvgChange > -0.3) marketSentiment = "中性震荡 — 隔夜外盘波动不大";
  else if (usAvgChange > -1) marketSentiment = "偏谨慎 — 隔夜美股走弱，注意风险";
  else marketSentiment = "偏悲观 — 隔夜美股大跌，市场承压明显";

  const globalParts: string[] = [];
  for (const idx of globalIndices) {
    if (idx.price > 0) {
      globalParts.push(`${idx.name} ${idx.changePercent >= 0 ? "+" : ""}${idx.changePercent.toFixed(2)}%`);
    }
  }

  const sectorForecasts: SectorForecast[] = sectorNames.map(sector => {
    const usImpact = analyzeUSImpact(globalIndices, sector);
    const etfPerf = analyzeETFPerformance(etfs, sector);
    const sectorPerf = analyzeSectorData(sectors, sector);

    // 技术面分析（基于该板块下ETF的预测结果）
    let techScore = 0;
    let techSummary = "";
    const sectorPredictions = Object.entries(etfPredictions)
      .filter(([code]) => {
        const etf = etfs.find(e => e.code === code);
        return etf?.sector === sector;
      })
      .map(([, v]) => v.prediction);

    if (sectorPredictions.length > 0) {
      techScore = sectorPredictions.reduce((s, p) => s + p.score, 0) / sectorPredictions.length;
      const signals = sectorPredictions.map(p => p.signal);
      const bullish = signals.filter(s => s.includes("看涨")).length;
      const bearish = signals.filter(s => s.includes("看跌")).length;
      techSummary = `${sectorPredictions.length}只ETF技术分析: ${bullish}只看涨, ${bearish}只看跌, ${sectorPredictions.length - bullish - bearish}只中性`;
    } else {
      techSummary = "暂无技术面数据";
    }

    // 综合评分
    const overallScore = Math.max(-100, Math.min(100, Math.round(
      usImpact.score * 0.3 +
      etfPerf.score * 0.3 +
      sectorPerf.score * 0.2 +
      techScore * 0.2
    )));

    const avgETFChange = etfs.filter(e => e.sector === sector)
      .reduce((s, e) => s + Math.abs(e.changePercent), 0) / Math.max(1, etfs.filter(e => e.sector === sector).length);

    const riskLevel = getRiskLevel(overallScore, avgETFChange);
    const action = getActionAdvice(overallScore, riskLevel);

    // 收集原因
    const reasons: string[] = [];
    if (usImpact.description) reasons.push(usImpact.description);
    if (etfPerf.description) reasons.push(etfPerf.description);
    if (sectorPerf.description) reasons.push(sectorPerf.description);

    // 明日展望
    let tomorrowOutlook: string;
    if (overallScore > 25) {
      tomorrowOutlook = `${sector}板块多重利好共振，明日有望延续强势，可积极关注`;
    } else if (overallScore > 10) {
      tomorrowOutlook = `${sector}板块偏暖，明日大概率小幅震荡上行，逢低可适当参与`;
    } else if (overallScore > -10) {
      tomorrowOutlook = `${sector}板块多空交织，明日预计以震荡为主，建议观望为主`;
    } else if (overallScore > -25) {
      tomorrowOutlook = `${sector}板块偏弱，明日可能延续调整，注意控制仓位`;
    } else {
      tomorrowOutlook = `${sector}板块面临较大压力，明日风险偏大，建议减仓规避`;
    }

    return {
      sector,
      overallScore,
      riskLevel,
      action,
      reasons,
      globalImpact: usImpact.description,
      technicalSummary: techSummary,
      etfPerformance: etfPerf.description,
      tomorrowOutlook,
    };
  });

  // 全局风险与机会
  const keyRisks: string[] = [];
  const keyOpportunities: string[] = [];

  if (usAvgChange < -1.5) keyRisks.push("隔夜美股暴跌，A股开盘可能低开");
  if (usAvgChange < -0.5) keyRisks.push("外盘走弱，市场情绪可能受到压制");

  const highRiskSectors = sectorForecasts.filter(s => s.riskLevel === "高风险" && s.overallScore < 0);
  if (highRiskSectors.length > 0) {
    keyRisks.push(`${highRiskSectors.map(s => s.sector).join("、")}板块风险较高，注意规避`);
  }

  if (usAvgChange > 1.5) keyOpportunities.push("隔夜美股大涨，A股开盘有望高开");
  const strongSectors = sectorForecasts.filter(s => s.overallScore > 20);
  if (strongSectors.length > 0) {
    keyOpportunities.push(`${strongSectors.map(s => s.sector).join("、")}板块表现较强，可重点关注`);
  }

  if (timeInfo.isBeforeClose) {
    keyRisks.push("临近收盘，注意控制隔夜持仓风险");
    const volatileSectors = sectorForecasts.filter(s => s.riskLevel === "高风险");
    if (volatileSectors.length > 0) {
      keyRisks.push(`${volatileSectors.map(s => s.sector).join("、")}板块波动较大，建议收盘前适当降低仓位`);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    isBeforeClose: timeInfo.isBeforeClose,
    marketSentiment,
    globalSummary: globalParts.join(" | "),
    sectorForecasts,
    keyRisks: keyRisks.length > 0 ? keyRisks : ["当前暂无明显风险信号"],
    keyOpportunities: keyOpportunities.length > 0 ? keyOpportunities : ["市场处于均衡态，等待方向信号"],
  };
}
