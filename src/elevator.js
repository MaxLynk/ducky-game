// Ported from the Ducky harness engine (art/blender/iceberg-game/harness/src/engine/elevator.js at
// commit 44bfb756), where the walkable Iceberg export was proved. Only the import paths changed.
// Elevator controller driven only by the extras on the ELEV__ root node:
//   { "elevator": { id, stops: [{id, floor_y, car_door, landing_door}], rest_stop,
//                   speed_mps, accel_mps2, door_open_s, door_close_s, dwell_s, car_node } }
//
// States: idle, doors_opening, open, doors_closing, moving.
// call(stopId) (landing call button) and press(stopId) (car button) queue requests. A request for
// the stop the car is standing at holds the doors (open: dwell restarts; closing: doors reopen).
// The car and everything under it move only along Y, with a trapezoid velocity profile, and land
// exactly on floor_y. Poses go through each registry entry's setPose (colliders.js), which calls
// setNextKinematicTranslation in "kinematic" mode and moves the collider directly in "parentless" mode. Doors slide along their "slide" extras (in the node's parent frame). Doors
// only move in doors_opening and doors_closing, so they cannot open while moving, and a door
// collider is never disabled: closed means solid.
//
// debug.stuckLandingDoors: a Set of stop ids whose landing door stays closed whatever the state
// machine does (for a negative control).

import * as THREE from 'three';

export const STATES = Object.freeze(['idle', 'doors_opening', 'open', 'doors_closing', 'moving']);

function profile(distance, vmax, accel) {
  const D = Math.abs(distance);
  if (D === 0) return { D, T: 0, at: () => 0 };
  const tA0 = vmax / accel;
  const dA0 = 0.5 * accel * tA0 * tA0;
  if (2 * dA0 >= D) {
    const tA = Math.sqrt(D / accel);
    const T = 2 * tA;
    return {
      D, T, vpeak: accel * tA,
      at: (t) => (t <= 0 ? 0 : t >= T ? D : t < tA ? 0.5 * accel * t * t : D - 0.5 * accel * (T - t) * (T - t)),
    };
  }
  const tC = (D - 2 * dA0) / vmax;
  const T = 2 * tA0 + tC;
  return {
    D, T, vpeak: vmax,
    at: (t) => {
      if (t <= 0) return 0;
      if (t >= T) return D;
      if (t < tA0) return 0.5 * accel * t * t;
      if (t < tA0 + tC) return dA0 + vmax * (t - tA0);
      return D - 0.5 * accel * (T - t) * (T - t);
    },
  };
}

function slideWorld(entry) {
  const s = entry.slide || [0, 0, 0];
  const v = new THREE.Vector3(s[0] || 0, s[1] || 0, s[2] || 0);
  const parent = entry.object.parent;
  if (parent) v.applyMatrix3(new THREE.Matrix3().setFromMatrix4(parent.matrixWorld));
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * registry: from colliders.js. record: one of registry.elevators ({ name, object, spec }).
 */
export function createElevator(registry, record, options = {}) {
  const warn = options.warn || ((m) => console.warn(m));
  const spec = record.spec;
  const need = ['stops', 'rest_stop', 'speed_mps', 'accel_mps2', 'door_open_s', 'door_close_s', 'dwell_s', 'car_node'];
  for (const k of need) if (spec[k] === undefined) throw new Error(`${record.name}: elevator extras missing "${k}"`);

  const stops = spec.stops.map((s) => ({ ...s }));
  const stopById = new Map(stops.map((s) => [s.id, s]));
  const rest = stopById.get(spec.rest_stop);
  if (!rest) throw new Error(`${record.name}: rest_stop ${spec.rest_stop} is not a stop`);

  const carEntry = registry.get(spec.car_node);
  if (!carEntry) throw new Error(`${record.name}: car_node ${spec.car_node} not found`);
  if (Math.abs(carEntry.closedTranslation.y - rest.floor_y) > 0.005) {
    warn(`${record.name}: car node world Y ${carEntry.closedTranslation.y.toFixed(4)} differs from rest stop floor_y ${rest.floor_y}`);
  }

  const carMembers = registry.descendantsOf(carEntry.object);
  // A door may be one leaf or several (a bi-parting door is two leaves). Leaves share a face name:
  // `..__car_door__inboard_a` and `..__car_door__inboard_b` are both the "inboard" door.
  const leafFace = (s) => s.replace(/_[a-z]$/, '');
  const carDoors = new Map();   // face -> [entries]
  for (const e of carMembers) {
    const m = e.name.match(/__car_door__(.+)$/);
    if (m || e.surface === 'car_door') {
      const face = m ? leafFace(m[1]) : (e.extras.face || e.name);
      if (!carDoors.has(face)) carDoors.set(face, []);
      carDoors.get(face).push(e);
      e.slideWorld = slideWorld(e);
    }
  }
  const landingDoors = new Map(); // stop id -> [entries]
  for (const s of stops) {
    const leaves = [];
    const exact = s.landing_door ? registry.get(s.landing_door) : null;
    if (exact) leaves.push(exact);
    for (const cand of registry.entries.values()) {
      if (leaves.includes(cand)) continue;
      const byStop = cand.surface === 'landing_door' && cand.stop === s.id;
      const byName = s.landing_door && cand.name.startsWith(s.landing_door + '_');
      if (byStop || byName) leaves.push(cand);
    }
    if (!leaves.length) {
      const e = registry.get(`${record.name.replace(/__elevator$/, '')}__landing_door__${s.id}`);
      if (e) leaves.push(e);
    }
    if (leaves.length) { landingDoors.set(s.id, leaves); for (const e of leaves) e.slideWorld = slideWorld(e); }
    else warn(`${record.name}: no landing door found for stop ${s.id}`);
    if (!carDoors.has(s.car_door)) warn(`${record.name}: stop ${s.id} names car door "${s.car_door}", not found`);
  }

  const st = {
    time: 0,
    state: 'idle',
    currentStop: rest.id,
    targetStop: null,
    carY: rest.floor_y,
    frac: 0,
    dwellLeft: 0,
    move: null,
    queue: [],
    events: [],
  };
  const debug = { stuckLandingDoors: new Set() };

  function log(type, extra = {}) { st.events.push({ t: +st.time.toFixed(4), type, state: st.state, stop: st.currentStop, ...extra }); }

  function request(stopId, source) {
    if (!stopById.has(stopId)) throw new Error(`elevator: unknown stop ${stopId}`);
    if (stopId === st.currentStop && st.state !== 'moving') {
      if (st.state === 'open') { st.dwellLeft = spec.dwell_s; return; }
      if (st.state === 'doors_closing') { st.state = 'doors_opening'; log('reopen', { source }); return; }
      if (st.state === 'doors_opening') return;
    }
    if (!st.queue.includes(stopId)) { st.queue.push(stopId); log('request', { source, target: stopId }); }
  }

  function startMove(target) {
    const from = st.carY;
    const to = stopById.get(target).floor_y;
    st.move = { from, to, dir: Math.sign(to - from), t: 0, prof: profile(to - from, spec.speed_mps, spec.accel_mps2) };
    st.targetStop = target;
    st.state = 'moving';
    log('depart', { target });
  }

  function doorFractions() {
    const car = {}; const landing = {};
    for (const face of carDoors.keys()) car[face] = 0;
    for (const id of landingDoors.keys()) landing[id] = 0;
    if (st.state !== 'moving' && st.frac > 0) {
      const stop = stopById.get(st.currentStop);
      if (carDoors.has(stop.car_door)) car[stop.car_door] = st.frac;
      if (landingDoors.has(stop.id) && !debug.stuckLandingDoors.has(stop.id)) landing[stop.id] = st.frac;
    }
    return { car, landing };
  }

  function apply() {
    const off = st.carY - rest.floor_y;
    const fr = doorFractions();
    const doorOf = new Map();
    for (const [face, leaves] of carDoors) for (const e of leaves) doorOf.set(e, fr.car[face]);
    for (const e of carMembers) {
      if (!e.setPose) continue;
      const f = doorOf.get(e) || 0;
      const sw = e.slideWorld || { x: 0, y: 0, z: 0 };
      e.setPose({
        x: e.closedTranslation.x + f * sw.x,
        y: e.closedTranslation.y + off + f * sw.y,
        z: e.closedTranslation.z + f * sw.z,
      });
    }
    for (const [id, leaves] of landingDoors) {
      for (const e of leaves) {
        if (!e.setPose) continue;
        const f = fr.landing[id];
        e.setPose({
          x: e.closedTranslation.x + f * e.slideWorld.x,
          y: e.closedTranslation.y + f * e.slideWorld.y,
          z: e.closedTranslation.z + f * e.slideWorld.z,
        });
      }
    }
  }

  function update(dt) {
    st.time += dt;
    switch (st.state) {
      case 'idle':
        if (st.queue.length) {
          const next = st.queue[0];
          if (next === st.currentStop) { st.queue.shift(); st.state = 'doors_opening'; log('doors_opening'); }
          else startMove(next);
        }
        break;
      case 'doors_opening':
        st.frac = Math.min(1, st.frac + dt / spec.door_open_s);
        if (st.frac >= 1) { st.state = 'open'; st.dwellLeft = spec.dwell_s; log('open'); }
        break;
      case 'open':
        st.dwellLeft -= dt;
        if (st.dwellLeft <= 0) { st.state = 'doors_closing'; log('doors_closing'); }
        break;
      case 'doors_closing':
        st.frac = Math.max(0, st.frac - dt / spec.door_close_s);
        if (st.frac <= 0) { st.state = 'idle'; log('closed'); }
        break;
      case 'moving': {
        const m = st.move;
        m.t += dt;
        if (m.t >= m.prof.T) {
          st.carY = m.to;                       // land exactly on floor_y
          st.currentStop = st.targetStop;
          st.queue = st.queue.filter((q) => q !== st.currentStop);
          st.targetStop = null;
          st.move = null;
          st.state = 'doors_opening';
          log('arrive', { carY: st.carY });
        } else {
          st.carY = m.from + m.dir * m.prof.at(m.t);
        }
        break;
      }
      default:
        throw new Error(`elevator: bad state ${st.state}`);
    }
    apply();
  }

  /** Seconds to travel between two stops (motion only, no doors). */
  function travelTime(a, b) {
    return profile(stopById.get(b).floor_y - stopById.get(a).floor_y, spec.speed_mps, spec.accel_mps2).T;
  }

  apply();

  return {
    id: spec.id || record.name,
    name: record.name,
    spec, stops, stopById, carEntry, carMembers, carDoors, landingDoors, debug,
    call: (s) => request(s, 'call'),
    press: (s) => request(s, 'press'),
    update, travelTime, doorFractions,
    stickLandingDoor: (s) => { if (!stopById.has(s)) throw new Error(`elevator: unknown stop ${s}`); debug.stuckLandingDoors.add(s); },
    get state() { return st.state; },
    get currentStop() { return st.currentStop; },
    get targetStop() { return st.targetStop; },
    get carY() { return st.carY; },
    get carOffset() { return st.carY - rest.floor_y; },
    get queue() { return st.queue.slice(); },
    get events() { return st.events; },
    get time() { return st.time; },
  };
}
