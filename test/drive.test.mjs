// The headless drive, as a test. The second case is the planted control: with collision off the
// same drive must FAIL the stop check, or the stop check proves nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runDrive, loadGrid } from '../scripts/drive.mjs';
import { circleHit, cellOf, cellBlocked } from '../src/grid.js';

test('the walk grid is the exported one: spawn is open, the hatch sits on the hull', () => {
  const g = loadGrid();
  assert.equal(g.nx * g.cell, 80);
  assert.equal(circleHit(g, g.spawn[0], g.spawn[1], 0.3), null);
  const [i, j] = cellOf(g, g.ship.hatch[0], g.ship.hatch[1] + 0.3);
  assert.equal(cellBlocked(g, i, j), 1);
  assert.equal(g.ship.name, 'The Iceberg');
});

test('collision on: Ducky moves at least 1 m, stays on the ice, stops at the hull', () => {
  const r = runDrive({ collide: true });
  assert.ok(r.checks.moved_at_least_1m, `moved ${r.displacement_m} m`);
  assert.ok(r.checks.kept_on_ice, `${r.steps_off_ice} steps off the ice`);
  assert.ok(r.checks.stopped_at_hull, JSON.stringify({ contact: r.first_hull_contact_s, drift: r.drift_last_2s_m, inside: r.steps_overlapping_obstacles, gap: r.nearest_hull_edge_m }));
});

test('planted control, collision off: the stop check fails because he walks into the ship', () => {
  const r = runDrive({ collide: false });
  assert.ok(r.checks.moved_at_least_1m);
  assert.ok(r.checks.kept_on_ice);
  assert.equal(r.checks.stopped_at_hull, false);
  assert.ok(r.steps_overlapping_obstacles > 0);
});

test('a step with no input, or a negative or zero dt, never moves him', async () => {
  const { createSim } = await import('../src/sim.js');
  const sim = createSim(loadGrid());
  for (const dt of [1 / 60, 0, -0.66, 1 / 30]) sim.step(dt, { x: 0, y: 0 });
  assert.equal(sim.state.x, 0);
  assert.equal(sim.state.y, 0);
});
