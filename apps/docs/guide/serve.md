# Serving results

`kraken serve` starts a local HTTP/WebSocket server that exposes run results — event streams and artifacts — to browsers and external tools. It is a projection server: it reads **only** the `.kraken/runs/` directory on disk and has no coupling to the process that executes tests. Finished runs and in-flight runs are therefore served identically; a live run is simply a run whose `events.jsonl` is still growing.

## Starting the server

```bash
kraken serve
kraken serve --port 4000
kraken serve --host 0.0.0.0 --port 4000
```

| Flag | Default | Description |
| --- | --- | --- |
| `--port` | `0` (OS-assigned) | Port to listen on. With the default, the operating system picks a free port and the CLI prints it. |
| `--host` | `127.0.0.1` | Bind host. The default restricts access to the local machine. |

On startup the CLI prints the listening URL and the runs directory being served, then runs until interrupted with Ctrl-C.

The runs directory is resolved from the project: `kraken serve` looks for `kraken.config.{ts,mts,js,mjs}` from the current directory upwards and serves `<projectRoot>/.kraken/runs`, where the project root is the directory containing the config file (falling back to the current directory when no config is found). Run it from anywhere inside the project.

::: warning
The default bind address is `127.0.0.1`, so the server is reachable only from the local machine. Binding to other interfaces (`--host 0.0.0.0`) exposes every run's events and artifacts without authentication — do this only on networks where that is acceptable.
:::

## GET / — the built-in viewer

The root path serves a minimal, dependency-free HTML viewer: a list of runs with status and event counts, refreshed every 3 seconds; selecting a run opens its live WebSocket tail and appends events as they arrive. The viewer is intentionally spartan — the primary consumers of `kraken serve` are external UIs built on the API below.

## GET /api/runs — the run index

Returns a JSON array of run summaries, sorted by directory modification time, most recent first:

```json
[
  { "id": "3f2c9d4e-8a17-4a0e-9d2c-5b1f6c7a8e90", "modifiedAt": 1751980065000, "status": "passed", "events": 42 },
  { "id": "b81a02c7-4c3d-4f21-a6b9-0e5d7f8a9c12", "modifiedAt": 1751979000000, "status": "running", "events": 17 }
]
```

| Field | Meaning |
| --- | --- |
| `id` | The run id — the directory name under `.kraken/runs/` |
| `modifiedAt` | The run directory's mtime, in epoch milliseconds |
| `status` | Derived status (see below) |
| `events` | Number of events written to the log so far |

The `status` is derived from the event log on demand — it is not stored anywhere:

| Condition | Status |
| --- | --- |
| The log contains a `runFinished` event | That event's `status` — `passed` or `failed` |
| The log has events but no `runFinished` | `running` |
| No events written yet | `unknown` |

A run whose process was killed before writing `runFinished` also reports `running`; the log alone cannot distinguish an in-flight run from an aborted one.

Summaries are cached keyed by the event file's `(mtime, size)`, so a finished run's log is parsed once; polling this endpoint re-parses only runs that are actively being written.

## GET /api/runs/:id/events — the full log

Returns the run's complete event log as a JSON array, in `seq` order. An unknown run id — or a run whose `events.jsonl` does not exist yet — yields `[]`. The array elements are exactly the events documented in the [events reference](/reference/events).

```bash
curl -s http://127.0.0.1:4000/api/runs/<runId>/events | jq '.[-1]'
```

## GET /api/runs/:id/artifacts/&lt;path&gt; — artifact files

Serves any file from inside the run directory — screenshots, source dumps, driver logs, the CTRF report, individual Allure result files:

```
GET /api/runs/<runId>/artifacts/alice/android-1f3a9c2e-1.png
GET /api/runs/<runId>/artifacts/ctrf-report.json
GET /api/runs/<runId>/artifacts/appium-android.log
```

Content types are derived from the extension: `.png` is served as `image/png`, `.json` and `.jsonl` as `application/json`, everything else as `text/plain`.

The path is traversal-rejected: the resolved target must remain inside that run's directory. Any path that escapes it — as well as any missing path or a path naming a directory — answers `404`. Event payloads reference artifacts by absolute filesystem path on the machine that ran the tests; to map an `artifactCaptured` event to a URL, take the path component relative to the run directory.

## WS /api/runs/:id/live — replay, then tail

A WebSocket endpoint with replay-then-tail semantics:

1. **Replay.** On connection, every event already written to `events.jsonl` is sent immediately — one event per message, in order.
2. **Tail.** The socket then streams each newly appended event as it is written. Appends are detected by a filesystem watch on the run directory backed by a 500 ms poll (watch notifications can coalesce), and only the appended bytes are read on each tick. A partially written trailing line is buffered until its newline arrives, so consumers only ever receive complete JSON documents.

Each message body is one serialized `KrakenEvent`. Because replay and tail share one channel and every event carries `seq`, a consumer needs no synchronization logic: connect at any time — before, during or after the run — and process messages in arrival order, or key by `seq` for idempotence.

Connecting to a path that does not match `/api/runs/<id>/live` closes the socket with code `4004` (`unknown endpoint`); a run id that would resolve outside the runs directory closes with `4004` (`invalid run id`). Connecting for a run whose directory or log does not exist yet is valid — the socket starts delivering events once the log appears, which makes it practical to open the socket before starting the run.

```js
const socket = new WebSocket(`ws://127.0.0.1:4000/api/runs/${runId}/live`);
socket.onmessage = ({ data }) => {
  const event = JSON.parse(data);
  // event.type, event.ts, event.runId, event.seq + the type-specific payload
};
```

## Building an external UI

The `/api/*` surface is designed so a GUI can be built without touching Kraken internals:

- **State is a reduction.** Everything a run view needs — scenario names, per-actor lanes, current steps, signal waits, artifacts — is derivable by folding the event stream in `seq` order. Kraken's own live terminal UI is implemented exactly this way.
- **Forward compatibility.** Ignore unknown event types and unknown fields; the stream evolves additively (see the [evolution rules](/reference/events#evolution-rules)).
- **Live and historical share one code path.** The WebSocket replays history before tailing, so a single consumer handles finished and in-flight runs alike; `/api/runs/:id/events` remains available when a one-shot snapshot is preferable.
- **Artifacts are URLs.** Convert `artifactCaptured` paths to `/api/runs/:id/artifacts/<relative path>` and render screenshots directly in the browser.
