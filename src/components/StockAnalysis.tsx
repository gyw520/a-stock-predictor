"use client";

import { useState, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ComposedChart, Area,
} from "recharts";

interface ChartDataPoint {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  ma5: number;
  ma10: number;
  ma20: number;
  dif: number;
  dea: number;
  macd: number;
}

interface IndicatorSignal {
  signal: string;
  detail: string;
}

interface Prediction {
  signal: string;
  score: number;
  shortTermTrend: string;
  mediumTermTrend: string;
  supportPrice: number;
  resistancePrice: number;
  reasons: string[];
  indicators: {
    maSignal: IndicatorSignal;
    macdSignal: IndicatorSignal;
    rsiSignal: IndicatorSignal;
    bollSignal: IndicatorSignal;
    kdjSignal: IndicatorSignal;
    volumeSignal: IndicatorSignal;
  };
}

interface AnalysisData {
  prediction: Prediction;
  chartData: ChartDataPoint[];
}

function SignalBadge({ signal }: { signal: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    "强烈看涨": { bg: "#dc262620", text: "#ef4444" },
    "看涨": { bg: "#f59e0b20", text: "#f59e0b" },
    "中性": { bg: "#6b728020", text: "#94a3b8" },
    "看跌": { bg: "#3b82f620", text: "#3b82f6" },
    "强烈看跌": { bg: "#10b98120", text: "#10b981" },
  };
  const c = colors[signal] || colors["中性"];
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: c.bg, color: c.text }}>
      {signal}
    </span>
  );
}

function ScoreGauge({ score }: { score: number }) {
  // score: -100 to 100
  const normalized = (score + 100) / 200; // 0 to 1
  const angle = -90 + normalized * 180;   // -90 to 90
  const color =
    score >= 40 ? "#ef4444" :
    score >= 15 ? "#f59e0b" :
    score <= -40 ? "#10b981" :
    score <= -15 ? "#3b82f6" : "#94a3b8";

  return (
    <div className="flex flex-col items-center">
      <svg width="160" height="90" viewBox="0 0 160 90">
        {/* Background arc */}
        <path d="M 10 80 A 70 70 0 0 1 150 80" fill="none" stroke="#1e2d4a" strokeWidth="8" strokeLinecap="round" />
        {/* Colored segments */}
        <path d="M 10 80 A 70 70 0 0 1 38 30" fill="none" stroke="#10b981" strokeWidth="8" strokeLinecap="round" opacity="0.3" />
        <path d="M 38 30 A 70 70 0 0 1 65 14" fill="none" stroke="#3b82f6" strokeWidth="8" strokeLinecap="round" opacity="0.3" />
        <path d="M 65 14 A 70 70 0 0 1 95 14" fill="none" stroke="#94a3b8" strokeWidth="8" strokeLinecap="round" opacity="0.3" />
        <path d="M 95 14 A 70 70 0 0 1 122 30" fill="none" stroke="#f59e0b" strokeWidth="8" strokeLinecap="round" opacity="0.3" />
        <path d="M 122 30 A 70 70 0 0 1 150 80" fill="none" stroke="#ef4444" strokeWidth="8" strokeLinecap="round" opacity="0.3" />
        {/* Needle */}
        <line
          x1="80" y1="80"
          x2={80 + 55 * Math.cos((angle * Math.PI) / 180)}
          y2={80 + 55 * Math.sin((angle * Math.PI) / 180)}
          stroke={color} strokeWidth="2.5" strokeLinecap="round"
        />
        <circle cx="80" cy="80" r="4" fill={color} />
      </svg>
      <div className="text-3xl font-bold mt-1" style={{ color }}>{score}</div>
      <div className="text-xs text-[var(--text-secondary)] mt-0.5">综合评分</div>
    </div>
  );
}

export default function StockAnalysis({
  stock,
}: {
  stock: { code: string; name: string } | null;
}) {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inputCode, setInputCode] = useState("");

  async function loadAnalysis(code: string) {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const resp = await fetch(`/api/predict?code=${code}`);
      if (!resp.ok) throw new Error("分析失败");
      const json = await resp.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (stock) {
      setInputCode(stock.code);
      loadAnalysis(stock.code);
    }
  }, [stock]);

  function handleManualSearch() {
    if (inputCode.trim()) loadAnalysis(inputCode.trim());
  }

  // 未选择股票时的提示
  if (!stock && !data && !loading) {
    return (
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-8">
        <div className="text-center">
          <div className="text-4xl mb-4">🔮</div>
          <h2 className="text-lg font-semibold mb-2">个股智能预测</h2>
          <p className="text-sm text-[var(--text-secondary)] mb-6">
            输入股票代码，获取基于技术指标的综合分析和趋势预测
          </p>
          <div className="flex items-center justify-center gap-2 max-w-xs mx-auto">
            <input
              type="text"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleManualSearch()}
              placeholder="输入股票代码，如 600519"
              className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none focus:border-[var(--accent-blue)] transition-colors"
            />
            <button
              onClick={handleManualSearch}
              className="px-5 py-2.5 bg-[var(--accent-blue)] text-white text-sm font-medium rounded-lg hover:bg-blue-500 transition-colors"
            >
              分析
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-12 text-center">
        <div className="text-2xl animate-bounce mb-3">⏳</div>
        <p className="text-sm text-[var(--text-secondary)]">正在分析 {stock?.name || inputCode}，计算技术指标中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-8 text-center">
        <p className="text-[var(--accent-red)] mb-4">{error}</p>
        <button onClick={() => stock && loadAnalysis(stock.code)} className="text-sm text-[var(--accent-blue)]">
          重试
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { prediction: p, chartData } = data;

  const indicatorsList = [
    { name: "均线系统", icon: "📏", ...p.indicators.maSignal },
    { name: "MACD", icon: "📊", ...p.indicators.macdSignal },
    { name: "RSI", icon: "📈", ...p.indicators.rsiSignal },
    { name: "布林带", icon: "🎯", ...p.indicators.bollSignal },
    { name: "KDJ", icon: "⚡", ...p.indicators.kdjSignal },
    { name: "量能", icon: "🔥", ...p.indicators.volumeSignal },
  ];

  return (
    <div className="space-y-6">
      {/* 顶部: 股票名 + 快速输入 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{stock?.name || inputCode}</h2>
          <p className="text-sm text-[var(--text-secondary)] font-mono">{stock?.code || inputCode}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleManualSearch()}
            placeholder="换一只..."
            className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-sm w-36 outline-none focus:border-[var(--accent-blue)] transition-colors"
          />
          <button onClick={handleManualSearch} className="px-4 py-2 bg-[var(--accent-blue)] text-white text-sm rounded-lg hover:bg-blue-500 transition-colors">
            分析
          </button>
        </div>
      </div>

      {/* 预测结果总览 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 评分仪表盘 */}
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 flex flex-col items-center justify-center">
          <ScoreGauge score={p.score} />
          <div className="mt-3">
            <SignalBadge signal={p.signal} />
          </div>
        </div>

        {/* 趋势判断 */}
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6">
          <h3 className="text-sm font-semibold mb-4">趋势判断</h3>
          <div className="space-y-4">
            <div>
              <div className="text-xs text-[var(--text-secondary)] mb-1">短期趋势</div>
              <div className="text-sm">{p.shortTermTrend}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-secondary)] mb-1">中期趋势</div>
              <div className="text-sm">{p.mediumTermTrend}</div>
            </div>
            <div className="flex gap-4 pt-2 border-t border-[var(--border-color)]">
              <div>
                <div className="text-xs text-[var(--text-secondary)]">支撑位</div>
                <div className="text-sm font-mono text-[var(--accent-green)]">{p.supportPrice}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-secondary)]">阻力位</div>
                <div className="text-sm font-mono text-[var(--accent-red)]">{p.resistancePrice}</div>
              </div>
            </div>
          </div>
        </div>

        {/* 判断依据 */}
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6">
          <h3 className="text-sm font-semibold mb-4">判断依据</h3>
          <div className="space-y-2">
            {p.reasons.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-[var(--accent-blue)] mt-0.5 text-xs">●</span>
                <span className="text-sm text-[var(--text-secondary)]">{r}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 技术指标面板 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
        <h3 className="text-sm font-semibold mb-4">技术指标信号</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {indicatorsList.map((ind) => (
            <div key={ind.name} className="rounded-lg bg-[var(--bg-secondary)] p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-sm">{ind.icon}</span>
                <span className="text-xs font-medium">{ind.name}</span>
              </div>
              <div className="mb-1">
                <SignalBadge signal={ind.signal} />
              </div>
              <div className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">{ind.detail}</div>
            </div>
          ))}
        </div>
      </div>

      {/* K线 + 均线图 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
        <h3 className="text-sm font-semibold mb-4">价格走势与均线</h3>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2d4a" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => v.slice(5)} />
            <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "#94a3b8" }} />
            <Tooltip
              contentStyle={{ background: "#1a2236", border: "1px solid #1e2d4a", borderRadius: "8px", fontSize: "12px" }}
              labelStyle={{ color: "#94a3b8" }}
            />
            <Area type="monotone" dataKey="close" stroke="#3b82f6" fill="#3b82f620" strokeWidth={2} name="收盘价" />
            <Line type="monotone" dataKey="ma5" stroke="#f59e0b" dot={false} strokeWidth={1} name="MA5" />
            <Line type="monotone" dataKey="ma10" stroke="#10b981" dot={false} strokeWidth={1} name="MA10" />
            <Line type="monotone" dataKey="ma20" stroke="#ef4444" dot={false} strokeWidth={1} name="MA20" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* 成交量 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
        <h3 className="text-sm font-semibold mb-4">成交量</h3>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2d4a" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => v.slice(5)} />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => `${(v / 10000).toFixed(0)}万`} />
            <Tooltip
              contentStyle={{ background: "#1a2236", border: "1px solid #1e2d4a", borderRadius: "8px", fontSize: "12px" }}
              formatter={(value: number) => [`${(value / 10000).toFixed(0)}万`, "成交量"]}
            />
            <Bar
              dataKey="volume"
              name="成交量"
              fill="#3b82f680"
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* MACD 图 */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5">
        <h3 className="text-sm font-semibold mb-4">MACD 指标</h3>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2d4a" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => v.slice(5)} />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
            <Tooltip
              contentStyle={{ background: "#1a2236", border: "1px solid #1e2d4a", borderRadius: "8px", fontSize: "12px" }}
            />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="dif" stroke="#f59e0b" dot={false} strokeWidth={1.5} name="DIF" />
            <Line type="monotone" dataKey="dea" stroke="#3b82f6" dot={false} strokeWidth={1.5} name="DEA" />
            <Bar dataKey="macd" name="MACD柱" radius={[1, 1, 0, 0]}>
              {chartData.map((entry, index) => (
                <rect key={index} fill={entry.macd >= 0 ? "#ef444480" : "#10b98180"} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* 免责声明 */}
      <div className="rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] p-4">
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          ⚠️ <strong>免责声明：</strong>以上分析基于历史数据和技术指标的数学计算，仅供参考学习。
          技术分析存在局限性，无法预测突发事件、政策变化等影响。请勿以此作为实际投资依据，
          股市有风险，投资需谨慎。
        </p>
      </div>
    </div>
  );
}
