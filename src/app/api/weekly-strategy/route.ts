import { NextResponse } from "next/server";
import {
  fetchETFList, fetchEnrichedSectorList,
  fetchNorthboundFlow, fetchMarketOverview, fetchOTCFundList,
  type ETFData, type OTCFundData,
} from "@/lib/stock-api";
import { analyzeEvents } from "@/lib/event-driven";
import { generateWeeklyStrategy } from "@/lib/weekly-strategy";
import { isTradingTime } from "@/lib/trading-hours";

export const dynamic = "force-dynamic";

// 场外基金转ETFData简化版（用于动量计算）
function otcToSimple(otc: OTCFundData, onMarketETFs: ETFData[]): ETFData {
  const isTradingNow = isTradingTime();
  let estimatedChange = otc.navChangePercent;
  if (isTradingNow) {
    const sameSectoETFs = onMarketETFs.filter(e => e.sector === otc.sector);
    if (sameSectoETFs.length > 0) {
      const avgChange = sameSectoETFs.reduce((s, e) => s + e.changePercent, 0) / sameSectoETFs.length;
      estimatedChange = avgChange * 0.95;
    }
  }
  return {
    code: otc.code,
    name: otc.name,
    price: otc.nav,
    change: 0,
    changePercent: estimatedChange,
    volume: 0,
    amount: 0,
    turnoverRate: 0,
    sector: otc.sector,
    amplitude: 0,
    change5d: otc.change5d + (isTradingNow ? estimatedChange : 0),
    change10d: otc.change10d + (isTradingNow ? estimatedChange : 0),
    mainNetInflow: 0,
  };
}

export async function GET() {
  try {
    const [etfs, otcFunds, sectors, northbound, market, eventAnalysis] = await Promise.all([
      fetchETFList(),
      fetchOTCFundList(),
      fetchEnrichedSectorList(),
      fetchNorthboundFlow(10),
      fetchMarketOverview(),
      analyzeEvents(),
    ]);

    const marketChange = (market.shIndex.changePercent + market.szIndex.changePercent) / 2;

    // 合并场内外ETF
    const otcAsETF = otcFunds.map(otc => otcToSimple(otc, etfs));
    const allETFs = [...etfs, ...otcAsETF];

    const strategy = generateWeeklyStrategy(
      allETFs, sectors, northbound,
      eventAnalysis.sectorSummaries,
      marketChange,
      eventAnalysis.topEvents,
    );

    return NextResponse.json(strategy);
  } catch (error) {
    console.error("Weekly strategy error:", error);
    return NextResponse.json({ error: "周策略生成失败" }, { status: 500 });
  }
}
