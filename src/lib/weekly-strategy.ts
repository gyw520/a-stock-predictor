/**
 * 短线周策略引擎
 * 
 * 目标：周综合盈利 2.5%+
 * 策略：板块轮动 + 动量追踪 + 事件驱动
 * 
 * 核心逻辑：
 * 1. 识别本周最强势板块（动量+资金+事件三重共振）
 * 2. 每日给出最佳买入/卖出时机
 * 3. 板块轮动信号（当前板块衰减→下一个板块接力）
 */

import type { ETFData, EnrichedSectorData, NorthboundFlow } from "./stock-api";
import { OTC_FUND_MAP } from "./stock-api";
import type { SectorEventSummary } from "./event-driven";
import { isTradingTime, isNearClose } from "./trading-hours";

// ==================== 类型 ====================

export interface SectorMomentum {
  sector: string;
  // 动量指标
  change1d: number;        // 今日涨跌%
  change3d: number;        // 3日涨跌%
  change5d: number;        // 5日涨跌%
  momentum: number;        // 动量评分 -100~100
  // 资金指标
  capitalFlow: number;     // 资金流入评分 -100~100
  mainNetInflow: number;   // 主力净流入（亿）
  // 波动率
  volatility: number;      // 5日波动率%
  amplitude: number;       // 今日振幅%
  // 事件驱动
  eventScore: number;      // 事件驱动分
  // 综合短线评分
  shortTermScore: number;  // -100~100
  // 板块内最佳ETF
  bestETF: { code: string; name: string; changePercent: number; score: number } | null;
}

export type DayAction = "重仓买入" | "加仓" | "持有" | "减仓" | "清仓" | "观望";

export interface DailyPlan {
  day: string;             // 周一~周五
  date: string;            // 日期
  action: DayAction;
  sector: string;          // 操作板块
  etfCode: string;
  etfName: string;
  reason: string;
  targetGain: number;      // 预期收益%
  stopLoss: number;        // 止损点%
  timing: string;          // 时机建议
}

export type OTCAction = "申购" | "赎回" | "持有" | "观望";

export interface OTCAlert {
  fundCode: string;
  fundName: string;
  sector: string;
  action: OTCAction;
  urgency: "立即" | "今日" | "关注";
  estimatedChange: number;   // 今日估算涨跌%
  change5d: number;          // 5日涨跌%
  sectorScore: number;       // 板块短线分
  reason: string;
  timing: string;            // 操作时间建议
  amountAdvice: string;      // 金额建议
}

export interface WeekendRisk {
  event: string;             // 事件描述
  category: string;          // 国际局势/政策/经济数据
  impactSectors: string[];   // 影响板块
  impact: "利空" | "利好" | "不确定";
  probability: "高" | "中" | "低";
  severity: number;          // 1-10
  advice: string;            // 建议
}

export interface MondayFundForecast {
  fundCode: string;
  fundName: string;
  sector: string;
  predictedChange: number;   // 预测涨跌%
  confidence: number;        // 置信度 0-100
  action: "周五赎回" | "周五申购" | "持有过周末" | "观望";
  reason: string;
}

export interface MondayForecast {
  marketOutlook: "看涨" | "看跌" | "震荡";
  marketReason: string;
  weekendRisks: WeekendRisk[];
  fundForecasts: MondayFundForecast[];
  overallAdvice: string;     // 总体建议
  shouldReduceBeforeWeekend: boolean;  // 是否建议周五减仓过周末
}

export interface WeeklyStrategy {
  weekLabel: string;         // 本周标签 如 "2024年第20周（5/5-5/9）"
  targetReturn: number;      // 目标收益% (2.5)
  
  // 本周推荐板块（按优先级排序）
  topSectors: SectorMomentum[];
  
  // 本周操作方案
  weeklyPlan: DailyPlan[];
  
  // 当前状态
  currentPhase: "启动期" | "加速期" | "高潮期" | "衰退期";
  rotationSignal: string;    // 轮动信号
  
  // 风控
  maxDrawdown: number;       // 最大回撤建议%
  positionAdvice: string;    // 仓位建议
  
  // 策略总结
  summary: string;
  riskWarning: string;
  
  // 实时推荐
  todayAction: {
    primary: { sector: string; etf: string; etfName: string; action: DayAction; reason: string };
    secondary: { sector: string; etf: string; etfName: string; action: DayAction; reason: string } | null;
  };
  
  // 场外ETF 3点前操作提醒
  otcAlerts: OTCAlert[];
  isPreClose: boolean;           // 是否处于收盘前时段
  
  // 周五→周一预测
  mondayForecast: MondayForecast | null;
  
  // 更新机制
  isNextWeekPreview: boolean;   // 是否为下周预览（周五收盘后/周末显示下周）
  lastUpdated: string;          // 上次更新时间
  updateMode: "实时" | "收盘后" | "下周预览";  // 当前模式
  intradayAdjustment: string | null;  // 盘中动态调整说明（如果有）
  
  timestamp: string;
}

// ==================== 板块动量分析 ====================

function analyzeSectorMomentum(
  etfs: ETFData[],
  sectors: EnrichedSectorData[],
  eventSummaries: SectorEventSummary[]
): SectorMomentum[] {
  // 按板块聚合ETF数据
  const sectorMap = new Map<string, ETFData[]>();
  for (const etf of etfs) {
    const list = sectorMap.get(etf.sector) || [];
    list.push(etf);
    sectorMap.set(etf.sector, list);
  }

  const results: SectorMomentum[] = [];

  for (const [sector, sectorETFs] of sectorMap) {
    if (sectorETFs.length === 0) continue;

    // 板块平均涨跌
    const avgChange1d = sectorETFs.reduce((s, e) => s + e.changePercent, 0) / sectorETFs.length;
    const avgChange5d = sectorETFs.reduce((s, e) => s + (e.change5d || 0), 0) / sectorETFs.length;
    const avgChange10d = sectorETFs.reduce((s, e) => s + (e.change10d || 0), 0) / sectorETFs.length;
    const avgChange3d = (avgChange5d + avgChange1d) / 2; // 近似3日

    // 动量评分：短期加速度
    // 动量 = 1日权重40% + 3日权重35% + 5日权重25%
    let momentum = 0;
    momentum += avgChange1d * 12;  // 1日涨1%=12分
    momentum += avgChange3d * 8;   // 3日涨1%=8分
    momentum += avgChange5d * 5;   // 5日涨1%=5分
    // 加速判断：今日>3日均>5日均 = 加速
    if (avgChange1d > avgChange3d && avgChange3d > avgChange5d / 5 * 3) {
      momentum += 15; // 加速奖励
    }
    // 反转判断：5日跌但今日涨 = 超跌反弹
    if (avgChange5d < -2 && avgChange1d > 1) {
      momentum += 10; // 反弹奖励
    }
    momentum = Math.max(-100, Math.min(100, momentum));

    // 资金流
    const sectorInfo = sectors.find(s => s.name === sector);
    const mainNetInflow = sectorInfo?.mainNetInflow || 0;
    const mainNetInflowBillion = mainNetInflow / 1e8;
    let capitalFlow = 0;
    capitalFlow += mainNetInflowBillion * 5; // 每亿流入=5分
    if (mainNetInflowBillion > 3) capitalFlow += 20; // 大额流入加分
    if (mainNetInflowBillion < -3) capitalFlow -= 20;
    // ETF主力净流入
    const etfMainFlow = sectorETFs.reduce((s, e) => s + (e.mainNetInflow || 0), 0) / 1e8;
    capitalFlow += etfMainFlow * 8;
    capitalFlow = Math.max(-100, Math.min(100, capitalFlow));

    // 波动率（用振幅估算）
    const avgAmplitude = sectorETFs.reduce((s, e) => s + (e.amplitude || 0), 0) / sectorETFs.length;
    const volatility = Math.max(avgAmplitude, Math.abs(avgChange5d) / 5 * 1.5);

    // 事件驱动
    const eventSum = eventSummaries.find(e => e.sector === sector);
    const eventScore = eventSum ? Math.max(-100, Math.min(100, eventSum.netImpact)) : 0;

    // 短线综合评分
    // 动量45% + 资金30% + 事件25%（短线以动量为王）
    const shortTermScore = Math.round(
      momentum * 0.45 + capitalFlow * 0.30 + eventScore * 0.25
    );

    // 板块内最佳ETF：选涨幅最高且有量的
    const sorted = [...sectorETFs].sort((a, b) => {
      // 综合考虑：今日涨幅 + 5日涨幅 + 量能
      const scoreA = a.changePercent * 3 + (a.change5d || 0) * 2 + (a.turnoverRate || 0) * 5;
      const scoreB = b.changePercent * 3 + (b.change5d || 0) * 2 + (b.turnoverRate || 0) * 5;
      return scoreB - scoreA;
    });
    const best = sorted[0];

    results.push({
      sector,
      change1d: avgChange1d,
      change3d: avgChange3d,
      change5d: avgChange5d,
      momentum,
      capitalFlow,
      mainNetInflow: mainNetInflowBillion,
      volatility,
      amplitude: avgAmplitude,
      eventScore,
      shortTermScore,
      bestETF: best ? {
        code: best.code,
        name: best.name,
        changePercent: best.changePercent,
        score: shortTermScore,
      } : null,
    });
  }

  // 按短线评分排序
  results.sort((a, b) => b.shortTermScore - a.shortTermScore);
  return results;
}

// ==================== 判断市场阶段 ====================

function detectPhase(topSector: SectorMomentum): "启动期" | "加速期" | "高潮期" | "衰退期" {
  const { change1d, change3d, change5d, momentum, capitalFlow } = topSector;
  
  // 高潮期：连续大涨后动量开始减弱
  if (change5d > 8 && change1d < change3d / 3) return "高潮期";
  // 衰退期：5日涨但今日跌，资金外流
  if (change5d > 3 && change1d < 0 && capitalFlow < 0) return "衰退期";
  // 加速期：连涨且今日加速
  if (change5d > 3 && change1d > 1 && momentum > 40) return "加速期";
  // 启动期：刚开始涨，资金流入
  if (change1d > 0.5 && capitalFlow > 20 && change5d < 5) return "启动期";
  
  return "启动期";
}

// ==================== 生成每日计划 ====================

function generateDailyPlans(
  topSectors: SectorMomentum[],
  phase: string,
): DailyPlan[] {
  const days = ["周一", "周二", "周三", "周四", "周五"];
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=周日, 1=周一...
  
  const plans: DailyPlan[] = [];
  
  if (topSectors.length === 0) return plans;

  const primary = topSectors[0];
  const secondary = topSectors[1];
  const tertiary = topSectors[2];

  // 根据市场阶段制定本周计划
  for (let i = 0; i < 5; i++) {
    const date = new Date(now);
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    date.setDate(date.getDate() + daysToMonday + i);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
    
    let plan: DailyPlan;
    const isToday = i === (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
    const isPast = i < (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
    
    if (phase === "启动期") {
      // 启动期策略：周一周二建仓，周三周四持有加仓，周五择机出
      if (i <= 1) {
        plan = {
          day: days[i], date: dateStr,
          action: i === 0 ? "重仓买入" : "加仓",
          sector: primary.sector,
          etfCode: primary.bestETF?.code || "",
          etfName: primary.bestETF?.name || primary.sector,
          reason: `${primary.sector}处于启动阶段，动量${primary.momentum > 0 ? "转正" : "蓄势"}，资金开始流入`,
          targetGain: 1.0 + i * 0.3,
          stopLoss: -1.5,
          timing: "开盘30分钟内观察，放量突破均线即入场",
        };
      } else if (i <= 3) {
        const useSector = i === 3 && secondary ? secondary : primary;
        plan = {
          day: days[i], date: dateStr,
          action: "持有",
          sector: useSector.sector,
          etfCode: useSector.bestETF?.code || "",
          etfName: useSector.bestETF?.name || useSector.sector,
          reason: `持有观察${useSector.sector}走势，若加速则加仓`,
          targetGain: 0.8,
          stopLoss: -1.0,
          timing: "盘中关注量能变化，缩量则警惕",
        };
      } else {
        plan = {
          day: days[i], date: dateStr,
          action: "减仓",
          sector: primary.sector,
          etfCode: primary.bestETF?.code || "",
          etfName: primary.bestETF?.name || primary.sector,
          reason: "周五获利了结，锁定本周收益",
          targetGain: 0.5,
          stopLoss: -0.5,
          timing: "14:00-14:30之间操作，避免尾盘变化",
        };
      }
    } else if (phase === "加速期") {
      // 加速期策略：追涨但要快进快出
      if (i === 0) {
        plan = {
          day: days[i], date: dateStr,
          action: "重仓买入",
          sector: primary.sector,
          etfCode: primary.bestETF?.code || "",
          etfName: primary.bestETF?.name || primary.sector,
          reason: `${primary.sector}加速上涨中，动量${primary.momentum.toFixed(0)}，趁势而上`,
          targetGain: 1.5,
          stopLoss: -2.0,
          timing: "开盘竞价观察，高开低于1%可追入",
        };
      } else if (i <= 2) {
        plan = {
          day: days[i], date: dateStr,
          action: "持有",
          sector: primary.sector,
          etfCode: primary.bestETF?.code || "",
          etfName: primary.bestETF?.name || primary.sector,
          reason: "加速阶段持仓享受主升浪",
          targetGain: 1.0,
          stopLoss: -1.5,
          timing: "设置止盈：累计盈利3%以上可止盈一半",
        };
      } else if (i === 3) {
        // 周四切换到下一个板块
        const nextSector = secondary || primary;
        plan = {
          day: days[i], date: dateStr,
          action: "减仓",
          sector: primary.sector,
          etfCode: primary.bestETF?.code || "",
          etfName: primary.bestETF?.name || primary.sector,
          reason: `${primary.sector}加速末期，减仓锁利，关注${nextSector.sector}接力`,
          targetGain: 0.5,
          stopLoss: -1.0,
          timing: "上午获利减半仓，下午关注新板块",
        };
      } else {
        const nextSector = secondary || primary;
        plan = {
          day: days[i], date: dateStr,
          action: secondary ? "加仓" : "清仓",
          sector: nextSector.sector,
          etfCode: nextSector.bestETF?.code || "",
          etfName: nextSector.bestETF?.name || nextSector.sector,
          reason: secondary
            ? `切换至${nextSector.sector}，为下周布局`
            : "本周策略完结，全部获利了结",
          targetGain: 0.5,
          stopLoss: -1.0,
          timing: "14:00前完成操作",
        };
      }
    } else if (phase === "高潮期") {
      // 高潮期：谨慎，快速获利了结
      if (i === 0) {
        plan = {
          day: days[i], date: dateStr,
          action: "减仓",
          sector: primary.sector,
          etfCode: primary.bestETF?.code || "",
          etfName: primary.bestETF?.name || primary.sector,
          reason: `${primary.sector}已至高潮，连涨${primary.change5d.toFixed(1)}%后风险增大`,
          targetGain: 0.5,
          stopLoss: -1.0,
          timing: "开盘高开即出，不追高",
        };
      } else if (i === 1) {
        const nextSector = secondary || tertiary || primary;
        plan = {
          day: days[i], date: dateStr,
          action: "重仓买入",
          sector: nextSector.sector,
          etfCode: nextSector.bestETF?.code || "",
          etfName: nextSector.bestETF?.name || nextSector.sector,
          reason: `轮动至${nextSector.sector}，处于启动位置`,
          targetGain: 1.2,
          stopLoss: -1.5,
          timing: "等待回调后低吸，不追高",
        };
      } else if (i <= 3) {
        const nextSector = secondary || primary;
        plan = {
          day: days[i], date: dateStr,
          action: "持有",
          sector: nextSector.sector,
          etfCode: nextSector.bestETF?.code || "",
          etfName: nextSector.bestETF?.name || nextSector.sector,
          reason: `${nextSector.sector}接力走势`,
          targetGain: 0.8,
          stopLoss: -1.0,
          timing: "关注量价配合",
        };
      } else {
        plan = {
          day: days[i], date: dateStr,
          action: "减仓",
          sector: (secondary || primary).sector,
          etfCode: (secondary || primary).bestETF?.code || "",
          etfName: (secondary || primary).bestETF?.name || (secondary || primary).sector,
          reason: "周末前降低仓位规避风险",
          targetGain: 0.3,
          stopLoss: -0.5,
          timing: "14:00-14:30操作",
        };
      }
    } else {
      // 衰退期：防守为主，等待新信号
      if (i <= 1) {
        plan = {
          day: days[i], date: dateStr,
          action: "观望",
          sector: primary.sector,
          etfCode: "",
          etfName: "空仓等待",
          reason: "板块衰退期，等待新轮动信号",
          targetGain: 0,
          stopLoss: 0,
          timing: "盘中观察资金流向，寻找新龙头",
        };
      } else if (i === 2) {
        // 周三寻找反弹
        const reboundSector = topSectors.find(s => s.change5d < -3 && s.change1d > 0 && s.capitalFlow > 0) || secondary || primary;
        plan = {
          day: days[i], date: dateStr,
          action: "加仓",
          sector: reboundSector.sector,
          etfCode: reboundSector.bestETF?.code || "",
          etfName: reboundSector.bestETF?.name || reboundSector.sector,
          reason: `${reboundSector.sector}超跌后资金回流，博反弹`,
          targetGain: 1.0,
          stopLoss: -1.5,
          timing: "下午低点入场，T+1卖出",
        };
      } else {
        const reboundSector = topSectors.find(s => s.change5d < -3 && s.change1d > 0) || secondary || primary;
        plan = {
          day: days[i], date: dateStr,
          action: i === 4 ? "减仓" : "持有",
          sector: reboundSector.sector,
          etfCode: reboundSector.bestETF?.code || "",
          etfName: reboundSector.bestETF?.name || reboundSector.sector,
          reason: i === 4 ? "周末前了结短线仓位" : "持有反弹仓位",
          targetGain: 0.5,
          stopLoss: -1.0,
          timing: i === 4 ? "14:00前操作" : "观察趋势",
        };
      }
    }

    plans.push(plan);
  }

  return plans;
}

// ==================== 主入口 ====================

export function generateWeeklyStrategy(
  etfs: ETFData[],
  sectors: EnrichedSectorData[],
  northbound: NorthboundFlow[],
  eventSummaries: SectorEventSummary[],
  marketChangePercent: number,
  topEvents?: import("./event-driven").EventSignal[],
): WeeklyStrategy {
  // 1. 板块动量分析
  const allMomentum = analyzeSectorMomentum(etfs, sectors, eventSummaries);
  const topSectors = allMomentum.slice(0, 8);
  
  if (topSectors.length === 0) {
    const { updateMode, isNextWeekPreview, weekLabel: wl } = getUpdateMode();
    return {
      weekLabel: wl,
      targetReturn: 2.5,
      topSectors: [],
      weeklyPlan: [],
      currentPhase: "启动期",
      rotationSignal: "暂无数据",
      maxDrawdown: -3,
      positionAdvice: "空仓等待",
      summary: "暂无足够数据生成策略",
      riskWarning: "请等待数据更新",
      todayAction: {
        primary: { sector: "", etf: "", etfName: "", action: "观望", reason: "数据不足" },
        secondary: null,
      },
      otcAlerts: [],
      isPreClose: isPreCloseWindow(),
      mondayForecast: null,
      isNextWeekPreview,
      lastUpdated: fmtTime(new Date()),
      updateMode,
      intradayAdjustment: null,
      timestamp: new Date().toISOString(),
    };
  }

  // 2. 判断主力板块阶段
  const primary = topSectors[0];
  const phase = detectPhase(primary);

  // 3. 生成轮动信号
  let rotationSignal = "";
  if (phase === "高潮期" || phase === "衰退期") {
    const next = topSectors.find(s => s.sector !== primary.sector && s.momentum > 20 && s.capitalFlow > 10);
    rotationSignal = next
      ? `⚡ ${primary.sector}动量减弱，${next.sector}接力信号明确，建议轮动！`
      : `⚠️ ${primary.sector}已到高位，暂无明确接力板块，建议减仓观望`;
  } else if (phase === "加速期") {
    rotationSignal = `🚀 ${primary.sector}主升浪中，持仓享受趋势，关注量能是否持续`;
  } else {
    rotationSignal = `🌱 ${primary.sector}启动信号出现，资金流入+动量转正，可逐步建仓`;
  }

  // 4. 生成每日计划
  const weeklyPlan = generateDailyPlans(topSectors, phase);

  // 5. 今日操作推荐
  const dayOfWeek = new Date().getDay();
  const todayPlan = weeklyPlan[dayOfWeek === 0 ? 4 : dayOfWeek - 1]; // 非交易日看周五
  
  const secondary = topSectors.length > 1 ? topSectors[1] : null;
  const todayAction = {
    primary: {
      sector: todayPlan?.sector || primary.sector,
      etf: todayPlan?.etfCode || primary.bestETF?.code || "",
      etfName: todayPlan?.etfName || primary.bestETF?.name || "",
      action: todayPlan?.action || "观望" as DayAction,
      reason: todayPlan?.reason || "等待信号确认",
    },
    secondary: secondary && secondary.shortTermScore > 30 ? {
      sector: secondary.sector,
      etf: secondary.bestETF?.code || "",
      etfName: secondary.bestETF?.name || "",
      action: "加仓" as DayAction,
      reason: `${secondary.sector}备选，动量${secondary.momentum.toFixed(0)}`,
    } : null,
  };

  // 6. 仓位建议
  let positionAdvice = "";
  if (phase === "启动期") positionAdvice = "5成仓位试探，确认后加至8成";
  else if (phase === "加速期") positionAdvice = "8-9成仓位，紧跟趋势";
  else if (phase === "高潮期") positionAdvice = "5成以下，逐步锁利，不追高";
  else positionAdvice = "2-3成仓位，轻仓博反弹或空仓等待";

  // 7. 北向资金趋势判断
  const nbTotal = northbound.slice(0, 3).reduce((s, n) => s + n.total, 0);
  const nbTrend = nbTotal > 30e8 ? "持续流入" : nbTotal < -30e8 ? "持续流出" : "震荡";

  // 8. 策略总结
  const expectedGain = topSectors.slice(0, 3).reduce((s, sec) => s + Math.max(0, sec.change1d), 0);
  const weeklyTarget = Math.max(2.5, expectedGain * 0.6);
  
  const summary = generateSummary(primary, secondary, phase, nbTrend, weeklyTarget);

  // 9. 更新模式与盘中调整
  const { updateMode, isNextWeekPreview, weekLabel: wl } = getUpdateMode();
  const intradayAdj = detectIntradayAdjustment(primary, secondary, phase, topSectors);

  // 10. 场外ETF 3点前操作提醒
  const otcAlerts = generateOTCAlerts(topSectors, allMomentum, etfs, phase);
  const preClose = isPreCloseWindow();

  // 11. 周五→周一预测
  const mondayForecast = generateMondayForecast(
    allMomentum, topSectors, primary, secondary, phase,
    marketChangePercent, nbTrend, eventSummaries, topEvents || [],
  );

  return {
    weekLabel: wl,
    targetReturn: weeklyTarget,
    topSectors,
    weeklyPlan: isNextWeekPreview ? generateDailyPlans(topSectors, detectPhase(primary)) : weeklyPlan,
    currentPhase: phase,
    rotationSignal,
    maxDrawdown: phase === "加速期" ? -3 : -2,
    positionAdvice,
    summary: isNextWeekPreview
      ? `【下周预案】基于本周收盘数据提前布局。` + summary
      : summary,
    riskWarning: generateRiskWarning(phase, marketChangePercent, primary),
    todayAction,
    otcAlerts,
    isPreClose: preClose,
    mondayForecast,
    isNextWeekPreview,
    lastUpdated: fmtTime(new Date()),
    updateMode,
    intradayAdjustment: intradayAdj,
    timestamp: new Date().toISOString(),
  };
}

function getWeekLabel(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
  // 计算本周一和周五的日期
  const dayOfWeek = now.getDay(); // 0=周日
  const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${now.getFullYear()}年第${weekNum}周（${fmt(monday)}-${fmt(friday)}）`;
}

function generateSummary(
  primary: SectorMomentum,
  secondary: SectorMomentum | null,
  phase: string,
  nbTrend: string,
  target: number,
): string {
  let s = `本周主攻【${primary.sector}】`;
  if (primary.bestETF) s += `(${primary.bestETF.name})`;
  s += `，当前处于${phase}`;
  
  if (phase === "启动期") {
    s += `，动量刚转正(${primary.momentum.toFixed(0)})，资金开始流入`;
    s += `。策略：逢低建仓，逐步加码。`;
  } else if (phase === "加速期") {
    s += `，动量强劲(${primary.momentum.toFixed(0)})`;
    s += `。策略：紧跟趋势不下车，设好止盈。`;
  } else if (phase === "高潮期") {
    s += `，注意见顶风险`;
    if (secondary) s += `，关注${secondary.sector}接力`;
    s += `。策略：逢高减仓，不贪最后一棒。`;
  } else {
    s += `，耐心等待新信号`;
    s += `。策略：轻仓或空仓，保住前期利润。`;
  }
  
  s += ` 北向资金${nbTrend}。`;
  s += ` 本周目标收益${target.toFixed(1)}%+。`;
  
  return s;
}

function generateRiskWarning(phase: string, marketChange: number, primary: SectorMomentum): string {
  const warnings: string[] = [];
  
  if (marketChange < -1) warnings.push("大盘下跌环境，短线需设严格止损");
  if (primary.change5d > 10) warnings.push(`${primary.sector}短期涨幅过大(${primary.change5d.toFixed(1)}%)，追高风险大`);
  if (primary.volatility > 3) warnings.push(`板块波动率高(${primary.volatility.toFixed(1)}%)，注意仓位控制`);
  if (phase === "高潮期") warnings.push("高潮期不追涨，错过不后悔");
  if (phase === "衰退期") warnings.push("衰退期严格止损，不死扛");
  
  if (warnings.length === 0) warnings.push("短线操作纪律：止损不犹豫，止盈分批出");
  
  return warnings.join("；");
}

// ==================== 更新模式检测 ====================

function getBeijingNow(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 3600000);
}

function fmtTime(d: Date): string {
  const bj = getBeijingNow();
  return `${bj.getMonth() + 1}/${bj.getDate()} ${bj.getHours().toString().padStart(2, "0")}:${bj.getMinutes().toString().padStart(2, "0")}`;
}

function getUpdateMode(): { updateMode: "实时" | "收盘后" | "下周预览"; isNextWeekPreview: boolean; weekLabel: string } {
  const bj = getBeijingNow();
  const day = bj.getDay(); // 0=周日
  const t = bj.getHours() * 60 + bj.getMinutes();
  const isWeekend = day === 0 || day === 6;
  const isFridayAfterClose = day === 5 && t > 900; // 周五15:00后
  const isAfterClose = !isWeekend && t > 900;       // 交易日15:00后

  if (isWeekend || isFridayAfterClose) {
    // 周末/周五收盘后 → 显示下周预案
    const nextMon = new Date(bj);
    const daysToNextMon = day === 0 ? 1 : day === 6 ? 2 : (8 - day);
    nextMon.setDate(bj.getDate() + daysToNextMon);
    const nextFri = new Date(nextMon);
    nextFri.setDate(nextMon.getDate() + 4);
    const start = new Date(nextMon.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((nextMon.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
    const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    return {
      updateMode: "下周预览",
      isNextWeekPreview: true,
      weekLabel: `${nextMon.getFullYear()}年第${weekNum}周（${fmt(nextMon)}-${fmt(nextFri)}）🔮 下周预案`,
    };
  }

  if (isAfterClose) {
    return { updateMode: "收盘后", isNextWeekPreview: false, weekLabel: getWeekLabel() + " 📊 收盘总结" };
  }

  // 盘中实时
  return { updateMode: "实时", isNextWeekPreview: false, weekLabel: getWeekLabel() };
}

// ==================== 盘中动态调整 ====================

function detectIntradayAdjustment(
  primary: SectorMomentum,
  secondary: SectorMomentum | null,
  phase: string,
  allSectors: SectorMomentum[],
): string | null {
  if (!isTradingTime()) return null;

  const adjustments: string[] = [];

  // 情况1：推荐板块今日大跌 → 紧急止损
  if (primary.change1d < -2) {
    adjustments.push(`⚠️ ${primary.sector}今日跌${primary.change1d.toFixed(1)}%，触发止损！建议立即减仓/清仓`);
  }

  // 情况2：推荐板块今日大涨 → 提前止盈
  if (primary.change1d > 3) {
    adjustments.push(`🎯 ${primary.sector}今日涨${primary.change1d.toFixed(1)}%，已超单日目标，考虑止盈一半`);
  }

  // 情况3：其他板块突然异动 → 轮动信号
  const hotNew = allSectors.find(s =>
    s.sector !== primary.sector &&
    s.change1d > 2 &&
    s.capitalFlow > 30 &&
    s.shortTermScore > primary.shortTermScore
  );
  if (hotNew) {
    adjustments.push(`🔥 异动板块：${hotNew.sector}今日涨${hotNew.change1d.toFixed(1)}%且资金涌入，短线分${hotNew.shortTermScore}已超过${primary.sector}(${primary.shortTermScore})，可考虑切换`);
  }

  // 情况4：加速转高潮
  if (phase === "加速期" && primary.change5d > 8 && primary.change1d < primary.change3d / 3) {
    adjustments.push(`📉 ${primary.sector}动量放缓，可能从加速期进入高潮期，注意减仓时机`);
  }

  return adjustments.length > 0 ? adjustments.join("；") : null;
}

// ==================== 场外ETF 3点前操作提醒 ====================

function isPreCloseWindow(): boolean {
  const bj = getBeijingNow();
  const day = bj.getDay();
  if (day === 0 || day === 6) return false;
  const t = bj.getHours() * 60 + bj.getMinutes();
  // 交易日 9:30-15:00 都可以操作场外，但重点提醒 13:00-15:00
  return t >= 570 && t <= 900;
}

function generateOTCAlerts(
  topSectors: SectorMomentum[],
  allSectors: SectorMomentum[],
  etfs: ETFData[],
  phase: string,
): OTCAlert[] {
  const alerts: OTCAlert[] = [];
  const bj = getBeijingNow();
  const day = bj.getDay();
  const t = bj.getHours() * 60 + bj.getMinutes();
  const isTrading = day >= 1 && day <= 5 && t >= 570 && t <= 900;
  const isUrgent = t >= 780 && t <= 900; // 13:00-15:00 紧急
  const isLastHour = t >= 840; // 14:00后最后一小时

  // 遍历所有板块，为每个有场外基金的板块生成提醒
  for (const sec of allSectors) {
    const otcFunds = OTC_FUND_MAP[sec.sector];
    if (!otcFunds || otcFunds.length === 0) continue;

    // 用场内ETF估算今日涨跌
    const sectorETFs = etfs.filter(e => e.sector === sec.sector);
    const estimatedChange = sectorETFs.length > 0
      ? sectorETFs.reduce((s, e) => s + e.changePercent, 0) / sectorETFs.length * 0.95
      : sec.change1d * 0.95;

    for (const fund of otcFunds) {
      let action: OTCAction;
      let urgency: "立即" | "今日" | "关注";
      let reason: string;
      let timing: string;
      let amountAdvice: string;

      const isTopSector = topSectors.slice(0, 3).some(ts => ts.sector === sec.sector);
      const isBullish = sec.shortTermScore > 30 && sec.momentum > 20;
      const isBearish = sec.shortTermScore < -20 || (sec.change5d > 8 && sec.change1d < 0);
      const isHot = sec.change1d > 2 && sec.capitalFlow > 20;

      if (isBullish && isTopSector && (phase === "启动期" || phase === "加速期")) {
        // 强势板块+短线推荐 → 申购
        action = "申购";
        urgency = isUrgent ? "立即" : "今日";
        reason = `${sec.sector}短线分${sec.shortTermScore}，动量${sec.momentum > 0 ? "+" : ""}${sec.momentum.toFixed(0)}，`;
        reason += estimatedChange > 0 ? `今日估涨${estimatedChange.toFixed(2)}%，趁回调申购` : `今日估跌${estimatedChange.toFixed(2)}%，低位好时机`;
        timing = isLastHour ? "⏰ 距截止不到1小时！" : isUrgent ? "建议14:30前操作" : "15:00前完成申购";
        amountAdvice = phase === "加速期" ? "建议较大金额（目标仓位的60-80%）" : "建议适量（目标仓位的30-50%）";
      } else if (isBearish || (phase === "高潮期" && isTopSector && sec.change5d > 5)) {
        // 弱势或高潮见顶 → 赎回
        action = "赎回";
        urgency = isUrgent ? "立即" : "今日";
        reason = phase === "高潮期"
          ? `${sec.sector}处于高潮期，5日涨${sec.change5d.toFixed(1)}%，锁定利润`
          : `${sec.sector}走弱，短线分${sec.shortTermScore}，动量${sec.momentum.toFixed(0)}，及时止损`;
        timing = isLastHour ? "⏰ 距截止不到1小时，抓紧！" : "建议14:30前操作";
        amountAdvice = phase === "高潮期" ? "建议赎回50-70%仓位" : "建议全部赎回";
      } else if (isHot && !isTopSector) {
        // 今日异动但非主推 → 关注
        action = "申购";
        urgency = "关注";
        reason = `${sec.sector}今日异动涨${sec.change1d.toFixed(1)}%，资金流入${sec.mainNetInflow.toFixed(1)}亿，可小额试探`;
        timing = "观察尾盘走势再决定";
        amountAdvice = "小金额试探（目标仓位的10-20%）";
      } else if (sec.shortTermScore > 10 && sec.shortTermScore <= 30) {
        // 中性偏多 → 持有
        action = "持有";
        urgency = "关注";
        reason = `${sec.sector}短线分${sec.shortTermScore}，走势中性偏多，暂不操作`;
        timing = "继续观察";
        amountAdvice = "维持现有仓位";
      } else {
        // 其他 → 观望
        action = "观望";
        urgency = "关注";
        reason = `${sec.sector}短线分${sec.shortTermScore}，信号不明确`;
        timing = "等待更明确的信号";
        amountAdvice = "不建议操作";
      }

      alerts.push({
        fundCode: fund.code,
        fundName: fund.name,
        sector: sec.sector,
        action,
        urgency,
        estimatedChange,
        change5d: sec.change5d,
        sectorScore: sec.shortTermScore,
        reason,
        timing: isTrading ? timing : "非交易时段，仅供参考",
        amountAdvice,
      });
    }
  }

  // 排序：申购/赎回优先，紧急优先，分数高优先
  const actionOrder: Record<OTCAction, number> = { "申购": 0, "赎回": 1, "持有": 2, "观望": 3 };
  const urgencyOrder: Record<string, number> = { "立即": 0, "今日": 1, "关注": 2 };
  alerts.sort((a, b) => {
    if (actionOrder[a.action] !== actionOrder[b.action]) return actionOrder[a.action] - actionOrder[b.action];
    if (urgencyOrder[a.urgency] !== urgencyOrder[b.urgency]) return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    return b.sectorScore - a.sectorScore;
  });

  return alerts;
}

// ==================== 周五→周一预测 ====================

function generateMondayForecast(
  allMomentum: SectorMomentum[],
  topSectors: SectorMomentum[],
  primary: SectorMomentum,
  secondary: SectorMomentum | null,
  phase: string,
  marketChange: number,
  nbTrend: string,
  eventSummaries: SectorEventSummary[],
  topEvents: import("./event-driven").EventSignal[],
): MondayForecast | null {
  const bj = getBeijingNow();
  const day = bj.getDay();
  const t = bj.getHours() * 60 + bj.getMinutes();
  // 周四下午、周五全天、周末 都展示预测
  const showForecast = (day === 4 && t >= 780) || day === 5 || day === 6 || day === 0;
  if (!showForecast) return null;

  // ===== 周末风险事件识别 =====
  const weekendRisks: WeekendRisk[] = [];

  // 从最新新闻事件中提取周末潜在风险
  for (const evt of topEvents) {
    if (evt.impact === "利空" && evt.weight >= 5) {
      weekendRisks.push({
        event: evt.title,
        category: evt.category,
        impactSectors: evt.sectors,
        impact: "利空",
        probability: evt.weight >= 8 ? "高" : evt.weight >= 6 ? "中" : "低",
        severity: evt.weight,
        advice: `${evt.sectors.slice(0, 2).join("/")}相关基金建议周五减仓`,
      });
    }
    if (evt.impact === "利好" && evt.weight >= 6) {
      weekendRisks.push({
        event: evt.title,
        category: evt.category,
        impactSectors: evt.sectors,
        impact: "利好",
        probability: evt.weight >= 8 ? "高" : "中",
        severity: evt.weight,
        advice: `${evt.sectors.slice(0, 2).join("/")}可持有过周末`,
      });
    }
  }

  // 基于板块走势的结构性风险
  for (const sec of allMomentum) {
    // 连涨5日以上 → 周末回调风险
    if (sec.change5d > 8) {
      weekendRisks.push({
        event: `${sec.sector}本周累计涨${sec.change5d.toFixed(1)}%，短期获利盘较大`,
        category: "技术面",
        impactSectors: [sec.sector],
        impact: "利空",
        probability: "中",
        severity: 6,
        advice: `${sec.sector}周一大概率回调，建议周五锁定利润`,
      });
    }
    // 连跌+资金外流 → 惯性下跌
    if (sec.change5d < -5 && sec.capitalFlow < -20) {
      weekendRisks.push({
        event: `${sec.sector}本周跌${sec.change5d.toFixed(1)}%且资金持续外流`,
        category: "技术面",
        impactSectors: [sec.sector],
        impact: "利空",
        probability: "高",
        severity: 7,
        advice: `${sec.sector}惯性下跌风险，避免抄底`,
      });
    }
  }

  // 大盘风险
  if (marketChange < -1.5) {
    weekendRisks.push({
      event: `大盘今日跌${Math.abs(marketChange).toFixed(1)}%，市场恐慌情绪扩散`,
      category: "市场情绪",
      impactSectors: ["全市场"],
      impact: "利空",
      probability: "高",
      severity: 8,
      advice: "系统性风险，建议大幅减仓过周末",
    });
  }

  // 北向资金外流
  if (nbTrend === "持续流出") {
    weekendRisks.push({
      event: "北向资金近3日持续净流出，外资撤退",
      category: "资金面",
      impactSectors: ["沪深300", "大消费", "食品饮料"],
      impact: "利空",
      probability: "中",
      severity: 5,
      advice: "外资重仓板块注意风险",
    });
  }

  // 排序：严重程度高优先
  weekendRisks.sort((a, b) => b.severity - a.severity);

  // ===== 周一大盘展望 =====
  const bearishRisks = weekendRisks.filter(r => r.impact === "利空");
  const bullishSignals = weekendRisks.filter(r => r.impact === "利好");
  const totalBearSeverity = bearishRisks.reduce((s, r) => s + r.severity, 0);
  const totalBullSeverity = bullishSignals.reduce((s, r) => s + r.severity, 0);

  let marketOutlook: "看涨" | "看跌" | "震荡";
  let marketReason: string;
  if (totalBearSeverity > totalBullSeverity + 10) {
    marketOutlook = "看跌";
    marketReason = `周末${bearishRisks.length}项利空因素（总风险度${totalBearSeverity}），周一大概率低开`;
  } else if (totalBullSeverity > totalBearSeverity + 5) {
    marketOutlook = "看涨";
    marketReason = `${bullishSignals.length}项利好支撑，周一有望高开`;
  } else {
    marketOutlook = "震荡";
    marketReason = "多空力量相对均衡，周一大概率震荡开盘";
  }

  // 叠加动量判断
  if (phase === "加速期" && primary.momentum > 50 && marketOutlook !== "看跌") {
    marketOutlook = "看涨";
    marketReason += `；${primary.sector}动量强劲，惯性上涨概率大`;
  }
  if (phase === "衰退期" && marketOutlook !== "看涨") {
    marketOutlook = "看跌";
    marketReason += `；主力板块进入衰退期，风险偏好降低`;
  }

  // ===== 场外基金周一预测 =====
  const fundForecasts: MondayFundForecast[] = [];
  const riskSectorSet = new Set(bearishRisks.flatMap(r => r.impactSectors));
  const bullSectorSet = new Set(bullishSignals.flatMap(r => r.impactSectors));

  for (const sec of allMomentum) {
    const otcFunds = OTC_FUND_MAP[sec.sector];
    if (!otcFunds || otcFunds.length === 0) continue;

    // 预测周一涨跌
    let predicted = 0;
    let confidence = 50;
    let action: MondayFundForecast["action"];
    let reason: string;

    const hasRisk = riskSectorSet.has(sec.sector) || riskSectorSet.has("全市场");
    const hasBull = bullSectorSet.has(sec.sector);

    if (hasRisk && !hasBull) {
      // 有利空事件
      const riskEvents = bearishRisks.filter(r => r.impactSectors.includes(sec.sector) || r.impactSectors.includes("全市场"));
      const maxSev = Math.max(...riskEvents.map(r => r.severity));
      predicted = -(maxSev * 0.3 + Math.random() * 0.5);
      confidence = 40 + maxSev * 4;
      action = "周五赎回";
      reason = riskEvents.map(r => r.event).slice(0, 2).join("；");
    } else if (hasBull && !hasRisk) {
      // 有利好事件
      predicted = sec.momentum * 0.02 + 0.5;
      confidence = 45;
      action = sec.shortTermScore > 30 ? "周五申购" : "持有过周末";
      reason = bullishSignals.filter(r => r.impactSectors.includes(sec.sector)).map(r => r.event).slice(0, 2).join("；") || "利好支撑";
    } else if (sec.change5d > 8) {
      // 累涨过多 → 预测回调
      predicted = -(sec.change5d * 0.15);
      confidence = 55;
      action = "周五赎回";
      reason = `本周涨${sec.change5d.toFixed(1)}%，获利回吐压力大`;
    } else if (sec.shortTermScore > 40 && sec.momentum > 30) {
      // 动量强 → 惯性上涨
      predicted = sec.momentum * 0.015;
      confidence = 45;
      action = "持有过周末";
      reason = `动量强劲(${sec.momentum.toFixed(0)})，趋势延续概率大`;
    } else {
      predicted = marketOutlook === "看跌" ? -0.5 : marketOutlook === "看涨" ? 0.3 : 0;
      confidence = 30;
      action = "观望";
      reason = "信号不明确，建议观望";
    }

    // 大盘风险覆盖
    if (marketOutlook === "看跌" && totalBearSeverity > 15) {
      predicted -= 0.5;
      confidence = Math.min(confidence + 10, 80);
      action = "周五赎回";
      reason = "系统性利空风险较大，" + reason;
    }

    for (const fund of otcFunds) {
      fundForecasts.push({
        fundCode: fund.code,
        fundName: fund.name,
        sector: sec.sector,
        predictedChange: Math.round(predicted * 100) / 100,
        confidence: Math.round(confidence),
        action,
        reason,
      });
    }
  }

  // 排序：赎回在前、申购其次
  const actOrder: Record<string, number> = { "周五赎回": 0, "周五申购": 1, "持有过周末": 2, "观望": 3 };
  fundForecasts.sort((a, b) => (actOrder[a.action] ?? 9) - (actOrder[b.action] ?? 9) || b.confidence - a.confidence);

  const shouldReduce = marketOutlook === "看跌" || totalBearSeverity > 15 || bearishRisks.some(r => r.severity >= 8);

  let overallAdvice: string;
  if (shouldReduce) {
    overallAdvice = `⚠️ 周末风险较大，建议周五收盘前减仓至3成以下。${bearishRisks.slice(0, 2).map(r => r.event).join("；")}`;
  } else if (marketOutlook === "看涨") {
    overallAdvice = `周一偏乐观，优质板块可持仓过周末。重点关注${primary.sector}${secondary ? `和${secondary.sector}` : ""}。`;
  } else {
    overallAdvice = `周一方向不明，建议保持5成仓位过周末，锁定部分利润。`;
  }

  return {
    marketOutlook,
    marketReason,
    weekendRisks: weekendRisks.slice(0, 8),
    fundForecasts,
    overallAdvice,
    shouldReduceBeforeWeekend: shouldReduce,
  };
}
