// Static build with no bundler and no dependency beyond three itself: copy the page, the
// sources, the parts of three the page imports, and the exported assets into dist/.
// Any static file server can host dist/; it fetches nothing from any other origin.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { phoneProblems } from './make-phone-assets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(root, 'dist');
const three = path.join(root, 'node_modules', 'three');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};
copy(path.join(root, 'index.html'), path.join(dist, 'index.html'));
for (const f of ['THIRD-PARTY.md', 'LICENSE', 'ASSETS-LICENSE.md']) copy(path.join(root, f), path.join(dist, f));
for (const f of fs.readdirSync(path.join(root, 'src'))) copy(path.join(root, 'src', f), path.join(dist, 'src', f));
const vendor = [
  'LICENSE',
  'build/three.module.js',
  'build/three.core.js',
  'examples/jsm/loaders/GLTFLoader.js',
  'examples/jsm/utils/BufferGeometryUtils.js',
  'examples/jsm/utils/SkeletonUtils.js',
  'examples/jsm/environments/RoomEnvironment.js',
  // The walkable Iceberg's GLBs: meshopt geometry and KTX2 (Basis Universal) textures.
  'examples/jsm/loaders/KTX2Loader.js',
  'examples/jsm/libs/ktx-parse.module.js',
  'examples/jsm/libs/zstddec.module.js',
  'examples/jsm/libs/meshopt_decoder.module.js',
  'examples/jsm/libs/basis/basis_transcoder.js',
  'examples/jsm/libs/basis/basis_transcoder.wasm',
  'examples/jsm/libs/basis/README.md', // names its licence, Apache-2.0 (Binomial LLC)
  'examples/jsm/utils/WorkerPool.js',
  'examples/jsm/math/ColorSpaces.js',
];
for (const f of vendor) copy(path.join(three, f), path.join(dist, 'vendor', 'three', f));
// Rapier (Apache-2.0) drives the ship's physics; its licence travels with the one file it ships as.
const rapier = path.join(root, 'node_modules', '@dimforge', 'rapier3d-compat');
for (const f of ['LICENSE', 'dist/rapier.mjs']) copy(path.join(rapier, f), path.join(dist, 'vendor', 'rapier', path.basename(f)));

const assets = path.join(root, 'assets');
const wanted = ['set.glb', 'ducky-ice.glb', 'ducky-helmet.glb', 'sky.jpg', 'collision.json', 'provenance.json'];
const missing = [];
for (const f of wanted) {
  const src = path.join(assets, f);
  if (fs.existsSync(src)) copy(src, path.join(dist, 'assets', f));
  else missing.push(f);
}
// Phone variants (scripts/make-phone-assets.mjs) must match the assets they were made from.
const phoneDir = path.join(assets, 'phone');
const phoneManifest = path.join(phoneDir, 'manifest.json');
if (fs.existsSync(phoneManifest) === false) missing.push('phone/manifest.json');
else {
  const { stale, corrupt, missing: gone } = phoneProblems(assets, wanted.filter((f) => f.endsWith('.glb') || f === 'sky.jpg'));
  missing.push(...gone);
  if (stale.length) throw new Error('Phone assets are stale for ' + stale.join(', ') + '. Run node scripts/make-phone-assets.mjs and commit assets/phone.');
  if (corrupt.length) throw new Error('Phone assets do not match their manifest sha256: ' + corrupt.join(', ') + '. Run node scripts/make-phone-assets.mjs and commit assets/phone.');
  for (const f of fs.readdirSync(phoneDir)) copy(path.join(phoneDir, f), path.join(dist, 'assets', 'phone', f));
}
// The walkable Iceberg export (assets/iceberg): the game ships what it loads, the desktop and
// phone LOD it draws and every collision GLB, each checked against the export manifest's sha256,
// plus a small runtime manifest. The unused phone LODs and the barrier reference stay in the repo.
const iceberg = path.join(assets, 'iceberg');
const manifestPath = path.join(iceberg, 'iceberg.manifest.json');
if (fs.existsSync(manifestPath) === false) missing.push('iceberg/iceberg.manifest.json');
else {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const runtime = { id: m.id, source: m.source, cells: {}, waypoints: m.waypoints, edges: m.edges, elevator_edges: m.elevator_edges,
    routes: m.routes, rooms: m.rooms,
    neighbours: Object.fromEntries(Object.entries(m.cameras).map(([k, c]) => [k, c.neighbours])), placed_rooms: m.placed_rooms, elevator: m.elevator, sockets: m.sockets, characters: m.characters };
  const bad = [];
  const ship = (logical) => {
    const entry = m.files[logical];
    if (entry === undefined) { bad.push(logical + ' is not in the manifest'); return null; }
    const src = path.join(iceberg, entry.file);
    if (fs.existsSync(src) === false) { missing.push('iceberg/' + entry.file); return null; }
    if (sha(src) !== entry.sha256) { bad.push(entry.file); return null; }
    copy(src, path.join(dist, 'assets', 'iceberg', entry.file));
    return entry.file;
  };
  for (const [slug, cell] of Object.entries(m.cells)) {
    runtime.cells[slug] = {
      desktop: cell.desktop ? ship(cell.desktop.file) : null,
      phone: cell.phone ? ship(cell.phone.file) : null,
      collision: cell.collision ? ship(cell.collision.file) : null,
    };
  }
  if (bad.length) throw new Error('Walkable Iceberg files do not match the export manifest sha256: ' + bad.join(', '));
  fs.writeFileSync(path.join(dist, 'assets', 'iceberg', 'runtime.json'), JSON.stringify(runtime));
}
let bytes = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else bytes += fs.statSync(p).size;
  }
};
walk(dist);
console.log(`dist: ${(bytes / 1e6).toFixed(1)} MB`);
if (missing.length) {
  throw new Error('Required assets missing: ' + missing.join(', ') + '. Place the supplied asset pack in assets/ and rebuild.');
}
