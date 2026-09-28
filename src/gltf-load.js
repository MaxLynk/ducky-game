// Ported from the Ducky harness engine (art/blender/iceberg-game/harness/src/engine/load.js at
// commit 44bfb756), where the walkable Iceberg export was proved. Only the import paths changed.
// Load a GLB from an ArrayBuffer with three's GLTFLoader, in node or in a browser.
// The meshopt decoder is registered so meshopt-compressed GLBs load too.
// Collision GLBs carry no textures, so no KTX2 loader is needed here.

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

let loaderPromise = null;

async function getLoader() {
  if (!loaderPromise) {
    loaderPromise = (async () => {
      await MeshoptDecoder.ready;
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      return loader;
    })();
  }
  return loaderPromise;
}

/**
 * Parse a GLB (ArrayBuffer, or a Node Buffer or Uint8Array view) into a three.js gltf result.
 * Returns { scene, scenes, parser, ... } exactly as GLTFLoader gives it.
 */
export async function loadGLB(data, path = '') {
  let buf = data;
  if (ArrayBuffer.isView(data)) {
    buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  const loader = await getLoader();
  return new Promise((resolve, reject) => {
    loader.parse(buf, path, resolve, reject);
  });
}

/** The glTF node name as authored (GLTFLoader sanitizes object.name, and keeps the original in userData.name). */
export function nodeName(object) {
  return (object.userData && typeof object.userData.name === 'string') ? object.userData.name : object.name;
}
