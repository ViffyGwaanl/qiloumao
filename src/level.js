// level.js — LEVEL agent: lays out the street from the other modules' parts (buildings, props, signs), builds the few
// pieces only the level needs (bamboo scaffold, AC cages, the cornice ledge, the attic, box signs), places the three fish
// and the home window, registers every collider, moves the pooled lights to the lamps nearest the camera, and exports
// the route as data (jumps and legs) so it can be proven by a scripted run (game.js selfTest, NOTES_level.md).
// World: +X east along the street, +Z south, street z -3.2..3.2, column lines z = +-3.4, upper facades at |z| = 3.15.
import * as THREE from 'three';
import { makeRng, box3, boxUV, xf, Batch, mergeGeos, clamp } from './util.js';

const FACE = 3.15, LED = 4.2, ROOF = 7.8;
const NAMES = ['陈记粥铺', '西关凉茶', '珠玑士多', '阿婆云吞面', '月明茶楼', '光明理发', '同福钟表', '蓬莱照相馆', '荔湾艇仔粥', '和记五金', '永春堂药材',
  '三姑糖水', '兴隆杂货', '巧姐裁缝', '顺发单车行', '金声唱片', '榕记花店', '福记烧腊', '阿珍双皮奶', '荣记修鞋', '德叔凉果', '泮塘马蹄糕'];
const NEON = [0xff4d6d, 0x3ddc97, 0xffc24a, 0x48d1ff];
const LB = [['#fff1cf', '#c2281d'], ['#e8fff4', '#0f7a55'], ['#fff6c8', '#1f4fa8'], ['#ffe9ec', '#b0204a'], ['#103a5c', '#ffe9a8'], ['#7a1420', '#ffe7a0']];
const PB = [['#3a1d14', '#e9c46a'], ['#12382f', '#f1e3b0'], ['#5a1a16', '#ffd98a'], ['#1b2c4a', '#f3e9d6']];
const HINTS = [
  '前面晾架上挂着第一条咸鱼，走到它底下，跳一下就能叼到',
  '第二条在街对面前头那顶红雨棚上：踩着木箱和三轮车上的货，一级一级跳上去',
  '第三条在二楼阳台：从雨棚跳上空调罩，再跳上竹棚，一直往前走，翻过栏杆就是',
  '三条都到手了。踩着阳台上的木箱、空调罩、小雨棚爬上屋檐，顺着屋檐往前走到亮灯的阁楼窗口',
];

// the two rows, west to east. shops = how many bays each shop takes. North: balconies are fixed where the route needs
// them ([floor, bay] in the building's own bay order, which runs east to west on the north side).
const SOUTH = [
  { x: -30, bays: 3, floors: 3, style: 'nanyang', shop: ['tanglong', 'open', 'shutter'], shops: [1, 2] },
  { x: -18, bays: 4, floors: 2, style: 'baroque', shop: ['open', 'open', 'glass', 'tanglong'], shops: [2, 1, 1] },
  { x: -2, bays: 2, floors: 3, style: 'modern', shop: ['open', 'glass'], shops: [1, 1] },
  { x: 6, bays: 3, floors: 2, style: 'plain', shop: ['shutter', 'open', 'tanglong'], shops: [1, 2] },
  { x: 18, bays: 3, floors: 3, style: 'nanyang', shop: ['glass', 'open', 'shutter'], shops: [2, 1] },
];
const NORTH = [
  { x: -30, bays: 4, floors: 2, style: 'modern', shop: ['shutter', 'open', 'glass', 'open'], shops: [2, 2] },
  { x: -14, bays: 3, floors: 3, style: 'nanyang', shop: ['tanglong', 'open', 'glass'], shops: [1, 2] },
  { x: -2, bays: 2, floors: 2, style: 'plain', shop: ['open', 'open'], shops: [1, 1], balconies: [[1, 1]] },
  { x: 6, bays: 3, floors: 3, style: 'baroque', shop: ['open', 'shutter', 'glass'], shops: [1, 2], balconies: [[0, 0], [1, 0], [2, 2]] },
  { x: 18, bays: 3, floors: 1, style: 'plain', shop: ['glass', 'tanglong', 'open'], shops: [2, 1], balconies: [], home: true },
];
const ENDS = [
  { mode: 'east', z: 12, bays: 3, floors: 3, style: 'baroque', shop: ['glass', 'open', 'open'], shops: [1, 2] }, { mode: 'east', z: 0, bays: 3, floors: 2, style: 'modern', shop: ['open', 'glass', 'shutter'], shops: [2, 1] },
  { mode: 'west', z: -12, bays: 3, floors: 2, style: 'plain', shop: ['shutter', 'open', 'glass'], shops: [1, 2] }, { mode: 'west', z: 0, bays: 3, floors: 3, style: 'nanyang', shop: ['open', 'tanglong', 'open'], shops: [2, 1] },
];

// Catmull-Rom through a list of [x,y,z]
function crom(pts, u, out) {
  const n = pts.length - 1, f = clamp(u, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), t = f - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  for (let k = 0; k < 3; k++) out.setComponent(k, 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t));
  return out;
}

// bake every plain static mesh under `group` into one mesh per material (one draw call per material for the whole street)
function mergeStatic(group, into) {
  group.updateMatrixWorld(true);
  const by = new Map(), done = [];
  const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  group.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh) return;
    const g = o.geometry, m = o.material;
    if (!g || !g.attributes || !g.attributes.position || !m || Array.isArray(m) || o.userData.noMerge || o.userData.dynamic || !shown(o)) return;
    if (g.morphAttributes && Object.keys(g.morphAttributes).length) return;
    for (const k in g.attributes) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') return;
    for (let p = o.parent; p && p !== group; p = p.parent) if (p.userData.noMerge || p.userData.dynamic) return;
    const c = g.index ? g.toNonIndexed() : g.clone();
    if (!c.attributes.normal) c.computeVertexNormals();
    c.applyMatrix4(o.matrixWorld);
    if (o.matrixWorld.determinant() < 0) { const p = c.attributes; for (const k in p) { const a = p[k], s = a.itemSize, arr = a.array; for (let i = 0; i + 3 * s <= arr.length; i += 3 * s) for (let j = 0; j < s; j++) { const t = arr[i + s + j]; arr[i + s + j] = arr[i + 2 * s + j]; arr[i + 2 * s + j] = t; } } }
    const key = m.uuid + '|' + o.renderOrder + '|' + o.layers.mask;
    if (!by.has(key)) by.set(key, { m, geos: [], ro: o.renderOrder, layers: o.layers.mask, cast: false });
    const e = by.get(key); e.geos.push(c); e.cast = e.cast || o.castShadow; done.push(o);
  });
  for (const o of done) o.removeFromParent();
  let tris = 0;
  for (const e of by.values()) {
    const mesh = new THREE.Mesh(mergeGeos(e.geos), e.m); mesh.renderOrder = e.ro; mesh.layers.mask = e.layers; mesh.castShadow = e.cast; mesh.receiveShadow = true; mesh.name = 'merged:' + (e.m.name || '');
    if (e.m.vertexColors && !mesh.geometry.attributes.color) mesh.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count * 3).fill(1), 3));
    mesh.geometry.computeBoundingSphere(); tris += mesh.geometry.attributes.position.count / 3; into.add(mesh);
    for (const g of e.geos) g.dispose();
  }
  let left = 0; group.traverse(o => { if (o.isMesh || o.isSprite || o.isLine || o.isPoints) left++; });
  return { meshes: by.size, tris: Math.round(tris), sources: done.length, left };
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d');
  const g = x.createRadialGradient(48, 48, 0, 48, 48, 48); g.addColorStop(0, 'rgba(255,236,200,1)'); g.addColorStop(0.22, 'rgba(255,190,110,0.55)'); g.addColorStop(0.6, 'rgba(255,150,70,0.14)'); g.addColorStop(1, 'rgba(255,140,60,0)');
  x.fillStyle = g; x.fillRect(0, 0, 96, 96);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export async function create(G) {
  const T = THREE, P = G.params, _v = new T.Vector3();
  const rng = makeRng(((+(P.seed || 2611)) * 7919 + 101) >>> 0);
  const root = new T.Group(); root.name = 'level'; G.scene.add(root);
  const stat = new T.Group(); stat.name = 'level-static';      // merged per material at the end
  const dyn = new T.Group(); dyn.name = 'level-dynamic'; root.add(dyn);
  const own = new Batch();                                       // geometry the level builds itself
  // the vertex-coloured twins of the library materials, the same ones arch and props use, so the bake below still gives one mesh per material
  const M = (n, o) => { const base = G.mats.get(n, o); return base.defines && base.defines.QL_EMIS ? base : G.mats.get(n, { ...(o || {}), vc: true }); }, mat = m => (typeof m === 'string' ? M(m) : m);
  const colliders = [], lamps = [], stats = { buildings: 0, props: 0, signs: 0, colliders: 0, lamps: 0 };
  const realArch = !G.arch.stub, realProps = !G.props.stub;

  // ---------- small builders ----------
  const addBox = (x0, y0, z0, x1, y1, z1, surface = 'stone', oneWay = false) => { const b = box3(x0, y0, z0, x1, y1, z1, surface); if (oneWay) b.oneWay = true; const r = G.physics.addBox(b) || b; colliders.push(r); return r; };
  const toV = v => (v && v.isVector3 ? v : new T.Vector3(v[0], v[1], v[2]));
  const worldBoxes = obj => (obj.userData.colliders || []).map(c => { const mn = toV(c.min), mx = toV(c.max), b = new T.Box3(); for (let i = 0; i < 8; i++) b.expandByPoint(_v.set(i & 1 ? mx.x : mn.x, i & 2 ? mx.y : mn.y, i & 4 ? mx.z : mn.z).applyMatrix4(obj.matrixWorld)); b.surface = c.surface || 'stone'; b.oneWay = !!c.oneWay; return b; });
  const register = (obj, force = {}) => worldBoxes(obj).map(b => addBox(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z, b.surface, force.oneWay ?? b.oneWay));
  const put = (obj, x, y, z, rot = 0, o = {}) => { obj.position.set(x, y, z); obj.rotation.y = rot; (o.dynamic ? dyn : stat).add(obj); obj.updateMatrixWorld(true); obj.userData.boxes = o.collide === false ? [] : register(obj); return obj; };
  const prop = (name, x, y, z, rot = 0, opts = {}, o = {}) => { let p; try { p = G.props.build(name, { seed: rng.int(1, 999999), ...opts }); } catch (e) { console.warn('[level] prop ' + name + ' failed: ' + e.message); p = new T.Group(); p.userData = { size: [0.3, 0.3, 0.3], colliders: [] }; } stats.props++; return put(p, x, y, z, rot, o); };
  const bounds = obj => new T.Box3().setFromObject(obj);
  const local = (obj, v) => toV(v).clone().applyMatrix4(obj.matrixWorld);
  // the highest top of a placed prop that a cat can stand on (at least 0.25 m both ways), at or below yMax
  const standTop = (obj, yMax = 99) => { let best = null; for (const b of obj.userData.boxes || []) if (b.max.y <= yMax && b.max.x - b.min.x >= 0.25 && b.max.z - b.min.z >= 0.25 && (!best || b.max.y > best.max.y)) best = b; return best; };
  const box = (m, x0, y0, z0, x1, y1, z1) => own.add(xf(boxUV(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), { p: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] }), mat(m));
  const _up = new T.Vector3(0, 1, 0), _q = new T.Quaternion(), _m4 = new T.Matrix4(), _one = new T.Vector3(1, 1, 1);
  const rod = (m, r, a, b, seg = 7) => { const A = toV(a), B = toV(b), d = B.clone().sub(A), len = d.length(); const g = new T.CylinderGeometry(r, r, len, seg, 1); _q.setFromUnitVectors(_up, d.normalize()); g.applyMatrix4(_m4.compose(A.clone().add(B).multiplyScalar(0.5), _q, _one)); own.add(g, mat(m)); };
  const tri = (m, a, b, c) => { const g = new T.BufferGeometry(), p = [...a, ...b, ...c, ...a, ...c, ...b]; g.setAttribute('position', new T.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new T.Float32BufferAttribute([a[2], a[1], b[2], b[1], c[2], c[1], a[2], a[1], c[2], c[1], b[2], b[1]], 2)); g.computeVertexNormals(); own.add(g, mat(m)); };
  const lamp = (x, y, z, color = 0xffb86b, intensity = 15, distance = 9, priority = 1) => { const c = Array.isArray(color) ? new T.Color(color[0], color[1], color[2]) : new T.Color(color); const mx = Math.max(c.r, c.g, c.b, 1e-3); if (mx > 1) c.multiplyScalar(1 / mx); const l = { pos: new T.Vector3(x, y, z), color: c, intensity, distance, priority, k: 0 }; lamps.push(l); return l; };
  const bulbMats = new Map(), bulbMat = c => { const k = Array.isArray(c) ? c.map(v => v.toFixed(1)).join() : String(c); if (!bulbMats.has(k)) { const col = Array.isArray(c) ? new T.Color(c[0], c[1], c[2]) : new T.Color(c).multiplyScalar(5); const m = new T.MeshBasicMaterial({ color: col }); m.name = 'level_bulb'; bulbMats.set(k, m); } return bulbMats.get(k); };
  // wall-mounted props: which local z is the front (+1 or -1)? Read it from the prop, so either convention works.
  const frontOf = obj => { let lo = 0, hi = 0; for (const c of (obj.userData.colliders || [])) { lo = Math.min(lo, toV(c.min).z); hi = Math.max(hi, toV(c.max).z); } if (Math.abs(hi + lo) > 0.002) return hi > -lo ? 1 : -1;
    let sz = 0, n = 0; obj.traverse(m => { if (!m.isMesh) return; const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i += 3) if (p.getY(i) < -0.2) { sz += p.getZ(i); n++; } }); return n && sz / n > 0.02 ? -1 : 1; };      // an AC box: its brackets hang below on the wall side
  const faceOut = (obj, out) => { if (frontOf(obj) !== out) { obj.rotation.y = Math.PI; obj.updateMatrixWorld(true); } return obj; };      // out = +1: the front looks to +Z (north facade), -1: to -Z

  // ---------- buildings ----------
  const styles = (G.arch.styles && G.arch.styles.length) ? G.arch.styles : ['plain'];
  const buildings = [];
  const addBuilding = (def, side, mode, i) => {
    const o = { bays: def.bays, floors: def.floors, style: styles.includes(def.style) ? def.style : styles[i % styles.length], seed: +(def.seed ?? (1000 + i * 37)), side, shop: def.shop, floor: mode === 'east' || mode === 'west' };
    if (def.balconies) o.balconies = def.balconies;
    let g; try { g = G.arch.building(o); } catch (e) { console.error('[level] building failed: ' + (e && e.stack || e)); return null; }
    const W = def.bays * 4;
    if (mode === 'south') put(g, def.x, 0, 3.4, 0);
    else if (mode === 'north') put(g, def.x + W, 0, -3.4, Math.PI);
    else if (mode === 'east') put(g, 30, 0, def.z, Math.PI / 2);      // local x runs to -z, the arcade faces west
    else put(g, -30, 0, def.z, -Math.PI / 2);                          // local x runs to +z, the arcade faces east
    const b = { g, def, side, mode, W, H: g.userData.height || 4.2 + def.floors * 3.6, colors: g.userData.colors || {}, anchors: g.userData.anchors || {}, w: v => toV(v).clone().applyMatrix4(g.matrixWorld), n: v => toV(v).clone().transformDirection(g.matrixWorld) };
    buildings.push(b); stats.buildings++; return b;
  };
  SOUTH.forEach((d, i) => addBuilding(d, 1, 'south', i));
  NORTH.forEach((d, i) => addBuilding(d, -1, 'north', i + 5));
  ENDS.forEach((d, i) => addBuilding(d, 1, d.mode, i + 10));
  const homeB = buildings.find(b => b.def.home) || { H: ROOF, colors: {} };
  const balcB = buildings.find(b => b.mode === 'north' && b.def.x === 6);
  if (!realArch) { box('concrete', 2, LED - 0.1, -FACE, 18, LED, -FACE + 0.3); addBox(2, LED - 0.1, -FACE, 18, LED, -FACE + 0.3, 'stone', true); }      // stub buildings have no floor-line ledge
  // a blank party wall behind the low north-east roof so the roof does not look out on nothing
  box('brick_grey', 18, ROOF, -12.5, 30, 12.4, -12); addBox(18, ROOF, -12.5, 30, 12.4, -12);

  // ---------- the route: fish 1 ----------
  const fishSpots = [];
  const rack = prop('drying_rack', -12, 0.12, 5.7, 0, { fish: 0 });
  { const hooks = rack.userData.hooks, hk = hooks && hooks.length > 1 ? local(rack, hooks[1]) : new T.Vector3(-12.13, 1.16, 5.2);
    if (!hooks) rod('bamboo', 0.02, [hk.x, hk.y, hk.z], [hk.x - 0.1, hk.y - 0.02, 5.6]);
    fishSpots.push({ p: [hk.x, hk.y - 0.2, hk.z], hang: [hk.x, hk.y, hk.z] }); }

  // ---------- fish 2: crate stack, the tricycle and its load, the awning (north kerb, bay 2..6) ----------
  const ZK = -2.55;
  const trike = prop('tricycle', 1.0, 0, ZK, Math.PI);
  const cargo = standTop(trike, 1.3) || { min: new T.Vector3(1.5, 0, ZK - 0.4), max: new T.Vector3(2.1, 0.9, ZK + 0.4) };
  const lx = clamp((cargo.min.x + cargo.max.x) / 2, cargo.min.x + 0.25, cargo.max.x - 0.25);
  const load = prop('crate_wood', lx, cargo.max.y, ZK, 0.04, { w: 0.5, h: 0.45, d: 0.45 });
  const loadTop = standTop(load) || cargo;
  const stack = prop('crate_stack', lx - 0.06, 0, ZK + 0.84, 0, { n: 2 });
  const stackTop = standTop(stack, 1.2) || { min: new T.Vector3(lx - 0.3, 0, ZK + 0.6), max: new T.Vector3(lx + 0.3, 0.92, ZK + 1.05) };
  const awnTop = clamp(loadTop.max.y + 1.0, 2.0, 2.7);
  const awnings = [];
  const mountAwning = (cx, top, w, d, color, zWall = -FACE) => {     // wall edge on the north facade, the highest strip at `top`
    const a = prop('awning', 0, 0, 0, 0, { w, d, color }, { collide: false });
    let hiY = -1e9, hiZ = 0; for (const c of (a.userData.colliders || [])) { const y = toV(c.max).y; if (y > hiY) { hiY = y; hiZ = (toV(c.min).z + toV(c.max).z) / 2; } }
    if (hiZ > 0.01) { a.rotation.y = Math.PI; a.updateMatrixWorld(true); }       // turn the high (wall) edge to the facade, whichever way the prop was built
    const bb = bounds(a), cb = worldBoxes(a), ct = cb.length ? Math.max(...cb.map(b => b.max.y)) : bb.max.y, zb = cb.length ? Math.min(...cb.map(b => b.min.z)) : bb.min.z;
    a.position.set(cx - (bb.min.x + bb.max.x) / 2, top - ct, zWall - zb); a.updateMatrixWorld(true); a.userData.boxes = register(a, { oneWay: true });
    awnings.push(new T.Vector3(cx, top, zWall + d / 2));
    const u = new T.Box3(); for (const b of a.userData.boxes) { u.expandByPoint(b.min); u.expandByPoint(b.max); } if (!a.userData.boxes.length) u.set(new T.Vector3(cx - w / 2, top - 0.3, zWall), new T.Vector3(cx + w / 2, top, zWall + d));
    return u;
  };
  const awnA = mountAwning(4, awnTop, 3.4, 1.6, 'awning_red', -3.1);
  { const fx = 4.55, fz = -2.4, fy = awnTop - 0.09 + 0.72; rod('bamboo', 0.022, [fx, fy + 0.62, -3.1], [fx, fy + 0.5, fz + 0.12]); fishSpots.push({ p: [fx, fy, fz], hang: [fx, fy + 0.5, fz] }); }
  prop('table_folding', 4.25, 0, -2.2, 0.2); prop('stool', 3.35, 0, -1.95, 0.4); prop('stool', 5.05, 0, -1.85, 1.1);      // a dry seat under the awning

  // an air-conditioner in a cage with a tin rain cover: the cover is the step (one-way), the unit is solid
  const acCage = (xc, top) => {
    const zW = -FACE, z1 = zW + 0.56, x0 = xc - 0.52, x1 = xc + 0.52;
    const u = faceOut(prop('ac_unit', 0, 0, 0, 0, {}, { collide: false }), 1); const ub = bounds(u), uc = worldBoxes(u), uTop = uc.length ? uc[0].max.y : ub.max.y, uBot = uc.length ? uc[0].min.y : ub.min.y, zmin = uc.length ? uc[0].min.z : ub.min.z;
    u.position.set(xc - (ub.min.x + ub.max.x) / 2, top - 0.09 - uTop, zW + 0.02 - zmin); u.updateMatrixWorld(true);
    const yb = top - 0.09 - (uTop - uBot);
    box('metal_rust', x0, top - 0.025, zW, x1, top, z1 + 0.04);
    for (const x of [x0 + 0.015, x1 - 0.015]) { rod('steel', 0.012, [x, yb - 0.02, z1 - 0.02], [x, top - 0.02, z1 - 0.02], 5); rod('steel', 0.012, [x, yb - 0.02, zW], [x, yb - 0.02, z1 - 0.02], 5); }
    for (let i = 1; i < 6; i++) rod('steel', 0.007, [x0 + (x1 - x0) * i / 6, yb - 0.02, z1 - 0.02], [x0 + (x1 - x0) * i / 6, top - 0.02, z1 - 0.02], 4);
    rod('steel', 0.01, [x0, yb - 0.02, z1 - 0.02], [x1, yb - 0.02, z1 - 0.02], 5); rod('steel', 0.01, [x0, (yb + top) / 2, z1 - 0.02], [x1, (yb + top) / 2, z1 - 0.02], 5);
    addBox(xc - 0.42, yb - 0.05, zW, xc + 0.42, top - 0.05, zW + 0.36, 'metal');
    return addBox(x0, top - 0.035, zW, x1, top, z1 + 0.04, 'metal', true);
  };
  const ac1 = acCage(6.0, (awnTop + LED) / 2);

  // ---------- a bamboo scaffold cantilevered from the facade, planks on top, a tarp over the middle ----------
  const SC0 = 5.62, SC1 = 14.42, DECK = LED + 0.04, zO = -2.27; let pipeX = null;
  if (balcB) for (const sp of (balcB.anchors.spouts || [])) { const px = balcB.w(sp.pos).x; if (px > SC0 + 0.6 && px < SC1 - 0.6) pipeX = px; }      // the building's down-pipe comes up through the deck: the cat walks round it
  const TA = pipeX !== null && pipeX < 10.4 ? pipeX + 0.9 : 7.4;
  { const zW = -FACE, rows = 4, rw = (zO - zW - 0.02) / rows;
    for (let i = 0; i < rows; i++) for (let x = SC0, j = 0; x < SC1 - 0.1; x += 2.2, j++) { const xa = x + 0.006, xb = Math.min(x + 2.2, SC1) - 0.006, za = zW + 0.012 + i * rw, zb = za + rw, top = DECK - ((i + j) % 2 ? 0.005 : 0);
      if (pipeX !== null && pipeX > xa && pipeX < xb && -2.79 > za && -2.79 < zb) { box('wood_red', xa, DECK - 0.035, za, pipeX - 0.09, top, zb); box('wood_red', pipeX + 0.09, DECK - 0.035, za, xb, top, zb); } else box('wood_red', xa, DECK - 0.035, za, xb, top, zb); }
    for (let x = SC0 + 0.24; x <= SC1 + 0.01; x += 1.71) { rod('bamboo', 0.036, [x, DECK - 0.075, zW], [x, DECK - 0.075, zO + 0.12]); rod('bamboo', 0.032, [x, DECK - 0.1, zO + 0.03], [x, DECK - 1.15, zW + 0.02]); rod('bamboo', 0.032, [x, DECK - 0.32, zO + 0.03], [x, DECK + 1.5, zO + 0.03]); }
    rod('bamboo', 0.032, [SC0 - 0.25, DECK - 0.11, zO], [SC1 + 0.05, DECK - 0.11, zO]); rod('bamboo', 0.03, [SC0 - 0.2, DECK - 0.11, (zW + zO) / 2], [SC1, DECK - 0.11, (zW + zO) / 2]);
    rod('bamboo', 0.028, [SC0 + 0.05, DECK + 1.0, zO + 0.03], [SC1 - 0.05, DECK + 1.0, zO + 0.03]); rod('bamboo', 0.026, [SC0 + 0.05, DECK + 0.52, zO + 0.03], [SC1 - 0.05, DECK + 0.52, zO + 0.03]);
    rod('bamboo', 0.024, [SC0 + 0.3, DECK + 0.05, zO + 0.03], [SC0 + 1.95, DECK + 1.0, zO + 0.03]); rod('bamboo', 0.024, [SC1 - 0.3, DECK + 0.05, zO + 0.03], [SC1 - 1.95, DECK + 1.0, zO + 0.03]);
    addBox(SC0, DECK - 0.04, zW, SC1, DECK, zO, 'wood', true);
    if (pipeX !== null) addBox(pipeX - 0.07, DECK, -2.86, pipeX + 0.07, DECK + 2.4, -2.72, 'metal');
    own.add(xf(boxUV(2.4, 0.015, 1.02), { p: [TA + 1.2, DECK + 1.52, zW + 0.48], r: [0.12, 0, 0] }), M('cloth_blue')); addBox(TA, DECK + 1.44, zW, TA + 2.4, DECK + 1.52, zW + 0.98, 'cloth');
    rod('rope', 0.006, [TA + 0.04, DECK + 1.46, zO + 0.03], [TA + 0.04, DECK + 1.58, zW + 0.02], 4); rod('rope', 0.006, [TA + 2.36, DECK + 1.46, zO + 0.03], [TA + 2.36, DECK + 1.58, zW + 0.02], 4);
  }

  // ---------- the balcony with fish 3 (the building's own, with a second one above as its roof) ----------
  let balc = null;
  if (balcB) for (const a of (balcB.anchors.balconies || [])) { const bb = new T.Box3().setFromPoints([balcB.w(a.min), balcB.w(a.max)]); if (bb.max.x > 14.6 && bb.min.x < 17.4 && Math.abs(bb.min.y - LED) < 0.3) balc = bb; }
  // every balcony's balustrade is solid (front and both ends): a cat hops over it, and cannot walk off the edge by accident
  for (const b of buildings) for (const a of (b.anchors.balconies || [])) {
    const bb = new T.Box3().setFromPoints([b.w(a.min), b.w(a.max)]), n = b.n([0, 0, -1]), y0 = bb.max.y, y1 = y0 + (a.rail || 0.95) - 0.03, t = 0.19;
    if (Math.abs(n.z) > 0.5) { const f = n.z > 0 ? bb.max.z : bb.min.z; addBox(bb.min.x, y0, f - Math.sign(n.z) * t, bb.max.x, y1, f, 'stone'); addBox(bb.min.x, y0, bb.min.z, bb.min.x + t, y1, bb.max.z, 'stone'); addBox(bb.max.x - t, y0, bb.min.z, bb.max.x, y1, bb.max.z, 'stone'); }
    else { const f = n.x > 0 ? bb.max.x : bb.min.x; addBox(f - Math.sign(n.x) * t, y0, bb.min.z, f, y1, bb.max.z, 'stone'); addBox(bb.min.x, y0, bb.min.z, bb.max.x, y1, bb.min.z + t, 'stone'); addBox(bb.min.x, y0, bb.max.z - t, bb.max.x, y1, bb.max.z, 'stone'); }
  }
  if (!balc) {          // no building balcony (stub buildings): two plain slabs
    balc = new T.Box3(new T.Vector3(14.5, LED, -FACE), new T.Vector3(17.5, LED + 0.95, -2.15));
    for (const y of [LED, LED + 3.6]) { box('concrete', 14.5, y - 0.14, -FACE, 17.5, y, -2.15); addBox(14.5, y - 0.14, -FACE, 17.5, y, -2.15, 'stone', true); }
  }
  const BX0 = balc.min.x, BX1 = balc.max.x, BZ = (balc.min.z + balc.max.z) / 2;
  { const fx = BX0 + 1.5, fz = BZ + 0.08, fy = LED + 0.78; fishSpots.push({ p: [fx, fy, fz], hang: [fx, LED + 3.6 - 0.14, fz] }); }      // on a long string from the balcony above
  prop('potted_plant', BX0 + 0.42, LED, balc.max.z - 0.4, 0.3);
  const stack2 = prop('crate_stack', BX1 - 0.62, LED, -FACE + 0.36, 0, { n: 2 });
  const stack2Top = standTop(stack2, LED + 1.2) || { min: new T.Vector3(BX1 - 0.9, LED, -3.0), max: new T.Vector3(BX1 - 0.35, LED + 0.92, -2.6) };

  // ---------- the last climb: AC cover -> the awning over the first window -> the cornice -> east to the attic ----------
  const ac2 = acCage(BX1 + 0.56, Math.min(stack2Top.max.y + 1.0, ROOF - 1.6));
  const awnW = mountAwning(BX1 + 1.72, clamp(ac2.max.y + 0.9, 6.95, ROOF - 0.7), 1.5, 0.95, 'awning_stripe');
  const HOME = new T.Vector3(27, ROOF + 0.1, -3.4);
  const LZ1 = -2.55, cornice = addBox(18.0, ROOF - 0.1, -FACE, 29.2, ROOF, LZ1, 'stone', true);
  { const tr = homeB.colors.trim || 'plaster_cream';
    box(tr, 18.02, ROOF - 0.075, -2.94, 29.2, ROOF - 0.001, LZ1); box(tr, 18.02, ROOF - 0.13, -2.94, 29.2, ROOF - 0.075, LZ1 - 0.06);
    for (let x = 18.35; x < 29.1; x += 1.21) own.add(xf(boxUV(0.12, 0.4, 0.42), { p: [x, ROOF - 0.3, -2.9], r: [0.62, 0, 0] }), M(tr));
  }
  // the attic: a dormer room rising from the parapet of the low roof, its lit window on the street face
  { const x0 = 25.85, x1 = 28.95, zf = -FACE, zp = -FACE - 0.24, zb = -6.4, y1 = ROOF + 2.25, yc = realArch ? ROOF + 0.88 : ROOF, wall = homeB.colors.wall || 'plaster_pink', zm = (zb + zf) / 2;
    box(wall, x0, ROOF, zb, x1, y1, zp); box(wall, x0, yc, zp, x1, y1, zf);
    for (const x of [x0, x1]) tri(wall, [x, y1, zb], [x, y1, zf], [x, y1 + 0.72, zm]);
    for (const s of [1, -1]) { const run = (zf - zb) / 2 + 0.6, len = Math.hypot(run, 0.72 * run / ((zf - zb) / 2)), ang = Math.atan2(0.72, (zf - zb) / 2); own.add(xf(boxUV(x1 - x0 + 0.6, 0.06, len), { p: [(x0 + x1) / 2, y1 + 0.72 - Math.sin(ang) * len / 2 + 0.05, zm + s * Math.cos(ang) * len / 2], r: [s * ang, 0, 0] }), M('metal_green')); }
    rod('wood_red', 0.05, [x0 - 0.3, y1 + 0.75, zm], [x1 + 0.3, y1 + 0.75, zm], 8); box('wood_red', x0 - 0.3, y1 - 0.22, zf + 0.5, x1 + 0.3, y1 - 0.14, zf + 0.58);
    addBox(x0, ROOF, zb, x1, y1 + 0.3, zf, 'stone'); addBox(x0 - 0.3, y1 - 0.2, zf, x1 + 0.3, y1 - 0.1, zf + 0.6, 'metal');
    const hw = faceOut(prop('home_window', 0, 0, 0, 0, {}, { collide: false }), 1); const hb = bounds(hw); hw.position.set(HOME.x - (hb.min.x + hb.max.x) / 2, ROOF + 0.03 - (realProps ? 0 : hb.min.y), zf + 0.045 - hb.min.z); hw.updateMatrixWorld(true); hw.userData.boxes = register(hw);
    const lp = hw.userData.lamp ? local(hw, hw.userData.lamp) : new T.Vector3(HOME.x, HOME.y + 0.86, zf);
    lamp(lp.x, lp.y - 0.1, zf + 0.5, 0xffc27a, 22, 10, 3);
    const lt = prop('lantern_paper', HOME.x + 1.25, y1 - 0.72, zf + 0.34, 0, {}, { collide: false }); rod('rope', 0.005, [HOME.x + 1.25, y1 - 0.72 + ((lt.userData.hang || [0, 0.42, 0])[1]), zf + 0.34], [HOME.x + 1.25, y1 - 0.16, zf + 0.34], 4);
    prop('potted_plant', 28.75, ROOF, -2.92, 0.7, {}, { collide: false }); prop('potted_plant', 25.4, ROOF, -2.95, 0.2, {}, { collide: false });
  }

  // ---------- signs: one name per shop ----------
  const names = NAMES.slice(); for (let i = names.length - 1; i > 0; i--) { const j = rng.int(0, i), t = names[i]; names[i] = names[j]; names[j] = t; }
  let nameI = 0; const buzz = [], shopAt = {};
  const mkSign = (kind, text, o = {}) => {
    try {
      if (kind === 'neon') return G.signs.neon(text, { color: o.color || 0xff4d6d, height: o.cell || 0.5, vertical: !!o.vertical, w: o.w, h: o.h });
      if (kind === 'lightbox') return G.signs.lightbox(text, { w: o.w || 2.4, h: o.h || 0.6, bg: o.bg || '#fff1cf', fg: o.fg || '#c2281d', vertical: !!o.vertical });
      if (kind === 'plaque') return G.signs.plaque(text);
      return G.signs.painted(text, { w: o.w || 2.6, h: o.h || 0.62, color: o.color || '#e9c46a', bg: o.bg || '#3a1d14', vertical: !!o.vertical });
    } catch (e) { console.warn('[level] sign failed: ' + e.message); const g = new T.Group(); g.userData.size = [1, 0.5, 0.05]; return g; }
  };
  const signAt = (obj, pos, normal, o = {}) => { const s = obj.userData.size || [1, 0.5, 0.06], k = Math.min(1, (o.maxW || 99) / s[0], (o.maxH || 99) / s[1]); if (k < 1) obj.scale.setScalar(k); obj.position.copy(pos).addScaledVector(normal, o.off ?? 0.012); obj.rotation.y = Math.atan2(normal.x, normal.z); stat.add(obj); obj.updateMatrixWorld(true); stats.signs++; return obj; };
  const twoFaced = (obj, pos, normal, o = {}) => { const d = (obj.userData.size || [1, 1, 0.06])[2] || 0.06; signAt(obj, pos, normal, { ...o, off: o.gap || 0.005 }); const back = obj.clone(); back.userData = { ...obj.userData }; signAt(back, pos, normal.clone().negate(), { ...o, off: o.gap || 0.005 }); return d; };
  // a box sign hung out over the street: vertical text on both faces, a tin hood on top that a cat can stand on
  const boxSign = (text, x, yc, h, zIn, zOut, o = {}) => {
    const wFace = Math.abs(zOut - zIn), zc = (zIn + zOut) / 2, kind = o.kind || 'lightbox', col = o.color || NEON[0], lb = o.lb || LB[0];
    const s = kind === 'neon' ? mkSign('neon', text, { vertical: true, color: col, cell: wFace * 0.92, w: wFace, h }) : mkSign('lightbox', text, { vertical: true, w: wFace, h, bg: lb[0], fg: lb[1] });
    const sz = s.userData.size || [wFace, h, 0.1], th = 0.07;
    twoFaced(s, new T.Vector3(x, yc, zc), new T.Vector3(1, 0, 0), { gap: th / 2, maxW: wFace, maxH: h });
    box('steel', x - th / 2, yc - h / 2 - 0.015, Math.min(zIn, zOut) - 0.015, x + th / 2, yc + h / 2 + 0.015, Math.max(zIn, zOut) + 0.015);
    const t = th / 2 + (sz[2] || 0.1) + 0.03; box('metal_rust', x - t, yc + h / 2 + 0.015, Math.min(zIn, zOut) - 0.04, x + t, yc + h / 2 + 0.04, Math.max(zIn, zOut) + 0.04);
    addBox(x - t, yc - h / 2, Math.min(zIn, zOut) - 0.04, x + t, yc + h / 2 + 0.04, Math.max(zIn, zOut) + 0.04, 'metal');
    if (o.wallZ !== undefined) { for (const y of [yc + h / 2 - 0.12, yc - h / 2 + 0.12]) rod('metal_rust', 0.02, [x, y, o.wallZ], [x, y, zIn]); rod('metal_rust', 0.012, [x, yc + h / 2 + 0.55, o.wallZ], [x, yc + h / 2 + 0.03, zOut - Math.sign(zOut - zIn) * 0.1]); box('metal_rust', x - 0.05, yc + h / 2 - 0.22, Math.min(o.wallZ, o.wallZ + Math.sign(zOut - zIn) * 0.02), x + 0.05, yc + h / 2 + 0.6, Math.max(o.wallZ, o.wallZ + Math.sign(zOut - zIn) * 0.02)); }
    lamp(x, yc - h * 0.5, zOut + Math.sign(zOut - zIn) * 0.6, kind === 'neon' ? col : 0xffd9a0, 20, 11, 0.9);
    if (kind === 'neon') buzz.push(new T.Vector3(x, yc, zc));
  };
  buildings.forEach((b, bi) => {
    const A = (b.anchors.signs || []).map(a => ({ ...a, pos: toV(a.pos), normal: toV(a.normal || [0, 0, -1]) }));
    const bal0 = new Set((b.anchors.balconies || []).filter(a => (a.floor ?? 0) === 0).map(a => a.bay));
    let bay = 0;
    (b.def.shops || [b.def.bays]).forEach((span, si) => {
      const name = names[nameI++ % names.length], x0 = bay * 4, x1 = (bay + span) * 4, first = bay; bay += span;
      const inBay = (a, k) => a.pos.x > k * 4 && a.pos.x < k * 4 + 4;
      const pb = PB[(bi + si) % PB.length], lb = LB[(bi * 2 + si) % LB.length], col = NEON[(bi + si * 2) % NEON.length], style = (bi * 3 + si * 5) % 4;
      // over the door, under the arcade
      { const a = A.find(q => q.kind === 'fascia' && q.face !== 'street' && q.pos.z > 1.5 && inBay(q, first)) || { pos: new T.Vector3(x0 + 2, 3.39, 2.715), normal: new T.Vector3(0, 0, -1), w: 3.2, h: 0.62 }; const w = Math.min(a.w || 3, 3.2) * 0.95, h = Math.min(a.h || 0.6, 0.7) * 0.95; shopAt[name] = { pos: b.w([a.pos.x, 1.2, 2.6]), type: (b.def.shop || [])[first] };
        const s = style === 0 ? mkSign('lightbox', name, { w, h, bg: lb[0], fg: lb[1] }) : style === 3 ? mkSign('neon', name, { color: col, cell: h * 0.9, w, h }) : mkSign('painted', name, { w, h, bg: pb[0], color: pb[1] });
        signAt(s, b.w(a.pos), b.n(a.normal), { maxW: w, maxH: h }); }
      // on the street face, above the arches (not where a balcony sits)
      { let k = first; if (bal0.has(k) && span > 1) k++;
        const a = A.find(q => q.kind === 'fascia' && (q.face === 'street' || q.pos.z < 0) && inBay(q, k)) || (bal0.has(k) ? null : { pos: new T.Vector3(k * 4 + 2, 4.66, realArch ? -0.28 : -0.21), normal: new T.Vector3(0, 0, -1), w: 3.2, h: 0.62 });
        if (a) { const w = Math.min(a.w || 3, 3.1) * 0.96, h = Math.min(a.h || 0.6, 0.64) * 0.97, lb2 = LB[(bi + si * 3 + 1) % LB.length];
          const s = style === 1 ? mkSign('lightbox', name, { w: w * 0.86, h: h * 0.94, bg: lb2[0], fg: lb2[1] }) : mkSign('neon', name, { color: col, cell: h * 0.94, w, h });
          const wp = b.w(a.pos), wn = b.n(a.normal); signAt(s, wp, wn, { maxW: w, maxH: h }); if (style !== 1) { lamp(wp.x + wn.x * 1.7, wp.y - 1.4, wp.z + wn.z * 1.7, col, 20, 10, 0.9); buzz.push(wp.clone()); } } }
      // hung across the walkway on the building's two rods
      { const a = A.find(q => q.kind === 'hanging' && inBay(q, first)); if (a) { const lb3 = LB[(bi + si + 2) % LB.length], sw = Math.min(a.w || 1, 1.0) * 0.96, sh = (a.h || 0.5) * 0.9, s = mkSign('lightbox', name, { w: sw, h: sh, bg: lb3[0], fg: lb3[1] }); twoFaced(s, b.w(a.pos), b.n(a.normal), { gap: 0.004 });
          for (const dz of [-0.36, 0.36]) rod('steel', 0.007, b.w([a.pos.x, a.pos.y + sh / 2 - 0.01, a.pos.z + dz]), b.w([a.pos.x, 4.1, a.pos.z + dz]), 4); } }
      // a painted board down one column
      { const a = A.find(q => q.kind === 'vertical' && q.mount === 'column' && q.pos.x >= x0 && q.pos.x <= x1 && (bi + si) % 2 === 0); if (a) { const s = mkSign(style === 2 ? 'neon' : 'painted', name, { vertical: true, w: (a.w || 0.36) * 0.94, h: (a.h || 1.5) * 0.96, cell: (a.w || 0.36) * 0.9, color: style === 2 ? col : pb[1], bg: pb[0] }); signAt(s, b.w(a.pos), b.n(a.normal), { maxW: a.w || 0.36, maxH: a.h || 1.5 }); } }
    });
    // the blade sign on the building's iron arms (not through the scaffold)
    const bl = A.find(q => q.mount === 'blade');
    if (bl) { const wp = b.w(bl.pos), wn = b.n([0, 0, -1]), name = names[(nameI + bi) % names.length], h = Math.min(bl.h || 2.7, 2.5), w = Math.min(bl.w || 0.9, 0.86);
      if (!(b.mode === 'north' && wp.x > SC0 - 1 && wp.x < BX1 + 0.5)) { const zc = wp.z, zi = zc - wn.z * w / 2, zo = zc + wn.z * w / 2; if (b.mode === 'north' || b.mode === 'south') boxSign(name, wp.x, wp.y, h, zi, zo, { kind: bi % 2 ? 'neon' : 'lightbox', color: NEON[(bi + 1) % 4], lb: LB[(bi + 4) % LB.length], wallZ: b.side * FACE }); } }
  });

  // ---------- lamps ----------
  for (const b of buildings) {
    const L = (b.anchors.lamps && b.anchors.lamps.length) ? b.anchors.lamps : Array.from({ length: b.def.bays }, (_, i) => ({ pos: [i * 4 + 2, 4.15, 1.3] }));
    L.forEach((a, i) => {      // a pendant on its cord: enamel shade, a warm bulb
      const top = b.w(a.pos), y = Math.min(top.y, 4.1) - 0.62 - (i % 2) * 0.1, col = a.color || [4.6, 3.3, 1.8], shade = b.def.style === 'modern' ? 'ceramic_white' : (i + buildings.indexOf(b)) % 2 ? 'metal_green' : 'ceramic_blue';
      rod('rubber', 0.007, [top.x, y + 0.1, top.z], [top.x, top.y, top.z], 5);
      const sg = new T.LatheGeometry([[0.035, 0.12], [0.07, 0.09], [0.2, 0.02], [0.215, 0]].map(q => new T.Vector2(q[0], q[1])), 16); sg.translate(top.x, y, top.z); const sm = M(shade); own.add(sg, sm);
      const si = sg.clone(); si.scale(0.97, 0.97, 0.97); si.translate(top.x * 0.03, y * 0.03, top.z * 0.03); { const ix = si.index.array; for (let q = 0; q < ix.length; q += 3) { const t = ix[q + 1]; ix[q + 1] = ix[q + 2]; ix[q + 2] = t; } si.computeVertexNormals(); } own.add(si, M('ceramic_white'));
      const cg = new T.CylinderGeometry(0.03, 0.04, 0.07, 8); cg.translate(top.x, y + 0.13, top.z); own.add(cg, M('brass'));
      const g = new T.SphereGeometry(0.055, 12, 8); g.scale(1, 1.25, 1); g.translate(top.x, y + 0.03, top.z); own.add(g, bulbMat(col));
      lamp(top.x, y - 0.22, top.z, col, 17, 9.5, 1);
    });
    for (const sc of (b.anchors.sconces || [])) { const w = b.w(sc.pos); lamp(w.x, w.y, w.z, sc.color || 0xffb86b, 8, 6.5, 0.6); }
    for (const d of (b.anchors.shopDoors || [])) if (d.lamp) { const w = b.w(d.lamp); lamp(w.x, w.y, w.z, 0xffc890, 9, 7, 0.6); }
  }

  // ---------- dressing ----------
  // [name, x, z, rotation, y (default: the floor there), opts]. Props face -Z; R turns them to face the street from the north.
  const R = Math.PI, floorAt = z => (Math.abs(z) > 3.2 ? 0.12 : 0);
  const D = [
    // south arcade, west to east (the cat's first walk): things hug the shopfront (z ~ 5.8) and the piers (z ~ 3.95); z 4.3..4.8 stays clear
    ['potted_plant', -28.9, 5.8, 0.4], ['bench_bamboo', -27.6, 5.9, 0], ['potted_plant', -25.2, 5.85, 1.2], ['bench_bamboo', -24.2, 5.9, 0], ['stool', -22.9, 5.55, 0.5],
    ['urn_copper', -21.7, 5.74, 0], ['urn_copper', -21.0, 5.76, 0.2], ['table_folding', -19.6, 5.55, 0.1], ['stool', -18.9, 5.2, 0.9], ['stool', -20.4, 5.25, 0.2],
    ['shelf_goods', -16.7, 5.96, 0], ['crate_wood', -15.3, 5.84, 0.2], ['basket', -14.5, 5.72, 0.7], ['bicycle', -15.9, 3.98, 0.03], ['basket', -10.6, 5.74, 0.3], ['basket', -13.3, 5.76, 1.3],
    ['planter', -9.6, 3.98, 0], ['congee_stall', -7.2, 5.62, 0], ['stool', -5.5, 5.4, 0.3], ['table_folding', -4.45, 5.5, 0.4], ['stool', -3.75, 5.25, 1.2], ['pot_steaming', -8.65, 5.78, 0],
    ['trash_bin', -2.5, 3.98, 0], ['shelf_goods', -0.2, 5.96, 0], ['crate_stack', 1.5, 5.82, 0.1], ['umbrella', 2.9, 5.6, 0.6], ['bench_bamboo', 4.6, 5.9, 0], ['potted_plant', 5.5, 3.98, 0],
    ['bicycle', 8.2, 5.86, 0.05], ['crate_wood', 10.1, 5.8, 0.3], ['basket', 10.9, 5.72, 0], ['table_folding', 12.6, 5.5, 0.2], ['stool', 13.4, 5.2, 0.6], ['urn_copper', 15.1, 5.74, 0],
    ['planter', 16.6, 3.98, 0], ['shelf_goods', 19.8, 5.96, 0], ['bench_bamboo', 22.3, 5.9, 0], ['potted_plant', 23.6, 5.82, 0.9], ['crate_stack', 25.4, 5.82, 0.4], ['trash_bin', 27.5, 3.98, 0], ['potted_plant', 28.8, 5.75, 0.2],
    // north arcade
    ['bench_bamboo', -27.2, -5.9, R], ['potted_plant', -25.5, -5.82, 0.3], ['crate_stack', -23.2, -5.82, 0.2], ['bicycle', -20.6, -5.86, 3.2], ['shelf_goods', -17.6, -5.96, R], ['basket', -16.2, -5.72, 0.5],
    ['urn_copper', -12.4, -5.74, R], ['table_folding', -11.0, -5.5, 0.3], ['stool', -10.3, -5.1, 0.8], ['planter', -8.4, -3.98, 0], ['shelf_goods', -5.6, -5.96, R], ['crate_wood', -4.2, -5.82, 0.4],
    ['congee_stall', 0.2, -5.62, R], ['stool', 1.9, -5.3, 0.2], ['pot_steaming', -1.2, -5.78, 0], ['basket', 3.2, -5.74, 0.9], ['potted_plant', 5.4, -5.82, 0.1], ['bench_bamboo', 8.0, -5.9, R], ['trash_bin', 9.5, -3.98, 0],
    ['crate_stack', 11.8, -5.82, 0.2], ['umbrella', 13.2, -5.5, 2.2], ['bicycle', 15.4, -5.86, 3.1], ['shelf_goods', 20.2, -5.96, R], ['table_folding', 22.6, -5.5, 0.1], ['stool', 23.4, -5.1, 0.4], ['urn_copper', 24.9, -5.74, R], ['potted_plant', 28.6, -5.82, 0.6],
    // the street edge, both kerbs
    ['bicycle', -22.5, 2.78, 0.04], ['planter', -19.4, 2.88, 0], ['trash_bin', -12.9, 2.82, 0], ['planter', -6.4, 2.88, 0], ['tricycle', 9.6, 2.5, 0.05], ['crate_wood', 11.5, 2.72, 0.3], ['planter', 14.8, 2.88, 0], ['bicycle', 20.8, 2.78, 3.1], ['planter', 25.2, 2.88, 0],
    ['planter', -25.6, -2.88, 0], ['bicycle', -17.2, -2.78, 3.18], ['trash_bin', -9.8, -2.82, 0], ['planter', -5.2, -2.88, 0], ['crate_wood', -3.1, -2.64, 0.5], ['planter', 9.0, -2.88, 0], ['umbrella', 16.2, -2.4, 0.4], ['basket', 24.0, -2.72, 0.2], ['planter', 27.4, -2.88, 0],
    // the two end arcades
    ['bench_bamboo', 32.5, 6.5, R / 2], ['potted_plant', 32.4, 1.8, 0.2], ['crate_stack', 32.3, -5.6, 1.4], ['urn_copper', 32.4, -1.6, R / 2], ['bicycle', 32.5, 9.0, 1.6],
    ['shelf_goods', -32.56, 5.4, -R / 2], ['potted_plant', -32.4, 1.4, 0.5], ['bench_bamboo', -32.5, -6.2, -R / 2], ['basket', -32.3, -1.9, 0.3], ['trash_bin', -30.9, -9.4, 0],
  ];
  const steamAt = [];
  for (const [name, x, z, rot = 0, y, opts] of D) {
    const p = prop(name, x, y === undefined ? (Math.abs(x) > 30 ? 0.12 : floorAt(z)) : y, z, rot, opts || {});
    if (p.userData.steam) for (const s of p.userData.steam) steamAt.push(local(p, s)); else if (!realProps && (name === 'pot_steaming' || name === 'congee_stall')) steamAt.push(new T.Vector3(x, 1.0, z));
    if (p.userData.lamp) { const w = local(p, p.userData.lamp); lamp(w.x, w.y - 0.1, w.z, 0xffc890, 10, 7, 0.9); }
  }
  // paper lanterns by some doors, bird cages, letter boxes
  for (const [x, z] of [[-26, 5.4], [-20, 5.4], [-10.4, 5.4], [-6, 5.4], [0, 5.4], [8, 5.4], [14, 5.4], [22, 5.4], [-24, -5.4], [-12, -5.4], [-4, -5.4], [4, -5.4], [12, -5.4], [20, -5.4], [26, -5.4]]) { const l = prop('lantern_paper', x + 1.55, 2.7, z, 0, {}, { collide: false }); const hy = 2.7 + ((l.userData.hang || [0, 0.42, 0])[1]); rod('rope', 0.005, [x + 1.55, hy, z], [x + 1.55, 4.1, z], 4); lamp(x + 1.55, 2.55, z, 0xff8a4a, 7, 6, 0.7); }
  for (const [x, z] of [[-17.5, 4.0], [6.6, 4.0], [-7.5, -4.0], [18.5, 4.1]]) { const c = prop('birdcage', x, 2.45, z, 0, {}, { collide: false }); rod('rope', 0.005, [x, 2.45 + ((c.userData.hang || [0, 0.47, 0])[1]), z], [x, 4.1, z], 4); }
  for (const [x, s] of [[-29.25, 1], [-13.25, 1], [6.75, 1], [-21.25, -1], [10.75, -1]]) faceOut(prop('mailbox', x, 1.25, s * 6.12, 0, {}, { collide: false }), -s);
  // strings of lanterns and cables across the street
  for (const x of [-24, -16, -8, 0, 24]) { const ls = prop('lantern_string', x, 5.42, 0, R / 2, { w: 6.3 }, { collide: false }); if (!realProps) { ls.position.y = 5.2; ls.updateMatrixWorld(true); } lamp(x, 4.4, 0, 0xff8a45, 30, 13, 1); }
  for (const [x, y, r] of [[-27, 8.6, 1.42], [-11, 8.4, 1.7], [3.5, 8.9, 1.5], [13, 9.4, 1.66], [21, 10.2, 1.45]]) { const c = prop('cable_span', x, y, 0, r, { w: 6.5 }, { collide: false }); if (c.userData.lamp) { const w = local(c, c.userData.lamp); lamp(w.x, w.y, w.z, 0xffc890, 8, 7, 0.5); } }
  // without real buildings: pipes and a few AC boxes so the stub street is not bare
  const drips = [];
  for (const b of buildings) for (const s of (b.anchors.spouts || [])) drips.push(b.w(s.pos));
  if (!realArch) for (const [x, s] of [[-18, 1], [-2, 1], [18, 1], [-14, -1]]) { prop('drainpipe', x + 0.33, 0, s * 3.06, s > 0 ? 0 : R, {}, { collide: false }); drips.push(new T.Vector3(x + 0.33, 0.3, s * 2.95)); }

  // ---------- fish ----------
  const glowTex = glowTexture();
  const fish = fishSpots.map((s, index) => {
    const pos = new T.Vector3(...s.p), pivot = new T.Group(); pivot.position.copy(pos);
    let f; try { f = G.props.build('salted_fish', { seed: 7 + index }); } catch (e) { f = new T.Group(); }
    const fb = bounds(f), ok = isFinite(fb.min.y); if (ok) f.position.set(-(fb.min.x + fb.max.x) / 2, -(fb.min.y + fb.max.y) / 2, -(fb.min.z + fb.max.z) / 2);
    const hh = ok ? (fb.max.y - fb.min.y) / 2 : 0.18; pivot.add(f);
    const glow = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: new T.Color(2.2, 1.7, 1.0), transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); glow.scale.setScalar(1.3); glow.position.copy(pos); glow.renderOrder = 5;
    const top = new T.Vector3(...s.hang), len = Math.max(0.02, top.y - (pos.y + hh)), str = new T.Mesh(new T.CylinderGeometry(0.004, 0.004, 1, 4), G.mats.get('rope')); str.scale.y = len; str.position.set(pos.x, pos.y + hh + len / 2, pos.z);
    dyn.add(pivot, glow, str);
    const L = lamp(pos.x, pos.y - 0.12, pos.z + (pos.z > 0 ? -0.3 : 0.3), 0xffc070, 8, 5, 2.5);
    return { index, pos, taken: false, object: pivot, glow, string: str, lamp: L, phase: index * 2.1 };
  });

  // ---------- bake ----------
  stat.add(own.finish({ name: 'level-own' }));
  const merged = new T.Group(); merged.name = 'level-merged'; root.add(merged);
  const ms = mergeStatic(stat, merged); root.add(stat);            // what could not be merged stays as it was
  G.physics.build && G.physics.build();
  Object.assign(stats, { colliders: colliders.length, lamps: lamps.length, mergedMeshes: ms.meshes, mergedTris: ms.tris, mergedFrom: ms.sources, unmerged: ms.left, realArch, realProps });
  const NL = clamp(+(P.lights ?? 7), 0, 8), slots = [];
  for (let i = 0; i < NL; i++) { const l = G.render.lightPool.acquire(); if (!l) break; slots.push({ l, lamp: null, k: 0 }); }
  const LSCALE = +(P.lv_light || 1);

  // ---------- the route as data: every jump (launch and landing in world space), then the legs of a full run ----------
  const gh = (x, z, y) => +G.physics.groundHeight(x, z, y + 0.02).toFixed(3);
  const J = (from, to, a, b, note) => { const la = [a[0], gh(a[0], a[2], a[1]), a[2]], lb = [b[0], gh(b[0], b[2], b[1]), b[2]]; return { from, to, launch: la, land: lb, rise: +(lb[1] - la[1]).toFixed(2), gap: +(Math.hypot(b[0] - a[0], b[2] - a[2])).toFixed(2), note }; };
  const mid = b => [(b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2];
  const sT = mid(stackTop), lT = mid(loadTop), s2 = mid(stack2Top), a1 = mid(ac1), a2 = mid(ac2), aw = mid(awnW);
  const jumps = [
    J('street', 'crate stack', [sT[0], 0, sT[2] + 0.62], sT, 'from the street side'),
    J('crate stack', 'load on the tricycle', [sT[0] + 0.04, sT[1], sT[2] - 0.1], [lT[0], lT[1], lT[2] + 0.06]),
    J('load on the tricycle', 'awning A', [loadTop.max.x - 0.08, lT[1], lT[2]], [awnA.min.x + 0.3, awnTop, lT[2]]),
    J('awning A', 'AC cover 1', [ac1.min.x - 0.2, awnTop, ac1.max.z + 0.12], [a1[0] - 0.15, a1[1], a1[2] + 0.05], 'the cage is solid, the cover is the step'),
    J('AC cover 1', 'scaffold', [a1[0] + 0.1, a1[1], -FACE + 0.3], [a1[0] + 0.1, DECK, -FACE + 0.3], 'straight up through the planks (one-way)'),
    J('scaffold', 'balcony', [BX0 - 0.22, DECK, -FACE + 0.2], [BX0 + 0.62, LED, -FACE + 0.2], 'over the balustrade (0.92 m)'),
    J('balcony', 'crate stack 2', [stack2Top.min.x - 0.42, LED, s2[2]], s2),
    J('crate stack 2', 'AC cover 2', [stack2Top.max.x - 0.06, s2[1], s2[2]], [ac2.min.x + 0.3, a2[1], a2[2] + 0.02], 'over the balustrade'),
    J('AC cover 2', 'window awning', [ac2.max.x - 0.14, a2[1], -FACE + 0.3], [awnW.min.x + 0.32, aw[1], -FACE + 0.3], 'up through the cloth'),
    J('window awning', 'cornice (7.8)', [aw[0], aw[1], -FACE + 0.2], [aw[0], ROOF, -FACE + 0.2], 'straight up through the one-way ledge'),
  ];
  const F = i => fish[i].pos, jl = k => ({ walk: jumps[k].launch }), jj = k => ({ jump: jumps[k] });
  const legs = [
    { walk: [-13.4, 0.12, 4.55] }, { walk: [F(0).x, 0.12, 4.9] }, { walk: [F(0).x, 0.12, F(0).z - 0.05], note: 'under fish 1' }, { grab: 0 },
    { walk: [F(0).x, 0.12, 4.6] }, { walk: [-4.3, 0.12, 4.5] }, { walk: [-4.0, 0, 2.0] }, { walk: [sT[0], 0, -0.4] },
    jl(0), jj(0), jl(1), jj(1), jl(2), jj(2), { walk: [F(1).x, awnTop, F(1).z], note: 'under fish 2' }, { grab: 1 },
    jl(3), jj(3), jl(4), jj(4), ...(pipeX !== null ? [{ walk: [pipeX - 0.7, DECK, zO - 0.2] }, { walk: [pipeX + 0.7, DECK, zO - 0.2] }] : [{ walk: [10.2, DECK, -FACE + 0.4] }]), jl(5), jj(5),
    { walk: [F(2).x, LED, F(2).z], note: 'under fish 3' }, { grab: 2 },
    jl(6), jj(6), jl(7), jj(7), jl(8), jj(8), jl(9), jj(9),
    { walk: [25.2, ROOF, -FACE + 0.3] }, { walk: [HOME.x, ROOF, -FACE + 0.33], note: 'home' },
  ];

  // ---------- title-screen camera path ----------
  const cinePos = [[-27.5, 0.42, 4.7], [-20, 0.6, 4.5], [-13.5, 0.95, 4.2], [-8, 1.5, 1.6], [-2.5, 2.2, 0.6], [3.5, 3.3, 1.1], [9.5, 4.9, 0.6], [14.5, 5.5, 0.5], [19.5, 7.4, 1.0], [23.4, 8.7, 0.3]];
  const cineLook = [[-19, 0.9, 4.9], [-12, 1.0, 5.4], [-8, 1.2, 4.6], [0.5, 1.2, -2.2], [4.2, 2.6, -2.6], [9, 4.0, -3.0], [15.5, 4.8, -2.9], [19, 6.0, -2.9], [25, 8.1, -3.2], [27, 8.7, -3.3]];
  const cinematicPath = cinePos.map((p, i) => ({ pos: p, look: cineLook[i] }));
  const sampleCinematic = (u, pos, look) => { crom(cinePos, u, pos); crom(cineLook, u, look); };

  // ---------- per frame ----------
  let t = 0, fxDone = false, sortT = 0; const focus = new T.Vector3(), fwd = new T.Vector3(); let chosen = [];
  const lazyFx = () => {       // fx and audio boot after the level: steam over the pots, water from the down-pipes, the street's sounds
    fxDone = true; const fx = G.fx, au = G.audio;
    if (fx && !fx.stub && fx.emitter) { try { for (const p of steamAt) fx.emitter('steam', p, {}); for (const p of drips) fx.emitter('drip', p, {}); } catch (e) { console.warn('[level] fx emitters: ' + e.message); } }
    if (au && !au.stub && au.loop) { try {
      for (const p of buzz) au.loop('neon_buzz', { pos: p }); for (const p of steamAt) au.loop('congee_pot', { pos: p }); for (const p of drips) au.loop('gutter_pour', { pos: p });
      for (const a of awnings) au.loop('rain_awning', { pos: a });
      const clock = shopAt['同福钟表']; if (clock) au.loop('clock_tick', { pos: clock.pos });
      let radios = 0; for (const n in shopAt) if (shopAt[n].type === 'shutter' && radios < 2 && n !== '同福钟表') { radios++; au.loop('radio_far', { pos: shopAt[n].pos }); }
    } catch (e) { console.warn('[level] audio loops: ' + e.message); } }
  };
  const api = {
    root, playerStart: { pos: new T.Vector3(-26, 0.12, 4.7), yaw: -Math.PI / 2 }, fish, home: { pos: HOME.clone(), radius: 1.15 }, lights: lamps,
    cinematicPath, sampleCinematic, cinematicSeconds: 46, hints: HINTS, stats, route: { jumps, legs }, buildings, colliders,
    reset() { for (const f of fish) { f.taken = false; f.object.visible = f.glow.visible = f.string.visible = true; } },
    update(dt) {
      t += dt; if (!fxDone && G.time.frame > 2) lazyFx();
      for (const f of fish) {
        const vis = !f.taken; f.object.visible = vis; f.glow.visible = vis; f.lamp.intensity = vis ? 8 : 0; if (!vis) continue;
        f.object.rotation.y = t * 0.9 + f.phase; f.object.rotation.z = Math.sin(t * 1.3 + f.phase) * 0.07; f.glow.scale.setScalar(1.3 + 0.16 * Math.sin(t * 2.2 + f.phase)); f.glow.material.opacity = 0.7 + 0.2 * Math.sin(t * 2.2 + f.phase + 1);
      }
      if (!slots.length) return;
      // the lamps nearest a point a little ahead of the camera get the real lights; swaps fade through zero
      const cam = G.camera; cam.getWorldDirection(fwd); focus.copy(cam.position).addScaledVector(fwd, 2.5);
      sortT -= dt;
      if (sortT <= 0) { sortT = 0.2; for (const l of lamps) l.d = l.intensity > 0 ? focus.distanceTo(l.pos) / l.priority : 1e9; chosen = lamps.slice().sort((a, b) => a.d - b.d).slice(0, slots.length); }
      for (const s of slots) {
        const keep = s.lamp && chosen.includes(s.lamp); s.k = clamp(s.k + (keep ? dt * 3.5 : -dt * 5), 0, 1);
        if (!keep && s.k <= 0) s.lamp = chosen.find(l => !slots.some(o => o.lamp === l)) || null;
        if (s.lamp) { s.l.position.copy(s.lamp.pos); s.l.color.copy(s.lamp.color); s.l.distance = s.lamp.distance; s.l.intensity = s.lamp.intensity * s.k * s.k * LSCALE; } else s.l.intensity = 0;
      }
    },
  };
  return api;
}

// ?show=level : the street without the cat, the camera flying the title path (lv_u=0..1 holds it at one point; cam= pins it)
export async function showcase(G) {
  const pos = new THREE.Vector3(), look = new THREE.Vector3(); let u = +(G.params.lv_u || 0);
  const still = G.params.lv_u !== undefined;
  return { update(dt) { if (!G.level || !G.level.sampleCinematic) return; if (!still) u = (u + dt / (G.level.cinematicSeconds || 40)) % 1; G.level.sampleCinematic(u, pos, look); G.camera.position.copy(pos); G.camera.lookAt(look); } };
}
