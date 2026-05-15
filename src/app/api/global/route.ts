import { NextResponse } from "next/server";
import { fetchGlobalIndices } from "@/lib/stock-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fetchGlobalIndices();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "获取全球市场数据失败" }, { status: 500 });
  }
}
