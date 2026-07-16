# ADR-0010: `kraken serve` — the GUI-Ready Projection Surface

| | |
|---|---|
| **Status** | **Accepted** (2026-07-05) — implemented, tested (HTTP + WS tail + traversal), live-verified over the flagship's real run history |
| **Date** | 2026-07-05 |
| **Deciders** | Claude (Fable 5), implementing ADR-0001 §7 Phase 5 / §5.12 (ratified 2026-07-02) |
| **Relates to** | ADR-0006 A3 (reporters are projections of the event stream) |

## Context

ADR-0001 promised a GUI could be added "with no core changes by construction": everything renderable is derivable from the event stream. Phase 5 cashes that promise as `kraken serve`.

## Decisions

### D1 — Serve the FILESYSTEM, not the runner

The server reads ONLY `.kraken/runs/<runId>/` — `events.jsonl` (written incrementally by the always-on JSONL reporter) plus artifact files. It holds no reference to the runner, the bus, or any live object; a run in progress is just a file that keeps growing. This is what makes the no-core-changes claim structural rather than aspirational — `kraken serve` works identically on runs that finished last week.

### D2 — Surface

- `GET /` — a minimal dependency-free built-in viewer (run list + live event feed): the seed for a future GUI, not the GUI.
- `GET /api/runs` — run index; status derived from the log (`runFinished` present → its status; events but no finish → `running`).
- `GET /api/runs/:id/events` — full log as JSON.
- `GET /api/runs/:id/artifacts/<path>` — artifact files; the resolved path MUST stay inside the run dir (traversal-tested).
- `WS /api/runs/:id/live` — replay-first, then live: exactly the signal-log semantics, applied to the event stream (offset-based file tail; `fs.watch` + a 500ms fallback poll because watch coalesces).

### D3 — Lifecycle

Binds `127.0.0.1` by default (it serves local artifacts — exposing it wider is an explicit `--host` choice). OS-assigned port by default. The CLI owns SIGINT and closes the server + WS clients cleanly (ADR-0005). `ws` (~8.18) is the one new dependency, CLI-only.

## Consequences

- A real GUI (React/whatever) can now be built entirely against `/api/*` without touching any Kraken package — the acceptance test for §5.12's architecture bet.
- Runs are served as-is from disk; there is no auth story (localhost tool). Revisit only if `--host` usage patterns demand it.
