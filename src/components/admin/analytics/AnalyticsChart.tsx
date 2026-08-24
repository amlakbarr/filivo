"use client";

import type { AnalyticsPoint } from "@/types/analytics";

type Series = {
  key: keyof AnalyticsPoint;
  label: string;
  color: string;
  format?: (value: number) => string;
};

export default function AnalyticsChart({
  points,
  series,
  emptyMessage = "هنوز داده‌ای برای این بازه وجود ندارد.",
}: {
  points: AnalyticsPoint[];
  series: Series[];
  emptyMessage?: string;
}) {
  const width = 760;
  const height = 250;
  const padding = { top: 20, right: 18, bottom: 42, left: 52 };
  const values = points.flatMap((point) =>
    series.map((item) => numeric(point[item.key]))
  );
  const max = Math.max(...values, 0);

  if (points.length === 0 || max === 0) {
    return <div className="grid h-64 place-items-center rounded-2xl bg-slate-50 text-center text-sm text-slate-400">{emptyMessage}</div>;
  }

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const x = (index: number) =>
    padding.left +
    (points.length === 1
      ? chartWidth / 2
      : (index / (points.length - 1)) * chartWidth);
  const y = (value: number) =>
    padding.top + chartHeight - (value / max) * chartHeight;
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs font-bold text-slate-600">
        {series.map((item) => <span key={String(item.key)} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={series.map((item) => item.label).join("، ")}>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = max * ratio;
          const lineY = y(value);
          return <g key={ratio}><line x1={padding.left} x2={width - padding.right} y1={lineY} y2={lineY} stroke="#e2e8f0" strokeWidth="1" /><text x={padding.left - 8} y={lineY + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{compact(value)}</text></g>;
        })}
        {series.length === 1 && <polygon points={`${x(0)},${y(0)} ${points.map((point, index) => `${x(index)},${y(numeric(point[series[0].key]))}`).join(" ")} ${x(points.length - 1)},${y(0)}`} fill={series[0].color} opacity="0.09" />}
        {series.map((item) => {
          const line = points.map((point, index) => `${x(index)},${y(numeric(point[item.key]))}`).join(" ");
          return <g key={String(item.key)}><polyline points={line} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />{points.map((point, index) => { const value = numeric(point[item.key]); return <circle key={`${point.key}-${String(item.key)}`} cx={x(index)} cy={y(value)} r="3.5" fill="white" stroke={item.color} strokeWidth="2"><title>{`${point.label} — ${item.label}: ${item.format ? item.format(value) : compact(value)}${item.key === "outputTokens" ? ` — Reasoning: ${compact(point.reasoningTokens)}` : ""}`}</title></circle>; })}</g>;
        })}
        {points.map((point, index) => index % labelEvery === 0 || index === points.length - 1 ? <text key={point.key} x={x(index)} y={height - 13} textAnchor="middle" fontSize="10" fill="#64748b">{point.label}</text> : null)}
      </svg>
    </div>
  );
}

function numeric(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0; }
function compact(value: number) { return new Intl.NumberFormat("fa-IR", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: value < 10 ? 2 : 0 }).format(value); }
