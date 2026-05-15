import { NextResponse } from "next/server";
import { fetchSectorList } from "@/lib/stock-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fetchSectorList();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "获取板块数据失败" }, { status: 500 });
  }
}
