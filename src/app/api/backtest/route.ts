import { NextResponse } from "next/server";
import {
  fetchETFList, fetchETFKLine, fetchEnrichedSectorList,
  fetchNorthboundFlow, fetchMarketOverview,
  type KLineData,
} from "@/lib/stock-api";
import { generateQuantReport } from "@/lib/quant-engine";
import { runBacktest, type BacktestConfig } from "@/lib/backtest";

export const dynamic = "force-dynamic";

/**
 * POST /api/backtest
 * Body: { days?: number, config?: Partial<BacktestConfig> }
 *
 * 用历史K线跑量化策略回测
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.min(body.days || 60, 120); // 最多120交易日
    const userConfig: Partial<BacktestConfig> = body.config || {};

    // 获取ETF列表和板块数据
    const [etfs, sectors, northbound, market] = await Promise.all([
      fetchETFList(),
      fetchEnrichedSectorList(),
      fetchNorthboundFlow(20),
      fetchMarketOverview(),
    ]);

    const marketChange = (market.shIndex.changePercent + market.szIndex.changePercent) / 2;

    // 获取历史K线（拉更长的时间线）
    const klineMap: Record<string, KLineData[]> = {};
    await Promise.all(
      etfs.map(async (etf) => {
        try {
          klineMap[etf.code] = await fetchETFKLine(etf.code, days + 30); // 多拉30天用于因子计算
        } catch {
          klineMap[etf.code] = [];
        }
      })
    );

    // 用滑动窗口为每个交易日生成量化分数
    const allDates = extractSortedDates(klineMap);
    const dailyScores = new Map<string, { date: string; code: string; name: string; score: number }[]>();

    // 初始化
    for (const etf of etfs) {
      dailyScores.set(etf.code, []);
    }

    // 从第21天开始，每天用前N日K线计算一次量化分
    for (let i = 20; i < allDates.length; i++) {
      const date = allDates[i];

      // 截取到当天为止的K线
      const targets = etfs.map(etf => {
        const fullKlines = klineMap[etf.code] || [];
        const klinesUpToDate = fullKlines.filter(k => k.date <= date).slice(-60); // 最近60日
        const sectorMatch = sectors.find(s =>
          etf.sector === s.name ||
          etf.name.includes(s.name.replace(/ETF|板块/g, "")) ||
          s.name.includes(etf.sector)
        ) || null;
        return {
          code: etf.code, name: etf.name, sector: etf.sector,
          klines: klinesUpToDate, sectorData: sectorMatch,
        };
      }).filter(t => t.klines.length >= 20);

      if (targets.length === 0) continue;

      // 生成当天的量化报告（不传增强数据，用纯K线因子回测）
      const report = generateQuantReport(
        targets, northbound, marketChange,
        [], [], // 回测不含事件数据
      );

      for (const d of report.decisions) {
        const arr = dailyScores.get(d.code);
        if (arr) {
          arr.push({ date, code: d.code, name: d.name, score: d.finalScore });
        }
      }
    }

    const result = runBacktest(dailyScores, klineMap, userConfig);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Backtest error:", error);
    return NextResponse.json({ error: "回测执行失败" }, { status: 500 });
  }
}

function extractSortedDates(klineMap: Record<string, KLineData[]>): string[] {
  const dateSet = new Set<string>();
  for (const klines of Object.values(klineMap)) {
    for (const k of klines) dateSet.add(k.date);
  }
  return [...dateSet].sort();
}
