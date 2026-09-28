// The phone variants in assets/phone keep every node, skin joint, mesh and accessor of their
// source and only shrink images to the phone caps. Runs when the committed asset pack is present.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPS, imageSize, readGlb, sha256 } from '../scripts/make-phone-assets.mjs';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const manifestFile = path.join(assets, 'phone', 'manifest.json');
const have = fs.existsSync(manifestFile);

test('phone manifest matches the current source assets', { skip: have === false }, () => {
  const { files } = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  for (const name of fs.readdirSync(assets).filter((f) => f.endsWith('.glb') || f === 'sky.jpg')) {
    assert.equal(files[name]?.source_sha256, sha256(fs.readFileSync(path.join(assets, name))), name + ' changed; rerun make-phone-assets');
    if (files[name].phone) assert.equal(files[name].phone_sha256, sha256(fs.readFileSync(path.join(assets, files[name].phone))), name);
  }
});

test('phone GLBs keep structure and cap images', { skip: have === false }, () => {
  const { files } = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  for (const [name, entry] of Object.entries(files)) {
    if (name.endsWith('.glb') === false) continue;
    const source = readGlb(fs.readFileSync(path.join(assets, name)));
    const phone = entry.phone ? readGlb(fs.readFileSync(path.join(assets, entry.phone))) : source;
    assert.deepEqual(phone.json.nodes.map((n) => n.name), source.json.nodes.map((n) => n.name), name + ' node names');
    assert.deepEqual(phone.json.skins?.map((s) => s.joints), source.json.skins?.map((s) => s.joints), name + ' joints');
    assert.deepEqual(phone.json.meshes, source.json.meshes, name + ' meshes');
    assert.deepEqual(phone.json.accessors, source.json.accessors, name + ' accessors');
    assert.deepEqual(phone.json.materials, source.json.materials, name + ' materials');
    for (const image of phone.json.images || []) {
      const view = phone.json.bufferViews[image.bufferView];
      const { width, height } = imageSize(phone.bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
      assert.ok(Math.max(width, height) <= CAPS.texture, `${name} image ${width}x${height}`);
    }
    for (const [i, view] of source.json.bufferViews.entries()) {
      if ((source.json.images || []).some((im) => im.bufferView === i)) continue;
      const a = source.bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
      const b = phone.bin.subarray(phone.json.bufferViews[i].byteOffset || 0, (phone.json.bufferViews[i].byteOffset || 0) + phone.json.bufferViews[i].byteLength);
      assert.ok(a.equals(b), `${name} buffer view ${i} bytes`);
    }
  }
  const sky = files['sky.jpg'];
  const size = imageSize(fs.readFileSync(path.join(assets, sky.phone || 'sky.jpg')));
  assert.ok(size.width <= CAPS.sky, `sky ${size.width}x${size.height}`);
});
