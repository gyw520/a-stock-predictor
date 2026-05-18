import { NextResponse } from "next/server";
import {
  fetchNearLimitUpStocks, fetchKLine, type KLineData,
  fetchEnhancedMarketData, fetchEnrichedSectorList, fetchStockSectors,
  fetchLimitUpPool, buildLimitUpDetails,
} from "@/lib/stock-api";
import {
  scanLimitUpPotential, type LimitUpCandidate,
  generateNextDayWatchlist, loadNextDayWatchlist, saveNextDayWatchlist, trackNextDayPicks,
  type NextDayAlert, type MarketContext,
} from "@/lib/limit-up-engine";
import { analyzeEvents } from "@/lib/event-driven";
import { sendNotification } from "@/lib/notify";
import { batchScoreLimitUpQuality, formatQualityTag, type LimitUpQuality } from "@/lib/limitup-quality";
import { runFullSentimentAnalysis, type EarlyBirdSignal } from "@/lib/sentiment-engine";

export const dynamic = "force-dynamic";

// 防重复推送：code -> { lastNotifyTime, lastLevel }
const notifyCache = new Map<string, { time: number; level: string }>();
// 上次推送摘要的时间
let lastDigestTime = 0;

export async function GET() {
  try {
    // 拉取涨幅排序前200只（覆盖3%+的票）
    const stocks = await fetchNearLimitUpStocks();

    const result = scanLimitUpPotential(
      stocks.map(s => ({
        code: s.code, name: s.name, price: s.price,
        changePercent: s.changePercent, volume: s.volume, amount: s.amount,
        open: s.open, high: s.high, low: s.low, prevClose: s.prevClose,
        turnoverRate: s.turnoverRate, pe: s.pe, marketCap: s.marketCap,
      })),
    );

    // 判断是否在交易时段（只在开市时间推送）
    const now = Date.now();
    const bjNow = new Date(now + 8 * 3600000);
    const day = bjNow.getUTCDay();
    const mins = bjNow.getUTCHours() * 60 + bjNow.getUTCMinutes();
    // 交易时段：周一至周五 9:30-11:30(570-690) 和 13:00-15:00(780-900)
    const isTrading = day >= 1 && day <= 5 && ((mins >= 570 && mins <= 690) || (mins >= 780 && mins <= 900));

    // 即时推送：仅在交易时段才推
    const COOLDOWN_MS = 15 * 60 * 1000; // 15分钟冷却（同票不重复推）
    const UPGRADE_COOLDOWN_MS = 10 * 60 * 1000; // 升级需10分钟冷却

    const toNotify: LimitUpCandidate[] = [];
    if (!isTrading) {
      // 非交易时段不推送，直接跳过
    } else {
      // 推送策略：优先推早期启动票（有上升空间+情绪火热），而非即将封板的票
      // 条件：(极高/高概率) + 距涨停≥1.5% + 市场热度≥30（有板块效应）
      const isHotMarket = result.marketHeat >= 30;
      for (const c of result.candidates) {
        // 只推极高或高概率
        if (c.level !== "极高" && c.level !== "高") continue;
        // 过滤掉即将封板的票（距涨停<1.5%），这种追高风险大
        if (c.distancePercent < 1.5) continue;
        // 情绪冷淡时不推
        if (!isHotMarket && c.level !== "极高") continue;
        // 成交额门槛：至少1亿
        if (c.amount < 100000000) continue;

        const cached = notifyCache.get(c.code);
        if (!cached) {
          toNotify.push(c);
          notifyCache.set(c.code, { time: now, level: c.level });
          continue;
        }

        // 升级通知
        if (c.level === "极高" && cached.level !== "极高" && now - cached.time > UPGRADE_COOLDOWN_MS) {
          toNotify.push(c);
          notifyCache.set(c.code, { time: now, level: c.level });
          continue;
        }

        // 正常冷却期
        if (now - cached.time > COOLDOWN_MS) {
          toNotify.push(c);
          notifyCache.set(c.code, { time: now, level: c.level });
        }
      }
    }

    // 清理过期缓存（60分钟后才清，保证同票1小时内最多推4次）
    for (const [code, data] of notifyCache) {
      if (now - data.time > 60 * 60 * 1000) notifyCache.delete(code);
    }

    // 推送（先补充板块/概念信息）
    if (toNotify.length > 0) {
      const sectorMap = await fetchStockSectors(toNotify.map(c => c.code)).catch(() => new Map());
      for (const c of toNotify) {
        const info = sectorMap.get(c.code);
        if (info) { c.sectors = info.sectors; c.concepts = info.concepts; }
      }
      notifyLimitUp(toNotify);
    }

    // 30分钟一次全景摘要（仅交易时段）
    const DIGEST_INTERVAL = 30 * 60 * 1000;
    if (isTrading && now - lastDigestTime > DIGEST_INTERVAL && result.candidates.filter(c => c.score >= 45).length >= 3) {
      // 补充板块信息给摘要中的候选
      const digestCodes = result.candidates.filter(c => c.score >= 45).slice(0, 8).map(c => c.code);
      const digestSectorMap = await fetchStockSectors(digestCodes).catch(() => new Map());
      for (const c of result.candidates) {
        const info = digestSectorMap.get(c.code);
        if (info) { c.sectors = info.sectors; c.concepts = info.concepts; }
      }
      notifyDigest(result);
      lastDigestTime = now;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Limit-up scan error:", error);
    return NextResponse.json({ error: "涨停扫描失败" }, { status: 500 });
  }
}

// ================================================================
//  通知
// ================================================================

/** 格式化板块+概念标签，优先显示概念（更有信息量），最多取3个板块+3个概念 */
function formatSectorTags(sectors?: string[], concepts?: string[]): string {
  const parts: string[] = [];
  if (sectors && sectors.length > 0) parts.push(...sectors.slice(0, 3).map(s => `【${s}】`));
  if (concepts && concepts.length > 0) parts.push(...concepts.slice(0, 3).map(c => `#${c}`));
  return parts.join(" ");
}

function notifyLimitUp(candidates: LimitUpCandidate[]) {
  const levelEmoji: Record<string, string> = { "极高": "🔴", "高": "🟠" };

  const lines = candidates.slice(0, 5).map(c => {
    const emoji = levelEmoji[c.level] || "🟡";
    const amountStr = c.amount >= 100000000
      ? `${(c.amount / 100000000).toFixed(1)}亿`
      : `${(c.amount / 10000).toFixed(0)}万`;
    const upRoom = `上升空间${c.distancePercent}%`;

    const sectorStr = formatSectorTags(c.sectors, c.concepts);
    return `${emoji} **${c.name}**(${c.code}) **${c.level}概率** ${c.score}分
   涨${c.changePercent}% | ${upRoom}
   换手${c.turnoverRate}% | 成交${amountStr}
   ${c.reason}${sectorStr ? `
   🎯 ${sectorStr}` : ""}`;
  });

  const title = `� 早期启动：${candidates.slice(0, 3).map(c => `${c.name}[涨${c.changePercent}%]`).join("、")}`;
  const content = lines.join("\n\n") + "\n\n> ⚠️ 早期信号仅供参考，注意仓位控制";

  sendNotification({ level: "紧急", title, content }).catch(e => console.error("涨停推送失败:", e));
}

// ================================================================
//  POST: 收盘后生成次日关注列表（14:50+自动触发或手动）
// ================================================================

export async function POST() {
  try {
    const stocks = await fetchNearLimitUpStocks();

    // 批量拉K线（只拉主板涨幅≥3%的票，控制请求量）
    const hotStocks = stocks.filter(s =>
      s.changePercent >= 3 && s.price > 0 && s.volume > 0 &&
      !s.name.includes("ST") &&
      (s.code.startsWith("60") || s.code.startsWith("00"))
    );
    const klineMap: Record<string, KLineData[]> = {};
    const BATCH = 15;
    for (let i = 0; i < hotStocks.length; i += BATCH) {
      const batch = hotStocks.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (s) => {
          try {
            const kl = await fetchKLine(s.code, undefined, 30);
            klineMap[s.code] = kl;
          } catch { klineMap[s.code] = []; }
        })
      );
    }

    // 并行拉取市场环境数据 + 事件驱动
    const [enhancedMarket, sectors, eventAnalysis] = await Promise.all([
      fetchEnhancedMarketData().catch(() => null),
      fetchEnrichedSectorList().catch(() => []),
      analyzeEvents().catch(() => ({ events: [], sectorSummaries: [], topEvents: [], timestamp: "" })),
    ]);

    // 构建市场上下文
    let marketCtx: MarketContext | undefined;
    if (enhancedMarket) {
      const nb = enhancedMarket.northbound;
      const nb3d = nb.slice(-3).reduce((s, n) => s + n.total, 0);
      const nbToday = nb.length > 0 ? nb[nb.length - 1].total : 0;
      const marginNet3d = enhancedMarket.margin.slice(0, 3).reduce((s, m) => s + m.netMarginBuy, 0);
      const hotSectors = sectors
        .sort((a, b) => b.changePercent - a.changePercent)
        .slice(0, 8)
        .map(s => s.name);

      marketCtx = {
        sentimentScore: enhancedMarket.breadth.sentimentScore,
        limitUpCount: enhancedMarket.sentiment.limitUp || enhancedMarket.breadth.limitUp,
        limitDownCount: enhancedMarket.sentiment.limitDown || enhancedMarket.breadth.limitDown,
        upDownRatio: enhancedMarket.breadth.upDownRatio,
        totalAmount: enhancedMarket.breadth.totalAmount,
        amountPercentile: enhancedMarket.breadth.amountPercentile,
        strongStockRatio: enhancedMarket.breadth.strongStockRatio,
        northbound3d: nb3d,
        northboundToday: nbToday,
        marginNetBuy3d: marginNet3d,
        hotSectors,
        events: eventAnalysis.topEvents.map(e => ({
          title: e.title,
          category: e.category,
          sectors: e.sectors,
          impact: e.impact,
          weight: e.weight,
          reason: e.reason,
        })),
      };
    }

    const watchlist = generateNextDayWatchlist(
      stocks.map(s => ({
        code: s.code, name: s.name, price: s.price,
        changePercent: s.changePercent, volume: s.volume, amount: s.amount,
        open: s.open, high: s.high, low: s.low, prevClose: s.prevClose,
        turnoverRate: s.turnoverRate, pe: s.pe, marketCap: s.marketCap,
      })),
      klineMap,
      marketCtx,
    );

    // 拉取涨停池详情（封板时间、封单、灸板等）+ 计算涨停质量分
    const [limitUpPool, sectorMap] = await Promise.all([
      fetchLimitUpPool().catch(() => []),
      watchlist.picks.length > 0
        ? fetchStockSectors(watchlist.picks.map(p => p.code)).catch(() => new Map())
        : Promise.resolve(new Map()),
    ]);

    // 涨停质量评分
    let qualityMap = new Map<string, LimitUpQuality>();
    if (limitUpPool.length > 0) {
      const details = buildLimitUpDetails(limitUpPool, klineMap);
      const qualities = batchScoreLimitUpQuality(details);
      qualityMap = new Map(qualities.map(q => [q.code, q]));
    }

    // 补充板块/概念 + 涨停质量信息到关注列表
    if (watchlist.picks.length > 0) {
      for (const p of watchlist.picks) {
        const info = sectorMap.get(p.code);
        if (info) { p.sectors = info.sectors; p.concepts = info.concepts; }
        // 涨停质量因子
        const q = qualityMap.get(p.code);
        if (q && p.limitUpToday) {
          p.qualityScore = q.qualityScore;
          p.qualityGrade = q.grade;
          p.qualityReasons = q.reasons;
          p.qualityRiskFlags = q.riskFlags;
          p.positionMultiplier = q.positionMultiplier;
          // 质量分影响综合分：垃圾板扣分，极优板加分
          if (q.qualityScore >= 80) {
            p.score = Math.min(100, p.score + 10);
            p.reasons.push(`🏆极优板(${q.qualityScore}分)`);
          } else if (q.qualityScore < 40) {
            p.score = Math.max(0, p.score - 15);
            p.reasons.push(`❌垃圾板(${q.qualityScore}分)`);
          } else if (q.qualityScore < 60) {
            p.score = Math.max(0, p.score - 8);
            p.reasons.push(`⚠️低质量板(${q.qualityScore}分)`);
          }
          // 风控标记加到reasons
          if (q.riskFlags.length > 0) {
            p.reasons.push(...q.riskFlags);
          }
        }
      }
      // 重新排序（质量分影响后）并保存
      watchlist.picks.sort((a, b) => b.score - a.score);
      // 重新判定等级
      for (const p of watchlist.picks) {
        if (p.score >= 70) p.level = "极高";
        else if (p.score >= 55) p.level = "高";
        else p.level = "中";
      }
      await saveNextDayWatchlist(watchlist);
      notifyNextDayWatchlist(watchlist);
    }

    // === 情绪+事件+公司综合早鸟分析（失败不阻塞，降级为基础评分） ===
    let earlyBirds: EarlyBirdSignal[] = [];
    let sentimentSummary = "";
    try {
      const topPicks = watchlist.picks.slice(0, 15);
      if (topPicks.length > 0) {
        const sentimentReport = await runFullSentimentAnalysis(
          topPicks.map(p => ({
            code: p.code, name: p.name,
            scalpQualityScore: p.qualityScore ?? p.score,
            scalpQualityGrade: p.qualityGrade ?? (p.score >= 70 ? "极优板" : p.score >= 55 ? "中等质量板" : "低质量板"),
            limitUpToday: p.limitUpToday,
            changePercent: p.todayChangePercent,
            turnoverRate: p.todayTurnoverRate,
            amount: p.todayAmount,
            marketCap: undefined as number | undefined,
            pe: undefined as number | undefined,
            sector: p.sectors?.[0],
            qualityRiskFlags: p.qualityRiskFlags,
          })),
        );
        earlyBirds = sentimentReport.earlyBirds;
        sentimentSummary = sentimentReport.summary;
      }
    } catch (e) {
      console.error("Sentiment analysis error, using fallback:", e);
      // 降级：直接用 watchlist 分数生成基础推荐
      earlyBirds = watchlist.picks.slice(0, 10).map(p => ({
        code: p.code, name: p.name,
        totalScore: p.score,
        level: p.score >= 70 ? "强烈推荐" : p.score >= 55 ? "推荐" : p.score >= 40 ? "关注" : "观望",
        scalpScore: p.score, sentimentScore: 0, eventScore: 0, companyScore: 0,
        catalyst: p.reasons.slice(0, 2).join("，"),
        riskWarnings: p.qualityRiskFlags || [],
        entryWindow: "盘中关注",
        confidenceFactors: p.reasons.slice(0, 3),
        detectedAt: new Date().toISOString(),
      } as EarlyBirdSignal));
      sentimentSummary = "情绪分析暂不可用，显示基础评分";
    }

    return NextResponse.json({
      success: true,
      watchlist,
      earlyBirds,
      sentimentSummary,
    });
  } catch (error) {
    console.error("Next-day watchlist error:", error);
    return NextResponse.json({ error: "次日预判生成失败" }, { status: 500 });
  }
}

// ================================================================
//  PUT: 次日盘中追踪（每15秒调用，追踪昨日关注列表）
// ================================================================

const trackNotifyCache = new Map<string, number>();

export async function PUT() {
  try {
    // 判断当前阶段（先算，便于早期返回也带上）
    const now = Date.now();
    const bjNow = new Date(now + 8 * 3600000);
    const day = bjNow.getUTCDay();
    const mins = bjNow.getUTCHours() * 60 + bjNow.getUTCMinutes();
    const isWeekday = day >= 1 && day <= 5;
    // 9:15-9:25 集合竞价
    const isCallAuction = isWeekday && mins >= 555 && mins <= 565;
    // 9:30-11:30 / 13:00-15:00 盘中
    const isIntraday = isWeekday && ((mins >= 570 && mins <= 690) || (mins >= 780 && mins <= 900));
    const phase: "callAuction" | "intraday" = isCallAuction ? "callAuction" : "intraday";

    const watchlist = await loadNextDayWatchlist();
    if (!watchlist || watchlist.picks.length === 0) {
      return NextResponse.json({ triggered: false, alerts: [], phase, reasoning: "无关注列表" });
    }

    // 关注列表必须是昨天或更早生成的（当天生成的是给明天用的）
    const today = new Date().toISOString().slice(0, 10);
    if (watchlist.date >= today) {
      // 当天生成的列表，说明还没到次日，但仍可追踪
      // 实际场景：下午生成，晚上不追踪，第二天才追踪
      // 允许追踪只要不是新生成的
    }

    // 拉取实时报价
    const stocks = await fetchNearLimitUpStocks();
    const alerts = trackNextDayPicks(
      watchlist,
      stocks.map(s => ({
        code: s.code, name: s.name, price: s.price,
        changePercent: s.changePercent, volume: s.volume, amount: s.amount,
        open: s.open, high: s.high, low: s.low, prevClose: s.prevClose,
        turnoverRate: s.turnoverRate, pe: s.pe, marketCap: s.marketCap,
      })),
      phase,
    );

    // 推送（集合竞价 + 盘中均推送）
    if ((isCallAuction || isIntraday) && alerts.length > 0) {
      const fresh = alerts.filter(a => {
        const last = trackNotifyCache.get(a.code) || 0;
        // 竞价5分钟冷却（整个竞价阶段最多推2次），盘中10分钟冷却
        const cooldown = isCallAuction ? 5 * 60 * 1000 : 10 * 60 * 1000;
        return now - last > cooldown;
      });
      if (fresh.length > 0) {
        for (const a of fresh) trackNotifyCache.set(a.code, now);
        notifyNextDayAlerts(fresh, isCallAuction);
      }
      // 清理
      for (const [code, ts] of trackNotifyCache) {
        if (now - ts > 30 * 60 * 1000) trackNotifyCache.delete(code);
      }
    }

    return NextResponse.json({
      triggered: alerts.length > 0,
      alerts,
      watchlist,
      phase,
      reasoning: alerts.length > 0
        ? `${isCallAuction ? "[竞价] " : ""}${alerts.length}只昨日关注票异动：${alerts.slice(0, 3).map(a => a.name).join("、")}`
        : "昨日关注列表暂无异动",
    });
  } catch (error) {
    console.error("Next-day track error:", error);
    return NextResponse.json({ error: "次日追踪失败" }, { status: 500 });
  }
}

// ================================================================
//  PATCH: 集合竞价快照统计（9:15-9:25专用）
// ================================================================

interface AuctionStock {
  code: string; name: string; price: number; prevClose: number;
  changePercent: number; amount: number; volume: number; marketCap: number;
}

interface AuctionStats {
  phase: "preMarket" | "callAuction" | "trading" | "afterMarket";
  timestamp: string;
  // 整体统计（仅主板）
  totalStocks: number;
  limitUpExpect: number;        // 一字涨停预期 (≥9.8%)
  highOpen7: number;            // 高开 ≥7%
  highOpen5: number;            // 高开 ≥5%
  highOpen3: number;            // 高开 ≥3%
  highOpen1: number;            // 高开 ≥1%（含上面所有）
  flat: number;                 // 平开 (-1%~1%)
  lowOpen3: number;             // 低开 ≤-3%
  lowOpen5: number;             // 低开 ≤-5%
  lowOpen7: number;             // 低开 ≤-7%
  limitDownExpect: number;      // 一字跌停预期 (≤-9.8%)
  upDownRatio: number;          // 涨跌比
  avgChange: number;            // 平均涨跌幅
  sentiment: "极度乐观" | "乐观" | "中性偏多" | "中性" | "中性偏空" | "悲观" | "极度悲观";
  sentimentScore: number;       // -100~100
  // TopN
  topGainers: AuctionStock[];   // 高开 Top 30
  topLosers: AuctionStock[];    // 低开 Top 10
  // 昨日关注票今日竞价表现
  watchlistAuction: {
    code: string; name: string;
    yesterdayScore: number; yesterdayLevel: string;
    auctionPct: number;         // 今日竞价涨跌幅
    matchedAuction: boolean;    // 是否在竞价数据中找到
  }[];
}

export async function PATCH() {
  try {
    const now = Date.now();
    const bjNow = new Date(now + 8 * 3600000);
    const day = bjNow.getUTCDay();
    const mins = bjNow.getUTCHours() * 60 + bjNow.getUTCMinutes();
    const isWeekday = day >= 1 && day <= 5;
    let phase: AuctionStats["phase"];
    if (!isWeekday) phase = "afterMarket";
    else if (mins < 555) phase = "preMarket";
    else if (mins <= 565) phase = "callAuction";
    else if ((mins <= 690) || (mins >= 780 && mins <= 900)) phase = "trading";
    else phase = "afterMarket";

    // 拉取涨幅前500 + 跌幅前200，覆盖竞价高开低开
    const [gainersRes, losersRes] = await Promise.all([
      fetch(`https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=500&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f6,f7,f12,f14,f17,f18`,
        { headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" }, cache: "no-store" }).then(r => r.json()).catch(() => null),
      fetch(`https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=300&po=0&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f6,f7,f12,f14,f17,f18`,
        { headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" }, cache: "no-store" }).then(r => r.json()).catch(() => null),
    ]);

    const parseItem = (item: Record<string, number | string>): AuctionStock => ({
      code: String(item.f12),
      name: String(item.f14),
      price: Number(item.f2) || 0,
      changePercent: Number(item.f3) || 0,
      amount: Number(item.f6) || 0,
      volume: 0,
      marketCap: Number(item.f7) || 0,
      prevClose: Number(item.f18) || 0,
    });

    const gainers = (gainersRes?.data?.diff || []).map(parseItem);
    const losers = (losersRes?.data?.diff || []).map(parseItem);
    const allMap = new Map<string, AuctionStock>();
    for (const s of [...gainers, ...losers]) {
      // 仅主板（沪市60+深市00）
      if (!(s.code.startsWith("60") || s.code.startsWith("00"))) continue;
      // 过滤ST、退市
      if (s.name.includes("ST") || s.name.includes("退")) continue;
      // 过滤异常数据
      if (s.price <= 0 || s.prevClose <= 0) continue;
      allMap.set(s.code, s);
    }
    const all = Array.from(allMap.values());

    // 统计
    let limitUpExpect = 0, h7 = 0, h5 = 0, h3 = 0, h1 = 0;
    let flat = 0, l3 = 0, l5 = 0, l7 = 0, limitDownExpect = 0;
    let riseCount = 0, fallCount = 0, sumChange = 0;
    for (const s of all) {
      const p = s.changePercent;
      sumChange += p;
      if (p > 0) riseCount++;
      else if (p < 0) fallCount++;
      if (p >= 9.8) limitUpExpect++;
      if (p >= 7) h7++;
      if (p >= 5) h5++;
      if (p >= 3) h3++;
      if (p >= 1) h1++;
      if (p > -1 && p < 1) flat++;
      if (p <= -3) l3++;
      if (p <= -5) l5++;
      if (p <= -7) l7++;
      if (p <= -9.8) limitDownExpect++;
    }
    const total = all.length || 1;
    const upDownRatio = fallCount > 0 ? Math.round((riseCount / fallCount) * 100) / 100 : riseCount > 0 ? 99 : 1;
    const avgChange = Math.round((sumChange / total) * 100) / 100;
    // 情绪打分
    const sentimentScore = Math.max(-100, Math.min(100, Math.round(
      (limitUpExpect - limitDownExpect) * 3 +
      (h5 - l5) * 0.8 +
      (h3 - l3) * 0.4 +
      avgChange * 5,
    )));
    let sentiment: AuctionStats["sentiment"];
    if (sentimentScore >= 60) sentiment = "极度乐观";
    else if (sentimentScore >= 30) sentiment = "乐观";
    else if (sentimentScore >= 10) sentiment = "中性偏多";
    else if (sentimentScore >= -10) sentiment = "中性";
    else if (sentimentScore >= -30) sentiment = "中性偏空";
    else if (sentimentScore >= -60) sentiment = "悲观";
    else sentiment = "极度悲观";

    // Top
    const sorted = [...all].sort((a, b) => b.changePercent - a.changePercent);
    const topGainers = sorted.slice(0, 30);
    const topLosers = sorted.slice(-10).reverse();

    // 昨日关注票今日竞价表现
    const watchlist = await loadNextDayWatchlist();
    const watchlistAuction: AuctionStats["watchlistAuction"] = (watchlist?.picks || []).map(p => {
      const m = allMap.get(p.code);
      return {
        code: p.code, name: p.name,
        yesterdayScore: p.score, yesterdayLevel: p.level,
        auctionPct: m ? Math.round(m.changePercent * 100) / 100 : 0,
        matchedAuction: !!m,
      };
    }).sort((a, b) => b.auctionPct - a.auctionPct);

    const stats: AuctionStats = {
      phase,
      timestamp: new Date().toISOString(),
      totalStocks: total,
      limitUpExpect, highOpen7: h7, highOpen5: h5, highOpen3: h3, highOpen1: h1,
      flat,
      lowOpen3: l3, lowOpen5: l5, lowOpen7: l7, limitDownExpect,
      upDownRatio, avgChange,
      sentiment, sentimentScore,
      topGainers, topLosers,
      watchlistAuction,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Auction stats error:", error);
    return NextResponse.json({ error: "竞价统计失败" }, { status: 500 });
  }
}

// ================================================================
//  通知函数
// ================================================================

function notifyNextDayWatchlist(wl: { picks: { code: string; name: string; score: number; level: string; reasons: string[]; limitUpToday: boolean; todayChangePercent: number; todayAmount: number; sectors?: string[]; concepts?: string[]; qualityScore?: number; qualityGrade?: string; positionMultiplier?: number }[] }) {
  const lines = wl.picks.slice(0, 10).map((p, i) => {
    const amountStr = p.todayAmount >= 100000000
      ? `${(p.todayAmount / 100000000).toFixed(1)}亿`
      : `${(p.todayAmount / 10000).toFixed(0)}万`;
    const tag = p.limitUpToday ? "🔒涨停" : `涨${p.todayChangePercent}%`;
    const sectorStr = formatSectorTags(p.sectors, p.concepts);
    // 涨停质量标签
    const qualityStr = p.qualityScore != null && p.limitUpToday
      ? ` | 板质${p.qualityScore}分[${p.qualityGrade}]${p.positionMultiplier != null && p.positionMultiplier < 1 ? ` 仓位×${p.positionMultiplier}` : ""}`
      : "";
    return `${i + 1}. **${p.name}**(${p.code}) **${p.score}分[${p.level}]** ${tag} ${amountStr}${qualityStr}\n   ${p.reasons.slice(0, 5).join(" + ")}${sectorStr ? `\n   🎯 ${sectorStr}` : ""}`;
  });

  const extreme = wl.picks.filter(p => p.level === "极高").length;
  const high = wl.picks.filter(p => p.level === "高").length;

  const title = `📋 明日冲板关注：${extreme}只极高+${high}只高概率`;
  const content = lines.join("\n\n") + `\n\n共${wl.picks.length}只，明日盘中实时追踪\n> 收盘分析，仅供参考`;

  sendNotification({ level: "日报", title, content }).catch(e => console.error("次日推送失败:", e));
}

function notifyNextDayAlerts(alerts: NextDayAlert[], isCallAuction = false) {
  const lines = alerts.slice(0, 5).map(a => {
    const amountStr = a.amount >= 100000000
      ? `${(a.amount / 100000000).toFixed(1)}亿`
      : `${(a.amount / 10000).toFixed(0)}万`;
    const sign = a.changePercent >= 0 ? "+" : "";
    const sectorStr = formatSectorTags(a.sectors, a.concepts);
    if (isCallAuction) {
      return `🔔 **${a.name}**(${a.code}) ${sign}${a.changePercent}% ${a.score}分\n   ${a.triggerReason}${sectorStr ? `\n   🎯 ${sectorStr}` : ""}`;
    }
    return `🚨 **${a.name}**(${a.code}) ${sign}${a.changePercent}% ${a.score}分\n   ${a.triggerReason}\n   换手${a.turnoverRate}% 成交${amountStr}${sectorStr ? `\n   🎯 ${sectorStr}` : ""}`;
  });

  const title = isCallAuction
    ? `� 集合竞价异动：${alerts.slice(0, 3).map(a => a.name).join("、")}`
    : `�� 昨日关注票启动：${alerts.slice(0, 3).map(a => a.name).join("、")}`;
  const content = lines.join("\n\n") + (isCallAuction
    ? "\n\n> 集合竞价撮合预估，9:25开盘前数据，仅供参考"
    : "\n\n> 昨日收盘预判今日追踪，追涨有风险");

  sendNotification({ level: "紧急", title, content }).catch(e => console.error("次日追踪推送失败:", e));
}

function notifyDigest(result: { candidates: LimitUpCandidate[]; limitUpCount: number; nearLimitUpCount: number; marketHeat: number }) {
  const hot = result.candidates.filter(c => c.score >= 45);
  if (hot.length === 0) return;

  const heatEmoji = result.marketHeat >= 70 ? "🔥🔥🔥" : result.marketHeat >= 40 ? "🔥🔥" : "🔥";

  const lines = hot.slice(0, 8).map((c, i) => {
    const amountStr = c.amount >= 100000000
      ? `${(c.amount / 100000000).toFixed(1)}亿`
      : `${(c.amount / 10000).toFixed(0)}万`;
    const sectorStr = formatSectorTags(c.sectors, c.concepts);
    return `${i + 1}. ${c.name}(${c.code}) **${c.score}分[${c.level}]** 涨${c.changePercent}% 差${c.distancePercent}% ${amountStr}${sectorStr ? ` ${sectorStr}` : ""}`;
  });

  const title = `${heatEmoji} 冲板全景：${result.limitUpCount}只封板 ${result.nearLimitUpCount}只冲击中`;
  const content = `市场炸板热度 **${result.marketHeat}/100**\n\n` + lines.join("\n") + "\n\n> 5分钟摘要";

  sendNotification({ level: "警告", title, content }).catch(e => console.error("摘要推送失败:", e));
}
