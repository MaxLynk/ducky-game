// The walk grid exported from the private Blender production pipeline: the ship's hull and the
// set's obstacles, sliced at Ducky's height band and flood filled from his spawn. Pure JS, so the
// browser and the headless drive test read exactly the same data.

function bytesFromBase64(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function decodeGrid(json) {
  return {
    cell: json.cell,
    x0: json.x0,
    y0: json.y0,
    nx: json.nx,
    ny: json.ny,
    x1: json.x0 + json.nx * json.cell,
    y1: json.y0 + json.ny * json.cell,
    blocked: bytesFromBase64(json.blocked_b64),
    hullEdge: bytesFromBase64(json.hull_edge_b64),
    spawn: json.spawn,
    ship: json.ship,
  };
}

function bit(bits, g, i, j) {
  const k = j * g.nx + i;
  return (bits[k >> 3] >> (k & 7)) & 1;
}

export function inBounds(g, i, j) {
  return i >= 0 && j >= 0 && i < g.nx && j < g.ny;
}

export function cellBlocked(g, i, j) {
  if (!inBounds(g, i, j)) return 1;
  return bit(g.blocked, g, i, j);
}

export function cellHull(g, i, j) {
  if (!inBounds(g, i, j)) return 0;
  return bit(g.hullEdge, g, i, j);
}

export function cellOf(g, x, y) {
  return [Math.floor((x - g.x0) / g.cell), Math.floor((y - g.y0) / g.cell)];
}

// Does a circle at (x, y) of radius r overlap any blocked cell? Returns the first hit or null.
export function circleHit(g, x, y, r) {
  const i0 = Math.floor((x - r - g.x0) / g.cell);
  const i1 = Math.floor((x + r - g.x0) / g.cell);
  const j0 = Math.floor((y - r - g.y0) / g.cell);
  const j1 = Math.floor((y + r - g.y0) / g.cell);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (!cellBlocked(g, i, j)) continue;
      const cx0 = g.x0 + i * g.cell;
      const cy0 = g.y0 + j * g.cell;
      const px = Math.min(Math.max(x, cx0), cx0 + g.cell);
      const py = Math.min(Math.max(y, cy0), cy0 + g.cell);
      if ((px - x) * (px - x) + (py - y) * (py - y) < r * r) return [i, j];
    }
  }
  return null;
}

// Distance from (x, y) to the nearest hull edge cell centre, searched out to `reach` metres.
export function nearestHull(g, x, y, reach = 3) {
  const n = Math.ceil(reach / g.cell);
  const [ci, cj] = cellOf(g, x, y);
  let best = Infinity;
  for (let j = cj - n; j <= cj + n; j++) {
    for (let i = ci - n; i <= ci + n; i++) {
      if (!cellHull(g, i, j)) continue;
      const cx = g.x0 + (i + 0.5) * g.cell;
      const cy = g.y0 + (j + 0.5) * g.cell;
      const d = Math.hypot(cx - x, cy - y);
      if (d < best) best = d;
    }
  }
  return best;
}
