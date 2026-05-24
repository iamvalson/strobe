"use client";

import { useMemo } from "react";
import { CheckResult } from "./types";

interface SparklineProps {
  history: CheckResult[];
  width?: number;
  height?: number;
}

export default function Sparkline({ history, width = 80, height = 24 }: SparklineProps) {
  const { path, color } = useMemo(() => {
    if (history.length < 2) return { path: "", color: "var(--text-tertiary)" };

    const values = history.map((h) => h.rtt_ms);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;

    const step = width / (values.length - 1);
    const pad = 2;

    const points = values.map((v, i) => {
      const x = i * step;
      const y = pad + ((1 - (v - min) / range) * (height - pad * 2));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const d = `M ${points.join(" L ")}`;

    /* color based on last RTT */
    const last = values[values.length - 1];
    const c =
      last < 200
        ? "var(--green)"
        : last < 600
        ? "var(--yellow)"
        : "var(--red)";

    return { path: d, color: c };
  }, [history, width, height]);

  if (!path) {
    return (
      <svg width={width} height={height} aria-hidden>
        <line
          x1="0" y1={height / 2}
          x2={width} y2={height / 2}
          stroke="var(--border)"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} aria-label="RTT history sparkline">
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
    </svg>
  );
}
