"use client";

import { useState, useEffect } from "react";

interface ETFData {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
  turnoverRate: number;
  sector: string;
}

interface GlobalIndexData {
  name: string;
  code: string;
  price: number;
  change: number;
  changePercent: number;
}

interface SectorForecast {
  sector: string;
  overallScore: number;
  riskLevel: string;
  action: string;
  reasons: string[];
  globalImpact: string;
  technicalSummary: string;
  etfPerformance: string;
  tomorrowOutlook: string;
}

interface DailyBriefing {
  timestamp: string;
  isBeforeClose: boolean;
  marketSentiment: string;
  globalSummary: string;
  sectorForecasts: SectorForecast[];
  keyRisks: string[];
  keyOpportunities: string[];
}

function ActionBadge({ action }: { action: string }) {
  const styles: Record<string, { bg: string; text: string }> = {
    "加仓": { bg: "#ef444425", text: "#ef4444" },
    "逢低建仓": { bg: "#f59e0b25", text: "#f59e0b" },
    "持仓观望": { bg: "#6b728025", text: "#94a3b8" },
    "逢高减仓": { bg: "#3b82f625", text: "#3b82f6" },
    "减仓": { bg: "#10b98125", text: "#10b981" },
  };
  const s = styles[action] || styles["持仓观望"];
  return (
    <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: s.bg, color: s.text }}>
      {action}
    </span>
  );
}

function RiskBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    "高风险": "#ef4444",
    "中风险": "#f59e0b",
    "低风险": "#10b981",
  };
  const c = colors[level] || "#94a3b8";
  return (
    <span className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: `${c}50`, color: c }}>
      {level}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const normalized = (score + 100) / 200;
  const color = score >= 30 ? "#ef4444" : score >= 10 ? "#f59e0b" : score <= -30 ? "#10b981" : score <= -10 ? "#3b82f6" : "#94a3b8";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-[var(--bg-primary)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${normalized * 100}%`, background: color }}
        />
      </div>
      <span className="text-sm font-bold w-10 text-right" style={{ color }}>{score}</span>
    </div>
  );
}

export default function ETFSectorPanel() {
  const [etfs, setETFs] = useState<ETFData[]>([]);
  const [globalIndices, setGlobalIndices] = useState<GlobalIndexData[]>([]);
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<"briefing" | "etf">("briefing");
  const [selectedSector, setSelectedSector] = useState<string>("all");

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      try {
        const [etfResp, globalResp, briefResp] = await Promise.all([
          fetch("/api/etf"),
          fetch("/api/global"),
          fetch("/api/briefing"),
        ]);
        const [etfData, globalData, briefData] = await Promise.all([
          etfResp.json(),
          globalResp.json(),
          briefResp.json(),
        ]);
        if (Array.isArray(etfData)) setETFs(etfData);
        if (Array.isArray(globalData)) setGlobalIndices(globalData);
        if (briefData && !briefData.error) setBriefing(briefData);
      } catch {} finally {
        setLoading(false);
      }
    }

    loadAll();
    const timer = setInterval(loadAll, 60000);
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => <div key={i} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] animate-pulse h-40" />)}
      </div>
    );
  }

  const sectorNames = ["all", ...new Set(etfs.map(e => e.sector).filter(Boolean))];
  const filteredETFs = selectedSector === "all" ? etfs : etfs.filter(e => e.sector === selectedSector);

  return (
    <div className="space-y-6">
      {/* Section Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveSection("briefing")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeSection === "briefing"
              ? "bg-[var(--accent-blue)] text-white"
              : "bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:text-[var(--text-primary)]"
          }`}
        >
          📋 综合研判 & 风险提醒
        </button>
        <button
          onClick={() => setActiveSection("etf")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeSection === "etf"
              ? "bg-[var(--accent-blue)] text-white"
              : "bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:text-[var(--text-primary)]"
          }`}
        >
          📊 ETF 实时行情
        </button>
      </div>

      {activeSection === "briefing" && briefing && (
        <>
          {/* 收盘前提醒 Banner */}
          {briefing.isBeforeClose && (
            <div className="rounded-xl border-2 border-[var(--accent-yellow)] bg-[#f59e0b10] p-4 flex items-start gap-3">
              <span className="text-2xl">⏰</span>
              <div>
                <h3 className="text-sm font-bold text-[var(--accent-yellow)] mb-1">收盘前风险提醒</h3>
                <p className="text-xs text-[var(--text-secondary)]">
                  距离收盘不足1小时，以下为各板块的持仓建议，请及时调整仓位。
                </p>
              </div>
            </div>
          )}

          {/* 全球市场 & 市场情绪 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <span>🌍</span> 全球市场概况
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {globalIndices.map(idx => {
                  const isUp = idx.changePercent >= 0;
                  const color = idx.changePercent === 0 ? "var(--text-secondary)" : isUp ? "var(--accent-red)" : "var(--accent-green)";
                  return (
                    <div key={idx.code} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--bg-secondary)]">
                      <span className="text-xs text-[var(--text-secondary)]">{idx.name}</span>
                      <span className="text-xs font-mono font-medium" style={{ color }}>
                        {isUp ? "+" : ""}{idx.changePercent.toFixed(2)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <span>🎯</span> 市场情绪判断
              </h3>
              <p className="text-base font-medium mb-4">{briefing.marketSentiment}</p>

              <div className="space-y-3">
                <div>
                  <h4 className="text-xs text-[var(--text-secondary)] mb-1.5">⚠️ 风险提示</h4>
                  {briefing.keyRisks.map((r, i) => (
                    <div key={i} className="flex items-start gap-1.5 mb-1">
                      <span className="text-[var(--accent-yellow)] text-xs mt-0.5">●</span>
                      <span className="text-xs text-[var(--text-secondary)]">{r}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <h4 className="text-xs text-[var(--text-secondary)] mb-1.5">💡 机会提示</h4>
                  {briefing.keyOpportunities.map((r, i) => (
                    <div key={i} className="flex items-start gap-1.5 mb-1">
                      <span className="text-[var(--accent-green)] text-xs mt-0.5">●</span>
                      <span className="text-xs text-[var(--text-secondary)]">{r}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 各板块综合研判 */}
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border-color)]">
              <h2 className="text-sm font-semibold">📊 各板块综合研判 — 明日预判 & 操作建议</h2>
            </div>
            <div className="divide-y divide-[var(--border-color)]">
              {briefing.sectorForecasts.map(sf => (
                <SectorForecastCard key={sf.sector} forecast={sf} isBeforeClose={briefing.isBeforeClose} />
              ))}
            </div>
          </div>
        </>
      )}

      {activeSection === "etf" && (
        <>
          {/* Sector Filter */}
          <div className="flex gap-2 flex-wrap">
            {sectorNames.map(s => (
              <button
                key={s}
                onClick={() => setSelectedSector(s)}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                  selectedSector === s
                    ? "bg-[var(--accent-blue)] text-white"
                    : "bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:text-[var(--text-primary)]"
                }`}
              >
                {s === "all" ? "全部" : s}
              </button>
            ))}
          </div>

          {/* ETF Table */}
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                    <th className="text-left px-4 py-2.5 font-medium">板块</th>
                    <th className="text-left px-4 py-2.5 font-medium">代码</th>
                    <th className="text-left px-4 py-2.5 font-medium">名称</th>
                    <th className="text-right px-4 py-2.5 font-medium">最新价</th>
                    <th className="text-right px-4 py-2.5 font-medium">涨跌幅</th>
                    <th className="text-right px-4 py-2.5 font-medium">成交额</th>
                    <th className="text-right px-4 py-2.5 font-medium">换手率</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredETFs.map(etf => {
                    const isUp = etf.changePercent >= 0;
                    const color = etf.changePercent === 0 ? "var(--text-secondary)" : isUp ? "var(--accent-red)" : "var(--accent-green)";
                    return (
                      <tr key={etf.code} className="border-b border-[var(--border-color)] hover:bg-[var(--bg-secondary)] transition-colors">
                        <td className="px-4 py-2.5">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                            {etf.sector}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">{etf.code}</td>
                        <td className="px-4 py-2.5 font-medium">{etf.name}</td>
                        <td className="px-4 py-2.5 text-right font-mono" style={{ color }}>
                          {etf.price.toFixed(3)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: `${color}15`, color }}>
                            {isUp ? "+" : ""}{etf.changePercent.toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text-secondary)] font-mono">
                          {etf.amount >= 1e8 ? `${(etf.amount / 1e8).toFixed(1)}亿` : `${(etf.amount / 1e4).toFixed(0)}万`}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">
                          {etf.turnoverRate.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// 单个板块预测卡片
function SectorForecastCard({ forecast: sf, isBeforeClose }: { forecast: SectorForecast; isBeforeClose: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-5 py-4 hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer" onClick={() => setExpanded(!expanded)}>
      {/* 顶部：板块名、评分、风险、操作建议 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-bold">{sf.sector}</h3>
          <RiskBadge level={sf.riskLevel} />
        </div>
        <div className="flex items-center gap-2">
          <ActionBadge action={sf.action} />
          <span className="text-xs text-[var(--text-secondary)]">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* 评分条 */}
      <div className="mb-2">
        <ScoreBar score={sf.overallScore} />
      </div>

      {/* 明日展望（始终显示） */}
      <p className="text-sm text-[var(--text-secondary)] mb-1">{sf.tomorrowOutlook}</p>

      {/* 收盘前强调操作建议 */}
      {isBeforeClose && (
        <div className="mt-2 rounded-lg bg-[#f59e0b10] border border-[#f59e0b30] px-3 py-2">
          <span className="text-xs text-[var(--accent-yellow)] font-medium">
            ⏰ 收盘前建议：{sf.action}
            {sf.action === "减仓" && " — 明日风险较大，建议降低仓位"}
            {sf.action === "加仓" && " — 明日预期向好，可考虑增持"}
            {sf.action === "持仓观望" && " — 方向不明，保持当前仓位"}
            {sf.action === "逢高减仓" && " — 如有盈利可适当减持锁定利润"}
            {sf.action === "逢低建仓" && " — 如有回调可分批建仓"}
          </span>
        </div>
      )}

      {/* 展开的详细分析 */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-[var(--border-color)] space-y-3">
          <div>
            <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-1">🌍 国际市场影响</h4>
            <p className="text-xs text-[var(--text-primary)]">{sf.globalImpact}</p>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-1">📈 ETF 表现</h4>
            <p className="text-xs text-[var(--text-primary)]">{sf.etfPerformance}</p>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-1">🔧 技术面分析</h4>
            <p className="text-xs text-[var(--text-primary)]">{sf.technicalSummary}</p>
          </div>
          {sf.reasons.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-1">📝 综合依据</h4>
              {sf.reasons.map((r, i) => (
                <div key={i} className="flex items-start gap-1.5 mb-0.5">
                  <span className="text-[var(--accent-blue)] text-xs mt-0.5">●</span>
                  <span className="text-xs text-[var(--text-primary)]">{r}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
