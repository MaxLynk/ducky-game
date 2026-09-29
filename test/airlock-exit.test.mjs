// Walking back out of the airlock never strands Ducky: the ice sim takes him from the ship's
// physics only through the open outer door, where it can stand him, and anywhere else along the
// airlock's aft wall he stays aboard and walks on. Regresses review 5346232208 (P1) at both jambs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld, run, placeAt } from './iceberg-world.mjs';
import { createRouteDriver } from '../src/route-driver.js';
import { DOORWAY, shipWalkable } from '../src/layout.js';

const dt = 1 / 60;
const hold = (w, input, seconds) => { for (let k = 0; k < seconds * 60; k++) w.step(dt, input); };
const at = (w) => ({ x: +w.sim.state.x.toFixed(4), y: +w.sim.state.y.toFixed(4), z: +w.sim.state.z.toFixed(4), inside: w.ship.aboard, door: w.shipState.door });
// Stick toward a world-plane point, as a player steers, until he is there or the time is up.
function walkTo(w, x, y, seconds) {
  const s = w.sim.state;
  for (let k = 0; k < seconds * 60; k++) {
    const d = Math.hypot(x - s.x, y - s.y);
    if (d < 0.03) return true;
    const m = Math.min(1, d / 0.3);
    w.step(dt, { x: (x - s.x) / d * m, y: (y - s.y) / d * m });
  }
  return false;
}
// Wherever he stands, either the ship holds him or the ice sim allows the spot: never a hull cell.
function assertHeld(w, label) {
  const s = w.sim.state;
  const ok = w.ship.aboard || shipWalkable(s.x, s.y, w.shipState, 0.3) === true || w.sim.free(s.x, s.y);
  assert.ok(ok, label + ': stranded outside the ship ' + JSON.stringify(at(w)));
}
// He can still move, and from where he stands he can walk out through the doorway onto the ice.
function assertWalksOut(w, label) {
  const before = at(w);
  hold(w, { y: 1 }, 1);
  assert.ok(Math.hypot(w.sim.state.x - before.x, w.sim.state.y - before.y) > 0.3, label + ': cannot move from ' + JSON.stringify(before));
  walkTo(w, -2, 21.4, 8);
  walkTo(w, -2, 19.0, 8);
  const out = at(w);
  assert.ok(out.inside === false && out.y < DOORWAY.y0, label + ': never reached the ice ' + JSON.stringify(out));
}
async function openAboard() {
  const w = await loadWorld();
  placeAt(w, 'airlock');
  assert.equal(w.step(dt, { interact: true }), 'door');
  hold(w, {}, 1.2);
  assert.ok(w.shipState.door > 0.99);
  return w;
}

test('the review walk: in from the ice, back to workshop_aft, S+A facing north for 20 s, and out again', async () => {
  const w = await loadWorld();
  hold(w, { y: 1 }, 20); hold(w, { y: -1 }, 70 / 60); hold(w, { x: -1 }, 85 / 60); hold(w, { y: 1 }, 4);
  assert.equal(w.step(dt, { interact: true }), 'door');
  hold(w, {}, 100 / 60);
  const R01 = ['airlock', 'airlock_gate', 'workshop_fwd', 'hall_arch', 'hall_mid', 'kitchen', 'hall_mid', 'cabin', 'hall_mid', 'hall_fwd', 'vestibule_centre', 'vestibule', 'vestibule_centre'];
  assert.ok(run(w, createRouteDriver(w.ship, R01)).done, 'R01 from the ice');
  assert.ok(run(w, createRouteDriver(w.ship, ['hall_fwd', 'hall_mid', 'hall_arch', 'workshop_fwd', 'workshop_port', 'workshop_aft'])).done, 'back to workshop_aft');
  hold(w, { x: -1, y: -1 }, 20); // facing north, S+A is the stick south-west
  const end = at(w);
  console.log('review walk end', JSON.stringify(end));
  assertHeld(w, 'S+A hold');
  assertWalksOut(w, 'after S+A hold');
  hold(w, { y: 1 }, 4);
  assert.equal(w.ship.aboard, true, 'back in through the airlock ' + JSON.stringify(at(w)));
});

test('the mirror: S+D along the aft wall past the east jamb for 20 s, and out again', async () => {
  const w = await openAboard();
  hold(w, { x: 1, y: -1 }, 20);
  console.log('S+D end', JSON.stringify(at(w)));
  assertHeld(w, 'S+D hold');
  assertWalksOut(w, 'after S+D hold');
});

// The door is 1.6 m wide; the capsule (0.22 m) fits nearer each jamb than the ice sim (0.3 m) does.
const offsets = [-0.4, -0.1, 0.1, 0.22, 0.29, 0.31, 0.4];
for (const [jamb, x0, sign] of [['west', DOORWAY.x0, 1], ['east', DOORWAY.x1, -1]]) {
  test(`the ${jamb} jamb: walking straight out at every offset leaves him aboard or on the ice, never stranded`, async () => {
    const ends = [];
    for (const o of offsets) {
      const w = await openAboard();
      const x = x0 + sign * o;
      assert.ok(walkTo(w, x, 21.5, 8), `${jamb} ${o}: reach the start`);
      hold(w, { y: -1 }, 3);
      ends.push([o, at(w)]);
      assertHeld(w, `${jamb} ${o}`);
      const clear = sign * (x - x0) >= 0.3;
      if (clear) assert.ok(w.ship.aboard === false && w.sim.state.y < DOORWAY.y0, `${jamb} ${o}: clear of the jamb, straight out ` + JSON.stringify(at(w)));
      else assert.equal(w.ship.aboard, true, `${jamb} ${o}: against the jamb or the wall, still aboard`);
      assertWalksOut(w, `${jamb} ${o}`);
    }
    console.log(jamb, JSON.stringify(ends));
  });
}

test('the outer door shut: he stays aboard at the door, and E opens it', async () => {
  const w = await loadWorld();
  placeAt(w, 'airlock');
  assert.ok(walkTo(w, -2, 21.5, 8));
  hold(w, { y: -1 }, 3);
  assert.equal(w.ship.aboard, true, 'door shut ' + JSON.stringify(at(w)));
  assert.equal(w.step(dt, { interact: true }), 'door');
  hold(w, {}, 1.2);
  hold(w, { y: -1 }, 3);
  assert.ok(w.ship.aboard === false && w.sim.state.y < DOORWAY.y0, 'out once open ' + JSON.stringify(at(w)));
});
