// Ducky powers and ship exploration. All assets are local to this build.
// Demo drives the same simulation as keyboard and touch; capture steps time explicitly.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { decodeGrid } from './grid.js';
import { createSim } from './sim.js';
import { createInput } from './input.js';
import { createDucky } from './ducky.js';
import { createMilestoneDemo } from './demo.js';
import { createRayIndex } from './ray-index.js';
import { buildWorld, cutAirlock } from './world.js';
import { createShipState, shipWalkable, surfaceAt, inShip } from './layout.js';
import { createInspect } from './inspect.js';
import { createSnowballs, trajectory, aimAt } from './snowballs.js';

const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const CAPTURE = params.has('capture');
const COLLIDE = params.get('collision') !== 'off';
// Phone quality profile: a touch screen whose short side is under 600 CSS px (a phone, not an
// iPad mini or a desktop) gets a smaller drawing buffer, shadow map and textures, because Android
// Chrome drops the WebGL context when GPU memory runs short.
const PHONE = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
const QUALITY = PHONE ? { dpr: 1.25, shadow: 1024, texture: 512, sky: 2048 } : { dpr: 1.5, shadow: 2048, texture: Infinity, sky: Infinity };
const DPR = Math.min(window.devicePixelRatio || 1, Number(params.get('dpr') || QUALITY.dpr));

const api = { ready: false, error: null, phone: PHONE, quality: QUALITY };
window.__dk = api;

const canvas = document.getElementById('view');
const loadingEl = document.getElementById('loading');
const nameEl = document.getElementById('name');
const statusEl = document.getElementById('status');
const problemEl = document.getElementById('start-problem');

// A phone without WebGL2 (blocked after a GPU crash, or no hardware acceleration) throws here,
// so the renderer is built inside start() where a failure reaches showProblem().
let renderer;
function createRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: CAPTURE,
  });
  renderer.setPixelRatio(DPR);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; // Blender's Standard view, not AgX
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  buildEnvironment();
  // Registered after the renderer's own handlers, so three has re-created its GL state before
  // restored() rebuilds what lived only on the GPU.
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
}
let envTarget = null;
function buildEnvironment() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  envTarget?.dispose();
  envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envTarget.texture;
  pmrem.dispose();
}

// Replaces the loading screen with the plain start-problem card; the error goes to the console.
function showProblem(err) {
  console.error(err); api.error = String(err?.message || err);
  loadingEl.classList.add('hidden'); problemEl.classList.remove('hidden');
}
// A lost context (Android under GPU memory pressure, or switching apps) shows the same card and
// keeps the game state; the browser restores the context because the event is prevented.
function lost(event) {
  event.preventDefault(); api.contextLost = (api.contextLost || 0) + 1; problemEl.dataset.lost = 'yes';
  showProblem(new Error('WebGL context lost'));
}
// Textures, geometry and shaders re-upload by themselves; the PMREM environment and the shadow
// map were rendered on the GPU, so they are drawn again. The player stays where they were.
function restored() {
  api.error = null; problemEl.classList.add('hidden'); delete problemEl.dataset.lost;
  buildEnvironment();
  if (api.ready === false) { loadingEl.classList.remove('hidden'); return; }
  renderer.shadowMap.needsUpdate = true; resize(); render();
}

// Scales a texture's image down to fit max px on its longest side (phone profile only).
// Textures that share one image share one scaled canvas.
const fitted = new Map();
function fitTexture(texture, max) {
  const img = texture?.image;
  if (Boolean(img) === false || Math.max(img.width, img.height) <= max) return;
  if (fitted.has(img) === false) {
    const k = max / Math.max(img.width, img.height);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    fitted.set(img, c);
  }
  texture.image = fitted.get(img); texture.needsUpdate = true;
}
function fitTextures(root, max) {
  if (max === Infinity) return;
  const seen = new Set();
  root.traverse((o) => {
    if (o.isMesh !== true) return;
    for (const m of [o.material].flat()) for (const v of Object.values(m)) {
      if (v?.isTexture && seen.has(v) === false) { seen.add(v); fitTexture(v, max); }
    }
  });
}

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0a0f1e, 60, 190);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 4000);
scene.environmentIntensity = 0.3;

// B0-00's three lights, re-aimed for real time: warm moon rim from behind-right, cold fill from
// the front-left, and a soft blue sky from above.
function blenderDir(x, y, z) {
  return new THREE.Vector3(x, z, -y).normalize();
}
const moon = new THREE.DirectionalLight(0xffdca0, 2.4);
const moonDir = blenderDir(8, 9, 2.4 + 2.0);
moon.castShadow = true;
moon.shadow.mapSize.set(QUALITY.shadow, QUALITY.shadow);
moon.shadow.camera.left = -7;
moon.shadow.camera.right = 7;
moon.shadow.camera.top = 7;
moon.shadow.camera.bottom = -7;
moon.shadow.camera.near = 1;
moon.shadow.camera.far = 60;
moon.shadow.bias = -0.0005;
moon.shadow.normalBias = 0.02;
scene.add(moon, moon.target);
const fill = new THREE.DirectionalLight(0x9ebcff, 1.1);
fill.position.copy(blenderDir(-7, -6, 3.5)).multiplyScalar(30);
scene.add(fill);
const top = new THREE.DirectionalLight(0x8ca8ff, 0.7);
top.position.copy(blenderDir(0, 4, 14)).multiplyScalar(30);
scene.add(top);
scene.add(new THREE.HemisphereLight(0x8196c8, 0x1c2336, 1.1));

function mergeByMaterial(root, name) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const key of Object.keys(g.attributes)) {
      if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    const m = o.material;
    if (!groups.has(m.uuid)) groups.set(m.uuid, { m, list: [] });
    groups.get(m.uuid).list.push(g);
  });
  const out = new THREE.Group();
  out.name = name;
  for (const { m, list } of groups.values()) {
    const indexed = list.every((g) => g.index);
    const parts = indexed ? list : list.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = mergeGeometries(parts, false);
    const mesh = new THREE.Mesh(merged, m);
    mesh.name = `${name}:${m.name}`;
    out.add(mesh);
  }
  return out;
}

function tameMaterials(root) {
  const seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh || seen.has(o.material)) return;
    const m = o.material;
    seen.add(m);
    if (m.transmission > 0) {
      // real-time transmission renders the scene twice; frosted glass reads fine as alpha
      m.transmission = 0;
      m.transparent = true;
      m.opacity = 0.4;
      m.depthWrite = false;
    }
  });
}

// The ice wall is one big box in the export; give it the plain's brick coursing, drawn here so
// no image asset is involved: 0.8 m bricks in running bond, 0.4 m courses.
function brickTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#b9c9dd';
  g.fillRect(0, 0, 512, 512);
  const rows = 8;
  const cols = 4;
  const bh = 512 / rows;
  const bw = 512 / cols;
  for (let r = 0; r < rows; r++) {
    for (let k = -1; k <= cols; k++) {
      const x = k * bw + (r % 2 ? bw / 2 : 0);
      const v = 236 + ((r * 7 + k * 13 + 20) % 5) * 4;
      g.fillStyle = `rgb(${v - 16}, ${v - 7}, ${v})`;
      g.fillRect(x + 3, r * bh + 3, bw - 6, bh - 6);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function planarUVs(geo, size) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u;
    let v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[2 * i] = u / size;
    uv[2 * i + 1] = v / size;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

async function load() {
  const loader = new GLTFLoader();
  const base = new URL('./assets/', document.baseURI);
  const [setG, duckIce, duckHelmet, shipG, gridJson, sky] = await Promise.all([
    loader.loadAsync(new URL('set.glb', base).href),
    loader.loadAsync(new URL('ducky-ice.glb', base).href),
    loader.loadAsync(new URL('ducky-helmet.glb', base).href),
    loader.loadAsync(new URL('ship.glb', base).href),
    fetch(new URL('collision.json', base)).then((r) => {
      if (!r.ok) throw new Error(`collision.json ${r.status}`);
      return r.json();
    }),
    new THREE.TextureLoader().loadAsync(new URL('sky.jpg', base).href),
  ]);
  return { setG, duckG: { ice: duckIce.scene, helmet: duckHelmet.scene }, shipG, gridJson, sky };
}

let sim, ducky, input, grid, world, ship, set, snow, demo, shipRays, sourceCockpit;
const shipState = createShipState();
const inspect = createInspect();
let camYaw = Math.PI / 2;
let camPitch = 0.08;
let nameShown = false;
let toastUntil = 0;
let throwPoseUntil = 0;
let inside = false;
let manual = null;
let lastPreview = -1;
let previewPoint = null;
const hitCounts = { ice: 0, hull: 0, target: 0 };
const metrics = { frames: 0, ms: [], calls: [], tris: [], step: [], render: [], slow: [], t0: performance.now() };
const ray = new THREE.Raycaster();
const vecA = new THREE.Vector3();
const vecB = new THREE.Vector3();
const normalMatrix = new THREE.Matrix3();
const ballsGroup = new THREE.Group();
const splatsGroup = new THREE.Group();
scene.add(ballsGroup, splatsGroup);
const ballGeometry = new THREE.SphereGeometry(0.12, 12, 8);
const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xf4fbff, roughness: 0.9 });
const splatGeometry = new THREE.CircleGeometry(0.26, 12);
const splatMaterial = new THREE.MeshBasicMaterial({ color: 0xf5fbff, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false });
const trajectoryGeometry = new THREE.BufferGeometry();
trajectoryGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(105), 3));
const trajectoryLine = new THREE.Line(trajectoryGeometry, new THREE.LineBasicMaterial({ color: 0xecdfad, transparent: true, opacity: 0.5 }));
trajectoryLine.frustumCulled = false;
scene.add(trajectoryLine);
const marker = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.2, 24), new THREE.MeshBasicMaterial({ color: 0xecdfad, side: THREE.DoubleSide }));
scene.add(marker);
const el = (id) => document.getElementById(id);

function toast(message) { el('toast').textContent = message; toastUntil = sim.state.t + 2.8; }
function portal(p) { return p.x > -3.25 && p.x < -0.75 && p.y > -0.05 && p.y < 2.95 && p.z < -19 && p.z > -24; }
function cast(a, b) {
  vecA.set(a.x, a.z, -a.y);
  vecB.set(b.x - a.x, b.z - a.z, -(b.y - a.y));
  const length = vecB.length();
  if (length < 0.00001) return null;
  ray.set(vecA, vecB.normalize()); ray.far = length + 0.03;
  const objects = [...world.targetMeshes];
  if (Math.max(a.y, b.y) > 18) {
    if (inside) world.inside.traverse((o) => { if (o.isMesh === true) objects.push(o); });
    else if (shipState.door < 0.9) objects.push(world.door);
  }
  const hits = ray.intersectObjects(objects, false);
  if (inside === false && Math.max(a.y, b.y) > 18) hits.push(...shipRays.intersect(ray).filter((h) => portal(h.point) === false));
  hits.sort((a, b) => a.distance - b.distance);
  const hit = hits[0];
  if (hit) {
    const n = hit.face.normal.clone().applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
    return { kind: hit.object.userData.hitKind || 'hull', target: hit.object.userData.targetId || hit.object.name,
      point: { x: hit.point.x, y: -hit.point.z, z: hit.point.y }, normal: { x: n.x, y: -n.z, z: n.y } };
  }
  if (b.z <= 0.12) {
    const f = (a.z - 0.12) / (a.z - b.z);
    return { kind: 'ice', point: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: 0.025 }, normal: { x: 0, y: 0, z: 1 } };
  }
  return null;
}

function getAim(r, origin) {
  if (r.aim) return aimAt(origin, r.aim, camYaw);
  if (r.pointer?.active) {
    ray.setFromCamera(r.pointer, camera); ray.far = 100;
    const hits = [...ray.intersectObjects(world.targetMeshes, false), ...shipRays.intersect(ray).filter((h) => portal(h.point) === false)];
    hits.sort((a, b) => a.distance - b.distance);
    const hit = hits[0];
    if (hit && hit.distance < 60) return aimAt(origin, { x: hit.point.x, y: -hit.point.z, z: hit.point.y }, camYaw);
    const ground = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (ground) return aimAt(origin, { x: ground.x, y: -ground.z, z: 0.03 }, camYaw);
  }
  return { yaw: camYaw, pitch: Math.max(-0.45, Math.min(0.9, camPitch + 0.2)) };
}

function updateProjectiles() {
  while (ballsGroup.children.length > snow.balls.length) ballsGroup.remove(ballsGroup.children[ballsGroup.children.length - 1]);
  snow.balls.forEach((b, i) => {
    if (ballsGroup.children[i] === undefined) ballsGroup.add(new THREE.Mesh(ballGeometry, ballMaterial));
    ballsGroup.children[i].position.set(b.x, b.z, -b.y);
  });
  const ids = new Set(snow.splats.map((s) => s.id));
  for (const child of [...splatsGroup.children]) if (ids.has(child.userData.id) === false) splatsGroup.remove(child);
  for (const s of snow.splats) {
    if (splatsGroup.children.some((o) => o.userData.id === s.id)) continue;
    const mesh = new THREE.Mesh(splatGeometry, splatMaterial);
    const n = new THREE.Vector3(s.normal.x, s.normal.z, -s.normal.y);
    mesh.position.set(s.point.x, s.point.z, -s.point.y).addScaledVector(n, 0.025);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.normalize());
    mesh.scale.set(1.3, 0.85, 1); mesh.userData.id = s.id; splatsGroup.add(mesh);
  }
}

function selectModel(id) {
  const entry = world.models.get(id);
  if (entry === undefined) return;
  entry.object.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(entry.object);
  const centre = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
  inspect.select(id, centre.toArray(), radius);
  el('model-select').value = id;
  el('model-detail').textContent = id + ' | ' + bounds.getSize(new THREE.Vector3()).toArray().map((n) => n.toFixed(2)).join(' x ') + ' m';
  el('inspect-panel').classList.remove('hidden'); document.body.classList.add('inspecting');
  toast('Inspecting ' + entry.label);
}
function exitInspect() {
  inspect.selected = null; el('inspect-panel').classList.add('hidden'); document.body.classList.remove('inspecting');
  input.clear();
}

function updateCamera(dt, r) {
  if (inspect.selected) {
    inspect.orbit(-r.lookX * 0.006 + (r.orbit || 0) + r.turn * dt, r.lookY * 0.006 + r.tilt * dt, r.zoom);
    camera.position.fromArray(inspect.position()); camera.lookAt(...inspect.target);
    return;
  }
  if (r.lookYaw === undefined) camYaw -= r.lookX * 0.006 + r.turn * dt * 1.5;
  else {
    const delta = Math.atan2(Math.sin(r.lookYaw - camYaw), Math.cos(r.lookYaw - camYaw));
    camYaw += delta * Math.min(1, dt * 5);
  }
  camPitch = r.lookPitch ?? Math.max(-0.6, Math.min(0.85, camPitch - r.lookY * 0.004 + r.tilt * dt));
  const s = sim.state;
  if (inside) {
    camera.position.set(s.x, 1.3, -s.y);
    camera.lookAt(s.x + Math.cos(camYaw) * 5, 1.3 + Math.sin(camPitch) * 5, -(s.y + Math.sin(camYaw) * 5));
  } else {
    const distance = 5.3;
    camera.position.set(s.x - Math.cos(camYaw) * distance, 2.3 + camPitch * 3, -(s.y - Math.sin(camYaw) * distance));
    camera.lookAt(s.x + Math.cos(camYaw), 0.95 + camPitch * 3, -(s.y + Math.sin(camYaw)));
  }
}

function stepWorld(dt) {
  const s = sim.state;
  const raw = input.read();
  const r = { ...raw, ...(manual || (demo ? demo.read(s) : {})) };
  if (r.inspectId) selectModel(r.inspectId);
  if (r.inspect) { if (inspect.selected) exitInspect(); else selectModel(inside ? 'blockout:cockpit' : 'ducky'); }
  if (r.exit) exitInspect();
  const inspecting = Boolean(inspect.selected);
  if (inspecting === false) {
    const fx = Math.cos(camYaw), fy = Math.sin(camYaw);
    const x = r.x ?? (fx * r.fwd + fy * r.right);
    const y = r.y ?? (fy * r.fwd - fx * r.right);
    sim.step(dt, { x, y, slide: r.slide });
    if (r.interact) {
      const result = shipState.interact(s.x, s.y);
      if (result === 'door') toast(shipState.doorTarget ? 'Airlock opening' : 'Airlock closing');
      else if (result === 'console') toast(shipState.consoleOn ? 'Lighting backup online' : 'Lighting backup off');
      else if (result === 'doorway-occupied') toast('Step clear of the door first');
      else toast('Walk closer to the airlock or cockpit console');
    }
  } else s.t += dt;
  shipState.step(dt);
  inside = inShip(s.x, s.y);
  const interiorInspect = inspect.selected?.startsWith('blockout:');
  const showInterior = inspecting ? Boolean(interiorInspect) : inside;
  ship.visible = inspecting ? inspect.selected === 'ship' : inside === false;
  sourceCockpit.visible = inspect.selected === 'ship:cockpit-of-record';
  for (const part of sourceCockpit.children) part.visible = part.name === 'cockpit:structure' ? el('cutaway').checked === false : true;
  set.visible = inspecting ? inspect.selected === 'set' : inside === false;
  world.inside.visible = inspecting ? Boolean(interiorInspect) : true;
  world.outside.visible = inspecting ? inspect.selected?.startsWith('target:') || inspect.selected?.startsWith('packed-') : inside === false;
  ducky.root.visible = inspecting ? inspect.selected === 'ducky' : inside === false;
  const selectedObject = world.models.get(inspect.selected)?.object;
  for (const group of [world.inside, world.outside]) group.traverse((o) => {
    if (o === group) return;
    if (inspecting === false) { o.visible = true; return; }
    let parent = o;
    let related = false;
    while (parent) { if (parent === selectedObject) related = true; parent = parent.parent; }
    let ancestor = selectedObject;
    while (ancestor) { if (ancestor === o) related = true; ancestor = ancestor.parent; }
    o.visible = related;
    if (interiorInspect && el('cutaway').checked && /ceiling|wall|header|bulkhead/.test(o.name)) o.visible = false;
  });
  scene.environmentIntensity = showInterior ? 0.75 : 0.3;
  world.update(shipState);
  ducky.update({ ...s, throwing: s.t < throwPoseUntil }, dt);
  scene.updateMatrixWorld(true);
  updateCamera(dt, r);
  camera.updateMatrixWorld();
  const origin = { x: s.x + Math.cos(camYaw) * 0.48, y: s.y + Math.sin(camYaw) * 0.48, z: s.mode === 'slide' ? 0.5 : 1.0 };
  const aim = getAim(r, origin);
  if (r.throw && inspecting === false) {
    if (snow.throw(origin, aim.yaw, aim.pitch)) throwPoseUntil = s.t + 0.35;
  }
  snow.step(dt); updateProjectiles();
  trajectoryLine.visible = inspecting === false && inside === false;
  marker.visible = trajectoryLine.visible;
  if (trajectoryLine.visible && s.t - lastPreview > 0.07) {
    lastPreview = s.t;
    const pts = []; let a = origin; let hit;
    for (let k = 0; k < 35; k++) {
      const p = trajectory(origin, aim.yaw, aim.pitch, k * 0.055);
      hit = cast(a, p); const q = hit ? hit.point : p;
      pts.push(new THREE.Vector3(q.x, q.z, -q.y)); a = p;
      if (hit) break;
    }
    trajectoryGeometry.setFromPoints(pts);
    trajectoryGeometry.setDrawRange(0, pts.length);
    trajectoryGeometry.computeBoundingSphere();
    if (hit) {
      previewPoint = hit;
      marker.position.set(hit.point.x, hit.point.z, -hit.point.y).add(new THREE.Vector3(hit.normal.x, hit.normal.z, -hit.normal.y).multiplyScalar(0.035));
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(hit.normal.x, hit.normal.z, -hit.normal.y));
    }
    marker.visible = Boolean(hit);
  }
  moon.position.set(s.x, 0, -s.y).addScaledVector(moonDir, 25); moon.target.position.set(s.x, 0, -s.y);
  nameShown = inside === false && Math.hypot(s.x + 2, s.y - 20.5) < 3;
  nameEl.classList.toggle('hidden', nameShown === false);
  el('toast').classList.toggle('show', s.t < toastUntil);
  el('speed').textContent = s.speed.toFixed(1) + ' m/s'; el('surface').textContent = s.surface.toUpperCase();
  el('snow-status').textContent = snow.cooldown > 0 ? 'PACKING ' + snow.cooldown.toFixed(1) + 's' : 'SNOWBALL READY';
  el('place').textContent = inside ? s.x <= -12 ? 'THE ICEBERG / COCKPIT' : 'THE ICEBERG / MAIN DECK' : 'THE ICE PLAIN';
  el('chapter').textContent = inside ? '02 / ABOARD THE ICEBERG' : '01 / A LITTLE MOMENTUM';
  el('objective').textContent = inside ? s.x < -12 ? 'A seat among the stars.' : 'Welcome aboard.' : s.mode === 'slide' ? 'Let it slide.' : 'The ice is yours.';
  el('hint').textContent = inside ? s.x < -12 ? 'Walk beside the pilot seat. Use the console to test the lighting.' : 'Follow the light strips forward to the cockpit.' : nameShown ? 'Use the airlock, then walk through the doorway.' : 'Slide on ice. Try a snowball on a target, the ice or the hull.';
  el('crosshair').style.left = r.pointer?.active ? ((r.pointer.x + 1) * 50) + '%' : '50%';
  el('crosshair').style.top = r.pointer?.active ? ((1 - r.pointer.y) * 50) + '%' : '48%';
  if (statusEl.dataset.on) statusEl.textContent = s.mode + ' x ' + s.x.toFixed(2) + ' y ' + s.y.toFixed(2) + ' | hits ' + JSON.stringify(hitCounts);
}

function render() {
  renderer.render(scene, camera);
  metrics.calls.push(renderer.info.render.calls); metrics.tris.push(renderer.info.render.triangles);
}
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
}
function webglName() {
  const gl = renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}

async function start() {
  createRenderer();
  const { setG, duckG, shipG, gridJson, sky } = await load();
  if (QUALITY.sky !== Infinity) fitTexture(sky, QUALITY.sky);
  for (const g of [setG.scene, duckG.ice, duckG.helmet, shipG.scene]) fitTextures(g, QUALITY.texture);
  fitted.clear();
  sky.mapping = THREE.EquirectangularReflectionMapping; sky.colorSpace = THREE.SRGBColorSpace; scene.background = sky;
  set = mergeByMaterial(setG.scene, 'set');
  const bricks = brickTexture();
  set.traverse((o) => {
    if (o.isMesh === true) {
      o.receiveShadow = true;
      if (o.material.name.startsWith('ice_shelf')) {
        planarUVs(o.geometry, 3.2); o.material = o.material.clone(); o.material.map = bricks; o.material.needsUpdate = true;
      }
    }
  });
  scene.add(set);
  grid = decodeGrid(gridJson);
  const holder = new THREE.Group();
  holder.rotation.y = THREE.MathUtils.degToRad(grid.ship.yaw_deg); holder.position.set(grid.ship.offset[0], 0, -grid.ship.offset[1]);
  holder.add(shipG.scene); shipRays = createRayIndex(holder); ship = mergeByMaterial(holder, 'ship'); tameMaterials(ship); cutAirlock(ship); scene.add(ship);
  // Preserve the actual raised cockpit at its authored position for model review.
  // It is separate from the flat navigation blockout until stair traversal exists.
  sourceCockpit = new THREE.Group();
  sourceCockpit.name = 'ship:cockpit-of-record';
  const cockpitParts = { structure: new THREE.Group(), fittings: new THREE.Group() };
  holder.traverse((o) => {
    if (o.isMesh === true && /^(cockpit_|console_|seat_|radar_|chair_|scope_)/.test(o.name)) {
      const copy = new THREE.Mesh(o.geometry, o.material);
      copy.matrix.copy(o.matrixWorld); copy.matrixAutoUpdate = false;
      const key = /wall|deckhead|ceiling|overhead|door|canopy/.test(o.name) ? 'structure' : 'fittings';
      cockpitParts[key].add(copy);
    }
  });
  for (const [name, group] of Object.entries(cockpitParts)) sourceCockpit.add(mergeByMaterial(group, 'cockpit:' + name));
  scene.add(sourceCockpit);
  ducky = createDucky(duckG); scene.add(ducky.root);
  world = buildWorld(scene);
  world.register('ducky', ducky.root, 'Ducky'); world.register('ship', ship, 'The Iceberg'); world.register('set', set, 'Ice plain');
  world.register('ship:cockpit-of-record', sourceCockpit, 'Cockpit (Blender model of record)');
  sim = createSim(grid, { collide: COLLIDE, surface: surfaceAt, free: (x, y, r) => shipWalkable(x, y, shipState, r) });
  input = createInput(document);
  snow = createSnowballs({ collide: cast, onHit: (event) => {
    hitCounts[event.kind] = (hitCounts[event.kind] || 0) + 1;
    console.log('SNOW_HIT ' + JSON.stringify(event));
    toast(event.kind === 'target' ? 'A snowy bullseye' : event.kind === 'hull' ? 'Splat on The Iceberg' : 'Splat on the ice');
    if (event.kind === 'target') world.targetMeshes.find((o) => o.userData.targetId === event.target)?.material.color.setHex(0xe8b769);
  } });
  if (DEMO) demo = createMilestoneDemo(grid);
  const selector = el('model-select');
  for (const [id, entry] of world.models) {
    const option = document.createElement('option'); option.value = id; option.textContent = entry.label; selector.add(option);
  }
  selector.addEventListener('change', () => selectModel(selector.value));
  await renderer.compileAsync(scene, camera);
  ducky.update(sim.state, 0); stepWorld(0); window.addEventListener('resize', resize); resize();
  if (params.has('debug')) statusEl.dataset.on = '1';
  Object.assign(api, {
    ready: true, webgl: webglName(), bones: ducky.bones.length, joints: ducky.joints, outfits: ducky.outfits,
    meshes: { set: set.children.length, ship: ship.children.length },
    state: () => ({ ...sim.state, nameShown, camYaw, camPitch, inside, door: shipState.door, doorTarget: shipState.doorTarget,
      consoleOn: shipState.consoleOn, outfit: ducky.outfit(), shipEvents: [...shipState.events], hits: [...snow.hits], hitCounts: { ...hitCounts }, cooldown: snow.cooldown,
      projectiles: snow.balls.map((b) => ({ ...b })), splats: snow.splats.length, inspect: inspect.selected,
      camera: camera.position.toArray(), inspectTarget: [...inspect.target], hatch: grid.ship.hatch, name: grid.ship.name,
      demoPhase: demo?.phase, demoEvents: demo?.events, preview: previewPoint }),
    advance(dt = 1 / 30, n = 1) { for (let i = 0; i < n; i++) stepWorld(dt); render(); return api.state(); },
    setInput(value) { manual = value; },
    gpu: () => ({ memory: { ...renderer.info.memory }, render: { ...renderer.info.render }, programs: renderer.info.programs?.length,
      pixelRatio: renderer.getPixelRatio(), canvas: [canvas.width, canvas.height], shadowMap: QUALITY.shadow, phone: PHONE }),
    selectModel, exitInspect,
    replaceModel: async (id, url) => {
      const local = new URL(url, document.baseURI);
      if ((local.origin === location.origin) === false) throw new Error('Model replacements must use a local asset URL');
      const model = await new GLTFLoader().loadAsync(local.href); world.replace(id, model.scene);
    },
    modelIds: () => [...world.models.keys()],
    resetMetrics() { metrics.frames = 0; metrics.ms = []; metrics.calls = []; metrics.tris = []; metrics.step = []; metrics.render = []; metrics.slow = []; metrics.t0 = performance.now(); },
    metrics() {
      const ms = [...metrics.ms].sort((a, b) => a - b);
      const q = (p) => ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : null;
      const span = (performance.now() - metrics.t0) / 1000;
      return { frames: metrics.frames, seconds: span, fps: metrics.frames / span, frame_ms_p50: q(0.5), frame_ms_p95: q(0.95),
        frame_ms_max: ms.length ? ms[ms.length - 1] : null, frame_ms_p99: q(0.99),
        step_ms_max: Math.max(0, ...metrics.step), render_ms_max: Math.max(0, ...metrics.render), slow: metrics.slow,
        draw_calls_avg: metrics.calls.length ? metrics.calls.reduce((a, b) => a + b, 0) / metrics.calls.length : null,
        triangles_avg: metrics.tris.length ? metrics.tris.reduce((a, b) => a + b, 0) / metrics.tris.length : null,
        canvas: [renderer.domElement.width, renderer.domElement.height], pixel_ratio: renderer.getPixelRatio(), webgl: api.webgl };
    },
  });
  loadingEl.classList.add('hidden'); render();
  if (CAPTURE === false) {
    let last = null;
    const loop = (now) => {
      if (last === null) last = now;
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      if (now > last) metrics.ms.push(now - last);
      const before = performance.now(); stepWorld(dt); const after = performance.now(); render(); const painted = performance.now();
      metrics.step.push(after - before); metrics.render.push(painted - after);
      if (now - last > 25) metrics.slow.push({ t: sim.state.t, phase: demo?.phase, interval: now - last, step: after - before, render: painted - after });
      last = now; metrics.frames++; requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
start().catch(showProblem);
