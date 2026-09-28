// Phone checks in headless Chrome over the DevTools protocol, like milestone-browser.mjs:
//   no-webgl2   getContext('webgl2') returns null; the start-problem card replaces the loading text
//   lost        a WebGL context lost after start shows the same card; restoring it hides the card
//   recover     Pixel 7 landscape: walk, lose the WebGL context mid-play, restore it; the game comes
//               back at the same place, as bright as before, and answers touch again
//   landscape   Pixel 7 landscape: Inspect, then tap Return (touch) and click Return (mouse)
//   phone-assets  Pixel 7 portrait and landscape fetch only the phone variants named in
//               assets/phone/manifest.json and decode no image over the caps; iPad mini and desktop
//               still fetch the originals
//   paused-loss Pixel 7 landscape, live loop: lose the context while walking; nothing moves while
//               the card is up and nothing jumps after restore
//   gpu         measurement only, never fails: Pixel 7 transfer bytes, Chrome renderer and GPU
//               process RSS peaks (Linux /proc), texture and renderbuffer bytes, renderer.info
//   render      Pixel 7 portrait, iPad mini and desktop still load and draw the scene
// Usage: node scripts/phone-browser.mjs --out=PATH [--dist=PATH] [--jobs=no-webgl2,lost,landscape,render]
// Exits 1 if any check fails. Serve only 127.0.0.1. Set TMPDIR to a local writable directory.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve } from './serve.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const jobs = String(args.jobs || 'no-webgl2,lost,recover,paused-loss,phone-assets,landscape,render,gpu').split(',');
const outDir = path.resolve(String(args.out || 'browser-out'));
const chrome = String(args.chrome || process.env.CHROME || 'google-chrome');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROFILES = {
  'pixel-portrait': { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, touch: true },
  'pixel-landscape': { width: 915, height: 412, deviceScaleFactor: 2.625, mobile: true, touch: true },
  'ipad-mini': { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true, touch: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, touch: false },
};
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36';

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    this.opened = new Promise((ok, bad) => { this.ws.onopen = ok; this.ws.onerror = bad; });
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, bad } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) bad(new Error(JSON.stringify(msg.error)));
        else ok(msg.result);
      } else if (msg.method) {
        for (const f of this.listeners) f(msg);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, bad) => this.pending.set(id, { ok, bad }));
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  }
}

async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-phone-chrome-'));
  const flags = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--window-size=1440,1100', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--use-angle=gl-egl', '--ignore-gpu-blocklist', 'about:blank'];
  const proc = spawn(chrome, flags, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((ok, bad) => {
    let buf = '';
    const t = setTimeout(() => bad(new Error('chrome did not start')), 30000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) { clearTimeout(t); ok(m[1]); }
    });
    proc.on('exit', (c) => bad(new Error(`chrome exited ${c}`)));
  });
  const port = new URL(wsUrl).port;
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.opened;
  return { proc, profile, cdp };
}

// A fresh page state per check: device profile, optional init script, console capture.
async function open(cdp, url, profileName, log, init = null) {
  const p = PROFILES[profileName];
  cdp.listeners.length = 0;
  cdp.listeners.push((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') log.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (msg.method === 'Network.requestWillBeSent') cdp.requests?.push(msg.params.request.url);
    if (msg.method === 'Network.loadingFinished' && cdp.bytes) cdp.bytes.total += msg.params.encodedDataLength;
    if (msg.method === 'Runtime.exceptionThrown') log.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  cdp.requests = []; cdp.bytes = { total: 0 };
  await sleep(200);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: p.width, height: p.height, deviceScaleFactor: p.deviceScaleFactor, mobile: p.mobile });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: p.touch, maxTouchPoints: p.touch ? 5 : 1 });
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: p.mobile ? ANDROID_UA : '' });
  if (cdp.initId) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: cdp.initId });
  cdp.initId = init ? (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: init })).identifier : null;
  await cdp.send('Page.navigate', { url });
}

async function waitReady(cdp, seconds = 90) {
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    const st = await cdp.eval('window.__dk ? { ready: window.__dk.ready, error: window.__dk.error } : null').catch(() => null);
    if (st?.ready) return (Date.now() - t0) / 1000;
    if (st?.error) throw new Error('page error: ' + st.error);
    await sleep(200);
  }
  throw new Error('page never became ready');
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(outDir, name);
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

// What a player can see: is the card displayed, is the loading text displayed, what does the card say.
const SCREEN = `(() => {
  const shown = (e) => Boolean(e) && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
  const card = document.getElementById('start-problem');
  const loading = document.getElementById('loading');
  const r = card ? card.getBoundingClientRect() : null;
  return { card: shown(card), loading: shown(loading) && loading.innerText.includes('Loading'),
    cardText: card ? card.innerText.replace(/\\s+/g, ' ').trim() : null, icons: card ? card.querySelectorAll('svg').length : 0,
    cardOnTop: r ? document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('#start-problem') !== null : false,
    error: window.__dk?.error ?? null };
})()`;

async function waitFor(cdp, expression, seconds) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < seconds * 1000) {
    last = await cdp.eval(expression).catch(() => null);
    if (last?.card && last.loading === false) return { ...last, seconds: (Date.now() - t0) / 1000 };
    await sleep(100);
  }
  return { ...last, seconds: null };
}

const NO_WEBGL2 = `(() => {
  const real = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (type === 'webgl2') return null;
    return real.call(this, type, ...rest);
  };
})();`;

async function noWebgl2(cdp, base) {
  const result = {};
  for (const profile of ['pixel-portrait', 'pixel-landscape']) {
    const log = [];
    await open(cdp, base + '/', profile, log, NO_WEBGL2);
    const screen = await waitFor(cdp, SCREEN, 5);
    const file = await shot(cdp, `no-webgl2-${profile}.png`);
    const checks = {
      card_within_5s: screen.seconds !== null,
      loading_text_gone: screen.loading === false,
      card_on_top: screen.cardOnTop === true,
      three_steps_with_icons: screen.icons === 3,
      error_logged: log.some((l) => l.startsWith('error:') && l.includes('WebGL')),
    };
    result[profile] = { checks, pass: Object.values(checks).every(Boolean), screen, file, console: log.slice(0, 8) };
  }
  return { ...result, pass: Object.values(result).every((r) => r.pass) };
}

async function lost(cdp, base) {
  const log = [];
  await open(cdp, base + '/', 'pixel-portrait', log);
  const ready = await waitReady(cdp);
  const before = await cdp.eval(SCREEN);
  await cdp.eval(`(() => { window.__lose = document.getElementById('view').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lose.loseContext(); })()`);
  const during = await waitFor(cdp, SCREEN, 5);
  const file = await shot(cdp, 'context-lost-pixel-portrait.png');
  await cdp.eval('window.__lose.restoreContext()');
  await sleep(1500);
  const after = await cdp.eval(SCREEN);
  const checks = {
    card_hidden_while_playing: before.card === false,
    card_shown_on_context_lost: during.seconds !== null,
    card_hidden_on_restore: after.card === false,
    error_logged: log.some((l) => l.startsWith('error:') && l.includes('context lost')),
  };
  return { checks, pass: Object.values(checks).every(Boolean), ready, before, during, after, file, console: log.slice(0, 8) };
}

// Mean brightness of the drawn frame, sampled in the same task as a render.
const FRAME = `(() => { const state = window.__dk.advance(1/60, 1);
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
  g.drawImage(document.getElementById('view'), 0, 0, 64, 64); const d = g.getImageData(0, 0, 64, 64).data;
  let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
  return { brightness: sum / (d.length / 4) / 3, x: state.x, y: state.y, mode: state.mode, inspect: state.inspect }; })()`;

async function recover(cdp, base) {
  const log = [];
  await open(cdp, base + '/?capture=1', 'pixel-landscape', log);
  const ready = await waitReady(cdp);
  const spawn = await cdp.eval(FRAME);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 300, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: 240, id: 1 }] });
  await cdp.eval('window.__dk.advance(1/60, 90)');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.eval('window.__dk.advance(1/60, 30)');
  const before = await cdp.eval(FRAME);
  await shot(cdp, 'recover-before-loss.png');
  await cdp.eval(`(() => { window.__lose = document.getElementById('view').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lose.loseContext(); })()`);
  const during = await waitFor(cdp, SCREEN, 5);
  const lostFile = await shot(cdp, 'recover-context-lost.png');
  await cdp.eval('window.__lose.restoreContext()');
  await sleep(2000);
  const after = await cdp.eval(FRAME);
  const screen = await cdp.eval(SCREEN);
  const restoredFile = await shot(cdp, 'recover-after-restore.png');
  const pos = await cdp.eval(`(() => { const r = document.getElementById('slide').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...pos, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const slid = await cdp.eval('window.__dk.advance(1/60, 1)');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 300, id: 3 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: 240, id: 3 }] });
  const moved = await cdp.eval('window.__dk.advance(1/60, 60)');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const checks = {
    walked_before_loss: Math.hypot(before.x - spawn.x, before.y - spawn.y) > 0.5,
    card_shown_while_lost: during.seconds !== null,
    card_hidden_after_restore: screen.card === false && screen.loading === false,
    same_place_after_restore: Math.hypot(after.x - before.x, after.y - before.y) < 0.05,
    as_bright_after_restore: Math.abs(after.brightness - before.brightness) <= before.brightness * 0.1,
    touch_slide_after_restore: slid.mode === 'slide',
    touch_walk_after_restore: Math.hypot(moved.x - after.x, moved.y - after.y) > 0.5,
  };
  return { checks, pass: Object.values(checks).every(Boolean), ready, before, during, after, slid: slid.mode,
    moved_m: Math.hypot(moved.x - after.x, moved.y - after.y), files: [lostFile, restoredFile], console: log.slice(0, 8) };
}

// Counts bytes each texture and renderbuffer allocation asks for (4 bytes a texel, times samples,
// times six for a cube map, every mip level). Cumulative: deletions are not subtracted.
const GPU_HOOK = `(() => {
  const P = WebGL2RenderingContext.prototype; const tally = window.__gpuBytes = { textures: 0, renderbuffers: 0, calls: 0 };
  const faces = (gl, target) => target === gl.TEXTURE_CUBE_MAP ? 6 : 1;
  const wrap = (name, count) => { const real = P[name]; P[name] = function (...a) { tally.calls++; try { count(this, a); } catch (e) {} return real.apply(this, a); }; };
  wrap('texStorage2D', (gl, [t, levels, , w, h]) => { for (let l = 0; l < levels; l++) tally.textures += Math.max(1, w >> l) * Math.max(1, h >> l) * 4 * faces(gl, t); });
  wrap('texStorage3D', (gl, [, levels, , w, h, d]) => { for (let l = 0; l < levels; l++) tally.textures += Math.max(1, w >> l) * Math.max(1, h >> l) * d * 4; });
  wrap('texImage2D', (gl, a) => { const w = a.length >= 8 ? a[3] : (a[5]?.width || 0); const h = a.length >= 8 ? a[4] : (a[5]?.height || 0); tally.textures += w * h * 4; });
  wrap('renderbufferStorage', (gl, [, , w, h]) => { tally.renderbuffers += w * h * 4; });
  wrap('renderbufferStorageMultisample', (gl, [, samples, , w, h]) => { tally.renderbuffers += w * h * 4 * Math.max(1, samples); });
})();`;

// Resident memory of this Chrome's renderer and GPU processes, from /proc (Linux only).
function chromeRss(profileDir) {
  const out = { renderer: 0, gpu: 0 };
  let pids = [];
  try { pids = execFileSync('pgrep', ['-f', profileDir]).toString().trim().split('\n'); } catch { return out; }
  for (const pid of pids) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      const kb = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] || 0);
      if (cmd.includes('--type=renderer')) out.renderer = Math.max(out.renderer, kb);
      if (cmd.includes('--type=gpu-process')) out.gpu = Math.max(out.gpu, kb);
    } catch {}
  }
  return out;
}

async function gpu(cdp, base, profileDir) {
  const result = {};
  for (const profile of ['pixel-portrait', 'pixel-landscape']) {
    const log = [];
    await cdp.send('Page.navigate', { url: 'about:blank' });
    await sleep(1500);
    const peak = { renderer: 0, gpu: 0 };
    let sampling = true;
    const sampler = (async () => { while (sampling) { const r = chromeRss(profileDir); peak.renderer = Math.max(peak.renderer, r.renderer); peak.gpu = Math.max(peak.gpu, r.gpu); await sleep(100); } })();
    await open(cdp, base + '/', profile, log, GPU_HOOK);
    const ready = await waitReady(cdp);
    await sleep(5000);
    sampling = false; await sampler;
    const m = await cdp.eval(`(() => { const d = window.__dk; const m = d.metrics(); const b = window.__gpuBytes;
      return { phone: d.phone ?? null, quality: d.quality ?? null, canvas: m.canvas, pixel_ratio: m.pixel_ratio,
        draw_calls_avg: m.draw_calls_avg, triangles_avg: m.triangles_avg,
        texture_mb: +(b.textures / 1048576).toFixed(1), renderbuffer_mb: +(b.renderbuffers / 1048576).toFixed(1),
        renderer_info: d.gpu ? d.gpu() : 'not exposed by this build' }; })()`);
    result[profile] = { ready, transfer_mb: +(cdp.bytes.total / 1e6).toFixed(2), rss_peak_mb: { renderer: +(peak.renderer / 1024).toFixed(0), gpu_process: +(peak.gpu / 1024).toFixed(0) }, ...m };
  }
  return { ...result, measurement: true, pass: true };
}

// Records the size of every image the page decodes: ImageBitmaps (GLTFLoader) and <img> (the sky).
const DECODE_HOOK = `(() => {
  const seen = window.__decoded = [];
  const cib = window.createImageBitmap;
  window.createImageBitmap = function (...a) { return cib.apply(this, a).then((b) => { seen.push({ kind: 'bitmap', width: b.width, height: b.height }); return b; }); };
  const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', { ...d, set(v) {
    this.addEventListener('load', () => seen.push({ kind: 'img', src: String(v).split('/').pop(), width: this.naturalWidth, height: this.naturalHeight }), { once: true });
    d.set.call(this, v); } });
})();`;

async function phoneAssets(cdp, base) {
  const manifest = await fetch(base + '/assets/phone/manifest.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const result = {};
  for (const profile of ['pixel-portrait', 'pixel-landscape', 'ipad-mini', 'desktop']) {
    const log = [];
    await open(cdp, base + '/', profile, log, DECODE_HOOK);
    const ready = await waitReady(cdp);
    const decoded = await cdp.eval('window.__decoded');
    const assets = cdp.requests.filter((u) => u.includes('/assets/')).map((u) => new URL(u).pathname.replace(/^\/assets\//, ''));
    const phoneProfile = PROFILES[profile].width < 600 || PROFILES[profile].height < 600;
    let checks;
    if (phoneProfile) {
      const expected = manifest ? Object.entries(manifest.files).map(([name, e]) => e.phone || name) : [];
      const replaced = manifest ? Object.entries(manifest.files).filter(([, e]) => e.phone).map(([name]) => name) : [];
      checks = {
        manifest_fetched: assets.includes('phone/manifest.json'),
        every_phone_variant_fetched: manifest !== null && expected.every((f) => assets.includes(f)),
        no_full_size_original_fetched: manifest !== null && replaced.every((f) => assets.includes(f) === false),
        decoded_textures_at_512: decoded.filter((d) => d.kind === 'bitmap').length > 0 && decoded.filter((d) => d.kind === 'bitmap').every((d) => Math.max(d.width, d.height) <= 512),
        decoded_sky_at_2048: decoded.some((d) => d.src === 'sky.jpg' && d.width === 2048),
      };
    } else {
      checks = {
        originals_fetched: ['ducky-ice.glb', 'ducky-helmet.glb', 'sky.jpg', 'set.glb', 'ship.glb'].every((f) => assets.includes(f)),
        no_phone_variant_fetched: assets.every((f) => f.startsWith('phone/') === false),
        sky_full_size: decoded.some((d) => d.src === 'sky.jpg' && d.width === 4096),
      };
    }
    result[profile] = { checks, pass: Object.values(checks).every(Boolean), ready, transfer_mb: +(cdp.bytes.total / 1e6).toFixed(2), assets, decoded };
  }
  return { ...result, pass: Object.values(result).filter((r) => typeof r === 'object').every((r) => r.pass) };
}

async function pausedLoss(cdp, base) {
  const log = [];
  const pos = () => cdp.eval('(() => { const s = window.__dk.state(); return { x: s.x, y: s.y, t: s.t, speed: s.speed }; })()');
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  await open(cdp, base + '/', 'pixel-landscape', log);
  const ready = await waitReady(cdp);
  await sleep(500);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 300, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: 230, id: 1 }] });
  await sleep(700);
  const walking = [await pos()]; await sleep(200); walking.push(await pos());
  await cdp.eval(`(() => { window.__lose = document.getElementById('view').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lose.loseContext(); })()`);
  const card = await waitFor(cdp, SCREEN, 5);
  const lostStart = await pos();
  await sleep(1500);
  const lostEnd = await pos();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.eval('window.__lose.restoreContext()');
  const after = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 1500) { after.push(await pos()); await sleep(30); }
  let maxStep = 0;
  for (let i = 1; i < after.length; i++) maxStep = Math.max(maxStep, dist(after[i], after[i - 1]));
  const checks = {
    was_walking_before_loss: dist(walking[1], walking[0]) > 0.1,
    card_shown: card.seconds !== null,
    no_movement_while_lost: dist(lostEnd, lostStart) < 1e-6 && lostEnd.t === lostStart.t,
    no_jump_on_restore: dist(after[0], lostEnd) < 0.1 && maxStep < 0.15,
    held_input_cleared: dist(after.at(-1), lostEnd) < 0.6,
  };
  return { checks, pass: Object.values(checks).every(Boolean), ready, walking_m: dist(walking[1], walking[0]),
    moved_while_lost_m: dist(lostEnd, lostStart), first_step_after_restore_m: dist(after[0], lostEnd), max_step_after_restore_m: maxStep,
    drift_after_restore_m: dist(after.at(-1), lostEnd), console: log.slice(0, 8) };
}

async function landscape(cdp, base) {
  const log = [];
  const center = (id) => cdp.eval(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2; const top = document.elementFromPoint(x, y);
    return { x, y, inViewport: y > 0 && y < innerHeight && x > 0 && x < innerWidth, topmost: top ? (top.id || top.tagName) : null, onTop: top?.closest('#' + ${JSON.stringify(id)}) !== null }; })()`);
  const tap = async (id) => {
    const pos = await center(id);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pos.x, y: pos.y, id: 7 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return { pos, state: await cdp.eval('window.__dk.advance(1/60,1)') };
  };
  const click = async (id) => {
    const pos = await center(id);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    return { pos, state: await cdp.eval('window.__dk.advance(1/60,1)') };
  };
  await open(cdp, base + '/?capture=1', 'pixel-landscape', log);
  const ready = await waitReady(cdp);
  const touchInspect = await tap('inspect');
  const inspectFile = await shot(cdp, 'landscape-inspecting.png');
  const touchReturn = await tap('exit');
  const touchFile = await shot(cdp, 'landscape-after-return-tap.png');
  const mouseInspect = await tap('inspect');
  const mouseReturn = await click('exit');
  const checks = {
    touch_inspect_opens: touchInspect.state.inspect === 'ducky',
    return_on_screen_and_on_top: touchReturn.pos.inViewport && touchReturn.pos.onTop,
    touch_return_closes: touchReturn.state.inspect === null,
    mouse_return_closes: mouseInspect.state.inspect === 'ducky' && mouseReturn.state.inspect === null,
  };
  return { checks, pass: Object.values(checks).every(Boolean), ready, return_button: touchReturn.pos,
    inspect: [touchInspect.state.inspect, touchReturn.state.inspect, mouseInspect.state.inspect, mouseReturn.state.inspect],
    files: [inspectFile, touchFile], console: log.slice(0, 8) };
}

// Draws the WebGL canvas into a small 2D canvas in the same task as a render and counts colours:
// a blank or failed canvas has one or two, the scene has many.
async function render(cdp, base) {
  const result = {};
  for (const profile of ['pixel-portrait', 'ipad-mini', 'desktop']) {
    const log = [];
    await open(cdp, base + '/', profile, log);
    const ready = await waitReady(cdp);
    await sleep(1500);
    const pixels = await cdp.eval(`(() => { window.__dk.advance(1/60, 1);
      const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
      g.drawImage(document.getElementById('view'), 0, 0, 64, 64); const d = g.getImageData(0, 0, 64, 64).data;
      const colours = new Set(); for (let i = 0; i < d.length; i += 4) colours.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3));
      return { colours: colours.size, webgl: window.__dk.webgl, phone: window.__dk.phone ?? null, pixel_ratio: window.__dk.metrics().pixel_ratio }; })()`);
    const file = await shot(cdp, `render-${profile}.png`);
    const screen = await cdp.eval(SCREEN);
    const checks = { ready: ready > 0, draws_scene: pixels.colours > 50, no_problem_card: screen.card === false, loading_gone: screen.loading === false };
    result[profile] = { checks, pass: Object.values(checks).every(Boolean), ready, pixels, file, errors: log.filter((l) => l.startsWith('error') || l.startsWith('exception')) };
  }
  return { ...result, pass: Object.values(result).every((r) => r.pass) };
}

const dist = path.resolve(String(args.dist || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dist')));
const server = await serve(dist, 0, '127.0.0.1');
const base = 'http://127.0.0.1:' + server.address().port;
const { proc, profile, cdp } = await launch();
const result = { dist, jobs: {} };
try {
  result.browser = (await cdp.send('Browser.getVersion')).product;
  for (const job of jobs) {
    const fn = { 'no-webgl2': noWebgl2, lost, recover, 'paused-loss': pausedLoss, 'phone-assets': phoneAssets, landscape, render, gpu }[job];
    if (fn === undefined) throw new Error('Unknown job: ' + job);
    result.jobs[job] = await fn(cdp, base, profile).catch((err) => ({ pass: false, error: String(err?.message || err) }));
    console.log(job, result.jobs[job].measurement ? 'MEASURED' : result.jobs[job].pass ? 'PASS' : 'FAIL');
  }
} finally {
  proc.kill('SIGKILL'); server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
result.pass = Object.values(result.jobs).every((j) => j.pass);
fs.writeFileSync(path.join(outDir, 'phone-browser.json'), JSON.stringify(result, null, 2) + '\n');
console.log(result.pass ? 'ALL PASS' : 'FAILED');
process.exit(result.pass ? 0 : 1);
