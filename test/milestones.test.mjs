import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGrid } from '../scripts/drive.mjs';
import { createSim } from '../src/sim.js';

test('M1: ice preserves momentum while rough snow stops the same slide', () => {
  const measure = (surface) => {
    const sim = createSim(loadGrid(), { surface: () => surface });
    sim.step(1 / 60, { slide: true });
    for (let i = 0; i < 60; i++) sim.step(1 / 60);
    return { speed: sim.state.speed, distance: sim.state.distance, mode: sim.state.mode };
  };
  const ice = measure('ice');
  const rough = measure('rough');
  console.log('friction after 1 second', JSON.stringify({ ice, rough }));
  assert.ok(ice.speed > 3);
  assert.ok(rough.speed < 0.1);
  assert.ok(ice.distance > rough.distance * 2);
});

test('M1: steering turns a slide and frame rates agree', () => {
  const results = [30, 60, 120].map((hz) => {
    const sim = createSim(loadGrid());
    sim.step(1 / 120, { slide: true });
    const start = sim.state.heading;
    for (let i = 0; i < hz; i++) sim.step(1 / hz, { x: 1 });
    assert.ok(sim.state.heading < start - 0.5);
    return sim.state.speed;
  });
  assert.ok(Math.max(...results) - Math.min(...results) < 0.03);
});

test('M1: snowballs arc, obey cooldown and splat on ice, hull and target', async () => {
  const { createSnowballs } = await import('../src/snowballs.js');
  for (const kind of ['ice', 'hull', 'target']) {
    const snow = createSnowballs({ collide: (a, b) => {
      if (kind === 'ice' && b.z <= 0.12) return { kind, point: { ...b, z: 0.12 }, normal: { x: 0, y: 0, z: 1 } };
      if (kind === 'ice') return null;
      if (b.y >= 5) return { kind, point: b, normal: { x: 0, y: -1, z: 0 } };
      return null;
    } });
    assert.equal(snow.throw({ x: 0, y: 0, z: 1 }, Math.PI / 2, 0.28), true);
    assert.equal(snow.throw({ x: 0, y: 0, z: 1 }, 0, 0), false);
    const heights = [];
    for (let i = 0; i < 240; i++) {
      snow.step(1 / 120);
      if (snow.balls.length) heights.push(snow.balls[0].z);
    }
    assert.ok(Math.max(...heights) > 1.2);
    assert.equal(snow.hits[0]?.kind, kind);
    assert.equal(snow.splats.length, 1);
    console.log('ballistic hit', JSON.stringify({ kind, peak: Math.max(...heights), hit: snow.hits[0] }));
  }
});

test('M2: port door blocks when closed, opens and admits a walk to the forward cockpit', async () => {
  const { createShipState, shipWalkable, shipToWorld } = await import('../src/layout.js');
  const ship = createShipState();
  assert.equal(shipWalkable(-2, 20.5, ship, 0.3), false);
  assert.equal(ship.interact(-2, 19.5), 'door');
  for (let i = 0; i < 90; i++) ship.step(1 / 60);
  assert.equal(shipWalkable(-2, 20.5, ship, 0.3), true);
  const g = loadGrid();
  const sim = createSim(g, { free: (x, y, r) => shipWalkable(x, y, ship, r), surface: () => 'deck' });
  sim.state.x = -2;
  sim.state.y = 19.3;
  for (let i = 0; i < 280; i++) sim.step(1 / 60, { x: 0, y: 1 });
  assert.ok(sim.state.y > 26);
  for (let i = 0; i < 450; i++) sim.step(1 / 60, { x: -1, y: 0 });
  assert.ok(sim.state.x < -13);
  assert.deepEqual(shipToWorld(12, 0), [-12, 27]);
  assert.deepEqual(shipToWorld(20, 0), [-20, 27]);
  assert.equal(ship.interact(-18.6, 27), 'console');
  assert.equal(ship.consoleOn, true);
  console.log('main deck walk', JSON.stringify({ x: sim.state.x, y: sim.state.y, door: ship.door, console: ship.consoleOn }));
});

test('M2: inspect orbit changes view while retaining the selected centre', async () => {
  const { createInspect } = await import('../src/inspect.js');
  const inspect = createInspect();
  inspect.select('ship:cockpit', [1, 2, 3], 4);
  const a = inspect.position();
  inspect.orbit(0.5, 0.2, 0);
  assert.equal(inspect.selected, 'ship:cockpit');
  assert.deepEqual(inspect.target, [1, 2, 3]);
  assert.ok(Math.hypot(...inspect.position().map((v, i) => v - a[i])) > 1);
});

test('M2: the visible room dividers and furniture stop a walk, and the door cannot close on Ducky', async () => {
  const { createShipState, shipWalkable } = await import('../src/layout.js');
  const ship = createShipState();
  assert.equal(shipWalkable(-9.7, 25.8, ship, 0.3), false);
  assert.equal(shipWalkable(-17.5, 27, ship, 0.3), false);
  ship.interact(-2, 19);
  ship.step(1);
  assert.equal(ship.interact(-2, 20.5), 'doorway-occupied');
  assert.equal(ship.doorTarget, 1);
  assert.equal(ship.interact(-2, 22), 'door');
  ship.step(1);
  assert.equal(shipWalkable(-2, 20.5, ship, 0.3), false);
});
