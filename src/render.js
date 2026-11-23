// render.js — the picture (CORE). WebGL renderer on #view, an HDR half-float scene target with MSAA, and a post chain
// written here as full-screen shader passes: bloom (13-tap downsample chain + tent upsample, energy conserving),
// eye adaptation from the smallest bloom level, a filmic tone curve, split-tone grade, vignette, FXAA, grain.
// The night sky is a shader on a box pinned to the far plane (moonlit cloud, city glow, stars, dawn in the east, +X);
// a PMREM of that sky is the environment map. Eight PointLights live in a pool so the light count never changes.
// Everything the post chain reads sits in `tune` and can be changed live from the console: __G.render.tune.bloom = 0.3
import * as THREE from 'three';
import { STUBS } from './stubs.js';
import { QUALITY, makeRng, clamp, lerp, smoothstep } from './util.js';

const HDR = THREE.HalfFloatType;
const BUDGET = { low: 1.0e6, medium: 1.6e6, high: 2.4e6, ultra: 3.8e6 };   // internal pixels per tier
const LUMA = 'vec3(0.2126, 0.7152, 0.0722)';

// ---------------------------------------------------------------- shaders
const FS_VERT = /* glsl */`varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const NOISE_GLSL = /* glsl */`
uniform sampler2D tNoise;
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return texture2D(tNoise, (i + f + 0.5) / 256.0).r; }
float fbm3(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * n2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3; a *= 0.5; } return s / 0.875; }
float fbm5(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3; a *= 0.5; } return s / 0.96875; }
`;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`;

// the whole sky: gradient, city glow hugging the horizon, stars, a moon in the west, one deck of moonlit cloud,
// and the first colours of sunrise in the east as uDawn goes 0 -> 1. uEnv = 1 is the copy used for the environment map.
const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform float uTime, uDawn, uEnv, uFlash, uGlow, uCloud;
uniform vec3 uMoonDir;
${NOISE_GLSL}
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec2 az = normalize(d.xz + vec2(1e-5, 0.0));
  float east = max(az.x, 0.0), dawn = uDawn, dw = smoothstep(0.0, 1.0, dawn);
  // night gradient: deep blue overhead, a paler teal-blue low down; both lift toward dusty blue as the day comes
  vec3 zen = mix(vec3(0.010, 0.024, 0.066), vec3(0.070, 0.150, 0.370), dw);
  vec3 hor = mix(vec3(0.034, 0.066, 0.130), vec3(0.400, 0.330, 0.390), dw);
  vec3 col = mix(hor, zen, smoothstep(0.0, 0.62, pow(h, 0.62)));
  // the city beyond the roofs: a warm sodium band, uneven along the horizon, with a faint magenta veil above it
  float gN = 0.45 + 0.75 * n2(az * 2.3 + 11.0);
  vec3 glow = vec3(0.62, 0.30, 0.14) * exp(-h * 7.5) * gN + vec3(0.20, 0.08, 0.19) * exp(-h * 2.6) * 0.55;
  col += glow * uGlow * (1.0 - 0.7 * dw);
  // sunrise: a fire line on the eastern horizon, peach above it, pink higher still
  float e1 = pow(east, 2.5), e2 = pow(east, 9.0);
  vec3 rise = vec3(1.00, 0.36, 0.10) * exp(-h * 10.0) * e1 * 2.6 + vec3(1.00, 0.52, 0.42) * exp(-h * 3.6) * e1 * 0.85 + vec3(1.00, 0.80, 0.42) * exp(-h * 26.0) * e2 * 4.5 + vec3(0.95, 0.42, 0.46) * exp(-h * 1.7) * (0.2 + 0.8 * e1) * 0.26;
  col += rise * dw * dw;
  float mu = max(dot(d, uMoonDir), 0.0);
  // cloud deck: the view ray meets a flat ceiling, a warped 5-layer noise is the density
  vec2 cuv = d.xz / (h + 0.16) * vec2(0.50, 0.72) + vec2(0.010, 0.004) * uTime;
  vec2 warp = vec2(fbm3(cuv * 0.8 + 3.1), fbm3(cuv * 0.8 + 9.7)) - 0.5;
  vec2 q = cuv * 0.95 + warp * 0.9;
  float dens = fbm5(q), big = n2(cuv * 0.23 + 5.0);
  float body = dens * 0.72 + big * 0.42;
  float cov = smoothstep(0.50 - 0.2 * uCloud, 0.74 - 0.2 * uCloud, body) * smoothstep(0.0, 0.07, d.y);
  // stars in the gaps
  vec2 sp = d.xz / (h + 0.4) * 46.0; vec2 si = floor(sp), sf = fract(sp) - 0.5;
  vec4 sr = texture2D(tNoise, (si + 0.5) / 256.0);
  float star = step(0.90, sr.r) * smoothstep(0.05 + 0.10 * sr.g, 0.0, length(sf - (sr.gb - 0.5) * 0.6)) * (0.35 + 0.65 * sr.b);
  star *= 0.75 + 0.25 * sin(uTime * (2.0 + 5.0 * sr.g) + sr.b * 40.0);
  col += vec3(0.80, 0.88, 1.0) * star * 1.6 * (1.0 - cov) * (1.0 - dw) * smoothstep(0.03, 0.25, d.y) * (1.0 - uEnv);
  // moon: disc with soft limb and faint maria, a tight aureole and a wide veil
  float disc = smoothstep(0.99962, 0.99978, mu);
  float maria = 0.78 + 0.22 * n2(d.xy * 90.0 + d.z * 40.0);
  vec3 moonCol = mix(vec3(0.86, 0.93, 1.0), vec3(1.0, 0.90, 0.80), dw);
  float halo = pow(mu, 900.0) * 1.2 + pow(mu, 110.0) * 0.16 + pow(mu, 16.0) * 0.032;
  col += moonCol * halo * (1.0 - 0.6 * dw);
  col += moonCol * disc * maria * 7.0 * (1.0 - cov * 0.92) * (1.0 - uEnv) * (1.0 - 0.5 * dw);
  // cloud lighting without any 3D: density sampled again a little toward the moon gives relief
  vec2 ld = normalize(uMoonDir.xz + vec2(1e-4)) * 0.22;
  float relief = clamp((dens - fbm5(q + ld)) * 3.2 + 0.45, 0.0, 1.0);
  vec3 cDark = mix(vec3(0.016, 0.027, 0.052), vec3(0.110, 0.120, 0.210), dw);
  vec3 cLit = mix(vec3(0.115, 0.165, 0.270), vec3(0.66, 0.44, 0.43), dw);
  vec3 cc = mix(cDark, cLit, relief * (0.45 + 0.55 * smoothstep(0.0, 0.5, body)));
  cc += moonCol * (pow(mu, 10.0) * 0.10 + pow(mu, 70.0) * 0.50) * (1.0 - smoothstep(0.55, 0.95, body) * 0.75);   // silver lining
  cc += vec3(0.50, 0.25, 0.13) * exp(-h * 4.2) * 0.42 * gN * uGlow * (1.0 - 0.7 * dw);                                   // undersides lit by the city
  cc += (vec3(1.0, 0.42, 0.24) * exp(-h * 2.4) * e1 * 1.6 + vec3(1.0, 0.52, 0.46) * (0.3 + 0.7 * e1) * 0.34 * relief) * dw * dw;      // undersides catching the sunrise
  cc += vec3(0.55, 0.68, 1.0) * uFlash * (0.4 + 1.6 * dens);                                                           // sheet lightning inside the deck
  cc = mix(cc, col, exp(-h * 9.0) * 0.85);                                                                             // far cloud melts into the horizon
  col = mix(col, cc, cov * 0.94);
  // below the horizon: mostly hidden by buildings; in the environment copy it is the wet street bouncing shop light
  if (d.y < 0.0) {
    vec3 gnd = mix(hor * 0.55 + glow * 0.35 * uGlow, vec3(0.030, 0.026, 0.026) + vec3(0.050, 0.030, 0.018) * uEnv, smoothstep(0.0, -0.22, d.y));
    col = mix(col, gnd, smoothstep(0.0, -0.03, d.y));
  }
  if (uEnv > 0.5) {
    // the street itself, as six soft lobes low on the horizon: tungsten from both shopfront rows, neon at the diagonals.
    // This is only in the environment copy, so metal and wet things have coloured light to pick up everywhere.
    float band = exp(-abs(d.y - 0.06) * 5.0);
    col += vec3(1.00, 0.62, 0.30) * pow(max(abs(az.y), 0.0), 3.0) * band * 0.85;
    col += vec3(1.00, 0.22, 0.36) * pow(max(dot(az, vec2(0.707, 0.707)), 0.0), 10.0) * band * 0.9;
    col += vec3(0.16, 0.95, 0.60) * pow(max(dot(az, vec2(-0.707, -0.707)), 0.0), 10.0) * band * 0.7;
    col += vec3(0.20, 0.78, 1.00) * pow(max(dot(az, vec2(-0.707, 0.707)), 0.0), 10.0) * band * 0.8;
    col += vec3(1.00, 0.72, 0.22) * pow(max(dot(az, vec2(0.707, -0.707)), 0.0), 10.0) * band * 0.8;
    col = min(col, vec3(6.0));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// 13 taps in five overlapping 2x2 groups; uKaris > 0 weights each group down by its brightness (first level only),
// which stops one hot pixel on a thin tube from flickering through the whole chain
const DOWN_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uKaris;
vec3 s(float x, float y) { return min(texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb, vec3(48.0)); }
float kw(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b)) * uKaris); }
void main() {
  vec3 a = s(-2., 2.), b = s(0., 2.), c = s(2., 2.), d = s(-2., 0.), e = s(0., 0.), f = s(2., 0.), g = s(-2., -2.), h = s(0., -2.), i = s(2., -2.);
  vec3 j = s(-1., 1.), k = s(1., 1.), l = s(-1., -1.), m = s(1., -1.);
  vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25, g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
  float w0 = 0.5 * kw(g0), w1 = 0.125 * kw(g1), w2 = 0.125 * kw(g2), w3 = 0.125 * kw(g3), w4 = 0.125 * kw(g4);
  gl_FragColor = vec4((g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4), 1.0);
}`;
// 3x3 tent of the blurrier level, mixed into the sharper one (a convex mix at every step: no energy is added)
const UP_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv; uniform sampler2D tLow, tHigh; uniform vec2 uTexel; uniform float uMix;
void main() {
  vec2 t = uTexel; vec3 c = texture2D(tLow, vUv).rgb * 4.0;
  c += (texture2D(tLow, vUv + vec2(t.x, 0.)).rgb + texture2D(tLow, vUv - vec2(t.x, 0.)).rgb + texture2D(tLow, vUv + vec2(0., t.y)).rgb + texture2D(tLow, vUv - vec2(0., t.y)).rgb) * 2.0;
  c += texture2D(tLow, vUv + t).rgb + texture2D(tLow, vUv - t).rgb + texture2D(tLow, vUv + vec2(t.x, -t.y)).rgb + texture2D(tLow, vUv + vec2(-t.x, t.y)).rgb;
  gl_FragColor = vec4(mix(texture2D(tHigh, vUv).rgb, c / 16.0, uMix), 1.0);
}`;
// one pixel: the log-average brightness of the frame (centre weighted), eased over time
const METER_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv; uniform sampler2D tSrc, tPrev; uniform float uBlend;
void main() {
  float s = 0.0, w = 0.0;
  for (int y = 0; y < 5; y++) for (int x = 0; x < 7; x++) {
    vec2 p = (vec2(float(x), float(y)) + 0.5) / vec2(7.0, 5.0); float wt = 1.0 - 0.75 * length(p - 0.5);
    s += log(max(dot(texture2D(tSrc, p).rgb, ${LUMA}), 1e-4)) * wt; w += wt;
  }
  float cur = exp(s / w), prev = texture2D(tPrev, vec2(0.5)).r;
  float o = (prev > 0.0 && prev < 1e4) ? mix(prev, cur, uBlend) : cur;
  gl_FragColor = vec4(o, o, o, 1.0);
}`;
// exposure -> tone curve -> grade -> sRGB, brightness kept in alpha for the edge pass
const GRADE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene, tBloom, tMeter;
${NOISE_GLSL}
uniform float uExposure, uBloom, uBloomAdd, uAuto, uKey, uMinE, uMaxE, uToneMix, uContrast, uLift, uSplit, uSat, uVig, uFade, uFlash, uWet, uCA, uTime;
uniform vec3 uShadowTint, uHighTint, uLiftCol;
vec3 filmic(vec3 c) {   // ACES fit (S. Hill): input transform, rational curve, output transform
  c = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777) * c;
  c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.4329510) + 0.238081);
  return clamp(mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602) * c, 0.0, 1.0);
}
void main() {
  vec2 uv = vUv, c = uv - 0.5; float r2 = dot(c, c);
  if (uWet > 0.002) {   // water on the eye: slow runnels down the edges of the picture bend what is behind them
    vec2 p = vec2(uv.x * 15.0, uv.y * 3.2 + uTime * 0.35);
    float run = smoothstep(0.50, 0.78, n2(p * vec2(1.0, 0.6) + 31.0));
    vec2 g = vec2(n2(p + vec2(0.4, 0.0)) - n2(p - vec2(0.4, 0.0)), (n2(p + vec2(0.0, 0.4)) - n2(p - vec2(0.0, 0.4))) * 0.3);
    uv += g * 0.05 * run * smoothstep(0.04, 0.30, r2) * uWet;
  }
  vec2 off = c * r2 * uCA;
  vec3 col = vec3(texture2D(tScene, uv - off).r, texture2D(tScene, uv).g, texture2D(tScene, uv + off).b);
  vec3 bl = texture2D(tBloom, uv).rgb;
  col = mix(col, bl, uBloom) + bl * uBloomAdd;
  float avg = texture2D(tMeter, vec2(0.5)).r;
  float ae = clamp(pow(uKey / max(avg, 1e-4), 0.8), uMinE, uMaxE);
  col *= uExposure * mix(1.0, ae, uAuto);
  col += vec3(1.0, 0.97, 0.92) * uFlash * 2.0;
  // filmic curve per channel (hot neon cores roll off to white), pulled part of the way toward a curve applied to
  // brightness alone, which keeps the hue of a saturated sign instead of bleaching it
  vec3 a = filmic(col); float L = max(dot(col, ${LUMA}), 1e-5);
  vec3 hp = col * (filmic(vec3(L)).g / L); hp /= max(1.0, max(hp.r, max(hp.g, hp.b)));
  col = mix(a, hp, uToneMix);
  float l = dot(col, ${LUMA});
  col = mix(col, mix(col * uShadowTint, col * uHighTint, smoothstep(0.0, 0.65, l)), uSplit);   // teal shadows, warm highlights
  col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);                                    // gentle S-curve
  col = col * (1.0 - uLift) + uLiftCol * uLift;                                                // lifted, slightly teal blacks
  l = dot(col, ${LUMA}); col = max(mix(vec3(l), col, uSat), 0.0);
  col *= 1.0 - uVig * smoothstep(0.10, 0.62, r2 * 1.25);
  col *= 1.0 - uFade;
  col = mix(col * 12.92, 1.055 * pow(max(col, 1e-5), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
  gl_FragColor = vec4(col, dot(col, ${LUMA}));
}`;
// to the canvas: edge anti-aliasing on the stored brightness, a light unsharp mask, grain, dither
const FINAL_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc; uniform vec2 uPx; uniform float uFxaa, uGrain, uSharpen, uTime;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  vec4 m = texture2D(tSrc, vUv); vec3 col = m.rgb;
  float lNW = texture2D(tSrc, vUv + vec2(-1., 1.) * uPx).a, lNE = texture2D(tSrc, vUv + vec2(1., 1.) * uPx).a;
  float lSW = texture2D(tSrc, vUv + vec2(-1., -1.) * uPx).a, lSE = texture2D(tSrc, vUv + vec2(1., -1.) * uPx).a;
  float lMin = min(m.a, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(m.a, max(max(lNW, lNE), max(lSW, lSE)));
  float edge = lMax - lMin;
  if (uFxaa > 0.5 && edge > max(0.0312, lMax * 0.10)) {
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -8.0, 8.0) * uPx;
    vec4 a = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)) + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)));
    vec4 b = a * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5) + texture2D(tSrc, vUv + dir * 0.5));
    col = (b.a < lMin || b.a > lMax) ? a.rgb : b.rgb;
  } else if (uSharpen > 0.0) {
    vec3 blur = 0.25 * (texture2D(tSrc, vUv + vec2(uPx.x, 0.)).rgb + texture2D(tSrc, vUv - vec2(uPx.x, 0.)).rgb + texture2D(tSrc, vUv + vec2(0., uPx.y)).rgb + texture2D(tSrc, vUv - vec2(0., uPx.y)).rgb);
    col += (col - blur) * uSharpen;
  }
  float g = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 311.0) - 0.5;
  float lum = dot(col, ${LUMA});
  col += g * uGrain * (0.35 + 0.65 * (1.0 - lum)) * 0.6;
  col += (hash(gl_FragCoord.xy * 1.7 + 19.0) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- module
export async function create(G) {
  const params = G.params;
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, depth: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x0c1420, 1);

  // The street is lit by dozens of shop lamps we cannot afford as real lights (the pool has eight). Their bounce is
  // folded into the hemisphere light instead: below arcade height every surface also receives the hemisphere's ground
  // colour (warm, set from dawn below), above it the night air stays blue. One line added to three's light loop.
  { const HEMI = 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );', C = THREE.ShaderChunk;
    if (C.lights_fragment_begin.includes(HEMI) && !C.lights_fragment_begin.includes('qlmLow')) C.lights_fragment_begin = C.lights_fragment_begin.replace(HEMI, HEMI + ' { float qlmLow = 1.0 - smoothstep( 2.4, 6.4, cameraPosition.y + ( vec4( geometryPosition, 0.0 ) * viewMatrix ).y ); irradiance += hemisphereLights[ i ].groundColor * ( qlmLow * 0.9 ); }'); }

  const scene = new THREE.Scene(); scene.name = 'world';
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.03, 400); camera.rotation.order = 'YXZ'; scene.add(camera);

  // shell gap: stubs.js has no stand-in for physics, so ?show=render / mats / signs would die in boot.
  // Hand the shell the real box world for those pages (physics has no dependencies).
  if (!STUBS.physics) {
    try { const real = await (await import('./physics.js')).create(G); STUBS.physics = () => real; }
    catch (e) { const z = new THREE.Vector3(); STUBS.physics = () => ({ stub: true, boxes: [], addBox: b => b, removeBox() {}, build() {}, groundHeight: () => 0, moveBody: () => ({ onGround: true, surface: 'stone', hitWall: false }), raycast: () => null, shelterAt: () => false, _z: z }); }
  }

  const postOn = params.post !== '0', bloomOn = params.bloom !== '0';
  const num = (k, d) => (params[k] !== undefined && params[k] !== '' && isFinite(+params[k]) ? +params[k] : d);

  // every number the picture depends on. Colours are linear RGB triples.
  const tune = {
    exposure: num('r_exp', 1.3),            // manual exposure (multiplied by api.exposure and the eye adaptation)
    autoExposure: num('r_auto', 0.75),      // 0 = manual only, 1 = full eye adaptation
    autoKey: 0.22, autoMin: 0.55, autoMax: 2.4, autoSpeed: 1.2,
    bloom: num('r_bloom', 0.26),            // share of the picture replaced by its blurred copy
    bloomAdd: 0.0,                          // extra bloom added on top (not energy conserving; 0 by default)
    bloomRadius: 0.58,                      // how much each blurrier level feeds the next sharper one
    bloomKaris: 0.2,
    toneMix: 0.3, contrast: 0.16, lift: 0.014, split: 0.75, saturation: 1.14,
    shadowTint: [0.84, 1.0, 1.13], highTint: [1.06, 1.0, 0.91], liftCol: [0.35, 0.62, 0.80],
    vignette: 0.34, grain: 0.035, sharpen: 0.2, ca: 0.003,
    fogDensity: 0.0125, fogNight: [0.030, 0.056, 0.098], fogDawn: [0.40, 0.32, 0.36],
    ambient: 1.0,                           // hemisphere light scale
    shopGlow: 0.72,                         // warm fill below arcade height (the bounce of all the shop lamps)
    moon: 1.0,                              // key light scale
    env: 1.0,                               // environment map scale
    skyGlow: 1.0, cloud: 0.6,
    exposureDawn: 0.85,                     // exposure multiplier reached at dawn = 1
  };
  const post = { fade: 0, saturation: 1, flash: 0, wet: 0 };

  // ---- noise (one 256x256 texture of fixed random numbers; every shader noise here comes from it)
  const noiseTex = (() => {
    const r = makeRng(0x51f15e), a = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < a.length; i++) a[i] = (r() * 256) | 0;
    const t = new THREE.DataTexture(a, 256, 256, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; t.name = 'render-noise';
    return t;
  })();

  // ---- sky
  const MOON_NIGHT = new THREE.Vector3(-0.85, 0.50, -0.05).normalize();   // low in the west, on the axis of the street
  const SUN_DAWN = new THREE.Vector3(0.80, 0.42, 0.30).normalize();
  const skyUniforms = () => ({ tNoise: { value: noiseTex }, uTime: { value: 0 }, uDawn: { value: 0 }, uEnv: { value: 0 }, uFlash: { value: 0 }, uGlow: { value: 1 }, uCloud: { value: 0.5 }, uMoonDir: { value: MOON_NIGHT.clone() } });
  const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: skyUniforms(), side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false, toneMapped: false });
  const sky = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), skyMat); sky.name = 'sky'; sky.frustumCulled = false; sky.renderOrder = 1000; sky.matrixAutoUpdate = false; scene.add(sky);
  // environment copy
  const envMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: skyUniforms(), side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
  envMat.uniforms.uEnv.value = 1;
  const envScene = new THREE.Scene(); { const m = new THREE.Mesh(sky.geometry, envMat); m.frustumCulled = false; envScene.add(m); }
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null, envDawn = -9;
  const bakeEnv = d => {
    const u = envMat.uniforms; u.uDawn.value = d; u.uGlow.value = tune.skyGlow; u.uCloud.value = tune.cloud; u.uMoonDir.value.copy(MOON_NIGHT);
    const prevTarget = renderer.getRenderTarget();
    const rt = pmrem.fromScene(envScene, 0, 0.1, 100);
    renderer.setRenderTarget(prevTarget);
    if (envRT) envRT.dispose();
    envRT = rt; envDawn = d; scene.environment = rt.texture; api.env = rt.texture;
  };

  // ---- lights: a hemisphere for the night air, one key light (the moon, sliding toward the sun by dawn), eight pooled points
  scene.fog = new THREE.FogExp2(0x16283a, tune.fogDensity);
  const hemi = new THREE.HemisphereLight(0x5c86d6, 0x5a4030, 1); hemi.name = 'night-air'; scene.add(hemi);
  const key = new THREE.DirectionalLight(0xa9c4ff, 1); key.name = 'moon'; scene.add(key); scene.add(key.target);
  const sunDir = MOON_NIGHT.clone();
  const POOL = 8, pool = [], flashes = [];
  for (let i = 0; i < POOL; i++) { const l = new THREE.PointLight(0xffb86b, 0, 9, 2); l.name = 'pool-' + i; l.userData.free = true; scene.add(l); pool.push(l); }
  const lightPool = {
    lights: pool,
    acquire() { const l = pool.find(x => x.userData.free); if (!l) return null; l.userData.free = false; l.userData.flash = false; l.distance = 9; l.decay = 2; l.intensity = 0; return l; },
    release(l) { if (!l || pool.indexOf(l) < 0) return; l.userData.free = true; l.intensity = 0; l.position.set(0, -50, 0); const i = flashes.findIndex(f => f.l === l); if (i >= 0) flashes.splice(i, 1); },
    // a short burst of light that fades by itself (camera flash, a spark, lightning on the street)
    flash(pos, color = 0xffffff, intensity = 30, life = 0.3) { const l = this.acquire(); if (!l) return null; l.userData.flash = true; l.position.copy(pos); l.color.set(color); l.intensity = intensity; l.distance = 14; flashes.push({ l, t: 0, life: Math.max(0.03, life), intensity }); return l; },
    used: () => pool.filter(x => !x.userData.free).length,
  };
  for (const l of pool) l.position.set(0, -50, 0);

  // ---- targets and passes
  const mkRT = (w, h, o = {}) => { const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type: o.type ?? HDR, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: !!o.depth, stencilBuffer: false, samples: o.samples || 0, generateMipmaps: false }); rt.texture.name = o.name || 'rt'; return rt; };
  const fsGeo = new THREE.BufferGeometry(); fsGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fsMesh = new THREE.Mesh(fsGeo, null); fsMesh.frustumCulled = false;
  const mkPass = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const blit = (mat, target) => { fsMesh.material = mat; renderer.setRenderTarget(target); renderer.render(fsMesh, fsCam); };
  const LEVELS = 6;
  let rtScene = null, rtLdr = null, down = [], up = [];
  const meter = [mkRT(1, 1, { name: 'meter-a' }), mkRT(1, 1, { name: 'meter-b' })]; let meterIdx = 0, meterFrames = 0;
  const size = { w: 0, h: 0, cw: 0, ch: 0 };
  const mDown = mkPass(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } });
  const mUp = mkPass(UP_FRAG, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 0.6 } });
  const mMeter = mkPass(METER_FRAG, { tSrc: { value: null }, tPrev: { value: null }, uBlend: { value: 1 } });
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
  const mGrade = mkPass(GRADE_FRAG, {
    tScene: { value: null }, tBloom: { value: black }, tMeter: { value: null }, tNoise: { value: noiseTex },
    uExposure: { value: 1 }, uBloom: { value: 0 }, uBloomAdd: { value: 0 }, uAuto: { value: 0 }, uKey: { value: 0.18 }, uMinE: { value: 0.5 }, uMaxE: { value: 2 },
    uToneMix: { value: 0 }, uContrast: { value: 0 }, uLift: { value: 0 }, uSplit: { value: 0 }, uSat: { value: 1 }, uVig: { value: 0 }, uFade: { value: 0 }, uFlash: { value: 0 }, uWet: { value: 0 }, uCA: { value: 0 }, uTime: { value: 0 },
    uShadowTint: { value: new THREE.Vector3(1, 1, 1) }, uHighTint: { value: new THREE.Vector3(1, 1, 1) }, uLiftCol: { value: new THREE.Vector3() },
  });
  const mFinal = mkPass(FINAL_FRAG, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() }, uFxaa: { value: 1 }, uGrain: { value: 0 }, uSharpen: { value: 0 }, uTime: { value: 0 } });

  const disposeTargets = () => { for (const t of [rtScene, rtLdr, ...down, ...up]) if (t) t.dispose(); rtScene = rtLdr = null; down = []; up = []; };
  const buildTargets = () => {
    disposeTargets();
    const Q = G.quality, { w, h } = size;
    rtScene = mkRT(w, h, { depth: true, samples: Q.msaa || 0, name: 'scene-hdr' });
    rtLdr = mkRT(w, h, { type: THREE.UnsignedByteType, name: 'graded' });
    let bw = w, bh = h;
    for (let i = 0; i < LEVELS; i++) { bw = Math.max(2, Math.round(bw / 2)); bh = Math.max(2, Math.round(bh / 2)); down.push(mkRT(bw, bh, { name: 'bloom-down-' + i })); if (i < LEVELS - 1) up.push(mkRT(bw, bh, { name: 'bloom-up-' + i })); }
    meterFrames = 0;
  };
  const listeners = [];
  const resize = () => {
    const cssW = canvas.clientWidth || innerWidth || 1280, cssH = canvas.clientHeight || innerHeight || 720;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(2, Math.round(cssW * dpr)), ch = Math.max(2, Math.round(cssH * dpr));
    let s = G.quality.scale || 1; const budget = BUDGET[G.quality.name] || BUDGET.high;
    if (cw * ch * s * s > budget) s = Math.sqrt(budget / (cw * ch));
    const w = Math.max(2, Math.round(cw * s / 2) * 2), h = Math.max(2, Math.round(ch * s / 2) * 2);
    size.cssW = cssW; size.cssH = cssH;
    if (cw !== size.cw || ch !== size.ch) { size.cw = cw; size.ch = ch; renderer.setSize(cw, ch, false); }
    if (w !== size.w || h !== size.h || !rtScene) { size.w = w; size.h = h; buildTargets(); for (const fn of listeners) { try { fn(size); } catch (e) { console.error('[render] resize listener: ' + (e && e.stack || e)); } } }
    camera.aspect = cw / ch; camera.updateProjectionMatrix();
  };

  // ---- dawn drives the sky, the fog, the lights and the exposure
  const cA = new THREE.Color(), cB = new THREE.Color(), vT = new THREE.Vector3();
  const forcedDawn = params.r_dawn !== undefined ? clamp(+params.r_dawn || 0, 0, 1) : null;
  let flashT = 9, flashPower = 0, skyFlash = 0, time = 0, dawnExposure = 1;
  const applyDawn = d => {
    const dw = smoothstep(0, 1, d);
    skyMat.uniforms.uDawn.value = d; skyMat.uniforms.uGlow.value = tune.skyGlow; skyMat.uniforms.uCloud.value = tune.cloud; skyMat.uniforms.uFlash.value = skyFlash;
    scene.fog.color.setRGB(lerp(tune.fogNight[0], tune.fogDawn[0], dw), lerp(tune.fogNight[1], tune.fogDawn[1], dw), lerp(tune.fogNight[2], tune.fogDawn[2], dw)).multiplyScalar(1 + skyFlash * 2);
    scene.fog.density = tune.fogDensity * lerp(1, 0.8, dw);
    hemi.color.copy(cA.setRGB(0.20, 0.38, 0.92)).lerp(cB.setRGB(0.80, 0.78, 0.98), dw);
    hemi.groundColor.copy(cA.setRGB(1.0, 0.63, 0.40).multiplyScalar(tune.shopGlow * 1.17)).lerp(cB.setRGB(0.40, 0.33, 0.30), dw);
    hemi.intensity = tune.ambient * lerp(0.60, 1.9, dw) * (1 + skyFlash * 3);
    key.color.copy(cA.setRGB(0.46, 0.64, 1.0)).lerp(cB.setRGB(1.0, 0.70, 0.50), dw);
    key.intensity = tune.moon * lerp(0.36, 2.0, dw);
    sunDir.copy(MOON_NIGHT).lerp(SUN_DAWN, dw).normalize();
    // the lerp passes near the zenith half way: fine, the light is at its weakest contrast there
    key.position.copy(sunDir).multiplyScalar(60); key.target.position.set(0, 0, 0);
    scene.environmentIntensity = tune.env * lerp(0.6, 1.25, dw);
    dawnExposure = lerp(1, tune.exposureDawn, dw);
    if (Math.abs(d - envDawn) > 0.04) bakeEnv(d);
  };

  // ---- frame
  const prePasses = [];   // fn(renderer, scene, camera): run before the main view (the ground renders its mirror here)
  const info = { calls: 0, tris: 0, reflCalls: 0, postCalls: 0, total: 0, ms: 0 };
  let lastT = 0, avgMs = 0;
  const renderWorld = (cam, target) => { renderer.setRenderTarget(target); renderer.autoClear = true; renderer.render(scene, cam); };
  const frame = dt => {
    const now = performance.now(); if (lastT) { const ms = now - lastT; avgMs = avgMs ? avgMs * 0.95 + ms * 0.05 : ms; } lastT = now;
    time += dt;
    if ((canvas.clientWidth || 0) !== size.cssW || (canvas.clientHeight || 0) !== size.cssH) resize();
    // lightning: a flicker that dies in under a second
    flashT += dt; skyFlash = flashT < 0.9 ? Math.max(0, flashPower * Math.exp(-flashT * 5) * (0.55 + 0.45 * Math.sin(flashT * 47) * Math.sin(flashT * 13 + 1)) * 0.5) : 0;
    for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; f.t += dt; const k = 1 - f.t / f.life; if (k <= 0) { flashes.splice(i, 1); lightPool.release(f.l); } else f.l.intensity = f.intensity * k * k; }
    const d = forcedDawn !== null ? forcedDawn : clamp(+api.dawn || 0, 0, 1);
    applyDawn(d);
    skyMat.uniforms.uTime.value = time;
    renderer.info.reset();
    const I = renderer.info.render;
    for (const fn of prePasses) { try { fn(renderer, scene, camera); } catch (e) { if (!fn._err) { fn._err = 1; console.error('[render] pre-pass threw: ' + (e && e.stack || e)); } } }
    info.reflCalls = I.calls; const c0 = I.calls, t0 = I.triangles;
    if (!postOn) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = tune.exposure * (api.exposure || 1) * dawnExposure * 1.2;
      renderWorld(camera, null);
      info.calls = I.calls - c0; info.tris = I.triangles - t0; info.postCalls = 0; info.total = I.calls; return;
    }
    renderWorld(camera, rtScene);
    info.calls = I.calls - c0; info.tris = I.triangles - t0; const c1 = I.calls;
    renderer.autoClear = false;
    let bloomTex = black;
    if (bloomOn && G.quality.bloom !== false) {
      let src = rtScene;
      for (let i = 0; i < LEVELS; i++) { mDown.uniforms.tSrc.value = src.texture; mDown.uniforms.uTexel.value.set(1 / src.width, 1 / src.height); mDown.uniforms.uKaris.value = i === 0 ? tune.bloomKaris : 0; blit(mDown, down[i]); src = down[i]; }
      let low = down[LEVELS - 1];
      for (let i = LEVELS - 2; i >= 0; i--) { mUp.uniforms.tLow.value = low.texture; mUp.uniforms.tHigh.value = down[i].texture; mUp.uniforms.uTexel.value.set(1 / low.width, 1 / low.height); mUp.uniforms.uMix.value = tune.bloomRadius; blit(mUp, up[i]); low = up[i]; }
      bloomTex = up[0].texture;
    }
    // eye adaptation: one pixel, eased; reads the smallest bloom level (or the scene itself when bloom is off)
    const mPrev = meter[meterIdx], mNext = meter[1 - meterIdx];
    mMeter.uniforms.tSrc.value = bloomTex === black ? rtScene.texture : down[LEVELS - 1].texture; mMeter.uniforms.tPrev.value = mPrev.texture;
    mMeter.uniforms.uBlend.value = meterFrames++ < 12 ? 1 : 1 - Math.exp(-dt * tune.autoSpeed);
    blit(mMeter, mNext); meterIdx = 1 - meterIdx;
    const u = mGrade.uniforms;
    u.tScene.value = rtScene.texture; u.tBloom.value = bloomTex; u.tMeter.value = mNext.texture;
    u.uExposure.value = tune.exposure * (api.exposure || 1) * dawnExposure; u.uBloom.value = bloomTex === black ? 0 : tune.bloom; u.uBloomAdd.value = bloomTex === black ? 0 : tune.bloomAdd;
    u.uAuto.value = tune.autoExposure; u.uKey.value = tune.autoKey; u.uMinE.value = tune.autoMin; u.uMaxE.value = tune.autoMax;
    u.uToneMix.value = tune.toneMix; u.uContrast.value = tune.contrast; u.uLift.value = tune.lift; u.uSplit.value = tune.split; u.uSat.value = tune.saturation * (post.saturation ?? 1);
    u.uVig.value = tune.vignette; u.uFade.value = clamp(post.fade || 0, 0, 1); u.uFlash.value = Math.max(0, post.flash || 0) + skyFlash * 0.12; u.uWet.value = clamp(post.wet || 0, 0, 1); u.uCA.value = tune.ca; u.uTime.value = time;
    u.uShadowTint.value.fromArray(tune.shadowTint); u.uHighTint.value.fromArray(tune.highTint); u.uLiftCol.value.fromArray(tune.liftCol);
    blit(mGrade, rtLdr);
    const f = mFinal.uniforms; f.tSrc.value = rtLdr.texture; f.uPx.value.set(1 / size.w, 1 / size.h); f.uFxaa.value = G.quality.fxaa ? 1 : 0; f.uGrain.value = tune.grain; f.uSharpen.value = tune.sharpen; f.uTime.value = time;
    blit(mFinal, null);
    renderer.autoClear = true;
    info.postCalls = I.calls - c1; info.total = I.calls;
  };

  const api = {
    renderer, scene, camera, sunDir, exposure: 1, tune, post, lightPool, env: null, dawn: 0, size, sky, noiseTex, prePasses, renderWorld,
    onResize(fn) { listeners.push(fn); },
    setQuality(q) { const src = typeof q === 'string' ? QUALITY[q] : q; if (!src) return; Object.assign(G.quality, src); size.w = 0; resize(); },
    resize, frame,
    stats() { const m = renderer.info.memory; return { calls: info.calls, tris: info.tris, tex: m.textures, programs: renderer.info.programs ? renderer.info.programs.length : 0, fps: avgMs ? +(1000 / avgMs).toFixed(1) : 0, ms: +avgMs.toFixed(2), reflCalls: info.reflCalls, postCalls: info.postCalls, totalCalls: info.total, res: size.w + 'x' + size.h, msaa: G.quality.msaa || 0, lights: lightPool.used(), geo: m.geometries }; },
    // called once everything is in the scene: compile every program now so the first seconds of play do not hitch
    async onLevelReady() {
      applyDawn(forcedDawn !== null ? forcedDawn : clamp(+api.dawn || 0, 0, 1));
      try { if (postOn) renderer.setRenderTarget(rtScene); renderer.compile(scene, camera); } catch (e) { console.warn('[render] precompile skipped: ' + e); }
      renderer.setRenderTarget(null);
    },
    // lightning: called by the "thunder" event, or directly
    lightning(power = 1) { flashT = 0; flashPower = clamp(power, 0, 2); },
  };
  G.events.on('thunder', e => api.lightning(e && e.intensity !== undefined ? e.intensity : 1));
  addEventListener('resize', resize);
  resize();
  applyDawn(forcedDawn !== null ? forcedDawn : 0);
  return api;
}

// ---------------------------------------------------------------- showcase: the whole chain at a glance
export async function showcase(G) {
  const T = THREE, S = G.scene, root = new T.Group(); root.name = 'render-showcase'; S.add(root);
  const PAL = [0xffb86b, 0xff4d6d, 0x3ddc97, 0xffc24a, 0x48d1ff, 0xe02a2a, 0x2a55e0, 0x1fae4e, 0xf2d21f, 0x8a3df0];
  // spheres: roughness left to right, three rows: plaster white, coloured dielectric, metal
  const sg = new T.SphereGeometry(0.34, 40, 24);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 7; i++) {
    const m = new T.MeshStandardMaterial({ color: r === 0 ? 0xe8e2d4 : r === 1 ? [0xb8322a, 0x1f7a6a, 0x2a4fa8, 0xc9902a, 0x7a3a8a, 0x2f8a3a, 0xb04a6a][i] : [0xd8d8dc, 0xd9a05a, 0xe6c15a, 0xb87333, 0xd8d8dc, 0xd9a05a, 0xe6c15a][i], roughness: 0.04 + i * 0.16, metalness: r === 2 ? 1 : 0 });
    const s = new T.Mesh(sg, m); s.position.set(-2.7 + i * 0.9, 0.36 + r * 0.82, 0); root.add(s);
  }
  // emissive bars, two strengths, in every palette colour (the lower row is the "neon" strength, the upper is a hot core)
  const bg = new T.BoxGeometry(0.07, 1.2, 0.07);
  PAL.forEach((c, i) => {
    for (let k = 0; k < 2; k++) { const b = new T.Mesh(bg, G.mats.emissive(c, k ? 9 : 3)); b.position.set(-4.05 + i * 0.9, 3.4 + k * 1.35, -1.2); root.add(b); }
    const d = new T.Mesh(new T.SphereGeometry(0.11, 16, 12), G.mats.emissive(c, 4)); d.position.set(-4.05 + i * 0.9, 0.11, 1.5); root.add(d);
  });
  const wall = new T.Mesh(new T.BoxGeometry(11, 6.4, 0.2), new T.MeshStandardMaterial({ color: 0x2a3a48, roughness: 0.8 })); wall.position.set(0, 3.2, -1.9); root.add(wall);
  // lit boxes in the wall colours, each beside a pooled light
  const cols = [0xe9dcc0, 0x3f8f8a, 0xd9a0a0, 0x6a2a22];
  const lights = [[-4.6, 1.5, 1.2, 0xffb86b, 16], [4.6, 1.4, 1.2, 0xff4d6d, 14], [0, 3.0, 2.2, 0x48d1ff, 10]];
  cols.forEach((c, i) => { const b = new T.Mesh(new T.BoxGeometry(0.9, 0.9 + i * 0.25, 0.9), new T.MeshStandardMaterial({ color: c, roughness: 0.7 })); b.position.set(i < 2 ? -5.2 + i * 1.1 : 3.0 + i * 0.7, (0.9 + i * 0.25) / 2, 0.4); b.rotation.y = 0.3 * i; root.add(b); });
  for (const [x, y, z, c, I] of lights) { const l = G.render.lightPool.acquire(); if (!l) break; l.position.set(x, y, z); l.color.set(c); l.intensity = I; const d = new T.Mesh(new T.SphereGeometry(0.06, 12, 8), G.mats.emissive(c, 6)); d.position.set(x, y, z); root.add(d); }
  // a mirror ball and a rough gold ball to judge the environment map
  const ball = new T.Mesh(new T.SphereGeometry(0.55, 48, 32), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, metalness: 1 })); ball.position.set(-3.6, 0.55, 2.0); root.add(ball);
  const gold = new T.Mesh(new T.SphereGeometry(0.55, 48, 32), new T.MeshStandardMaterial({ color: 0xe6c15a, roughness: 0.32, metalness: 1 })); gold.position.set(3.6, 0.55, 2.0); root.add(gold);
  return { cam: [0, 2.3, 8.2], target: [0, 2.3, 0], update() {} };
}
