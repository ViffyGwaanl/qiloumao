// fx.js — weather and small effects (CORE). Everything is a fixed pool drawn with instancing: six draw calls in all.
//   rain streaks   one instanced quad per drop, moved entirely on the GPU, wrapped into a box that follows the camera
//   splash crowns  hashed positions round the camera, re-rolled every third of a second, plus a small pool for splash()
//   roof drips     free-falling drops along every roof and awning edge, found from the collision boxes
//   soft sprites   steam, mist and puffs: simulated on the CPU, lit by the pooled lights so they pick up the warm glow
//   sparks         short bright streaks with gravity
// Where rain may fall comes from G.physics: a top-down "roof map" is rasterised from the collision boxes (the top of the
// highest box over every 25 cm cell, which is exactly where physics.shelterAt starts to say "roof overhead"). Streaks
// vanish below it, splashes land on it (street, awning tops, crate tops), drips start at its edges.
import * as THREE from 'three';
import { makeRng, clamp, lerp } from './util.js';

const RX0 = -40, RZ0 = -14, RW = 320, RH = 112, RCELL = 0.25;   // roof map: 80 m x 28 m
const N_RAIN = 7000, N_SPLASH = 1100, N_DRIP = 560, DRIP_RESERVE = 200, N_SOFT = 360, N_SPARK = 128, N_MANUAL = 48;

const LIGHT_PARS = /* glsl */`
uniform vec3 uLPos[8]; uniform vec3 uLCol[8]; uniform float uLCut[8]; uniform vec3 uAmb;
vec3 fxLight(vec3 p) {
  vec3 s = vec3(0.0);
  for (int i = 0; i < 8; i++) { vec3 d = uLPos[i] - p; float d2 = dot(d, d), k = clamp(1.0 - d2 * d2 / (uLCut[i] * uLCut[i] * uLCut[i] * uLCut[i]), 0.0, 1.0); s += uLCol[i] * (k * k / max(d2, 0.08)); }
  return s;
}`;
const ROOF_PARS = /* glsl */`
uniform sampler2D tRoof; uniform vec4 uRoofOrg;
float roofAt(vec2 xz) { return texture2D(tRoof, (xz - uRoofOrg.xy) * uRoofOrg.zw).r; }`;
const FOG_PARS = /* glsl */`uniform float uFogD; float fxFog(float d) { return exp(-uFogD * uFogD * d * d); }`;

const RAIN_VERT = /* glsl */`
attribute vec4 aSeed;
uniform vec3 uCam, uBox, uVel; uniform float uTime, uRain, uPix;
${LIGHT_PARS}${ROOF_PARS}${FOG_PARS}
varying vec3 vCol; varying float vA; varying vec2 vQ;
void main() {
  vec3 vel = uVel * (0.8 + 0.4 * fract(aSeed.w * 7.31));
  vec3 ctr = uCam + vec3(0.0, uBox.y * 0.28, 0.0);
  vec3 p = mod(aSeed.xyz * uBox + vel * uTime - ctr + uBox * 0.5, uBox) - uBox * 0.5 + ctr;   // endless fall inside a box round the eye
  float gone = step(p.y, roofAt(p.xz) + 0.02) + step(uRain, aSeed.w);
  vec3 dir = normalize(vel); float len = 0.030 * length(vel);
  vec3 toCam = uCam - p; float dist = length(toCam);
  vec3 side = normalize(cross(dir, toCam));
  float w0 = mix(0.0035, 0.0075, fract(aSeed.w * 3.7)), w = max(w0, dist * uPix * 0.85);   // never thinner than a pixel; dimmer instead
  vec3 c = p + dir * (position.y - 0.5) * len + side * position.x * w;
  vA = (w0 / w) * smoothstep(0.25, 1.3, dist) * fxFog(dist);
  vCol = uAmb + fxLight(p) * 0.085;
  vQ = position.xy;
  gl_Position = gone > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(c, 1.0);
}`;
const RAIN_FRAG = /* glsl */`
varying vec3 vCol; varying float vA; varying vec2 vQ;
void main() { float a = (1.0 - abs(vQ.x) * 2.0) * smoothstep(0.0, 0.25, vQ.y) * smoothstep(1.0, 0.55, vQ.y); gl_FragColor = vec4(vCol * vA * a, 1.0); }`;

// splash: a tiny crown that opens outward, with a few thrown droplets; MANUAL = the pool behind fx.splash()
const SPLASH_VERT = /* glsl */`
attribute vec4 aSeed;
#ifdef MANUAL
attribute float aScale;
#endif
uniform vec3 uCam; uniform float uTime, uRain;
${LIGHT_PARS}${ROOF_PARS}${FOG_PARS}
varying vec3 vCol; varying vec2 vQ; varying float vLife, vSeed;
void main() {
#ifdef MANUAL
  float life = (uTime - aSeed.w) / 0.42, scale = aScale, rnd = fract(aSeed.w * 3.71);
  vec3 g = aSeed.xyz;
  float gone = step(1.0, life) + step(life, 0.0);
#else
  float T = 0.26 + 0.14 * aSeed.z, tt = uTime / T + aSeed.w * 17.0, cyc = floor(tt), life = fract(tt), scale = 1.0, rnd = fract(aSeed.x * 5.3 + aSeed.y);
  vec2 h = fract(sin(vec2(cyc * 12.9898 + aSeed.x * 78.233, cyc * 39.346 + aSeed.y * 11.135)) * 43758.5453);
  vec2 rr = h * 2.0 - 1.0; rr *= 0.3 + 0.7 * abs(rr);                       // denser near the player
  vec2 xz = floor(uCam.xz / 2.0) * 2.0 + rr * 12.0;                         // snapped, so splashes do not slide with the eye
  float y = roofAt(xz);                                                     // lands on whatever is highest here
  vec3 g = vec3(xz.x, y, xz.y);
  float gone = step(uRain, aSeed.z * 0.999) + step(uCam.y + 7.0, y);
#endif
  life = clamp(life, 0.0, 1.0);
  float sizeW = mix(0.030, 0.070, rnd) * scale * (0.35 + 0.65 * sqrt(life));
  vec3 toCam = uCam - g; float dist = length(toCam);
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
  vec3 c = g + right * position.x * sizeW * 1.3 + vec3(0.0, position.y * sizeW * 0.85 * (0.35 + 0.65 * sin(life * 3.14159)) + 0.004, 0.0);
  vCol = (uAmb * 1.6 + fxLight(g + vec3(0.0, 0.05, 0.0)) * 0.11) * fxFog(dist) * smoothstep(0.15, 0.6, dist);
  vQ = position.xy; vLife = life; vSeed = aSeed.x * 37.0 + aSeed.y * 11.0;
  gl_Position = gone > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(c, 1.0);
}`;
const SPLASH_FRAG = /* glsl */`
varying vec3 vCol; varying vec2 vQ; varying float vLife, vSeed;
void main() {
  float x = vQ.x * 2.0, y = vQ.y;                                           // x -1..1, y 0..1
  float open = 0.22 + 0.60 * vLife, hw = open * (0.35 + 0.65 * y);        // a cup that opens upward and outward
  float cup = exp(-pow(x / hw, 2.0) * 1.6) - 0.75 * exp(-pow(x / (hw * 0.55), 2.0) * 1.6);
  cup = max(cup, 0.0) * (1.0 - y) * (1.0 - y) * smoothstep(0.0, 0.10, y);
  float base = smoothstep(0.10, 0.0, y) * smoothstep(open * 1.15, open * 0.5, abs(x));   // the ring on the water, seen edge-on
  float dx = abs(x) - (0.25 + 0.7 * vLife), dy = y - (0.5 + 0.4 * sin(vLife * 3.14159) + 0.1 * sin(vSeed));
  float drop = smoothstep(0.010, 0.0, dx * dx + dy * dy * 0.6);             // one thrown droplet either side
  float a = (cup * 0.9 + base * 0.55 + drop * 0.8) * (1.0 - vLife) * (1.0 - vLife * 0.5);
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

// drips: every instance is one drop that leaves a roof edge, falls freely, and waits a moment before the next one
const DRIP_VERT = /* glsl */`
attribute vec4 aFrom;   // x, y0, z, phase
attribute vec4 aTo;     // y1, pause, width, on
uniform vec3 uCam; uniform float uTime, uPix, uRain;
${LIGHT_PARS}${FOG_PARS}
varying vec3 vCol; varying float vA; varying vec2 vQ;
void main() {
  float hgt = max(aFrom.y - aTo.x, 0.05), T = sqrt(hgt / 4.905), per = T + aTo.y;
  float t = fract(uTime / per + aFrom.w) * per;
  float fall = 4.905 * t * t, v = 9.81 * t + 0.4;
  vec3 p = vec3(aFrom.x, aFrom.y - fall, aFrom.z);
#ifdef CROWN
  float life = (t - T) / 0.3; p.y = aTo.x;
  float gone = step(life, 0.0) + step(1.0, life) + step(aTo.w, 0.5);
  vec3 toCam = uCam - p; float dist = length(toCam); vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
  float sz = 0.075 * (0.4 + 0.6 * sqrt(clamp(life, 0.0, 1.0)));
  vec3 c = p + right * position.x * sz + vec3(0.0, position.y * sz * 1.4 * (0.4 + 0.6 * sin(clamp(life, 0.0, 1.0) * 3.14159)) + 0.004, 0.0);
  vCol = (uAmb * 1.8 + fxLight(p + vec3(0.0, 0.05, 0.0)) * 0.12) * fxFog(dist); vA = life; vQ = position.xy;
#else
  float gone = step(T, t) + step(aTo.w, 0.5);
  vec3 toCam = uCam - p; float dist = length(toCam); vec3 side = normalize(cross(vec3(0.0, -1.0, 0.0), toCam));
  float len = clamp(v * 0.022, 0.015, 0.30), w0 = aTo.z, w = max(w0, dist * uPix * 0.9);
  vec3 c = p + vec3(0.0, (position.y - 0.5) * len, 0.0) + side * position.x * w;
  vCol = (uAmb * 1.5 + fxLight(p) * 0.12) * fxFog(dist); vA = (w0 / w) * smoothstep(0.15, 0.7, dist); vQ = position.xy;
#endif
  gl_Position = gone > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(c, 1.0);
}`;
const DRIP_FRAG = /* glsl */`
varying vec3 vCol; varying float vA; varying vec2 vQ;
void main() {
#ifdef CROWN
  float x = vQ.x * 2.0, y = vQ.y, open = 0.30 + 0.62 * vA, lip = open * (0.45 + 0.55 * y);
  float a = (smoothstep(0.20, 0.0, abs(abs(x) - lip)) * (1.0 - y) * smoothstep(0.0, 0.08, y) * 0.8 + smoothstep(0.07, 0.0, y) * step(abs(x), open) * 0.6) * (1.0 - vA);
  gl_FragColor = vec4(vCol * a, 1.0);
#else
  float a = (1.0 - abs(vQ.x) * 2.0) * smoothstep(0.0, 0.5, vQ.y) * smoothstep(1.0, 0.8, vQ.y);   // fat head, thin tail
  gl_FragColor = vec4(vCol * vA * a, 1.0);
#endif
}`;

const SOFT_VERT = /* glsl */`
attribute vec4 aPos;    // xyz, size
attribute vec4 aCol;    // rgb tint, alpha
attribute float aRot;
uniform vec3 uCam;
${LIGHT_PARS}${FOG_PARS}
varying vec4 vCol; varying vec2 vQ; varying float vR;
void main() {
  vec3 p = aPos.xyz; vec3 toCam = uCam - p; float dist = length(toCam);
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x)), up = normalize(cross(toCam, right));
  float cs = cos(aRot), sn = sin(aRot); vec2 q = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs);
  vec3 c = p + (right * q.x + up * q.y) * aPos.w;
  vec3 lit = uAmb * 5.0 + fxLight(p) * 0.20;
  float f = fxFog(dist);
  vCol = vec4(mix(uAmb * 3.5, aCol.rgb * lit, f), aCol.a * smoothstep(0.12, 0.6 + aPos.w * 0.5, dist));   // fades as the eye walks into it
  vQ = position.xy * 2.0; vR = aRot;
  gl_Position = aCol.a <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(c, 1.0);
}`;
const SOFT_FRAG = /* glsl */`
uniform sampler2D tNoise; uniform float uTime;
varying vec4 vCol; varying vec2 vQ; varying float vR;
void main() {
  float r = length(vQ); if (r > 1.0) discard;
  float n = texture2D(tNoise, vQ * 0.011 + vR * 0.37 + uTime * 0.0015).r * 0.65 + texture2D(tNoise, vQ * 0.027 - vR * 0.11).g * 0.35;
  float a = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.55) * vCol.a;
  gl_FragColor = vec4(vCol.rgb, a);
}`;
const SPARK_VERT = /* glsl */`
attribute vec4 aPos;    // xyz, life left 0..1
attribute vec4 aVel;    // xyz, size
uniform vec3 uCam;
varying float vL; varying vec2 vQ;
void main() {
  vec3 p = aPos.xyz, toCam = uCam - p; vec3 dir = normalize(aVel.xyz + vec3(0.0, 1e-4, 0.0)); vec3 side = normalize(cross(dir, toCam));
  float len = clamp(length(aVel.xyz) * 0.035, 0.012, 0.22), w = max(aVel.w, length(toCam) * 0.0011);
  vec3 c = p + dir * (position.y - 0.5) * len + side * position.x * w;
  vL = aPos.w; vQ = position.xy;
  gl_Position = aPos.w <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(c, 1.0);
}`;
const SPARK_FRAG = /* glsl */`
varying float vL; varying vec2 vQ;
void main() { float a = (1.0 - abs(vQ.x) * 2.0) * smoothstep(0.0, 0.6, vQ.y); vec3 c = mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.82, 0.45), vL) * (2.0 + 9.0 * vL * vL); gl_FragColor = vec4(c * a, 1.0); }`;

export async function create(G) {
  const root = new THREE.Group(); root.name = 'fx'; G.scene.add(root);
  const rng = makeRng(0xf00d5), Q = G.quality;
  let time = 0, rain = 0.75, rainTarget = 0.75, softAlive = 0, sparkWas = false;
  const thunderRng = makeRng(0x7b0d), thunderOn = G.params.thunder !== '0' && (!G.showcase || G.showcase === 'fx'), dripSlots = new Set();
  let thunderT = 28 + thunderRng() * 20;
  const quad = () => { const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]); return g; };
  const quadC = () => { const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]); return g; };
  const inst = (g, name, arr, n) => { const a = new THREE.InstancedBufferAttribute(arr, n); g.setAttribute(name, a); return a; };

  // ---- shared uniforms
  const roofData = new Float32Array(RW * RH), roofTex = new THREE.DataTexture(roofData, RW, RH, THREE.RedFormat, THREE.FloatType);
  roofTex.minFilter = roofTex.magFilter = THREE.NearestFilter; roofTex.wrapS = roofTex.wrapT = THREE.ClampToEdgeWrapping; roofTex.needsUpdate = true; roofTex.name = 'fx-roof-map';
  const SH = {
    uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uRain: { value: 0.75 }, uPix: { value: 0.001 }, uFogD: { value: 0.0125 },
    uAmb: { value: new THREE.Vector3(0.05, 0.07, 0.1) }, uLPos: { value: Array.from({ length: 8 }, () => new THREE.Vector3(0, -99, 0)) }, uLCol: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) }, uLCut: { value: new Float32Array(8).fill(9) },
    tRoof: { value: roofTex }, uRoofOrg: { value: new THREE.Vector4(RX0, RZ0, 1 / (RW * RCELL), 1 / (RH * RCELL)) },
  };
  const mk = (vs, fs, extra = {}, o = {}) => { const m = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: { ...SH, ...extra }, transparent: true, depthWrite: false, depthTest: true, blending: o.blending ?? THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false, defines: o.defines || {} }); return m; };
  const mesh = (g, m, name, order) => { const x = new THREE.Mesh(g, m); x.name = name; x.frustumCulled = false; x.renderOrder = order; root.add(x); return x; };

  // ---- rain streaks
  const nRain = Math.max(200, Math.round(N_RAIN * (Q.rain ?? 1)));
  const gRain = quad(); { const a = new Float32Array(nRain * 4); for (let i = 0; i < a.length; i++) a[i] = rng(); inst(gRain, 'aSeed', a, 4); gRain.instanceCount = nRain; }
  const mRain = mk(RAIN_VERT, RAIN_FRAG, { uBox: { value: new THREE.Vector3(20, 13, 20) }, uVel: { value: new THREE.Vector3(-1.5, -9.2, 0.7) } });
  mesh(gRain, mRain, 'rain', 30);

  // ---- splash crowns: the ambient field, and a small pool for splash()
  const nSplash = Math.max(100, Math.round(N_SPLASH * (Q.rain ?? 1)));
  const gSplash = quad(); { const a = new Float32Array(nSplash * 4); for (let i = 0; i < a.length; i++) a[i] = rng(); inst(gSplash, 'aSeed', a, 4); gSplash.instanceCount = nSplash; }
  mesh(gSplash, mk(SPLASH_VERT, SPLASH_FRAG), 'splashes', 31);
  // the pool behind splash(): aSeed = x, y, z, start time; aScale = size
  const gMan = quad(), manArr = new Float32Array(N_MANUAL * 4).fill(-1e6), manAttr = inst(gMan, 'aSeed', manArr, 4); manAttr.setUsage(THREE.DynamicDrawUsage); gMan.instanceCount = N_MANUAL;
  const manScale = new Float32Array(N_MANUAL).fill(1), manScaleAttr = inst(gMan, 'aScale', manScale, 1); manScaleAttr.setUsage(THREE.DynamicDrawUsage);
  const manMesh = mesh(gMan, mk(SPLASH_VERT, SPLASH_FRAG, {}, { defines: { MANUAL: 1 } }), 'splash-pool', 31); manMesh.visible = false;
  let manNext = 0, manLast = -9;

  // ---- drips
  const gDrip = quad(), dripFrom = new Float32Array(N_DRIP * 4), dripTo = new Float32Array(N_DRIP * 4);
  const aFrom = inst(gDrip, 'aFrom', dripFrom, 4), aTo = inst(gDrip, 'aTo', dripTo, 4); gDrip.instanceCount = N_DRIP;
  mesh(gDrip, mk(DRIP_VERT, DRIP_FRAG), 'drips', 32);
  const gDripC = quad(); gDripC.setAttribute('aFrom', aFrom); gDripC.setAttribute('aTo', aTo); gDripC.instanceCount = N_DRIP;
  mesh(gDripC, mk(DRIP_VERT, DRIP_FRAG, {}, { defines: { CROWN: 1 } }), 'drip-crowns', 32);
  let dripAuto = 0;               // slots [0, dripAuto) come from the roof map, the rest belong to emitters
  const dripFree = [];

  // ---- soft sprites
  const gSoft = quadC(), softPos = new Float32Array(N_SOFT * 4), softCol = new Float32Array(N_SOFT * 4), softRot = new Float32Array(N_SOFT);
  const aSP = inst(gSoft, 'aPos', softPos, 4), aSC = inst(gSoft, 'aCol', softCol, 4), aSR = inst(gSoft, 'aRot', softRot, 1); for (const a of [aSP, aSC, aSR]) a.setUsage(THREE.DynamicDrawUsage);
  gSoft.instanceCount = N_SOFT;
  const noiseTex = G.render.noiseTex || roofTex;
  mesh(gSoft, mk(SOFT_VERT, SOFT_FRAG, { tNoise: { value: noiseTex } }, { blending: THREE.NormalBlending }), 'soft-sprites', 28);
  const soft = Array.from({ length: N_SOFT }, () => ({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, s0: 0.1, s1: 0.5, a: 0.2, r: 1, g: 1, b: 1, rot: 0, spin: 0, drag: 0.3 }));
  let softNext = 0;
  const spawnSoft = o => { for (let k = 0; k < N_SOFT; k++) { const p = soft[softNext]; softNext = (softNext + 1) % N_SOFT; if (!p.on) { Object.assign(p, o); p.on = true; p.age = 0; return p; } } return null; };

  // ---- sparks
  const gSpark = quad(), spPos = new Float32Array(N_SPARK * 4), spVel = new Float32Array(N_SPARK * 4);
  const aKP = inst(gSpark, 'aPos', spPos, 4), aKV = inst(gSpark, 'aVel', spVel, 4); aKP.setUsage(THREE.DynamicDrawUsage); aKV.setUsage(THREE.DynamicDrawUsage); gSpark.instanceCount = N_SPARK;
  const sparkMesh = mesh(gSpark, mk(SPARK_VERT, SPARK_FRAG), 'sparks', 33); sparkMesh.visible = false;
  const sparks = Array.from({ length: N_SPARK }, () => ({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 0.004 }));
  let sparkNext = 0, sparkAlive = 0;
  const spawnSpark = (pos, speed = 2.2) => { const p = sparks[sparkNext]; sparkNext = (sparkNext + 1) % N_SPARK; const th = rng() * 6.283, up = 0.3 + rng() * 0.9, s = speed * (0.4 + rng() * 0.9); p.on = true; p.x = pos.x; p.y = pos.y; p.z = pos.z; p.vx = Math.cos(th) * s * 0.6; p.vz = Math.sin(th) * s * 0.6; p.vy = up * s; p.age = 0; p.life = 0.35 + rng() * 0.6; p.size = 0.003 + rng() * 0.004; };

  // ---- the roof map and the drip edges, from the collision boxes
  let roofBoxes = -1, roofCheck = 0;
  const cellH = (i, j) => (i < 0 || j < 0 || i >= RW || j >= RH ? 0 : roofData[j * RW + i]);
  const buildRoof = () => {
    const boxes = (G.physics && G.physics.boxes) || []; roofBoxes = boxes.length; roofData.fill(0);
    for (const b of boxes) {
      const top = b.max.y; if (!(top > 0)) continue;
      // a cell is covered when its centre is inside the footprint (the same test physics.shelterAt makes)
      const i0 = Math.max(0, Math.ceil((b.min.x - RX0) / RCELL - 0.5)), i1 = Math.min(RW - 1, Math.floor((b.max.x - RX0) / RCELL - 0.5));
      const j0 = Math.max(0, Math.ceil((b.min.z - RZ0) / RCELL - 0.5)), j1 = Math.min(RH - 1, Math.floor((b.max.z - RZ0) / RCELL - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * RW + i; if (top > roofData[k]) roofData[k] = top; }
    }
    roofTex.needsUpdate = true;
    // edges: a covered cell at least 1.8 m above an open neighbour. Lower edges (awnings, balconies) are picked first.
    const edges = [], r = makeRng(0xd41b);
    for (let j = 1; j < RH - 1; j++) for (let i = 1; i < RW - 1; i++) {
      const h = roofData[j * RW + i]; if (h < 1.8) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = cellH(i + di, j + dj); if (h - n > 1.8) { const x = RX0 + (i + 0.5 + di * 0.56) * RCELL, z = RZ0 + (j + 0.5 + dj * 0.56) * RCELL; if (Math.abs(z) < 7 && Math.abs(x) < 36) edges.push({ x, z, h, n, key: h + r() * 9 }); break; } }
    }
    edges.sort((a, b) => a.key - b.key);
    dripAuto = Math.min(edges.length, N_DRIP - DRIP_RESERVE);
    for (let i = 0; i < N_DRIP; i++) {
      if (i < dripAuto && !dripSlots.has(i)) { const e = edges[i]; dripFrom.set([e.x + (r() - 0.5) * 0.2, e.h - 0.02, e.z + (r() - 0.5) * 0.04, r()], i * 4); dripTo.set([e.n, 0.25 + r() * 1.6, 0.005 + r() * 0.004, 1], i * 4); }
      else if (!dripSlots.has(i)) { dripTo[i * 4 + 3] = 0; }
    }
    dripFree.length = 0; for (let i = dripAuto; i < N_DRIP; i++) if (!dripSlots.has(i)) dripFree.push(i);   // pop() hands out the highest slot first
    aFrom.needsUpdate = true; aTo.needsUpdate = true;
  };
  const roofHeight = (x, z) => cellH(Math.floor((x - RX0) / RCELL), Math.floor((z - RZ0) / RCELL));

  // ---- emitters
  const emitters = new Set(), v3 = (p, d = new THREE.Vector3()) => (p && p.isVector3 ? d.copy(p) : Array.isArray(p) ? d.fromArray(p) : d.set((p && p.x) || 0, (p && p.y) || 0, (p && p.z) || 0));
  const setDrips = em => {
    for (let k = 0; k < em.slots.length; k++) {
      const i = em.slots[k], o = em.offs[k], x = em.pos.x + o[0], z = em.pos.z + o[1];
      const y1 = em.opts.ground !== undefined ? em.opts.ground : (G.physics && G.physics.groundHeight ? G.physics.groundHeight(x, z, em.pos.y - 0.05) : 0);
      dripFrom.set([x, em.pos.y, z, o[2]], i * 4); dripTo.set([y1, em.opts.pour ? 0.02 + o[3] * 0.08 : (em.opts.pause ?? 0.3) + o[3] * 1.2, em.opts.pour ? 0.008 : 0.006, 1], i * 4);
    }
    aFrom.needsUpdate = true; aTo.needsUpdate = true;
  };
  const api = {
    root,
    // kinds: 'steam' (rises from a pot or an urn), 'mist' (slow ground haze), 'sparks', 'drip' (a dripping point or line;
    // opts.count drops spread over opts.spread metres along x, opts.pour = true for a downpipe pouring water)
    emitter(kind, pos, opts = {}) {
      const em = { kind, pos: v3(pos), opts, acc: rng(), slots: [], offs: [], on: true };
      if (kind === 'drip') {
        if (roofBoxes < 0) buildRoof();
        // an outlet close above the ground is a downpipe: it pours
        if (opts.pour === undefined && G.physics && G.physics.groundHeight && em.pos.y - G.physics.groundHeight(em.pos.x, em.pos.z, em.pos.y) < 0.8) em.opts = opts = { ...opts, pour: true };
        const n = clamp(opts.count ?? (opts.pour ? 10 : 3), 1, 24), sp = opts.spread ?? (opts.pour ? 0.05 : 0.3);
        for (let k = 0; k < n && dripFree.length; k++) { const i = dripFree.pop(); dripSlots.add(i); em.slots.push(i); em.offs.push([(rng() - 0.5) * sp, (rng() - 0.5) * (opts.pour ? sp : 0.03), rng(), rng()]); }
        setDrips(em);
      }
      emitters.add(em);
      return {
        stop() { em.on = false; emitters.delete(em); for (const i of em.slots) { dripTo[i * 4 + 3] = 0; dripSlots.delete(i); dripFree.push(i); } if (em.slots.length) aTo.needsUpdate = true; em.slots = []; },
        setPos(v) { v3(v, em.pos); if (em.slots.length) setDrips(em); },
      };
    },
    // one splash crown, e.g. under a paw landing in a puddle; size 1 = a raindrop's, 3 = a jump into water
    splash(pos, size = 1) { const p = v3(pos), i = manNext; manNext = (manNext + 1) % N_MANUAL; manArr.set([p.x, p.y, p.z, SH.uTime.value], i * 4); manScale[i] = clamp(size, 0.2, 8) * 1.6; manAttr.needsUpdate = true; manScaleAttr.needsUpdate = true; manLast = SH.uTime.value; manMesh.visible = true; },
    // a small burst of mist (a shake, a landing, a lid lifted)
    puff(pos, opts = {}) { const p = v3(pos), n = opts.count ?? 7, c = opts.color || [1, 1, 1]; for (let k = 0; k < n; k++) spawnSoft({ x: p.x + (rng() - 0.5) * 0.12, y: p.y + rng() * 0.08, z: p.z + (rng() - 0.5) * 0.12, vx: (rng() - 0.5) * 0.9, vy: 0.15 + rng() * 0.5, vz: (rng() - 0.5) * 0.9, life: 0.7 + rng() * 0.7, s0: 0.06, s1: 0.32 + rng() * 0.25, a: 0.20 * (opts.alpha ?? 1), r: c[0], g: c[1], b: c[2], rot: rng() * 6.28, spin: (rng() - 0.5) * 1.5, drag: 2.2 }); },
    setRain(v) { rainTarget = clamp(+v || 0, 0, 1); },
    roofHeight,
    update(dt) {
      time += dt; rain += (rainTarget - rain) * Math.min(1, dt * 0.8);
      const cam = G.camera, R = G.render;
      SH.uCam.value.copy(cam.position); SH.uTime.value = time; SH.uRain.value = rain;
      SH.uPix.value = 2 * Math.tan((cam.fov * Math.PI) / 360) / Math.max(200, (R.size && R.size.h) || 1080);
      const fog = G.scene.fog; if (fog) { SH.uFogD.value = fog.density || 0.0125; SH.uAmb.value.set(fog.color.r, fog.color.g, fog.color.b).multiplyScalar(1.5).addScalar(0.012); }
      const lights = (R.lightPool && R.lightPool.lights) || [];
      for (let i = 0; i < 8; i++) { const l = lights[i]; if (l && l.intensity > 0 && l.visible) { SH.uLPos.value[i].copy(l.position); SH.uLCol.value[i].set(l.color.r, l.color.g, l.color.b).multiplyScalar(l.intensity); SH.uLCut.value[i] = l.distance > 0 ? l.distance : 30; } else { SH.uLCol.value[i].set(0, 0, 0); SH.uLPos.value[i].set(0, -99, 0); } }
      if ((roofCheck -= dt) <= 0) { roofCheck = 0.5; if (((G.physics && G.physics.boxes) || []).length !== roofBoxes) buildRoof(); }
      if (manMesh.visible && time - manLast > 0.6) manMesh.visible = false;
      // emitters
      for (const em of emitters) {
        if (em.kind === 'drip') continue;
        const o = em.opts, rate = (em.kind === 'steam' ? 9 : em.kind === 'mist' ? 0.8 : 26) * (o.rate ?? 1);   // opts.rate multiplies the usual rate
        em.acc += rate * dt;
        while (em.acc >= 1) {
          em.acc -= 1; const p = em.pos, c = o.color || (em.kind === 'steam' ? [1.0, 0.97, 0.93] : [0.80, 0.88, 1.0]), sc = o.size ?? 1;
          if (em.kind === 'steam') spawnSoft({ x: p.x + (rng() - 0.5) * 0.14 * sc, y: p.y, z: p.z + (rng() - 0.5) * 0.14 * sc, vx: (rng() - 0.5) * 0.10 - 0.05, vy: (0.28 + rng() * 0.30) * (o.speed ?? 1), vz: (rng() - 0.5) * 0.10 + 0.02, life: 2.2 + rng() * 1.6, s0: 0.10 * sc, s1: (0.55 + rng() * 0.35) * sc, a: 0.21 * (o.alpha ?? 1), r: c[0], g: c[1], b: c[2], rot: rng() * 6.28, spin: (rng() - 0.5) * 0.7, drag: 0.25 });
          else if (em.kind === 'mist') spawnSoft({ x: p.x + (rng() - 0.5) * 3 * sc, y: p.y + rng() * 0.25, z: p.z + (rng() - 0.5) * 1.6 * sc, vx: -0.10 - rng() * 0.12, vy: 0.012, vz: (rng() - 0.5) * 0.06, life: 9 + rng() * 5, s0: 1.1 * sc, s1: (2.0 + rng() * 1.2) * sc, a: 0.11 * (o.alpha ?? 1), r: c[0], g: c[1], b: c[2], rot: rng() * 6.28, spin: (rng() - 0.5) * 0.08, drag: 0 });
          else if (em.kind === 'sparks') spawnSpark(p, o.speed ?? 2.2);
        }
      }
      // soft sprites
      let alive = 0;
      for (let i = 0; i < N_SOFT; i++) {
        const p = soft[i], k = i * 4;
        if (!p.on) { if (softCol[k + 3] !== 0) softCol[k + 3] = 0; continue; }
        p.age += dt; const u = p.age / p.life; if (u >= 1) { p.on = false; softCol[k + 3] = 0; continue; }
        const d = Math.exp(-p.drag * dt); p.vx *= d; p.vz *= d; if (p.drag > 1) p.vy *= d;
        p.x += (p.vx + Math.sin(time * 0.7 + i) * 0.03) * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.spin * dt;
        softPos[k] = p.x; softPos[k + 1] = p.y; softPos[k + 2] = p.z; softPos[k + 3] = lerp(p.s0, p.s1, 1 - (1 - u) * (1 - u));
        softCol[k] = p.r; softCol[k + 1] = p.g; softCol[k + 2] = p.b; softCol[k + 3] = p.a * Math.min(1, u * 6) * (1 - u) * (1 - u * 0.3); softRot[i] = p.rot; alive++;
      }
      softAlive = alive; aSP.needsUpdate = true; aSC.needsUpdate = true; aSR.needsUpdate = true;
      // sparks: gravity, one bounce on whatever is below
      sparkAlive = 0;
      for (let i = 0; i < N_SPARK; i++) {
        const p = sparks[i], k = i * 4;
        if (!p.on) { spPos[k + 3] = 0; continue; }
        p.age += dt; if (p.age >= p.life) { p.on = false; spPos[k + 3] = 0; continue; }
        p.vy -= 9.81 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const gy = roofHeight(p.x, p.z); if (p.y < gy + 0.005 && p.vy < 0 && p.y > gy - 0.3) { p.y = gy + 0.005; p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; }
        spPos[k] = p.x; spPos[k + 1] = p.y; spPos[k + 2] = p.z; spPos[k + 3] = 1 - p.age / p.life; spVel[k] = p.vx; spVel[k + 1] = p.vy; spVel[k + 2] = p.vz; spVel[k + 3] = p.size; sparkAlive++;
      }
      sparkMesh.visible = sparkAlive > 0; if (sparkAlive || sparkWas) { aKP.needsUpdate = true; aKV.needsUpdate = true; } sparkWas = sparkAlive > 0;
      // distant thunder now and then (render flashes the sky, audio rolls)
      if (thunderOn && rain > 0.35 && (thunderT -= dt) <= 0) { thunderT = 50 + thunderRng() * 45; G.events.emit('thunder', { intensity: 0.3 + 0.7 * thunderRng() }); }
    },
    stats: () => ({ streaks: nRain, splashes: nSplash, drips: dripAuto + dripSlots.size, sprites: softAlive, sparks: sparkAlive, emitters: emitters.size, roofBoxes, calls: 5 + (manMesh.visible ? 1 : 0) + (sparkMesh.visible ? 1 : 0) }),
  };
  return api;
}

// ---------------------------------------------------------------- showcase: every effect on one test floor
export async function showcase(G) {
  const T = THREE, S = G.scene, root = new T.Group(), fx = G.fx; root.name = 'fx-showcase'; S.add(root);
  const box = (x0, y0, z0, x1, y1, z1, mat, solid = true) => { const m = new T.Mesh(new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); root.add(m); if (solid) G.physics.addBox({ min: new T.Vector3(x0, y0, z0), max: new T.Vector3(x1, y1, z1), surface: 'stone' }); return m; };
  const dark = new T.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.6 }), wood = new T.MeshStandardMaterial({ color: 0x5a2f22, roughness: 0.7 });
  // a roof on four posts: it must stay dry underneath, drip along its edges and take splashes on top
  box(-4.5, 2.5, -2.2, -0.5, 2.62, 1.0, dark);
  for (const [x, z] of [[-4.4, -2.1], [-0.6, -2.1], [-4.4, 0.9], [-0.6, 0.9]]) box(x - 0.06, 0, z - 0.06, x + 0.06, 2.5, z + 0.06, dark, false);
  box(-3.9, 0, -1.4, -2.9, 0.75, -0.7, wood); box(-3.65, 0.75, -1.25, -3.15, 1.0, -0.85, new T.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.9, roughness: 0.3 }));
  const lamp = (x, y, z, c, I) => { const m = new T.Mesh(new T.SphereGeometry(0.1, 16, 12), G.mats.emissive(c, 5)); m.position.set(x, y, z); root.add(m); const l = G.render.lightPool.acquire(); if (l) { l.position.set(x, y, z); l.color.set(c); l.intensity = I; l.distance = 10; } };
  lamp(-2.5, 2.3, -0.6, 0xffb86b, 16); lamp(2.2, 1.8, -1.0, 0xff4d6d, 14); lamp(4.6, 2.6, 0.6, 0x48d1ff, 12); lamp(0.6, 0.5, 1.6, 0x3ddc97, 6);
  box(1.6, 0, -1.4, 2.6, 0.5, -0.6, wood); box(3.4, 0, -2.4, 5.6, 1.6, -2.2, dark);
  fx.emitter('steam', [-3.4, 1.02, -1.05], {});
  fx.emitter('steam', [2.1, 0.52, -1.0], { size: 0.7, color: [1.0, 0.9, 0.85] });
  fx.emitter('mist', [1.5, 0.15, 1.5], {});
  fx.emitter('sparks', [4.5, 1.62, -2.3], {});
  fx.emitter('drip', [3.2, 2.2, 0.8], { count: 4, spread: 0.6 });
  fx.emitter('drip', [5.4, 2.6, 0.2], { pour: true });
  box(5.34, 2.6, 0.14, 5.46, 3.4, 0.26, dark, false);
  if (G.physics.build) G.physics.build();
  let t = 0, n = 0;
  return { cam: [0.4, 1.1, 6.2], target: [0.2, 1.0, 0], update(dt) { t += dt; if (t > 0.7) { t = 0; n++; fx.splash([0.2 + (n % 3) * 0.5, 0, 2.6], 1 + (n % 3)); if (n % 2 === 0) fx.puff([-1.2 + (n % 4) * 0.2, 0.05, 2.4]); } } };
}
