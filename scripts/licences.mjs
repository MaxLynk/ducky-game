// Every package npm installed, with its licence. The brief allows MIT only; anything else fails.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const rows = [];
for (const [where, info] of Object.entries(lock.packages || {})) {
  if (!where) continue;
  const pkg = JSON.parse(fs.readFileSync(path.join(root, where, 'package.json'), 'utf8'));
  rows.push({ name: pkg.name, version: pkg.version, license: pkg.license, dev: !!info.dev });
}
for (const r of rows) console.log(`${r.name}@${r.version} ${r.license}${r.dev ? ' (dev)' : ''}`);
const bad = rows.filter((r) => r.license !== 'MIT');
console.log(`${rows.length} packages, ${bad.length} not MIT`);
process.exitCode = bad.length ? 1 : 0;
