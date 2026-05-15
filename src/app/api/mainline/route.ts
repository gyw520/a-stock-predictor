import { NextRequest, NextResponse } from "next/server";
import { fetchSectorList, fetchKLine } from "@/lib/stock-api";
import { generateMainLineReport } from "@/lib/mainline-analyzer";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("period") === "month" ? "本月" : "本周";
  const days = period === "本月" ? 30 : 10;

  try {
    const sectors = await fetchSectorList();

    // 为排名前30的板块获取K线（限制并发）
    const topSectors = sectors.slice(0, 30);
    const sectorKlines: Record<string, import("@/lib/stock-api").KLineData[]> = {};

    // 板块K线使用板块代码 + 90市场
    const klinePromises = topSectors.map(async (sector) => {
      try {
        const secid = `90.${sector.code}`;
        const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=${days}`;
        const resp = await fetch(url, {
          headers: { "Referer": "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
        });
        const json = await resp.json();
        if (json.data?.klines) {
          sectorKlines[sector.code] = json.data.klines.map((line: string) => {
            const parts = line.split(",");
            return {
              date: parts[0],
              open: parseFloat(parts[1]),
              close: parseFloat(parts[2]),
              high: parseFloat(parts[3]),
              low: parseFloat(parts[4]),
              volume: parseFloat(parts[5]),
              amount: parseFloat(parts[6]),
            };
          });
        }
      } catch {}
    });

    await Promise.all(klinePromises);

    const report = generateMainLineReport(sectors, sectorKlines, period);
    return NextResponse.json(report);
  } catch (error) {
    console.error("Mainline error:", error);
    return NextResponse.json({ error: "主线分析失败" }, { status: 500 });
  }
}
