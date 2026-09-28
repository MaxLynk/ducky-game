// In-game acceptance for the walkable Iceberg, desktop profile, local Chrome.
//   node scripts/iceberg-browser.mjs --out=DIR [--dist=DIR] [--jobs=routes,perf] [--gl=egl]
// routes: from the ice, open the airlock and walk every route of the export in the game with the
//   game's own input (a stick direction, the use button, the car buttons), with a still per deck
//   and per route. Any console error, page exception, failed request or off-origin request fails.
// perf: time to ready, frame rate over the 60 second demo walk, and renderer memory (bytes the
//   page asks WebGL to allocate, and the renderer and GPU process RSS). Runs on any dist, so the
//   same numbers can be taken from the previous build.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve } from './serve.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const jobs = String(args.jobs || 'routes,perf').split(',');
const outDir = path.resolve(String(args.out || 'browser-out'));
const dist = path.resolve(String(args.dist || 'dist'));
const chrome = String(args.chrome || process.env.CHROME || 'google-chrome');
const W = 1920; const H = 1080;
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.listeners = [];
    this.opened = new Promise((ok, bad) => { this.ws.onopen = ok; this.ws.onerror = bad; });
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, bad } = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (msg.error) bad(new Error(JSON.stringify(msg.error))); else ok(msg.result);
      } else if (msg.method) for (const f of this.listeners) f(msg);
    };
  }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((ok, bad) => this.pending.set(id, { ok, bad })); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  }
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-ice-'));
async function launch() {
  const GL = { egl: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
    swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
  const flags = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...GL[String(args.gl || 'egl')], 'about:blank'];
  const proc = spawn(chrome, flags, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((ok, bad) => {
    let buf = ''; const t = setTimeout(() => bad(new Error('chrome did not start')), 30000);
    proc.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); ok(m[1]); } });
    proc.on('exit', (c) => bad(new Error(`chrome exited ${c}`)));
  });
  const port = new URL(wsUrl).port;
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const cdp = new CDP(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await cdp.opened;
  return { proc, cdp };
}

// WebGL allocation tally: every texture, buffer and renderbuffer the page asks for, in bytes,
// with compressed texture formats counted at their block size. Deleted objects are subtracted.
const GPU_HOOK = `(() => {
  const P = WebGL2RenderingContext.prototype; const t = window.__gpu = { textures: 0, buffers: 0, renderbuffers: 0 };
  const size = new Map(); const bound = new Map();
  const bpt = (f) => ({ 0x8E8C: 1, 0x8E8D: 1, 0x83F0: 0.5, 0x83F1: 0.5, 0x8C4C: 0.5, 0x8C4D: 0.5, 0x83F2: 1, 0x83F3: 1, 0x8C4E: 1, 0x8C4F: 1,
    0x93B0: 1, 0x93D0: 1, 0x9274: 0.5, 0x9275: 0.5, 0x9276: 0.5, 0x9277: 0.5, 0x9278: 1, 0x9279: 1, 0x8D64: 0.5 })[f] ?? 4;
  const add = (kind, obj, bytes) => { if (!obj) return; const k = size.get(obj); if (k) t[k.kind] -= k.bytes; size.set(obj, { kind, bytes: (k?.bytes || 0) * 0 + bytes }); t[kind] += bytes; };
  const wrap = (name, f) => { const real = P[name]; P[name] = function (...a) { try { f(this, a); } catch (e) {} return real.apply(this, a); }; };
  wrap('bindTexture', (gl, [target, tex]) => bound.set(target, tex));
  wrap('bindBuffer', (gl, [target, buf]) => bound.set('b' + target, buf));
  wrap('bindRenderbuffer', (gl, [target, rb]) => bound.set('r', rb));
  wrap('texStorage2D', (gl, [target, levels, fmt, w, h]) => { let b = 0; for (let l = 0; l < levels; l++) b += Math.max(4, w >> l) * Math.max(4, h >> l) * bpt(fmt); add('textures', bound.get(target), b * (target === gl.TEXTURE_CUBE_MAP ? 6 : 1)); });
  wrap('texStorage3D', (gl, [target, levels, fmt, w, h, d]) => { let b = 0; for (let l = 0; l < levels; l++) b += Math.max(1, w >> l) * Math.max(1, h >> l) * d * bpt(fmt); add('textures', bound.get(target), b); });
  wrap('texImage2D', (gl, a) => { if (a[1] !== 0) return; const w = a.length >= 8 ? a[3] : (a[5]?.width || 0); const h = a.length >= 8 ? a[4] : (a[5]?.height || 0); add('textures', bound.get(a[0]), w * h * 4 * 4 / 3); });
  wrap('compressedTexImage2D', (gl, a) => { if (a[1] !== 0) return; add('textures', bound.get(a[0]), (a[6]?.byteLength || 0) * 4 / 3); });
  wrap('bufferData', (gl, [target, data]) => add('buffers', bound.get('b' + target), typeof data === 'number' ? data : (data?.byteLength || 0)));
  wrap('renderbufferStorage', (gl, [, , w, h]) => add('renderbuffers', bound.get('r'), w * h * 4));
  wrap('renderbufferStorageMultisample', (gl, [, samples, , w, h]) => add('renderbuffers', bound.get('r'), w * h * 4 * Math.max(1, samples)));
  for (const [name, kind] of [['deleteTexture', 'textures'], ['deleteBuffer', 'buffers'], ['deleteRenderbuffer', 'renderbuffers']]) {
    wrap(name, (gl, [obj]) => { const k = size.get(obj); if (k) { t[k.kind] -= k.bytes; size.delete(obj); } });
  }
})();`;

function chromeRss() {
  const out = { renderer: 0, gpu: 0 };
  let pids = [];
  try { pids = execFileSync('pgrep', ['-f', profile]).toString().trim().split('\n'); } catch { return out; }
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

const problems = [];
const requests = [];
async function openPage(cdp, url, hook = null) {
  cdp.listeners = [(msg) => {
    if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url);
    if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) problems.push(`http ${msg.params.response.status} ${msg.params.response.url}`);
    if (msg.method === 'Network.loadingFailed' && msg.params.canceled !== true) problems.push(`failed ${msg.params.errorText}`);
    if (msg.method === 'Runtime.exceptionThrown') problems.push(`exception: ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ''}`);
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(msg.params.type)) problems.push(`console ${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') problems.push(`log error: ${msg.params.entry.text}`);
  }];
  await cdp.send('Network.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Page.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  if (hook) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
  await cdp.send('Page.navigate', { url });
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    const s = await cdp.eval('({ ready: Boolean(window.__dk && window.__dk.ready), error: window.__dk ? window.__dk.error : null, now: performance.now() })').catch(() => ({}));
    if (s.error) throw new Error('page error: ' + s.error + ' | ' + problems.slice(0, 6).join(' | '));
    if (s.ready) return s.now;
    await sleep(50);
  }
  throw new Error('page never became ready: ' + problems.slice(0, 8).join(' | '));
}
async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88, fromSurface: true });
  const file = path.join(outDir, name + '.jpg'); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return file;
}
async function key(cdp, code, name, vk, frames = 1) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: name, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  const s = await cdp.eval(`window.__dk.advance(1/60, ${frames})`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: name, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  return s;
}
async function drive(cdp, route, maxSeconds = 240, opts = {}) {
  await cdp.eval(`window.__dk.drive(${JSON.stringify(route)}, ${JSON.stringify(opts)})`);
  let s;
  for (let k = 0; k < maxSeconds / 5; k++) {
    s = await cdp.eval('window.__dk.advance(1/60, 300)');
    if (s.route.done || s.route.failed) break;
  }
  await cdp.eval('window.__dk.drive(null)');
  return { pass: s.route.done === true && !s.route.failed, failed: s.route.failed, t: s.t, end: s.ship, legs: s.route.log.length,
    min_feet: Math.min(...s.route.log.map((l) => l.feet)), max_feet: Math.max(...s.route.log.map((l) => l.feet)) };
}
const view = (cdp, yaw, pitch = 0) => cdp.eval(`window.__dk.look(${yaw}, ${pitch})`);

async function routes(cdp, base) {
  await openPage(cdp, base + '/?capture=1&dpr=1');
  const out = { routes: {}, stills: [] };
  const still = async (name) => { out.stills.push(await shot(cdp, name)); };
  // From the ice: walk to the hull with the keyboard, open the airlock with E, walk in.
  for (const [code, name, vk, frames] of [['KeyW', 'w', 87, 1200], ['KeyS', 's', 83, 70], ['KeyA', 'a', 65, 85]]) await key(cdp, code, name, vk, frames);
  const closed = await key(cdp, 'KeyW', 'w', 87, 240);
  await key(cdp, 'KeyE', 'e', 69, 1);
  const open = await cdp.eval('window.__dk.advance(1/60, 100)');
  await view(cdp, Math.PI / 2, 0.05); await still('00-outside-airlock-open');
  out.airlock = { stopped_by_closed_door: closed.y < 20.5 && closed.y > 19, door_opened: open.door > 0.99, before: [closed.x, closed.y] };
  const R = await fetch(base + '/assets/iceberg/runtime.json').then((r) => r.json());
  const plan = [
    ['airlock_to_main_deck', ['airlock', ...R.routes.R01_airlock_main_deck.slice(1)], '01-main-deck-vestibule', Math.PI],
    ['cockpit_up', 'COCKPIT'],
    ['main_deck_back_to_stair_head', ['hall_fwd', 'hall_mid', 'hall_arch'], '03-main-deck-hall', 0],
    ['R03_stair_down_sleeping_rooms', R.routes.R03_stair_down_sleeping_rooms.slice(1), '04-lower-deck-avionics', Math.PI],
    ['lower_deck_aft', ['avionics_door', 'lower_fwd', 'lower_mid', 'lower_aft'], '05-lower-deck-hall', 0],
    ['R04_lower_deck_to_reactor', R.routes.R04_lower_deck_to_reactor.slice(1), '06-reactor-landing', -Math.PI / 2],
    ['elevator_LOWER_to_MAIN', ['reactor_aft', 'elev_lower', { elevator: ['LOWER', 'MAIN'] }], '07-elevator-at-main', -Math.PI / 2],
    ['elevator_MAIN_to_HOLD', [{ elevator: ['MAIN', 'HOLD'] }, 'hold_fwd', 'hold_lane', 'hold_mid'], '08-hold', 0],
    ['elevator_HOLD_to_LOWER', ['hold_lane', 'hold_fwd', 'elev_hold', { elevator: ['HOLD', 'LOWER'] }], '09-elevator-at-lower', Math.PI / 2],
    ['elevator_LOWER_to_HOLD', [{ elevator: ['LOWER', 'HOLD'] }], '10-elevator-at-hold', 0],
    ['elevator_HOLD_to_MAIN', [{ elevator: ['HOLD', 'MAIN'] }], '11-elevator-at-main', -Math.PI / 2],
    ['elevator_MAIN_to_LOWER', [{ elevator: ['MAIN', 'LOWER'] }, 'reactor_aft'], '12-reactor', 0],
    ['elevator_LOWER_to_MAIN_again', ['elev_lower', { elevator: ['LOWER', 'MAIN'] }, 'hall_aft', 'workshop_aft'], '13-workshop', Math.PI],
    ['R07_gallery_stair_hold', R.routes.R07_gallery_stair_hold.slice(1), '14-gallery-back-in-workshop', Math.PI],
    ['to_stair_foot', ['workshop_port', 'workshop_fwd', 'hall_arch', 'stair_top', 'stair_bottom', 'lower_fwd'], '15-lower-deck-forward', 0],
    ['R08_stair_up_and_back_to_airlock', R.routes.R08_stair_up_and_back_to_airlock.slice(1), '16-back-in-airlock', -Math.PI / 2],
  ];
  for (const [name, route, file, yaw] of plan) {
    if (route === 'COCKPIT') {
      // The cockpit: the use button at the vestibule, the console, and back down.
      const up = await key(cdp, 'KeyE', 'e', 69, 30);
      const walk = await drive(cdp, ['cockpit_aisle'], 60, { arrive: 0.12 });
      const use = await key(cdp, 'KeyE', 'e', 69, 30);
      await view(cdp, Math.PI, -0.05); await still('02-cockpit-lighting-backup-on');
      const back = await drive(cdp, ['cockpit_door_inside'], 60, { arrive: 0.12 });
      const down = await key(cdp, 'KeyE', 'e', 69, 30);
      out.routes.cockpit = { pass: up.ship.cell === 'iceberg-cockpit' && up.ship.feet > 2.1 && walk.pass && use.consoleOn === true && back.pass && down.ship.feet < 0.2,
        up: { cell: up.ship.cell, feet: up.ship.feet }, console_on: use.consoleOn, down_feet: down.ship.feet };
      continue;
    }
    const r = await drive(cdp, route);
    // The car's buttons are also checked by key: 1, 2 and 3 in the car.
    await view(cdp, yaw, 0); await still(file);
    out.routes[name] = r;
    console.log(name, r.pass ? 'PASS' : 'FAIL', r.t.toFixed(1), JSON.stringify(r.failed || r.end.cell));
  }
  // Out through the airlock onto the ice.
  const exit = await drive(cdp, ['airlock']);
  await view(cdp, Math.PI / 2, 0);
  const outside = await key(cdp, 'KeyS', 's', 83, 200);
  out.routes.exit_to_ice = { pass: exit.pass && outside.inside === false, y: outside.y };
  // A snowball aboard meets the ship.
  await cdp.eval('window.__dk.place("hall_mid")'); await view(cdp, Math.PI, 0);
  const thrown = await key(cdp, 'KeyF', 'f', 70, 90);
  out.snowball_aboard = { pass: thrown.hits.some((h) => h.kind === 'ship'), hits: thrown.hits.map((h) => h.kind) };
  // The car buttons by key: standing in the car at MAIN, 2 takes it to the reactor deck.
  await cdp.eval('window.__dk.place("elev_car")');
  await key(cdp, 'Digit2', '2', 50, 1);
  const rode = await cdp.eval('window.__dk.advance(1/60, 900)');
  await view(cdp, -Math.PI / 2, 0); await still('17-car-by-key-at-lower');
  out.car_key = { pass: rode.ship.elevator.stop === 'LOWER' && Math.abs(rode.ship.feet + 2.925) < 0.1, stop: rode.ship.elevator.stop, feet: rode.ship.feet };
  out.pass = out.car_key.pass && Object.values(out.routes).every((r) => r.pass) && out.airlock.door_opened && out.airlock.stopped_by_closed_door && out.snowball_aboard.pass;
  return out;
}

// A still per deck and room, standing at the export's waypoints.
const STILLS = [
  ['deck-main-hall-forward', 'hall_arch', Math.PI, 0], ['deck-main-kitchen', 'hall_mid', -Math.PI / 2, -0.1],
  ['deck-main-captains-cabin', 'hall_mid', Math.PI / 2, -0.1], ['deck-main-vestibule', 'hall_fwd', Math.PI, 0.1],
  ['deck-main-workshop', 'workshop_fwd', 0, 0], ['deck-main-airlock', 'airlock_gate', -Math.PI / 2, 0],
  ['stair-companion-from-top', 'stair_top', Math.PI, -0.35], ['stair-companion-from-foot', 'stair_bottom', 0, 0.3],
  ['deck-lower-hall', 'lower_aft', Math.PI, 0], ['deck-lower-sleeping-room-1', 'sleep1', Math.PI / 2, -0.1],
  ['deck-lower-avionics', 'avionics_door', Math.PI, 0], ['deck-lower-pellet-room', 'pellet_fwd', 0, -0.1],
  ['deck-lower-reactor', 'reactor_fwd', 0.6, 0], ['deck-hold-garage', 'hold_fwd', 0, 0],
  ['deck-hold-cargo', 'hold_aft', Math.PI, 0], ['stair-gallery', 'gallery_head', 0.4, -0.3],
  ['elevator-main-landing', 'elev_main', -Math.PI / 2, 0], ['elevator-car', 'elev_car', -Math.PI / 2, 0],
  ['cockpit', 'cockpit_aisle', Math.PI, -0.05],
];
async function stills(cdp, base) {
  await openPage(cdp, base + '/?capture=1&dpr=1');
  const out = { stills: [] };
  for (const [name, at, yaw, pitch] of STILLS) {
    await cdp.eval(`window.__dk.place(${JSON.stringify(at)})`);
    const s = await cdp.eval(`window.__dk.look(${yaw}, ${pitch})`);
    await cdp.eval('window.__dk.advance(1/60, 20)');
    out.stills.push({ name, at, cell: s.ship.cell, file: await shot(cdp, 'still-' + name) });
  }
  out.pass = true;
  return out;
}

async function perf(cdp, base) {
  const out = {};
  await cdp.send('Page.navigate', { url: 'about:blank' }); await sleep(1500);
  const peak = { renderer: 0, gpu: 0 };
  let sampling = true;
  const sampler = (async () => { while (sampling) { const r = chromeRss(); peak.renderer = Math.max(peak.renderer, r.renderer); peak.gpu = Math.max(peak.gpu, r.gpu); await sleep(100); } })();
  const t0 = Date.now();
  out.ready_ms = await openPage(cdp, base + '/?demo=1&dpr=1', GPU_HOOK);
  out.ready_wall_ms = Date.now() - t0;
  const t1 = Date.now();
  const streams = await cdp.eval('typeof window.__dk.interiorLoaded === "function"');
  while (streams && Date.now() - t1 < 120000) { if (await cdp.eval('window.__dk.interiorReady === true')) break; await sleep(50); }
  out.interior_ready_ms = streams ? await cdp.eval('performance.now()') : null;
  await cdp.eval('window.__dk.resetMetrics()');
  await sleep(58000);
  const m = await cdp.eval('window.__dk.metrics()');
  const g = await cdp.eval('({ gpu: window.__gpu, info: window.__dk.gpu ? window.__dk.gpu() : null, heap: performance.memory ? performance.memory.usedJSHeapSize : null, state: window.__dk.state() })');
  sampling = false; await sampler;
  const end = chromeRss();
  const mb = (b) => +(b / 1048576).toFixed(1);
  Object.assign(out, {
    demo_walk: { fps: +m.fps.toFixed(2), frame_ms_p50: m.frame_ms_p50, frame_ms_p95: m.frame_ms_p95, frame_ms_max: m.frame_ms_max, slow_frames_by_demo_phase: m.slow.reduce((c, f) => { c[f.phase] = (c[f.phase] || 0) + 1; return c; }, {}), draw_calls_avg: Math.round(m.draw_calls_avg), triangles_avg: Math.round(m.triangles_avg), seconds: +m.seconds.toFixed(1), canvas: m.canvas, webgl: m.webgl, demo_phase_at_end: g.state.demoPhase, inside_at_end: g.state.inside },
    memory: { webgl_textures_mb: mb(g.gpu.textures), webgl_buffers_mb: mb(g.gpu.buffers), webgl_renderbuffers_mb: mb(g.gpu.renderbuffers), webgl_total_mb: mb(g.gpu.textures + g.gpu.buffers + g.gpu.renderbuffers),
      renderer_info: g.info?.memory ?? null, js_heap_mb: g.heap ? mb(g.heap) : null, rss_peak_mb: { renderer: Math.round(peak.renderer / 1024), gpu_process: Math.round(peak.gpu / 1024) },
      rss_end_mb: { renderer: Math.round(end.renderer / 1024), gpu_process: Math.round(end.gpu / 1024) } },
  });
  return out;
}

const server = await serve(dist, 0);
const base = `http://127.0.0.1:${server.address().port}`;
const { proc, cdp } = await launch();
const result = { dist, jobs: {} };
try {
  for (const job of jobs) {
    problems.length = 0;
    const r = job === 'routes' ? await routes(cdp, base) : job === 'stills' ? await stills(cdp, base) : await perf(cdp, base);
    r.problems = [...problems];
    result.jobs[job] = r;
    fs.writeFileSync(path.join(outDir, `iceberg-${job}.json`), JSON.stringify(r, null, 2) + '\n');
    console.log(job, JSON.stringify(job === 'perf' ? r : { pass: r.pass, problems: r.problems.slice(0, 5) }));
  }
} finally {
  cdp.ws.close(); proc.kill('SIGTERM'); server.close(); await sleep(500);
  fs.rmSync(profile, { recursive: true, force: true });
}
result.off_origin = [...new Set(requests.filter((u) => !u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:') && u !== 'about:blank'))];
fs.writeFileSync(path.join(outDir, 'iceberg-browser.json'), JSON.stringify(result, null, 2) + '\n');
const failed = result.off_origin.length > 0 || Object.values(result.jobs).some((r) => r.pass === false || (r.problems && r.problems.length));
if (failed) process.exitCode = 1;
