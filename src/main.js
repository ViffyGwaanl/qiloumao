// main.js — the shell: boot, the shared context G, module loading with fallback stubs, the main loop and the test hooks.
// See CONTRACT.md. A module that is missing or throws is replaced by its stub (render is the only one allowed to be fatal
// once the real one exists), so every module can be developed and looked at alone with ?show=<name>.
import * as THREE from 'three';
import { makeRng, makeEvents, pickQuality } from './util.js';
import { STUBS } from './stubs.js';

const ORDER = ['render', 'mats', 'signs', 'physics', 'arch', 'props', 'ground', 'level', 'fx', 'audio', 'player', 'hud', 'game'];
// literal import() calls so the bundler can see them; a missing file just rejects and the stub takes over
const LOAD = {
  render: () => import('./render.js'), mats: () => import('./mats.js'), signs: () => import('./signs.js'), physics: () => import('./physics.js'),
  arch: () => import('./arch.js'), props: () => import('./props.js'), ground: () => import('./ground.js'), level: () => import('./level.js'),
  fx: () => import('./fx.js'), audio: () => import('./audio.js'), player: () => import('./player.js'), hud: () => import('./hud.js'), game: () => import('./game.js'),
};
const BOOT_TEXT = { render: '正在点亮街灯', mats: '正在烧花阶砖', signs: '正在写招牌', arch: '正在砌骑楼', props: '正在摆竹椅和咸鱼', ground: '正在下雨', level: '正在布置街道', fx: '正在煲粥', audio: '正在调音', player: '正在叫醒猫', hud: '', game: '' };

window.__frames = 0; window.__ready = false; window.__fatal = null; window.__errors = [];
// the tab icon is drawn here as well: no favicon file, and so no request for one
try {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#16283a'; x.beginPath(); x.roundRect(0, 0, 64, 64, 14); x.fill();
  x.fillStyle = '#ffb86b'; x.beginPath(); x.arc(32, 37, 19, 0, 7); x.fill(); for (const s of [-1, 1]) { x.beginPath(); x.moveTo(32 + s * 6, 24); x.lineTo(32 + s * 19, 9); x.lineTo(32 + s * 20, 33); x.fill(); }
  x.fillStyle = '#16283a'; for (const s of [-1, 1]) { x.beginPath(); x.ellipse(32 + s * 8, 35, 2.6, 4.2, 0, 0, 7); x.fill(); } x.beginPath(); x.moveTo(29.5, 43); x.lineTo(34.5, 43); x.lineTo(32, 46); x.fill();
  const l = document.createElement('link'); l.rel = 'icon'; l.href = c.toDataURL('image/png'); document.head.appendChild(l);
} catch (e) { /* no icon then */ }
addEventListener('error', e => window.__errors.push(String(e.message)));
addEventListener('unhandledrejection', e => window.__errors.push('unhandled: ' + String(e.reason && e.reason.message || e.reason)));
{ const ce = console.error.bind(console); console.error = (...a) => { try { window.__errors.push(a.map(x => (x && x.stack) || String(x)).join(' ').slice(0, 500)); } catch (e) {} ce(...a); }; }
const bootEl = document.getElementById('boot'), bootMsg = document.getElementById('boot-msg'), bootFill = document.getElementById('boot-fill');
const fatal = msg => { window.__fatal = String(msg); console.error('[fatal] ' + msg); if (bootMsg) bootMsg.textContent = '启动失败：' + msg; };
const tick = () => new Promise(r => setTimeout(r, 0));
const progress = async (text, p) => { if (text && bootMsg) bootMsg.textContent = text; if (bootFill) bootFill.style.width = Math.round(p * 100) + '%'; await tick(); };

async function boot() {
  const params = Object.fromEntries(new URLSearchParams(location.search));
  const G = { THREE, params, quality: pickQuality(params.q || (params.shot ? 'medium' : '')), rng: makeRng(+(params.seed || 2611)), events: makeEvents(), time: { t: 0, dt: 0, frame: 0, real: 0 } };
  window.__G = G;
  const show = params.show && ORDER.includes(params.show) ? params.show : null; G.showcase = show;
  const mods = {};
  const load = async name => {
    const t0 = performance.now();
    // in a showcase only the module itself and the ones before it in ORDER are real; the street (ground, level) is real
    // only for the showcases that need it, everything else gets a plain 80 m test floor
    let useStub = false;
    if (show) {
      if (ORDER.indexOf(name) > ORDER.indexOf(show)) useStub = true;
      if ((name === 'ground' || name === 'level') && !['ground', 'level', 'player', 'hud', 'game'].includes(show)) useStub = true;
      if (useStub && name === 'ground' && !['ground', 'level', 'player', 'hud', 'game'].includes(show)) useStub = 'floor';
    }
    if (name === 'audio' && params.noaudio) useStub = true;
    if (!useStub) {
      try { mods[name] = await LOAD[name](); G[name] = await mods[name].create(G); }
      catch (e) { const missing = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Cannot find module/i.test(String(e && e.message)); if (!missing) console.error(`[boot] module "${name}" failed: ` + (e && e.stack || e)); else console.warn(`[boot] ${name}: no file yet, using the stub`); G[name] = null; }
    }
    if (!G[name]) {
      if (useStub === 'floor') { const f = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), G.mats.get('concrete')); f.name = 'test-floor'; f.receiveShadow = true; G.scene.add(f); G[name] = { stub: true, root: f, setRain() {}, setReflections() {}, isPuddle: () => false, wetnessAt: () => 0.5, update() {} }; }
      else G[name] = STUBS[name](G);
    }
    if (name === 'render') { G.renderer = G.render.renderer; G.scene = G.render.scene; G.camera = G.render.camera; }
    const ms = performance.now() - t0; if (ms > 120) console.log(`[boot] ${name} ${ms.toFixed(0)}ms${G[name].stub ? ' (stub)' : ''}`);
  };
  for (let i = 0; i < ORDER.length; i++) { await progress(BOOT_TEXT[ORDER[i]], 0.04 + 0.88 * i / ORDER.length); await load(ORDER[i]); }

  let shot = null;   // pinned camera: {pos, look}
  const setShot = o => {
    if (o.cam) { const f = String(o.cam).split(',').map(Number); shot = { pos: new THREE.Vector3(f[0], f[1], f[2]), look: new THREE.Vector3(f[3] ?? 0, f[4] ?? 1, f[5] ?? 0) }; }
    if (o.cam === '') shot = null;
    if (o.fov) { G.camera.fov = +o.fov; G.camera.updateProjectionMatrix(); }
  };
  window.__setShot = setShot;
  let info = null;
  if (show) {
    try { info = mods[show] && mods[show].showcase ? await mods[show].showcase(G) : null; } catch (e) { fatal(`showcase "${show}" threw: ` + (e && e.stack || e)); }
    if (info && info.cam) setShot({ cam: [...info.cam, ...(info.target || [0, 1, 0])].join(',') });
    else if (!info) setShot({ cam: '0,1.6,6,0,0.8,0' });
  }
  G.showcaseInfo = info || {};
  if (params.cam) setShot(params); if (params.fov) setShot({ fov: params.fov });
  try { G.physics.build && G.physics.build(); await G.render.onLevelReady(); } catch (e) { console.error('[boot] onLevelReady failed: ' + (e && e.stack || e)); }
  if (!show && (params.shot || params.autostart)) { try { G.game.start({ skipIntro: true }); } catch (e) { console.error('[boot] game.start failed: ' + (e && e.stack || e)); } }

  let avg = 0;
  window.__stats = () => ({ ...(G.render.stats ? G.render.stats() : {}), fps: avg ? +(1 / avg).toFixed(1) : 0, state: G.game && G.game.state, quality: G.quality.name });
  await progress('准备好了', 1); if (bootEl) { bootEl.classList.add('done'); setTimeout(() => { bootEl.hidden = true; }, 600); }

  const errOnce = {};
  const upd = (name, dt) => { const m = G[name]; if (m && m.update) { try { m.update(dt); } catch (e) { if (!errOnce[name]) { errOnce[name] = 1; console.error(`[loop] ${name}.update threw: ` + (e && e.stack || e)); } } } };
  let last = performance.now();
  G.renderer.setAnimationLoop(() => {
    const now = performance.now(); let real = (now - last) / 1000; last = now; avg = avg ? avg * 0.95 + real * 0.05 : real;
    let dt = Math.min(real, 0.05); if (params.dt) dt = +params.dt;
    G.time.dt = dt; G.time.t += dt; G.time.real = now / 1000; G.time.frame++;
    for (const n of ['player', 'game', 'level', 'ground', 'fx', 'mats', 'signs', 'audio', 'hud']) upd(n, dt);
    if (show && G.showcaseInfo.update) { try { G.showcaseInfo.update(dt); } catch (e) { if (!errOnce.sc) { errOnce.sc = 1; console.error('[loop] showcase update threw: ' + (e && e.stack || e)); } } }
    if (shot) { G.camera.position.copy(shot.pos); G.camera.lookAt(shot.look); }
    try { G.render.frame(dt); } catch (e) { if (!errOnce.render) { errOnce.render = 1; console.error('[loop] render.frame threw: ' + (e && e.stack || e)); } }
    if (++window.__frames === 2) window.__ready = true;
  });
}
boot().catch(e => fatal(e && e.stack || e));
