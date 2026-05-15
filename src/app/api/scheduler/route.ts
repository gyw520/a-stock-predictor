import { NextResponse } from "next/server";
import { notifyAlert, notifyDailyReport } from "@/lib/notify";
import { runMonitorScan, getUnacknowledgedAlerts } from "@/lib/realtime-monitor";
import { loadPortfolio } from "@/lib/model-portfolio";

export const dynamic = "force-dynamic";

/**
 * POST /api/scheduler
 * Body: { task: "daily-report" | "monitor-scan" | "alert-push" }
 *
 * 由 cron 或外部调度器调用，执行定时任务
 *
 * 建议 cron 配置：
 *   - 每日 9:15  → task=daily-report   （开盘前推送日报）
 *   - 盘中每5分钟 → task=monitor-scan  （实时监控）
 *   - 盘中每5分钟 → task=alert-push    （推送未确认告警）
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const task = body.task || "daily-report";

    if (task === "daily-report") {
      return await handleDailyReport();
    }

    if (task === "monitor-scan") {
      return await handleMonitorScan();
    }

    if (task === "scalp-scan") {
      return await handleScalpScan();
    }

    if (task === "alert-push") {
      return await handleAlertPush();
    }

    return NextResponse.json({ error: `未知任务: ${task}` }, { status: 400 });
  } catch (error) {
    console.error("Scheduler error:", error);
    return NextResponse.json({ error: "调度任务执行失败" }, { status: 500 });
  }
}

// ================================================================
//  日报
// ================================================================

async function handleDailyReport() {
  // 调用量化策略API获取最新报告
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  let reportSummary = "";

  try {
    const resp = await fetch(`${baseUrl}/api/quant-strategy`);
    const report = await resp.json();
    if (report.error) throw new Error(report.error);

    const topLong = report.topLong?.slice(0, 3).map((d: any) => `${d.name}(${d.finalScore}分)`).join("、") || "无";
    const topShort = report.topShort?.slice(0, 3).map((d: any) => `${d.name}(${d.finalScore}分)`).join("、") || "无";

    reportSummary = [
      `**市场状态**: ${report.regime}`,
      `**全市场量化分**: ${report.marketScore}`,
      `**建议仓位**: ${report.riskBudget}%`,
      `**看多标的**: ${topLong}`,
      `**看空标的**: ${topShort}`,
      "",
      `**因子趋势**: ${report.factorMemory?.marketTrend || "无数据"}`,
      "",
      report.summary,
    ].join("\n");
  } catch (e: any) {
    reportSummary = `量化报告获取失败: ${e.message}`;
  }

  // 组合状态
  const state = await loadPortfolio();
  const totalValue = state.cash + state.holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalPnlPct = ((totalValue - state.initialCapital) / state.initialCapital * 100).toFixed(2);

  const portfolioSection = [
    "",
    "---",
    `**组合总资产**: ¥${totalValue.toFixed(2)} (${Number(totalPnlPct) >= 0 ? "+" : ""}${totalPnlPct}%)`,
    `**现金**: ¥${state.cash.toFixed(2)}`,
    `**持仓数**: ${state.holdings.length}/${3}`,
    `**风控状态**: ${state.riskLevel || "正常"}`,
    `**最大回撤**: ${(state.maxDrawdownPct || 0).toFixed(1)}%`,
    state.holdings.length > 0
      ? "\n**持仓明细**:\n" + state.holdings.map(h =>
          `- ${h.name}: ${h.pnlPercent >= 0 ? "+" : ""}${h.pnlPercent.toFixed(1)}% (量化分${h.quantScore})`
        ).join("\n")
      : "当前空仓",
  ].join("\n");

  const fullReport = reportSummary + portfolioSection;

  const results = await notifyDailyReport(fullReport);

  return NextResponse.json({
    task: "daily-report",
    notifyResults: results,
    reportLength: fullReport.length,
  });
}

// ================================================================
//  盘中监控
// ================================================================

async function handleMonitorScan() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  try {
    const resp = await fetch(`${baseUrl}/api/monitor`);
    const result = await resp.json();

    // 如果有紧急告警，立即推送
    if (result.alerts && result.alerts.length > 0) {
      const urgentAlerts = result.alerts.filter((a: any) => a.level === "紧急");
      if (urgentAlerts.length > 0) {
        const content = urgentAlerts.map((a: any) => `- **${a.name}**: ${a.message}`).join("\n");
        await notifyAlert("紧急", `触发${urgentAlerts.length}条紧急告警`, content);
      }
    }

    return NextResponse.json({
      task: "monitor-scan",
      alerts: result.alerts?.length || 0,
      holdingStatus: result.holdingStatus?.length || 0,
    });
  } catch (e: any) {
    return NextResponse.json({ task: "monitor-scan", error: e.message });
  }
}

// ================================================================
//  超短线扫描
// ================================================================

async function handleScalpScan() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  try {
    const resp = await fetch(`${baseUrl}/api/scalp`, { method: "PUT" });
    const result = await resp.json();
    return NextResponse.json({
      task: "scalp-scan",
      triggered: result.triggered,
      emotion: result.emotion,
      actions: result.actions?.length || 0,
    });
  } catch (e: any) {
    return NextResponse.json({ task: "scalp-scan", error: e.message });
  }
}

// ================================================================
//  未确认告警推送
// ================================================================

async function handleAlertPush() {
  const unacked = await getUnacknowledgedAlerts();

  if (unacked.length > 0) {
    const content = unacked.map(a =>
      `- [${a.level}] ${a.name}: ${a.message}`
    ).join("\n");

    await notifyAlert("警告", `${unacked.length}条未确认告警`, content);
  }

  return NextResponse.json({
    task: "alert-push",
    unacknowledgedCount: unacked.length,
  });
}
