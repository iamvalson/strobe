export interface Monitor {
  id: string;
  url: string;
  interval: string;
  timeout: string;
  disabled?: boolean;
  disabled_reason?: string;
}

/** Real-time update pushed over WebSocket */
export interface CheckResult {
  monitor_id: string;
  url: string;
  status_code: number;
  rtt_ms: number;
  error: string;
  checked_at: string;
  /** Present and true only on the result that triggers an auto-disable. */
  disabled?: boolean;
  disabled_reason?: string;
}

/** Historical record returned by GET /api/monitors/:id/history */
export interface CheckRecord {
  id: number;
  monitor_id: string;
  url: string;
  status_code: number;
  latency_ms: number;
  error_msg: string;
  created_at: string; // ISO-8601
}

/** Normalised point used by the chart (from either source) */
export interface DataPoint {
  timestamp: number; // ms since epoch — used for x-axis sorting
  time: string;      // formatted label
  rtt: number;       // RTT in ms
  status: number;    // HTTP status code
  error: string;
}

export type MonitorStatus = "up" | "down" | "pending";

export interface MonitorState {
  config: Monitor;
  latest: CheckResult | null;
  history: CheckResult[];
  status: MonitorStatus;
}
