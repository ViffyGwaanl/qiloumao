// ground.js — the hero surface (CORE): the camera is 26 cm above it.
// Carriageway (x -35..35, z -3.2..3.2, y 0): granite slabs with standing water. Where the water lies comes from a data
// map computed here (noise + camber toward the gutters + hand-placed basins). Rain rings are a formula in the pixel shader
// that tilts the water normal. Reflections are a TRUE planar reflection: the world is drawn a second time from a camera
// mirrored about y = 0 into a mip-mapped HDR target; puddles read it sharp, damp stone reads it blurred and smeared
// vertically. Without it (quality.refl = 0, setReflections(false)) the floor falls back to the environment map.
// Arcade floors (top at y 0.12): patterned cement tiles with a damp sheen that reuses the same mirror picture.
// All three materials are the library's own (G.mats.get) patched with onBeforeCompile; three's lighting is untouched.
import * as THREE from 'three';
import { box3, boxUV, mergeGeos, clamp, lerp, smoothstep } from './util.js';

const X0 = -35, X1 = 35, Z0 = -3.2, Z1 = 3.2, FLOOR_Y = 0.12, KERB_W = 0.3, WALL_Z = 6.2;
const MW = 1024, MH = 96;   // puddle map: 6.8 cm per texel
// hand-placed basins: x, z, radius along x, radius along z, extra depth
const BASINS = [
  [-23.5, 1.5, 2.6, 1.3, 0.34], [-18, -1.2, 3.0, 1.2, 0.30], [-12.5, 0.9, 2.2, 1.5, 0.34], [-6.5, -2.0, 3.4, 0.9, 0.30], [-1.5, 1.8, 2.8, 1.0, 0.30],
  [3, -0.4, 2.0, 1.4, 0.34], [8, 2.2, 3.2, 0.8, 0.30], [12, -1.6, 2.4, 1.2, 0.32], [17, 0.6, 2.8, 1.5, 0.36], [22, -2.2, 3.0, 0.8, 0.30],
  [26, 1.4, 2.4, 1.2, 0.34], [-29, -1.0, 2.0, 1.4, 0.30], [30.5, -0.6, 2.2, 1.6, 0.30], [-15, 2.6, 2.0, 0.5, 0.26],
];
const hash2 = (x, y) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v); };
// water level at a point of the carriageway: above 0.5 there is standing water
function levelAt(x, z) {
  let h = 0.345 + (vnoise(x * 0.33 + 7.1, z * 0.33 + 3.3) - 0.5) * 0.30 + (vnoise(x * 0.9 + 1.7, z * 0.9 + 9.1) - 0.5) * 0.17;
  const az = Math.abs(z);
  h += smoothstep(1.9, 3.0, az) * 0.2 * (0.25 + 1.1 * vnoise(x * 0.23 + 40, z > 0 ? 1.5 : 7.5));   // camber: the gutters by the kerbs hold water, in stretches
  for (const b of BASINS) { const dx = (x - b[0]) / (b[2] * 1.25), dz = (z - b[1]) / (b[3] * 1.25), d = dx * dx + dz * dz; if (d < 1) h += b[4] * (1 - d) * (1 - d); }
  return clamp(h, 0, 1);
}

// ---------------------------------------------------------------- shader pieces
const PARS = /* glsl */`
varying vec3 vGW;
uniform sampler2D uGMask, uGNoise, tGRefl;
uniform mat4 uGReflMat;
uniform vec4 uGOrg;
uniform vec3 uGRight;
uniform float uGTime, uGRain, uGWet, uGReflOn, uGLod, uGRing, uGDistort, uGStreak, uGAspect, uGPlaneY, uGFilm, uGGain, uGF0, uGDark, uGBoost;
float gPuddle = 0.0, gSoak = 0.0, gUp = 1.0, gMirror = 0.0, gBlur = 0.3; vec2 gSlope = vec2(0.0);
float gN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return texture2D(uGNoise, (i + f + 0.5) / 256.0).r; }
// one sparse layer of rain rings: the ground is cut into cells, each cell gets a new drop (place, size, strength) every
// cycle; a thin crest runs outward, followed by a weaker second one, and both die as they widen. Returns a normal tilt.
vec2 gRing(vec2 p, float t, float cell, float seed) {
  vec2 q = p / cell, id = floor(q), f = fract(q);
  vec4 h0 = texture2D(uGNoise, (id + 0.5 + seed) / 256.0);
  float tt = t * (0.6 + 0.55 * h0.x) + h0.y * 9.0, cyc = floor(tt), life = fract(tt);
  vec4 h = texture2D(uGNoise, (id + 0.5 + seed + vec2(cyc * 7.0, cyc * 13.0)) / 256.0);
  float on = step(h.z, 0.18 + 0.62 * uGRain);
  float rmax = mix(0.17, 0.44, h.x * h.x);
  vec2 dv = (f - mix(vec2(rmax), vec2(1.0 - rmax), h.yw)) * cell; float d = length(dv);
  float r = life * rmax * cell, w = 0.005 + 0.020 * life;
  float x = (d - r) / w, x2 = (d - r * 0.58) / (w * 0.8);
  float prof = x * exp(-x * x) * 2.33 + 0.5 * x2 * exp(-x2 * x2) * 2.33 * smoothstep(0.12, 0.3, life);
  return dv / max(d, 1e-4) * prof * (1.0 - life) * (1.0 - life) * on * mix(0.45, 1.0, h.y) * smoothstep(0.0, 0.06, life);
}
`;
// before three builds its material struct: albedo, roughness and the normal are final here, whatever the library did.
// Wet stone is a rough solid under a smooth film of water: the film gives a strong mirror at a low eye (low roughness in
// three's own Fresnel maths), and its waviness, not the roughness, decides how smeared the mirror picture is (gBlur).
// G_QL = the material came from the mats module: its height channel (qlOrm.a) says where the joints and pits are, so
// water gathers there first and the high grain of a slab stands proud of it.
const SURFACE = [
/* 0: carriageway */ /* glsl */`
{
  vec2 gp = vGW.xz;
  vec4 gmk = texture2D(uGMask, (gp - uGOrg.xy) * uGOrg.zw);
  float gsn = gN(gp * 2.3) * 0.5 + gN(gp * 6.1 + 4.7) * 0.3 + gN(gp * 19.0 + 9.2) * 0.2;   // 40 / 16 / 5 cm: a ragged shoreline whatever the map resolution
  #ifdef G_QL
    float gH = qlOrm.a;
  #else
    float gH = 0.6;
  #endif
  float gDepth = gmk.r - 0.5 + (gsn - 0.5) * 0.085 + (0.6 - gH) * 0.14;
  gPuddle = smoothstep(0.0, 0.03, gDepth) * uGWet;
  float gDeep = smoothstep(0.0, 0.22, gDepth);
  gSoak = smoothstep(-0.15, -0.004, gDepth) * uGWet;                                      // soaked band round every puddle
  float gFilm = uGWet * clamp(0.30 + 0.55 * gmk.g + (0.6 - gH) * 1.1 + gSoak * 0.7, 0.0, 1.0);   // water film on stone that is merely wet
  #ifndef G_QL
    diffuseColor.rgb *= mix(1.0, 0.62, gFilm);                                            // wet stone is darker (the library does this itself)
  #endif
  diffuseColor.rgb *= mix(1.0, uGDark, gFilm) * mix(1.0, 0.82, gSoak);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * mix(0.85, 0.38, gDeep) + vec3(0.004, 0.008, 0.010) * gDeep, gPuddle);   // shallow rim shows the bed, deeper water goes murky
  float gR = mix(roughnessFactor, 0.11, gFilm * 0.85);
  gR = mix(gR, 0.07, gSoak); gR = mix(gR, 0.03, gPuddle);
  metalnessFactor *= 1.0 - gPuddle;
  gMirror = max(gFilm * uGFilm, max(gSoak, gPuddle));
  gBlur = mix(mix(0.44, 0.24, gFilm), 0.11, gSoak) * (1.0 - gPuddle);
  vec3 gNw = inverseTransformDirection(normal, viewMatrix);
  vec2 gSl = gNw.xz / max(gNw.y, 0.25) * (1.0 - gPuddle) * mix(0.55, 0.22, gSoak);         // the film fills the small relief
  float gDist = length(vGW - cameraPosition), gRf = 1.0 - smoothstep(8.0, 24.0, gDist), gWsum = gPuddle;
  if (gWsum > 0.004 && gRf > 0.0) {
    vec2 rr = gRing(gp, uGTime, 0.24, 0.0) + gRing(mat2(0.8, 0.6, -0.6, 0.8) * gp, uGTime * 0.87, 0.35, 37.0) * 0.9 + gRing(gp.yx + 3.3, uGTime * 1.13, 0.15, 91.0) * 0.6;
    gSl += rr * gRf * (0.25 + 0.75 * uGRain) * uGRing * gWsum;
  }
  gSl += (vec2(gN(gp * 3.1 + uGTime * vec2(0.21, 0.13)), gN(gp * 3.1 + 5.0 - uGTime * vec2(0.17, 0.19))) - 0.5) * 0.02 * gPuddle;   // wind shiver
  gR += (1.0 - gRf) * 0.035 * gPuddle * uGRain;                                           // far puddles: rings become a little roughness
  roughnessFactor = gR; gSlope = gSl; gUp = 1.0;
  normal = normalize((viewMatrix * vec4(normalize(vec3(gSl.x, 1.0, gSl.y)), 0.0)).xyz);
}
`,
/* 1: arcade tiles */ /* glsl */`
{
  vec2 gp = vGW.xz;
  float gsn = gN(gp * 1.3) * 0.6 + gN(gp * 4.7 + 3.0) * 0.4;
  float gIn = clamp((abs(gp.y) - ${Z1.toFixed(1)}) / ${(WALL_Z - Z1).toFixed(1)}, 0.0, 1.0);       // 0 at the kerb, 1 at the shopfront
  float gDamp = clamp(1.25 - gIn * 1.5 + (gsn - 0.5) * 1.1, 0.0, 1.0) * uGWet;            // rain blows in at the open side
  gSoak = gDamp; gPuddle = smoothstep(0.75, 1.0, gDamp) * 0.5;
  diffuseColor.rgb *= mix(1.0, 0.78, gDamp);
  float gDry = clamp(roughnessFactor * 0.45, 0.10, 0.20);                                       // cement tiles worn to a polish by a century of feet
  roughnessFactor = mix(gDry, 0.07, gDamp * 0.92);
  gMirror = mix(0.66, 1.0, gDamp);
  gBlur = mix(0.20, 0.06, gDamp);
  vec3 gNw = inverseTransformDirection(normal, viewMatrix);
  gUp = step(0.7, gNw.y);
  vec2 gSl = gNw.xz / max(gNw.y, 0.25) * mix(0.6, 0.2, gDamp);
  gSlope = gSl;
  if (gUp > 0.5) normal = normalize((viewMatrix * vec4(normalize(vec3(gSl.x, 1.0, gSl.y)), 0.0)).xyz);
}
`,
/* 2: kerb stones */ /* glsl */`
{
  vec2 gp = vGW.xz;
  float gsn = gN(gp * 2.1) * 0.6 + gN(gp * 7.3 + 3.0) * 0.4;
  float gFilm = clamp(0.7 + (gsn - 0.5) * 0.7, 0.0, 1.0) * uGWet;
  gSoak = gFilm * 0.6; gPuddle = 0.0;
  #ifndef G_QL
    diffuseColor.rgb *= mix(1.0, 0.64, gFilm);
  #endif
  roughnessFactor = mix(roughnessFactor, 0.12, gFilm * 0.8);
  vec3 gNw = inverseTransformDirection(normal, viewMatrix);
  gUp = step(0.7, gNw.y); gSlope = gNw.xz / max(gNw.y, 0.25) * 0.4 * gUp;
  gMirror = gFilm * 0.8; gBlur = 0.26;
}
`];
// after three has looked up the environment map: swap in the mirror picture where the floor is wet
const REFLECT = /* glsl */`
#ifdef RE_IndirectSpecular
if (uGReflOn > 0.5 && gUp > 0.5) {
  vec4 grc = uGReflMat * vec4(vGW.x, uGPlaneY, vGW.z, 1.0);
  if (grc.w > 0.001) {
    vec2 ruv = grc.xy / grc.w;
    vec3 gv = normalize(vGW - cameraPosition);
    // a slope along the line of sight throws the reflection up or down; a sideways slope hardly moves it at a low eye
    vec2 gt = vec2(2.0 * abs(gv.y) * dot(gSlope, uGRight.xz) / uGAspect, -2.0 * dot(gSlope, normalize(gv.xz + vec2(1e-5)))) * 0.69 * uGDistort;
    ruv += clamp(gt, -0.11, 0.11);
    // puddles: a sharp mirror. Wet stone: the same picture blurred and stretched vertically, the smear of lights on a wet road
    float lod = mix(1.0 + gBlur * 9.5, 0.35, gPuddle) + uGLod;
    vec2 st = vec2(0.0, (gBlur * 0.5 + 0.004) * (1.0 - gPuddle) * uGStreak);
    vec3 pr = textureLod(tGRefl, ruv, lod).rgb * 0.26
      + (textureLod(tGRefl, ruv + st * 0.30, lod + 0.2).rgb + textureLod(tGRefl, ruv - st * 0.30, lod + 0.2).rgb) * 0.19
      + (textureLod(tGRefl, ruv + st * 0.65, lod + 0.5).rgb + textureLod(tGRefl, ruv - st * 0.65, lod + 0.5).rgb) * 0.12
      + (textureLod(tGRefl, ruv + st * 1.05, lod + 0.8).rgb + textureLod(tGRefl, ruv - st * 1.05, lod + 0.8).rgb) * 0.06;
    pr = min(pr, vec3(40.0));
    // lamps and neon are far brighter in life than their modelled values: let the bright part of the mirror picture punch through
    pr *= uGGain * (1.0 + uGBoost * smoothstep(0.5, 2.6, dot(pr, vec3(0.2126, 0.7152, 0.0722))));
    radiance = mix(radiance, pr, clamp(gMirror, 0.0, 1.0));
  }
}
#endif
`;

export async function create(G) {
  const root = new THREE.Group(); root.name = 'ground'; G.scene.add(root);
  const render = G.render;

  // ---- puddle map (R: water level, G: how damp the stone is between puddles)
  const lvl = new Float32Array(MW * MH), data = new Uint8Array(MW * MH * 4);
  for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
    const x = X0 + (i + 0.5) / MW * (X1 - X0), z = Z0 + (j + 0.5) / MH * (Z1 - Z0), k = j * MW + i, h = levelAt(x, z);
    lvl[k] = h; data[k * 4] = Math.round(h * 255); data[k * 4 + 1] = Math.round(clamp(0.5 + (vnoise(x * 0.7 + 31, z * 0.7 + 17) - 0.5) * 1.5 + (vnoise(x * 2.3 + 5, z * 2.3 + 2) - 0.5) * 0.5, 0, 1) * 255); data[k * 4 + 2] = 0; data[k * 4 + 3] = 255;
  }
  const maskTex = new THREE.DataTexture(data, MW, MH, THREE.RGBAFormat); maskTex.minFilter = maskTex.magFilter = THREE.LinearFilter; maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping; maskTex.needsUpdate = true; maskTex.name = 'ground-puddles';
  const sampleLevel = (x, z) => {
    const u = clamp((x - X0) / (X1 - X0) * MW - 0.5, 0, MW - 1.001), v = clamp((z - Z0) / (Z1 - Z0) * MH - 0.5, 0, MH - 1.001), i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * MW + i;
    return lerp(lerp(lvl[k], lvl[k + 1], fu), lerp(lvl[k + MW], lvl[k + MW + 1], fu), fv);
  };
  let noiseTex = render.noiseTex;
  if (!noiseTex) { const a = new Uint8Array(256 * 256 * 4); for (let i = 0; i < a.length; i++) a[i] = (hash2(i, 77) * 256) | 0; noiseTex = new THREE.DataTexture(a, 256, 256, THREE.RGBAFormat); noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping; noiseTex.minFilter = noiseTex.magFilter = THREE.LinearFilter; noiseTex.needsUpdate = true; }

  // ---- mirror target
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
  const U = {
    uGMask: { value: maskTex }, uGNoise: { value: noiseTex }, tGRefl: { value: black }, uGReflMat: { value: new THREE.Matrix4() },
    uGOrg: { value: new THREE.Vector4(X0, Z0, 1 / (X1 - X0), 1 / (Z1 - Z0)) }, uGRight: { value: new THREE.Vector3(1, 0, 0) },
    uGTime: { value: 0 }, uGRain: { value: 0.7 }, uGWet: { value: 1 }, uGReflOn: { value: 0 }, uGLod: { value: 0 }, uGRing: { value: 0.55 }, uGDistort: { value: 1 }, uGStreak: { value: 1 }, uGAspect: { value: 16 / 9 }, uGFilm: { value: 0.9 }, uGGain: { value: 1 }, uGF0: { value: 0.12 }, uGDark: { value: 0.7 }, uGBoost: { value: 1.6 },
  };
  const tune = { clipY: -0.004, ring: 0.55, distort: 1, streak: 1, film: 0.9, gain: 1, f0: 0.12, dark: 0.7, boost: 1.6 };   // live: __G.ground.tune.streak = 1.5

  // ---- materials: the library's, cloned and patched
  const patch = (name, kind, planeY, opts) => {
    const base = G.mats.get(name, opts), mat = base.clone();
    mat.userData = base.userData; if (base.defines) mat.defines = { ...base.defines };
    const prev = base.onBeforeCompile, prevKey = base.customProgramCacheKey;
    const uPlane = { value: planeY };
    mat.onBeforeCompile = (shader, r) => {
      if (prev) { try { prev.call(mat, shader, r); } catch (e) { console.warn('[ground] library shader hook failed on ' + name + ': ' + e); } }
      Object.assign(shader.uniforms, U, { uGPlaneY: uPlane });
      const vs = shader.vertexShader, fs = shader.fragmentShader;
      if (!vs.includes('#include <project_vertex>') || !fs.includes('#include <lights_physical_fragment>') || !fs.includes('#include <lights_fragment_maps>')) { console.warn('[ground] ' + name + ': unexpected shader layout, wet floor patch skipped'); return; }
      shader.vertexShader = vs.replace('#include <common>', '#include <common>\nvarying vec3 vGW;').replace('#include <project_vertex>', '#include <project_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = fs.replace('#include <common>', '#include <common>\n' + (/\bqlOrm\b/.test(fs) ? '#define G_QL\n' : '') + PARS)
        .replace('#include <lights_physical_fragment>', SURFACE[kind] + '\n#include <lights_physical_fragment>\nmaterial.specularColor = mix(material.specularColor, vec3(uGF0), clamp(gMirror, 0.0, 1.0) * gUp);')
        .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + REFLECT);
    };
    mat.customProgramCacheKey = () => 'qlm-ground-' + kind + (prevKey ? prevKey.call(base) : '');
    mat.name = name + '+wet' + kind; mat.needsUpdate = true;
    return mat;
  };
  const matStreet = patch('granite_slab', 0, 0);
  // the mirror picture is taken about y = 0; a floor 12 cm higher reads it a little lower down, which lines up distant
  // lights (most of what a tile reflects) and leaves a small error at the foot of things standing on it
  const matTileS = patch('tile_flower_a', 1, -0.07, { interior: true }), matTileN = patch('tile_flower_b', 1, -0.07, { interior: true });
  const matKerb = patch('granite_slab', 2, -0.07);

  // ---- geometry (UVs in metres, like util.boxUV)
  const flat = (x0, x1, z0, z1, y) => { const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2); const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i)); return g; };
  const street = new THREE.Mesh(flat(X0, X1, Z0, Z1, 0), matStreet); street.name = 'carriageway'; root.add(street);
  const tileS = new THREE.Mesh(flat(X0, X1, Z1 + KERB_W, WALL_Z + 0.25, FLOOR_Y), matTileS); tileS.name = 'arcade-floor-south'; root.add(tileS);
  const tileN = new THREE.Mesh(flat(X0, X1, -WALL_Z - 0.25, -Z1 - KERB_W, FLOOR_Y), matTileN); tileN.name = 'arcade-floor-north'; root.add(tileN);
  // kerb stones: 1 m blocks with a 6 mm joint and a chamfered street edge, merged into one mesh
  const kerbs = [];
  for (const s of [1, -1]) for (let x = X0; x < X1; x += 1) {
    const g = boxUV(0.994, FLOOR_Y - 0.012, KERB_W - 0.004, 'bottom'); g.translate(x + 0.5, 0, s * (Z1 + KERB_W / 2));
    const cap = boxUV(0.994, 0.012, KERB_W - 0.022, 'bottom'); cap.translate(x + 0.5, FLOOR_Y - 0.012, s * (Z1 + KERB_W / 2 + 0.009));
    kerbs.push(g, cap);
  }
  const kerb = new THREE.Mesh(mergeGeos(kerbs), matKerb); kerb.name = 'kerbs'; root.add(kerb);
  // a dark apron under everything so no gap at the ends of the block ever shows the sky
  const apron = new THREE.Mesh(flat(-60, 60, -16, 16, -0.03), new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.6 })); apron.name = 'apron'; root.add(apron);

  // ---- colliders: the two arcade floors (kerb included)
  if (G.physics && G.physics.addBox) { G.physics.addBox(box3(X0, 0, Z1, X1, FLOOR_Y, WALL_Z, 'tile')); G.physics.addBox(box3(X0, 0, -WALL_Z, X1, FLOOR_Y, -Z1, 'tile')); }

  // ---- the mirror pass
  let reflOn = true, rt = null, rain = 0.7, rainTarget = 0.7, time = 0;
  const mirror = new THREE.PerspectiveCamera(); mirror.matrixAutoUpdate = true;
  const vPos = new THREE.Vector3(), vUp = new THREE.Vector3(), vFwd = new THREE.Vector3(), vTgt = new THREE.Vector3(), plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const ensureTarget = () => {
    const s = G.quality.refl || 0, sz = render.size || { w: 1280, h: 720 };
    const w = Math.max(64, Math.round(sz.w * s / 2) * 2), h = Math.max(32, Math.round(sz.h * s / 2) * 2);
    if (rt && rt.width === w && rt.height === h) return;
    if (rt) rt.dispose();
    rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: true, stencilBuffer: false });
    rt.texture.name = 'ground-mirror'; U.uGLod.value = Math.log2(h / 540);
  };
  const prePass = (renderer, scene, camera) => {
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    U.uGRight.value.set(e[0], e[1], e[2]); U.uGAspect.value = camera.aspect;
    if (!reflOn || !(G.quality.refl > 0) || e[13] < 0.03 || G.params.refl === '0') { U.uGReflOn.value = 0; return; }
    ensureTarget();
    // the same eye, mirrored about y = 0 and turned the right way up again, so it stays an ordinary camera
    vPos.set(e[12], -e[13], e[14]); vUp.set(-e[4], e[5], -e[6]); vFwd.set(-e[8], e[9], -e[10]);
    mirror.position.copy(vPos); mirror.up.copy(vUp); mirror.lookAt(vTgt.copy(vPos).add(vFwd));
    mirror.near = camera.near; mirror.far = camera.far; mirror.updateMatrixWorld(); mirror.matrixWorldInverse.copy(mirror.matrixWorld).invert();
    mirror.projectionMatrix.copy(camera.projectionMatrix);
    U.uGReflMat.value.multiplyMatrices(bias, mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
    // oblique near plane: nothing below the ground gets into the mirror (the third row of the projection is rebuilt so
    // that the near plane becomes the ground plane, seen from the mirrored eye)
    plane.set(vTgt.set(0, 1, 0), -tune.clipY).applyMatrix4(mirror.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const p = mirror.projectionMatrix.elements;
    q.set((Math.sign(clip.x) + p[8]) / p[0], (Math.sign(clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1; p[14] = clip.w;
    mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
    const fxRoot = G.fx && G.fx.root, fxWas = fxRoot ? fxRoot.visible : false;
    root.visible = false; if (fxRoot) fxRoot.visible = false;
    U.tGRefl.value = black;   // never sample the target while drawing into it
    try { render.renderWorld(mirror, rt); } finally { root.visible = true; if (fxRoot) fxRoot.visible = fxWas; }
    U.tGRefl.value = rt.texture; U.uGReflOn.value = 1;
  };
  if (render.prePasses) render.prePasses.push(prePass);

  const inStreet = (x, z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
  const api = {
    root, tune, uniforms: U, bounds: { x0: X0, x1: X1, z0: Z0, z1: Z1, floorY: FLOOR_Y }, basins: BASINS,
    setRain(v) { rainTarget = clamp(+v || 0, 0, 1); },
    setReflections(on) { reflOn = !!on; },
    // standing water under this point? (the shader adds a ragged edge of a few centimetres on top of this)
    isPuddle(x, z) { return inStreet(x, z) && sampleLevel(x, z) - 0.5 > 0.012; },
    // 0 dry .. 1 standing water
    wetnessAt(x, z) {
      if (inStreet(x, z)) return clamp(0.6 + smoothstep(-0.12, 0.02, sampleLevel(x, z) - 0.5) * 0.4, 0, 1);
      const az = Math.abs(z); if (az > Z1 && az <= WALL_Z) return clamp(0.42 - (az - Z1) / (WALL_Z - Z1) * 0.34, 0, 1);
      return 0.5;
    },
    update(dt) {
      time += dt; rain += (rainTarget - rain) * Math.min(1, dt * 0.8);
      U.uGTime.value = time; U.uGRain.value = rain; U.uGRing.value = tune.ring; U.uGDistort.value = tune.distort; U.uGStreak.value = tune.streak; U.uGFilm.value = tune.film; U.uGGain.value = tune.gain; U.uGF0.value = tune.f0; U.uGDark.value = tune.dark; U.uGBoost.value = tune.boost;
      const w = G.mats && G.mats.uniforms && G.mats.uniforms.wet ? G.mats.uniforms.wet.value : 1; U.uGWet.value = clamp(w, 0, 1);
    },
    stats: () => ({ mirror: rt ? rt.width + 'x' + rt.height : 'off', on: U.uGReflOn.value }),
  };
  return api;
}

// ---------------------------------------------------------------- showcase: a short stretch of street with things to mirror
export async function showcase(G) {
  const T = THREE, S = G.scene, root = new T.Group(); root.name = 'ground-showcase'; S.add(root);
  const em = (c, i) => G.mats.emissive(c, i);
  const addBox = (x, y, z, w, h, d, mat) => { const m = new T.Mesh(boxUV(w, h, d, 'bottom'), mat); m.position.set(x, y, z); root.add(m); return m; };
  // two rows of arcade buildings (real ones when the arch module exists, plain stand-ins otherwise)
  const place = (b, x, side) => { b.position.set(side > 0 ? x : x + b.userData.size[0], 0, side * 3.4); if (side < 0) b.rotation.y = Math.PI; root.add(b); b.updateMatrixWorld(true);
    for (const c of b.userData.colliders || []) { const bb = new T.Box3(c.min.clone(), c.max.clone()).applyMatrix4(b.matrixWorld); G.physics.addBox({ min: bb.min, max: bb.max, surface: c.surface }); } };
  try {
    place(G.arch.building({ bays: 4, floors: 3, side: 1, seed: 11, style: 'nanyang', shop: ['open', 'shutter', 'glass', 'tanglong'] }), -10, 1);
    place(G.arch.building({ bays: 3, floors: 3, side: 1, seed: 12, style: 'baroque', shop: ['glass', 'open', 'shutter'] }), 6, 1);
    place(G.arch.building({ bays: 4, floors: 4, side: -1, seed: 13, style: 'modern', shop: ['shutter', 'open', 'glass', 'open'] }), -12, -1);
    place(G.arch.building({ bays: 3, floors: 3, side: -1, seed: 14, style: 'plain', shop: ['tanglong', 'glass', 'open'] }), 4, -1);
  } catch (e) { console.warn('[ground showcase] buildings skipped: ' + e); }
  // signs: neon along the fascias and hanging over the street, lightboxes at the kerb
  const sign = (kind, text, o, x, y, z, ry) => { try { const s = G.signs[kind](text, o); s.position.set(x, y, z); s.rotation.y = ry; root.add(s); } catch (e) { /* stub or missing */ } };
  sign('neon', '陈记粥铺', { color: 0xff4d6d, height: 0.62 }, -6, 3.5, 3.1, Math.PI);
  sign('neon', '西关凉茶', { color: 0x3ddc97, height: 0.62 }, 2.5, 3.5, 3.1, Math.PI);
  sign('neon', '月明茶楼', { color: 0x48d1ff, height: 0.62 }, -7, 3.5, -3.1, 0);
  sign('neon', '同福钟表', { color: 0xffc24a, height: 0.62 }, 3.5, 3.5, -3.1, 0);
  sign('lightbox', '珠玑士多', { w: 1.5, h: 0.5 }, -1.6, 2.5, 3.1, Math.PI);
  sign('lightbox', '光明理发', { w: 0.5, h: 1.6, vertical: true }, 7.9, 2.6, -3.0, 0);
  // bright things at cat height: glowing boxes, a row of lanterns, a striped barrier of tubes
  const PAL = [0xff4d6d, 0x3ddc97, 0xffc24a, 0x48d1ff, 0xffb86b, 0x8a3df0];
  PAL.forEach((c, i) => { addBox(-5 + i * 2.6, 0.12, i % 2 ? 3.9 : -3.9, 0.5, 0.5 + (i % 3) * 0.25, 0.5, em(c, 2.6)); });
  for (let i = 0; i < 9; i++) { const l = new T.Mesh(new T.SphereGeometry(0.17, 16, 12), em(0xffa64a, 3.2)); l.scale.y = 1.25; l.position.set(-9 + i * 2.3, 2.9 + 0.12 * Math.sin(i * 1.7), i % 2 ? 2.9 : -2.9); root.add(l); }
  for (let i = 0; i < 5; i++) addBox(1.4 + i * 0.22, 0, -0.7 + i * 0.05, 0.05, 1.1, 0.05, em(PAL[i], 4));
  addBox(-2.2, 0, -1.1, 0.5, 0.45, 0.4, G.mats.get('crate_wood'.replace('crate_', '') + '_dark'));   // a dark crate standing in the wet
  addBox(4.4, 0, 1.2, 0.34, 0.34, 0.34, G.mats.get('plastic_red'));
  // pooled lights where a real street would have them
  const L = [[-6, 2.6, 4.6, 0xffb86b, 22], [2.5, 2.6, 4.6, 0xffb86b, 20], [-7, 2.6, -4.6, 0xffc890, 20], [3.5, 2.6, -4.6, 0xffb86b, 20], [-1, 2.2, 0, 0xff4d6d, 10], [6.5, 1.6, -2.6, 0x48d1ff, 10]];
  for (const [x, y, z, c, I] of L) { const l = G.render.lightPool.acquire(); if (!l) break; l.position.set(x, y, z); l.color.set(c); l.intensity = I; l.distance = 11; }
  if (G.physics.build) G.physics.build();
  return { cam: [-8.5, 0.26, 1.5], target: [3, 0.55, -0.4], update() {} };
}
