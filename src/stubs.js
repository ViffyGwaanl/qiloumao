// stubs.js — stand-ins for every module (shell). When a module file is missing or throws while loading, the shell uses its
// stub so everything else still runs. Each stub is small but FUNCTIONAL enough to look at the other modules against it.
// Every stub API has `stub: true`.
import * as THREE from 'three';
import { boxUV, hashStr, box3 } from './util.js';

const noop = () => {};
// rough sizes [w, h, d] so a stubbed prop is a box of the right size
export const PROP_SIZES = {
  bench_bamboo: [1.2, 0.45, 0.4], stool: [0.32, 0.3, 0.32], crate_wood: [0.6, 0.5, 0.45], crate_stack: [0.65, 1.0, 0.5], basket: [0.5, 0.35, 0.5],
  tricycle: [2.2, 1.1, 1.0], bicycle: [1.75, 1.0, 0.5], planter: [0.9, 0.4, 0.35], potted_plant: [0.4, 0.8, 0.4], lantern_paper: [0.34, 0.42, 0.34],
  lantern_string: [4, 0.5, 0.34], awning: [3.6, 0.5, 1.6], drying_rack: [1.4, 1.1, 0.5], salted_fish: [0.12, 0.36, 0.05], congee_stall: [1.8, 1.9, 0.9],
  pot_steaming: [0.45, 0.4, 0.45], urn_copper: [0.5, 0.85, 0.5], shelf_goods: [1.6, 1.8, 0.4], mailbox: [0.3, 0.4, 0.15], ac_unit: [0.8, 0.55, 0.3],
  drainpipe: [0.12, 4.2, 0.12], cable_span: [4, 0.4, 0.05], trash_bin: [0.45, 0.7, 0.45], umbrella: [1.0, 0.9, 1.0], birdcage: [0.3, 0.45, 0.3],
  table_folding: [0.8, 0.7, 0.8], home_window: [1.2, 1.5, 0.3], kerb_stone: [1.0, 0.12, 0.25],
};

export const STUBS = {
  // a plain forward renderer so every other module can be looked at before the real render module exists
  render(G) {
    const canvas = document.getElementById('view');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1) * (G.quality.scale || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15; renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x16283a); scene.fog = new THREE.FogExp2(0x16283a, 0.012);
    const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.03, 400); camera.rotation.order = 'YXZ'; scene.add(camera);
    scene.add(new THREE.HemisphereLight(0x8fb4e8, 0x40342c, 1.6));
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.2); sun.position.set(4, 9, 6); scene.add(sun);
    const pool = []; for (let i = 0; i < 8; i++) { const l = new THREE.PointLight(0xffb86b, 0, 9, 2); l.userData.free = true; scene.add(l); pool.push(l); }
    const api = {
      stub: true, renderer, scene, camera, sunDir: sun.position.clone().normalize(), exposure: 1, tune: {}, post: { fade: 0, saturation: 1, flash: 0, wet: 0 }, env: null, dawn: 0,
      lightPool: { acquire() { const l = pool.find(x => x.userData.free); if (l) l.userData.free = false; return l || null; }, release(l) { if (l) { l.userData.free = true; l.intensity = 0; } }, flash: noop },
      setQuality: noop, onLevelReady: async () => {},
      resize() { const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
      frame() { renderer.render(scene, camera); },
      stats() { const i = renderer.info; return { calls: i.render.calls, tris: i.render.triangles, tex: i.memory.textures, programs: i.programs ? i.programs.length : 0 }; },
    };
    addEventListener('resize', api.resize); api.resize();
    return api;
  },
  mats() {
    const cache = new Map();
    const EM = { glass_manchu_a: 0xff5a4a, glass_manchu_b: 0x4a8cff, glass_manchu_c: 0x3ddc97, glass_manchu_d: 0xffc24a, paper_lantern: 0xffa64a };
    return {
      stub: true, names: [], uniforms: { wet: { value: 1 } }, tileOf: () => 1, stats: () => ({ sets: 0, textureMB: 0, genMs: 0 }), update: noop,
      get(name = 'x') {
        if (!cache.has(name)) { const h = hashStr(name); const c = new THREE.Color().setHSL((h % 360) / 360, 0.35, 0.5); const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: /steel|brass|copper|metal/.test(name) ? 0.8 : 0 }); if (EM[name]) { m.emissive = new THREE.Color(EM[name]); m.emissiveIntensity = 2.2; } m.name = name; cache.set(name, m); }
        return cache.get(name);
      },
      emissive: (color = 0xffffff, intensity = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }),
    };
  },
  signs() {
    const mk = (text, w, h, bg, fg, glow) => {
      const c = document.createElement('canvas'); c.width = 512; c.height = Math.max(64, Math.round(512 * h / w)); const x = c.getContext('2d');
      x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = `900 ${Math.floor(c.height * 0.62)}px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif`; x.fillText(text, c.width / 2, c.height / 2, c.width * 0.92);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1, 1, 1).multiplyScalar(glow) })); m.position.z = 0.02;
      const g = new THREE.Group(); g.add(m); g.userData.size = [w, h, 0.06]; return g;
    };
    return {
      stub: true, names: ['陈记粥铺', '西关凉茶', '珠玑士多', '阿婆云吞面', '月明茶楼', '光明理发', '同福钟表', '蓬莱照相馆', '荔湾艇仔粥', '和记五金', '永春堂药材'], update: noop,
      neon: (text, o = {}) => mk(text, (o.height || 0.5) * Math.max(1, text.length) * 0.95, o.height || 0.5, '#0b0d12', '#' + new THREE.Color(o.color || 0xff4d6d).getHexString(), 2.4),
      lightbox: (text, o = {}) => mk(text, o.w || 1.6, o.h || 0.5, o.bg || '#fff4d8', o.fg || '#c2281d', 1.8),
      painted: (text, o = {}) => mk(text, o.w || 2.4, o.h || 0.6, o.bg || '#3a1d14', o.color || '#e9c46a', 0.9),
      plaque: text => mk(text, 0.5, 0.18, '#22262b', '#d8d2c4', 0.9),
    };
  },
  arch(G) {
    return {
      stub: true, styles: ['plain'],
      building({ bays = 3, floors = 3, side = 1 } = {}) {
        const W = bays * 4, H = 4.2 + floors * 3.6, g = new THREE.Group(), mat = G.mats.get('plaster_cream'), col = G.mats.get('concrete');
        const upper = new THREE.Mesh(boxUV(W, H - 4.2, 8.6, 'bottom'), mat); upper.position.set(W / 2, 4.2, 4.3); g.add(upper);
        const shop = new THREE.Mesh(boxUV(W, 4.08, 5.8, 'bottom'), G.mats.get('plaster_teal')); shop.position.set(W / 2, 0.12, 2.8 + 2.9); g.add(shop);
        const floor = new THREE.Mesh(boxUV(W, 0.12, 3.0, 'bottom'), G.mats.get('tile_check')); floor.position.set(W / 2, 0, 1.3); g.add(floor);
        const colliders = [box3(0, 4.2, -0.2, W, H, 8.6), box3(0, 0, 2.8, W, 4.2, 8.6), box3(0, 0, -0.2, W, 0.12, 2.8, 'tile')], anchors = { signs: [], lamps: [], balconies: [], windows: [], shopDoors: [] };
        for (let i = 0; i <= bays; i++) { const c = new THREE.Mesh(boxUV(0.5, 4.2, 0.5, 'bottom'), col); c.position.set(i * 4, 0, 0); g.add(c); colliders.push(box3(i * 4 - 0.25, 0, -0.25, i * 4 + 0.25, 4.2, 0.25)); }
        for (let i = 0; i < bays; i++) { anchors.signs.push({ pos: [i * 4 + 2, 3.6, 2.78], normal: [0, 0, -1], w: 3, h: 0.6, kind: 'fascia' }); anchors.lamps.push({ pos: [i * 4 + 2, 4.0, 1.3] }); anchors.windows.push({ pos: [i * 4 + 2, 6.2, -0.2], w: 1.4, h: 1.8 }); anchors.shopDoors.push({ pos: [i * 4 + 2, 0.12, 2.8], w: 3, h: 3, type: 'shutter' }); }
        g.userData = { size: [W, H, 8.6], colliders, anchors }; return g;
      },
    };
  },
  props(G) {
    return {
      stub: true, names: () => Object.keys(PROP_SIZES),
      build(name, opts = {}) {
        const s = PROP_SIZES[name] || [0.5, 0.5, 0.5], w = opts.w || s[0], d = opts.d || s[2], g = new THREE.Group();
        const m = new THREE.Mesh(boxUV(w, s[1], d, 'bottom'), G.mats.get(name === 'salted_fish' ? 'fish_salted' : name === 'awning' ? 'awning_red' : 'wood_dark')); g.add(m);
        if (name === 'awning') { m.scale.y = 0.06 / s[1]; m.position.y = 0; g.userData.colliders = [box3(-w / 2, 0, -d / 2, w / 2, 0.06, d / 2, 'cloth')]; }
        else g.userData.colliders = name === 'salted_fish' || /lantern|cable/.test(name) ? [] : [box3(-w / 2, 0, -d / 2, w / 2, s[1], d / 2, 'wood')];
        g.userData.size = [w, s[1], d]; g.name = name; return g;
      },
    };
  },
  ground(G) {
    const root = new THREE.Group(); root.name = 'ground';
    const st = new THREE.Mesh(new THREE.PlaneGeometry(70, 6.4).rotateX(-Math.PI / 2), G.mats.get('granite_slab')); root.add(st);
    for (const s of [1, -1]) { const a = new THREE.Mesh(boxUV(70, 0.12, 3.0, 'bottom'), G.mats.get('tile_flower_a')); a.position.set(0, 0, s * 4.7); root.add(a); if (G.physics && G.physics.addBox) G.physics.addBox(box3(-35, 0, s * 4.7 - 1.5, 35, 0.12, s * 4.7 + 1.5, 'tile')); }
    G.scene.add(root);
    return { stub: true, root, setRain: noop, setReflections: noop, isPuddle: () => false, wetnessAt: () => 0.5, update: noop };
  },
  level(G) { return { stub: true, root: new THREE.Group(), playerStart: { pos: new THREE.Vector3(-26, 0.12, 4.7), yaw: -Math.PI / 2 }, fish: [], home: { pos: new THREE.Vector3(27, 7.9, -3.4), radius: 1.2 }, lights: [], cinematicPath: [{ pos: [-28, 1.2, 1], look: [0, 2.5, 0] }, { pos: [20, 1.6, -1], look: [28, 6, -3.4] }], hints: [], stats: {}, update: noop }; },
  fx() { return { stub: true, root: new THREE.Group(), emitter: () => ({ stop: noop, setPos: noop }), splash: noop, puff: noop, setRain: noop, update: noop, stats: () => ({}) }; },
  audio() { const h = { setGain: noop, setPos: noop, stop: noop }; return { stub: true, ctx: null, ready: Promise.resolve(), names: [], play: noop, loop: () => h, setShelter: noop, setMood: noop, setPaused: noop, setVolume: noop, resume: noop, selfTest: async () => ({ peak: 0, rms: 0, clipped: 0 }), update: noop }; },
  player(G) { const s = (G.level && G.level.playerStart) || { pos: new THREE.Vector3(-26, 0.12, 4.7), yaw: -Math.PI / 2 }; return { stub: true, pos: s.pos.clone(), vel: new THREE.Vector3(), eye: s.pos.clone().add(new THREE.Vector3(0, 0.26, 0)), yaw: s.yaw, pitch: 0, wet: 0, carrying: 0, enabled: false, onGround: true, speed: 0, reset: noop, update: noop }; },
  hud() { return { stub: true, show: noop, setFish: noop, setWet: noop, hint: noop, update: noop }; },
  game() { return { stub: true, state: 'showcase', start: noop, update: noop }; },
};
