/**
 * 市场情绪 + 事件驱动 + 公司快析 综合引擎
 *
 * 目标：在超短线引擎之前，先回答三个问题：
 *   1. 今天适不适合做短线？（风向标）
 *   2. 市场在炒什么？（事件热度图谱）
 *   3. 这只票有没有暗雷？（公司风控快析）
 *
 * 最终输出一个 EarlyBirdSignal —— 综合所有维度后的"早期启动"评分
 */

import {
  fetchMarketBreadth, fetchNorthboundFlow, fetchMarginData,
  fetchMarketOverview, fetchSectorMoneyFlow, fetchMarketSentimentData,
  type MarketBreadthData,
} from "./stock-api";
import { analyzeEvents, type EventAnalysis, type SectorEventSummary } from "./event-driven";
import type { LimitUpQuality } from "./limitup-quality";
import type { ScalpConfig } from "./scalp-engine";

// ================================================================
//  类型定义
// ================================================================

/** 市场风向标：综合环境评估（-100 极度恶劣 ~ 100 极度乐观） */
export interface MarketWindVane {
  score: number;
  label: "极度乐观" | "偏暖" | "中性" | "偏冷" | "极度恶劣";
  // 子维度
  breadth: { score: number; detail: string };      // 市场广度
  capitalFlow: { score: number; detail: string };   // 资金流向
  sentiment: { score: number; detail: string };     // 情绪温度
  volatility: { score: number; detail: string };    // 波动率环境
  sectorHeat: { top3: string[]; bottom3: string[] }; // 板块热度排名
  windEvents: string[];  // 核心风向驱动事件（最多3条）
}

/** 事件热度图谱：按板块/概念聚合的事件影响力 */
export interface EventHeatMap {
  hotSectors: EventSectorHeat[];        // 事件热度最高的板块（利好为主）
  coldSectors: EventSectorHeat[];       // 事件冲击最大的板块（利空为主）
  topCatalysts: EventCatalyst[];        // 最重磅的催化事件
  eventClusterScore: number;            // 事件聚集度（高=有明确主线，低=散乱）
}

export interface EventSectorHeat {
  sector: string;
  netImpact: number;           // 净影响 -100~100
  bullCount: number;
  bearCount: number;
  topEvent: string;            // 最高权重事件标题
  momentum: "升温" | "持续" | "降温" | "初现";
}

export interface EventCatalyst {
  title: string;
  category: string;
  sectors: string[];
  impact: "利好" | "利空" | "关注";
  weight: number;
  freshness: number;           // 0-1，越新越高
  amplifiedBy: string[];       // 被哪些其他事件强化
}

/** 公司快析：单只股票的多维度风险评估 */
export interface CompanyQuickAnalysis {
  code: string;
  name: string;
  // 基本面快照
  fundamentals: {
    marketCap: number;          // 市值（亿）
    pe: number;                 // 市盈率
    turnoverRate: number;       // 换手率
    amount: number;             // 成交额
    sector: string;             // 所属板块
    sectorRank: number;         // 板块内涨幅排名
  };
  // 事件关联
  eventExposure: {
    relatedEvents: string[];    // 关联的事件
    sectorSentiment: number;    // 所在板块事件净影响 -100~100
    sectorMomentum: number;     // 板块日内动量
  };
  // 风控检查
  riskFlags: RiskFlag[];
  riskScore: number;            // 0-100，越高越危险
  safeToTrade: boolean;         // 综合判断是否适合交易
}

export interface RiskFlag {
  type: "流动性风险" | "估值风险" | "事件风险" | "板块风险" | "异常波动";
  severity: "低" | "中" | "高" | "禁止";
  detail: string;
}

/** 早期启动信号：综合评分后的输出 */
export interface EarlyBirdSignal {
  code: string;
  name: string;
  totalScore: number;           // 综合评分 0-100
  level: "强烈推荐" | "推荐" | "关注" | "观望" | "回避";
  // 各维度得分
  scalpScore: number;           // 超短线技术得分（来自 scalp-engine）
  sentimentScore: number;       // 市场环境得分
  eventScore: number;           // 事件催化得分
  companyScore: number;         // 公司基本面/风控得分（负数=扣分）
  // 信号详情
  catalyst: string;             // 核心催化逻辑（一句话）
  riskWarnings: string[];       // 风险提示
  entryWindow: string;          // 建议入场窗口（如"竞价9:25-9:30"）
  confidenceFactors: string[];  // 信心来源
  detectedAt: string;
}

// ================================================================
//  默认阈值（可通过 ScalpConfig 覆盖）
// ================================================================

export interface SentimentConfig {
  wind: {
    breadthWeight: number;      // 广度权重 0-1
    capitalWeight: number;      // 资金权重
    sentimentWeight: number;    // 情绪权重
    volatilityWeight: number;   // 波动率权重
  };
  event: {
    freshnessHalfLife: number;  // 事件时效半衰期（小时）
    clusterThreshold: number;   // 事件聚集阈值
    maxCatalysts: number;       // 最多保留催化事件数
  };
  company: {
    minMarketCapYi: number;     // 最小时值（亿）
    maxTurnoverRate: number;    // 最大换手率（异常放量）
    minTurnoverRate: number;    // 最小换手率（无人问津）
    maxPE: number;              // 最大市盈率
    sectorConcentrationLimit: number; // 板块集中度上限
  };
}

export const DEFAULT_SENTIMENT_CONFIG: SentimentConfig = {
  wind: {
    breadthWeight: 0.25,
    capitalWeight: 0.30,
    sentimentWeight: 0.25,
    volatilityWeight: 0.20,
  },
  event: {
    freshnessHalfLife: 4,
    clusterThreshold: 3,
    maxCatalysts: 5,
  },
  company: {
    minMarketCapYi: 10,
    maxTurnoverRate: 25,
    minTurnoverRate: 1,
    maxPE: 500,
    sectorConcentrationLimit: 40,
  },
};

// ================================================================
//  1. 市场风向标
// ================================================================

export async function assessMarketWind(
  config: SentimentConfig = DEFAULT_SENTIMENT_CONFIG,
): Promise<MarketWindVane> {
  const { wind: W } = config;

  const [breadth, northbound, margin, overview, sectorFlow, sentiment] = await Promise.all([
    fetchMarketBreadth().catch(() => null),
    fetchNorthboundFlow(5).catch(() => []),
    fetchMarginData(5).catch(() => []),
    fetchMarketOverview().catch(() => null),
    fetchSectorMoneyFlow().catch(() => []),
    fetchMarketSentimentData().catch(() => null),
  ]);

  // --- 广度评分 ---
  let breadthScore = 0;
  const breadthDetails: string[] = [];
  if (breadth) {
    // 涨停/跌停比
    if (breadth.limitUp >= 80) { breadthScore += 30; breadthDetails.push(`${breadth.limitUp}家涨停`); }
    else if (breadth.limitUp >= 50) { breadthScore += 20; }
    else if (breadth.limitUp >= 30) { breadthScore += 10; }
    else { breadthScore -= 5; }
    if (breadth.limitDown >= 30) { breadthScore -= 15; breadthDetails.push(`${breadth.limitDown}家跌停`); }
    else if (breadth.limitDown >= 10) { breadthScore -= 8; }
    // 涨跌比
    if (breadth.upDownRatio >= 3) { breadthScore += 15; breadthDetails.push("普涨"); }
    else if (breadth.upDownRatio >= 1.5) { breadthScore += 8; }
    else if (breadth.upDownRatio < 0.5) { breadthScore -= 10; breadthDetails.push("普跌"); }
    // 强势股占比
    if (breadth.strongStockRatio >= 40) { breadthScore += 10; }
    else if (breadth.strongStockRatio < 10) { breadthScore -= 8; }
    // 连板高度
    if (breadth.maxContinuousBoard >= 5) { breadthScore += 10; breadthDetails.push(`最高${breadth.maxContinuousBoard}连板`); }
    else if (breadth.maxContinuousBoard >= 3) { breadthScore += 5; }
  } else {
    breadthScore = 0;
    breadthDetails.push("数据缺失");
  }
  breadthScore = clamp(breadthScore, -20, 40);

  // --- 资金流向评分 ---
  let capitalScore = 0;
  const capitalDetails: string[] = [];
  // 北向资金
  if (northbound.length > 0) {
    const todayNB = northbound[northbound.length - 1];
    const nbYi = todayNB.total / 10000;
    if (nbYi > 50) { capitalScore += 25; capitalDetails.push(`北向大幅流入${nbYi.toFixed(0)}亿`); }
    else if (nbYi > 20) { capitalScore += 15; }
    else if (nbYi > 0) { capitalScore += 5; }
    else if (nbYi < -50) { capitalScore -= 20; capitalDetails.push(`北向大幅流出${Math.abs(nbYi).toFixed(0)}亿`); }
    else if (nbYi < -20) { capitalScore -= 10; }
  }
  // 融资余额趋势
  if (margin.length >= 3) {
    const recent3 = margin.slice(-3);
    const marginChange = recent3[recent3.length - 1].marginBalance - recent3[0].marginBalance;
    if (marginChange > 100) { capitalScore += 15; capitalDetails.push("融资加仓"); }
    else if (marginChange < -100) { capitalScore -= 10; capitalDetails.push("融资降杠杆"); }
  }
  // 市场成交额分位
  if (breadth) {
    if (breadth.amountPercentile >= 80) { capitalScore += 10; }
    else if (breadth.amountPercentile <= 20) { capitalScore -= 8; capitalDetails.push("量能极度萎缩"); }
  }
  capitalScore = clamp(capitalScore, -25, 40);

  // --- 情绪温度 ---
  let sentimentScore = 0;
  const sentimentDetails: string[] = [];
  if (breadth) {
    sentimentScore += breadth.sentimentScore / 5; // -100~100 → -20~20
  }
  if (sentiment) {
    if (sentiment.limitUp >= 80) { sentimentDetails.push("情绪亢奋"); }
    if (sentiment.fall5pct >= 500) { sentimentScore -= 5; sentimentDetails.push("恐慌蔓延"); }
  }
  sentimentScore = clamp(sentimentScore, -20, 30);

  // --- 波动率环境 ---
  let volatilityScore = 0;
  const volatilityDetails: string[] = [];
  if (overview) {
    const shChange = Math.abs(overview.shIndex.changePercent);
    const szChange = Math.abs(overview.szIndex.changePercent);
    const avgChange = (shChange + szChange) / 2;
    if (avgChange > 3) { volatilityScore -= 10; volatilityDetails.push(`指数剧烈波动${avgChange.toFixed(1)}%`); }
    else if (avgChange > 1.5) { volatilityScore -= 3; }
    else if (avgChange < 0.3) { volatilityScore += 5; volatilityDetails.push("波动收敛"); }
    if (overview.shIndex.changePercent * overview.szIndex.changePercent < 0) {
      volatilityScore -= 8; volatilityDetails.push("指数分化");
    }
  }
  volatilityScore = clamp(volatilityScore, -15, 10);

  // --- 板块热度 ---
  const top3: string[] = [];
  const bottom3: string[] = [];
  if (sectorFlow.length >= 6) {
    const sorted = [...sectorFlow].sort((a, b) => b.mainNetInflow - a.mainNetInflow);
    top3.push(...sorted.slice(0, 3).map(s => s.name));
    bottom3.push(...sorted.slice(-3).reverse().map(s => s.name));
  }

  // --- 加权总分 ---
  const totalScore = Math.round(
    breadthScore * W.breadthWeight +
    capitalScore * W.capitalWeight +
    sentimentScore * W.sentimentWeight +
    volatilityScore * W.volatilityWeight
  );

  const label: MarketWindVane["label"] =
    totalScore >= 25 ? "极度乐观" :
    totalScore >= 5 ? "偏暖" :
    totalScore >= -5 ? "中性" :
    totalScore >= -20 ? "偏冷" : "极度恶劣";

  const windEvents: string[] = [
    ...breadthDetails,
    ...capitalDetails,
    ...sentimentDetails,
    ...volatilityDetails,
  ].slice(0, 3);

  return {
    score: totalScore,
    label,
    breadth: { score: breadthScore, detail: breadthDetails.join(" | ") || "正常" },
    capitalFlow: { score: capitalScore, detail: capitalDetails.join(" | ") || "正常" },
    sentiment: { score: sentimentScore, detail: sentimentDetails.join(" | ") || "正常" },
    volatility: { score: volatilityScore, detail: volatilityDetails.join(" | ") || "正常" },
    sectorHeat: { top3, bottom3 },
    windEvents,
  };
}

// ================================================================
//  2. 事件热度图谱 + 催化事件识别
// ================================================================

export async function buildEventHeatMap(
  eventAnalysis: EventAnalysis,
  config: SentimentConfig = DEFAULT_SENTIMENT_CONFIG,
): Promise<EventHeatMap> {
  const { event: E } = config;
  const now = Date.now();

  // 计算事件新鲜度
  function calcFreshness(eventTime: string): number {
    try {
      const t = new Date(eventTime).getTime();
      const hoursAgo = (now - t) / 3600000;
      return Math.exp(-hoursAgo / E.freshnessHalfLife); // 指数衰减
    } catch { return 0.5; }
  }

  // 按板块汇总影响力
  const sectorMap = new Map<string, {
    bullWeight: number; bearWeight: number;
    bullCount: number; bearCount: number;
    topEvent: string; topWeight: number;
    events: { title: string; fresh: number; weight: number; impact: string }[];
  }>();

  for (const ev of eventAnalysis.events) {
    const fresh = calcFreshness(ev.time);
    const adjustedWeight = ev.weight * fresh;
    for (const sector of ev.sectors) {
      const entry = sectorMap.get(sector) || {
        bullWeight: 0, bearWeight: 0, bullCount: 0, bearCount: 0,
        topEvent: "", topWeight: 0, events: [],
      };
      if (ev.impact === "利好") { entry.bullWeight += adjustedWeight; entry.bullCount++; }
      else if (ev.impact === "利空") { entry.bearWeight += adjustedWeight; entry.bearCount++; }
      if (ev.weight > entry.topWeight) { entry.topEvent = ev.title; entry.topWeight = ev.weight; }
      entry.events.push({ title: ev.title, fresh, weight: ev.weight, impact: ev.impact });
      sectorMap.set(sector, entry);
    }
  }

  // 转换为热度排名
  const hotSectors: EventSectorHeat[] = [];
  const coldSectors: EventSectorHeat[] = [];

  for (const [sector, data] of sectorMap) {
    const netImpact = Math.round(clamp(data.bullWeight * 7 - data.bearWeight * 7, -100, 100));
    const item: EventSectorHeat = {
      sector,
      netImpact,
      bullCount: data.bullCount,
      bearCount: data.bearCount,
      topEvent: data.topEvent,
      momentum: data.bullCount >= 3 ? "持续" : data.bullCount >= 1 ? "初现" : "降温",
    };
    if (netImpact >= 10) hotSectors.push(item);
    else if (netImpact <= -10) coldSectors.push(item);
  }
  hotSectors.sort((a, b) => b.netImpact - a.netImpact);
  coldSectors.sort((a, b) => a.netImpact - b.netImpact);

  // Top 催化事件（带新鲜度+聚集强化）
  const scoredEvents = eventAnalysis.topEvents.map(ev => {
    const fresh = calcFreshness(ev.time);
    // 检查该事件涉及的板块有多少也有其他事件（聚集效应）
    const amplifiedBy: string[] = [];
    for (const sector of ev.sectors) {
      const se = sectorMap.get(sector);
      if (se && se.events.length >= E.clusterThreshold) {
        amplifiedBy.push(sector);
      }
    }
    return {
      title: ev.title,
      category: ev.category,
      sectors: ev.sectors,
      impact: ev.impact,
      weight: ev.weight,
      freshness: Math.round(fresh * 100) / 100,
      amplifiedBy,
    };
  });

  // 聚集度评分
  const clusterScore = hotSectors.length >= 3 && hotSectors[0].netImpact >= 40
    ? 80 : hotSectors.length >= 2 ? 50 : 20;

  return {
    hotSectors: hotSectors.slice(0, 8),
    coldSectors: coldSectors.slice(0, 5),
    topCatalysts: scoredEvents.slice(0, E.maxCatalysts),
    eventClusterScore: clusterScore,
  };
}

// ================================================================
//  3. 问题股黑名单检测 + 公司快析（多维度风控）
// ================================================================

/** 问题股检测结果 */
export interface ProblemStockFlag {
  code: string;
  name: string;
  blocked: boolean;             // true = 绝对禁止交易
  severity: "禁止" | "高危" | "警告" | "关注";
  flags: ProblemFlagDetail[];
  totalRiskScore: number;       // 0-100
}

interface ProblemFlagDetail {
  category: "退市风险" | "监管处罚" | "财务暴雷" | "异常交易" | "信息披露" | "股东风险" | "基本面恶化";
  detail: string;
  severity: "禁止" | "高危" | "警告";
}

// ---- 名称模式黑名单 ----
const NAME_BLACKLIST_PATTERNS: { pattern: RegExp; reason: string; severity: ProblemFlagDetail["severity"] }[] = [
  { pattern: /\*ST|^ST/, reason: "ST/*ST股，退市风险警示", severity: "禁止" },
  { pattern: /退$|退市/, reason: "已进入退市整理期", severity: "禁止" },
  { pattern: /^PT/, reason: "特别转让股，流动性极差", severity: "禁止" },
  { pattern: /^N(?![\u4e00-\u9fa5])/, reason: "新股首日，无历史数据风险不可控", severity: "高危" },
  { pattern: /^C(?![\u4e00-\u9fa5])/, reason: "次新股前5日，波动剧烈", severity: "高危" },
];

// ---- 代码段黑名单（财务暴雷/退市风险板块） ----
const CODE_PREFIX_BLACKLIST: { prefix: string; reason: string }[] = [
  // 400开头是老三板退市股
];

// ---- 问题股关键词（从名称/新闻中检测） ----
const PROBLEM_KEYWORDS: { keywords: string[]; category: ProblemFlagDetail["category"]; severity: ProblemFlagDetail["severity"] }[] = [
  // 退市风险
  { keywords: ["退市风险", "终止上市", "暂停上市", "强制退市", "面值退市"], category: "退市风险", severity: "禁止" },
  // 监管处罚
  { keywords: ["立案调查", "证监会立案", "涉嫌信息披露违法违规", "涉嫌操纵市场", "涉嫌内幕交易"], category: "监管处罚", severity: "禁止" },
  { keywords: ["行政处罚决定书", "市场禁入", "罚款", "没收违法所得"], category: "监管处罚", severity: "高危" },
  { keywords: ["问询函", "关注函", "监管函", "警示函", "责令改正"], category: "监管处罚", severity: "警告" },
  // 财务暴雷
  { keywords: ["财务造假", "虚增收入", "虚增利润", "审计非标意见", "无法表示意见", "否定意见"], category: "财务暴雷", severity: "禁止" },
  { keywords: ["业绩预告大幅修正", "业绩变脸", "商誉减值", "巨额亏损", "资不抵债", "净资产为负"], category: "财务暴雷", severity: "高危" },
  { keywords: ["业绩预亏", "业绩大幅下滑", "营收下滑", "毛利率下滑", "经营性现金流为负"], category: "财务暴雷", severity: "警告" },
  // 股东风险
  { keywords: ["大股东减持", "控股股东减持", "清仓式减持", "减持预披露"], category: "股东风险", severity: "警告" },
  { keywords: ["股权质押爆仓", "质押平仓", "强制平仓", "控股股东股份被冻结"], category: "股东风险", severity: "高危" },
  { keywords: ["实际控制人被", "董事长被", "高管被"], category: "股东风险", severity: "高危" },
  // 异常交易
  { keywords: ["连续跌停", "一字跌停", "闪崩", "天地板", "地天板"], category: "异常交易", severity: "高危" },
  { keywords: ["异常波动公告", "股票交易异常波动"], category: "异常交易", severity: "警告" },
  // 信息披露
  { keywords: ["信息披露违规", "信披违规", "未及时披露", "重大遗漏", "虚假记载", "误导性陈述"], category: "信息披露", severity: "高危" },
  { keywords: ["延迟披露", "年报延期", "无法按期披露"], category: "信息披露", severity: "警告" },
  // 基本面恶化
  { keywords: ["连续亏损", "持续亏损", "扣非净利润为负", "主营业务萎缩", "负债率过高"], category: "基本面恶化", severity: "警告" },
  { keywords: ["债务违约", "债券违约", "贷款逾期", "资金链断裂"], category: "基本面恶化", severity: "禁止" },
];

/**
 * 检测问题股——所有分析的第一个关口
 * 返回 blocked=true 的股票绝对不能买
 */
export function detectProblemStock(
  code: string,
  name: string,
  extraData?: {
    news?: string[];             // 最近新闻标题
    changePercent?: number;      // 当日涨跌
    consecutiveLimitDown?: number; // 连续跌停数
    marketCap?: number;
    pe?: number;
  },
): ProblemStockFlag {
  const flags: ProblemFlagDetail[] = [];

  // 1. 名称模式匹配
  for (const rule of NAME_BLACKLIST_PATTERNS) {
    if (rule.pattern.test(name)) {
      flags.push({ category: "退市风险", detail: rule.reason, severity: rule.severity });
    }
  }

  // 2. 从新闻中检测问题关键词
  if (extraData?.news) {
    for (const newsItem of extraData.news) {
      for (const rule of PROBLEM_KEYWORDS) {
        for (const kw of rule.keywords) {
          if (newsItem.includes(kw)) {
            flags.push({
              category: rule.category,
              detail: `新闻提及: "${newsItem.substring(0, 50)}"`,
              severity: rule.severity,
            });
            break; // 同一规则只触发一次
          }
        }
      }
    }
  }

  // 3. 交易数据分析
  if (extraData?.consecutiveLimitDown != null && extraData.consecutiveLimitDown >= 1) {
    flags.push({
      category: "异常交易",
      detail: `连续${extraData.consecutiveLimitDown}个跌停，有未消化利空`,
      severity: extraData.consecutiveLimitDown >= 2 ? "禁止" : "高危",
    });
  }

  if (extraData?.changePercent != null && extraData.changePercent <= -9) {
    flags.push({
      category: "异常交易",
      detail: `今日${extraData.changePercent.toFixed(1)}%接近跌停`,
      severity: "高危",
    });
  }

  // 4. 基本面红标
  if (extraData?.pe != null && extraData.pe < 0) {
    flags.push({
      category: "基本面恶化",
      detail: `PE为负(${extraData.pe.toFixed(1)})，公司亏损`,
      severity: "警告",
    });
  }

  // 去重
  const seen = new Set<string>();
  const uniqueFlags = flags.filter(f => {
    const key = `${f.category}:${f.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 综合判定
  const hasBlock = uniqueFlags.some(f => f.severity === "禁止");
  const hasHighRisk = uniqueFlags.some(f => f.severity === "高危");
  const severity: ProblemStockFlag["severity"] = hasBlock ? "禁止" : hasHighRisk ? "高危"
    : uniqueFlags.length >= 2 ? "警告" : uniqueFlags.length > 0 ? "关注" : "警告";

  const riskScore = Math.min(100,
    uniqueFlags.filter(f => f.severity === "禁止").length * 40 +
    uniqueFlags.filter(f => f.severity === "高危").length * 25 +
    uniqueFlags.filter(f => f.severity === "警告").length * 10
  );

  return {
    code, name,
    blocked: hasBlock || hasHighRisk,
    severity,
    flags: uniqueFlags,
    totalRiskScore: riskScore,
  };
}

// ---- 原有公司快析（增强版） ----

/**
 * 公司基本面 + 交易面快速风险评估
 * blocked=true = 禁止交易，后续所有环节跳过
 */
export function quickCompanyAnalysis(
  code: string,
  name: string,
  data: {
    marketCap?: number;
    pe?: number;
    turnoverRate: number;
    amount: number;
    changePercent: number;
    sector?: string;
    sectorChangePercent?: number;
    isST?: boolean;
    consecutiveLimitUp?: number;
    consecutiveLimitDown?: number;
    high?: number;
    low?: number;
    prevClose?: number;
    news?: string[];
  },
  heatMap?: EventHeatMap,
  config: SentimentConfig = DEFAULT_SENTIMENT_CONFIG,
): CompanyQuickAnalysis & { blocked: boolean; blockReason: string } {
  // === 第一关：问题股黑名单检测（绝对禁止） ===
  const problemCheck = detectProblemStock(code, name, {
    news: data.news,
    changePercent: data.changePercent,
    consecutiveLimitDown: data.consecutiveLimitDown,
    marketCap: data.marketCap,
    pe: data.pe,
  });

  if (problemCheck.blocked) {
    return {
      code, name,
      blocked: true,
      blockReason: problemCheck.flags.map(f => `[${f.severity}] ${f.detail}`).join("；"),
      fundamentals: { marketCap: data.marketCap ?? 0, pe: data.pe ?? 0, turnoverRate: data.turnoverRate, amount: data.amount, sector: data.sector ?? "未知", sectorRank: 99 },
      eventExposure: { relatedEvents: [], sectorSentiment: 0, sectorMomentum: 0 },
      riskFlags: problemCheck.flags.map(f => ({ type: f.category as any, severity: f.severity === "禁止" ? "禁止" : f.severity === "高危" ? "高" : "中", detail: f.detail })),
      riskScore: Math.max(80, problemCheck.totalRiskScore),
      safeToTrade: false,
    };
  }

  const C = config.company;
  const riskFlags: RiskFlag[] = [];
  let riskScore = problemCheck.totalRiskScore; // 继承黑名单检测的风险分

  // 问题股标记同步到 riskFlags
  for (const f of problemCheck.flags) {
    riskFlags.push({
      type: f.category as any,
      severity: f.severity === "禁止" ? "禁止" : f.severity === "高危" ? "高" : "中",
      detail: f.detail,
    });
  }

  // 1. 流动性风险
  if (data.amount < 50_000_000) {
    riskFlags.push({ type: "流动性风险", severity: "高", detail: `成交额仅${(data.amount / 10000).toFixed(0)}万，流动性差` });
    riskScore += 25;
  } else if (data.amount < 100_000_000) {
    riskFlags.push({ type: "流动性风险", severity: "中", detail: `成交额${(data.amount / 100000000).toFixed(1)}亿，偏低` });
    riskScore += 10;
  }

  if (data.turnoverRate < C.minTurnoverRate) {
    riskFlags.push({ type: "流动性风险", severity: "中", detail: `换手率${data.turnoverRate.toFixed(1)}%极低，无人关注` });
    riskScore += 15;
  }
  if (data.turnoverRate > C.maxTurnoverRate) {
    riskFlags.push({ type: "异常波动", severity: "中", detail: `换手率${data.turnoverRate.toFixed(1)}%异常偏高` });
    riskScore += 12;
  }

  // 2. 估值/基本面风险
  if (data.pe != null && (data.pe > C.maxPE || data.pe < 0)) {
    riskFlags.push({ type: "估值风险", severity: "低", detail: `PE=${data.pe.toFixed(0)}，估值偏高` });
    riskScore += 8;
  }
  if (data.marketCap != null && data.marketCap < C.minMarketCapYi * 100000000) {
    riskFlags.push({ type: "流动性风险", severity: "中", detail: `市值仅${(data.marketCap / 1e8).toFixed(1)}亿，小盘风险` });
    riskScore += 10;
  }

  // 3. 异常波动
  if (data.consecutiveLimitUp != null && data.consecutiveLimitUp >= 3) {
    riskFlags.push({ type: "异常波动", severity: "高", detail: `已${data.consecutiveLimitUp}连板，追高风险极大` });
    riskScore += 30;
  }
  if (data.isST) {
    riskFlags.push({ type: "估值风险", severity: "禁止", detail: "ST股，禁止交易" });
    riskScore += 50;
  }

  // 4. 板块/事件风险
  let sectorSentiment = 0;
  const relatedEvents: string[] = [];
  if (data.sector && heatMap) {
    const hotSector = heatMap.hotSectors.find(h => h.sector === data.sector);
    const coldSector = heatMap.coldSectors.find(c => c.sector === data.sector);
    if (hotSector) {
      sectorSentiment = hotSector.netImpact;
      if (hotSector.netImpact >= 30) relatedEvents.push(`板块"${data.sector}"受${hotSector.bullCount}条利好消息催化`);
    } else if (coldSector) {
      sectorSentiment = coldSector.netImpact;
      if (coldSector.netImpact <= -30) {
        riskFlags.push({ type: "板块风险", severity: "中", detail: `所在板块"${data.sector}"遭遇利空冲击` });
        riskScore += 15;
      }
    }
  }

  const sectorMomentum = data.sectorChangePercent ?? data.changePercent;
  const sectorRank = 50; // 默认中等

  // 问题股警告/关注级别也附加风险惩罚
  const problemRiskPenalty = problemCheck.severity === "警告" ? 25
    : problemCheck.severity === "关注" ? 10 : 0;

  return {
    code, name,
    fundamentals: {
      marketCap: data.marketCap ?? 0,
      pe: data.pe ?? 0,
      turnoverRate: data.turnoverRate,
      amount: data.amount,
      sector: data.sector ?? "未知",
      sectorRank,
    },
    eventExposure: { relatedEvents, sectorSentiment, sectorMomentum },
    riskFlags,
    riskScore: Math.min(100, riskScore + problemRiskPenalty),
    safeToTrade: (riskScore + problemRiskPenalty) < 30 && !data.isST && !problemCheck.blocked,
    blocked: false,
    blockReason: "",
  };
}

// ================================================================
//  4. 综合早鸟评分引擎
// ================================================================

export interface EarlyBirdInput {
  code: string;
  name: string;
  // 超短线维度
  scalpQualityScore: number;     // 来自 watchlist 的质量分
  scalpQualityGrade: string;     // "极优板" | "中等质量板" | ...
  limitUpToday: boolean;
  changePercent: number;
  openPct?: number;              // 竞价高开%
  // 行情维度
  turnoverRate: number;
  amount: number;
  marketCap?: number;
  pe?: number;
  sector?: string;
  sectorChangePercent?: number;
  consecutiveLimitUp?: number;
  isST?: boolean;
  // 可选：已有的分析数据
  qualityRiskFlags?: string[];
}

export function computeEarlyBirdScore(
  input: EarlyBirdInput,
  wind: MarketWindVane,
  heatMap: EventHeatMap,
  company: CompanyQuickAnalysis & { blocked?: boolean; blockReason?: string },
  config?: SentimentConfig,
): EarlyBirdSignal {
  // === 问题股直接返回回避（不浪费计算） ===
  if ((company as any).blocked) {
    return {
      code: input.code, name: input.name,
      totalScore: 0,
      level: "回避",
      scalpScore: 0, sentimentScore: 0, eventScore: 0, companyScore: -50,
      catalyst: "",
      riskWarnings: [(company as any).blockReason || "问题股，禁止交易"],
      entryWindow: "不适用",
      confidenceFactors: [],
      detectedAt: new Date().toISOString(),
    };
  }

  let scalpScore = 0;
  const confidenceFactors: string[] = [];
  const riskWarnings: string[] = [];
  let catalyst = "";

  // ======= 1. 超短线得分（基于质量分 + 涨势） =======
  if (input.scalpQualityGrade === "极优板") { scalpScore += 35; confidenceFactors.push("极优板质量"); }
  else if (input.scalpQualityGrade === "中等质量板") { scalpScore += 28; }
  else if (input.scalpQualityGrade === "低质量板") { scalpScore += 15; }
  else { scalpScore += Math.min(35, Math.round((input.scalpQualityScore || 0) / 2.5)); }

  // 涨势加分（不再只有涨停才给高分）
  if (input.limitUpToday) { scalpScore += 15; catalyst = "今日涨停封板"; confidenceFactors.push("涨停封板"); }
  else if (input.changePercent >= 8) { scalpScore += 12; catalyst = `涨${input.changePercent.toFixed(1)}%逼近涨停`; }
  else if (input.changePercent >= 5) { scalpScore += 10; catalyst = `涨${input.changePercent.toFixed(1)}%启动加速`; }
  else if (input.changePercent >= 3) { scalpScore += 7; catalyst = `涨${input.changePercent.toFixed(1)}%早期启动`; }
  else { scalpScore += 4; catalyst = `涨${input.changePercent.toFixed(1)}%`; }

  // 竞价强势加分（高开不破 → 主力信心足）
  if (input.openPct != null && input.openPct >= 2 && input.changePercent >= input.openPct) {
    scalpScore += 5; confidenceFactors.push("竞价强势未回补");
  }

  // 质量风控告警
  if (input.qualityRiskFlags) {
    for (const f of input.qualityRiskFlags) {
      if (f.includes("⛔")) { scalpScore -= 20; riskWarnings.push(f); }
      else if (f.includes("🚫")) { scalpScore -= 30; riskWarnings.push(f); }
      else if (f.includes("⚠️")) { scalpScore -= 10; riskWarnings.push(f); }
    }
  }
  scalpScore = clamp(scalpScore, 0, 50);

  // ======= 2. 市场环境得分（中性不扣分，只有真正差才扣） =======
  let sentimentScore = 0;
  if (wind.score >= 30) { sentimentScore += 15; confidenceFactors.push("市场极度乐观"); }
  else if (wind.score >= 10) { sentimentScore += 10; confidenceFactors.push("市场偏暖"); }
  else if (wind.score >= -5) { sentimentScore += 5; }
  else if (wind.score >= -20) { /* 中性偏冷不扣分，让其他维度说话 */ }
  else { sentimentScore -= 10; riskWarnings.push("市场极度恶劣，注意仓位"); }

  // 短线氛围特殊加分：风偏高的环境给更多分
  if (wind.breadth.score >= 25) { sentimentScore += 5; confidenceFactors.push("涨停潮环境"); }
  if (wind.capitalFlow.score >= 20) { sentimentScore += 8; confidenceFactors.push("资金大幅流入"); }
  sentimentScore = clamp(sentimentScore, -10, 25);

  // ======= 3. 事件催化得分 =======
  let eventScore = 3; // 基础分：有事件分析本身就是正面信号
  // 板块事件热度
  if (input.sector && company.eventExposure.sectorSentiment >= 40) {
    eventScore += 15;
    catalyst = company.eventExposure.relatedEvents[0] || catalyst;
    confidenceFactors.push(`板块${input.sector}受事件强力催化`);
  } else if (input.sector && company.eventExposure.sectorSentiment >= 20) {
    eventScore += 10;
  } else if (input.sector && company.eventExposure.sectorSentiment >= 5) {
    eventScore += 5;
  } else if (input.sector && company.eventExposure.sectorSentiment <= -20) {
    eventScore -= 8; riskWarnings.push(`板块${input.sector}遭遇利空`);
  }
  // 事件聚集度
  if (heatMap.eventClusterScore >= 60) { eventScore += 8; confidenceFactors.push("事件聚集效应显著"); }
  else if (heatMap.eventClusterScore >= 30) { eventScore += 3; }

  eventScore = clamp(eventScore, -8, 25);

  // ======= 4. 公司基本面/风控得分 =======
  let companyScore = 0;
  if (company.safeToTrade) {
    companyScore += 10;
    // 基本面加分
    if (company.fundamentals.amount >= 500_000_000) { companyScore += 5; confidenceFactors.push("大资金参与"); }
    if (company.fundamentals.turnoverRate >= 3 && company.fundamentals.turnoverRate <= 15) {
      companyScore += 3; confidenceFactors.push("换手合理");
    }
  } else {
    companyScore -= company.riskScore / 4; // 风控分越高，扣分越多
    for (const flag of company.riskFlags) {
      if (flag.severity === "禁止") { companyScore -= 20; riskWarnings.push(flag.detail); }
      else if (flag.severity === "高") { companyScore -= 10; riskWarnings.push(flag.detail); }
      else { companyScore -= 3; riskWarnings.push(flag.detail); }
    }
  }
  companyScore = clamp(companyScore, -30, 15);

  // ======= 综合评分 =======
  const totalScore = Math.round(clamp(
    scalpScore + sentimentScore + eventScore + companyScore, 0, 100
  ));

  const level: EarlyBirdSignal["level"] =
    totalScore >= 60 ? "强烈推荐" :
    totalScore >= 45 ? "推荐" :
    totalScore >= 30 ? "关注" :
    totalScore >= 15 ? "观望" : "回避";

  // 建议入场窗口
  let entryWindow = "盘中10:00-11:00";
  if (input.openPct != null && input.openPct >= 2 && input.openPct <= 5) {
    entryWindow = "竞价9:25-9:30（高开确认）";
  } else if (input.changePercent >= 5 && input.changePercent <= 8) {
    entryWindow = "盘中10:00-10:30（二次确认）";
  } else if (input.changePercent < 5) {
    entryWindow = "盘中11:00-14:00（等放量突破）";
  }

  return {
    code: input.code,
    name: input.name,
    totalScore,
    level,
    scalpScore,
    sentimentScore,
    eventScore,
    companyScore,
    catalyst: catalyst || "综合评分驱动",
    riskWarnings: riskWarnings.slice(0, 4),
    entryWindow,
    confidenceFactors: confidenceFactors.slice(0, 5),
    detectedAt: new Date().toISOString(),
  };
}

// ================================================================
//  5. 一站式入口：完整分析管线
// ================================================================

export interface FullSentimentReport {
  timestamp: string;
  wind: MarketWindVane;
  heatMap: EventHeatMap;
  earlyBirds: EarlyBirdSignal[];
  summary: string;
}

export async function runFullSentimentAnalysis(
  picks: EarlyBirdInput[],
  scalpConfig?: ScalpConfig,
  sentimentConfig?: SentimentConfig,
): Promise<FullSentimentReport> {
  const SC = sentimentConfig || DEFAULT_SENTIMENT_CONFIG;

  // Step 1: 风向标
  const wind = await assessMarketWind(SC);

  // Step 2: 事件图谱
  const eventAnalysis = await analyzeEvents();
  const heatMap = await buildEventHeatMap(eventAnalysis, SC);

  // Step 3 & 4: 对每只候选做快析 + 综合评分
  const earlyBirds: EarlyBirdSignal[] = [];
  for (const pick of picks) {
    const company = quickCompanyAnalysis(pick.code, pick.name, {
      turnoverRate: pick.turnoverRate,
      amount: pick.amount,
      changePercent: pick.changePercent,
      sector: pick.sector,
      sectorChangePercent: pick.sectorChangePercent,
      marketCap: pick.marketCap,
      pe: pick.pe,
      isST: pick.isST,
      consecutiveLimitUp: pick.consecutiveLimitUp,
    }, heatMap, SC);

    const signal = computeEarlyBirdScore(pick, wind, heatMap, company, SC);
    earlyBirds.push(signal);
  }

  earlyBirds.sort((a, b) => b.totalScore - a.totalScore);

  const topCount = earlyBirds.filter(e => e.level === "强烈推荐" || e.level === "推荐").length;
  const summary = [
    `风向: ${wind.label}(${wind.score}分)`,
    `事件聚集度: ${heatMap.eventClusterScore}分`,
    heatMap.hotSectors.length > 0 ? `热点板块: ${heatMap.hotSectors.slice(0, 3).map(s => s.sector).join("、")}` : "",
    `早期信号: ${topCount}只推荐 / ${earlyBirds.length}只扫描`,
    wind.windEvents.length > 0 ? `关键信号: ${wind.windEvents.slice(0, 2).join("；")}` : "",
  ].filter(Boolean).join(" | ");

  return { timestamp: new Date().toISOString(), wind, heatMap, earlyBirds, summary };
}

// ================================================================
//  工具
// ================================================================

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}