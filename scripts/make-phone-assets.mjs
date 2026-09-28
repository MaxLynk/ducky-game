// Phone asset variants: every GLB in assets/ with an embedded image over 512 px, and the sky at
// 2048 px wide, are written to assets/phone/ with their images scaled down. Nodes, meshes, skins,
// joints, accessors and materials are untouched; only image bytes change. A GLB whose images are
// already small (or that has none) is not copied, and the phone loads the original.
// assets/phone/manifest.json records each source's SHA-256 so the build can refuse stale variants.
// Usage: node scripts/make-phone-assets.mjs   (needs ffmpeg on PATH)
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CAPS = { texture: 512, sky: 2048 };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
const out = path.join(assets, 'phone');

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Width and height from a JPEG SOF marker or a PNG IHDR chunk.
export function imageSize(buf) {
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error('Unrecognised image');
}

export function readGlb(buf) {
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength));
  const binStart = 20 + jsonLength;
  const bin = binStart < buf.length ? buf.subarray(binStart + 8, binStart + 8 + buf.readUInt32LE(binStart)) : Buffer.alloc(0);
  return { json, bin };
}

// What the build must refuse: a source changed since its variant was made (stale), a variant whose own
// bytes differ from the manifest (corrupt), or a variant the manifest names that is not there (missing).
export function phoneProblems(assetsDir, names) {
  const problems = { stale: [], corrupt: [], missing: [] };
  const { files } = JSON.parse(fs.readFileSync(path.join(assetsDir, 'phone', 'manifest.json'), 'utf8'));
  for (const f of names) {
    const src = path.join(assetsDir, f);
    if (fs.existsSync(src) === false) continue;
    if (files[f]?.source_sha256 !== sha256(fs.readFileSync(src))) { problems.stale.push(f); continue; }
    if (files[f].phone === null) continue;
    const phone = path.join(assetsDir, files[f].phone);
    if (fs.existsSync(phone) === false) problems.missing.push(files[f].phone);
    else if (sha256(fs.readFileSync(phone)) !== files[f].phone_sha256) problems.corrupt.push(files[f].phone);
  }
  return problems;
}

function writeGlb(json, bin) {
  const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const binChunk = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
  const chunk = (b, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.write(type, 4); return Buffer.concat([h, b]); };
  return Buffer.concat([header, chunk(jsonChunk, 'JSON'), chunk(binChunk, 'BIN\0')]);
}

function scaleImage(buf, mimeType, max) {
  const { width, height } = imageSize(buf);
  if (Math.max(width, height) <= max) return null;
  const k = max / Math.max(width, height);
  const w = Math.round(width * k), h = Math.round(height * k);
  const png = mimeType === 'image/png';
  return execFileSync('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-vf', `scale=${w}:${h}:flags=lanczos`, '-frames:v', '1',
    '-c:v', png ? 'png' : 'mjpeg', ...(png ? [] : ['-q:v', '2']), '-f', 'image2pipe', 'pipe:1'], { input: buf, maxBuffer: 1 << 28 });
}

// Rebuilds the binary chunk with the scaled image bytes; every other buffer view keeps its bytes.
function shrinkGlb(buf, max) {
  const { json, bin } = readGlb(buf);
  const replaced = new Map();
  for (const image of json.images || []) {
    if (image.bufferView === undefined) continue;
    const view = json.bufferViews[image.bufferView];
    const bytes = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const scaled = scaleImage(bytes, image.mimeType, max);
    if (scaled) replaced.set(image.bufferView, scaled);
  }
  if (replaced.size === 0) return null;
  if ((json.buffers || []).length !== 1) throw new Error('Expected one buffer');
  const parts = [];
  let offset = 0;
  json.bufferViews.forEach((view, i) => {
    const data = replaced.get(i) || bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const padding = (4 - (offset % 4)) % 4;
    if (padding) { parts.push(Buffer.alloc(padding)); offset += padding; }
    view.byteOffset = offset; view.byteLength = data.length;
    parts.push(data); offset += data.length;
  });
  const next = Buffer.concat(parts);
  json.buffers[0].byteLength = next.length;
  return writeGlb(json, next);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const manifest = { note: 'Generated by scripts/make-phone-assets.mjs. Rerun it after any change to assets/.', caps: CAPS, files: {} };
  const names = fs.readdirSync(assets).filter((f) => f.endsWith('.glb') || f === 'sky.jpg').sort();
  for (const name of names) {
    const source = fs.readFileSync(path.join(assets, name));
    const phone = name === 'sky.jpg' ? scaleImage(source, 'image/jpeg', CAPS.sky) : shrinkGlb(source, CAPS.texture);
    const entry = { source_sha256: sha256(source), source_bytes: source.length, phone: null };
    if (phone) {
      fs.writeFileSync(path.join(out, name), phone);
      Object.assign(entry, { phone: 'phone/' + name, phone_sha256: sha256(phone), phone_bytes: phone.length });
    }
    manifest.files[name] = entry;
    console.log(name, phone ? `${source.length} -> ${phone.length} bytes` : 'unchanged, phone loads the original');
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
