// mats.js — the material library (MATS). Every surface texture is produced on the GPU when it is first asked for:
// one fragment shader per kind of surface is drawn once on a full-screen triangle into a three-attachment scratch target
// (colour, ao/roughness/metalness/height, 16-bit height), then three small passes turn that into mip-mapped, seamlessly
// tiling maps: albedo (sRGB; alpha = tint amount or glow mask), ORM (r ao, g roughness, b metalness, a height) and a
// normal map from the height. get(name) wraps them in a cached MeshStandardMaterial whose shader is patched with
// world-space variation, a grime film and the rain look (tops wet and glossy, walls streaked, undersides dry).
// No image files, no Math.random: the same pixels for every visitor.
import * as THREE from 'three';

// ------------------------------------------------------------------------------------------------ GLSL toolbox
const VS = `in vec3 position; out vec2 vUv; void main(){ vUv = position.xy*0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PRELUDE = `precision highp float; precision highp int;
uniform vec4 uP; uniform float uSeed; uniform vec2 uTexel; uniform vec3 uC[5];
in vec2 vUv;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
#define TAU 6.28318530718
#define sat(x) clamp(x, 0.0, 1.0)
#define OV(c_, k_) { float kk = sat(k_); nt = mix(nt, c_, kk); ta *= 1.0 - kk; }
vec3 L(float r, float g, float b){ return pow(vec3(r, g, b), vec3(2.2)); }      // colours are typed as they look on screen
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// integer hash (same bits on every GPU); cells wrap with period 'per', which is what makes every pattern tile
uint hu(uint x){ x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
vec3 h3(vec2 cell, vec2 per, float s){
  vec2 c = mod(cell, per);
  uint n = hu(uint(int(c.x)) + 0x9e3779b9u*hu(uint(int(c.y)) + 0x85ebca6bu*hu(uint(int(s*17.0 + uSeed*131.0)) + 7u)));
  uint a = hu(n ^ 0x68bc21ebu), b = hu(a ^ 0x02e5be93u);
  return vec3(float(n), float(a), float(b))/4294967295.0;
}
// periodic gradient noise, about -0.7..0.7
float gn(vec2 p, vec2 per, float s){
  vec2 i = floor(p), f = p - i, u = f*f*f*(f*(f*6.0 - 15.0) + 10.0);
  float a = TAU*h3(i, per, s).x, b = TAU*h3(i + vec2(1.0, 0.0), per, s).x, c = TAU*h3(i + vec2(0.0, 1.0), per, s).x, d = TAU*h3(i + vec2(1.0, 1.0), per, s).x;
  return mix(mix(dot(vec2(cos(a), sin(a)), f), dot(vec2(cos(b), sin(b)), f - vec2(1.0, 0.0)), u.x),
             mix(dot(vec2(cos(c), sin(c)), f - vec2(0.0, 1.0)), dot(vec2(cos(d), sin(d)), f - vec2(1.0, 1.0)), u.x), u.y);
}
// fractal noise 0..1 centred on 0.5; f = cells per tile (whole numbers), may be stretched: vec2(40, 1) = vertical streaks
float fbm(vec2 uv, vec2 f, int oct, float s){
  float v = 0.0, a = 0.5, t = 0.0;
  for(int i = 0; i < oct; i++){ v += a*gn(uv*f, f, s + float(i)*7.0); t += a; a *= 0.5; f *= 2.0; }
  return sat(v/t*1.75 + 0.5);
}
// voronoi: x = F1, y = F2, z = cell random, w = another cell random
vec4 vor(vec2 p, vec2 per, float s){
  vec2 i = floor(p), f = p - i; float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0.0);
  for(int y = -1; y <= 1; y++) for(int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y)); vec3 r = h3(i + g, per, s); vec2 d = g + r.xy - f; float q = dot(d, d);
    if(q < d1){ d2 = d1; d1 = q; id = vec2(r.z, fract(r.z*91.7 + r.x*3.1)); } else if(q < d2) d2 = q;
  }
  return vec4(sqrt(d1), sqrt(d2), id);
}
// scattered straight scratches: f cells per tile, w half width (cells), base angle + spread, density 0..1
float scr(vec2 uv, float f, float s, float w, float ang, float spread, float dens){
  vec2 p = uv*f, i = floor(p); float m = 0.0;
  for(int y = -1; y <= 1; y++) for(int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y)); vec3 r = h3(i + g, vec2(f), s), r2 = h3(i + g, vec2(f), s + 3.0);
    if(r2.y < dens){
      float a = ang + (r.z - 0.5)*spread, len = 0.12 + r2.x*0.75; vec2 dir = vec2(cos(a), sin(a)), q = p - (i + g + r.xy);
      float t = clamp(dot(q, dir), -len, len); m = max(m, (1.0 - smoothstep(w*0.4, w, length(q - dir*t)))*(0.35 + 0.65*r2.z));
    }
  }
  return m;
}
float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
float cov(float d, float aw){ return sat(0.5 - d/aw); }                          // anti-aliased inside of a shape (d < 0)
// the single exit: colour (linear), alpha (tint amount or glow mask), height, ao, roughness, metalness
void emit(vec3 c, float a, float h, float ao, float r, float m){
  o0 = vec4(sqrt(sat(c)), sat(a)); o1 = vec4(sat(ao), sat(r), sat(m), sat(h));
  float hh = sat(h)*255.0; o2 = vec4(floor(hh)/255.0, fract(hh), 0.0, 1.0);
}
`;

// paint / plaster damage model: flake 0 intact .. 1 through to what is underneath; halo = thin ring round a flake;
// run = the dirty wash-down below damage (-v is down)
const DMG = `
void damage(vec2 uv, float amt, float fq, out float flake, out float halo, out float run){
  float zone = smoothstep(0.5, 0.8, fbm(uv, vec2(2.0), 3, 61.0));
  float n = fbm(uv, vec2(fq), 3, 62.0) + (fbm(uv, vec2(fq*9.0), 3, 63.0) - 0.5)*0.07;
  float th = 0.975 - 0.10*amt - 0.05*zone;
  flake = smoothstep(th, th + 0.025, n);
  halo = smoothstep(th - 0.08, th, n)*(1.0 - flake);
  vec4 v = vor(uv*fq*7.0, vec2(fq*7.0), 64.0);
  float rad = 0.34*(0.3 + 0.7*v.w);
  flake = max(flake, step(v.z, 0.03*zone*(0.1 + amt))*smoothstep(rad, rad - 0.07, v.x + (fbm(uv, vec2(fq*20.0), 2, 66.0) - 0.5)*0.25));
  run = 0.0;
  for(int i = 1; i <= 5; i++){ float nn = fbm(uv + vec2(0.0, float(i)*0.022), vec2(fq), 3, 62.0); run += smoothstep(th, th + 0.025, nn)*(1.0 - float(i)/6.0); }
  run = sat(run*0.5)*smoothstep(0.35, 0.75, fbm(uv, vec2(fq*14.0, 1.0), 3, 65.0))*(1.0 - flake);
}
`;

const FN = {
// 麻石: long worn granite slabs, 0.37 m wide and about 1.1 m long (long side along v), dark joints. tile 2.2 m
granite: `
void surf(vec2 uv){
  float cols = 6.0, T = 2.2;
  float cx = uv.x*cols, ci = floor(cx), fx = cx - ci;
  vec3 rc = h3(vec2(ci, 3.0), vec2(cols, 8.0), 11.0);
  float split = 0.36 + 0.28*rc.y, t = fract(uv.y + rc.x);
  float si = step(split, t), len = mix(split, 1.0 - split, si), fy = (t - si*split)/len;
  vec3 rs = h3(vec2(ci, si), vec2(cols, 2.0), 12.0), rs2 = h3(vec2(ci, si), vec2(cols, 2.0), 13.0);
  float W = T/cols, Lm = T*len;
  float wob = (fbm(uv, vec2(18.0), 3, 14.0) - 0.5)*0.012;
  float dx = min(fx, 1.0 - fx)*W, dy = min(fy, 1.0 - fy)*Lm, d = min(dx, dy) + wob;
  // knocked-off corners
  float cr = 0.012 + 0.03*rs2.y*step(0.45, rs.y); d = min(d, length(vec2(dx, dy)) - cr + wob*2.0 + 0.012);
  float jw = 0.0035 + 0.0035*rs.z;
  float joint = 1.0 - smoothstep(jw, jw + 0.003, d);
  float bev = smoothstep(jw, jw + 0.022, d); bev = bev*bev*(3.0 - 2.0*bev);
  float grain = fbm(uv, vec2(70.0), 4, 1.0), big = fbm(uv + rs.xy*0.0, vec2(4.0), 5, 2.0 + ci + si*3.0), mid = fbm(uv, vec2(13.0), 4, 3.0);
  vec4 sp = vor(uv*230.0, vec2(230.0), 4.0), sp2 = vor(uv*95.0, vec2(95.0), 5.0), sp3 = vor(uv*420.0, vec2(420.0), 6.0);
  float dark = smoothstep(0.34, 0.14, sp.x)*step(0.60, sp.z) + smoothstep(0.3, 0.1, sp3.x)*step(0.7, sp3.z)*0.6;     // biotite
  float light = smoothstep(0.42, 0.16, sp2.x)*step(0.45, sp2.z);                                                    // feldspar
  vec3 base = mix(L(0.72, 0.67, 0.58), L(0.82, 0.74, 0.60), rs.x);
  base = mix(base, L(0.64, 0.65, 0.68), step(0.66, rs2.x)*0.8);
  base = mix(base, L(0.80, 0.64, 0.55), step(0.78, rs2.z)*0.75);
  base = mix(base, L(0.58, 0.56, 0.52), step(0.9, rs.y)*0.6);
  vec3 c = base*(0.80 + 0.40*big)*(0.90 + 0.20*mid)*(0.93 + 0.14*grain);
  c = mix(c, c*0.34, sat(dark)*0.8); c = mix(c, c*1.25 + 0.03, light*0.45);
  // dressing marks on some slabs, worn nearly flat
  float chis = step(0.5, rs2.y)*0.8;
  float cm = smoothstep(0.55, 0.95, 0.5 + 0.5*sin((uv.y*110.0 + fbm(uv, vec2(9.0, 3.0), 3, 15.0)*3.0)*TAU))*chis*smoothstep(0.35, 0.7, fbm(uv, vec2(7.0), 3, 16.0));
  c *= 1.0 - cm*0.14;
  // stains, and dirt creeping in from the joints
  float stain = smoothstep(0.58, 0.85, fbm(uv, vec2(5.0), 5, 17.0)); c = mix(c, c*vec3(0.62, 0.58, 0.52), stain*0.55);
  float jd = (1.0 - smoothstep(0.0, 0.045, d - jw))*(0.35 + 0.65*fbm(uv, vec2(40.0), 3, 18.0)); c *= 1.0 - jd*0.42;
  // a crack across a few slabs
  float ck = abs(fy - 0.3 - 0.4*rs.x + (fbm(uv, vec2(16.0), 4, 19.0) - 0.5)*0.22)*Lm;
  float crack = step(0.84, rs2.x)*(1.0 - smoothstep(0.001, 0.004, ck));
  c *= 1.0 - crack*0.6;
  vec3 jc = mix(L(0.12, 0.11, 0.10), L(0.13, 0.19, 0.09), smoothstep(0.5, 0.75, fbm(uv, vec2(6.0), 4, 20.0))*0.8);
  c = mix(c, jc*(0.7 + 0.6*grain), joint);
  float pit = smoothstep(0.26, 0.08, sp2.x)*step(sp2.z, 0.16);
  float hs = 0.68 + (rs2.x - 0.5)*0.10 + (big - 0.5)*0.16 + (mid - 0.5)*0.07 + (grain - 0.5)*0.035 - pit*0.10 - cm*0.035 - crack*0.12
           + (fx - 0.5)*(rs.x - 0.5)*0.16 + (fy - 0.5)*(rs.y - 0.5)*0.16;
  float h = mix(0.24 + 0.10*grain, hs, bev);
  float r = mix(0.52 + (grain - 0.5)*0.22 + cm*0.15 - light*0.08 + stain*0.1, 0.92, joint);
  emit(c, 1.0, h, mix(0.5, 1.0, bev) - crack*0.3, r, 0.0);
}`,

// 花阶砖: 20 cm pigmented cement tiles laid as a carpet. tile 0.8 m = 4 x 4 tiles. uP.x = 0 flower A, 1 medallion B, 2 check; uP.y = wear
tile: `
void surf(vec2 uv){
  float N = 4.0; vec2 g = uv*N, ti = floor(g), p = g - ti - 0.5;
  vec3 rt = h3(ti, vec2(N), 21.0), rt2 = h3(ti, vec2(N), 22.0);
  float aw = N*uTexel.x*1.25;
  float wob = (fbm(uv, vec2(28.0), 2, 23.0) - 0.5)*0.007;        // pigment poured into a brass mould: the edges bleed only a little
  vec3 c; int k = int(uP.x + 0.5);
  if(k == 0){
    vec3 cream = uC[0], red = uC[1], jade = uC[2], blue = uC[3];
    float man = abs(p.x) + abs(p.y), r = length(p), a = atan(p.y, p.x);
    c = mix(red, cream, cov((man - 0.5)*0.7071 + wob, aw));
    float rc = length(abs(p) - 0.5);                             // corner discs: four tiles make a full circle
    c = mix(c, jade, cov(rc - 0.205 + wob, aw));
    c = mix(c, cream, cov(abs(rc - 0.128) - 0.024 + wob, aw));
    c = mix(c, red, cov(rc - 0.055 + wob, aw));
    c = mix(c, jade, cov(r - 0.205*pow(abs(sin(2.0*a)), 0.75) + wob, aw));
    c = mix(c, red, cov(r - 0.295*pow(abs(cos(2.0*a)), 0.75) + wob, aw));
    c = mix(c, blue, cov(r - 0.088 + wob, aw));
    c = mix(c, cream, cov(r - 0.042 + wob, aw));
    c = mix(c, blue, cov(abs(man - 0.5)*0.7071 - 0.027 + wob, aw));
  } else if(k == 1){
    vec3 ochre = uC[0], blue = uC[1], cream = uC[2], red = uC[3];
    vec2 q = (fract(g*0.5) - 0.5)*2.0;                           // -1..1 over a group of 2 x 2 tiles
    float R = length(q);
    c = ochre;
    float rc = length(abs(q) - 1.0);
    c = mix(c, red, cov(rc - 0.31 + wob, aw));
    c = mix(c, cream, cov(abs(rc - 0.195) - 0.032 + wob, aw));
    c = mix(c, blue, cov(rc - 0.09 + wob, aw));
    vec2 e1 = vec2(abs(q.x) - 1.0, q.y), e2 = vec2(q.x, abs(q.y) - 1.0);
    float de = min(abs(e1.x) + abs(e1.y), abs(e2.x) + abs(e2.y));
    c = mix(c, blue, cov((de - 0.165)*0.7071 + wob, aw));
    c = mix(c, cream, cov((de - 0.07)*0.7071 + wob, aw));
    c = mix(c, cream, cov(R - 0.83 + wob, aw));
    c = mix(c, blue, cov(R - 0.785 + wob, aw));
    c = mix(c, cream, cov(R - 0.655 + wob, aw));
    float st = min(sdBox(q, vec2(0.40)), sdBox(rot(q, 0.7853982), vec2(0.40)));
    c = mix(c, red, cov(st + wob, aw));
    c = mix(c, ochre, cov(R - 0.275 + wob, aw));
    c = mix(c, blue, cov(R - 0.175 + wob, aw));
    c = mix(c, cream, cov(R - 0.07 + wob, aw));
  } else {
    c = mix(uC[0], uC[1], mod(ti.x + ti.y, 2.0));
  }
  float e = max(abs(p.x), abs(p.y));
  float big = fbm(uv, vec2(3.0), 5, 24.0), mott = fbm(uv, vec2(22.0), 4, 25.0 + rt.x*40.0), fine = fbm(uv, vec2(120.0), 3, 26.0);
  c *= (0.90 + 0.20*rt.x)*(0.89 + 0.22*mott);
  float wear = smoothstep(0.46, 0.80, big + (fbm(uv, vec2(30.0), 3, 27.0) - 0.5)*0.3)*uP.y;       // foot traffic has rubbed the pigment dusty
  c = mix(c, mix(c, vec3(luma(c))*1.05 + vec3(0.035, 0.03, 0.025), 0.6), wear*0.55);
  vec4 sp = vor(uv*260.0, vec2(260.0), 28.0); float pin = step(0.8, sp.z)*smoothstep(0.3, 0.1, sp.x);
  c *= 1.0 - pin*0.32;
  float stain = smoothstep(0.6, 0.85, fbm(uv, vec2(5.0), 4, 29.0)); c *= 1.0 - stain*0.2*uP.y;
  // chipped corners and nibbled edges show the grey cement body
  vec2 sg = vec2(rt2.x < 0.5 ? 1.0 : -1.0, rt.y < 0.5 ? 1.0 : -1.0);
  float crad = 0.03 + 0.08*rt2.z, nz = fbm(uv, vec2(36.0), 3, 30.0);
  float chip = step(rt2.y, 0.28*uP.y)*(1.0 - smoothstep(crad - 0.012, crad, length(p - sg*0.5) + (nz - 0.5)*0.07));
  chip = max(chip, smoothstep(0.04, 0.0, 0.5 - e)*smoothstep(0.66, 0.78, fbm(uv, vec2(44.0), 3, 31.0))*uP.y);
  c = mix(c, L(0.50, 0.49, 0.46)*(0.8 + 0.4*fine), chip);
  float ang = rt.y*TAU; float cl = abs(dot(p, vec2(cos(ang), sin(ang))) - (rt.z - 0.5)*0.4 + (fbm(uv, vec2(24.0), 3, 32.0) - 0.5)*0.12);
  float crack = step(1.0 - 0.12*uP.y, rt2.z)*(1.0 - smoothstep(0.003, 0.009, cl));
  c *= 1.0 - crack*0.55;
  float joint = 1.0 - smoothstep(0.0055, 0.0055 + aw, 0.5 - e);
  c = mix(c, L(0.17, 0.16, 0.15), joint);
  vec2 tilt = (rt.xy - 0.5)*0.56;
  float hs = 0.60 + dot(p, tilt) + (rt.z - 0.5)*0.08 + (fine - 0.5)*0.022 + (mott - 0.5)*0.02 - wear*0.012 - chip*0.2 - crack*0.08 - pin*0.03 - smoothstep(0.45, 0.5, e)*0.05;
  float r = 0.34 + 0.12*(mott - 0.5) + wear*0.22 + chip*0.4 + pin*0.1;
  emit(c, 1.0, mix(hs, 0.22, joint), 1.0 - joint*0.45 - chip*0.2 - crack*0.3, mix(r, 0.9, joint), 0.0);
}`,

// lime plaster wall, painted (the paint colour is the material's colour; alpha = how much of it shows). tile 2.4 m. uP.x = decay
plaster: DMG + `
void surf(vec2 uv){
  float amt = uP.x;
  float big = fbm(uv, vec2(3.0), 5, 1.0), mid = fbm(uv, vec2(9.0), 4, 2.0), fine = fbm(uv, vec2(64.0), 3, 3.0), trowel = fbm(uv, vec2(6.0, 26.0), 3, 4.0);
  vec3 nt = vec3(0.0); float ta = 0.88 + 0.16*(big - 0.5) + 0.12*(mid - 0.5) + 0.05*(fine - 0.5);
  float chalk = smoothstep(0.5, 0.8, fbm(uv, vec2(4.0), 4, 5.0)); OV(vec3(0.82, 0.80, 0.74), chalk*0.14)
  float vs1 = fbm(uv, vec2(64.0, 1.0), 3, 6.0), vs2 = fbm(uv, vec2(19.0, 1.0), 3, 7.0), vs3 = fbm(uv, vec2(7.0, 2.0), 3, 8.0);
  float sz = smoothstep(0.42, 0.72, fbm(uv, vec2(2.0, 1.0), 3, 20.0));                       // streaks gather in a few places, they do not stripe the wall
  float streak = sat(smoothstep(0.58, 0.82, vs1)*0.4*(0.5 + big) + smoothstep(0.58, 0.82, vs2)*0.5 + smoothstep(0.55, 0.82, vs3)*0.3)*(0.25 + amt*0.6)*(0.12 + 0.88*sz);
  OV(L(0.26, 0.23, 0.19), streak*0.40)
  float mould = smoothstep(0.64, 0.82, fbm(uv, vec2(6.0), 5, 9.0))*(0.4 + 0.6*fbm(uv, vec2(90.0), 2, 10.0)); OV(L(0.15, 0.2, 0.13), mould*0.5*amt)
  float ws = fbm(uv, vec2(3.0, 2.0), 5, 11.0), tide = 1.0 - smoothstep(0.0, 0.02, abs(ws - 0.64)), wst = smoothstep(0.64, 0.70, ws);
  OV(L(0.50, 0.40, 0.24), (wst*0.22 + tide*0.30)*amt)
  // a trowelled repair patch or two, fresher and greyer
  vec2 pg = uv*3.0, pid = floor(pg); vec3 pr = h3(pid, vec2(3.0), 12.0), pr2 = h3(pid, vec2(3.0), 13.0);
  float pd = sdBox(pg - pid - (0.3 + 0.4*pr.xy), vec2(0.10 + 0.17*pr.z, 0.07 + 0.14*pr2.x)) + (fbm(uv, vec2(30.0), 3, 14.0) - 0.5)*0.05;
  float patch_ = step(pr2.y, 0.22 + 0.25*amt)*(1.0 - smoothstep(-0.012, 0.008, pd));
  OV(L(0.70, 0.69, 0.65)*(0.9 + 0.2*trowel), patch_*0.88)
  float fl, halo, run; damage(uv, amt, 5.0, fl, halo, run);
  OV(L(0.26, 0.23, 0.19), run*0.5)
  float putty = sat(smoothstep(0.45, 0.8, halo) + fl), cement = smoothstep(0.4, 0.9, fl)*smoothstep(0.3, 0.5, fbm(uv, vec2(7.0), 3, 15.0));
  OV(L(0.86, 0.84, 0.78)*(0.9 + 0.2*fine), putty)
  if(cement > 0.0){ float kk = cement; nt = mix(nt, L(0.68, 0.65, 0.59)*(0.8 + 0.4*mid), kk); }
  vec2 w = uv + (vec2(fbm(uv, vec2(6.0), 3, 16.0), fbm(uv, vec2(6.0), 3, 17.0)) - 0.5)*0.09;
  vec4 cr = vor(w*4.0, vec2(4.0), 18.0); float crack = (1.0 - smoothstep(0.0, 0.010, cr.y - cr.x))*smoothstep(0.45, 0.68, fbm(uv, vec2(2.0), 3, 19.0));
  OV(L(0.12, 0.11, 0.10), crack*0.8)
  float h = 0.6 + (mid - 0.5)*0.12 + (fine - 0.5)*0.06 + (trowel - 0.5)*0.08 - putty*0.06 - cement*0.10 + patch_*0.05 - crack*0.22;
  emit(nt, ta, h, 1.0 - crack*0.4 - cement*0.1, 0.84 + (fine - 0.5)*0.12 - patch_*0.05, 0.0);
}`,

// 青砖: thin blue-grey bricks with fine white lime joints. tile 1.5 m: 6 x 24 bricks of 250 x 62.5 mm
brick: `
void surf(vec2 uv){
  vec2 n = vec2(6.0, 24.0);
  float row = floor(uv.y*n.y); vec2 g = vec2(uv.x*n.x + mod(row, 2.0)*0.5, uv.y*n.y), id = floor(g), f = g - id;
  vec3 r = h3(id, n, 1.0), r2 = h3(id, n, 2.0);
  vec2 dmm = min(f, 1.0 - f)*vec2(250.0, 62.5);
  float ed = fbm(uv, vec2(48.0), 3, 3.0), fine = fbm(uv, vec2(110.0), 3, 4.0), big = fbm(uv, vec2(3.0), 5, 5.0);
  float d = min(dmm.x, dmm.y), jw = 2.9 + (ed - 0.5)*1.6;
  float mortar = 1.0 - smoothstep(jw, jw + 1.3, d);
  float round_ = smoothstep(jw, jw + 5.0, d);
  vec3 bc = mix(L(0.40, 0.49, 0.55), L(0.54, 0.61, 0.64), r.x);
  bc = mix(bc, L(0.34, 0.42, 0.50), step(0.86, r2.x)); bc = mix(bc, L(0.56, 0.54, 0.50), step(0.93, r2.y)*0.7);
  vec4 pv = vor(uv*170.0, vec2(170.0), 6.0); float pit = step(0.8, pv.z)*smoothstep(0.3, 0.1, pv.x);
  bc *= (0.86 + 0.28*fbm(uv, vec2(40.0, 60.0), 3, 7.0 + r.z*30.0))*(0.94 + 0.12*fine); bc *= 1.0 - pit*0.3;
  float chipz = step(r2.z, 0.14)*smoothstep(0.55, 0.75, fbm(uv, vec2(26.0), 3, 8.0)); bc = mix(bc, bc*1.25 + 0.03, chipz*0.6);
  vec3 mc = L(0.95, 0.93, 0.87)*(0.88 + 0.16*ed);
  vec3 c = mix(bc, mc, mortar);
  float vs = fbm(uv, vec2(30.0, 1.0), 3, 9.0), soot = sat(smoothstep(0.52, 0.85, vs)*0.6 + smoothstep(0.55, 0.85, big)*0.5)*uP.x;
  c = mix(c, c*vec3(0.50, 0.48, 0.46), soot*0.5);
  float moss = smoothstep(0.66, 0.84, fbm(uv, vec2(7.0), 5, 10.0))*mortar; c = mix(c, L(0.22, 0.32, 0.14), moss*0.6*uP.x);
  float h = mix(0.62 + (r.y - 0.5)*0.10 + (fine - 0.5)*0.05 - pit*0.12 - chipz*0.1 - (1.0 - round_)*0.08, 0.40 + (ed - 0.5)*0.08, mortar);
  emit(c, 1.0, h, mix(1.0, 0.75, mortar), mix(0.74, 0.92, mortar) + soot*0.05, 0.0);
}`,

concrete: `
void surf(vec2 uv){
  float big = fbm(uv, vec2(3.0), 5, 1.0), mid = fbm(uv, vec2(11.0), 4, 2.0), fine = fbm(uv, vec2(80.0), 3, 3.0);
  vec4 po = vor(uv*150.0, vec2(150.0), 4.0); float pore = step(0.72, po.z)*smoothstep(0.28, 0.08, po.x);
  vec3 c = mix(L(0.56, 0.56, 0.55), L(0.69, 0.67, 0.62), big)*(0.9 + 0.2*mid)*(0.95 + 0.1*fine);
  c = mix(c, c*0.6, pore*0.8);
  float vs = fbm(uv, vec2(26.0, 1.0), 3, 6.0); c = mix(c, c*0.72, smoothstep(0.55, 0.85, vs)*0.4*uP.x);
  float st = smoothstep(0.6, 0.85, fbm(uv, vec2(4.0), 5, 7.0)); c = mix(c, c*vec3(0.74, 0.70, 0.62), st*0.5);
  vec2 w = uv + (vec2(fbm(uv, vec2(7.0), 3, 8.0), fbm(uv, vec2(7.0), 3, 9.0)) - 0.5)*0.1;
  vec4 cr = vor(w*3.0, vec2(3.0), 10.0); float crack = (1.0 - smoothstep(0.0, 0.008, cr.y - cr.x))*smoothstep(0.5, 0.7, fbm(uv, vec2(2.0), 3, 11.0));
  c *= 1.0 - crack*0.6;
  emit(c, 1.0, 0.6 + (mid - 0.5)*0.15 + (fine - 0.5)*0.06 - pore*0.25 - crack*0.3, 1.0 - pore*0.3 - crack*0.4, 0.80 + (fine - 0.5)*0.12, 0.0);
}`,

// boards 15 cm wide, grain along v; grey-scale grain that the material colour stains. tile 1.2 m. uP.x = wear
wood: `
void surf(vec2 uv){
  float np = 8.0, px = uv.x*np, pi_ = floor(px), fx = px - pi_; vec3 r = h3(vec2(pi_, 2.0), vec2(np, 4.0), 1.0);
  float s = 10.0 + pi_*3.0;
  float lines = fbm(uv, vec2(128.0, 2.0), 4, s), pores = fbm(uv, vec2(320.0, 8.0), 2, s + 1.0), wav = fbm(uv, vec2(np*2.0, 3.0), 3, s + 2.0);
  float ring = 0.5 + 0.5*sin((fx*2.5 + wav*5.0 + r.x*5.0)*TAU);
  float g = (0.56 + 0.26*lines + 0.16*ring - 0.14*smoothstep(0.6, 0.9, pores))*(0.84 + 0.30*r.y);
  float ex = min(fx, 1.0 - fx), gap = 1.0 - smoothstep(0.0, 0.022, ex);
  float edge = smoothstep(0.10, 0.02, ex)*(0.4 + 0.6*fbm(uv, vec2(6.0, 30.0), 3, 5.0));
  float sc = scr(uv, 10.0, 6.0, 0.012, 1.57, 0.6, 0.35), dirt = smoothstep(0.55, 0.85, fbm(uv, vec2(4.0, 6.0), 4, 7.0));
  vec3 c = vec3(g)*vec3(1.0, 0.97, 0.92);
  c = mix(c, vec3(1.0, 0.92, 0.78), (edge*0.28 + sc*0.3)*uP.x);
  c *= 1.0 - dirt*0.22; c *= 1.0 - gap*0.82;
  emit(c, 1.0, 0.55 + (lines - 0.5)*0.2 + (ring - 0.5)*0.05 - gap*0.42 - sc*0.05, 1.0 - gap*0.5, 0.40 + 0.25*(1.0 - lines) + edge*0.2*uP.x + dirt*0.15, 0.0);
}`,

// bamboo skin: 5 cm strips, fibres along v, a node ring every 30 cm. tile 0.6 m
bamboo: `
void surf(vec2 uv){
  float ns = 12.0, sx = uv.x*ns, si = floor(sx), fx = sx - si; vec3 r = h3(vec2(si, 1.0), vec2(ns, 4.0), 1.0);
  float prof = sqrt(sat(1.0 - pow(abs(fx - 0.5)*2.0, 2.0)));
  float gap = smoothstep(0.0, 0.06, min(fx, 1.0 - fx));
  float ny = fract(uv.y*2.0 + r.x), nd = min(ny, 1.0 - ny)*0.5;
  float node = 1.0 - smoothstep(0.004, 0.014, nd), nodeDark = 1.0 - smoothstep(0.0015, 0.005, nd), band = smoothstep(0.07, 0.012, nd);
  float fib = fbm(uv, vec2(168.0, 3.0), 3, 2.0 + si), fib2 = fbm(uv, vec2(36.0, 2.0), 3, 5.0);
  vec3 c = mix(L(0.86, 0.70, 0.34), L(0.78, 0.66, 0.30), r.y); c = mix(c, L(0.60, 0.66, 0.26), step(0.7, r.z)*0.5);
  c *= (0.80 + 0.32*fib)*(0.92 + 0.16*fib2);
  c = mix(c, c*1.15 + 0.02, band*0.35); c = mix(c, L(0.27, 0.19, 0.09), nodeDark*0.75);
  vec4 sp = vor(uv*vec2(90.0, 30.0), vec2(90.0, 30.0), 6.0); c *= 1.0 - step(0.86, sp.z)*smoothstep(0.35, 0.1, sp.x)*0.4;
  c *= mix(0.5, 1.0, gap);
  emit(c, 1.0, mix(0.18, 0.35 + 0.42*prof + node*0.12 + (fib - 0.5)*0.03, gap), mix(0.55, 1.0, gap), 0.32 + 0.2*(1.0 - fib), 0.0);
}`,

// roll-up shutter (卷闸): 7.5 cm horizontal slats, galvanised, dirty in the seams. tile 0.9 m
shutter: `
void surf(vec2 uv){
  float ns = 12.0, sy = uv.y*ns, si = floor(sy), fy = sy - si;
  float prof = 0.5 + 0.5*cos((fy - 0.5)*TAU), seam = 1.0 - smoothstep(0.0, 0.08, min(fy, 1.0 - fy));
  vec3 r = h3(vec2(1.0, si), vec2(4.0, ns), 1.0);
  float vs = fbm(uv, vec2(40.0, 1.0), 3, 2.0), vs2 = fbm(uv, vec2(12.0, 1.0), 3, 3.0), big = fbm(uv, vec2(3.0), 4, 4.0), fine = fbm(uv, vec2(90.0), 3, 5.0);
  vec3 c = L(0.80, 0.84, 0.86)*(0.9 + 0.14*r.x);
  float dirt = sat(seam*0.6 + smoothstep(0.55, 0.8, vs)*0.35 + smoothstep(0.5, 0.8, vs2)*0.3 + (1.0 - prof)*0.22)*(0.5 + big);
  c = mix(c, L(0.25, 0.23, 0.20), dirt*0.55);
  float rust = smoothstep(0.82, 0.93, fbm(uv, vec2(9.0), 5, 6.0) + seam*0.10 + (fine - 0.5)*0.2)*uP.x;
  c = mix(c, L(0.42, 0.22, 0.10)*(0.7 + 0.6*fine), rust*0.85);
  float s1 = scr(uv, 8.0, 7.0, 0.02, 0.2, 2.0, 0.5); c = mix(c, vec3(0.78), s1*0.4);
  float h = 0.25 + 0.55*prof*(1.0 - seam*0.5) - seam*0.2 + (fbm(uv, vec2(5.0), 3, 8.0) - 0.5)*0.10 - rust*0.03;
  emit(c, 1.0, h, 1.0 - seam*0.45, mix(0.40, 0.85, max(dirt*0.7, rust)), mix(0.7, 0.05, max(rust, dirt*0.6)));
}`,

// enamel paint on steel (tinted by the material colour), chipped to rust. tile 1.5 m
paintmetal: DMG + `
void surf(vec2 uv){
  float fl, halo, run; damage(uv, uP.x, 5.0, fl, halo, run);
  float big = fbm(uv, vec2(3.0), 4, 1.0), fine = fbm(uv, vec2(90.0), 3, 2.0), rn = fbm(uv, vec2(40.0), 4, 3.0), vs = fbm(uv, vec2(30.0, 1.0), 3, 4.0);
  vec3 nt = vec3(0.0); float ta = 0.92 + 0.16*(big - 0.5);
  OV(L(0.22, 0.20, 0.17), smoothstep(0.55, 0.85, vs)*0.3)
  vec3 rustC = mix(L(0.46, 0.22, 0.08), L(0.26, 0.11, 0.05), rn);
  OV(rustC, sat(halo*0.6 + run*0.8)*0.6)
  OV(rustC*(0.8 + 0.5*fine), fl)
  emit(nt, ta, 0.62 + (fine - 0.5)*0.03 - fl*0.22 + fl*rn*0.1, 1.0 - fl*0.25, mix(0.36, 0.9, sat(fl + halo*0.5 + run*0.5)), fl*0.2);
}`,

rust: `
void surf(vec2 uv){
  float a = fbm(uv, vec2(5.0), 6, 1.0), b = fbm(uv, vec2(20.0), 4, 2.0), f = fbm(uv, vec2(100.0), 3, 3.0);
  vec4 pit = vor(uv*80.0, vec2(80.0), 4.0); float pp = step(0.7, pit.z)*smoothstep(0.3, 0.1, pit.x);
  vec3 c = mix(L(0.58, 0.28, 0.09), L(0.34, 0.14, 0.06), b); c = mix(c, L(0.72, 0.40, 0.12), smoothstep(0.55, 0.8, f)*0.6); c = mix(c, L(0.17, 0.10, 0.08), smoothstep(0.6, 0.75, a)*0.6);
  c *= 1.0 - pp*0.5;
  float steel = smoothstep(0.30, 0.22, a)*uP.x; c = mix(c, L(0.38, 0.39, 0.40), steel);
  emit(c, 1.0, 0.4 + floor(a*4.0)/4.0*0.35 + (f - 0.5)*0.1 - pp*0.15, 1.0 - pp*0.3, mix(0.9, 0.5, steel), steel*0.8);
}`,

steel: `
void surf(vec2 uv){
  float br = fbm(uv, vec2(2.0, 260.0), 3, 1.0), br2 = fbm(uv, vec2(6.0, 90.0), 3, 2.0), big = fbm(uv, vec2(4.0), 4, 3.0);
  float s1 = scr(uv, 9.0, 4.0, 0.012, 0.3, 3.0, 0.5), s2 = scr(uv, 24.0, 5.0, 0.02, 1.2, 3.0, 0.4);
  vec3 c = L(0.76, 0.77, 0.79)*(0.85 + 0.2*br)*(0.94 + 0.12*big); c = mix(c, vec3(0.85), max(s1, s2)*0.3);
  float smudge = smoothstep(0.55, 0.8, fbm(uv, vec2(7.0), 4, 6.0));
  emit(c, 1.0, 0.5 + (br - 0.5)*0.1 - max(s1, s2)*0.1, 1.0, 0.28 + 0.12*br2 + smudge*0.15, 1.0);
}`,

// hammered copper / brass (the metal colour is the material colour; alpha = bare metal), tarnish and verdigris. tile 0.5 m
patina: `
void surf(vec2 uv){
  vec4 dm = vor(uv*16.0, vec2(16.0), 1.0); float dim = smoothstep(0.0, 0.6, dm.x);
  float big = fbm(uv, vec2(3.0), 5, 2.0), mid = fbm(uv, vec2(12.0), 4, 3.0), fine = fbm(uv, vec2(70.0), 3, 4.0), vs = fbm(uv, vec2(24.0, 1.0), 3, 5.0);
  vec3 nt = vec3(0.0); float ta = 0.92 + 0.16*(mid - 0.5);
  float tarn = smoothstep(0.5, 0.85, big + (mid - 0.5)*0.4 + dim*0.1); OV(L(0.24, 0.13, 0.07), tarn*0.30)
  float verd = smoothstep(0.83, 0.93, fbm(uv, vec2(5.0), 5, 6.0) + (1.0 - dim)*0.10 + smoothstep(0.6, 0.85, vs)*0.06)*uP.x;
  OV(L(0.30, 0.66, 0.55)*(0.75 + 0.5*fine), verd*0.88)
  emit(nt, ta, 0.42 + dim*0.3*uP.y + verd*0.05*fine, 1.0, mix(0.24 + 0.2*tarn + (fine - 0.5)*0.1, 0.85, verd), 0.72*(1.0 - verd*0.92));
}`,

ceramic: `
void surf(vec2 uv){
  float big = fbm(uv, vec2(4.0), 4, 1.0), fine = fbm(uv, vec2(60.0), 3, 2.0);
  vec4 sp = vor(uv*120.0, vec2(120.0), 3.0); float speck = step(0.93, sp.z)*smoothstep(0.25, 0.08, sp.x);
  vec2 w = uv + (vec2(fbm(uv, vec2(9.0), 3, 4.0), fbm(uv, vec2(9.0), 3, 5.0)) - 0.5)*0.05;
  vec4 cr = vor(w*9.0, vec2(9.0), 6.0); float crk = (1.0 - smoothstep(0.0, 0.008, cr.y - cr.x))*smoothstep(0.45, 0.7, fbm(uv, vec2(3.0), 3, 7.0))*uP.x;
  vec3 c = vec3(0.94 + 0.06*(big - 0.5)*2.0)*vec3(1.0, 0.99, 0.96); c *= 1.0 - speck*0.5 - crk*0.3;
  emit(c, 1.0, 0.5 + (big - 0.5)*0.1 - crk*0.05, 1.0, 0.10 + 0.06*fine + crk*0.2, 0.0);
}`,

glassdark: `
void surf(vec2 uv){
  float dust = fbm(uv, vec2(6.0), 5, 1.0), vs = fbm(uv, vec2(30.0, 1.0), 3, 2.0);
  vec4 dr = vor(uv*40.0, vec2(40.0), 4.0); float drop = step(0.6, dr.z)*smoothstep(0.22, 0.12, dr.x);
  float film = sat(smoothstep(0.4, 0.8, dust)*0.5 + smoothstep(0.55, 0.85, vs)*0.4);
  vec3 c = mix(L(0.10, 0.17, 0.22), L(0.42, 0.42, 0.38), film*0.35);
  emit(c, 1.0, 0.5 + drop*0.2, 1.0, mix(0.06, 0.5, film) - drop*0.03, 0.0);
}`,

// 满洲窗: a dark wooden lattice holding coloured glass, lit from inside. One sash panel per tile (0.6 m), the sash frame on the
// tile border. uP.x = layout 0..3. alpha = glow mask (0 on the wood)
manchu: `
vec3 PAL(int i){ return i == 0 ? vec3(1.0, 0.045, 0.03) : i == 1 ? vec3(0.025, 0.25, 1.0) : i == 2 ? vec3(0.0, 0.68, 0.17) : i == 3 ? vec3(1.0, 0.55, 0.02) : vec3(0.42, 0.06, 1.0); }
void surf(vec2 uv){
  int lay = int(uP.x + 0.5);
  vec2 p = uv, c0 = p - 0.5, a = abs(c0);
  float bw = 0.015, aw = uTexel.x*1.2;
  float dbar = min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y)) - 0.030;
  int ci = 0; float pid = 0.0, etch = 0.0;
  float r = length(c0), an = atan(c0.y, c0.x);
  if(lay == 0){
    float b = 0.5 - 0.195;
    dbar = min(dbar, min(abs(a.x - b), abs(a.y - b)) - bw);
    bool ox = a.x > b, oy = a.y > b;
    if(ox && oy){ ci = 0; pid = 1.0; }
    else if(ox){ ci = 2; pid = 2.0 + step(0.0, c0.x); }
    else if(oy){ ci = 1; pid = 4.0 + step(0.0, c0.y); }
    else {
      float dm = (a.x + a.y - 0.235)*0.7071;
      dbar = min(dbar, abs(dm) - bw*0.85);
      dbar = min(dbar, max(min(a.x, a.y) - bw*0.85, -dm));
      if(dm < 0.0){ ci = 4; pid = 6.0; etch = cov(r - 0.085*(0.55 + 0.45*cos(6.0*an)), aw*2.0)*(1.0 - cov(r - 0.022, aw*2.0)); }
      else { ci = 3; pid = 7.0 + step(0.0, c0.x) + 2.0*step(0.0, c0.y); }
    }
  } else if(lay == 1){
    float b = 0.5 - 0.125, inner = max(a.x, a.y) - b;
    dbar = min(dbar, abs(inner) - bw);
    if(inner > 0.0){
      bool ox = a.x > b, oy = a.y > b;
      if(ox && oy){ ci = 3; pid = 1.0; }
      else { float t = ((ox ? p.y : p.x) - (0.5 - b))/(2.0*b), ft = fract(t*4.0); dbar = min(dbar, min(ft, 1.0 - ft)*0.25*2.0*b - bw*0.85); float k = floor(t*4.0); ci = mod(k, 2.0) < 0.5 ? 2 : 4; pid = 2.0 + k + (ox ? 4.0 : 0.0); }
    } else {
      vec2 q = c0/(2.0*b); float u = (q.x + q.y)*3.0, v = (q.x - q.y)*3.0;
      float du = abs(fract(u) - 0.5), dv = abs(fract(v) - 0.5);
      dbar = min(dbar, min(du, dv)/4.2426*2.0*b - bw*0.85);
      float iu = floor(u + 0.5), iv = floor(v + 0.5), m = mod(iu + 2.0*iv + 30.0, 3.0);
      ci = m < 0.5 ? 3 : m < 1.5 ? 0 : 1; pid = 12.0 + iu*7.0 + iv*13.0;
    }
  } else if(lay == 2){
    float k = 4.0; vec2 g = p*k, id = floor(g), f = abs(fract(g) - 0.5);
    float dq = 0.5 - max(f.x, f.y), dd = (0.72 - (f.x + f.y))*0.7071;
    dbar = min(dbar, abs(dd)/k - bw*0.8);
    dbar = min(dbar, max(dq/k - bw*0.8, -dd/k));
    if(dd < 0.0){ ci = 0; pid = 1.0 + mod(floor(g.x + 0.5) + floor(g.y + 0.5)*4.0, 16.0); }
    else { ci = mod(id.x + id.y, 2.0) < 0.5 ? 2 : 3; pid = 20.0 + id.x + id.y*4.0; float rr = length(fract(g) - 0.5), aa = atan(fract(g).y - 0.5, fract(g).x - 0.5); etch = cov(rr - 0.16*(0.6 + 0.4*cos(8.0*aa)), aw*k*2.0)*(1.0 - cov(rr - 0.05, aw*k*2.0)); }
  } else {
    float m = max(a.x, a.y), r1 = 0.375, r2 = 0.275, rr = 0.185;
    dbar = min(dbar, min(abs(m - r1), abs(m - r2)) - bw);
    if(m > r1){
      bool ox = a.x > r1, oy = a.y > r1;
      if(ox && oy){ ci = 3; pid = 1.0; }
      else { float t = ox ? c0.y : c0.x; dbar = min(dbar, abs(abs(t) - r1/3.0) - bw*0.85); ci = abs(t) < r1/3.0 ? 4 : 1; pid = 2.0 + step(0.0, t) + (ox ? 2.0 : 0.0) + step(r1/3.0, abs(t))*4.0; }
    } else if(m > r2){
      dbar = min(dbar, abs(a.x - a.y)*0.7071 - bw*0.85); ci = 0; pid = 10.0 + step(a.y, a.x);
    } else {
      dbar = min(dbar, abs(r - rr) - bw);
      if(r < rr){ ci = 3; pid = 14.0; etch = cov(r - 0.13*(0.6 + 0.4*cos(8.0*an)), aw*2.0)*(1.0 - cov(r - 0.035, aw*2.0)); }
      else { ci = 2; pid = 15.0; dbar = min(dbar, max(abs(a.x - a.y)*0.7071 - bw*0.85, rr - r)); }
    }
  }
  float wood = cov(dbar, aw), open = smoothstep(0.0, 0.075, dbar), lamp = 0.80 + 0.36*exp(-dot(c0, c0)*5.0);
  vec3 pr = h3(vec2(pid, float(lay)), vec2(128.0), 7.0);
  vec3 pc = PAL(ci);
  float rip = fbm(uv, vec2(24.0, 9.0), 3, 8.0), cloud = fbm(uv, vec2(5.0), 4, 9.0);
  vec4 sd = vor(uv*70.0, vec2(70.0), 10.0); float seed = step(0.85, sd.z)*smoothstep(0.25, 0.1, sd.x);
  float glow = (0.40 + 0.60*open)*(0.84 + 0.30*(rip - 0.5))*(0.80 + 0.26*pr.x)*(0.90 + 0.20*(cloud - 0.5))*lamp + seed*0.08;
  pc = mix(pc, mix(pc, vec3(1.0, 0.93, 0.80), 0.6), etch); glow += etch*0.12;
  vec3 wc = L(0.26, 0.11, 0.06)*(0.7 + 0.6*fbm(uv, vec2(8.0, 90.0), 3, 11.0));
  float hb = smoothstep(0.0, 0.010, -dbar);
  emit(mix(pc, wc, wood), sat(glow)*(1.0 - wood), mix(0.30 + rip*0.07 + seed*0.05, 0.50 + 0.4*hb, wood), mix(0.7 + 0.3*open, 1.0, wood), mix(0.10 + 0.10*rip, 0.5, wood), 0.0);
}`,

// woven cloth (canvas awnings, sheets). uP.x = threads per tile, uP.y = 1 for red-white-blue stripes, uP.z = dirt, uP.w = folds
cloth: `
void surf(vec2 uv){
  float F = uP.x, u = uv.x*F, v = uv.y*F, chk = mod(floor(u) + floor(v), 2.0);
  float weave = sin(fract(u)*3.14159)*sin(fract(v)*3.14159);
  float fold = fbm(uv, vec2(2.0, 5.0), 4, 1.0), vs = fbm(uv, vec2(22.0, 1.0), 3, 3.0), big = fbm(uv, vec2(3.0), 4, 4.0);
  vec3 c = vec3(0.84 + 0.16*weave)*mix(0.93, 1.0, chk);
  if(uP.y > 0.5){ float sx = fract(uv.x*2.0)*4.0; float e = abs(fract(sx) - 0.5); vec3 sc = sx < 1.0 ? uC[0] : sx < 2.0 ? uC[2] : sx < 3.0 ? uC[1] : uC[2]; c *= sc*(0.9 + 0.1*smoothstep(0.5, 0.44, e)); }
  c *= 0.84 + 0.26*fold;
  float dirt = sat(smoothstep(0.55, 0.85, vs)*0.5 + smoothstep(0.55, 0.85, big)*0.4)*uP.z;
  c = mix(c, c*vec3(0.55, 0.50, 0.42), dirt*0.6);
  float fade = smoothstep(0.5, 0.8, fbm(uv, vec2(4.0), 4, 6.0))*uP.z; c = mix(c, c*0.8 + vec3(luma(c))*0.25 + 0.03, fade*0.4);
  emit(c, 1.0, 0.45 + weave*0.10 + (fold - 0.5)*0.6*uP.w, 0.75 + 0.25*weave, 0.86 - 0.1*weave, 0.0);
}`,

// paper lantern: ribs every 2.5 cm, paper seams, lit from inside. tile 0.4 m. alpha = glow mask
lantern: `
void surf(vec2 uv){
  float nr = 16.0, ry = uv.y*nr, fy = ry - floor(ry), rib = 1.0 - smoothstep(0.03, 0.11, min(fy, 1.0 - fy)), bulge = sin(fy*3.14159);
  float fib = fbm(uv, vec2(40.0, 90.0), 3, 1.0), cloud = fbm(uv, vec2(5.0), 4, 2.0);
  float seam = 1.0 - smoothstep(0.0, 0.014, abs(fract(uv.x*4.0) - 0.5));
  vec3 c = vec3(1.0, 0.97, 0.90)*(0.82 + 0.18*fib)*(0.92 + 0.16*cloud); c *= 1.0 - rib*0.45 - seam*0.14;
  float glow = (0.60 + 0.40*bulge)*(0.85 + 0.3*(cloud - 0.5))*(1.0 - rib*0.5)*(1.0 - seam*0.2);
  emit(c, glow, 0.4 + 0.25*bulge + rib*0.35, 1.0 - rib*0.2, 0.8, 0.0);
}`,

rubber: `
void surf(vec2 uv){
  float fine = fbm(uv, vec2(90.0), 3, 1.0), big = fbm(uv, vec2(5.0), 4, 2.0);
  float zz = abs(fract(uv.x*8.0 + abs(fract(uv.y*8.0) - 0.5)*0.8) - 0.5), groove = 1.0 - smoothstep(0.06, 0.12, zz);
  vec3 c = L(0.15, 0.15, 0.16)*(0.8 + 0.4*fine); c = mix(c, L(0.36, 0.33, 0.28), smoothstep(0.5, 0.8, big)*0.35); c *= 1.0 - groove*0.5;
  emit(c, 1.0, 0.6 - groove*0.4 + (fine - 0.5)*0.05, 1.0 - groove*0.4, 0.82, 0.0);
}`,

plastic: `
void surf(vec2 uv){
  float big = fbm(uv, vec2(4.0), 4, 1.0), fine = fbm(uv, vec2(120.0), 2, 2.0);
  float s = max(scr(uv, 10.0, 3.0, 0.014, 0.4, 3.0, 0.5), scr(uv, 26.0, 4.0, 0.02, 2.0, 3.0, 0.4)), scuff = smoothstep(0.55, 0.8, fbm(uv, vec2(9.0), 4, 5.0));
  vec3 nt = vec3(0.0); float ta = 0.94 + 0.12*(big - 0.5);
  OV(vec3(0.85), s*0.32 + scuff*0.04)
  OV(L(0.26, 0.23, 0.2), smoothstep(0.68, 0.9, fbm(uv, vec2(5.0, 3.0), 4, 6.0))*0.14)
  emit(nt, ta, 0.5 - s*0.1 + (fine - 0.5)*0.03, 1.0, 0.30 + scuff*0.3 + s*0.2, 0.0);
}`,

cardboard: `
void surf(vec2 uv){
  float fl = 0.5 + 0.5*cos(uv.x*TAU*64.0), fib = fbm(uv, vec2(30.0, 120.0), 3, 1.0), big = fbm(uv, vec2(3.0), 4, 2.0);
  float damp = fbm(uv, vec2(3.0, 2.0), 4, 3.0), tide = 1.0 - smoothstep(0.0, 0.025, abs(damp - 0.6)), wetz = smoothstep(0.6, 0.66, damp);
  float crease = 1.0 - smoothstep(0.0, 0.006, abs(fbm(uv, vec2(2.0), 3, 4.0) - 0.5));
  vec3 c = L(0.76, 0.58, 0.36)*(0.86 + 0.2*fib)*(0.92 + 0.16*big)*(0.96 + 0.04*fl);
  c = mix(c, c*vec3(0.62, 0.58, 0.52), (wetz*0.6 + tide*0.35)*uP.x); c *= 1.0 - crease*0.25;
  emit(c, 1.0, 0.5 + fl*0.05 + (fib - 0.5)*0.05 - crease*0.15, 1.0 - crease*0.2, 0.9, 0.0);
}`,

// salted fish: overlapping scales (free edge down, like shingles), dried gold and silver, salt crust. tile 0.2 m
fish: `
void surf(vec2 uv){
  vec2 n = vec2(18.0, 28.0), p = uv*n, id = vec2(0.0); float d = 1.0, t = 0.0;
  for(int k = 2; k >= 0; k--){
    float j = floor(p.y) + float(k), off = mod(j, 2.0)*0.5, i = floor(p.x - off), cx = i + 0.5 + off;
    float dd = length(vec2((p.x - cx)/0.60, (p.y - j)/1.22));
    if(dd < 1.0){ d = dd; t = (j - p.y)/1.22; id = vec2(i, j); break; }
  }
  vec3 r = h3(id, n, 1.0);
  float tt = sat(t), rim = smoothstep(0.78, 0.97, d)*step(0.0, t), under = smoothstep(-0.55, 0.12, t);
  float big = fbm(uv, vec2(3.0), 4, 2.0), fine = fbm(uv, vec2(90.0), 3, 3.0);
  vec3 c = mix(L(0.82, 0.78, 0.64), L(0.90, 0.68, 0.30), big);
  c = mix(c, L(0.60, 0.41, 0.22), smoothstep(0.55, 0.8, fbm(uv, vec2(2.0, 5.0), 3, 4.0))*0.55);
  c *= (0.70 + 0.38*tt + (r.x - 0.5)*0.20)*(0.9 + 0.2*fine);
  c = mix(c, c*1.3 + 0.05, rim*0.55); c *= mix(0.5, 1.0, under);
  vec4 sl = vor(uv*120.0, vec2(120.0), 5.0); float salt = step(0.78, sl.z)*smoothstep(0.3, 0.1, sl.x)*smoothstep(0.4, 0.7, fbm(uv, vec2(6.0), 3, 6.0));
  c = mix(c, vec3(0.93, 0.93, 0.89), salt*0.8);
  emit(c, 1.0, 0.22 + 0.55*tt*(1.0 - 0.3*d*d) + salt*0.15, mix(0.55, 1.0, under), mix(0.34 + 0.2*fine, 0.8, salt), 0.3*(1.0 - salt));
}`,

leaf: `
void surf(vec2 uv){
  vec4 v = vor(uv*7.0, vec2(7.0), 1.0), v2 = vor(uv*15.0 + 3.3, vec2(15.0), 2.0);
  float edge = smoothstep(0.0, 0.12, v.y - v.x), fine = fbm(uv, vec2(60.0), 3, 3.0), big = fbm(uv, vec2(3.0), 4, 4.0);
  vec3 c = mix(L(0.16, 0.42, 0.14), L(0.38, 0.66, 0.18), v.z); c = mix(c, L(0.10, 0.32, 0.17), step(0.6, v2.z)*0.4*smoothstep(0.4, 0.2, v2.x));
  float vein = 1.0 - smoothstep(0.0, 0.03, abs(v.x - 0.25));
  c *= 0.72 + 0.38*edge; c = mix(c, c*1.3 + vec3(0.02, 0.04, 0.0), vein*0.2); c *= 0.9 + 0.2*fine;
  c = mix(c, L(0.66, 0.58, 0.20), smoothstep(0.75, 0.9, big)*0.4);
  emit(c, 1.0, 0.3 + 0.5*edge*(1.0 - v.x) + (fine - 0.5)*0.05, 0.6 + 0.4*edge, 0.40 + 0.2*fine, 0.0);
}`,

soil: `
void surf(vec2 uv){
  vec4 a = vor(uv*40.0, vec2(40.0), 1.0), b = vor(uv*110.0, vec2(110.0), 2.0); float big = fbm(uv, vec2(4.0), 4, 3.0), fine = fbm(uv, vec2(70.0), 3, 4.0);
  vec3 c = mix(L(0.27, 0.19, 0.12), L(0.40, 0.29, 0.18), big)*(0.75 + 0.5*fine);
  c = mix(c, L(0.56, 0.51, 0.43), step(0.9, a.z)*smoothstep(0.35, 0.2, a.x)); c *= 0.8 + 0.3*smoothstep(0.0, 0.4, b.x);
  emit(c, 1.0, 0.4 + 0.25*(1.0 - a.x) + 0.15*(1.0 - b.x) + (fine - 0.5)*0.1, 0.7 + 0.3*smoothstep(0.0, 0.3, b.x), 0.95, 0.0);
}`,

rope: `
void surf(vec2 uv){
  float s = fract(uv.x*4.0 + uv.y*4.0), strand = sin(s*3.14159), yarn = 0.5 + 0.5*sin((uv.x*4.0 - uv.y*4.0)*TAU*5.0 + strand*2.0);
  float fine = fbm(uv, vec2(60.0), 3, 1.0), big = fbm(uv, vec2(4.0), 3, 2.0);
  vec3 c = L(0.78, 0.63, 0.40)*(0.6 + 0.4*strand)*(0.86 + 0.14*yarn)*(0.85 + 0.3*fine); c = mix(c, c*vec3(0.6, 0.56, 0.5), smoothstep(0.5, 0.8, big)*0.5);
  emit(c, 1.0, 0.25 + 0.6*strand + yarn*0.06, 0.55 + 0.45*strand, 0.9, 0.0);
}`,
};

const COPY_FS = `precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D tA; uniform int uMode; uniform vec2 uTexel; uniform vec2 uK; in vec2 vUv; layout(location = 0) out vec4 o;
float H(vec2 uv){ vec4 t = texture(tA, uv); return t.r + t.g/255.0; }
void main(){
  if(uMode == 0){ vec4 t = texture(tA, vUv); o = vec4(t.rgb*t.rgb, t.a); }
  else if(uMode == 1){ o = texture(tA, vUv); }
  else {
    vec2 d = uTexel;
    float l = H(vUv - vec2(d.x, 0.0)), r = H(vUv + vec2(d.x, 0.0)), dn = H(vUv - vec2(0.0, d.y)), up = H(vUv + vec2(0.0, d.y));
    float lu = H(vUv + vec2(-d.x, d.y)), ru = H(vUv + d), ld = H(vUv - d), rd = H(vUv + vec2(d.x, -d.y));
    float gx = (ru + 2.0*r + rd - lu - 2.0*l - ld)*0.125, gy = (lu + 2.0*up + ru - ld - 2.0*dn - rd)*0.125;
    o = vec4(normalize(vec3(-gx*uK.x, -gy*uK.y, 1.0))*0.5 + 0.5, 1.0);
  }
}`;

// ------------------------------------------------------------------------------------------------ the tables
// texture sets: fn = surface shader, tile = metres per repeat, size = share of G.quality.tex, bump = relief in mm,
// nb = the normal map stores slopes nb times steeper and the material scales them back (8 bits cannot hold a 0.3 degree tilt)
const c3 = h => { const c = new THREE.Color(h); return new THREE.Vector3(c.r, c.g, c.b); };   // hex (as seen on screen) -> linear
const SETS = {
  granite:       { fn: 'granite', tile: 2.2, size: 1, bump: 8, nb: 3, aniso: 16 },
  tile_a:        { fn: 'tile', tile: 0.8, size: 1, bump: 4, nb: 4, aniso: 16, p: [0, 1], colors: [0xf0e2bb, 0xb9412e, 0x2f8f6d, 0x5c7f9c] },
  tile_b:        { fn: 'tile', tile: 0.8, size: 1, bump: 4, nb: 4, aniso: 16, p: [1, 1], seed: 3, colors: [0xd9a441, 0x4f7396, 0xf1e4c2, 0xb23a2a] },
  tile_c:        { fn: 'tile', tile: 0.8, size: 1, bump: 4, nb: 4, aniso: 16, p: [2, 1], seed: 5, colors: [0xefe0b8, 0x2e9070] },
  plaster:       { fn: 'plaster', tile: 2.4, size: 1, bump: 2.5, p: [0.45] },
  plaster_old:   { fn: 'plaster', tile: 2.4, size: 1, bump: 3, p: [1.35], seed: 2 },
  brick:         { fn: 'brick', tile: 1.5, size: 1, bump: 4, p: [0.7] },
  concrete:      { fn: 'concrete', tile: 2, size: 0.5, bump: 2.5, p: [1] },
  wood:          { fn: 'wood', tile: 1.2, size: 0.5, bump: 2.5, p: [1] },
  bamboo:        { fn: 'bamboo', tile: 0.6, size: 0.5, bump: 4 },
  shutter:       { fn: 'shutter', tile: 0.9, size: 0.5, bump: 9, p: [1] },
  paintmetal:    { fn: 'paintmetal', tile: 1.5, size: 0.5, bump: 1.2, p: [0.6] },
  rust:          { fn: 'rust', tile: 1, size: 0.25, bump: 2, p: [1] },
  steel:         { fn: 'steel', tile: 1, size: 0.25, bump: 0.5 },
  patina:        { fn: 'patina', tile: 0.5, size: 0.5, bump: 1.6, p: [1, 1] },
  ceramic:       { fn: 'ceramic', tile: 0.5, size: 0.25, bump: 0.4, p: [1] },
  glassdark:     { fn: 'glassdark', tile: 1, size: 0.25, bump: 0.4 },
  manchu_a:      { fn: 'manchu', tile: 0.6, size: 0.5, bump: 9, p: [0], aniso: 8 },
  manchu_b:      { fn: 'manchu', tile: 0.6, size: 0.5, bump: 9, p: [1], seed: 1, aniso: 8 },
  manchu_c:      { fn: 'manchu', tile: 0.6, size: 0.5, bump: 9, p: [2], seed: 2, aniso: 8 },
  manchu_d:      { fn: 'manchu', tile: 0.6, size: 0.5, bump: 9, p: [3], seed: 3, aniso: 8 },
  canvas:        { fn: 'cloth', tile: 0.5, size: 0.5, bump: 3, p: [160, 0, 1, 1] },
  canvas_stripe: { fn: 'cloth', tile: 0.8, size: 0.5, bump: 3, p: [256, 1, 0.8, 1], seed: 4, colors: [0xd8362a, 0x2a58c0, 0xf2eee2] },
  linen:         { fn: 'cloth', tile: 0.25, size: 0.25, bump: 1.5, p: [96, 0, 0.35, 1], seed: 6 },
  lantern:       { fn: 'lantern', tile: 0.4, size: 0.25, bump: 3 },
  rubber:        { fn: 'rubber', tile: 0.25, size: 0.25, bump: 2 },
  plastic:       { fn: 'plastic', tile: 0.6, size: 0.25, bump: 0.5 },
  cardboard:     { fn: 'cardboard', tile: 0.5, size: 0.25, bump: 1.5, p: [1] },
  fish:          { fn: 'fish', tile: 0.2, size: 0.5, bump: 1.5 },
  leaf:          { fn: 'leaf', tile: 0.4, size: 0.25, bump: 4 },
  soil:          { fn: 'soil', tile: 0.5, size: 0.25, bump: 6 },
  rope:          { fn: 'rope', tile: 0.08, size: 0.25, bump: 4 },
};
// materials: mode 0 = texture x colour, 1 = texture rgb + colour x alpha (painted things), 2 = as 0 but alpha glows.
// wet = [darken, gloss multiplier, how wet walls get, pooling in the low parts]; vary = [macro, grime, micro]
const FLOOR = { wet: [0.42, 0.26, 0.6, 1], vary: [0.14, 0.22, 0.10] };
const WALL = { wet: [0.26, 0.55, 0.9, 0], vary: [0.14, 0.40, 0.10] };
const HARD = { wet: [0.12, 0.55, 0.8, 0.3], vary: [0.06, 0.25, 0.04] };
const SOFT = { wet: [0.32, 0.6, 0.7, 0], vary: [0.10, 0.30, 0.06] };
const DEFS = {
  granite_slab:   { set: 'granite', ...FLOOR },
  tile_flower_a:  { set: 'tile_a', ...FLOOR },
  tile_flower_b:  { set: 'tile_b', ...FLOOR },
  tile_check:     { set: 'tile_c', ...FLOOR },
  plaster_cream:  { set: 'plaster', mode: 1, color: 0xf2deaa, ...WALL },
  plaster_teal:   { set: 'plaster', mode: 1, color: 0x35a89c, ...WALL },
  plaster_pink:   { set: 'plaster', mode: 1, color: 0xee9d9a, ...WALL },
  plaster_stained: { set: 'plaster_old', mode: 1, color: 0xd9cfa6, ...WALL },
  brick_grey:     { set: 'brick', ...WALL, vary: [0.12, 0.35, 0.10] },
  concrete:       { set: 'concrete', ...WALL, wet: [0.36, 0.4, 0.8, 0.6] },
  wood_dark:      { set: 'wood', color: 0x8a5a3a, ...SOFT, wet: [0.25, 0.5, 0.7, 0.3] },
  wood_red:       { set: 'wood', color: 0xb5281c, ...SOFT, wet: [0.22, 0.5, 0.7, 0.3] },
  bamboo:         { set: 'bamboo', ...HARD, wet: [0.2, 0.6, 0.7, 0] },
  metal_shutter:  { set: 'shutter', ...HARD },
  metal_green:    { set: 'paintmetal', mode: 1, color: 0x1f7a52, ...HARD },
  metal_rust:     { set: 'rust', ...HARD, wet: [0.25, 0.5, 0.8, 0] },
  steel:          { set: 'steel', ...HARD },
  brass:          { set: 'patina', mode: 1, color: 0xe8bb55, ...HARD },
  copper:         { set: 'patina', mode: 1, color: 0xe58a55, ...HARD },
  ceramic_white:  { set: 'ceramic', color: 0xf4f1e8, ...HARD },
  ceramic_blue:   { set: 'ceramic', color: 0x2a5cc0, ...HARD },
  glass_dark:     { set: 'glassdark', ...HARD, vary: [0.03, 0.15, 0] },
  glass_manchu_a: { set: 'manchu_a', mode: 2, emis: [2.0, 0.3] },
  glass_manchu_b: { set: 'manchu_b', mode: 2, emis: [2.0, 0.3] },
  glass_manchu_c: { set: 'manchu_c', mode: 2, emis: [2.0, 0.3] },
  glass_manchu_d: { set: 'manchu_d', mode: 2, emis: [2.0, 0.3] },
  awning_red:     { set: 'canvas', color: 0xd9332a, ...SOFT },
  awning_green:   { set: 'canvas', color: 0x1f9a62, ...SOFT },
  awning_stripe:  { set: 'canvas_stripe', ...SOFT },
  paper_lantern:  { set: 'lantern', mode: 2, color: 0xff8a30, emis: [2.1, 1], lantern: true },
  rubber:         { set: 'rubber', ...HARD, wet: [0.2, 0.5, 0.8, 0] },
  plastic_red:    { set: 'plastic', mode: 1, color: 0xe02a20, ...HARD },
  plastic_blue:   { set: 'plastic', mode: 1, color: 0x1f62d8, ...HARD },
  cardboard:      { set: 'cardboard', ...SOFT, wet: [0.4, 0.8, 0.8, 0] },
  fish_salted:    { set: 'fish', ...HARD, vary: [0.04, 0.1, 0.03] },
  leaf:           { set: 'leaf', ...HARD, wet: [0.1, 0.45, 0.9, 0], vary: [0.12, 0.1, 0.04] },
  soil:           { set: 'soil', ...SOFT, wet: [0.4, 0.6, 0.8, 0] },
  rope:           { set: 'rope', ...SOFT },
  cloth_white:    { set: 'linen', color: 0xf2eee4, ...SOFT },
  cloth_blue:     { set: 'linen', color: 0x3463b4, ...SOFT },
};

// ------------------------------------------------------------------------------------------------ the runtime patch
const FRAG_DECL = `
varying vec3 vQlW; varying vec3 vQlN;
uniform float uQlWet; uniform float uQlGlow; uniform vec4 uQlX; uniform vec4 uQlWp; uniform vec4 uQlV; uniform vec2 uQlE;
float qlH(vec3 p){ p = fract(p*0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x + p.y + p.z)); }
float qlNoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(qlH(i), qlH(i + vec3(1, 0, 0)), f.x), mix(qlH(i + vec3(0, 1, 0)), qlH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(qlH(i + vec3(0, 0, 1)), qlH(i + vec3(1, 0, 1)), f.x), mix(qlH(i + vec3(0, 1, 1)), qlH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;
const FRAG_MAP = `
  vec3 qlN = normalize(vQlN);
  #ifdef DOUBLE_SIDED
    qlN *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
  vec4 qlOrm = texture2D(roughnessMap, vRoughnessMapUv);
  #if QL_MODE == 1
    diffuseColor.rgb = sampledDiffuseColor.rgb + diffuse*sampledDiffuseColor.a;
  #endif
  float qlWetK = 0.0, qlPool = 0.0, qlFilm = 0.0, qlUp = 0.0, qlMicro = 0.0, qlM2 = 0.5;
  #ifdef QL_FX
  {
    // world-space variation: two broad octaves hide the tiling, one fine octave keeps close-ups crisp
    float qlM1 = qlNoise(vQlW*0.43); qlM2 = qlNoise(vQlW*1.71 + 11.3);
    float qlNear = clamp(1.0 - length(fwidth(vQlW))*140.0, 0.0, 1.0);
    qlMicro = (qlNoise(vQlW*230.0) - 0.5)*qlNear;
    diffuseColor.rgb *= 1.0 + ((qlM1 - 0.5) + (qlM2 - 0.5)*0.6)*uQlV.x + qlMicro*uQlV.z;
    // grime film, pulled into the crevices by the ao channel
    float qlGr = smoothstep(0.5, 0.9, qlM1*0.5 + qlM2*0.5 + (1.0 - qlOrm.r)*0.45)*uQlV.y;
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.50, 0.46, 0.40), qlGr);
    // rain: tops wet, walls streaked, undersides dry
    qlUp = smoothstep(0.25, 0.85, qlN.y);
    float qlExpo = smoothstep(-0.5, -0.05, qlN.y);
    float qlS = vQlW.x + vQlW.z;
    float qlSt = qlNoise(vec3(qlS*3.3, vQlW.y*0.35, 2.7))*qlNoise(vec3(qlS*14.0, vQlW.y*0.7, 8.1));
    qlSt = smoothstep(0.10, 0.42, qlSt)*(0.15 + 0.85*smoothstep(0.35, 0.7, qlNoise(vec3(qlS*0.6, vQlW.y*0.22, 4.4))));
    float qlW = uQlWet*uQlX.x*qlExpo;
    qlPool = qlUp*smoothstep(0.62, 0.30, qlOrm.a)*uQlWp.w;
    float qlLow = smoothstep(0.55, 0.02, vQlW.y)*(1.0 - qlUp)*qlExpo*uQlWet*(0.35 + 0.65*uQlX.x);      // splashed band where things meet the ground
    qlWetK = clamp(qlW*mix(uQlWp.z*(0.22 + 1.1*qlSt), 0.80 + 0.3*(qlM2 - 0.5) + 0.4*qlPool, qlUp) + qlLow*0.55, 0.0, 1.0);
    // a standing film of water: in the low parts (joints, dips) and in broad patches
    qlFilm = clamp(qlUp*qlW*(qlPool + smoothstep(0.40, 0.72, qlM1*0.55 + qlM2*0.45)*uQlWp.w*0.85), 0.0, 1.0);
    float qlL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    diffuseColor.rgb = max(mix(vec3(qlL), diffuseColor.rgb, 1.0 + 0.5*qlWetK*uQlWp.x), 0.0)*(1.0 - uQlWp.x*qlWetK);
    diffuseColor.rgb *= 1.0 - 0.25*qlLow*uQlV.y;
  }
  #endif
  #ifdef QL_EMIS
    diffuseColor.rgb *= mix(1.0, uQlE.y, sampledDiffuseColor.a);
  #endif
`;
const FRAG_ROUGH = `
  #ifdef QL_FX
    roughnessFactor *= 1.0 + (qlM2 - 0.5)*0.25 + qlMicro*0.5;
    roughnessFactor = mix(roughnessFactor, roughnessFactor*uQlWp.y, qlWetK);
    roughnessFactor = clamp(mix(roughnessFactor, 0.045, qlFilm*0.9), 0.04, 1.0);
  #endif
`;
const FRAG_EMIS = `
  #ifdef QL_EMIS
  {
    float qlF = 1.0;
    #ifdef QL_LANTERN
      qlF = mix(0.45, 1.3, pow(clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 1.4));
    #endif
    totalEmissiveRadiance += sampledDiffuseColor.rgb*diffuse*sampledDiffuseColor.a*(uQlE.x*uQlGlow*qlF);
  }
  #endif
`;
const VERT_DECL = `\nvarying vec3 vQlW; varying vec3 vQlN;`;
const VERT_POS = `
  { vec4 qlP = vec4(transformed, 1.0);
    #ifdef USE_BATCHING
      qlP = batchingMatrix*qlP;
    #endif
    #ifdef USE_INSTANCING
      qlP = instanceMatrix*qlP;
    #endif
    vQlW = (modelMatrix*qlP).xyz;
    vQlN = inverseTransformDirection(transformedNormal, viewMatrix); }
`;
function applyPatch(shader, U) {
  Object.assign(shader.uniforms, U);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>' + VERT_DECL).replace('#include <project_vertex>', '#include <project_vertex>' + VERT_POS);
  let nm = THREE.ShaderChunk.normal_fragment_maps;
  if (nm.includes('mapN.xy *= normalScale;')) nm = nm.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale*(1.0 - 0.6*qlFilm);'); else nm = '#include <normal_fragment_maps>';
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>' + FRAG_DECL)
    .replace('#include <map_fragment>', '#include <map_fragment>' + FRAG_MAP)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>' + FRAG_ROUGH)
    .replace('#include <normal_fragment_maps>', nm)
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>' + FRAG_EMIS);
}

// ------------------------------------------------------------------------------------------------ the module
export async function create(G) {
  const renderer = G.renderer, params = G.params || {};
  const baseTex = (G.quality && G.quality.tex) || 1024;
  const maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
  const uniforms = { wet: { value: params.wet !== undefined ? +params.wet : 1 }, glow: { value: 1 } };
  const st = { sets: 0, textureMB: 0, genMs: 0, materials: 0, programs: 0, per: {} };

  const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(tri, null); quad.frustumCulled = false;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const copyMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: COPY_FS, depthTest: false, depthWrite: false,
    uniforms: { tA: { value: null }, uMode: { value: 0 }, uTexel: { value: new THREE.Vector2() }, uK: { value: new THREE.Vector2() } } });
  const genMats = new Map(), scratch = new Map(), sets = new Map();
  let scratchIdle = 0;

  function generate(key) {
    const S = SETS[key], t0 = performance.now();
    const size = Math.max(64, Math.round((S.aniso === 16 ? baseTex : Math.min(baseTex, 1024))*S.size));      // only the four floors grow past 1024 at q=ultra
    let sc = scratch.get(size);
    if (!sc) { sc = new THREE.WebGLRenderTarget(size, size, { count: 3, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false, generateMipmaps: false }); scratch.set(size, sc); }
    let gm = genMats.get(S.fn);
    if (!gm) {
      gm = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: PRELUDE + FN[S.fn] + '\nvoid main(){ surf(vUv); }', depthTest: false, depthWrite: false,
        uniforms: { uP: { value: new THREE.Vector4() }, uSeed: { value: 0 }, uTexel: { value: new THREE.Vector2() }, uC: { value: [0, 1, 2, 3, 4].map(() => new THREE.Vector3(1, 1, 1)) } } });
      gm.name = 'ql-gen-' + S.fn; genMats.set(S.fn, gm); st.programs++;
    }
    const p = S.p || []; gm.uniforms.uP.value.set(p[0] || 0, p[1] || 0, p[2] || 0, p[3] || 0); gm.uniforms.uSeed.value = S.seed || 0; gm.uniforms.uTexel.value.set(1/size, 1/size);
    (S.colors || []).forEach((h, i) => gm.uniforms.uC.value[i].copy(c3(h)));
    const prev = { rt: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(), ac: renderer.autoClear, xr: renderer.xr.enabled, sm: renderer.shadowMap.autoUpdate };
    renderer.autoClear = false; renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
    quad.material = gm; renderer.setRenderTarget(sc); renderer.render(quad, cam);
    const mk = (srgb, nm) => { const t = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, anisotropy: Math.min(S.aniso || 4, maxAniso), colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace }); t.texture.name = `ql_${key}_${nm}`; t.texture.repeat.set(1/S.tile, 1/S.tile); return t; };
    const A = mk(true, 'albedo'), O = mk(false, 'orm'), Nn = mk(false, 'normal'), nb = S.nb || 1;
    quad.material = copyMat; copyMat.uniforms.uTexel.value.set(1/size, 1/size);
    copyMat.uniforms.tA.value = sc.textures[0]; copyMat.uniforms.uMode.value = 0; renderer.setRenderTarget(A); renderer.render(quad, cam);
    copyMat.uniforms.tA.value = sc.textures[1]; copyMat.uniforms.uMode.value = 1; renderer.setRenderTarget(O); renderer.render(quad, cam);
    const k = S.bump*0.001*size/S.tile*nb; copyMat.uniforms.uK.value.set(k, k);
    copyMat.uniforms.tA.value = sc.textures[2]; copyMat.uniforms.uMode.value = 2; renderer.setRenderTarget(Nn); renderer.render(quad, cam);
    renderer.setRenderTarget(prev.rt, prev.face, prev.mip); renderer.autoClear = prev.ac; renderer.xr.enabled = prev.xr; renderer.shadowMap.autoUpdate = prev.sm;
    const rec = { key, albedo: A.texture, orm: O.texture, normal: Nn.texture, tile: S.tile, size, nb, targets: [A, O, Nn] };
    sets.set(key, rec); scratchIdle = 0;
    st.per[key] = +(performance.now() - t0).toFixed(1); st.sets++; st.textureMB = +(st.textureMB + size*size*4*3*1.3334/1048576).toFixed(1); st.genMs = +(st.genMs + performance.now() - t0).toFixed(1);
    return rec;
  }
  const ensure = key => sets.get(key) || generate(key);

  const cache = new Map(), warned = new Set();
  let grey = null;
  function get(name, opts) {
    const D = DEFS[name];
    if (!D) {
      if (!warned.has(name)) { warned.add(name); console.warn(`[mats] unknown material "${name}", using neutral grey`); }
      return grey || (grey = Object.assign(new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.8, metalness: 0 }), { name: 'unknown' }));
    }
    const o = opts || {};
    const key = name + '|' + (o.interior ? 1 : 0) + '|' + (o.color !== undefined ? new THREE.Color(o.color).getHexString() : '') + '|' + (o.emissive !== undefined ? o.emissive : '') + '|' + (o.side !== undefined ? o.side : '') + '|' + (o.wet !== undefined ? o.wet : '') + '|' + (o.rough !== undefined ? o.rough : '') + '|' + (o.grime !== undefined ? o.grime : '') + '|' + (o.vc ? 'vc' : '');
    let m = cache.get(key); if (m) return m;
    let R; try { R = ensure(D.set); } catch (e) { console.error('[mats] generating "' + D.set + '" failed: ' + (e && e.stack || e)); return get('__unknown__'); }
    const mode = D.mode || 0, fx = mode !== 2;
    m = new THREE.MeshStandardMaterial({ map: R.albedo, normalMap: R.normal, roughnessMap: R.orm, metalnessMap: R.orm, aoMap: R.orm,
      color: new THREE.Color(o.color !== undefined ? o.color : (D.color !== undefined ? D.color : 0xffffff)), roughness: o.rough !== undefined ? o.rough : 1, metalness: 1, side: o.side !== undefined ? o.side : THREE.FrontSide,
      vertexColors: !!o.vc });      // opts.vc: multiply by the geometry's vertex colours (arch and props bake their dirt there); every mesh using it needs a colour attribute
    m.normalScale.set(1/R.nb, 1/R.nb); m.name = name;
    m.defines = Object.assign({}, m.defines, { QL_MODE: mode });
    if (fx) m.defines.QL_FX = 1; else { m.defines.QL_EMIS = 1; if (D.lantern) m.defines.QL_LANTERN = 1; }
    const wet = D.wet || [0, 1, 0, 0], vary = D.vary || [0, 0, 0], em = D.emis || [0, 1];
    const U = { uQlWet: uniforms.wet, uQlGlow: uniforms.glow,
      uQlX: { value: new THREE.Vector4((o.interior ? 0.12 : 1)*(o.wet !== undefined ? o.wet : 1), 0, 0, 0) },
      uQlWp: { value: new THREE.Vector4(wet[0], wet[1], wet[2], wet[3]) },
      uQlV: { value: new THREE.Vector4(vary[0], vary[1]*(o.grime !== undefined ? o.grime : 1), vary[2], 0) },
      uQlE: { value: new THREE.Vector2(em[0]*(o.emissive !== undefined ? o.emissive : 1), em[1]) } };
    const patch = shader => applyPatch(shader, U);
    m.onBeforeCompile = patch; m.customProgramCacheKey = () => 'ql3';
    m.userData = { mats: name, tile: R.tile, set: D.set, uniforms: U, patch };
    cache.set(key, m); st.materials++;
    return m;
  }

  const emCache = new Map();
  const api = {
    names: Object.keys(DEFS), uniforms, get,
    emissive(color = 0xffffff, intensity = 3) {
      const c = new THREE.Color(color), key = c.getHexString() + '|' + intensity; let m = emCache.get(key);
      if (!m) { m = new THREE.MeshBasicMaterial({ color: c.multiplyScalar(intensity) }); m.name = 'emissive'; emCache.set(key, m); }
      return m;
    },
    tileOf: name => (DEFS[name] ? SETS[DEFS[name].set].tile : 1),
    textures(name) { const D = DEFS[name]; if (!D) return null; const R = ensure(D.set); return { map: R.albedo, orm: R.orm, normal: R.normal, tile: R.tile, size: R.size, normalScale: 1/R.nb }; },
    prewarm(list) { for (const n of list || Object.keys(DEFS)) get(n); },
    stats: () => ({ sets: st.sets, textureMB: st.textureMB, genMs: st.genMs, materials: st.materials, programs: st.programs, perSetMs: st.per }),
    update(dt) { if (scratch.size && (scratchIdle += dt) > 3) { for (const t of scratch.values()) t.dispose(); scratch.clear(); } },
  };
  return api;
}

// ------------------------------------------------------------------------------------------------ showcase (?show=mats)
// every material on a sphere and an upright panel with its name under it, and a 6 x 3 m patch of each floor lying flat.
// ?only=a,b,c picks materials; ?wet=0..1 sets the rain; ?interior=1 shows the under-the-arcade versions; ?mats_maps=1 shows raw maps
const FLOORS = ['granite_slab', 'tile_flower_a', 'tile_flower_b', 'tile_check'];
function metreUV(geo, su, sv) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i)*su, uv.getY(i)*sv); return geo; }
export function showcaseEnv(G) {      // a little night-street environment so glossy things have something to mirror (only when the scene has none)
  if (G.scene.environment) return;
  const s = new THREE.Scene(); s.background = new THREE.Color(0x0e1a2a);
  const add = (col, k, x, y, z, w, h, d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k) })); m.position.set(x, y, z); s.add(m); };
  add(0x24405c, 1, 0, 30, 0, 80, 1, 80);
  add(0xffb86b, 7, -9, 3.2, -8, 5, 1.6, 0.3); add(0xff4d6d, 9, 6, 4.5, -8, 3, 0.9, 0.3); add(0x3ddc97, 8, 12, 2.6, -6, 0.6, 3, 0.3); add(0x48d1ff, 8, -14, 5, 2, 0.3, 1.2, 4);
  add(0xffc24a, 8, 14, 3.5, 6, 0.3, 1, 3); add(0xffb86b, 6, 0, 3, 12, 8, 1.2, 0.3); add(0xff4d6d, 7, -6, 6, 10, 1, 2.4, 0.3); add(0xffe2b8, 5, 3, 9, 3, 1.5, 0.2, 1.5);
  const pm = new THREE.PMREMGenerator(G.renderer); G.scene.environment = pm.fromScene(s, 0.03).texture; pm.dispose();
}
export async function showcase(G) {
  const mats = G.mats, P = G.params || {}, root = new THREE.Group(); root.name = 'mats-showcase'; G.scene.add(root);
  const tf = G.scene.getObjectByName('test-floor'); if (tf && !tf.userData.metreUV) { metreUV(tf.geometry, 80, 80); tf.userData.metreUV = true; }
  showcaseEnv(G);
  const interior = !!+(P.interior || 0);
  let names = mats.names.slice(); if (P.only) { const w = P.only.split(','); names = names.filter(n => w.includes(n)); }
  const perRow = P.only ? Math.max(1, names.length) : 11, dx = 1.62, dz = 2.3;
  const sph = metreUV(new THREE.SphereGeometry(0.33, 48, 32), 2*Math.PI*0.33, Math.PI*0.33), pan = metreUV(new THREE.PlaneGeometry(0.9, 0.9), 0.9, 0.9);
  // labels: one canvas, one mesh
  const lc = document.createElement('canvas'); lc.width = 2048; lc.height = 1024; const lx = lc.getContext('2d'); lx.fillStyle = 'rgba(8,12,18,0.82)';
  const LP = [], LU = [], cw = 256, ch = 40, cols = 8;
  names.forEach((n, i) => {
    const row = Math.floor(i/perRow), col = i%perRow, x = (col - (Math.min(perRow, names.length) - 1)/2)*dx, z = -row*dz;
    const opt = { interior, side: /glass|lantern|awning|cloth|leaf/.test(n) ? THREE.DoubleSide : undefined };
    const m = mats.get(n, opt);
    const a = new THREE.Mesh(sph, m); a.position.set(x - 0.42, 0.36, z + 0.25); root.add(a);
    const b = new THREE.Mesh(pan, m); b.position.set(x + 0.3, 0.5, z - 0.1); root.add(b);
    if (P.mats_maps) { const t = mats.textures(n); [t.map, t.orm, t.normal].forEach((tx, j) => { const q = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44), new THREE.MeshBasicMaterial({ map: tx })); metreUV(q.geometry, t.tile, t.tile); q.position.set(x - 0.46 + j*0.46, 1.25, z - 0.1); root.add(q); }); }
    const cxp = (i%cols)*cw, cyp = Math.floor(i/cols)*ch; lx.fillStyle = 'rgba(8,12,18,0.85)'; lx.fillRect(cxp + 1, cyp + 1, cw - 2, ch - 2);
    lx.fillStyle = '#f3e9d6'; lx.font = '600 22px Menlo, Consolas, monospace'; lx.textAlign = 'center'; lx.textBaseline = 'middle'; lx.fillText(n, cxp + cw/2, cyp + ch/2 + 1, cw - 10);
    const w = 1.3, h = w*ch/cw, y0 = 0.02, zf = z + 0.72, u0 = cxp/2048, u1 = (cxp + cw)/2048, v1 = 1 - cyp/1024, v0 = 1 - (cyp + ch)/1024, ty = h*0.8, tz = -h*0.6;
    LP.push(x - w/2, y0, zf, x + w/2, y0, zf, x + w/2, y0 + ty, zf + tz, x - w/2, y0, zf, x + w/2, y0 + ty, zf + tz, x - w/2, y0 + ty, zf + tz);
    LU.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  });
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(LP, 3)); lg.setAttribute('uv', new THREE.Float32BufferAttribute(LU, 2));
  const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace; lt.anisotropy = 8;
  root.add(new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ map: lt, transparent: true, side: THREE.DoubleSide })));
  // floor patches, 6 x 3 m, two by two in front (toward +z): centres x = -3.15 / 3.15, z = 3.7 / 7.0; each has a lamp at its +x end
  const fl = P.only ? FLOORS.filter(n => names.includes(n)) : FLOORS, LAMP = [0xffb86b, 0xff4d6d, 0x48d1ff, 0xffc24a];
  fl.forEach((n, i) => {
    const g = metreUV(new THREE.PlaneGeometry(6, 3), 6, 3).rotateX(-Math.PI/2), px = fl.length > 1 ? (i%2 ? 3.15 : -3.15) : 0, pz = 3.7 + Math.floor(i/2)*3.3;
    const m = new THREE.Mesh(g, mats.get(n, { interior })); m.position.set(px, 0.02, pz); root.add(m);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), mats.emissive(LAMP[i%4], 6)); bulb.position.set(px + 2.6, 0.75, pz + 0.3); root.add(bulb);
    const l = G.render && G.render.lightPool && G.render.lightPool.acquire && G.render.lightPool.acquire();
    if (l) { l.color.set(LAMP[i%4]); l.intensity = +(P.mats_lamp || 14); l.distance = 9; l.position.copy(bulb.position); }
  });
  console.log('[mats] ' + JSON.stringify(mats.stats()));
  const rows = Math.ceil(names.length/perRow);
  if (!P.only && !P.cam && !P.fov) { G.camera.fov = 40; G.camera.updateProjectionMatrix(); }
  return P.only ? { cam: [0, 1.5, 2.4 + names.length*0.5], target: [0, 0.4, 0] } : { cam: [0, 9.6, 19.8], target: [0, 0, 0.9 - rows*0.12], update() {} };
}
