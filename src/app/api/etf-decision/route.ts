import { NextResponse } from "next/server";
import {
  fetchETFList, fetchETFKLine, fetchEnrichedSectorList,
  fetchNorthboundFlow, fetchMarketOverview, fetchOTCFundList,
  type KLineData, type ETFData, type OTCFundData,
} from "@/lib/stock-api";
import { generateETFDecisionReport } from "@/lib/etf-decision";
import { analyzeEvents } from "@/lib/event-driven";
import { isNearClose, isTradingTime } from "@/lib/trading-hours";

export const dynamic = "force-dynamic";

// 场外联接基金→对应场内ETF板块映射（用于盘中估算）
// 盘中优先用东方财富官方GSZZL估值，否则用同板块场内ETF均值推算
function estimateOTCRealtime(
  otc: OTCFundData,
  onMarketETFs: ETFData[],
  isTradingNow: boolean
): ETFData {
  let estimatedChangeToday = otc.navChangePercent; // 默认用最新净值涨跌
  let isEstimated = false;

  if (isTradingNow) {
    // 优先使用东方财富官方盘中估值
    if (otc.estimatedChange != null) {
      estimatedChangeToday = otc.estimatedChange;
      isEstimated = true;
    } else {
      // 降级：用同板块场内ETF实时涨跌推算
      const sameSectoETFs = onMarketETFs.filter(e => e.sector === otc.sector);
      if (sameSectoETFs.length > 0) {
        const avgChange = sameSectoETFs.reduce((s, e) => s + e.changePercent, 0) / sameSectoETFs.length;
        estimatedChangeToday = avgChange * 0.95;
        isEstimated = true;
      }
    }
  }

  // 盘中时5d涨幅需要加上今日估算
  const change5dWithToday = isEstimated ? otc.change5d + estimatedChangeToday : otc.change5d;
  const change10dWithToday = isEstimated ? otc.change10d + estimatedChangeToday : otc.change10d;

  return {
    code: otc.code,
    name: otc.name + (isEstimated ? "(估)" : ""),
    price: otc.nav * (1 + estimatedChangeToday / 100),
    change: 0,
    changePercent: estimatedChangeToday,
    volume: 0,
    amount: 0,
    turnoverRate: 0,
    sector: otc.sector,
    amplitude: 0,
    change5d: change5dWithToday,
    change10d: change10dWithToday,
    mainNetInflow: 0,
  };
}

export async function GET() {
  try {
    const [etfs, otcFunds, sectors, northbound, market, eventAnalysis] = await Promise.all([
      fetchETFList(),
      fetchOTCFundList(),
      fetchEnrichedSectorList(),
      fetchNorthboundFlow(10),
      fetchMarketOverview(),
      analyzeEvents(),
    ]);

    // 大盘涨跌幅（取沪深300的近似值）
    const marketChange = (market.shIndex.changePercent + market.szIndex.changePercent) / 2;

    const isTradingNow = isTradingTime();

    // 场外联接基金：盘中用场内ETF实时数据估算今日涨跌
    const otcAsETF = otcFunds.map(otc => estimateOTCRealtime(otc, etfs, isTradingNow));
    const allETFs = [...etfs, ...otcAsETF];

    // 并发获取每只场内ETF的K线（场外基金不需要，已有5d/10d数据）
    const klineMap: Record<string, KLineData[]> = {};
    const klinePromises = etfs.map(async (etf) => {
      try {
        const klines = await fetchETFKLine(etf.code, 60);
        klineMap[etf.code] = klines;
      } catch {
        klineMap[etf.code] = [];
      }
    });
    await Promise.all(klinePromises);

    const isPreCloseNow = isNearClose();

    const report = generateETFDecisionReport(
      allETFs, klineMap, sectors, northbound, marketChange, isPreCloseNow,
      eventAnalysis.sectorSummaries, eventAnalysis.topEvents
    );

    // 为场外基金决策填充 navDate / isEstimated
    const otcCodeMap = new Map(otcFunds.map(o => [o.code, o]));
    for (const d of report.allDecisions) {
      const otc = otcCodeMap.get(d.etfCode);
      if (otc) {
        d.navDate = otc.navDate;
        d.isEstimated = d.etfName.includes("(估)");
      }
    }

    return NextResponse.json(report);
  } catch (error) {
    console.error("ETF decision error:", error);
    return NextResponse.json({ error: "场外ETF分析失败" }, { status: 500 });
  }
}
