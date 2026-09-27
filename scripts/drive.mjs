// The headless drive: runs the game's own sim (src/sim.js) on the exported walk grid, with no
// browser. Ducky walks from his spawn to the hatch, then leans north into the hull for four
// seconds. Three checks: he moved at least 1 m, he never left the ice, and he stopped at the hull.
//
//   node scripts/drive.mjs                    collision on: all three pass, exit 0
//   node scripts/drive.mjs --collision=off    the planted control: the stop check must fail, exit 1

import fs from 'node:fs';
import { decodeGrid, circleHit, nearestHull } from '../src/grid.js';
import { createSim } from '../src/sim.js';
import { flowField } from '../src/autopilot.js';

export function loadGrid() {
  const url = new URL('../assets/collision.json', import.meta.url);
  return decodeGrid(JSON.parse(fs.readFileSync(url, 'utf8')));
}

export function runDrive({ collide = true, dt = 1 / 60, approachLimit = 20, push = 4 } = {}) {
  const grid = loadGrid();
  const sim = createSim(grid, { collide });
  const s = sim.state;
  const r = sim.tuning.radius;
  const start = [s.x, s.y];
  const [hx, hy] = grid.ship.hatch;
  const approach = [hx, hy - 1.4];
  const field = flowField(grid, approach[0], approach[1], r);
  let offIceSteps = 0;
  let insideSteps = 0;
  let hullContactT = null;
  let pushFrom = null;
  const trace = [];
  const history = [];
  let k = 0;
  while (true) {
    let input;
    if (pushFrom === null) {
      input = field.steer(s.x, s.y);
      if (Math.hypot(s.x - approach[0], s.y - approach[1]) < 0.25 || s.t >= approachLimit) pushFrom = s.t;
    }
    if (pushFrom !== null) {
      if (s.t - pushFrom >= push) break;
      input = { x: 0, y: 1 };
    }
    sim.step(dt, input);
    if (!sim.onIce(s.x, s.y)) offIceSteps++;
    if (circleHit(grid, s.x, s.y, r)) insideSteps++;
    if (s.contactHull && hullContactT === null) hullContactT = +s.t.toFixed(3);
    history.push([s.t, s.x, s.y]);
    if (k++ % 30 === 0) trace.push([+s.t.toFixed(2), +s.x.toFixed(3), +s.y.toFixed(3), s.mode]);
  }
  const end = [s.x, s.y];
  const last = history.filter(h => h[0] >= s.t - 2.0);
  const drift = Math.hypot(last[last.length - 1][1] - last[0][1], last[last.length - 1][2] - last[0][2]);
  const hullGap = nearestHull(grid, s.x, s.y, 3);
  const displacement = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const checks = {
    moved_at_least_1m: displacement >= 1.0,
    kept_on_ice: offIceSteps === 0,
    stopped_at_hull: hullContactT !== null && drift < 0.05 && insideSteps === 0 && hullGap <= r + 0.35,
  };
  return {
    collision: collide ? 'on' : 'off',
    start, end: end.map(v => +v.toFixed(3)),
    displacement_m: +displacement.toFixed(3),
    path_m: +s.distance.toFixed(3),
    seconds: +s.t.toFixed(2),
    push_started_s: pushFrom === null ? null : +pushFrom.toFixed(2),
    first_hull_contact_s: hullContactT,
    drift_last_2s_m: +drift.toFixed(4),
    steps_overlapping_obstacles: insideSteps,
    steps_off_ice: offIceSteps,
    nearest_hull_edge_m: Number.isFinite(hullGap) ? +hullGap.toFixed(3) : null,
    radius_m: r,
    hatch: [hx, hy],
    checks,
    pass: Object.values(checks).every(Boolean),
    trace,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const off = process.argv.includes('--collision=off');
  const out = runDrive({ collide: !off });
  const outArg = process.argv.find(a => a.startsWith('--out='));
  const { trace, ...summary } = out;
  console.log(JSON.stringify(summary, null, 1));
  for (const [name, ok] of Object.entries(out.checks)) console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (outArg) fs.writeFileSync(outArg.slice(6), JSON.stringify(out, null, 1));
  process.exitCode = out.pass ? 0 : 1;
}
