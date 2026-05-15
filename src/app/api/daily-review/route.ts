import { NextResponse } from "next/server";
import {
  fetchEnrichedSectorList, fetchMarketOverview,
  fetchNorthboundFlow, fetchSectorMoneyFlow, fetchETFList,
  fetchMarketSentimentData,
} from "@/lib/stock-api";
import { analyzeEvents } from "@/lib/event-driven";
import { generateDailyReview } from "@/lib/daily-review";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [sectors, market, northbound, moneyFlows, etfs, eventAnalysis, sentimentData] = await Promise.all([
      fetchEnrichedSectorList(),
      fetchMarketOverview(),
      fetchNorthboundFlow(10),
      fetchSectorMoneyFlow(),
      fetchETFList(),
      analyzeEvents(),
      fetchMarketSentimentData(),
    ]);

    const report = generateDailyReview(
      market, sectors, moneyFlows, northbound, etfs,
      eventAnalysis.sectorSummaries,
      eventAnalysis.topEvents,
      sentimentData,
    );

    return NextResponse.json(report);
  } catch (error) {
    console.error("Daily review error:", error);
    return NextResponse.json({ error: "复盘数据生成失败" }, { status: 500 });
  }
}
