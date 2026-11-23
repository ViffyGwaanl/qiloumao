// game.js — LEVEL agent: the rules. States title | intro | playing | paused | complete. The title screen flies the camera
// along level.cinematicPath; start places the cat and fades in; a fish within 0.5 m of the cat's head is taken; with three
// fish, reaching the attic window ends the game. Dawn rises over 300 s of play. selfTest() walks the whole route with the
// real controller (the level's legs) so the route can be proven without playing by hand.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './util.js';

const DAWN_SECONDS = 300, TAKE = 0.5;
const rate = (time, shakes) => (time <= 150 && shakes <= 1 ? '夜行大师' : time <= DAWN_SECONDS && shakes <= 4 ? '机灵猫' : '落汤猫');

export async function create(G) {
  const T = THREE, ev = G.events, P = G.params;
  const hud = () => G.hud || {}, call = (o, f, ...a) => { try { if (o && typeof o[f] === 'function') return o[f](...a); } catch (e) { console.warn('[game] ' + f + ': ' + e.message); } };
  const cPos = new T.Vector3(), cLook = new T.Vector3(), tmp = new T.Vector3();
  const api = { state: 'title', time: 0, shakes: 0, fish: 0, result: null, dawnSeconds: DAWN_SECONDS };
  let shel = 1, cineU = 0, introT = 0, endT = 0, stage = -1, wetHint = 0, homeHint = 0, prevState = 'title', titleShown = false;

  const cinematic = (dt, speed = 1) => {
    const L = G.level; if (!L) return;
    const secs = L.cinematicSeconds || 40; cineU += dt * speed / secs; if (cineU >= 1) cineU -= 1;
    if (L.sampleCinematic) L.sampleCinematic(cineU, cPos, cLook);
    else { const path = L.cinematicPath || [], n = path.length; if (n < 2) return; const f = cineU * (n - 1), i = Math.min(n - 2, Math.floor(f)), k = f - i; cPos.fromArray(path[i].pos).lerp(tmp.fromArray(path[i + 1].pos), k); cLook.fromArray(path[i].look).lerp(tmp.fromArray(path[i + 1].look), k); }
    const cam = G.camera; cam.position.copy(cPos); cam.lookAt(cLook); if (Math.abs(cam.fov - 58) > 0.01 && !P.fov) { cam.fov = 58; cam.updateProjectionMatrix(); }
    // dip to black across the loop point
    const edge = Math.min(cineU, 1 - cineU) * secs; call(hud(), 'fade', api.state === 'title' ? 1 - smoothstep(0, 1.4, edge) : 0, 0.05);
  };
  const setStage = s => { if (s === stage) return; stage = s; const H = (G.level && G.level.hints) || []; if (H[s]) call(hud(), 'hint', H[s], { hold: 9, again: true }); };
  const mood = () => call(G.audio, 'setMood', api.state === 'complete' ? 1 : api.state === 'title' ? 0.15 : 0.25 + 0.22 * api.fish);

  api.start = (o = {}) => {
    const p = G.player, L = G.level;
    call(L, 'reset'); if (L && L.fish) for (const f of L.fish) f.taken = false;
    call(p, 'reset'); api.time = 0; api.shakes = 0; api.fish = 0; api.result = null; stage = -1; wetHint = 0; homeHint = 0; endT = 0;
    if (G.render) { G.render.dawn = 0; if (G.render.post) G.render.post.wet = 0; }
    call(G.audio, 'resume'); call(G.audio, 'setPaused', false);
    call(hud(), 'show', 'play'); call(hud(), 'setFish', 0); call(hud(), 'setWet', 0);
    if (o.skipIntro) { api.state = 'playing'; p.enabled = true; call(hud(), 'fade', 0, 0.01); setStage(0); }
    else { api.state = 'intro'; introT = 0; p.enabled = false; call(hud(), 'fade', 1, 0.4); }
    ev.emit('game:start', {}); mood();
  };
  api.pause = () => { if (api.state !== 'playing') return; api.state = 'paused'; G.player.enabled = false; call(hud(), 'show', 'pause'); call(G.audio, 'setPaused', true); if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); };
  api.resume = () => { if (api.state !== 'paused') return; api.state = 'playing'; G.player.enabled = true; call(hud(), 'show', 'play'); call(G.audio, 'setPaused', false); call(G.player, 'lock'); };
  api.toTitle = () => { api.state = 'title'; if (G.player) G.player.enabled = false; call(hud(), 'show', 'title'); mood(); };
  const complete = () => {
    api.state = 'complete'; G.player.enabled = false; endT = 0;
    api.result = { time: api.time, shakes: api.shakes, rating: rate(api.time, api.shakes), fish: api.fish };
    ev.emit('game:complete', api.result); ev.emit('cat:purr', { pos: G.player.pos }); mood();
    call(hud(), 'hint', ''); call(hud(), 'show', 'end', api.result);
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  };

  ev.on('ui:start', () => { if (api.state === 'title') api.start({}); });
  ev.on('ui:restart', () => { if (api.state === 'paused' || api.state === 'complete') { api.start({ skipIntro: true }); call(G.player, 'lock'); } });
  ev.on('ui:resume', () => api.resume());
  ev.on('ui:pause', () => { if (api.state === 'playing') api.pause(); else if (api.state === 'paused') api.resume(); });
  ev.on('cat:shake', () => { if (api.state === 'playing') { api.shakes++; if (api.shakes === 1) call(hud(), 'hint', '淋透了就得停下来抖水。骑楼和雨棚底下不淋雨，躲一会儿就干了', { hold: 8, again: true }); } });
  addEventListener('visibilitychange', () => { if (document.hidden && api.state === 'playing' && !P.shot && !P.autostart) api.pause(); });

  api.update = dt => {
    const p = G.player, L = G.level, R = G.render;
    if (api.state !== 'playing' && api.state !== 'paused' && G.audio && G.audio.setShelter && G.physics.shelterAt) { const c = G.camera.position; shel += ((G.physics.shelterAt(c.x, c.y, c.z) ? 1 : 0) - shel) * Math.min(1, dt * 3); G.audio.setShelter(shel); }
    if (api.state === 'title') { if (!titleShown) { titleShown = true; call(hud(), 'show', 'title'); mood(); } cinematic(dt); return; }
    if (api.state === 'intro') {
      introT += dt;
      if (introT < 0.45) cinematic(dt, 0.4);
      else if (!p.enabled) { p.enabled = true; call(p, 'update', 0); call(hud(), 'fade', 0, 0.9); call(p, 'lock'); }
      if (introT > 1.2) { api.state = 'playing'; setStage(0); }
      return;
    }
    if (api.state === 'complete') {
      // sit in the window and look back over the street
      endT += dt; const h = L.home.pos, k = smoothstep(0, 3, endT), a = 0.9 + 0.25 * Math.sin(endT * 0.12);
      cPos.set(h.x - 0.4, h.y + 0.5 + 0.1 * k, h.z + 1.3); cLook.set(h.x - 16, 2.2 + 0.6 * Math.sin(a * 3), h.z + 3.6 + 1.2 * Math.cos(a * 2));
      G.camera.position.lerp(cPos, 1 - Math.exp(-dt * 2)); tmp.copy(cLook); G.camera.lookAt(tmp);
      if (R) R.dawn = clamp(Math.max(R.dawn || 0, api.time / DAWN_SECONDS) + dt * 0.02, 0, 1);
      return;
    }
    if (api.state !== 'playing') return;
    api.time += dt;
    if (R) { R.dawn = clamp(api.time / DAWN_SECONDS, 0, 1); if (R.post) R.post.wet = p.wet * 0.6; }
    call(hud(), 'setWet', p.wet, p.shaking);
    if (p.wet > 0.6 && !wetHint && api.shakes === 0) { wetHint = 1; call(hud(), 'hint', '身上快湿透了，先找个有顶的地方躲一躲', { hold: 6, again: true }); }
    // fish: the nearest point of the hanging fish to the cat's head
    const fish = (L && L.fish) || [];
    for (const f of fish) {
      if (f.taken) continue;
      const dy = clamp(p.eye.y - f.pos.y, -0.18, 0.18), d = Math.hypot(p.eye.x - f.pos.x, p.eye.y - (f.pos.y + dy), p.eye.z - f.pos.z);
      if (d < TAKE) { f.taken = true; api.fish++; p.carrying = api.fish; ev.emit('fish:take', { index: f.index ?? fish.indexOf(f), pos: f.pos, count: api.fish }); call(hud(), 'setFish', api.fish); call(R && R.lightPool, 'flash', f.pos, 0xffc070, 14, 0.5); mood(); const nx = fish.findIndex(q => !q.taken); setStage(nx < 0 ? 3 : nx); }
    }
    if (stage < 0) setStage(0);
    // home
    if (L && L.home) {
      const d = Math.hypot(p.pos.x - L.home.pos.x, p.pos.z - L.home.pos.z), near = d < (L.home.radius || 1) && Math.abs(p.pos.y - L.home.pos.y) < 0.9;
      if (near && api.fish >= fish.length && p.onGround) complete();
      else if (near && api.fish < fish.length) { homeHint -= dt; if (homeHint <= 0) { homeHint = 8; call(hud(), 'hint', `还差 ${fish.length - api.fish} 条咸鱼，叼齐了再回家`, { hold: 5, again: true }); } }
    }
  };

  // ---- the scripted run: every leg of the level's route with the real controller, 60 steps a second ----
  api.selfTest = (o = {}) => {
    const p = G.player, L = G.level, dt = 1 / 60, legs = (L.route && L.route.legs) || [], out = [], jv = p.tune.jumpV;
    if (o.jumpScale) p.tune.jumpV = jv * o.jumpScale;
    api.start({ skipIntro: true }); if (o.dry) p.wetOn = false;
    const step = () => { p.update(dt); api.update(dt); };
    const bot = (mx, mz, jump, run) => { p.bot = { mx, mz, jump, run, yaw: (mx || mz) ? Math.atan2(-mx, -mz) : p.yaw }; };
    let ok = true, fail = null;
    for (let li = 0; li < legs.length && ok; li++) {
      const leg = legs[li], t0 = api.time; let res = { i: li };
      if (leg.walk) {
        const [x, y, z] = leg.walk; let n = 0, still = 0, lastD = 1e9, done = false;
        while (n++ < 60 * 25) { const dx = x - p.pos.x, dz = z - p.pos.z, d = Math.hypot(dx, dz); if (d < 0.07 || api.state === 'complete') { done = true; break; } if (p.shaking <= 0) { if (lastD - d < 0.002) still++; else still = 0; } lastD = d; if (still > 40 && d < 0.3) { done = true; break; } if (still > 150) break; const k = Math.min(1, d / 0.18 + 0.25); bot(dx / d * k, dz / d * k, false, !!o.run); step(); }
        res = { ...res, type: 'walk', to: leg.walk.map(v => +v.toFixed(2)), ok: done && (Math.abs(p.pos.y - y) < 0.2 || api.state === 'complete') };
      } else if (leg.jump) {
        const j = leg.jump, [x, y, z] = j.land; let n = 0, left = false, peak = p.pos.y, landed = false;
        while (p.shaking > 0 && n++ < 200) { bot(0, 0, false); step(); }
        n = 0;
        while (n++ < 60 * 3) { const dx = x - p.pos.x, dz = z - p.pos.z, d = Math.hypot(dx, dz), k = d < 0.05 ? 0 : Math.min(1, d / 0.15); bot(d ? dx / d * k : 0, d ? dz / d * k : 0, true, !!(j.run || o.run)); step(); peak = Math.max(peak, p.pos.y); if (!p.onGround) left = true; else if (left) { landed = true; break; } }
        res = { ...res, type: 'jump', from: j.from, to: j.to, rise: j.rise, gap: j.gap, peak: +(peak - j.launch[1]).toFixed(2), ok: landed && Math.abs(p.pos.y - y) < 0.06 && Math.hypot(x - p.pos.x, z - p.pos.z) < 0.6 };
      } else if (leg.grab !== undefined) {
        const f = L.fish[leg.grab]; let n = 0;
        while (!f.taken && n++ < 60 * 5) { bot(0, 0, p.onGround && n % 50 < 30, false); step(); }
        res = { ...res, type: 'grab', fish: leg.grab, ok: f.taken };
      }
      res.t = +(api.time - t0).toFixed(2); res.at = [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)]; out.push(res);
      if (!res.ok) { ok = false; fail = res; }
    }
    p.bot = null; p.tune.jumpV = jv; p.wetOn = true;
    for (let i = 0; i < 30 && ok && api.state === 'playing'; i++) step();
    return { ok: ok && api.state === 'complete', state: api.state, fish: api.fish, time: +api.time.toFixed(1), shakes: api.shakes, rating: api.result && api.result.rating, fail, jumps: out.filter(r => r.type === 'jump').map(r => `${r.from}>${r.to} +${r.rise} gap ${r.gap} peak ${r.peak} ${r.ok ? 'ok' : 'FAIL'}`), legs: o.verbose ? out : undefined };
  };

  if (P.shot || P.autostart) titleShown = true;
  return api;
}

// ?show=game : the whole game, started (same as ?autostart=1)
export async function showcase(G) { G.game.start({ skipIntro: true }); return { update() {} }; }
