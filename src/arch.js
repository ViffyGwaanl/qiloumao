// arch.js — ARCH agent: parametric Xiguan arcade buildings (骑楼), and the private modelling kit that props.js shares.
// Building space (CONTRACT): x 0..bays*4, column line z = 0, shopfront z = 2.8, back z = 8.6, ground y = 0, arcade floor
// y = 0.12, arcade ceiling 4.1, first floor line 4.2, storeys 3.6. The street is on the -Z side.
import * as THREE from 'three';
import { boxUV, tint, mergeGeos, box3, makeRng, hashStr, sat } from './util.js';

const V3 = THREE.Vector3, TAU = Math.PI * 2, PI = Math.PI, _q = new THREE.Quaternion(), _up = new V3(0, 1, 0);

// =====================================================================================================================
// modelling kit (private to arch.js / props.js)
// =====================================================================================================================
// box between two corners / box with its bottom centre at x,y,z
export const span = (x0, y0, z0, x1, y1, z1) => boxUV(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
export const bb = (w, h, d, x = 0, y = 0, z = 0) => boxUV(w, h, d, 'bottom').translate(x, y, z);
// cylinder / cone standing on y = 0, UVs in metres
export function cyl(rt, rb, h, seg = 10, open = false) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), uv = g.attributes.uv, nS = (seg + 1) * 2, R = Math.max(rt, rb);
  for (let i = 0; i < uv.count; i++) { if (i < nS) uv.setXY(i, uv.getX(i) * TAU * R, uv.getY(i) * h); else uv.setXY(i, (uv.getX(i) - 0.5) * 2 * R, (uv.getY(i) - 0.5) * 2 * R); }
  return g.translate(0, h / 2, 0);
}
export function sph(r, ws = 10, hs = 7) { const g = new THREE.SphereGeometry(r, ws, hs), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TAU * r, uv.getY(i) * PI * r); return g; }
export function torus(R, r, seg = 6, tseg = 16, arc = TAU) { const g = new THREE.TorusGeometry(R, r, seg, tseg, arc), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * arc * R, uv.getY(i) * TAU * r); return g; }
// lathe: profile [[r, y], ...] going UP gives outward faces, going DOWN gives inward faces (the inside of a pot)
export function lathe(pts, seg = 10, arc = TAU) {
  const P = pts.map(p => new THREE.Vector2(Math.max(p[0], 1e-4), p[1])), g = new THREE.LatheGeometry(P, seg, 0, arc), uv = g.attributes.uv;
  let L = 0, R = 0; for (let i = 1; i < P.length; i++) L += P[i].distanceTo(P[i - 1]); for (const p of P) R = Math.max(R, p.x);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * arc * R, uv.getY(i) * L);
  return g;
}
// round bar from a to b (radius r at a, r2 at b)
export function rod(a, b, r = 0.01, seg = 6, r2 = r, caps = false) {
  const d = new V3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length() || 1e-6, g = cyl(r2, r, L, seg, !caps);
  g.applyQuaternion(_q.setFromUnitVectors(_up, d.multiplyScalar(1 / L))); return g.translate(a[0], a[1], a[2]);
}
// rectangular bar from a to b: w = horizontal thickness, h = vertical thickness (for a vertical bar: w along z, h along x)
export function beam(a, b, w, h) {
  const d = new V3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length() || 1e-6, y = d.multiplyScalar(1 / L);
  const x = (Math.abs(y.y) > 0.99 ? new V3(1, 0, 0) : new V3(0, 1, 0)).cross(y).normalize(), z = x.clone().cross(y);
  const g = boxUV(w, L, h, 'bottom'); g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z)); return g.translate(a[0], a[1], a[2]);
}
// smooth tube through points
export function tube(pts, r, seg = 6, steps = 0, closed = false) {
  const c = new THREE.CatmullRomCurve3(pts.map(p => new V3(p[0], p[1], p[2])), closed, 'centripetal');
  const g = new THREE.TubeGeometry(c, steps || Math.max(4, pts.length * 3), r, seg, closed), uv = g.attributes.uv, L = c.getLength();
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L, uv.getY(i) * TAU * r);
  return g;
}
const shapeOf = (pts, holes) => { const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))); if (holes) for (const h of holes) s.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1])))); return s; };
// polygon [[x,y],...] extruded along +Z from 0 to depth
export const extr = (pts, depth, holes) => new THREE.ExtrudeGeometry(shapeOf(pts, holes), { depth, bevelEnabled: false, curveSegments: 6 });
// closed profile [[z,y],...] swept along X from x0 to x1 (cornices, ledges, sills, kerbs)
export function profX(pts, x0, x1) { const g = extr(pts, x1 - x0); g.rotateY(-PI / 2); return g.translate(x1, 0, 0); }
// flat polygon [[x,y],...] at depth z facing -Z (the street); UVs in metres from (u0, v0)
export function faceZ(pts, z, holes, u0 = 0, v0 = 0) {
  const g = new THREE.ShapeGeometry(shapeOf(pts.map(p => [-p[0], p[1]]), holes && holes.map(h => h.map(p => [-p[0], p[1]]))), 6); g.rotateY(PI); g.translate(0, 0, z);
  const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) - u0, p.getY(i) - v0); return g;
}
// one quad, corners counter-clockwise seen from the front; UVs in metres
export function quad(a, b, c, d) {
  const g = new THREE.BufferGeometry(), e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const l = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map(v => v / l);
  const w = Math.hypot(e1[0], e1[1], e1[2]), h = Math.hypot(e2[0], e2[1], e2[2]);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c, ...a, ...c, ...d]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([...n, ...n, ...n, ...n, ...n, ...n]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, w, 0, w, h, 0, 0, w, h, 0, h]), 2));
  return g;
}
export const quadZ = (x0, y0, x1, y1, z) => quad([x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z]);   // faces -Z
export const quadUp = (x0, z0, x1, z1, y) => quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);   // faces +Y
// open ribbon: profile [[z,y],...] swept along X. Going up the profile the faces look toward -Z (flip = toward +Z)
export function stripX(prof, x0, x1, flip = false) {
  const n = prof.length - 1, P = new Float32Array(n * 18), N = new Float32Array(n * 18), U = new Float32Array(n * 12); let v = 0;
  for (let i = 0; i < n; i++) {
    const z0 = prof[i][0], y0 = prof[i][1], z1 = prof[i + 1][0], y1 = prof[i + 1][1], dy = y1 - y0, dz = z1 - z0, L = Math.hypot(dy, dz) || 1e-6;
    let ny = dz / L, nz = -dy / L; const xa = flip ? x0 : x1, xb = flip ? x1 : x0; if (flip) { ny = -ny; nz = -nz; }
    P.set([xa, y0, z0, xb, y0, z0, xb, y1, z1, xa, y0, z0, xb, y1, z1, xa, y1, z1], i * 18);
    for (let j = 0; j < 6; j++) { N[i * 18 + j * 3 + 1] = ny; N[i * 18 + j * 3 + 2] = nz; }
    U.set([xa, v, xb, v, xb, v + L, xa, v, xb, v + L, xa, v + L], i * 12); v += L;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); return g;
}
// the inside faces of an opening: outline [[x,y],...] counter-clockwise, from depth z0 back to z1
export function ribbonZ(pts, z0, z1) {
  const gs = []; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; gs.push(quad([q[0], q[1], z0], [p[0], p[1], z0], [p[0], p[1], z1], [q[0], q[1], z1])); }
  return mergeGeos(gs);
}
// both faces of a thin surface (leaves, cloth, lamp shades)
export function twoSided(geo) {
  const a = geo.index ? geo.toNonIndexed() : geo, b = a.clone();
  for (const name of Object.keys(b.attributes)) { const at = b.attributes[name], s = at.itemSize, arr = at.array; for (let i = 0; i < at.count; i += 3) for (let j = 0; j < s; j++) { const t = arr[(i + 1) * s + j]; arr[(i + 1) * s + j] = arr[(i + 2) * s + j]; arr[(i + 2) * s + j] = t; } }
  const n = b.attributes.normal.array; for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return mergeGeos([a, b]);
}
// cheap lattice value noise 0..1
const h3 = (x, y, z) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z); let fx = x - xi, fy = y - yi, fz = z - zi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h3(xi, yi, zi), h3(xi + 1, yi, zi), fx), l(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), fx), fy), l(l(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), fx), l(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), fx), fy), fz);
}
// vertex-colour dirt: mottling, darker undersides, a brownish band in the bottom 22 cm (only shows on materials with vertexColors)
function grimePass(geo, seed, amt, y0 = 0) {
  const p = geo.attributes.position, n = geo.attributes.normal; let c = geo.attributes.color;
  if (!c) { c = new THREE.BufferAttribute(new Float32Array(p.count * 3).fill(1), 3); geo.setAttribute('color', c); }
  const a = c.array, o = (seed % 97) * 0.37;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), big = vnoise(x * 1.7 + o, y * 1.7, z * 1.7 + 5.3), fine = vnoise(x * 9 + 2.1, y * 9 + o, z * 9);
    const g = sat(1 - (y - y0) / 0.22); let k = (0.84 + 0.16 * big) * (0.93 + 0.07 * fine) * (0.8 + 0.2 * sat(n.getY(i) * 0.6 + 0.62)) * (1 - 0.36 * g * g * (0.55 + 0.45 * fine));
    k = 1 - (1 - k) * amt; a[i * 3] *= k; a[i * 3 + 1] *= k * (1 - 0.04 * g * amt); a[i * 3 + 2] *= k * (1 - 0.1 * g * amt);
  }
}
// fake a lit interior: per-vertex Lambert from one warm lamp, written into vertex colours for the unlit 'glow' material
export function bake(geo, alb, L, amb = 0.3) {
  const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position, n = g.attributes.normal, a = new Float32Array(p.count * 3), kf = L.k == null ? 0.35 : L.k;
  for (let i = 0; i < p.count; i++) {
    const dx = L.p[0] - p.getX(i), dy = L.p[1] - p.getY(i), dz = L.p[2] - p.getZ(i), d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2) || 1e-6;
    const nl = Math.max(0, (n.getX(i) * dx + n.getY(i) * dy + n.getZ(i) * dz) / d) * 0.8 + 0.2, e = amb + nl / (1 + kf * d2);
    a[i * 3] = alb[0] * L.c[0] * e; a[i * 3 + 1] = alb[1] * L.c[1] * e; a[i * 3 + 2] = alb[2] * L.c[2] * e;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}
// the one private material: unlit, vertex-coloured (HDR values allowed). Lamp bulbs, flames and the baked shop interiors.
let _glow = null;
export function glowMat() { if (!_glow) { _glow = new THREE.MeshBasicMaterial({ vertexColors: true }); _glow.name = 'arch_glow'; } return _glow; }

// collects geometry per material name and merges to one mesh per material
export class Kit {
  constructor(G, seed = 1, opts = {}) { this.G = G; this.seed = seed >>> 0; this.rng = makeRng((this.seed * 7919 + 13) >>> 0); this.by = new Map(); this.colliders = []; this.interior = !!opts.interior; }
  add(geo, mat, col) { if (!geo) return this; if (col) tint(geo, col); let a = this.by.get(mat); if (!a) this.by.set(mat, a = []); a.push(geo); return this; }
  glow(geo, col = [1, 1, 1]) { return this.add(geo, '#glow', col); }
  lit(geo, alb, L, amb) { return this.add(bake(geo, alb, L, amb), '#glow'); }
  col(x0, y0, z0, x1, y1, z1, surface = 'stone', oneWay = false) { const b = box3(x0, y0, z0, x1, y1, z1, surface); if (oneWay) b.oneWay = true; this.colliders.push(b); return b; }
  finish(name, { grime = 0.7, y0 = 0 } = {}) {
    const g = new THREE.Group(); g.name = name; let tris = 0;
    for (const [mat, geos] of this.by) {
      const geo = mergeGeos(geos), isGlow = mat === '#glow', io = this.interior ? { interior: true } : undefined; let material = isGlow ? glowMat() : (typeof mat === 'string' ? this.G.mats.get(mat, io) : mat);
      if (!isGlow && typeof mat === 'string' && grime > 0 && !(material.defines && material.defines.QL_EMIS)) material = this.G.mats.get(mat, { ...(io || {}), vc: true });      // the vertex-coloured twin, so the dirt below shows (a stub mats just returns the same material)
      if (!isGlow && grime > 0 && material.vertexColors) grimePass(geo, this.seed, grime, y0);
      if (material.vertexColors && !geo.attributes.color) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
      const m = new THREE.Mesh(geo, material);
      m.name = name + ':' + (typeof mat === 'string' ? mat : 'mat'); m.castShadow = false; m.receiveShadow = !isGlow; tris += geo.attributes.position.count / 3; g.add(m);
    }
    g.userData.tris = tris; g.userData.meshes = g.children.length; g.userData.colliders = this.colliders; return g;
  }
}

// ---- small fittings shared with props.js ----
// outdoor air-conditioner unit 0.8 x 0.55 x 0.3 on two brackets: (x, y) = bottom centre, z = the wall plane behind it
export function acUnit(k, x, y, z, M = {}) {
  const body = M.body || 'ceramic_white', metal = M.metal || 'steel', dark = M.dark || 'rubber', rust = M.rust || 'metal_rust';
  k.add(span(x - 0.4, y, z - 0.33, x + 0.4, y + 0.55, z - 0.03), body);
  k.add(span(x - 0.41, y + 0.55, z - 0.34, x + 0.41, y + 0.57, z - 0.02), metal);
  k.add(cyl(0.215, 0.215, 0.012, 16).rotateX(-PI / 2).translate(x - 0.12, y + 0.28, z - 0.33), dark);
  k.add(torus(0.215, 0.012, 5, 18).translate(x - 0.12, y + 0.28, z - 0.345), metal);
  for (let i = 0; i < 4; i++) { const a = i * PI / 4; k.add(rod([x - 0.12 - Math.cos(a) * 0.21, y + 0.28 - Math.sin(a) * 0.21, z - 0.35], [x - 0.12 + Math.cos(a) * 0.21, y + 0.28 + Math.sin(a) * 0.21, z - 0.35], 0.004, 4), metal); }
  k.add(cyl(0.045, 0.045, 0.02, 8).rotateX(-PI / 2).translate(x - 0.12, y + 0.28, z - 0.345), metal);
  for (let i = 0; i < 7; i++) k.add(span(x + 0.16, y + 0.1 + i * 0.055, z - 0.336, x + 0.36, y + 0.125 + i * 0.055, z - 0.33), metal);
  for (const s of [-0.28, 0.28]) { k.add(span(x + s - 0.02, y - 0.035, z - 0.36, x + s + 0.02, y, z), rust); k.add(beam([x + s, y - 0.035, z - 0.34], [x + s, y - 0.32, z - 0.01], 0.03, 0.03), rust); k.add(span(x + s - 0.02, y - 0.34, z - 0.03, x + s + 0.02, y, z), rust); }
  k.add(tube([[x + 0.4, y + 0.2, z - 0.1], [x + 0.46, y + 0.16, z - 0.06], [x + 0.47, y - 0.1, z - 0.03], [x + 0.46, y - 0.5, z - 0.02]], 0.014, 5, 10), dark);
}
// cast-iron downpipe on a wall: (x, z) pipe axis, from y0 up to y1, with collars, a hopper head and a kicked-out shoe
export function downpipe(k, x, z, y0, y1, mat = 'metal_rust', wallZ = z + 0.09, hopper = true, shoe = true) {
  const R = 0.052; k.add(rod([x, y0 + (shoe ? 0.1 : 0), z], [x, y1 - (hopper ? 0.2 : 0), z], R, 8), mat);
  for (let y = y0 + 0.5; y < y1 - 0.3; y += 1.45) { k.add(cyl(R + 0.012, R + 0.012, 0.05, 8).translate(x, y, z), mat); if (wallZ != null) k.add(span(x - 0.1, y + 0.005, z, x + 0.1, y + 0.045, wallZ), mat); }
  if (hopper) { k.add(cyl(0.15, 0.06, 0.2, 4).rotateY(PI / 4).translate(x, y1 - 0.2, z), mat); k.add(span(x - 0.115, y1 - 0.02, z - 0.115, x + 0.115, y1 + 0.02, z + 0.115), mat); }
  if (shoe) { const dx = shoe === 'x' ? 0.14 : 0, dz = shoe === 'x' ? 0 : -0.14; k.add(rod([x, y0 + 0.12, z], [x + dx, y0, z + dz], R, 8, R, true), mat); k.add(sph(R * 1.02, 8, 6).translate(x, y0 + 0.11, z), mat); }
}

// =====================================================================================================================
// the building
// =====================================================================================================================
const BAY = 4, ZF = -0.25, ZS = 2.8, ZB = 8.6, FL = 0.12, CEIL = 4.1, ARC = 4.2, ST = 3.6;
const TRIM = { plaster_teal: 'plaster_cream', plaster_pink: 'plaster_cream', plaster_cream: 'plaster_teal', brick_grey: 'plaster_cream', plaster_stained: 'concrete' };
const STYLE = {
  nanyang: { wall: ['plaster_teal', 'plaster_pink', 'plaster_teal', 'plaster_cream'], wood: 'wood_red', iron: 'metal_green', arch: 1.0, spring: 2.85, glass: ['glass_manchu_a', 'glass_manchu_c'], rail: 'baluster', lampC: [3.2, 2.5, 1.5] },
  baroque: { wall: ['plaster_pink', 'plaster_cream', 'plaster_pink', 'plaster_teal'], wood: 'wood_dark', iron: 'metal_rust', arch: 1.45, spring: 2.4, glass: ['glass_manchu_b', 'glass_manchu_d'], rail: 'baluster', lampC: [3.2, 2.5, 1.5] },
  modern: { wall: ['plaster_cream', 'plaster_teal', 'plaster_pink'], wood: 'metal_green', iron: 'metal_green', lintel: 3.55, glass: ['glass_manchu_d', 'glass_manchu_c'], rail: 'pipe', lampC: [3.0, 3.4, 3.6] },
  plain: { wall: ['brick_grey', 'plaster_stained'], wood: 'wood_dark', iron: 'metal_rust', lintel: 3.5, glass: ['glass_manchu_a', 'glass_manchu_b'], rail: 'bars', lampC: [4.5, 3.2, 1.7] },
};
const GOODS = [[0.86, 0.16, 0.14], [0.96, 0.74, 0.18], [0.18, 0.6, 0.36], [0.2, 0.42, 0.82], [0.92, 0.86, 0.7], [0.96, 0.5, 0.14], [0.16, 0.62, 0.62], [0.78, 0.3, 0.55]];
const BAL = [[0.03, 0], [0.046, 0.02], [0.046, 0.06], [0.03, 0.09], [0.056, 0.22], [0.06, 0.3], [0.04, 0.48], [0.028, 0.58], [0.042, 0.62], [0.042, 0.7]];
const arcPts = (cx, cy, rx, ry, t0, t1, n) => { const a = []; for (let i = 0; i <= n; i++) { const t = t0 + (t1 - t0) * i / n; a.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); } return a; };

// masonry balustrade from a=[x,z] to b=[x,z] standing on y
function balustrade(k, a, b, y, mat, hgt = 0.95, seg = 6) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), n = Math.max(1, Math.round(L / 0.17)), s = (hgt - 0.18) / 0.7;
  k.add(beam([a[0], y + 0.04, a[1]], [b[0], y + 0.04, b[1]], 0.13, 0.08), mat); k.add(beam([a[0], y + hgt - 0.05, a[1]], [b[0], y + hgt - 0.05, b[1]], 0.17, 0.1), mat);
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; k.add(lathe(BAL, seg).scale(1, s, 1).translate(a[0] + dx * t, y + 0.08, a[1] + dz * t), mat); }
}
// iron railing: flat top and bottom bars, square uprights, a ring in every third gap
function ironRail(k, a, b, y, mat, hgt = 0.95) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), n = Math.max(2, Math.round(L / 0.12));
  k.add(beam([a[0], y + hgt, a[1]], [b[0], y + hgt, b[1]], 0.045, 0.016), mat); k.add(beam([a[0], y + hgt - 0.14, a[1]], [b[0], y + hgt - 0.14, b[1]], 0.02, 0.012), mat); k.add(beam([a[0], y + 0.08, a[1]], [b[0], y + 0.08, b[1]], 0.03, 0.014), mat);
  for (let i = 0; i <= n; i++) { const t = i / n, x = a[0] + dx * t, z = a[1] + dz * t; k.add(bb(0.013, hgt - 0.02, 0.013, x, y + 0.02, z), mat); if (i < n && i % 3 === 1) { const g = torus(0.05, 0.006, 4, 10); if (Math.abs(dz) > Math.abs(dx)) g.rotateY(PI / 2); k.add(g.translate(x + dx / n * 0.5, y + hgt - 0.07, z + dz / n * 0.5), mat); } }
}
// streamline rail: a low solid upstand with two pipes on short posts
function pipeRail(k, a, b, y, wallMat, mat, cap, hgt = 0.95) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), n = Math.max(1, Math.round(L / 0.8));
  k.add(beam([a[0], y + 0.24, a[1]], [b[0], y + 0.24, b[1]], 0.1, 0.48), wallMat); k.add(beam([a[0], y + 0.5, a[1]], [b[0], y + 0.5, b[1]], 0.14, 0.04), cap);
  for (const h of [0.72, hgt]) k.add(rod([a[0], y + h, a[1]], [b[0], y + h, b[1]], 0.02, 6), mat);
  for (let i = 0; i <= n; i++) { const t = i / n; k.add(rod([a[0] + dx * t, y + 0.5, a[1] + dz * t], [a[0] + dx * t, y + hgt, a[1] + dz * t], 0.014, 5), mat); }
}

function makeBuilding(G, o) {
  const bays = Math.max(1, Math.min(12, (o.bays | 0) || 3)), floors = Math.max(1, Math.min(5, (o.floors | 0) || 3));
  const style = STYLE[o.style] ? o.style : 'plain', S = STYLE[style], side = o.side === -1 ? -1 : 1, C = o.colors || {};
  const seed = (hashStr(style) + Math.imul((o.seed | 0) + 1, 2654435761) + (side < 0 ? 977 : 0)) >>> 0;
  const k = new Kit(G, seed), r = k.rng, W = bays * BAY, H = ARC + floors * ST, isArch = !!S.arch;
  const wall = C.wall || S.wall[Math.floor(r() * S.wall.length)], trim = C.trim || TRIM[wall] || 'plaster_cream', wood = C.wood || S.wood, iron = C.iron || S.iron;
  const glassSet = C.glass || S.glass, tileOf = n => (G.mats.tileOf && G.mats.tileOf(n)) || 1;
  const shops = []; for (let b = 0; b < bays; b++) shops.push((o.shop && o.shop[b]) || r.pick(['shutter', 'open', 'tanglong', 'glass', 'shutter', 'open']));
  const A = { signs: [], lamps: [], balconies: [], windows: [], shopDoors: [], spouts: [], ledges: [], sconces: [] };
  const colX = i => (i === 0 ? [0, 0.3] : i === bays ? [W - 0.3, W] : [i * BAY - 0.25, i * BAY + 0.25]);
  // a glowing pane with the lattice texture fitted to a whole number of repeats
  const fitUV = (g, w, h, mat) => { const t = tileOf(mat), su = Math.max(1, Math.round(w / t)) * t / w, sv = Math.max(1, Math.round(h / t)) * t / h, uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; };
  const pane = (x0, y0, x1, y1, z, mat) => k.add(fitUV(quadZ(x0, y0, x1, y1, z), x1 - x0, y1 - y0, mat), mat);

  // ---------------- arcade: piers, arches or lintels, ceiling, lamps ----------------
  const capY = isArch ? S.spring : S.lintel;
  for (let i = 0; i <= bays; i++) {
    const [x0, x1] = colX(i), pl = i === 0 ? 0 : 1, pr = i === bays ? 0 : 1;
    k.add(span(x0 - 0.07 * pl, 0, -0.32, x1 + 0.07 * pr, 0.3, 0.32), 'granite_slab'); k.add(span(x0 - 0.04 * pl, 0.3, -0.29, x1 + 0.04 * pr, 0.4, 0.29), 'granite_slab');
    k.add(span(x0 - 0.02 * pl, 0.4, -0.27, x1 + 0.02 * pr, 0.46, 0.27), trim);
    k.add(span(x0, 0.46, -0.25, x1, ARC, 0.25), wall);
    for (const [d0, d1, p] of [[-0.2, -0.14, 0.025], [-0.14, -0.05, 0.055], [-0.05, 0, 0.085]]) k.add(span(x0 - p * pl, capY + d0, -0.25 - p, x1 + p * pr, capY + d1, 0.25 + p), trim);
    if (style === 'baroque' || style === 'nanyang') { const m = (x0 + x1) / 2, hw = Math.min(0.15, (x1 - x0) / 2 - 0.05); k.add(span(m - hw, 0.62, -0.275, m + hw, capY - 0.36, -0.25), trim); k.add(span(m - hw + 0.035, 0.66, -0.283, m + hw - 0.035, capY - 0.4, -0.275), wall); }
    else { k.add(span(x0 - 0.012 * pl, 0.46, -0.262, x1 + 0.012 * pr, 1.2, 0.262), trim); k.add(span(x0 - 0.02 * pl, 1.2, -0.27, x1 + 0.02 * pr, 1.25, 0.27), trim); }
    k.col(x0 - 0.07 * pl, 0, -0.32, x1 + 0.07 * pr, CEIL, 0.32);
    if (i > 0 && i < bays) A.signs.push({ pos: [i * BAY, 2.1, -0.29], normal: [0, 0, -1], w: 0.36, h: 1.5, kind: 'vertical', mount: 'column' });
    // the building's own lights, one on the inner face of every pier (glow only; anchors.sconces lists them)
    { const m = (x0 + x1) / 2, lc = S.lampC;
      if (style === 'modern') { k.add(span(m - 0.045, 2.1, 0.25, m + 0.045, 2.9, 0.275), 'metal_shutter'); k.glow(cyl(0.022, 0.022, 0.66, 8).translate(m, 2.17, 0.3), lc); for (const y of [2.14, 2.83]) k.add(span(m - 0.03, y, 0.27, m + 0.03, y + 0.035, 0.33), 'metal_shutter'); A.sconces.push({ pos: [m, 2.5, 0.32], color: lc }); }
      else if (style === 'plain') { k.add(tube([[m, 3.0, 0.25], [m, 3.12, 0.42], [m, 3.14, 0.62], [m, 3.06, 0.7]], 0.012, 5, 10), iron); k.add(twoSided(lathe([[0.17, 0], [0.16, 0.02], [0.05, 0.09], [0.03, 0.12]], 12)).translate(m, 2.94, 0.7), iron); k.glow(sph(0.045, 8, 6).translate(m, 2.95, 0.7), lc); k.add(cyl(0.05, 0.05, 0.02, 8).rotateX(PI / 2).translate(m, 3.0, 0.25), iron); A.sconces.push({ pos: [m, 2.93, 0.7], color: lc }); }
      else { k.add(tube([[m, 2.56, 0.25], [m, 2.52, 0.4], [m, 2.6, 0.5], [m, 2.72, 0.5]], 0.013, 5, 10), 'brass'); k.add(cyl(0.06, 0.03, 0.05, 8).translate(m, 2.72, 0.5), 'brass'); k.glow(sph(0.115, 12, 8).scale(1, 0.95, 1).translate(m, 2.87, 0.5), lc); k.add(cyl(0.012, 0.035, 0.035, 6).translate(m, 2.975, 0.5), 'brass'); k.add(span(m - 0.05, 2.46, 0.25, m + 0.05, 2.66, 0.265), 'brass'); A.sconces.push({ pos: [m, 2.87, 0.5], color: lc }); } }
    // cross beam to the shopfront
    k.add(span(x0 + 0.08 * pl, 3.7, 0.25, x1 - 0.08 * pr, CEIL, ZS), 'plaster_cream');
  }
  for (let b = 0; b < bays; b++) {
    const xl = colX(b)[1], xr = colX(b + 1)[0], cx = (xl + xr) / 2, a = (xr - xl) / 2;
    if (isArch) {
      const sp = S.spring, ri = S.arch;
      k.add(extr([[xl, ARC], [xl, sp], ...arcPts(cx, sp, a, ri, PI, 0, 18).slice(1, -1), [xr, sp], [xr, ARC]], 0.5).translate(0, 0, -0.25), wall);
      k.add(extr([...arcPts(cx, sp, a + 0.13, ri + 0.13, PI, 0, 18), ...arcPts(cx, sp, a, ri, 0, PI, 18)], 0.04).translate(0, 0, -0.29), trim);
      k.add(extr([[cx - 0.09, sp + ri - 0.03], [cx + 0.09, sp + ri - 0.03], [cx + 0.14, sp + ri + 0.3], [cx - 0.14, sp + ri + 0.3]], 0.1).translate(0, 0, -0.35), trim);
      if (style === 'baroque') for (const s of [-1, 1]) k.add(cyl(0.2, 0.2, 0.03, 14).rotateX(-PI / 2).translate(cx + s * (a - 0.32), sp + ri + 0.02, -0.25), trim);
      k.col(xl, sp + ri * 0.5, -0.25, xr, CEIL, 0.25);
    } else {
      const ly = S.lintel; k.add(span(xl, ly, -0.25, xr, ARC, 0.25), wall);
      if (style === 'modern') { const R = 0.42; k.add(extr([[xl, ly + 0.01], [xl + R, ly + 0.01], ...arcPts(xl + R, ly - R, R, R, PI / 2, PI, 6).slice(1)], 0.5).translate(0, 0, -0.25), wall); k.add(extr([[xr, ly + 0.01], ...arcPts(xr - R, ly - R, R, R, 0, PI / 2, 6)], 0.5).translate(0, 0, -0.25), wall); for (let j = 0; j < 3; j++) k.add(span(xl, ly + 0.14 + j * 0.13, -0.275, xr, ly + 0.19 + j * 0.13, -0.25), trim); }
      else for (const [s, x] of [[1, xl], [-1, xr]]) { k.add(span(x, ly - 0.14, -0.25, x + s * 0.3, ly, 0.25), trim); k.add(span(x, ly - 0.28, -0.25, x + s * 0.15, ly - 0.14, 0.25), trim); }
      k.col(xl, ly, -0.25, xr, CEIL, 0.25);
    }
    for (const z of [1.05, 1.95]) k.add(span(xl - 0.1, 3.9, z - 0.07, xr + 0.1, CEIL, z + 0.07), 'plaster_cream');
    // ceiling rose for the bay's pendant lamp (the level hangs the pendant from this anchor)
    const lx = b * BAY + 2, lz = 1.5;
    k.add(cyl(0.07, 0.09, 0.03, 10).translate(lx, CEIL - 0.03, lz), 'brass'); k.add(cyl(0.018, 0.03, 0.05, 6).translate(lx, CEIL - 0.08, lz), 'brass');
    A.lamps.push({ pos: [lx, 3.95, lz], color: S.lampC });
    A.signs.push({ pos: [b * BAY + (b % 2 ? 0.95 : 3.05), 3.28, 0.85], normal: [b % 2 ? 1 : -1, 0, 0], w: 1.0, h: 0.5, kind: 'hanging' });
  }
  k.add(span(0, CEIL, -0.25, W, ARC, ZS), 'plaster_cream');
  if (o.floor) { k.add(span(0, 0, -0.2, W, FL, ZS), ['tile_flower_a', 'tile_flower_b', 'tile_check'][seed % 3]); k.add(span(0, 0, -0.34, W, FL - 0.005, -0.2), 'granite_slab'); k.col(0, 0, -0.34, W, FL, ZS, 'tile'); }

  // ---------------- shopfront wall ----------------
  for (let i = 0; i <= bays; i++) {
    const [x0, x1] = i === 0 ? [0, 0.3] : i === bays ? [W - 0.3, W] : [i * BAY - 0.3, i * BAY + 0.3], pl = i === 0 ? 0 : 1, pr = i === bays ? 0 : 1;
    k.add(span(x0, 0, 2.7, x1, 3.0, 3.05), wall); k.add(span(x0 - 0.03 * pl, 0, 2.67, x1 + 0.03 * pr, 0.42, 3.05), 'granite_slab'); k.add(span(x0 - 0.015 * pl, 0.42, 2.685, x1 + 0.015 * pr, 0.47, 3.05), trim);
    if (i > 0 && i < bays && r() < 0.6) { const m = i * BAY; k.add(span(m - 0.13, 1.42, 2.63, m + 0.13, 1.78, 2.7), 'metal_shutter'); k.add(span(m - 0.1, 1.5, 2.624, m + 0.1, 1.7, 2.63), 'glass_dark'); k.add(rod([m + 0.08, 1.78, 2.66], [m + 0.08, 3.0, 2.66], 0.012, 5), 'metal_shutter'); k.add(span(m - 0.15, 1.78, 2.61, m + 0.15, 1.8, 2.7), 'metal_shutter'); }
  }
  k.add(span(0, 3.0, 2.72, W, 3.78, 3.05), wall); k.add(span(0, 2.95, 2.68, W, 3.0, 3.05), trim);
  k.add(profX([[2.72, 3.78], [2.64, 3.84], [2.6, 3.84], [2.6, 3.9], [3.05, 3.9], [3.05, 3.78]], 0, W), trim); k.add(span(0, 3.9, 2.8, W, CEIL, 3.05), wall);
  for (let b = 0; b < bays; b++) {
    const bx = b * BAY, xo0 = bx + 0.3, xo1 = bx + 3.7, cxb = bx + 2, type = shops[b];
    A.signs.push({ pos: [cxb, 3.39, 2.715], normal: [0, 0, -1], w: 3.2, h: 0.62, kind: 'fascia' });
    k.add(span(xo0, FL, 2.76, xo1, FL + 0.02, 3.05), 'granite_slab');
    if (type === 'open') shopOpen(b, xo0, xo1); else if (type === 'tanglong') shopTanglong(b, xo0, xo1); else if (type === 'glass') shopGlass(b, xo0, xo1); else shopShutter(b, xo0, xo1);
  }

  function shopShutter(b, xo0, xo1) {
    const mat = r() < 0.3 && iron === 'metal_green' ? 'metal_green' : 'metal_shutter', gap = r() < 0.3 ? r.range(0.2, 0.42) : 0, yb = FL + 0.02 + gap, yt = 2.66;
    k.add(span(xo0, yt, 2.74, xo1, 2.95, 3.02), mat); k.add(span(xo0, yt - 0.03, 2.73, xo1, yt, 3.02), mat);
    for (const x of [xo0, xo1 - 0.07]) { k.add(span(x, FL, 2.84, x + 0.07, yt, 2.95), mat); }
    const prof = []; for (let y = yb + 0.07; y < yt - 0.02; y += 0.078) prof.push([2.886, y], [2.886, y + 0.05], [2.9, y + 0.064]);
    k.add(stripX(prof, xo0 + 0.06, xo1 - 0.06), mat);
    k.add(span(xo0 + 0.07, yb, 2.868, xo1 - 0.07, yb + 0.075, 2.925), mat);
    for (const hx of [xo0 + 0.9, xo1 - 0.9]) { k.add(rod([hx - 0.07, yb + 0.12, 2.875], [hx + 0.07, yb + 0.12, 2.875], 0.007, 5), mat); for (const s of [-0.07, 0.07]) k.add(rod([hx + s, yb + 0.12, 2.875], [hx + s, yb + 0.12, 2.89], 0.007, 5), mat); }
    const cx = (xo0 + xo1) / 2; k.add(span(cx - 0.035, yb + 0.01, 2.845, cx + 0.035, yb + 0.065, 2.868), 'brass'); k.add(torus(0.022, 0.005, 4, 8, PI).translate(cx, yb + 0.065, 2.856), mat);
    if (gap) { const L = { p: [cx, 0.7, 3.6], c: [1.6, 1.15, 0.65], k: 0.5 }; k.lit(quadUp(xo0 + 0.07, 2.93, xo1 - 0.07, 4.4, FL + 0.021), [0.8, 0.7, 0.55], L); k.lit(quadZ(xo0 + 0.07, FL, xo1 - 0.07, yb + 0.5, 4.4), [0.7, 0.62, 0.5], L); k.lit(span(cx - 0.6, FL + 0.02, 3.5, cx - 0.1, FL + 0.38, 3.95), [0.75, 0.55, 0.3], L); k.lit(span(cx + 0.3, FL + 0.02, 3.3, cx + 0.62, FL + 0.3, 3.7), [0.3, 0.45, 0.75], L); }
    k.col(xo0 - 0.3, 0, 2.8, xo1 + 0.3, CEIL, ZB); A.shopDoors.push({ pos: [cx, FL, ZS], w: xo1 - xo0, h: 2.83, type: 'shutter', gap });
  }

  function shopOpen(b, xo0, xo1) {
    const cx = (xo0 + xo1) / 2, y0 = FL + 0.02, y1 = 2.95, z0 = 3.05, z1 = 5.45, L = { p: [cx, 2.45, 3.9], c: [1.55, 1.18, 0.74], k: 0.2 }, left = r() < 0.5;
    const dado = r.pick([[0.3, 0.62, 0.52], [0.25, 0.5, 0.7], [0.75, 0.36, 0.3], [0.85, 0.7, 0.3]]), cream = [0.92, 0.86, 0.72], woodA = [0.5, 0.3, 0.17], tA = r.pick([[0.72, 0.2, 0.16], [0.16, 0.42, 0.36], [0.85, 0.62, 0.2]]), tB = [0.9, 0.86, 0.76];
    const nx = Math.round((xo1 - xo0) / 0.34), nz = 7, dx = (xo1 - xo0) / nx, dz = (z1 - 2.95) / nz;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) k.lit(quadUp(xo0 + i * dx, 2.95 + j * dz, xo0 + (i + 1) * dx, 2.95 + (j + 1) * dz, y0 + 0.001), (i + j) % 2 ? tA : tB, L, 0.34);
    for (const [xa, xb] of [[xo0 - 0.02, xo0], [xo1, xo1 + 0.02]]) { k.lit(span(xa, y0, 2.95, xb, 1.15, z1), dado, L); k.lit(span(xa, 1.15, 2.95, xb, y1, z1), cream, L); }
    k.lit(span(xo0, y0, z1, xo1, 1.15, z1 + 0.02), dado, L); k.lit(span(xo0, 1.15, z1, xo1, y1, z1 + 0.02), cream, L); k.lit(span(xo0, y1, 2.95, xo1, y1 + 0.02, z1), cream, L, 0.45);
    k.add(rod([cx, 2.52, 3.9], [cx, y1, 3.9], 0.005, 4), 'glass_dark'); k.glow(sph(0.055, 8, 6).translate(cx, 2.46, 3.9), [6, 4.2, 2.2]); k.add(twoSided(lathe([[0.19, 0], [0.06, 0.08], [0.03, 0.11]], 12)).translate(cx, 2.48, 3.9), iron);
    // shelves of goods on the back wall
    for (const x of [xo0 + 0.04, cx, xo1 - 0.04]) k.lit(span(x - 0.025, y0, z1 - 0.34, x + 0.025, 2.5, z1), woodA, L);
    for (let s = 0; s < 5; s++) {
      const ys = y0 + 0.12 + s * 0.48; k.lit(span(xo0 + 0.04, ys - 0.03, z1 - 0.34, xo1 - 0.04, ys, z1), woodA, L);
      if (s === 4) break;
      for (let x = xo0 + 0.1; x < xo1 - 0.25;) {
        const w = r.range(0.09, 0.22), h = r.range(0.14, 0.4), d = r.range(0.12, 0.24), c = r.pick(GOODS), n = r() < 0.45 ? r.int(2, 4) : 1;
        for (let q = 0; q < n && x < xo1 - 0.25; q++) { if (Math.abs(x + w / 2 - cx) > 0.03 + w / 2) k.lit(r() < 0.35 ? cyl(w / 2, w / 2, h, 7).translate(x + w / 2, ys, z1 - 0.17) : span(x, ys, z1 - 0.06 - d, x + w, ys + h, z1 - 0.06), c, L); x += w + 0.012; }
        x += r.range(0.0, 0.07);
      }
    }
    // counter along one side, with jars and a scale
    const c0 = left ? xo0 + 0.12 : xo1 - 0.72, c1 = c0 + 0.6;
    k.lit(span(c0 + 0.03, y0 + 0.08, 3.5, c1 - 0.03, 0.92, 4.95), woodA, L); k.lit(span(c0 + 0.06, y0, 3.53, c1 - 0.06, y0 + 0.08, 4.92), [0.2, 0.14, 0.1], L); k.lit(span(c0 - 0.02, 0.92, 3.46, c1 + 0.02, 0.97, 4.99), [0.62, 0.4, 0.22], L);
    for (let j = 0; j < 4; j++) k.lit(span(left ? c1 - 0.032 : c0 + 0.02, y0 + 0.16, 3.56 + j * 0.35, left ? c1 - 0.02 : c0 + 0.032, 0.86, 3.86 + j * 0.35), [0.4, 0.23, 0.13], L);
    for (let j = 0; j < 3; j++) { const jz = 3.7 + j * 0.42, c = r.pick(GOODS); k.lit(cyl(0.085, 0.085, 0.2, 9).translate(c0 + 0.3, 0.97, jz), [c[0] * 0.8 + 0.2, c[1] * 0.8 + 0.2, c[2] * 0.8 + 0.2], L); k.lit(cyl(0.07, 0.088, 0.035, 9).translate(c0 + 0.3, 1.17, jz), [0.8, 0.14, 0.12], L); }
    // sacks and a tub on the floor by the door
    const sx = left ? xo1 - 0.5 : xo0 + 0.5;
    for (let j = 0; j < 3; j++) { const px = sx + (j === 2 ? 0.02 : (j ? 0.2 : -0.2)) * (left ? -1 : 1), pz = 3.5 + (j === 2 ? 0.2 : j * 0.45), py = y0 + (j === 2 ? 0.3 : 0.0); k.lit(sph(0.26, 9, 7).scale(1, 0.62, 0.86).translate(px, py + 0.16, pz), j === 1 ? [0.9, 0.88, 0.8] : [0.74, 0.6, 0.4], L, 0.4); k.lit(cyl(0.05, 0.08, 0.08, 6).rotateZ(0.4).translate(px + 0.2, py + 0.24, pz), [0.6, 0.48, 0.32], L); }
    k.lit(lathe([[0.2, 0], [0.24, 0.3], [0.25, 0.32], [0.22, 0.32], [0.2, 0.1]], 12).translate(sx + (left ? -0.75 : 0.75), y0, 4.5), [0.25, 0.45, 0.75], L); k.lit(cyl(0.21, 0.21, 0.02, 12).translate(sx + (left ? -0.75 : 0.75), y0 + 0.24, 4.5), [0.86, 0.3, 0.2], L);
    // the shop's board shutters, stacked at the jamb
    for (let j = 0; j < 4; j++) { const g = span(-0.15, 0, -0.017, 0.15, 2.5, 0.017); g.rotateX(-0.05 - j * 0.012); g.rotateY(left ? -0.25 : 0.25); k.add(g.translate(left ? xo1 - 0.2 : xo0 + 0.2, y0, 2.98 + j * 0.05 - 0.1), 'wood_dark'); }
    k.col(xo0 - 0.3, 0, 2.8, xo0, CEIL, z1); k.col(xo1, 0, 2.8, xo1 + 0.3, CEIL, z1); k.col(xo0 - 0.3, 0, z1 - 0.36, xo1 + 0.3, CEIL, ZB); k.col(xo0, y1, 2.72, xo1, CEIL, z1); k.col(xo0, 0, 2.8, xo1, y0, z1, 'tile'); k.col(c0, 0, 3.46, c1, 0.97, 4.99, 'wood');
    A.shopDoors.push({ pos: [cx, FL, ZS], w: xo1 - xo0, h: 2.83, type: 'open', depth: z1 - ZS, lamp: L.p });
  }

  function shopTanglong(b, xo0, xo1) {
    const flip = r() < 0.5, dw = 1.3, dx0 = flip ? xo1 - 0.5 - dw : xo0 + 0.5, dx1 = dx0 + dw, dcx = dx0 + dw / 2, dyt = 2.72, wx0 = flip ? xo0 + 0.4 : dx1 + 0.55, wx1 = wx0 + 0.95, wy0 = 1.25, wy1 = 2.6, y0 = FL + 0.02;
    // brick wall around the door and the window
    const xs = [xo0, dx0, dx1, wx0, wx1, xo1].sort((a, c) => a - c);
    for (let i = 0; i < 5; i++) { const a = xs[i], c = xs[i + 1], isDoor = Math.abs(a - dx0) < 1e-6, isWin = Math.abs(a - wx0) < 1e-6; if (isDoor) k.add(span(a, dyt, 2.8, c, 2.95, 3.05), 'brick_grey'); else if (isWin) { k.add(span(a, FL, 2.8, c, wy0, 3.05), 'brick_grey'); k.add(span(a, wy1, 2.8, c, 2.95, 3.05), 'brick_grey'); } else k.add(span(a, FL, 2.8, c, 2.95, 3.05), 'brick_grey'); }
    k.add(span(xo0, FL, 2.775, dx0 - 0.16, 0.55, 2.8), 'granite_slab'); k.add(span(dx1 + 0.16, FL, 2.775, xo1, 0.55, 2.8), 'granite_slab');
    // granite door frame and threshold
    for (const x of [dx0 - 0.16, dx1]) k.add(span(x, FL, 2.75, x + 0.16, dyt + 0.2, 3.05), 'granite_slab');
    k.add(span(dx0 - 0.2, dyt, 2.74, dx1 + 0.2, dyt + 0.22, 3.05), 'granite_slab'); k.add(span(dx0, FL, 2.8, dx1, FL + 0.13, 2.96), 'granite_slab');
    k.add(profX([[2.74, dyt + 0.22], [2.5, dyt + 0.27], [2.5, dyt + 0.3], [2.8, dyt + 0.42], [2.8, dyt + 0.22]], dx0 - 0.3, dx1 + 0.3), 'wood_dark');
    for (const x of [dx0 - 0.22, dx1 + 0.16]) k.add(extr([[0, 0], [0.22, 0.2], [0.22, 0.26], [0, 0.26]], 0.06).rotateY(PI / 2).translate(x, dyt + 0.0, 2.74), 'wood_dark');
    // layer 1: the low folding half-doors (脚门), one leaf ajar
    const hy0 = y0 + 0.32, hy1 = hy0 + 1.3, lw = dw / 2 - 0.01;
    for (const s of [-1, 1]) {
      const parts = [], add = g => parts.push(g);
      add(span(0, 0, -0.02, 0.05, hy1 - hy0, 0.02)); add(span(lw - 0.05, 0, -0.02, lw, hy1 - hy0, 0.02)); add(span(0, 0, -0.02, lw, 0.07, 0.02)); add(span(0, 0.62, -0.02, lw, 0.68, 0.02)); add(span(0.04, 0.06, -0.01, lw - 0.04, 0.63, 0.01));
      add(extr([[0, 0], [lw, 0], [lw, 0.05], ...arcPts(lw / 2, 0.05, lw / 2 - 0.03, 0.1, 0, PI, 8), [0, 0.05]], 0.04).translate(0, hy1 - hy0, -0.02));
      for (let j = 0; j < 5; j++) add(rod([0.05 + (j + 0.5) * (lw - 0.1) / 5, 0.68, 0], [0.05 + (j + 0.5) * (lw - 0.1) / 5, hy1 - hy0, 0], 0.012, 5));
      add(span(0.1, 0.16, -0.016, lw - 0.1, 0.52, -0.01));
      const leaf = mergeGeos(parts); if (s > 0) leaf.scale(-1, 1, 1), flipWinding(leaf);
      leaf.rotateY(s < 0 ? (flip ? 0.12 : 0.55) : (flip ? -0.55 : -0.12)); k.add(leaf.translate(s < 0 ? dx0 : dx1, hy0, 2.79), 'wood_red');
      for (const hy of [hy0 + 0.15, hy1 - 0.2]) k.add(cyl(0.012, 0.012, 0.09, 5).translate(s < 0 ? dx0 : dx1, hy, 2.79), 'brass');
    }
    // layer 2: the sliding grille of round bars (趟栊)
    for (const x of [dx0 + 0.035, dx1 - 0.035]) k.add(span(x - 0.035, y0 + 0.13, 2.86, x + 0.035, dyt, 2.93), 'wood_red');
    k.add(span(dx0, dyt - 0.07, 2.86, dx1, dyt, 2.93), 'wood_red'); k.add(span(dx0, y0 + 0.11, 2.86, dx1, y0 + 0.18, 2.93), 'wood_red');
    for (let j = 0; j < 13; j++) k.add(rod([dx0 + 0.05, y0 + 0.3 + j * 0.178, 2.895], [dx1 - 0.05, y0 + 0.3 + j * 0.178, 2.895], 0.034, 8), 'wood_red');
    k.add(span(dcx - 0.03, y0 + 0.18, 2.875, dcx + 0.03, dyt - 0.07, 2.915), 'wood_red');
    // layer 3: the heavy board doors, standing open inside
    for (const s of [-1, 1]) { const x = s < 0 ? dx0 + 0.03 : dx1 - 0.03; k.add(span(x - 0.03, y0, 3.06, x + 0.03, dyt - 0.05, 3.7), 'wood_dark'); k.add(torus(0.045, 0.008, 4, 10).rotateY(PI / 2).translate(x - s * 0.035, 1.25, 3.55), 'brass'); for (const by of [0.5, 1.3, 2.1]) k.add(span(x - 0.034, by, 3.08, x + 0.034, by + 0.05, 3.68), iron); }
    // the hall behind, warm
    const L = { p: [dcx, 2.2, 3.9], c: [1.5, 1.0, 0.55], k: 0.3 };
    k.lit(quadUp(dx0, 2.96, dx1, 4.7, y0 + 0.001), [0.62, 0.24, 0.18], L, 0.4); k.lit(quadZ(dx0 - 0.4, y0, dx1 + 0.4, dyt + 0.3, 4.7), [0.9, 0.8, 0.62], L); for (const [x, sx] of [[dx0 - 0.02, 1], [dx1 + 0.02, -1]]) k.lit(sx > 0 ? quad([x, y0, 3.05], [x, y0, 4.7], [x, dyt, 4.7], [x, dyt, 3.05]) : quad([x, y0, 4.7], [x, y0, 3.05], [x, dyt, 3.05], [x, dyt, 4.7]), [0.85, 0.74, 0.58], L);
    k.lit(span(dcx - 0.4, y0, 4.4, dcx + 0.4, 0.82, 4.68), [0.42, 0.2, 0.13], L); k.lit(span(dcx - 0.45, 0.82, 4.36, dcx + 0.45, 0.87, 4.7), [0.5, 0.25, 0.15], L);
    k.lit(lathe([[0.05, 0], [0.09, 0.08], [0.06, 0.2], [0.035, 0.26], [0.05, 0.3]], 8).translate(dcx + 0.2, 0.87, 4.52), [0.2, 0.45, 0.8], L); k.lit(span(dcx - 0.2, 1.2, 4.68, dcx + 0.2, 1.95, 4.7), [0.85, 0.16, 0.12], L);
    k.glow(sph(0.07, 8, 6).translate(dcx, 2.3, 3.9), [4.5, 3.0, 1.5]);
    // side window with coloured glass
    const g = S.glass[b % 2]; pane(wx0 + 0.05, wy0 + 0.05, wx1 - 0.05, wy1 - 0.05, 2.93, g);
    for (const [a, c, d, e] of [[wx0, wy0, wx0 + 0.06, wy1], [wx1 - 0.06, wy0, wx1, wy1], [wx0, wy0, wx1, wy0 + 0.06], [wx0, wy1 - 0.06, wx1, wy1], [(wx0 + wx1) / 2 - 0.02, wy0, (wx0 + wx1) / 2 + 0.02, wy1], [wx0, wy0 + 0.88, wx1, wy0 + 0.92]]) k.add(span(a, c, 2.87, d, e, 2.93), 'wood_red');
    k.add(span(wx0 - 0.08, wy0 - 0.09, 2.72, wx1 + 0.08, wy0, 2.95), 'granite_slab'); k.add(span(wx0 - 0.08, wy1, 2.76, wx1 + 0.08, wy1 + 0.1, 2.95), 'granite_slab');
    for (let j = 0; j < 5; j++) k.add(rod([wx0 + 0.12 + j * (wx1 - wx0 - 0.24) / 4, wy0, 2.83], [wx0 + 0.12 + j * (wx1 - wx0 - 0.24) / 4, wy1, 2.83], 0.009, 5), iron);
    k.col(xo0 - 0.3, 0, 2.8, xo1 + 0.3, CEIL, ZB); k.col(dx0 - 0.16, 0, 2.74, dx1 + 0.16, FL + 0.13, 2.8);
    A.shopDoors.push({ pos: [dcx, FL, ZS], w: dw, h: dyt - FL, type: 'tanglong' }); A.windows.push({ pos: [(wx0 + wx1) / 2, (wy0 + wy1) / 2, ZS], w: wx1 - wx0, h: wy1 - wy0, lit: true, floor: -1, bay: b });
  }

  function shopGlass(b, xo0, xo1) {
    const left = r() < 0.5, dw = 0.95, dx0 = left ? xo0 + 0.08 : xo1 - 0.08 - dw, dx1 = dx0 + dw, wx0 = left ? dx1 + 0.08 : xo0 + 0.08, wx1 = left ? xo1 - 0.08 : dx0 - 0.08, yT = 2.36, yTop = 2.95, zf = 2.86, zb = 2.94, fr = wood, y0 = FL + 0.02, ga = glassSet[b % 2], gb = glassSet[(b + 1) % 2];
    for (const x of [xo0, left ? dx1 : dx0 - 0.08, xo1 - 0.08]) k.add(span(x, FL, zf, x + 0.08, yTop, zb), fr);
    k.add(span(xo0, yT, zf - 0.015, xo1, yT + 0.07, zb), fr); k.add(span(xo0, yTop - 0.06, zf, xo1, yTop, zb), fr);
    // stall riser of glazed tiles, sill, mullions
    k.add(span(wx0, FL, zf, wx1, 0.68, zb + 0.06), 'ceramic_blue'); k.add(span(wx0, FL, zf - 0.012, wx1, FL + 0.1, zf), 'granite_slab'); k.add(span(wx0 - 0.0, 0.68, zf - 0.04, wx1, 0.73, zb + 0.06), fr);
    const nm = Math.max(1, Math.round((wx1 - wx0) / 0.82)); for (let j = 1; j < nm; j++) { const x = wx0 + (wx1 - wx0) * j / nm; k.add(span(x - 0.022, 0.73, zf, x + 0.022, yT, zb), fr); }
    // transom lights of coloured glass over the whole front
    pane(xo0 + 0.08, yT + 0.07, xo1 - 0.08, yTop - 0.06, zb - 0.03, ga); const nt = Math.round((xo1 - xo0) / 0.48); for (let j = 1; j < nt; j++) { const x = xo0 + (xo1 - xo0) * j / nt; k.add(span(x - 0.015, yT + 0.07, zf + 0.01, x + 0.015, yTop - 0.06, zb), fr); }
    // lit display behind the window
    const cx = (wx0 + wx1) / 2, L = { p: [cx, 2.15, 3.02], c: [1.7, 1.3, 0.82], k: 0.45 }, back = r.pick([[0.8, 0.3, 0.25], [0.25, 0.5, 0.55], [0.85, 0.72, 0.45], [0.5, 0.3, 0.55]]);
    k.lit(quadZ(wx0, 0.73, wx1, yT, 3.6), back, L); k.lit(quadUp(wx0, zb, wx1, 3.6, 0.731), [0.55, 0.36, 0.2], L);
    k.lit(quad([wx0, 0.73, 2.94], [wx0, 0.73, 3.6], [wx0, yT, 3.6], [wx0, yT, 2.94]), back, L); k.lit(quad([wx1, 0.73, 3.6], [wx1, 0.73, 2.94], [wx1, yT, 2.94], [wx1, yT, 3.6]), back, L);
    k.lit(span(wx0 + 0.1, 1.42, 3.36, wx1 - 0.1, 1.45, 3.6), [0.6, 0.4, 0.22], L);
    const kind = seed % 3;
    for (let x = wx0 + 0.18, j = 0; x < wx1 - 0.15; x += r.range(0.26, 0.4), j++) {
      const c = r.pick(GOODS), up = j % 2 ? 1.45 : 0.73, z = j % 2 ? 3.48 : r.range(3.15, 3.4);
      if (kind === 0) { k.lit(cyl(0.11, 0.11, 0.03, 12).rotateX(-PI / 2).translate(x, up + 0.16, z), [0.95, 0.92, 0.82], L, 0.6); k.lit(torus(0.11, 0.014, 5, 14).translate(x, up + 0.16, z - 0.02), c, L); k.lit(span(x - 0.07, up, z - 0.02, x + 0.07, up + 0.05, z + 0.05), [0.45, 0.28, 0.16], L); k.lit(span(x - 0.004, up + 0.16, z - 0.036, x + 0.004, up + 0.24, z - 0.032), [0.1, 0.1, 0.1], L); k.lit(span(x, up + 0.156, z - 0.036, x + 0.06, up + 0.164, z - 0.032), [0.1, 0.1, 0.1], L); }
      else if (kind === 1) { const h = r.range(0.2, 0.36); k.lit(cyl(0.07, 0.085, h, 9).translate(x, up, z), [c[0] * 0.7 + 0.3, c[1] * 0.7 + 0.3, c[2] * 0.7 + 0.3], L); k.lit(cyl(0.05, 0.075, 0.04, 9).translate(x, up + h, z), [0.75, 0.15, 0.12], L); }
      else { const h = r.range(0.18, 0.34), w = r.range(0.16, 0.24); k.lit(span(-w / 2, 0, -0.012, w / 2, h, 0.012).rotateX(-0.14).translate(x, up, z), [0.2, 0.14, 0.1], L); k.lit(span(-w / 2 + 0.025, 0.025, -0.016, w / 2 - 0.025, h - 0.025, -0.012).rotateX(-0.14).translate(x, up, z), c, L, 0.5); }
    }
    for (const s of [-0.3, 0.3]) { k.add(rod([cx + s * (wx1 - wx0), 2.0, 3.1], [cx + s * (wx1 - wx0), yT, 3.1], 0.004, 4), 'glass_dark'); k.glow(sph(0.1, 10, 7).scale(1, 0.85, 1).translate(cx + s * (wx1 - wx0), 1.92, 3.1), [3.6, 1.2, 0.7]); }
    // the door: timber frame, lit coloured glass above a solid panel, brass kick plate and handle
    const hs = left ? 1 : -1, hx = left ? dx1 - 0.12 : dx0 + 0.12;
    for (const x of [dx0, dx1 - 0.09]) k.add(span(x, y0 + 0.01, zf + 0.02, x + 0.09, yT, zb - 0.01), fr);
    k.add(span(dx0, y0 + 0.01, zf + 0.02, dx1, y0 + 0.26, zb - 0.01), fr); k.add(span(dx0, 1.02, zf + 0.02, dx1, 1.12, zb - 0.01), fr); k.add(span(dx0, yT - 0.1, zf + 0.02, dx1, yT, zb - 0.01), fr);
    k.add(span(dx0 + 0.09, y0 + 0.26, zf + 0.04, dx1 - 0.09, 1.02, zb - 0.03), fr); k.add(span(dx0 + 0.16, y0 + 0.36, zf + 0.03, dx1 - 0.16, 0.92, zf + 0.04), fr);
    k.add(span(dx0 + 0.02, y0 + 0.03, zf + 0.012, dx1 - 0.02, y0 + 0.22, zf + 0.02), 'brass'); pane(dx0 + 0.09, 1.12, dx1 - 0.09, yT - 0.1, zb - 0.04, gb);
    k.add(rod([hx, 1.0, zf - 0.03], [hx, 1.4, zf - 0.03], 0.012, 6, 0.012, true), 'brass'); for (const y of [1.04, 1.36]) k.add(rod([hx, y, zf - 0.03], [hx, y, zf + 0.02], 0.008, 5), 'brass');
    k.col(xo0 - 0.3, 0, 2.8, xo1 + 0.3, CEIL, ZB); A.shopDoors.push({ pos: [(dx0 + dx1) / 2, FL, ZS], w: dw, h: yT - FL, type: 'glass', hinge: hs });
  }

  // ---------------- upper floors ----------------
  const holes = [], ZI = ZF + 0.16;
  const balSet = new Set(); if (o.balconies) for (const [f, b] of o.balconies) balSet.add(f + ':' + b); else { balSet.add('0:' + (style === 'baroque' || style === 'nanyang' ? (bays - 1) >> 1 : r.int(0, bays - 1))); for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) if (r() < (f === 0 ? 0.3 : 0.2)) balSet.add(f + ':' + b); }

  function opening(op) {
    const { x0, x1, y0, y1, rise = 0, door = false, f, b } = op, w = x1 - x0, cx = (x0 + x1) / 2, fm = style === 'modern' ? 'metal_green' : wood;
    const out = [[x0, y0], [x1, y0], ...(rise ? arcPts(cx, y1, w / 2, rise, 0, PI, 10) : [[x1, y1], [x0, y1]])];
    holes.push(out); k.add(ribbonZ(out, ZF, ZI), wall);
    let state = op.state || (door ? (r() < 0.85 ? 'lit' : 'dark') : (() => { const t = r(); return style === 'modern' ? (t < 0.72 ? 'lit' : 'dark') : t < 0.6 ? 'lit' : t < 0.72 ? 'dark' : t < 0.86 ? 'open' : 'shut'; })());
    const lit = state !== 'dark' && state !== 'shut', gm = lit ? glassSet[(r() < 0.5) ? 0 : 1] : 'glass_dark';
    k.add(fitUV(faceZ(out, ZI - 0.012, null, x0, y0), w, y1 - y0 + rise, gm), gm);
    // frame, mullion, transom
    for (const x of [x0, x1 - 0.05]) k.add(span(x, y0, ZI - 0.07, x + 0.05, y1, ZI), fm);
    k.add(span(x0, y0, ZI - 0.07, x1, y0 + 0.05, ZI), fm); k.add(span(x0, y1 - 0.03, ZI - 0.07, x1, y1 + 0.03, ZI), fm);
    if (w > 0.7) k.add(span(cx - 0.022, y0, ZI - 0.06, cx + 0.022, y1, ZI), fm);
    if (!door || style !== 'modern') k.add(span(x0, y0 + (y1 - y0) * (door ? 0.4 : 0.6), ZI - 0.055, x1, y0 + (y1 - y0) * (door ? 0.4 : 0.6) + 0.04, ZI), fm);
    if (door) k.add(span(x0 + 0.05, y0 + 0.05, ZI - 0.04, x1 - 0.05, y0 + (y1 - y0) * 0.4, ZI - 0.02), fm);
    if (rise) { k.add(extr([...arcPts(cx, y1, w / 2, rise, 0, PI, 10), ...arcPts(cx, y1, w / 2 - 0.05, rise - 0.05, PI, 0, 10)], 0.06).translate(0, 0, ZI - 0.07), fm); for (const t of [PI / 3, PI / 2, 2 * PI / 3]) k.add(beam([cx, y1, ZI - 0.04], [cx + (w / 2 - 0.02) * Math.cos(t), y1 + (rise - 0.02) * Math.sin(t), ZI - 0.04], 0.03, 0.03), fm); }
    // sill and hood
    if (!door) { k.add(span(x0 - 0.1, y0 - 0.09, ZF - 0.1, x1 + 0.1, y0, ZF + 0.03), trim); k.add(span(x0 - 0.06, y0 - 0.15, ZF - 0.06, x1 + 0.06, y0 - 0.09, ZF), trim); }
    if (rise) { k.add(extr([...arcPts(cx, y1, w / 2 + 0.11, rise + 0.11, 0, PI, 10), ...arcPts(cx, y1, w / 2, rise, PI, 0, 10)], 0.045).translate(0, 0, ZF - 0.045), trim); k.add(extr([[cx - 0.06, y1 + rise - 0.02], [cx + 0.06, y1 + rise - 0.02], [cx + 0.09, y1 + rise + 0.2], [cx - 0.09, y1 + rise + 0.2]], 0.07).translate(0, 0, ZF - 0.07), trim); for (const s of [-1, 1]) k.add(span(cx + s * (w / 2 + 0.13), y1 - 0.06, ZF - 0.055, cx + s * (w / 2 - 0.0), y1 + 0.03, ZF), trim); }
    else if (style === 'baroque') { k.add(span(x0 - 0.12, y1 + 0.02, ZF - 0.07, x1 + 0.12, y1 + 0.12, ZF), trim); k.add(extr([[x0 - 0.16, y1 + 0.12], [x1 + 0.16, y1 + 0.12], [cx, y1 + 0.12 + w * 0.3]], 0.08).translate(0, 0, ZF - 0.08), trim); }
    else if (style !== 'modern') { k.add(span(x0 - 0.1, y1, ZF - 0.05, x1 + 0.1, y1 + 0.16, ZF), trim); if (style === 'plain') k.add(span(x0 - 0.14, y1 + 0.16, ZF - 0.09, x1 + 0.14, y1 + 0.21, ZF), trim); }
    // louvred shutters
    if (!door && (state === 'shut' || state === 'open') && style !== 'modern') {
      const lw = w / 2, leaf = (xa, z, open) => {
        k.add(span(xa, y0 + 0.0, z - 0.035, xa + 0.045, y1, z), wood); k.add(span(xa + lw - 0.045, y0, z - 0.035, xa + lw, y1, z), wood); k.add(span(xa, y0, z - 0.035, xa + lw, y0 + 0.06, z), wood); k.add(span(xa, y1 - 0.06, z - 0.035, xa + lw, y1, z), wood); k.add(span(xa, (y0 + y1) / 2 - 0.03, z - 0.035, xa + lw, (y0 + y1) / 2 + 0.03, z), wood);
        const prof = []; for (let y = y0 + 0.07; y < y1 - 0.08; y += 0.062) prof.push([z - 0.03, y], [z - 0.008, y + 0.055]); k.add(stripX(prof, xa + 0.045, xa + lw - 0.045), wood);
      };
      if (state === 'shut') { leaf(x0, ZF + 0.07, false); leaf(cx, ZF + 0.07, false); } else { leaf(x0 - lw - 0.02, ZF - 0.012, true); leaf(x1 + 0.02, ZF - 0.012, true); }
    }
    A.windows.push({ pos: [cx, (y0 + y1 + rise) / 2, ZF], w, h: y1 - y0 + rise, lit, state, floor: f, bay: b, door });
  }

  function balcony(f, b) {
    const yf = ARC + f * ST, cx = b * BAY + 2, hw = style === 'modern' ? 1.7 : 1.5, x0 = cx - hw, x1 = cx + hw, zo = ZF - 1.0;
    k.add(profX([[ZF, yf], [zo, yf], [zo, yf - 0.06], [zo + 0.05, yf - 0.1], [zo + 0.05, yf - 0.14], [ZF, yf - 0.14]], x0, x1), trim);
    for (const cxk of [x0 + 0.22, cx, x1 - 0.22]) k.add(extr([[0, 0], [0.86, 0], [0.86, -0.07], [0.55, -0.12], [0.3, -0.3], [0.1, -0.52], [0, -0.56]], 0.14).rotateY(PI / 2).translate(cxk - 0.07, yf - 0.14, ZF), trim);
    if (S.rail === 'baluster') {
      for (const x of [x0 + 0.1, x1 - 0.1]) { k.add(bb(0.2, 0.95, 0.2, x, yf, zo + 0.1), trim); k.add(bb(0.25, 0.05, 0.25, x, yf + 0.95, zo + 0.1), trim); k.add(sph(0.07, 8, 6).translate(x, yf + 1.06, zo + 0.1), trim); }
      balustrade(k, [x0 + 0.2, zo + 0.1], [x1 - 0.2, zo + 0.1], yf, trim, 0.92); for (const x of [x0 + 0.1, x1 - 0.1]) balustrade(k, [x, zo + 0.2], [x, ZF], yf, trim, 0.92);
    } else if (S.rail === 'pipe') {
      pipeRail(k, [x0 + 0.05, zo + 0.05], [x1 - 0.05, zo + 0.05], yf, wall, iron, trim); for (const x of [x0 + 0.05, x1 - 0.05]) pipeRail(k, [x, zo + 0.05], [x, ZF], yf, wall, iron, trim);
    } else { ironRail(k, [x0 + 0.03, zo + 0.03], [x1 - 0.03, zo + 0.03], yf, iron); for (const x of [x0 + 0.03, x1 - 0.03]) ironRail(k, [x, zo + 0.03], [x, ZF], yf, iron); }
    k.col(x0, yf - 0.14, zo, x1, yf, ZF, 'tile', true);
    A.balconies.push({ min: new V3(x0, yf - 0.14, zo), max: new V3(x1, yf, ZF), floor: f, bay: b, rail: 0.95 });
  }

  for (let f = 0; f < floors; f++) {
    const yf = ARC + f * ST;
    for (let b = 0; b < bays; b++) {
      const bx = b * BAY, hasBal = balSet.has(f + ':' + b), add = (c, w, sill, h, rise, door) => opening({ x0: bx + c - w / 2, x1: bx + c + w / 2, y0: yf + sill, y1: yf + sill + h, rise, door, f, b, state: door && hasBal ? (r() < 0.9 ? 'lit' : 'dark') : undefined });
      if (style === 'nanyang') { if (hasBal) { add(2, 1.2, 0.02, 2.2, 0.6, true); add(0.78, 0.6, 1.05, 1.3, 0.3); add(3.22, 0.6, 1.05, 1.3, 0.3); } else { add(1.2, 0.95, 0.95, 1.5, 0.475); add(2.8, 0.95, 0.95, 1.5, 0.475); } }
      else if (style === 'baroque') { if (hasBal) add(2, 1.3, 0.02, 2.25, 0.65, true); else add(2, 1.3, 0.9, 1.5, 0.65); add(0.82, 0.56, 0.9, 1.6, 0); add(3.18, 0.56, 0.9, 1.6, 0); }
      else if (style === 'modern') { if (hasBal) add(2, 0.98, 0.02, 2.44, 0, true); else add(2, 0.98, 1.0, 1.46, 0); add(0.87, 0.98, 1.0, 1.46, 0); add(3.13, 0.98, 1.0, 1.46, 0); }
      else { if (hasBal) { add(2, 1.0, 0.02, 2.4, 0, true); add(0.8, 0.62, 1.0, 1.4, 0); add(3.2, 0.62, 1.0, 1.4, 0); } else { add(1.2, 1.0, 1.0, 1.6, 0); add(2.8, 1.0, 1.0, 1.6, 0); } }
      if (hasBal) balcony(f, b);
      if (f === 0) A.signs.push(hasBal ? { pos: [bx + 2, yf + 0.5, ZF - 1.07], normal: [0, 0, -1], w: 2.5, h: 0.6, kind: 'fascia', face: 'street', on: 'balcony' } : { pos: [bx + 2, yf + 0.43, ZF - 0.03], normal: [0, 0, -1], w: 3.2, h: 0.62, kind: 'fascia', face: 'street' });
      // panels and bands between the floors
      if (style === 'nanyang' && !hasBal && f > 0) for (const c of [1.2, 2.8]) { k.add(span(bx + c - 0.48, yf + 0.3, ZF - 0.025, bx + c + 0.48, yf + 0.74, ZF), trim); k.add(span(bx + c - 0.4, yf + 0.36, ZF - 0.035, bx + c + 0.4, yf + 0.68, ZF - 0.025), wall); }
      if (style === 'baroque') { k.add(cyl(0.2, 0.2, 0.04, 14).rotateX(-PI / 2).scale(1.5, 1, 1).translate(bx + 2, yf + 3.16, ZF), trim); if (!hasBal && f > 0) k.add(span(bx + 1.4, yf + 0.3, ZF - 0.03, bx + 2.6, yf + 0.72, ZF), trim); }
      if (style === 'modern') { k.add(profX([[ZF, yf + 2.62], [ZF - 0.42, yf + 2.62], [ZF - 0.42, yf + 2.56], [ZF - 0.38, yf + 2.54], [ZF, yf + 2.5]], bx + 0.3, bx + 3.7), trim); k.col(bx + 0.3, yf + 2.5, ZF - 0.42, bx + 3.7, yf + 2.62, ZF, 'stone', true); if (!hasBal) k.add(span(bx + 0.3, yf + 0.86, ZF - 0.06, bx + 3.7, yf + 0.92, ZF), trim); }
      if (style === 'plain') for (const y of [0.55, 3.0]) k.add(span(bx + 0.26, yf + y, ZF - 0.02, bx + 3.74, yf + y + 0.08, ZF), trim);
    }
    // the ledge along the floor line (a cat walks on it)
    k.add(profX([[ZF, yf], [ZF - 0.3, yf], [ZF - 0.3, yf - 0.07], [ZF - 0.24, yf - 0.1], [ZF - 0.17, yf - 0.13], [ZF - 0.17, yf - 0.19], [ZF - 0.08, yf - 0.24], [ZF, yf - 0.24]], 0, W), trim);
    k.col(0, yf - 0.1, ZF - 0.3, W, yf, ZF, 'stone', true); A.ledges.push({ min: new V3(0, yf, ZF - 0.3), max: new V3(W, yf + 0.3, ZF), floor: f });
  }
  k.add(faceZ([[0, ARC], [W, ARC], [W, H], [0, H]], ZF, holes, 0, ARC), wall);

  // pilasters / fins on the column lines
  for (let i = 0; i <= bays; i++) {
    const [x0, x1] = i === 0 ? [0, 0.26] : i === bays ? [W - 0.26, W] : [i * BAY - 0.24, i * BAY + 0.24], pl = i === 0 ? 0 : 1, pr = i === bays ? 0 : 1;
    if (style === 'nanyang') { k.add(span(x0, ARC, ZF - 0.07, x1, H - 0.5, ZF), trim); k.add(span(x0 - 0.04 * pl, ARC, ZF - 0.11, x1 + 0.04 * pr, ARC + 0.32, ZF), trim); for (const [d0, d1, p] of [[-0.74, -0.68, 0.03], [-0.68, -0.58, 0.06], [-0.58, -0.5, 0.09]]) k.add(span(x0 - p * pl, H + d0, ZF - 0.07 - p, x1 + p * pr, H + d1, ZF), trim); k.add(span(x0 + 0.1 * pl, ARC + 0.5, ZF - 0.08, x1 - 0.1 * pr, H - 0.95, ZF - 0.07), wall); }
    else if (style === 'baroque') for (let f = 0; f < floors; f++) { const y = ARC + f * ST, yt = f === floors - 1 ? H - 0.5 : y + ST - 0.24; k.add(span(x0, y, ZF - 0.08, x1, yt, ZF), trim); k.add(span(x0 - 0.04 * pl, y, ZF - 0.12, x1 + 0.04 * pr, y + 0.3, ZF), trim); for (const [d0, d1, p] of [[-0.3, -0.24, 0.03], [-0.24, -0.1, 0.07], [-0.1, 0, 0.1]]) k.add(span(x0 - p * pl, yt + d0, ZF - 0.08 - p, x1 + p * pr, yt + d1, ZF), trim); for (const s of [-1, 1]) if ((s < 0 ? pl : pr)) k.add(cyl(0.07, 0.07, 0.05, 8).rotateX(-PI / 2).translate((x0 + x1) / 2 + s * 0.2, yt - 0.2, ZF - 0.15), trim); for (let j = 0; j < 3; j++) if (pl && pr) k.add(span(x0 + 0.1 + j * 0.11, y + 0.42, ZF - 0.09, x0 + 0.16 + j * 0.11, yt - 0.42, ZF - 0.08), wall); }
    else if (style === 'modern') { const m = (x0 + x1) / 2, hw = Math.min(0.08, (x1 - x0) / 2); k.add(span(m - hw, ARC, ZF - 0.16, m + hw, H + 0.5, ZF), trim); k.add(span(x0, ARC, ZF - 0.04, x1, H, ZF), wall); }
    else k.add(span(x0, ARC, ZF - 0.045, x1, H - 0.3, ZF), wall);
  }

  // ---------------- cornice, parapet, pediment ----------------
  const xc = W / 2; let top = H;
  const medallion = (y, rad, gm) => { k.add(torus(rad, 0.05, 6, 20).translate(xc, y, ZF - 0.03), trim); k.add(fitUV(faceZ(arcPts(xc, y, rad, rad, 0, TAU, 20).slice(0, -1), ZF - 0.012, null, xc - rad, y - rad), rad * 2, rad * 2, gm), gm); for (let j = 0; j < 4; j++) k.add(rod([xc - Math.cos(j * PI / 4) * rad, y - Math.sin(j * PI / 4) * rad, ZF - 0.02], [xc + Math.cos(j * PI / 4) * rad, y + Math.sin(j * PI / 4) * rad, ZF - 0.02], 0.012, 4), trim); };
  if (style === 'nanyang' || style === 'baroque') {
    k.add(profX([[ZF, H - 0.5], [ZF - 0.05, H - 0.5], [ZF - 0.05, H - 0.42], [ZF - 0.12, H - 0.36], [ZF - 0.12, H - 0.26], [ZF - 0.3, H - 0.12], [ZF - 0.42, H - 0.1], [ZF - 0.45, H - 0.02], [ZF - 0.45, H], [ZF, H]], 0, W), trim);
    for (let x = 0.11; x < W - 0.05; x += 0.22) k.add(span(x - 0.045, H - 0.36, ZF - 0.21, x + 0.045, H - 0.26, ZF - 0.12), trim);
    k.add(span(0, H, ZF - 0.02, W, H + 0.18, ZF + 0.3), trim);
    const yb = H + 0.18, hw = Math.min(1.75, W / 2 - 0.3), pedH = style === 'baroque' ? 0.95 : 1.0;
    const pedX = []; for (let i = 0; i <= bays; i++) { const x = i === 0 ? 0.24 : i === bays ? W - 0.24 : i * BAY; if (Math.abs(x - xc) > hw - 0.1) pedX.push(x); }
    for (const x of pedX) {
      k.add(bb(0.46, pedH, 0.36, x, yb, ZF + 0.14), trim); k.add(bb(0.56, 0.07, 0.44, x, yb + pedH, ZF + 0.14), trim);
      if (style === 'baroque') k.add(lathe([[0.07, 0], [0.11, 0.03], [0.05, 0.1], [0.14, 0.24], [0.17, 0.36], [0.12, 0.46], [0.06, 0.5], [0.09, 0.54], [0.03, 0.62], [0.0, 0.66]], 10).translate(x, yb + pedH + 0.07, ZF + 0.14), trim);
      else { k.add(cyl(0.06, 0.1, 0.1, 8).translate(x, yb + pedH + 0.07, ZF + 0.14), trim); k.add(sph(0.15, 10, 8).translate(x, yb + pedH + 0.3, ZF + 0.14), trim); }
    }
    for (let i = 0; i < pedX.length - 1; i++) { const a = pedX[i] + 0.23, c = pedX[i + 1] - 0.23; if (c - a < 0.5) continue; if (a < xc && c > xc) { if (xc - hw - a > 0.4) balustrade(k, [a, ZF + 0.14], [xc - hw, ZF + 0.14], yb, trim, 0.9, 5); if (c - xc - hw > 0.4) balustrade(k, [xc + hw, ZF + 0.14], [c, ZF + 0.14], yb, trim, 0.9, 5); } else balustrade(k, [a, ZF + 0.14], [c, ZF + 0.14], yb, trim, 0.9, 5); }
    let ped;
    if (style === 'nanyang') { const R = hw - 0.45; ped = [[-hw, 0], [hw, 0], ...arcPts(hw, 1.0, -0.45, -0.45, PI / 2, 0, 5), ...arcPts(0, 1.0, R, 0.95, 0, PI, 16).slice(1), ...arcPts(-hw, 1.0, 0.45, -0.45, 0, PI / 2, 5).slice(1)]; top = yb + 2.3; }
    else { ped = [[-hw, 0], [hw, 0], [hw, 0.5]]; for (let i = 1; i <= 10; i++) { const t = i / 10; ped.push([hw - (hw - 0.42) * t, 0.5 + 1.5 * (t + 0.13 * Math.sin(TAU * t))]); } ped.push([0.42, 1.35], [0.3, 1.35], [0.3, 1.62], [-0.3, 1.62], [-0.3, 1.35], [-0.42, 1.35]); for (let i = 10; i >= 1; i--) { const t = i / 10; ped.push([-hw + (hw - 0.42) * t, 0.5 + 1.5 * (t + 0.13 * Math.sin(TAU * t))]); } ped.push([-hw, 0.5]); top = yb + 2.5; }
    k.add(extr(ped, 0.3).translate(xc, yb, ZF - 0.02), trim);
    k.add(extr(ped.map(p => [p[0] * 0.86, 0.1 + (p[1]) * 0.84]), 0.02).translate(xc, yb, ZF - 0.04), wall);
    medallion(yb + (style === 'baroque' ? 0.82 : 1.05), style === 'baroque' ? 0.36 : 0.44, glassSet[0]);
    if (style === 'nanyang') { for (const s of [-1, 1]) k.add(cyl(0.2, 0.2, 0.34, 14).rotateX(-PI / 2).translate(xc + s * (hw - 0.12), yb + 0.72, ZF + 0.3), trim); k.add(cyl(0.05, 0.09, 0.12, 8).translate(xc, yb + 1.93, ZF + 0.13), trim); k.add(sph(0.14, 10, 8).translate(xc, yb + 2.17, ZF + 0.13), trim); }
    else { k.add(lathe([[0.1, 0], [0.16, 0.04], [0.07, 0.14], [0.2, 0.34], [0.24, 0.5], [0.16, 0.64], [0.08, 0.7], [0.12, 0.76], [0.04, 0.86], [0.0, 0.92]], 12).translate(xc, yb + 1.62, ZF + 0.13), trim); for (const s of [-1, 1]) { k.add(cyl(0.17, 0.17, 0.34, 12).rotateX(-PI / 2).translate(xc + s * 0.56, yb + 1.86, ZF + 0.3), trim); k.add(cyl(0.2, 0.2, 0.34, 12).rotateX(-PI / 2).translate(xc + s * (hw - 0.1), yb + 0.62, ZF + 0.3), trim); } }
    k.col(0, H, ZF - 0.02, W, H + 1.1, ZF + 0.32);
  } else if (style === 'modern') {
    k.add(profX([[ZF, H - 0.2], [ZF - 0.36, H - 0.2], [ZF - 0.4, H - 0.12], [ZF - 0.4, H], [ZF, H]], 0, W), trim);
    k.add(span(0, H, ZF, W, H + 0.9, ZF + 0.22), wall); k.add(span(0, H + 0.9, ZF - 0.03, W, H + 0.98, ZF + 0.25), trim);
    for (let j = 0; j < 3; j++) k.add(span(0, H + 0.2 + j * 0.2, ZF - 0.025, W, H + 0.27 + j * 0.2, ZF), trim);
    const steps = [[Math.min(2.6, W / 2 - 0.2), 1.5], [Math.min(1.7, W / 2 - 0.6), 2.0], [Math.min(0.8, W / 2 - 1.0), 2.5]];
    for (const [hw, h] of steps) if (hw > 0.2) { k.add(span(xc - hw, H + 0.9, ZF - 0.04, xc + hw, H + h, ZF + 0.22), wall); k.add(span(xc - hw - 0.03, H + h, ZF - 0.07, xc + hw + 0.03, H + h + 0.07, ZF + 0.25), trim); }
    for (const s of [-0.34, 0, 0.34]) k.add(span(xc + s - 0.05, H - 1.0, ZF - 0.14, xc + s + 0.05, H + 2.9 - Math.abs(s) * 1.2, ZF), trim);
    k.glow(span(xc - 0.012, H + 0.2, ZF - 0.165, xc + 0.012, H + 2.8, ZF - 0.14), [0.5, 3.2, 3.8]);
    top = H + 2.95; k.col(0, H, ZF, W, H + 0.98, ZF + 0.25);
  } else {
    k.add(profX([[ZF, H - 0.3], [ZF - 0.06, H - 0.3], [ZF - 0.06, H - 0.2], [ZF - 0.14, H - 0.2], [ZF - 0.14, H - 0.1], [ZF - 0.22, H - 0.1], [ZF - 0.22, H], [ZF, H]], 0, W), trim);
    k.add(span(0, H, ZF, W, H + 0.8, ZF + 0.24), wall); k.add(span(0, H + 0.8, ZF - 0.04, W, H + 0.88, ZF + 0.28), trim);
    const hw = Math.min(1.8, W / 2 - 0.2); k.add(extr([[-hw, 0.8], [hw, 0.8], [hw, 1.0], [0.5, 1.75], [-0.5, 1.75], [-hw, 1.0]], 0.24).translate(xc, H, ZF), wall); k.add(extr([[-hw - 0.06, 1.0], [-0.52, 1.75], [0.52, 1.75], [hw + 0.06, 1.0], [hw + 0.06, 1.08], [0.55, 1.83], [-0.55, 1.83], [-hw - 0.06, 1.08]], 0.32).translate(xc, H, ZF - 0.04), trim);
    medallion(H + 1.2, 0.3, glassSet[1]);
    top = H + 1.85; k.col(0, H, ZF, W, H + 0.88, ZF + 0.28);
  }

  // ---------------- shell: sides, back, roof ----------------
  k.add(span(0, 0, ZS + 0.25, 0.08, H, ZB), wall); k.add(span(W - 0.08, 0, ZS + 0.25, W, H, ZB), wall);
  k.add(span(0, ARC, ZF, 0.08, H, ZS + 0.25), wall); k.add(span(W - 0.08, ARC, ZF, W, H, ZS + 0.25), wall);
  k.add(span(0.08, 0, ZB - 0.1, W - 0.08, H, ZB), wall); k.add(span(0, H - 0.08, ZF + 0.3, W, H, ZB), trim);
  k.col(0, CEIL, ZF, W, H, ZB);

  // ---------------- downpipes, air conditioners, blade-sign brackets ----------------
  const pipes = bays > 1 ? [1 + Math.floor(r() * (bays - 1))] : []; if (bays > 3 && r() < 0.6) pipes.push(bays - 1);
  for (const i of new Set(pipes)) { const x = i * BAY + (r() < 0.5 ? -0.36 : 0.36); downpipe(k, x, ZF - 0.36, ARC + 0.02, H - 0.1, iron, ZF, true, true); A.spouts.push({ pos: [x, ARC + 0.02, ZF - 0.5] }); }
  const nAC = Math.min(bays * floors, 1 + Math.floor(r() * (bays + 1)));
  for (let j = 0, used = new Set(); j < nAC; j++) { const f = Math.floor(r() * floors), b = Math.floor(r() * bays), key = f + ':' + b; if (used.has(key) || balSet.has(key) || (f === 0 && floors > 1)) continue; used.add(key); const x = b * BAY + 2 + (style === 'modern' || style === 'baroque' ? 0 : 0), y = ARC + f * ST + 0.36; if (style === 'baroque' || style === 'modern') continue; acUnit(k, x, y, ZF, { body: 'metal_shutter', metal: 'metal_shutter', dark: 'glass_dark', rust: iron }); k.col(x - 0.4, y, ZF - 0.33, x + 0.4, y + 0.57, ZF, 'metal'); }
  if (bays > 1) { const i = 1 + Math.floor(r() * (bays - 1)); A.signs.push({ pos: [i * BAY, ARC + 2.0, ZF - 0.85], normal: [-1, 0, 0], w: 0.9, h: 2.7, kind: 'vertical', mount: 'blade' }); }

  const g = k.finish('building:' + style, { grime: 0.75 });
  g.userData.size = [W, top, ZB]; g.userData.anchors = A; g.userData.style = style; g.userData.shops = shops; g.userData.colors = { wall, trim, wood, iron, glass: glassSet }; g.userData.height = H;
  return g;
}
// mirror helper for geometry scaled by -1 on one axis
function flipWinding(g) { const src = g.index ? null : g; if (!src) return g; for (const name of Object.keys(g.attributes)) { const at = g.attributes[name], s = at.itemSize, arr = at.array; for (let i = 0; i < at.count; i += 3) for (let j = 0; j < s; j++) { const t = arr[(i + 1) * s + j]; arr[(i + 1) * s + j] = arr[(i + 2) * s + j]; arr[(i + 2) * s + j] = t; } } return g; }

export async function create(G) {
  return { styles: ['nanyang', 'baroque', 'modern', 'plain'], building: (o = {}) => makeBuilding(G, o) };
}

// put a sign from G.signs on an anchor (origin = centre of the back face, facing its +Z)
function mountSign(G, root, an, text, i) {
  const S = G.signs; if (!S) return; let s;
  const neon = [0xff4d6d, 0x3ddc97, 0xffc24a, 0x48d1ff][i % 4];
  if (an.kind === 'fascia') s = i % 3 === 0 ? S.neon(text, { color: neon, height: 0.42 }) : i % 3 === 1 ? S.lightbox(text, { w: Math.min(an.w, 2.6), h: 0.56 }) : S.painted(text, { w: Math.min(an.w, 2.8), h: 0.58 });
  else if (an.kind === 'hanging') s = S.lightbox(text.slice(0, 2), { w: 0.9, h: 0.45 });
  else if (an.mount === 'blade') s = S.neon(text, { color: neon, height: 0.5, vertical: true });
  else s = S.painted(text.slice(0, 4), { w: 0.3, h: 1.3, vertical: true });
  if (!s) return; s.position.set(an.pos[0], an.pos[1], an.pos[2]); s.rotation.y = Math.atan2(an.normal[0], an.normal[2]); root.add(s);
}

export async function showcase(G) {
  const api = G.arch, only = (G.params.only || '').split(',').filter(Boolean), styles = api.styles.filter(s => !only.length || only.includes(s)), list = styles.length ? styles : api.styles;
  const root = new THREE.Group(); root.name = 'arch-showcase'; G.scene.add(root);
  const bays = +(G.params.arch_bays || 3), total = list.length * bays * BAY, names = (G.signs && G.signs.names) || ['陈记粥铺']; let x = -total / 2, tris = 0, meshes = 0, ni = 0; const report = {};
  list.forEach((style, i) => {
    const b = api.building({ bays, floors: +(G.params.arch_floors || (i % 2 ? 2 : 3)), style, seed: +(G.params.seed || 7) + i, side: 1, floor: true, colors: G.params.arch_seedcolors ? undefined : { nanyang: { wall: 'plaster_teal' }, baroque: { wall: 'plaster_pink' }, modern: { wall: 'plaster_cream' }, plain: { wall: 'brick_grey' } }[style], shop: G.params.arch_shop ? G.params.arch_shop.split('.') : ['open', 'tanglong', 'glass', 'shutter'].slice(i % 2 ? 1 : 0).concat(['shutter', 'open']) });
    b.position.x = x; root.add(b); tris += b.userData.tris; meshes += b.userData.meshes; report[style] = { tris: b.userData.tris, meshes: b.userData.meshes, colliders: b.userData.colliders.length };
    const an = b.userData.anchors;
    if (!G.params.arch_nosigns) an.signs.forEach((s, j) => { if (s.kind === 'vertical' && s.mount === 'column' && j % 2) return; mountSign(G, b, s, names[ni % names.length], ni); ni++; });
    if (G.physics && G.physics.addBox) for (const c of b.userData.colliders) G.physics.addBox({ min: c.min.clone().add(b.position), max: c.max.clone().add(b.position), surface: c.surface, oneWay: c.oneWay });
    if (G.params.arch_debug) for (const c of b.userData.colliders) { const m = new THREE.Mesh(new THREE.BoxGeometry(c.max.x - c.min.x, c.max.y - c.min.y, c.max.z - c.min.z), new THREE.MeshBasicMaterial({ color: c.oneWay ? 0x33ff88 : 0xff3366, wireframe: true })); m.position.copy(c.min).add(c.max).multiplyScalar(0.5).add(b.position); root.add(m); }
    // real lights on a few lamps (the pool allows 8)
    an.lamps.forEach((l, j) => { if ((i * 3 + j) % 2 && list.length > 1) return; const p = G.render.lightPool && G.render.lightPool.acquire(); if (p) { p.color.setRGB(1, 0.72, 0.42); p.intensity = 14; p.distance = 9; p.position.set(l.pos[0] + x, l.pos[1] - 0.1, l.pos[2]); } });
    x += bays * BAY;
  });
  G.archReport = report; console.log('[arch] showcase', JSON.stringify(report), 'total tris', tris, 'meshes', meshes);
  const one = list.length === 1;
  return { cam: one ? [-7.5, 1.7, -12.5] : [-20, 2.2, -15.5], target: one ? [0.5, 6.2, 0] : [1, 7.6, 0], update() {} };
}
