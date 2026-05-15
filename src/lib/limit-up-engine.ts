/**
 * 涨停预判引擎
 *
 * 核心思路：不等7%再发现，从3%+就开始扫描
 * 综合多维度判断"涨势凶猛、可能冲板"的股票
 *
 * 评分维度（总分100）：
 *  1. 涨幅动量（25分）：当前涨幅越高越好，加速上涨更好
 *  2. 成交放量（20分）：量比、换手率、成交额
 *  3. 分时形态（20分）：高位运行、逼近日内高点、开盘跳空
 *  4. 冲板距离（15分）：离涨停越近分越高
 *  5. 资金特征（10分）：大单集中、成交额大
 *  6. 板块共振（10分）：所在板块也在涨，板块龙头效应
 *
 * 另含：次日冲板预判 + 次日盘中追踪推送
 */

import * as fs from "fs";
import * as path from "path";

export interface LimitUpCandidate {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  limitPrice: number;
  distancePercent: number;   // 距涨停还差多少%
  score: number;             // 综合冲板概率分（0-100）
  level: "极高" | "高" | "中" | "关注";
  turnoverRate: number;
  amount: number;
  volume: number;
  // 各维度得分
  momentumScore: number;     // 涨幅动量
  volumeScore: number;       // 成交放量
  patternScore: number;      // 分时形态
  distanceScore: number;     // 冲板距离
  capitalScore: number;      // 资金特征
  sectorScore: number;       // 板块共振
  // 标签
  tags: string[];
  reason: string;
  detectedAt: string;
  // 分时特征
  high: number;
  low: number;
  open: number;
  prevClose: number;
  // 板块/概念
  sectors?: string[];   // 所属行业板块
  concepts?: string[];  // 所属概念板块
}

export interface LimitUpScanResult {
  timestamp: string;
  candidates: LimitUpCandidate[];
  totalScanned: number;
  marketHeat: number;        // 市场炸板热度 0-100
  limitUpCount: number;      // 当前涨停数
  nearLimitUpCount: number;  // 冲板中数量
}

interface QuoteData {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  amount: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  turnoverRate: number;
  pe: number;
  marketCap: number;
}

// ================================================================
//  主扫描入口
// ================================================================

export function scanLimitUpPotential(
  quotes: QuoteData[],
  sectorChangeMap?: Map<string, number>,  // 板块涨幅
): LimitUpScanResult {
  const candidates: LimitUpCandidate[] = [];
  let limitUpCount = 0;

  for (const q of quotes) {
    if (q.price <= 0 || q.prevClose <= 0 || q.volume <= 0) continue;
    if (q.name.includes("ST") || q.name.includes("退") || q.name.includes("N")) continue;
    // 只推荐沪市主板(60开头)+深市主板(00开头)，跳过创业板(30x)/科创板(68x)
    if (!(q.code.startsWith("60") || q.code.startsWith("00"))) continue;

    // 涨停板参数（主板统一10%）
    const is20pct = false;
    const limitPct = is20pct ? 0.20 : 0.10;
    const limitPrice = Math.round(q.prevClose * (1 + limitPct) * 100) / 100;
    const isLimitUp = q.price >= limitPrice - 0.01;

    if (isLimitUp) { limitUpCount++; continue; } // 已封板跳过

    // 门槛：普通股涨幅≥3%，20cm股涨幅≥5%
    const minChange = is20pct ? 5 : 3;
    if (q.changePercent < minChange) continue;

    // 基本面过滤
    if (q.turnoverRate < 1) continue;         // 太冷
    if (q.amount < 30000000) continue;         // 成交额<3000万太小

    // 距涨停百分比
    const distPct = ((limitPrice - q.price) / q.prevClose) * 100;

    // ======= 各维度评分 =======

    // 1. 涨幅动量（20分）—— 降低高涨幅的分数上限，避免即将封板票过高
    let momentumScore = 0;
    if (is20pct) {
      if (q.changePercent >= 16) momentumScore = 18;
      else if (q.changePercent >= 13) momentumScore = 16;
      else if (q.changePercent >= 10) momentumScore = 14;
      else if (q.changePercent >= 7) momentumScore = 12;
      else momentumScore = 8;
    } else {
      // 早期启动段（3-6%）给合理分数，近封板段（9%+）不再给最高分
      if (q.changePercent >= 9) momentumScore = 15;     // 已经很高了距离不多
      else if (q.changePercent >= 8) momentumScore = 16;
      else if (q.changePercent >= 7) momentumScore = 18;
      else if (q.changePercent >= 6) momentumScore = 20; // 早期强势最佳区间
      else if (q.changePercent >= 5) momentumScore = 18;
      else if (q.changePercent >= 4) momentumScore = 14;
      else momentumScore = 10;
    }
    // 加速上涨bonus：当前价在日内高位 = 越来越猛
    if (q.high > 0 && q.low > 0) {
      const intraRange = q.high - q.low;
      if (intraRange > 0) {
        const posInRange = (q.price - q.low) / intraRange;
        if (posInRange >= 0.95) momentumScore = Math.min(20, momentumScore + 3);
        else if (posInRange >= 0.85) momentumScore = Math.min(20, momentumScore + 2);
      }
    }

    // 2. 成交放量（20分）
    let volumeScore = 0;
    // 换手率越高=资金越活跃
    if (q.turnoverRate >= 15) volumeScore += 10;
    else if (q.turnoverRate >= 8) volumeScore += 8;
    else if (q.turnoverRate >= 5) volumeScore += 6;
    else if (q.turnoverRate >= 3) volumeScore += 4;
    else volumeScore += 2;
    // 成交额越大=主力参与
    if (q.amount >= 1000000000) volumeScore += 10;        // 10亿+
    else if (q.amount >= 500000000) volumeScore += 8;     // 5亿+
    else if (q.amount >= 200000000) volumeScore += 6;     // 2亿+
    else if (q.amount >= 100000000) volumeScore += 4;     // 1亿+
    else if (q.amount >= 50000000) volumeScore += 2;
    volumeScore = Math.min(20, volumeScore);

    // 3. 分时形态（20分）
    let patternScore = 0;
    const tags: string[] = [];

    // 高开 = 主力意图明确
    if (q.open > 0 && q.prevClose > 0) {
      const openGapPct = ((q.open - q.prevClose) / q.prevClose) * 100;
      if (openGapPct >= 5) { patternScore += 8; tags.push("高开冲击"); }
      else if (openGapPct >= 3) { patternScore += 6; tags.push("跳空高开"); }
      else if (openGapPct >= 1) { patternScore += 3; tags.push("小幅高开"); }
    }

    // 价格贴近日内最高 = 持续攻击
    if (q.high > 0 && q.price > 0) {
      const fromHighPct = ((q.high - q.price) / q.high) * 100;
      if (fromHighPct < 0.2) { patternScore += 7; tags.push("持续冲顶"); }
      else if (fromHighPct < 0.5) { patternScore += 5; tags.push("高位盘整"); }
      else if (fromHighPct < 1.0) { patternScore += 3; tags.push("接近高点"); }
    }

    // 日内振幅小但涨幅大 = 单边上攻
    if (q.high > 0 && q.low > 0 && q.prevClose > 0) {
      const amplitude = ((q.high - q.low) / q.prevClose) * 100;
      const changeRatio = q.changePercent / Math.max(amplitude, 0.1);
      if (changeRatio > 0.8 && q.changePercent >= 5) {
        patternScore += 5; tags.push("单边上攻");
      }
    }
    patternScore = Math.min(20, patternScore);

    // 4. 冲板距离（8分）—— 降低权重，避免偏向即将封板的票
    let distanceScore = 0;
    if (distPct <= 0.5) distanceScore = 5;        // 差不多要封了，反而不给最高分
    else if (distPct <= 1.0) distanceScore = 6;
    else if (distPct <= 2.0) distanceScore = 8;   // 还有空间，最佳
    else if (distPct <= 3.0) distanceScore = 7;
    else if (distPct <= 5.0) distanceScore = 5;
    else if (distPct <= 7.0) distanceScore = 3;
    else distanceScore = 1;

    // 4b. 早期启动加分（12分）—— 核心新维度：奖励有上升空间且正在加速的票
    let earlyLaunchScore = 0;
    const hasUpRoom = distPct >= 2.0; // 距离涨停还有≥ 2%空间
    const inHighPos = q.high > 0 && q.low > 0 && q.high > q.low
      ? (q.price - q.low) / (q.high - q.low) >= 0.85 : false;
    const hasVolume = q.turnoverRate >= 3 && q.amount >= 100000000;
    const earlyRange = q.changePercent >= 3 && q.changePercent <= 7;
    if (earlyRange && hasUpRoom && inHighPos && hasVolume) {
      earlyLaunchScore = 12; // 最佳早期启动
      tags.push("早期启动");
    } else if (earlyRange && hasUpRoom && (inHighPos || hasVolume)) {
      earlyLaunchScore = 8;
      tags.push("启动初期");
    } else if (hasUpRoom && q.changePercent >= 4 && q.changePercent <= 8 && hasVolume) {
      earlyLaunchScore = 6;
    }

    // 5. 资金特征（10分）
    let capitalScore = 0;
    // 大成交额 + 高换手 + 持续在高位 → 主力在里面
    if (q.amount >= 500000000 && q.turnoverRate >= 5) capitalScore = 10;
    else if (q.amount >= 300000000 && q.turnoverRate >= 3) capitalScore = 8;
    else if (q.amount >= 100000000 && q.turnoverRate >= 2) capitalScore = 5;
    else if (q.amount >= 50000000) capitalScore = 3;

    // 6. 板块共振（10分）— 如果有板块数据
    let sectorScore = 0;
    // 简化：暂时不做板块匹配，后续可增强
    // 用涨幅本身间接反映板块效应
    if (q.changePercent >= 7) sectorScore = 5; // 能涨到7%+说明有板块效应
    if (q.turnoverRate >= 8) sectorScore += 3; // 高换手说明市场关注度高
    sectorScore = Math.min(10, sectorScore);

    // ======= 总分 =======
    const totalScore = momentumScore + volumeScore + patternScore + distanceScore + earlyLaunchScore + capitalScore + sectorScore;

    // 过滤低分
    if (totalScore < 30) continue;

    // 判断级别
    let level: LimitUpCandidate["level"];
    if (totalScore >= 75) level = "极高";
    else if (totalScore >= 60) level = "高";
    else if (totalScore >= 45) level = "中";
    else level = "关注";

    // 生成原因
    const reasons: string[] = [];
    if (momentumScore >= 20) reasons.push("涨势凶猛");
    else if (momentumScore >= 15) reasons.push("涨势强劲");
    if (volumeScore >= 15) reasons.push("巨量放大");
    else if (volumeScore >= 10) reasons.push("量能充沛");
    if (patternScore >= 15) reasons.push("形态完美");
    else if (patternScore >= 10) reasons.push("形态偏强");
    if (distPct <= 1) reasons.push(`仅差${distPct.toFixed(1)}%`);
    if (capitalScore >= 8) reasons.push("大资金涌入");
    if (tags.includes("单边上攻")) reasons.push("单边上攻");
    if (tags.includes("持续冲顶")) reasons.push("持续冲顶");

    // 早期启动标签
    if (earlyLaunchScore >= 8) reasons.unshift("🚀早期启动");
    if (tags.includes("单边上攻") && earlyRange) reasons.push("单边上攻有空间");

    candidates.push({
      code: q.code,
      name: q.name,
      price: q.price,
      changePercent: Math.round(q.changePercent * 100) / 100,
      limitPrice,
      distancePercent: Math.round(distPct * 100) / 100,
      score: totalScore,
      level,
      turnoverRate: Math.round(q.turnoverRate * 100) / 100,
      amount: q.amount,
      volume: q.volume,
      momentumScore,
      volumeScore,
      patternScore,
      distanceScore,
      capitalScore,
      sectorScore,
      tags,
      reason: reasons.join(" + ") || "综合偏强",
      detectedAt: new Date().toISOString(),
      high: q.high,
      low: q.low,
      open: q.open,
      prevClose: q.prevClose,
    });
  }

  // 按分数降序
  candidates.sort((a, b) => b.score - a.score);

  // 市场热度：涨停数 + 冲板数
  const nearCount = candidates.filter(c => c.score >= 45).length;
  const marketHeat = Math.min(100, limitUpCount * 3 + nearCount * 2);

  return {
    timestamp: new Date().toISOString(),
    candidates,
    totalScanned: quotes.length,
    marketHeat,
    limitUpCount,
    nearLimitUpCount: nearCount,
  };
}

// ================================================================
//  次日冲板预判
// ================================================================

export interface NextDayPick {
  code: string;
  name: string;
  todayClose: number;
  todayChangePercent: number;
  todayTurnoverRate: number;
  todayAmount: number;
  score: number;              // 次日冲板概率分 0-100
  level: "极高" | "高" | "中";
  reasons: string[];
  // K线特征
  consecutiveUp: number;      // 连涨天数
  volumeExpanding: boolean;   // 量能持续放大
  limitUpToday: boolean;      // 今日涨停
  nearLimitUpToday: boolean;  // 今日差点涨停(≥8%)
  addedDate: string;
  // 综合分析
  analysis: NextDayAnalysis;
  // 板块/概念
  sectors?: string[];   // 所属行业板块
  concepts?: string[];  // 所属概念板块
  // 涨停质量因子（仅涨停票有）
  qualityScore?: number;       // 涨停质量分 0-100
  qualityGrade?: string;       // "极优板" | "中等质量板" | "低质量板" | "垃圾板"
  qualityReasons?: string[];   // 质量因子详情
  qualityRiskFlags?: string[]; // 风控标记
  positionMultiplier?: number; // 仓位建议倍数
}

export interface EventInfo {
  title: string;
  category: string;   // 国际局势 | 贸易关系 | 国家政策 | 行业政策 | 央行货币 | 科技突破 | 大宗商品 | 突发事件
  sectors: string[];
  impact: "利好" | "利空" | "关注";
  weight: number;
  reason: string;
}

export interface MarketContext {
  sentimentScore: number;       // 情绪分 -100~100
  limitUpCount: number;         // 今日涨停家数
  limitDownCount: number;       // 今日跌停家数
  upDownRatio: number;          // 涨跌比
  totalAmount: number;          // 两市成交额(亿)
  amountPercentile: number;     // 成交额历史分位 0-100
  strongStockRatio: number;     // 强势股占比%
  northbound3d: number;         // 北向近3日净买(万元)
  northboundToday: number;      // 北向今日净买(万元)
  marginNetBuy3d: number;       // 融资近3日净买(亿)
  hotSectors: string[];         // 今日涨幅前N板块
  // 事件驱动
  events: EventInfo[];          // 当日重要事件
}

export interface NextDayAnalysis {
  summary: string;              // 一句话总结
  limitUpReason: string;        // 涨停/大涨原因分析
  technicalPattern: string;     // 技术形态分析
  volumeAnalysis: string;       // 量能分析
  marketAnalysis: string;       // 市场环境分析
  internationalFactors: string; // 国际因素
  domesticFactors: string;      // 国内政策/宏观因素
  companyFactors: string;       // 公司/行业因素
  speculationFactors: string;   // 炒作/题材因素
  riskWarning: string;          // 风险提示
  klineFeatures: string[];      // K线特征标签
  recentKlines: { date: string; close: number; changePercent: number; volume: number; amount: number }[]; // 近5日K线
}

export interface NextDayWatchlist {
  date: string;               // 生成日期
  picks: NextDayPick[];
  generatedAt: string;
}

export interface NextDayTrackResult {
  watchlist: NextDayWatchlist;
  triggered: NextDayAlert[];  // 今日盘中触发的
}

export interface NextDayAlert {
  code: string;
  name: string;
  currentPrice: number;
  changePercent: number;
  turnoverRate: number;
  amount: number;
  triggerReason: string;
  score: number;
  detectedAt: string;
  // 板块/概念
  sectors?: string[];   // 所属行业板块
  concepts?: string[];  // 所属概念板块
}

interface KLineSimple {
  date: string; open: number; close: number;
  high: number; low: number; volume: number; amount: number;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const WATCHLIST_FILE = path.join(DATA_DIR, "next-day-watchlist.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadNextDayWatchlist(): NextDayWatchlist | null {
  ensureDataDir();
  if (!fs.existsSync(WATCHLIST_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(WATCHLIST_FILE, "utf-8"));
  } catch { return null; }
}

export function saveNextDayWatchlist(wl: NextDayWatchlist) {
  ensureDataDir();
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(wl, null, 2), "utf-8");
}

/**
 * 生成"次日冲板关注列表"
 *
 * 逻辑：分析今天强势票的K线，判断哪些明天还可能继续冲
 * 典型pattern：
 * 1. 今日涨停/炸板 + 高换手 → 明天可能连板
 * 2. 首板放量 + 板块龙头 → 次日溢价
 * 3. 连续3天放量上攻(累计涨幅<15%) → 蓄势待冲
 * 4. 高位横盘突破 + 量能放大 → 加速冲板
 */
export function generateNextDayWatchlist(
  quotes: QuoteData[],
  klineMap: Record<string, KLineSimple[]>,
  marketCtx?: MarketContext,
): NextDayWatchlist {
  const today = new Date().toISOString().slice(0, 10);
  const picks: NextDayPick[] = [];

  for (const q of quotes) {
    if (q.price <= 0 || q.prevClose <= 0 || q.volume <= 0) continue;
    if (q.name.includes("ST") || q.name.includes("退")) continue;
    // 只推荐沪市主板(60开头)+深市主板(00开头)
    if (!(q.code.startsWith("60") || q.code.startsWith("00"))) continue;
    if (q.amount < 50000000) continue; // 成交额5000万+

    const is20pct = false;
    const limitPct = is20pct ? 0.20 : 0.10;
    const limitPrice = Math.round(q.prevClose * (1 + limitPct) * 100) / 100;
    const limitUpToday = q.price >= limitPrice - 0.01;
    const nearLimitUpToday = !limitUpToday && q.changePercent >= (is20pct ? 16 : 8);

    // 基本门槛：今天至少涨3%或者涨停
    if (q.changePercent < 3 && !limitUpToday) continue;

    const klines = klineMap[q.code] || [];
    let score = 0;
    const reasons: string[] = [];

    // ======= 1. 涨停/炸板分析（30分） =======
    if (limitUpToday) {
      score += 25;
      reasons.push("今日涨停");
      // 首板（昨天没涨停）
      if (klines.length >= 2) {
        const yClose = klines[klines.length - 2]?.close || 0;
        const yPrevClose = klines.length >= 3 ? klines[klines.length - 3]?.close || yClose : yClose;
        const yChangePct = yPrevClose > 0 ? ((yClose - yPrevClose) / yPrevClose) * 100 : 0;
        if (yChangePct < (is20pct ? 15 : 8)) {
          score += 5; reasons.push("首板");
        } else {
          score += 10; reasons.push("连板");
        }
      }
    } else if (nearLimitUpToday) {
      score += 18;
      reasons.push(`差点涨停(${q.changePercent.toFixed(1)}%)`);
    } else if (q.changePercent >= 6) {
      score += 12;
      reasons.push(`大涨${q.changePercent.toFixed(1)}%`);
    } else if (q.changePercent >= 4) {
      score += 6;
      reasons.push(`涨${q.changePercent.toFixed(1)}%`);
    }

    // ======= 2. 量能特征（20分） =======
    if (q.turnoverRate >= 15) { score += 12; reasons.push("极高换手"); }
    else if (q.turnoverRate >= 8) { score += 9; reasons.push("高换手"); }
    else if (q.turnoverRate >= 4) { score += 6; }
    else if (q.turnoverRate >= 2) { score += 3; }

    if (q.amount >= 1000000000) { score += 8; reasons.push("10亿+大资金"); }
    else if (q.amount >= 500000000) { score += 6; reasons.push("5亿+资金"); }
    else if (q.amount >= 200000000) { score += 4; }

    // ======= 3. K线连续性（25分） =======
    let consecutiveUp = 0;
    let volumeExpanding = false;
    if (klines.length >= 3) {
      // 连涨天数（含今天）
      for (let i = klines.length - 1; i >= 0; i--) {
        if (klines[i].close > klines[i].open) consecutiveUp++;
        else break;
      }
      // 今天也是涨的
      if (q.price > q.open) consecutiveUp++;
      // 但要注意不是今天的K线重复计算
      if (klines.length > 0 && klines[klines.length - 1].date === today) {
        consecutiveUp--; // 避免重复
      }

      if (consecutiveUp >= 4) { score += 15; reasons.push(`${consecutiveUp}连阳`); }
      else if (consecutiveUp >= 3) { score += 10; reasons.push("3连阳"); }
      else if (consecutiveUp >= 2) { score += 5; }

      // 量能递增
      const vols = klines.slice(-3).map(k => k.volume);
      if (vols.length >= 3 && vols[2] > vols[1] && vols[1] > vols[0]) {
        volumeExpanding = true;
        score += 10; reasons.push("量能3日递增");
      } else if (vols.length >= 2 && vols[vols.length - 1] > vols[vols.length - 2]) {
        score += 4;
      }

      // 近5日累计涨幅（不要追太高）
      if (klines.length >= 5) {
        const close5ago = klines[klines.length - 5].close;
        const cum5dPct = close5ago > 0 ? ((q.price - close5ago) / close5ago) * 100 : 0;
        if (cum5dPct > 30) { score -= 10; reasons.push("5日涨30%+过热"); }
        else if (cum5dPct > 20) { score -= 5; reasons.push("5日涨20%+偏热"); }
        else if (cum5dPct > 10 && cum5dPct <= 20) { score += 5; reasons.push("5日强势上攻"); }
      }

      // 突破形态：今日突破近20日高点
      if (klines.length >= 20) {
        const high20 = Math.max(...klines.slice(-20).map(k => k.high));
        if (q.high > high20) {
          score += 8; reasons.push("突破20日新高");
        }
      }
    }

    // ======= 4. 分时强度（15分） =======
    // 收盘在日内高位 = 尾盘强势，次日高开概率大
    if (q.high > q.low) {
      const closePos = (q.price - q.low) / (q.high - q.low);
      if (closePos >= 0.9) { score += 10; reasons.push("尾盘封住高位"); }
      else if (closePos >= 0.7) { score += 6; reasons.push("收盘偏强"); }
    }
    // 涨停封板质量
    if (limitUpToday && q.turnoverRate < 5) {
      score += 5; reasons.push("封板坚定(低换手)");
    }

    // ======= 过滤低分 =======
    if (score < 35) continue;

    let level: NextDayPick["level"];
    if (score >= 70) level = "极高";
    else if (score >= 55) level = "高";
    else level = "中";

    // ======= 综合分析 =======
    const analysis = buildAnalysis(q, klines, {
      limitUpToday, nearLimitUpToday, consecutiveUp, volumeExpanding, score, reasons,
    }, marketCtx);

    picks.push({
      code: q.code,
      name: q.name,
      todayClose: q.price,
      todayChangePercent: Math.round(q.changePercent * 100) / 100,
      todayTurnoverRate: Math.round(q.turnoverRate * 100) / 100,
      todayAmount: q.amount,
      score,
      level,
      reasons,
      consecutiveUp,
      volumeExpanding,
      limitUpToday,
      nearLimitUpToday,
      addedDate: today,
      analysis,
    });
  }

  picks.sort((a, b) => b.score - a.score);

  const watchlist: NextDayWatchlist = {
    date: today,
    picks: picks.slice(0, 30), // 最多30只关注
    generatedAt: new Date().toISOString(),
  };

  saveNextDayWatchlist(watchlist);
  return watchlist;
}

// ================================================================
//  综合分析生成
// ================================================================

function buildAnalysis(
  q: QuoteData,
  klines: KLineSimple[],
  ctx: { limitUpToday: boolean; nearLimitUpToday: boolean; consecutiveUp: number; volumeExpanding: boolean; score: number; reasons: string[] },
  marketCtx?: MarketContext,
): NextDayAnalysis {
  const klineFeatures: string[] = [];
  const recentKlines = klines.slice(-5).map((k, i, arr) => {
    const prev = i > 0 ? arr[i - 1].close : k.open;
    return {
      date: k.date,
      close: k.close,
      changePercent: prev > 0 ? Math.round(((k.close - prev) / prev) * 10000) / 100 : 0,
      volume: k.volume,
      amount: k.amount,
    };
  });

  // --- 涨停/大涨原因分析 ---
  const limitUpReasonParts: string[] = [];

  if (ctx.limitUpToday) {
    // 判断首板/连板
    if (klines.length >= 2) {
      const yClose = klines[klines.length - 2]?.close || 0;
      const yPrev = klines.length >= 3 ? klines[klines.length - 3]?.close || yClose : yClose;
      const yPct = yPrev > 0 ? ((yClose - yPrev) / yPrev) * 100 : 0;
      if (yPct >= 9) {
        limitUpReasonParts.push("连续涨停，市场资金合力封板，短线情绪极度亢奋");
        klineFeatures.push("连板");
      } else if (yPct >= 3) {
        limitUpReasonParts.push("前一日已强势上攻，今日情绪延续直接封板，属于趋势加速");
        klineFeatures.push("加速板");
      } else {
        limitUpReasonParts.push("首次涨停，可能受消息面/题材/资金集中驱动，关注次日溢价");
        klineFeatures.push("首板");
      }
    } else {
      limitUpReasonParts.push("涨停封板，需关注封板质量及次日竞价情况");
    }

    if (q.turnoverRate < 5) {
      limitUpReasonParts.push("封板换手率低("+q.turnoverRate.toFixed(1)+"%)，筹码锁定好，封板坚定");
      klineFeatures.push("缩量封板");
    } else if (q.turnoverRate >= 15) {
      limitUpReasonParts.push("封板换手率极高("+q.turnoverRate.toFixed(1)+"%)，资金分歧大，有炸板风险但也说明关注度高");
      klineFeatures.push("放量封板");
    }
  } else if (ctx.nearLimitUpToday) {
    limitUpReasonParts.push(`今日大涨${q.changePercent.toFixed(1)}%接近涨停，冲板未果可能有两种后续：次日继续冲或高开低走消化获利盘`);
    klineFeatures.push("冲板未果");
  } else {
    limitUpReasonParts.push(`今日涨${q.changePercent.toFixed(1)}%，涨势强劲但尚未触及涨停板，处于上攻加速阶段`);
  }

  // 成交额分析
  const amtStr = q.amount >= 100000000 ? (q.amount / 100000000).toFixed(1) + "亿" : (q.amount / 10000).toFixed(0) + "万";
  limitUpReasonParts.push(`成交额${amtStr}，${q.amount >= 1000000000 ? "超大资金参与，机构级别博弈" : q.amount >= 500000000 ? "大资金活跃，主力明确介入" : q.amount >= 200000000 ? "资金参与度中等" : "资金参与度一般"}`);

  // --- 技术形态分析 ---
  const techParts: string[] = [];
  if (ctx.consecutiveUp >= 4) {
    techParts.push(`${ctx.consecutiveUp}连阳上攻，多头趋势明确，短线动能充沛`);
    klineFeatures.push(ctx.consecutiveUp + "连阳");
  } else if (ctx.consecutiveUp >= 3) {
    techParts.push("3连阳蓄势，短期多头占优");
    klineFeatures.push("3连阳");
  } else if (ctx.consecutiveUp >= 2) {
    techParts.push("连续2日收阳，初步确认上攻意图");
  }

  // 突破分析
  if (klines.length >= 20) {
    const high20 = Math.max(...klines.slice(-20).map(k => k.high));
    const low20 = Math.min(...klines.slice(-20).map(k => k.low));
    if (q.high > high20) {
      techParts.push(`突破近20日高点(${high20.toFixed(2)})，打开上方空间`);
      klineFeatures.push("突破新高");
    }
    const amplitude = low20 > 0 ? ((high20 - low20) / low20 * 100) : 0;
    if (amplitude < 10 && q.changePercent >= 5) {
      techParts.push(`前期横盘整理(振幅仅${amplitude.toFixed(1)}%)后放量突破，典型的蓄力形态`);
      klineFeatures.push("横盘突破");
    }
  }

  // 均线分析
  if (klines.length >= 10) {
    const ma5 = klines.slice(-5).reduce((s, k) => s + k.close, 0) / 5;
    const ma10 = klines.slice(-10).reduce((s, k) => s + k.close, 0) / 10;
    if (q.price > ma5 && ma5 > ma10) {
      techParts.push("价格站上5日和10日均线，短期均线多头排列");
      klineFeatures.push("均线多头");
    }
  }

  // 收盘位置
  if (q.high > q.low) {
    const closePos = (q.price - q.low) / (q.high - q.low);
    if (closePos >= 0.9) {
      techParts.push("收盘封住日内最高位附近，尾盘强势不减，次日高开概率大");
      klineFeatures.push("光头阳线");
    } else if (closePos >= 0.7) {
      techParts.push("收盘偏强，位于日内高位区间");
    } else if (closePos < 0.4) {
      techParts.push("收盘回落至日内低位区，上方套牢盘较重，需警惕次日冲高回落");
      klineFeatures.push("上影线");
    }
  }

  if (techParts.length === 0) techParts.push("技术形态暂无明显特征");

  // --- 量能分析 ---
  const volParts: string[] = [];
  if (ctx.volumeExpanding) {
    volParts.push("近3日量能持续递增，资金持续流入，量价配合理想");
    klineFeatures.push("量能递增");
  }
  if (q.turnoverRate >= 15) {
    volParts.push(`换手率${q.turnoverRate.toFixed(1)}%极高，筹码充分换手，短线博弈激烈`);
  } else if (q.turnoverRate >= 8) {
    volParts.push(`换手率${q.turnoverRate.toFixed(1)}%偏高，资金参与度活跃`);
  } else if (q.turnoverRate >= 4) {
    volParts.push(`换手率${q.turnoverRate.toFixed(1)}%适中`);
  } else {
    volParts.push(`换手率${q.turnoverRate.toFixed(1)}%偏低，筹码锁定较好`);
  }

  // 与前几日量能比较
  if (klines.length >= 3) {
    const recentVols = klines.slice(-3).map(k => k.volume);
    const avgVol = recentVols.reduce((s, v) => s + v, 0) / recentVols.length;
    const todayVolRatio = avgVol > 0 ? q.volume / avgVol : 1;
    if (todayVolRatio > 2) {
      volParts.push(`今日成交量是近3日均量的${todayVolRatio.toFixed(1)}倍，属于异常放量`);
      klineFeatures.push("异常放量");
    } else if (todayVolRatio > 1.5) {
      volParts.push(`今日成交量是近3日均量的${todayVolRatio.toFixed(1)}倍，明显放量`);
    }
  }

  if (volParts.length === 0) volParts.push("量能表现正常");

  // --- 风险提示 ---
  const riskParts: string[] = [];
  if (klines.length >= 5) {
    const close5ago = klines[klines.length - 5]?.close || q.price;
    const cum5d = close5ago > 0 ? ((q.price - close5ago) / close5ago) * 100 : 0;
    if (cum5d > 30) {
      riskParts.push(`近5日累计涨幅${cum5d.toFixed(1)}%，短期涨幅过大，获利盘较重，回调风险高`);
      klineFeatures.push("5日涨30%+");
    } else if (cum5d > 20) {
      riskParts.push(`近5日累计涨幅${cum5d.toFixed(1)}%，短期涨幅偏大，注意获利回吐`);
    }
  }
  if (ctx.limitUpToday && q.turnoverRate >= 15) {
    riskParts.push("虽然涨停但换手率极高，资金分歧大，次日可能高开低走");
  }
  if (ctx.nearLimitUpToday) {
    riskParts.push("冲板未封住说明上方抛压存在，追高需谨慎");
  }
  riskParts.push("涨停预判不等于一定涨停，追涨打板有风险，注意仓位控制");

  // --- 市场环境分析 ---
  const mktParts: string[] = [];
  if (marketCtx) {
    // 市场情绪
    if (marketCtx.sentimentScore >= 50) {
      mktParts.push(`市场情绪极热(${marketCtx.sentimentScore}分)，涨停潮涌现(${marketCtx.limitUpCount}家涨停)，赚钱效应极佳，冲板环境有利`);
      klineFeatures.push("市场情绪热");
    } else if (marketCtx.sentimentScore >= 20) {
      mktParts.push(`市场情绪偏暖(${marketCtx.sentimentScore}分)，${marketCtx.limitUpCount}家涨停，涨跌比${marketCtx.upDownRatio.toFixed(1)}，整体做多氛围尚可`);
    } else if (marketCtx.sentimentScore >= -20) {
      mktParts.push(`市场情绪中性(${marketCtx.sentimentScore}分)，涨跌比${marketCtx.upDownRatio.toFixed(1)}，板块分化明显`);
    } else {
      mktParts.push(`市场情绪偏冷(${marketCtx.sentimentScore}分)，${marketCtx.limitDownCount}家跌停，整体做空氛围较重，逆势封板需谨慎`);
      klineFeatures.push("市场弱势");
      riskParts.push("大盘环境偏弱，个股逆势涨停次日可能被补跌");
    }

    // 量能环境
    if (marketCtx.totalAmount >= 12000) {
      mktParts.push(`两市成交${marketCtx.totalAmount.toFixed(0)}亿(分位${marketCtx.amountPercentile}%)，量能充沛为冲板提供资金基础`);
    } else if (marketCtx.totalAmount >= 8000) {
      mktParts.push(`两市成交${marketCtx.totalAmount.toFixed(0)}亿，量能中等`);
    } else {
      mktParts.push(`两市成交${marketCtx.totalAmount.toFixed(0)}亿，量能萎缩，追涨意愿不足`);
      riskParts.push("量能不足环境下追高风险加大");
    }

    // 北向资金
    const nbTodayYi = marketCtx.northboundToday / 10000;
    const nb3dYi = marketCtx.northbound3d / 10000;
    if (nb3dYi > 50) {
      mktParts.push(`北向资金近3日净买入${nb3dYi.toFixed(1)}亿(今日${nbTodayYi.toFixed(1)}亿)，外资看多`);
      klineFeatures.push("北向流入");
    } else if (nb3dYi < -50) {
      mktParts.push(`北向资金近3日净卖出${Math.abs(nb3dYi).toFixed(1)}亿，外资撤退中`);
      klineFeatures.push("北向流出");
    } else {
      mktParts.push(`北向资金近3日小幅${nb3dYi >= 0 ? "流入" : "流出"}${Math.abs(nb3dYi).toFixed(1)}亿，方向不明`);
    }

    // 融资
    if (marketCtx.marginNetBuy3d > 30) {
      mktParts.push(`融资近3日净买入${marketCtx.marginNetBuy3d.toFixed(0)}亿，杠杆资金积极入场`);
    } else if (marketCtx.marginNetBuy3d < -30) {
      mktParts.push(`融资近3日净卖出${Math.abs(marketCtx.marginNetBuy3d).toFixed(0)}亿，杠杆资金谨慎`);
    }

    // 热点板块
    if (marketCtx.hotSectors.length > 0) {
      mktParts.push(`今日热点板块：${marketCtx.hotSectors.slice(0, 5).join("、")}`);
    }
  } else {
    mktParts.push("市场数据暂未获取");
  }

  // --- 场外多维因素分析 ---
  // 板块关键词映射（用于匹配事件与个股的关联度）
  const stockSectorKeywords = inferStockSectors(q.name, q.code, marketCtx?.hotSectors || []);
  const relatedEvents = marketCtx?.events?.filter(e =>
    e.sectors.some(s => stockSectorKeywords.some(kw => s.includes(kw) || kw.includes(s)))
  ) || [];

  // 国际因素
  const intlParts: string[] = [];
  const intlEvents = relatedEvents.filter(e => e.category === "国际局势" || e.category === "贸易关系");
  if (intlEvents.length > 0) {
    for (const e of intlEvents.slice(0, 3)) {
      intlParts.push(`[${e.impact}] ${e.title} — ${e.reason}`);
    }
    if (intlEvents.some(e => e.impact === "利好" && e.weight >= 7)) klineFeatures.push("国际利好");
    if (intlEvents.some(e => e.impact === "利空" && e.weight >= 7)) klineFeatures.push("国际利空");
  }
  // 通用国际环境
  if (marketCtx) {
    const nbYi = marketCtx.northboundToday / 10000;
    if (nbYi > 30) intlParts.push(`北向资金(外资)今日大幅流入${nbYi.toFixed(1)}亿，表明海外资金看好A股`);
    else if (nbYi < -30) intlParts.push(`北向资金(外资)今日大幅流出${Math.abs(nbYi).toFixed(1)}亿，海外资金避险情绪升温`);
  }
  if (intlParts.length === 0) intlParts.push("暂无直接相关的国际因素影响");

  // 国内因素
  const domParts: string[] = [];
  const domEvents = relatedEvents.filter(e =>
    e.category === "国家政策" || e.category === "央行货币" || e.category === "行业政策"
  );
  if (domEvents.length > 0) {
    for (const e of domEvents.slice(0, 3)) {
      domParts.push(`[${e.impact}] ${e.title} — ${e.reason}`);
    }
    if (domEvents.some(e => e.impact === "利好" && e.weight >= 7)) klineFeatures.push("政策利好");
    if (domEvents.some(e => e.impact === "利空" && e.weight >= 7)) klineFeatures.push("政策利空");
  }
  // 通用宏观
  if (marketCtx) {
    if (marketCtx.marginNetBuy3d > 30) domParts.push(`融资杠杆资金近3日净买入${marketCtx.marginNetBuy3d.toFixed(0)}亿，内资看多`);
    else if (marketCtx.marginNetBuy3d < -30) domParts.push(`融资杠杆资金近3日净卖出${Math.abs(marketCtx.marginNetBuy3d).toFixed(0)}亿，内资偏谨慎`);
    if (marketCtx.totalAmount >= 12000) domParts.push("两市量能充沛，流动性宽裕");
    else if (marketCtx.totalAmount < 8000) domParts.push("两市量能萎缩，市场流动性偏紧");
  }
  if (domParts.length === 0) domParts.push("暂无直接相关的国内政策因素");

  // 公司/行业因素
  const compParts: string[] = [];
  const compEvents = relatedEvents.filter(e => e.category === "科技突破" || e.category === "大宗商品");
  if (compEvents.length > 0) {
    for (const e of compEvents.slice(0, 3)) {
      compParts.push(`[${e.impact}] ${e.title} — ${e.reason}`);
    }
  }
  // 基于K线推断公司基本面特征
  if (ctx.consecutiveUp >= 5) {
    compParts.push(`连续${ctx.consecutiveUp}日上涨，可能有未公开利好（业绩预增/订单/重组等）`);
  }
  if (q.amount >= 1000000000) {
    compParts.push(`成交额超10亿，有机构资金大举买入迹象`);
  }
  if (ctx.limitUpToday && q.turnoverRate < 3) {
    compParts.push("涨停缩量封板，可能有确定性利好尚未完全反映");
  }
  if (q.marketCap && q.marketCap < 5000000000) {
    compParts.push(`市值偏小(${(q.marketCap / 100000000).toFixed(0)}亿)，受游资关注度较高`);
    klineFeatures.push("小盘股");
  } else if (q.marketCap && q.marketCap >= 50000000000) {
    compParts.push(`大市值(${(q.marketCap / 100000000).toFixed(0)}亿)，涨停需主力合力，确定性更强`);
    klineFeatures.push("大盘股");
  }
  if (compParts.length === 0) compParts.push("暂无明确的公司/行业层面驱动因素");

  // 炒作/题材因素
  const specParts: string[] = [];
  // 板块热度
  if (marketCtx?.hotSectors && marketCtx.hotSectors.length > 0) {
    const inHotSector = marketCtx.hotSectors.filter(s => stockSectorKeywords.some(kw => s.includes(kw) || kw.includes(s)));
    if (inHotSector.length > 0) {
      specParts.push(`所属板块"${inHotSector.join("、")}"为今日市场热点，资金抱团效应明显`);
      klineFeatures.push("热点板块");
    }
  }
  // 连板效应
  if (ctx.limitUpToday && klines.length >= 2) {
    const yClose = klines[klines.length - 2]?.close || 0;
    const yPrev = klines.length >= 3 ? klines[klines.length - 3]?.close || yClose : yClose;
    const yPct = yPrev > 0 ? ((yClose - yPrev) / yPrev) * 100 : 0;
    if (yPct >= 9) {
      specParts.push("连板股是短线游资最爱的炒作标的，情绪核心/人气龙头地位，追涨需关注是否卡位或有新题材加持");
    }
  }
  // 高换手+大涨 = 典型游资炒作特征
  if (q.turnoverRate >= 15 && q.changePercent >= 7) {
    specParts.push(`超高换手率(${q.turnoverRate.toFixed(1)}%)+大涨${q.changePercent.toFixed(1)}%，典型游资接力炒作模式`);
    klineFeatures.push("游资炒作");
  }
  // 涨停板数量（市场情绪）
  if (marketCtx && marketCtx.limitUpCount >= 50) {
    specParts.push(`今日全市场${marketCtx.limitUpCount}只涨停，打板氛围极热，连板晋级概率提升`);
  } else if (marketCtx && marketCtx.limitUpCount >= 30) {
    specParts.push(`今日${marketCtx.limitUpCount}只涨停，短线情绪活跃，题材炒作有持续性`);
  } else if (marketCtx && marketCtx.limitUpCount < 15) {
    specParts.push(`今日仅${marketCtx.limitUpCount}只涨停，短线情绪冷淡，题材炒作难持续`);
    riskParts.push("炒作情绪冰点，追涨打板失败率高");
  }
  if (specParts.length === 0) specParts.push("暂无明显炒作/题材驱动");

  // --- 一句话总结 ---
  const tag = ctx.limitUpToday ? "涨停封板" : ctx.nearLimitUpToday ? "冲板未果" : `强势涨${q.changePercent.toFixed(1)}%`;
  const mktEnv = marketCtx ? (marketCtx.sentimentScore >= 20 ? "市场情绪偏暖" : marketCtx.sentimentScore >= -20 ? "市场情绪中性" : "市场偏弱") : "";
  const evtTag = relatedEvents.length > 0 ? `，有${relatedEvents.filter(e=>e.impact==="利好").length}条利好事件驱动` : "";
  const summary = `${q.name}今日${tag}，${ctx.consecutiveUp >= 3 ? ctx.consecutiveUp + "连阳趋势明确" : "短线动能强劲"}，${ctx.volumeExpanding ? "量能持续放大" : "量能配合尚可"}${mktEnv ? "，" + mktEnv : ""}${evtTag}，综合冲板概率评分${ctx.score}分(${ctx.score >= 70 ? "极高" : ctx.score >= 55 ? "高" : "中"})，次日关注竞价强度及量能延续性。`;

  return {
    summary,
    limitUpReason: limitUpReasonParts.join("。") + "。",
    technicalPattern: techParts.join("。") + "。",
    volumeAnalysis: volParts.join("。") + "。",
    marketAnalysis: mktParts.join("。") + "。",
    internationalFactors: intlParts.join("。") + "。",
    domesticFactors: domParts.join("。") + "。",
    companyFactors: compParts.join("。") + "。",
    speculationFactors: specParts.join("。") + "。",
    riskWarning: riskParts.join("。") + "。",
    klineFeatures,
    recentKlines,
  };
}

// 通过股票名称和代码推断所属板块关键词
function inferStockSectors(name: string, code: string, hotSectors: string[]): string[] {
  const keywords: string[] = [];

  // 行业关键词映射
  const nameKeywords: Record<string, string[]> = {
    "半导体|芯片|微电子|集成电路": ["半导体", "芯片"],
    "新能源|锂|电池|光伏|风电|太阳能": ["新能源", "光伏", "锂电"],
    "医药|药业|生物|制药|医疗": ["医药", "创新药", "医疗"],
    "银行": ["银行"],
    "证券|券商": ["券商"],
    "保险|人寿": ["保险", "非银"],
    "地产|置业|置地|开发": ["房地产"],
    "汽车|车|比亚迪": ["新能源车", "汽车"],
    "军工|航天|航空|兵器|船舶": ["军工"],
    "通信|中兴|华为|5G": ["通信", "5G"],
    "AI|人工智能|算力|大模型": ["人工智能", "AI"],
    "机器人|自动化": ["机器人", "人工智能"],
    "食品|酒|饮料|乳业": ["食品饮料", "消费"],
    "家电|美的|格力|海尔": ["家电"],
    "煤|能源|电力|燃气": ["煤炭", "电力"],
    "钢铁|钢|铁": ["钢铁"],
    "有色|铜|铝|锌|黄金|稀土": ["有色金属"],
    "农业|种业|养殖|饲料": ["农业"],
    "建筑|建材|基建|水泥": ["建材基建"],
    "化工|化学|石化": ["化工"],
    "旅游|酒店|航空|机场": ["旅游"],
    "游戏|传媒|影视|娱乐": ["游戏传媒"],
  };

  for (const [pattern, sectors] of Object.entries(nameKeywords)) {
    if (pattern.split("|").some(kw => name.includes(kw))) {
      keywords.push(...sectors);
    }
  }

  // 代码前缀推断
  if (code.startsWith("600") || code.startsWith("601")) {
    // 大盘蓝筹居多
    if (keywords.length === 0) keywords.push("沪深300", "大盘");
  }

  // 从热点板块名称中匹配
  for (const sector of hotSectors) {
    if (name.length >= 2 && sector.includes(name.substring(0, 2))) {
      keywords.push(sector);
    }
  }

  if (keywords.length === 0) keywords.push(name); // 兜底用股票名
  return [...new Set(keywords)];
}

// ================================================================
//  次日盘中追踪：监控关注列表里的票
// ================================================================

/**
 * 盘中追踪关注列表中的票
 * 如果出现冲板趋势就触发告警
 *
 * 三阶段：
 *  - 集合竞价(9:15-9:25)：基于竞价价格预判，重点看高开幅度
 *  - 盘中(9:30-11:30/13:00-15:00)：基于涨幅+换手+持续性
 *
 * 触发条件（盘中，宽松，早发现）：
 * 1. 高开≥2% → 可能有溢价延续
 * 2. 涨幅≥3% + 换手≥2% → 开始启动
 * 3. 涨幅≥5% → 明确冲板趋势
 * 4. 现价接近日内最高 + 涨幅≥2% → 持续攻击
 */
export function trackNextDayPicks(
  watchlist: NextDayWatchlist,
  currentQuotes: QuoteData[],
  phase: "callAuction" | "intraday" = "intraday",
): NextDayAlert[] {
  const alerts: NextDayAlert[] = [];
  const quoteMap = new Map(currentQuotes.map(q => [q.code, q]));

  for (const pick of watchlist.picks) {
    const q = quoteMap.get(pick.code);
    if (!q || q.price <= 0 || q.prevClose <= 0) continue;

    let triggerReason = "";
    let bonus = 0;

    // 集合竞价阶段：以竞价价格相对昨收的涨幅作为核心信号
    if (phase === "callAuction") {
      // 竞价阶段 q.price 是撮合预估价，q.changePercent 由其计算
      const auctionPct = q.changePercent;

      if (auctionPct >= 9) {
        triggerReason = `竞价高开${auctionPct.toFixed(1)}% 极强势 一字预期`;
        bonus = 25;
      } else if (auctionPct >= 5) {
        triggerReason = `竞价高开${auctionPct.toFixed(1)}% 资金强烈看多`;
        bonus = 18;
      } else if (auctionPct >= 3) {
        triggerReason = `竞价高开${auctionPct.toFixed(1)}% 有溢价预期`;
        bonus = 12;
      } else if (auctionPct >= 1.5) {
        triggerReason = `竞价小幅高开${auctionPct.toFixed(1)}% 关注开盘后表现`;
        bonus = 6;
      } else if (auctionPct <= -2) {
        // 低开预警（昨日强势票今日低开 → 警告）
        triggerReason = `⚠️竞价低开${auctionPct.toFixed(1)}% 谨防高位接力失败`;
        bonus = -5;
      } else {
        // 平开附近不触发
        continue;
      }

      const alertScore = Math.min(100, Math.max(0, pick.score + bonus));
      alerts.push({
        code: pick.code,
        name: pick.name,
        currentPrice: q.price,
        changePercent: Math.round(auctionPct * 100) / 100,
        turnoverRate: 0,
        amount: q.amount,
        triggerReason: `[竞价] [昨日${pick.score}分${pick.limitUpToday ? "涨停" : pick.nearLimitUpToday ? "冲板" : "强势"}] ${triggerReason}`,
        score: alertScore,
        detectedAt: new Date().toISOString(),
        sectors: pick.sectors,
        concepts: pick.concepts,
      });
      continue;
    }

    // 盘中阶段
    // 高开检测
    const openGapPct = q.prevClose > 0 ? ((q.open - q.prevClose) / q.prevClose) * 100 : 0;

    // 条件1：涨幅≥5% — 明确启动
    if (q.changePercent >= 5) {
      triggerReason = `涨${q.changePercent.toFixed(1)}%已启动`;
      bonus = 15;
    }
    // 条件2：涨幅≥3% + 换手≥2%
    else if (q.changePercent >= 3 && q.turnoverRate >= 2) {
      triggerReason = `涨${q.changePercent.toFixed(1)}%+换手${q.turnoverRate.toFixed(1)}%放量启动`;
      bonus = 10;
    }
    // 条件3：高开≥2% 且 当前价≥开盘价
    else if (openGapPct >= 2 && q.price >= q.open) {
      triggerReason = `高开${openGapPct.toFixed(1)}%且未回补`;
      bonus = 8;
    }
    // 条件4：价格在日内高位 + 涨幅≥2%
    else if (q.changePercent >= 2 && q.high > q.low) {
      const posInRange = (q.price - q.low) / (q.high - q.low);
      if (posInRange >= 0.9) {
        triggerReason = `涨${q.changePercent.toFixed(1)}%持续冲高`;
        bonus = 6;
      }
    }

    if (!triggerReason) continue;

    // 昨日评分 + 今日bonus
    const alertScore = Math.min(100, pick.score + bonus);

    alerts.push({
      code: pick.code,
      name: pick.name,
      currentPrice: q.price,
      changePercent: Math.round(q.changePercent * 100) / 100,
      turnoverRate: Math.round(q.turnoverRate * 100) / 100,
      amount: q.amount,
      triggerReason: `[昨日${pick.score}分${pick.limitUpToday ? "涨停" : pick.nearLimitUpToday ? "冲板" : "强势"}] ${triggerReason}`,
      score: alertScore,
      detectedAt: new Date().toISOString(),
      sectors: pick.sectors,
      concepts: pick.concepts,
    });
  }

  alerts.sort((a, b) => b.score - a.score);
  return alerts;
}
