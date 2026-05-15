import { NextResponse } from "next/server";
import { runScalpBacktest, type ScalpBacktestConfig } from "@/lib/scalp-backtest";

export const dynamic = "force-dynamic";

// ================================================================
//  POST: 执行超短线回测
//  前端负责拉取K线数据，后端只做计算
//  Body: { klineMap: Record<string, {name, klines}>, config?: Partial<ScalpBacktestConfig> }
// ================================================================

export async function POST(request: Request) {
  const t0 = Date.now();
  try {
    const body = await request.json();
    const klineMap = body.klineMap;
    const config: Partial<ScalpBacktestConfig> = body.config || {};

    if (!klineMap || typeof klineMap !== "object") {
      return NextResponse.json({ error: "缺少K线数据(klineMap)" }, { status: 400 });
    }

    const stockCount = Object.keys(klineMap).length;
    console.log(`[ScalpBacktest] 收到${stockCount}只股票K线，开始回测...`);

    if (stockCount < 5) {
      return NextResponse.json({ error: `K线数据不足(仅${stockCount}只，需至少5只)` }, { status: 400 });
    }

    const result = runScalpBacktest(klineMap, config);
    console.log(`[ScalpBacktest] 回测完成: ${result.totalTrades}笔交易, 胜率${result.winRate}%, 耗时${Date.now() - t0}ms`);

    return NextResponse.json({
      success: true,
      stocksUsed: stockCount,
      elapsedMs: Date.now() - t0,
      ...result,
    });
  } catch (error: any) {
    console.error("Scalp backtest error:", error);
    return NextResponse.json({
      error: `超短线回测计算失败: ${error?.message || "未知错误"}`,
    }, { status: 500 });
  }
}
