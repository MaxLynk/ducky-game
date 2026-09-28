// The walkable Iceberg in the game: the export's own routes walked by the game's sim, ship and
// elevator code at 60 Hz, with Ducky's capsule, and negative controls that must fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadWorld, run, placeAt, manifest, dir } from './iceberg-world.mjs';
import { createRouteDriver } from '../src/route-driver.js';
import { shipFrame } from '../src/ship.js';

const walk = async (name, route, setup) => {
  const w = await loadWorld();
  if (setup) setup(w);
  placeAt(w, route[0]);
  return run(w, createRouteDriver(w.ship, route.slice(1)));
};

test('the export in assets/iceberg is byte for byte the manifest it ships with', () => {
  const files = Object.values(manifest.files);
  assert.ok(files.length >= 60);
  for (const f of files) {
    const bytes = fs.readFileSync(path.join(dir, f.file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), f.sha256, f.file);
  }
});

test('the ship sits where the ship model sat: the export airlock door is the game hatch', async () => {
  const w = await loadWorld();
  const f = shipFrame(w.grid.ship);
  const door = f.toWorld(2, 0, -6.5);
  assert.ok(Math.hypot(door.x - w.grid.ship.hatch[0], door.y - w.grid.ship.hatch[1]) < 0.1, JSON.stringify(door));
  const back = f.toShip(door.x, door.y, 1);
  assert.ok(Math.abs(back.x - 2) < 1e-9 && Math.abs(back.z + 6.5) < 1e-9 && back.y === 1);
});

for (const name of Object.keys(manifest.routes).filter((r) => manifest.placed_rooms && !Object.values(manifest.placed_rooms).some((p) => p.route === r))) {
  test(`route ${name} walks in the game`, async () => {
    const r = await walk(name, manifest.routes[name]);
    assert.ok(r.done, JSON.stringify(r.failed));
    console.log(name, JSON.stringify({ t: +r.t.toFixed(1), min_feet: +r.minFeet.toFixed(3), end: r.end.cell }));
  });
}

test('every elevator stop, both ways, lands on its floor', async () => {
  const w = await loadWorld();
  placeAt(w, 'elev_main');
  const order = [['MAIN', 'LOWER'], ['LOWER', 'HOLD'], ['HOLD', 'MAIN'], ['MAIN', 'HOLD'], ['HOLD', 'LOWER'], ['LOWER', 'MAIN']];
  for (const [a, b] of order) {
    const r = run(w, createRouteDriver(w.ship, [{ elevator: [a, b] }]));
    assert.ok(r.done, `${a} to ${b}: ` + JSON.stringify(r.failed));
    const floor = w.ship.elevator.stopById.get(b).floor_y;
    assert.ok(Math.abs(w.sim.state.z - floor) < 0.25, `${a} to ${b}: feet ${w.sim.state.z} floor ${floor}`);
  }
});

test('control: without the companion stair ramp the stair route fails', async () => {
  const r = await walk('R03', manifest.routes.R03_stair_down_sleeping_rooms, (w) => assert.ok(w.ship.registry.remove(manifest.negative_controls.stair.remove[0])));
  assert.equal(r.done, false);
  console.log('stair removed', JSON.stringify(r.failed));
});

test('control: without the car floor the elevator route fails', async () => {
  const r = await walk('R05', manifest.routes.R05_elevator_main_hold_lower, (w) => assert.ok(w.ship.registry.remove('COL__iceberg-elevator__car_floor')));
  assert.equal(r.done, false);
  console.log('car floor removed', JSON.stringify(r.failed));
});

test('control: a landing door stuck shut blocks the elevator route', async () => {
  const r = await walk('R05', manifest.routes.R05_elevator_main_hold_lower, (w) => w.ship.elevator.stickLandingDoor('HOLD'));
  assert.equal(r.done, false);
  assert.equal(r.failed.reason, 'waypoint_timeout');
});

test('the cockpit: the use button at the vestibule places Ducky in it, the console answers, and back down', async () => {
  const w = await loadWorld();
  placeAt(w, 'vestibule_centre');
  const s = w.sim.state;
  assert.equal(w.step(1 / 60, { interact: true }).kind, 'cockpit-up');
  assert.ok(s.z > 2.2 && w.ship.state.cell === 'iceberg-cockpit');
  assert.ok(run(w, createRouteDriver(w.ship, ['cockpit_aisle'], { arrive: 0.12 })).done);
  assert.deepEqual(w.step(1 / 60, { interact: true }), { kind: 'console', on: true });
  assert.ok(run(w, createRouteDriver(w.ship, ['cockpit_door_inside'], { arrive: 0.12 })).done);
  assert.equal(w.step(1 / 60, { interact: true }).kind, 'cockpit-down');
  for (let i = 0; i < 30; i++) w.step(1 / 60, {});
  assert.ok(Math.abs(s.z) < 0.1, 'back on the vestibule floor ' + s.z);
});
