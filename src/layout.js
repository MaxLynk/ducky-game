// The ice plain's gameplay pieces, and the one stretch of the ship the 2D ice sim still walks: the
// airlock doorway. Past it Ducky is aboard, on the walkable export's physics (ship.js).
// World plane metres: x east, y north. The outer door is the export's airlock_outerdoor, ship
// station 1.2 to 2.8 on the port side, which the ship's placement puts at x -2.8 to -1.2, y 20.5.
export const ROUGH = [
  { id: 'packed-snow-west', x: -9, y: 4, width: 5, depth: 9 },
  { id: 'packed-snow-east', x: 9, y: 6, width: 4, depth: 7 },
];
export const TARGETS = [
  { id: 'target:01', x: -5, y: 10, z: 1.4, radius: 0.8 },
  { id: 'target:02', x: 5, y: 13, z: 1.4, radius: 0.8 },
  { id: 'target:03', x: 9, y: 2, z: 1.4, radius: 0.8 },
];
export const HATCH = { x: -2, y: 20.5 };
export const DOORWAY = { x0: -2.8, x1: -1.2, y0: 19.6, y1: 21.3 };

export const inDoorway = (x, y) => x >= DOORWAY.x0 && x <= DOORWAY.x1 && y >= DOORWAY.y0 && y <= DOORWAY.y1;
export const inShip = (x, y) => y >= 20.65 && inDoorway(x, y);
export function surfaceAt(x, y) {
  if (inShip(x, y)) return 'deck';
  return ROUGH.some((r) => Math.abs(x - r.x) < r.width / 2 && Math.abs(y - r.y) < r.depth / 2) ? 'rough' : 'ice';
}

// On the ice near the ship: null lets the walk grid decide; true or false rules the doorway.
// Aboard, the physics decides everything, so this is never asked.
export function shipWalkable(x, y, ship, radius, aboard = false) {
  if (aboard || y < DOORWAY.y0) return null;
  if (inDoorway(x, y) === false) return null;
  if (x - radius < DOORWAY.x0 || x + radius > DOORWAY.x1) return false;
  if (y + radius > HATCH.y - 0.15 && ship.door < 0.9) return false;
  return true;
}

export function createShipState() {
  return {
    door: 0, doorTarget: 0, events: [],
    interact(x, y) {
      if (Math.hypot(x - HATCH.x, y - HATCH.y) < 2.6) {
        if (Math.abs(y - HATCH.y) < 0.7 && this.doorTarget === 1) return 'doorway-occupied';
        this.doorTarget = this.doorTarget === 1 ? 0 : 1;
        this.events.push({ kind: 'door', open: this.doorTarget === 1 });
        return 'door';
      }
      return null;
    },
    step(dt) {
      this.door += Math.sign(this.doorTarget - this.door) * Math.min(Math.abs(this.doorTarget - this.door), dt * 1.5);
    },
  };
}
