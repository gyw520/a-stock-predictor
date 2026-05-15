/**
 * 策略绩效自评估系统
 *
 * 功能：
 *   - 记录每个策略在不同市场状态(regime)下的历史信号准确度
 *   - 计算策略近N日胜率
 *   - 动态调整策略矩阵权重（连续正确→加权，连续错误→降权）
 *
 * 持久化到 .data/strategy-perf.json
 */

import * as fs from "fs";
import * as path from "path";
import { kvLoad, kvSave } from "./kv-store";
import type { StrategyName, MarketRegime } from "./quant-engine";

// ================================================================
//  类型定义
// ================================================================

export interface StrategyRecord {
  date: string;
  strategy: StrategyName;
  regime: MarketRegime;
  direction: "long" | "short" | "neutral";
  strength: number;
  code: string;
  // 事后验证（由后续调用填入）
  actualReturn1d?: number;  // 次日实际收益%
  actualReturn3d?: number;  // 3日实际收益%
  correct?: boolean;         // 方向是否正确
}

export interface StrategyPerfSummary {
  strategy: StrategyName;
  regime: MarketRegime;
  totalSignals: number;
  correctSignals: number;
  winRate: number;          // 0-100
  avgReturn: number;        // 正确信号的平均收益
  recentWinRate: number;    // 近10次胜率
  weightMultiplier: number; // 建议的权重乘数 (0.5~1.5)
}

export interface StrategyPerfState {
  records: StrategyRecord[];
  lastUpdateDate: string;
}

// ================================================================
//  持久化
// ================================================================

const MAX_RECORDS = 500;

async function loadPerfState(): Promise<StrategyPerfState> {
  return kvLoad("strategy-perf", { records: [], lastUpdateDate: "" } as StrategyPerfState);
}

async function savePerfState(state: StrategyPerfState): Promise<void> {
  state.records = state.records.slice(-MAX_RECORDS);
  return kvSave("strategy-perf", state);
}

// ================================================================
//  记录策略信号
// ================================================================

/**
 * 记录今日各策略信号（每日调仓后调用）
 */
export async function recordStrategySignals(
  signals: { code: string; strategy: StrategyName; direction: "long" | "short" | "neutral"; strength: number }[],
  regime: MarketRegime,
  date: string,
) {
  const state = await loadPerfState();

  // 避免同日重复记录
  if (state.lastUpdateDate === date) return;

  for (const s of signals) {
    if (s.direction === "neutral") continue; // 不记录观望信号
    state.records.push({
      date,
      strategy: s.strategy,
      regime,
      direction: s.direction,
      strength: s.strength,
      code: s.code,
    });
  }

  state.lastUpdateDate = date;
  await savePerfState(state);
}

/**
 * 用实际收益验证过去未验证的信号（每日开盘后调用）
 */
export async function verifyStrategySignals(
  returns: Map<string, { ret1d: number; ret3d: number }>, // code -> 实际收益
) {
  const state = await loadPerfState();
  let updated = false;

  for (const rec of state.records) {
    if (rec.correct !== undefined) continue; // 已验证
    const ret = returns.get(rec.code);
    if (!ret) continue;

    rec.actualReturn1d = ret.ret1d;
    rec.actualReturn3d = ret.ret3d;
    // 方向正确判定
    if (rec.direction === "long") {
      rec.correct = ret.ret1d > 0;
    } else {
      rec.correct = ret.ret1d < 0;
    }
    updated = true;
  }

  if (updated) await savePerfState(state);
}

// ================================================================
//  计算策略权重调整
// ================================================================

/**
 * 计算各策略在各regime下的动态权重乘数
 */
export async function calcStrategyWeightAdj(): Promise<Map<string, number>> {
  const state = await loadPerfState();
  const verified = state.records.filter(r => r.correct !== undefined);
  if (verified.length < 10) return new Map(); // 数据不足

  // 按 strategy+regime 分组
  const groups = new Map<string, StrategyRecord[]>();
  for (const r of verified) {
    const key = `${r.strategy}|${r.regime}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const result = new Map<string, number>();

  for (const [key, records] of groups) {
    const total = records.length;
    const correct = records.filter(r => r.correct).length;
    const winRate = total > 0 ? correct / total : 0.5;

    // 近10次胜率（更灵敏）
    const recent = records.slice(-10);
    const recentWin = recent.filter(r => r.correct).length / recent.length;

    // 综合胜率 = 60%近期 + 40%全局
    const compositeWinRate = recentWin * 0.6 + winRate * 0.4;

    // 权重乘数映射: 胜率30%→×0.5, 50%→×1.0, 70%→×1.5
    let multiplier: number;
    if (compositeWinRate >= 0.7) multiplier = 1.5;
    else if (compositeWinRate >= 0.6) multiplier = 1.2;
    else if (compositeWinRate >= 0.5) multiplier = 1.0;
    else if (compositeWinRate >= 0.4) multiplier = 0.8;
    else multiplier = 0.5;

    result.set(key, multiplier);
  }

  return result;
}

/**
 * 获取格式化的策略绩效报告
 */
export async function getStrategyPerfReport(): Promise<StrategyPerfSummary[]> {
  const state = await loadPerfState();
  const verified = state.records.filter(r => r.correct !== undefined);
  if (verified.length < 5) return [];

  const groups = new Map<string, StrategyRecord[]>();
  for (const r of verified) {
    const key = `${r.strategy}|${r.regime}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const results: StrategyPerfSummary[] = [];
  for (const [key, records] of groups) {
    const [strategy, regime] = key.split("|") as [StrategyName, MarketRegime];
    const total = records.length;
    const correct = records.filter(r => r.correct).length;
    const winRate = total > 0 ? (correct / total) * 100 : 50;

    const recent = records.slice(-10);
    const recentWin = (recent.filter(r => r.correct).length / recent.length) * 100;

    const correctReturns = records.filter(r => r.correct && r.actualReturn1d != null).map(r => r.actualReturn1d!);
    const avgReturn = correctReturns.length > 0 ? correctReturns.reduce((s, v) => s + v, 0) / correctReturns.length : 0;

    const compositeWinRate = recentWin * 0.6 + winRate * 0.4;
    let weightMultiplier: number;
    if (compositeWinRate >= 70) weightMultiplier = 1.5;
    else if (compositeWinRate >= 60) weightMultiplier = 1.2;
    else if (compositeWinRate >= 50) weightMultiplier = 1.0;
    else if (compositeWinRate >= 40) weightMultiplier = 0.8;
    else weightMultiplier = 0.5;

    results.push({
      strategy, regime,
      totalSignals: total,
      correctSignals: correct,
      winRate: Math.round(winRate),
      avgReturn: Math.round(avgReturn * 100) / 100,
      recentWinRate: Math.round(recentWin),
      weightMultiplier,
    });
  }

  return results.sort((a, b) => b.winRate - a.winRate);
}
