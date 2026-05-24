"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import MonitorCard from "./MonitorCard";
import AddMonitorModal from "./AddMonitorModal";
import { CheckResult, Monitor, MonitorState } from "./types";

/* ── Config ───────────────────────────────────────────────── */
// REST calls go through Next.js rewrites (/api/*) — no CORS issues.
// WS connects directly to the backend (not proxied by Next.js).
const API_BASE = "";   // relative — proxied by next.config.ts rewrites

// Computed lazily inside connectWS (always runs client-side after mount),
// so window is always defined and there is no SSR/client hydration mismatch.
function getWsUrl(): string {
  return process.env.NEXT_PUBLIC_WS_URL ?? `ws://${window.location.hostname}:8080/ws`;
}

const MAX_HISTORY = 24;

/* ── Icons ────────────────────────────────────────────────── */
function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconWifi({ connected }: { connected: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"
        stroke={connected ? "var(--green)" : "var(--red)"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Component ────────────────────────────────────────────── */
export default function Dashboard({ initialMonitors }: { initialMonitors: Monitor[] }) {
  const [monitors, setMonitors] = useState<Map<string, MonitorState>>(() => {
    const m = new Map<string, MonitorState>();
    (initialMonitors ?? []).forEach((cfg) =>
      m.set(cfg.id, { config: cfg, latest: null, history: [], status: "pending" })
    );
    return m;
  });

  const [wsConnected, setWsConnected] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  /* WebSocket */
  const connectWS = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const wsUrl = getWsUrl();

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);

    ws.onmessage = (evt: MessageEvent) => {
      try {
        const result: CheckResult = JSON.parse(evt.data as string);
        setMonitors((prev) => {
          const next = new Map(prev);
          const existing = next.get(result.monitor_id);
          if (!existing) return next;

          const history = [...existing.history, result].slice(-MAX_HISTORY);
          const isUp =
            !result.error &&
            result.status_code >= 200 &&
            result.status_code < 400;

          // If the backend just auto-disabled this monitor, propagate the
          // disabled flag into the config so the card flips to "paused" immediately.
          const config = result.disabled
            ? { ...existing.config, disabled: true, disabled_reason: result.disabled_reason ?? "" }
            : existing.config;

          next.set(result.monitor_id, {
            ...existing,
            config,
            latest: result,
            history,
            status: isUp ? "up" : "down",
          });
          return next;
        });
      } catch {
        /* ignore malformed messages */
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      retryRef.current = setTimeout(connectWS, 3000);
    };

    ws.onerror = () => ws.close();
  }, []);

  /* Fetch monitors from API (fills in any not in SSR snapshot) */
  useEffect(() => {
    fetch(`${API_BASE}/api/monitors`)
      .then((r) => r.json())
      .then((data: Monitor[] | null) => {
        setMonitors((prev) => {
          const next = new Map(prev);
          (data ?? []).forEach((cfg) => {
            if (!next.has(cfg.id)) {
              next.set(cfg.id, { config: cfg, latest: null, history: [], status: "pending" });
            }
          });
          return next;
        });
      })
      .catch(() => {});

    mountedRef.current = true;
    connectWS();

    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [connectWS]);

  /* Add monitor */
  const handleAdd = async (payload: Omit<Monitor, "id"> & { id?: string }) => {
    setAddError(null);
    const res = await fetch(`${API_BASE}/api/monitors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Server error ${res.status}`);
    }
    const created: Monitor = await res.json();
    setMonitors((prev) => {
      const next = new Map(prev);
      next.set(created.id, { config: created, latest: null, history: [], status: "pending" });
      return next;
    });
    setShowModal(false);
  };

  /* Stats */
  const list = Array.from(monitors.values());
  const upCount = list.filter((m) => m.status === "up").length;
  const downCount = list.filter((m) => m.status === "down").length;
  const pendingCount = list.filter((m) => m.status === "pending").length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ─────────────────────────────────────────── */}
      <header
        style={{
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          backgroundColor: "var(--bg-overlay)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
        className="sticky top-0 z-30"
      >
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <span
              className="text-base font-semibold tracking-tight"
              style={{ color: "var(--text-primary)", letterSpacing: "-0.02em" }}
            >
              strobe
            </span>
            <span
              className="hidden sm:flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full"
              style={{ color: "var(--text-secondary)", backgroundColor: "var(--border-subtle)" }}
            >
              <IconWifi connected={wsConnected} />
              <span>{wsConnected ? "live" : "reconnecting…"}</span>
            </span>
          </div>

          {/* Stats + CTA */}
          <div className="flex items-center gap-3">
            {list.length > 0 && (
              <div className="hidden sm:flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                {upCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--green)" }} />
                    {upCount} up
                  </span>
                )}
                {downCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--red)" }} />
                    {downCount} down
                  </span>
                )}
                {pendingCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--text-tertiary)" }} />
                    {pendingCount} pending
                  </span>
                )}
              </div>
            )}

            <button
              onClick={() => { setAddError(null); setShowModal(true); }}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all duration-150 cursor-pointer"
              style={{ backgroundColor: "var(--blue)", color: "#ffffff" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.88")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <IconPlus />
              Add Monitor
            </button>
          </div>
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────── */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-2"
              style={{ backgroundColor: "var(--border-subtle)" }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="3" stroke="var(--text-tertiary)" strokeWidth="2" />
                <path d="M6.34 6.34a8 8 0 0 0 0 11.32M17.66 6.34a8 8 0 0 1 0 11.32" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" />
                <path d="M3.51 3.51a13 13 0 0 0 0 16.98M20.49 3.51a13 13 0 0 1 0 16.98" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-base font-medium" style={{ color: "var(--text-primary)" }}>
              No monitors yet
            </p>
            <p className="text-sm text-center max-w-xs" style={{ color: "var(--text-secondary)" }}>
              Add your first monitor to start tracking uptime and response times in real time.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="mt-2 flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg transition-opacity cursor-pointer"
              style={{ backgroundColor: "var(--blue)", color: "#ffffff" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.88")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <IconPlus />
              Add your first monitor
            </button>
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((state) => (
              <Link
                key={state.config.id}
                href={`/monitors/${encodeURIComponent(state.config.id)}`}
                style={{ textDecoration: "none", display: "block" }}
              >
                <MonitorCard state={state} />
              </Link>
            ))}
          </div>
        )}
      </main>

      {/* ── Add Monitor Modal ───────────────────────────────── */}
      {showModal && (
        <AddMonitorModal
          onClose={() => setShowModal(false)}
          onAdd={handleAdd}
          error={addError}
        />
      )}
    </div>
  );
}
