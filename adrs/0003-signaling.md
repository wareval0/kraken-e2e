# ADR-0003: Signaling Semantics and Transports

| | |
|---|---|
| **Status** | **Accepted** (2026-07-03) — implemented in @kraken/signaling; conformance suite run against InMemoryTransport and ChaosTransport. *Post-verification notes (2026-07-03): the misuse error class ships as `SignalUsageError` (un-prefixed, consistent with the other classes); `SignalWaitAbortedError` joins the D4 taxonomy (abort cancellations); `barrier()` is bus-facade sugar; D7 gains invariant 13 (timeout errors carry the history snapshot + near-miss names — a transport obligation exercised by the suite); and cursors are keyed per (subscriber, name, from-filter) channel — a from-filtered wait never advances past other senders' records.* |
| **Date** | 2026-07-03 |
| **Deciders** | Claude (Fable 5), implementing ADR-0001 §5.7 (ratified 2026-07-02) |
| **Relates to** | ADR-0001 §5.7 (signal log), §5.6/D4 (Kraken-owned signal store), §9.2 (deferred signal questions) |

## Context

ADR-0001 fixed the signaling model: a **scoped append-only signal log with per-subscriber cursors** in a standalone `@kraken/signaling` package, with an in-memory transport now and Redis Streams (node-redis) later, plus a shipped conformance suite so every transport behaves identically. This ADR fixes the remaining semantics precisely enough to implement, and resolves the questions ADR-0001 §9.2 assigned here.

The failure mode this design exists to kill: in Kraken v2, a signal published before the receiver started waiting was silently lost (ephemeral pub/sub), producing timeout-flakiness that was indistinguishable from app bugs.

## Decisions

### D1 — Package layering

`@kraken/signaling` has **zero runtime dependencies** and no imports from any other `@kraken/*` package. Public surface:

- Main entry: types (`SignalPayload`, `SignalScope`, `SignalRecord`), the `SignalTransport` SPI, the `SignalBus` facade, `InMemoryTransport`, `ChaosTransport`, and the error classes.
- `@kraken/signaling/conformance`: `describeSignalTransportContract(name, makeTransport)` — a vitest-based suite (vitest is an optional peerDependency used only by this subpath).

### D2 — The transport SPI (dumb log; intelligence lives in the bus)

```ts
interface SignalTransport {
  createScope(scope: SignalScope): Promise<void>;
  /** Acknowledged append. Resolves once durably ordered. MUST NOT resolve synchronously. */
  publish(scope, signal: { name; from; payload }): Promise<SignalRecord>;
  /** Earliest record with `name` (and `from` if given) whose seq > afterSeq.
   *  Replays history first, then waits live. Never hangs past timeoutMs. */
  waitFor(scope, query: { name; afterSeq; from? }, opts: { timeoutMs; signal? }): Promise<SignalRecord>;
  history(scope): Promise<readonly SignalRecord[]>;
  /** Idempotent. Rejects all pending waiters with ScopeClosedError; frees retention. */
  destroyScope(scope): Promise<void>;
  ping(): Promise<void>;
}
```

Transports know nothing about subscribers, cursors, or predicates — those live in `SignalBus`. This keeps the Redis Streams mapping 1:1 (`XADD` / `XRANGE` / `XREAD BLOCK`) and makes third-party transports small.

`SignalRecord = { seq, name, from, payload, publishedAt }`. `seq` is strictly increasing per scope, assigned by the transport's single sequencer; `publishedAt` is diagnostic only, never used for ordering.

### D3 — Subscriber identity and delivery semantics (the load-bearing definitions)

- Cursors are keyed by **(subscriberId, signalName)** and live in the bus. `subscriberId` defaults to the actor id (`scoped.forActor('bob')` binds it).
- **Broadcast**: distinct subscribers each independently receive the same record — delivery never deletes.
- **FIFO counting**: successive `waitFor` calls by the same subscriber on the same name consume successive records in seq order.
- **Replay-first**: a `waitFor` whose match already exists in the log resolves with it (after a microtask) — publish-before-wait is *defined away*.
- **Concurrent same-subscriber waits on the same name** (ADR-0001 §9.2 question): **rejected at the bus with `KrakenSignalUsageError`**. Rationale: any assignment of records to N concurrent identical waits is arbitrary and racy; the legitimate use cases are covered by sequential waits (counting) or distinct subscribers (broadcast). Simple, deterministic, and it converts an ambiguity into an error message. Revisit only with a concrete scenario in hand.
- **`where` predicates** (client-side payload filters): a predicate-rejected record is **permanently consumed** for that (subscriber, name) cursor — deterministic and documented (the alternative, non-consuming peek bookkeeping, is complexity without a demonstrated need). A `peek` variant is explicitly NOT offered in v1.

### D4 — Timeouts and failure diagnostics

- Timeouts are always **waiter-local** wall clock; transport latency counts against them; no server-side timeout variants (identical locus on every transport).
- `SignalTimeoutError.detail` carries: scope, subscriberId, signal name, timeoutMs, cursor position, the **full in-scope history snapshot**, and **near-miss name suggestions** (Levenshtein distance ≤ 2 against names seen in the scope). A timeout stops being "flaky" and becomes "bob waited for `mesage-sent`; alice published `message-sent` at seq 4".
- Timeout policy (ADR-0001 §9.2): **the bus API requires an explicit `timeoutMs` — there is no library-level default.** Defaults belong to the layers above (the Gherkin wait step carries its duration in the step text; config may define a project default for step-level waits in ADR-0004's scope). The library stays policy-free.
- Error taxonomy: `SignalTimeoutError` (test-level failure), `ScopeClosedError` (use after destroy — never hangs), `TransportUnavailableError` (infrastructure failure, surfaced immediately to pending waiters; the orchestrator classifies it as infra, not test failure), `SignalPayloadError` (non-JSON-serializable or over the size cap), `KrakenSignalUsageError` (API misuse, e.g. concurrent identical waits).

### D5 — Payload discipline

Every transport (including in-memory) round-trips payloads through JSON (`JSON.parse(JSON.stringify(...))`) so shared-mutable-reference bugs and non-serializable payloads (functions, session handles, circular refs) fail identically on day one — not on farm-migration day. The bus enforces a size cap (default **64 KiB** of serialized payload, configurable) with `SignalPayloadError`.

### D6 — Scoping and lifecycle

Scope = `{ runId, scenarioId }`, key `` `${runId}/${scenarioId}` ``; `scenarioId` is unique per scenario *instance* (each Examples row gets its own). Cross-scenario signals remain unsupported (ADR-0001 §5.17). `destroyScope` is idempotent; publish/waitFor after destroy reject with `ScopeClosedError`. Retention = scope lifetime; the bus warns (once) past a per-scope record-count threshold (default 10 000) to surface pathological loops.

### D7 — Conformance suite invariants (each one is a test)

1. Publish-before-wait replay (the v2 race). 2. Total order: strictly increasing seq; all consumers observe the same order. 3. FIFO with advancing `afterSeq`. 4. Multi-waiter broadcast (same record delivered to independent queries). 5. `from` filtering. 6. Scope isolation. 7. **Never-synchronous resolution** (microtask-deferred even when the answer is known — Zalgo prevention: no code can accidentally depend on same-tick resolution that no networked transport can provide). 8. Payload isolation (received ≠ published reference; structural equality; non-serializable rejected). 9. Timeout rejects with `SignalTimeoutError`, not before ~timeoutMs. 10. `AbortSignal` cancels a pending wait promptly. 11. `destroyScope` rejects pending waiters with `ScopeClosedError`; idempotent; post-destroy calls reject. 12. `ping` resolves on a healthy transport. 13. Timeout errors carry the full in-scope history snapshot and near-miss name suggestions (a transport obligation — the one intelligence transports DO own, because only they see the log on timeout).

`ChaosTransport` (decorator: injected latency and scripted `TransportUnavailableError`s, deterministic via an injected `random` function) ships now, in Phase 1, so orchestrator tests exercise distributed-mode failure paths years before a real farm exists.

### D8 — Future transports (binding notes)

Redis transport (Phase 4): **node-redis** with Streams (`ioredis` is deprecated — ADR-0001 D11); sequencer via Lua `INCR`+`XADD`; reconnect resumes from cursors (safe because of invariant 1/2). Any transport, first-party or student-written, must pass the conformance suite before use.

## Consequences

- The in-memory transport is deliberately "as awkward as a network": async-only, JSON-round-tripped, size-capped. Local tests cannot accrete behaviors a distributed transport can't honor.
- The bus owns real logic (cursors, predicates, near-miss diagnostics) — it is the piece to test hardest; the transport SPI stays small enough for a thesis student to implement in a week.
- Explicit-timeout-everywhere pushes a small verbosity cost to callers; the DSL absorbs it in step text (by design — self-documenting waits, ADR-0001 §5.9).

Open for later (with evidence): non-consuming `peek`, cross-scenario/run-scoped signal tiers, payload schemas per signal name.

## Amendment 1 (2026-07-05): the conformance suite did its job

`RedisStreamTransport` (@kraken/signaling/redis — Redis Streams via node-redis 6, per D11) became the second implementation to pass the FULL conformance suite including the Chaos wrapper, UNMODIFIED, against a real ad-hoc redis-server. Mapping: seq = atomic Lua INCR+XADD with explicit `${seq}-0` stream ids; poll-based waitFor (the bus owns cursors); scope lifecycle via an `:open` marker key. `redis` is an optional peer dependency on a subpath export — installing Kraken never drags it in. One suite improvement fell out: `ConformanceOptions.skip` registers a VISIBLY skipped suite when external infrastructure is absent (C11).
