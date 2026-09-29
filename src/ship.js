// The walkable Iceberg: Ducky aboard, on Rapier physics built from the export's collision GLBs.
// Outside he walks the 2D ice sim; through the open airlock he boards, and from then on a capsule
// on Rapier's character controller carries him deck to deck, down the stairs and in the elevator.
// No rendering here, so the node tests walk the same code the game walks.
//
// Frames: the game's world plane is Blender ground (x east, y north, z up). The export is glTF in
// ship space (X to the nose, Y up). The ship sits where the walk grid puts it (collision.json ship
// yaw and offset), exactly where the ship model sat before.

import { createColliderRegistry } from './colliders.js';
import { createCharacter } from './character.js';
import { createElevator } from './elevator.js';

export const DUCKY_CAPSULE = { height: 1.4, radius: 0.22 }; // the export's own character spec
export const STOPS = ['MAIN', 'LOWER', 'HOLD'];
export const STOP_NAMES = { MAIN: 'main deck', LOWER: 'reactor deck', HOLD: 'hold' };
export const CELL_NAMES = {
  'iceberg-airlock': 'AIRLOCK', 'iceberg-workshop': 'WORKSHOP', 'iceberg-main-hall': 'MAIN DECK',
  'iceberg-kitchen': 'KITCHEN', 'iceberg-captain-cabin': "CAPTAIN'S CABIN", 'iceberg-lower-hall': 'LOWER DECK',
  'iceberg-sleeping-cabins': 'SLEEPING ROOMS', 'iceberg-pellet-room': 'PELLET ROOM', 'iceberg-reactor': 'REACTOR ROOM',
  'iceberg-hold': 'HOLD', 'iceberg-elevator': 'ELEVATOR', 'iceberg-cockpit': 'COCKPIT', 'catapult-exterior': 'HOLD',
};
// Boarding and leaving happen inside the airlock, past the outer door (ship Z -6.4) and clear of
// its wall, with a gap between the two lines so he never flickers between the sims.
export const BOARD_Y = 21.05;
export const LEAVE_Y = 20.95;
const LEAVE_AT = LEAVE_Y - 0.02; // where leave() stands him on the ice
// Walking back out, the capsule reaches the leave line anywhere along the airlock's aft wall, door
// open or shut. The ice sim takes him only where it can stand him: at the leave spot, through the
// open outer door and clear of both jambs with its wider footprint (0.3 m to the capsule's 0.22).
// Anywhere else the ship's physics keeps him, so he walks on instead of being stranded on the hull.
// iceFree(x, y) is layout.js shipWalkable for the ice sim's radius.
export function canLeave(s, iceFree) {
  return s.y < LEAVE_Y && s.z < 0.5 && iceFree(s.x, Math.min(s.y, LEAVE_AT)) === true;
}
const OUTER_DOOR = 'COL__iceberg-airlock__airlock_outerdoor';

export function shipFrame(ship) {
  const yaw = ship.yaw_deg * Math.PI / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const [ox, oy] = ship.offset;
  return {
    yaw, offset: [ox, oy],
    toShip(x, y, z = 0) { const a = x - ox; const b = y - oy; return { x: a * c + b * s, y: z, z: a * s - b * c }; },
    toWorld(X, Y, Z) { return { x: X * c + Z * s + ox, y: X * s - Z * c + oy, z: Y }; },
    vecToShip(dx, dy) { return { x: dx * c + dy * s, z: dx * s - dy * c }; },
    vecToWorld(X, Z) { return { x: X * c + Z * s, y: X * s - Z * c }; },
  };
}

/**
 * RAPIER: the initialised module. collisionScenes: [{ scene, file }] from gltf-load.js.
 * manifest: iceberg.manifest.json. ship: collision.json's ship record.
 */
export function createShip(RAPIER, { manifest, collisionScenes, ship, warn = () => {} }) {
  const frame = shipFrame(ship);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const registry = createColliderRegistry(RAPIER, world, { warn });
  for (const { scene, file } of collisionScenes) registry.addScene(scene, file);
  const elevator = createElevator(registry, registry.elevators[0], { warn });
  world.step(); // scene queries see nothing until the broad phase is built
  const wp = (name) => (manifest.waypoints[name] || manifest.control_waypoints?.[name]).p;
  const nameOf = (c) => registry.entryForCollider(c)?.name ?? null;
  const cellOf = (c) => registry.entryForCollider(c)?.cell ?? null;
  const start = wp('airlock');
  const character = createCharacter(RAPIER, world, {
    ...DUCKY_CAPSULE,
    position: { x: start[0], y: start[1] + DUCKY_CAPSULE.height / 2 + 0.02, z: start[2] },
    platformDelta: registry.platformDelta, nameOfCollider: nameOf,
  });
  const outerDoor = registry.get(OUTER_DOOR);
  if (outerDoor === null) throw new Error('export has no ' + OUTER_DOOR);
  const carFloor = registry.get('COL__iceberg-elevator__car_floor');
  const carVolume = registry.get('TRIG__iceberg-elevator__car_volume');
  const landing = {};
  for (const stop of elevator.stops) {
    const leaves = elevator.landingDoors.get(stop.id) || [];
    const mid = leaves.reduce((m, e) => ({ x: m.x + e.closedTranslation.x / leaves.length, z: m.z + e.closedTranslation.z / leaves.length }), { x: 0, z: 0 });
    const w = manifest.elevator_edges.find((e) => e.from === stop.id) || manifest.elevator_edges.find((e) => e.to === stop.id);
    const name = w.from === stop.id ? w.a : w.b;
    landing[stop.id] = { door: mid, name, waypoint: wp(name), floor: stop.floor_y };
  }
  const state = { aboard: false, cell: 'iceberg-airlock', consoleOn: false, events: [], lastStop: null };

  function box(entry) {
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    entry.object.updateMatrixWorld(true);
    entry.object.traverse((o) => {
      if (o.isMesh !== true) return;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], bb.min.getComponent(k)); b.max[k] = Math.max(b.max[k], bb.max.getComponent(k)); }
    });
    return b;
  }
  const carBox = box(carVolume || carFloor);
  const carCentre = { x: (carBox.min[0] + carBox.max[0]) / 2, z: (carBox.min[2] + carBox.max[2]) / 2 };

  function setOuterDoor(open) {
    for (const c of outerDoor.colliders) c.setEnabled(open === false);
  }
  function inCar() {
    const p = character.position;
    const feet = character.feetY;
    return p.x > carBox.min[0] && p.x < carBox.max[0] && p.z > carBox.min[2] && p.z < carBox.max[2]
      && Math.abs(feet - elevator.carY) < 0.3;
  }
  // A door sensor: someone in a landing doorway holds the doors open, as the harness does.
  function doorSensor() {
    if (elevator.state === 'moving' || elevator.state === 'idle') return;
    const l = landing[elevator.currentStop];
    const p = character.position;
    if (Math.hypot(p.x - l.door.x, p.z - l.door.z) < 0.7 && Math.abs(character.feetY - l.floor) < 0.5) elevator.call(elevator.currentStop);
  }
  function locate(s) {
    const p = character.position;
    const w = frame.toWorld(p.x, character.feetY, p.z);
    s.x = w.x; s.y = w.y; s.z = w.z;
    const cell = cellOf(character.groundCollider);
    if (cell) state.cell = cell;
    return w;
  }

  // One physics tick while aboard: the sim hands over its displacement for this step.
  function tick(dt, dx, dy, s) {
    registry.beginTick();
    doorSensor();
    elevator.update(dt);
    const v = frame.vecToShip(dx / dt, dy / dt);
    const x0 = s.x; const y0 = s.y;
    character.step(dt, { x: v.x, z: v.z });
    world.step();
    locate(s);
    const moved = Math.hypot(s.x - x0, s.y - y0);
    const wanted = Math.hypot(dx, dy);
    return { moved, bumped: wanted > 1e-4 && moved < wanted * 0.5 };
  }
  // While he is on the ice the elevator still runs its doors and trips.
  function idle(dt) {
    registry.beginTick(); elevator.update(dt); world.step();
  }
  function board(s) {
    const p = frame.toShip(s.x, s.y, 0);
    character.teleport({ x: p.x, y: wp('airlock')[1] + character.halfTotal + 0.02, z: p.z });
    state.aboard = true; state.cell = 'iceberg-airlock';
    state.events.push({ kind: 'board' });
    locate(s);
  }
  function leave(s) {
    state.aboard = false; s.z = 0; s.y = Math.min(s.y, LEAVE_AT);
    state.events.push({ kind: 'leave' });
  }
  function place(name, s) {
    const p = wp(name);
    character.teleport({ x: p[0], y: p[1] + character.halfTotal + 0.02, z: p[2] });
    registry.beginTick(); world.step();
    locate(s);
  }
  function near(name, r, dy = 0.5) {
    const p = wp(name); const c = character.position;
    return Math.hypot(c.x - p[0], c.z - p[2]) < r && Math.abs(character.feetY - p[1]) < dy;
  }
  function nextStop() {
    const i = STOPS.indexOf(elevator.currentStop);
    return STOPS[(i + 1) % STOPS.length];
  }
  // The use button aboard. Returns what happened, for the toast and the tests.
  function interact(s, stop = null) {
    if (inCar()) {
      const to = stop || nextStop();
      elevator.press(to); state.lastStop = to;
      state.events.push({ kind: 'press', stop: to });
      return { kind: 'press', stop: to };
    }
    for (const [id, l] of Object.entries(landing)) {
      const c = character.position;
      if (Math.hypot(c.x - l.waypoint[0], c.z - l.waypoint[2]) < 1.3 && Math.abs(character.feetY - l.floor) < 0.5) {
        elevator.call(id); state.events.push({ kind: 'call', stop: id });
        return { kind: 'call', stop: id };
      }
    }
    // The cockpit sits 2.26 m over the vestibule under the hull fairing, and the export builds no
    // stair to it (its manifest lists the cockpit as a placed room, access unresolved). Until that
    // is decided, the use button places Ducky in it and back, as the export's own route R02 does.
    if (near('vestibule_centre', 2.6) || near('vestibule', 1.6)) {
      place('cockpit_door_inside', s); state.cell = 'iceberg-cockpit';
      state.events.push({ kind: 'cockpit', up: true });
      return { kind: 'cockpit-up' };
    }
    if (state.cell === 'iceberg-cockpit' || character.feetY > 1.5) {
      const c = character.position;
      if (c.x < 17.3) { // at the door, not the aisle
        place('vestibule_centre', s); state.cell = 'iceberg-main-hall';
        state.events.push({ kind: 'cockpit', up: false });
        return { kind: 'cockpit-down' };
      }
      state.consoleOn = state.consoleOn === false;
      state.events.push({ kind: 'console', on: state.consoleOn });
      return { kind: 'console', on: state.consoleOn };
    }
    return null;
  }
  // A segment in world-plane metres against every solid aboard, for snowballs.
  function castRay(a, b) {
    const pa = frame.toShip(a.x, a.y, a.z);
    const pb = frame.toShip(b.x, b.y, b.z);
    const d = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z };
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < 1e-5) return null;
    const ray = new RAPIER.Ray(pa, { x: d.x / len, y: d.y / len, z: d.z / len });
    const hit = world.castRayAndGetNormal(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined, character.collider, character.body);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    const p = frame.toWorld(pa.x + d.x / len * t, pa.y + d.y / len * t, pa.z + d.z / len * t);
    const n = frame.vecToWorld(hit.normal.x, hit.normal.z);
    return { kind: 'ship', target: nameOf(hit.collider), point: p, normal: { x: n.x, y: n.y, z: hit.normal.y } };
  }

  return {
    frame, world, registry, elevator, character, state, landing, carCentre,
    tick, idle, board, leave, place, interact, castRay, setOuterDoor, inCar, near,
    get aboard() { return state.aboard; },
    waypoint: wp,
    snapshot() {
      const p = character.position;
      return { aboard: state.aboard, cell: state.cell, feet: character.feetY, ship: [p.x, p.y, p.z], grounded: character.grounded,
        ground: character.groundName, inCar: inCar(), consoleOn: state.consoleOn,
        elevator: { state: elevator.state, stop: elevator.currentStop, target: elevator.targetStop, carY: elevator.carY, doors: elevator.doorFractions() } };
    },
  };
}
