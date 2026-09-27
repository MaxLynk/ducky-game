// Keyboard, mouse and two independent touch regions. Actions fire once per press.
export function createInput(doc = document) {
  const keys = new Set();
  const queued = new Set();
  const actions = { Space: 'slide', KeyF: 'throw', KeyE: 'interact', KeyV: 'inspect', Escape: 'exit' };
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const look = { id: null, x: 0, y: 0, dx: 0, dy: 0, zoom: 0 };
  const pointer = { x: 0, y: 0, active: false };
  const canvas = doc.getElementById('view');
  const stickEl = doc.getElementById('stick');
  const knob = doc.getElementById('knob');
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT') return;
    if (actions[e.code] && e.repeat === false) queued.add(actions[e.code]);
    if (actions[e.code] || e.code.startsWith('Arrow')) e.preventDefault();
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  function clear() {
    keys.clear(); queued.clear(); stick.id = null; look.id = null; stick.x = 0; stick.y = 0;
    look.dx = 0; look.dy = 0; stickEl.classList.add('hidden');
  }
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    const touch = e.pointerType === 'touch';
    if (touch) doc.body.classList.add('touch');
    if (touch && doc.body.classList.contains('inspecting') === false && e.clientX < window.innerWidth * 0.48 && stick.id === null) {
      Object.assign(stick, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
      stickEl.classList.remove('hidden');
      stickEl.style.left = (e.clientX - 56) + 'px'; stickEl.style.top = (e.clientY - 56) + 'px';
      knob.style.transform = 'translate(0px, 0px)';
    } else if (touch || e.button === 2 || doc.body.classList.contains('inspecting')) {
      Object.assign(look, { id: e.pointerId, x: e.clientX, y: e.clientY });
    } else if (e.button === 0) queued.add('throw');
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === stick.id) {
      let dx = e.clientX - stick.ox; let dy = e.clientY - stick.oy;
      const len = Math.max(56, Math.hypot(dx, dy));
      stick.x = dx / len; stick.y = dy / len;
      knob.style.transform = 'translate(' + stick.x * 56 + 'px,' + stick.y * 56 + 'px)';
    } else if (e.pointerId === look.id) {
      look.dx += e.clientX - look.x; look.dy += e.clientY - look.y;
      look.x = e.clientX; look.y = e.clientY; pointer.active = false;
    } else if (e.pointerType === 'mouse') {
      pointer.x = e.clientX / window.innerWidth * 2 - 1;
      pointer.y = 1 - e.clientY / window.innerHeight * 2; pointer.active = true;
    }
  });
  const end = (e) => {
    if (e.pointerId === stick.id) { stick.id = null; stick.x = 0; stick.y = 0; stickEl.classList.add('hidden'); }
    if (e.pointerId === look.id) look.id = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => { look.zoom += e.deltaY * 0.001; e.preventDefault(); }, { passive: false });
  for (const name of ['slide', 'throw', 'interact', 'inspect', 'exit']) {
    doc.getElementById(name).addEventListener('pointerdown', (e) => { queued.add(name); e.preventDefault(); });
  }
  for (const [id, value] of [['zoom-in', -0.18], ['zoom-out', 0.18]]) {
    doc.getElementById(id).addEventListener('click', () => { look.zoom += value; });
  }
  return {
    clear,
    read() {
      let fwd = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
      let right = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      if (stick.id === null) { /* keyboard */ } else { fwd = -stick.y; right = stick.x; }
      const r = { fwd, right, pointer: { ...pointer }, lookX: look.dx, lookY: look.dy, zoom: look.zoom,
        turn: Number(keys.has('KeyL')) - Number(keys.has('KeyJ')),
        tilt: Number(keys.has('KeyO')) - Number(keys.has('KeyU')) };
      for (const name of ['slide', 'throw', 'interact', 'inspect', 'exit']) r[name] = queued.has(name);
      queued.clear(); look.dx = 0; look.dy = 0; look.zoom = 0;
      return r;
    },
  };
}
