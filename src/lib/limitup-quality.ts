/**
 * 涨停质量因子评分引擎
 *
 * 7 大因子：
 *  1. 封板时间评分  — 越早封板质量越高
 *  2. 封单比        — 收盘封单金额 / 当日总成交额
 *  3. 是否炸板      — 盘中打开涨停的次数
 *  4. 是否烂板      — 封单极弱 + 多次开板
 *  5. 成交量比      — 当日成交量 / 前5日均量
 *  6. 连板阶段      — 连续涨停天数
 *  7. 收盘封死与否  — 硬性过滤
 *
 * 综合公式：
 *   质量分 = (封板时间 * 权重 + 封单比 * 权重 + 炸板因子) * 成交量比因子 * 烂板惩罚
 *
 * 风控规则：
 *  - 尾盘板(14:56后)禁止
 *  - 极度放量烂板熔断
 *  - 炸板后回封需30分钟冷却
 *  - 质量60-79限仓0.5倍
 *  - 次日涨停打开+换手>15%触发止盈
 */

// ================================================================
//  类型定义
// ================================================================

/** 涨停详情原始数据 */
export interface LimitUpDetail {
  code: string;
  name: string;
  // 封板时间（HH:MM:SS格式，如 "09:35:00"）
  firstSealTime: string;
  // 封单金额（元）
  sealOrderAmount: number;
  // 当日成交额（元）
  totalAmount: number;
  // 盘中打开涨停次数
  openCount: number;
  // 当日成交量（手）
  volume: number;
  // 前5日平均成交量（手）
  avgVolume5d: number;
  // 连板天数
  consecutiveLimitUp: number;
  // 收盘是否封死
  sealedAtClose: boolean;
  // 今日涨停价
  limitPrice: number;
  // 今日收盘价
  closePrice: number;
  // 换手率
  turnoverRate: number;
}

/** 涨停质量评分结果 */
export interface LimitUpQuality {
  code: string;
  name: string;
  // 综合质量分 0-100
  qualityScore: number;
  // 信号等级
  grade: "极优板" | "中等质量板" | "低质量板" | "垃圾板";
  // 各因子详情
  sealTimeScore: number;       // 封板时间评分 0-30
  sealTimeRating: number;      // 1-5 原始评级
  sealRatioScore: number;      // 封单比评分 0-25
  sealRatioPercent: number;    // 封单比%
  openBoardFactor: number;     // 炸板因子 0-1
  openCount: number;           // 炸板次数
  badBoardFactor: number;      // 烂板因子 0-1
  isBadBoard: boolean;
  volumeRatioFactor: number;   // 成交量比因子 0-1
  volumeRatio: number;         // 量比值
  boardStage: number;          // 连板阶段 1/2/3+
  boardStageFactor: number;    // 连板阶段因子
  sealedAtClose: boolean;
  // 风控标记
  riskFlags: string[];
  // 仓位建议倍数 0/0.2/0.5/1.0
  positionMultiplier: number;
  // 详细原因
  reasons: string[];
}

// ================================================================
//  封板时间评分（30分满分）
// ================================================================

function scoreSealTime(firstSealTime: string): { score: number; rating: number } {
  if (!firstSealTime) return { score: 0, rating: 5 };

  const parts = firstSealTime.split(":");
  const hh = parseInt(parts[0] || "15", 10);
  const mm = parseInt(parts[1] || "0", 10);
  const totalMin = hh * 60 + mm;

  // 评级1: 10:00前（含9:30开盘即封）→ 最优
  if (totalMin <= 600) return { score: 30, rating: 1 };
  // 评级2: 10:01-11:30
  if (totalMin <= 690) return { score: 25, rating: 2 };
  // 评级3: 13:00-14:00
  if (totalMin <= 840) return { score: 18, rating: 3 };
  // 评级4: 14:01-14:55
  if (totalMin <= 895) return { score: 10, rating: 4 };
  // 评级5: 14:56-15:00（尾盘板）
  return { score: 5, rating: 5 };
}

// ================================================================
//  封单比评分（25分满分）
// ================================================================

function scoreSealRatio(sealOrderAmount: number, totalAmount: number): { score: number; percent: number } {
  if (totalAmount <= 0) return { score: 0, percent: 0 };
  const ratio = (sealOrderAmount / totalAmount) * 100;

  // 0级: <0.5%
  if (ratio < 0.5) return { score: 5, percent: ratio };
  // 1级: 0.5%-2%
  if (ratio < 2) return { score: 12, percent: ratio };
  // 2级: 2%-5%
  if (ratio < 5) return { score: 20, percent: ratio };
  // 3级: >5%
  return { score: 25, percent: ratio };
}

// ================================================================
//  炸板因子（乘数）
// ================================================================

function calcOpenBoardFactor(openCount: number): number {
  if (openCount === 0) return 1.0;
  if (openCount === 1) return 0.6;
  return 0.3; // ≥2次
}

// ================================================================
//  烂板因子（乘数）
// ================================================================

function calcBadBoardFactor(sealOrderAmount: number, totalAmount: number, openCount: number): { factor: number; isBad: boolean } {
  if (totalAmount <= 0) return { factor: 1.0, isBad: false };
  const sealRatio = (sealOrderAmount / totalAmount) * 100;
  // 烂板定义：封单比<0.5% 且 开板≥2次
  if (sealRatio < 0.5 && openCount >= 2) {
    return { factor: 0.2, isBad: true };
  }
  return { factor: 1.0, isBad: false };
}

// ================================================================
//  成交量比因子（乘数）
// ================================================================

function calcVolumeRatioFactor(volume: number, avgVolume5d: number): { factor: number; ratio: number } {
  if (avgVolume5d <= 0) return { factor: 1.0, ratio: 1.0 };
  const ratio = volume / avgVolume5d;

  // 0级: <0.8 缩量
  if (ratio < 0.8) return { factor: 1.0, ratio };
  // 1级: 0.8-1.2 正常
  if (ratio <= 1.2) return { factor: 1.0, ratio };
  // 2级: 1.2-2.0 温和放量
  if (ratio <= 2.0) return { factor: 0.7, ratio };
  // 3级: >2.0 极度放量（出货嫌疑）
  return { factor: 0.4, ratio };
}

// ================================================================
//  连板阶段因子
// ================================================================

function calcBoardStageFactor(consecutiveLimitUp: number): number {
  if (consecutiveLimitUp <= 1) return 1.0;
  if (consecutiveLimitUp === 2) return 1.0;
  return 0.9; // 三板及以上风险上升
}

// ================================================================
//  风控规则
// ================================================================

function checkRiskRules(detail: LimitUpDetail, sealRatioPercent: number, volumeRatio: number): string[] {
  const flags: string[] = [];

  // 1. 禁止追尾盘板
  if (detail.firstSealTime) {
    const parts = detail.firstSealTime.split(":");
    const totalMin = parseInt(parts[0] || "15", 10) * 60 + parseInt(parts[1] || "0", 10);
    if (totalMin >= 896) { // 14:56+
      flags.push("⛔尾盘板禁入");
    }
  }

  // 2. 极度放量烂板熔断
  if (volumeRatio > 2.5 && sealRatioPercent < 0.3) {
    flags.push("🚫极度放量烂板熔断");
  }

  // 3. 炸板后回封需冷却
  if (detail.openCount >= 1) {
    flags.push("⏳炸板回封需冷却观察");
  }

  // 4. 三板以上高风险
  if (detail.consecutiveLimitUp >= 3) {
    flags.push("⚠️三板以上高风险");
  }

  return flags;
}

// ================================================================
//  主评分函数
// ================================================================

/**
 * 计算单只涨停股的质量分
 */
export function scoreLimitUpQuality(detail: LimitUpDetail): LimitUpQuality {
  const reasons: string[] = [];

  // 硬性过滤：未封死直接剔除
  if (!detail.sealedAtClose) {
    return {
      code: detail.code,
      name: detail.name,
      qualityScore: 0,
      grade: "垃圾板",
      sealTimeScore: 0, sealTimeRating: 5,
      sealRatioScore: 0, sealRatioPercent: 0,
      openBoardFactor: 0, openCount: detail.openCount,
      badBoardFactor: 0, isBadBoard: true,
      volumeRatioFactor: 0, volumeRatio: 0,
      boardStage: detail.consecutiveLimitUp, boardStageFactor: 0,
      sealedAtClose: false,
      riskFlags: ["❌收盘未封死，直接剔除"],
      positionMultiplier: 0,
      reasons: ["收盘未封死涨停"],
    };
  }

  // 1. 封板时间
  const { score: sealTimeScore, rating: sealTimeRating } = scoreSealTime(detail.firstSealTime);
  if (sealTimeRating === 1) reasons.push("早盘封板(极优)");
  else if (sealTimeRating === 2) reasons.push("上午封板");
  else if (sealTimeRating === 3) reasons.push("午后封板");
  else if (sealTimeRating === 4) reasons.push("尾盘前封板");
  else reasons.push("尾盘封板(劣)");

  // 2. 封单比
  const { score: sealRatioScore, percent: sealRatioPercent } = scoreSealRatio(
    detail.sealOrderAmount, detail.totalAmount
  );
  if (sealRatioPercent >= 5) reasons.push(`封单比${sealRatioPercent.toFixed(1)}%(极强)`);
  else if (sealRatioPercent >= 2) reasons.push(`封单比${sealRatioPercent.toFixed(1)}%(强)`);
  else if (sealRatioPercent >= 0.5) reasons.push(`封单比${sealRatioPercent.toFixed(1)}%(一般)`);
  else reasons.push(`封单比${sealRatioPercent.toFixed(2)}%(弱)`);

  // 3. 炸板因子
  const openBoardFactor = calcOpenBoardFactor(detail.openCount);
  if (detail.openCount === 0) reasons.push("未炸板");
  else if (detail.openCount === 1) reasons.push("炸板1次");
  else reasons.push(`炸板${detail.openCount}次(差)`);

  // 4. 烂板因子
  const { factor: badBoardFactor, isBad: isBadBoard } = calcBadBoardFactor(
    detail.sealOrderAmount, detail.totalAmount, detail.openCount
  );
  if (isBadBoard) reasons.push("烂板(次日大概率低开)");

  // 5. 成交量比
  const { factor: volumeRatioFactor, ratio: volumeRatio } = calcVolumeRatioFactor(
    detail.volume, detail.avgVolume5d
  );
  if (volumeRatio > 2.0) reasons.push(`量比${volumeRatio.toFixed(1)}(极度放量)`);
  else if (volumeRatio > 1.2) reasons.push(`量比${volumeRatio.toFixed(1)}(温和放量)`);
  else reasons.push(`量比${volumeRatio.toFixed(1)}`);

  // 6. 连板阶段
  const boardStageFactor = calcBoardStageFactor(detail.consecutiveLimitUp);
  if (detail.consecutiveLimitUp >= 3) reasons.push(`${detail.consecutiveLimitUp}连板(高风险)`);
  else if (detail.consecutiveLimitUp === 2) reasons.push("二板");
  else reasons.push("首板");

  // ======= 综合评分 =======
  // 基础分 = 封板时间(30) + 封单比(25) = 最高55分
  const baseScore = sealTimeScore + sealRatioScore;
  // 乘以各因子
  const rawScore = baseScore * openBoardFactor * volumeRatioFactor * badBoardFactor * boardStageFactor;
  // 归一化到 0-100
  const maxPossible = 55; // 30 + 25
  const qualityScore = Math.round(Math.min(100, (rawScore / maxPossible) * 100));

  // 信号等级
  let grade: LimitUpQuality["grade"];
  if (qualityScore >= 80) grade = "极优板";
  else if (qualityScore >= 60) grade = "中等质量板";
  else if (qualityScore >= 40) grade = "低质量板";
  else grade = "垃圾板";

  // 风控
  const riskFlags = checkRiskRules(detail, sealRatioPercent, volumeRatio);

  // 仓位倍数
  let positionMultiplier = 1.0;
  if (qualityScore < 40 || riskFlags.some(f => f.includes("⛔") || f.includes("🚫"))) {
    positionMultiplier = 0;
  } else if (qualityScore < 60) {
    positionMultiplier = 0.2;
  } else if (qualityScore < 80) {
    positionMultiplier = 0.5;
  }

  return {
    code: detail.code,
    name: detail.name,
    qualityScore,
    grade,
    sealTimeScore, sealTimeRating,
    sealRatioScore, sealRatioPercent,
    openBoardFactor, openCount: detail.openCount,
    badBoardFactor, isBadBoard,
    volumeRatioFactor, volumeRatio,
    boardStage: detail.consecutiveLimitUp, boardStageFactor,
    sealedAtClose: detail.sealedAtClose,
    riskFlags,
    positionMultiplier,
    reasons,
  };
}

// ================================================================
//  批量评分
// ================================================================

/**
 * 批量计算涨停质量分
 * @returns 按质量分降序排列，已过滤掉"未封死"的
 */
export function batchScoreLimitUpQuality(details: LimitUpDetail[]): LimitUpQuality[] {
  return details
    .map(d => scoreLimitUpQuality(d))
    .filter(q => q.sealedAtClose) // 过滤未封死
    .sort((a, b) => b.qualityScore - a.qualityScore);
}

// ================================================================
//  风控：次日止盈判断
// ================================================================

/**
 * 次日止盈触发检查
 * 条件：买入后次日涨停打开且换手率>15%
 */
export function shouldStopProfit(params: {
  isLimitUpOpen: boolean;    // 今日曾触涨停但打开
  turnoverRate: number;      // 今日换手率
  changePercent: number;     // 今日涨幅
}): { trigger: boolean; reason: string } {
  if (params.isLimitUpOpen && params.turnoverRate > 15) {
    return {
      trigger: true,
      reason: `涨停打开+换手${params.turnoverRate.toFixed(1)}%>15%，触发移动止盈`,
    };
  }
  return { trigger: false, reason: "" };
}

// ================================================================
//  格式化输出（用于通知）
// ================================================================

export function formatQualityTag(q: LimitUpQuality): string {
  const gradeEmoji: Record<string, string> = {
    "极优板": "🏆",
    "中等质量板": "🟡",
    "低质量板": "🟠",
    "垃圾板": "❌",
  };
  const emoji = gradeEmoji[q.grade] || "❓";
  const timeLabel = ["", "早盘封", "上午封", "午后封", "尾盘前封", "尾盘封"][q.sealTimeRating] || "";
  const sealStr = q.sealRatioPercent >= 1
    ? `封单${q.sealRatioPercent.toFixed(1)}%`
    : `封单${q.sealRatioPercent.toFixed(2)}%`;
  const openStr = q.openCount === 0 ? "未炸板" : `炸${q.openCount}次`;
  const volStr = `量比${q.volumeRatio.toFixed(1)}`;
  const boardStr = q.boardStage >= 3 ? `${q.boardStage}连板` : q.boardStage === 2 ? "二板" : "首板";

  return `${emoji}${q.grade}(${q.qualityScore}分) ${timeLabel} ${sealStr} ${openStr} ${volStr} ${boardStr}`;
}
