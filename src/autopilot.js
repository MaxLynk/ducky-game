// Scripted drivers that feed the same input the keyboard and the touch stick feed: one for the
// headless drive test, one for the 30 second demo and capture. Pure JS, no three.js.

import { circleHit } from './grid.js';

// Head for (tx, ty), sidestepping small obstacles such as the sleeping colony. Within `direct`
// metres of the target it stops sidestepping and pushes straight on, so it will lean on a hull.
export function steerToward(grid, s, tx, ty, opts = {}) {
  const r = (opts.radius ?? 0.3) + 0.08;
  const direct = opts.direct ?? 1.8;
  const want = Math.atan2(ty - s.y, tx - s.x);
  if (Math.hypot(tx - s.x, ty - s.y) < direct) return { x: Math.cos(want), y: Math.sin(want) };
  for (const off of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2, 1.5, -1.5]) {
    const a = want + off;
    let ok = true;
    for (const d of [0.35, 0.7, 1.05, 1.4]) {
      if (circleHit(grid, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, r)) { ok = false; break; }
    }
    if (ok) return { x: Math.cos(a), y: Math.sin(a) };
  }
  return { x: Math.cos(want), y: Math.sin(want) };
}

// The longest clear straight run from (x, y) along heading a, up to `max` metres.
export function clearRun(grid, x, y, a, r = 0.38, max = 8) {
  for (let d = 0.2; d <= max; d += 0.2) {
    if (circleHit(grid, x + Math.cos(a) * d, y + Math.sin(a) * d, r)) return d - 0.2;
  }
  return max;
}

// The point at the hull in front of the hatch that a push toward it will end against.
export function hatchTarget(grid) {
  const [hx, hy] = grid.ship.hatch;
  return [hx, hy + 0.5];
}

// The demo: idle, waddle out, belly slide along the open ice, walk round the colony to the
// hatch, lean on the hull, then stand there while the name shows. Deterministic in sim time.
export function createDemo(grid) {
  const [hx, hy] = grid.ship.hatch;
  const approach = [hx, hy - 1.2];
  let field = null;
  let slideHeading = null;
  let launched = false;
  let pushFrom = null;
  return function demo(s) {
    const t = s.t;
    if (!field) field = flowField(grid, approach[0], approach[1], 0.3);
    if (t < 1.4) return { x: 0, y: 0 };
    if (t < 3.5) return steerToward(grid, s, 1.0, 4.2);
    if (t < 4.6) return steerToward(grid, s, -4.0, 4.4);
    if (!launched) {
      // the clearest run west, below the colony, for the slide
      let best = -1;
      for (const a of [Math.PI, Math.PI * 0.97, Math.PI * 1.03]) {
        const d = clearRun(grid, s.x, s.y, a);
        if (d > best) { best = d; slideHeading = a; }
      }
      launched = true;
      return { x: Math.cos(slideHeading), y: Math.sin(slideHeading), slide: true };
    }
    if (s.mode === 'slide' || s.mode === 'getup') return { x: Math.cos(slideHeading), y: Math.sin(slideHeading) };
    if (pushFrom === null) {
      if (Math.hypot(s.x - approach[0], s.y - approach[1]) < 0.3 || t > 24) pushFrom = t;
      else return field.steer(s.x, s.y);
    }
    if (t - pushFrom < 1.6) return { x: 0, y: 1 };
    return { x: 0, y: 0 };
  };
}

// A flow field over the walk grid: breadth-first distance (in cells) from every walkable cell to
// the target, where walkable means his whole footprint fits. Following it steps round the colony
// instead of leaning on the first penguin in the way.
export function flowField(grid, tx, ty, radius = 0.3) {
  const { nx, ny, cell, x0, y0 } = grid;
  const walk = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * cell;
      const y = y0 + (j + 0.5) * cell;
      walk[j * nx + i] = circleHit(grid, x, y, radius + 0.06) ? 0 : 1;
    }
  }
  const dist = new Float32Array(nx * ny).fill(Infinity);
  const ti = Math.floor((tx - x0) / cell);
  const tj = Math.floor((ty - y0) / cell);
  const queue = new Int32Array(nx * ny);
  let head = 0;
  let tail = 0;
  const t0 = tj * nx + ti;
  dist[t0] = 0;
  queue[tail++] = t0;
  while (head < tail) {
    const k = queue[head++];
    const i = k % nx;
    const j = (k - i) / nx;
    const nb = [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]];
    for (const [a, b] of nb) {
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const m = b * nx + a;
      if (!walk[m] || dist[m] !== Infinity) continue;
      dist[m] = dist[k] + 1;
      queue[tail++] = m;
    }
  }
  function at(x, y) {
    const i = Math.floor((x - x0) / cell);
    const j = Math.floor((y - y0) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return Infinity;
    return dist[j * nx + i];
  }
  // the input direction that follows the field downhill from (x, y)
  function steer(x, y) {
    const here = at(x, y);
    if (here === 0) return { x: 0, y: 0 };
    let best = null;
    let bestD = here;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const d = at(x + Math.cos(a) * 0.6, y + Math.sin(a) * 0.6);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best === null) return { x: tx - x, y: ty - y };
    return { x: Math.cos(best), y: Math.sin(best) };
  }
  return { at, steer, target: [tx, ty] };
}
