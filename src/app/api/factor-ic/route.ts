import { NextResponse } from "next/server";
import {
  fetchETFList, fetchETFKLine, fetchNorthboundFlow, fetchMarketOverview,
  type KLineData,
} from "@/lib/stock-api";
import { analyzeFactorIC } from "@/lib/factor-ic";

export const dynamic = "force-dynamic";

/**
 * GET /api/factor-ic
 * 因子IC检验：验证每个因子的预测有效性
 */
export async function GET() {
  try {
    const [etfs, northbound, market] = await Promise.all([
      fetchETFList(),
      fetchNorthboundFlow(20),
      fetchMarketOverview(),
    ]);

    const marketChange = (market.shIndex.changePercent + market.szIndex.changePercent) / 2;

    // 获取更长的K线历史（用于IC检验）
    const klineMap: Record<string, KLineData[]> = {};
    await Promise.all(
      etfs.map(async (etf) => {
        try {
          klineMap[etf.code] = await fetchETFKLine(etf.code, 90); // 90日
        } catch {
          klineMap[etf.code] = [];
        }
      })
    );

    // 简化：用市场均值作为每日市场涨跌近似
    const marketChanges: number[] = new Array(90).fill(marketChange);

    const report = analyzeFactorIC(klineMap, northbound, marketChanges);

    return NextResponse.json(report);
  } catch (error) {
    console.error("Factor IC error:", error);
    return NextResponse.json({ error: "因子IC检验失败" }, { status: 500 });
  }
}
