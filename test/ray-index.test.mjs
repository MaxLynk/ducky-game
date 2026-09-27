import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRayIndex } from '../src/ray-index.js';

test('the accelerated hull rays match original triangles, including mirrored meshes and short sweeps', () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4, 90, 60), new THREE.MeshBasicMaterial());
  mesh.scale.set(-1.1, 1.3, 0.7);
  mesh.rotation.set(0.1, 0.3, 0.2);
  mesh.position.set(3, 2, -5);
  root.add(mesh); root.updateMatrixWorld(true);
  const index = createRayIndex(root);
  assert.equal(index.splitMeshes, 1);
  let hitCount = 0;
  let missCount = 0;
  for (let i = 0; i < 40; i++) {
    const origin = new THREE.Vector3(Math.sin(i * 2.1) * 12, Math.cos(i * 1.3) * 8, 10);
    const target = new THREE.Vector3(3 + Math.sin(i) * 8, 2, -5);
    const ray = new THREE.Raycaster(origin, target.sub(origin).normalize(), 0, i % 4 === 0 ? 3 : 100);
    const expected = ray.intersectObject(mesh);
    const actual = index.intersect(ray);
    assert.equal(actual.length > 0, expected.length > 0);
    if (expected.length) {
      hitCount++;
      assert.ok(Math.abs(actual[0].distance - expected[0].distance) < 0.0001);
      assert.ok(actual[0].point.distanceTo(expected[0].point) < 0.0001);
    } else missCount++;
  }
  assert.ok(hitCount > 5);
  assert.ok(missCount > 5);
  console.log('ray equivalence', JSON.stringify({ hitCount, missCount, indexedParts: index.count }));
});
