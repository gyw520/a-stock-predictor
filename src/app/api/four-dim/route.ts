import { NextResponse } from "next/server";
import {
  fetchEnrichedSectorList, fetchSectorMoneyFlow, fetchNorthboundFlow,
  fetchMarketOverview, fetchKLine, type KLineData, type EnrichedSectorData,
} from "@/lib/stock-api";
import { analyzeFourDimensions } from "@/lib/four-dimension";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 并发获取基础数据
    const [sectors, moneyFlow, northbound, market] = await Promise.all([
      fetchEnrichedSectorList(),
      fetchSectorMoneyFlow(),
      fetchNorthboundFlow(10),
      fetchMarketOverview(),
    ]);

    const totalAmount = market.shIndex.amount + market.szIndex.amount;

    // 取前20个板块
    const topSectors = sectors.slice(0, 20);

    // 尝试获取每个板块领涨股的K线（作为板块代理）
    const klinePromises = topSectors.map(async (sector) => {
      if (!sector.leadingStockCode) return [] as KLineData[];
      try {
        const klines = await fetchKLine(sector.leadingStockCode, 0, 60);
        return klines;
      } catch { return [] as KLineData[]; }
    });

    const klineResults = await Promise.all(klinePromises);

    // 对每个板块做四维分析
    const reports = topSectors.map((sector, i) => {
      const klines = klineResults[i];
      const flow = moneyFlow.find(m => m.code === sector.code || m.name === sector.name) || null;
      const amountRatio = totalAmount > 0 ? (sector.amount / totalAmount) * 100 : 0;
      const riseRatio = sector.stockCount > 0 ? sector.riseCount / sector.stockCount : 0;

      // 传入enrichedSector作为fallback
      return analyzeFourDimensions(
        sector.name, sector.code, klines, northbound, flow,
        amountRatio, sector.changePercent, riseRatio,
        undefined, // benchmarkKlines
        sector     // enrichedSector fallback
      );
    });

    // 按综合分排序
    reports.sort((a, b) => b.compositeScore - a.compositeScore);

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      northboundSummary: northbound,
      reports,
    });
  } catch (error) {
    console.error("Four-dim error:", error);
    return NextResponse.json({ error: "四维分析失败" }, { status: 500 });
  }
}
