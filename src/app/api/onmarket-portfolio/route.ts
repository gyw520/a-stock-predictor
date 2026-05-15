import { NextResponse } from "next/server";
import {
  fetchETFList, fetchETFKLine, fetchEnrichedSectorList,
  fetchNorthboundFlow, fetchMarketOverview,
  fetchMarketBreadth, fetchMarginData, fetchETFValuations,
  calcTurnoverTrend,
  type KLineData, type TurnoverTrend, type ValuationData,
} from "@/lib/stock-api";
import { analyzeEvents } from "@/lib/event-driven";
import { generateQuantReport } from "@/lib/quant-engine";
import {
  loadOnMarketPortfolio, saveOnMarketPortfolio, onMarketRebalance, intradayScan,
  type OnMarketState, type OnMarketQuote,
} from "@/lib/onmarket-portfolio";
import { loadICWeights } from "@/lib/factor-ic";
import { isTradingTime } from "@/lib/trading-hours";
import { sendNotification, type NotifyLevel } from "@/lib/notify";

export const dynamic = "force-dynamic";

// GET: 读取场内ETF组合状态
export async function GET() {
  try {
    const state = loadOnMarketPortfolio();

    // 用实时行情刷新持仓市值
    try {
      const etfs = await fetchETFList();
      const etfMap = new Map(etfs.map(e => [e.code, e]));

      for (const h of state.holdings) {
        const etf = etfMap.get(h.code);
        if (etf && etf.price > 0) {
          h.currentPrice = etf.price;
          h.currentValue = h.shares * h.currentPrice;
          h.pnl = h.currentValue - h.costAmount;
          h.pnlPercent = h.costAmount > 0 ? (h.pnl / h.costAmount) * 100 : 0;
        }
      }
    } catch { /* use cached */ }

    const totalValue = state.cash + state.holdings.reduce((s, h) => s + h.currentValue, 0);
    const totalPnl = totalValue - state.initialCapital;
    const totalPnlPct = (totalPnl / state.initialCapital) * 100;
    const weekPnlPct = state.weekStartValue > 0 ? ((totalValue - state.weekStartValue) / state.weekStartValue) * 100 : 0;

    return NextResponse.json({
      ...state,
      totalValue: Math.round(totalValue * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      totalPnlPercent: Math.round(totalPnlPct * 100) / 100,
      weekPnlPercent: Math.round(weekPnlPct * 100) / 100,
    });
  } catch (error) {
    console.error("OnMarket Portfolio GET error:", error);
    return NextResponse.json({ error: "读取场内组合失败" }, { status: 500 });
  }
}

// POST: 触发调仓
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const forceRebalance = body.force === true;

    const state = loadOnMarketPortfolio();
    const today = new Date().toISOString().slice(0, 10);

    if (state.lastRebalanceDate === today && !forceRebalance) {
      return NextResponse.json({ message: "今日已调仓", portfolio: state });
    }

    // 并发获取数据
    const [etfs, sectors, northbound, market, eventAnalysis, breadth, margin] = await Promise.all([
      fetchETFList(),
      fetchEnrichedSectorList(),
      fetchNorthboundFlow(20),
      fetchMarketOverview(),
      analyzeEvents(),
      fetchMarketBreadth(),
      fetchMarginData(10),
    ]);

    const marketChange = (market.shIndex.changePercent + market.szIndex.changePercent) / 2;

    // K线
    const klineMap: Record<string, KLineData[]> = {};
    await Promise.all(
      etfs.map(async (etf) => {
        try { klineMap[etf.code] = await fetchETFKLine(etf.code, 60); }
        catch { klineMap[etf.code] = []; }
      })
    );

    // 量化报告
    const targets = etfs.map(etf => ({
      code: etf.code, name: etf.name, sector: etf.sector,
      klines: klineMap[etf.code] || [],
      sectorData: sectors.find(s =>
        etf.sector === s.name ||
        etf.name.includes(s.name.replace(/ETF|板块/g, "")) ||
        s.name.includes(etf.sector)
      ) || null,
    })).filter(t => t.klines.length >= 20);

    let valuations = new Map<string, ValuationData>();
    try { valuations = await fetchETFValuations(etfs.map(e => e.code)); } catch {}
    const turnovers = new Map<string, TurnoverTrend>();
    for (const etf of etfs) {
      const kl = klineMap[etf.code];
      if (kl && kl.length >= 20) turnovers.set(etf.code, calcTurnoverTrend(kl, etf.code));
    }

    const icWeights = loadICWeights();
    const quantReport = generateQuantReport(
      targets, northbound, marketChange,
      eventAnalysis.sectorSummaries, eventAnalysis.topEvents,
      { breadth, margin, valuations, turnovers },
      undefined, icWeights,
    );

    // 场内ETF实时报价
    const quotes: OnMarketQuote[] = etfs.map(etf => ({
      code: etf.code,
      name: etf.name,
      sector: etf.sector,
      price: etf.price,
      changePercent: etf.changePercent,
    }));

    const result = onMarketRebalance(state, quantReport, quotes);

    // 有操作时推送通知
    if (result.actions.length > 0) {
      notifyTradeActions("调仓", result.actions, result.reasoning);
    }

    const tv = result.portfolio.cash + result.portfolio.holdings.reduce((s, h) => s + h.currentValue, 0);
    return NextResponse.json({
      success: true,
      reasoning: result.reasoning,
      actions: result.actions,
      portfolio: {
        ...result.portfolio,
        totalValue: Math.round(tv * 100) / 100,
        totalPnl: Math.round((tv - result.portfolio.initialCapital) * 100) / 100,
        totalPnlPercent: Math.round(((tv - result.portfolio.initialCapital) / result.portfolio.initialCapital * 100) * 100) / 100,
        weekPnlPercent: Math.round((result.portfolio.weekStartValue > 0 ? ((tv - result.portfolio.weekStartValue) / result.portfolio.weekStartValue * 100) : 0) * 100) / 100,
      },
    });
  } catch (error) {
    console.error("OnMarket Portfolio POST error:", error);
    return NextResponse.json({ error: "场内调仓失败" }, { status: 500 });
  }
}

// PUT: 盘中实时扫描（做T+止损+机会买入）
// 轻量扫描每30秒；全量扫描（含量化报告）每5分钟一次
let lastFullScanTime = 0;
const FULL_SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5分钟

export async function PUT() {
  try {
    const state = loadOnMarketPortfolio();
    const hasHoldings = state.holdings.length > 0;
    const hasPending = (state.pendingTOrders || []).length > 0;
    const hasCapacity = state.holdings.length < 2 && state.cash > 2500;

    if (!hasHoldings && !hasPending && !hasCapacity) {
      return NextResponse.json({ triggered: false, reasoning: "空仓且无余力，无需扫描", portfolio: state });
    }

    // 获取实时报价 + 北向资金
    const [etfs, northbound] = await Promise.all([
      fetchETFList(),
      fetchNorthboundFlow(1),
    ]);

    // 北向资金今日净买入判断
    const nbToday = northbound.length > 0 ? northbound[northbound.length - 1] : null;
    const northboundBuying = nbToday ? nbToday.total > 0 : undefined;

    // 板块涨跌聚合（同板块ETF平均涨跌）
    const sectorChanges = new Map<string, number[]>();
    for (const etf of etfs) {
      if (!sectorChanges.has(etf.sector)) sectorChanges.set(etf.sector, []);
      sectorChanges.get(etf.sector)!.push(etf.changePercent);
    }
    const sectorAvg = new Map<string, number>();
    for (const [sector, changes] of sectorChanges) {
      sectorAvg.set(sector, changes.reduce((a, b) => a + b, 0) / changes.length);
    }

    const quotes: OnMarketQuote[] = etfs.map(etf => ({
      code: etf.code, name: etf.name, sector: etf.sector,
      price: etf.price, changePercent: etf.changePercent,
      mainNetInflow: etf.mainNetInflow / 10000, // 元→万
      sectorChange: sectorAvg.get(etf.sector),
      northboundBuy: northboundBuying,
      amplitude: etf.amplitude,     // 今日振幅%
      change5d: etf.change5d,       // 5日涨跌%
    }));

    // 全量扫描（含机会买入）：每5分钟跑一次量化报告
    let quantReport = undefined;
    const now = Date.now();
    if (hasCapacity && now - lastFullScanTime > FULL_SCAN_INTERVAL_MS) {
      try {
        const [sectors, market, eventAnalysis, breadth, margin] = await Promise.all([
          fetchEnrichedSectorList(),
          fetchMarketOverview(),
          analyzeEvents(),
          fetchMarketBreadth(),
          fetchMarginData(10),
        ]);

        const marketChange = (market.shIndex.changePercent + market.szIndex.changePercent) / 2;

        const klineMap: Record<string, KLineData[]> = {};
        await Promise.all(
          etfs.map(async (etf) => {
            try { klineMap[etf.code] = await fetchETFKLine(etf.code, 60); }
            catch { klineMap[etf.code] = []; }
          })
        );

        const targets = etfs.map(etf => ({
          code: etf.code, name: etf.name, sector: etf.sector,
          klines: klineMap[etf.code] || [],
          sectorData: sectors.find(s =>
            etf.sector === s.name ||
            etf.name.includes(s.name.replace(/ETF|板块/g, "")) ||
            s.name.includes(etf.sector)
          ) || null,
        })).filter(t => t.klines.length >= 20);

        let valuations = new Map<string, ValuationData>();
        try { valuations = await fetchETFValuations(etfs.map(e => e.code)); } catch {}
        const turnovers = new Map<string, TurnoverTrend>();
        for (const etf of etfs) {
          const kl = klineMap[etf.code];
          if (kl && kl.length >= 20) turnovers.set(etf.code, calcTurnoverTrend(kl, etf.code));
        }

        const icWeights = loadICWeights();
        quantReport = generateQuantReport(
          targets, northbound, marketChange,
          eventAnalysis.sectorSummaries, eventAnalysis.topEvents,
          { breadth, margin, valuations, turnovers },
          undefined, icWeights,
        );
        lastFullScanTime = now;
      } catch (e) {
        console.error("Intraday full scan error:", e);
        // 全量扫描失败不影响轻量级做T和止损
      }
    }

    const result = intradayScan(state, quotes, quantReport);

    // 有操作时推送通知（盘中买入/止损/做T）
    if (result.triggered && result.actions.length > 0) {
      notifyTradeActions("盘中", result.actions, result.reasoning);
    }

    const tv = result.portfolio.cash + result.portfolio.holdings.reduce((s, h) => s + h.currentValue, 0);
    return NextResponse.json({
      triggered: result.triggered,
      reasoning: result.reasoning,
      actions: result.actions,
      portfolio: {
        ...result.portfolio,
        totalValue: Math.round(tv * 100) / 100,
        totalPnl: Math.round((tv - result.portfolio.initialCapital) * 100) / 100,
        totalPnlPercent: Math.round(((tv - result.portfolio.initialCapital) / result.portfolio.initialCapital * 100) * 100) / 100,
        weekPnlPercent: Math.round((result.portfolio.weekStartValue > 0 ? ((tv - result.portfolio.weekStartValue) / result.portfolio.weekStartValue * 100) : 0) * 100) / 100,
      },
    });
  } catch (error) {
    console.error("Intraday scan error:", error);
    return NextResponse.json({ error: "盘中扫描失败" }, { status: 500 });
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

function notifyTradeActions(source: string, actions: TradeAction[], reasoning: string) {
  const hasBuy = actions.some(a => a.type === "买入");
  const hasSell = actions.some(a => a.type === "卖出" || a.type === "减仓");
  const hasStop = reasoning.includes("止损") || reasoning.includes("熔断");

  let level: NotifyLevel = "提示";
  if (hasStop) level = "紧急";
  else if (hasBuy) level = "警告"; // 买入机会用警告级确保不错过

  const lines = actions.map(a => {
    const emoji = a.type === "买入" ? "🟢" : a.type === "卖出" ? "🔴" : "🟡";
    return `${emoji} **${a.type}** ${a.name}(${a.code}) ${a.shares}股 ¥${a.amount.toFixed(0)}\n   ${a.reason}${a.quantScore ? ` | 量化${a.quantScore}分` : ""}`;
  });

  const title = `${source}信号：${actions.map(a => `${a.type}${a.name}`).join("、")}`;
  const content = lines.join("\n") + `\n\n**摘要**：${reasoning}`;

  // 异步发送，不阻塞响应
  sendNotification({ level, title, content }).catch(e => {
    console.error("通知发送失败:", e);
  });
}
