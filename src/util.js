// util.js — shared helpers (shell). Anyone may ADD functions at the end of this file; do not change existing ones.
import * as THREE from 'three';

// seeded random: r(), r.range(a,b), r.int(a,b), r.pick(arr), r.sign(), r.fork()
export function makeRng(seed = 2611) {
  let s = seed >>> 0;
  const r = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  r.fork = () => makeRng(Math.floor(r() * 4294967296));
  return r;
}
export const hashStr = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export function makeEvents() {
  const m = new Map();
  return {
    on(name, fn) { if (!m.has(name)) m.set(name, []); m.get(name).push(fn); return () => this.off(name, fn); },
    off(name, fn) { const a = m.get(name); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    emit(name, data) { const a = m.get(name); if (a) for (const fn of a.slice()) { try { fn(data); } catch (e) { console.error(`[events] handler for "${name}" threw: ` + (e && e.stack || e)); } } },
  };
}

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const sat = x => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const damp = (cur, target, rate, dt) => target + (cur - target) * Math.exp(-rate * dt);   // frame-rate independent ease

// quality tiers: scale = internal resolution factor, refl = planar reflection scale (0 = off), rain = density 0..1
export const QUALITY = {
  low:    { name: 'low',    scale: 0.7,  msaa: 0, tex: 512,  refl: 0,    bloom: true, rain: 0.5, fxaa: false },
  medium: { name: 'medium', scale: 0.85, msaa: 0, tex: 1024, refl: 0.5,  bloom: true, rain: 0.8, fxaa: true },
  high:   { name: 'high',   scale: 1,    msaa: 4, tex: 1024, refl: 0.5,  bloom: true, rain: 1,   fxaa: true },
  ultra:  { name: 'ultra',  scale: 1,    msaa: 4, tex: 2048, refl: 1,    bloom: true, rain: 1,   fxaa: true },
};
export function pickQuality(name) {
  if (name && QUALITY[name]) return { ...QUALITY[name] };
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
  return { ...(mobile ? QUALITY.low : QUALITY.high) };
}

// ---- geometry helpers: UVs in metres so procedural textures tile at world scale ----
// a box with world-scale UVs; anchor 'center' or 'bottom' (origin on the bottom face)
export function boxUV(w, h, d, anchor = 'center') {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ax > 0.5) uv.setXY(i, z, y); else if (ay > 0.5) uv.setXY(i, x, z); else uv.setXY(i, x, y);
  }
  if (anchor === 'bottom') g.translate(0, h / 2, 0);
  return g;
}
// move / rotate / scale a geometry in place: xf(geo, {p:[x,y,z], r:[rx,ry,rz], s: 1 | [sx,sy,sz]})
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function xf(geo, { p = [0, 0, 0], r = [0, 0, 0], s = 1 } = {}) {
  _e.set(r[0], r[1], r[2]); _q.setFromEuler(_e); _p.set(p[0], p[1], p[2]);
  if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  geo.applyMatrix4(_m.compose(_p, _q, _s)); return geo;
}
// paint a geometry with one vertex colour [r,g,b] (0..1) or a function (x,y,z) -> [r,g,b]
export function tint(geo, c) {
  const p = geo.attributes.position, a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const v = typeof c === 'function' ? c(p.getX(i), p.getY(i), p.getZ(i)) : c; a[i * 3] = v[0]; a[i * 3 + 1] = v[1]; a[i * 3 + 2] = v[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo;
}
// merge geometries into one (non-indexed): keeps position, normal, uv and, if any has it, color
export function mergeGeos(list) {
  const gs = list.filter(Boolean).map(g => (g.index ? g.toNonIndexed() : g));
  if (!gs.length) return new THREE.BufferGeometry();
  const hasC = gs.some(g => g.attributes.color); let n = 0; for (const g of gs) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), C = hasC ? new Float32Array(n * 3).fill(1) : null;
  let o = 0;
  for (const g of gs) {
    const c = g.attributes.position.count; if (!g.attributes.normal) g.computeVertexNormals();
    P.set(g.attributes.position.array.subarray(0, c * 3), o * 3); N.set(g.attributes.normal.array.subarray(0, c * 3), o * 3);
    if (g.attributes.uv) U.set(g.attributes.uv.array.subarray(0, c * 2), o * 2);
    if (C && g.attributes.color) C.set(g.attributes.color.array.subarray(0, c * 3), o * 3);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  if (C) out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return out;
}
// a small builder: add(geometry, material) many times, then finish() -> Group with one mesh per material
export class Batch {
  constructor() { this.by = new Map(); }
  add(geo, mat) { if (!this.by.has(mat)) this.by.set(mat, []); this.by.get(mat).push(geo); return this; }
  finish({ cast = false, receive = true, name = '' } = {}) {
    const g = new THREE.Group(); g.name = name;
    for (const [mat, geos] of this.by) { const m = new THREE.Mesh(mergeGeos(geos), mat); m.castShadow = cast; m.receiveShadow = receive; g.add(m); }
    return g;
  }
}
// collider helper: { min: Vector3, max: Vector3, surface }
export const box3 = (x0, y0, z0, x1, y1, z1, surface = 'stone') => ({ min: new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)), max: new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)), surface });

// ---- add new shared helpers below this line ----
