/**
 * `kraken serve` (ADR-0001 §7 Phase 5): a GUI-ready projection server over
 * the run artifacts on disk. BY CONSTRUCTION it needs zero core changes —
 * it reads ONLY `.kraken/runs/<runId>/` (events.jsonl + artifacts), the same
 * substrate every reporter projects from (ADR-0006 A3). Live runs stream
 * through a WebSocket tail of the incrementally-written events.jsonl.
 *
 * Surface:
 *   GET  /               minimal built-in viewer (dependency-free HTML)
 *   GET  /api/runs                     → run index (id, mtime, status)
 *   GET  /api/runs/:id/events         → full event log as JSON array
 *   GET  /api/runs/:id/artifacts/<p>  → artifact files (traversal-safe)
 *   WS   /api/runs/:id/live           → replay + live tail of events
 */
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  watch,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, normalize, resolve, sep } from 'node:path';

import { WebSocketServer } from 'ws';

export interface ServeOptions {
  /** The `.kraken/runs` directory to project. */
  readonly runsDir: string;
  readonly port?: number;
  readonly host?: string;
  readonly log?: (line: string) => void;
}

export interface ServeHandle {
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

interface RunSummary {
  readonly id: string;
  readonly modifiedAt: number;
  readonly status: 'running' | 'passed' | 'failed' | 'unknown';
  readonly events: number;
}

function readEvents(runDir: string): Array<Record<string, unknown>> {
  const path = join(runDir, 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Summaries are cached by the events file's (mtime, size): a finished run's
 * log never changes, so its full parse happens once — the viewer's 3s /api/runs
 * poll re-parses only runs that are actively being written (was: re-parse
 * EVERY run's whole log on every poll).
 */
const summaryCache = new Map<string, { key: string; summary: RunSummary }>();

function summarize(runsDir: string, id: string): RunSummary {
  const dir = join(runsDir, id);
  const eventsPath = join(dir, 'events.jsonl');
  const dirMtime = statSync(dir).mtimeMs;
  let key: string;
  try {
    const stat = statSync(eventsPath);
    key = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    key = `none:${dirMtime}`;
  }
  const cached = summaryCache.get(id);
  if (cached && cached.key === key) return cached.summary;

  const events = readEvents(dir);
  const last = [...events].reverse().find((event) => event['type'] === 'runFinished');
  const summary: RunSummary = {
    id,
    modifiedAt: dirMtime,
    status: last
      ? (last['status'] as RunSummary['status'])
      : events.length > 0
        ? 'running'
        : 'unknown',
    events: events.length,
  };
  summaryCache.set(id, { key, summary });
  return summary;
}

const VIEWER_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Kraken serve</title>
<style>
  body{font:14px ui-monospace,monospace;margin:2rem;background:#0d1117;color:#c9d1d9}
  h1{color:#58a6ff} a{color:#58a6ff} .run{margin:.2rem 0}
  #events{white-space:pre-wrap;border-top:1px solid #30363d;margin-top:1rem;padding-top:1rem}
  .passed{color:#3fb950}.failed{color:#f85149}.running{color:#d29922}
</style></head><body>
<h1>🦑 kraken serve</h1>
<div id="runs">loading…</div><div id="events"></div>
<script>
const runsEl = document.getElementById('runs'), eventsEl = document.getElementById('events');
async function load() {
  const runs = await (await fetch('/api/runs')).json();
  runsEl.innerHTML = runs.length ? '' : 'no runs yet';
  for (const run of runs) {
    const div = document.createElement('div'); div.className = 'run';
    div.innerHTML = '<span class="' + run.status + '">' + run.status + '</span> <a href="#" data-id="' +
      run.id + '">' + run.id + '</a> (' + run.events + ' events)';
    div.querySelector('a').onclick = (e) => { e.preventDefault(); tail(run.id); };
    runsEl.appendChild(div);
  }
}
let socket;
function tail(id) {
  socket?.close();
  eventsEl.textContent = '── live: ' + id + '\\n';
  socket = new WebSocket('ws://' + location.host + '/api/runs/' + id + '/live');
  socket.onmessage = (message) => { eventsEl.textContent += message.data + '\\n'; };
}
load(); setInterval(load, 3000);
</script></body></html>`;

export async function startServe(options: ServeOptions): Promise<ServeHandle> {
  const { runsDir } = options;
  const log = options.log ?? (() => {});

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(VIEWER_HTML);
        return;
      }
      if (url.pathname === '/api/runs') {
        const runs = existsSync(runsDir)
          ? readdirSync(runsDir)
              .filter((entry) => statSync(join(runsDir, entry)).isDirectory())
              .map((id) => summarize(runsDir, id))
              .sort((a, b) => b.modifiedAt - a.modifiedAt)
          : [];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(runs));
        return;
      }
      if (parts[0] === 'api' && parts[1] === 'runs' && parts[3] === 'events' && parts[2]) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(readEvents(join(runsDir, parts[2]))));
        return;
      }
      if (parts[0] === 'api' && parts[1] === 'runs' && parts[3] === 'artifacts' && parts[2]) {
        // Traversal-safe: the resolved path must stay inside the run dir.
        const runDir = resolve(runsDir, parts[2]);
        const target = normalize(resolve(runDir, parts.slice(4).join(sep)));
        if (!target.startsWith(runDir + sep) || !existsSync(target) || !statSync(target).isFile()) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const type = target.endsWith('.png')
          ? 'image/png'
          : target.endsWith('.json') || target.endsWith('.jsonl')
            ? 'application/json'
            : 'text/plain; charset=utf-8';
        res.writeHead(200, { 'content-type': type });
        res.end(readFileSync(target));
        return;
      }
      res.writeHead(404);
      res.end('not found');
    } catch (cause) {
      res.writeHead(500);
      res.end(cause instanceof Error ? cause.message : 'internal error');
    }
  });

  // WS live tail: replay everything written so far, then follow appends.
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket, req) => {
    const match = /^\/api\/runs\/([^/]+)\/live$/.exec(req.url ?? '');
    if (!match || match[1] === undefined) {
      socket.close(4004, 'unknown endpoint');
      return;
    }
    // Containment: the segment can't contain '/', but `..` alone would escape
    // (join(runsDir, '..', …)). Same guard the artifact HTTP route enforces.
    const dir = resolve(runsDir, match[1]);
    if (!dir.startsWith(resolve(runsDir) + sep)) {
      socket.close(4004, 'invalid run id');
      return;
    }
    const eventsPath = join(dir, 'events.jsonl');
    // BYTE offset + leftover buffer: read ONLY the appended tail each tick
    // (was: re-read + re-slice the ENTIRE growing log on every poll/watch).
    let byteOffset = 0;
    let leftover = Buffer.alloc(0);
    const push = (): void => {
      let size: number;
      try {
        size = statSync(eventsPath).size;
      } catch {
        return; // events.jsonl not written yet
      }
      if (size <= byteOffset) return;
      const fd = openSync(eventsPath, 'r');
      try {
        const chunk = Buffer.allocUnsafe(size - byteOffset);
        const read = readSync(fd, chunk, 0, chunk.length, byteOffset);
        byteOffset += read;
        let data =
          leftover.length > 0
            ? Buffer.concat([leftover, chunk.subarray(0, read)])
            : chunk.subarray(0, read);
        let newline = data.indexOf(0x0a);
        while (newline !== -1) {
          const line = data.subarray(0, newline).toString('utf8').trim();
          if (line.length > 0) socket.send(line);
          data = data.subarray(newline + 1);
          newline = data.indexOf(0x0a);
        }
        // keep bytes past the last newline (a partially-written trailing event)
        leftover = Buffer.from(data);
      } finally {
        closeSync(fd);
      }
    };
    push();
    const watcher = existsSync(dir) ? watch(dir, () => push()) : undefined;
    // fs.watch coalesces; a slow poll catches missed notifications.
    const poll = setInterval(push, 500);
    socket.on('close', () => {
      watcher?.close();
      clearInterval(poll);
    });
  });

  await new Promise<void>((resolvePromise) =>
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolvePromise),
  );
  const address = server.address();
  const port = address !== null && typeof address === 'object' ? address.port : 0;
  const url = `http://${options.host ?? '127.0.0.1'}:${port}`;
  log(`kraken serve listening on ${url} (runs: ${runsDir})`);

  return {
    port,
    url,
    close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolvePromise, rejectPromise) => {
        wss.close((error) => (error ? rejectPromise(error) : resolvePromise()));
      });
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
      });
    },
  };
}
