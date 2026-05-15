import { NextResponse } from "next/server";
import {
  fetchStockList, fetchNearLimitUpStocks, fetchMarketBreadth,
  type StockQuote,
} from "@/lib/stock-api";
import {
  loadScalpPortfolio, scalpScan, judgeMarketEmotion,
  type ScalpQuote, type MarketEmotionData,
} from "@/lib/scalp-engine";
import { sendNotification, type NotifyLevel } from "@/lib/notify";

export const dynamic = "force-dynamic";

// ================================================================
//  GET: 读取超短线组合状态
// ================================================================

export async function GET() {
  try {
    const state = loadScalpPortfolio();

    // 刷新持仓市价
    if (state.holdings.length > 0) {
      try {
        const stocks = await fetchStockList(1, 200);
        const qm = new Map(stocks.map(s => [s.code, s]));
        for (const h of state.holdings) {
          const q = qm.get(h.code);
          if (q && q.price > 0) {
            h.currentPrice = q.price;
            h.currentValue = h.shares * h.currentPrice;
            h.pnl = h.currentValue - h.costAmount;
            h.pnlPercent = h.costAmount > 0 ? (h.pnl / h.costAmount) * 100 : 0;
          }
        }
      } catch {}
    }

    const tv = state.cash + state.holdings.reduce((s, h) => s + h.currentValue, 0);
    return NextResponse.json({
      ...state,
      totalValue: Math.round(tv * 100) / 100,
      totalPnl: Math.round((tv - state.initialCapital) * 100) / 100,
      totalPnlPercent: Math.round(((tv - state.initialCapital) / state.initialCapital * 100) * 100) / 100,
      weekPnlPercent: state.weekStartValue > 0
        ? Math.round(((tv - state.weekStartValue) / state.weekStartValue * 100) * 100) / 100
        : 0,
    });
  } catch (error) {
    console.error("Scalp GET error:", error);
    return NextResponse.json({ error: "读取超短线组合失败" }, { status: 500 });
  }
}

// ================================================================
//  PUT: 盘中实时扫描（超短线核心循环）
// ================================================================

export async function PUT() {
  try {
    const state = loadScalpPortfolio();

    // 获取行情
    const [stocks, nearLimitUp, breadth] = await Promise.all([
      fetchStockList(1, 200),
      fetchNearLimitUpStocks(),
      fetchMarketBreadth().catch(() => null),
    ]);

    const stockMap = new Map<string, StockQuote>();
    for (const s of [...stocks, ...nearLimitUp]) {
      if (!stockMap.has(s.code)) stockMap.set(s.code, s);
    }
    // 持仓股补充
    for (const h of state.holdings) {
      if (!stockMap.has(h.code)) {
        try {
          const extra = await fetchStockList(1, 5000);
          for (const s of extra) {
            if (s.code === h.code) stockMap.set(s.code, s);
          }
        } catch {}
      }
    }

    const allStocks = Array.from(stockMap.values());

    // 构建超短线行情
    const quotes: ScalpQuote[] = allStocks.filter(s =>
      s.price > 0 && !s.name.includes("ST") && !s.name.includes("退")
    ).map(s => {
      const limitPrice = Math.round(s.prevClose * 1.1 * 100) / 100;
      return {
        code: s.code, name: s.name,
        price: s.price, open: s.open, high: s.high, low: s.low,
        prevClose: s.prevClose, changePercent: s.changePercent,
        volume: s.volume, amount: s.amount, turnoverRate: s.turnoverRate,
        limitPrice,
        isLimitUp: s.price >= limitPrice - 0.01,
      };
    });

    // 构建情绪数据
    let emotionData: MarketEmotionData | undefined;
    if (breadth) {
      const limitUpStocks = quotes.filter(q => q.isLimitUp);
      const limitDownPrice = (q: ScalpQuote) => Math.round(q.prevClose * 0.9 * 100) / 100;
      const limitDownStocks = quotes.filter(q => q.price <= limitDownPrice(q) + 0.01 && q.price > 0);
      const upStocks = quotes.filter(q => q.changePercent > 0);
      const downStocks = quotes.filter(q => q.changePercent < 0);

      // 连板计算（简化：涨停且代码在昨日涨停列表中）
      // 这里用高换手作为近似
      const highLimitStocks = limitUpStocks.filter(q => q.turnoverRate < 5); // 低换手=强封板≈连板

      emotionData = {
        limitUpCount: limitUpStocks.length,
        limitDownCount: limitDownStocks.length,
        upCount: upStocks.length,
        downCount: downStocks.length,
        sealRate: limitUpStocks.length > 0 ? 70 : 0, // 简化估计
        highLimitCount: highLimitStocks.length,
        brokenBoardCount: 0, // 需要更详细数据
        yesterdayLimitUpAvgOpen: 0, // 需要历史对比
        mainNetInflow: 0,
      };

      // 从breadth补充涨停/跌停数据
      if (breadth.limitUp > 0) emotionData.limitUpCount = breadth.limitUp;
      if (breadth.limitDown > 0) emotionData.limitDownCount = breadth.limitDown;
      if (breadth.continuousLimitUp > 0) emotionData.highLimitCount = breadth.continuousLimitUp;
    }

    const result = scalpScan(state, quotes, emotionData);

    // 通知
    if (result.actions.length > 0) {
      const hasSell = result.actions.some(a => a.type === "卖出");
      const hasBuy = result.actions.some(a => a.type === "买入");
      const level: NotifyLevel = hasSell ? "紧急" : hasBuy ? "警告" : "提示";

      const lines = result.actions.map(a => {
        const emoji = a.type === "买入" ? "🟢" : "🔴";
        return `${emoji} **${a.type}** ${a.name}(${a.code}) ${a.shares}股 ¥${a.amount.toFixed(0)}\n   ${a.reason} [${a.strategy}]`;
      });

      const title = `⚡ 超短线：${result.actions.map(a => `${a.type}${a.name}`).join("、")}`;
      const content = [
        ...lines,
        `\n🎭 市场情绪: **${result.emotion}** ${result.emotionDetail}`,
        `\n**分析**：${result.reasoning}`,
      ].join("\n");

      sendNotification({ level, title, content }).catch(e => console.error("超短线通知失败:", e));
    }

    const tv = result.portfolio.cash + result.portfolio.holdings.reduce((s, h) => s + h.currentValue, 0);
    return NextResponse.json({
      triggered: result.triggered,
      reasoning: result.reasoning,
      actions: result.actions,
      emotion: result.emotion,
      emotionDetail: result.emotionDetail,
      portfolio: {
        ...result.portfolio,
        totalValue: Math.round(tv * 100) / 100,
        totalPnl: Math.round((tv - result.portfolio.initialCapital) * 100) / 100,
        totalPnlPercent: Math.round(((tv - result.portfolio.initialCapital) / result.portfolio.initialCapital * 100) * 100) / 100,
        weekPnlPercent: result.portfolio.weekStartValue > 0
          ? Math.round(((tv - result.portfolio.weekStartValue) / result.portfolio.weekStartValue * 100) * 100) / 100
          : 0,
      },
    });
  } catch (error) {
    console.error("Scalp scan error:", error);
    return NextResponse.json({ error: "超短线扫描失败" }, { status: 500 });
  }
}
