"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UptimeChart from "./UptimeChart";
import { CheckRecord, DataPoint, Monitor, MonitorState } from "./types";

/* ── Helpers ──────────────────────────────────────────────── */
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function hostFromURL(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function recordsToDataPoints(records: CheckRecord[]): DataPoint[] {
  return records.map((r) => ({
    timestamp: new Date(r.created_at).getTime(),
    time: formatTime(r.created_at),
    rtt: r.latency_ms,
    status: r.status_code,
    error: r.error_msg,
  }));
}

/* ── Icons ────────────────────────────────────────────────── */
function IconX() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconExternalLink() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <polyline points="15 3 21 3 21 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconRefresh({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ animation: spinning ? "spin 0.8s linear infinite" : "none" }}
    >
      <path
        d="M23 4v6h-6M1 20v-6h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Stat tile ────────────────────────────────────────────── */
function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div
      style={{
        backgroundColor: "var(--bg-base)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 10,
        padding: "12px 14px",
        flex: 1,
        minWidth: 0,
      }}
    >
      <p style={{ fontSize: 10, color: "var(--text-tertiary)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </p>
      <p
        style={{
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: "-0.03em",
          color: color ?? "var(--text-primary)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {value}
      </p>
    </div>
  );
}

/* ── Uptime bar ───────────────────────────────────────────── */
function UptimeBar({ records }: { records: CheckRecord[] }) {
  if (records.length === 0) return null;
  const last = records.slice(-60);
  return (
    <div style={{ display: "flex", gap: 2, height: 20 }}>
      {last.map((r) => {
        const ok = !r.error_msg && r.status_code >= 200 && r.status_code < 400;
        return (
          <div
            key={r.id}
            title={`${formatDate(r.created_at)} — ${ok ? `${r.latency_ms}ms` : r.error_msg || `HTTP ${r.status_code}`}`}
            style={{
              flex: 1,
              borderRadius: 2,
              backgroundColor: ok ? "var(--green)" : "var(--red)",
              opacity: ok ? 0.75 : 0.9,
              cursor: "default",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = ok ? "0.75" : "0.9")}
          />
        );
      })}
    </div>
  );
}

/* ── Edit field ───────────────────────────────────────────── */
const fieldStyle: React.CSSProperties = {
  backgroundColor: "var(--bg-base)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-primary)",
  fontSize: 13,
  padding: "7px 10px",
  width: "100%",
  fontFamily: "inherit",
  outline: "none",
  transition: "border-color 0.15s",
};

/* ── Panel ────────────────────────────────────────────────── */
interface MonitorDetailPanelProps {
  state: MonitorState;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<Pick<Monitor, "url" | "interval" | "timeout">>) => Promise<Monitor>;
}

type Tab = "overview" | "settings";

export default function MonitorDetailPanel({
  state,
  onClose,
  onUpdate,
}: MonitorDetailPanelProps) {
  const { config, latest, history, status } = state;
  const [tab, setTab] = useState<Tab>("overview");

  /* ── History from DB ─────────────────────────────────────── */
  const [records, setRecords] = useState<CheckRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const fetchHistory = useCallback(() => {
    setLoadingHistory(true);
    fetch(`/api/monitors/${encodeURIComponent(config.id)}/history`)
      .then((r) => r.json())
      .then((data: CheckRecord[] | null) => setRecords(data ?? []))
      .catch(() => setRecords([]))
      .finally(() => setLoadingHistory(false));
  }, [config.id]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  /* Merge DB history + live WS data (deduplicate by rounded ms) */
  const chartData = useMemo((): DataPoint[] => {
    const dbPoints = recordsToDataPoints(records);
    const livePoints: DataPoint[] = history.map((h) => ({
      timestamp: Date.now(), // approximate — WS only gives HH:mm:ss
      time: h.checked_at,
      rtt: h.rtt_ms,
      status: h.status_code,
      error: h.error,
    }));

    // Use DB as base; append any live points newer than last DB record
    if (dbPoints.length === 0) return livePoints;
    return dbPoints; // DB is always up-to-date since ws results are persisted
  }, [records, history]);

  /* ── Stats ───────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const src = records.length > 0 ? records : [];
    if (src.length === 0) return null;
    const ok = src.filter((r) => !r.error_msg && r.status_code >= 200 && r.status_code < 400);
    const uptime = ((ok.length / src.length) * 100).toFixed(1);
    const rtts = ok.map((r) => r.latency_ms).filter(Boolean);
    const avg = rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : 0;
    const sorted = [...rtts].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    return { uptime, avg, p95, total: src.length };
  }, [records]);

  /* ── Edit form ───────────────────────────────────────────── */
  const [editURL, setEditURL] = useState(config.url);
  const [editInterval, setEditInterval] = useState(config.interval || "30s");
  const [editTimeout, setEditTimeout] = useState(config.timeout || "10s");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // Keep form in sync if config updates externally
  useEffect(() => {
    setEditURL(config.url);
    setEditInterval(config.interval || "30s");
    setEditTimeout(config.timeout || "10s");
  }, [config]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveOk(false);

    try {
      new URL(editURL);
    } catch {
      setSaveError("Please enter a valid URL.");
      return;
    }
    if (!/^\d+[smh]$/.test(editInterval.trim())) {
      setSaveError("Interval must be like 30s, 1m, or 1h.");
      return;
    }
    if (!/^\d+[smh]$/.test(editTimeout.trim())) {
      setSaveError("Timeout must be like 10s, 30s, or 1m.");
      return;
    }

    setSaving(true);
    try {
      await onUpdate(config.id, {
        url: editURL.trim(),
        interval: editInterval.trim(),
        timeout: editTimeout.trim(),
      });
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  /* ── Keyboard + mount animation ─────────────────────────── */
  const [visible, setVisible] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 260);
  };

  /* ── Status colours ──────────────────────────────────────── */
  const statusColor =
    status === "up" ? "var(--green)" : status === "down" ? "var(--red)" : "var(--text-tertiary)";

  /* ── Tab button ──────────────────────────────────────────── */
  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button
      onClick={() => setTab(id)}
      style={{
        fontSize: 13,
        fontWeight: tab === id ? 600 : 400,
        color: tab === id ? "var(--text-primary)" : "var(--text-secondary)",
        background: "none",
        border: "none",
        padding: "6px 0",
        cursor: "pointer",
        borderBottom: `2px solid ${tab === id ? "var(--text-primary)" : "transparent"}`,
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );

  return (
    /* ── Backdrop ──────────────────────────────────────────── */
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) handleClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        backgroundColor: visible ? "rgba(0,0,0,0.32)" : "rgba(0,0,0,0)",
        backdropFilter: visible ? "blur(3px)" : "blur(0px)",
        transition: "background-color 0.26s ease, backdrop-filter 0.26s ease",
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      {/* ── Panel ─────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Monitor details: ${config.id}`}
        style={{
          width: "100%",
          maxWidth: 480,
          height: "100%",
          backgroundColor: "var(--bg-card)",
          borderLeft: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transform: visible ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.26s cubic-bezier(0.32, 0.72, 0, 1)",
          willChange: "transform",
        }}
      >
        {/* ── Header ───────────────────────────────────────── */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-subtle)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              {/* Status + name */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: statusColor,
                    flexShrink: 0,
                  }}
                />
                <h2
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: "var(--text-primary)",
                    margin: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {config.id}
                </h2>
              </div>
              {/* URL */}
              <a
                href={config.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--blue)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-secondary)")}
              >
                {hostFromURL(config.url)}
                <IconExternalLink />
              </a>
            </div>

            {/* Close + refresh */}
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button
                onClick={fetchHistory}
                title="Refresh history"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 7,
                  border: "none",
                  backgroundColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  transition: "background-color 0.15s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--border)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--border-subtle)")}
              >
                <IconRefresh spinning={loadingHistory} />
              </button>
              <button
                onClick={handleClose}
                title="Close"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 7,
                  border: "none",
                  backgroundColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  transition: "background-color 0.15s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--border)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--border-subtle)")}
              >
                <IconX />
              </button>
            </div>
          </div>

          {/* Last check summary */}
          {latest && (
            <div
              style={{
                marginTop: 10,
                padding: "7px 10px",
                borderRadius: 8,
                backgroundColor: status === "up" ? "var(--green-bg)" : status === "down" ? "var(--red-bg)" : "var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
              }}
            >
              <span style={{ color: statusColor, fontWeight: 600 }}>
                {status === "up" ? "Operational" : status === "down" ? "Down" : "Checking…"}
              </span>
              {latest.rtt_ms > 0 && (
                <span style={{ color: "var(--text-secondary)" }}>· {latest.rtt_ms}ms</span>
              )}
              {latest.status_code > 0 && (
                <span style={{ color: "var(--text-secondary)" }}>· HTTP {latest.status_code}</span>
              )}
              <span style={{ marginLeft: "auto", color: "var(--text-tertiary)" }}>
                {latest.checked_at}
              </span>
            </div>
          )}
        </div>

        {/* ── Tabs ─────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            gap: 20,
            padding: "0 20px",
            borderBottom: "1px solid var(--border-subtle)",
            flexShrink: 0,
          }}
        >
          <TabBtn id="overview" label="Overview" />
          <TabBtn id="settings" label="Settings" />
        </div>

        {/* ── Scrollable body ───────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>

          {/* ======= OVERVIEW TAB ======= */}
          {tab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

              {/* Stats row */}
              {stats ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <Stat
                    label="Uptime"
                    value={`${stats.uptime}%`}
                    color={parseFloat(stats.uptime) >= 99 ? "var(--green)" : parseFloat(stats.uptime) >= 95 ? "var(--yellow)" : "var(--red)"}
                  />
                  <Stat label="Avg RTT" value={`${stats.avg}ms`} />
                  <Stat label="P95 RTT" value={`${stats.p95}ms`} />
                  <Stat label="Checks" value={stats.total >= 1000 ? `${(stats.total / 1000).toFixed(1)}k` : String(stats.total)} />
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        height: 62,
                        borderRadius: 10,
                        backgroundColor: "var(--border-subtle)",
                        animation: "pulse 1.5s ease-in-out infinite",
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Uptime bar */}
              {records.length > 0 && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>
                      Last {Math.min(records.length, 60)} checks
                    </p>
                    <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                      oldest → newest
                    </p>
                  </div>
                  <UptimeBar records={records} />
                </div>
              )}

              {/* Chart */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>
                    Response Time
                  </p>
                  <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                    {chartData.length} data points
                  </p>
                </div>
                <UptimeChart data={chartData} avgRtt={stats?.avg ?? 0} />
              </div>

              {/* Recent checks table */}
              {records.length > 0 && (
                <div>
                  <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 10 }}>
                    Recent Checks
                  </p>
                  <div
                    style={{
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 10,
                      overflow: "hidden",
                    }}
                  >
                    {records.slice(-10).reverse().map((r, i) => {
                      const ok = !r.error_msg && r.status_code >= 200 && r.status_code < 400;
                      return (
                        <div
                          key={r.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "9px 12px",
                            borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none",
                            fontSize: 12,
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              backgroundColor: ok ? "var(--green)" : "var(--red)",
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                            {formatTime(r.created_at)}
                          </span>
                          <span
                            style={{
                              marginLeft: "auto",
                              fontVariantNumeric: "tabular-nums",
                              color: ok ? "var(--text-primary)" : "var(--red)",
                              fontWeight: 500,
                            }}
                          >
                            {ok ? `${r.latency_ms}ms` : r.error_msg || `HTTP ${r.status_code}`}
                          </span>
                          {r.status_code > 0 && (
                            <span
                              style={{
                                fontSize: 11,
                                color: ok ? "var(--green)" : "var(--red)",
                                backgroundColor: ok ? "var(--green-bg)" : "var(--red-bg)",
                                padding: "2px 6px",
                                borderRadius: 4,
                                fontWeight: 500,
                                flexShrink: 0,
                              }}
                            >
                              {r.status_code}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ======= SETTINGS TAB ======= */}
          {tab === "settings" && (
            <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 20 }}>

              {/* Read-only ID */}
              <div>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>
                    Monitor ID
                  </span>
                  <div
                    style={{
                      ...fieldStyle,
                      backgroundColor: "var(--border-subtle)",
                      color: "var(--text-tertiary)",
                      cursor: "not-allowed",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {config.id}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                    ID cannot be changed — it is the monitor&apos;s primary key.
                  </span>
                </label>
              </div>

              {/* URL */}
              <div>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>URL</span>
                  <input
                    type="url"
                    value={editURL}
                    onChange={(e) => setEditURL(e.target.value)}
                    style={fieldStyle}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "var(--blue)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>
              </div>

              {/* Interval + Timeout */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>Check Interval</span>
                  <input
                    type="text"
                    value={editInterval}
                    onChange={(e) => setEditInterval(e.target.value)}
                    placeholder="30s"
                    style={fieldStyle}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "var(--blue)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                  />
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>e.g. 30s, 1m, 5m</span>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>Timeout</span>
                  <input
                    type="text"
                    value={editTimeout}
                    onChange={(e) => setEditTimeout(e.target.value)}
                    placeholder="10s"
                    style={fieldStyle}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "var(--blue)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                  />
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>e.g. 10s, 30s</span>
                </label>
              </div>

              {/* Error / success */}
              {saveError && (
                <div
                  style={{
                    padding: "9px 12px",
                    borderRadius: 8,
                    backgroundColor: "var(--red-bg)",
                    color: "var(--red)",
                    fontSize: 12,
                  }}
                >
                  {saveError}
                </div>
              )}
              {saveOk && (
                <div
                  style={{
                    padding: "9px 12px",
                    borderRadius: 8,
                    backgroundColor: "var(--green-bg)",
                    color: "var(--green)",
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  ✓ Changes saved — monitor restarted with new settings.
                </div>
              )}

              {/* Save button */}
              <button
                type="submit"
                disabled={saving}
                style={{
                  padding: "9px 0",
                  borderRadius: 9,
                  border: "none",
                  backgroundColor: "var(--blue)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.6 : 1,
                  transition: "opacity 0.15s",
                  fontFamily: "inherit",
                }}
                onMouseEnter={(e) => { if (!saving) (e.currentTarget as HTMLElement).style.opacity = "0.88"; }}
                onMouseLeave={(e) => { if (!saving) (e.currentTarget as HTMLElement).style.opacity = "1"; }}
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>

              {/* Config metadata */}
              <div
                style={{
                  marginTop: 8,
                  padding: "12px 14px",
                  borderRadius: 10,
                  backgroundColor: "var(--bg-base)",
                  border: "1px solid var(--border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <p style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Current Config
                </p>
                {[
                  ["ID", config.id],
                  ["URL", config.url],
                  ["Interval", config.interval],
                  ["Timeout", config.timeout],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{k}</span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-primary)",
                        fontFamily: k === "URL" || k === "ID" ? "var(--font-geist-mono)" : "inherit",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "60%",
                        textAlign: "right",
                      }}
                    >
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
