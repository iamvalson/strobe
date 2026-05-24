"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import UptimeChart from "../../components/UptimeChart";
import { CheckRecord, CheckResult, DataPoint, Monitor } from "../../components/types";

/* ── Types ────────────────────────────────────────────────── */
type TimeRange = "5m" | "10m" | "1h" | "1d";
type Status = "up" | "down" | "pending";

const RANGES: { value: TimeRange; label: string }[] = [
  { value: "5m",  label: "5m"  },
  { value: "10m", label: "10m" },
  { value: "1h",  label: "1h"  },
  { value: "1d",  label: "1d"  },
];

// Computed lazily inside connectWS (always runs client-side after mount),
// so window is always defined and there is no SSR/client hydration mismatch.
function getWsUrl(): string {
  return process.env.NEXT_PUBLIC_WS_URL ?? `ws://${window.location.hostname}:8080/ws`;
}

/* ── Helpers ──────────────────────────────────────────────── */
function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return iso; }
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString([], {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return iso; }
}

function hostFromURL(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

function recordToPoint(r: CheckRecord): DataPoint {
  return {
    timestamp: new Date(r.created_at).getTime(),
    time: fmtTime(r.created_at),
    rtt: r.latency_ms,
    status: r.status_code,
    error: r.error_msg,
  };
}

/* ── Icons ────────────────────────────────────────────────── */
function IconArrowLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconExternal() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}
function IconWifi({ connected }: { connected: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"
        stroke={connected ? "var(--green)" : "var(--red)"}
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconRefresh({ spinning }: { spinning: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden
      style={{ animation: spinning ? "spin 0.7s linear infinite" : "none" }}>
      <path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconPlay() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <polygon points="5 3 19 12 5 21 5 3" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" fill="currentColor" />
    </svg>
  );
}
function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconAlert() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

/* ── Stat tile ────────────────────────────────────────────── */
function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      backgroundColor: "var(--bg-card)",
      border: "1px solid var(--border-subtle)",
      borderRadius: 12, padding: "16px 20px",
    }}>
      <p style={{ fontSize: 11, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
        {label}
      </p>
      <p style={{
        fontSize: 28, fontWeight: 700, letterSpacing: "-0.04em",
        color: color ?? "var(--text-primary)",
        fontVariantNumeric: "tabular-nums", lineHeight: 1,
      }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>{sub}</p>}
    </div>
  );
}

/* ── Uptime bar ───────────────────────────────────────────── */
function UptimeBar({ points }: { points: DataPoint[] }) {
  if (points.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 2, height: 28 }}>
      {points.map((p, i) => {
        const ok = !p.error && p.status >= 200 && p.status < 400;
        return (
          <div
            key={i}
            title={`${p.time} — ${ok ? `${p.rtt}ms` : p.error || `HTTP ${p.status}`}`}
            style={{
              flex: 1, borderRadius: 3,
              backgroundColor: ok ? "var(--green)" : "var(--red)",
              opacity: ok ? 0.7 : 0.95,
              cursor: "default",
              transition: "opacity 0.12s, transform 0.12s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "1";
              (e.currentTarget as HTMLElement).style.transform = "scaleY(1.1)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = ok ? "0.7" : "0.95";
              (e.currentTarget as HTMLElement).style.transform = "scaleY(1)";
            }}
          />
        );
      })}
    </div>
  );
}

/* ── Edit field ───────────────────────────────────────────── */
const inputStyle: React.CSSProperties = {
  backgroundColor: "var(--bg-base)",
  border: "1px solid var(--border)",
  borderRadius: 8, color: "var(--text-primary)",
  fontSize: 14, padding: "9px 12px",
  width: "100%", fontFamily: "inherit",
  outline: "none", transition: "border-color 0.15s",
};

/* ════════════════════════════════════════════════════════════
   Main component
   ════════════════════════════════════════════════════════════ */
export default function MonitorDetail({
  monitorId,
  initialMonitor,
}: {
  monitorId: string;
  initialMonitor: Monitor | null;
}) {
  const router = useRouter();

  /* ── State ─────────────────────────────────────────────── */
  const [monitor, setMonitor] = useState<Monitor | null>(initialMonitor);
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const [dbRecords, setDbRecords] = useState<CheckRecord[]>([]);
  const [livePoints, setLivePoints] = useState<{ point: DataPoint; ts: number }[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [wsLatest, setWsLatest] = useState<CheckResult | null>(null);
  const [status, setStatus] = useState<Status>("pending");
  const [loading, setLoading] = useState(true);

  /* Edit form */
  const [editURL, setEditURL] = useState(monitor?.url ?? "");
  const [editInterval, setEditInterval] = useState(monitor?.interval || "30s");
  const [editTimeout, setEditTimeout] = useState(monitor?.timeout || "10s");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* Re-enable */
  const [enabling, setEnabling] = useState(false);
  const [enableMsg, setEnableMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* Delete */
  const [deletePhase, setDeletePhase] = useState<"idle" | "confirm" | "deleting">("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  /* ── Fetch history ─────────────────────────────────────── */
  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/monitors/${encodeURIComponent(monitorId)}/history?since=${timeRange}`
      );
      const data: CheckRecord[] | null = await res.json();
      setDbRecords(data ?? []);
      setLivePoints([]); // reset live buffer on range change
    } catch {
      setDbRecords([]);
    } finally {
      setLoading(false);
    }
  }, [monitorId, timeRange]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  /* ── WebSocket ─────────────────────────────────────────── */
  const connectWS = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);

    ws.onmessage = (evt: MessageEvent) => {
      try {
        const result: CheckResult = JSON.parse(evt.data as string);
        if (result.monitor_id !== monitorId) return;

        const ts = Date.now();
        const point: DataPoint = {
          timestamp: ts,
          time: result.checked_at,
          rtt: result.rtt_ms,
          status: result.status_code,
          error: result.error,
        };

        setLivePoints((prev) => [...prev, { point, ts }]);
        setWsLatest(result);
        setStatus(
          !result.error && result.status_code >= 200 && result.status_code < 400
            ? "up"
            : "down"
        );

        // Backend just auto-disabled this monitor — flip the config immediately
        // so the disabled banner appears without requiring a page refresh.
        if (result.disabled) {
          setMonitor((prev) =>
            prev
              ? { ...prev, disabled: true, disabled_reason: result.disabled_reason ?? "" }
              : prev
          );
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setWsConnected(false);
      retryRef.current = setTimeout(connectWS, 3000);
    };
    ws.onerror = () => ws.close();
  }, [monitorId]);

  useEffect(() => {
    mountedRef.current = true;
    connectWS();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [connectWS]);

  /* ── Merged chart data ─────────────────────────────────── */
  const chartData = useMemo((): DataPoint[] => {
    const dbPoints = dbRecords.map(recordToPoint);
    const lastDbTs = dbPoints.length > 0 ? dbPoints[dbPoints.length - 1].timestamp : 0;

    // Trim live buffer to the selected time window
    const windowMs =
      timeRange === "5m"  ? 5  * 60_000 :
      timeRange === "10m" ? 10 * 60_000 :
      timeRange === "1h"  ? 3_600_000   :
                            86_400_000;
    const cutoff = Date.now() - windowMs;

    const newLive = livePoints
      .filter((l) => l.ts > lastDbTs && l.ts >= cutoff)
      .map((l) => l.point);

    return [...dbPoints, ...newLive];
  }, [dbRecords, livePoints, timeRange]);

  /* ── Stats (recalculated live on every WS tick) ────────── */
  const stats = useMemo(() => {
    if (chartData.length === 0) return null;
    const ok = chartData.filter((p) => !p.error && p.status >= 200 && p.status < 400);
    const uptime = ((ok.length / chartData.length) * 100);
    const rtts = ok.map((p) => p.rtt).filter(Boolean);
    const avg = rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : 0;
    const sorted = [...rtts].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    return {
      uptime: uptime.toFixed(uptime === 100 ? 0 : 2),
      avg,
      p95,
      total: chartData.length,
      downCount: chartData.length - ok.length,
    };
  }, [chartData]);

  /* ── Sync form when monitor updates ───────────────────── */
  useEffect(() => {
    if (!monitor) return;
    setEditURL(monitor.url);
    setEditInterval(monitor.interval || "30s");
    setEditTimeout(monitor.timeout || "10s");
  }, [monitor]);

  /* ── Save settings ─────────────────────────────────────── */
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMsg(null);
    try { new URL(editURL); } catch {
      setSaveMsg({ ok: false, text: "Please enter a valid URL." });
      return;
    }
    if (!/^\d+[smh]$/.test(editInterval.trim())) {
      setSaveMsg({ ok: false, text: "Interval must be like 30s, 1m, or 1h." });
      return;
    }
    if (!/^\d+[smh]$/.test(editTimeout.trim())) {
      setSaveMsg({ ok: false, text: "Timeout must be like 10s or 30s." });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/monitors/${encodeURIComponent(monitorId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: editURL.trim(), interval: editInterval.trim(), timeout: editTimeout.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated: Monitor = await res.json();
      setMonitor(updated);
      setSaveMsg({ ok: true, text: "Saved — monitor restarted with new settings." });
    } catch (err) {
      setSaveMsg({ ok: false, text: err instanceof Error ? err.message : "Save failed." });
    } finally {
      setSaving(false);
    }
  };

  /* ── Re-enable handler ──────────────────────────────────── */
  const handleEnable = async () => {
    setEnabling(true);
    setEnableMsg(null);
    try {
      const res = await fetch(`/api/monitors/${encodeURIComponent(monitorId)}/enable`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await res.text());
      const updated: Monitor = await res.json();
      setMonitor(updated);
      setEnableMsg({ ok: true, text: "Monitor re-enabled — probing has resumed." });
      // Refresh history now that it's active again
      fetchHistory();
    } catch (err) {
      setEnableMsg({ ok: false, text: err instanceof Error ? err.message : "Failed to enable monitor." });
    } finally {
      setEnabling(false);
    }
  };

  /* ── Delete handler ─────────────────────────────────────── */
  const handleDelete = async () => {
    setDeletePhase("deleting");
    setDeleteError(null);
    try {
      const res = await fetch(`/api/monitors/${encodeURIComponent(monitorId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      // Navigate home — the monitor no longer exists.
      router.push("/");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed.");
      setDeletePhase("confirm"); // stay on confirm so user sees the error
    }
  };

  /* ── Derived ─────────────────────────────────────────────── */
  const isDisabled = !!monitor?.disabled;

  /* ── Status colours ─────────────────────────────────────── */
  const statusColor =
    isDisabled ? "var(--text-tertiary)" :
    status === "up" ? "var(--green)" : status === "down" ? "var(--red)" : "var(--text-tertiary)";

  /* ════════════════════════════════════════════════════════
     Render
     ════════════════════════════════════════════════════════ */
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-base)" }}>

      {/* ── Sticky header ────────────────────────────────── */}
      <header style={{
        position: "sticky", top: 0, zIndex: 30,
        backgroundColor: "var(--bg-overlay)",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid var(--border-subtle)",
      }}>
        <div style={{
          maxWidth: 1100, margin: "0 auto", padding: "0 24px",
          height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <Link
            href="/"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 13, color: "var(--text-secondary)", textDecoration: "none",
              padding: "5px 10px", borderRadius: 8,
              backgroundColor: "var(--border-subtle)",
              transition: "background-color 0.15s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--border)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--border-subtle)")}
          >
            <IconArrowLeft />
            Monitors
          </Link>

          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
            strobe
          </span>

          <span style={{
            display: "flex", alignItems: "center", gap: 5, fontSize: 12,
            color: "var(--text-secondary)",
            padding: "4px 10px", borderRadius: 20,
            backgroundColor: "var(--border-subtle)",
          }}>
            <IconWifi connected={wsConnected} />
            {wsConnected ? "live" : "reconnecting…"}
          </span>
        </div>
      </header>

      {/* ── Page body ────────────────────────────────────── */}
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px 64px" }}>

        {/* ── Disabled banner ──────────────────────────── */}
        {isDisabled && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            backgroundColor: "color-mix(in srgb, var(--yellow) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--yellow) 30%, transparent)",
            borderRadius: 12, padding: "14px 18px",
            marginBottom: 24,
          }}>
            <span style={{ color: "var(--yellow)", flexShrink: 0, paddingTop: 1 }}>
              <IconAlert />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 3px" }}>
                Monitoring paused
              </p>
              {monitor?.disabled_reason && (
                <p style={{
                  fontSize: 12, color: "var(--text-secondary)", margin: "0 0 12px",
                  fontFamily: "var(--font-geist-mono)", wordBreak: "break-word",
                }}>
                  {monitor.disabled_reason}
                </p>
              )}
              {enableMsg && (
                <p style={{
                  fontSize: 12, marginBottom: 10,
                  color: enableMsg.ok ? "var(--green)" : "var(--red)",
                }}>
                  {enableMsg.text}
                </p>
              )}
              <button
                onClick={handleEnable}
                disabled={enabling}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "7px 16px", borderRadius: 8, border: "none",
                  backgroundColor: "var(--text-primary)", color: "var(--bg-card)",
                  fontSize: 12, fontWeight: 600, cursor: enabling ? "not-allowed" : "pointer",
                  opacity: enabling ? 0.6 : 1, transition: "opacity 0.15s",
                  fontFamily: "inherit",
                }}
                onMouseEnter={(e) => { if (!enabling) (e.currentTarget as HTMLElement).style.opacity = "0.82"; }}
                onMouseLeave={(e) => { if (!enabling) (e.currentTarget as HTMLElement).style.opacity = "1"; }}
              >
                <IconPlay />
                {enabling ? "Re-enabling…" : "Re-enable Monitor"}
              </button>
            </div>
          </div>
        )}

        {/* ── Monitor heading ──────────────────────────── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 28 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              {/* Live status dot */}
              <span style={{
                position: "relative", display: "inline-block",
                width: 10, height: 10, borderRadius: "50%",
                backgroundColor: statusColor, flexShrink: 0,
              }} />
              <h1 style={{
                fontSize: 24, fontWeight: 700, letterSpacing: "-0.03em",
                color: "var(--text-primary)", margin: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {monitor?.id ?? monitorId}
              </h1>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <a href={monitor?.url} target="_blank" rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 13, color: "var(--text-secondary)", textDecoration: "none",
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--blue)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-secondary)")}
              >
                {hostFromURL(monitor?.url ?? "")}
                <IconExternal />
              </a>
              {wsLatest && (
                <>
                  <span style={{ color: "var(--border)" }}>·</span>
                  <span style={{ fontSize: 12, color: wsLatest.status_code >= 400 ? "var(--red)" : "var(--green)", fontWeight: 500 }}>
                    HTTP {wsLatest.status_code}
                  </span>
                  <span style={{ color: "var(--border)" }}>·</span>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                    {wsLatest.rtt_ms}ms
                  </span>
                  <span style={{ color: "var(--border)" }}>·</span>
                  <span style={{ fontSize: 12, color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                    {wsLatest.checked_at}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Time range selector */}
          <div style={{
            display: "flex", gap: 2, flexShrink: 0,
            backgroundColor: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 10, padding: 3,
          }}>
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setTimeRange(r.value)}
                style={{
                  fontSize: 12, fontWeight: timeRange === r.value ? 600 : 400,
                  padding: "5px 14px", borderRadius: 7, border: "none",
                  cursor: "pointer", fontFamily: "inherit",
                  backgroundColor: timeRange === r.value ? "var(--text-primary)" : "transparent",
                  color: timeRange === r.value ? "var(--bg-card)" : "var(--text-secondary)",
                  transition: "background-color 0.15s, color 0.15s",
                }}
              >
                {r.label}
              </button>
            ))}
            <button
              onClick={fetchHistory}
              title="Refresh"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 30, borderRadius: 7, border: "none", cursor: "pointer",
                backgroundColor: "transparent", color: "var(--text-tertiary)",
                transition: "background-color 0.15s",
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--border-subtle)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")}
            >
              <IconRefresh spinning={loading} />
            </button>
          </div>
        </div>

        {/* ── Stats row ────────────────────────────────── */}
        <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
          <Stat
            label="Uptime"
            value={stats ? `${stats.uptime}%` : "—"}
            sub={stats ? `${stats.downCount} incident${stats.downCount !== 1 ? "s" : ""}` : undefined}
            color={
              !stats ? undefined :
              parseFloat(stats.uptime) >= 99 ? "var(--green)" :
              parseFloat(stats.uptime) >= 95 ? "var(--yellow)" :
              "var(--red)"
            }
          />
          <Stat
            label="Avg Response"
            value={stats ? `${stats.avg}ms` : "—"}
            sub="mean RTT"
          />
          <Stat
            label="P95 Response"
            value={stats ? `${stats.p95}ms` : "—"}
            sub="95th percentile"
          />
          <Stat
            label="Total Checks"
            value={stats ? (stats.total >= 1000 ? `${(stats.total / 1000).toFixed(1)}k` : String(stats.total)) : "—"}
            sub={`last ${timeRange}`}
          />
        </div>

        {/* ── Chart section ─────────────────────────────── */}
        <div style={{
          backgroundColor: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 14, padding: "24px 20px 16px",
          marginBottom: 16,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Response Time</p>
              <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                {loading ? "Loading…" : `${chartData.length} data points · last ${timeRange}`}
              </p>
            </div>
            {stats && (
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)" }}>
                <span>
                  <span style={{ color: "var(--green)", fontWeight: 500 }}>avg </span>
                  {stats.avg}ms
                </span>
                <span>
                  <span style={{ color: "var(--text-tertiary)", fontWeight: 500 }}>p95 </span>
                  {stats.p95}ms
                </span>
              </div>
            )}
          </div>
          <UptimeChart data={chartData} avgRtt={stats?.avg ?? 0} height={320} />
        </div>

        {/* ── Uptime history bar ────────────────────────── */}
        {chartData.length > 0 && (
          <div style={{
            backgroundColor: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 14, padding: "20px",
            marginBottom: 16,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
                Check History
              </p>
              <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                oldest → newest · {chartData.length} checks
              </p>
            </div>
            <UptimeBar points={chartData} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{chartData[0]?.time}</span>
              <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{chartData[chartData.length - 1]?.time}</span>
            </div>
          </div>
        )}

        {/* ── Recent checks table ───────────────────────── */}
        {chartData.length > 0 && (
          <div style={{
            backgroundColor: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 14, overflow: "hidden",
            marginBottom: 16,
          }}>
            <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
                Recent Checks
              </p>
            </div>
            {[...chartData].reverse().slice(0, 20).map((p, i) => {
              const ok = !p.error && p.status >= 200 && p.status < 400;
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 20px",
                  borderBottom: i < 19 ? "1px solid var(--border-subtle)" : "none",
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    backgroundColor: ok ? "var(--green)" : "var(--red)",
                  }} />
                  <span style={{ fontSize: 12, color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums", flexShrink: 0, minWidth: 80 }}>
                    {p.time}
                  </span>
                  <span style={{
                    fontSize: 12, color: ok ? "var(--text-primary)" : "var(--red)",
                    fontVariantNumeric: "tabular-nums", flex: 1,
                  }}>
                    {ok ? `${p.rtt}ms` : (p.error || `HTTP ${p.status}`)}
                  </span>
                  {p.status > 0 && (
                    <span style={{
                      fontSize: 11, fontWeight: 500, flexShrink: 0,
                      padding: "2px 8px", borderRadius: 5,
                      color: ok ? "var(--green)" : "var(--red)",
                      backgroundColor: ok ? "var(--green-bg)" : "var(--red-bg)",
                    }}>
                      {p.status}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Settings ──────────────────────────────────── */}
        <div style={{
          backgroundColor: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 14,
        }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>Settings</p>
            <p style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>Changes take effect immediately after saving.</p>
          </div>
          <form onSubmit={handleSave} style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 18 }}>

            {/* Read-only ID */}
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", alignItems: "start", gap: 16 }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", margin: 0 }}>Monitor ID</p>
                <p style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 3 }}>Cannot be changed</p>
              </div>
              <div style={{
                ...inputStyle, backgroundColor: "var(--border-subtle)",
                color: "var(--text-tertiary)", cursor: "not-allowed",
                fontFamily: "var(--font-geist-mono)", fontSize: 13,
              }}>
                {monitor?.id ?? monitorId}
              </div>
            </div>

            {/* URL */}
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", alignItems: "center", gap: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", margin: 0 }}>URL</p>
              <input
                type="url" value={editURL}
                onChange={(e) => setEditURL(e.target.value)}
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--blue)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                spellCheck={false} autoComplete="off"
              />
            </div>

            {/* Interval + Timeout */}
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr", alignItems: "center", gap: 16 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", margin: 0 }}>Interval / Timeout</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <input
                  type="text" value={editInterval} placeholder="30s"
                  onChange={(e) => setEditInterval(e.target.value)}
                  style={inputStyle}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--blue)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                />
                <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>e.g. 30s, 1m, 5m</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <input
                  type="text" value={editTimeout} placeholder="10s"
                  onChange={(e) => setEditTimeout(e.target.value)}
                  style={inputStyle}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--blue)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                />
                <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>e.g. 10s, 30s</span>
              </div>
            </div>

            {/* Feedback */}
            {saveMsg && (
              <div style={{
                padding: "10px 14px", borderRadius: 8, fontSize: 13,
                backgroundColor: saveMsg.ok ? "var(--green-bg)" : "var(--red-bg)",
                color: saveMsg.ok ? "var(--green)" : "var(--red)",
              }}>
                {saveMsg.text}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="submit" disabled={saving}
                style={{
                  padding: "9px 24px", borderRadius: 9, border: "none",
                  backgroundColor: "var(--blue)", color: "#fff",
                  fontSize: 13, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.6 : 1, transition: "opacity 0.15s",
                  fontFamily: "inherit",
                }}
                onMouseEnter={(e) => { if (!saving) (e.currentTarget as HTMLElement).style.opacity = "0.88"; }}
                onMouseLeave={(e) => { if (!saving) (e.currentTarget as HTMLElement).style.opacity = "1"; }}
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </form>

          {/* ── Danger zone ──────────────────────────────── */}
          <div style={{
            borderTop: "1px solid var(--border-subtle)",
            padding: "20px",
          }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--red)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Danger Zone
            </p>

            {deletePhase === "idle" && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", margin: "0 0 2px" }}>
                    Delete this monitor
                  </p>
                  <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: 0 }}>
                    Permanently removes the monitor and all its check history.
                  </p>
                </div>
                <button
                  onClick={() => { setDeletePhase("confirm"); setDeleteError(null); }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "8px 16px", borderRadius: 8, border: "1px solid var(--red)",
                    backgroundColor: "transparent", color: "var(--red)",
                    fontSize: 13, fontWeight: 500, cursor: "pointer",
                    fontFamily: "inherit", flexShrink: 0, transition: "background-color 0.15s",
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--red-bg)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")}
                >
                  <IconTrash />
                  Delete Monitor
                </button>
              </div>
            )}

            {(deletePhase === "confirm" || deletePhase === "deleting") && (
              <div style={{
                backgroundColor: "var(--red-bg)",
                border: "1px solid color-mix(in srgb, var(--red) 25%, transparent)",
                borderRadius: 10, padding: "16px",
              }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--red)", margin: "0 0 4px" }}>
                  Are you sure?
                </p>
                <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 14px" }}>
                  This will permanently delete <strong style={{ color: "var(--text-primary)" }}>{monitor?.id ?? monitorId}</strong> and all of its check history. This cannot be undone.
                </p>
                {deleteError && (
                  <p style={{ fontSize: 12, color: "var(--red)", margin: "0 0 12px" }}>{deleteError}</p>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={handleDelete}
                    disabled={deletePhase === "deleting"}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "8px 18px", borderRadius: 8, border: "none",
                      backgroundColor: "var(--red)", color: "#fff",
                      fontSize: 13, fontWeight: 600,
                      cursor: deletePhase === "deleting" ? "not-allowed" : "pointer",
                      opacity: deletePhase === "deleting" ? 0.6 : 1,
                      transition: "opacity 0.15s", fontFamily: "inherit",
                    }}
                    onMouseEnter={(e) => { if (deletePhase !== "deleting") (e.currentTarget as HTMLElement).style.opacity = "0.85"; }}
                    onMouseLeave={(e) => { if (deletePhase !== "deleting") (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                  >
                    <IconTrash />
                    {deletePhase === "deleting" ? "Deleting…" : "Yes, delete it"}
                  </button>
                  <button
                    onClick={() => { setDeletePhase("idle"); setDeleteError(null); }}
                    disabled={deletePhase === "deleting"}
                    style={{
                      padding: "8px 18px", borderRadius: 8,
                      border: "1px solid var(--border)",
                      backgroundColor: "var(--bg-card)", color: "var(--text-secondary)",
                      fontSize: 13, fontWeight: 500,
                      cursor: deletePhase === "deleting" ? "not-allowed" : "pointer",
                      fontFamily: "inherit", transition: "background-color 0.15s",
                    }}
                    onMouseEnter={(e) => { if (deletePhase !== "deleting") (e.currentTarget as HTMLElement).style.backgroundColor = "var(--border-subtle)"; }}
                    onMouseLeave={(e) => { if (deletePhase !== "deleting") (e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-card)"; }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
