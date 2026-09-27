// Coordinates match the walk simulation: x east, y north, z up, metres.
export const SNOW = { speed: 13, gravity: 9.8, cooldown: 0.65, radius: 0.12 };

export function trajectory(origin, yaw, pitch, t) {
  const flat = SNOW.speed * Math.cos(pitch);
  return {
    x: origin.x + Math.cos(yaw) * flat * t,
    y: origin.y + Math.sin(yaw) * flat * t,
    z: origin.z + SNOW.speed * Math.sin(pitch) * t - 0.5 * SNOW.gravity * t * t,
  };
}

export function aimAt(origin, point, fallbackYaw) {
  const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
  const v2 = SNOW.speed * SNOW.speed;
  const dz = point.z - origin.z;
  const disc = v2 * v2 - SNOW.gravity * (SNOW.gravity * distance * distance + 2 * dz * v2);
  return {
    yaw: distance > 0.1 ? Math.atan2(point.y - origin.y, point.x - origin.x) : fallbackYaw,
    pitch: disc >= 0 && distance > 0.1 ? Math.atan((v2 - Math.sqrt(disc)) / (SNOW.gravity * distance)) : 0.55,
  };
}

export function createSnowballs({ collide, onHit = () => {} }) {
  const balls = [];
  const splats = [];
  const hits = [];
  let time = 0;
  let nextThrow = 0;
  let serial = 0;
  return {
    balls, splats, hits,
    get cooldown() { return Math.max(0, nextThrow - time); },
    throw(origin, yaw, pitch) {
      if (time < nextThrow) return false;
      nextThrow = time + SNOW.cooldown;
      balls.push({ id: ++serial, origin: { ...origin }, yaw, pitch, age: 0, ...origin });
      return true;
    },
    step(dt) {
      if (dt <= 0) return;
      time += dt;
      for (let i = balls.length - 1; i >= 0; i--) {
        const ball = balls[i];
        const steps = Math.ceil(dt * 120);
        let hit = null;
        for (let j = 0; j < steps; j++) {
          const old = { x: ball.x, y: ball.y, z: ball.z };
          ball.age += dt / steps;
          const next = trajectory(ball.origin, ball.yaw, ball.pitch, ball.age);
          hit = collide(old, next, SNOW.radius);
          Object.assign(ball, next);
          if (hit) break;
        }
        if (hit) {
          const event = { id: ball.id, time, age: ball.age, ...hit };
          splats.push({ ...event, born: time });
          hits.push(event);
          if (hits.length > 100) hits.shift();
          if (splats.length > 24) splats.shift();
          onHit(event);
          balls.splice(i, 1);
        } else if (ball.age > 5) balls.splice(i, 1);
      }
      while (splats.length && time - splats[0].born > 12) splats.shift();
    },
  };
}
