"use client";

import type {
  TopicAnalyticsTopic,
  TopicTrendPoint,
} from "@/types/topic-analytics";

const COLORS = [
  "#059669",
  "#2563eb",
  "#f59e0b",
  "#8b5cf6",
  "#e11d48",
];

export default function TopicTrendChart({
  points,
  topics,
}: {
  points: TopicTrendPoint[];
  topics: TopicAnalyticsTopic[];
}) {
  const width = 760;
  const height = 250;
  const padding = { top: 20, right: 18, bottom: 42, left: 45 };
  const max = Math.max(
    0,
    ...points.flatMap((point) =>
      topics.map((topic) => point.values[topic.id] || 0)
    )
  );

  if (!topics.length || !max) {
    return (
      <div className="grid h-64 place-items-center rounded-2xl bg-slate-50 text-sm text-slate-400">
        در بازه انتخاب‌شده سؤال دسته‌بندی‌شده‌ای وجود ندارد.
      </div>
    );
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
      <div className="mb-3 flex flex-wrap gap-3 text-xs font-bold text-slate-600">
        {topics.map((topic, index) => (
          <span key={topic.id} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: COLORS[index] }} />
            {topic.path}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="روند سؤال‌ها بر اساس موضوع">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = max * ratio;
          const lineY = y(value);
          return (
            <g key={ratio}>
              <line x1={padding.left} x2={width - padding.right} y1={lineY} y2={lineY} stroke="#e2e8f0" />
              <text x={padding.left - 7} y={lineY + 4} textAnchor="end" fontSize="10" fill="#94a3b8">{Math.round(value).toLocaleString("fa-IR")}</text>
            </g>
          );
        })}
        {topics.map((topic, topicIndex) => {
          const color = COLORS[topicIndex];
          const line = points.map((point, index) => `${x(index)},${y(point.values[topic.id] || 0)}`).join(" ");
          return (
            <g key={topic.id}>
              <polyline points={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {points.map((point, index) => (
                <circle key={`${topic.id}-${point.key}`} cx={x(index)} cy={y(point.values[topic.id] || 0)} r="3" fill="white" stroke={color} strokeWidth="2">
                  <title>{`${point.label} — ${topic.path}: ${(point.values[topic.id] || 0).toLocaleString("fa-IR")}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {points.map((point, index) =>
          index % labelEvery === 0 || index === points.length - 1 ? (
            <text key={point.key} x={x(index)} y={height - 13} textAnchor="middle" fontSize="10" fill="#64748b">{point.label}</text>
          ) : null
        )}
      </svg>
    </div>
  );
}
