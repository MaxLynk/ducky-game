// Temporary gameplay blockouts, in the general arrangement's metre scale.
// Local ship station +X points toward the nose. Port is local +Y.
export const shipToWorld = (station, port) => [-station, 27 - port];
export const ROUGH = [
  { id: 'packed-snow-west', x: -9, y: 4, width: 5, depth: 9 },
  { id: 'packed-snow-east', x: 9, y: 6, width: 4, depth: 7 },
];
export const TARGETS = [
  { id: 'target:01', x: -5, y: 10, z: 1.4, radius: 0.8 },
  { id: 'target:02', x: 5, y: 13, z: 1.4, radius: 0.8 },
  { id: 'target:03', x: 9, y: 2, z: 1.4, radius: 0.8 },
];
export const ROOMS = [
  { id: 'blockout:airlock', label: 'AIRLOCK', x0: -3.3, x1: -0.7, y0: 19, y1: 26.5 },
  { id: 'blockout:workshop', label: 'WORKSHOP', x0: -4, x1: 7.7, y0: 21, y1: 33 },
  { id: 'blockout:main-hall', label: 'MAIN DECK', x0: -12.3, x1: -3.7, y0: 25.65, y1: 28.35 },
  { id: 'blockout:kitchen', label: 'KITCHEN', x0: -11.7, x1: -4.3, y0: 21.5, y1: 26.5 },
  { id: 'blockout:captains-cabin', label: "CAPTAIN'S CABIN", x0: -11.7, x1: -4.3, y0: 27.5, y1: 32.5 },
  { id: 'blockout:cockpit', label: 'COCKPIT', x0: -20, x1: -12, y0: 22.5, y1: 31.5 },
];
// Box dimensions also drive the rendered props, so collision follows replacements.
export const FURNITURE = [
  { id: 'blockout:console', x: -19, y: 27, z: 0.6, w: 1, d: 7.4, h: 1.2, type: 'console' },
  { id: 'blockout:seat-pilot', x: -17.5, y: 27, z: 0.55, w: 0.8, d: 0.8, h: 1.1, type: 'seat' },
  { id: 'blockout:seat_RESERVED_port', x: -17.5, y: 25.4, z: 0.55, w: 0.8, d: 0.8, h: 1.1, type: 'seat' },
  { id: 'blockout:seat_RESERVED_stbd', x: -17.5, y: 28.6, z: 0.55, w: 0.8, d: 0.8, h: 1.1, type: 'seat' },
  { id: 'blockout:seat_guest_port', x: -15.6, y: 25.4, z: 0.55, w: 0.8, d: 0.8, h: 1.1, type: 'seat' },
  { id: 'blockout:seat_guest_stbd', x: -15.6, y: 28.6, z: 0.55, w: 0.8, d: 0.8, h: 1.1, type: 'seat' },
  { id: 'blockout:workbench', x: 3, y: 29.5, z: 0.5, w: 3, d: 1.2, h: 1, type: 'bench' },
  { id: 'blockout:galley-counter', x: -8, y: 22.2, z: 0.45, w: 5.5, d: 0.8, h: 0.9, type: 'bench' },
  { id: 'blockout:cabin-bunk', x: -8, y: 31.3, z: 0.35, w: 2.2, d: 1.2, h: 0.7, type: 'seat' },
];

export const WALLS = [
  { id: 'blockout:workshop:port-wall-aft', x: 3.5, y: 21.0, z: 1.5, w: 8.4, d: 0.14, h: 3.0 },
  { id: 'blockout:workshop:port-wall-forward', x: -3.65, y: 21.0, z: 1.5, w: 0.7, d: 0.14, h: 3.0 },
  { id: 'blockout:workshop:starboard-wall', x: 2.0, y: 33.0, z: 1.5, w: 11.5, d: 0.14, h: 3.0 },
  { id: 'blockout:workshop:aft-wall', x: 7.8, y: 27.0, z: 1.5, w: 0.16, d: 12.0, h: 3.0 },
  { id: 'blockout:airlock:west-wall', x: -3.3, y: 20.3, z: 1.5, w: 0.14, d: 2.8, h: 3.0 },
  { id: 'blockout:airlock:east-wall', x: -0.7, y: 20.3, z: 1.5, w: 0.14, d: 2.8, h: 3.0 },
  { id: 'blockout:kitchen:port-wall', x: -8.0, y: 21.5, z: 1.5, w: 8.0, d: 0.14, h: 3.0 },
  { id: 'blockout:cabin:starboard-wall', x: -8.0, y: 32.5, z: 1.5, w: 8.0, d: 0.14, h: 3.0 },
  { id: 'blockout:kitchen:divider', x: -9.7, y: 25.8, z: 1.5, w: 3.7, d: 0.12, h: 3.0 },
  { id: 'blockout:cabin:divider', x: -9.7, y: 28.2, z: 1.5, w: 3.7, d: 0.12, h: 3.0 },
  { id: 'blockout:cockpit:port-wall', x: -16.0, y: 22.5, z: 1.5, w: 8.0, d: 0.14, h: 3.0 },
  { id: 'blockout:cockpit:starboard-wall', x: -16.0, y: 31.5, z: 1.5, w: 8.0, d: 0.14, h: 3.0 },
  { id: 'blockout:forward:port-bulkhead', x: -12.0, y: 23.5, z: 1.5, w: 0.16, d: 4.2, h: 3.0 },
  { id: 'blockout:forward:starboard-bulkhead', x: -12.0, y: 30.5, z: 1.5, w: 0.16, d: 4.2, h: 3.0 },
];

const contains = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
export const inShip = (x, y) => y >= 20.65 && ROOMS.some((r) => contains(r, x, y));
export function surfaceAt(x, y) {
  if (inShip(x, y)) return 'deck';
  return ROUGH.some((r) => Math.abs(x - r.x) < r.width / 2 && Math.abs(y - r.y) < r.depth / 2) ? 'rough' : 'ice';
}

export function shipWalkable(x, y, ship, radius) {
  if (y < 19.6) return null;
  const around = [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius],
    [radius * 0.71, radius * 0.71], [-radius * 0.71, radius * 0.71],
    [radius * 0.71, -radius * 0.71], [-radius * 0.71, -radius * 0.71]];
  const within = ROOMS.some((r) => contains(r, x, y));
  if (within === false) return null;
  if (around.every(([dx, dy]) => ROOMS.some((r) => contains(r, x + dx, y + dy))) === false) return false;
  if (Math.abs(y - 20.5) < radius + 0.15 && x > -3.4 && x < -0.6 && ship.door < 0.9) return false;
  for (const p of [...FURNITURE, ...WALLS]) {
    if (Math.abs(x - p.x) < p.w / 2 + radius && Math.abs(y - p.y) < p.d / 2 + radius) return false;
  }
  return true;
}

export function createShipState() {
  return {
    door: 0, doorTarget: 0, consoleOn: false, events: [],
    interact(x, y) {
      if (Math.hypot(x + 2, y - 20.5) < 2.6) {
        if (Math.abs(y - 20.5) < 0.7 && this.doorTarget === 1) return 'doorway-occupied';
        this.doorTarget = this.doorTarget === 1 ? 0 : 1;
        this.events.push({ kind: 'door', open: this.doorTarget === 1 });
        return 'door';
      }
      if (x < -16.3 && x > -20 && Math.abs(y - 27) < 4) {
        this.consoleOn = this.consoleOn === false;
        this.events.push({ kind: 'console', on: this.consoleOn });
        return 'console';
      }
      return null;
    },
    step(dt) {
      this.door += Math.sign(this.doorTarget - this.door) * Math.min(Math.abs(this.doorTarget - this.door), dt * 1.5);
    },
  };
}
