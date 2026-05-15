import { NextResponse } from "next/server";
import {
  fetchStockList, fetchKLine, fetchNorthboundFlow, fetchMarketOverview,
  fetchMarketBreadth, fetchMarginData, fetchNearLimitUpStocks, fetchStockSectors,
  type KLineData, type StockQuote,
} from "@/lib/stock-api";
import { analyzeEvents } from "@/lib/event-driven";
import { generateQuantReport } from "@/lib/quant-engine";
import {
  loadStockPortfolio, stockRebalance, stockIntradayScan,
  type StockQuoteInfo, type LimitUpAlert,
} from "@/lib/stock-portfolio";
import { loadICWeights } from "@/lib/factor-ic";
import { sendNotification, type NotifyLevel } from "@/lib/notify";

export const dynamic = "force-dynamic";

// ================================================================
//  GET: 读取个股模拟盘状态
// ================================================================

export async function GET() {
  try {
    const state = await loadStockPortfolio();

    // 实时行情刷新
    try {
      if (state.holdings.length > 0) {
        const codes = state.holdings.map(h => h.code);
        // 获取持仓股票最新报价
        const allStocks = await fetchStockList(1, 100);
        const quoteMap = new Map(allStocks.map(s => [s.code, s]));
        for (const h of state.holdings) {
          const q = quoteMap.get(h.code);
          if (q && q.price > 0) {
            h.currentPrice = q.price;
            h.currentValue = h.shares * h.currentPrice;
            h.pnl = h.currentValue - h.costAmount;
            h.pnlPercent = h.costAmount > 0 ? (h.pnl / h.costAmount) * 100 : 0;
          }
        }
      }
    } catch {}

    const tv = state.cash + state.holdings.reduce((s, h) => s + h.currentValue, 0);
    return NextResponse.json({
      ...state,
      totalValue: Math.round(tv * 100) / 100,
      totalPnl: Math.round((tv - state.initialCapital) * 100) / 100,
      totalPnlPercent: Math.round(((tv - state.initialCapital) / state.initialCapital * 100) * 100) / 100,
      weekPnlPercent: Math.round((state.weekStartValue > 0 ? ((tv - state.weekStartValue) / state.weekStartValue * 100) : 0) * 100) / 100,
    });
  } catch (error) {
    console.error("Stock Portfolio GET error:", error);
    return NextResponse.json({ error: "读取个股组合失败" }, { status: 500 });
  }
}

// ================================================================
//  POST: 触发调仓（全量量化扫描+选股）
// ================================================================

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const forceRebalance = body.force === true;

    const state = await loadStockPortfolio();
    const today = new Date().toISOString().slice(0, 10);

    if (state.lastRebalanceDate === today && !forceRebalance) {
      return NextResponse.json({ message: "今日已调仓", portfolio: state });
    }

    // 获取全市场个股（取涨幅前100+跌幅前50 = 活跃标的池）
    const [topGainers, topLosers, northbound, market, eventAnalysis, breadth, margin] = await Promise.all([
      fetchStockList(1, 100),  // 涨幅排序前100
      fetchStockList(1, 50),   // 后面会反向取
      fetchNorthboundFlow(20),
      fetchMarketOverview(),
      analyzeEvents(),
      fetchMarketBreadth(),
      fetchMarginData(10),
    ]);

    // 合并去重
    const stockMap = new Map<string, StockQuote>();
    for (const s of [...topGainers, ...topLosers]) {
      if (!stockMap.has(s.code)) stockMap.set(s.code, s);
    }
    // 也加入持仓股票
    for (const h of state.holdings) {
      if (!stockMap.has(h.code)) {
        // 单独获取
        try {
          const [extra] = await Promise.all([fetchStockList(1, 5000)]);
          for (const s of extra) {
            if (s.code === h.code) stockMap.set(s.code, s);
          }
        } catch {}
      }
    }

    const stocks = Array.from(stockMap.values()).filter(s =>
      s.price > 0 && s.volume > 0 &&
      !s.name.includes("ST") && !s.name.includes("退") &&
      s.turnoverRate >= 0.3
    );

    const marketChange = (market.shIndex.changePercent + market.szIndex.changePercent) / 2;

    // 获取K线（并发，限制批次避免爆请求）
    const klineMap: Record<string, KLineData[]> = {};
    const BATCH = 20;
    for (let i = 0; i < stocks.length; i += BATCH) {
      const batch = stocks.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (s) => {
          try { klineMap[s.code] = await fetchKLine(s.code, undefined, 60); }
          catch { klineMap[s.code] = []; }
        })
      );
    }

    // 构建量化报告目标
    const targets = stocks.map(s => ({
      code: s.code, name: s.name, sector: "",
      klines: klineMap[s.code] || [],
      sectorData: null,
    })).filter(t => t.klines.length >= 20);

    const icWeights = await loadICWeights();
    const quantReport = generateQuantReport(
      targets, northbound, marketChange,
      eventAnalysis.sectorSummaries, eventAnalysis.topEvents,
      { breadth, margin },
      undefined, icWeights,
    );

    // 实时报价
    const quotes: StockQuoteInfo[] = stocks.map(s => ({
      code: s.code, name: s.name, price: s.price,
      changePercent: s.changePercent, volume: s.volume, amount: s.amount,
      turnoverRate: s.turnoverRate, pe: s.pe,
      high: s.high, low: s.low, open: s.open, prevClose: s.prevClose,
    }));

    const result = await stockRebalance(state, quantReport, quotes);

    // 通知
    if (result.actions.length > 0) {
      notifyStockActions("个股调仓", result.actions, result.reasoning);
    }
    // 每日推荐
    if (result.topPicks.length > 0) {
      notifyDailyPick(result.topPicks);
    }

    const tv = result.portfolio.cash + result.portfolio.holdings.reduce((s, h) => s + h.currentValue, 0);
    return NextResponse.json({
      success: true,
      reasoning: result.reasoning,
      actions: result.actions,
      topPicks: result.topPicks,
      portfolio: {
        ...result.portfolio,
        totalValue: Math.round(tv * 100) / 100,
        totalPnl: Math.round((tv - result.portfolio.initialCapital) * 100) / 100,
        totalPnlPercent: Math.round(((tv - result.portfolio.initialCapital) / result.portfolio.initialCapital * 100) * 100) / 100,
        weekPnlPercent: Math.round((result.portfolio.weekStartValue > 0 ? ((tv - result.portfolio.weekStartValue) / result.portfolio.weekStartValue * 100) : 0) * 100) / 100,
      },
    });
  } catch (error) {
    console.error("Stock Portfolio POST error:", error);
    return NextResponse.json({ error: "个股调仓失败" }, { status: 500 });
  }
}

// ================================================================
//  PUT: 盘中实时扫描（止损+机会买入）
// ================================================================

let lastFullScanTime = 0;
const FULL_SCAN_INTERVAL_MS = 5 * 60 * 1000;

export async function PUT() {
  try {
    const state = await loadStockPortfolio();
    const hasHoldings = state.holdings.length > 0;
    const hasCapacity = state.holdings.length < 1 && state.cash > 3000;

    if (!hasHoldings && !hasCapacity) {
      return NextResponse.json({ triggered: false, reasoning: "空仓且无余力", portfolio: state });
    }

    // 获取实时报价 + 涨停候选（涨幅前200）
    const [stocks, nearLimitUp] = await Promise.all([
      fetchStockList(1, 100),
      fetchNearLimitUpStocks(),
    ]);
    const stockMap = new Map<string, StockQuote>();
    for (const s of [...stocks, ...nearLimitUp]) {
      if (!stockMap.has(s.code)) stockMap.set(s.code, s);
    }

    // 确保持仓股在报价列表中
    for (const h of state.holdings) {
      if (!stockMap.has(h.code)) {
        try {
          const extra = await fetchStockList(1, 5000);
          for (const s of extra) {
            if (s.code === h.code) stockMap.set(s.code, s);
          }
        } catch {}
      }
    }

    const allStocks = Array.from(stockMap.values());
    const quotes: StockQuoteInfo[] = allStocks.map(s => ({
      code: s.code, name: s.name, price: s.price,
      changePercent: s.changePercent, volume: s.volume, amount: s.amount,
      turnoverRate: s.turnoverRate, pe: s.pe,
      high: s.high, low: s.low, open: s.open, prevClose: s.prevClose,
    }));

    // 全量扫描
    let quantReport = undefined;
    const now = Date.now();
    if (hasCapacity && now - lastFullScanTime > FULL_SCAN_INTERVAL_MS) {
      try {
        const [northbound, market, eventAnalysis, breadth, margin] = await Promise.all([
          fetchNorthboundFlow(20),
          fetchMarketOverview(),
          analyzeEvents(),
          fetchMarketBreadth(),
          fetchMarginData(10),
        ]);

        const marketChange = (market.shIndex.changePercent + market.szIndex.changePercent) / 2;
        const activeStocks = allStocks.filter(s =>
          s.price > 0 && s.volume > 0 && !s.name.includes("ST") && !s.name.includes("退") && s.turnoverRate >= 0.5
        );

        const klineMap: Record<string, KLineData[]> = {};
        const BATCH = 20;
        for (let i = 0; i < activeStocks.length; i += BATCH) {
          const batch = activeStocks.slice(i, i + BATCH);
          await Promise.all(
            batch.map(async (s) => {
              try { klineMap[s.code] = await fetchKLine(s.code, undefined, 60); }
              catch { klineMap[s.code] = []; }
            })
          );
        }

        const targets = activeStocks.map(s => ({
          code: s.code, name: s.name, sector: "",
          klines: klineMap[s.code] || [],
          sectorData: null,
        })).filter(t => t.klines.length >= 20);

        const icWeights = await loadICWeights();
        quantReport = generateQuantReport(
          targets, northbound, marketChange,
          eventAnalysis.sectorSummaries, eventAnalysis.topEvents,
          { breadth, margin },
          undefined, icWeights,
        );
        lastFullScanTime = now;
      } catch (e) {
        console.error("Stock intraday full scan error:", e);
      }
    }

    const result = await stockIntradayScan(state, quotes, quantReport);

    if (result.triggered && result.actions.length > 0) {
      notifyStockActions("个股盘中", result.actions, result.reasoning);
    }

    // 涨停预判通知（推早期启动阶段，仅交易时段）
    const bjNow = new Date(Date.now() + 8 * 3600000);
    const dayOfWeek = bjNow.getUTCDay();
    const minsOfDay = bjNow.getUTCHours() * 60 + bjNow.getUTCMinutes();
    const isTradingHours = dayOfWeek >= 1 && dayOfWeek <= 5 && ((minsOfDay >= 570 && minsOfDay <= 690) || (minsOfDay >= 780 && minsOfDay <= 900));
    if (isTradingHours) {
      // 推早期启动阶段（冲刺7-8%），过滤掉即将封板的（触板/封板）
      const hotAlerts = (result.limitUpAlerts || []).filter(a => a.phase === "冲刺" || a.phase === "临门");
      if (hotAlerts.length > 0) {
        // 补充板块/概念信息
        const sectorMap = await fetchStockSectors(hotAlerts.map(a => a.code)).catch(() => new Map());
        for (const a of hotAlerts) {
          const info = sectorMap.get(a.code);
          if (info) { (a as any).sectors = info.sectors; (a as any).concepts = info.concepts; }
        }
        notifyLimitUpAlerts(hotAlerts);
      }
    }

    const tv = result.portfolio.cash + result.portfolio.holdings.reduce((s, h) => s + h.currentValue, 0);
    return NextResponse.json({
      triggered: result.triggered,
      reasoning: result.reasoning,
      actions: result.actions,
      limitUpAlerts: result.limitUpAlerts || [],
      portfolio: {
        ...result.portfolio,
        totalValue: Math.round(tv * 100) / 100,
        totalPnl: Math.round((tv - result.portfolio.initialCapital) * 100) / 100,
        totalPnlPercent: Math.round(((tv - result.portfolio.initialCapital) / result.portfolio.initialCapital * 100) * 100) / 100,
        weekPnlPercent: Math.round((result.portfolio.weekStartValue > 0 ? ((tv - result.portfolio.weekStartValue) / result.portfolio.weekStartValue * 100) : 0) * 100) / 100,
      },
    });
  } catch (error) {
    console.error("Stock intraday scan error:", error);
    return NextResponse.json({ error: "个股盘中扫描失败" }, { status: 500 });
  }
}

// ================================================================
//  通知辅助
// ================================================================

interface TradeAction {
  type: string;
  code: string;
  name: string;
  sector: string;
  shares: number;
  amount: number;
  reason: string;
  quantScore?: number;
}

function notifyStockActions(source: string, actions: TradeAction[], reasoning: string) {
  const hasStop = reasoning.includes("止损") || reasoning.includes("熔断");
  const hasBuy = actions.some(a => a.type === "买入");

  let level: NotifyLevel = "提示";
  if (hasStop) level = "紧急";
  else if (hasBuy) level = "警告";

  const lines = actions.map(a => {
    const emoji = a.type === "买入" ? "🟢" : a.type === "卖出" ? "🔴" : "🟡";
    return `${emoji} **${a.type}** ${a.name}(${a.code}) ${a.shares}股 ¥${a.amount.toFixed(0)}\n   ${a.reason}${a.quantScore ? ` | 量化${a.quantScore}分` : ""}`;
  });

  const title = `📈 ${source}：${actions.map(a => `${a.type}${a.name}`).join("、")}`;
  const content = lines.join("\n") + `\n\n**摘要**：${reasoning}`;

  sendNotification({ level, title, content }).catch(e => console.error("通知失败:", e));
}

function notifyDailyPick(topPicks: { code: string; name: string; score: number; reason: string }[]) {
  const lines = topPicks.slice(0, 5).map((p, i) =>
    `${i + 1}. **${p.name}**(${p.code}) ${p.score}分 — ${p.reason}`
  );

  const title = "📊 今日个股量化Top5推荐";
  const content = lines.join("\n") + "\n\n> 仅供参考，不构成投资建议";

  sendNotification({ level: "日报", title, content }).catch(e => console.error("推荐通知失败:", e));
}

// 涨停预判通知（防重复：同一只票5分钟内不重复通知）
const limitUpNotifyCache = new Map<string, number>();

function notifyLimitUpAlerts(alerts: LimitUpAlert[]) {
  const now = Date.now();
  const COOLDOWN_MS = 15 * 60 * 1000; // 15分钟冷却（降低推送频率）

  // 过滤掉冷却期内已通知的
  const fresh = alerts.filter(a => {
    const lastNotified = limitUpNotifyCache.get(a.code) || 0;
    return now - lastNotified > COOLDOWN_MS;
  });

  if (fresh.length === 0) return;

  // 标记为已通知
  for (const a of fresh) {
    limitUpNotifyCache.set(a.code, now);
  }

  // 清理过期缓存
  for (const [code, ts] of limitUpNotifyCache) {
    if (now - ts > 30 * 60 * 1000) limitUpNotifyCache.delete(code);
  }

  const phaseEmoji: Record<string, string> = {
    "冲刺": "🏃",
    "临门": "🔥",
    "触板": "🚀",
    "封板": "🔒",
  };

  const lines = fresh.map(a => {
    const emoji = phaseEmoji[a.phase] || "📈";
    const amountStr = a.amount >= 100000000
      ? `${(a.amount / 100000000).toFixed(1)}亿`
      : `${(a.amount / 10000).toFixed(0)}万`;
    const sectorParts: string[] = [];
    if ((a as any).sectors?.length) sectorParts.push(...(a as any).sectors.slice(0, 2).map((s: string) => `【${s}】`));
    if ((a as any).concepts?.length) sectorParts.push(...(a as any).concepts.slice(0, 3).map((c: string) => `#${c}`));
    const sectorStr = sectorParts.join(" ");
    return `${emoji} **${a.name}**(${a.code}) 涨${a.changePercent}% → **${a.phase}**\n   ${a.distancePercent > 0 ? `距涨停${a.distancePercent}%` : "已触板"} | 换手${a.turnoverRate}% | 成交${amountStr}\n   ${a.momentum}${sectorStr ? `\n   🎯 ${sectorStr}` : ""}`;
  });

  const title = `🔥 涨停预判：${fresh.map(a => `${a.name}[${a.phase}]`).join("、")}`;
  const content = lines.join("\n\n") + "\n\n> 涨停预判仅供参考，追涨有风险";

  sendNotification({ level: "紧急", title, content }).catch(e => console.error("涨停通知失败:", e));
}
