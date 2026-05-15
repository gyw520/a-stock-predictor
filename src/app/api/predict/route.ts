import { NextRequest, NextResponse } from "next/server";
import { fetchKLine } from "@/lib/stock-api";
import { predict, calculateIndicators } from "@/lib/predictor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "缺少code参数" }, { status: 400 });
  }
  try {
    // 重试机制：网络不稳定时最多重试2次
    let klines: Awaited<ReturnType<typeof fetchKLine>> = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        klines = await fetchKLine(code, undefined, 120);
        if (klines.length > 0) break;
      } catch {
        if (attempt === 2) throw new Error(`K线获取失败(${code})`);
        await new Promise(r => setTimeout(r, 500));
      }
    }
    if (klines.length === 0) {
      return NextResponse.json({ error: `无法获取K线数据，请确认代码${code}是否正确` }, { status: 404 });
    }
    const prediction = predict(klines);
    const indicators = calculateIndicators(klines);

    // 只返回最近的指标数据用于图表
    const len = klines.length;
    const sliceStart = Math.max(0, len - 60);
    const chartData = klines.slice(sliceStart).map((k, i) => {
      const idx = sliceStart + i;
      return {
        date: k.date,
        open: k.open,
        close: k.close,
        high: k.high,
        low: k.low,
        volume: k.volume,
        ma5: indicators.ma5[idx],
        ma10: indicators.ma10[idx],
        ma20: indicators.ma20[idx],
        dif: indicators.macd.dif[idx],
        dea: indicators.macd.dea[idx],
        macd: indicators.macd.macd[idx],
      };
    });

    return NextResponse.json({ prediction, chartData, code, name: "" });
  } catch (error) {
    console.error("Predict error:", error);
    return NextResponse.json({ error: "预测分析失败: " + (error instanceof Error ? error.message : "网络错误，请重试") }, { status: 500 });
  }
}
