// Ducky v2 (art/blender/cast-v2), rigged, with a procedural waddle and a belly slide. He comes as two
// exports on one skeleton: bare-headed on the ice, and in his helmet with the visor closed everywhere
// else (founder, 2026-09-27: "bare headed on ice, helmet everywhere else"). The exports carry only
// the deform bones and no controls, so this drives four of them directly (thighs and upper arms)
// and tilts the whole figure for the side to side roll. The head is left alone.

import * as THREE from 'three';

const AXES = {
  fwd: new THREE.Vector3(1, 0, 0), // he faces +x in his own frame
  up: new THREE.Vector3(0, 1, 0),
  lat: new THREE.Vector3(0, 0, 1), // his right-hand side
};
const PIVOT = 0.45; // the belly slide pitches him about this height, so his belly meets the ice
const LIMBS = { lThigh: 'DEF-thigh.L', rThigh: 'DEF-thigh.R', lArm: 'DEF-upper_arm.L', rArm: 'DEF-upper_arm.R' };
const ON_THE_ICE = new Set(['ice', 'rough']); // sim.js surfaces of the plain; 'deck' is the ship

// Which export he wears on a surface: the bare head only on the ice, the helmet anywhere else.
export function outfitFor(surface) {
  return ON_THE_ICE.has(surface) ? 'ice' : 'helmet';
}

// models: { ice: gltf.scene, helmet: gltf.scene }
export function createDucky(models) {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.name = 'ducky';
  root.add(tilt);
  tilt.position.y = PIVOT;

  const outfits = {};
  for (const [name, model] of Object.entries(models)) {
    model.name = 'ducky:' + name;
    model.position.y = -PIVOT;
    tilt.add(model);
    const bones = {};
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = o.material.transparent === false; // the visor glass casts no shadow, as in Blender
        o.frustumCulled = false;
      }
      if (o.isBone) bones[o.name] = o;
    });
    outfits[name] = { model, bones };
  }
  root.updateMatrixWorld(true);

  function joint(model, b) {
    if (!b) return null;
    const modelInv = new THREE.Quaternion();
    model.getWorldQuaternion(modelInv).invert();
    const pq = new THREE.Quaternion();
    b.parent.getWorldQuaternion(pq);
    const inv = modelInv.multiply(pq).invert();
    const axis = (v) => v.clone().applyQuaternion(inv).normalize();
    return { b, rest: b.quaternion.clone(), fwd: axis(AXES.fwd), lat: axis(AXES.lat), up: axis(AXES.up) };
  }
  for (const o of Object.values(outfits)) {
    // GLTFLoader names nodes with PropertyBinding.sanitizeNodeName, so DEF-thigh.L loads as DEF-thighL.
    o.J = Object.fromEntries(Object.entries(LIMBS).map(([k, bone]) => [k, joint(o.model, o.bones[THREE.PropertyBinding.sanitizeNodeName(bone)])]));
  }
  const q = new THREE.Quaternion();
  function pose(j, turns) {
    if (!j) return;
    j.b.quaternion.copy(j.rest);
    for (const [k, a] of turns) {
      q.setFromAxisAngle(j[k], a);
      j.b.quaternion.premultiply(q);
    }
  }

  let worn = null;
  function wear(name) {
    if (outfits[name] === undefined) throw new Error('No Ducky export for ' + name);
    for (const [k, o] of Object.entries(outfits)) o.model.visible = k === name;
    worn = name;
  }
  wear(outfits.ice ? 'ice' : Object.keys(outfits)[0]);

  let slide = 0;
  let clock = 0;
  function update(s, dt) {
    clock += dt;
    if (typeof s.surface === 'string') wear(outfitFor(s.surface));
    root.position.set(s.x, 0, -s.y);
    root.rotation.y = s.heading;
    const sliding = s.mode === 'slide' ? 1 : 0;
    slide += (sliding - slide) * Math.min(1, dt * (sliding ? 8 : 4));
    const walk = Math.min(1, s.speed / 1.1) * (1 - slide);
    const ph = s.walkPhase;
    const roll = Math.sin(ph) * 0.14 * walk;
    const bob = Math.abs(Math.sin(ph)) * 0.03 * walk;
    const breathe = Math.sin(clock * 2.1) * 0.005 * (1 - walk) * (1 - slide);
    const lean = -0.07 * walk - 1.4 * slide;
    tilt.rotation.set(roll, 0, lean);
    tilt.position.y = PIVOT + bob + breathe;

    const stepA = Math.sin(ph) * 0.38 * walk;
    const out = 0.16 * walk + 0.1 + 0.25 * slide + Math.sin(clock * 2.1) * 0.02 * (1 - walk);
    const swing = Math.sin(ph) * 0.18 * walk;
    const J = outfits[worn].J;
    pose(J.lThigh, [['lat', stepA - 0.5 * slide]]);
    pose(J.rThigh, [['lat', -stepA - 0.5 * slide]]);
    pose(J.lArm, [['fwd', out], ['lat', -swing - 0.35 * slide]]);
    pose(J.rArm, [['fwd', -out], ['lat', s.throwing ? -1.4 : swing - 0.35 * slide]]);
  }

  const first = Object.values(outfits)[0];
  return {
    root, update, wear,
    outfit: () => worn,
    outfits: Object.keys(outfits),
    bones: Object.keys(first.bones),
    joints: Object.fromEntries(Object.keys(LIMBS).map((k) => [k, Object.values(outfits).every((o) => Boolean(o.J[k]))])),
  };
}
