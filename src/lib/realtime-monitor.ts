/**
 * 盘中实时监控引擎
 *
 * 功能：
 *   - 轮询持仓ETF实时价格
 *   - 检测移动止损 / 固定止损 / 止盈触发
 *   - 检测量化分数大幅变化
 *   - 生成告警列表，持久化到 .data/alerts.json
 */

import * as fs from "fs";
import * as path from "path";
import { loadPortfolio, type PortfolioHolding } from "./model-portfolio";

// ================================================================
//  类型
// ================================================================

export type AlertLevel = "紧急" | "警告" | "提示";
export type AlertType = "移动止损" | "固定止损" | "止盈" | "量化恶化" | "熔断" | "强信号" | "拐点";

export interface Alert {
  id: string;
  timestamp: string;
  level: AlertLevel;
  type: AlertType;
  code: string;
  name: string;
  message: string;
  currentPrice: number;
  triggerValue: number;    // 触发阈值
  acknowledged: boolean;
}

export interface MonitorResult {
  timestamp: string;
  isTradingHours: boolean;
  alerts: Alert[];
  holdingStatus: HoldingLiveStatus[];
}

export interface HoldingLiveStatus {
  code: string;
  name: string;
  currentPrice: number;
  buyPrice: number;
  peakPrice: number;
  pnlPct: number;
  drawdownFromPeak: number;
  trailingStopPct: number;
  distToStopLoss: number;     // 距止损线还有多少%（正=安全，负=已触发）
  distToTakeProfit: number;   // 距止盈线还有多少%
  risk: "安全" | "接近止损" | "已触发止损" | "已触发止盈";
}

// ================================================================
//  持久化
// ================================================================

const DATA_DIR = path.join(process.cwd(), ".data");
const ALERTS_FILE = path.join(DATA_DIR, "alerts.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadAlerts(): Alert[] {
  ensureDataDir();
  if (fs.existsSync(ALERTS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(ALERTS_FILE, "utf-8"));
    } catch { /* fall through */ }
  }
  return [];
}

function saveAlerts(alerts: Alert[]) {
  ensureDataDir();
  // 只保留最近100条
  const trimmed = alerts.slice(-100);
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(trimmed, null, 2), "utf-8");
}

// ================================================================
//  监控逻辑
// ================================================================

const STOP_LOSS_PCT = 5;
const TAKE_PROFIT_PCT = 8;

interface LivePrice {
  code: string;
  price: number;
  changePercent: number;
}

/**
 * 执行一次监控扫描
 */
export function runMonitorScan(
  livePrices: Map<string, LivePrice>,
  quantScores?: Map<string, number>,
): MonitorResult {
  const now = new Date();
  const timestamp = now.toISOString();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const day = now.getDay();

  const isTradingHours = day >= 1 && day <= 5 &&
    ((hour === 9 && minute >= 30) || (hour >= 10 && hour < 11) ||
     (hour === 11 && minute <= 30) ||
     (hour >= 13 && hour < 15));

  const state = loadPortfolio();
  const existingAlerts = loadAlerts();
  const newAlerts: Alert[] = [];
  const holdingStatus: HoldingLiveStatus[] = [];

  // 今日已触发的告警code+type集合（避免重复告警）
  const today = now.toISOString().slice(0, 10);
  const todayFired = new Set(
    existingAlerts
      .filter(a => a.timestamp.startsWith(today))
      .map(a => `${a.code}:${a.type}`)
  );

  for (const h of state.holdings) {
    const live = livePrices.get(h.code);
    if (!live) continue;

    const currentPrice = live.price;
    const pnlPct = h.buyNav > 0 ? ((currentPrice - h.buyNav) / h.buyNav) * 100 : 0;
    const peakNav = h.peakNav || h.buyNav;
    const drawdownFromPeak = peakNav > 0 ? ((peakNav - currentPrice) / peakNav) * 100 : 0;
    const trailingStopPct = h.trailingStopPct || 3;

    // 距离各条线的距离
    const distToTrailingStop = trailingStopPct - drawdownFromPeak;
    const distToFixedStop = STOP_LOSS_PCT + pnlPct; // pnlPct is negative when losing
    const distToStopLoss = Math.min(distToTrailingStop, distToFixedStop);
    const distToTakeProfit = TAKE_PROFIT_PCT - pnlPct;

    let risk: HoldingLiveStatus["risk"] = "安全";

    // 检测移动止损
    if (drawdownFromPeak >= trailingStopPct) {
      risk = "已触发止损";
      if (!todayFired.has(`${h.code}:移动止损`)) {
        newAlerts.push(makeAlert("紧急", "移动止损", h, currentPrice, trailingStopPct,
          `${h.name} 距峰值回撤${drawdownFromPeak.toFixed(1)}%，触发${trailingStopPct}%移动止损线`));
      }
    }
    // 检测固定止损
    else if (pnlPct <= -STOP_LOSS_PCT) {
      risk = "已触发止损";
      if (!todayFired.has(`${h.code}:固定止损`)) {
        newAlerts.push(makeAlert("紧急", "固定止损", h, currentPrice, STOP_LOSS_PCT,
          `${h.name} 亏损${pnlPct.toFixed(1)}%，触发${STOP_LOSS_PCT}%固定止损线`));
      }
    }
    // 检测止盈
    else if (pnlPct >= TAKE_PROFIT_PCT) {
      risk = "已触发止盈";
      if (!todayFired.has(`${h.code}:止盈`)) {
        newAlerts.push(makeAlert("提示", "止盈", h, currentPrice, TAKE_PROFIT_PCT,
          `${h.name} 盈利${pnlPct.toFixed(1)}%，达到${TAKE_PROFIT_PCT}%止盈目标`));
      }
    }
    // 接近止损预警
    else if (distToStopLoss < 1 && distToStopLoss > 0) {
      risk = "接近止损";
      if (!todayFired.has(`${h.code}:警告`)) {
        newAlerts.push(makeAlert("警告", "移动止损", h, currentPrice, trailingStopPct,
          `${h.name} 距止损线仅${distToStopLoss.toFixed(1)}%，注意风险`));
        todayFired.add(`${h.code}:警告`);
      }
    }

    // 量化分数检测
    const qScore = quantScores?.get(h.code);
    if (qScore != null && qScore < -20 && !todayFired.has(`${h.code}:量化恶化`)) {
      newAlerts.push(makeAlert("警告", "量化恶化", h, currentPrice, qScore,
        `${h.name} 量化分${qScore}严重恶化，建议减仓`));
    }

    holdingStatus.push({
      code: h.code, name: h.name,
      currentPrice, buyPrice: h.buyNav, peakPrice: peakNav,
      pnlPct: r2(pnlPct),
      drawdownFromPeak: r2(drawdownFromPeak),
      trailingStopPct,
      distToStopLoss: r2(distToStopLoss),
      distToTakeProfit: r2(distToTakeProfit),
      risk,
    });
  }

  // 检查熔断状态
  if (state.riskLevel === "熔断" && !todayFired.has("portfolio:熔断")) {
    newAlerts.push({
      id: `alert-${Date.now()}-cb`,
      timestamp,
      level: "紧急",
      type: "熔断",
      code: "portfolio",
      name: "整体组合",
      message: `组合触发熔断，回撤${state.maxDrawdownPct?.toFixed(1)}%，暂停交易至${state.circuitBreakerUntil}`,
      currentPrice: 0,
      triggerValue: state.maxDrawdownPct || 0,
      acknowledged: false,
    });
  }

  // 保存新告警
  if (newAlerts.length > 0) {
    saveAlerts([...existingAlerts, ...newAlerts]);
  }

  return { timestamp, isTradingHours, alerts: newAlerts, holdingStatus };
}

// ================================================================
//  告警确认
// ================================================================

export function acknowledgeAlert(alertId: string): boolean {
  const alerts = loadAlerts();
  const alert = alerts.find(a => a.id === alertId);
  if (alert) {
    alert.acknowledged = true;
    saveAlerts(alerts);
    return true;
  }
  return false;
}

export function getUnacknowledgedAlerts(): Alert[] {
  return loadAlerts().filter(a => !a.acknowledged);
}

// ================================================================
//  工具
// ================================================================

function makeAlert(
  level: AlertLevel, type: AlertType,
  h: PortfolioHolding, price: number, triggerValue: number,
  message: string,
): Alert {
  return {
    id: `alert-${Date.now()}-${h.code}`,
    timestamp: new Date().toISOString(),
    level, type,
    code: h.code, name: h.name,
    message, currentPrice: price, triggerValue,
    acknowledged: false,
  };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
