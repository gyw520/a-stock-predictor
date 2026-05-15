"use client";

import { useState, useEffect, useCallback } from "react";
import MarketOverview from "@/components/MarketOverview";
import SectorPanel from "@/components/SectorPanel";
import StockSearch from "@/components/StockSearch";
import StockAnalysis from "@/components/StockAnalysis";
import StockTable from "@/components/StockTable";
import ETFSectorPanel from "@/components/ETFSectorPanel";
import MainLinePanel from "@/components/MainLinePanel";
import FourDimPanel from "@/components/FourDimPanel";
import ETFDecisionPanel from "@/components/ETFDecisionPanel";
import WeeklyStrategyPanel from "@/components/WeeklyStrategyPanel";
import DailyReviewPanel from "@/components/DailyReviewPanel";
import QuantStrategyPanel from "@/components/QuantStrategyPanel";
import ModelPortfolioPanel from "@/components/ModelPortfolioPanel";
import OnMarketPortfolioPanel from "@/components/OnMarketPortfolioPanel";
import StockPortfolioPanel from "@/components/StockPortfolioPanel";
import LimitUpPanel from "@/components/LimitUpPanel";
import ScalpPanel from "@/components/ScalpPanel";

type Tab = "overview" | "sectors" | "etf-forecast" | "mainline" | "four-dim" | "etf-decision" | "weekly-strategy" | "daily-review" | "quant" | "model" | "onmarket" | "stock" | "scalp" | "limit-up" | "analysis";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null);

  const handleSelectStock = useCallback((code: string, name: string) => {
    setSelectedStock({ code, name });
    setActiveTab("analysis");
  }, []);

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "overview", label: "大盘总览", icon: "📊" },
    { key: "sectors", label: "板块分析", icon: "🏷️" },
    { key: "etf-forecast", label: "ETF研判", icon: "🌐" },
    { key: "mainline", label: "主线追踪", icon: "🚩" },
    { key: "four-dim", label: "四维研判", icon: "🧩" },
    { key: "etf-decision", label: "场外ETF决策", icon: "💼" },
    { key: "weekly-strategy", label: "短线周策略", icon: "⚡" },
    { key: "daily-review", label: "当日复盘", icon: "📋" },
    { key: "quant", label: "量化策略", icon: "🤖" },
    { key: "model", label: "场外模拟盘", icon: "💰" },
    { key: "onmarket", label: "场内模拟盘", icon: "📈" },
    { key: "stock", label: "个股模拟盘", icon: "🎯" },
    { key: "scalp", label: "超短线", icon: "⚡" },
    { key: "limit-up", label: "涨停雷达", icon: "🔥" },
    { key: "analysis", label: "个股预测", icon: "🔮" },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="text-2xl">📈</div>
              <div>
                <h1 className="text-lg font-bold text-white">A股智能预测系统</h1>
                <p className="text-xs text-[var(--text-secondary)]">实时行情 · 技术分析 · 趋势预测</p>
              </div>
            </div>
            <StockSearch onSelect={handleSelectStock} />
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-5 py-3 text-sm font-medium transition-colors relative ${
                  activeTab === tab.key
                    ? "text-[var(--accent-blue)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <span className="mr-1.5">{tab.icon}</span>
                {tab.label}
                {activeTab === tab.key && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent-blue)] rounded-t" />
                )}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6">
        {activeTab === "overview" && (
          <div className="space-y-6">
            <MarketOverview />
            <StockTable onSelectStock={handleSelectStock} />
          </div>
        )}
        {activeTab === "sectors" && <SectorPanel onSelectStock={handleSelectStock} />}
        {activeTab === "etf-forecast" && <ETFSectorPanel />}
        {activeTab === "mainline" && <MainLinePanel />}
        {activeTab === "four-dim" && <FourDimPanel />}
        {activeTab === "etf-decision" && <ETFDecisionPanel />}
        {activeTab === "weekly-strategy" && <WeeklyStrategyPanel />}
        {activeTab === "daily-review" && <DailyReviewPanel />}
        {activeTab === "quant" && <QuantStrategyPanel />}
        {activeTab === "model" && <ModelPortfolioPanel />}
        {activeTab === "onmarket" && <OnMarketPortfolioPanel />}
        {activeTab === "stock" && <StockPortfolioPanel />}
        {activeTab === "scalp" && <ScalpPanel />}
        {activeTab === "limit-up" && <LimitUpPanel />}
        {activeTab === "analysis" && <StockAnalysis stock={selectedStock} />}
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-color)] py-4 mt-8">
        <p className="text-center text-xs text-[var(--text-secondary)]">
          ⚠️ 本系统仅供学习参考，不构成投资建议。股市有风险，投资需谨慎。
        </p>
      </footer>
    </div>
  );
}
