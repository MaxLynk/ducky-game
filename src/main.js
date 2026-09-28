// Ducky powers and ship exploration. All assets are local to this build.
// Demo drives the same simulation as keyboard and touch; capture steps time explicitly.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { decodeGrid } from './grid.js';
import { createSim } from './sim.js';
import { createInput } from './input.js';
import { createDucky } from './ducky.js';
import { createMilestoneDemo } from './demo.js';
import { createRayIndex } from './ray-index.js';
import { buildWorld, cutBox, AIRLOCK_PORTAL, AIRLOCK_DOOR_SLAB, inPortal } from './world.js';
import { createShipState, shipWalkable, surfaceAt } from './layout.js';
import { loadGLB, nodeName } from './gltf-load.js';
import { createShip, BOARD_Y, LEAVE_Y, CELL_NAMES, STOP_NAMES } from './ship.js';
import { createRouteDriver } from './route-driver.js';
import { createInspect } from './inspect.js';
import { createSnowballs, trajectory, aimAt } from './snowballs.js';

const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
const CAPTURE = params.has('capture');
const COLLIDE = params.get('collision') !== 'off';
// Phone quality profile: a touch screen whose short side is under 600 CSS px (a phone, not an
// iPad mini or a desktop) gets a smaller drawing buffer and shadow map, and loads the phone asset
// variants (textures 512 px, sky 2048 px, from scripts/make-phone-assets.mjs), because Android
// Chrome drops the WebGL context when GPU memory runs short.
const PHONE = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
const QUALITY = PHONE ? { dpr: 1.25, shadow: 1024 } : { dpr: 1.5, shadow: 2048 };
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
let paused = false; // true while the WebGL context is lost: the world holds still behind the card
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
  paused = true; input?.clear();
  showProblem(new Error('WebGL context lost'));
}
// Textures, geometry and shaders re-upload by themselves; the PMREM environment and the shadow
// map were rendered on the GPU, so they are drawn again. The player stays where they were.
function restored() {
  api.error = null; problemEl.classList.add('hidden'); delete problemEl.dataset.lost;
  paused = false; input?.clear();
  buildEnvironment();
  if (api.ready === false) { loadingEl.classList.remove('hidden'); return; }
  renderer.shadowMap.needsUpdate = true; resize(); render();
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

// Six of the walkable Iceberg's materials are procedural in Blender and reach glTF as plain white
// (no colour, no texture). Until the export bakes them, the game gives each the colour its name
// states, only when it arrives as that untextured white.
const STAND_IN = { int_deck: 0x6b5a48, int_wall_lightbrown: 0xb08a64, plate_tractoryellow: 0xe0b43a, floor_cream: 0xe6d9b8,
  dark_fitting: 0x2e3338, brick_sand: 0xc9a77a };
function standInColours(root) {
  root.traverse((o) => {
    if (o.isMesh !== true) return;
    const m = o.material;
    if (STAND_IN[m.name] !== undefined && !m.map && m.color.r === 1 && m.color.g === 1 && m.color.b === 1) m.color.setHex(STAND_IN[m.name]);
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

const base = new URL('./assets/', document.baseURI);
const json = (url) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`${url.pathname || url} ${r.status}`);
  return r.json();
});
let shipLoader = null;
let ktx2 = null;
// The walkable Iceberg's GLBs are meshopt geometry with KTX2 textures; the transcoder is local.
function exportLoader() {
  if (shipLoader) return shipLoader;
  ktx2 = new KTX2Loader().setTranscoderPath(new URL('../vendor/three/examples/jsm/libs/basis/', base).href).detectSupport(renderer);
  shipLoader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  return shipLoader;
}
// Every cell GLB embeds the same three hull textures; keep one GPU copy of each.
const sharedTextures = new Map();
function shareTextures(root) {
  const slots = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'];
  root.traverse((o) => {
    if (o.isMesh !== true) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const slot of slots) {
        const t = m[slot];
        if (!t || !t.name || !t.image) continue;
        const key = [slot, t.name, t.image.width, t.image.height, t.offset.x, t.offset.y, t.repeat.x, t.repeat.y, t.rotation].join('|');
        const kept = sharedTextures.get(key);
        if (kept === undefined) sharedTextures.set(key, t);
        else if (kept !== t) { m[slot] = kept; t.dispose(); }
      }
    }
  });
}

async function load() {
  const loader = new GLTFLoader();
  // The phone asks for its variants by name before anything large is fetched or decoded.
  const phone = PHONE ? await json(new URL('phone/manifest.json', base)) : null;
  const asset = (name) => new URL(phone?.files[name]?.phone || name, base).href;
  const runtime = await json(new URL('iceberg/runtime.json', base));
  const shipFile = (slug) => new URL('iceberg/' + runtime.cells[slug][PHONE ? 'phone' : 'desktop'], base).href;
  const collision = Object.entries(runtime.cells).filter(([, c]) => c.collision).map(async ([slug, c]) => {
    const r = await fetch(new URL('iceberg/' + c.collision, base));
    if (!r.ok) throw new Error(`iceberg/${c.collision} ${r.status}`);
    return { slug, file: c.collision, scene: (await loadGLB(await r.arrayBuffer())).scene };
  });
  const [setG, duckIce, duckHelmet, exteriorG, gridJson, sky, collisionScenes] = await Promise.all([
    loader.loadAsync(asset('set.glb')),
    loader.loadAsync(asset('ducky-ice.glb')),
    loader.loadAsync(asset('ducky-helmet.glb')),
    exportLoader().loadAsync(shipFile('iceberg-exterior')),
    json(new URL('collision.json', base)),
    new THREE.TextureLoader().loadAsync(asset('sky.jpg')),
    Promise.all(collision),
    RAPIER.init(),
  ]);
  return { setG, duckG: { ice: duckIce.scene, helmet: duckHelmet.scene }, exteriorG, gridJson, sky, runtime, collisionScenes, shipFile };
}

// The rooms stream in after the ice plain is playable; boarding waits for them.
async function loadInterior(runtime, shipFile) {
  const slugs = Object.keys(runtime.cells).filter((s) => s !== 'iceberg-exterior' && runtime.cells[s].desktop);
  await Promise.all(slugs.map(async (slug) => {
    const g = await exportLoader().loadAsync(shipFile(slug));
    shareTextures(g.scene); tameMaterials(g.scene); standInColours(g.scene);
    if (slug === 'iceberg-airlock') cutBox(g.scene, AIRLOCK_DOOR_SLAB, 'game-airlock-door-v1');
    const cell = new THREE.Group(); cell.name = 'iceberg:' + slug; cell.add(g.scene);
    cell.userData.slug = slug;
    interiorRoot.add(cell);
    cells.set(slug, cell);
    world.register('iceberg:' + slug.replace(/^iceberg-/, ''), cell, 'The Iceberg: ' + (CELL_NAMES[slug] || slug).toLowerCase());
    if (slug === 'iceberg-elevator') bindElevator(g.scene);
    const option = document.createElement('option'); option.value = 'iceberg:' + slug.replace(/^iceberg-/, '');
    option.textContent = world.models.get(option.value).label; el('model-select').add(option);
  }));
  ktx2.dispose(); // every texture is in; the transcoder workers and their memory go
  hullSides(true); await renderer.compileAsync(scene, camera); hullSides(false); // both hull programs ready before boarding
  api.interiorReady = true;
}

// Aboard, a room is drawn with the rooms within two portals of it (the export's own neighbour
// lists) and the hull, which is the rooms' outer skin. Everything else is out of sight.
const nearby = new Map();
function inSight(runtime, cell) {
  if (nearby.has(cell) === false) {
    const near = new Set([cell, 'iceberg-elevator']);
    for (const a of runtime.neighbours[cell] || []) { near.add(a); for (const b of runtime.neighbours[a] || []) near.add(b); }
    nearby.set(cell, near);
  }
  return nearby.get(cell);
}
const HULL_ABOARD = new Set(['hull_walnut_aft', 'canopy_glass']);
const hullMaterials = new Set();
let hullDouble = null;
function hullSides(double) {
  if (hullDouble === double) return;
  hullDouble = double;
  for (const m of hullMaterials) m.side = double ? THREE.DoubleSide : THREE.FrontSide;
}

// The elevator's car, car doors and landing doors are drawn from nodes that share their collider's
// name; each frame they take the pose the physics gave the collider.
const elevatorParts = [];
function bindElevator(root) {
  root.updateMatrixWorld(true);
  const moving = [];
  root.traverse((o) => { const e = aboard.registry.get(nodeName(o)); if (e?.moving) moving.push([o, e]); });
  for (const [o, e] of moving) {
    root.attach(o);
    elevatorParts.push({ o, e, rest: o.position.clone() });
  }
}
function syncElevator() {
  for (const { o, e, rest } of elevatorParts) {
    o.position.set(rest.x + e.pose.x - e.closedTranslation.x, rest.y + e.pose.y - e.closedTranslation.y, rest.z + e.pose.z - e.closedTranslation.z);
  }
}

let sim, ducky, input, grid, world, ship, set, snow, demo, shipRays, aboard, driver = null, cockpitLight, runtimeManifest;
const interiorRoot = new THREE.Group();
interiorRoot.name = 'iceberg:interior';
const cells = new Map();
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
const cutaway = new THREE.Plane();
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
const portal = inPortal;
function cast(a, b) {
  // Aboard, a snowball meets the ship's own colliders: walls, decks, doors and the elevator car.
  if (inside) return aboard.castRay(a, b);
  vecA.set(a.x, a.z, -a.y);
  vecB.set(b.x - a.x, b.z - a.z, -(b.y - a.y));
  const length = vecB.length();
  if (length < 0.00001) return null;
  ray.set(vecA, vecB.normalize()); ray.far = length + 0.03;
  const objects = [...world.targetMeshes];
  if (Math.max(a.y, b.y) > 18 && shipState.door < 0.9) objects.push(world.door);
  const hits = ray.intersectObjects(objects, false);
  if (Math.max(a.y, b.y) > 18) hits.push(...shipRays.intersect(ray).filter((h) => portal(h.point) === false));
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
    const eye = s.z + 1.3; // his eyes, on whatever deck or stair he stands
    camera.position.set(s.x, eye, -s.y);
    camera.lookAt(s.x + Math.cos(camYaw) * 5, eye + Math.sin(camPitch) * 5, -(s.y + Math.sin(camYaw) * 5));
  } else {
    const distance = 5.3;
    camera.position.set(s.x - Math.cos(camYaw) * distance, 2.3 + camPitch * 3, -(s.y - Math.sin(camYaw) * distance));
    camera.lookAt(s.x + Math.cos(camYaw), 0.95 + camPitch * 3, -(s.y + Math.sin(camYaw)));
  }
}

function stepWorld(dt) {
  if (paused) return;
  const s = sim.state;
  const raw = input.read();
  const r = { ...raw, ...(driver ? driver.read(s) : manual || (demo ? demo.read(s) : {})) };
  if (r.inspectId) selectModel(r.inspectId);
  if (r.inspect) { if (inspect.selected) exitInspect(); else selectModel(inside ? 'iceberg:' + aboard.state.cell.replace(/^iceberg-/, '') : 'ducky'); }
  if (r.exit) exitInspect();
  const inspecting = Boolean(inspect.selected);
  if (inspecting === false) {
    const fx = Math.cos(camYaw), fy = Math.sin(camYaw);
    const x = r.x ?? (fx * r.fwd + fy * r.right);
    const y = r.y ?? (fy * r.fwd - fx * r.right);
    sim.step(dt, { x, y, slide: r.slide });
    if (r.interact) {
      const result = shipState.interact(s.x, s.y);
      const used = result === null && inside ? aboard.interact(s, r.stop) : null;
      if (result === 'door') toast(shipState.doorTarget ? 'Airlock opening' : 'Airlock closing');
      else if (result === 'doorway-occupied') toast('Step clear of the door first');
      else if (used?.kind === 'call') toast('Elevator called to the ' + STOP_NAMES[used.stop]);
      else if (used?.kind === 'press') toast('Going to the ' + STOP_NAMES[used.stop]);
      else if (used?.kind === 'cockpit-up') toast('Up into the cockpit');
      else if (used?.kind === 'cockpit-down') toast('Down to the main deck');
      else if (used?.kind === 'console') toast(used.on ? 'Lighting backup online' : 'Lighting backup off');
      else toast(inside ? 'Walk closer to the airlock, the elevator or the cockpit' : 'Walk closer to the airlock');
    } else if (r.stop && inside && aboard.inCar()) {
      aboard.interact(s, r.stop); toast('Going to the ' + STOP_NAMES[r.stop]);
    }
  } else s.t += dt;
  shipState.step(dt);
  aboard.setOuterDoor(shipState.door > 0.9);
  // Through the open airlock he boards the physics ship; walking back out he returns to the ice.
  if (inside === false && s.y > BOARD_Y && api.interiorReady && shipWalkable(s.x, s.y, shipState, sim.tuning.radius) === true) {
    aboard.board(s); sim.setMover(aboard.tick);
  } else if (inside && s.y < LEAVE_Y && s.z < 0.5) {
    aboard.leave(s); sim.setMover(null);
  }
  if (aboard.aboard === false && inspecting === false) aboard.idle(dt);
  inside = aboard.aboard;
  syncElevator();
  const cellInspect = inspect.selected?.startsWith('iceberg:') ? world.models.get(inspect.selected)?.object : null;
  const showInterior = inspecting ? Boolean(cellInspect) : inside;
  ship.visible = inspecting ? inspect.selected === 'ship' : true;
  interiorRoot.visible = inspecting ? Boolean(cellInspect) : true;
  const sight = inside ? inSight(runtimeManifest, aboard.state.cell) : null;
  for (const [slug, cell] of cells) cell.visible = inspecting ? cell === cellInspect : inside ? sight.has(slug) : slug === 'iceberg-airlock' || slug === 'iceberg-workshop';
  for (const part of ship.children) part.visible = inspecting || inside === false || HULL_ABOARD.has(part.material?.name);
  hullSides(inside && inspecting === false);
  // The inspector's cutaway takes the deckhead off a room: everything above the room's floor plus
  // 2.1 m is clipped while the room is inspected.
  renderer.clippingPlanes = cellInspect && el('cutaway').checked ? [cutaway.set(new THREE.Vector3(0, -1, 0), new THREE.Box3().setFromObject(cellInspect).min.y + 2.1)] : [];
  set.visible = inspecting ? inspect.selected === 'set' : inside === false;
  world.inside.visible = inspecting ? inspect.selected?.startsWith('airlock:') : inside === false || s.z < 0.5;
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
  });
  scene.environmentIntensity = showInterior ? 0.75 : 0.3;
  cockpitLight.visible = aboard.state.consoleOn; // an unlit light stays out of every shader
  world.update(shipState);
  ducky.update({ ...s, throwing: s.t < throwPoseUntil }, dt);
  scene.updateMatrixWorld(true);
  updateCamera(dt, r);
  camera.updateMatrixWorld();
  const origin = { x: s.x + Math.cos(camYaw) * 0.48, y: s.y + Math.sin(camYaw) * 0.48, z: s.z + (s.mode === 'slide' ? 0.5 : 1.0) };
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
  const cell = aboard.state.cell;
  const inCockpit = inside && cell === 'iceberg-cockpit';
  el('place').textContent = inside ? 'THE ICEBERG / ' + (CELL_NAMES[cell] || 'ABOARD') : 'THE ICE PLAIN';
  el('chapter').textContent = inside ? '02 / ABOARD THE ICEBERG' : '01 / A LITTLE MOMENTUM';
  el('objective').textContent = inside ? inCockpit ? 'A seat among the stars.' : 'Welcome aboard.' : s.mode === 'slide' ? 'Let it slide.' : 'The ice is yours.';
  el('hint').textContent = inside ? inCockpit ? 'Use the console to test the lighting. Use the door behind you to go back down.'
    : aboard.inCar() ? 'Press 1 main deck, 2 reactor deck, 3 hold, or use the panel to go to the next stop.'
      : 'Forward is the cockpit: use the vestibule to go up. The stairs and the elevator go below.'
    : nameShown ? api.interiorReady ? 'Use the airlock, then walk through the doorway.' : 'The ship is still loading.' : 'Slide on ice. Try a snowball on a target, the ice or the hull.';
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
  const { setG, duckG, exteriorG, gridJson, sky, runtime, collisionScenes, shipFile } = await load();
  runtimeManifest = runtime;
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
  // The walkable export's exterior, where the ship model sat before; its hull collider answers
  // snowball rays outside, and the Rapier world is built from every collision GLB.
  ship = exteriorG.scene; ship.name = 'ship'; holder.add(ship); scene.add(holder);
  shareTextures(ship); tameMaterials(ship); standInColours(ship); cutBox(ship, AIRLOCK_PORTAL, 'game-airlock-v2');
  // The rooms are built inside the hull and use it as their outer skin, so aboard the hull is drawn
  // from both sides (hullSides below); outside, its front faces are enough.
  ship.traverse((o) => { if (o.isMesh === true) hullMaterials.add(o.material); });
  aboard = createShip(RAPIER, { manifest: runtime, collisionScenes, ship: grid.ship, warn: (m) => console.warn(m) });
  const hull = new THREE.Group();
  hull.rotation.copy(holder.rotation); hull.position.copy(holder.position);
  hull.add(collisionScenes.find((c) => c.slug === 'iceberg-hull').scene);
  shipRays = createRayIndex(hull);
  interiorRoot.rotation.copy(holder.rotation); interiorRoot.position.copy(holder.position); scene.add(interiorRoot);
  // The lighting-backup console lights the cockpit when it is switched on.
  cockpitLight = new THREE.PointLight(0xffd9a0, 6, 7, 1.6); cockpitLight.visible = false; cockpitLight.position.set(19.2, 3.7, 0); interiorRoot.add(cockpitLight);
  ducky = createDucky(duckG); scene.add(ducky.root);
  world = buildWorld(scene);
  world.register('ducky', ducky.root, 'Ducky'); world.register('ship', ship, 'The Iceberg'); world.register('set', set, 'Ice plain');
  sim = createSim(grid, { collide: COLLIDE, surface: (x, y) => (aboard.aboard ? 'deck' : surfaceAt(x, y)),
    free: (x, y, r) => shipWalkable(x, y, shipState, r, aboard.aboard) });
  input = createInput(document);
  snow = createSnowballs({ collide: cast, onHit: (event) => {
    hitCounts[event.kind] = (hitCounts[event.kind] || 0) + 1;
    console.log('SNOW_HIT ' + JSON.stringify(event));
    toast(event.kind === 'target' ? 'A snowy bullseye' : event.kind === 'hull' ? 'Splat on The Iceberg' : event.kind === 'ship' ? 'Splat aboard The Iceberg' : 'Splat on the ice');
    if (event.kind === 'target') world.targetMeshes.find((o) => o.userData.targetId === event.target)?.material.color.setHex(0xe8b769);
  } });
  if (DEMO) demo = createMilestoneDemo(grid, aboard);
  const selector = el('model-select');
  for (const [id, entry] of world.models) {
    const option = document.createElement('option'); option.value = id; option.textContent = entry.label; selector.add(option);
  }
  selector.addEventListener('change', () => selectModel(selector.value));
  // Capture steps simulated time faster than the rooms can stream, so it waits for them.
  const interior = loadInterior(runtime, shipFile);
  if (CAPTURE) await interior;
  else interior.catch(showProblem);
  await renderer.compileAsync(scene, camera);
  ducky.update(sim.state, 0); stepWorld(0); window.addEventListener('resize', resize); resize();
  if (params.has('debug')) statusEl.dataset.on = '1';
  Object.assign(api, {
    ready: true, readyMs: performance.now(), webgl: webglName(), bones: ducky.bones.length, joints: ducky.joints, outfits: ducky.outfits,
    meshes: { set: set.children.length, ship: ship.children.length },
    state: () => ({ ...sim.state, nameShown, camYaw, camPitch, inside, door: shipState.door, doorTarget: shipState.doorTarget,
      consoleOn: aboard.state.consoleOn, outfit: ducky.outfit(), shipEvents: [...shipState.events, ...aboard.state.events], hits: [...snow.hits], hitCounts: { ...hitCounts }, cooldown: snow.cooldown,
      projectiles: snow.balls.map((b) => ({ ...b })), splats: snow.splats.length, inspect: inspect.selected,
      camera: camera.position.toArray(), inspectTarget: [...inspect.target], hatch: grid.ship.hatch, name: grid.ship.name,
      demoPhase: demo?.phase, demoEvents: demo?.events, preview: previewPoint, ship: aboard.snapshot(), interiorReady: Boolean(api.interiorReady),
      route: driver ? { done: driver.done, failed: driver.failed, log: driver.log, leg: driver.leg } : null }),
    advance(dt = 1 / 30, n = 1) {
      for (let i = 0; i < n; i++) { stepWorld(dt); if (driver && (driver.done || driver.failed)) break; }
      render(); return api.state();
    },
    setInput(value) { manual = value; },
    // Test hooks: walk a route of the export's waypoints with player input, or stand at a waypoint.
    drive(route, opts) { driver = route ? createRouteDriver(aboard, route, opts) : null; return api.state(); },
    place(name) {
      if (aboard.aboard === false) { aboard.board(sim.state); sim.setMover(aboard.tick); }
      aboard.place(name, sim.state); inside = true; return api.advance(1 / 60, 1);
    },
    look(yaw, pitch = 0) { camYaw = yaw; camPitch = pitch; return api.advance(1 / 60, 1); },
    interiorLoaded: () => interior,
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
      if (paused) { last = null; requestAnimationFrame(loop); return; } // restart the clock on restore, no jump
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
