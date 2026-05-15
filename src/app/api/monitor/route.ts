import { NextResponse } from "next/server";
import { fetchETFList, type ETFData } from "@/lib/stock-api";
import { loadPortfolio } from "@/lib/model-portfolio";
import { runMonitorScan, getUnacknowledgedAlerts, acknowledgeAlert } from "@/lib/realtime-monitor";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitor
 * 执行一次盘中监控扫描，返回告警和持仓实时状态
 */
export async function GET() {
  try {
    const state = loadPortfolio();

    if (state.holdings.length === 0) {
      return NextResponse.json({
        timestamp: new Date().toISOString(),
        isTradingHours: false,
        alerts: [],
        holdingStatus: [],
        unacknowledged: getUnacknowledgedAlerts(),
        message: "当前无持仓",
      });
    }

    // 获取持仓标的实时行情
    let etfs: ETFData[] = [];
    try {
      etfs = await fetchETFList();
    } catch { /* fallback below */ }

    // 构建实时价格Map
    const livePrices = new Map<string, { code: string; price: number; changePercent: number }>();

    // 持仓是场外基金，但可以通过同板块场内ETF价格来近似
    // 先用场内ETF价格构建一个sector→price映射
    const sectorPrice = new Map<string, { price: number; changePercent: number }>();
    for (const etf of etfs) {
      if (!sectorPrice.has(etf.sector) || etf.amount > (sectorPrice.get(etf.sector) as any)?.amount) {
        sectorPrice.set(etf.sector, { price: etf.price, changePercent: etf.changePercent });
      }
    }

    // 对每个持仓，用其最新净值+场内ETF实时涨跌来估算当前价格
    for (const h of state.holdings) {
      const sectorLive = sectorPrice.get(h.sector);
      if (sectorLive) {
        // 用当前净值 × (1 + 场内ETF今日涨跌) 来估算实时净值
        const estimatedPrice = h.currentNav * (1 + sectorLive.changePercent / 100);
        livePrices.set(h.code, { code: h.code, price: estimatedPrice, changePercent: sectorLive.changePercent });
      } else {
        // 没有场内对标，用当前净值
        livePrices.set(h.code, { code: h.code, price: h.currentNav, changePercent: 0 });
      }
    }

    const result = runMonitorScan(livePrices);

    return NextResponse.json({
      ...result,
      unacknowledged: getUnacknowledgedAlerts(),
    });
  } catch (error) {
    console.error("Monitor error:", error);
    return NextResponse.json({ error: "监控扫描失败" }, { status: 500 });
  }
}

/**
 * POST /api/monitor
 * Body: { action: "acknowledge", alertId: string }
 * 确认告警
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.action === "acknowledge" && body.alertId) {
      const success = acknowledgeAlert(body.alertId);
      return NextResponse.json({ success });
    }

    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: "操作失败" }, { status: 500 });
  }
}
