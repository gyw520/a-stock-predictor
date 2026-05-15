import { NextRequest, NextResponse } from "next/server";
import { fetchKLine } from "@/lib/stock-api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const days = Number(req.nextUrl.searchParams.get("days") || "120");
  if (!code) {
    return NextResponse.json({ error: "缺少code参数" }, { status: 400 });
  }
  try {
    const data = await fetchKLine(code, undefined, days);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "获取K线数据失败" }, { status: 500 });
  }
}
