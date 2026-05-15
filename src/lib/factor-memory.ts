/**
 * 因子时序记忆系统
 *
 * 功能：
 *   - 每日保存量化因子快照
 *   - 计算因子变化率（日环比）
 *   - 计算因子加速度（变化率的变化）
 *   - 生成因子趋势信号
 *
 * 持久化到 .data/factor-snapshots.json
 */

import * as fs from "fs";
import * as path from "path";
import { kvLoad, kvSave } from "./kv-store";
import type { QuantDecision, FactorCategory } from "./quant-engine";

// ================================================================
//  类型定义
// ================================================================

export interface FactorSnapshot {
  date: string;
  code: string;
  name: string;
  sector: string;
  finalScore: number;
  factorComposite: number;
  aiAdjustedScore: number;
  matrixScore: number;
  regime: string;
  categoryScores: Record<string, number>; // 各因子族加权得分
}

export interface FactorDelta {
  code: string;
  name: string;
  sector: string;
  scoreDelta: number;         // finalScore今日-昨日
  scoreAccel: number;         // 变化率的变化（加速度）
  factorDelta: number;        // factorComposite变化
  categoryDeltas: Record<string, number>; // 各因子族变化
  trendDays: number;          // 连续同向天数（正=连续上升，负=连续下降）
  signal: FactorTrendSignal;
}

export type FactorTrendSignal =
  | "加速上升"   // 连续上升 + 加速度>0
  | "稳步上升"   // 连续上升 + 加速度≈0
  | "减速上升"   // 上升中但加速度<0（接近拐点）
  | "拐点向上"   // 从下降转上升
  | "拐点向下"   // 从上升转下降
  | "加速下降"   // 连续下降 + 加速度<0
  | "稳步下降"   // 连续下降
  | "减速下降"   // 下降中但加速度>0（接近反弹）
  | "横盘";

export interface FactorMemoryReport {
  date: string;
  deltas: FactorDelta[];
  topImproving: FactorDelta[];    // 改善最多的
  topDeteriorating: FactorDelta[]; // 恶化最多的
  marketTrend: string;             // 全市场因子趋势描述
  historyDays: number;             // 已积累天数
}

// ================================================================
//  持久化
// ================================================================

const MAX_HISTORY_DAYS = 30;

async function loadSnapshots(): Promise<Record<string, Array<FactorSnapshot>>> {
  const empty: Record<string, Array<FactorSnapshot>> = {};
  return kvLoad("factor-snapshots", empty);
}

async function saveSnapshots(data: Record<string, FactorSnapshot[]>): Promise<void> {
  return kvSave("factor-snapshots", data);
}

// ================================================================
//  快照记录
// ================================================================

export async function recordFactorSnapshot(decisions: QuantDecision[], date?: string): Promise<void> {
  const today = date || new Date().toISOString().slice(0, 10);
  const allSnapshots = await loadSnapshots();

  for (const d of decisions) {
    if (!allSnapshots[d.code]) allSnapshots[d.code] = [];

    // 避免同一天重复记录
    const existing = allSnapshots[d.code];
    if (existing.length > 0 && existing[existing.length - 1].date === today) {
      existing[existing.length - 1] = buildSnapshot(d, today);
    } else {
      existing.push(buildSnapshot(d, today));
    }

    // 保留最近N天
    if (existing.length > MAX_HISTORY_DAYS) {
      allSnapshots[d.code] = existing.slice(-MAX_HISTORY_DAYS);
    }
  }

  await saveSnapshots(allSnapshots);
}

function buildSnapshot(d: QuantDecision, date: string): FactorSnapshot {
  const categoryScores: Record<string, number> = {};
  for (const f of d.factors) {
    categoryScores[f.category] = (categoryScores[f.category] || 0) + f.weighted;
  }
  return {
    date,
    code: d.code,
    name: d.name,
    sector: d.sector,
    finalScore: d.finalScore,
    factorComposite: d.factorComposite,
    aiAdjustedScore: d.aiAdjustedScore,
    matrixScore: d.matrixScore,
    regime: d.regime,
    categoryScores,
  };
}

// ================================================================
//  因子变化率 + 加速度计算
// ================================================================

export async function calcFactorDeltas(decisions: QuantDecision[]): Promise<FactorMemoryReport> {
  const today = new Date().toISOString().slice(0, 10);
  const allSnapshots = await loadSnapshots();
  const deltas: FactorDelta[] = [];

  for (const d of decisions) {
    const history = allSnapshots[d.code] || [];
    if (history.length < 2) {
      deltas.push({
        code: d.code, name: d.name, sector: d.sector,
        scoreDelta: 0, scoreAccel: 0, factorDelta: 0,
        categoryDeltas: {}, trendDays: 0, signal: "横盘",
      });
      continue;
    }

    const prev = history[history.length - 1];
    const prev2 = history.length >= 2 ? history[history.length - 2] : null;

    // 当日变化
    const scoreDelta = d.finalScore - prev.finalScore;
    const factorDelta = d.factorComposite - prev.factorComposite;

    // 加速度：本次变化 vs 上次变化
    const prevDelta = prev2 ? prev.finalScore - prev2.finalScore : 0;
    const scoreAccel = scoreDelta - prevDelta;

    // 各因子族变化
    const categoryDeltas: Record<string, number> = {};
    const currentCatScores: Record<string, number> = {};
    for (const f of d.factors) {
      currentCatScores[f.category] = (currentCatScores[f.category] || 0) + f.weighted;
    }
    for (const cat of Object.keys(currentCatScores)) {
      categoryDeltas[cat] = round2(currentCatScores[cat] - (prev.categoryScores[cat] || 0));
    }

    // 连续同向天数
    let trendDays = scoreDelta > 0 ? 1 : scoreDelta < 0 ? -1 : 0;
    for (let i = history.length - 1; i >= 1; i--) {
      const delta = history[i].finalScore - history[i - 1].finalScore;
      if ((trendDays > 0 && delta > 0) || (trendDays < 0 && delta < 0)) {
        trendDays += trendDays > 0 ? 1 : -1;
      } else {
        break;
      }
    }

    // 趋势信号判定
    const signal = classifyTrend(scoreDelta, scoreAccel, trendDays);

    deltas.push({
      code: d.code, name: d.name, sector: d.sector,
      scoreDelta: round2(scoreDelta),
      scoreAccel: round2(scoreAccel),
      factorDelta: round2(factorDelta),
      categoryDeltas,
      trendDays,
      signal,
    });
  }

  deltas.sort((a, b) => b.scoreDelta - a.scoreDelta);

  const topImproving = deltas.filter(d => d.scoreDelta > 0).slice(0, 5);
  const topDeteriorating = [...deltas].reverse().filter(d => d.scoreDelta < 0).slice(0, 5);

  // 全市场趋势
  const avgDelta = deltas.length > 0 ? deltas.reduce((s, d) => s + d.scoreDelta, 0) / deltas.length : 0;
  const avgAccel = deltas.length > 0 ? deltas.reduce((s, d) => s + d.scoreAccel, 0) / deltas.length : 0;
  const improvingPct = deltas.length > 0 ? (deltas.filter(d => d.scoreDelta > 0).length / deltas.length) * 100 : 50;

  let marketTrend = "";
  if (avgDelta > 3 && avgAccel > 0) marketTrend = `市场因子加速改善(均+${avgDelta.toFixed(1)},${improvingPct.toFixed(0)}%标的走强)`;
  else if (avgDelta > 1) marketTrend = `市场因子温和改善(均+${avgDelta.toFixed(1)})`;
  else if (avgDelta < -3 && avgAccel < 0) marketTrend = `市场因子加速恶化(均${avgDelta.toFixed(1)})`;
  else if (avgDelta < -1) marketTrend = `市场因子温和走弱(均${avgDelta.toFixed(1)})`;
  else marketTrend = `市场因子横盘(均变化${avgDelta.toFixed(1)})`;

  const historyDays = Math.max(...Object.values(allSnapshots).map(h => h.length), 0);

  return { date: today, deltas, topImproving, topDeteriorating, marketTrend, historyDays };
}

function classifyTrend(delta: number, accel: number, trendDays: number): FactorTrendSignal {
  const absDelta = Math.abs(delta);
  if (absDelta < 1 && Math.abs(trendDays) <= 1) return "横盘";

  if (delta > 0) {
    if (trendDays <= -2) return "拐点向上"; // 之前在跌，现在涨
    if (accel > 1) return "加速上升";
    if (accel < -1) return "减速上升";
    return "稳步上升";
  } else {
    if (trendDays >= 2) return "拐点向下"; // 之前在涨，现在跌
    if (accel < -1) return "加速下降";
    if (accel > 1) return "减速下降";
    return "稳步下降";
  }
}

// ================================================================
//  查询历史
// ================================================================

export async function getFactorHistory(code: string, days = 10): Promise<FactorSnapshot[]> {
  const allSnapshots = await loadSnapshots();
  return (allSnapshots[code] || []).slice(-days);
}

export async function getScoreHistory(code: string, days = 10): Promise<{ date: string; score: number }[]> {
  const history = await getFactorHistory(code, days);
  return history.map(s => ({ date: s.date, score: s.finalScore }));
}

// ================================================================
//  工具
// ================================================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
