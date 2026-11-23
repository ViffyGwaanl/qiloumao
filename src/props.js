// props.js — ARCH agent: every street prop, assembled from primitives. Origin = bottom centre of the prop (the awning is the
// exception: y = 0 is the middle of its sloping cloth top). Floor-standing props with a front (shelf_goods, congee_stall,
// urn_copper, pot_steaming) face -Z like the buildings; wall-mounted ones (mailbox, ac_unit, awning, home_window) face +Z
// with their back on -Z, which is how the level mounts them. The camera is a cat's, 26 cm up, so feet,
// wheels, undersides and anything standing on the floor get the detail.
import * as THREE from 'three';
import { mergeGeos, box3, hashStr } from './util.js';
import { Kit, span, bb, cyl, sph, torus, lathe, rod, beam, tube, extr, profX, quad, quadZ, quadUp, stripX, twoSided, bake, acUnit, downpipe, glowMat } from './arch.js';

const PI = Math.PI, TAU = PI * 2;
const WARM = [5.5, 3.9, 2.1];

// ---------- small shared parts ----------
// a bamboo pole with nodes
function bamboo(k, a, b, r = 0.02, mat = 'bamboo', step = 0.24) {
  k.add(rod(a, b, r, 7, r * 0.9, true), mat);
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]);
  for (let s = step * 0.6; s < L - 0.03; s += step) { const t0 = s / L, t1 = (s + 0.012) / L; k.add(rod([a[0] + d[0] * t0, a[1] + d[1] * t0, a[2] + d[2] * t0], [a[0] + d[0] * t1, a[1] + d[1] * t1, a[2] + d[2] * t1], r * 1.14, 7, r * 1.14), mat); }
}
const lash = (k, p, r = 0.03) => k.add(sph(r, 6, 4).scale(1, 0.75, 1).translate(p[0], p[1], p[2]), 'rope');
// spoked wheel in the XY plane (axle along Z), turned by yaw
function wheel(k, c, R, yaw = 0, o = {}) {
  const ty = o.tyre || 0.022, n = o.spokes || 14, hw = o.hub || 0.07, put = (g, m) => k.add(g.rotateY(yaw).translate(c[0], c[1], c[2]), m), rimR = R - ty * 2 - 0.004;
  put(torus(R - ty, ty, 6, 22), 'rubber'); put(torus(rimR, 0.009, 4, 22), 'steel'); put(cyl(0.02, 0.02, hw, 7).rotateX(PI / 2).translate(0, 0, -hw / 2), 'steel');
  for (const s of [-1, 1]) put(cyl(0.032, 0.032, 0.006, 8).rotateX(PI / 2).translate(0, 0, s * hw * 0.42), 'steel');
  for (let i = 0; i < n; i++) { const a = i / n * TAU, s = i % 2 ? 1 : -1, b = a + s * 0.5; put(rod([Math.cos(b) * 0.03, Math.sin(b) * 0.03, s * hw * 0.42], [Math.cos(a) * rimR, Math.sin(a) * rimR, 0], 0.0022, 3), 'steel'); }
}
// an arching leaf blade growing from the origin up and toward +Z
function blade(len, wid, bend, segs = 3) {
  const pr = [0.4, 1, 0.78, 0.04, 0], pt = t => [len * (t - 0.3 * bend * t * t), len * bend * t * t * 0.9], gs = [];
  for (let i = 0; i < segs; i++) { const a = pt(i / segs), b = pt((i + 1) / segs), w0 = wid * pr[i] / 2, w1 = wid * pr[i + 1] / 2; gs.push(quad([-w0, a[0], a[1]], [w0, a[0], a[1]], [w1, b[0], b[1]], [-w1, b[0], b[1]])); }
  return twoSided(mergeGeos(gs));
}
function plant(k, r, x, y, z, n, len, wid, kind = 0) {
  if (kind === 2) k.add(rod([x, y, z], [x, y + len * 0.8, z], 0.012, 5, 0.007), 'leaf');
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + r.range(-0.3, 0.3), tilt = kind === 2 ? r.range(0.9, 1.4) : r.range(0.15, 0.75), l = len * r.range(0.7, 1.1) * (kind === 2 ? 0.42 : 1), g = blade(l, wid * r.range(0.8, 1.2), kind === 1 ? 0.25 : 0.75);
    g.rotateX(tilt).rotateY(a); k.add(g.translate(x, y + (kind === 2 ? len * (0.25 + 0.6 * i / n) : 0), z), 'leaf');
  }
}
// slatted wooden crate, bottom centre at (x, y, z), turned by yaw
function crate(k, r, x, y, z, w, h, d, yaw, mat) {
  const parts = [], dark = [], t = 0.018, add = g => parts.push(g);
  dark.push(span(-w / 2 + t, t, -d / 2 + t, w / 2 - t, h - t, d / 2 - t));
  const nh = Math.max(2, Math.round(h / 0.13)), ph = (h - 0.02) / nh;
  for (let i = 0; i < nh; i++) { const y0 = 0.01 + i * ph + 0.008, y1 = 0.01 + (i + 1) * ph - 0.008; for (const s of [-1, 1]) { add(span(-w / 2, y0, s * d / 2 - t * (s > 0 ? 1 : 0), w / 2, y1, s * d / 2 + t * (s < 0 ? 1 : 0))); add(span(s * w / 2 - t * (s > 0 ? 1 : 0), y0, -d / 2 + t, s * w / 2 + t * (s < 0 ? 1 : 0), y1, d / 2 - t)); } }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(span(sx * (w / 2 + 0.004) - 0.022, 0, sz * (d / 2 + 0.004) - 0.022, sx * (w / 2 + 0.004) + 0.022, h, sz * (d / 2 + 0.004) + 0.022));
  const nt = Math.max(3, Math.round(w / 0.12)), pw = w / nt; for (let i = 0; i < nt; i++) add(span(-w / 2 + i * pw + 0.006, h - t, -d / 2, -w / 2 + (i + 1) * pw - 0.006, h, d / 2));
  for (const s of [-1, 1]) { add(span(-w / 2 - 0.004, h * 0.42, s * (d / 2 + 0.006) - 0.012, w / 2 + 0.004, h * 0.58, s * (d / 2 + 0.006) + 0.012)); add(span(s * w * 0.32 - 0.03, -0.0, -d / 2, s * w * 0.32 + 0.03, 0.02, d / 2)); }
  k.add(mergeGeos(parts).rotateY(yaw).translate(x, y, z), mat); k.add(mergeGeos(dark).rotateY(yaw).translate(x, y, z), 'rubber');
}
// a tied sack lying down
const sack = (k, x, y, z, s, yaw, mat = 'cloth_white') => { k.add(sph(0.3 * s, 10, 7).scale(1, 0.55, 0.7).rotateY(yaw).translate(x, y + 0.165 * s, z), mat); k.add(cyl(0.035 * s, 0.07 * s, 0.1 * s, 6).rotateZ(-PI / 2 + 0.3).rotateY(yaw).translate(x + Math.cos(yaw) * 0.27 * s, y + 0.19 * s, z - Math.sin(yaw) * 0.27 * s), mat); k.add(torus(0.04 * s, 0.008, 4, 8).rotateY(PI / 2 + yaw).translate(x + Math.cos(yaw) * 0.29 * s, y + 0.2 * s, z - Math.sin(yaw) * 0.29 * s), 'rope'); };
// round paper lantern: body centre at (x, y, z), radius R
function lantern(k, x, y, z, R, cap = 'wood_red') {
  const pts = []; for (let i = 0; i <= 8; i++) { const t = -1.15 + 2.3 * i / 8; pts.push([Math.max(R * 0.36, R * Math.cos(t)), R * 0.86 * Math.sin(t) / Math.sin(1.15)]); }
  k.add(lathe(pts, 12).translate(x, y, z), 'paper_lantern');
  for (const s of [-1, 1]) k.add(cyl(R * 0.4, R * 0.4, R * 0.16, 10).translate(x, y + s * R * 0.86 - (s > 0 ? 0 : R * 0.16), z), cap);
  k.add(cyl(R * 0.1, R * 0.16, R * 0.5, 6).translate(x, y - R * 0.86 - R * 0.66, z), 'plastic_red'); k.add(rod([x, y + R, z], [x, y + R * 1.3, z], 0.004, 4), 'rope');
}
// sagging line between two points
const sag = (a, b, drop, n = 10) => { const p = []; for (let i = 0; i <= n; i++) { const t = i / n; p.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - drop * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]); } return p; };
// stainless pot with a lid ajar, bottom centre at (x, y, z)
function pot(k, r, x, y, z, R = 0.2, h = 0.28, mat = 'steel') {
  k.add(lathe([[R * 0.9, 0], [R, 0.02], [R, h - 0.015], [R + 0.012, h], [R - 0.004, h], [R - 0.008, 0.03], [0.0, 0.03]], 16).translate(x, y, z), mat);
  k.add(cyl(R - 0.01, R - 0.01, 0.004, 14).translate(x, y + h - 0.06, z), 'ceramic_white');
  for (const s of [-1, 1]) k.add(torus(0.035, 0.007, 4, 8, PI).rotateZ(s > 0 ? -PI / 2 : PI / 2).rotateX(PI / 2).translate(x + s * (R + 0.005), y + h - 0.05, z), mat);
  const a = r.range(0, TAU), lid = lathe([[0.0, 0.05], [R * 0.5, 0.04], [R + 0.01, 0.0], [R + 0.014, -0.006]], 16), knob = lathe([[0.012, 0.045], [0.014, 0.065], [0.03, 0.075], [0.0, 0.085]], 8);
  for (const g of [twoSided(lid), knob]) k.add(g.rotateZ(0.2).rotateY(a).translate(x + Math.cos(a) * 0.05, y + h + 0.035, z - Math.sin(a) * 0.05), g === knob ? 'rubber' : mat);
  return [x, y + h + 0.05, z];
}
const bowl = (k, x, y, z, R = 0.075, mat = 'ceramic_white') => k.add(lathe([[R * 0.42, 0], [R * 0.45, 0.008], [R * 0.9, R * 0.45], [R, R * 0.72], [R * 0.95, R * 0.72], [R * 0.82, R * 0.42], [0.0, 0.014]], 10).translate(x, y, z), mat);

// ---------- the props ----------
const P = {
  bench_bamboo(k, o, r) {
    const w = o.w || 1.2, d = 0.38, h = 0.45, lx = w / 2 - 0.06, lz = d / 2 - 0.04;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { bamboo(k, [sx * lx, 0, sz * lz], [sx * lx, h - 0.03, sz * lz], 0.024, 'bamboo', 0.17); lash(k, [sx * lx, h - 0.05, sz * lz], 0.034); lash(k, [sx * lx, 0.14, sz * lz], 0.03); }
    for (const sz of [-1, 1]) { bamboo(k, [-lx - 0.05, h - 0.05, sz * lz], [lx + 0.05, h - 0.05, sz * lz], 0.021); bamboo(k, [-lx, 0.14, sz * lz], [lx, 0.14, sz * lz], 0.015); }
    for (const sx of [-1, 1]) { bamboo(k, [sx * lx, h - 0.05, -lz - 0.04], [sx * lx, h - 0.05, lz + 0.04], 0.021); bamboo(k, [sx * lx, 0.14, -lz], [sx * lx, 0.14, lz], 0.015); }
    bamboo(k, [0, h - 0.06, -lz], [0, h - 0.06, lz], 0.016);
    const n = 9; for (let i = 0; i < n; i++) { const z = -d / 2 + 0.02 + (i + 0.5) * (d - 0.04) / n; k.add(cyl(0.019, 0.019, w - 0.02, 7).scale(0.5, 1, 1).rotateZ(PI / 2).translate(w / 2 - 0.01, h - 0.012 + 0.002 * (i % 2), z), 'bamboo'); }
    k.col(-w / 2, h - 0.08, -d / 2, w / 2, h, d / 2, 'wood'); return [w, h, d];
  },
  stool(k, o, r) {
    const h = 0.3;
    if ((o.seed | 0) % 2 === 0) { // low bamboo stool with a slatted round seat
      for (let i = 0; i < 4; i++) { const a = PI / 4 + i * PI / 2, x = Math.cos(a) * 0.125, z = Math.sin(a) * 0.125; bamboo(k, [x * 1.12, 0, z * 1.12], [x, h - 0.03, z], 0.017, 'bamboo', 0.12); lash(k, [x * 1.01, h - 0.06, z * 1.01], 0.024); }
      k.add(torus(0.128, 0.012, 5, 14).rotateX(PI / 2).translate(0, 0.11, 0), 'bamboo'); k.add(torus(0.15, 0.016, 5, 16).rotateX(PI / 2).translate(0, h - 0.018, 0), 'bamboo');
      for (let i = 0; i < 7; i++) { const x = -0.12 + i * 0.04, l = Math.sqrt(Math.max(0.0004, 0.145 * 0.145 - x * x)); k.add(span(x - 0.017, h - 0.022, -l, x + 0.017, h - 0.006, l), 'bamboo'); }
      k.col(-0.15, h - 0.05, -0.15, 0.15, h, 0.15, 'wood');
    } else { // the red plastic stool
      const m = o.color === 'blue' ? 'plastic_blue' : 'plastic_red', t = 0.115, b = 0.155;
      for (let i = 0; i < 4; i++) { const sx = i < 2 ? 1 : -1, sz = i % 2 ? 1 : -1; k.add(beam([sx * b, 0, sz * b], [sx * t, h - 0.02, sz * t], 0.035, 0.035), m); k.add(beam([sx * b, 0.0, sz * b], [sx * b, 0.012, sz * b], 0.05, 0.05), m); }
      k.add(span(-t - 0.02, h - 0.025, -t - 0.02, t + 0.02, h, t + 0.02), m); k.add(cyl(0.03, 0.03, 0.004, 8).translate(0, h, 0), 'rubber');
      for (let i = 0; i < 4; i++) { const g = extr([[-t, 0], [t, 0], [t * 1.12, -0.11], [t * 0.7, -0.11], ...[0.6, 0.3, 0, -0.3, -0.6].map(q => [t * q, -0.11 + 0.06 * Math.cos(q * PI / 1.2)]), [-t * 0.7, -0.11], [-t * 1.12, -0.11]], 0.006); k.add(g.rotateX(0.13).translate(0, h - 0.02, t + 0.012).rotateY(i * PI / 2), m); }
      k.col(-0.15, h - 0.05, -0.15, 0.15, h, 0.15, 'wood');
    }
    return [0.32, h, 0.32];
  },
  crate_wood(k, o, r) { const w = o.w || 0.6, h = o.h || 0.5, d = o.d || 0.45; crate(k, r, 0, 0, 0, w, h, d, 0, 'wood_dark'); k.col(-w / 2, 0, -d / 2, w / 2, h, d / 2, 'wood'); return [w, h, d]; },
  crate_stack(k, o, r) {
    const n = Math.max(2, Math.min(4, o.n | 0 || 2)), m = 'wood_dark'; let y = 0, w = 0.64, d = 0.48, x = 0;
    for (let i = 0; i < n; i++) { const h = i === 0 ? 0.5 : 0.42, yaw = i === 0 ? 0 : r.range(-0.12, 0.12); if (i) { w -= 0.1; d -= 0.06; x = -0.32 + w / 2 + 0.01; } crate(k, r, x, y, 0, w, h, d, yaw, i % 2 ? 'wood_dark' : m); k.col(x - w / 2, y, -d / 2, x + w / 2, y + h, d / 2, 'wood'); y += h; }
    k.add(tube([[0.33, 0.02, 0.1], [0.33, 0.3, 0.12], [0.3, 0.5, 0.1], [0.12, 0.52, 0.08], [0.02, 0.7, 0.1], [-0.3 + w, y + 0.005, 0.08], [-0.2, y + 0.008, 0.1], [-0.335, y - 0.1, 0.1], [-0.335, 0.03, 0.1]], 0.007, 4, 30), 'rope');
    return [0.66, y, 0.5];
  },
  basket(k, o, r) {
    const R = 0.24, h = 0.33;
    k.add(lathe([[R * 0.7, 0], [R * 0.74, 0.02], [R * 0.98, h - 0.03], [R, h], [R * 0.93, h], [R * 0.69, 0.035], [0, 0.03]], 16).translate(0, 0, 0), 'bamboo');
    k.add(torus(R * 0.985, 0.014, 5, 18).rotateX(PI / 2).translate(0, h, 0), 'bamboo'); for (const t of [0.3, 0.62]) k.add(torus(R * (0.72 + 0.26 * t) + 0.004, 0.006, 4, 16).rotateX(PI / 2).translate(0, h * t, 0), 'bamboo');
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; k.add(rod([Math.cos(a) * (R * 0.74 + 0.003), 0.02, Math.sin(a) * (R * 0.74 + 0.003)], [Math.cos(a) * (R + 0.003), h, Math.sin(a) * (R + 0.003)], 0.006, 4), 'bamboo'); }
    for (const s of [-1, 1]) k.add(torus(0.05, 0.008, 4, 8, PI).rotateY(PI / 2).translate(s * R, h, 0), 'rope');
    if ((o.seed | 0) % 3 !== 2) for (let i = 0; i < 9; i++) { const a = r.range(0, TAU), q = r.range(0, R * 0.62); k.add(sph(r.range(0.06, 0.09), 7, 5).scale(1, 0.75, 1).translate(Math.cos(a) * q, h - 0.07 + r.range(0, 0.05), Math.sin(a) * q), 'leaf'); }
    k.col(-R, 0, -R, R, h, R, 'wood'); return [0.5, h + 0.03, 0.5];
  },
  tricycle(k, o, r) {
    const fm = 'metal_green', tube1 = (a, b, rr = 0.016) => k.add(rod(a, b, rr, 7, rr, true), fm);
    // rear axle, wheels, bed
    for (const s of [-1, 1]) { wheel(k, [-0.55, 0.33, s * 0.48], 0.33, 0, { spokes: 16, hub: 0.09 }); k.add(span(-0.6, 0.33, s * 0.3 - 0.02, -0.5, 0.47, s * 0.3 + 0.02), fm); k.add(torus(0.37, 0.02, 4, 12, PI * 0.9).scale(1, 1, 3).rotateZ(0.08).translate(-0.55, 0.33, s * 0.48), fm); }
    k.add(rod([-0.55, 0.33, -0.5], [-0.55, 0.33, 0.5], 0.014, 6), 'steel');
    for (const s of [-1, 1]) k.add(beam([-1.14, 0.485, s * 0.3], [0.05, 0.485, s * 0.3], 0.035, 0.035), fm);
    for (const x of [-1.12, -0.55, 0.03]) k.add(beam([x, 0.485, -0.42], [x, 0.485, 0.42], 0.035, 0.03), fm);
    for (let i = 0; i < 7; i++) { const z = -0.42 + i * 0.12; k.add(span(-1.15, 0.5, z + 0.004, 0.05, 0.528, z + 0.116), 'wood_dark'); }
    for (const s of [-1, 1]) { k.add(span(-1.15, 0.528, s * 0.42 - 0.012, 0.05, 0.7, s * 0.42 + 0.012), fm); k.add(rod([-1.15, 0.71, s * 0.42], [0.05, 0.71, s * 0.42], 0.014, 6, 0.014, true), fm); for (const x of [-1.13, -0.55, 0.03]) k.add(span(x - 0.015, 0.5, s * 0.435 - 0.008, x + 0.015, 0.7, s * 0.435 + 0.008), fm); }
    k.add(span(0.03, 0.528, -0.42, 0.055, 0.78, 0.42), fm); k.add(rod([0.045, 0.79, -0.42], [0.045, 0.79, 0.42], 0.014, 6, 0.014, true), fm); k.add(span(-1.155, 0.528, -0.42, -1.14, 0.58, 0.42), fm);
    // cargo: a crate, two sacks, a box
    crate(k, r, -0.86, 0.528, -0.18, 0.5, 0.36, 0.4, 0.05, 'wood_dark'); sack(k, -0.86, 0.528, 0.22, 0.8, 0.1); sack(k, -0.84, 0.69, 0.2, 0.7, -0.25);
    k.add(span(-0.5, 0.528, -0.36, 0.0, 0.552, 0.36), 'cloth_white'); k.add(torus(0.09, 0.012, 5, 14).rotateX(PI / 2).translate(-0.2, 0.566, 0.2), 'rope'); k.add(torus(0.075, 0.012, 5, 14).rotateX(PI / 2).translate(-0.19, 0.588, 0.2), 'rope');
    // frame, saddle, crank and chain
    tube1([0.05, 0.5, 0.26], [0.26, 0.3, 0.03]); tube1([0.05, 0.5, -0.26], [0.26, 0.3, -0.03]); tube1([0.26, 0.3, 0], [0.19, 0.86, 0], 0.017); tube1([0.26, 0.3, 0], [0.7, 0.74, 0], 0.018); tube1([0.2, 0.78, 0], [0.67, 0.93, 0], 0.016); tube1([0.05, 0.72, 0], [0.2, 0.74, 0]);
    k.add(rod([0.71, 0.66, 0], [0.64, 1.02, 0], 0.022, 8, 0.022, true), fm);
    k.add(sph(0.13, 10, 6).scale(1.25, 0.32, 0.85).translate(0.16, 0.925, 0), 'rubber'); k.add(sph(0.06, 8, 5).scale(1.6, 0.4, 0.8).translate(0.3, 0.92, 0), 'rubber'); for (const s of [-1, 1]) k.add(cyl(0.016, 0.016, 0.05, 6).translate(0.1, 0.86, s * 0.05), 'steel');
    k.add(cyl(0.1, 0.1, 0.005, 18).rotateX(PI / 2).translate(0.26, 0.3, 0.06), 'steel'); k.add(cyl(0.045, 0.045, 0.006, 10).rotateX(PI / 2).translate(-0.55, 0.33, 0.06), 'steel'); k.add(cyl(0.028, 0.028, 0.15, 8).rotateX(PI / 2).translate(0.26, 0.3, -0.075), 'steel');
    k.add(beam([0.26, 0.4, 0.063], [-0.55, 0.375, 0.063], 0.008, 0.012), 'steel'); k.add(beam([0.26, 0.2, 0.063], [-0.55, 0.285, 0.063], 0.008, 0.012), 'steel');
    for (const s of [-1, 1]) { const px = 0.26 + s * 0.1, py = 0.3 - s * 0.13; k.add(beam([0.26, 0.3, s * 0.085], [px, py, s * 0.085], 0.012, 0.024), 'steel'); k.add(span(px - 0.045, py - 0.012, s * 0.09, px + 0.045, py + 0.012, s * 0.18), 'rubber'); }
    // fork, front wheel, mudguard, handlebar
    const yaw = 0.3, fx = 0.86, c = Math.cos(yaw), sn = Math.sin(yaw);
    wheel(k, [fx, 0.33, 0], 0.33, yaw, { spokes: 16 });
    for (const s of [-1, 1]) k.add(rod([0.71, 0.66, 0], [fx + s * sn * 0.05, 0.33, s * c * 0.05], 0.013, 6), fm);
    k.add(torus(0.365, 0.016, 4, 14, PI * 0.8).scale(1, 1, 2.6).rotateZ(0.25).rotateY(yaw).translate(fx, 0.33, 0), fm);
    k.add(tube([[0.5, 1.1, -0.3 * c + 0.03], [0.6, 1.07, -0.2], [0.64, 1.04, 0], [0.62, 1.07, 0.2], [0.52, 1.1, 0.3]].map(p => [0.64 + (p[0] - 0.64) * c + p[2] * sn, p[1], -(p[0] - 0.64) * sn + p[2] * c]), 0.012, 6, 16), 'steel');
    for (const s of [-1, 1]) { const p = [0.51, 1.1, s * 0.3], q = [0.43, 1.105, s * 0.31]; k.add(rod([0.64 + (p[0] - 0.64) * c + p[2] * sn, p[1], -(p[0] - 0.64) * sn + p[2] * c], [0.64 + (q[0] - 0.64) * c + q[2] * sn, q[1], -(q[0] - 0.64) * sn + q[2] * c], 0.017, 7, 0.017, true), 'rubber'); }
    k.add(sph(0.03, 8, 5).scale(1, 0.7, 1).translate(0.66, 1.1, 0.12), 'steel');
    k.col(-1.15, 0.3, -0.44, 0.05, 0.552, 0.44, 'wood'); k.col(-1.11, 0.552, -0.38, -0.61, 0.888, 0.02, 'wood'); k.col(-1.1, 0.552, 0.04, -0.6, 0.8, 0.4, 'cloth'); k.col(0.05, 0, -0.07, 1.19, 0.95, 0.07, 'metal');
    for (const s of [-1, 1]) k.col(-0.88, 0, s * 0.48 - 0.04, -0.22, 0.66, s * 0.48 + 0.04, 'metal');
    return [2.35, 1.12, 1.04];
  },
  bicycle(k, o, r) {
    const fm = (o.seed | 0) % 2 ? 'plastic_blue' : 'metal_green', kk = new Kit(k.G, k.seed), T = (a, b, rr = 0.014) => kk.add(rod(a, b, rr, 7, rr, true), fm), hubR = [-0.55, 0.34], hubF = [0.56, 0.34], bbx = [-0.08, 0.3];
    wheel(kk, [hubR[0], hubR[1], 0], 0.34, 0, { spokes: 18 }); wheel(kk, [hubF[0], hubF[1], 0], 0.34, 0.22, { spokes: 18 });
    T([bbx[0], bbx[1], 0], [-0.2, 0.82, 0], 0.015); T([-0.19, 0.76, 0], [0.31, 0.86, 0], 0.014); T([0.34, 0.68, 0], [bbx[0], bbx[1], 0], 0.016); kk.add(rod([0.37, 0.6, 0], [0.29, 0.94, 0], 0.019, 8, 0.019, true), fm);
    for (const s of [-1, 1]) { T([bbx[0], bbx[1], s * 0.03], [hubR[0], hubR[1], s * 0.055], 0.009); T([-0.2, 0.76, s * 0.02], [hubR[0], hubR[1], s * 0.055], 0.008); T([0.37, 0.6, 0], [hubF[0] + s * 0.011, hubF[1], s * 0.05], 0.011); }
    for (const [hx, a0, yw] of [[hubR[0], 0.55, 0], [hubF[0], 0.2, 0.22]]) kk.add(torus(0.372, 0.014, 4, 14, PI * 0.72).scale(1, 1, 2.4).rotateZ(a0).rotateY(yw).translate(hx, 0.34, 0), fm);
    kk.add(sph(0.12, 10, 6).scale(1.3, 0.3, 0.8).translate(-0.24, 0.9, 0), 'rubber'); kk.add(sph(0.05, 8, 5).scale(1.6, 0.45, 0.8).translate(-0.1, 0.895, 0), 'rubber'); for (const s of [-1, 1]) kk.add(cyl(0.014, 0.014, 0.05, 6).translate(-0.3, 0.84, s * 0.045), 'steel');
    kk.add(rod([0.29, 0.94, 0], [0.26, 1.03, 0], 0.011, 6), 'steel'); kk.add(tube([[0.1, 1.0, -0.27], [0.24, 1.03, -0.2], [0.3, 1.03, 0], [0.24, 1.03, 0.2], [0.1, 1.0, 0.27]], 0.011, 6, 16), 'steel'); for (const s of [-1, 1]) kk.add(rod([0.11, 1.0, s * 0.27], [0.02, 0.99, s * 0.275], 0.016, 7, 0.016, true), 'rubber');
    kk.add(sph(0.028, 8, 5).scale(1, 0.7, 1).translate(0.2, 1.06, 0.16), 'steel'); kk.add(cyl(0.045, 0.03, 0.06, 8).rotateZ(-PI / 2).translate(0.36, 0.8, 0), 'steel');
    kk.add(cyl(0.095, 0.095, 0.005, 18).rotateX(PI / 2).translate(bbx[0], bbx[1], 0.05), 'steel'); kk.add(cyl(0.04, 0.04, 0.006, 10).rotateX(PI / 2).translate(hubR[0], hubR[1], 0.05), 'steel'); kk.add(cyl(0.024, 0.024, 0.12, 8).rotateX(PI / 2).translate(bbx[0], bbx[1], -0.06), 'steel');
    kk.add(extr([[bbx[0] + 0.11, bbx[1] + 0.02], [bbx[0] + 0.06, bbx[1] + 0.12], [hubR[0], hubR[1] + 0.07], [hubR[0] - 0.05, hubR[1] + 0.02], [hubR[0], hubR[1] - 0.03], [bbx[0], bbx[1] + 0.0]], 0.006).translate(0, 0, 0.062), fm);
    kk.add(beam([bbx[0], bbx[1] - 0.09, 0.053], [hubR[0], hubR[1] - 0.04, 0.053], 0.007, 0.011), 'steel');
    for (const s of [-1, 1]) { const px = bbx[0] + s * 0.06, py = bbx[1] - s * 0.15; kk.add(beam([bbx[0], bbx[1], s * 0.072], [px, py, s * 0.072], 0.011, 0.022), 'steel'); kk.add(span(px - 0.04, py - 0.011, s * 0.078, px + 0.04, py + 0.011, s * 0.16), 'rubber'); }
    // rear rack and stand
    for (const s of [-1, 1]) { kk.add(rod([-0.86, 0.7, s * 0.07], [-0.3, 0.7, s * 0.07], 0.007, 5), 'steel'); kk.add(rod([-0.8, 0.7, s * 0.07], [hubR[0], hubR[1], s * 0.065], 0.006, 5), 'steel'); }
    for (const x of [-0.86, -0.67, -0.48, -0.3]) kk.add(rod([x, 0.7, -0.07], [x, 0.7, 0.07], 0.006, 5), 'steel'); kk.add(rod([-0.3, 0.7, 0], [-0.21, 0.78, 0], 0.007, 5), 'steel');
    kk.add(rod([bbx[0] - 0.06, bbx[1] - 0.02, 0.03], [bbx[0] - 0.2, 0.0, 0.24], 0.009, 5, 0.009, true), 'steel');
    const lean = 0.13, g = kk.finish('bike', { grime: 0 }); for (const m of g.children) { m.geometry.rotateX(lean); k.add(m.geometry, m.material.name === 'arch_glow' ? '#glow' : m.name.split(':')[1]); }
    k.col(-0.9, 0, -0.07, 0.9, 0.8, 0.09, 'metal'); return [1.82, 1.08, 0.6];
  },
  planter(k, o, r) {
    const w = o.w || 0.9, h = 0.3, d = 0.34;
    k.add(extr([[-d / 2 + 0.03, 0], [d / 2 - 0.03, 0], [d / 2, h], [d / 2 - 0.035, h], [d / 2 - 0.06, 0.05], [-d / 2 + 0.06, 0.05], [-d / 2 + 0.035, h], [-d / 2, h]], w - 0.07).rotateY(-PI / 2).translate(w / 2 - 0.035, 0, 0), 'concrete');
    for (const s of [-1, 1]) { k.add(extr([[-d / 2 + 0.03, 0], [d / 2 - 0.03, 0], [d / 2, h], [-d / 2, h]], 0.035).rotateY(-PI / 2).translate(s > 0 ? w / 2 : -w / 2 + 0.035, 0, 0), 'concrete'); k.add(span(s * (w / 2 - 0.12) - 0.05, -0.0, -d / 2 + 0.02, s * (w / 2 - 0.12) + 0.05, 0.0, d / 2 - 0.02), 'concrete'); }
    k.add(span(-w / 2, h - 0.02, -d / 2 - 0.012, w / 2, h + 0.012, -d / 2 + 0.02), 'concrete'); k.add(span(-w / 2, h - 0.02, d / 2 - 0.02, w / 2, h + 0.012, d / 2 + 0.012), 'concrete');
    k.add(quadUp(-w / 2 + 0.035, -d / 2 + 0.035, w / 2 - 0.035, d / 2 - 0.035, h - 0.04), 'soil');
    const n = Math.max(3, Math.round(w / 0.2)); for (let i = 0; i < n; i++) { const x = -w / 2 + 0.12 + i * (w - 0.24) / (n - 1), kind = (i + (o.seed | 0)) % 3; plant(k, r, x, h - 0.04, r.range(-0.04, 0.04), kind === 2 ? 7 : 9, kind === 2 ? 0.5 : r.range(0.26, 0.4), kind === 1 ? 0.1 : 0.045, kind); if (kind !== 0) for (let j = 0; j < 3; j++) k.add(sph(0.028, 6, 4).translate(x + r.range(-0.1, 0.1), h + r.range(0.1, 0.32), r.range(-0.09, 0.09)), 'plastic_red'); }
    k.col(-w / 2, 0, -d / 2, w / 2, h, d / 2, 'stone'); return [w, 0.72, d + 0.1];
  },
  potted_plant(k, o, r) {
    const pm = (o.seed | 0) % 2 ? 'ceramic_white' : 'ceramic_blue', R = 0.17, h = 0.3;
    k.add(lathe([[R * 0.62, 0], [R * 0.66, 0.012], [R * 0.7, 0.03], [R * 0.98, h - 0.045], [R * 1.06, h - 0.04], [R * 1.08, h], [R * 0.94, h], [R * 0.9, h - 0.05], [0, h - 0.06]], 16), pm);
    k.add(lathe([[R * 0.8, 0], [R * 0.95, 0.006], [R * 1.0, 0.03], [R * 0.93, 0.03], [R * 0.8, 0.014]], 16), pm); k.add(cyl(R * 0.9, R * 0.9, 0.004, 14).translate(0, h - 0.045, 0), 'soil');
    const kind = (o.seed | 0) % 3;
    if (kind === 0) { for (let s = 0; s < 3; s++) { const a = s * 2.1 + r.range(0, 1), bx = Math.cos(a) * 0.04, bz = Math.sin(a) * 0.04, L = r.range(0.34, 0.5); k.add(rod([bx, h - 0.05, bz], [bx * 2, h + L * 0.8, bz * 2], 0.008, 5, 0.005), 'leaf'); for (let j = 0; j < 4; j++) { const g = blade(r.range(0.16, 0.24), 0.11, 0.3); g.rotateX(r.range(0.7, 1.2)).rotateY(a + j * 1.7); k.add(g.translate(bx * (1 + j * 0.25), h + L * (0.2 + 0.2 * j), bz * (1 + j * 0.25)), 'leaf'); } } }
    else if (kind === 1) { plant(k, r, 0, h - 0.05, 0, 14, 0.5, 0.05, 0); for (let j = 0; j < 4; j++) { const a = r.range(0, TAU); k.add(rod([0, h, 0], [Math.cos(a) * 0.08, h + 0.36, Math.sin(a) * 0.08], 0.004, 4), 'leaf'); k.add(sph(0.035, 6, 5).scale(1, 0.8, 1).translate(Math.cos(a) * 0.085, h + 0.38, Math.sin(a) * 0.085), 'plastic_red'); } }
    else { k.add(rod([0, h - 0.05, 0], [0.01, h + 0.26, 0], 0.012, 6, 0.008), 'rope'); for (let j = 0; j < 12; j++) { const a = r.range(0, TAU), el = r.range(-0.3, 1.2), rr = 0.14, c = [Math.cos(a) * Math.cos(el) * rr, h + 0.36 + Math.sin(el) * rr * 0.9, Math.sin(a) * Math.cos(el) * rr]; const g = blade(0.12, 0.07, 0.3); g.rotateX(1.1 - el * 0.5).rotateY(-a + PI / 2); k.add(g.translate(c[0] * 0.6, c[1], c[2] * 0.6), 'leaf'); if (j % 2) k.add(sph(0.02, 6, 4).translate(c[0], c[1] - 0.03, c[2]), 'plastic_red'); } k.add(sph(0.13, 8, 6).scale(1, 0.85, 1).translate(0, h + 0.36, 0), 'leaf'); }
    k.col(-R, 0, -R, R, h, R, 'stone'); return [0.42, 0.82, 0.42];
  },
  lantern_paper(k, o, r) { const R = (o.r || 0.15); lantern(k, 0, R * 1.52, 0, R, (o.seed | 0) % 2 ? 'brass' : 'wood_red'); const g = k; g.hang = [0, R * 2.82, 0]; return [R * 2.2, R * 2.82, R * 2.2]; },
  lantern_string(k, o, r) {
    const w = o.w || o.length || 4, n = o.n || Math.max(3, Math.round(w / 0.62)), drop = o.sag == null ? 0.16 : o.sag, R = 0.1, top = 0.5, pts = sag([-w / 2, top, 0], [w / 2, top, 0], drop, 20);
    k.add(tube(pts, 0.006, 4, 40), 'rope'); const C = [[4.2, 0.6, 0.8], [0.5, 3.4, 1.6], [4.2, 2.6, 0.5], [0.5, 2.6, 4.0]];
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, x = -w / 2 + w * t, y = top - drop * 4 * t * (1 - t); lantern(k, x, y - R * 1.3, 0, R); const t2 = (i + 1) / n; if (i < n - 1) { const x2 = -w / 2 + w * t2, y2 = top - drop * 4 * t2 * (1 - t2); k.add(cyl(0.012, 0.012, 0.03, 5).translate(x2, y2 - 0.03, 0), 'rope'); k.glow(sph(0.022, 6, 5).scale(1, 1.3, 1).translate(x2, y2 - 0.055, 0), C[i % 4]); } }
    k.bulbs = n - 1; return [w, top, R * 2.2];
  },
  awning(k, o, r) {
    const w = o.w || 3.6, d = o.d || 1.6, drop = d * 0.22, col = o.color || ['red', 'green', 'stripe'][(o.seed | 0) % 3], m = /green/.test(col) ? 'awning_green' : /strip/.test(col) ? 'awning_stripe' : 'awning_red', yb = drop / 2, yf = -drop / 2, zb = d / 2, zf = -d / 2;
    const nb = Math.max(2, Math.round(w / 1.2)) + 1, prof = []; for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push([zb + (zf - zb) * t, yb + (yf - yb) * t - 0.03 * Math.sin(PI * t)]); }
    // cloth panels that sag a little between the rafters
    for (let b = 0; b < nb - 1; b++) { const x0 = -w / 2 + b * w / (nb - 1), x1 = x0 + w / (nb - 1), xm = (x0 + x1) / 2, pm = prof.map(p => [p[0], p[1] - 0.025 * Math.sin(PI * (zb - p[0]) / d)]); const gs = []; for (let i = 0; i < 8; i++) { gs.push(quad([x0, prof[i][1], prof[i][0]], [xm, pm[i][1], pm[i][0]], [xm, pm[i + 1][1], pm[i + 1][0]], [x0, prof[i + 1][1], prof[i + 1][0]])); gs.push(quad([xm, pm[i][1], pm[i][0]], [x1, prof[i][1], prof[i][0]], [x1, prof[i + 1][1], prof[i + 1][0]], [xm, pm[i + 1][1], pm[i + 1][0]])); } const g = mergeGeos(gs), uv = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getZ(i)); k.add(twoSided(g), m); }
    // scalloped valance
    const ns = Math.max(3, Math.round(w / 0.3)), sw = w / ns, val = [[-w / 2, 0]]; for (let i = 0; i < ns; i++) for (let j = 1; j <= 6; j++) { const t = j / 6; val.push([-w / 2 + (i + t) * sw, -0.15 - 0.07 * Math.sin(PI * t)]); } val.push([w / 2, 0]);
    const vg = new THREE.ShapeGeometry(new THREE.Shape(val.map(p => new THREE.Vector2(p[0], p[1]))), 4); k.add(twoSided(vg).translate(0, yf + 0.005, zf - 0.004), m);
    for (let i = 0; i < 2; i++) { const s = i ? 1 : -1; k.add(twoSided(quad([s * w / 2, yf - 0.15, zf], [s * w / 2, yb - 0.15 * 0.3, zb], [s * w / 2, yb, zb], [s * w / 2, yf, zf])), m); }
    // iron frame: wall rail, front bar, rafters, stays
    const fr = 'metal_rust'; k.add(rod([-w / 2, yb - 0.02, zb - 0.02], [w / 2, yb - 0.02, zb - 0.02], 0.016, 6, 0.016, true), fr); k.add(rod([-w / 2, yf - 0.02, zf + 0.01], [w / 2, yf - 0.02, zf + 0.01], 0.016, 6, 0.016, true), fr);
    for (let b = 0; b < nb; b++) { const x = -w / 2 + b * w / (nb - 1) + (b === 0 ? 0.01 : b === nb - 1 ? -0.01 : 0); k.add(rod([x, yb - 0.02, zb - 0.02], [x, yf - 0.02, zf + 0.01], 0.012, 5), fr); if (b === 0 || b === nb - 1 || nb > 3 && b === (nb >> 1)) { k.add(rod([x, yb - 0.55, zb - 0.01], [x, yf + 0.06, zf + d * 0.25], 0.011, 5), fr); k.add(span(x - 0.03, yb - 0.6, zb - 0.012, x + 0.03, yb - 0.5, zb), fr); k.add(span(x - 0.03, yb - 0.06, zb - 0.012, x + 0.03, yb + 0.03, zb), fr); } }
    const nsx = 4; for (let i = 0; i < nsx; i++) { const z0 = zb + (zf - zb) * i / nsx, z1 = zb + (zf - zb) * (i + 1) / nsx, yt = yb + (yf - yb) * (i + 0.5) / nsx; k.col(-w / 2, yt - 0.06, z1, w / 2, yt, z0, 'cloth', true); }
    return [w, 0.5, d];
  },
  drying_rack(k, o, r) {
    const w = o.w || 1.4, h = 1.08, ex = w / 2 - 0.08, hooks = [];
    for (const s of [-1, 1]) { bamboo(k, [s * ex, 0, -0.24], [s * ex, h + 0.08, 0.05], 0.019); bamboo(k, [s * ex + 0.012, 0, 0.24], [s * ex + 0.012, h + 0.08, -0.05], 0.019); lash(k, [s * ex + 0.006, h - 0.015, 0], 0.036); bamboo(k, [s * ex + 0.03, 0.3, -0.16], [s * ex + 0.03, 0.3, 0.16], 0.013); }
    bamboo(k, [-w / 2, h + 0.02, 0], [w / 2, h + 0.02, 0], 0.02, 'bamboo', 0.3); bamboo(k, [-ex, 0.62, -0.085], [ex, 0.62, -0.085], 0.014, 'bamboo', 0.3); for (const s of [-1, 1]) lash(k, [s * ex, 0.62, -0.085], 0.026);
    const nH = 4; for (let i = 0; i < nH; i++) { const x = -ex + 0.22 + i * (2 * ex - 0.44) / (nH - 1); hooks.push([x, h - 0.035, 0]); k.add(torus(0.022, 0.004, 4, 8).translate(x, h - 0.012, 0), 'rope'); }
    // bunches of dried greens on the lower rail
    for (let i = 0; i < 3; i++) { const x = -ex + 0.3 + i * 0.36 + r.range(-0.04, 0.04); k.add(torus(0.018, 0.004, 4, 6).translate(x, 0.6, -0.085), 'rope'); for (let j = 0; j < 6; j++) { const g = blade(r.range(0.2, 0.3), 0.035, 0.2); g.rotateX(PI - r.range(0.02, 0.22)).rotateY(j * 1.05 + r.range(0, 0.5)); k.add(g.translate(x, 0.6, -0.085), 'rope'); } }
    const nf = o.fish | 0; for (let i = 0; i < nf && i < nH; i++) fish(k, hooks[i][0], hooks[i][1] - 0.36, 0, r.range(-0.5, 0.5));
    k.hooks = hooks; for (const s of [-1, 1]) k.col(s * ex - 0.04, 0, -0.25, s * ex + 0.05, h + 0.05, 0.25, 'wood'); return [w, h + 0.1, 0.52];
  },
  salted_fish(k, o, r) { fish(k, 0, 0, 0, 0); k.hang = [0, 0.36, 0]; return [0.13, 0.36, 0.05]; },
  congee_stall(k, o, r) {
    const W2 = 0.9, D2 = 0.45, ct = 0.86, wd = 'wood_dark', st = 'steel', top = 1.8;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { k.add(bb(0.045, top - (sx > 0 ? 0.22 : 0), 0.045, sx * (W2 - 0.03), sx > 0 ? 0.22 : 0, sz * (D2 - 0.03)), wd); if (sx < 0) k.add(bb(0.06, 0.02, 0.06, sx * (W2 - 0.03), 0, sz * (D2 - 0.03)), 'rubber'); }
    k.add(span(-W2, ct - 0.04, -D2, W2, ct, D2), st); k.add(span(-W2 - 0.01, ct, -D2 - 0.01, W2 + 0.01, ct + 0.025, -D2 + 0.02), st); for (const s of [-1, 1]) k.add(span(s * W2 - 0.015, ct, -D2, s * W2 + 0.015, ct + 0.025, D2), st);
    k.add(span(-W2 + 0.03, 0.3, -D2 + 0.01, W2 - 0.03, ct - 0.04, -D2 + 0.03), st); for (const s of [-1, 1]) k.add(span(s * (W2 - 0.02) - 0.01, 0.3, -D2 + 0.03, s * (W2 - 0.02) + 0.01, ct - 0.04, D2 - 0.05), st);
    for (let i = 0; i < 5; i++) k.add(span(-W2 + 0.06 + i * 0.345, 0.34, -D2 + 0.004, -W2 + 0.36 + i * 0.345, ct - 0.09, -D2 + 0.01), 'metal_green');
    k.add(span(-W2 + 0.03, 0.27, -D2 + 0.03, W2 - 0.03, 0.3, D2 - 0.03), wd); for (const s of [-1, 1]) { k.add(beam([-W2 + 0.03, 0.25, s * (D2 - 0.03)], [W2 - 0.03, 0.25, s * (D2 - 0.03)], 0.04, 0.05), wd); k.add(beam([-W2 + 0.03, top - 0.03, s * (D2 - 0.03)], [W2 - 0.03, top - 0.03, s * (D2 - 0.03)], 0.04, 0.04), wd); }
    for (const s of [-1, 1]) k.add(beam([s * (W2 - 0.03), top - 0.03, -D2 + 0.03], [s * (W2 - 0.03), top - 0.03, D2 - 0.03], 0.04, 0.04), wd);
    // wheels at one end, push handles at the other
    for (const s of [-1, 1]) { wheel(k, [W2 - 0.1, 0.22, s * (D2 + 0.04)], 0.22, 0, { spokes: 10, tyre: 0.025, hub: 0.06 }); k.add(rod([-W2, ct - 0.1, s * (D2 - 0.05)], [-W2 - 0.3, ct - 0.02, s * (D2 - 0.05)], 0.016, 6, 0.016, true), wd); }
    k.add(rod([W2 - 0.1, 0.22, -D2 - 0.06], [W2 - 0.1, 0.22, D2 + 0.06], 0.012, 6), st);
    // under the counter: gas bottle, bucket, hose
    k.add(lathe([[0.1, 0], [0.13, 0.01], [0.13, 0.04], [0.15, 0.06], [0.15, 0.36], [0.11, 0.44], [0.05, 0.47], [0.05, 0.5]], 14).translate(-0.48, 0.3, 0.12), 'metal_rust'); k.add(torus(0.07, 0.008, 4, 12).rotateX(PI / 2).translate(-0.48, 0.82, 0.12), 'metal_rust'); for (let i = 0; i < 3; i++) k.add(bb(0.012, 0.05, 0.02, -0.48 + Math.cos(i * 2.1) * 0.07, 0.78, 0.12 + Math.sin(i * 2.1) * 0.07), 'metal_rust');
    k.add(tube([[-0.48, 0.8, 0.12], [-0.4, 0.84, 0.2], [-0.3, 0.8, 0.3], [-0.36, 0.86, 0.36]], 0.008, 4, 12), 'rubber');
    k.add(twoSided(lathe([[0.12, 0], [0.15, 0.24]], 12)).translate(0.3, 0.3, 0.1), st); k.add(cyl(0.12, 0.12, 0.004, 12).translate(0.3, 0.3, 0.1), st); k.add(torus(0.15, 0.006, 4, 14).rotateX(PI / 2).translate(0.3, 0.54, 0.1), st);
    // two gas rings and two big pots, lids ajar
    const steam = [];
    for (const px of [-0.5, 0.02]) { k.add(torus(0.15, 0.012, 5, 16).rotateX(PI / 2).translate(px, ct + 0.085, 0.08), 'metal_rust'); for (let i = 0; i < 3; i++) k.add(beam([px + Math.cos(i * 2.09) * 0.15, ct, 0.08 + Math.sin(i * 2.09) * 0.15], [px + Math.cos(i * 2.09) * 0.07, ct + 0.09, 0.08 + Math.sin(i * 2.09) * 0.07], 0.016, 0.012), 'metal_rust'); k.add(cyl(0.05, 0.06, 0.05, 8).translate(px, ct, 0.08), 'metal_rust'); for (let i = 0; i < 10; i++) k.glow(cyl(0.004, 0.012, 0.035, 4).translate(px + Math.cos(i * 0.628) * 0.085, ct + 0.05, 0.08 + Math.sin(i * 0.628) * 0.085), [0.5, 1.2, 4.5]); steam.push(pot(k, r, px, ct + 0.098, 0.08, 0.21, 0.3)); }
    // ladle in the second pot, bowls, condiments
    k.add(rod([0.1, ct + 0.36, 0.1], [0.4, ct + 0.62, -0.02], 0.007, 5, 0.007, true), st); k.add(twoSided(sph(0.05, 8, 4)).scale(1, 0.8, 1).translate(0.1, ct + 0.36, 0.1), st);
    for (let i = 0; i < 6; i++) bowl(k, 0.62, ct + i * 0.022, 0.2); for (let i = 0; i < 3; i++) { bowl(k, 0.38 + i * 0.19, ct, -0.3); k.add(cyl(0.062, 0.062, 0.003, 10).translate(0.38 + i * 0.19, ct + 0.045, -0.3), 'ceramic_white'); for (let j = 0; j < 4; j++) k.add(span(-0.008, 0, -0.004, 0.008, 0.004, 0.004).rotateY(j * 1.3).translate(0.38 + i * 0.19 + r.range(-0.03, 0.03), ct + 0.047, -0.3 + r.range(-0.03, 0.03)), 'leaf'); }
    for (let i = 0; i < 3; i++) { k.add(lathe([[0.03, 0], [0.04, 0.02], [0.04, 0.06], [0.028, 0.075], [0.028, 0.09]], 8).translate(-0.76, ct, -0.3 + i * 0.11), 'ceramic_white'); k.add(cyl(0.03, 0.03, 0.012, 8).translate(-0.76, ct + 0.09, -0.3 + i * 0.11), 'metal_rust'); }
    k.add(span(0.5, ct, 0.0, 0.84, ct + 0.012, 0.36), wd); k.add(span(-0.2, ct, -0.4, 0.2, ct + 0.01, -0.22), 'cloth_white');
    // the little roof with a scalloped front, and a bulb
    const zb = D2 + 0.08, zf = -D2 - 0.2, yb = top + 0.16, yf = top - 0.04, prof = [[zb, yb], [(zb + zf) / 2, (yb + yf) / 2 - 0.02], [zf, yf]];
    k.add(twoSided(stripX(prof, -W2 - 0.08, W2 + 0.08)), 'awning_stripe'); const g = k.by.get('awning_stripe').pop(), uv = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i), p.getZ(i)); k.add(g, 'awning_stripe');
    const ns = 9, sw = (W2 * 2 + 0.16) / ns, val = [[-W2 - 0.08, 0]]; for (let i = 0; i < ns; i++) for (let j = 1; j <= 5; j++) { const t = j / 5; val.push([-W2 - 0.08 + (i + t) * sw, -0.11 - 0.05 * Math.sin(PI * t)]); } val.push([W2 + 0.08, 0]);
    k.add(twoSided(new THREE.ShapeGeometry(new THREE.Shape(val.map(q => new THREE.Vector2(q[0], q[1]))), 4)).translate(0, yf, zf), 'awning_stripe');
    for (const s of [-1, 1]) { k.add(beam([s * (W2 - 0.03), top, D2 - 0.03], [s * (W2 - 0.03), yb - 0.01, zb - 0.02], 0.03, 0.03), wd); k.add(beam([s * (W2 - 0.03), yb - 0.015, zb - 0.01], [s * (W2 - 0.03), yf - 0.015, zf + 0.01], 0.03, 0.03), wd); } k.add(beam([-W2 - 0.06, yf - 0.015, zf + 0.01], [W2 + 0.06, yf - 0.015, zf + 0.01], 0.03, 0.03), wd); k.add(beam([-W2 - 0.06, yb - 0.015, zb - 0.01], [W2 + 0.06, yb - 0.015, zb - 0.01], 0.03, 0.03), wd);
    k.add(rod([0.25, top - 0.26, -0.1], [0.25, top + 0.04, -0.1], 0.004, 4), 'rubber'); k.glow(sph(0.045, 8, 6).translate(0.25, top - 0.3, -0.1), WARM); k.add(twoSided(lathe([[0.15, 0], [0.05, 0.07], [0.025, 0.1]], 12)).translate(0.25, top - 0.31, -0.1), 'metal_green');
    k.steam = steam; k.lamp = [0.25, top - 0.3, -0.1];
    k.col(-W2, 0, -D2, W2, ct + 0.02, D2, 'metal'); k.col(-W2 - 0.08, top - 0.05, zf, W2 + 0.08, top + 0.08, zb, 'cloth', true); return [2.1, yb + 0.02, 1.2];
  },
  pot_steaming(k, o, r) {
    k.add(lathe([[0.17, 0], [0.19, 0.02], [0.2, 0.16], [0.17, 0.19], [0.14, 0.19], [0.15, 0.04], [0, 0.04]], 14), 'metal_rust'); for (let i = 0; i < 3; i++) k.add(bb(0.03, 0.035, 0.05, Math.cos(i * 2.09 + 0.5) * 0.15, 0.19, Math.sin(i * 2.09 + 0.5) * 0.15), 'metal_rust');
    k.glow(cyl(0.13, 0.13, 0.01, 12).translate(0, 0.1, 0), [3.2, 1.0, 0.25]); k.glow(span(-0.06, 0.045, -0.202, 0.06, 0.12, -0.19), [3.6, 1.3, 0.3]); k.add(span(-0.075, 0.035, -0.205, 0.075, 0.045, -0.185), 'metal_rust'); k.add(span(-0.075, 0.12, -0.205, 0.075, 0.13, -0.185), 'metal_rust');
    const s = pot(k, r, 0, 0.225, 0, 0.19, 0.22); k.steam = [s]; k.col(-0.2, 0, -0.2, 0.2, 0.46, 0.2, 'metal'); return [0.46, 0.52, 0.46];
  },
  urn_copper(k, o, r) {
    const pr = [[0.13, 0.05], [0.15, 0.06], [0.16, 0.085], [0.2, 0.14], [0.235, 0.22], [0.24, 0.29], [0.215, 0.37], [0.15, 0.44], [0.115, 0.485], [0.12, 0.51], [0.15, 0.56], [0.16, 0.615], [0.14, 0.675], [0.09, 0.72], [0.055, 0.745], [0.05, 0.77]];
    k.add(lathe(pr, 18), 'copper'); k.add(lathe([[0.06, 0.77], [0.07, 0.775], [0.065, 0.79], [0.03, 0.8], [0.02, 0.82], [0.035, 0.84], [0.02, 0.86], [0.0, 0.865]], 12), 'brass');
    for (const [y, R] of [[0.495, 0.122], [0.105, 0.178], [0.3, 0.243], [0.615, 0.163]]) k.add(torus(R, 0.008, 5, 20).rotateX(PI / 2).translate(0, y, 0), 'brass');
    k.add(lathe([[0.16, 0], [0.17, 0.012], [0.14, 0.03], [0.13, 0.05]], 16), 'brass'); for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; k.add(lathe([[0.02, 0], [0.03, 0.01], [0.025, 0.03]], 6).translate(Math.cos(a) * 0.14, -0.0, Math.sin(a) * 0.14), 'brass'); }
    // tap low on the front (-Z), ring handles on the shoulders
    k.add(rod([0, 0.15, -0.2], [0, 0.14, -0.3], 0.014, 7, 0.011, true), 'brass'); k.add(rod([0, 0.14, -0.29], [0, 0.105, -0.3], 0.009, 6, 0.009, true), 'brass'); k.add(rod([0, 0.15, -0.265], [0, 0.2, -0.265], 0.006, 5), 'brass'); k.add(rod([-0.03, 0.2, -0.265], [0.03, 0.2, -0.265], 0.007, 5, 0.007, true), 'brass');
    for (const s of [-1, 1]) { k.add(sph(0.022, 6, 5).translate(s * 0.158, 0.63, 0), 'brass'); k.add(torus(0.04, 0.006, 4, 12).rotateY(PI / 2).rotateZ(s * 0.35).translate(s * 0.185, 0.6, 0), 'brass'); }
    k.col(-0.22, 0, -0.22, 0.22, 0.86, 0.22, 'metal'); return [0.5, 0.87, 0.52];
  },
  shelf_goods(k, o, r) {
    const w = o.w || 1.6, h = 1.8, d = 0.38, wd = 'wood_dark', M = ['plastic_red', 'cardboard', 'plastic_blue', 'ceramic_white', 'cardboard', 'ceramic_blue'];
    for (const s of [-1, 0, 1]) k.add(span(s * (w / 2 - 0.02) - 0.02, 0, -d / 2, s * (w / 2 - 0.02) + 0.02, h, d / 2), wd); k.add(span(-w / 2, 0.06, d / 2 - 0.012, w / 2, h, d / 2), wd); k.add(span(-w / 2 - 0.02, h, -d / 2 - 0.02, w / 2 + 0.02, h + 0.03, d / 2), wd);
    for (let s = 0; s < 5; s++) { const y = 0.1 + s * 0.4; k.add(span(-w / 2, y - 0.025, -d / 2, w / 2, y, d / 2 - 0.01), wd); if (s === 4) break;
      for (let x = -w / 2 + 0.06; x < w / 2 - 0.2;) { const iw = r.range(0.08, 0.2), ih = r.range(0.12, 0.33), m = r.pick(M), n = r() < 0.5 ? r.int(2, 4) : 1, round = r() < 0.4; for (let q = 0; q < n && x < w / 2 - 0.2; q++) { if (Math.abs(x + iw / 2) > iw / 2 + 0.03) { if (round) { k.add(cyl(iw / 2, iw / 2, ih, 8).translate(x + iw / 2, y, -0.02), m); k.add(cyl(iw * 0.3, iw * 0.42, 0.025, 8).translate(x + iw / 2, y + ih, -0.02), 'plastic_red'); } else k.add(span(x, y, -d / 2 + 0.03 + r.range(0, 0.05), x + iw, y + ih, d / 2 - 0.05), m); } x += iw + 0.012; } x += r.range(0, 0.06); } }
    k.col(-w / 2, 0, -d / 2, w / 2, h + 0.03, d / 2, 'wood'); return [w, h + 0.03, d + 0.04];
  },
  mailbox(k, o, r) {
    const m = 'metal_green'; k.add(span(-0.14, 0, -0.06, 0.14, 0.34, 0.07), m); k.add(profX([[0.07, 0.34], [0.07, 0.4], [-0.085, 0.345], [-0.085, 0.33], [-0.06, 0.34]], -0.155, 0.155), m);
    k.add(span(-0.1, 0.265, -0.066, 0.1, 0.285, -0.06), 'rubber'); k.add(span(-0.11, 0.29, -0.075, 0.11, 0.3, -0.06), m); k.add(span(-0.12, 0.02, -0.066, 0.12, 0.22, -0.06), m);
    k.add(cyl(0.014, 0.014, 0.008, 8).rotateX(-PI / 2).translate(0.08, 0.12, -0.066), 'brass'); k.add(span(-0.08, 0.08, -0.07, 0.03, 0.17, -0.066), 'brass'); k.add(span(-0.15, 0.1, 0.07, 0.15, 0.3, 0.075), 'metal_rust');
    k.col(-0.15, 0, -0.08, 0.15, 0.4, 0.075, 'metal'); return [0.31, 0.4, 0.16];
  },
  ac_unit(k, o, r) { acUnit(k, 0, 0, 0.18, {}); k.add(span(0.2, 0.42, -0.156, 0.34, 0.47, -0.15), 'plastic_blue'); k.col(-0.4, 0, -0.15, 0.4, 0.57, 0.15, 'metal'); return [0.82, 0.57, 0.34]; },
  drainpipe(k, o, r) {
    const h = o.h || 4.2, m = (o.seed | 0) % 2 ? 'metal_green' : 'metal_rust'; downpipe(k, 0, 0, 0, h, m, null, o.hopper !== false, 'x'); k.spout = [0.16, 0.02, 0];
    k.col(-0.06, 0, -0.06, 0.06, h, 0.07, 'metal'); return [0.24, h, 0.24];
  },
  cable_span(k, o, r) {
    const w = o.w || o.length || 4, h = o.h || 0.4;
    for (let i = 0; i < 3; i++) { const z = (i - 1) * 0.022, dr = h * (0.55 + 0.2 * i + r.range(-0.08, 0.08)); k.add(tube(sag([-w / 2, h - i * 0.03, z], [w / 2, h - (2 - i) * 0.025, z], dr - 0.03, 14), 0.008 - i * 0.0015, 4, 28), 'rubber'); }
    for (const s of [-1, 1]) { k.add(lathe([[0.012, 0], [0.03, 0.01], [0.012, 0.025], [0.03, 0.04], [0.012, 0.055]], 8).rotateZ(PI / 2).translate(s * w / 2 + 0.03, h - 0.03, 0), 'ceramic_white'); }
    if ((o.seed | 0) % 2) { const t = 0.35, x = -w / 2 + w * t, y = h - (h * 0.55 - 0.03) * 4 * t * (1 - t); k.add(rod([x, y - 0.22, -0.022], [x, y, -0.022], 0.004, 4), 'rubber'); k.glow(sph(0.035, 8, 6).translate(x, y - 0.25, -0.022), WARM); k.lamp = [x, y - 0.25, -0.022]; }
    return [w, h, 0.06];
  },
  trash_bin(k, o, r) {
    const R = 0.2, h = 0.56, m = 'steel';
    k.add(lathe([[R * 0.84, 0], [R * 0.86, 0.02], [R, h - 0.02], [R + 0.012, h], [R - 0.004, h], [R * 0.84, 0.03], [0, 0.03]], 16), m); for (const y of [0.16, 0.3, 0.44]) k.add(torus(R * (0.86 + 0.14 * y / h) + 0.003, 0.008, 4, 18).rotateX(PI / 2).translate(0, y, 0), m);
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; k.add(rod([Math.cos(a) * (R * 0.87 + 0.002), 0.04, Math.sin(a) * (R * 0.87 + 0.002)], [Math.cos(a) * (R * 0.99 + 0.002), h - 0.04, Math.sin(a) * (R * 0.99 + 0.002)], 0.005, 3), m); }
    for (const s of [-1, 1]) k.add(torus(0.04, 0.006, 4, 8, PI).rotateX(PI).rotateY(PI / 2).translate(s * (R + 0.01), h - 0.12, 0), m);
    const lid = [lathe([[R + 0.03, 0], [R + 0.032, 0.02], [R * 0.7, 0.07], [R * 0.25, 0.095], [0, 0.1]], 16), torus(0.04, 0.007, 4, 8, PI).translate(0, 0.095, 0)]; for (const g of lid) k.add(g.rotateZ(0.12).translate(0.02, h + 0.0, 0), m);
    k.add(sph(0.16, 8, 6).scale(1, 0.5, 1).translate(-0.02, h - 0.03, 0), 'rubber');
    k.col(-R, 0, -R, R, h + 0.1, R, 'metal'); return [0.46, 0.7, 0.46];
  },
  umbrella(k, o, r) {
    const kk = new Kit(k.G, k.seed), m = (o.seed | 0) % 2 ? 'awning_red' : 'cloth_blue', R = 0.5, n = 8;
    const gs = []; for (let i = 0; i < n; i++) { const a0 = i / n * TAU, a1 = (i + 1) / n * TAU, am = (a0 + a1) / 2, p = (a, q, y) => [Math.cos(a) * R * q, y, Math.sin(a) * R * q]; gs.push(quad(p(a0, 1, 0), p(am, 0.93, 0.012), p(am, 0.5, 0.15), p(a0, 0.52, 0.15)), quad(p(am, 0.93, 0.012), p(a1, 1, 0), p(a1, 0.52, 0.15), p(am, 0.5, 0.15)), quad(p(a0, 0.52, 0.15), p(am, 0.5, 0.15), p(am, 0.02, 0.24), p(a0, 0.02, 0.24)), quad(p(am, 0.5, 0.15), p(a1, 0.52, 0.15), p(a1, 0.02, 0.24), p(am, 0.02, 0.24))); kk.add(rod([0, 0.235, 0], p(a0, 1, -0.004), 0.0035, 3), 'steel'); kk.add(rod([0, 0.06, 0], p(a0, 0.5, 0.14), 0.003, 3), 'steel'); }
    kk.add(twoSided(mergeGeos(gs)), m); kk.add(rod([0, -0.42, 0], [0, 0.27, 0], 0.008, 6, 0.008, true), 'steel'); kk.add(cyl(0.012, 0.004, 0.04, 6).translate(0, 0.25, 0), 'steel');
    kk.add(tube([[0, -0.38, 0], [0, -0.44, 0], [0.03, -0.47, 0], [0.07, -0.45, 0], [0.08, -0.41, 0]], 0.013, 6, 12), 'wood_dark');
    const g = kk.finish('umb', { grime: 0 }); for (const mm of g.children) { mm.geometry.rotateZ(-PI / 4).translate(0, 0.365, 0); k.add(mm.geometry, mm.name.split(':')[1]); }
    return [1.0, 0.75, 1.0];
  },
  birdcage(k, o, r) {
    const R = 0.14, hb = 0.26;
    k.add(cyl(R + 0.008, R + 0.008, 0.022, 16).translate(0, 0.0, 0), 'bamboo'); k.add(cyl(R - 0.01, R - 0.01, 0.004, 14).translate(0, 0.022, 0), 'wood_dark');
    for (let i = 0; i < 20; i++) { const a = i / 20 * TAU, c = Math.cos(a), s = Math.sin(a); k.add(tube([[c * R, 0.02, s * R], [c * R, hb, s * R], [c * R * 0.82, hb + 0.07, s * R * 0.82], [c * R * 0.4, hb + 0.125, s * R * 0.4], [c * 0.012, hb + 0.14, s * 0.012]], 0.0028, 3, 8), 'bamboo'); }
    for (const [y, q] of [[0.09, 1], [0.18, 1], [hb, 1], [hb + 0.075, 0.8]]) k.add(torus(R * q + 0.002, 0.0045, 4, 18).rotateX(PI / 2).translate(0, y, 0), 'bamboo');
    k.add(lathe([[0.012, 0], [0.03, 0.006], [0.02, 0.02], [0.006, 0.03]], 8).translate(0, hb + 0.138, 0), 'brass'); k.add(torus(0.022, 0.004, 4, 10, PI * 1.5).rotateZ(-PI / 4).translate(0, hb + 0.19, 0), 'brass');
    k.add(rod([-R, 0.11, 0], [R, 0.11, 0], 0.005, 5), 'bamboo'); for (const s of [-1, 1]) k.add(lathe([[0.012, 0], [0.022, 0.006], [0.024, 0.03], [0.02, 0.03], [0.016, 0.01]], 8).translate(s * (R - 0.03), 0.03, 0.02), 'ceramic_blue');
    // the bird
    k.add(sph(0.026, 8, 6).scale(1.35, 1, 1).translate(0.01, 0.142, 0), 'cloth_white'); k.add(sph(0.018, 7, 5).translate(0.04, 0.165, 0), 'cloth_white'); k.add(cyl(0.0, 0.006, 0.018, 4).rotateZ(-PI / 2).translate(0.055, 0.165, 0), 'brass'); k.add(span(-0.06, 0.14, -0.008, -0.02, 0.146, 0.008).rotateZ(0.0), 'cloth_white');
    k.hang = [0, hb + 0.21, 0]; return [0.3, hb + 0.21, 0.3];
  },
  table_folding(k, o, r) {
    const h = 0.7, R = 0.4, st = 'steel';
    k.add(cyl(R, R, 0.028, 20).translate(0, h - 0.028, 0), 'wood_dark'); k.add(torus(R, 0.012, 4, 24).rotateX(PI / 2).translate(0, h - 0.014, 0), st);
    for (const s of [-1, 1]) { const z = s * 0.24; k.add(rod([-0.3, 0, z], [0.3, h - 0.03, z], 0.011, 6, 0.011, true), st); k.add(rod([0.3, 0, z * 0.9], [-0.3, h - 0.03, z * 0.9], 0.011, 6, 0.011, true), st); k.add(cyl(0.014, 0.014, 0.03, 6).rotateX(PI / 2).translate(0, h / 2 - 0.015, z * 0.95 - 0.015), st); for (const x of [-0.3, 0.3]) k.add(cyl(0.016, 0.016, 0.012, 6).translate(x, 0, z * (x > 0 ? 0.9 : 1)), 'rubber'); }
    for (const x of [-0.3, 0.3]) { k.add(rod([x, h - 0.04, -0.24], [x, h - 0.04, 0.24], 0.009, 5), st); k.add(rod([x, 0.1, -0.23], [x, 0.1, 0.23], 0.008, 5), st); }
    // teapot and cups
    k.add(lathe([[0.04, 0], [0.065, 0.01], [0.08, 0.05], [0.07, 0.09], [0.04, 0.105], [0.035, 0.11]], 12).translate(0.05, h, 0.02), 'ceramic_white'); k.add(lathe([[0.04, 0.105], [0.03, 0.115], [0.012, 0.12], [0.014, 0.135], [0, 0.14]], 10).translate(0.05, h, 0.02), 'ceramic_blue');
    k.add(tube([[0.12, h + 0.04, 0.02], [0.16, h + 0.06, 0.02], [0.185, h + 0.1, 0.02]], 0.011, 5, 6), 'ceramic_white'); k.add(torus(0.032, 0.007, 4, 10, PI).rotateZ(PI / 2).translate(-0.025, h + 0.055, 0.02), 'ceramic_white');
    for (let i = 0; i < 3; i++) { const a = 2.2 + i * 0.9; bowl(k, 0.05 + Math.cos(a) * 0.2, h, 0.02 + Math.sin(a) * 0.2, 0.034); } k.add(lathe([[0.05, 0], [0.11, 0.012], [0.115, 0.016], [0.05, 0.008], [0, 0.008]], 14).translate(-0.12, h, -0.2), 'ceramic_blue');
    k.col(-R * 0.75, h - 0.05, -R * 0.75, R * 0.75, h, R * 0.75, 'wood'); return [0.82, h + 0.14, 0.82];
  },
  home_window(k, o, r) {
    const w = 1.2, h = 1.5, wd = 'wood_red', zf = -0.06, zb = 0.13, ga = o.glass || 'glass_manchu_a', L = { p: [0.0, 0.86, 0.0], c: [1.9, 1.25, 0.6], k: 2.6 };
    // surround, deep sill, hood
    for (const s of [-1, 1]) k.add(span(s * (w / 2 - 0.04) - 0.04, 0.1, zf, s * (w / 2 - 0.04) + 0.04, h - 0.08, zb), wd); k.add(span(-w / 2, h - 0.1, zf, w / 2, h - 0.02, zb), wd); k.add(span(-w / 2, 1.08, zf + 0.01, w / 2, 1.14, zb), wd);
    k.add(span(-w / 2 - 0.06, 0, -0.15, w / 2 + 0.06, 0.07, zb), 'granite_slab'); k.add(span(-w / 2 - 0.02, 0.07, -0.13, w / 2 + 0.02, 0.1, zb), wd); k.add(profX([[zb, h - 0.02], [-0.15, h - 0.02], [-0.15, h + 0.0], [-0.1, h + 0.03], [zb, h + 0.03]], -w / 2 - 0.08, w / 2 + 0.08), wd);
    // fixed transom of coloured glass, lit
    const fit = (g, gw, gh) => { const t = (k.G.mats.tileOf && k.G.mats.tileOf(ga)) || 1, su = Math.max(1, Math.round(gw / t)) * t / gw, sv = Math.max(1, Math.round(gh / t)) * t / gh, uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; };
    k.add(fit(quadZ(-w / 2 + 0.08, 1.14, w / 2 - 0.08, h - 0.1, zb - 0.05), w - 0.16, 0.26), ga); for (const x of [-0.18, 0.18]) k.add(span(x - 0.012, 1.14, zb - 0.07, x + 0.012, h - 0.1, zb - 0.04), wd);
    // two casement leaves swung open, coloured glass in a wooden lattice frame
    for (const s of [-1, 1]) { const lw = w / 2 - 0.09, parts = [span(0, 0, -0.016, 0.04, 0.98, 0.016), span(lw - 0.04, 0, -0.016, lw, 0.98, 0.016), span(0, 0, -0.016, lw, 0.045, 0.016), span(0, 0.935, -0.016, lw, 0.98, 0.016), span(0, 0.47, -0.012, lw, 0.5, 0.012), span(lw / 2 - 0.012, 0, -0.012, lw / 2 + 0.012, 0.98, 0.012)], gl = twoSided(fit(quad([0.04, 0.045, 0], [lw - 0.04, 0.045, 0], [lw - 0.04, 0.935, 0], [0.04, 0.935, 0]), lw - 0.08, 0.89));
      const fr = mergeGeos(parts), ang = s < 0 ? PI - 1.15 : 1.15 + PI; for (const [g, m] of [[fr, wd], [gl, ga]]) { if (s > 0) g.rotateY(PI); g.rotateY(s < 0 ? 1.25 : -1.25); k.add(g.translate(s * (w / 2 - 0.08), 0.1, zf), m); }
      k.add(rod([s * (w / 2 - 0.085), 0.11, zf - 0.005], [s * (w / 2 - 0.085) + s * 0.0 - s * 0.0, 0.11, zf - 0.02], 0.004, 4), 'brass'); k.add(rod([s * (w / 2 - 0.09), 0.115, zf - 0.01], [s * (w / 2 - 0.09) + s * 0.12, 0.115, zf - 0.33], 0.004, 4), 'brass'); }
    // the warm room: back wall, a curtain, a lantern, a little shelf with a jar
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { const xa = -w / 2 + 0.08 + i * (w - 0.16) / 6, ya = 0.1 + j * 0.98 / 6; k.lit(quadZ(xa, ya, xa + (w - 0.16) / 6, ya + 0.98 / 6, zb - 0.004), [0.95, 0.78, 0.5], L, 0.22); } k.lit(span(-0.52, 0.72, zb - 0.06, -0.2, 0.74, zb - 0.004), [0.5, 0.3, 0.18], L); k.lit(cyl(0.035, 0.045, 0.1, 8).translate(-0.4, 0.74, zb - 0.035), [0.3, 0.6, 0.8], L); k.lit(cyl(0.03, 0.03, 0.07, 8).translate(-0.29, 0.74, zb - 0.035), [0.85, 0.3, 0.25], L);
    const cur = []; for (let i = 0; i <= 10; i++) cur.push([0.24 + i * 0.026, zb - 0.03 + 0.012 * Math.sin(i * 1.9)]); for (let i = 0; i < 10; i++) k.lit(quad([cur[i + 1][0], 0.1, cur[i + 1][1]], [cur[i][0], 0.1, cur[i][1]], [cur[i][0], 1.08, cur[i][1]], [cur[i + 1][0], 1.08, cur[i + 1][1]]), [0.85, 0.3, 0.26], L, 0.45);
    k.glow(sph(0.08, 10, 7).scale(1, 0.9, 1).translate(0.0, 0.86, zb - 0.075), [3.4, 1.5, 0.45]); for (const s of [-1, 1]) k.add(cyl(0.035, 0.035, 0.014, 8).translate(0, 0.86 + s * 0.072 - 0.007, zb - 0.075), 'brass'); k.add(rod([0, 0.92, zb - 0.07], [0, 1.08, zb - 0.07], 0.003, 4), 'rope');
    // the cushion on the sill
    const cu = new THREE.SphereGeometry(1, 16, 10), cp = cu.attributes.position, pw = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
    for (let i = 0; i < cp.count; i++) { const x = pw(cp.getX(i), 0.55), z = pw(cp.getZ(i), 0.55), y = cp.getY(i), pinch = 1 - 0.5 * Math.pow(Math.max(Math.abs(x), Math.abs(z)), 5); cp.setXYZ(i, x * 0.31 * (1 - 0.06 * z * z), y * 0.07 * pinch - 0.012 * Math.exp(-(x * x + z * z) * 3) * (y > 0 ? 1 : 0), z * 0.125 * (1 - 0.06 * x * x)); } cu.computeVertexNormals();
    { const uv = cu.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, cp.getX(i), cp.getZ(i) + cp.getY(i)); }
    k.add(cu.translate(-0.12, 0.16, -0.045), 'cloth_blue'); k.add(span(-0.45, 0.1, -0.145, 0.21, 0.104, 0.075), 'cloth_white');
    k.col(-w / 2 - 0.06, 0, -0.15, w / 2 + 0.06, 0.1, zb, 'wood'); k.col(-0.4, 0.1, -0.13, 0.16, 0.17, 0.06, 'cloth'); k.seat = [-0.12, 0.17, -0.035]; k.lamp = [0, 0.86, 0];
    return [w + 0.16, h + 0.03, 0.3];
  },
  kerb_stone(k, o, r) { const w = o.w || 1.0, h = 0.12, d = 0.25; k.add(profX([[-d / 2, 0], [-d / 2, h - 0.025], [-d / 2 + 0.025, h], [d / 2, h], [d / 2, 0]], -w / 2 + 0.004, w / 2 - 0.004), 'granite_slab'); k.col(-w / 2, 0, -d / 2, w / 2, h, d / 2, 'stone'); return [w, h, d]; },
};
// the salted fish: split and flattened, hung head-up on a loop of string; bottom of the tail at (x, y, z)
function fish(k, x, y, z, yaw) {
  const body = [[0, 0.3], [0.022, 0.292], [0.042, 0.27], [0.055, 0.235], [0.058, 0.19], [0.05, 0.14], [0.034, 0.095], [0.016, 0.06], [0.014, 0.045], [0.05, 0.004], [0.02, 0.012], [0, 0.022], [-0.02, 0.012], [-0.05, 0.0], [-0.014, 0.045], [-0.016, 0.06], [-0.03, 0.095], [-0.042, 0.14], [-0.046, 0.19], [-0.042, 0.235], [-0.03, 0.27], [-0.014, 0.292]];
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(body.map(p => new THREE.Vector2(p[0], p[1]))), { depth: 0.008, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.006, bevelSegments: 2, curveSegments: 4 }); g.translate(0, 0, -0.004);
  const parts = [g, extr([[0.05, 0.2], [0.078, 0.17], [0.06, 0.135], [0.046, 0.15]], 0.004).translate(0, 0, -0.002), extr([[-0.04, 0.215], [-0.07, 0.19], [-0.06, 0.15], [-0.04, 0.16]], 0.004).translate(0, 0, -0.002), sph(0.008, 6, 4).scale(1, 1, 0.6).translate(0.018, 0.262, 0.012), sph(0.008, 6, 4).scale(1, 1, 0.6).translate(0.018, 0.262, -0.012)];
  for (let i = 0; i < 4; i++) parts.push(span(-0.03 + i * 0.004, 0.11 + i * 0.035, -0.0125, 0.036 - i * 0.002, 0.114 + i * 0.035, 0.0125));
  k.add(mergeGeos(parts).rotateY(yaw).translate(x, y, z), 'fish_salted');
  k.add(tube([[0.006, 0.29, 0], [0.012, 0.325, 0], [0, 0.36, 0], [-0.012, 0.325, 0], [-0.006, 0.29, 0]].map(p => [x + p[0] * Math.cos(yaw), y + p[1], z - p[0] * Math.sin(yaw)]), 0.0028, 4, 10), 'rope');
}

const NAMES = Object.keys(P), FLIP = new Set(['mailbox', 'ac_unit', 'awning', 'home_window']);

export async function create(G) {
  const cache = new Map();
  function build(name, opts = {}) {
    const o = opts || {}, key = name + '|' + JSON.stringify(o);
    let src = cache.get(key);
    if (!src) {
      const seed = (hashStr(String(name)) + Math.imul((o.seed | 0) + 1, 40503)) >>> 0, k = new Kit(G, seed, { interior: !!o.interior }); let size;
      try { if (P[name]) size = P[name](k, o, k.rng); } catch (e) { console.error('[props] "' + name + '" failed: ' + (e && e.stack || e)); k.by.clear(); k.colliders.length = 0; size = null; }
      if (!size) { const w = o.w || 0.5, h = o.h || 0.5, d = o.d || 0.5; k.add(bb(w, h, d), 'concrete'); k.col(-w / 2, 0, -d / 2, w / 2, h, d / 2); size = [w, h, d]; }
      src = k.finish(name, { grime: /lantern|fish|cable|window|awning/.test(name) ? 0.25 : 0.8, y0: name === 'awning' ? -99 : 0 });
      if (FLIP.has(name)) {   // built facing -Z like the buildings; the wall-mounted ones are handed out facing +Z, back on -Z (what the level expects)
        for (const m of src.children) m.geometry.rotateY(PI);
        for (const c of src.userData.colliders) { const a = -c.max.x, b = -c.min.x, e = -c.max.z, f = -c.min.z; c.min.x = a; c.max.x = b; c.min.z = e; c.max.z = f; }
        const fl = v => (Array.isArray(v) && typeof v[0] === 'number' ? [-v[0], v[1], -v[2]] : Array.isArray(v) ? v.map(fl) : v); for (const key2 of ['hooks', 'hang', 'steam', 'lamp', 'spout', 'seat']) if (k[key2] != null) k[key2] = fl(k[key2]);
      }
      src.userData.size = size; for (const key2 of ['hooks', 'hang', 'steam', 'lamp', 'spout', 'seat', 'bulbs']) if (k[key2] != null) src.userData[key2] = k[key2];
      cache.set(key, src);
    }
    const g = new THREE.Group(); g.name = name; for (const m of src.children) { const c = new THREE.Mesh(m.geometry, m.material); c.name = m.name; c.castShadow = m.castShadow; c.receiveShadow = m.receiveShadow; g.add(c); }
    g.userData = { ...src.userData, size: src.userData.size.slice(), colliders: src.userData.colliders.map(c => { const b = box3(c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z, c.surface); if (c.oneWay) b.oneWay = true; return b; }) };
    return g;
  }
  // static batching: bake the world transforms of many placed props (or any groups of meshes) into one mesh per material
  function merge(objects, name = 'props-merged') {
    const by = new Map(), out = new THREE.Group(); out.name = name;
    for (const obj of objects) { obj.updateMatrixWorld(true); obj.traverse(m => { if (!m.isMesh) return; const g = m.geometry.clone().applyMatrix4(m.matrixWorld); if (m.matrixWorld.determinant() < 0) { const ix = g.index ? null : g.attributes; if (ix) for (const nm of Object.keys(ix)) { const at = ix[nm], s = at.itemSize, a = at.array; for (let i = 0; i < at.count; i += 3) for (let j = 0; j < s; j++) { const t = a[(i + 1) * s + j]; a[(i + 1) * s + j] = a[(i + 2) * s + j]; a[(i + 2) * s + j] = t; } } } if (!by.has(m.material)) by.set(m.material, []); by.get(m.material).push(g); }); }
    for (const [mat, geos] of by) { const mesh = new THREE.Mesh(mergeGeos(geos), mat); mesh.receiveShadow = true; out.add(mesh); }
    return out;
  }
  return { build, names: () => NAMES.slice(), merge, glowMaterial: glowMat };
}

export async function showcase(G) {
  const api = G.props, only = (G.params.only || '').split(',').filter(Boolean), list = only.length ? only : api.names(), root = new THREE.Group(); root.name = 'props-showcase'; G.scene.add(root);
  const report = {}, OPT = { drying_rack: { fish: 3 }, lantern_string: { w: 2.4 }, cable_span: { w: 2.4, seed: 1 }, awning: { w: 2.4, d: 1.4 }, drainpipe: { h: 2.2 } };
  const LIFT = { lantern_paper: 0.9, lantern_string: 0.9, cable_span: 1.0, awning: 1.3, birdcage: 0.8, salted_fish: 0.5, ac_unit: 0.9, mailbox: 0.9, home_window: 0.5 };
  const perRow = only.length ? 99 : 7, cellW = 2.75, cellD = 2.7, placed = [];
  const seed0 = +(G.params.props_seed || G.params.seed || 1);
  list.forEach((name, i) => {
    const g = api.build(name, { seed: seed0, ...(OPT[name] || {}) }), s = g.userData.size, row = Math.floor(i / perRow), colN = Math.min(perRow, list.length - row * perRow), col = i % perRow;
    report[name] = { tris: g.userData.tris, meshes: g.userData.meshes, size: s.map(v => +v.toFixed(2)), colliders: g.userData.colliders.length };
    g.position.set(only.length ? 0 : (col - (colN - 1) / 2) * cellW, only.length === 1 ? (LIFT[name] ? 0.35 : 0) : (LIFT[name] || 0), row * cellD); g.rotation.y = FLIP.has(name) ? PI : 0; placed.push(g); root.add(g);
  });
  if (only.length > 1) { let tot = placed.reduce((a, g) => a + g.userData.size[0] + 0.4, 0), x = -tot / 2; for (const g of placed) { g.position.x = x + g.userData.size[0] / 2 + 0.2; x += g.userData.size[0] + 0.4; } }
  for (const g of placed) {
    if (G.signs && G.signs.plaque && !only.length) { const p = G.signs.plaque(g.name), k = Math.min(2.2, 2.5 / Math.max(0.3, (p.userData.size || [1])[0])); p.scale.setScalar(k); p.position.set(g.position.x, 0.03, g.position.z - 1.05); p.rotation.set(1.0, PI, 0); root.add(p); }
    if (G.params.props_debug) for (const c of g.userData.colliders) { const m = new THREE.Mesh(new THREE.BoxGeometry(c.max.x - c.min.x, c.max.y - c.min.y, c.max.z - c.min.z), new THREE.MeshBasicMaterial({ color: c.oneWay ? 0x33ff88 : 0xff3366, wireframe: true })); m.position.copy(c.min).add(c.max).multiplyScalar(0.5).add(g.position); root.add(m); }
  }
  const one = only.length === 1 && placed[0], rowW = placed.reduce((a, g) => a + g.userData.size[0] + 0.4, 0);
  for (let i = 0; i < 8; i++) { const p = G.render.lightPool && G.render.lightPool.acquire(); if (!p) break; p.color.setRGB(1, 0.82, 0.6); p.distance = 14;
    if (one) { p.intensity = i < 3 ? 10 : 0; p.position.set([-1.4, 1.6, 0.2][i % 3], [1.5, 1.9, 2.4][i % 3], [-1.6, -0.8, 1.6][i % 3]); }
    else if (only.length) { p.intensity = 12; p.position.set((i / 7 - 0.5) * rowW, 2.0, -1.5); }
    else { p.intensity = 22; p.position.set((i % 4 - 1.5) * 5.2, 3.0, -1.2 + Math.floor(i / 4) * 5.6); } }
  G.propsReport = report; console.log('[props] showcase', JSON.stringify(report));
  if (one) { const s = one.userData.size, d = Math.max(s[0], s[2], s[1] * 0.8) * 0.62 + 0.42, y = one.position.y; return { cam: [-d * 0.6, 0.26, -d], target: [0, y + Math.min(s[1] * 0.42, 0.55), 0], update() {} }; }
  if (only.length) return { cam: [-rowW * 0.12, 0.5, -(rowW * 0.42 + 0.9)], target: [0, 0.45, 0], update() {} };
  return { cam: [0, 5.2, -6.6], target: [0, 0.2, 3.4], update() {} };
}
