// Ducky's movement on the ice: walking, the belly slide, and collision with the walk grid.
// Pure JS with no three.js import, so the headless drive test runs the same code the game runs.
// Frame: the Blender ground plane, x east and y north in metres; heading 0 faces east.

import { circleHit, nearestHull } from './grid.js';

export const TUNING = {
  radius: 0.3,        // his footprint, a little narrower than the 0.94 m flipper span
  walkSpeed: 1.6,     // metres per second at full stick
  accel: 5.0,
  turnRate: 5.0,      // radians per second while walking
  stride: 0.32,       // metres per footfall, drives the waddle
  slideSpeed: 4.0,    // launch speed of a belly slide
  slideFriction: 0.38, // metres per second lost each second on ice
  roughFriction: 6.0,
  deckFriction: 4.0,
  slideSteer: 0.8,    // radians per second of steering while sliding
  slideMin: 0.6,      // below this he gets up
  getUpTime: 0.45,
  maxStep: 0.08,      // metres per collision substep
};

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function turnToward(a, target, maxTurn) {
  const d = wrap(target - a);
  if (Math.abs(d) <= maxTurn) return target;
  return wrap(a + Math.sign(d) * maxTurn);
}

export function createSim(grid, opts = {}) {
  const T = { ...TUNING, ...(opts.tuning || {}) };
  const s = {
    x: grid.spawn[0],
    y: grid.spawn[1],
    heading: opts.heading ?? Math.PI / 2, // facing north, toward the ship
    speed: 0,
    mode: 'stand',
    modeT: 0,
    walkPhase: 0,
    distance: 0,
    t: 0,
    contact: false,
    contactHull: false,
    collide: opts.collide !== false,
    surface: 'ice',
  };

  // The ice itself always holds him: the plain's edge is a bound, not an obstacle, so turning
  // collision off (the planted control) still keeps him on the ice.
  function onIce(x, y) {
    const r = T.radius;
    return x >= grid.x0 + r && x <= grid.x1 - r && y >= grid.y0 + r && y <= grid.y1 - r;
  }

  function free(x, y) {
    if (opts.free) {
      const allowed = opts.free(x, y, T.radius);
      if (allowed === true || allowed === false) return allowed;
    }
    if (!onIce(x, y)) return false;
    if (!s.collide) return true;
    return circleHit(grid, x, y, T.radius) === null;
  }

  function move(dx, dy) {
    const len = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(len / T.maxStep));
    let moved = 0;
    let bumped = false;
    for (let k = 0; k < n; k++) {
      const sx = dx / n;
      const sy = dy / n;
      if (free(s.x + sx, s.y + sy)) {
        s.x += sx; s.y += sy; moved += Math.hypot(sx, sy);
      } else if (free(s.x + sx, s.y)) {
        s.x += sx; moved += Math.abs(sx); bumped = true;
      } else if (free(s.x, s.y + sy)) {
        s.y += sy; moved += Math.abs(sy); bumped = true;
      } else {
        bumped = true;
        break;
      }
    }
    return { moved, bumped };
  }

  function step(dt, input = {}) {
    if (!(dt > 0)) return s; // a zero or negative step would integrate him backwards
    s.t += dt;
    s.modeT += dt;
    const ix = input.x || 0;
    const iy = input.y || 0;
    const mag = Math.min(1, Math.hypot(ix, iy));
    const want = mag > 0.1 ? Math.atan2(iy, ix) : null;
    s.surface = opts.surface ? opts.surface(s.x, s.y) : 'ice';

    if (s.mode === 'slide') {
      if (want !== null) s.heading = turnToward(s.heading, want, T.slideSteer * dt);
      const friction = s.surface === 'rough' ? T.roughFriction : s.surface === 'deck' ? T.deckFriction : T.slideFriction;
      s.speed = Math.max(0, s.speed - friction * dt);
      if ((s.speed < T.slideMin && s.modeT > 0.5) || (input.slide && s.modeT > 0.4)) {
        s.mode = 'getup'; s.modeT = 0;
      }
    } else if (s.mode === 'getup') {
      s.speed = Math.max(0, s.speed - 4 * dt);
      if (s.modeT >= T.getUpTime) { s.mode = 'stand'; s.modeT = 0; }
    } else {
      let target = 0;
      if (want !== null) {
        s.heading = turnToward(s.heading, want, T.turnRate * dt);
        const facing = Math.max(0, Math.cos(wrap(want - s.heading)));
        target = T.walkSpeed * mag * facing;
      }
      const dv = target - s.speed;
      s.speed += Math.max(-T.accel * dt, Math.min(T.accel * dt, dv));
      const next = s.speed > 0.05 ? 'walk' : 'stand';
      if (next !== s.mode) { s.mode = next; s.modeT = 0; }
      if (input.slide) {
        s.mode = 'slide'; s.modeT = 0;
        s.speed = Math.max(T.slideSpeed, s.speed + 2.5);
      }
    }

    const { moved, bumped } = move(Math.cos(s.heading) * s.speed * dt, Math.sin(s.heading) * s.speed * dt);
    s.distance += moved;
    s.contact = bumped;
    s.contactHull = bumped && nearestHull(grid, s.x, s.y, T.radius + 0.5) <= T.radius + 0.35;
    if (bumped) {
      // a bump costs speed; a slide into something ends the slide
      s.speed = Math.min(s.speed, moved / Math.max(dt, 1e-6));
      if (s.mode === 'slide' && moved < 0.01) { s.mode = 'getup'; s.modeT = 0; }
    }
    if (s.mode === 'walk' || s.mode === 'stand') s.walkPhase += (moved / T.stride) * Math.PI;
    return s;
  }

  return { state: s, step, onIce, free, tuning: T };
}
