import { NextRequest, NextResponse } from "next/server";
import { searchStock } from "@/lib/stock-api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const keyword = req.nextUrl.searchParams.get("q");
  if (!keyword) {
    return NextResponse.json([]);
  }
  try {
    const data = await searchStock(keyword);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "搜索失败" }, { status: 500 });
  }
}
