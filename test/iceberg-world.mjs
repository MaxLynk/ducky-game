// Loads the walkable Iceberg's collision GLBs from assets/iceberg in node and plays the game's
// own aboard step (sim.js movement, ship.js physics, the use button) at a fixed rate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { loadGLB } from '../src/gltf-load.js';
import { createShip, canLeave, BOARD_Y } from '../src/ship.js';
import { createSim } from '../src/sim.js';
import { createShipState, shipWalkable, surfaceAt } from '../src/layout.js';
import { loadGrid } from '../scripts/drive.mjs';

export const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'iceberg');
export const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'iceberg.manifest.json'), 'utf8'));

export function collisionFiles(m = manifest) {
  const files = [];
  for (const cell of Object.values(m.cells)) if (cell.collision) files.push(cell.collision.file);
  return files;
}

let rapierReady = null;
export async function loadWorld(opts = {}) {
  rapierReady ??= RAPIER.init();
  await rapierReady;
  const collisionScenes = [];
  for (const file of collisionFiles()) {
    if (opts.skip?.includes(file)) continue;
    const gltf = await loadGLB(fs.readFileSync(path.join(dir, file)));
    collisionScenes.push({ scene: gltf.scene, file });
  }
  const grid = loadGrid();
  const ship = createShip(RAPIER, { manifest, collisionScenes, ship: grid.ship });
  const shipState = createShipState();
  const sim = createSim(grid, { free: (x, y, r) => shipWalkable(x, y, shipState, r, ship.aboard),
    surface: (x, y) => (ship.aboard ? 'deck' : surfaceAt(x, y)) });
  const mover = (dt, dx, dy, s) => ship.tick(dt, dx, dy, s);
  // The same order the game's stepWorld uses.
  function step(dt, input = {}) {
    const s = sim.state;
    let used = null;
    if (input.interact) {
      used = shipState.interact(s.x, s.y);
      if (used === null && ship.aboard) used = ship.interact(s, input.stop);
    }
    sim.step(dt, { x: input.x || 0, y: input.y || 0, slide: input.slide });
    shipState.step(dt);
    ship.setOuterDoor(shipState.door > 0.9);
    if (ship.aboard === false && s.y > BOARD_Y && shipWalkable(s.x, s.y, shipState, 0.3, false) === true) { ship.board(s); sim.setMover(mover); }
    else if (ship.aboard && canLeave(s, (x, y) => shipWalkable(x, y, shipState, 0.3, false))) { ship.leave(s); sim.setMover(null); }
    if (ship.aboard === false) ship.idle(dt);
    return used;
  }
  return { ship, sim, shipState, step, grid };
}

// Run a driver (route-driver.js) until it is done or fails, at 60 Hz. As in the harness, more than
// 0.5 m of continuous ungrounded descent is a fall and fails the run.
export function run(w, driver, maxSeconds = 400) {
  const dt = 1 / 60;
  let minFeet = Infinity;
  let fall = 0;
  let failed = null;
  for (let k = 0; k < maxSeconds * 60; k++) {
    if (driver.done || driver.failed) break;
    const before = w.sim.state.z;
    w.step(dt, driver.read(w.sim.state));
    const after = w.sim.state.z;
    minFeet = Math.min(minFeet, after);
    const c = w.ship.character;
    if (w.ship.aboard && c.grounded === false && after < before && c.platformDelta.y === 0) fall += before - after; else fall = 0;
    if (fall > 0.5) { failed = { reason: 'free_fall', at: w.ship.snapshot().ship, leg: driver.leg }; break; }
  }
  failed ??= driver.failed;
  return { done: driver.done && failed === null, failed, t: w.sim.state.t, log: driver.log, minFeet, end: w.ship.snapshot() };
}

// Stand aboard at a waypoint, as the harness starts a route.
export function placeAt(w, name) {
  w.ship.state.aboard = true;
  w.sim.setMover((dt, dx, dy, s) => w.ship.tick(dt, dx, dy, s));
  w.ship.place(name, w.sim.state);
}
