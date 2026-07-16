import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { type ServeHandle, startServe } from '../src/serve.ts';

const runsDir = mkdtempSync(join(tmpdir(), 'kraken-serve-'));
const runDir = join(runsDir, 'run-1');
mkdirSync(join(runDir, 'alice'), { recursive: true });

const ev = (seq: number, type: string, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ ts: seq, runId: 'run-1', seq, type, ...extra })}\n`;

writeFileSync(
  join(runDir, 'events.jsonl'),
  ev(1, 'runStarted', { protocol: 1, scenarioCount: 1 }) +
    ev(2, 'scenarioStarted', { scenarioId: 's1', name: 'demo', actors: [] }),
);
writeFileSync(join(runDir, 'alice', 'shot.png'), Buffer.from([0x89, 0x50]));

const handles: ServeHandle[] = [];
afterAll(async () => {
  for (const handle of handles) await handle.close();
});

async function serve(): Promise<ServeHandle> {
  const handle = await startServe({ runsDir });
  handles.push(handle);
  return handle;
}

describe('kraken serve (the §5.12 projection server)', () => {
  it('lists runs with a live status derived from the event log', async () => {
    const { url } = await serve();
    const runs = (await (await fetch(`${url}/api/runs`)).json()) as Array<Record<string, unknown>>;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: 'run-1', status: 'running', events: 2 });
  });

  it('serves the full event log and artifacts; blocks path traversal', async () => {
    const { url } = await serve();
    const events = (await (await fetch(`${url}/api/runs/run-1/events`)).json()) as unknown[];
    expect(events).toHaveLength(2);
    const art = await fetch(`${url}/api/runs/run-1/artifacts/alice/shot.png`);
    expect(art.status).toBe(200);
    expect(art.headers.get('content-type')).toBe('image/png');
    const evil = await fetch(`${url}/api/runs/run-1/artifacts/..%2F..%2Fetc%2Fpasswd`);
    expect(evil.status).toBe(404);
  });

  it('WS live tail replays history then streams appended events', async () => {
    const { url, port } = await serve();
    void url;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/runs/run-1/live`);
    const received: string[] = [];
    socket.addEventListener('message', (message) => received.push(String(message.data)));
    await new Promise((resolve) => socket.addEventListener('open', resolve));
    // replay of the 2 existing events arrives first
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received).toHaveLength(2);
    // live append → pushed through the tail
    appendFileSync(
      join(runDir, 'events.jsonl'),
      ev(3, 'runFinished', { status: 'passed', durationMs: 5 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(received).toHaveLength(3);
    expect(JSON.parse(received[2] as string)).toMatchObject({ type: 'runFinished' });
    socket.close();
  });

  it('byte-offset tail streams multiple appends in order, UTF-8 intact', async () => {
    const runDir2 = join(runsDir, 'run-utf8');
    mkdirSync(runDir2, { recursive: true });
    writeFileSync(
      join(runDir2, 'events.jsonl'),
      ev(1, 'runStarted', { protocol: 1, scenarioCount: 1 }),
    );
    const { port } = await serve();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/runs/run-utf8/live`);
    const received: string[] = [];
    socket.addEventListener('message', (message) => received.push(String(message.data)));
    await new Promise((resolve) => socket.addEventListener('open', resolve));
    await new Promise((resolve) => setTimeout(resolve, 150));
    // three separate appends, one carrying multibyte payload (🦑 + acentos)
    for (const [seq, text] of [
      [2, 'plain'],
      [3, 'coreografía 🦑 señal'],
      [4, 'done'],
    ] as const) {
      appendFileSync(
        join(runDir2, 'events.jsonl'),
        ev(seq, 'stepStarted', { scenarioId: 's1', stepId: `st${seq}`, actorId: 'a', text }),
      );
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(received).toHaveLength(4); // 1 replay + 3 appends
    expect(JSON.parse(received[2] as string).text).toBe('coreografía 🦑 señal');
    expect(received.map((r) => JSON.parse(r).seq)).toEqual([1, 2, 3, 4]);
    socket.close();
  });

  it('/api/runs reflects new events after append (cache invalidates by mtime/size)', async () => {
    const runDirCache = join(runsDir, 'run-cache');
    mkdirSync(runDirCache, { recursive: true });
    writeFileSync(
      join(runDirCache, 'events.jsonl'),
      ev(1, 'runStarted', { protocol: 1, scenarioCount: 1 }),
    );
    const { url } = await serve();
    const before = (await (await fetch(`${url}/api/runs`)).json()) as Array<{
      id: string;
      events: number;
    }>;
    expect(before.find((r) => r.id === 'run-cache')?.events).toBe(1);
    // second poll hits the cache (same mtime/size) — still correct
    const cached = (await (await fetch(`${url}/api/runs`)).json()) as Array<{
      id: string;
      events: number;
    }>;
    expect(cached.find((r) => r.id === 'run-cache')?.events).toBe(1);
    // append → mtime/size change → cache invalidated → fresh count
    appendFileSync(
      join(runDirCache, 'events.jsonl'),
      ev(2, 'runFinished', { status: 'passed', durationMs: 3 }),
    );
    const after = (await (await fetch(`${url}/api/runs`)).json()) as Array<{
      id: string;
      events: number;
      status: string;
    }>;
    expect(after.find((r) => r.id === 'run-cache')).toMatchObject({ events: 2, status: 'passed' });
  });

  it('a nonexistent run id streams nothing and does not crash (containment-safe)', async () => {
    const { port } = await serve();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/runs/does-not-exist/live`);
    const received: string[] = [];
    socket.addEventListener('message', (m) => received.push(String(m.data)));
    const opened = await new Promise<boolean>((resolve) => {
      socket.addEventListener('open', () => resolve(true));
      socket.addEventListener('close', () => resolve(false));
    });
    if (opened) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(received).toHaveLength(0); // no file → no leaked data
      socket.close();
    }
    // either outcome is safe: closed outright, or open-but-silent
    expect(received).toHaveLength(0);
  });
});
