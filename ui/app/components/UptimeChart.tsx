"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Dot,
} from "recharts";
import { DataPoint } from "./types";

/* ── Custom tooltip ───────────────────────────────────────── */
interface TooltipProps {
  active?: boolean;
  payload?: { value: number; payload: DataPoint }[];
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const isDown = !!d.error || (d.status >= 400 || d.status === 0);

  return (
    <div
      style={{
        backgroundColor: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "10px 14px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
        minWidth: 160,
      }}
    >
      <p
        style={{
          fontSize: 11,
          color: "var(--text-tertiary)",
          marginBottom: 6,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {d.time}
      </p>

      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.03em",
            color: isDown
              ? "var(--red)"
              : d.rtt < 200
              ? "var(--green)"
              : d.rtt < 600
              ? "var(--yellow)"
              : "var(--red)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {d.rtt}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>ms</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: isDown ? "var(--red)" : "var(--green)",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: isDown ? "var(--red)" : "var(--text-primary)",
          }}
        >
          {d.status > 0 ? `HTTP ${d.status}` : "Error"}
        </span>
      </div>

      {d.error && (
        <p
          style={{
            fontSize: 11,
            color: "var(--red)",
            marginTop: 6,
            maxWidth: 200,
            lineHeight: 1.4,
            fontFamily: "var(--font-geist-mono)",
            wordBreak: "break-word",
          }}
        >
          {d.error.length > 80 ? d.error.slice(0, 80) + "…" : d.error}
        </p>
      )}
    </div>
  );
}

/* ── Custom dot — red for failures ───────────────────────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomDot(props: any) {
  const { cx, cy, payload } = props as { cx: number; cy: number; payload: DataPoint };
  const isDown = !!payload.error || payload.status === 0 || payload.status >= 400;
  if (!isDown) return null; // only render explicit failure dots
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill="var(--red)"
      stroke="var(--bg-card)"
      strokeWidth={2}
    />
  );
}

/* ── Main chart ───────────────────────────────────────────── */
interface UptimeChartProps {
  data: DataPoint[];
  avgRtt: number;
  height?: number;
}

export default function UptimeChart({ data, avgRtt, height = 200 }: UptimeChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height, color: "var(--text-tertiary)", fontSize: 13 }}
      >
        No data yet — checks will appear here as they come in.
      </div>
    );
  }

  const maxRtt = Math.max(...data.map((d) => d.rtt), 100);
  const yMax = Math.ceil((maxRtt * 1.25) / 50) * 50; // round up to nearest 50ms

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="rttGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--green)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--green)" stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid
          vertical={false}
          stroke="var(--border-subtle)"
          strokeDasharray="0"
        />

        <XAxis
          dataKey="time"
          tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={40}
        />

        <YAxis
          domain={[0, yMax]}
          tick={{ fontSize: 10, fill: "var(--text-tertiary)" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}ms`}
          width={58}
        />

        <Tooltip
          content={<CustomTooltip />}
          cursor={{
            stroke: "var(--border)",
            strokeWidth: 1,
            strokeDasharray: "4 2",
          }}
        />

        {avgRtt > 0 && (
          <ReferenceLine
            y={avgRtt}
            stroke="var(--text-tertiary)"
            strokeDasharray="4 2"
            strokeWidth={1}
            label={{
              value: `avg ${avgRtt}ms`,
              position: "insideTopRight",
              fontSize: 10,
              fill: "var(--text-tertiary)",
              dy: -4,
            }}
          />
        )}

        <Area
          type="monotone"
          dataKey="rtt"
          stroke="var(--green)"
          strokeWidth={1.5}
          fill="url(#rttGradient)"
          dot={<CustomDot />}
          activeDot={{
            r: 4,
            fill: "var(--green)",
            stroke: "var(--bg-card)",
            strokeWidth: 2,
          }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
