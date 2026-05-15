import { NextResponse } from "next/server";
import {
  fetchETFList, fetchETFKLine, fetchOTCFundList, fetchEnrichedSectorList,
  fetchNorthboundFlow, fetchMarketOverview,
  fetchMarketBreadth, fetchMarginData, fetchETFValuations,
  calcTurnoverTrend,
  type KLineData, type TurnoverTrend, type ValuationData,
} from "@/lib/stock-api";
import { analyzeEvents } from "@/lib/event-driven";
import { generateQuantReport } from "@/lib/quant-engine";
import { loadPortfolio, rebalance, savePortfolio, type PortfolioState } from "@/lib/model-portfolio";
import { recordFactorSnapshot, calcFactorDeltas } from "@/lib/factor-memory";
import { loadICWeights } from "@/lib/factor-ic";
import { isTradingTime } from "@/lib/trading-hours";

export const dynamic = "force-dynamic";

// GET: 读取当前组合状态
export async function GET() {
  try {
    const state = await loadPortfolio();
    // 尝试用最新行情刷新持仓市值
    try {
      const otcFunds = await fetchOTCFundList();
      const isTradingNow = isTradingTime();
      // 判断是否在"收盘后但净值未更新"的窗口（15:00-21:00）
      const now = new Date();
      const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
      const bj = new Date(utcMs + 8 * 3600000);
      const bjMinutes = bj.getHours() * 60 + bj.getMinutes();
      const isAfterCloseBeforeNav = !isTradingNow && bj.getDay() >= 1 && bj.getDay() <= 5 && bjMinutes >= 900 && bjMinutes <= 1260; // 15:00-21:00

      for (const h of state.holdings) {
        const otc = otcFunds.find(f => f.code === h.code);
        if (otc) {
          if ((isTradingNow || isAfterCloseBeforeNav) && otc.estimatedChange != null) {
            // 盘中或收盘后净值未更新：用估值涨跌幅叠加净值
            h.currentNav = otc.nav * (1 + otc.estimatedChange / 100);
          } else {
            // 净值已更新或非交易日：直接用最新公布净值
            h.currentNav = otc.nav;
          }
          h.currentValue = h.shares * h.currentNav;
          h.pnl = h.currentValue - h.costAmount;
          h.pnlPercent = h.costAmount > 0 ? (h.pnl / h.costAmount) * 100 : 0;
        }
      }
    } catch { /* use cached values */ }

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
    console.error("Portfolio GET error:", error);
    return NextResponse.json({ error: "读取组合失败" }, { status: 500 });
  }
}

// POST: 触发调仓
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const forceRebalance = body.force === true;

    const state = await loadPortfolio();
    const today = new Date().toISOString().slice(0, 10);

    // 防止同一天重复调仓（除非强制）
    if (state.lastRebalanceDate === today && !forceRebalance) {
      return NextResponse.json({ message: "今日已调仓", portfolio: state });
    }

    // 并发获取所有数据（含增强三层）
    const [etfs, otcFunds, sectors, northbound, market, eventAnalysis, breadth, margin] = await Promise.all([
      fetchETFList(),
      fetchOTCFundList(),
      fetchEnrichedSectorList(),
      fetchNorthboundFlow(20),
      fetchMarketOverview(),
      analyzeEvents(),
      fetchMarketBreadth(),
      fetchMarginData(10),
    ]);

    const marketChange = (market.shIndex.changePercent + market.szIndex.changePercent) / 2;
    const isTradingNow = isTradingTime();

    // 获取K线
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
      sectorData: sectors.find(s => etf.sector === s.name || etf.name.includes(s.name.replace(/ETF|板块/g, "")) || s.name.includes(etf.sector)) || null,
    })).filter(t => t.klines.length >= 20);

    // 获取估值 + 换手率趋势
    let valuations = new Map<string, ValuationData>();
    try { valuations = await fetchETFValuations(etfs.map(e => e.code)); } catch {}
    const turnovers = new Map<string, TurnoverTrend>();
    for (const etf of etfs) {
      const kl = klineMap[etf.code];
      if (kl && kl.length >= 20) turnovers.set(etf.code, calcTurnoverTrend(kl, etf.code));
    }

    // 先算因子趋势（用昨日快照对比）
    const icWeights = await loadICWeights();
    let prevDeltas: Map<string, import("@/lib/factor-memory").FactorDelta> | undefined;
    try {
      const tempReport = generateQuantReport(targets, northbound, marketChange, eventAnalysis.sectorSummaries, eventAnalysis.topEvents, { breadth, margin, valuations, turnovers }, undefined, icWeights);
      const mem = await calcFactorDeltas(tempReport.decisions);
      if (mem.historyDays >= 2) prevDeltas = new Map(mem.deltas.map(d => [d.code, d]));
    } catch {}

    const quantReport = generateQuantReport(targets, northbound, marketChange, eventAnalysis.sectorSummaries, eventAnalysis.topEvents, { breadth, margin, valuations, turnovers }, prevDeltas, icWeights);

    // 记录因子快照
    try { await recordFactorSnapshot(quantReport.decisions); } catch {}

    // 场外ETF报价
    const otcQuotes = otcFunds.map(otc => ({
      code: otc.code, name: otc.name, sector: otc.sector,
      nav: otc.nav, navDate: otc.navDate,
      changePercent: isTradingNow && otc.estimatedChange != null ? otc.estimatedChange : otc.navChangePercent,
      isEstimated: isTradingNow && otc.estimatedChange != null,
    }));

    // 执行调仓
    const result = rebalance(state, quantReport, otcQuotes);

    return NextResponse.json({
      success: true,
      reasoning: result.reasoning,
      actions: result.actions,
      portfolio: {
        ...result.portfolio,
        totalValue: Math.round((result.portfolio.cash + result.portfolio.holdings.reduce((s, h) => s + h.currentValue, 0)) * 100) / 100,
        totalPnl: Math.round((result.portfolio.cash + result.portfolio.holdings.reduce((s, h) => s + h.currentValue, 0) - result.portfolio.initialCapital) * 100) / 100,
        totalPnlPercent: Math.round(((result.portfolio.cash + result.portfolio.holdings.reduce((s, h) => s + h.currentValue, 0) - result.portfolio.initialCapital) / result.portfolio.initialCapital * 100) * 100) / 100,
      },
    });
  } catch (error) {
    console.error("Portfolio rebalance error:", error);
    return NextResponse.json({ error: "调仓失败: " + (error instanceof Error ? error.message : String(error)) }, { status: 500 });
  }
}
