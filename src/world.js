import * as THREE from 'three';
import { ROUGH, TARGETS } from './layout.js';

// Every inspectable model is registered by stable ID. A local GLB can replace its visual at this
// transform. The ship's rooms are the walkable export's cells (main.js registers them); what is
// built here is the ice plain's props and the airlock's animated outer door, which the export
// models as a closed slab.
export function buildWorld(scene) {
  const models = new Map();
  const inside = new THREE.Group();
  inside.name = 'airlock-door';
  scene.add(inside);
  const outside = new THREE.Group();
  outside.name = 'practice-plain';
  scene.add(outside);
  const materials = {
    dark: new THREE.MeshStandardMaterial({ color: 0x283e49, roughness: 0.72 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xd99d4e, metalness: 0.5, roughness: 0.4 }),
    light: new THREE.MeshBasicMaterial({ color: 0xffdda1 }),
    snow: new THREE.MeshStandardMaterial({ color: 0xf0f5ff, roughness: 1 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x448ca6, roughness: 0.45 }),
  };
  function register(id, object, label = id) {
    object.name = id;
    object.userData.assetSlot = id;
    models.set(id, { object, label });
    return object;
  }
  function box(id, x, y, z, w, d, h, mat, parent = inside) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, z, -y);
    parent.add(mesh);
    return register(id, mesh);
  }
  function label(text, x, y, z, width = 2.5, parent = inside, yaw = 0) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#20333b'; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#d4b98c'; ctx.lineWidth = 5; ctx.strokeRect(4, 4, 504, 120);
    ctx.fillStyle = '#ffedcb'; ctx.font = '600 34px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 64, 486);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    mesh.position.set(x, z, -y); mesh.rotation.y = yaw; parent.add(mesh);
    return mesh;
  }
  // The export's airlock_outerdoor is 1.6 m wide at x -2.8 to -1.2; this door covers it and slides up.
  const door = box('airlock:outer-door', -2, 20.35, 1.25, 1.9, 0.16, 2.5, materials.dark);
  for (const x of [-3.02, -0.98]) box('airlock:frame:' + x, x, 20.22, 1.4, 0.15, 0.22, 2.8, materials.trim);
  box('airlock:header', -2, 20.22, 2.72, 2.2, 0.22, 0.16, materials.trim);
  label('AIRLOCK', -2, 20.1, 2.45, 1.4);
  const doorLight = box('airlock:indicator', -3.14, 20.08, 1.3, 0.13, 0.07, 0.5, materials.light);
  for (const r of ROUGH) {
    box(r.id, r.x, r.y, 0.025, r.width, r.depth, 0.05, materials.snow, outside);
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1 + (i % 3) * 0.04, 0), materials.snow);
      mesh.scale.set(1.9, 0.3, 1);
      mesh.position.set(r.x + Math.sin(i * 3.7) * r.width * 0.43, 0.06, -(r.y + Math.cos(i * 2.1) * r.depth * 0.43));
      outside.add(mesh);
    }
  }
  const targetMeshes = [];
  for (const t of TARGETS) {
    const root = new THREE.Group(); outside.add(root); register(t.id, root, 'Snow target ' + t.id.slice(-2));
    box(t.id + ':post', t.x, t.y, 0.6, 0.12, 0.12, 1.2, materials.trim, root);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(t.radius, 20, 12), materials.blue.clone());
    ball.position.set(t.x, t.z, -t.y); ball.scale.z = 0.25; root.add(ball);
    ball.userData.hitKind = 'target'; ball.userData.targetId = t.id;
    targetMeshes.push(ball);
    for (let k = 0; k < 2; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3 + k * 0.27, 0.035, 6, 32), materials.snow);
      ring.position.set(t.x, t.z, -t.y + 0.2); root.add(ring);
    }
    label(t.id.slice(-2), t.x, t.y - 0.22, 2.55, 0.6, root);
  }
  return { inside, outside, door, models, targetMeshes, materials,
    register,
    update(ship) {
      door.position.y = 1.25 + ship.door * 2.7;
      doorLight.material = ship.door > 0.9 ? materials.blue : materials.light;
    },
    replace(id, model) {
      const slot = models.get(id);
      if (slot === undefined) throw new Error('Unknown asset slot: ' + id);
      const old = slot.object;
      model.position.copy(old.position); model.quaternion.copy(old.quaternion); model.scale.copy(old.scale);
      old.parent.add(model); old.removeFromParent(); register(id, model, slot.label);
    },
  };
}

// Shader cuts for the game view only; the exported models are never edited. `box` is in three
// world coordinates: [x0, x1, y0, y1, z0, z1].
export function cutBox(root, box, key) {
  const [x0, x1, y0, y1, z0, z1] = box.map((v) => v.toFixed(3));
  const test = `if (portalWorld.x > ${x0} && portalWorld.x < ${x1} && portalWorld.y > ${y0} && portalWorld.y < ${y1} && portalWorld.z > ${z0} && portalWorld.z < ${z1}) discard;`;
  const seen = new Set();
  root.traverse((o) => {
    if (o.isMesh !== true || seen.has(o.material)) return;
    seen.add(o.material);
    o.material.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec3 portalWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nportalWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = 'varying vec3 portalWorld;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\n' + test);
    };
    o.material.customProgramCacheKey = () => key;
    o.material.needsUpdate = true;
  });
}
// The hull opening in front of the airlock, world plane x -2.95 to -1.05, y 19 to 24, up to 2.6 m.
export const AIRLOCK_PORTAL = [-2.95, -1.05, -0.05, 2.6, -24, -19];
// The export's closed outer door slab inside the airlock cell, x -2.85 to -1.15, y 20.3 to 20.7.
export const AIRLOCK_DOOR_SLAB = [-2.85, -1.15, -0.05, 2.45, -20.7, -20.3];
export const inPortal = (p) => p.x > AIRLOCK_PORTAL[0] && p.x < AIRLOCK_PORTAL[1] && p.y > AIRLOCK_PORTAL[2]
  && p.y < AIRLOCK_PORTAL[3] && p.z > AIRLOCK_PORTAL[4] && p.z < AIRLOCK_PORTAL[5];
