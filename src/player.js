// player.js — LEVEL agent: the cat. Input (keyboard, mouse with pointer lock or drag, touch), a small first-person
// controller on G.physics.moveBody, footsteps, head bob, landing dip, variable-height jump with coyote time and a jump
// buffer, wetness and the shake. The numbers come from the contract: eye 0.26 m, radius 0.14 m, walk 2.2, run 5,
// jump apex 1.35 m (9 m/s up against 30 m/s2), a run-jump carries 3 m.
import * as THREE from 'three';
import { clamp, damp, makeRng } from './util.js';

export const CAT = {
  eye: 0.26, radius: 0.14, height: 0.3, walk: 2.2, run: 5.0, jumpV: 9.0, gravity: 30, cut: 2.6, accel: 46, airAccel: 26,
  coyote: 0.12, buffer: 0.15, fov: 78, wetTime: 12, dryTime: 5, shakeTime: 1.0, afterShake: 0.3, strideWalk: 0.36, strideRun: 0.6,
};

export async function create(G) {
  const T = THREE, canvas = G.renderer.domElement, ev = G.events, rng = makeRng(90210);
  const startOf = () => (G.level && G.level.playerStart) || { pos: new T.Vector3(-26, 0.12, 4.7), yaw: -Math.PI / 2 };
  const baseFov = +(G.params.fov || CAT.fov);
  const api = {
    pos: new T.Vector3(), vel: new T.Vector3(), eye: new T.Vector3(), yaw: 0, pitch: 0, wet: 0, carrying: 0, enabled: false, onGround: true, speed: 0,
    shakes: 0, shaking: 0, sheltered: true, turnRate: 0, surface: 'tile', wetOn: true, bot: null, tune: CAT, locked: false, touch: false,
  };

  // ---------- input ----------
  const keys = new Set(); let lookX = 0, lookY = 0, drag = null, jumpTouch = false, meowAsk = false, wasLocked = false;
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 }, look = { id: null, x: 0, y: 0 };
  const typing = e => /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '');
  addEventListener('keydown', e => {
    if (typing(e)) return;
    if (e.code === 'Escape' || e.code === 'KeyP') { ev.emit('ui:pause'); return; }
    if (api.enabled && /^(Space|Arrow|Key[WASDIJKLE]|Shift)/.test(e.code)) e.preventDefault();
    if (e.code === 'KeyE' && !e.repeat) meowAsk = true;
    keys.add(e.code);
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); jumpTouch = false; stick.id = look.id = null; stick.x = stick.y = 0; });
  const lock = () => { if (!api.enabled || api.touch || document.pointerLockElement === canvas || !canvas.requestPointerLock) return; try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* drag fallback */ } };
  api.lock = lock;
  canvas.addEventListener('mousedown', e => { if (!api.enabled || e.button !== 0) return; if (document.pointerLockElement === canvas) meowAsk = true; else { drag = { x: e.clientX, y: e.clientY, moved: 0 }; lock(); } });
  addEventListener('mouseup', () => { if (drag && drag.moved < 5 && api.enabled && document.pointerLockElement !== canvas && !api.justLocked) meowAsk = true; drag = null; });
  addEventListener('mousemove', e => {
    if (!api.enabled) return;
    if (document.pointerLockElement === canvas) { lookX += e.movementX || 0; lookY += e.movementY || 0; }
    else if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy); lookX += dx * 1.6; lookY += dy * 1.6; }
  });
  document.addEventListener('pointerlockchange', () => { const on = document.pointerLockElement === canvas; api.locked = on; if (on) { api.justLocked = true; setTimeout(() => { api.justLocked = false; }, 250); } if (!on && wasLocked && api.enabled) ev.emit('ui:pause'); wasLocked = on; });
  document.addEventListener('pointerlockerror', () => {});

  // touch: left thumb is a stick, right thumb looks, two buttons
  let touchUI = null;
  const buildTouch = () => {
    const ui = document.getElementById('ui'); if (!ui || touchUI) return;
    const st = document.createElement('style'); st.textContent = `.qc-t{position:absolute;pointer-events:none;inset:0;font-family:"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif}
.qc-stick{position:absolute;width:112px;height:112px;margin:-56px 0 0 -56px;border-radius:50%;border:2px solid rgba(243,233,214,.45);background:rgba(12,20,32,.25);display:none}
.qc-stick i{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,184,107,.75)}
.qc-b{position:absolute;right:calc(22px + env(safe-area-inset-right));width:76px;height:76px;border-radius:50%;border:2px solid rgba(243,233,214,.6);background:rgba(12,20,32,.38);color:#f3e9d6;font-size:20px;font-weight:700;display:flex;align-items:center;justify-content:center;pointer-events:auto;touch-action:none;-webkit-user-select:none;user-select:none}
.qc-b:active{background:rgba(255,184,107,.6);color:#0c1420}.qc-j{bottom:calc(34px + env(safe-area-inset-bottom))}.qc-m{bottom:calc(128px + env(safe-area-inset-bottom));width:60px;height:60px;right:calc(30px + env(safe-area-inset-right));font-size:17px}`;
    document.head.appendChild(st);
    touchUI = document.createElement('div'); touchUI.className = 'qc-t'; touchUI.innerHTML = '<div class="qc-stick"><i></i></div><div class="qc-b qc-j">跳</div><div class="qc-b qc-m">喵</div>'; ui.appendChild(touchUI);
    const j = touchUI.querySelector('.qc-j'), m = touchUI.querySelector('.qc-m');
    j.addEventListener('touchstart', e => { jumpTouch = true; e.preventDefault(); }, { passive: false }); j.addEventListener('touchend', e => { jumpTouch = false; e.preventDefault(); }, { passive: false }); j.addEventListener('touchcancel', () => { jumpTouch = false; });
    m.addEventListener('touchstart', e => { meowAsk = true; e.preventDefault(); }, { passive: false });
  };
  const stickEl = () => touchUI && touchUI.querySelector('.qc-stick');
  canvas.addEventListener('touchstart', e => {
    api.touch = true; buildTouch(); if (!api.enabled) return; e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && stick.id === null) { stick.id = t.identifier; stick.ox = t.clientX; stick.oy = t.clientY; stick.x = stick.y = 0; const el = stickEl(); if (el) { el.style.display = 'block'; el.style.left = t.clientX + 'px'; el.style.top = t.clientY + 'px'; el.firstChild.style.transform = ''; } }
      else if (look.id === null) { look.id = t.identifier; look.x = t.clientX; look.y = t.clientY; }
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    if (!api.enabled) return; e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) { let dx = (t.clientX - stick.ox) / 52, dy = (t.clientY - stick.oy) / 52; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } stick.x = dx; stick.y = dy; const el = stickEl(); if (el) el.firstChild.style.transform = `translate(${dx * 34}px,${dy * 34}px)`; }
      else if (t.identifier === look.id) { lookX += (t.clientX - look.x) * 2.2; lookY += (t.clientY - look.y) * 2.2; look.x = t.clientX; look.y = t.clientY; }
    }
  }, { passive: false });
  const tEnd = e => { for (const t of e.changedTouches) { if (t.identifier === stick.id) { stick.id = null; stick.x = stick.y = 0; const el = stickEl(); if (el) el.style.display = 'none'; } if (t.identifier === look.id) look.id = null; } };
  canvas.addEventListener('touchend', tEnd); canvas.addEventListener('touchcancel', tEnd);

  // ---------- state ----------
  let coyote = 0, buffer = 0, jumpHeldPrev = false, jumping = false, stepDist = 0, bobT = 0, bob = 0, dip = 0, dipV = 0, shakeT = 0, splashT = 0, meowCd = 0, shelterK = 1, fov = baseFov, safeT = 0, wasWet = false, airT = 0, roll = 0;
  const lastSafe = new T.Vector3(), wish = new T.Vector3(), tmp = new T.Vector3();
  const inside = (x, y, z) => { const r = CAT.radius * 0.8, bs = G.physics.boxes || []; for (const b of bs) if (!b.oneWay && x + r > b.min.x && x - r < b.max.x && z + r > b.min.z && z - r < b.max.z && y + CAT.height > b.min.y + 0.02 && y < b.max.y - 0.02) return true; return false; };
  api.place = (p, yaw = api.yaw, pitch = 0) => { api.pos.copy(p); api.vel.set(0, 0, 0); api.yaw = yaw; api.pitch = pitch; api.onGround = true; lastSafe.copy(p); coyote = buffer = 0; jumping = false; dip = dipV = bob = 0; api.eye.set(p.x, p.y + CAT.eye, p.z); };
  api.reset = () => { const s = startOf(); api.place(s.pos, s.yaw, 0); api.wet = 0; api.carrying = 0; api.shakes = 0; api.shaking = 0; shakeT = 0; wasWet = false; keys.clear(); lookX = lookY = 0; };
  api.meow = () => { if (meowCd > 0) return; meowCd = 0.55; ev.emit('cat:meow', { pos: api.eye }); };
  api.reset();

  // ---------- the cat you are: two ginger front paws that reach into the bottom of the frame when running and jumping,
  // and a soft cat-shaped shadow on the floor under the body (paws=0 hides the paws, pshadow=0 the shadow) ----------
  const paws = [];
  if (G.params.paws !== '0') {
    const fur = [0.8, 0.4, 0.1], stripe = [0.55, 0.25, 0.06], cream = [0.95, 0.82, 0.62], pad = [0.9, 0.58, 0.56];
    const parts = [], paint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const q = typeof c === 'function' ? c(g.attributes.position.getX(i), g.attributes.position.getY(i), g.attributes.position.getZ(i)) : c; a[i * 3] = q[0]; a[i * 3 + 1] = q[1]; a[i * 3 + 2] = q[2]; } g.setAttribute('color', new T.BufferAttribute(a, 3)); return g.index ? g.toNonIndexed() : g; };
    // the paw points to -z; the foreleg runs back along +z with tabby rings
    const leg = new T.CylinderGeometry(0.021, 0.027, 0.3, 12, 8); leg.rotateX(Math.PI / 2); leg.translate(0, 0.012, 0.165); parts.push(paint(leg, (x, y, z) => (Math.sin(z * 62) > 0.45 && y > -0.004 ? stripe : fur)));
    const paw = new T.SphereGeometry(0.03, 14, 10); paw.scale(1.12, 0.74, 1.3); paw.translate(0, 0.002, -0.004); parts.push(paint(paw, (x, y, z) => (z < -0.026 || y < -0.012 ? cream : fur)));
    for (let i = 0; i < 4; i++) { const t = new T.SphereGeometry(0.0115, 8, 6), a = (i - 1.5) * 0.36; t.scale(1, 0.85, 1.25); t.translate(Math.sin(a) * 0.027, -0.004, -0.034 - Math.cos(a) * 0.008); parts.push(paint(t, cream)); }
    const pd = new T.SphereGeometry(0.012, 8, 6); pd.scale(1.3, 0.5, 1.1); pd.translate(0, -0.021, -0.006); parts.push(paint(pd, pad));
    let n = 0; for (const g of parts) n += g.attributes.position.count; const P3 = new Float32Array(n * 3), N3 = new Float32Array(n * 3), C3 = new Float32Array(n * 3); let o = 0;
    for (const g of parts) { P3.set(g.attributes.position.array, o); N3.set(g.attributes.normal.array, o); C3.set(g.attributes.color.array, o); o += g.attributes.position.count * 3; }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(P3, 3)); geo.setAttribute('normal', new T.BufferAttribute(N3, 3)); geo.setAttribute('color', new T.BufferAttribute(C3, 3));
    const fm = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, emissive: new T.Color(0.2, 0.1, 0.03), emissiveIntensity: 0.22 }); fm.name = 'cat_fur';
    for (const sx of [-1, 1]) { const m = new T.Mesh(geo, fm); m.frustumCulled = false; m.visible = false; m.name = 'paw'; m.scale.setScalar(0.86); G.camera.add(m); paws.push({ m, sx, x: sx * 0.05, y: -0.3, z: -0.12, k: 0 }); }
  }
  let blob = null;
  if (G.params.pshadow !== '0') {
    const c = document.createElement('canvas'); c.width = 96; c.height = 192; const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, 96, 192); x.shadowColor = '#fff'; x.shadowBlur = 13; x.fillStyle = '#fff';
    for (let i = 0; i < 2; i++) {      // seen from above, head to the top: ears, head, body, haunches, tail
      x.beginPath(); x.ellipse(48, 112, 21, 46, 0, 0, 6.3); x.fill(); x.beginPath(); x.ellipse(48, 140, 25, 24, 0, 0, 6.3); x.fill(); x.beginPath(); x.arc(48, 50, 17, 0, 6.3); x.fill();
      for (const sx of [-1, 1]) { x.beginPath(); x.moveTo(48 + sx * 5, 37); x.lineTo(48 + sx * 16, 25); x.lineTo(48 + sx * 17, 45); x.fill(); }
      x.lineWidth = 7; x.lineCap = 'round'; x.strokeStyle = '#fff'; x.beginPath(); x.moveTo(52, 158); x.quadraticCurveTo(70, 176, 62, 184); x.stroke();
    }
    const tex = new T.CanvasTexture(c), g = new T.PlaneGeometry(0.42, 0.84); g.rotateX(-Math.PI / 2); g.translate(0, 0, -0.1);      // thrown a little forward, as if the lamp were behind: the head and ears reach 0.5 m ahead, into the bottom of the view
    blob = new T.Mesh(g, new T.MeshBasicMaterial({ color: 0x05070b, alphaMap: tex, transparent: true, opacity: 0.5, depthWrite: false }));      // 8 mm above the floor; no polygon offset (the renderer's depth runs the other way)
    blob.name = 'cat_shadow'; blob.renderOrder = 1; blob.visible = false; G.scene.add(blob);
  }
  let reach = 0, air = 0, pawT = 0;
  const cue = (dt, hs) => {
    for (const q of paws) q.m.visible = true;
    if (paws.length) {
      const running = api.onGround && hs > 3.4, up = !api.onGround; pawT += dt * (running ? 13 : 4);
      reach = damp(reach, running ? 1 : 0, running ? 7 : 5, dt); air = damp(air, up ? 1 : 0, up ? 14 : 7, dt);
      for (const q of paws) {
        const ph = pawT + (q.sx > 0 ? 0.9 : 0), sw = Math.max(0, Math.sin(ph)), lift = Math.max(0, Math.cos(ph));      // gallop: both forelegs reach almost together, one a little ahead
        const rise = api.vel.y > 0 ? 1 : 0.55;
        const tx = q.sx * (0.05 + 0.012 * air), ty = -0.3 + reach * (0.105 + 0.05 * sw) + air * (0.13 + 0.035 * rise) + dip * 0.6, tz = -0.12 - reach * (0.15 + 0.1 * sw) - air * (0.2 + 0.06 * rise);
        q.x = damp(q.x, tx, 18, dt); q.y = damp(q.y, ty, 18, dt); q.z = damp(q.z, tz, 18, dt);
        q.m.position.set(q.x, q.y, q.z); q.m.rotation.set(0.78 - 0.3 * air - 0.22 * reach * lift, -q.sx * 0.1, q.sx * 0.12);      // the leg trails down and back out of the frame
      }
    }
    if (blob) {
      const gy = G.physics.groundHeight(api.pos.x, api.pos.z, api.pos.y + 0.05), h = Math.max(0, api.pos.y - gy), k = clamp(1 - h / 1.8, 0, 1);
      blob.visible = k > 0.02; blob.position.set(api.pos.x, gy + 0.008, api.pos.z); blob.rotation.y = api.yaw; blob.scale.setScalar(1 + h * 0.25); blob.material.opacity = 0.68 * k * k;
    }
  };

  api.update = dt => {
    meowCd -= dt;
    if (!api.enabled) { lookX = lookY = 0; meowAsk = false; api.turnRate = damp(api.turnRate, 0, 8, dt); for (const q of paws) q.m.visible = false; if (blob) blob.visible = false; return; }
    const bot = api.bot;
    // look
    const kTurn = (keys.has('ArrowLeft') || keys.has('KeyJ') ? 1 : 0) - (keys.has('ArrowRight') || keys.has('KeyL') ? 1 : 0), kPitch = (keys.has('KeyI') ? 1 : 0) - (keys.has('KeyK') ? 1 : 0);
    const dyaw = -lookX * 0.0022 + kTurn * 2.5 * dt; api.yaw += dyaw; api.pitch = clamp(api.pitch - lookY * 0.0022 + kPitch * 1.5 * dt, -1.35, 1.35); lookX = lookY = 0;
    if (bot && bot.yaw !== undefined) api.yaw = bot.yaw;
    api.turnRate = damp(api.turnRate, dt > 0 ? dyaw / dt : 0, 10, dt);
    if (meowAsk) { meowAsk = false; api.meow(); }

    // wish direction in the world
    let f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - stick.y, s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + stick.x;
    const sn = Math.sin(api.yaw), cs = Math.cos(api.yaw); wish.set(-sn * f + cs * s, 0, -cs * f - sn * s);
    let run = keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(stick.x, stick.y) > 0.92, jumpHeld = keys.has('Space') || jumpTouch;
    if (bot) { wish.set(bot.mx || 0, 0, bot.mz || 0); run = !!bot.run; jumpHeld = !!bot.jump; }
    const wl = wish.length(); if (wl > 1) wish.multiplyScalar(1 / wl);
    const shaking = shakeT > 0; if (shaking) { wish.set(0, 0, 0); jumpHeld = false; }

    // horizontal velocity eases to the wish; less grip in the air
    const sp = run ? CAT.run : CAT.walk, a = (api.onGround ? CAT.accel : CAT.airAccel) * dt, tx = wish.x * sp, tz = wish.z * sp;
    const dx = tx - api.vel.x, dz = tz - api.vel.z, dl = Math.hypot(dx, dz); if (dl <= a || dl === 0) { api.vel.x = tx; api.vel.z = tz; } else { api.vel.x += dx / dl * a; api.vel.z += dz / dl * a; }

    // jump: buffered press, coyote time, hold for the full height
    if (jumpHeld && !jumpHeldPrev) buffer = CAT.buffer; else buffer -= dt; jumpHeldPrev = jumpHeld;
    coyote = api.onGround ? CAT.coyote : coyote - dt;
    if (buffer > 0 && coyote > 0 && !shaking) { api.vel.y = CAT.jumpV; buffer = 0; coyote = 0; api.onGround = false; jumping = true; ev.emit('cat:jump', { pos: api.pos }); }
    const g = CAT.gravity * (jumping && api.vel.y > 0 && !jumpHeld ? CAT.cut : 1);
    api.vel.y = Math.max(-32, api.vel.y - g * dt * 0.5);       // half the gravity before the move, half after: an exact parabola at any frame rate
    const vy0 = api.vel.y, was = api.onGround;
    const res = G.physics.moveBody(api.pos, api.vel, CAT.radius, CAT.height, dt);
    api.onGround = !!res.onGround; if (res.onGround) { api.surface = res.surface || 'stone'; jumping = false; } else api.vel.y = Math.max(-32, api.vel.y - g * dt * 0.5);
    // never out of the block, never below the street
    api.pos.x = clamp(api.pos.x, -32.6, 32.6); api.pos.z = clamp(api.pos.z, -11.8, 11.8); if (api.pos.y < 0) { api.pos.y = 0; api.vel.y = 0; api.onGround = true; }
    safeT -= dt; if (safeT <= 0) { safeT = 0.4; if (inside(api.pos.x, api.pos.y, api.pos.z)) { api.pos.copy(lastSafe); api.vel.set(0, 0, 0); } else if (api.onGround) lastSafe.copy(api.pos); }
    if (!api.onGround) airT += dt;
    if (api.onGround && !was) { const v = Math.max(0, -vy0); if (airT > 0.08 || v > 2.5) { ev.emit('cat:land', { surface: api.surface, speed: v, pos: api.pos }); dipV = -Math.min(1.1, 0.25 + v * 0.07); if (v > 6 && G.fx && G.fx.puff && !api.sheltered) G.fx.puff(api.pos); } airT = 0; stepDist = 0; }
    const hs = Math.hypot(api.vel.x, api.vel.z); api.speed = hs;

    // paws
    if (api.onGround && hs > 0.4) { const stride = hs > 3.4 ? CAT.strideRun : CAT.strideWalk; stepDist += hs * dt; bobT += hs * dt / stride * Math.PI; if (stepDist >= stride) { stepDist -= stride; ev.emit('cat:step', { surface: api.surface, run: hs > 3.4, pos: api.pos, wet: api.wet }); if (!api.sheltered && G.fx && G.fx.splash && hs > 3.4) G.fx.splash(api.pos, 0.25); } }
    const bobAmp = api.onGround ? clamp(hs / CAT.run, 0, 1) * 0.016 + (hs > 0.4 ? 0.006 : 0) : 0; bob = damp(bob, Math.abs(Math.sin(bobT)) * bobAmp * 2 - bobAmp, 18, dt);
    dipV += (-dip * 190 - dipV * 20) * dt; dip += dipV * dt; dip = clamp(dip, -0.09, 0.04);     // a soft spring under the eye

    // rain
    api.sheltered = !!G.physics.shelterAt(api.pos.x, api.pos.y + CAT.height, api.pos.z);
    shelterK = damp(shelterK, api.sheltered ? 1 : 0, 5, dt); if (G.audio && G.audio.setShelter) G.audio.setShelter(shelterK);
    if (api.wetOn && !shaking) { api.wet = clamp(api.wet + (api.sheltered ? -dt / CAT.dryTime : dt / CAT.wetTime), 0, 1); if (api.wet > 0.45) wasWet = true; if (api.wet <= 0 && wasWet) { wasWet = false; ev.emit('cat:purr', { pos: api.pos }); } }
    if (api.wet >= 1 && !shaking && api.onGround) { shakeT = CAT.shakeTime; splashT = 0; api.shakes++; ev.emit('cat:shake', { pos: api.pos }); }
    let sy = 0, sr = 0, spch = 0;
    if (shakeT > 0) {
      shakeT -= dt; const k = Math.sin(Math.PI * clamp(1 - shakeT / CAT.shakeTime, 0, 1)), ph = (CAT.shakeTime - shakeT) * 44; sr = Math.sin(ph) * 0.085 * k; sy = Math.sin(ph * 0.83 + 1) * 0.035 * k; spch = Math.cos(ph * 1.21) * 0.018 * k;
      splashT -= dt; if (splashT <= 0 && G.fx && G.fx.splash) { splashT = 0.07; const an = rng() * 6.283, d = 0.12 + rng() * 0.3; G.fx.splash(tmp.set(api.pos.x + Math.cos(an) * d, api.pos.y + 0.02, api.pos.z + Math.sin(an) * d), 0.3 + rng() * 0.3); }
      if (shakeT <= 0) { api.wet = CAT.afterShake; shakeT = 0; }
    }
    api.shaking = shakeT > 0 ? shakeT / CAT.shakeTime : 0;

    // camera
    api.eye.set(api.pos.x, api.pos.y + CAT.eye + bob + dip, api.pos.z);
    roll = damp(roll, clamp(-api.turnRate * 0.012, -0.05, 0.05), 8, dt);
    const cam = G.camera; cam.position.copy(api.eye); cam.rotation.set(api.pitch + spch, api.yaw + sy, roll + sr, 'YXZ');
    cue(dt, hs);
    const fv = baseFov + (hs > 3.4 ? 5 : 0); fov = damp(fov, fv, 6, dt); if (Math.abs(cam.fov - fov) > 0.02) { cam.fov = fov; cam.updateProjectionMatrix(); }
  };
  return api;
}

// ?show=player : the street with the cat switched on. ppos=x,y,z and pyaw=radians start it somewhere else.
export async function showcase(G) {
  const p = G.player, pp = String(G.params.ppos || '').split(',').map(Number);
  if (pp.length === 3 && pp.every(Number.isFinite)) p.place(new THREE.Vector3(pp[0], pp[1], pp[2]), G.params.pyaw !== undefined ? +G.params.pyaw : p.yaw);
  else if (G.params.pyaw !== undefined) p.yaw = +G.params.pyaw;
  if (G.params.ppitch !== undefined) p.pitch = +G.params.ppitch;
  p.enabled = true;
  return { update() {} };
}
