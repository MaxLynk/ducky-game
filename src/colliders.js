// Ported from the Ducky harness engine (art/blender/iceberg-game/harness/src/engine/colliders.js at
// commit 44bfb756), where the walkable Iceberg export was proved. Only the import paths changed.
// Build Rapier colliders from loaded glTF scenes, driven only by node extras (object.userData).
//
// Conventions (see CONTRACT.md):
//   extras.collider = "static" | "kinematic" | "trigger"
//   extras.shape    = "convex" | "trimesh"
//   extras.surface, extras.cell, extras.stop, extras.slide are carried on the registry entry.
// Static and non-moving trigger nodes: vertices are taken in world space (the contract says their
// node transform is identity, but world space is correct either way) and attached to one shared
// fixed body.
// Moving nodes (collider "kinematic", anything under a kinematic node, and anything under an
// elevator's car_node): vertices are node local with any world scale baked in, and the collider is
// posed at the node's world translation and rotation at load time (the closed pose at the rest
// stop). Every moving entry has setPose(t), and the registry records how far each moved this tick
// (platformDelta) so a character can ride it. Two ways to hold a moving node, options.movingMode:
//
//   "parentless" (default): the collider has no rigid body and setPose moves it directly
//     (Collider.setTranslation). Rapier's KinematicCharacterController treats it as fixed geometry.
//   "kinematic": one kinematicPositionBased body per node, setPose calls
//     setNextKinematicTranslation. This is the textbook layout, but in Rapier 0.21.0 the character
//     controller stalls when walking on any collider whose parent is a kinematic body (it applies
//     its own velocity based platform carry, and on a floor at rest the character stops dead after a
//     few ticks with 20 computed collisions). Kept so the stall can be re-tested on a new Rapier:
//     run.mjs --moving-mode kinematic.
//
// After adding scenes, step the world once before any scene query: in Rapier 0.21.0 castRay and the
// character controller see no colliders until the broad phase has been built by world.step().
//
// No test logic lives here. The registry lets callers look up and remove colliders by node name.

import * as THREE from 'three';
import { nodeName } from './gltf-load.js';

export const NODE_PREFIXES = ['COL__', 'TRIG__', 'ELEV__'];

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _qi = new THREE.Quaternion();

function hasPrefix(name) {
  return NODE_PREFIXES.some((p) => name.startsWith(p));
}

/** Meshes that belong to this collider node: itself if it is a mesh, plus un-named primitive children. */
function nodeMeshes(obj) {
  const out = [];
  if (obj.isMesh) out.push(obj);
  for (const child of obj.children) {
    if (child.isMesh && !(child.userData && (child.userData.collider || child.userData.name))) out.push(child);
  }
  return out;
}

/** Gather world-space vertices and a flat index list for all meshes of a node. */
function gatherWorldGeometry(obj) {
  const positions = [];
  const indices = [];
  for (const mesh of nodeMeshes(obj)) {
    const geom = mesh.geometry;
    const pos = geom && geom.attributes && geom.attributes.position;
    if (!pos) continue;
    const base = positions.length / 3;
    for (let i = 0; i < pos.count; i++) {
      _v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
      positions.push(_v.x, _v.y, _v.z);
    }
    if (geom.index) {
      for (let i = 0; i < geom.index.count; i++) indices.push(base + geom.index.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) indices.push(base + i);
    }
  }
  return { positions, indices };
}

function makeShapeDesc(RAPIER, shape, positions, indices, trimeshFlags, warn, name) {
  if (positions.length < 9) return null;
  const verts = new Float32Array(positions);
  if (shape === 'trimesh') {
    const idx = new Uint32Array(indices);
    return trimeshFlags ? RAPIER.ColliderDesc.trimesh(verts, idx, trimeshFlags) : RAPIER.ColliderDesc.trimesh(verts, idx);
  }
  const hull = RAPIER.ColliderDesc.convexHull(verts);
  if (hull) return hull;
  warn(`${name}: convex hull failed (degenerate points), falling back to trimesh`);
  const idx = new Uint32Array(indices);
  return RAPIER.ColliderDesc.trimesh(verts, idx);
}

/**
 * Create an empty registry bound to a Rapier world. Call addScene() for every loaded GLB scene.
 * options.trimeshFlags: Rapier TriMeshFlags for "trimesh" shapes (default none, two sided).
 * options.warn: function(message) for non-fatal problems (default console.warn).
 */
export function createColliderRegistry(RAPIER, world, options = {}) {
  const warn = options.warn || ((m) => console.warn(m));
  const trimeshFlags = options.trimeshFlags || 0;
  const movingMode = options.movingMode || 'parentless';
  if (!['parentless', 'kinematic'].includes(movingMode)) throw new Error(`movingMode ${movingMode}: use parentless or kinematic`);
  const fixedBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  const entries = new Map();      // node name -> entry
  const byHandle = new Map();     // collider handle -> entry
  const byObject = new Map();     // three Object3D -> entry
  const elevators = [];           // { name, object, spec }
  const duplicates = [];

  function attach(entry, desc, body) {
    const collider = world.createCollider(desc, body);
    entry.colliders.push(collider);
    byHandle.set(collider.handle, entry);
  }

  function addScene(scene, source = '') {
    scene.updateMatrixWorld(true);

    // Moving roots: kinematic nodes and every elevator's car node.
    const carNames = new Set();
    scene.traverse((o) => {
      const ex = o.userData && o.userData.elevator;
      if (ex && typeof ex === 'object') {
        elevators.push({ name: nodeName(o), object: o, spec: ex, source });
        if (ex.car_node) carNames.add(ex.car_node);
      }
    });
    const isMovingRoot = (o) => (o.userData && o.userData.collider === 'kinematic') || carNames.has(nodeName(o));
    const isMoving = (o) => {
      for (let a = o; a; a = a.parent) if (isMovingRoot(a)) return true;
      return false;
    };

    scene.traverse((obj) => {
      const name = nodeName(obj);
      const ud = obj.userData || {};
      const kind = ud.collider;
      const movingRoot = isMovingRoot(obj);
      if (!kind && !movingRoot) return;
      if (!hasPrefix(name)) warn(`${name}: has collider extras but no COL__, TRIG__ or ELEV__ prefix`);
      if (entries.has(name)) {
        duplicates.push(name);
        warn(`${name}: duplicate collider node name (source ${source}), later copy ignored`);
        return;
      }
      const moving = isMoving(obj);
      const extras = { ...ud };
      delete extras.name;
      const entry = {
        name,
        object: obj,
        source,
        extras,
        kind: kind || 'kinematic',
        surface: ud.surface || null,
        cell: ud.cell || null,
        stop: ud.stop || null,
        slide: Array.isArray(ud.slide) ? ud.slide.slice() : null,
        moving,
        body: null,
        colliders: [],
        removed: false,
        closedTranslation: null,
        rotation: null,
      };

      const { positions, indices } = gatherWorldGeometry(obj);
      const shape = ud.shape || 'convex';

      if (moving) {
        obj.matrixWorld.decompose(_p, _q, _s);
        entry.closedTranslation = { x: _p.x, y: _p.y, z: _p.z };
        entry.rotation = { x: _q.x, y: _q.y, z: _q.z, w: _q.w };
        entry.pose = { ...entry.closedTranslation };
        entry.tickDelta = { x: 0, y: 0, z: 0 };
        let body;
        if (movingMode === 'kinematic') {
          body = world.createRigidBody(
            RAPIER.RigidBodyDesc.kinematicPositionBased()
              .setTranslation(_p.x, _p.y, _p.z)
              .setRotation(entry.rotation),
          );
          entry.body = body;
        }
        // Bring world vertices into the node frame (rigid part only, so scale stays baked in).
        _qi.copy(_q).invert();
        const local = new Array(positions.length);
        for (let i = 0; i < positions.length; i += 3) {
          _v.set(positions[i] - _p.x, positions[i + 1] - _p.y, positions[i + 2] - _p.z).applyQuaternion(_qi);
          local[i] = _v.x; local[i + 1] = _v.y; local[i + 2] = _v.z;
        }
        const desc = makeShapeDesc(RAPIER, shape, local, indices, trimeshFlags, warn, name);
        if (desc) {
          if (kind === 'trigger') desc.setSensor(true);
          if (!body) desc.setTranslation(_p.x, _p.y, _p.z).setRotation(entry.rotation);
          attach(entry, desc, body);
        }
        entry.setPose = (t) => {
          entry.tickDelta.x += t.x - entry.pose.x;
          entry.tickDelta.y += t.y - entry.pose.y;
          entry.tickDelta.z += t.z - entry.pose.z;
          entry.pose = { x: t.x, y: t.y, z: t.z };
          if (entry.body) entry.body.setNextKinematicTranslation(entry.pose);
          else for (const c of entry.colliders) c.setTranslation(entry.pose);
        };
      } else {
        entry.body = fixedBody;
        const desc = makeShapeDesc(RAPIER, shape, positions, indices, trimeshFlags, warn, name);
        if (desc) {
          if (kind === 'trigger') desc.setSensor(true);
          attach(entry, desc, fixedBody);
        } else if (kind) {
          warn(`${name}: collider node has no usable geometry`);
        }
      }
      entries.set(name, entry);
      byObject.set(obj, entry);
    });
  }

  function get(name) { return entries.get(name) || null; }

  /** Remove every collider of a node. Returns false if no such node. */
  function remove(name) {
    const e = entries.get(name);
    if (!e) return false;
    for (const c of e.colliders) {
      byHandle.delete(c.handle);
      world.removeCollider(c, true);
    }
    e.colliders = [];
    e.removed = true;
    return true;
  }

  /** Entry owning a Rapier collider, or null (for example the character's own capsule). */
  function entryForCollider(collider) {
    return collider ? (byHandle.get(collider.handle) || null) : null;
  }

  /** Registry entries whose node is a descendant of (or equal to) the given object. */
  function descendantsOf(object) {
    const out = [];
    object.traverse((o) => { const e = byObject.get(o); if (e) out.push(e); });
    return out;
  }

  /** Call once at the start of every tick, before anything calls setPose. */
  function beginTick() {
    for (const e of entries.values()) if (e.tickDelta) { e.tickDelta.x = 0; e.tickDelta.y = 0; e.tickDelta.z = 0; }
  }

  /**
   * How far the moving node owning this collider moved this tick, for a character standing on it.
   * Null for static geometry, and null in "kinematic" mode, where Rapier's character controller
   * applies its own kinematic platform carry.
   */
  function platformDelta(collider) {
    if (movingMode !== 'parentless') return null;
    const e = entryForCollider(collider);
    return e && e.moving && e.tickDelta ? e.tickDelta : null;
  }

  /** True for colliders of static (non-moving) collider nodes. */
  function isStatic(collider) {
    const e = entryForCollider(collider);
    return !!(e && !e.moving);
  }

  return {
    world, fixedBody, entries, elevators, duplicates, movingMode,
    addScene, get, remove, entryForCollider, descendantsOf, beginTick, platformDelta, isStatic,
  };
}
