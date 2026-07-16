/**
 * The Release Board — a REAL (tiny) full-stack web app the trio scenario
 * tests end to end: node:http backend, in-memory store, server-rendered
 * dashboard. Zero dependencies. Because WE own this app, its markup uses
 * data-testid — the portable `testId` locator strategy works against it.
 *
 * Started idempotently from kraken.trio.config.ts; override the port with
 * KRAKEN_BOARD_PORT.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.KRAKEN_BOARD_PORT ?? 4173);

/** @type {{ platform: string, by: string, verdict: string, build: string }[]} */
const signoffs = [];

const page = () => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Release Board</title>
<style>
  body{font:15px system-ui;margin:2rem auto;max-width:640px;color:#1f2328}
  h1{font-size:1.3rem} .entry{padding:.4rem .6rem;border:1px solid #d0d7de;border-radius:6px;margin:.3rem 0}
  .ok{border-left:4px solid #1a7f37} form{display:flex;gap:.5rem;margin:1rem 0}
  input,button{font:inherit;padding:.35rem .5rem}
</style></head><body>
  <h1 data-testid="board-title">Release Board — build sign-offs</h1>
  <form method="POST" action="/signoff">
    <input name="platform" placeholder="platform" data-testid="signoff-platform" required>
    <input name="by" placeholder="engineer" data-testid="signoff-by" required>
    <input name="build" placeholder="build" data-testid="signoff-build" required>
    <button type="submit" data-testid="signoff-submit">Record sign-off</button>
  </form>
  <div data-testid="signoff-count">${signoffs.length} sign-off(s)</div>
  ${signoffs
    .map(
      (s, i) =>
        `<div class="entry ok" data-testid="entry-${i}">${s.platform} · ${s.by} · build ${s.build}</div>`,
    )
    .join('\n  ')}
</body></html>`;

export function startBoard() {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/signoff') {
      let body = '';
      req.on('data', (chunk) => {
        body += String(chunk);
      });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        signoffs.push({
          platform: params.get('platform') ?? '?',
          by: params.get('by') ?? '?',
          verdict: 'approved',
          build: params.get('build') ?? '?',
        });
        res.writeHead(303, { location: '/' });
        res.end();
      });
      return;
    }
    if (req.url === '/entries.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(signoffs));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page());
  });

  return new Promise((resolve) => {
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        // A board is already up (previous scenario/run) — reuse it.
        resolve(undefined);
      } else {
        throw error;
      }
    });
    server.listen(PORT, '127.0.0.1', () => {
      server.unref(); // never keep the CLI process alive
      resolve(server);
    });
  });
}

export const BOARD_URL = `http://127.0.0.1:${PORT}`;

// Allow standalone use: node server/release-board.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  await startBoard();
  console.log(`release board on ${BOARD_URL}`);
}
