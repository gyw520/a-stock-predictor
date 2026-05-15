import { NextResponse } from "next/server";
import { fetchGlobalIndices, fetchETFList, fetchSectorList, fetchETFKLine, SECTOR_ETF_MAP } from "@/lib/stock-api";
import { predict } from "@/lib/predictor";
import { generateDailyBriefing } from "@/lib/sector-analyzer";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 并发获取所有数据
    const [globalIndices, etfs, sectors] = await Promise.all([
      fetchGlobalIndices(),
      fetchETFList(),
      fetchSectorList(),
    ]);

    // 为每个板块取一只代表性ETF做技术分析
    const etfPredictions: Record<string, { prediction: ReturnType<typeof predict>; lastPrice: number }> = {};
    const representativeETFs: { code: string; sector: string }[] = [];

    for (const [sector, etfList] of Object.entries(SECTOR_ETF_MAP)) {
      if (etfList.length > 0) {
        representativeETFs.push({ code: etfList[0].code, sector });
      }
    }

    // 并发获取K线并预测（限制并发数量）
    const predictionPromises = representativeETFs.map(async ({ code, sector }) => {
      try {
        const klines = await fetchETFKLine(code, 120);
        if (klines.length > 0) {
          const prediction = predict(klines);
          etfPredictions[code] = { prediction, lastPrice: klines[klines.length - 1].close };
        }
      } catch {}
    });

    await Promise.all(predictionPromises);

    const briefing = generateDailyBriefing(globalIndices, etfs, sectors, etfPredictions);

    return NextResponse.json(briefing);
  } catch (error) {
    console.error("Briefing error:", error);
    return NextResponse.json({ error: "生成分析报告失败" }, { status: 500 });
  }
}
