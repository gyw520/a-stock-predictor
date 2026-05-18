import { NextResponse } from "next/server";
import { assessMarketWind, buildEventHeatMap } from "@/lib/sentiment-engine";
import { analyzeEvents } from "@/lib/event-driven";

export const dynamic = "force-dynamic";

/**
 * GET /api/sentiment
 * 返回：市场风向标 + 事件热度图谱 + 综合摘要
 *
 * 可传 ?mode=wind 仅获取风向标（更快），默认返回完整报告
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") || "full";

    // 风向标（最快，适合高频轮询）
    if (mode === "wind") {
      const wind = await assessMarketWind();
      return NextResponse.json({
        timestamp: new Date().toISOString(),
        wind,
      });
    }

    // 完整报告
    const [wind, eventAnalysis] = await Promise.all([
      assessMarketWind(),
      analyzeEvents(),
    ]);

    const heatMap = await buildEventHeatMap(eventAnalysis);

    // 综合摘要
    const hotSectors = heatMap.hotSectors.slice(0, 3).map(s => s.sector).join("、");
    const coldSectors = heatMap.coldSectors.slice(0, 3).map(s => s.sector).join("、");
    const topEvent = heatMap.topCatalysts[0];

    const summary = [
      `📍 市场风向: ${wind.label}(${wind.score}分)`,
      `📊 广度${wind.breadth.score}分 | 资金${wind.capitalFlow.score}分 | 情绪${wind.sentiment.score}分`,
      heatMap.hotSectors.length > 0 ? `🔥 热点板块: ${hotSectors}` : "",
      heatMap.coldSectors.length > 0 ? `❄️ 冷门板块: ${coldSectors}` : "",
      topEvent ? `📰 重磅事件: [${topEvent.impact}] ${topEvent.title}` : "",
      `📈 事件聚集度: ${heatMap.eventClusterScore}分（${heatMap.eventClusterScore >= 60 ? "有明确主线" : "题材散乱"}）`,
      wind.windEvents.length > 0 ? `⚡ 关键信号: ${wind.windEvents.slice(0, 2).join("；")}` : "",
    ].filter(Boolean).join("\n");

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      wind,
      heatMap,
      summary,
    });
  } catch (error) {
    console.error("Sentiment API error:", error);
    return NextResponse.json({ error: "情绪分析失败" }, { status: 500 });
  }
}