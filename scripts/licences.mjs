// Every package npm installed, with its licence. MIT only, with one named exception: Rapier, the
// physics of the walkable Iceberg, is Apache-2.0 and ships with its licence text
// (dist/vendor/rapier/LICENSE). Any other licence, or another version of that exception, fails.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXCEPTIONS = { '@dimforge/rapier3d-compat@0.21.0': 'Apache-2.0' };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const rows = [];
for (const [where, info] of Object.entries(lock.packages || {})) {
  if (!where) continue;
  const pkg = JSON.parse(fs.readFileSync(path.join(root, where, 'package.json'), 'utf8'));
  rows.push({ name: pkg.name, version: pkg.version, license: pkg.license, dev: !!info.dev });
}
for (const r of rows) console.log(`${r.name}@${r.version} ${r.license}${r.dev ? ' (dev)' : ''}`);
const bad = rows.filter((r) => r.license !== 'MIT' && EXCEPTIONS[`${r.name}@${r.version}`] !== r.license);
const excepted = rows.filter((r) => r.license !== 'MIT' && bad.includes(r) === false);
console.log(`${rows.length} packages, ${bad.length} not allowed, ${excepted.length} named exception${excepted.length === 1 ? '' : 's'} (${excepted.map((r) => `${r.name} ${r.license}`).join(', ') || 'none'})`);
process.exitCode = bad.length ? 1 : 0;
