// Ported from the Ducky harness engine (art/blender/iceberg-game/harness/src/engine/character.js at
// commit 44bfb756), where the walkable Iceberg export was proved. Only the import paths changed.
// Capsule character on Rapier's KinematicCharacterController.
//
// Order of a game tick that uses this module:
//   1. registry.beginTick()
//   2. move platforms (elevator.update(dt), which calls each moving entry's setPose)
//   3. character.step(dt, desiredHorizontalVelocity)
//   4. world.step()
//
// Platform riding: before moving, a ray is cast straight down from the capsule centre to find the
// ground collider. params.platformDelta(collider) returns how far that collider's node moved this
// tick (colliders.js registry.platformDelta), or null for static ground. That translation is added
// to this tick's movement:
//   - the horizontal part goes into the desired movement handed to the controller, so a sideways
//     platform cannot carry the character through a wall;
//   - the vertical part is applied first, as a carry, because the platform has already moved when
//     the controller runs: the character is moved with it, then resolves its own motion from there.
//     The carry is SWEPT first: the capsule is shape-cast along it against every solid except the
//     support collider and whatever moved with it this tick (the rest of the car). If something is
//     in the way the carry stops short of it, state.carryObstruction names what, and
//     params.onCarryObstructed(info) is called so the game can stop the platform. A carry is never
//     a teleport through a ceiling.
// In "parentless" moving mode (the default) this is the only carry. In "kinematic" mode the
// registry returns null and Rapier's controller applies its own velocity based kinematic carry.

export const DEFAULTS = Object.freeze({
  offset: 0.02,           // controller skin: the gap it keeps from obstacles
  stepMax: 0.20,          // autostep max height, metres
  stepMinWidth: 0.15,     // autostep min width, metres
  snap: 0.25,             // snap to ground distance, metres
  maxSlopeDeg: 35,        // max climbable slope, degrees
  gravity: -9.81,
  groundProbe: 0.10,      // how far below the capsule bottom still counts as "standing on"
});

export function createCharacter(RAPIER, world, params) {
  const p = { ...DEFAULTS, ...params };
  const { height, radius } = p;
  if (!(height > 2 * radius)) throw new Error(`character height ${height} must exceed twice the radius ${radius}`);
  const halfHeight = (height - 2 * radius) / 2;   // half of the cylinder part
  const halfTotal = height / 2;                    // centre to capsule bottom

  const start = p.position || { x: 0, y: halfTotal + p.offset, z: 0 };
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y, start.z),
  );
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius), body);

  const controller = world.createCharacterController(p.offset);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.enableAutostep(p.stepMax, p.stepMinWidth, false);
  controller.enableSnapToGround(p.snap);
  controller.setMaxSlopeClimbAngle(p.maxSlopeDeg * Math.PI / 180);
  controller.setMinSlopeSlideAngle(p.maxSlopeDeg * Math.PI / 180);
  controller.setSlideEnabled(true);
  controller.setApplyImpulsesToDynamicBodies(false);

  const queryFlags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
  const down = { x: 0, y: -1, z: 0 };
  const nameOf = typeof p.nameOfCollider === 'function' ? p.nameOfCollider : () => null;
  const platformDeltaOf = typeof p.platformDelta === 'function' ? p.platformDelta : () => null;

  const state = {
    vy: 0,
    grounded: false,
    groundCollider: null,
    groundName: null,
    platformDelta: { x: 0, y: 0, z: 0 },
    collisions: [],
    carryObstruction: null,
  };
  const onCarryObstructed = typeof p.onCarryObstructed === 'function' ? p.onCarryObstructed : () => {};

  // Colliders that moved by exactly this delta this tick ride with the support (the car's own walls,
  // ceiling and doors); the carry is not swept against them.
  function sameDelta(c, d) {
    const e = platformDeltaOf(c);
    return !!e && Math.abs(e.x - d.x) < 1e-9 && Math.abs(e.y - d.y) < 1e-9 && Math.abs(e.z - d.z) < 1e-9;
  }

  /** Sweep the capsule by dy. Returns the distance it may travel and what stopped it, if anything. */
  function sweepCarry(pos, dy, support, d) {
    const dist = Math.abs(dy);
    const hit = world.castShape(pos, collider.rotation(), { x: 0, y: Math.sign(dy), z: 0 }, collider.shape,
      0, dist + p.offset, false, queryFlags, undefined, collider, body,
      (c) => c.handle !== support.handle && !sameDelta(c, d));
    if (!hit || hit.time_of_impact >= dist + p.offset) return { travel: dy, hit: null };
    const allowed = Math.max(0, hit.time_of_impact - p.offset);
    return { travel: Math.sign(dy) * Math.min(dist, allowed), hit };
  }

  function findGround(pos) {
    const ray = new RAPIER.Ray({ x: pos.x, y: pos.y, z: pos.z }, down);
    const hit = world.castRay(ray, halfTotal + p.groundProbe + p.offset + p.snap, true, queryFlags, undefined, collider, body);
    if (!hit) return null;
    if (hit.timeOfImpact > halfTotal + p.offset + p.groundProbe) return null;
    return hit.collider;
  }

  function step(dt, desiredVel = { x: 0, z: 0 }) {
    let pos = body.translation();

    // Ground under the capsule, and how far it moved this tick.
    const ground = findGround(pos);
    state.groundCollider = ground;
    state.groundName = ground ? nameOf(ground) : null;
    const d = ground ? platformDeltaOf(ground) : null;
    const dx = d ? d.x : 0, dy = d ? d.y : 0, dz = d ? d.z : 0;
    state.platformDelta = { x: dx, y: dy, z: dz };

    // Vertical carry first, swept: the platform is already at this tick's pose.
    state.carryObstruction = null;
    if (dy !== 0) {
      const sw = sweepCarry(pos, dy, ground, d);
      if (sw.hit) {
        state.carryObstruction = {
          by: nameOf(sw.hit.collider), wanted_m: dy, carried_m: sw.travel,
          at: { x: pos.x, y: pos.y, z: pos.z },
        };
        onCarryObstructed(state.carryObstruction);
      }
      if (sw.travel !== 0) {
        pos = { x: pos.x, y: pos.y + sw.travel, z: pos.z };
        body.setTranslation(pos, true);
        world.propagateModifiedBodyPositionsToColliders();
      }
    }

    // Gravity integration.
    state.vy += p.gravity * dt;
    const desired = {
      x: (desiredVel.x || 0) * dt + dx,
      y: state.vy * dt,
      z: (desiredVel.z || 0) * dt + dz,
    };

    controller.computeColliderMovement(collider, desired, queryFlags);
    const mv = controller.computedMovement();
    state.grounded = controller.computedGrounded();
    if (state.grounded || mv.y > desired.y + 1e-6) state.vy = 0;

    const hits = [];
    const n = controller.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const c = controller.computedCollision(i);
      if (c && c.collider) hits.push({ name: nameOf(c.collider), normal: { x: c.normal1.x, y: c.normal1.y, z: c.normal1.z } });
    }
    state.collisions = hits;

    body.setNextKinematicTranslation({ x: pos.x + mv.x, y: pos.y + mv.y, z: pos.z + mv.z });
  }

  function teleport(pt) {
    body.setTranslation(pt, true);
    body.setNextKinematicTranslation(pt);
    world.propagateModifiedBodyPositionsToColliders();
    state.vy = 0;
  }

  return {
    body, collider, controller, params: p, halfTotal,
    step, teleport,
    get position() { const t = body.translation(); return { x: t.x, y: t.y, z: t.z }; },
    get feetY() { return body.translation().y - halfTotal; },
    get grounded() { return state.grounded; },
    get groundCollider() { return state.groundCollider; },
    get groundName() { return state.groundName; },
    get platformDelta() { return state.platformDelta; },
    get collisions() { return state.collisions; },
    get carryObstruction() { return state.carryObstruction; },
    get verticalVelocity() { return state.vy; },
  };
}
