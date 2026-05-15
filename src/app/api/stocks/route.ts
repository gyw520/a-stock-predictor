import { NextRequest, NextResponse } from "next/server";
import { fetchStockList } from "@/lib/stock-api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const page = Number(req.nextUrl.searchParams.get("page") || "1");
  const pageSize = Number(req.nextUrl.searchParams.get("pageSize") || "20");
  try {
    const data = await fetchStockList(page, pageSize);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "获取股票列表失败" }, { status: 500 });
  }
}
