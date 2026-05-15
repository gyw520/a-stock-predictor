"use client";
import { useState, useEffect, useRef } from "react";

// ==================== 类型 ====================

interface NextDayAnalysis {
  summary: string;
  limitUpReason: string;
  technicalPattern: string;
  volumeAnalysis: string;
  marketAnalysis: string;
  internationalFactors: string;
  domesticFactors: string;
  companyFactors: string;
  speculationFactors: string;
  riskWarning: string;
  klineFeatures: string[];
  recentKlines: { date: string; close: number; changePercent: number; volume: number; amount: number }[];
}

interface NextDayPick {
  code: string; name: string; todayClose: number;
  todayChangePercent: number; todayTurnoverRate: number; todayAmount: number;
  score: number; level: "极高" | "高" | "中";
  reasons: string[];
  consecutiveUp: number; volumeExpanding: boolean;
  limitUpToday: boolean; nearLimitUpToday: boolean;
  addedDate: string;
  analysis?: NextDayAnalysis;
  sectors?: string[]; concepts?: string[];
  qualityScore?: number; qualityGrade?: string;
  qualityReasons?: string[]; qualityRiskFlags?: string[];
  positionMultiplier?: number;
}

interface NextDayAlert {
  code: string; name: string; currentPrice: number;
  changePercent: number; turnoverRate: number; amount: number;
  triggerReason: string; score: number; detectedAt: string;
  sectors?: string[]; concepts?: string[];
}

interface NextDayWatchlist {
  date: string; picks: NextDayPick[]; generatedAt: string;
}

interface LimitUpCandidate {
  code: string; name: string; price: number;
  changePercent: number; limitPrice: number; distancePercent: number;
  score: number; level: "极高" | "高" | "中" | "关注";
  turnoverRate: number; amount: number; volume: number;
  momentumScore: number; volumeScore: number; patternScore: number;
  distanceScore: number; capitalScore: number; sectorScore: number;
  tags: string[]; reason: string; detectedAt: string;
  high: number; low: number; open: number; prevClose: number;
  sectors?: string[]; concepts?: string[];
}

interface ScanResult {
  timestamp: string;
  candidates: LimitUpCandidate[];
  totalScanned: number;
  marketHeat: number;
  limitUpCount: number;
  nearLimitUpCount: number;
}

interface AuctionStock {
  code: string; name: string; price: number; prevClose: number;
  changePercent: number; amount: number; marketCap: number;
}

interface AuctionStats {
  phase: "preMarket" | "callAuction" | "trading" | "afterMarket";
  timestamp: string;
  totalStocks: number;
  limitUpExpect: number;
  highOpen7: number; highOpen5: number; highOpen3: number; highOpen1: number;
  flat: number;
  lowOpen3: number; lowOpen5: number; lowOpen7: number; limitDownExpect: number;
  upDownRatio: number; avgChange: number;
  sentiment: string; sentimentScore: number;
  topGainers: AuctionStock[]; topLosers: AuctionStock[];
  watchlistAuction: {
    code: string; name: string;
    yesterdayScore: number; yesterdayLevel: string;
    auctionPct: number; matchedAuction: boolean;
  }[];
}

// ==================== 主面板 ====================

export default function LimitUpPanel() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "极高" | "高" | "中">("all");
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 次日关注
  const [watchlist, setWatchlist] = useState<NextDayWatchlist | null>(null);
  const [nextDayAlerts, setNextDayAlerts] = useState<NextDayAlert[]>([]);
  const [phase, setPhase] = useState<"callAuction" | "intraday" | null>(null);
  const [generating, setGenerating] = useState(false);
  const [tab, setTab] = useState<"realtime" | "auction" | "nextday">("realtime");
  const [auctionStats, setAuctionStats] = useState<AuctionStats | null>(null);
  const [selectedPick, setSelectedPick] = useState<NextDayPick | null>(null);

  const fetchData = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await fetch("/api/limit-up");
      if (!res.ok) throw new Error();
      const json = await res.json();
      if (!json.error) setData(json);
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // 次日追踪
  const fetchNextDayTrack = async () => {
    try {
      const res = await fetch("/api/limit-up", { method: "PUT" });
      const json = await res.json();
      if (json.watchlist) setWatchlist(json.watchlist);
      if (json.alerts) setNextDayAlerts(json.alerts);
      if (json.phase) setPhase(json.phase);
    } catch {}
  };

  // 集合竞价统计
  const fetchAuctionStats = async () => {
    try {
      const res = await fetch("/api/limit-up", { method: "PATCH" });
      const json = await res.json();
      if (!json.error) setAuctionStats(json);
    } catch {}
  };

  // 生成次日关注列表
  const generateWatchlist = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/limit-up", { method: "POST" });
      const json = await res.json();
      if (json.watchlist) setWatchlist(json.watchlist);
    } catch {} finally { setGenerating(false); }
  };

  useEffect(() => {
    fetchData();
    fetchNextDayTrack();
    fetchAuctionStats();
    // 10秒刷新实时雷达 + 次日追踪
    timerRef.current = setInterval(() => {
      fetchData(true);
      fetchNextDayTrack();
      fetchAuctionStats();
    }, 10 * 1000);

    // 14:50自动生成次日关注列表
    const autoGen = setInterval(() => {
      const utc = Date.now();
      const bj = new Date(utc + 8 * 3600000);
      const d = bj.getUTCDay();
      const m = bj.getUTCHours() * 60 + bj.getUTCMinutes();
      if (d >= 1 && d <= 5 && m >= 890 && m <= 895) { // 14:50-14:55
        generateWatchlist();
      }
    }, 60 * 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      clearInterval(autoGen);
    };
  }, []);

  if (loading) return (
    <div className="space-y-4">
      {[1,2,3,4].map(i => <div key={i} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] animate-pulse h-24" />)}
    </div>
  );

  const candidates = data?.candidates || [];
  const filtered = filter === "all" ? candidates : candidates.filter(c => c.level === filter);
  const extremeHigh = candidates.filter(c => c.level === "极高");
  const high = candidates.filter(c => c.level === "高");
  const medium = candidates.filter(c => c.level === "中");
  const watch = candidates.filter(c => c.level === "关注");

  const heatColor = (data?.marketHeat ?? 0) >= 70 ? "#ef4444" : (data?.marketHeat ?? 0) >= 40 ? "#f59e0b" : "#94a3b8";

  return (
    <div className="space-y-4">
      {/* 顶部状态栏 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔥</span>
            <div>
              <h2 className="text-lg font-bold">涨停雷达</h2>
              <p className="text-[10px] text-[var(--text-secondary)]">
                盘中实时扫描 + 次日冲板预判 · 10秒刷新 · 企微即时推送
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <span className="text-[9px] text-[var(--text-secondary)] font-mono">
                {new Date(data.timestamp).toLocaleTimeString("zh-CN")} · 扫描{data.totalScanned}只
              </span>
            )}
            <button onClick={() => fetchData()} disabled={refreshing}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 bg-[var(--accent-blue)] text-white hover:opacity-90">
              {refreshing ? "⏳..." : "🔄 刷新"}
            </button>
            <button onClick={generateWatchlist} disabled={generating}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 bg-[#f59e0b] text-white hover:opacity-90">
              {generating ? "⏳ 分析中..." : "📋 生成明日关注"}
            </button>
          </div>
        </div>

        {/* Tab切换 */}
        <div className="flex gap-1 mb-4">
          {[
            { key: "realtime" as const, label: "🔥 盘中实时", count: data?.candidates.length || 0 },
            { key: "auction" as const, label: "🔔 集合竞价", count: auctionStats?.limitUpExpect ?? 0 },
            { key: "nextday" as const, label: "📋 次日预判", count: (watchlist?.picks.length || 0) + nextDayAlerts.length },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors ${
                tab === t.key ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}>
              {t.label}({t.count})
            </button>
          ))}
        </div>

        {/* 市场热度 + 统计 */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
            <div className="text-[10px] text-[var(--text-secondary)]">市场炸板热度</div>
            <div className="text-xl font-black mt-0.5" style={{ color: heatColor }}>
              {data?.marketHeat ?? 0}<span className="text-xs font-normal">/100</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-[var(--bg-card)] overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{
                width: `${data?.marketHeat ?? 0}%`,
                background: `linear-gradient(90deg, #f59e0b, ${heatColor})`,
              }} />
            </div>
          </div>
          <StatCard label="已封板" value={`${data?.limitUpCount ?? 0}只`} color="#ef4444" icon="🔒" />
          <StatCard label="极高概率" value={`${extremeHigh.length}只`} color="#ef4444" icon="🔴" />
          <StatCard label="高概率" value={`${high.length}只`} color="#f97316" icon="🟠" />
          <StatCard label="关注中" value={`${medium.length + watch.length}只`} color="#f59e0b" icon="🟡" />
        </div>
      </div>

      {/* 实时雷达内容 */}
      {tab === "realtime" && (
        <>
          {/* 过滤标签 */}
          <div className="flex gap-1 items-center">
            {[
              { key: "all" as const, label: `全部(${candidates.length})`, color: "" },
              { key: "极高" as const, label: `极高(${extremeHigh.length})`, color: "#ef4444" },
              { key: "高" as const, label: `高(${high.length})`, color: "#f97316" },
              { key: "中" as const, label: `中(${medium.length})`, color: "#f59e0b" },
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  filter === f.key
                    ? "text-white"
                    : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
                style={filter === f.key ? { background: f.color || "var(--accent-blue)" } : {}}>
                {f.label}
              </button>
            ))}
            <span className="text-[9px] text-[var(--text-secondary)] ml-auto">
              💡 评分 = 涨幅动量(25) + 成交放量(20) + 分时形态(20) + 冲板距离(15) + 资金(10) + 板块(10)
            </span>
          </div>

          {/* 候选列表 */}
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-[var(--text-secondary)]">
              <div className="text-4xl mb-3">😴</div>
              <p className="text-sm">暂无符合条件的冲板候选</p>
              <p className="text-[10px] mt-1">等待盘中出现涨幅≥3%+放量的强势票</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((c, idx) => (
                <CandidateCard key={c.code} candidate={c} rank={idx + 1} />
              ))}
            </div>
          )}
        </>
      )}

      {/* 集合竞价Tab */}
      {tab === "auction" && (
        <AuctionTab stats={auctionStats} />
      )}

      {/* 次日预判Tab */}
      {tab === "nextday" && (
        <>
          {/* 次日盘中触发告警 */}
          {nextDayAlerts.length > 0 && (() => {
            const isAuction = phase === "callAuction";
            const themeColor = isAuction ? "#f59e0b" : "#ef4444";
            const icon = isAuction ? "🔔" : "🚨";
            const title = isAuction ? "集合竞价异动预警" : "昨日关注票今日启动";
            return (
              <div className="rounded-xl border p-4" style={{ borderColor: themeColor + "40", background: themeColor + "08" }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm">{icon}</span>
                  <h3 className="text-xs font-bold" style={{ color: themeColor }}>{title}</h3>
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: themeColor + "20", color: themeColor }}>
                    {nextDayAlerts.length}只{isAuction ? "异动" : "触发"}
                  </span>
                  {isAuction && (
                    <span className="text-[9px] text-[var(--text-secondary)]">9:15-9:25 竞价撮合预估价</span>
                  )}
                </div>
                <div className="space-y-2">
                  {nextDayAlerts.map(a => {
                    const amountStr = a.amount >= 100000000 ? `${(a.amount / 100000000).toFixed(1)}亿` : `${(a.amount / 10000).toFixed(0)}万`;
                    const sign = a.changePercent >= 0 ? "+" : "";
                    const pctColor = a.changePercent >= 0 ? "#ef4444" : "#22c55e";
                    return (
                      <div key={a.code} className="flex items-center gap-2 text-[11px] py-2 border-b border-[var(--border-color)] last:border-0">
                        <span className="text-2xl font-black tabular-nums" style={{ color: themeColor }}>{a.score}</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-bold">{a.name}</span>
                            <span className="text-[var(--text-secondary)] font-mono text-[9px]">{a.code}</span>
                            <span className="font-bold" style={{ color: pctColor }}>{sign}{a.changePercent}%</span>
                            {!isAuction && (
                              <span className="text-[var(--text-secondary)]">换手{a.turnoverRate}% {amountStr}</span>
                            )}
                          </div>
                          <div className="text-[10px] text-[#f97316]">{a.triggerReason}</div>
                          <SectorTags sectors={a.sectors} concepts={a.concepts} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* 次日关注列表 */}
          {watchlist && watchlist.picks.length > 0 ? (
            <div className="rounded-xl border border-[#f59e0b40] bg-[#f59e0b08] p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm">📋</span>
                <h3 className="text-xs font-bold text-[#f59e0b]">次日冲板关注列表</h3>
                <span className="text-[9px] text-[var(--text-secondary)]">
                  {watchlist.date}生成 · {watchlist.picks.length}只
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#ef444420] text-[#ef4444] font-bold ml-auto">
                  {watchlist.picks.filter(p => p.level === "极高").length}极高
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#f9731620] text-[#f97316] font-bold">
                  {watchlist.picks.filter(p => p.level === "高").length}高
                </span>
              </div>
              <div className="space-y-2">
                {watchlist.picks.map((p, idx) => {
                  const levelColor: Record<string, string> = { "极高": "#ef4444", "高": "#f97316", "中": "#f59e0b" };
                  const color = levelColor[p.level] || "#94a3b8";
                  const amountStr = p.todayAmount >= 100000000 ? `${(p.todayAmount / 100000000).toFixed(1)}亿` : `${(p.todayAmount / 10000).toFixed(0)}万`;
                  const isTriggered = nextDayAlerts.some(a => a.code === p.code);
                  return (
                    <div key={p.code} className={`text-[11px] py-2 px-2 rounded-lg border-b border-[var(--border-color)] last:border-0 ${isTriggered ? "bg-[#ef444410]" : ""}`}>
                      <div className="flex items-center gap-2">
                        <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black text-white"
                          style={{ background: idx < 3 ? color : "#6b7280" }}>
                          {idx + 1}
                        </div>
                        <span className="font-bold w-16 cursor-pointer hover:text-[var(--accent-blue)] hover:underline transition-colors" onClick={() => setSelectedPick(p)}>{p.name}</span>
                        <span className="text-[var(--text-secondary)] font-mono w-14 text-[9px]">{p.code}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: `${color}15`, color }}>{p.level}</span>
                        <span className="font-black tabular-nums" style={{ color }}>{p.score}</span>
                        <span className="text-[var(--text-secondary)]">
                          {p.limitUpToday ? "🔒涨停" : `+${p.todayChangePercent}%`}
                        </span>
                        <span className="text-[9px] text-[var(--text-secondary)]">换手{p.todayTurnoverRate}%</span>
                        <span className="text-[9px] text-[var(--text-secondary)]">{amountStr}</span>
                        {isTriggered && <span className="text-[9px] px-1 py-0.5 rounded bg-[#ef444420] text-[#ef4444] font-bold">🚨已启动</span>}
                        {p.qualityScore != null && p.limitUpToday && <QualityBadge score={p.qualityScore} grade={p.qualityGrade || ""} />}
                        <span className="text-[9px] text-[var(--text-secondary)] ml-auto truncate max-w-[200px]">{p.reasons.slice(0, 3).join("+")}</span>
                      </div>
                      <SectorTags sectors={p.sectors} concepts={p.concepts} />
                      {p.qualityRiskFlags && p.qualityRiskFlags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5 pl-8">
                          {p.qualityRiskFlags.map(f => (
                            <span key={f} className="text-[8px] px-1 py-0.5 rounded bg-[#ef444410] text-[#ef4444]">{f}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-[var(--text-secondary)]">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-sm">暂无次日关注列表</p>
              <p className="text-[10px] mt-1">点击“生成明日关注”或等待14:50自动生成</p>
            </div>
          )}

          {/* 次日预判说明 */}
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
            <h3 className="text-sm font-bold mb-2">📋 次日冲板预判说明</h3>
            <div className="text-[11px] text-[var(--text-secondary)] space-y-1 leading-relaxed">
              <p>• 每天<strong>14:50自动生成</strong>明日关注列表，也可手动触发</p>
              <p>• 分析今日涨停/大涨票的K线特征：连板、首板、连阳、量能递增、尾盘强势、突破新高</p>
              <p>• 第二天盘中自动追踪关注列表，出现以下任意情况即推送企微：</p>
              <p className="pl-4">✅ 涨幅≥5% → 明确启动</p>
              <p className="pl-4">✅ 涨幅≥3% + 换手≥2% → 放量启动</p>
              <p className="pl-4">✅ 高开≥2%且未回补 → 溢价延续</p>
              <p className="pl-4">✅ 涨幅≥2%+持续冲高 → 攻击态势</p>
              <p>• 推送规则：仅交易时段推送，3分钟冷却防刷屏</p>
            </div>
          </div>
        </>
      )}

      {/* 实时雷达Tab */}
      {tab === "realtime" && (
        <>
      {/* 说明 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-sm font-bold mb-2">📋 涨停预判策略说明</h3>
        <div className="text-[11px] text-[var(--text-secondary)] space-y-1 leading-relaxed">
          <p>• <strong>扫描范围</strong>：全市场涨幅前500只个股，涨幅≥3%进入监控池</p>
          <p>• <strong>评分体系</strong>（满分100）：动量(25)+放量(20)+形态(20)+距离(15)+资金(10)+板块(10)</p>
          <p>• <strong>推送规则</strong>：极高/高概率票→企微即时推送（仅交易时段，3分钟冷却）</p>
          <p>• ⚠️ 涨停预判不等于一定封板，追涨打板有风险，仅供参考</p>
        </div>
      </div>
        </>
      )}

      {/* 分析弹窗 */}
      {selectedPick && <AnalysisModal pick={selectedPick} onClose={() => setSelectedPick(null)} />}
    </div>
  );
}

// ==================== 集合竞价Tab ====================

function AuctionTab({ stats }: { stats: AuctionStats | null }) {
  if (!stats) {
    return (
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 text-center text-[10px] text-[var(--text-secondary)]">
        正在加载集合竞价数据...
      </div>
    );
  }

  const phaseLabel: Record<AuctionStats["phase"], string> = {
    preMarket: "盘前（9:15前）",
    callAuction: "集合竞价中（9:15-9:25）",
    trading: "盘中交易",
    afterMarket: "收盘后",
  };
  const phaseColor: Record<AuctionStats["phase"], string> = {
    preMarket: "#94a3b8",
    callAuction: "#f59e0b",
    trading: "#22c55e",
    afterMarket: "#94a3b8",
  };

  // 情绪颜色
  const sentimentColor =
    stats.sentimentScore >= 60 ? "#dc2626" :
    stats.sentimentScore >= 30 ? "#ef4444" :
    stats.sentimentScore >= 10 ? "#f97316" :
    stats.sentimentScore >= -10 ? "#94a3b8" :
    stats.sentimentScore >= -30 ? "#3b82f6" :
    stats.sentimentScore >= -60 ? "#22c55e" : "#16a34a";

  return (
    <div className="space-y-3">
      {/* 顶部：阶段+情绪 */}
      <div className="rounded-xl border p-4" style={{ borderColor: phaseColor[stats.phase] + "40", background: phaseColor[stats.phase] + "08" }}>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm">🔔</span>
            <h3 className="text-xs font-bold" style={{ color: phaseColor[stats.phase] }}>
              {phaseLabel[stats.phase]}
            </h3>
            <span className="text-[9px] text-[var(--text-secondary)]">
              {new Date(stats.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-secondary)]">市场情绪</span>
            <span className="text-sm font-black" style={{ color: sentimentColor }}>{stats.sentiment}</span>
            <span className="text-xs font-bold tabular-nums" style={{ color: sentimentColor }}>
              {stats.sentimentScore >= 0 ? "+" : ""}{stats.sentimentScore}
            </span>
          </div>
        </div>

        {/* 关键指标 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
          <div className="rounded-lg bg-[var(--bg-card)] p-2 text-center">
            <div className="text-[var(--text-secondary)]">扫描数量</div>
            <div className="text-base font-black tabular-nums mt-0.5">{stats.totalStocks}</div>
          </div>
          <div className="rounded-lg bg-[var(--bg-card)] p-2 text-center">
            <div className="text-[var(--text-secondary)]">平均涨跌</div>
            <div className="text-base font-black tabular-nums mt-0.5" style={{ color: stats.avgChange >= 0 ? "#ef4444" : "#22c55e" }}>
              {stats.avgChange >= 0 ? "+" : ""}{stats.avgChange}%
            </div>
          </div>
          <div className="rounded-lg bg-[var(--bg-card)] p-2 text-center">
            <div className="text-[var(--text-secondary)]">涨跌比</div>
            <div className="text-base font-black tabular-nums mt-0.5" style={{ color: stats.upDownRatio >= 1 ? "#ef4444" : "#22c55e" }}>
              {stats.upDownRatio}
            </div>
          </div>
          <div className="rounded-lg bg-[var(--bg-card)] p-2 text-center">
            <div className="text-[var(--text-secondary)]">情绪分</div>
            <div className="text-base font-black tabular-nums mt-0.5" style={{ color: sentimentColor }}>
              {stats.sentimentScore >= 0 ? "+" : ""}{stats.sentimentScore}
            </div>
          </div>
        </div>
      </div>

      {/* 涨跌分布 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
        <h3 className="text-xs font-bold mb-3 flex items-center gap-2">
          📊 涨跌分布
          <span className="text-[9px] text-[var(--text-secondary)] font-normal">仅统计沪深主板</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px]">
          <DistCell label="一字涨停" value={stats.limitUpExpect} color="#dc2626" badge="≥9.8%" />
          <DistCell label="高开" value={stats.highOpen7} color="#ef4444" badge="≥7%" />
          <DistCell label="高开" value={stats.highOpen5} color="#f97316" badge="≥5%" />
          <DistCell label="高开" value={stats.highOpen3} color="#f59e0b" badge="≥3%" />
          <DistCell label="高开" value={stats.highOpen1} color="#fbbf24" badge="≥1%" />
          <DistCell label="平开" value={stats.flat} color="#94a3b8" badge="-1%~1%" />
          <DistCell label="低开" value={stats.lowOpen3} color="#60a5fa" badge="≤-3%" />
          <DistCell label="低开" value={stats.lowOpen5} color="#3b82f6" badge="≤-5%" />
          <DistCell label="低开" value={stats.lowOpen7} color="#22c55e" badge="≤-7%" />
          <DistCell label="一字跌停" value={stats.limitDownExpect} color="#16a34a" badge="≤-9.8%" />
        </div>
      </div>

      {/* 昨日关注票今日竞价表现 */}
      {stats.watchlistAuction.length > 0 && (
        <div className="rounded-xl border border-[#f59e0b40] bg-[#f59e0b08] p-4">
          <h3 className="text-xs font-bold mb-3 text-[#f59e0b] flex items-center gap-2">
            📋 昨日关注票今日竞价表现
            <span className="text-[9px] text-[var(--text-secondary)] font-normal">{stats.watchlistAuction.length}只</span>
          </h3>
          <div className="space-y-1">
            {stats.watchlistAuction.map(w => {
              const pctColor = w.auctionPct >= 0 ? "#ef4444" : "#22c55e";
              const tag = w.auctionPct >= 9 ? "🔥极强" : w.auctionPct >= 5 ? "💪强势" : w.auctionPct >= 2 ? "📈高开" : w.auctionPct >= -2 ? "➡️平开" : "⚠️低开";
              return (
                <div key={w.code} className="flex items-center gap-2 text-[11px] py-1.5 border-b border-[var(--border-color)] last:border-0">
                  <span className="font-bold w-16 truncate">{w.name}</span>
                  <span className="text-[var(--text-secondary)] font-mono text-[9px]">{w.code}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-card)] text-[var(--text-secondary)]">
                    昨{w.yesterdayScore}分[{w.yesterdayLevel}]
                  </span>
                  <span className="flex-1" />
                  <span className="text-[10px]">{tag}</span>
                  <span className="font-bold tabular-nums w-12 text-right" style={{ color: pctColor }}>
                    {w.matchedAuction ? `${w.auctionPct >= 0 ? "+" : ""}${w.auctionPct}%` : "无报价"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TOP高开 */}
      {stats.topGainers.length > 0 && (
        <div className="rounded-xl border border-[#ef444440] bg-[#ef444408] p-4">
          <h3 className="text-xs font-bold mb-3 text-[#ef4444] flex items-center gap-2">
            🚀 高开TOP {Math.min(stats.topGainers.length, 30)}
            <span className="text-[9px] text-[var(--text-secondary)] font-normal">主板涨幅榜</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
            {stats.topGainers.map((s, i) => (
              <StockRow key={s.code} stock={s} rank={i + 1} positive />
            ))}
          </div>
        </div>
      )}

      {/* TOP低开 */}
      {stats.topLosers.length > 0 && stats.topLosers[0].changePercent < 0 && (
        <div className="rounded-xl border border-[#22c55e40] bg-[#22c55e08] p-4">
          <h3 className="text-xs font-bold mb-3 text-[#22c55e] flex items-center gap-2">
            📉 低开TOP {stats.topLosers.filter(s => s.changePercent < 0).length}
            <span className="text-[9px] text-[var(--text-secondary)] font-normal">警示作用</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
            {stats.topLosers.filter(s => s.changePercent < 0).map((s, i) => (
              <StockRow key={s.code} stock={s} rank={i + 1} positive={false} />
            ))}
          </div>
        </div>
      )}

      <div className="text-[9px] text-[var(--text-secondary)] text-center">
        {stats.phase === "callAuction"
          ? "数据为竞价撮合预估价，9:25集合竞价结束后开盘"
          : stats.phase === "preMarket"
          ? "9:15集合竞价开始后才有数据"
          : "数据自动每10秒刷新"}
      </div>
    </div>
  );
}

function DistCell({ label, value, color, badge }: { label: string; value: number; color: string; badge: string }) {
  return (
    <div className="rounded-lg bg-[var(--bg-secondary)] p-2 text-center">
      <div className="text-[var(--text-secondary)]">{label}</div>
      <div className="text-[8px] text-[var(--text-secondary)] opacity-60">{badge}</div>
      <div className="text-base font-black tabular-nums mt-0.5" style={{ color: value > 0 ? color : "var(--text-secondary)" }}>
        {value}
      </div>
    </div>
  );
}

function StockRow({ stock: s, rank, positive }: { stock: AuctionStock; rank: number; positive: boolean }) {
  const pctColor = positive ? "#ef4444" : "#22c55e";
  const sign = s.changePercent >= 0 ? "+" : "";
  return (
    <div className="flex items-center gap-2 text-[11px] py-1 border-b border-[var(--border-color)] last:border-0">
      <span className="text-[9px] text-[var(--text-secondary)] font-mono w-5 text-right">{rank}</span>
      <span className="font-bold w-20 truncate">{s.name}</span>
      <span className="text-[var(--text-secondary)] font-mono text-[9px]">{s.code}</span>
      <span className="flex-1" />
      <span className="text-[9px] text-[var(--text-secondary)] tabular-nums">¥{s.price.toFixed(2)}</span>
      <span className="font-bold tabular-nums w-14 text-right" style={{ color: pctColor }}>
        {sign}{s.changePercent.toFixed(2)}%
      </span>
    </div>
  );
}

// ==================== 分析弹窗 ====================

function AnalysisModal({ pick: p, onClose }: { pick: NextDayPick; onClose: () => void }) {
  const a = p.analysis;
  const levelColor: Record<string, string> = { "极高": "#ef4444", "高": "#f97316", "中": "#f59e0b" };
  const color = levelColor[p.level] || "#94a3b8";
  const amountStr = p.todayAmount >= 100000000 ? `${(p.todayAmount / 100000000).toFixed(1)}亿` : `${(p.todayAmount / 10000).toFixed(0)}万`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative bg-[var(--bg-card)] border border-[var(--border-color)] rounded-2xl shadow-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="sticky top-0 bg-[var(--bg-card)] border-b border-[var(--border-color)] p-5 rounded-t-2xl z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-3xl font-black tabular-nums" style={{ color }}>{p.score}</div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">{p.name}</span>
                  <span className="text-xs text-[var(--text-secondary)] font-mono">{p.code}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: `${color}15`, color }}>
                    {p.level}概率
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] mt-0.5">
                  <span className="font-bold" style={{ color: "#ef4444" }}>
                    {p.limitUpToday ? "🔒涨停" : `+${p.todayChangePercent}%`}
                  </span>
                  <span>¥{p.todayClose.toFixed(2)}</span>
                  <span>换手{p.todayTurnoverRate}%</span>
                  <span>成交{amountStr}</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-lg">
              ×
            </button>
          </div>
          {/* K线特征标签 */}
          {a && a.klineFeatures.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {a.klineFeatures.map((f, i) => (
                <span key={i} className="text-[9px] px-2 py-0.5 rounded-full font-bold" style={{ background: `${color}12`, color }}>{f}</span>
              ))}
            </div>
          )}
        </div>

        {/* 内容 */}
        {a ? (
          <div className="p-5 space-y-4">
            {/* 一句话总结 */}
            <div className="rounded-xl bg-[var(--bg-secondary)] p-4">
              <div className="text-xs font-bold mb-1.5 text-[var(--text-primary)]">📌 综合判断</div>
              <p className="text-[12px] leading-relaxed text-[var(--text-primary)]">{a.summary}</p>
            </div>

            {/* 涨停/大涨原因 */}
            <AnalysisSection icon="🔥" title="涨停/大涨原因" content={a.limitUpReason} color="#ef4444" />

            {/* 技术形态 */}
            <AnalysisSection icon="📐" title="技术形态分析" content={a.technicalPattern} color="#8b5cf6" />

            {/* 量能分析 */}
            <AnalysisSection icon="📊" title="量能分析" content={a.volumeAnalysis} color="#3b82f6" />

            {/* 市场环境 */}
            <AnalysisSection icon="🌍" title="市场环境" content={a.marketAnalysis} color="#10b981" />

            {/* 场外因素 */}
            <AnalysisSection icon="🌐" title="国际因素" content={a.internationalFactors} color="#6366f1" />
            <AnalysisSection icon="🏛️" title="国内政策/宏观" content={a.domesticFactors} color="#0891b2" />
            <AnalysisSection icon="🏢" title="公司/行业因素" content={a.companyFactors} color="#059669" />
            <AnalysisSection icon="🎯" title="炒作/题材因素" content={a.speculationFactors} color="#dc2626" />

            {/* 近5日K线 */}
            {a.recentKlines.length > 0 && (
              <div>
                <div className="text-xs font-bold mb-2 text-[var(--text-primary)]">📈 近5日走势</div>
                <div className="grid grid-cols-5 gap-1">
                  {a.recentKlines.map((k, i) => {
                    const isUp = k.changePercent >= 0;
                    const volStr = k.amount >= 100000000 ? `${(k.amount / 100000000).toFixed(1)}亿` : `${(k.amount / 10000).toFixed(0)}万`;
                    return (
                      <div key={i} className="text-center rounded-lg p-2 bg-[var(--bg-secondary)]">
                        <div className="text-[8px] text-[var(--text-secondary)]">{k.date.slice(5)}</div>
                        <div className="text-xs font-bold mt-0.5" style={{ color: isUp ? "#ef4444" : "#22c55e" }}>
                          {isUp ? "+" : ""}{k.changePercent.toFixed(2)}%
                        </div>
                        <div className="text-[9px] text-[var(--text-secondary)] mt-0.5">¥{k.close.toFixed(2)}</div>
                        <div className="text-[8px] text-[var(--text-secondary)]">{volStr}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 风险提示 */}
            <div className="rounded-xl border border-[#f59e0b40] bg-[#f59e0b08] p-4">
              <div className="text-xs font-bold mb-1.5" style={{ color: "#f59e0b" }}>⚠️ 风险提示</div>
              <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{a.riskWarning}</p>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-[var(--text-secondary)]">
            <p className="text-sm">暂无分析数据</p>
            <p className="text-[10px] mt-1">请重新生成关注列表以获取分析</p>
          </div>
        )}
      </div>
    </div>
  );
}

function AnalysisSection({ icon, title, content, color }: { icon: string; title: string; content: string; color: string }) {
  return (
    <div>
      <div className="text-xs font-bold mb-1.5 text-[var(--text-primary)]">{icon} {title}</div>
      <p className="text-[11px] leading-relaxed text-[var(--text-secondary)] pl-1 border-l-2 ml-1" style={{ borderColor: color }}>
        {content}
      </p>
    </div>
  );
}

// ==================== 候选卡片 ====================

function CandidateCard({ candidate: c, rank }: { candidate: LimitUpCandidate; rank: number }) {
  const levelColor: Record<string, string> = {
    "极高": "#ef4444", "高": "#f97316", "中": "#f59e0b", "关注": "#94a3b8",
  };
  const levelBg: Record<string, string> = {
    "极高": "#ef444415", "高": "#f9731615", "中": "#f59e0b15", "关注": "#94a3b815",
  };
  const color = levelColor[c.level] || "#94a3b8";
  const amountStr = c.amount >= 100000000
    ? `${(c.amount / 100000000).toFixed(1)}亿`
    : `${(c.amount / 10000).toFixed(0)}万`;

  // 分时条形：显示涨幅在日内的位置
  const openGap = c.prevClose > 0 ? ((c.open - c.prevClose) / c.prevClose * 100) : 0;

  return (
    <div className="rounded-xl border bg-[var(--bg-card)] p-4 transition-all hover:border-[color:var(--accent-blue)]"
      style={{ borderColor: c.level === "极高" ? `${color}60` : "var(--border-color)" }}>
      <div className="flex items-start gap-3">
        {/* 排名 */}
        <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-black text-white"
          style={{ background: rank <= 3 ? color : "#6b7280" }}>
          {rank}
        </div>

        {/* 主信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-sm">{c.name}</span>
            <span className="text-[9px] text-[var(--text-secondary)] font-mono">{c.code}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: levelBg[c.level], color }}>
              {c.level}概率
            </span>
            {c.tags.slice(0, 3).map((t, i) => (
              <span key={i} className="text-[8px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">{t}</span>
            ))}
          </div>

          {/* 核心数据行 */}
          <div className="flex items-center gap-3 text-[11px] mb-2">
            <span className="font-bold tabular-nums" style={{ color: "#ef4444" }}>
              ¥{c.price.toFixed(2)}
            </span>
            <span className="font-bold tabular-nums" style={{ color: "#ef4444" }}>
              +{c.changePercent}%
            </span>
            <span className="text-[var(--text-secondary)]">
              涨停价 {c.limitPrice.toFixed(2)}
            </span>
            <span className="font-bold" style={{ color: c.distancePercent <= 1 ? "#ef4444" : c.distancePercent <= 2 ? "#f97316" : "#f59e0b" }}>
              差{c.distancePercent}%
            </span>
            <span className="text-[var(--text-secondary)]">换手{c.turnoverRate}%</span>
            <span className="text-[var(--text-secondary)]">成交{amountStr}</span>
          </div>

          {/* 评分条 */}
          <div className="flex items-center gap-1 mb-1">
            <ScoreBar label="动量" value={c.momentumScore} max={20} color="#ef4444" />
            <ScoreBar label="量能" value={c.volumeScore} max={20} color="#f97316" />
            <ScoreBar label="形态" value={c.patternScore} max={20} color="#f59e0b" />
            <ScoreBar label="空间" value={c.distanceScore} max={8} color="#8b5cf6" />
            <ScoreBar label="资金" value={c.capitalScore} max={10} color="#3b82f6" />
            <ScoreBar label="板块" value={c.sectorScore} max={10} color="#10b981" />
          </div>

          {/* 原因 */}
          <div className="text-[10px] text-[var(--text-secondary)]">{c.reason}</div>
          <SectorTags sectors={c.sectors} concepts={c.concepts} />
        </div>

        {/* 右侧大分数 */}
        <div className="flex-shrink-0 text-right">
          <div className="text-2xl font-black tabular-nums" style={{ color }}>{c.score}</div>
          <div className="text-[9px] text-[var(--text-secondary)]">冲板分</div>
        </div>
      </div>
    </div>
  );
}

// ==================== 涨停质量徽章 ====================

function QualityBadge({ score, grade }: { score: number; grade: string }) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    "极优板": { bg: "#10b98115", text: "#10b981" },
    "中等质量板": { bg: "#f59e0b15", text: "#f59e0b" },
    "低质量板": { bg: "#f9731615", text: "#f97316" },
    "垃圾板": { bg: "#ef444415", text: "#ef4444" },
  };
  const c = colorMap[grade] || { bg: "#94a3b815", text: "#94a3b8" };
  const emoji = grade === "极优板" ? "🏆" : grade === "中等质量板" ? "🟡" : grade === "低质量板" ? "🟠" : "❌";
  return (
    <span className="text-[8px] px-1.5 py-0.5 rounded font-bold" style={{ background: c.bg, color: c.text }}>
      {emoji}{score}分
    </span>
  );
}

// ==================== 板块/概念标签 ====================

function SectorTags({ sectors, concepts }: { sectors?: string[]; concepts?: string[] }) {
  const hasSectors = sectors && sectors.length > 0;
  const hasConcepts = concepts && concepts.length > 0;
  if (!hasSectors && !hasConcepts) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {hasSectors && sectors.slice(0, 2).map(s => (
        <span key={s} className="text-[9px] px-1.5 py-0.5 rounded bg-[#3b82f615] text-[#3b82f6] font-medium">
          {s}
        </span>
      ))}
      {hasConcepts && concepts.slice(0, 3).map(c => (
        <span key={c} className="text-[9px] px-1.5 py-0.5 rounded bg-[#8b5cf615] text-[#8b5cf6] font-medium">
          #{c}
        </span>
      ))}
    </div>
  );
}

// ==================== 小组件 ====================

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex-1">
      <div className="flex justify-between text-[8px] mb-0.5">
        <span className="text-[var(--text-secondary)]">{label}</span>
        <span className="font-bold" style={{ color }}>{value}/{max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
      <div className="text-[10px] text-[var(--text-secondary)]">{icon} {label}</div>
      <div className="text-lg font-black tabular-nums mt-0.5" style={{ color }}>{value}</div>
    </div>
  );
}
