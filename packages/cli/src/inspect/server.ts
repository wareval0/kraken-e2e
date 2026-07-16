/**
 * The `kraken inspect` server: mirrors one actor's live screen into the
 * browser and turns clicks on the mirror into element identification.
 * Built ENTIRELY on the portable session contract (screenshot + source +
 * tap + navigate) — no driver internals, so it works with any driver.
 *
 * Endpoints:
 *   GET  /                     the inspector UI
 *   GET  /api/screen           { image (base64 png), width, height, platform }
 *   GET  /api/identify?x&y     hit-test at device coordinates → locators + snippet
 *   POST /api/tap  {x,y}       identify at (x,y) and tap THAT element via its locator
 *   POST /api/navigate {to}    deep link / URL
 */
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';

import type { TargetLocator, UserSession } from '@kraken-e2e/contracts';

import {
  type HitResult,
  type InspectedElement,
  identify,
  parseSource,
  rankWebLocators,
  toHitResult,
  type WebCounts,
} from './hit-test.js';

export interface InspectServeOptions {
  readonly session: UserSession;
  readonly platform: 'android' | 'ios' | 'web' | 'auto';
  readonly port?: number;
  readonly host?: string;
  readonly log?: (line: string) => void;
}

/**
 * Walks the live DOM and returns every visible element with its on-screen box
 * in DEVICE pixels (multiplied by devicePixelRatio to align with the
 * screenshot), plus the attributes the inspector ranks. Runs in the page via
 * UserSession.evaluate — the only way to get real geometry on the web, since
 * the HTML source carries no coordinates.
 */
const WEB_DOM_SCRIPT = `
const dpr = window.devicePixelRatio || 1;
const CLICKY = new Set(['A','BUTTON','INPUT','SELECT','TEXTAREA','LABEL','SUMMARY']);
const out = [];
for (const el of document.querySelectorAll('body *')) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0) continue;
  const st = window.getComputedStyle(el);
  if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue;
  const leaf = el.children.length === 0;
  const ownText = leaf ? (el.textContent || '').trim() : '';
  // Best stable CSS hook when there is no data-testid: sites often expose
  // data-functional-selector (e.g. Kahoot) or a form name.
  const fnSel = el.getAttribute('data-functional-selector');
  const nm = el.getAttribute('name');
  out.push({
    x: Math.round(r.left * dpr), y: Math.round(r.top * dpr),
    width: Math.round(r.width * dpr), height: Math.round(r.height * dpr),
    className: el.tagName.toLowerCase(),
    a11y: el.getAttribute('aria-label') || undefined,
    resourceId: el.getAttribute('data-testid') || el.getAttribute('data-test') || undefined,
    htmlId: el.id || undefined,
    cssHook: fnSel ? '[data-functional-selector="'+fnSel+'"]' : nm ? el.tagName.toLowerCase()+'[name="'+nm+'"]' : undefined,
    text: (ownText || '').slice(0, 60) || undefined,
    clickable: CLICKY.has(el.tagName) || el.getAttribute('role') === 'button' ||
      typeof el.onclick === 'function' || st.cursor === 'pointer',
  });
}
return out;
`;

/**
 * Hit-tests a single point in the LIVE page and returns the element the user
 * actually SEES there, then climbs to the nearest addressable/tappable
 * ancestor. Built on the browser's own hit-testing so stacking order is
 * honoured — a click over a modal identifies the modal, not the content hidden
 * behind it. But three real-world layers are resolved so identification is
 * specific rather than generic:
 *
 *  - SAME-ORIGIN iframes are descended into (coordinates mapped through the
 *    frame's box incl. border/padding); a cross-origin frame is reported as-is.
 *  - Open SHADOW DOM is pierced (cookie/consent sheets and web components).
 *  - "See-through" overlays are PEELED. Many cards/list rows lay a transparent,
 *    empty click-capture <div> over their content; elementFromPoint returns
 *    THAT, hiding the title/button the user clicked. We temporarily disable an
 *    empty, transparent leaf's pointer-events and re-hit-test to reveal the
 *    visible element beneath — then restore it. An opaque modal renders pixels,
 *    is not see-through, and is kept.
 *
 * Coordinates arrive as arguments[0]=x, arguments[1]=y in DEVICE pixels; they
 * are divided by devicePixelRatio back to CSS pixels.
 */
const WEB_HIT_SCRIPT = `
const dpr = window.devicePixelRatio || 1;
let cx = arguments[0] / dpr, cy = arguments[1] / dpr;
let doc = document, win = window, offX = 0, offY = 0, frame = false;
const ownTextOf = (node) => {
  let t = '';
  for (const c of node.childNodes) if (c.nodeType === 3) t += c.textContent;
  return t.replace(/\\s+/g, ' ').trim();
};
// An empty leaf that paints nothing at this pixel — a click-capture overlay or
// spacer laid over real content. Only such elements are peeled. A genuine
// control (a semantic tag, an ARIA-labelled/role'd/focusable element, an SVG
// shape) is NEVER peeled even when it is an empty, transparent leaf — an
// icon-only <button>, a stretched-link <a>, or a chart <path> must survive.
const seeThrough = (el) => {
  if (!el || el.children.length > 0) return false;
  // SVG shapes paint via fill/stroke (not background) and are namespaced
  // (tagName is lowercase, so a 'SVG' string check would be dead).
  if (el instanceof SVGElement) return false;
  const tag = el.tagName;
  if (tag === 'IMG' || tag === 'CANVAS' || tag === 'VIDEO' || tag === 'INPUT' ||
      tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A' ||
      tag === 'SUMMARY' || tag === 'LABEL') return false;
  if (ownTextOf(el)) return false;
  // Any accessibility/interaction affordance means this IS the target, not a
  // spacer — keep it. (A bare click-capture <div> overlay has none of these.)
  const role = el.getAttribute('role');
  const tabindex = el.getAttribute('tabindex');
  if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') ||
      el.getAttribute('href') || typeof el.onclick === 'function' ||
      (tabindex !== null && tabindex !== '-1') ||
      (role && /^(button|link|checkbox|tab|menuitem|menuitemcheckbox|radio|switch|option)$/.test(role)))
    return false;
  const cs = win.getComputedStyle(el);
  if (cs.backgroundImage && cs.backgroundImage !== 'none') return false;
  if ((cs.maskImage && cs.maskImage !== 'none') ||
      (cs.webkitMaskImage && cs.webkitMaskImage !== 'none')) return false;
  if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') return false;
  const m = (cs.backgroundColor || '').match(/rgba?\\(([^)]+)\\)/);
  const parts = m ? m[1].split(',') : [];
  const alpha = m ? (parts.length === 4 ? parseFloat(parts[3]) : 1) : 0;
  return !(alpha > 0.05);
};
let hit = null;
const undo = [];
try {
  for (let g = 0; g < 40; g++) {
    const el = doc.elementFromPoint(cx, cy);
    if (!el) break;
    if (el.tagName === 'IFRAME') {
      let idoc = null;
      try { idoc = el.contentDocument; } catch (e) { idoc = null; }
      if (!idoc) { hit = el; break; } // cross-origin — report the frame
      const fr = el.getBoundingClientRect();
      const cs = win.getComputedStyle(el);
      const bl = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
      const bt = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
      const ncx = cx - fr.left - bl, ncy = cy - fr.top - bt;
      const inner = idoc.elementFromPoint(ncx, ncy);
      if (!inner) { hit = el; break; }
      cx = ncx; cy = ncy; offX += fr.left + bl; offY += fr.top + bt;
      doc = idoc; win = idoc.defaultView || win; frame = true;
      continue;
    }
    if (el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(cx, cy);
      if (inner && inner !== el) { doc = el.shadowRoot; continue; }
    }
    if (seeThrough(el)) {
      undo.push([el, el.style.pointerEvents]);
      el.style.pointerEvents = 'none';
      continue;
    }
    hit = el;
    break;
  }
  if (!hit) hit = doc.elementFromPoint(cx, cy);
} finally {
  for (const pair of undo) pair[0].style.pointerEvents = pair[1];
}
if (!hit) return null;
const idOf = (node) => node.getAttribute('data-testid') || node.getAttribute('data-test') ||
  node.getAttribute('aria-label') || node.getAttribute('data-functional-selector');
const bodyEl = (win.document || document).body;
let n = hit;
for (let node = hit, i = 0; node && node !== bodyEl && i < 6; node = node.parentElement, i++) {
  const role = node.getAttribute('role');
  if (idOf(node) || node.tagName === 'BUTTON' || node.tagName === 'A' ||
      node.tagName === 'INPUT' || role === 'button' || role === 'link' ||
      role === 'checkbox' || role === 'tab' || role === 'menuitem') { n = node; break; }
}
// Text from the CLICKED LEAF's own text nodes, not a container's concatenated
// textContent ("EN" + "English (US)" → "ENEnglish (US)", which no by:text can
// match). Multi-child containers yield no text so a stable id is used instead.
const textOf = (node) => {
  const own = ownTextOf(node);
  if (own) return own;
  return node.children.length <= 1 ? (node.textContent || '').replace(/\\s+/g, ' ').trim() : '';
};
const r = n.getBoundingClientRect();
const st = win.getComputedStyle(n);
const role = n.getAttribute('role');
const fnSel = n.getAttribute('data-functional-selector');
const nm = n.getAttribute('name');
const text = textOf(hit) || textOf(n);
const cssHook = fnSel ? '[data-functional-selector="' + fnSel + '"]'
  : nm ? n.tagName.toLowerCase() + '[name="' + nm + '"]' : undefined;
// How many elements each candidate matches ON THE PAGE — so the ranker can
// prefer a UNIQUE selector over an ambiguous one (e.g. a "Log in" text shared
// by a card heading and the submit button). Counting mirrors what each locator
// resolves to: exact attribute value, exact full text, or the raw CSS.
const byAttr = (attr, val) => {
  if (val == null) return undefined;
  let c = 0;
  for (const e of doc.querySelectorAll('[' + attr + ']')) { if (e.getAttribute(attr) === val && ++c > 9) break; }
  return c;
};
const byText = (val) => {
  if (!val) return undefined;
  let c = 0;
  for (const e of doc.querySelectorAll('*')) {
    if ((e.textContent || '').replace(/\\s+/g, ' ').trim() === val && ++c > 9) break;
  }
  return c;
};
const bySel = (sel) => { if (!sel) return undefined; try { return doc.querySelectorAll(sel).length; } catch (e) { return undefined; } };
// One element's identifiers + how many page elements each value matches.
const describe = (node, box) => {
  const nodeRole = node.getAttribute('role');
  const nodeFn = node.getAttribute('data-functional-selector');
  const nodeNm = node.getAttribute('name');
  const hook = nodeFn ? '[data-functional-selector="' + nodeFn + '"]'
    : nodeNm ? node.tagName.toLowerCase() + '[name="' + nodeNm + '"]' : undefined;
  const nodeText = textOf(node);
  const tid = node.getAttribute('data-testid') || node.getAttribute('data-test') || undefined;
  const st2 = win.getComputedStyle(node);
  return {
    x: Math.round((box.left + offX) * dpr), y: Math.round((box.top + offY) * dpr),
    width: Math.round(box.width * dpr), height: Math.round(box.height * dpr),
    className: node.tagName.toLowerCase(),
    a11y: node.getAttribute('aria-label') || undefined,
    resourceId: tid,
    htmlId: node.id || undefined,
    cssHook: hook,
    text: nodeText && nodeText.length <= 60 ? nodeText : undefined,
    frame: frame || undefined,
    clickable: node.tagName === 'BUTTON' || node.tagName === 'A' || node.tagName === 'INPUT' ||
      nodeRole === 'button' || typeof node.onclick === 'function' || st2.cursor === 'pointer',
    counts: {
      a11y: byAttr('aria-label', node.getAttribute('aria-label')),
      testId: byAttr('data-testid', tid),
      text: nodeText && nodeText.length <= 60 ? byText(nodeText) : undefined,
      cssHook: bySel(hook),
      htmlId: node.id ? 1 : undefined,
    },
  };
};
const out = describe(n, r);
// The exact LEAF the user clicked, when it differs from the tappable ancestor —
// its identifiers are often the SPECIFIC ones ("...--title"), so the inspector
// surfaces both instead of stopping at the general container layer.
if (hit !== n) out.leaf = describe(hit, hit.getBoundingClientRect());
return out;
`;

/**
 * Performs a CLICK at a point entirely inside the page: find the topmost
 * element there (descending same-origin iframes and open shadow roots) and
 * dispatch the full pointer/mouse event sequence on it. Unlike a WebDriver
 * click this never raises or focuses the browser window — the inspector stays
 * on top — and because it hit-tests at dispatch time it works on late-rendered
 * layers (cookie/consent sheets) without any stale element references.
 * (Dispatched events carry isTrusted:false; the rare handler that checks it
 * falls back to the locator-based driver tap.)
 */
const WEB_CLICK_SCRIPT = `
const dpr = window.devicePixelRatio || 1;
let cx = arguments[0] / dpr, cy = arguments[1] / dpr;
let doc = document, win = window;
let el = doc.elementFromPoint(cx, cy);
if (!el) return null;
for (let g = 0; g < 6; g++) {
  if (el.tagName === 'IFRAME') {
    let idoc = null;
    try { idoc = el.contentDocument; } catch (e) { idoc = null; }
    if (!idoc) break;
    const fr = el.getBoundingClientRect();
    const cs = win.getComputedStyle(el);
    const bl = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
    const bt = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
    const inner = idoc.elementFromPoint(cx - fr.left - bl, cy - fr.top - bt);
    if (!inner) break;
    cx -= fr.left + bl; cy -= fr.top + bt;
    doc = idoc; win = idoc.defaultView || win; el = inner;
    continue;
  }
  if (el.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(cx, cy);
    if (inner && inner !== el) { el = inner; continue; }
  }
  break;
}
const opts = { bubbles: true, cancelable: true, composed: true, view: win,
  clientX: cx, clientY: cy, button: 0, buttons: 1 };
try { el.dispatchEvent(new win.PointerEvent('pointerdown', opts)); } catch (e) {}
el.dispatchEvent(new win.MouseEvent('mousedown', opts));
if (typeof el.focus === 'function') { try { el.focus(); } catch (e) {} }
try { el.dispatchEvent(new win.PointerEvent('pointerup', opts)); } catch (e) {}
el.dispatchEvent(new win.MouseEvent('mouseup', opts));
el.dispatchEvent(new win.MouseEvent('click', opts));
return { tag: el.tagName.toLowerCase() };
`;

/**
 * Coerce the raw object returned by WEB_HIT_SCRIPT into a clean
 * InspectedElement. The WebDriver wire turns every `undefined` field into
 * `null`, so absent attributes arrive as `null` — normalise them back to
 * absent so the ranker's presence checks behave.
 */
export function normalizeWebElement(raw: Record<string, unknown>): InspectedElement {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined;
  const a11y = str(raw['a11y']);
  const resourceId = str(raw['resourceId']);
  const text = str(raw['text']);
  const htmlId = str(raw['htmlId']);
  const cssHook = str(raw['cssHook']);
  return {
    x: Number(raw['x']) || 0,
    y: Number(raw['y']) || 0,
    width: Number(raw['width']) || 0,
    height: Number(raw['height']) || 0,
    className: str(raw['className']) ?? 'element',
    ...(a11y !== undefined ? { a11y } : {}),
    ...(resourceId !== undefined ? { resourceId } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(htmlId !== undefined ? { htmlId } : {}),
    ...(cssHook !== undefined ? { cssHook } : {}),
    ...(raw['frame'] ? { frame: true } : {}),
    clickable: raw['clickable'] === true,
  };
}

export interface InspectHandle {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

interface ScreenState {
  readonly elements: readonly InspectedElement[];
  readonly imageBase64: string;
  readonly width: number;
  readonly height: number;
}

/** PNG pixel size from the IHDR chunk (bytes 16-23) — no image library needed. */
function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export async function startInspect(options: InspectServeOptions): Promise<InspectHandle> {
  const { session } = options;
  const log = options.log ?? (() => {});
  let state: ScreenState | undefined;

  // Web has no coordinates in its source; read live DOM geometry via evaluate.
  const isWeb = options.platform === 'web' && typeof session.evaluate === 'function';

  // Every driver call is time-bounded so one slow/hung command cannot freeze
  // the inspector — it surfaces as a normal error instead.
  const withTimeout = async <T>(label: string, ms: number, op: Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        op,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const capture = async (): Promise<ScreenState> => {
    const artifact = await withTimeout('screenshot', 20_000, session.screenshot());
    const png = readFileSync(artifact.path);
    const { width, height } = pngSize(png);
    let elements: readonly InspectedElement[];
    if (isWeb) {
      const raw = await withTimeout(
        'evaluate',
        20_000,
        session.evaluate?.(WEB_DOM_SCRIPT) ?? Promise.resolve([]),
      );
      // Normalise so state.elements is honestly typed (WEB_DOM_SCRIPT fields
      // arrive as null over the WebDriver wire, same as WEB_HIT_SCRIPT).
      elements = Array.isArray(raw)
        ? raw.map((r) => normalizeWebElement(r as Record<string, unknown>))
        : [];
    } else {
      elements = parseSource(
        options.platform === 'web' ? 'auto' : options.platform,
        await withTimeout('source', 20_000, session.source()),
      );
    }
    state = { elements, imageBase64: png.toString('base64'), width, height };
    return state;
  };

  /** Capture, but on failure keep serving the last good frame instead of dying. */
  const captureSafe = async (): Promise<ScreenState | { error: string }> => {
    try {
      return await capture();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      log(`  ! capture failed: ${message}`);
      return state ?? { error: message };
    }
  };

  /**
   * Identify the element at a device-pixel point. Web hit-tests the live page
   * (elementFromPoint, honours stacking); mobile hit-tests the captured flat
   * element list parsed from the page source.
   */
  const identifyAt = async (x: number, y: number): Promise<HitResult | undefined> => {
    if (isWeb) {
      const raw = await withTimeout(
        'identify',
        15_000,
        session.evaluate?.(WEB_HIT_SCRIPT, x, y) ?? Promise.resolve(null),
      );
      if (!raw || typeof raw !== 'object') return undefined;
      const record = raw as Record<string, unknown>;
      const el = normalizeWebElement(record);
      const counts = (record['counts'] ?? {}) as WebCounts;
      let candidates = rankWebLocators(el, counts);
      // The exact leaf the user clicked often carries the SPECIFIC identifier
      // (a "...--title" test id) while the tappable ancestor has the general
      // one — surface both, dedup'd, so identification never stops at the
      // container layer.
      const leafRaw = record['leaf'];
      if (leafRaw && typeof leafRaw === 'object') {
        const leaf = normalizeWebElement(leafRaw as Record<string, unknown>);
        const leafCounts = ((leafRaw as Record<string, unknown>)['counts'] ?? {}) as WebCounts;
        const seen = new Set(candidates.map((c) => `${c.locator.by}|${c.locator.value}`));
        candidates = [
          ...candidates,
          ...rankWebLocators(leaf, leafCounts).filter(
            (c) => !seen.has(`${c.locator.by}|${c.locator.value}`),
          ),
          // Stable re-sort so a unique, portable leaf identifier (the specific
          // "...--title" test id) outranks a merely-unique container hook.
        ].sort(
          (a, b) =>
            Number(b.unique === true) - Number(a.unique === true) ||
            Number(b.portable) - Number(a.portable),
        );
      }
      return toHitResult(el, candidates);
    }
    const current = state ?? (await capture());
    return identify(current.elements, x, y, options.platform);
  };

  const json = (res: import('node:http').ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    void (async () => {
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(INSPECTOR_HTML);
        return;
      }
      if (url.pathname === '/api/screen') {
        const fresh = await captureSafe();
        if ('error' in fresh) {
          json(res, 503, fresh);
          return;
        }
        json(res, 200, {
          image: fresh.imageBase64,
          width: fresh.width,
          height: fresh.height,
          elements: fresh.elements.length,
        });
        return;
      }
      if (url.pathname === '/api/identify') {
        const x = Number(url.searchParams.get('x'));
        const y = Number(url.searchParams.get('y'));
        try {
          const hit = await identifyAt(x, y);
          json(res, hit ? 200 : 404, hit ?? { error: 'no element at that point' });
        } catch (cause) {
          json(res, 503, { error: cause instanceof Error ? cause.message : String(cause) });
        }
        return;
      }
      if (url.pathname === '/api/tap' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += String(chunk);
        const { x, y } = JSON.parse(body) as { x: number; y: number };
        let hit: HitResult | undefined;
        try {
          hit = await identifyAt(x, y);
        } catch (cause) {
          json(res, 503, { error: cause instanceof Error ? cause.message : String(cause) });
          return;
        }
        if (!hit) {
          json(res, 404, { error: 'no element at that point' });
          return;
        }
        try {
          if (isWeb) {
            // Dispatch the click INSIDE the page at the exact point: no window
            // focus steal, and it works on late-rendered layers (cookie sheets)
            // because it hit-tests at dispatch time. Falls back to a locator
            // tap for the rare isTrusted-checking handler.
            const clicked = await withTimeout(
              'tap',
              15_000,
              session.evaluate?.(WEB_CLICK_SCRIPT, x, y) ?? Promise.resolve(null),
            );
            if (!clicked) {
              await withTimeout(
                'tap',
                15_000,
                session.tap(hit.candidates[0]?.locator as TargetLocator),
              );
            }
          } else {
            // Mobile: tap through the identified locator (validates it too).
            await withTimeout(
              'tap',
              15_000,
              session.tap(hit.candidates[0]?.locator as TargetLocator),
            );
          }
        } catch (cause) {
          json(res, 200, {
            tapped: hit.candidates[0]?.locator,
            warning: cause instanceof Error ? cause.message : String(cause),
          });
          return;
        }
        // Let the tapped view settle before responding; the client then issues
        // a single /api/screen refresh which captures (and re-parses state for
        // the next identify) — so we do NOT screenshot again here (one write
        // per tap, not two).
        await new Promise((resolve) => setTimeout(resolve, 400));
        json(res, 200, { tapped: hit.candidates[0]?.locator });
        return;
      }
      if (url.pathname === '/api/navigate' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += String(chunk);
        const { to } = JSON.parse(body) as { to: string };
        await withTimeout('navigate', 30_000, session.navigate(to));
        await new Promise((resolve) => setTimeout(resolve, 800));
        await captureSafe();
        json(res, 200, { navigated: to });
        return;
      }
      json(res, 404, { error: 'not found' });
    })().catch((cause) => {
      json(res, 500, { error: cause instanceof Error ? cause.message : String(cause) });
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve),
  );
  const address = server.address();
  const port = address !== null && typeof address === 'object' ? address.port : 0;
  const url = `http://${options.host ?? '127.0.0.1'}:${port}`;
  log(`kraken inspect listening on ${url}`);
  return {
    url,
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

const INSPECTOR_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Kraken inspect</title>
<style>
  body{font:13px ui-monospace,monospace;margin:0;display:flex;height:100vh;overflow:hidden;background:#0d1117;color:#c9d1d9}
  /* Mirror column is capped so a wide (web) screen never eats the panel. */
  #left{flex:0 1 auto;max-width:62vw;padding:12px;overflow:auto}
  #screen{position:relative;cursor:crosshair;display:inline-block}
  #screen img{max-width:100%;max-height:88vh;display:block;object-fit:contain;border:1px solid #30363d;border-radius:6px}
  #box{position:absolute;border:2px solid #58a6ff;background:#58a6ff22;pointer-events:none;display:none}
  #busy{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#0d1117bb;color:#58a6ff;font-weight:600;font-size:14px;pointer-events:none;border-radius:6px}
  #busy.on{display:flex}
  #busy .dot{animation:pulse 1s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:.35}50%{opacity:1}}
  #right{flex:1 1 360px;min-width:320px;padding:16px;overflow:auto;border-left:1px solid #30363d}
  h1{font-size:15px;color:#58a6ff;margin:0 0 8px}
  .cand{border:1px solid #30363d;border-left:4px solid #3fb950;border-radius:6px;padding:8px;margin:8px 0;cursor:pointer}
  .cand.native{border-left-color:#d29922}
  .cand.selected{background:#161b22;border-color:#58a6ff}
  .loc{color:#3fb950;font-weight:600}
  .cand:hover .loc{text-decoration:underline}
  .why{color:#8b949e;font-size:12px}
  .elmeta{color:#8b949e;margin-bottom:6px}
  .tag{font-size:10px;padding:1px 6px;border-radius:9px;margin-left:6px;vertical-align:middle;font-weight:600}
  .tag.rec{background:#1f6feb;color:#fff}
  .tag.warn{background:#7d3b00;color:#ffce8a}
  .tag.ok{background:#12341f;color:#3fb950}
  pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:8px;overflow:auto;cursor:pointer}
  #bar{margin-bottom:8px;display:flex;gap:6px}
  input,button{font:inherit;background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:5px 8px}
  button:hover{border-color:#58a6ff}
  label{display:flex;align-items:center;gap:4px;color:#8b949e}
  #meta{color:#8b949e;margin-bottom:6px}
  .copied{color:#3fb950}
</style></head><body>
<div id="left">
  <div id="bar">
    <button id="refresh">↻ refresh</button>
    <label><input type="checkbox" id="tapmode"> tap-through</label>
  </div>
  <div id="bar">
    <input id="deeplink" placeholder="deep link / URL (wdio://forms, https://…)" size="30">
    <button id="go">go</button>
  </div>
  <div id="screen"><img id="shot" alt="device screen"><div id="box"></div><div id="busy"><span class="dot">⏳ processing…</span></div></div>
</div>
<div id="right">
  <h1>🦑 kraken inspect</h1>
  <div id="meta">loading screen…</div>
  <div id="out">Click any element on the mirror. Its identifier, ranked Kraken locators and a
  ready-to-paste Screen Object method will appear here. Enable <b>tap-through</b> to also perform
  the tap on the device (the mirror refreshes after each tap).</div>
</div>
<script>
const shot = document.getElementById('shot'), box = document.getElementById('box');
const out = document.getElementById('out'), meta = document.getElementById('meta');
let device = { width: 0, height: 0 };
async function refresh() {
  meta.textContent = 'capturing…';
  try {
    const res = await fetch('/api/screen');
    const s = await res.json();
    if (!res.ok) { meta.textContent = 'capture failed: ' + (s.error || res.status) + ' — retrying…'; return; }
    device = s;
    shot.src = 'data:image/png;base64,' + s.image;
    meta.textContent = s.width + '×' + s.height + ' — ' + s.elements + ' elements';
    box.style.display = 'none';
  } catch (err) {
    meta.textContent = 'capture error: ' + err.message + ' — retrying…';
  }
}
function toDevice(e) {
  const r = shot.getBoundingClientRect();
  return { x: Math.round((e.clientX - r.left) * (device.width / r.width)),
           y: Math.round((e.clientY - r.top) * (device.height / r.height)) };
}
function esc(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML}
const busyEl = document.getElementById('busy');
// One click is processed at a time: while a tap/identify is in flight, further
// clicks are ignored (with a visible ⏳) so a slow-rendering element can't be
// double-fired — but each finished click frees the next, so deliberate
// multi-step sequences still work.
let busy = false;
shot.addEventListener('click', async (e) => {
  if (busy) return;
  const p = toDevice(e);
  const tap = document.getElementById('tapmode').checked;
  busy = true;
  busyEl.classList.add('on');
  box.style.display = 'none'; // a prior highlight is stale the moment we act
  try {
    if (tap) {
      const hit = await (await fetch('/api/tap', { method: 'POST', body: JSON.stringify(p) })).json();
      // Instant textual confirmation BEFORE the (slower) mirror recapture.
      const warn = hit.warning ? ' <span class="why">(' + esc(hit.warning) + ')</span>' : '';
      out.insertAdjacentHTML('afterbegin', '<div class="cand">tapped: <span class="loc">' + esc(JSON.stringify(hit.tapped || hit.error)) + '</span>' + warn + '</div>');
      await refresh();
      return;
    }
    const hit = await (await fetch('/api/identify?x=' + p.x + '&y=' + p.y)).json();
    if (hit.error) { out.innerHTML = '<div class="cand native">' + esc(hit.error) + '</div>'; return; }
    const el = hit.element;
    const r = shot.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = (el.x * r.width / device.width) + 'px';
    box.style.top = (el.y * r.height / device.height) + 'px';
    box.style.width = (el.width * r.width / device.width) + 'px';
    box.style.height = (el.height * r.height / device.height) + 'px';
    renderHit(hit);
  } catch (err) {
    out.innerHTML = '<div class="cand native">' + esc(err && err.message || String(err)) + '</div>';
  } finally {
    busy = false;
    busyEl.classList.remove('on');
  }
});
// Renders the candidates and a Screen Object snippet. The snippet defaults to
// the recommended (first) locator, and switches when another candidate is
// clicked — so an intentional pick of a different identifier updates the code.
function renderHit(hit) {
  const el = hit.element, cands = hit.candidates;
  let html = '<div class="elmeta">' + esc(el.className) + ' · ' + el.width + '×' + el.height + (el.clickable ? ' · clickable' : '') + '</div>';
  if (el.frame) html += '<div class="cand native"><span class="tag warn">iframe</span> inside a same-origin iframe — identifiable, but tap-through can\\'t cross frames yet</div>';
  cands.forEach((c, i) => {
    const badge = (i === 0 ? '<span class="tag rec">recommended</span>' : '')
      + (c.unique === false ? '<span class="tag warn">matches ' + c.matchCount + '</span>'
         : c.unique === true ? '<span class="tag ok">unique</span>' : '');
    html += '<div class="cand' + (c.portable ? '' : ' native') + (i === 0 ? ' selected' : '') + '" data-i="' + i + '">'
      + '<div class="loc">' + esc(JSON.stringify(c.locator)) + badge + '</div>'
      + '<div class="why">' + esc(c.rationale) + '</div></div>';
  });
  html += '<div class="why" style="margin:10px 0 4px">Screen Object method — click a locator above to switch:</div>';
  html += '<pre id="snip" title="click to copy">' + esc(cands[0].snippet) + '</pre>';
  out.innerHTML = html;
  const snip = document.getElementById('snip');
  snip.onclick = () => { navigator.clipboard.writeText(snip.textContent); snip.classList.add('copied'); };
  for (const card of out.querySelectorAll('.cand[data-i]')) {
    card.onclick = () => {
      const i = +card.getAttribute('data-i');
      for (const other of out.querySelectorAll('.cand')) other.classList.remove('selected');
      card.classList.add('selected');
      snip.textContent = cands[i].snippet;
      snip.classList.remove('copied');
      navigator.clipboard.writeText(JSON.stringify(cands[i].locator));
    };
  }
}
document.getElementById('refresh').onclick = refresh;
document.getElementById('go').onclick = async () => {
  const to = document.getElementById('deeplink').value.trim();
  if (!to) return;
  meta.textContent = 'navigating…';
  await fetch('/api/navigate', { method: 'POST', body: JSON.stringify({ to }) });
  await refresh();
};
// Initial load can be slow (first screenshot of a heavy page); keep retrying
// until the mirror appears rather than showing a blank forever.
(async function boot() {
  for (let i = 0; i < 20; i++) {
    await refresh();
    if (device.width > 0) return;
    await new Promise(r => setTimeout(r, 2000));
  }
})();
</script></body></html>`;
