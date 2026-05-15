/**
 * 因子IC（信息系数）检验
 *
 * 对每个因子计算:
 *   - Rank IC: 因子值截面排名与未来N日收益排名的斯皮尔曼相关系数
 *   - IC均值 / IC标准差 / ICIR（IC的夏普）
 *   - IC胜率（IC>0的天数占比）
 *   - 因子衰减速度（1日/3日/5日IC对比）
 *
 * 用于判断哪些因子真正有预测力，剔除噪音因子
 */

import * as fs from "fs";
import * as path from "path";
import { kvLoad, kvSave } from "./kv-store";
import type { KLineData, EnrichedSectorData, NorthboundFlow } from "./stock-api";
import { calcRawFactors, FACTOR_DEFS, type RawFactors } from "./quant-engine";

// ================================================================
//  类型定义
// ================================================================

export interface FactorICResult {
  factorName: string;
  factorKey: string;
  category: string;
  // IC统计
  ic1d: number;          // 未来1日收益 Rank IC
  ic3d: number;          // 未来3日收益 Rank IC
  ic5d: number;          // 未来5日收益 Rank IC
  icMean: number;        // IC均值（多日平均）
  icStd: number;         // IC标准差
  icir: number;          // ICIR = IC均值/IC标准差
  icWinRate: number;     // IC>0的天数占比%
  // 判定
  effective: boolean;    // 是否有效因子
  grade: "A" | "B" | "C" | "D"; // A=强有效, B=有效, C=弱, D=无效/噪音
  comment: string;
}

export interface ICAnalysisReport {
  analyzedDays: number;
  totalFactors: number;
  effectiveFactors: number;
  gradeA: FactorICResult[];
  gradeB: FactorICResult[];
  gradeC: FactorICResult[];
  gradeD: FactorICResult[];
  allResults: FactorICResult[];
  recommendation: string;
}

// ================================================================
//  IC计算核心
// ================================================================

/**
 * 跑IC检验：用历史K线滑动窗口计算每日截面IC
 */
export function analyzeFactorIC(
  klineMap: Record<string, KLineData[]>,
  northbound: NorthboundFlow[],
  marketChanges: number[], // 每日大盘涨跌
): ICAnalysisReport {
  const codes = Object.keys(klineMap);
  if (codes.length < 5) return emptyReport();

  // 提取所有交易日
  const allDates = extractSortedDates(klineMap);
  if (allDates.length < 30) return emptyReport();

  // 为每一天、每只ETF计算因子值
  // dailyFactors[dateIdx][code] = RawFactors
  const dailyFactors: Map<number, Map<string, RawFactors>> = new Map();
  const dailyReturns: Map<string, number[]> = new Map(); // code -> daily returns indexed by date

  // 构建每日收益率
  for (const code of codes) {
    const klines = klineMap[code];
    const rets: number[] = [];
    for (let i = 0; i < allDates.length; i++) {
      const k = klines.find(k => k.date === allDates[i]);
      const kPrev = i > 0 ? klines.find(k => k.date === allDates[i - 1]) : null;
      if (k && kPrev && kPrev.close > 0) {
        rets.push(((k.close - kPrev.close) / kPrev.close) * 100);
      } else {
        rets.push(0);
      }
    }
    dailyReturns.set(code, rets);
  }

  // 从第21天开始计算因子（需要20天窗口）
  for (let i = 20; i < allDates.length - 5; i++) {
    const factorMap = new Map<string, RawFactors>();
    for (const code of codes) {
      const klines = klineMap[code];
      const windowKlines = klines.filter(k => k.date <= allDates[i]).slice(-60);
      if (windowKlines.length < 20) continue;
      const mc = marketChanges[Math.min(i, marketChanges.length - 1)] || 0;
      factorMap.set(code, calcRawFactors(windowKlines, null, northbound, mc));
    }
    dailyFactors.set(i, factorMap);
  }

  // 对每个因子计算IC序列
  const results: FactorICResult[] = [];

  for (const fd of FACTOR_DEFS) {
    const ic1dSeries: number[] = [];
    const ic3dSeries: number[] = [];
    const ic5dSeries: number[] = [];

    for (let i = 20; i < allDates.length - 5; i++) {
      const factorMap = dailyFactors.get(i);
      if (!factorMap || factorMap.size < 5) continue;

      // 截面数据：各ETF的因子值和未来收益
      const entries: { code: string; factorVal: number; ret1d: number; ret3d: number; ret5d: number }[] = [];

      for (const [code, factors] of factorMap) {
        const rets = dailyReturns.get(code);
        if (!rets) continue;
        const r1 = rets[i + 1] || 0;
        const r3 = (rets[i + 1] || 0) + (rets[i + 2] || 0) + (rets[i + 3] || 0);
        const r5 = r3 + (rets[i + 4] || 0) + (rets[i + 5] || 0);
        entries.push({
          code,
          factorVal: factors[fd.key] as number,
          ret1d: r1, ret3d: r3, ret5d: r5,
        });
      }

      if (entries.length < 5) continue;

      // Rank IC = Spearman correlation
      const factorVals = entries.map(e => e.factorVal);
      const ic1 = spearmanCorrelation(factorVals, entries.map(e => e.ret1d));
      const ic3 = spearmanCorrelation(factorVals, entries.map(e => e.ret3d));
      const ic5 = spearmanCorrelation(factorVals, entries.map(e => e.ret5d));

      if (!isNaN(ic1)) ic1dSeries.push(ic1);
      if (!isNaN(ic3)) ic3dSeries.push(ic3);
      if (!isNaN(ic5)) ic5dSeries.push(ic5);
    }

    const ic1d = mean(ic1dSeries);
    const ic3d = mean(ic3dSeries);
    const ic5d = mean(ic5dSeries);

    // 如果higherIsBetter=false，好的因子IC应该是负的，取绝对值方向修正
    const dirSign = fd.higherIsBetter ? 1 : -1;
    const dirIc1 = ic1d * dirSign;
    const dirIc3 = ic3d * dirSign;
    const dirIc5 = ic5d * dirSign;

    const icMean = mean([dirIc1, dirIc3, dirIc5]);
    const icStd = stdDev(ic1dSeries.map(v => v * dirSign));
    const icir = icStd > 0 ? icMean / icStd : 0;
    const icWinRate = ic1dSeries.length > 0
      ? (ic1dSeries.filter(v => v * dirSign > 0).length / ic1dSeries.length) * 100 : 50;

    // 评级
    let grade: "A" | "B" | "C" | "D";
    let effective: boolean;
    let comment: string;

    if (Math.abs(icMean) > 0.05 && icir > 0.5 && icWinRate > 55) {
      grade = "A"; effective = true;
      comment = `强有效因子: IC均值${(icMean * 100).toFixed(1)}%, ICIR=${icir.toFixed(2)}, 胜率${icWinRate.toFixed(0)}%`;
    } else if (Math.abs(icMean) > 0.03 && icir > 0.3) {
      grade = "B"; effective = true;
      comment = `有效因子: IC均值${(icMean * 100).toFixed(1)}%, ICIR=${icir.toFixed(2)}`;
    } else if (Math.abs(icMean) > 0.02 || icir > 0.2) {
      grade = "C"; effective = false;
      comment = `弱因子: IC${(icMean * 100).toFixed(1)}%, 建议降权`;
    } else {
      grade = "D"; effective = false;
      comment = `无效/噪音因子: IC≈0, 建议剔除`;
    }

    results.push({
      factorName: fd.name, factorKey: fd.key, category: fd.category,
      ic1d: r4(dirIc1), ic3d: r4(dirIc3), ic5d: r4(dirIc5),
      icMean: r4(icMean), icStd: r4(icStd), icir: r4(icir),
      icWinRate: r2(icWinRate),
      effective, grade, comment,
    });
  }

  results.sort((a, b) => Math.abs(b.icMean) - Math.abs(a.icMean));

  const gradeA = results.filter(r => r.grade === "A");
  const gradeB = results.filter(r => r.grade === "B");
  const gradeC = results.filter(r => r.grade === "C");
  const gradeD = results.filter(r => r.grade === "D");

  const recommendation = [
    gradeA.length > 0 ? `A级因子(${gradeA.length}): ${gradeA.map(r => r.factorName).join("、")}` : "",
    gradeB.length > 0 ? `B级因子(${gradeB.length}): ${gradeB.map(r => r.factorName).join("、")}` : "",
    gradeD.length > 0 ? `建议剔除(${gradeD.length}): ${gradeD.map(r => r.factorName).join("、")}` : "",
  ].filter(Boolean).join(" | ");

  return {
    analyzedDays: allDates.length - 25,
    totalFactors: results.length,
    effectiveFactors: results.filter(r => r.effective).length,
    gradeA, gradeB, gradeC, gradeD,
    allResults: results,
    recommendation,
  };
}

// ================================================================
//  数学工具
// ================================================================

function rank(arr: number[]): number[] {
  const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  for (let i = 0; i < sorted.length; i++) {
    ranks[sorted[i].i] = i + 1;
  }
  // 处理平局（平均排名）
  let j = 0;
  while (j < sorted.length) {
    let k = j;
    while (k < sorted.length && sorted[k].v === sorted[j].v) k++;
    const avgRank = (j + k + 1) / 2; // 1-indexed avg
    for (let m = j; m < k; m++) {
      ranks[sorted[m].i] = avgRank;
    }
    j = k;
  }
  return ranks;
}

function spearmanCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 3) return NaN;
  const rx = rank(x);
  const ry = rank(y);
  return pearsonCorrelation(rx, ry);
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let cov = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    cov += dx * dy;
    sx += dx * dx;
    sy += dy * dy;
  }
  const denom = Math.sqrt(sx * sy);
  return denom > 0 ? cov / denom : 0;
}

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function extractSortedDates(klineMap: Record<string, KLineData[]>): string[] {
  const dateSet = new Set<string>();
  for (const klines of Object.values(klineMap)) {
    for (const k of klines) dateSet.add(k.date);
  }
  return [...dateSet].sort();
}

function r2(n: number): number { return Math.round(n * 100) / 100; }
function r4(n: number): number { return Math.round(n * 10000) / 10000; }

function emptyReport(): ICAnalysisReport {
  return {
    analyzedDays: 0, totalFactors: 0, effectiveFactors: 0,
    gradeA: [], gradeB: [], gradeC: [], gradeD: [],
    allResults: [], recommendation: "数据不足，无法进行IC检验",
  };
}

// ================================================================
//  IC → 因子权重调节器
// ================================================================

export interface ICWeightAdjustment {
  factorKey: string;
  multiplier: number;  // 权重乘数 (0.3~1.5)
  reason: string;
}

/**
 * 根据IC检验结果生成因子权重调节表
 * A级: ×1.3, B级: ×1.1, C级: ×0.6, D级: ×0.3
 * ICIR额外加成：ICIR>1.5 → 再×1.15
 */
export function calcICWeightAdjustments(report: ICAnalysisReport): Map<string, ICWeightAdjustment> {
  const result = new Map<string, ICWeightAdjustment>();
  if (report.analyzedDays < 10 || report.allResults.length === 0) return result;

  for (const r of report.allResults) {
    let multiplier: number;
    let reason: string;

    switch (r.grade) {
      case "A":
        multiplier = 1.3;
        reason = `A级因子(IC=${(r.icMean * 100).toFixed(1)}%,ICIR=${r.icir.toFixed(2)})`;
        if (r.icir > 1.5) { multiplier = 1.45; reason += ",超强ICIR"; }
        break;
      case "B":
        multiplier = 1.1;
        reason = `B级因子(IC=${(r.icMean * 100).toFixed(1)}%)`;
        if (r.icir > 1.0) { multiplier = 1.2; reason += ",良好ICIR"; }
        break;
      case "C":
        multiplier = 0.6;
        reason = `C级弱因子(IC=${(r.icMean * 100).toFixed(1)}%),降权`;
        break;
      case "D":
        multiplier = 0.3;
        reason = `D级噪音因子,大幅降权`;
        break;
    }

    // IC胜率额外调节
    if (r.icWinRate > 65 && multiplier < 1.5) {
      multiplier *= 1.05;
      reason += `,胜率${r.icWinRate.toFixed(0)}%`;
    } else if (r.icWinRate < 40) {
      multiplier *= 0.85;
      reason += `,低胜率${r.icWinRate.toFixed(0)}%`;
    }

    result.set(r.factorKey, {
      factorKey: r.factorKey,
      multiplier: Math.round(Math.max(0.3, Math.min(1.5, multiplier)) * 100) / 100,
      reason,
    });
  }

  return result;
}

// IC结果持久化
export async function saveICWeights(adjustments: Map<string, ICWeightAdjustment>, report: ICAnalysisReport): Promise<void> {
  return kvSave("ic-weights", {
    timestamp: new Date().toISOString(),
    analyzedDays: report.analyzedDays,
    effectiveFactors: report.effectiveFactors,
    adjustments: Object.fromEntries(adjustments),
  });
}

export async function loadICWeights(): Promise<Map<string, ICWeightAdjustment>> {
  const data = await kvLoad<{ adjustments: Record<string, ICWeightAdjustment> }>("ic-weights", { adjustments: {} });
  return new Map(Object.entries(data.adjustments || {}));
}
