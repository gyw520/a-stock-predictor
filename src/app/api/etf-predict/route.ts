import { NextRequest, NextResponse } from "next/server";
import { fetchETFKLine } from "@/lib/stock-api";
import { predict } from "@/lib/predictor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "缺少code参数" }, { status: 400 });
  }
  try {
    const klines = await fetchETFKLine(code, 120);
    if (klines.length === 0) {
      return NextResponse.json({ error: "无法获取ETF K线数据" }, { status: 404 });
    }
    const prediction = predict(klines);
    return NextResponse.json({ prediction, lastPrice: klines[klines.length - 1].close });
  } catch (error) {
    return NextResponse.json({ error: "ETF预测失败" }, { status: 500 });
  }
}
