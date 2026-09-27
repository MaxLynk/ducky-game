import * as THREE from 'three';
import { ROUGH, TARGETS, ROOMS, FURNITURE, WALLS } from './layout.js';

// Every blockout is registered by stable ID. A Blender GLB can replace its visual
// at this transform without changing room traversal or interaction identifiers.
export function buildWorld(scene) {
  const models = new Map();
  const inside = new THREE.Group();
  inside.name = 'blockout:main-deck';
  scene.add(inside);
  const outside = new THREE.Group();
  outside.name = 'practice-plain';
  scene.add(outside);
  const materials = {
    floor: new THREE.MeshStandardMaterial({ color: 0x554637, roughness: 0.9 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x98704e, roughness: 0.82 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x283e49, roughness: 0.72 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xd99d4e, metalness: 0.5, roughness: 0.4 }),
    light: new THREE.MeshBasicMaterial({ color: 0xffdda1 }),
    screen: new THREE.MeshBasicMaterial({ color: 0x164552 }),
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
  for (const r of ROOMS) {
    const part = new THREE.Group();
    inside.add(part);
    register(r.id, part, r.label);
    box(r.id + ':floor', (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, -0.06,
      r.x1 - r.x0, r.y1 - r.y0, 0.16, materials.floor, part);
    box(r.id + ':ceiling', (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 3.06,
      r.x1 - r.x0, r.y1 - r.y0, 0.12, materials.wall, part);
  }
  for (const p of WALLS) box(p.id, p.x, p.y, p.z, p.w, p.d, p.h, materials.wall);
  // Outer walls and partial dividers keep the hall and doorways continuous.
  box('blockout:cockpit:window-sill', -20, 27, 0.4, 0.16, 9, 0.8, materials.wall);
  box('blockout:cockpit:window-header', -20, 27, 2.8, 0.16, 9, 0.4, materials.wall);
  for (const y of [22.5, 25, 29, 31.5]) box('blockout:window-rib:' + y, -20, y, 1.7, 0.16, 0.08, 2, materials.trim);
  for (let x = -19; x < 7; x += 3) {
    box('blockout:ceiling-light:' + x, x, 27, 2.98, 0.6, 0.9, 0.025, materials.light);
    box('blockout:hall-guide:' + x, x, 26, 0.025, 1.2, 0.06, 0.015, materials.light);
  }
  for (const p of FURNITURE) {
    const part = new THREE.Group();
    inside.add(part); register(p.id, part);
    const mat = p.type === 'seat' ? materials.dark : materials.wall;
    box(p.id + ':body', p.x, p.y, p.type === 'seat' ? 0.48 : p.z, p.w, p.d,
      p.type === 'seat' ? 0.24 : p.h, mat, part);
    if (p.type === 'seat') {
      box(p.id + ':back', p.x + 0.3, p.y, 0.85, 0.2, p.d, 0.75, mat, part);
      box(p.id + ':pedestal', p.x, p.y, 0.2, 0.24, 0.24, 0.4, materials.trim, part);
    }
  }
  const screens = [];
  for (let k = 0; k < 5; k++) {
    const screen = box('blockout:console:screen:' + k, -18.47, 24.6 + k * 1.2, 1.05,
      0.035, 0.85, 0.55, materials.screen.clone());
    screens.push(screen);
  }
  for (const [i, color] of [0xf4d045, 0x4a91ff, 0xf68eaf].entries()) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color }));
    b.position.set(-18.42, 0.75, -(26.65 + i * 0.35)); inside.add(b);
    register('blockout:console:button:' + ['tractor', 'warp', 'saws'][i], b);
  }
  const backup = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 8), materials.light);
  backup.position.set(-17.7, 0.8, -26.35); inside.add(backup); register('blockout:lighting-backup', backup);
  label('COCKPIT  +12 TO +20', -12.12, 27, 2.6, 2.6, inside, Math.PI / 2);
  label('KITCHEN', -8.5, 25.88, 2.2, 1.5);
  label("CAPTAIN'S CABIN", -8.5, 28.12, 2.2, 2);
  label('MAIN DECK  |  FORWARD', -4.15, 27, 2.6, 2.5, inside, Math.PI / 2);
  const consoleLabel = label('LIGHTING BACKUP', -18.43, 27, 1.65, 2.1, inside, Math.PI / 2);
  register('blockout:console:label', consoleLabel);
  const door = box('blockout:airlock:outer-door', -2, 20.35, 1.35, 2.3, 0.16, 2.7, materials.dark);
  for (const x of [-3.23, -0.77]) box('blockout:airlock:frame:' + x, x, 20.22, 1.5, 0.15, 0.22, 3, materials.trim);
  box('blockout:airlock:header', -2, 20.22, 2.9, 2.6, 0.22, 0.2, materials.trim);
  label('AIRLOCK', -2, 20.1, 2.56, 1.6);
  const doorLight = box('blockout:airlock:indicator', -3.35, 20.08, 1.3, 0.13, 0.07, 0.5, materials.light);
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
  // Fill small construction seams between adjacent rooms.
  box('blockout:main-deck:subfloor', -6, 27, -0.13, 28, 12, 0.08, materials.floor);
  for (const [id, entry] of models) {
    if (id === 'blockout:cockpit') continue;
    if (id.startsWith('blockout:cockpit:') || id.startsWith('blockout:console') || id.startsWith('blockout:seat') || id.startsWith('blockout:window') || id === 'blockout:lighting-backup') {
      if (entry.object.parent === inside) models.get('blockout:cockpit').object.add(entry.object);
    }
  }
  return { inside, outside, door, models, targetMeshes, materials,
    register,
    update(ship) {
      door.position.y = 1.35 + ship.door * 2.85;
      doorLight.material = ship.door > 0.9 ? materials.blue : materials.light;
      screens.forEach((s, k) => s.material.color.setHex(ship.consoleOn ? [0x5cdcc4, 0x77b6ed, 0xe3bf6b][k % 3] : 0x164552));
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

export function cutAirlock(ship) {
  // The blockout portal cuts only the game visual, never the ship of record.
  ship.traverse((o) => {
    if (o.isMesh === true) {
      o.material.onBeforeCompile = (shader) => {
        shader.vertexShader = 'varying vec3 portalWorld;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\nportalWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = 'varying vec3 portalWorld;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>',
          '#include <clipping_planes_fragment>\nif (portalWorld.x > -3.25 && portalWorld.x < -0.75 && portalWorld.y > -0.05 && portalWorld.y < 2.95 && portalWorld.z < -19.0 && portalWorld.z > -24.0) discard;');
      };
      o.material.customProgramCacheKey = () => 'game-airlock-v1';
      o.material.needsUpdate = true;
    }
  });
}
