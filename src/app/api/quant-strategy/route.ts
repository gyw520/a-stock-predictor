import { NextResponse } from "next/server";
import {
  fetchETFList, fetchETFKLine, fetchEnrichedSectorList,
  fetchNorthboundFlow, fetchMarketOverview,
  fetchMarketBreadth, fetchMarginData, fetchETFValuations,
  calcTurnoverTrend,
  type KLineData, type TurnoverTrend, type ValuationData,
} from "@/lib/stock-api";
import { analyzeEvents } from "@/lib/event-driven";
import { generateQuantReport } from "@/lib/quant-engine";
import { recordFactorSnapshot, calcFactorDeltas } from "@/lib/factor-memory";
import { loadICWeights } from "@/lib/factor-ic";
import { calcStrategyWeightAdj, recordStrategySignals } from "@/lib/strategy-perf";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 并发获取所有数据源（原有 + 增强三层）
    const [etfs, sectors, northbound, market, eventAnalysis, breadth, margin] = await Promise.all([
      fetchETFList(),
      fetchEnrichedSectorList(),
      fetchNorthboundFlow(20),
      fetchMarketOverview(),
      analyzeEvents(),
      fetchMarketBreadth(),
      fetchMarginData(10),
    ]);

    const marketChange = (market.shIndex.changePercent + market.szIndex.changePercent) / 2;

    // 并发获取每只ETF的K线（60日）
    const klineMap: Record<string, KLineData[]> = {};
    await Promise.all(
      etfs.map(async (etf) => {
        try {
          klineMap[etf.code] = await fetchETFKLine(etf.code, 60);
        } catch {
          klineMap[etf.code] = [];
        }
      })
    );

    // 获取ETF估值数据
    const etfCodes = etfs.map(e => e.code);
    let valuations = new Map<string, ValuationData>();
    try { valuations = await fetchETFValuations(etfCodes); } catch {}

    // 计算换手率趋势 + 筹码集中度
    const turnovers = new Map<string, TurnoverTrend>();
    for (const etf of etfs) {
      const kl = klineMap[etf.code];
      if (kl && kl.length >= 20) {
        turnovers.set(etf.code, calcTurnoverTrend(kl, etf.code));
      }
    }

    // 构建分析标的
    const targets = etfs.map(etf => {
      const sectorMatch = sectors.find(s =>
        etf.sector === s.name ||
        etf.name.includes(s.name.replace(/ETF|板块/g, "")) ||
        s.name.includes(etf.sector)
      ) || null;
      return {
        code: etf.code,
        name: etf.name,
        sector: etf.sector,
        klines: klineMap[etf.code] || [],
        sectorData: sectorMatch,
      };
    }).filter(t => t.klines.length >= 20);

    // 加载IC自适应权重
    const icWeights = await loadICWeights();

    // 先用昨日快照计算因子趋势（反哺决策）
    let prevDeltas: Map<string, import("@/lib/factor-memory").FactorDelta> | undefined;
    try {
      const tempReport = generateQuantReport(
        targets, northbound, marketChange,
        eventAnalysis.sectorSummaries, eventAnalysis.topEvents,
        { breadth, margin, valuations, turnovers },
        undefined, icWeights,
      );
      const memoryReport = await calcFactorDeltas(tempReport.decisions);
      if (memoryReport.historyDays >= 2) {
        prevDeltas = new Map(memoryReport.deltas.map(d => [d.code, d]));
      }
    } catch {}

    // 策略绩效自评估权重
    const strategyPerfAdj = await calcStrategyWeightAdj();

    // 正式生成报告（带因子趋势+IC权重+策略自评）
    const report = generateQuantReport(
      targets, northbound, marketChange,
      eventAnalysis.sectorSummaries, eventAnalysis.topEvents,
      { breadth, margin, valuations, turnovers },
      prevDeltas, icWeights, strategyPerfAdj,
    );

    // 记录今日快照
    try {
      await recordFactorSnapshot(report.decisions);
    } catch (e) { console.error("Factor snapshot save error:", e); }

    // 记录策略信号用于绩效跟踪
    try {
      const today = new Date().toISOString().slice(0, 10);
      const signals = report.decisions.flatMap(d =>
        d.strategies.map(s => ({ code: d.code, strategy: s.strategy, direction: s.direction, strength: s.strength }))
      );
      recordStrategySignals(signals, report.regime, today);
    } catch (e) { console.error("Strategy perf record error:", e); }

    // 计算最终的factorMemory返回前端
    let factorMemory = null;
    try {
      factorMemory = await calcFactorDeltas(report.decisions);
    } catch (e) { console.error("Factor delta calc error:", e); }

    return NextResponse.json({ ...report, factorMemory });
  } catch (error) {
    console.error("Quant strategy error:", error);
    return NextResponse.json({ error: "量化策略分析失败" }, { status: 500 });
  }
}
