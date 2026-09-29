// Walks Ducky along a route of the export's waypoints by feeding the same input a player feeds:
// a stick direction, the use button and a car button. Used by the demo, the node tests and the
// browser acceptance. A route item is a waypoint name or { elevator: [from, to] }, as in the
// export manifest. Pure JS.

export function createRouteDriver(ship, route, opts = {}) {
  const arrive = opts.arrive ?? 0.25;   // metres, horizontal
  const arriveY = opts.arriveY ?? 0.3;  // metres, feet to waypoint floor
  const speed = opts.speed ?? 1.6;
  const legs = [];
  for (const item of route) {
    if (typeof item === 'string') legs.push({ kind: 'walk', to: item });
    else {
      const [a, b] = item.elevator;
      legs.push({ kind: 'walk', to: ship.landing[a].name });
      legs.push({ kind: 'call', stop: a });
      legs.push({ kind: 'board', stop: a });
      legs.push({ kind: 'press', stop: b });
      legs.push({ kind: 'ride', stop: b });
      legs.push({ kind: 'walk', to: ship.landing[b].name });
    }
  }
  const log = [];
  let i = 0;
  let since = null;
  let fired = false;
  let failed = null;
  function next(s, extra = {}) { log.push({ leg: i, ...legs[i], t: s.t, x: s.x, y: s.y, feet: s.z, ...extra }); i++; since = s.t; fired = false; }
  function toward(s, X, Y, Z) {
    const w = ship.frame.toWorld(X, Y, Z);
    const d = Math.hypot(w.x - s.x, w.y - s.y);
    const m = Math.min(1, d / 0.6);
    const a = Math.atan2(w.y - s.y, w.x - s.x);
    return { d, dz: Math.abs(s.z - Y), input: { x: Math.cos(a) * m, y: Math.sin(a) * m, lookYaw: a } };
  }
  function read(s) {
    if (failed || i >= legs.length) return {};
    if (since === null) since = s.t;
    const leg = legs[i];
    const elapsed = s.t - since;
    const el = ship.elevator;
    if (leg.kind === 'walk') {
      const p = ship.waypoint(leg.to);
      const t = toward(s, p[0], p[1], p[2]);
      if (leg.limit === undefined) leg.limit = t.d / speed * 3 + 10;
      if (t.d < arrive && t.dz < arriveY) { next(s); return {}; }
      if (elapsed > leg.limit) { failed = { leg: i, to: leg.to, reason: 'waypoint_timeout', d: t.d, dz: t.dz }; return {}; }
      return t.input;
    }
    const limit = 60;
    if (elapsed > limit) { failed = { leg: i, kind: leg.kind, stop: leg.stop, reason: 'elevator_timeout', state: el.state, at: el.currentStop }; return {}; }
    if (leg.kind === 'call') {
      if (el.currentStop === leg.stop && el.state === 'open') { next(s); return {}; }
      const use = fired === false || (el.state === 'idle' && elapsed > 1 && Math.round(elapsed * 60) % 60 === 0);
      fired = true;
      return { interact: use };
    }
    if (leg.kind === 'board') {
      const c = ship.carCentre;
      const t = toward(s, c.x, el.carY, c.z);
      if (t.d < 0.15 && ship.inCar()) { next(s); return {}; }
      return t.input;
    }
    if (leg.kind === 'press') {
      if (fired) { next(s); return {}; }
      fired = true;
      return { interact: true, stop: leg.stop };
    }
    if (leg.kind === 'ride') {
      if (el.currentStop === leg.stop && el.state === 'open') { next(s, { carY: el.carY }); return {}; }
      return {};
    }
    return {};
  }
  return {
    read, log, legs,
    get done() { return i >= legs.length; },
    get failed() { return failed; },
    get leg() { return legs[i]; },
  };
}
