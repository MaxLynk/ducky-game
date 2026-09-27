// The built game in headless Chrome, driven over the DevTools protocol with Node's own
// WebSocket: no Playwright, no Puppeteer, no package at all. Serves dist/ on 127.0.0.1 and runs:
//   drive     hold W with real key events from the spawn: he must move, stay on the ice, stop at the hull
//   control   the same drive with ?collision=off, the planted control: the stop check must fail
//   metrics   the 30 s demo in real time at 1920x1080: fps, frame times, draw calls, triangles
//   capture   the demo stepped at 1/30 s for 900 frames, encoded to a 30 s mp4 with ffmpeg
//   outfits   stills of the bare-head export on the ice and the helmet export once the demo is aboard
// Every request the page makes is logged; anything off this origin fails the run.
//
//   node scripts/browser.mjs --out=DIR [--jobs=drive,control,metrics,capture] [--chrome=google-chrome]

import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve } from './serve.mjs';
import { loadGrid } from './drive.mjs';
import { circleHit, nearestHull } from '../src/grid.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const jobs = String(args.jobs || 'drive,control,metrics,capture').split(',');
const outDir = path.resolve(String(args.out || 'browser-out'));
const chrome = String(args.chrome || process.env.CHROME || 'google-chrome');
const W = 1920;
const H = 1080;
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-chrome-'));
  const GL = {
    egl: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
    gl: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'],
    vulkan: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
    swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  };
  const gpu = GL[String(args.gl || 'egl')];
  const flags = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', ...gpu, 'about:blank'];
  // --egl-vendor=FILE picks the EGL driver (a glvnd vendor json), for a machine with two GPUs
  const env = { ...process.env };
  if (args['egl-vendor']) env.__EGL_VENDOR_LIBRARY_FILENAMES = String(args['egl-vendor']);
  const proc = spawn(chrome, flags, { stdio: ['ignore', 'ignore', 'pipe'], env });
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

async function openPage(cdp, url, requests, consoleLog) {
  cdp.listeners.length = 0;
  cdp.listeners.push((msg) => {
    if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url);
    if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) consoleLog.push(`http ${msg.params.response.status} ${msg.params.response.url}`);
    if (msg.method === 'Network.loadingFailed') consoleLog.push(`failed ${msg.params.errorText}`);
    if (msg.method === 'Log.entryAdded') consoleLog.push(`log ${msg.params.entry.level}: ${msg.params.entry.text}`);
    if (msg.method === 'Runtime.consoleAPICalled') consoleLog.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (msg.method === 'Runtime.exceptionThrown') consoleLog.push(`exception: ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ''}`);
  });
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const st = await cdp.eval('window.__dk ? { ready: window.__dk.ready, error: window.__dk.error } : null').catch(() => null);
    if (st && st.error) throw new Error(`page error: ${st.error}`);
    if (st && st.ready) return (Date.now() - t0) / 1000;
    await sleep(250);
  }
  throw new Error(`page never became ready: ${consoleLog.slice(0, 12).join(' | ')}`);
}

async function key(cdp, type, code, keyName, vk) {
  await cdp.send('Input.dispatchKeyEvent', { type, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}

async function drive(cdp, base, collide, requests, consoleLog) {
  const grid = loadGrid();
  const url = `${base}/index.html${collide ? '' : '?collision=off'}`;
  const loadS = await openPage(cdp, url, requests, consoleLog);
  const s0 = await cdp.eval('window.__dk.state()');
  const samples = [];
  await key(cdp, 'keyDown', 'KeyW', 'w', 87);
  const t0 = Date.now();
  let hullAt = null;
  while (Date.now() - t0 < 16000) {
    await sleep(250);
    const s = await cdp.eval('window.__dk.state()');
    samples.push([+((Date.now() - t0) / 1000).toFixed(2), +s.x.toFixed(3), +s.y.toFixed(3), s.mode, s.contactHull]);
    if (s.contactHull && hullAt === null) hullAt = (Date.now() - t0) / 1000;
  }
  await key(cdp, 'keyUp', 'KeyW', 'w', 87);
  const s1 = await cdp.eval('window.__dk.state()');
  const r = 0.3;
  const last = samples.filter((p) => p[0] >= samples[samples.length - 1][0] - 2);
  const drift = Math.hypot(last[last.length - 1][1] - last[0][1], last[last.length - 1][2] - last[0][2]);
  const onIce = samples.every((p) => p[1] >= grid.x0 + r && p[1] <= grid.x1 - r && p[2] >= grid.y0 + r && p[2] <= grid.y1 - r);
  const inside = samples.filter((p) => circleHit(grid, p[1], p[2], r)).length;
  const gap = nearestHull(grid, s1.x, s1.y, 3);
  const moved = Math.hypot(s1.x - s0.x, s1.y - s0.y);
  const checks = {
    moved_at_least_1m: moved >= 1,
    kept_on_ice: onIce,
    stopped_at_hull: hullAt !== null && drift < 0.05 && inside === 0 && gap <= r + 0.35,
  };
  return {
    url, collision: collide ? 'on' : 'off', load_s: loadS, key: 'KeyW held 16 s (real key events)',
    start: [s0.x, s0.y], end: [+s1.x.toFixed(3), +s1.y.toFixed(3)], displacement_m: +moved.toFixed(3),
    first_hull_contact_s: hullAt, drift_last_2s_m: +drift.toFixed(4), samples_overlapping_obstacles: inside,
    nearest_hull_edge_m: Number.isFinite(gap) ? +gap.toFixed(3) : null, name_shown_at_end: s1.nameShown,
    checks, pass: Object.values(checks).every(Boolean), samples,
  };
}

async function metrics(cdp, base, requests, consoleLog) {
  const url = `${base}/index.html?demo=1&dpr=1`;
  const loadS = await openPage(cdp, url, requests, consoleLog);
  await sleep(1500);
  await cdp.eval('window.__dk.resetMetrics()');
  await sleep(20000);
  const m = await cdp.eval('window.__dk.metrics()');
  const meshes = await cdp.eval('window.__dk.meshes');
  return { url, load_s: loadS, viewport: [W, H], measured_s: 20, ...m, merged_meshes: meshes };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function capture(cdp, base, requests, consoleLog) {
  const url = `${base}/index.html?demo=1&capture=1&dpr=1`;
  const loadS = await openPage(cdp, url, requests, consoleLog);
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-frames-'));
  const stills = path.join(outDir, 'stills');
  fs.mkdirSync(stills, { recursive: true });
  const log = [];
  const t0 = Date.now();
  for (let f = 0; f < 900; f++) {
    const s = await cdp.eval('window.__dk.advance(1/30).t !== undefined && window.__dk.state()');
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, fromSurface: true });
    const buf = Buffer.from(shot.data, 'base64');
    fs.writeFileSync(path.join(frames, `f${String(f).padStart(4, '0')}.jpg`), buf);
    if (f % 150 === 0 || f === 899) fs.writeFileSync(path.join(stills, `t${String(Math.round(f / 30)).padStart(2, '0')}s.jpg`), buf);
    if (f % 30 === 0) log.push([+s.t.toFixed(2), +s.x.toFixed(2), +s.y.toFixed(2), s.mode, s.contactHull, s.nameShown]);
  }
  const grabS = (Date.now() - t0) / 1000;
  const mp4 = path.join(outDir, 'capture-30s.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', '30', '-i', path.join(frames, 'f%04d.jpg'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', mp4]);
  fs.rmSync(frames, { recursive: true, force: true });
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries',
    'stream=width,height,nb_read_frames,r_frame_rate:format=duration', '-of', 'json', mp4]).toString();
  return { url, load_s: loadS, frames: 900, step_s: 1 / 30, grab_s: grabS, file: mp4, bytes: fs.statSync(mp4).size,
    sha256: sha256(mp4), ffprobe: JSON.parse(probe), timeline: log };
}

async function preview(cdp, base, requests, consoleLog) {
  const url = `${base}/index.html?demo=1&capture=1&dpr=1`;
  const loadS = await openPage(cdp, url, requests, consoleLog);
  const shots = [];
  let t = 0;
  for (const at of [0.1, 3, 5.5, 7, 12, 19, 22, 29.9]) {
    const n = Math.max(1, Math.round((at - t) * 30));
    const s = await cdp.eval(`window.__dk.advance(1/30, ${n})`);
    t += n / 30;
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85, fromSurface: true });
    const f = path.join(outDir, `preview-${String(at).replace('.', 'p')}s.jpg`);
    fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
    shots.push([f, +s.t.toFixed(2), +s.x.toFixed(2), +s.y.toFixed(2), s.mode, s.nameShown]);
  }
  return { url, load_s: loadS, shots, webgl: await cdp.eval('window.__dk.webgl') };
}

// Ducky's two exports: bare-headed on the ice at the start, then the demo walks him aboard and the
// helmet export must be the one worn. Stills of each, in play and in the inspect view.
async function outfits(cdp, base, requests, consoleLog) {
  const url = `${base}/index.html?demo=1&capture=1&dpr=1`;
  const loadS = await openPage(cdp, url, requests, consoleLog);
  const shots = [];
  const snap = async (name) => {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const f = path.join(outDir, `outfit-${name}.png`);
    fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
    const s = await cdp.eval('window.__dk.state()');
    shots.push({ file: f, t: +s.t.toFixed(2), x: +s.x.toFixed(2), y: +s.y.toFixed(2), surface: s.surface, inside: s.inside, outfit: s.outfit, inspect: s.inspect, projectiles: s.projectiles.length, splats: s.splats });
  };
  let s = await cdp.eval('window.__dk.advance(1/30, 3)');
  await snap('ice-play');
  await cdp.eval("window.__dk.selectModel('ducky'); window.__dk.advance(1/30, 1)");
  await snap('ice-inspect');
  await cdp.eval('window.__dk.exitInspect(); window.__dk.advance(1/30, 1)');
  let n = 0;
  while (s.inside === false && n < 60 * 30) { s = await cdp.eval('window.__dk.advance(1/30, 15)'); n += 15; }
  s = await cdp.eval('window.__dk.advance(1/30, 30)');
  await snap('aboard-play');
  await cdp.eval("window.__dk.selectModel('ducky'); window.__dk.advance(1/30, 1)");
  await snap('aboard-inspect');
  const outfitsSeen = shots.map((x) => x.outfit);
  return { url, load_s: loadS, outfits: await cdp.eval('window.__dk.outfits'), shots,
    checks: { ice_first: outfitsSeen[0] === 'ice' && outfitsSeen[1] === 'ice', helmet_aboard: outfitsSeen[2] === 'helmet' && outfitsSeen[3] === 'helmet' } };
}

const server = await serve(path.resolve(String(args.dist || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dist'))), 0, '127.0.0.1');
const base = `http://127.0.0.1:${server.address().port}`;
const origin = new URL(base).origin;
const { proc, profile, cdp } = await launch();
const result = { base, chrome, gl: String(args.gl || 'egl'), egl_vendor: args['egl-vendor'] || null, jobs: {}, requests: [], off_origin: [], console: [] };
try {
  const version = await cdp.send('Browser.getVersion').catch(() => null);
  result.browser = version && version.product;
  for (const job of jobs) {
    const requests = [];
    const consoleLog = [];
    let r;
    if (job === 'drive') r = await drive(cdp, base, true, requests, consoleLog);
    else if (job === 'control') r = await drive(cdp, base, false, requests, consoleLog);
    else if (job === 'metrics') r = await metrics(cdp, base, requests, consoleLog);
    else if (job === 'capture') r = await capture(cdp, base, requests, consoleLog);
    else if (job === 'preview') r = await preview(cdp, base, requests, consoleLog);
    else if (job === 'outfits') r = await outfits(cdp, base, requests, consoleLog);
    else continue;
    r.requests = requests.length;
    r.console = consoleLog.slice(0, 40);
    result.jobs[job] = r;
    result.requests.push(...requests);
    fs.writeFileSync(path.join(outDir, `browser-${job}.json`), JSON.stringify(r, null, 1));
    const { samples, timeline, ...brief } = r;
    console.log(job, JSON.stringify(brief).slice(0, 900));
  }
} finally {
  cdp.ws.close();
  proc.kill('SIGTERM');
  server.close();
  await sleep(500);
  fs.rmSync(profile, { recursive: true, force: true });
}
result.off_origin = [...new Set(result.requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')))];
result.requests = [...new Set(result.requests.map((u) => u.replace(origin, '')))];
fs.writeFileSync(path.join(outDir, 'browser-run.json'), JSON.stringify(result, null, 1));
console.log('distinct requests', result.requests.length, 'off origin', result.off_origin.length, JSON.stringify(result.off_origin));
if (result.off_origin.length) process.exitCode = 1;
