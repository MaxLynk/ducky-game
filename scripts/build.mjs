// Static build with no bundler and no dependency beyond three itself: copy the page, the
// sources, the parts of three the page imports, and the exported assets into dist/.
// Any static file server can host dist/; it fetches nothing from any other origin.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
];
for (const f of vendor) copy(path.join(three, f), path.join(dist, 'vendor', 'three', f));

const assets = path.join(root, 'assets');
const wanted = ['set.glb', 'ducky-ice.glb', 'ducky-helmet.glb', 'ship.glb', 'sky.jpg', 'collision.json', 'provenance.json'];
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
  const { files } = JSON.parse(fs.readFileSync(phoneManifest, 'utf8'));
  const stale = [];
  for (const f of wanted.filter((f) => f.endsWith('.glb') || f === 'sky.jpg')) {
    const src = path.join(assets, f);
    if (fs.existsSync(src) === false) continue;
    const sum = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');
    if (files[f]?.source_sha256 !== sum) stale.push(f);
    else if (files[f].phone && fs.existsSync(path.join(assets, files[f].phone)) === false) missing.push(files[f].phone);
  }
  if (stale.length) throw new Error('Phone assets are stale for ' + stale.join(', ') + '. Run node scripts/make-phone-assets.mjs and commit assets/phone.');
  for (const f of fs.readdirSync(phoneDir)) copy(path.join(phoneDir, f), path.join(dist, 'assets', 'phone', f));
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
