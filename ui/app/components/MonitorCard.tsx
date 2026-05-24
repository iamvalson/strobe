"use client";

import Sparkline from "./Sparkline";
import { MonitorState } from "./types";

/* ── Icon ─────────────────────────────────────────────────── */
function IconChevronRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 18l6-6-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Helpers ──────────────────────────────────────────────── */
function formatRTT(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function rttColor(ms: number): string {
  if (ms < 200) return "var(--green)";
  if (ms < 600) return "var(--yellow)";
  return "var(--red)";
}

function statusCodeColor(code: number): string {
  if (code >= 200 && code < 300) return "var(--green)";
  if (code >= 300 && code < 400) return "var(--blue)";
  if (code >= 400 && code < 500) return "var(--yellow)";
  return "var(--red)";
}

function statusCodeLabel(code: number): string {
  const labels: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    429: "Too Many Requests",
    500: "Internal Error",
    502: "Bad Gateway",
    503: "Unavailable",
    504: "Timeout",
  };
  return labels[code] ?? "";
}

function hostFromURL(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/* ── Status dot ───────────────────────────────────────────── */
function StatusDot({ status }: { status: "up" | "down" | "pending" }) {
  if (status === "pending") {
    return (
      <span
        className="relative inline-block w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: "var(--text-tertiary)" }}
        aria-label="Pending"
      />
    );
  }

  const color = status === "up" ? "var(--green)" : "var(--red)";
  const pulseClass =
    status === "up" ? "status-pulse-green" : "status-pulse-red";

  return (
    <span
      className={`relative inline-block w-2.5 h-2.5 rounded-full status-pulse ${pulseClass}`}
      style={{ backgroundColor: color }}
      aria-label={status === "up" ? "Up" : "Down"}
    />
  );
}

/* ── Paused icon (for disabled monitors) ──────────────────── */
function IconPause() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" />
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
    </svg>
  );
}

/* ── Badge ────────────────────────────────────────────────── */
function Badge({
  children,
  color,
  bg,
}: {
  children: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-md"
      style={{ color, backgroundColor: bg, fontVariantNumeric: "tabular-nums" }}
    >
      {children}
    </span>
  );
}

/* ── Card ─────────────────────────────────────────────────── */
export default function MonitorCard({ state }: { state: MonitorState }) {
  const onClick = undefined;
  const isSelected = false;
  const { config, latest, history, status } = state;
  const host = hostFromURL(config.url);
  const isDisabled = !!config.disabled;

  return (
    <article
      className="relative flex flex-col gap-4 p-5 rounded-[14px] transition-all duration-200 group"
      onClick={onClick}
      style={{
        backgroundColor: "var(--bg-card)",
        border: `1px solid ${isDisabled ? "var(--border-subtle)" : isSelected ? "var(--blue)" : "var(--border)"}`,
        boxShadow: isSelected
          ? "0 0 0 3px color-mix(in srgb, var(--blue) 15%, transparent)"
          : "var(--shadow-card)",
        cursor: "pointer",
        opacity: isDisabled ? 0.65 : 1,
      }}
      onMouseEnter={(e) => {
        if (isSelected || isDisabled) return;
        (e.currentTarget as HTMLElement).style.boxShadow =
          "var(--shadow-card-hover)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
      }}
      onMouseLeave={(e) => {
        if (isSelected || isDisabled) return;
        (e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-card)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
      }}
    >
      {/* ── Top row: status + ID + badge ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {isDisabled ? (
            <span
              className="relative inline-flex items-center justify-center w-2.5 h-2.5 rounded-full"
              style={{ color: "var(--text-tertiary)" }}
              aria-label="Disabled"
            >
              <IconPause />
            </span>
          ) : (
            <StatusDot status={status} />
          )}
          <div className="min-w-0">
            <p
              className="text-sm font-semibold truncate leading-tight"
              style={{
                color: isDisabled
                  ? "var(--text-tertiary)"
                  : "var(--text-primary)",
                letterSpacing: "-0.01em",
              }}
              title={config.id}
            >
              {config.id}
            </p>
            <p
              className="text-xs truncate mt-0.5"
              style={{ color: "var(--text-tertiary)" }}
              title={config.url}
            >
              {host}
            </p>
          </div>
        </div>

        {/* Badge: disabled pill or status code */}
        {isDisabled ? (
          <span
            className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-md"
            style={{
              color: "var(--text-tertiary)",
              backgroundColor: "var(--border-subtle)",
            }}
          >
            paused
          </span>
        ) : latest && latest.status_code > 0 ? (
          <Badge
            color={statusCodeColor(latest.status_code)}
            bg={
              latest.status_code < 300
                ? "var(--green-bg)"
                : latest.status_code < 400
                  ? "var(--blue-bg)"
                  : latest.status_code < 500
                    ? "var(--yellow-bg)"
                    : "var(--red-bg)"
            }
          >
            {latest.status_code}
            {statusCodeLabel(latest.status_code)
              ? ` ${statusCodeLabel(latest.status_code)}`
              : ""}
          </Badge>
        ) : !latest ? (
          <span
            className="text-xs px-1.5 py-0.5 rounded-md"
            style={{
              color: "var(--text-tertiary)",
              backgroundColor: "var(--border-subtle)",
            }}
          >
            waiting…
          </span>
        ) : null}
      </div>

      {/* ── Body: disabled reason or live metrics ── */}
      {isDisabled ? (
        <div
          className="text-xs px-3 py-2 rounded-lg leading-snug"
          style={{
            backgroundColor: "var(--border-subtle)",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-geist-mono)",
          }}
        >
          {config.disabled_reason
            ? config.disabled_reason.length > 72
              ? config.disabled_reason.slice(0, 72) + "…"
              : config.disabled_reason
            : "Monitoring paused"}
        </div>
      ) : latest && !latest.error ? (
        <div className="flex items-end justify-between gap-3">
          <div>
            <p
              className="text-2xl font-semibold tabular-nums leading-none"
              style={{
                color: rttColor(latest.rtt_ms),
                letterSpacing: "-0.03em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatRTT(latest.rtt_ms)}
            </p>
            <p
              className="text-xs mt-1"
              style={{ color: "var(--text-tertiary)" }}
            >
              {latest.checked_at}
            </p>
          </div>
          <Sparkline history={history} width={80} height={28} />
        </div>
      ) : latest?.error ? (
        <div
          className="text-xs px-3 py-2 rounded-lg leading-snug"
          style={{
            backgroundColor: "var(--red-bg)",
            color: "var(--red)",
            fontFamily: "var(--font-geist-mono)",
          }}
        >
          {latest.error.length > 60
            ? latest.error.slice(0, 60) + "…"
            : latest.error}
        </div>
      ) : (
        /* Skeleton shimmer while pending */
        <div className="flex flex-col gap-1.5 animate-pulse">
          <div
            className="h-7 w-20 rounded-md"
            style={{ backgroundColor: "var(--border-subtle)" }}
          />
          <div
            className="h-3 w-14 rounded-md"
            style={{ backgroundColor: "var(--border-subtle)" }}
          />
        </div>
      )}

      {/* ── Footer: interval info + chevron ── */}
      <div
        className="flex items-center gap-3 pt-3 text-xs"
        style={{
          borderTop: "1px solid var(--border-subtle)",
          color: "var(--text-tertiary)",
        }}
      >
        <span>every {config.interval || "—"}</span>
        <span>·</span>
        <span>timeout {config.timeout || "—"}</span>
        {isDisabled && (
          <span
            className="ml-auto text-xs"
            style={{ color: "var(--text-tertiary)" }}
          >
            re-enable in settings →
          </span>
        )}
        {!isDisabled && onClick && (
          <span
            className="ml-auto"
            style={{
              color: isSelected ? "var(--blue)" : "var(--text-tertiary)",
            }}
          >
            <IconChevronRight />
          </span>
        )}
      </div>
    </article>
  );
}
