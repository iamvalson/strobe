# Strobe

![Strobe Dashboard Banner](./assets/dashboard-demo.gif)

Strobe is a high-precision uptime monitoring engine built for real-time observability of HTTP endpoints. Designed around Go's concurrency primitives, it manages hundreds of simultaneous probes with a minimal memory footprint — streaming live telemetry to a Next.js dashboard over WebSocket the moment a result lands.

---

## Key Features

- **Concurrent Worker Pool** — A fixed-size pool of 10 goroutines drains a shared task channel, applying natural backpressure so the system never over-commits resources regardless of monitor count.
- **Dynamic Monitor Management** — Add, update, pause, or delete monitors via REST API at runtime. Changes take effect immediately — no restart required.
- **Real-Time Telemetry** — Probe results are broadcast over WebSocket the instant they arrive. The dashboard reflects status changes and RTT spikes without polling.
- **DNS Auto-Disable** — After 3 consecutive `no such host` failures, a monitor is automatically disabled, persisted to the database, and its goroutine is stopped. The WS broadcast carries the `disabled` flag so the UI flips to a "paused" state instantly — no extra round-trip needed.
- **Dual-Layer Persistence** — Historical check records are written to PostgreSQL for long-term analysis. Redis caches the latest result per monitor for fast reads.
- **Fault-Tolerant Lifecycle** — Every probe runs under `context.WithTimeout`. A global shutdown context propagates cancellation to all goroutines simultaneously, draining in-flight requests cleanly on `Ctrl+C`.

---

## System Architecture

Strobe follows a **pipeline architecture** where data flows in one direction through a chain of loosely coupled components:

```
REST API ──► controlChan ──► Dispatcher
                                  │
                        (per-monitor goroutine)
                                  │
                              taskChan
                                  │
                           Worker Pool (10 goroutines)
                                  │
                            probe.HTTP()
                                  │
                            resultChan
                                  │
                        main.go result loop
                       ┌──────────┴──────────┐
                     Store                WS Hub
                 (Postgres              (broadcast
                 + Redis)               to clients)
```

### Components

**Dispatcher** (`internal/dispatcher`)
Receives `MonitorConfig` values from `controlChan` and manages one goroutine per active monitor. Each goroutine ticks on the monitor's configured interval and enqueues a `Task` into the shared task channel. Sending a config with `Disabled: true` cancels that monitor's goroutine without restarting it — used by auto-disable, delete, and pause flows.

**Worker Pool** (`internal/worker`)
Ten goroutines block on the task channel. When a task arrives, the worker wraps the parent context with `context.WithTimeout` using the monitor's configured timeout, executes `probe.HTTP`, and forwards the result to `resultChan`. The fixed pool size bounds memory regardless of how many monitors are active.

**HTTP Prober** (`internal/probe`)
Issues a `GET` using `http.NewRequestWithContext` so the per-probe deadline is enforced at the transport level. Measures RTT with `time.Since` around the full round-trip. Returns a `Result` struct carrying `MonitorID`, `StatusCode`, `RTT`, `Error`, and optional `Disabled`/`DisabledReason` fields for inline state propagation.

**Result Loop** (`cmd/server/main.go`)
The single fan-in point. Receives every `probe.Result`, tracks consecutive DNS failures per monitor ID, triggers auto-disable when the threshold (`3`) is crossed, persists results to the store, and broadcasts to the WebSocket hub.

**Store** (`internal/store`)
Wraps `pgx/v5` (PostgreSQL) and `go-redis/v9`. Handles schema migrations on startup, full CRUD for monitors, check history writes, and Redis cache updates. Exposes typed sentinel errors (`ErrDuplicateURL`, `ErrDuplicateID`) so the API layer can return precise HTTP status codes.

**WebSocket Hub** (`internal/ws`)
A thread-safe broadcast center protected by a `sync.Mutex`. `Run()` fans each `probe.Result` out to every registered `*websocket.Conn` as JSON, normalising RTT to milliseconds and `CheckedAt` to a wall-clock string. Each connection gets a dedicated read goroutine (required by `gorilla/websocket`) that processes ping/pong control frames and detects client disconnects proactively — so dead connections are cleaned up without waiting for the next failed write.

**REST API** (`internal/api`)
Chi v5 router mounted at `/api`:

| Method   | Path                         | Description                        |
| -------- | ---------------------------- | ---------------------------------- |
| `GET`    | `/api/monitors`              | List all monitors                  |
| `POST`   | `/api/monitors`              | Create a monitor                   |
| `PATCH`  | `/api/monitors/{id}`         | Update URL / interval / timeout    |
| `DELETE` | `/api/monitors/{id}`         | Delete monitor and all its history |
| `POST`   | `/api/monitors/{id}/enable`  | Re-enable a disabled monitor       |
| `GET`    | `/api/monitors/{id}/history` | Fetch check history (`?since=1h`)  |

**Next.js Dashboard** (`ui/`)
Server-renders the initial monitor list, then hydrates into a live React state map driven by a single WebSocket connection per page. A `mountedRef` guard prevents React StrictMode's double-mount from opening duplicate connections. Includes a per-monitor detail page with RTT history sparkline, a settings panel, a re-enable banner for auto-disabled monitors, and a two-click delete confirmation flow.

---

## Tech Stack

| Layer        | Technology                                     |
| ------------ | ---------------------------------------------- |
| **Backend**  | Go 1.26, Chi v5, Gorilla WebSocket, pgx/v5     |
| **Frontend** | Next.js (App Router), TypeScript, Tailwind CSS |
| **Database** | PostgreSQL 16 (historical telemetry)           |
| **Cache**    | Redis 8.6 (last-known-status)                  |
| **Infra**    | Docker, Docker Compose                         |

---

## Getting Started

### Prerequisites

- Go 1.22+
- Node.js 22+ with NPM
- Docker & Docker Compose

### 1. Configure environment

```bash
# Backend
cp .env.example .env

# Frontend
cp ui/.env.example ui/.env.local
```

`.env` (backend):

```env
DATABASE_URL=postgres://user:password@localhost:5432/strobe?sslmode=disable
REDIS_URL=localhost:6379
PORT=8080
```

`ui/.env.local` (frontend):

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
```

### 2. Spin up infrastructure

```bash
make docker-up
```

Starts PostgreSQL 16 and Redis 8.6 via Docker Compose. Both services include health checks — the app won't start until they're ready.

### 3. Start the backend

```bash
make run
```

Runs database migrations, loads existing monitors from the DB, and starts the HTTP server on `:8080`.

### 4. Start the frontend

```bash
cd ui
npm install
npm run dev
```

Visit `http://localhost:3000`.

---

## API Reference

### Create a monitor

```bash
curl -X POST http://localhost:8080/api/monitors \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "interval": "30s", "timeout": "10s"}'
```

Defaults: `interval = 30s`, `timeout = 10s`. An `id` is auto-generated if omitted.

### Fetch check history

```bash
# Supported values: 5m, 10m, 1h, 1d
curl http://localhost:8080/api/monitors/{id}/history?since=1h
```

### Re-enable a disabled monitor

```bash
curl -X POST http://localhost:8080/api/monitors/{id}/enable
```

### Delete a monitor

```bash
curl -X DELETE http://localhost:8080/api/monitors/{id}
```

Returns `204 No Content`. Stops the probe goroutine immediately.

---

## Engineering Decisions

**`controlChan` as the single lifecycle gate**
Every mutation that affects a running monitor — create, update, delete, auto-disable, re-enable — sends a `MonitorConfig` to `controlChan`. The dispatcher is the only place that starts or cancels goroutines. This means the API layer, the DNS auto-disable logic, and the delete handler all converge on the same code path, making lifecycle bugs surface in one place rather than being scattered across handlers.

**`context.Context` throughout**
The global shutdown context flows from `main.go` into every worker's `context.WithTimeout`. A single `Ctrl+C` cancels every in-flight HTTP probe and every goroutine in the dispatcher simultaneously. No goroutine leaks, no zombie connections waiting to time out.

**`mountedRef` instead of state for WS guards**
React state writes are asynchronous — setting a flag in `useState` can't guarantee the new value is visible before the next render cycle. A `useRef` write is synchronous and immediate, so setting `mountedRef.current = false` as the _first_
**`mountedRef` instead of state for WS guards**
React state writes are asynchronous — setting a flag in `useState` can't guarantee the new value is visible before the next render cycle. A `useRef` write is synchronous and immediate, so setting `mountedRef.current = false` as the _first_ line of the cleanup function guarantees that any `onclose`-triggered reconnect that fires after unmount will see the flag and bail before opening a new connection. Using state here would race against the async close event.

**Disabled flag on the WS result**
When auto-disable triggers, the UI needs to flip the monitor card to "paused" immediately — before the next API poll. Stamping `Disabled: true` and `DisabledReason` onto the specific `probe.Result` that crosses the DNS failure threshold lets the dashboard update in the same tick the result is broadcast, with no extra HTTP round-trip.

**RTT precision**
RTT is captured internally in nanoseconds via `time.Since` and stored at full precision in PostgreSQL. The WebSocket hub normalises it to milliseconds (`.Milliseconds()`) before serialisation so the frontend always receives human-readable values without losing fidelity in the database.
