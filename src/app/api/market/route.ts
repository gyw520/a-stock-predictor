import { NextResponse } from "next/server";
import { fetchMarketOverview } from "@/lib/stock-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fetchMarketOverview();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "获取大盘数据失败" }, { status: 500 });
  }
}
