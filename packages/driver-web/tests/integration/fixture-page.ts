/**
 * The CTK fixture page: a self-contained HTML app exercising every core
 * operation, served from an in-test http server (real navigation, no files).
 * data-testid contract mirrors the mobile fixture's roles.
 */
import { createServer, type Server } from 'node:http';

export const FIXTURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Kraken CTK fixture</title></head>
<body>
  <main style="display:flex;flex-direction:column;gap:12px;padding:24px;max-width:480px">
    <h1 data-testid="title">Kraken CTK fixture</h1>
    <button data-testid="switch" type="button"
      onclick="this.textContent = this.textContent === 'ON' ? 'OFF' : 'ON'">OFF</button>
    <p data-testid="switch-text">Click to turn the switch ON</p>
    <input data-testid="text-input" aria-label="text-input" placeholder="Type here…"
      oninput="document.querySelector('[data-testid=input-text-result]').textContent = this.value">
    <p data-testid="input-text-result"></p>
    <div style="height:1600px"></div>
    <p data-testid="deep-below">You scrolled to the bottom</p>
  </main>
</body>
</html>`;

export interface FixtureServer {
  readonly url: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(FIXTURE_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fixture server failed to bind');
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
