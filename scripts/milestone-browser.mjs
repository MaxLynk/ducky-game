// Browser acceptance, real input events, wall-clock performance and a 60 second capture.
// Usage: node scripts/milestone-browser.mjs --out=PATH --jobs=verify,controls,metrics,capture
// Serve only 127.0.0.1. Set TMPDIR to a local writable temporary directory.
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve } from './serve.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const jobs = String(args.jobs || 'verify,metrics,capture').split(',');
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-game-chrome-'));
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

function save(name, value) { fs.writeFileSync(path.join(outDir, name), JSON.stringify(value, null, 2) + '\n'); }
async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, fromSurface: true });
  const file = path.join(outDir, name); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return file;
}
async function preview(cdp, base, requests, log) {
  await openPage(cdp, base + '/?demo=1&capture=1&dpr=1', requests, log);
  let t = 0; const result = [];
  for (const at of [0.5, 3, 5.8, 8.5, 24.9, 27.5, 29, 36, 43, 49, 54, 59.9]) {
    const n = Math.round((at - t) * 60); t += n / 60;
    const state = await cdp.eval('window.__dk.advance(1/60,' + n + ')');
    const file = await shot(cdp, 'preview-' + at + '.jpg');
    result.push({ t, file, state });
  }
  return result;
}
async function verify(cdp, base, requests, log) {
  await openPage(cdp, base + '/?demo=1&capture=1&dpr=1', requests, log);
  const states = [];
  for (let k = 0; k < 60; k++) states.push(await cdp.eval('window.__dk.advance(1/60,60)'));
  const end = states.at(-1);
  const checks = {
    belly_slide: states.some((s) => s.mode === 'slide' && s.speed > 3),
    rough_stops_slide: states.some((s) => s.surface === 'rough' && s.mode === 'stand' && s.speed < 0.1),
    target_splat: (end.hits || []).some((h) => h.kind === 'target'),
    ice_splat: (end.hits || []).some((h) => h.kind === 'ice'),
    hull_splat: (end.hits || []).some((h) => h.kind === 'hull'),
    door_open: end.door > 0.99,
    walked_inside: states.some((s) => s.inside && s.y > 25),
    cockpit_forward: states.some((s) => s.inside && s.x <= -17 && s.x >= -20),
    console_responds: end.consoleOn === true,
    inspect_orbits: states.some((s, i) => i > 0 && s.inspect && s.inspect === states[i - 1].inspect && Math.hypot(...s.camera.map((v, j) => v - states[i - 1].camera[j])) > 0.1),
  };
  return { checks, pass: Object.values(checks).every(Boolean), states, final: end };
}
async function metrics(cdp, base, requests, log) {
  await openPage(cdp, base + '/?demo=1&dpr=1', requests, log);
  await sleep(1500); await cdp.eval('window.__dk.resetMetrics()');
  await sleep(30000); await sleep(30000);
  const m = await cdp.eval('window.__dk.metrics()');
  return { ...m, viewport: [W, H], target_fps: 60, pass: m.fps >= 59 && m.frame_ms_p95 <= 18.5,
    note: 'Wall-clock requestAnimationFrame measurement. 59 fps threshold allows timer and 60 Hz quantization. Capture is measured separately.' };
}
async function capture(cdp, base, requests, log) {
  await openPage(cdp, base + '/?demo=1&capture=1&dpr=1', requests, log);
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-game-frames-'));
  const stills = path.join(outDir, 'stills'); fs.mkdirSync(stills, { recursive: true });
  const timeline = [];
  for (let f = 0; f < 1800; f++) {
    const s = await cdp.eval('window.__dk.advance(1/60,2)');
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, fromSurface: true });
    const buf = Buffer.from(r.data, 'base64');
    fs.writeFileSync(path.join(frames, 'f' + String(f).padStart(4, '0') + '.jpg'), buf);
    if ([89, 179, 254, 746, 824, 869, 1079, 1289, 1469, 1619, 1799].includes(f)) {
      fs.writeFileSync(path.join(stills, 't' + (f / 30).toFixed(1) + '.jpg'), buf);
    }
    if (f % 30 === 0) timeline.push(s);
    if (f % 300 === 0) console.log('capture seconds', f / 30);
  }
  const file = path.join(outDir, 'ducky-game-60s-1080p.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', '30', '-i', path.join(frames, 'f%04d.jpg'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'fast', '-movflags', '+faststart', file]);
  fs.rmSync(frames, { recursive: true, force: true });
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries',
    'stream=width,height,nb_read_frames,r_frame_rate:format=duration', '-of', 'json', file]).toString());
  return { file, probe, timeline, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    note: 'Real browser frames, deterministic 1/60 simulation steps, encoded at 30 fps. This capture is not the performance benchmark.' };
}

const server = await serve(path.resolve(String(args.dist || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dist'))), 0, '127.0.0.1');
const base = 'http://127.0.0.1:' + server.address().port;
const { proc, profile, cdp } = await launch();
const result = { base, jobs: {}, requests: [], console: [] };
try {
  result.browser = (await cdp.send('Browser.getVersion')).product;
  for (const job of jobs) {
    const requests = [], log = [];
    const fn = { preview, verify, metrics, capture, controls }[job];
    if (fn === undefined) throw new Error('Unknown job: ' + job);
    const r = await fn(cdp, base, requests, log);
    result.jobs[job] = r; result.requests.push(...requests); result.console.push(...log);
    save('browser-' + job + '.json', r);
    console.log(job, JSON.stringify(r.checks || { pass: r.pass, fps: r.fps, file: r.file }));
  }
} finally {
  cdp.ws.close(); proc.kill('SIGTERM'); server.close(); await sleep(500);
  fs.rmSync(profile, { recursive: true, force: true });
}
result.off_origin = [...new Set(result.requests.filter((u) => u.startsWith(base) === false && u.startsWith('data:') === false && u.startsWith('blob:') === false))];
result.requests = [...new Set(result.requests.map((u) => u.replace(base, '')))];
save('browser-run.json', result);
const failed = Object.values(result.jobs).some((r) => r.pass === false) || result.off_origin.length > 0;
if (failed) process.exitCode = 1;

async function controls(cdp, base, requests, log) {
  await openPage(cdp, base + '/?capture=1&dpr=1', requests, log);
  const start = await cdp.eval('window.__dk.state()');
  await key(cdp, 'keyDown', 'KeyW', 'w', 87);
  const walked = await cdp.eval('window.__dk.advance(1/60,120)');
  await key(cdp, 'keyUp', 'KeyW', 'w', 87);
  await key(cdp, 'keyDown', 'Space', ' ', 32);
  const sliding = await cdp.eval('window.__dk.advance(1/60,1)');
  await key(cdp, 'keyUp', 'Space', ' ', 32);
  await key(cdp, 'keyDown', 'KeyF', 'f', 70);
  const thrown = await cdp.eval('window.__dk.advance(1/60,1)');
  await key(cdp, 'keyUp', 'KeyF', 'f', 70);
  await key(cdp, 'keyDown', 'KeyV', 'v', 86);
  const inspecting = await cdp.eval('window.__dk.advance(1/60,1)');
  await key(cdp, 'keyUp', 'KeyV', 'v', 86);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 900, y: 450, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1130, y: 480, button: 'left', buttons: 1 });
  const orbit = await cdp.eval('window.__dk.advance(1/60,1)');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1130, y: 480, button: 'left', clickCount: 1 });
  const checks = {
    keyboard_walk: walked.y > start.y + 2,
    keyboard_slide: sliding.mode === 'slide', keyboard_throw: thrown.projectiles.length === 1,
    keyboard_inspect: inspecting.inspect === 'ducky', mouse_orbit: Math.hypot(...orbit.camera.map((v, i) => v - inspecting.camera[i])) > 1,
  };
  await openPage(cdp, base + '/?capture=1&dpr=1', requests, log);
  for (const [code, name, vk, frames] of [['KeyW', 'w', 87, 1200], ['KeyS', 's', 83, 70], ['KeyA', 'a', 65, 85]]) {
    await key(cdp, 'keyDown', code, name, vk);
    await cdp.eval('window.__dk.advance(1/60,' + frames + ')');
    await key(cdp, 'keyUp', code, name, vk);
  }
  await key(cdp, 'keyDown', 'KeyW', 'w', 87);
  const closedDoor = await cdp.eval('window.__dk.advance(1/60,240)');
  await key(cdp, 'keyUp', 'KeyW', 'w', 87);
  await key(cdp, 'keyDown', 'KeyE', 'e', 69);
  await cdp.eval('window.__dk.advance(1/60,1)');
  await key(cdp, 'keyUp', 'KeyE', 'e', 69);
  const openDoor = await cdp.eval('window.__dk.advance(1/60,90)');
  await key(cdp, 'keyDown', 'KeyW', 'w', 87);
  const entered = await cdp.eval('window.__dk.advance(1/60,180)');
  await key(cdp, 'keyUp', 'KeyW', 'w', 87);
  await key(cdp, 'keyDown', 'KeyS', 's', 83);
  const exited = await cdp.eval('window.__dk.advance(1/60,240)');
  await key(cdp, 'keyUp', 'KeyS', 's', 83);
  checks.closed_door_stops_keyboard_walk = closedDoor.y < 20.5 && closedDoor.y > 19;
  checks.keyboard_use_opens_door = openDoor.door > 0.99;
  checks.keyboard_walks_through_door = entered.inside;
  checks.keyboard_can_exit = exited.inside === false;
  await openPage(cdp, base + '/?capture=1&dpr=1', requests, log);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 90, y: 600, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 90, y: 540, id: 1 }] });
  const touchWalk = await cdp.eval('window.__dk.advance(1/60,90)');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  async function tap(id) {
    const pos = await cdp.eval('(()=>{ const r=document.getElementById(' + JSON.stringify(id) + ').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...pos, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return cdp.eval('window.__dk.advance(1/60,1)');
  }
  const touchSlide = await tap('slide');
  const touchThrow = await tap('throw');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 350, id: 3 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 255, y: 390, id: 3 }] });
  const touchLook = await cdp.eval('window.__dk.advance(1/60,1)');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  const touchInspect = await tap('inspect');
  await shot(cdp, 'touch-390x844.jpg');
  checks.touch_look = Math.abs(touchLook.camYaw - touchThrow.camYaw) > 0.2;
  checks.touch_walk = touchWalk.y > 1.8;
  checks.touch_slide = touchSlide.mode === 'slide';
  checks.touch_throw = touchThrow.projectiles.length === 1;
  checks.touch_inspect = touchInspect.inspect === 'ducky';
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  return { checks, pass: Object.values(checks).every(Boolean), keyboard: { walked, sliding, thrown, inspecting, orbit, closedDoor, openDoor, entered, exited }, touch: { viewport: [390, 844], touchWalk, touchSlide, touchThrow, touchLook, touchInspect } };
}
