import * as THREE from 'three';

// Keep small Blender primitives for ray tests while rendering merged materials.
// A binary tree of world bounds avoids testing half a million hull triangles
// for every aim preview point. The index is immutable for a parked ship.
export function createRayIndex(root) {
  root.updateMatrixWorld(true);
  const parts = [];
  let splitMeshes = 0;
  const point = new THREE.Vector3();
  function add(mesh) {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    parts.push({ mesh, box, centre: box.getCenter(new THREE.Vector3()) });
  }
  root.traverse((mesh) => {
    if (mesh.isMesh === true) {
      const geometry = mesh.geometry;
      const position = geometry.attributes.position;
      const count = geometry.index ? geometry.index.count : position.count;
      if (count < 6000) { add(mesh); return; }
      splitMeshes++;
      const cells = new Map();
      const mirrored = mesh.matrixWorld.determinant() < 0;
      for (let i = 0; i < count; i += 3) {
        const vertices = [];
        for (let j = 0; j < 3; j++) {
          const index = geometry.index ? geometry.index.getX(i + j) : i + j;
          point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
          vertices.push(point.x, point.y, point.z);
        }
        if (mirrored) {
          for (let k = 0; k < 3; k++) [vertices[k + 3], vertices[k + 6]] = [vertices[k + 6], vertices[k + 3]];
        }
        const key = [0, 1, 2].map((k) => Math.floor((vertices[k] + vertices[k + 3] + vertices[k + 6]) / 6)).join(',');
        if (cells.has(key) === false) cells.set(key, []);
        cells.get(key).push(...vertices);
      }
      for (const values of cells.values()) {
        const part = new THREE.BufferGeometry();
        part.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
        const chunk = new THREE.Mesh(part, mesh.material);
        chunk.name = mesh.name;
        add(chunk);
      }
    }
  });
  function build(items) {
    const box = new THREE.Box3(); items.forEach((p) => box.union(p.box));
    if (items.length <= 8) return { box, items };
    const size = box.getSize(new THREE.Vector3());
    const axis = size.x > size.y && size.x > size.z ? 'x' : size.y > size.z ? 'y' : 'z';
    items.sort((a, b) => a.centre[axis] - b.centre[axis]);
    const middle = Math.floor(items.length / 2);
    return { box, left: build(items.slice(0, middle)), right: build(items.slice(middle)) };
  }
  const tree = build(parts);
  return {
    count: parts.length,
    splitMeshes,
    intersect(raycaster) {
      const hits = [];
      function visit(node) {
        if (raycaster.ray.intersectBox(node.box, point) === null) return;
        if (node.box.containsPoint(raycaster.ray.origin) === false && point.distanceTo(raycaster.ray.origin) > raycaster.far) return;
        if (node.items) {
          for (const p of node.items) {
            if (raycaster.ray.intersectsBox(p.box)) p.mesh.raycast(raycaster, hits);
          }
        } else { visit(node.left); visit(node.right); }
      }
      visit(tree);
      hits.sort((a, b) => a.distance - b.distance);
      return hits;
    },
  };
}
