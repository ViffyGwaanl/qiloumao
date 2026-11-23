// signs.js — every piece of lettering (MATS). All signs are drawn with the 2D canvas and the system Chinese fonts into a few
// shared atlas pages (2048 px), so a street full of signs costs a handful of textures and three shader programs.
//   neon(text, {color, height, vertical, w, h, flicker})   glass-tube lettering on a dark board + a soft additive halo
//   lightbox(text, {w, h, bg, fg, vertical})               a lit box with a metal frame, a little dirty + a faint halo
//   painted(text, {w, h, color, bg, vertical})             a hand-painted wooden shop board (lit by the scene)
//   plaque(text, {w, h, bg, fg})                           a small enamel door plate (lit by the scene)
// Every object: userData.size = [w, h, d], origin at the centre of its back face, facing +z.
import * as THREE from 'three';
import { makeRng, hashStr } from './util.js';

const NAMES = ['陈记粥铺', '西关凉茶', '珠玑士多', '阿婆云吞面', '月明茶楼', '光明理发', '同福钟表', '蓬莱照相馆', '荔湾艇仔粥', '和记五金', '永春堂药材'];
const SANS = '"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
const BRUSH = '"Weibei SC","Kaiti SC","STKaiti","KaiTi","Songti SC","STSong","SimSun","PingFang SC","Noto Sans SC","Microsoft YaHei",serif';
const PAGE = 2048, PAD = 6;
const css = c => '#' + new THREE.Color(c).getHexString();
const mixCss = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

// geometry builder: quads with atlas uvs and a per-vertex brightness (values above 1 feed the bloom)
class GB {
  constructor() { this.P = []; this.N = []; this.U = []; this.C = []; }
  quad(a, b, c, d, n, uv, k = 1) {       // a bottom-left, b bottom-right, c top-right, d top-left; uv = [u0, v0, u1, v1]
    const [u0, v0, u1, v1] = uv;
    this.P.push(...a, ...b, ...c, ...a, ...c, ...d); this.U.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    for (let i = 0; i < 6; i++) { this.N.push(...n); this.C.push(k, k, k); }
    return this;
  }
  face(w, h, z, uv, k) { return this.quad([-w/2, -h/2, z], [w/2, -h/2, z], [w/2, h/2, z], [-w/2, h/2, z], [0, 0, 1], uv, k); }
  sides(w, h, d, uv, k) {                 // the four edges of a slab that sits on the wall (z = 0 .. d)
    const x = w/2, y = h/2;
    this.quad([x, -y, d], [x, -y, 0], [x, y, 0], [x, y, d], [1, 0, 0], uv, k); this.quad([-x, -y, 0], [-x, -y, d], [-x, y, d], [-x, y, 0], [-1, 0, 0], uv, k);
    this.quad([-x, y, d], [x, y, d], [x, y, 0], [-x, y, 0], [0, 1, 0], uv, k); this.quad([-x, -y, 0], [x, -y, 0], [x, -y, d], [-x, -y, d], [0, -1, 0], uv, k);
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    return g;
  }
}

export async function create(G) {
  const maxAniso = G.renderer && G.renderer.capabilities.getMaxAnisotropy ? G.renderer.capabilities.getMaxAnisotropy() : 1;
  const pages = { glow: [], paint: [] }, flick = [], st = { signs: 0, pages: 0 };
  let time = 0;

  function newPage(kind) {
    const cv = document.createElement('canvas'); cv.width = cv.height = PAGE; const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, PAGE, PAGE);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, maxAniso); tex.name = 'ql_signs_' + kind + pages[kind].length;
    const pg = { kind, cv, ctx, tex, y: PAD, shelves: [], mats: {} };
    if (kind === 'glow') {
      pg.mats.body = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true }); pg.mats.body.name = 'sign-glow';
      pg.mats.add = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }); pg.mats.add.name = 'sign-halo';
    } else {
      pg.mats.body = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.58, metalness: 0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.14 }); pg.mats.body.name = 'sign-paint';
    }
    st.pages++; return pg;
  }
  // shelf packing with best fit: tall vertical signs and short horizontal ones get shelves of their own height
  function alloc(kind, w, h) {
    w = Math.min(PAGE - 2*PAD, Math.ceil(w)); h = Math.min(PAGE - 2*PAD, Math.ceil(h));
    const list = pages[kind]; let best = null;
    for (const pg of list) for (const sh of pg.shelves) if (sh.x + w + PAD <= PAGE && sh.h >= h && sh.h <= h*1.25 + 6 && (!best || sh.h - h < best.sh.h - h)) best = { pg, sh };
    if (!best) {
      let pg = list.find(q => q.y + h + PAD <= PAGE);
      if (!pg) { pg = newPage(kind); list.push(pg); }
      const sh = { y: pg.y, h, x: PAD }; pg.shelves.push(sh); pg.y += h + PAD; best = { pg, sh };
    }
    const { pg, sh } = best, r = { pg, x: sh.x, y: sh.y, w, h }; sh.x += w + PAD; pg.tex.needsUpdate = true;
    r.uv = [(r.x + 0.5)/PAGE, 1 - (r.y + h - 0.5)/PAGE, (r.x + w - 0.5)/PAGE, 1 - (r.y + 0.5)/PAGE];
    return r;
  }
  // draw inside a region with the origin at its corner; nothing can spill into the neighbours
  function draw(r, fn) { const c = r.pg.ctx; c.save(); c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip(); c.translate(r.x, r.y); try { fn(c, r.w, r.h); } finally { c.restore(); } }
  // a region with an 8 px strip of one colour under it, for the edges of the slab
  function allocWithSwatch(kind, w, h, sideCol) {
    const r = alloc(kind, w, h + 10); const c = r.pg.ctx; c.fillStyle = sideCol; c.fillRect(r.x, r.y + h, r.w, 10);
    const full = r.uv, vSplit = 1 - (r.y + h - 0.5)/PAGE;
    r.face = { ...r, h, uv: [full[0], vSplit, full[2], full[3]] };
    const su = (r.x + r.w/2)/PAGE, sv = 1 - (r.y + h + 5)/PAGE; r.swatch = [su, sv, su, sv];
    return r;
  }
  const scratchCv = document.createElement('canvas'), scratch = scratchCv.getContext('2d');
  function onScratch(w, h, fn) { w = Math.ceil(w); h = Math.ceil(h); if (scratchCv.width < w) scratchCv.width = w; if (scratchCv.height < h) scratchCv.height = h; scratch.setTransform(1, 0, 0, 1, 0, 0); scratch.globalCompositeOperation = 'source-over'; scratch.globalAlpha = 1; scratch.shadowColor = 'transparent'; scratch.clearRect(0, 0, scratchCv.width, scratchCv.height); fn(scratch, w, h); return scratchCv; }

  // where each character goes: evenly spread along the board, like a real shop sign
  function layout(chars, vertical, W, H, mx, my, maxGap = 0.3) {
    const n = Math.max(1, chars.length), long = vertical ? H - 2*my : W - 2*mx, short = vertical ? W - 2*mx : H - 2*my;
    const em = Math.max(4, Math.min(short, long/(n + (n - 1)*0.04)));
    const gap = n > 1 ? Math.min(em*maxGap, (long - n*em)/(n - 1)) : 0, total = n*em + (n - 1)*gap, s0 = ((vertical ? H : W) - total)/2 + em/2;
    return { em, pts: chars.map((c, i) => (vertical ? { c, x: W/2, y: s0 + i*(em + gap) } : { c, x: s0 + i*(em + gap), y: H/2 })) };
  }
  const rrect = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  function wrap(mesh, w, h, d, kind, text) { const g = new THREE.Group(); g.add(mesh); g.userData.size = [w, h, d]; g.userData.sign = kind; g.userData.text = text; g.name = kind + ':' + text; st.signs++; return g; }
  function fit(w, h, o) { let s = 1; if (o.w && w*s > o.w) s = o.w/w; if (o.h && h*s > o.h) s = o.h/h; return s; }
  // a soft glow that only exists as a blur: the shape is drawn far to the left and only its shadow lands in the region
  function blurOnly(c, col, blur, alpha, fn) { c.save(); c.shadowColor = col; c.shadowBlur = blur; c.shadowOffsetX = 6000; c.globalAlpha = alpha; c.fillStyle = col; c.strokeStyle = col; c.translate(-6000, 0); fn(c); c.restore(); }
  function edgeFade(c, W, H, m) {         // force the outer rim of a halo to black so the quad has no visible edge
    const side = (x0, y0, x1, y1, rx, ry, rw, rh) => { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(rx, ry, rw, rh); };
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.shadowColor = 'transparent';
    side(0, 0, m, 0, 0, 0, m, H); side(W, 0, W - m, 0, W - m, 0, m, H); side(0, 0, 0, m, 0, 0, W, m); side(0, H, 0, H - m, 0, H - m, W, m);
  }

  // ------------------------------------------------------------------ neon
  function neon(text, o = {}) {
    text = String(text === undefined || text === null ? '' : text) || '?';
    const chars = [...text], n = chars.length, vertical = !!o.vertical, rng = makeRng(hashStr('neon' + text + (vertical ? 'v' : 'h')));
    let cell = o.height || 0.5, long = cell*(n*0.76 + 0.34), w = vertical ? cell : long, h = vertical ? long : cell;
    const s = fit(w, h, o); w *= s; h *= s; cell *= s;
    const d = 0.07, col = new THREE.Color(o.color !== undefined ? o.color : 0xff4d6d), cs = css(col);
    const ppm = Math.min(152/cell, 960/Math.max(w, h)), W = w*ppm, H = h*ppm, cp = cell*ppm;
    const r = allocWithSwatch('glow', W, H, '#0b0e14');
    const L = layout(chars, vertical, W, H, cp*(vertical ? 0.17 : 0.2), cp*(vertical ? 0.2 : 0.17), 0.22), em = L.em;
    const text3 = (c, lw, fill = true) => { c.lineWidth = lw; for (const p of L.pts) { if (lw > 0) c.strokeText(p.c, p.x, p.y + em*0.03); if (fill) c.fillText(p.c, p.x, p.y + em*0.03); } };
    const setFont = (c, wt = 300) => { c.font = `${wt} ${em}px ${SANS}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineCap = 'round'; };
    draw(r.face, (c, W, H) => {
      const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#121824'); g.addColorStop(1, '#0a0d13'); c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(255,255,255,0.035)'; c.lineWidth = 1; for (let y = cp*0.1; y < H; y += cp*0.085) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      c.strokeStyle = '#2b3646'; c.lineWidth = cp*0.035; c.strokeRect(cp*0.03, cp*0.03, W - cp*0.06, H - cp*0.06);
      c.fillStyle = '#566170'; for (const [bx, by] of [[0.07, 0.07], [0.07, -0.07], [-0.07, 0.07], [-0.07, -0.07]]) { c.beginPath(); c.arc(bx > 0 ? bx*cp : W + bx*cp, by > 0 ? by*cp : H + by*cp, cp*0.018, 0, 7); c.fill(); }
      setFont(c);
      c.globalCompositeOperation = 'lighter';
      c.shadowColor = cs; c.fillStyle = cs; c.strokeStyle = cs;
      c.shadowBlur = em*0.6; c.globalAlpha = 0.30; text3(c, em*0.08);            // light pooled on the board
      c.shadowBlur = em*0.13; c.globalAlpha = 0.70; text3(c, em*0.05);           // the glow hugging the glass
      c.globalCompositeOperation = 'source-over'; c.shadowColor = 'transparent'; c.shadowBlur = 0; c.globalAlpha = 1;
      // tube supports: little dark clips the tube sits in
      c.fillStyle = '#05070a'; for (const p of L.pts) for (let i = 0; i < 3; i++) c.fillRect(p.x + (rng() - 0.5)*em*0.8, p.y + (rng() - 0.5)*em*0.8, em*0.03, em*0.03);
      const tube = mixCss(col, 0xffffff, 0.12), core = mixCss(col, 0xffffff, 0.88);
      c.fillStyle = tube; c.strokeStyle = tube; text3(c, em*0.034);              // the coloured glass
      setFont(c, 200); c.fillStyle = core; text3(c, 0);                          // the hot core: the same strokes, thinner
    });
    // halo: a quarter-resolution blur that reaches past the board
    const M = cell*0.85, hs = 0.2, HW = (w + 2*M)*ppm*hs, HH = (h + 2*M)*ppm*hs, hr = alloc('glow', HW, HH);
    draw(hr, (c, HW, HH) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, HW, HH); c.globalCompositeOperation = 'lighter'; const mp = M*ppm*hs;
      blurOnly(c, cs, mp*0.55, 0.42, c2 => { rrect(c2, mp, mp, HW - 2*mp, HH - 2*mp, mp*0.3); c2.fill(); });
      blurOnly(c, cs, mp*0.22, 0.55, c2 => { c2.translate(mp, mp); c2.scale(hs, hs); setFont(c2); text3(c2, em*0.09); });
      edgeFade(c, HW, HH, mp*0.5);
    });
    const body = new GB().face(w, h, d, r.face.uv, 2.4).sides(w, h, d, r.swatch, 1).build();
    const halo = new GB().face(w + 2*M, h + 2*M, d + 0.02, hr.uv, 0.9).build();
    const flicker = o.flicker !== undefined ? !!o.flicker : rng() < 0.28;
    let mb = r.pg.mats.body, ma = hr.pg.mats.add;
    if (flicker) { mb = mb.clone(); ma = ma.clone(); flick.push({ mb, ma, rng: rng.fork(), cur: 1, next: rng.range(1, 6), dip: 0, depth: 0, w1: rng.range(0.6, 1.4), w2: rng.range(1.7, 2.9), p: rng.range(0, 6) }); }
    const m1 = new THREE.Mesh(body, mb), m2 = new THREE.Mesh(halo, ma); m2.renderOrder = 2;
    const g = wrap(m1, w, h, d, 'neon', text); g.add(m2); g.userData.color = col.getHex(); g.userData.flicker = flicker; return g;
  }

  // ------------------------------------------------------------------ lightbox
  function lightbox(text, o = {}) {
    text = String(text === undefined || text === null ? '' : text) || '?';
    const chars = [...text], vertical = !!o.vertical, rng = makeRng(hashStr('box' + text + (vertical ? 'v' : 'h')));
    const w = o.w || (vertical ? 0.5 : 1.6), h = o.h || (vertical ? 1.6 : 0.5), d = 0.14, bg = css(o.bg !== undefined ? o.bg : '#fff4d8'), fg = css(o.fg !== undefined ? o.fg : '#c2281d');
    const ppm = Math.min(270, 840/Math.max(w, h)), W = w*ppm, H = h*ppm, sp = Math.min(W, H);
    const r = allocWithSwatch('glow', W, H, '#12151a');
    draw(r.face, (c, W, H) => {
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      // the tubes inside: two soft brighter bands along the box, and a little falloff toward the frame
      const band = (t) => { const g = vertical ? c.createLinearGradient(W*(t - 0.2), 0, W*(t + 0.2), 0) : c.createLinearGradient(0, H*(t - 0.2), 0, H*(t + 0.2)); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.13)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H); };
      band(0.3); band(0.7);
      for (const [x0, y0, x1, y1] of [[0, 0, sp*0.22, 0], [W, 0, W - sp*0.22, 0], [0, 0, 0, sp*0.22], [0, H, 0, H - sp*0.22]]) { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(20,10,0,0.22)'); g.addColorStop(1, 'rgba(20,10,0,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H); }
      // inner rule and lettering
      c.strokeStyle = fg; c.globalAlpha = 0.85; c.lineWidth = sp*0.016; c.strokeRect(sp*0.105, sp*0.105, W - sp*0.21, H - sp*0.21); c.globalAlpha = 1;
      const L = layout(chars, vertical, W, H, sp*(vertical ? 0.2 : 0.22), sp*(vertical ? 0.22 : 0.2), 0.35), em = L.em;
      c.font = `900 ${em}px ${SANS}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
      c.fillStyle = fg; c.strokeStyle = fg; c.lineWidth = em*0.02; for (const p of L.pts) { c.strokeText(p.c, p.x, p.y + em*0.03); c.fillText(p.c, p.x, p.y + em*0.03); }
      // dirt: rain streaks from the top edge, dust along the bottom, a few specks
      for (let i = 0; i < W/26; i++) { const x = rng()*W, len = H*(0.15 + rng()*0.7), ww = 1 + rng()*sp*0.02; const g = c.createLinearGradient(0, 0, 0, len); g.addColorStop(0, `rgba(58,44,28,${0.05 + rng()*0.12})`); g.addColorStop(1, 'rgba(58,44,28,0)'); c.fillStyle = g; c.fillRect(x, 0, ww, len); }
      { const g = c.createLinearGradient(0, H, 0, H - sp*0.2); g.addColorStop(0, 'rgba(40,30,20,0.28)'); g.addColorStop(1, 'rgba(40,30,20,0)'); c.fillStyle = g; c.fillRect(0, H - sp*0.2, W, sp*0.2); }
      c.fillStyle = 'rgba(40,30,20,0.25)'; for (let i = 0; i < W*H/5200; i++) { c.beginPath(); c.arc(rng()*W, rng()*H, 0.6 + rng()*1.8, 0, 7); c.fill(); }
      // frame
      const f = sp*0.055; c.strokeStyle = '#161a20'; c.lineWidth = f*2; c.strokeRect(0, 0, W, H);
      c.strokeStyle = '#4c5460'; c.lineWidth = Math.max(1, f*0.14); c.strokeRect(f, f, W - 2*f, H - 2*f);
      c.fillStyle = '#6b7480'; for (const [x, y] of [[f/2, f/2], [W - f/2, f/2], [f/2, H - f/2], [W - f/2, H - f/2]]) { c.beginPath(); c.arc(x, y, f*0.2, 0, 7); c.fill(); }
    });
    const M = Math.min(w, h)*0.75, hs = 0.2, HW = (w + 2*M)*ppm*hs, HH = (h + 2*M)*ppm*hs, hr = alloc('glow', HW, HH);
    draw(hr, (c, HW, HH) => { c.fillStyle = '#000'; c.fillRect(0, 0, HW, HH); c.globalCompositeOperation = 'lighter'; const mp = M*ppm*hs; blurOnly(c, bg, mp*0.5, 0.5, c2 => { rrect(c2, mp*1.05, mp*1.05, HW - 2.1*mp, HH - 2.1*mp, mp*0.15); c2.fill(); }); edgeFade(c, HW, HH, mp*0.45); });
    const body = new GB().face(w, h, d, r.face.uv, 1.55).sides(w, h, d, r.swatch, 1).build();
    const halo = new GB().face(w + 2*M, h + 2*M, d + 0.02, hr.uv, 0.55).build();
    const m1 = new THREE.Mesh(body, r.pg.mats.body), m2 = new THREE.Mesh(halo, hr.pg.mats.add); m2.renderOrder = 2;
    const g = wrap(m1, w, h, d, 'lightbox', text); g.add(m2); return g;
  }

  // ------------------------------------------------------------------ painted board and plaque (lit by the scene)
  function brushText(chars, vertical, W, H, mx, my, color, rng, wear) {
    return onScratch(W, H, (c, W, H) => {
      const L = layout(chars, vertical, W, H, mx, my, 0.45), em = L.em;
      c.font = `900 ${em}px ${BRUSH}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
      const hi = mixCss(color, 0xffffff, 0.45), lo = mixCss(color, 0x000000, 0.35);
      for (const p of L.pts) {
        c.save(); c.translate(p.x, p.y + em*0.03); c.rotate((rng() - 0.5)*0.05); const sc = 0.96 + rng()*0.08; c.scale(sc, sc);
        c.lineWidth = em*0.03; c.fillStyle = c.strokeStyle = 'rgba(0,0,0,0.55)'; c.strokeText(p.c, em*0.022, em*0.03); c.fillText(p.c, em*0.022, em*0.03);     // carved shadow
        c.fillStyle = c.strokeStyle = hi; c.strokeText(p.c, -em*0.008, -em*0.012); c.fillText(p.c, -em*0.008, -em*0.012);                                 // raised edge
        const g = c.createLinearGradient(0, -em/2, 0, em/2); g.addColorStop(0, mixCss(color, 0xffffff, 0.22)); g.addColorStop(0.55, css(color)); g.addColorStop(1, lo);
        c.fillStyle = c.strokeStyle = g; c.lineWidth = em*0.022; c.strokeText(p.c, 0, 0); c.fillText(p.c, 0, 0);
        c.restore();
      }
      // wear: flakes, scratches and specks rubbed out of the paint
      c.globalCompositeOperation = 'destination-out'; c.fillStyle = c.strokeStyle = '#000';
      for (let i = 0; i < W*H/2600*wear; i++) { const x = rng()*W, y = rng()*H, rr = 1 + rng()*em*0.03; c.beginPath(); for (let k = 0; k < 6; k++) { const a = k/6*6.283, q = rr*(0.6 + rng()*0.8); c.lineTo(x + Math.cos(a)*q, y + Math.sin(a)*q); } c.fill(); }
      c.globalAlpha = 0.7; for (let i = 0; i < 14*wear; i++) { c.lineWidth = 0.6 + rng()*1.6; const x = rng()*W, y = rng()*H, a = (vertical ? 1.57 : 0) + (rng() - 0.5)*0.5, len = em*(0.2 + rng()*0.9); c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a)*len, y + Math.sin(a)*len); c.stroke(); }
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    });
  }
  function painted(text, o = {}) {
    text = String(text === undefined || text === null ? '' : text) || '?';
    const chars = [...text], vertical = !!o.vertical, rng = makeRng(hashStr('paint' + text + (vertical ? 'v' : 'h')));
    const w = o.w || (vertical ? 0.55 : 2.4), h = o.h || (vertical ? 2.4 : 0.6), d = 0.05, color = css(o.color !== undefined ? o.color : '#e9c46a'), bg = css(o.bg !== undefined ? o.bg : '#3a1d14');
    const ppm = Math.min(250, 840/Math.max(w, h)), W = w*ppm, H = h*ppm, sp = Math.min(W, H);
    const r = allocWithSwatch('paint', W, H, mixCss(bg, 0x000000, 0.35));
    const txt = brushText(chars, vertical, W, H, sp*(vertical ? 0.2 : 0.3), sp*(vertical ? 0.3 : 0.2), color, rng, 1);
    draw(r.face, (c, W, H) => {
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(255,230,200,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.22)'); c.fillStyle = g; c.fillRect(0, 0, W, H); }
      // wood grain along the board
      const longN = vertical ? H : W, shortN = vertical ? W : H;
      for (let i = 0; i < shortN/2.2; i++) {
        const t = rng()*shortN, amp = rng()*3, ph = rng()*6.28, fr = (1 + rng()*3)/longN*6.28; c.strokeStyle = rng() < 0.75 ? `rgba(0,0,0,${0.05 + rng()*0.16})` : `rgba(255,220,170,${0.03 + rng()*0.07})`; c.lineWidth = 0.6 + rng()*1.4; c.beginPath();
        for (let s = 0; s <= longN; s += longN/24) { const q = t + Math.sin(s*fr + ph)*amp; if (vertical) c.lineTo(q, s); else c.lineTo(s, q); } c.stroke();
      }
      // border: bevel, a gold rule, a thin inner rule, corner studs
      c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = sp*0.05; c.strokeRect(0, 0, W, H);
      c.strokeStyle = 'rgba(255,230,190,0.18)'; c.lineWidth = Math.max(1, sp*0.008); c.strokeRect(sp*0.03, sp*0.03, W - sp*0.06, H - sp*0.06);
      c.strokeStyle = color; c.lineWidth = sp*0.024; c.strokeRect(sp*0.075, sp*0.075, W - sp*0.15, H - sp*0.15);
      c.lineWidth = Math.max(1, sp*0.007); c.strokeRect(sp*0.115, sp*0.115, W - sp*0.23, H - sp*0.23);
      c.fillStyle = color; for (const [x, y] of [[0.075, 0.075], [-0.075, 0.075], [0.075, -0.075], [-0.075, -0.075]]) { c.beginPath(); c.arc(x > 0 ? x*sp : W + x*sp, y > 0 ? y*sp : H + y*sp, sp*0.03, 0, 7); c.fill(); }
      c.drawImage(txt, 0, 0, Math.ceil(W), Math.ceil(H), 0, 0, Math.ceil(W), Math.ceil(H));
      // age: grime from the top edge, pale scratches, dark knocks
      for (let i = 0; i < W/30; i++) { const x = rng()*W, len = H*(0.1 + rng()*0.5); const g = c.createLinearGradient(0, 0, 0, len); g.addColorStop(0, `rgba(0,0,0,${0.08 + rng()*0.14})`); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x, 0, 1 + rng()*sp*0.03, len); }
      c.strokeStyle = 'rgba(255,235,200,0.10)'; for (let i = 0; i < 26; i++) { c.lineWidth = 0.5 + rng(); const x = rng()*W, y = rng()*H, a = rng()*6.28, len = sp*(0.05 + rng()*0.3); c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a)*len, y + Math.sin(a)*len); c.stroke(); }
      c.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < W*H/9000; i++) { c.beginPath(); c.arc(rng()*W, rng()*H, 0.8 + rng()*2.6, 0, 7); c.fill(); }
    });
    const geo = new GB().face(w, h, d, r.face.uv, 1).sides(w, h, d, r.swatch, 1).build(); geo.deleteAttribute('color');
    return wrap(new THREE.Mesh(geo, r.pg.mats.body), w, h, d, 'painted', text);
  }
  function plaque(text, o = {}) {
    text = String(text === undefined || text === null ? '' : text) || '?';
    const chars = [...text], rng = makeRng(hashStr('plaque' + text));
    const h = o.h || 0.18, w = o.w || Math.max(0.5, h*(chars.length*0.62 + 1.1)), d = 0.012, bg = css(o.bg !== undefined ? o.bg : '#1f4fa8'), fg = css(o.fg !== undefined ? o.fg : '#f4f1e6');
    const ppm = Math.min(520, 640/Math.max(w, h)), W = w*ppm, H = h*ppm;
    const r = allocWithSwatch('paint', W, H, '#1a1d22');
    draw(r.face, (c, W, H) => {
      c.fillStyle = '#1a1d22'; c.fillRect(0, 0, W, H);
      rrect(c, 1, 1, W - 2, H - 2, H*0.12); c.fillStyle = bg; c.fill();
      { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(255,255,255,0.20)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.18)'); c.fillStyle = g; c.fill(); }
      rrect(c, H*0.09, H*0.09, W - H*0.18, H - H*0.18, H*0.07); c.strokeStyle = fg; c.lineWidth = H*0.03; c.stroke();
      const L = layout(chars, false, W, H, H*0.5, H*0.24, 0.3), em = L.em;
      c.font = `700 ${em}px ${SANS}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = fg; for (const p of L.pts) c.fillText(p.c, p.x, p.y + em*0.04);
      for (const x of [H*0.26, W - H*0.26]) { c.fillStyle = '#8b9198'; c.beginPath(); c.arc(x, H/2, H*0.055, 0, 7); c.fill(); c.strokeStyle = '#30343a'; c.lineWidth = 1; c.beginPath(); c.moveTo(x - H*0.04, H/2); c.lineTo(x + H*0.04, H/2); c.stroke(); const g = c.createRadialGradient(x, H/2 + H*0.05, 0, x, H/2 + H*0.05, H*0.2); g.addColorStop(0, 'rgba(110,50,20,0.35)'); g.addColorStop(1, 'rgba(110,50,20,0)'); c.fillStyle = g; c.fillRect(x - H*0.2, H/2 - H*0.15, H*0.4, H*0.5); }
      // chipped enamel
      for (let i = 0; i < 9; i++) { const e = rng() < 0.5, x = e ? rng()*W : (rng() < 0.5 ? rng()*H*0.1 : W - rng()*H*0.1), y = e ? (rng() < 0.5 ? rng()*H*0.1 : H - rng()*H*0.1) : rng()*H, rr = H*(0.015 + rng()*0.04); c.fillStyle = rng() < 0.5 ? '#15171a' : '#5a2c14'; c.beginPath(); for (let k = 0; k < 7; k++) { const a = k/7*6.283, q = rr*(0.5 + rng()); c.lineTo(x + Math.cos(a)*q, y + Math.sin(a)*q); } c.fill(); }
    });
    const geo = new GB().face(w, h, d, r.face.uv, 1).sides(w, h, d, r.swatch, 1).build(); geo.deleteAttribute('color');
    return wrap(new THREE.Mesh(geo, r.pg.mats.body), w, h, d, 'plaque', text);
  }

  return {
    names: NAMES.slice(), neon, lightbox, painted, plaque,
    stats: () => ({ signs: st.signs, pages: st.pages, atlasMB: +(st.pages*PAGE*PAGE*4*1.3334/1048576).toFixed(1), flickering: flick.length }),
    // a few tubes breathe slowly and now and then dip for a moment: never a strobe
    update(dt) {
      time += dt;
      for (const f of flick) {
        let v = 0.975 + 0.025*Math.sin(time*f.w1 + f.p)*Math.sin(time*f.w2 + f.p*1.7);
        if ((f.next -= dt) <= 0) { f.dip = f.rng.range(0.10, 0.22); f.depth = f.rng.range(0.10, 0.24); f.next = f.rng.range(4, 10); }
        if (f.dip > 0) { f.dip -= dt; v *= 1 - f.depth; }
        f.cur += (v - f.cur)*Math.min(1, dt*14);
        f.mb.color.setScalar(f.cur); f.ma.color.setScalar(f.cur);
      }
    },
  };
}

// ------------------------------------------------------------------------------------------------ showcase (?show=signs)
// a wall with every shop name as neon, lightbox and painted board, each both horizontal and vertical, and a door plaque.
export async function showcase(G) {
  const S = G.signs, root = new THREE.Group(); root.name = 'signs-showcase'; G.scene.add(root);
  const tf = G.scene.getObjectByName('test-floor'); if (tf && !tf.userData.metreUV) { const uv = tf.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i)*80, uv.getY(i)*80); tf.userData.metreUV = true; }
  const NEON = [0xff4d6d, 0x3ddc97, 0xffc24a, 0x48d1ff, 0xb98cff, 0xff7a3d];
  const BOX = [['#fff4d8', '#c2281d'], ['#c8261c', '#ffe9a8'], ['#1f9a6a', '#fdfbf0'], ['#1d57b8', '#ffffff'], ['#ffd24a', '#7a1410'], ['#fdfdf6', '#10643e']];
  const PAINT = [['#e9c46a', '#3a1d14'], ['#c8281e', '#ead9b0'], ['#f0d078', '#16130f'], ['#e9c46a', '#5a1712'], ['#1f6a48', '#e8dcb8']];
  const colW = 3.05, rowH = 4.25, perRow = 6, names = S.names, rows = Math.ceil(names.length/perRow);
  const WW = perRow*colW + 0.6, WH = rows*rowH + 0.5;
  const wallGeo = new THREE.PlaneGeometry(WW, WH); { const uv = wallGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i)*WW, uv.getY(i)*WH); }
  const wall = new THREE.Mesh(wallGeo, G.mats.get('plaster_teal', { interior: true })); wall.position.set(0, WH/2, 0); root.add(wall);
  const put = (obj, x, y) => { obj.position.set(x, y, 0.001); root.add(obj); return obj; };
  names.forEach((nm, i) => {
    const row = Math.floor(i/perRow), col = i%perRow, inRow = Math.min(perRow, names.length - row*perRow);
    const cx = (col - (inRow - 1)/2)*colW, top = WH - 0.3 - row*rowH;
    put(S.neon(nm, { color: NEON[i%NEON.length], height: 0.44, w: colW - 0.5 }), cx, top - 0.22);
    put(S.lightbox(nm, { w: 2.0, h: 0.46, bg: BOX[i%BOX.length][0], fg: BOX[i%BOX.length][1] }), cx, top - 0.84);
    put(S.painted(nm, { w: 2.3, h: 0.54, color: PAINT[i%PAINT.length][0], bg: PAINT[i%PAINT.length][1] }), cx, top - 1.5);
    const vy = top - 1.95;
    const nv = S.neon(nm, { color: NEON[(i + 2)%NEON.length], height: 0.36, vertical: true, h: 1.75 }); put(nv, cx - 0.95, vy - nv.userData.size[1]/2);
    const lv = S.lightbox(nm, { w: 0.42, h: 1.7, vertical: true, bg: BOX[(i + 1)%BOX.length][0], fg: BOX[(i + 1)%BOX.length][1] }); put(lv, cx - 0.2, vy - 0.85);
    const pv = S.painted(nm, { w: 0.46, h: 1.75, vertical: true, color: PAINT[(i + 1)%PAINT.length][0], bg: PAINT[(i + 1)%PAINT.length][1] }); put(pv, cx + 0.5, vy - 0.875);
    put(S.plaque(nm), cx + 1.12, vy - 0.3);
  });
  put(S.plaque('恩宁里 12'), (perRow - 1)/2*colW + 0.6, 1.0); put(S.plaque('猫'), (perRow - 1)/2*colW - 0.3, 1.0);
  console.log('[signs] ' + JSON.stringify(S.stats()));
  const dist = Math.max(WW/2/1.29, WH/2/0.727)*1.04;
  return { cam: [0, WH/2 + 0.1, dist], target: [0, WH/2, 0] };
}
