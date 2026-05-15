/**
 * 参数自动反馈系统
 *
 * 功能：
 *   - 从Walk-Forward回测结果中提取鲁棒参数
 *   - 与当前引擎参数比对，生成微调建议
 *   - 持久化最优参数供引擎自动加载
 *   - 安全边界：变动幅度限制在±30%，防止突变
 *
 * 持久化到 .data/param-feedback.json
 */

import { kvLoad, kvSave } from "./kv-store";
import type { BacktestConfig, WalkForwardResult } from "./backtest";

// ================================================================
//  类型定义
// ================================================================

export interface ParamFeedback {
  timestamp: string;
  source: "walk-forward" | "manual";
  robustParams: Partial<BacktestConfig>;
  confidence: number;             // 0-100 参数可信度
  overfitRatio: number;           // 过拟合比率（越接近1越好）
  stabilityScore: number;         // 参数稳定性评分 0-100
  adjustedParams: EngineThresholds;  // 映射到引擎的实际阈值
  appliedDate: string;
}

export interface EngineThresholds {
  buyScoreThreshold: number;      // 做多阈值 (对应buyThreshold)
  sellScoreThreshold: number;     // 卖出阈值 (对应sellThreshold)
  stopLossPct: number;            // 止损%
  takeProfitPct: number;          // 止盈%
  trailingStopPct: number;        // 移动止损%
  maxHoldings: number;            // 最大持仓数
  positionSizeMultiplier: number; // 仓位大小系数 0.5-1.5
}

export interface ParamAdjustment {
  param: string;
  currentValue: number;
  suggestedValue: number;
  change: number;                 // 变化幅度%
  reason: string;
  safe: boolean;                  // 是否在安全边界内
}

// ================================================================
//  默认引擎参数
// ================================================================

const DEFAULT_THRESHOLDS: EngineThresholds = {
  buyScoreThreshold: 12,          // 降低门槛→更多交易机会
  sellScoreThreshold: -5,
  stopLossPct: 5,
  takeProfitPct: 8,
  trailingStopPct: 3,
  maxHoldings: 3,
  positionSizeMultiplier: 1.1,    // 提高仓位系数→更积极
};

const MAX_CHANGE_PCT = 30; // 单次调整最大幅度30%

// ================================================================
//  核心逻辑
// ================================================================

/**
 * 从Walk-Forward结果生成参数反馈
 */
export async function generateParamFeedback(wfResult: WalkForwardResult): Promise<ParamFeedback | null> {
  if (wfResult.windows.length < 2) return null;

  const { robustParams, avgOverfitRatio, paramStability } = wfResult;

  // 参数稳定性评分（基于变异系数CV）
  const avgCV = paramStability.length > 0
    ? paramStability.reduce((s, p) => s + p.cv, 0) / paramStability.length
    : 1;
  const stabilityScore = Math.round(Math.max(0, Math.min(100, (1 - avgCV) * 100)));

  // 可信度 = 过拟合比率 × 稳定性 × 窗口数权重
  const windowWeight = Math.min(1, wfResult.windows.length / 5); // 至少5个窗口才满分
  const confidence = Math.round(
    avgOverfitRatio * stabilityScore * windowWeight
  );

  // 仅当可信度>30时才生成反馈
  if (confidence < 30) return null;

  // 映射到引擎阈值（带安全限制）
  const current = await loadCurrentThresholds();
  const adjustedParams = mapToEngineThresholds(robustParams, confidence, current);

  const feedback: ParamFeedback = {
    timestamp: new Date().toISOString(),
    source: "walk-forward",
    robustParams,
    confidence,
    overfitRatio: avgOverfitRatio,
    stabilityScore,
    adjustedParams,
    appliedDate: new Date().toISOString().slice(0, 10),
  };

  return feedback;
}

/**
 * 将回测最优参数映射到引擎阈值，带安全边界
 */
function mapToEngineThresholds(params: Partial<BacktestConfig>, confidence: number, current: EngineThresholds): EngineThresholds {
  // 调整力度与可信度正相关：高可信度→调整幅度更大
  const adjustFactor = Math.min(1, confidence / 80); // 可信度80时完全采纳

  const adjusted: EngineThresholds = { ...current };

  if (params.buyThreshold !== undefined) {
    adjusted.buyScoreThreshold = safeAdjust(current.buyScoreThreshold, params.buyThreshold, adjustFactor);
  }
  if (params.sellThreshold !== undefined) {
    adjusted.sellScoreThreshold = safeAdjust(current.sellScoreThreshold, params.sellThreshold, adjustFactor);
  }
  if (params.stopLossPct !== undefined) {
    adjusted.stopLossPct = safeAdjust(current.stopLossPct, params.stopLossPct, adjustFactor);
  }
  if (params.takeProfitPct !== undefined) {
    adjusted.takeProfitPct = safeAdjust(current.takeProfitPct, params.takeProfitPct, adjustFactor);
  }
  if (params.trailingStopPct !== undefined) {
    adjusted.trailingStopPct = safeAdjust(current.trailingStopPct, params.trailingStopPct, adjustFactor);
  }
  if (params.maxHoldings !== undefined) {
    adjusted.maxHoldings = Math.round(safeAdjust(current.maxHoldings, params.maxHoldings, adjustFactor));
  }

  // 仓位系数基于过拟合比率: 高过拟合→缩小仓位
  if (confidence < 50) {
    adjusted.positionSizeMultiplier = 0.8;
  } else if (confidence > 70) {
    adjusted.positionSizeMultiplier = 1.1;
  }

  return adjusted;
}

/**
 * 安全调整：限制单次变动幅度
 */
function safeAdjust(current: number, target: number, factor: number): number {
  const diff = target - current;
  const maxChange = Math.abs(current) * (MAX_CHANGE_PCT / 100);
  const clampedDiff = Math.max(-maxChange, Math.min(maxChange, diff));
  return Math.round((current + clampedDiff * factor) * 100) / 100;
}

/**
 * 生成人可读的调整建议列表
 */
export async function getParamAdjustments(wfResult: WalkForwardResult): Promise<ParamAdjustment[]> {
  const feedback = await generateParamFeedback(wfResult);
  if (!feedback) return [];

  const current = await loadCurrentThresholds();
  const suggested = feedback.adjustedParams;
  const adjustments: ParamAdjustment[] = [];

  const pairs: { param: string; cur: number; sug: number }[] = [
    { param: "buyScoreThreshold", cur: current.buyScoreThreshold, sug: suggested.buyScoreThreshold },
    { param: "sellScoreThreshold", cur: current.sellScoreThreshold, sug: suggested.sellScoreThreshold },
    { param: "stopLossPct", cur: current.stopLossPct, sug: suggested.stopLossPct },
    { param: "takeProfitPct", cur: current.takeProfitPct, sug: suggested.takeProfitPct },
    { param: "trailingStopPct", cur: current.trailingStopPct, sug: suggested.trailingStopPct },
    { param: "maxHoldings", cur: current.maxHoldings, sug: suggested.maxHoldings },
  ];

  for (const { param, cur, sug } of pairs) {
    if (Math.abs(sug - cur) < 0.01) continue;
    const changePct = cur !== 0 ? ((sug - cur) / Math.abs(cur)) * 100 : 0;
    adjustments.push({
      param,
      currentValue: cur,
      suggestedValue: sug,
      change: Math.round(changePct * 10) / 10,
      reason: getAdjustReason(param, cur, sug, wfResult),
      safe: Math.abs(changePct) <= MAX_CHANGE_PCT,
    });
  }

  return adjustments;
}

function getAdjustReason(param: string, cur: number, sug: number, wf: WalkForwardResult): string {
  const dir = sug > cur ? "提高" : "降低";
  const stability = wf.paramStability.find(p => p.param === param.replace("ScoreThreshold", "Threshold").replace("buyScore", "buy").replace("sellScore", "sell"));
  const cvInfo = stability ? `(CV=${stability.cv})` : "";
  
  switch (param) {
    case "buyScoreThreshold":
      return sug > cur
        ? `${dir}买入门槛，减少低质量信号${cvInfo}`
        : `${dir}买入门槛，增加交易机会${cvInfo}`;
    case "sellScoreThreshold":
      return sug > cur
        ? `${dir}卖出容忍度，更快止损${cvInfo}`
        : `${dir}卖出容忍度，减少频繁交易${cvInfo}`;
    case "stopLossPct":
      return `${dir}止损线至${sug}%，${sug > cur ? "给更多空间" : "更严格风控"}${cvInfo}`;
    case "trailingStopPct":
      return `${dir}移动止损至${sug}%，${sug > cur ? "容忍更大回撤" : "锁定更多利润"}${cvInfo}`;
    default:
      return `Walk-Forward建议${dir}${param}${cvInfo}`;
  }
}

// ================================================================
//  持久化
// ================================================================

export async function loadCurrentThresholds(): Promise<EngineThresholds> {
  const data = await kvLoad<ParamFeedback | null>("param-feedback", null);
  if (data && data.adjustedParams) {
    return data.adjustedParams;
  }
  return { ...DEFAULT_THRESHOLDS };
}

export async function saveParamFeedback(feedback: ParamFeedback): Promise<void> {
  return kvSave("param-feedback", feedback);
}

/**
 * 一键执行：从WF结果生成反馈并持久化
 * 返回调整详情供前端展示
 */
export async function applyWalkForwardFeedback(wfResult: WalkForwardResult): Promise<{
  applied: boolean;
  feedback: ParamFeedback | null;
  adjustments: ParamAdjustment[];
}> {
  const feedback = await generateParamFeedback(wfResult);
  const adjustments = await getParamAdjustments(wfResult);

  if (feedback && feedback.confidence >= 40) {
    saveParamFeedback(feedback);
    return { applied: true, feedback, adjustments };
  }

  return { applied: false, feedback, adjustments };
}
