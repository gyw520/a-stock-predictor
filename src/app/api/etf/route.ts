import { NextResponse } from "next/server";
import { fetchETFList } from "@/lib/stock-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fetchETFList();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "获取ETF数据失败" }, { status: 500 });
  }
}
