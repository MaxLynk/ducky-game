import { flowField } from './autopilot.js';
import { TARGETS } from './layout.js';

// A repeatable input demonstration. It uses the same movement, throws and use action
// as a player, with no position changes or synthetic hit events.
export function createMilestoneDemo(grid) {
  let phase = 0;
  let since = 0;
  let fired = false;
  const field = flowField(grid, -2, 18.7, 0.3);
  const events = [];
  function next(s) { phase++; since = s.t; fired = false; events.push({ phase, t: s.t }); }
  function toward(s, x, y, radius = 0.25) {
    if (Math.hypot(x - s.x, y - s.y) < radius) { next(s); return {}; }
    const a = Math.atan2(y - s.y, x - s.x);
    return { x: Math.cos(a), y: Math.sin(a), lookYaw: a };
  }
  return { events,
    read(s) {
      const elapsed = s.t - since;
      if (phase === 0) { if (s.t > 1) next(s); return { lookYaw: Math.PI }; }
      if (phase === 1) { if (elapsed > 0.75) next(s); return { x: -1, lookYaw: Math.PI }; }
      if (phase === 2) {
        const slide = fired === false; fired = true;
        if (elapsed > 1 && s.mode === 'stand') next(s);
        return { x: elapsed < 0.2 ? -1 : 0, slide, lookYaw: Math.PI };
      }
      if (phase === 3 || phase === 4 || phase === 6) {
        const aim = phase === 3 ? TARGETS[0] : phase === 4 ? { x: s.x + 7, y: s.y + 3, z: 0.05 } : { x: -6, y: 21.5, z: 1.3 };
        const toss = elapsed > 0.65 && fired === false;
        if (toss) fired = true;
        if (elapsed > 2.8) next(s);
        return { aim, throw: toss, lookYaw: Math.atan2(aim.y - s.y, aim.x - s.x) };
      }
      if (phase === 5) {
        if (Math.hypot(s.x + 2, s.y - 18.7) < 0.35) { next(s); return {}; }
        const move = field.steer(s.x, s.y);
        return { ...move, lookYaw: Math.atan2(move.y, move.x) };
      }
      if (phase === 7) {
        const use = fired === false; fired = true;
        if (elapsed > 1.1) next(s);
        return { interact: use, lookYaw: Math.PI / 2 };
      }
      if (phase === 8) return toward(s, -2, 27);
      if (phase === 9) return toward(s, -14, 27);
      if (phase === 10) return toward(s, -14, 24);
      if (phase === 11) return toward(s, -18, 24);
      if (phase === 12) {
        const use = elapsed > 0.5 && fired === false; if (use) fired = true;
        if (elapsed > 2) next(s);
        return { interact: use, lookYaw: Math.atan2(27 - s.y, -19 - s.x), lookPitch: -0.08 };
      }
      if (phase === 13) {
        const select = fired === false; fired = true;
        if (elapsed > 4) next(s);
        return { inspectId: select ? 'blockout:cockpit' : null, orbit: 0.006 };
      }
      if (phase === 14) {
        const select = fired === false; fired = true;
        if (elapsed > 4) next(s);
        return { inspectId: select ? 'ship:cockpit-of-record' : null, orbit: 0.006 };
      }
      if (phase === 15) {
        const select = fired === false; fired = true;
        return { inspectId: select ? 'ship' : null, orbit: 0.006 };
      }
      return {};
    },
    get phase() { return phase; },
  };
}
