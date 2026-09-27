// Which Ducky the player wears. Founder, 2026-09-27: "bare headed on ice, helmet everywhere else."
// The last case reads the committed asset pack in assets/ when it is present.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createDucky, outfitFor } from '../src/ducky.js';
import { createSim } from '../src/sim.js';
import { surfaceAt } from '../src/layout.js';
import { loadGrid } from '../scripts/drive.mjs';

const LIMBS = ['DEF-thigh.L', 'DEF-thigh.R', 'DEF-upper_arm.L', 'DEF-upper_arm.R'];

function figure(bones = LIMBS) {
  const scene = new THREE.Group();
  const spine = new THREE.Bone();
  spine.name = 'DEF-spine';
  scene.add(spine);
  for (const name of bones) {
    const b = new THREE.Bone();
    b.name = name;
    spine.add(b);
  }
  return scene;
}

test('bare head on the ice and the rough ice, helmet on the deck and anywhere else', () => {
  assert.equal(outfitFor('ice'), 'ice');
  assert.equal(outfitFor('rough'), 'ice');
  assert.equal(outfitFor('deck'), 'helmet');
  assert.equal(outfitFor('mars'), 'helmet');
});

test('the surface the sim reports picks the export: spawn is ice, the cockpit deck is helmet', () => {
  const g = loadGrid();
  const sim = createSim(g, { surface: surfaceAt });
  sim.step(1 / 30, { x: 0, y: 0 });
  assert.equal(sim.state.surface, 'ice');
  assert.equal(outfitFor(sim.state.surface), 'ice');
  assert.equal(surfaceAt(-16.0, 27.0), 'deck'); // the forward cockpit, layout.js
  assert.equal(outfitFor(surfaceAt(-16.0, 27.0)), 'helmet');
});

test('walking aboard swaps to the helmet export, and back on the ice swaps it off', () => {
  const ice = figure();
  const helmet = figure();
  const d = createDucky({ ice, helmet });
  assert.deepEqual(d.outfits, ['ice', 'helmet']);
  assert.deepEqual(d.joints, { lThigh: true, rThigh: true, lArm: true, rArm: true });
  const s = { x: 0, y: 0, heading: 0, mode: 'walk', speed: 1, walkPhase: 1 };
  const seen = [];
  for (const surface of ['ice', 'rough', 'deck', 'deck', 'ice']) {
    d.update({ ...s, surface }, 1 / 30);
    assert.equal(ice.visible, d.outfit() === 'ice');
    assert.equal(helmet.visible, d.outfit() === 'helmet');
    seen.push(d.outfit());
  }
  assert.deepEqual(seen, ['ice', 'ice', 'helmet', 'helmet', 'ice']);
  // the waddle drives the worn export's own thigh
  const thigh = helmet.getObjectByName('DEF-thigh.L');
  d.update({ ...s, surface: 'deck', walkPhase: 1.3 }, 1 / 30);
  assert.ok(thigh.quaternion.angleTo(new THREE.Quaternion()) > 0.01);
});

test('planted control: an export without the v2 limb bones reports its joints missing', () => {
  const d = createDucky({ ice: figure(['L_Thigh', 'R_Thigh', 'L_Upperarm', 'R_Upperarm']), helmet: figure() });
  assert.deepEqual(d.joints, { lThigh: false, rThigh: false, lArm: false, rArm: false });
});

function glbJson(file) {
  const b = fs.readFileSync(file);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const have = ['ducky-ice.glb', 'ducky-helmet.glb'].every((f) => fs.existsSync(path.join(assets, f)));
test('the two exports share one skeleton; only the helmet export carries the helmet and visor', { skip: have ? false : 'asset pack not present' }, () => {
  const ice = glbJson(path.join(assets, 'ducky-ice.glb'));
  const helmet = glbJson(path.join(assets, 'ducky-helmet.glb'));
  const joints = (j) => j.skins[0].joints.map((i) => j.nodes[i].name);
  assert.deepEqual(joints(ice), joints(helmet));
  for (const bone of LIMBS) assert.ok(joints(ice).includes(bone), bone);
  const names = (j) => j.nodes.map((n) => n.name || '');
  assert.equal(names(ice).some((n) => n.startsWith('ducky_v2_helmet')), false);
  assert.ok(names(helmet).some((n) => n.startsWith('ducky_v2_helmet_visor')));
  assert.equal(helmet.materials.find((m) => m.name === 'ducky_v2_visor_glass').alphaMode, 'BLEND');
  assert.ok(names(ice).some((n) => n.startsWith('ducky_v2_scarf')));
  assert.ok(names(helmet).some((n) => n.startsWith('ducky_v2_scarf')));
});
