"use client";

import { useEffect, useRef, useState } from "react";
import { Monitor } from "./types";

/* ── Types ────────────────────────────────────────────────── */
type Payload = Omit<Monitor, "id"> & { id?: string };

interface AddMonitorModalProps {
  onClose: () => void;
  onAdd: (payload: Payload) => Promise<void>;
  error?: string | null;
}

/* ── Icons ────────────────────────────────────────────────── */
function IconX() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M1 1l12 12M13 1L1 13"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ── Field ────────────────────────────────────────────────── */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  backgroundColor: "var(--bg-base)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--text-primary)",
  fontSize: "14px",
  padding: "8px 12px",
  outline: "none",
  width: "100%",
  fontFamily: "inherit",
  transition: "border-color 0.15s",
};

/* ── Modal ────────────────────────────────────────────────── */
export default function AddMonitorModal({ onClose, onAdd, error }: AddMonitorModalProps) {
  const [url, setUrl] = useState("");
  const [id, setId] = useState("");
  const [interval, setInterval] = useState("30s");
  const [timeout, setTimeout] = useState("10s");
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const urlInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  /* Auto-focus URL input */
  useEffect(() => {
    urlInputRef.current?.focus();
  }, []);

  /* Close on Escape */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  /* Basic URL validation */
  const validate = (): string | null => {
    if (!url.trim()) return "URL is required.";
    try {
      const parsed = new URL(url.trim());
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return "URL must use http or https.";
      }
    } catch {
      return "Please enter a valid URL (e.g. https://example.com).";
    }
    if (!/^\d+[smh]$/.test(interval.trim())) {
      return "Interval must be like 10s, 1m, or 1h.";
    }
    if (!/^\d+[smh]$/.test(timeout.trim())) {
      return "Timeout must be like 5s, 1m, or 1h.";
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    const err = validate();
    if (err) { setLocalError(err); return; }

    const payload: Payload = {
      url: url.trim(),
      interval: interval.trim(),
      timeout: timeout.trim(),
    };
    if (id.trim()) payload.id = id.trim();

    setSubmitting(true);
    try {
      await onAdd(payload);
    } catch (ex) {
      setLocalError(ex instanceof Error ? ex.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = localError || error;

  return (
    /* Backdrop */
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      {/* Card */}
      <div
        className="w-full max-w-sm flex flex-col rounded-[18px] overflow-hidden"
        style={{
          backgroundColor: "var(--bg-card)",
          border: "1px solid var(--border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25), 0 4px 16px rgba(0,0,0,0.12)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Add monitor"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div>
            <h2
              className="text-sm font-semibold"
              style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
            >
              Add Monitor
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
              Start tracking a new endpoint
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer"
            style={{ color: "var(--text-tertiary)", backgroundColor: "var(--border-subtle)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "var(--border)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "var(--border-subtle)")
            }
            aria-label="Close"
          >
            <IconX />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 py-5">
          <Field label="URL" hint="Must start with http:// or https://">
            <input
              ref={urlInputRef}
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--blue)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
              autoComplete="url"
              spellCheck={false}
            />
          </Field>

          <Field
            label="Monitor ID"
            hint="Optional — auto-generated if left blank"
          >
            <input
              type="text"
              placeholder="my-service"
              value={id}
              onChange={(e) => setId(e.target.value)}
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--blue)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Interval" hint="e.g. 30s, 1m">
              <input
                type="text"
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--blue)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
              />
            </Field>
            <Field label="Timeout" hint="e.g. 10s, 30s">
              <input
                type="text"
                value={timeout}
                onChange={(e) => setTimeout(e.target.value)}
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--blue)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
              />
            </Field>
          </div>

          {/* Error */}
          {displayError && (
            <div
              className="text-xs px-3 py-2.5 rounded-lg leading-snug"
              style={{ backgroundColor: "var(--red-bg)", color: "var(--red)" }}
            >
              {displayError}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 text-sm font-medium py-2.5 rounded-lg transition-colors cursor-pointer"
              style={{
                backgroundColor: "var(--border-subtle)",
                color: "var(--text-secondary)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--border)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--border-subtle)")
              }
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 text-sm font-medium py-2.5 rounded-lg transition-opacity cursor-pointer disabled:cursor-not-allowed"
              style={{
                backgroundColor: "var(--blue)",
                color: "#ffffff",
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting ? "Adding…" : "Add Monitor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
