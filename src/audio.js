// audio.js — everything the player hears (AUDIO agent). No audio files: every sound and every note of the music is
// computed sample by sample into Float32Arrays when the page loads, then played through the Web Audio API.
//   PART 1  DSP toolbox      plain functions on typed arrays, no browser dependencies (runs under node too)
//   PART 2  recipes          one function per sound; the seed of each sound is the hash of its name
//   PART 3  engine           create(G): buses, voices, 3D, reverbs, music layers, events, selfTest, debug
//   PART 4  showcase         ?show=audio : every sound with its waveform, spectrogram and numbers, played in turn
// See CONTRACT.md (audio) and NOTES_audio.md.

// =====================================================================================================================
// PART 1 — DSP toolbox
// =====================================================================================================================
const PI = Math.PI, TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
export const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// seeded random (mulberry32): r(), r.range, r.int, r.pick, r.bi (-1..1), r.seed
export function makeRng(seed) {
  let s = seed >>> 0;
  const r = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = a => a[Math.floor(r() * a.length)];
  r.bi = () => r() * 2 - 1;
  r.seed = () => (Math.floor(r() * 4294967296) >>> 0) || 1;
  return r;
}
const buf = (sr, sec) => new Float32Array(Math.max(1, Math.round(sr * sec)));
// white noise in [-1, 1]; a xorshift stream seeded from the sound's generator (bulk noise is the hot loop at boot)
function noise(n, rng) {
  const o = new Float32Array(n); let s = rng.seed() | 0;
  for (let i = 0; i < n; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; o[i] = (s >>> 0) * 4.656612873077393e-10 - 1; }
  return o;
}
// biquad coefficients written out by hand (the usual cookbook forms): lp hp bp notch peak ls hs
function coef(type, f, q, sr, dB = 0) {
  f = clamp(f, 10, sr * 0.47); const w = TAU * f / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
  let b0, b1, b2, a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  if (type === 'lp') { b1 = 1 - cs; b0 = b2 = b1 / 2; }
  else if (type === 'hp') { b1 = -(1 + cs); b0 = b2 = (1 + cs) / 2; }
  else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; }
  else if (type === 'notch') { b0 = 1; b1 = -2 * cs; b2 = 1; }
  else if (type === 'peak') { const A = Math.pow(10, dB / 40); b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a2 = 1 - al / A; }
  else {   // shelves, slope 1
    const A = Math.pow(10, dB / 40), k = 2 * Math.sqrt(A) * (sn / 2 * Math.SQRT2);
    if (type === 'ls') { b0 = A * ((A + 1) - (A - 1) * cs + k); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - k); a0 = (A + 1) + (A - 1) * cs + k; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - k; }
    else { b0 = A * ((A + 1) + (A - 1) * cs + k); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - k); a0 = (A + 1) - (A - 1) * cs + k; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - k; }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
// run a fixed biquad over a buffer in place (transposed direct form II)
function biquad(x, type, f, q, sr, dB) {
  const c = coef(type, f, q, sr, dB), b0 = c[0], b1 = c[1], b2 = c[2], a1 = c[3], a2 = c[4]; let z1 = 0, z2 = 0;
  for (let i = 0, n = x.length; i < n; i++) { const v = x[i], y = b0 * v + z1; z1 = b1 * v - a1 * y + z2 + 1e-25; z2 = b2 * v - a2 * y; x[i] = y; }
  return x;
}
// time-varying biquad: the cutoff (and optionally Q) is a function of progress 0..1, re-read every `step` samples
function biquadVar(x, type, fFn, q, sr, step = 32, dB) {
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1 = 0, z2 = 0; const n = x.length, qf = typeof q === 'function';
  for (let i = 0; i < n; i++) {
    if (i % step === 0) { const p = i / n, c = coef(type, fFn(p), qf ? q(p) : q, sr, dB); b0 = c[0]; b1 = c[1]; b2 = c[2]; a1 = c[3]; a2 = c[4]; }
    const v = x[i], y = b0 * v + z1; z1 = b1 * v - a1 * y + z2 + 1e-25; z2 = b2 * v - a2 * y; x[i] = y;
  }
  return x;
}
const peakOf = x => { let m = 0; for (let i = 0; i < x.length; i++) { const a = x[i] < 0 ? -x[i] : x[i]; if (a > m) m = a; } return m; };
const rmsOf = x => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); };
const scale = (x, g) => { for (let i = 0; i < x.length; i++) x[i] *= g; return x; };
const norm1 = x => { const p = peakOf(x); return p > 1e-9 ? scale(x, 1 / p) : x; };
const toRms = (x, r) => { const v = rmsOf(x); return v > 1e-9 ? scale(x, r / v) : x; };
const shape = (x, sr, fn) => { for (let i = 0; i < x.length; i++) x[i] *= fn(i / sr); return x; };   // multiply by an envelope of time
const sat = (x, d) => { const k = 1 / Math.tanh(d); for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * d) * k; return x; };
function fade(x, sr, tin, tout) {
  const a = Math.min(x.length, Math.round(tin * sr)), b = Math.min(x.length, Math.round(tout * sr)), n = x.length;
  for (let i = 0; i < a; i++) x[i] *= i / a;
  for (let i = 0; i < b; i++) { const u = i / b; x[n - 1 - i] *= u * u * (3 - 2 * u); }
  return x;
}
// filtered noise burst with an exponential tail, normalised to peak 1 — the workhorse for anything that taps, puffs or splashes
function burst(sr, rng, dur, tau, o = {}) {
  const x = noise(Math.max(2, Math.round(sr * dur)), rng), att = o.att || 0;
  if (o.hp) biquad(x, 'hp', o.hp, o.q || 0.707, sr);
  if (o.lp) biquad(x, 'lp', o.lp, o.q || 0.707, sr);
  if (o.bp) biquad(x, 'bp', o.bp, o.q || 1, sr);
  for (let i = 0; i < x.length; i++) { const t = i / sr; x[i] *= Math.exp(-t / tau) * (att ? 1 - Math.exp(-t / att) : 1); }
  return norm1(x);
}
// pitch-swept sine: f goes from f0 towards f1 with time constant tSw, loudness decays with tDec (thumps, knocks)
function sweep(sr, dur, f0, f1, tSw, tDec, att = 0.001) {
  const n = Math.round(sr * dur), o = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / sr; ph += TAU * (f1 + (f0 - f1) * Math.exp(-t / tSw)) / sr; o[i] = Math.sin(ph) * Math.exp(-t / tDec) * (att ? 1 - Math.exp(-t / att) : 1); }
  return o;
}
// a bubble: a sine whose pitch rises while it dies (a drop closing a pocket of air under water)
function plink(sr, f0, ratio, dur, tau) {
  const n = Math.round(sr * dur), o = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const p = i / n, t = i / sr; ph += TAU * f0 * (1 + (ratio - 1) * p) / sr; o[i] = Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t / 0.0007) * (1 - p * p * p); }
  return o;
}
// bank of decaying partials [[Hz, decay s, amp], ...]: struck metal, wood, porcelain, bells. Each partial is a rotating,
// shrinking phasor (4 multiplies a sample, no sin calls). rng = random start phases; null = all start at zero (clean bells)
function modal(sr, dur, parts, rng, att = 0.0004) {
  const n = Math.round(sr * dur), o = new Float32Array(n);
  for (const [f, d, a] of parts) {
    if (f >= sr * 0.47 || f <= 0) continue;
    const w = TAU * f / sr, r = Math.exp(-1 / (d * sr)), cr = Math.cos(w) * r, si = Math.sin(w) * r, ph = rng ? rng() * TAU : 0;
    let re = Math.sin(ph) * a, im = Math.cos(ph) * a;
    for (let i = 0; i < n; i++) { o[i] += re; const t = re * cr + im * si; im = im * cr - re * si; re = t; }
  }
  const na = Math.min(n, Math.round(att * sr)); for (let i = 0; i < na; i++) { const u = i / na; o[i] *= u * u * (3 - 2 * u); }
  return o;
}
// sum of harmonics of a fixed pitch with given amplitudes (index 0 = fundamental), by the Chebyshev recurrence
function harm(sr, dur, f0, amps, phase = 0) {
  const n = Math.round(sr * dur), o = new Float32Array(n), K = amps.length, w = TAU * f0 / sr;
  for (let i = 0; i < n; i++) { const th = w * i + phase, c2 = 2 * Math.cos(th); let a = 0, b = Math.sin(th), acc = b * amps[0]; for (let k = 1; k < K; k++) { const s = c2 * b - a; acc += s * amps[k]; a = b; b = s; } o[i] = acc; }
  return o;
}
// Karplus-Strong plucked string: a burst of noise goes round a delay line one period long; a small low-pass in the loop
// makes the high partials die first, an all-pass tunes the fractional part of the period (so the notes are in tune).
// o: bright 0..1 (pick hardness), pos (pluck position along the string), t60 (seconds to die away), damp (loop low-pass)
function pluck(sr, dur, f, rng, o = {}) {
  const n = Math.round(sr * dur), out = new Float32Array(n), period = sr / f;
  const b = clamp(o.damp != null ? o.damp : 0.035 + 0.17 * (200 / f), 0.015, 0.5);
  let N = Math.floor(period - b - 1e-3), frac = period - N - b; if (frac < 0.12) { N -= 1; frac += 1; }
  if (N < 2) return out;
  const C = (1 - frac) / (1 + frac), rho = Math.pow(10, -3 / (f * (o.t60 || 2.5)));
  const e = noise(N, rng), a = clamp(o.bright != null ? o.bright : 0.6, 0.03, 1);
  for (let pass = 0; pass < 2; pass++) { let s = e[N - 1] * 0.5; for (let i = 0; i < N; i++) { s += a * (e[i] - s); e[i] = s; } }
  const d = Math.max(1, Math.round((o.pos || 0.17) * N)), c = e.slice(); for (let i = 0; i < N; i++) e[i] = c[i] - c[(i - d + N) % N];
  let m = 0; for (let i = 0; i < N; i++) m += e[i]; m /= N; for (let i = 0; i < N; i++) e[i] -= m; norm1(e);
  const dl = e; let idx = 0, prev = 0, apx = 0, apy = 0;
  for (let i = 0; i < n; i++) {
    const y = dl[idx]; out[i] = y;
    const lp = (1 - b) * y + b * prev; prev = y;
    const ap = C * lp + apx - C * apy; apx = lp; apy = ap;
    dl[idx] = ap * rho; if (++idx >= N) idx = 0;
  }
  return out;
}
// read a buffer at a changing speed (pitch bends, vibrato): rateFn(t) = playback rate at time t
function warp(x, sr, rateFn) {
  const n = x.length, o = new Float32Array(n); let pos = 0;
  for (let i = 0; i < n; i++) { const j = pos | 0; if (j + 1 >= n) break; o[i] = x[j] + (x[j + 1] - x[j]) * (pos - j); pos += rateFn(i / sr); }
  return o;
}
// mixing: at a time, clipped at the end; or wrapping round the end (for loops); stereo with an equal-power pan p in -1..1
function mix(dst, src, t, g, sr) { const o = Math.round(t * sr), n = Math.min(src.length, dst.length - o); for (let i = o < 0 ? -o : 0; i < n; i++) dst[o + i] += src[i] * g; return dst; }
function mixWrap(dst, src, t, g, sr) { const N = dst.length; let o = ((Math.round(t * sr) % N) + N) % N; for (let i = 0, n = src.length; i < n; i++) { dst[o] += src[i] * g; if (++o >= N) o = 0; } return dst; }
function mixSt(L, R, src, t, g, p, sr, wrap) { const a = (clamp(p, -1, 1) + 1) * PI / 4, f = wrap ? mixWrap : mix; f(L, src, t, g * Math.cos(a), sr); f(R, src, t, g * Math.sin(a), sr); }
// loop cross-fader for noise beds: render the loop plus an overhang, fold the overhang onto the start with an
// equal-power cross-fade, so the last sample runs straight into the first
function xfadeLoop(x, N) { const ov = x.length - N, o = x.slice(0, N); for (let i = 0; i < ov; i++) { const a = i / ov * PI / 2; o[i] = x[i] * Math.sin(a) + x[N + i] * Math.cos(a); } return o; }
// loop closer for rung or decaying material: whatever rings past the end is added back at the start
function wrapTail(x, N) { const o = x.slice(0, N); for (let i = N; i < x.length; i++) o[(i - N) % N] += x[i]; return o; }
// grain scatterer: `count` grains picked from a bank, thrown at random times between t0 and t1 with skewed loudness
// (many quiet, few loud); stereo if R is given; wrap for loops
function scatter(L, R, sr, rng, bank, count, t0, t1, g0, g1, o = {}) {
  const pw = o.pow || 3, wrap = !!o.wrap, early = o.early || 1;
  for (let i = 0; i < count; i++) {
    const t = t0 + (t1 - t0) * Math.pow(rng(), early), g = g0 + (g1 - g0) * Math.pow(rng(), pw), s = bank[Math.floor(rng() * bank.length)];
    if (R) mixSt(L, R, s, t, g, o.pan != null ? o.pan : rng.bi() * (o.width != null ? o.width : 1), sr, wrap); else (wrap ? mixWrap : mix)(L, s, t, g, sr);
  }
}
// slow random curve (one value per control step), roughly -1..1
function smoothNoise(n, rng, a) { const o = new Float32Array(n); let s = 0, m = 1e-9; for (let i = 0; i < n; i++) { s += a * (rng.bi() - s); o[i] = s; } for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(o[i])); for (let i = 0; i < n; i++) o[i] /= m; return o; }
// piecewise-linear lookup through [[x, a, b, ...], ...] keyframes -> array of the interpolated columns
function keys(K, x) {
  if (x <= K[0][0]) return K[0]; const last = K[K.length - 1]; if (x >= last[0]) return last;
  let i = 1; while (K[i][0] < x) i++; const A = K[i - 1], B = K[i], u = (x - A[0]) / (B[0] - A[0]), o = [x];
  for (let j = 1; j < A.length; j++) o.push(A[j] + (B[j] - A[j]) * u);
  return o;
}

// ---- the voice: a buzzing source through a moving mouth --------------------------------------------------------------
// The mouth as four resonances, each [centre Hz, width Hz, strength]. open 0..1 = jaw (closed "m" .. wide "a"),
// front 0..1 = where the tongue is ("u" .. "i"). Numbers are for a cat-sized throat (about half a human's, so everything
// sits about twice as high); a closed mouth lets little through above the first resonance.
function mouth(open, front) {
  return [360 + 1020 * open, 200 + 180 * open, 1,
    lerp(lerp(1050, 3300, front), lerp(1900, 2700, front), open), 420, 0.1 + 0.62 * open,
    3700 + 1000 * front - 200 * open, 600, 0.04 + 0.31 * open,
    5800, 900, 0.12 * open];
}
// Voiced sound computed harmonic by harmonic: the pitch is integrated, and every harmonic k gets the loudness the throat
// gives to the frequency k*f0 at that moment (source roll-off times the sum of the resonance curves), so the formants sit
// exactly where the control function puts them and nothing aliases. Controls are read every 32 samples and smoothed.
// ctl(p) -> { f0, amp, open, front, [F: resonances as above], [tilt], [sub], [jit] }
function vox(sr, dur, rng, ctl, o = {}) {
  const n = Math.round(sr * dur), out = new Float32Array(n), CR = 32, nc = Math.ceil(n / CR) + 2, K = o.K || 18, floor = o.floor != null ? o.floor : 0.15;
  const jit = smoothNoise(nc, rng, 0.3), drift = smoothNoise(nc, rng, 0.03), shim = smoothNoise(nc, rng, 0.25);
  const sm = 1 - Math.exp(-CR / sr / (o.smooth || 0.012));   // control smoothing
  let cur = null, A = new Float64Array(K + 1), B = new Float64Array(K + 1);
  const frame = (p, c, A) => {
    const k = ctl(p), F = k.F || mouth(k.open, k.front), nf = F.length;
    if (!cur) cur = { f0: k.f0, amp: k.amp, F: F.slice(), tilt: 1.5, sub: 0, lip: 0 };
    const lip = k.F ? 1 : 0.3 + 0.7 * Math.pow(k.open, 0.7), tilt = k.tilt != null ? k.tilt : 0.7 + 1.3 * (1 - k.open) * (1 - k.open);
    cur.f0 += sm * (k.f0 - cur.f0); cur.amp += sm * (k.amp - cur.amp); cur.tilt += sm * (tilt - cur.tilt); cur.sub += sm * ((k.sub || 0) - cur.sub); cur.lip += sm * (lip - cur.lip);
    for (let i = 0; i < nf; i++) cur.F[i] += sm * (F[i] - cur.F[i]);
    const f0 = cur.f0 * (1 + jit[c] * (k.jit != null ? k.jit : 0.011) + drift[c] * 0.012), g = cur.amp * cur.lip * (1 + shim[c] * 0.07);
    for (let h = 1; h <= K; h++) {
      const f = h * f0; if (f > sr * 0.45) { A[h] = 0; continue; }
      let e = floor;
      for (let i = 0; i < nf; i += 3) { const d = (f * f - cur.F[i] * cur.F[i]) / (cur.F[i + 1] * f); e += cur.F[i + 2] / Math.sqrt(1 + d * d); }
      A[h] = g * e * Math.pow(h, -cur.tilt);
    }
    return { f0, sub: cur.sub };
  };
  let prev = frame(0, 0, A), th = 0;
  for (let c = 0; c * CR < n; c++) {
    const next = frame(Math.min(1, (c + 1) * CR / n), c + 1, B), i0 = c * CR, i1 = Math.min(n, i0 + CR);
    for (let i = i0; i < i1; i++) {
      const u = (i - i0) / CR; th += TAU * (prev.f0 + (next.f0 - prev.f0) * u) / sr; if (th > 4 * PI) th -= 4 * PI;
      const s1 = Math.sin(th), c2 = 2 * Math.cos(th); let a = 0, b = s1, acc = s1 * (A[1] + (B[1] - A[1]) * u);
      for (let h = 2; h <= K; h++) { const s = c2 * b - a; acc += s * (A[h] + (B[h] - A[h]) * u); a = b; b = s; }
      const sub = prev.sub + (next.sub - prev.sub) * u;
      out[i] = sub ? acc * (1 + sub * Math.cos(th * 0.5)) : acc;
    }
    prev = next; const t = A; A = B; B = t;
  }
  return out;
}

// ---- analysis (used by debug(), the showcase and the node checks) ----------------------------------------------------
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TAU / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < h; k++) { const a = i + k, b = a + h, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
// magnitude spectrum of `size` samples starting at `start` (Hann window); returns size/2 bins
export function spectrum(x, start, size, outMag) {
  const re = new Float64Array(size), im = new Float64Array(size), mag = outMag || new Float32Array(size >> 1);
  for (let i = 0; i < size; i++) { const j = start + i; re[i] = (j >= 0 && j < x.length ? x[j] : 0) * (0.5 - 0.5 * Math.cos(TAU * i / (size - 1))); }
  fft(re, im); for (let i = 0; i < size >> 1; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * 2 / size;
  return mag;
}
// numbers for one rendered sound
export function analyse(ch, sr, loop) {
  let peak = 0, sum = 0, dc = 0, nan = 0, n = 0;
  for (const x of ch) { for (let i = 0; i < x.length; i++) { const v = x[i]; if (v !== v || v === Infinity || v === -Infinity) { nan++; continue; } const a = v < 0 ? -v : v; if (a > peak) peak = a; sum += v * v; dc += v; } n += x.length; }
  const r = { dur: +(ch[0].length / sr).toFixed(3), ch: ch.length, sr, peak: +peak.toFixed(4), rms: +Math.sqrt(sum / Math.max(1, n)).toFixed(4), dc: +(dc / Math.max(1, n)).toFixed(5), nan };
  if (loop) {   // seam: the jump from the last sample to the first, in units of the typical sample-to-sample step; edge: level of first vs last 5 ms
    let jump = 0, ds = 0, a = 0, b = 0; const m = Math.min(ch[0].length >> 1, Math.round(sr * 0.005));
    for (const x of ch) { const N = x.length; jump = Math.max(jump, Math.abs(x[0] - x[N - 1])); for (let i = 1; i < N; i++) { const d = x[i] - x[i - 1]; ds += d * d; } for (let i = 0; i < m; i++) { a += x[i] * x[i]; b += x[N - 1 - i] * x[N - 1 - i]; } }
    r.seam = +(jump / (Math.sqrt(ds / Math.max(1, n)) + 1e-9)).toFixed(2); r.edgeDb = +(10 * Math.log10((a + 1e-12) / (b + 1e-12))).toFixed(1);
  }
  return r;
}

// =====================================================================================================================
// PART 2 — recipes. Each one layers toolbox pieces into a buffer (mono) or [left, right]. Heavy ones are generators that
// `yield` between layers so the engine can render them in small time slices without stalling a frame.
// =====================================================================================================================

// ---- rain ----------------------------------------------------------------------------------------------------------
// a bank of single drops: very short noise ticks of different length and colour
function dropBank(sr, rng, n, f0, f1, d0 = 0.0006, d1 = 0.0035) {
  const bank = []; for (let i = 0; i < n; i++) { const d = rng.range(d0, d1); bank.push(burst(sr, rng, d * 3 + 0.003, d, { bp: rng.range(f0, f1), q: rng.range(0.6, 1.5), att: 0.00015 })); }
  return bank;
}
function plinkBank(sr, rng, n, f0, f1) { const bank = []; for (let i = 0; i < n; i++) bank.push(plink(sr, rng.range(f0, f1), rng.range(1.25, 1.85), rng.range(0.012, 0.036), rng.range(0.005, 0.013))); return bank; }
// one drip landing in a film of water: a tiny tick, the bubble, a breath of splash
function drip1(sr, rng, k = 1) {
  const o = buf(sr, 0.16);
  mix(o, burst(sr, rng, 0.004, 0.0008, { hp: 2800, att: 0.0001 }), 0, 0.35, sr);
  mix(o, plink(sr, rng.range(850, 1500) * k, rng.range(1.4, 1.9), rng.range(0.03, 0.05), rng.range(0.011, 0.018)), 0.0015, 1, sr);
  if (rng() < 0.6) mix(o, plink(sr, rng.range(1600, 2600) * k, 1.3, 0.016, 0.006), rng.range(0.03, 0.06), 0.3, sr);
  mix(o, burst(sr, rng, 0.05, 0.012, { bp: 2400, q: 0.7, att: 0.002 }), 0.002, 0.12, sr);
  return o;
}
// rain in the open street: hiss (far drops merge into it) + a low wash + hundreds of single drops + puddle plinks, stereo
function rot(x, k) { const N = x.length, o = new Float32Array(N); k = ((k % N) + N) % N; o.set(x.subarray(k), 0); o.set(x.subarray(0, k), N - k); return o; }
function* rain_open(sr, rng) {
  const N = Math.round(sr * 6), ov = sr >> 1;
  const w = noise(N + ov, rng), h = w.slice();
  biquad(h, 'lp', 5200, 0.5, sr); biquad(h, 'hp', 1300, 0.6, sr);   // a broad hump, far from white
  yield;
  biquad(w, 'bp', 440, 0.5, sr);                                    // the street's low wash
  const gh = 0.62 / rmsOf(h), gw = 0.78 / rmsOf(w);
  for (let i = 0; i < w.length; i++) w[i] = h[i] * gh + w[i] * gw;
  // the bed is a closed loop, so the same loop started somewhere else is a second, unrelated-sounding channel
  const L = toRms(xfadeLoop(w, N), 0.075), R = rot(L, Math.round(N * 0.463)); yield;
  const p1 = rng() * TAU, p2 = rng() * TAU;
  for (let i = 0; i < N; i++) { const t = i / N; L[i] *= 1 + 0.12 * Math.sin(TAU * t + p1) + 0.07 * Math.sin(TAU * 3 * t + p2); R[i] *= 1 + 0.12 * Math.sin(TAU * t + p1 + 0.7) + 0.07 * Math.sin(TAU * 3 * t + p2 + 1.3); }
  yield;
  // single drops: ticks on stone (bright, tiny), duller taps, and near ones with a little body; a cat's ears are a
  // hand above the ground, so the nearest drops are loud and separate
  const bank = dropBank(sr, rng, 26, 2000, 6800), taps = dropBank(sr, rng, 12, 900, 2000, 0.002, 0.006), splat = [], pl = plinkBank(sr, rng, 14, 650, 2300);
  for (let i = 0; i < 8; i++) { const g = burst(sr, rng, 0.03, rng.range(0.003, 0.007), { bp: rng.range(800, 1900), q: 0.8, att: 0.0004 }); mix(g, bank[i], 0, 0.7, sr); splat.push(norm1(g)); }
  scatter(L, null, sr, rng, bank, 430, 0, 6, 0.04, 0.55, { wrap: true }); scatter(R, null, sr, rng, bank, 430, 0, 6, 0.04, 0.55, { wrap: true });
  scatter(L, R, sr, rng, bank, 220, 0, 6, 0.05, 0.6, { wrap: true, width: 0.6 });
  scatter(L, R, sr, rng, taps, 260, 0, 6, 0.04, 0.45, { wrap: true });
  yield;
  scatter(L, R, sr, rng, splat, 54, 0, 6, 0.12, 0.62, { wrap: true, pow: 2 });       // near, heavy drops on stone
  scatter(L, R, sr, rng, pl, 44, 0, 6, 0.08, 0.42, { wrap: true, pow: 2 });           // plinks in the puddles
  return [L, R];
}
// the same rain heard from under the arcade: the roof takes the top off, the street outside is a duller wash, and close by
// the eave drips in two loose rhythms
function* rain_arcade(sr, rng) {
  const N = Math.round(sr * 6), ov = sr >> 1;
  const w = noise(N + ov, rng), h = w.slice();
  biquad(h, 'lp', 4200, 0.5, sr); biquad(h, 'hp', 1800, 0.6, sr);   // what comes in through the arches
  yield;
  biquad(w, 'lp', 1500, 0.5, sr); biquad(w, 'hp', 170, 0.6, sr);    // rain drumming on the floors above, through the slab
  const gh = 0.2 / rmsOf(h), gw = 1 / rmsOf(w);
  for (let i = 0; i < w.length; i++) w[i] = h[i] * gh + w[i] * gw;
  const L = toRms(xfadeLoop(w, N), 0.085), R = rot(L, Math.round(N * 0.537)); yield;
  const p1 = rng() * TAU;
  for (let i = 0; i < N; i++) { const t = i / N; L[i] *= 1 + 0.1 * Math.sin(TAU * t + p1); R[i] *= 1 + 0.1 * Math.sin(TAU * t + p1 + 0.9); }
  const far = dropBank(sr, rng, 16, 1300, 3200, 0.001, 0.004);
  scatter(L, R, sr, rng, far, 420, 0, 6, 0.02, 0.32, { wrap: true });
  yield;
  // two eave drip lines, one each side, quasi regular
  for (const [count, pan, g] of [[15, -0.62, 0.68], [11, 0.55, 0.56], [7, 0.15, 0.4]]) {
    for (let k = 0; k < count; k++) mixSt(L, R, drip1(sr, rng, rng.range(0.85, 1.2)), (k + 0.5 + rng.bi() * 0.22) * 6 / count, g * rng.range(0.55, 1), pan + rng.bi() * 0.18, sr, true);
  }
  return [L, R];
}
// rain on a cloth awning: every drop is a soft low thup on a stretched membrane
function* rain_awning(sr, rng) {
  const N = Math.round(sr * 4), ov = sr >> 2, e = new Float32Array(N + ov), o = new Float32Array(N + ov);
  for (let i = 0; i < 300; i++) { const j = Math.floor(rng() * N), a = Math.pow(rng(), 1.6) * 0.7 + 0.15; e[j] += a; e[Math.min(N - 1, j + 1)] += a * 0.6; }
  for (const [f, q, g] of [[205, 4, 1], [335, 5, 0.8], [520, 4, 0.5], [870, 3, 0.28], [1500, 2, 0.1]]) { const x = e.slice(); biquad(x, 'bp', f, q, sr); mix(o, x, 0, g, sr); }
  yield;
  const out = toRms(wrapTail(o, N), 0.1); for (let i = 0; i < N; i++) out[i] = Math.tanh(out[i] * 2.2) / 2.2;
  const bed = noise(N + ov, rng); biquad(bed, 'lp', 1100, 0.5, sr); biquad(bed, 'hp', 150, 0.6, sr);
  mix(out, toRms(xfadeLoop(bed, N), 0.045), 0, 1, sr);
  for (let k = 0; k < 5; k++) mixWrap(out, drip1(sr, rng, 0.9), (k + rng()) * 0.8, 0.12, sr);   // off the edge of the cloth
  return out;
}
// a roof gutter pouring onto stone: a rope of water, splatter, glugs and bubbles
function* gutter_pour(sr, rng) {
  const N = Math.round(sr * 4), ov = sr >> 2, w = noise(N + ov, rng), lo = w.slice(), hi = w.slice();
  biquad(w, 'bp', 1700, 0.45, sr); biquad(lo, 'lp', 520, 0.6, sr); biquad(lo, 'hp', 110, 0.7, sr); biquad(hi, 'hp', 4200, 0.6, sr); biquad(hi, 'lp', 9000, 0.6, sr);
  yield;
  const gm = 1 / rmsOf(w), gl = 0.7 / rmsOf(lo), gh = 0.22 / rmsOf(hi); let a = 1, ta = 1, b = 1, tb = 1;
  for (let i = 0; i < w.length; i++) {   // the stream breaks up: loudness re-rolled every few ms (splatter) and every few hundred ms (glug)
    if (i % 130 === 0) ta = 0.35 + 1.1 * rng(); if (i % 5200 === 0) tb = 0.55 + 0.8 * rng();
    a += 0.03 * (ta - a); b += 0.0009 * (tb - b); w[i] = (w[i] * gm * a + hi[i] * gh * a) * 0.8 + lo[i] * gl * b;
  }
  const out = toRms(xfadeLoop(w, N), 0.1); yield;
  scatter(out, null, sr, rng, plinkBank(sr, rng, 16, 480, 1700), 150, 0, 4, 0.05, 0.36, { wrap: true, pow: 2 });
  return out;
}
// wind along the street: a band of noise whose centre and loudness wander, a faint whistle through the arches
function* wind(sr, rng) {
  const N = Math.round(sr * 8), ov = sr >> 1, ch = [];
  for (let c = 0; c < 2; c++) {
    const w = noise(N + ov, rng), hi = w.slice(), p1 = rng() * TAU, p2 = rng() * TAU, T = (N + ov) / N;
    biquadVar(w, 'bp', p => 400 + 150 * Math.sin(TAU * p * T + p1) + 70 * Math.sin(TAU * 3 * p * T + p2), 1.1, sr, 64);
    biquadVar(hi, 'bp', p => 1250 + 220 * Math.sin(TAU * 2 * p * T + p2), 7, sr, 64);
    const g = 1 / rmsOf(w), gh = 0.1 / rmsOf(hi);
    for (let i = 0; i < w.length; i++) { const t = i / N; w[i] = (w[i] * g + hi[i] * gh * (0.5 + 0.5 * Math.sin(TAU * t + p1))) * (0.62 + 0.28 * Math.sin(TAU * t + p2) + 0.1 * Math.sin(TAU * 4 * t + p1)); }
    ch.push(xfadeLoop(w, N)); yield;
  }
  return ch;
}
// distant thunder: noise under a closing low-pass, loudness from a handful of overlapping "rolls", a sub rumble under it
function* thunder(sr, rng, v) {
  const dur = 7, n = Math.round(sr * dur), rolls = [], ch = [];
  for (let i = 0; i < (v ? 10 : 7); i++) rolls.push([rng.range(0.1, v ? 3.6 : 2.8), rng.range(0.12, 0.5), rng.range(0.4, 1)]);
  if (v) rolls.push([0.12, 0.09, 1.3]);
  const env = t => { let a = 0.18; for (const [c, w, g] of rolls) { const d = (t - c) / w; a += g * Math.exp(-d * d); } return a * Math.exp(-t / (v ? 2.1 : 1.7)) * (1 - Math.exp(-t / 0.12)); };
  for (let c = 0; c < 2; c++) {
    const x = noise(n, rng), sub = noise(n, rng);
    biquadVar(x, 'lp', p => 70 + (v ? 560 : 380) * Math.pow(1 - p, 2.2), 0.6, sr, 64); biquad(x, 'hp', 28, 0.7, sr);
    biquad(sub, 'bp', 52, 1.1, sr);
    const gx = 1 / rmsOf(x), gs = 0.9 / rmsOf(sub);
    yield; let e0 = 0, e1 = 0, s0 = 0, s1 = 0;
    for (let i = 0; i < n; i++) { const m = i & 63; if (m === 0) { const t = (i + 64) / sr; e0 = e1; e1 = env(t); s0 = s1; s1 = Math.exp(-t / 2.4) * (1 - Math.exp(-t / 0.3)) * 0.6; } const u = m / 64; x[i] = x[i] * gx * (e0 + (e1 - e0) * u) + sub[i] * gs * (s0 + (s1 - s0) * u); }
    ch.push(x); yield;
  }
  return ch;
}

// ---- the street's small machines -------------------------------------------------------------------------------------
// neon tube and its transformer: mains buzz at 100 Hz with its harmonics, a hiss that pulses with the mains, and the odd
// flicker. Every component repeats exactly in the 2 s loop.
function* neon_buzz(sr, rng) {
  const N = Math.round(sr * 2), amps = [];
  for (let k = 1; k <= 70; k++) { const f = 50 * k; amps.push(f > 5000 ? 0 : (k === 1 ? 0.25 : k % 2 === 0 ? 1 : 0.42) / Math.pow(k / 2, 1.05) * (1 + 0.8 * Math.exp(-Math.pow((f - 1900) / 600, 2)))); }
  const o = harm(sr, 2, 50, amps, rng() * TAU); yield;
  const h = noise(N + (sr >> 2), rng); biquad(h, 'bp', 4300, 1.4, sr); const hl = toRms(xfadeLoop(h, N), 0.2 * rmsOf(o));
  for (let i = 0; i < N; i++) { const s = Math.sin(TAU * 50 * i / sr); o[i] += hl[i] * (0.25 + 1.5 * s * s * s * s); }
  const fl = new Float32Array(N).fill(1);
  for (let k = 0; k < 7; k++) { const c = rng() * N, w = rng.range(0.012, 0.05) * sr, d = rng.range(0.25, 0.7); for (let i = Math.floor(c - 3 * w); i < c + 3 * w; i++) { const j = ((i % N) + N) % N, u = (i - c) / w; fl[j] *= 1 - d * Math.exp(-u * u); } }
  for (let i = 0; i < N; i++) o[i] *= fl[i];
  return o;
}
// the congee pot: thick slow bubbles breaking, the lid ticking, steam hissing from under it
function* congee_pot(sr, rng) {
  const N = Math.round(sr * 4), o = new Float32Array(N);
  for (let i = 0; i < 50; i++) {
    const f = rng.range(130, 430), d = rng.range(0.04, 0.09), b = plink(sr, f, rng.range(1.5, 2.3), d, d * 0.42), t = rng() * 4, g = 0.25 + 0.75 * Math.pow(rng(), 1.5);
    mixWrap(o, b, t, g, sr); mixWrap(o, burst(sr, rng, 0.03, 0.007, { bp: rng.range(500, 900), q: 1, att: 0.002 }), t + d * 0.7, g * 0.22, sr);
  }
  yield;
  const lo = noise(N + (sr >> 2), rng); biquad(lo, 'bp', 170, 0.9, sr); mix(o, toRms(xfadeLoop(lo, N), 0.3 * rmsOf(o)), 0, 1, sr);
  const st = noise(N + (sr >> 2), rng); biquad(st, 'hp', 3600, 0.6, sr); biquad(st, 'lp', 8500, 0.6, sr);
  const sl = toRms(xfadeLoop(st, N), 0.34 * rmsOf(o)), p = rng() * TAU;
  for (let i = 0; i < N; i++) { const t = i / N; o[i] += sl[i] * (0.75 + 0.2 * Math.sin(TAU * 2 * t + p) + 0.12 * Math.sin(TAU * 5 * t)); }
  yield;
  for (let k = 0; k < 6; k++) mixWrap(o, modal(sr, 0.08, [[2900, 0.012, 1], [4700, 0.008, 0.6], [6900, 0.005, 0.3]], rng), rng() * 4, rng.range(0.03, 0.09) * 4 * rmsOf(o), sr);
  return o;
}
// a shop clock behind glass: tick ... tock, one second apart, with the wooden case answering
function clock_tick(sr, rng) {
  const o = buf(sr, 2);
  const hit = (t, k, g) => {
    mixWrap(o, burst(sr, rng, 0.004, 0.0006, { hp: 3000 * k }), t, 0.5 * g, sr);
    mixWrap(o, modal(sr, 0.09, [[2350 * k, 0.009, 1], [3900 * k, 0.006, 0.6], [5600 * k, 0.004, 0.35], [410 * k, 0.03, 0.3], [830 * k, 0.018, 0.18]], rng), t, g, sr);
  };
  hit(0.04, 1, 1); hit(1.04, 0.84, 0.85); hit(0.985, 1.3, 0.12); hit(1.985, 1.3, 0.12);
  return o;
}
// the tune on a radio behind a shutter: a thin bowed lead and a plucked off-beat, squeezed into a telephone band
const RADIO = { bpm: 120, lead: [[0, 79, 1], [1, 81, .5], [1.5, 83, .5], [2, 86, 1], [3, 83, .5], [3.5, 81, .5], [4, 79, 1.5], [5.5, 76, .5], [6, 74, 2],
  [8, 76, 1], [9, 79, .5], [9.5, 81, .5], [10, 83, 1], [11, 81, .5], [11.5, 79, .5], [12, 81, 3],
  [16, 83, 1], [17, 86, .5], [17.5, 83, .5], [18, 81, 1], [19, 79, .5], [19.5, 76, .5], [20, 79, 1.5], [21.5, 81, .5], [22, 76, 2],
  [24, 74, 1], [25, 76, .5], [25.5, 79, .5], [26, 81, 1], [27, 83, .5], [27.5, 81, .5], [28, 79, 3]], bass: [55, 52, 55, 57, 55, 52, 50, 55] };
function* radio_far(sr, rng) {
  const beat = 60 / RADIO.bpm, dur = 32 * beat, N = Math.round(sr * dur), notes = RADIO.lead;
  const FID = [1150, 400, 1, 2500, 600, 0.5, 3600, 800, 0.2];   // the little fiddle's body
  const ctl = t => {
    const bt = t / beat; let cur = null, prevN = null;
    for (const nt of notes) { if (bt >= nt[0]) { prevN = cur; cur = nt; } else break; }
    if (!cur) return { f0: mtof(notes[0][1]), amp: 0, F: FID, tilt: 1 };
    const lt = (bt - cur[0]) * beat, len = cur[2] * beat, gl = prevN ? Math.exp(-lt / 0.03) : 0;
    const f = mtof(cur[1]) * Math.pow(mtof(prevN ? prevN[1] : cur[1]) / mtof(cur[1]), gl) * (1 + 0.007 * Math.sin(TAU * 5.6 * t) * sstep(0.12, 0.3, lt));
    const amp = lt > len ? 0 : Math.min(1, lt / 0.04) * (0.75 + 0.25 * Math.exp(-lt / 0.3)) * Math.min(1, (len - lt) / 0.05);
    return { f0: f, amp, F: FID, tilt: 1, jit: 0.004 };
  };
  const lead = new Float32Array(N);
  for (let q = 0; q < 8; q++) { mix(lead, vox(sr, dur / 8, rng, p => ctl((q + p * 0.99999) * dur / 8), { K: 6, smooth: 0.006 }), q * dur / 8, 1, sr); yield; }   // every 4 beats starts on a new note, so the pieces join at silence
  norm1(lead);
  const o = new Float32Array(N); mixWrap(o, lead, 0.2, 0.8, sr);
  for (let b = 0; b < 32; b++) {   // plucked accompaniment: root on the beat, fifth and octave on the off-beat
    const root = RADIO.bass[b >> 2];
    if (b % 2 === 0) mixWrap(o, pluck(sr, 0.7, mtof(root), rng, { bright: 0.5, t60: 0.9 }), b * beat + 0.2, 0.32, sr);
    mixWrap(o, pluck(sr, 0.4, mtof(root + (b % 2 ? 19 : 12)), rng, { bright: 0.6, t60: 0.5 }), (b + 0.5) * beat + 0.2, 0.2, sr);
  }
  yield;
  biquad(o, 'hp', 480, 0.8, sr); biquad(o, 'hp', 380, 0.7, sr); biquad(o, 'lp', 2300, 0.8, sr); biquad(o, 'lp', 2700, 0.7, sr); biquad(o, 'peak', 1300, 1.2, sr, 5);
  sat(norm1(o), 1.6);
  const hs = noise(N + sr, rng); biquad(hs, 'bp', 1700, 0.6, sr); const hl = toRms(xfadeLoop(hs, N), 0.035);
  for (let i = 0; i < N; i++) o[i] = o[i] * (0.9 + 0.1 * Math.sin(TAU * 3 * i / N)) + hl[i];
  return o;
}
// a bicycle bell far down the street: a thumb-struck dome, heard through distance (dulled, with a slap-back)
function bike_bell(sr, rng, v) {
  const o = buf(sr, 1.9), dry = buf(sr, 1.9);
  const strike = (t, g) => { mix(dry, modal(sr, 0.9, [[2085, 0.42, 1], [2104, 0.38, 0.55], [3330, 0.27, 0.55], [4960, 0.17, 0.3], [6850, 0.1, 0.16]], null, 0.0006), t, g, sr); mix(dry, burst(sr, rng, 0.004, 0.0008, { hp: 3000 }), t, g * 0.25, sr); };
  for (const t0 of v ? [0, 0.52] : [0]) for (let k = 0; k < 7; k++) strike(t0 + k * 0.071 + rng.bi() * 0.004, (0.55 + 0.45 * Math.sin(PI * (k + 0.5) / 7)) * (t0 ? 0.85 : 1));
  biquad(dry, 'lp', 4200, 0.6, sr); mix(o, dry, 0, 1, sr);
  const e = dry.slice(); biquad(e, 'lp', 2400, 0.6, sr); mix(o, e, 0.115, 0.3, sr); mix(o, e, 0.21, 0.16, sr); mix(o, e, 0.37, 0.07, sr);
  return o;
}
function drip(sr, rng, v) { return drip1(sr, rng, [1, 1.18, 0.86][v]); }

// ---- the cat ---------------------------------------------------------------------------------------------------------
const STEP_K = [1, 1.09, 0.93];
// the pad of a paw meeting the ground: a soft, short, low-mid puff with no hard edge (never a boot)
function pawPat(sr, rng, k, lp = 1250, body = 0.35) {
  const x = burst(sr, rng, 0.075, 0.010 / k, { lp: lp * k, hp: 130, att: 0.002 });
  mix(x, sweep(sr, 0.05, 150 * k, 88 * k, 0.012, 0.013, 0.002), 0, body, sr);
  return x;
}
const clawTick = (sr, rng, k) => burst(sr, rng, 0.006, 0.0007, { hp: 3600 * k, att: 0.00015 });
function stepBase(sr, rng, v, dur, lp, tick) {
  const k = STEP_K[v], o = buf(sr, dur), t2 = 0.013 + 0.004 * v;
  mix(o, pawPat(sr, rng, k, lp), 0.002, 1, sr); mix(o, pawPat(sr, rng, k * 1.15, lp * 1.1, 0.15), 0.002 + t2, 0.38, sr);   // the big pad, then the toes
  if (tick) { mix(o, clawTick(sr, rng, k), 0.003, tick, sr); mix(o, clawTick(sr, rng, k * 1.2), 0.004 + t2, tick * 0.6, sr); }
  return o;
}
function step_stone(sr, rng, v) { const o = stepBase(sr, rng, v, 0.13, 1250, 0.07); mix(o, burst(sr, rng, 0.03, 0.006, { bp: 4800, q: 0.8, att: 0.002 }), 0.004, 0.035, sr); return o; }
function step_tile(sr, rng, v) { const k = STEP_K[v], o = stepBase(sr, rng, v, 0.13, 1700, 0.13); mix(o, modal(sr, 0.05, [[2900 * k, 0.009, 1], [4750 * k, 0.006, 0.6]], rng), 0.003, 0.06, sr); return o; }
function step_wood(sr, rng, v) { const k = STEP_K[v], o = stepBase(sr, rng, v, 0.18, 1100, 0.04); mix(o, modal(sr, 0.16, [[292 * k, 0.034, 1], [612 * k, 0.022, 0.55], [1024 * k, 0.013, 0.28], [1710 * k, 0.008, 0.1]], rng, 0.0015), 0.003, 0.5, sr); return o; }
function step_metal(sr, rng, v) { const k = STEP_K[v], o = stepBase(sr, rng, v, 0.3, 1400, 0.1); scale(o, 0.8); mix(o, modal(sr, 0.29, [[482 * k, 0.07, 1], [1133 * k, 0.05, 0.7], [2090 * k, 0.034, 0.45], [3370 * k, 0.02, 0.25], [5100 * k, 0.012, 0.1]], rng, 0.001), 0.003, 0.3, sr); return o; }
function step_wet(sr, rng, v) {
  const k = STEP_K[v], o = stepBase(sr, rng, v, 0.17, 1150, 0); scale(o, 0.8);
  const s = noise(Math.round(sr * 0.07), rng); biquadVar(s, 'bp', p => (2700 - 1700 * p) * k, 1.1, sr, 16); shape(s, sr, t => Math.exp(-t / 0.014) * (1 - Math.exp(-t / 0.003)));
  mix(o, norm1(s), 0.004, 0.45, sr); mix(o, burst(sr, rng, 0.03, 0.006, { hp: 4500, att: 0.001 }), 0.005, 0.1, sr);
  mix(o, plink(sr, rng.range(1300, 2100) * k, 1.5, 0.012, 0.005), 0.016 + rng() * 0.01, 0.2, sr); mix(o, plink(sr, rng.range(1900, 2900) * k, 1.4, 0.01, 0.004), 0.04 + rng() * 0.02, 0.13, sr);
  return o;
}
function step_cloth(sr, rng, v) {
  const k = STEP_K[v], o = buf(sr, 0.16);
  mix(o, burst(sr, rng, 0.1, 0.018, { lp: 620 * k, hp: 90, att: 0.004 }), 0.002, 1, sr); mix(o, sweep(sr, 0.09, 185 * k, 118 * k, 0.02, 0.024, 0.004), 0.002, 0.6, sr);
  mix(o, burst(sr, rng, 0.05, 0.012, { bp: 2500, q: 0.7, att: 0.004 }), 0.004, 0.05, sr);
  return o;
}
// the push-off: hind paws scuff, then a breath of fur moving through air
function jump(sr, rng) {
  const o = buf(sr, 0.3);
  mix(o, pawPat(sr, rng, 1.1), 0.002, 0.8, sr); mix(o, pawPat(sr, rng, 1.25), 0.014, 0.6, sr);
  mix(o, burst(sr, rng, 0.03, 0.007, { bp: 3000, q: 0.8, att: 0.001 }), 0.004, 0.2, sr); mix(o, clawTick(sr, rng, 1.1), 0.006, 0.12, sr); mix(o, clawTick(sr, rng, 0.9), 0.017, 0.09, sr);
  mix(o, burst(sr, rng, 0.26, 0.07, { bp: 820, q: 0.6, att: 0.04 }), 0.01, 0.2, sr);
  return o;
}
// landing: front paws, then hind paws, a small weight arriving. v0 soft, v1 from a height
function land(sr, rng, v) {
  const o = buf(sr, 0.3), k = v ? 0.88 : 1;
  mix(o, sweep(sr, 0.12, v ? 118 : 128, v ? 58 : 74, 0.02, v ? 0.034 : 0.022, 0.002), 0.002, v ? 0.85 : 0.45, sr);
  mix(o, pawPat(sr, rng, k), 0.002, 1, sr); mix(o, pawPat(sr, rng, k * 1.1), v ? 0.022 : 0.032, 0.8, sr);
  if (v) { mix(o, pawPat(sr, rng, k * 0.95), 0.05, 0.6, sr); mix(o, burst(sr, rng, 0.09, 0.02, { lp: 700, att: 0.004 }), 0.004, 0.4, sr); mix(o, clawTick(sr, rng, 1), 0.004, 0.16, sr); mix(o, clawTick(sr, rng, 1.2), 0.026, 0.12, sr); }
  else mix(o, clawTick(sr, rng, 1.1), 0.004, 0.07, sr);
  return o;
}
// shaking the rain off: the fur flaps from head to tail about eleven times a second and throws a spray of drops
function* shake(sr, rng) {
  const dur = 1.45, L = buf(sr, dur), R = buf(sr, dur); let t = 0.02, k = 0;
  while (t < 0.86) {
    const u = t / 0.86, a = Math.sin(PI * Math.pow(u, 0.7)) * 0.9 + 0.1, f = rng.range(700, 2100) * (1.2 - 0.4 * u);
    mixSt(L, R, burst(sr, rng, 0.07, rng.range(0.012, 0.018), { bp: f, q: 0.6, att: 0.006 }), t, a, (k % 2 ? 0.5 : -0.5) * (0.4 + 0.6 * u), sr);
    mixSt(L, R, burst(sr, rng, 0.05, 0.012, { lp: 480, att: 0.005 }), t, a * 0.5, 0, sr);   // the loose skin underneath
    t += 1 / (10 + 3.5 * Math.sin(PI * u)) * rng.range(0.93, 1.07); k++;
  }
  yield;
  const bank = dropBank(sr, rng, 14, 2800, 7500, 0.0005, 0.002);
  scatter(L, R, sr, rng, bank, 110, 0.06, 0.95, 0.03, 0.3, { pow: 2 });
  scatter(L, R, sr, rng, plinkBank(sr, rng, 8, 900, 2600), 16, 0.3, 1.3, 0.05, 0.22, { pow: 2 });
  scatter(L, R, sr, rng, bank, 40, 0.3, 1.35, 0.02, 0.12, { pow: 2 });
  return [L, R];
}
// The meows. Keyframes: [progress, pitch Hz, loudness, jaw open, tongue front]. A meow is a mouth opening and closing on a
// gliding note: closed "m", quickly through "i", wide "a" at the top of the pitch arc, closing through "o/u".
// 0 the plain miaow, 1 a short high mew, 2 "mrrow?" that starts as a rolled trill and ends rising, 3 a long complaining one
const MEOWS = [
  { dur: 0.76, breath: 0.05, k: [[0, 495, 0, 0, .5], [.05, 540, .55, .06, .7], [.14, 625, .9, .45, 1], [.3, 705, 1, 1, .5], [.5, 665, .95, .9, .32], [.7, 560, .7, .4, .08], [.86, 470, .38, .12, .05], [1, 420, 0, 0, .1]] },
  { dur: 0.42, breath: 0.07, k: [[0, 660, 0, 0, .8], [.08, 745, .65, .22, 1], [.28, 845, 1, .8, .8], [.55, 800, .9, .6, .6], [.8, 700, .45, .2, .4], [1, 640, 0, 0, .3]] },
  { dur: 0.82, breath: 0.05, trill: [0.02, 0.34, 27], k: [[0, 395, 0, 0, .4], [.06, 430, .65, .1, .5], [.3, 500, .75, .24, .6], [.48, 590, 1, .95, .5], [.7, 655, .95, .65, .25], [.88, 760, .55, .25, .1], [1, 790, 0, .05, .1]] },
  { dur: 1.22, breath: 0.06, sub: 0.2, k: [[0, 465, 0, 0, .6], [.04, 500, .55, .08, .8], [.12, 600, .9, .42, 1], [.28, 652, 1, .72, .9], [.45, 640, 1, 1, .5], [.62, 592, .92, .85, .3], [.8, 485, .65, .36, .08], [.92, 405, .32, .1, .05], [1, 372, 0, 0, .1]] },
];
function meowVoice(sr, rng, M) {
  const dur = M.dur, tr = M.trill;
  const ctl = p => {
    const k = keys(M.k, p);
    return { f0: k[1], amp: k[2], open: k[3], front: k[4], sub: (M.sub || 0) * sstep(0.3, 0.45, p) * (1 - sstep(0.6, 0.8, p)) };
  };
  const v = vox(sr, dur, rng, ctl), n = v.length;
  // the rolled "rr": the throat flutters about 27 times a second, deepest at the start of the roll
  if (tr) { const i0 = Math.floor(tr[0] * n), i1 = Math.floor(tr[1] * n); for (let i = i0; i < i1; i++) { const u = (i - i0) / (i1 - i0), c = 0.5 + 0.5 * Math.cos(TAU * tr[2] * (i - i0) / sr); v[i] *= 1 - (0.85 - 0.6 * u) * Math.min(1, u * 12) * c * Math.sqrt(c); } }
  const pk = peakOf(v) || 1;
  // breath: noise coloured by the same mouth, strongest as the note starts and as it lets go
  const br = noise(n, rng); biquadVar(br, 'bp', p => { const k = keys(M.k, p); return mouth(k[3], k[4])[3]; }, 1.3, sr, 32);
  const g = M.breath * pk / (rmsOf(br) * 3 + 1e-9); let e0 = 0, e1 = 0;
  for (let i = 0; i < n; i++) {
    if (i % 64 === 0) { e0 = e1; const k = keys(M.k, Math.min(1, (i + 64) / n)); e1 = g * (0.5 + 1.6 * Math.abs(k[2] - 0.5)) * Math.min(1, k[2] * 6); if (i === 0) e0 = 0; }
    v[i] += br[i] * (e0 + (e1 - e0) * ((i % 64) / 64));
  }
  biquad(v, 'hp', 220, 0.7, sr);
  return v;
}
function meow(sr, rng, v) { return meowVoice(sr, rng, MEOWS[v]); }
// a chirrup ("prrt?"): a closed-mouth rolled note that rises — the happy noise
function trill(sr, rng) {
  return meowVoice(sr, rng, { dur: 0.36, breath: 0.05, trill: [0.03, 0.8, 26], k: [[0, 380, 0, 0, .5], [.1, 410, .7, .1, .6], [.6, 520, .9, .28, .7], [.88, 600, .7, .45, .8], [1, 620, 0, .2, .8]] });
}
// purr: about 25 small pulses a second from the throat, louder and lower breathing out, lighter and a touch higher
// breathing in; two breaths in the 4 s loop
function* purr(sr, rng) {
  const N = Math.round(sr * 4), ov = sr >> 1, e = new Float32Array(N + ov), o = new Float32Array(N + ov), br = noise(N + ov, rng), env = new Float32Array(N + ov);
  for (let cyc = 0; cyc < 2; cyc++) {
    for (const [t0, len, rate, amp, hi] of [[0.03, 1.07, 23.5 + cyc, 1, 0], [1.2, 0.7, 26.5 - cyc * 0.7, 0.62, 1]]) {
      let t = 0;
      while (t < len) {
        const u = t / len, a = amp * Math.pow(Math.sin(PI * u), 0.55) * rng.range(0.8, 1.1), i0 = Math.round((cyc * 2 + t0 + t) * sr), w = Math.round(sr * 0.006);
        for (let i = 0; i < w; i++) { const s = Math.sin(PI * i / w); e[i0 + i] += a * s * s * (hi ? 0.8 : 1); env[i0 + i] += a * s * (hi ? 1.5 : 0.8); }
        t += 1 / rate * rng.range(0.95, 1.05);
      }
    }
  }
  for (const [f, q, g] of [[92, 2.5, 1], [185, 3.5, 0.8], [330, 3, 0.45], [620, 2.2, 0.22], [1150, 2, 0.08]]) { const x = e.slice(); biquad(x, 'bp', f, q, sr); mix(o, x, 0, g, sr); }
  yield;
  biquad(br, 'bp', 1300, 0.8, sr); const gb = 0.1 * peakOf(o) / (rmsOf(br) * 3);
  let sm = 0; for (let i = 0; i < o.length; i++) { sm += 0.02 * (env[i] - sm); o[i] += br[i] * gb * sm * 3; }
  return wrapTail(o, N);
}

// ---- pick-ups and interface --------------------------------------------------------------------------------------------
// a soft chime: a felt-struck bar with a slow beat between two close partials
function chimeNote(sr, f, dur, g = 1) { return modal(sr, dur, [[f, dur * 0.3, g], [f * 1.0035, dur * 0.27, g * 0.4], [f * 2, dur * 0.13, g * 0.2], [f * 3.01, dur * 0.07, g * 0.09], [f * 4.2, dur * 0.035, g * 0.045]], null, 0.004); }
// taking a fish: a little wet slap, then two or three warm notes going up the scale (higher for each fish)
function fish_take(sr, rng, v) {
  const o = buf(sr, 2.2), notes = [[71, 76], [74, 79], [76, 81, 86]][v];
  mix(o, burst(sr, rng, 0.06, 0.012, { bp: 640, q: 0.9, att: 0.002 }), 0, 0.42, sr); mix(o, burst(sr, rng, 0.03, 0.006, { hp: 2400, att: 0.0008 }), 0.002, 0.15, sr);
  mix(o, plink(sr, 1150, 1.6, 0.02, 0.008), 0.03, 0.16, sr); mix(o, plink(sr, 1900, 1.4, 0.014, 0.005), 0.062, 0.09, sr);
  notes.forEach((m, i) => mix(o, chimeNote(sr, mtof(m), 2.0, 1), 0.05 + i * 0.13, 0.5 + 0.12 * i, sr));
  mix(o, chimeNote(sr, mtof(notes[0] - 12), 2.0, 1), 0.05, 0.22, sr);
  biquad(o, 'lp', 5200, 0.6, sr);
  return o;
}
const hint_tick = (sr, rng) => { const o = modal(sr, 0.22, [[1568, 0.05, 1], [1574, 0.045, 0.4], [3140, 0.02, 0.28], [4720, 0.01, 0.1]], null, 0.0012); mix(o, burst(sr, rng, 0.003, 0.0006, { hp: 2500 }), 0, 0.08, sr); return o; };
const ui_click = (sr, rng) => { const o = modal(sr, 0.1, [[880, 0.02, 1], [1765, 0.012, 0.42], [2650, 0.008, 0.2]], null, 0.0006); mix(o, burst(sr, rng, 0.003, 0.0006, { hp: 2600 }), 0, 0.18, sr); return o; };
const ui_hover = sr => modal(sr, 0.07, [[2350, 0.016, 1], [3530, 0.009, 0.3]], null, 0.0012);

// ---- music -------------------------------------------------------------------------------------------------------------
// A night piece in E 羽 (the pentatonic set G A B D E with E as home): 80 BPM, 8 bars of 4, 24 s, four stems that loop
// together. The harmony moves every two bars: E 羽 -> A 商 -> G 宫 -> D 徵 and back. The ending sting settles on G 宫.
export const MUSIC = {
  bpm: 80, beats: 32,
  chords: [[40, 59, 62, 64, 67], [45, 57, 59, 64, 67], [43, 55, 59, 62, 64], [38, 57, 62, 64, 67]],   // bass first, then the pad voices (MIDI)
  // plucked melody: [beat, MIDI, length in beats, loudness, ornament]  g grace note from below, t slow tremolo, v vibrato, b bend up into the note
  pluck: [[0, 71, 1.5, .8, 'g'], [1.5, 74, .5, .55], [2, 76, 2, .85, 't'], [4, 74, .5, .6], [4.5, 71, .5, .55], [5, 69, 1, .65], [6, 71, 2, .75, 'v'],
    [8, 69, 1.5, .75, 'g'], [9.5, 71, .5, .5], [10, 74, 1, .65], [11, 76, 1, .7], [12, 79, 1.5, .9, 'b'], [13.5, 76, .5, .55], [14, 74, 1.25, .7, 'v'],
    [16, 71, 1, .7], [17, 74, 1, .7], [18, 76, 1.5, .85, 't'], [19.5, 74, .5, .5], [20, 71, 1, .65], [21, 69, .5, .55], [21.5, 67, .5, .5], [22, 69, 2, .7, 'v'],
    [24, 67, 1, .65, 'g'], [25, 69, 1, .6], [26, 64, 2, .8, 'v'], [28, 67, 1, .55], [29, 64, 1, .5], [30, 59, 2, .6, 'v']],
  low: [[0, 52, .5], [2, 59, .3], [8, 45, .5], [10, 52, .3], [16, 43, .5], [18, 50, .3], [24, 50, .5], [26, 45, .3], [30.5, 47, .25]],   // the left hand
  gliss: { at: 15.3, notes: [62, 64, 67, 69, 71, 74, 76, 79], step: 0.085 },                                                          // a sweep up the strings into bar 5
  wood: [[0, 0, .9], [1.5, 1, .42], [3, 0, .5], [4, 0, .85], [5.5, 1, .42], [6.5, 1, .3], [7.5, 0, .4]],                               // two-bar pattern: [beat, low/high, loudness]
  bell: [[0, 83, .7], [1.5, 88, .6], [3, 86, .42], [8, 81, .6], [9.5, 88, .5], [16, 86, .7], [17.5, 83, .6], [19, 79, .5], [24, 88, .55], [25.5, 86, .5], [27, 83, .5]],
  bowl: [[12, 67, .8], [28, 64, .7]],
};
const BEAT = 60 / MUSIC.bpm, LOOP = MUSIC.beats * BEAT;
const MT = b => (b + 0.25) * BEAT;   // beat -> seconds in the loop; the loop point sits a quarter beat before beat 1, where nothing starts
// one pad note: three soft partials a hair apart in the two ears, swelling in and out slowly
function padNote(sr, f, dur, att, rel, rng) {
  const n = Math.round(sr * dur), ch = [];
  for (let c = 0; c < 2; c++) {
    const o = new Float32Array(n), det = 1 + (c ? 1 : -1) * 0.0011 + rng.bi() * 0.0004;
    for (const [h, a] of [[1, 1], [2.001, 0.3], [3.002, 0.1], [0.5, 0.12]]) {
      const w = TAU * f * h * det / sr, cr = Math.cos(w), si = Math.sin(w), ph = rng() * TAU; let re = Math.sin(ph) * a, im = Math.cos(ph) * a;
      for (let i = 0; i < n; i++) { o[i] += re; const t = re * cr + im * si; im = im * cr - re * si; re = t; }
    }
    const lf = rng.range(0.11, 0.19), lp = rng() * TAU;
    const ev = t => sstep(0, att, t) * (1 - sstep(dur - rel, dur, t)) * (0.85 + 0.15 * Math.sin(TAU * lf * t + lp)); let e0 = 0, e1 = 0;
    for (let i = 0; i < n; i++) { const m = i & 127; if (m === 0) { e0 = e1; e1 = ev((i + 128) / sr); } o[i] *= e0 + (e1 - e0) * (m / 128); }
    ch.push(o);
  }
  return ch;
}
function* music_pad(sr, rng) {
  const N = Math.round(sr * LOOP), L = new Float32Array(N), R = new Float32Array(N);
  for (let c = 0; c < 4; c++) {
    const ch = MUSIC.chords[c], t0 = MT(c * 8);
    for (let i = 0; i < ch.length; i++) {
      const bass = i === 0, f = mtof(ch[i]), nt = padNote(sr, f, 6 + 3.4, bass ? 1.2 : 2.2, 3.2, rng), g = bass ? 0.4 : 0.36 * Math.pow(261 / f, 0.35);
      mixWrap(L, nt[0], t0 - 1.0, g, sr); mixWrap(R, nt[1], t0 - 1.0, g, sr); yield;
    }
  }
  // a breath of air on top so the pad is not a pure organ: noise through a band that follows nothing, very low
  for (const x of [L, R]) { const a = noise(N + sr, rng); biquad(a, 'bp', 900, 0.7, sr); mix(x, toRms(xfadeLoop(a, N), rmsOf(x) * 0.05), 0, 1, sr); }
  return [L, R];
}
// one plucked note of the zither voice, with its ornament
function zither(sr, rng, midi, len, vel, orn) {
  const f = mtof(midi), dur = Math.min(4.2, len + 2.4), t60 = clamp(4.6 * Math.pow(196 / f, 0.45), 1.4, 5);
  let x = pluck(sr, dur, f, rng, { bright: 0.28 + 0.5 * vel, pos: 0.14, t60 });
  if (orn === 'v') x = warp(x, sr, t => 1 + 0.0055 * Math.sin(TAU * 5.1 * t) * sstep(0.18, 0.5, t));
  if (orn === 'b') x = warp(x, sr, t => Math.pow(2, -2 / 12 * Math.exp(-t / 0.045)) * (1 + 0.004 * Math.sin(TAU * 5.3 * t) * sstep(0.3, 0.6, t)));
  if (orn === 't') { const n = Math.floor((len - 0.3) * 6.6); for (let k = 0; k < n; k++) { const u = k / Math.max(1, n - 1); mix(x, pluck(sr, 0.7, f, rng, { bright: 0.3 + 0.2 * Math.sin(PI * u), pos: 0.2, t60: 0.9 }), 0.3 + k / 6.6 + rng.bi() * 0.006, 0.22 + 0.3 * Math.sin(PI * u), sr); } }
  biquad(x, 'peak', 260, 1, sr, 3); biquad(x, 'hs', 5200, 0.7, sr, -4); biquad(x, 'hp', 90, 0.7, sr);
  return fade(x, sr, 0, 0.25);
}
function* music_pluck(sr, rng) {
  const N = Math.round(sr * LOOP), L = new Float32Array(N), R = new Float32Array(N), pan = m => clamp((m - 66) / 40, -0.5, 0.5);
  for (const [b, m, len, vel, orn] of MUSIC.pluck) {
    if (orn === 'g') mixSt(L, R, zither(sr, rng, m - (m % 12 === 7 || m % 12 === 2 ? 3 : 2), 0.2, vel * 0.5), MT(b) - 0.085, vel * 0.45, pan(m), sr, true);
    mixSt(L, R, zither(sr, rng, m, len * BEAT, vel, orn), MT(b), vel, pan(m), sr, true); yield;
  }
  for (const [b, m, vel] of MUSIC.low) { mixSt(L, R, zither(sr, rng, m, 1.5, vel), MT(b), vel * 0.8, pan(m), sr, true); yield; }
  MUSIC.gliss.notes.forEach((m, i, a) => mixSt(L, R, zither(sr, rng, m, 0.4, 0.3), MT(MUSIC.gliss.at) + i * MUSIC.gliss.step, 0.16 + 0.2 * i / a.length, pan(m), sr, true));
  return [L, R];
}
// the low wooden pulse: a hollow block struck with a soft stick
function woodHit(sr, rng, hi, vel) {
  const k = hi ? 1.5 : 1, o = buf(sr, 0.5);
  mix(o, modal(sr, 0.5, [[147 * k, 0.15, 1], [296 * k, 0.085, 0.5], [514 * k, 0.045, 0.3], [887 * k, 0.026, 0.14], [1420 * k, 0.014, 0.06]], null, 0.0015), 0, 1, sr);
  mix(o, sweep(sr, 0.08, 120 * k, 74 * k, 0.02, 0.03, 0.002), 0, 0.5, sr); mix(o, burst(sr, rng, 0.012, 0.003, { lp: 1600, att: 0.0005 }), 0, 0.18 * vel, sr);
  return o;
}
function* music_wood(sr, rng) {
  const N = Math.round(sr * LOOP), o = new Float32Array(N);
  for (let bar2 = 0; bar2 < 4; bar2++) { for (const [b, hi, vel] of MUSIC.wood) mixWrap(o, woodHit(sr, rng, hi, vel), MT(bar2 * 8 + b), vel, sr); yield; }
  return o;
}
// a small bell (clean partials, a slow beat) and a singing bowl (long, with the wobble of two close modes)
function bellNote(sr, f, vel) { return modal(sr, 3.2, [[f, 1.5, 1], [f * 1.0023, 1.4, 0.5], [f * 2.0, 0.8, 0.3], [f * 2.76, 0.55, 0.22 * vel], [f * 5.4, 0.2, 0.08 * vel], [f * 0.5, 1.2, 0.12]], null, 0.002); }
function bowlNote(sr, f) { return modal(sr, 7, [[f, 3.2, 1], [f * 1.006, 3.0, 0.8], [f * 2.71, 1.6, 0.35], [f * 2.722, 1.5, 0.25], [f * 5.15, 0.6, 0.1]], null, 0.03); }
function* music_bell(sr, rng) {
  const N = Math.round(sr * LOOP), L = new Float32Array(N), R = new Float32Array(N);
  for (const [b, m, vel] of MUSIC.bell) {
    const x = bellNote(sr, mtof(m), vel), p = rng.range(0.25, 0.6) * (rng() < 0.5 ? -1 : 1);
    mixSt(L, R, x, MT(b), vel, p, sr, true); mixSt(L, R, x, MT(b + 1), vel * 0.3, -p, sr, true); mixSt(L, R, x, MT(b + 2), vel * 0.12, p * 0.5, sr, true); yield;
  }
  for (const [b, m, vel] of MUSIC.bowl) { mixSt(L, R, bowlNote(sr, mtof(m)), MT(b), vel * 0.55, 0, sr, true); yield; }
  return [L, R];
}
// the ending: everything comes to rest on G 宫 — a warm chord, the strings climbing the scale to the high G, a bell, the bowl
function* sting_complete(sr, rng) {
  const dur = 7.5, L = buf(sr, dur), R = buf(sr, dur);
  for (const [m, g, t] of [[43, 0.26, 0], [50, 0.22, 0], [55, 0.25, 0], [59, 0.23, 0.1], [62, 0.22, 0.2], [64, 0.15, 1.3], [69, 0.12, 1.3]]) {
    const nt = padNote(sr, mtof(m), dur - t - 0.1, 0.7, 3.6, rng), g2 = g * Math.pow(261 / mtof(m), 0.2); mix(L, nt[0], t, g2, sr); mix(R, nt[1], t, g2, sr); yield;
  }
  [[55, 0, .6], [62, .17, .6], [67, .34, .65], [71, .5, .7], [74, .66, .75], [76, .82, .8], [79, 1.12, 1, 'v'], [74, 2.6, .4], [79, 3.05, .5, 'v'], [43, 1.12, .6]]
    .forEach(([m, t, v, orn]) => mixSt(L, R, zither(sr, rng, m, 2.5, v, orn), t, v * 0.75, clamp((m - 66) / 40, -0.5, 0.5), sr));
  yield;
  mixSt(L, R, bellNote(sr, mtof(86), 0.7), 1.12, 0.3, 0.4, sr); mixSt(L, R, bellNote(sr, mtof(91), 0.6), 1.5, 0.2, -0.4, sr); mixSt(L, R, bellNote(sr, mtof(83), 0.6), 3.05, 0.16, 0.2, sr);
  mixSt(L, R, bowlNote(sr, mtof(67)), 0, 0.3, 0, sr);
  mixSt(L, R, woodHit(sr, rng, 0, 0.9), 0, 0.7, 0, sr); mixSt(L, R, woodHit(sr, rng, 0, 0.6), 1.12, 0.5, 0, sr);
  for (const x of [L, R]) fade(x, sr, 0, 2.5);
  return [L, R];
}

// ---- rooms (impulse responses for the two reverbs) ------------------------------------------------------------------------
// the open street: a few distinct slap-backs off the facing fronts, then a short bright tail that leaks up into the sky
function* ir_street(sr, rng) {
  const dur = 1.3, ch = [];
  for (let c = 0; c < 2; c++) {
    const o = buf(sr, dur), tail = noise(o.length, rng);
    [[0.021, 0.5], [0.038, 0.42], [0.057, 0.32], [0.083, 0.24], [0.121, 0.16], [0.166, 0.1], [0.23, 0.05]].forEach(([t, g], i) => mix(o, burst(sr, rng, 0.012, 0.003, { hp: 500, lp: 5200 - i * 450 }), t * (c ? 1.07 : 0.95) + rng() * 0.004, g, sr));
    biquadVar(tail, 'lp', p => 5200 - 4000 * Math.pow(p, 0.5), 0.6, sr, 64); biquad(tail, 'hp', 300, 0.7, sr);
    shape(tail, sr, t => Math.exp(-t / 0.17) * (1 - Math.exp(-t / 0.03))); mix(o, tail, 0, 0.16 / (peakOf(tail) + 1e-9), sr);
    ch.push(o); yield;
  }
  return ch;
}
// under the arcade: floor, ceiling and columns close by — a dense early cluster, a flutter, a darker, longer tail
function* ir_arcade(sr, rng) {
  const dur = 1.9, ch = [];
  for (let c = 0; c < 2; c++) {
    const o = buf(sr, dur), tail = noise(o.length, rng), boom = noise(o.length, rng);
    [[0.006, 0.6], [0.011, 0.55], [0.017, 0.5], [0.024, 0.42], [0.031, 0.36], [0.043, 0.3], [0.058, 0.22], [0.079, 0.16]].forEach(([t, g], i) => mix(o, burst(sr, rng, 0.01, 0.0025, { hp: 300, lp: 4600 - i * 380 }), t * (c ? 1.08 : 0.94) + rng() * 0.002, g, sr));
    for (let k = 1; k < 9; k++) mix(o, burst(sr, rng, 0.02, 0.005, { lp: 3000 / (1 + k * 0.3), hp: 250 }), 0.02 * k * (c ? 1.04 : 1), 0.22 * Math.pow(0.72, k), sr);   // flutter between floor and ceiling
    biquadVar(tail, 'lp', p => 3800 - 3100 * Math.pow(p, 0.45), 0.6, sr, 64); biquad(tail, 'hp', 180, 0.7, sr);
    shape(tail, sr, t => Math.exp(-t / 0.3) * (1 - Math.exp(-t / 0.02))); mix(o, tail, 0, 0.3 / (peakOf(tail) + 1e-9), sr);
    biquad(boom, 'lp', 300, 0.7, sr); biquad(boom, 'hp', 70, 0.7, sr); shape(boom, sr, t => Math.exp(-t / 0.34) * (1 - Math.exp(-t / 0.04))); mix(o, boom, 0, 0.16 / (peakOf(boom) + 1e-9), sr);
    ch.push(o); yield;
  }
  return ch;
}

// the toolbox, for tests and for anyone who wants to build another sound
export const DSP = { noise, coef, biquad, biquadVar, burst, sweep, plink, modal, harm, pluck, warp, mix, mixWrap, mixSt, xfadeLoop, wrapTail, scatter, vox, mouth, keys, fade, sat, peakOf, rmsOf, mtof };

// ---- the table: name -> how to make it and how to play it ---------------------------------------------------------------
// sr: the sound's own sample rate (the browser resamples on playback); n: variants; peak or rms: level the rendered buffer
// is scaled to; g: default play gain; bus: world (3D when a pos is given) | cat | amb | music | ui; boot: rendered before
// the first frame; prio / max: voice stealing; ref / roll: distance model; jit: random pitch spread per play
export const SOUNDS = {
  rain_open:      { zh: '露天的雨', gen: rain_open, sr: 32000, rms: 0.1, g: 0.62, bus: 'amb', loop: 1, boot: 1 },
  rain_arcade:    { zh: '骑楼下听雨', gen: rain_arcade, sr: 32000, rms: 0.1, g: 0.42, bus: 'amb', loop: 1, boot: 1 },
  rain_awning:    { zh: '雨打布篷', gen: rain_awning, sr: 22050, rms: 0.1, g: 0.9, bus: 'world', loop: 1, ref: 2.2, roll: 1.4 },
  gutter_pour:    { zh: '檐沟落水', gen: gutter_pour, sr: 32000, rms: 0.1, g: 0.9, bus: 'world', loop: 1, ref: 2, roll: 1.5 },
  wind:           { zh: '穿街风', gen: wind, sr: 22050, rms: 0.08, g: 0.3, bus: 'amb', loop: 1 },
  thunder:        { zh: '远雷', gen: thunder, sr: 22050, n: 2, peak: 0.85, g: 0.6, bus: 'amb', prio: 3, max: 2, jit: 0.04 },
  neon_buzz:      { zh: '霓虹灯嗡嗡', gen: neon_buzz, sr: 22050, rms: 0.08, g: 0.5, bus: 'world', loop: 1, ref: 2.5, roll: 1.3 },
  congee_pot:     { zh: '粥煲和蒸汽', gen: congee_pot, sr: 32000, rms: 0.09, g: 0.85, bus: 'world', loop: 1, ref: 1.8, roll: 1.4 },
  clock_tick:     { zh: '钟表铺的钟', gen: clock_tick, sr: 32000, peak: 0.6, g: 0.5, bus: 'world', loop: 1, ref: 1.5, roll: 1.5 },
  radio_far:      { zh: '闸门后的收音机', gen: radio_far, sr: 22050, rms: 0.07, g: 0.55, bus: 'world', loop: 1, ref: 2.2, roll: 1.2 },
  bike_bell:      { zh: '远处单车铃', gen: bike_bell, sr: 32000, n: 2, peak: 0.6, g: 0.4, bus: 'world', prio: 1, max: 2, ref: 10, roll: 1 },
  drip:           { zh: '檐口滴水', gen: drip, sr: 32000, n: 3, peak: 0.6, g: 0.5, bus: 'world', prio: 0, max: 4, jit: 0.08, ref: 1.2, roll: 1.4 },
  step_stone:     { zh: '猫步·麻石', gen: step_stone, sr: 32000, n: 3, peak: 0.6, g: 0.5, bus: 'cat', boot: 1, prio: 1, max: 4, jit: 0.05 },
  step_tile:      { zh: '猫步·花阶砖', gen: step_tile, sr: 32000, n: 3, peak: 0.6, g: 0.5, bus: 'cat', boot: 1, prio: 1, max: 4, jit: 0.05 },
  step_wood:      { zh: '猫步·木', gen: step_wood, sr: 32000, n: 3, peak: 0.6, g: 0.5, bus: 'cat', boot: 1, prio: 1, max: 4, jit: 0.05 },
  step_metal:     { zh: '猫步·铁皮', gen: step_metal, sr: 32000, n: 3, peak: 0.6, g: 0.5, bus: 'cat', boot: 1, prio: 1, max: 4, jit: 0.05 },
  step_wet:       { zh: '猫步·积水', gen: step_wet, sr: 32000, n: 3, peak: 0.6, g: 0.5, bus: 'cat', boot: 1, prio: 1, max: 4, jit: 0.05 },
  step_cloth:     { zh: '猫步·布篷', gen: step_cloth, sr: 32000, n: 3, peak: 0.6, g: 0.52, bus: 'cat', boot: 1, prio: 1, max: 4, jit: 0.05 },
  jump:           { zh: '起跳', gen: jump, sr: 32000, peak: 0.5, g: 0.42, bus: 'cat', boot: 1, prio: 2, max: 2, jit: 0.04 },
  land:           { zh: '落地（轻/重）', gen: land, sr: 32000, n: 2, peak: 0.7, g: 0.55, bus: 'cat', boot: 1, prio: 2, max: 2, jit: 0.04 },
  shake:          { zh: '甩水', gen: shake, sr: 32000, peak: 0.7, g: 0.6, bus: 'cat', prio: 3, max: 1, jit: 0.03 },
  meow:           { zh: '喵（四种）', gen: meow, sr: 32000, n: 4, peak: 0.8, g: 0.5, bus: 'cat', boot: 1, prio: 4, max: 2, jit: 0.03 },
  trill:          { zh: '咕噜一声', gen: trill, sr: 32000, peak: 0.7, g: 0.34, bus: 'cat', prio: 3, max: 1, jit: 0.03 },
  purr:           { zh: '呼噜', gen: purr, sr: 22050, rms: 0.1, g: 0.4, bus: 'cat', loop: 1 },
  fish_take:      { zh: '叼到咸鱼', gen: fish_take, sr: 32000, n: 3, peak: 0.75, g: 0.5, bus: 'cat', prio: 5, max: 2, jit: 0 },
  hint_tick:      { zh: '提示', gen: hint_tick, sr: 32000, peak: 0.5, g: 0.4, bus: 'ui', prio: 2, max: 2, jit: 0 },
  ui_click:       { zh: '界面·点', gen: ui_click, sr: 32000, peak: 0.5, g: 0.5, bus: 'ui', prio: 3, max: 2, jit: 0 },
  ui_hover:       { zh: '界面·掠过', gen: ui_hover, sr: 32000, peak: 0.4, g: 0.3, bus: 'ui', prio: 1, max: 2, jit: 0 },
  music_pad:      { zh: '配乐·铺底', gen: music_pad, sr: 22050, rms: 0.09, g: 1, bus: 'music', loop: 1, stem: 1 },
  music_pluck:    { zh: '配乐·筝', gen: music_pluck, sr: 32000, peak: 0.62, g: 1, bus: 'music', loop: 1, stem: 1 },
  music_wood:     { zh: '配乐·木鱼', gen: music_wood, sr: 22050, peak: 0.5, g: 0.8, bus: 'music', loop: 1, stem: 1 },
  music_bell:     { zh: '配乐·铃和钵', gen: music_bell, sr: 32000, peak: 0.5, g: 0.58, bus: 'music', loop: 1, stem: 1 },
  sting_complete: { zh: '回家了（结尾）', gen: sting_complete, sr: 32000, peak: 0.8, g: 0.9, bus: 'music', prio: 6, max: 1, jit: 0 },
  ir_street:      { zh: '混响·街上', gen: ir_street, sr: 32000, g: 0.6, bus: 'ui', ir: 1, jit: 0 },
  ir_arcade:      { zh: '混响·骑楼下', gen: ir_arcade, sr: 32000, g: 0.6, bus: 'ui', ir: 1, jit: 0 },
};
export const NAMES = Object.keys(SOUNDS);

// finish a rendered sound: clean, fade the ends (one-shots), scale to its level, measure
function finish(S, raw, sr) {
  const ch = Array.isArray(raw) ? raw : [raw]; let bad = 0;
  for (const x of ch) {
    let m = 0; for (let i = 0; i < x.length; i++) { const v = x[i]; if (v !== v || v === Infinity || v === -Infinity) { x[i] = 0; bad++; } else m += v; }
    if (!S.ir) { m /= x.length; for (let i = 0; i < x.length; i++) x[i] -= m; }
    if (!S.loop) fade(x, sr, S.ir ? 0 : 0.0005, S.ir ? 0.05 : 0.012);
  }
  let pk = 0, sq = 0, n = 0; for (const x of ch) { pk = Math.max(pk, peakOf(x)); const r = rmsOf(x); sq += r * r * x.length; n += x.length; }
  let g = pk > 1e-9 ? (S.rms ? S.rms / Math.sqrt(sq / n) : (S.peak || 0.7) / pk) : 1; if (pk * g > 0.97) g = 0.97 / pk;
  if (S.ir && sq > 0) g = 1 / Math.sqrt(sq / ch.length);   // a room answers with as much energy as it is sent: unit energy per channel
  for (const x of ch) scale(x, g);
  const st = analyse(ch, sr, !!S.loop); st.nan = bad;
  return { ch, sr, dur: ch[0].length / sr, loop: !!S.loop, stats: st };
}
// render one variant step by step (a generator, so the caller can stop between layers), or all at once
// (sr overrides the table's rate: the two impulse responses must be at the context's own rate for the ConvolverNode)
export function* renderIter(name, v = 0, sr = 0) {
  const S = SOUNDS[name], rate = sr || S.sr, rng = makeRng((hashStr(name) + v * 7919) >>> 0), r = S.gen(rate, rng, v);
  const raw = r && typeof r.next === 'function' ? yield* r : r;
  return finish(S, raw, rate);
}
export function renderSound(name, v = 0, sr = 0) { const it = renderIter(name, v, sr); let r; while (!(r = it.next()).done); return r.value; }

// =====================================================================================================================
// PART 3 — engine
// =====================================================================================================================
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const SURF = { stone: 'stone', tile: 'tile', wood: 'wood', metal: 'metal', cloth: 'cloth', water: 'wet', wet: 'wet' };
const STEMS = ['music_pad', 'music_pluck', 'music_wood', 'music_bell'];
// order of the background rendering: rooms and cat first, then the beds and the music, the rare things last
const BG_ORDER = ['ir_street', 'ir_arcade', 'shake', 'trill', 'fish_take', 'ui_click', 'ui_hover', 'hint_tick', 'wind', 'music_pad', 'music_pluck', 'purr', 'drip', 'neon_buzz', 'congee_pot', 'clock_tick', 'gutter_pour', 'rain_awning', 'music_wood', 'music_bell', 'bike_bell', 'thunder', 'radio_far', 'sting_complete'];
// soft clipper: straight up to 0.62, then bending over towards 0.93 and never reaching it (input is fed at half level)
function clipCurve() { const n = 2049, c = new Float32Array(n), T = 0.62, M = 0.93; for (let i = 0; i < n; i++) { const x = (i / (n - 1) * 2 - 1) * 2, a = Math.abs(x); c[i] = Math.sign(x) * (a < T ? a : T + (M - T) * Math.tanh((a - T) / (M - T))); } return c; }
// stem loudness for a mood 0..1: the pad is always there, then the strings, the wooden pulse, the bell
const stemGains = m => [0.55 + 0.3 * m, sstep(0, 0.25, m), sstep(0.3, 0.6, m), sstep(0.5, 0.9, m)];
function toBuffer(ac, d) { const b = ac.createBuffer(d.ch.length, d.ch[0].length, d.sr); for (let c = 0; c < d.ch.length; c++) { if (b.copyToChannel) b.copyToChannel(d.ch[c], c); else b.getChannelData(c).set(d.ch[c]); } return b; }
// the mixer, built the same way on the live context and on the offline one used by selfTest():
//   world, cat, amb -> pause gain ┐
//   music -> duck gain            ├-> compressor -> soft clipper -> master -> out
//   ui                            ┘
//   world, cat, amb, music each send a little to two convolvers (street / arcade), cross-faded by the shelter value
function buildGraph(ac) {
  const g = v => { const n = ac.createGain(); n.gain.value = v; return n; };
  const bus = { world: g(1), cat: g(1), amb: g(1), music: g(0.42), ui: g(0.8) };
  const paused = g(1), duck = g(1), pre = g(1), comp = ac.createDynamicsCompressor(), half = g(0.5), clip = ac.createWaveShaper(), master = g(1);
  comp.threshold.value = -15; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.008; comp.release.value = 0.25;
  clip.curve = clipCurve(); clip.oversample = '2x';
  for (const k of ['world', 'cat', 'amb']) bus[k].connect(paused);
  paused.connect(pre); bus.music.connect(duck); duck.connect(pre); bus.ui.connect(pre);
  pre.connect(comp); comp.connect(half); half.connect(clip); clip.connect(master); master.connect(ac.destination);
  const send = g(1), sA = g(2.2), sB = g(0), cvA = ac.createConvolver(), cvB = ac.createConvolver(), ret = g(0.3);
  cvA.normalize = false; cvB.normalize = false;   // the impulse responses are already scaled to unit energy
  const sends = { world: g(0.42), cat: g(0.3), amb: g(0.03), music: g(0.16) };
  for (const k in sends) { bus[k].connect(sends[k]); sends[k].connect(send); }
  send.connect(sA); sA.connect(cvA); cvA.connect(ret); send.connect(sB); sB.connect(cvB); cvB.connect(ret); ret.connect(pre);
  return { ac, bus, paused, duck, pre, comp, master, sA, sB, cvA, cvB, ret, sends };
}

export async function create(G) {
  G = G || {}; const P = G.params || {}, T0 = nowMs();
  const data = {}, ms = { boot: 0, bg: 0, bgWall: 0, each: {}, steps: {} }, warned = {};
  const warn = (k, e) => { if (!warned[k]) { warned[k] = 1; console.warn('[audio] ' + k + ': ' + (e && e.message || e)); } };
  const put = (name, v, d, t) => { (data[name] || (data[name] = []))[v] = d; ms.each[name] = +((ms.each[name] || 0) + t).toFixed(1); };

  // ---- 1. the sounds the first seconds need, rendered now -----------------------------------------------------------
  // In this order, cheapest and most urgent first. Normally all of it takes 60-75 ms. If the machine is so busy that it
  // runs past the budget (aboot=<ms>, default 150), what is left goes to the front of the background queue instead of
  // holding the boot any longer; the beds and voices simply start when their buffer arrives.
  const queue = [], BOOT = ['step_tile', 'step_stone', 'jump', 'land', 'meow', 'step_wet', 'step_wood', 'step_metal', 'step_cloth', 'rain_arcade', 'rain_open'], budget = +P.aboot || 150;
  ms.deferred = [];
  for (const name of [...BOOT, ...NAMES.filter(n => SOUNDS[n].boot && !BOOT.includes(n))]) {
    const S = SOUNDS[name];
    for (let v = 0; v < (S.n || 1); v++) {
      const t = nowMs(); if (t - T0 > budget) { queue.push([name, v]); if (!ms.deferred.includes(name)) ms.deferred.push(name); continue; }
      try { put(name, v, renderSound(name, v), nowMs() - t); } catch (e) { console.error('[audio] synthesis failed for ' + name + ': ' + (e && e.stack || e)); }
    }
  }
  for (const name of [...BG_ORDER, ...NAMES]) { const S = SOUNDS[name]; if (!S || S.boot || S.ir || queue.some(q => q[0] === name)) continue; for (let v = 0; v < (S.n || 1); v++) queue.push([name, v]); }
  ms.boot = +(nowMs() - T0).toFixed(1);

  // ---- 2. context and mixer -------------------------------------------------------------------------------------------
  // Made on the first key, click or touch (a context made earlier is refused by the browser and only earns a console
  // warning); until then, and when there is no Web Audio at all, everything below is a silent no-op.
  let ctx = null, env = null, analyser = null, tried = false; const cache = new Map(), pools = {};
  const live = () => !!ctx && ctx.state === 'running';
  const getBuf = (name, v) => { const k = name + '#' + v; let b = cache.get(k); if (!b) { b = toBuffer(ctx, data[name][v]); cache.set(k, b); } return b; };
  const prng = makeRng(hashStr('qiloumao-play')), arng = makeRng(hashStr('qiloumao-ambience'));
  const st = { shelter: 0, shelterS: 0, auto: true, mood: 0.3, moodS: 0.3, moodAuto: true, paused: false, vol: P.vol != null ? clamp(+P.vol || 0, 0, 1.5) : 0.9,
    bedOn: P.show !== 'audio' || P.abed === '1', gust: 0.5, gustT: 0, gustTo: 0.5, stingT: 0, purrT: 0, purr: null, thunderSeen: -1e9, nextBell: 18, nextThunder: 40, t: 0, acc: 0, fish: 0, irSet: false };
  const lp = [0, 0.26, 0];   // listener position
  const toPos = p => (!p ? null : Array.isArray(p) ? [+p[0] || 0, +p[1] || 0, +p[2] || 0] : (typeof p.x === 'number' ? [p.x, p.y, p.z] : null));
  const setPan = (pn, v) => { if (pn.positionX) { pn.positionX.value = v[0]; pn.positionY.value = v[1]; pn.positionZ.value = v[2]; } else pn.setPosition(v[0], v[1], v[2]); };
  const mkPanner = (S, o) => { const pn = ctx.createPanner(); pn.panningModel = 'equalpower'; pn.distanceModel = 'inverse'; pn.maxDistance = 200; pn.refDistance = o.ref || S.ref || 2; pn.rolloffFactor = o.roll || S.roll || 1.2; return pn; };
  const ramp = (param, v, tc = 0.12) => { if (param._to !== undefined && Math.abs(param._to - v) < 0.003) return; param._to = v; param.setTargetAtTime(v, ctx.currentTime, tc); };
  function ensureCtx() {
    if (ctx || tried) return !!ctx; tried = true; const t = nowMs();
    try {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext); if (!AC) { if (typeof window !== 'undefined') warn('WebAudio unavailable, running silent', ''); return false; }
      const c = new AC({ latencyHint: 'interactive' }), e = buildGraph(c); analyser = c.createAnalyser(); analyser.fftSize = 2048; e.master.connect(analyser); e.master.gain.value = st.vol;
      // one-shot voices: fixed pools per bus
      const mk = (k, dest, n, spatial) => { pools[k] = []; for (let i = 0; i < n; i++) { const g = c.createGain(); let pan = null; if (spatial) { pan = c.createPanner(); pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.maxDistance = 200; g.connect(pan); pan.connect(dest); } else g.connect(dest); pools[k].push({ g, pan, src: null, name: '', prio: 0, t0: 0, end: 0 }); } };
      mk('world3d', e.bus.world, 8, true); mk('world', e.bus.world, 4); mk('cat', e.bus.cat, 8); mk('amb', e.bus.amb, 4); mk('music', e.bus.music, 2); mk('ui', e.bus.ui, 4);
      ctx = c; env = e; api.ctx = c;
      queue.unshift(['ir_street', 0], ['ir_arcade', 0]); kickPump();   // the two rooms, at this context's sample rate
    } catch (e) { warn('WebAudio failed, running silent', e); ctx = null; env = null; return false; }
    ms.ctx = +(nowMs() - t).toFixed(1); return true;
  }

  // ---- 3. background rendering in small time slices -----------------------------------------------------------------
  let cur = null, resolveReady, bgStart = 0, finished = false, pumping = false; const ready = new Promise(r => (resolveReady = r));
  const SLICE = P.show === 'audio' ? 12 : 5, GAP = P.show === 'audio' ? 1 : 9;
  const done = () => { if (finished) return; finished = true; ms.bg = +ms.bg.toFixed(1); ms.bgWall = +(nowMs() - bgStart).toFixed(0); resolveReady(api); };
  const onRendered = () => { try { if (env && !st.irSet && data.ir_street && data.ir_street[0] && data.ir_arcade && data.ir_arcade[0]) { env.cvA.buffer = getBuf('ir_street', 0); env.cvB.buffer = getBuf('ir_arcade', 0); st.irSet = true; } } catch (e) { warn('reverb', e); } };
  function work(budget) {   // render queued sounds for up to `budget` ms; returns true when nothing is left
    const t0 = nowMs();
    while (nowMs() - t0 < budget) {
      if (!cur) { const q = queue.shift(); if (!q) { done(); return true; } cur = { name: q[0], v: q[1], it: renderIter(q[0], q[1], SOUNDS[q[0]].ir && ctx ? ctx.sampleRate : 0), t: 0 }; }
      try { const s0 = nowMs(), r = cur.it.next(), dt = nowMs() - s0; cur.t += dt; ms.bg += dt; if (dt > (ms.steps[cur.name] || 0)) ms.steps[cur.name] = +dt.toFixed(1); if (r.done) { put(cur.name, cur.v, r.value, cur.t); cur = null; onRendered(); } }
      catch (e) { console.error('[audio] synthesis failed for ' + cur.name + ': ' + (e && e.stack || e)); cur = null; }
    }
    return false;
  }
  const pump = () => { if (work(SLICE)) pumping = false; else setTimeout(pump, GAP); };
  const kickPump = (delay = 0) => { if (!pumping && typeof setTimeout !== 'undefined') { pumping = true; setTimeout(pump, delay); } };
  const flush = () => { while (!work(1e9)); };
  const bump = name => { const a = [], b = []; for (const q of queue) (q[0] === name ? a : b).push(q); queue.length = 0; queue.push(...a, ...b); };
  bgStart = nowMs(); kickPump(80);

  // ---- 4. one-shot voices, stolen by priority -----------------------------------------------------------------------
  function play(name, o) {
    try {
      o = o || {}; const S = SOUNDS[name]; if (!S || !live()) return false;
      const vs = data[name], n = S.n || 1; let v = o.variant;
      if (v == null) { S._rr = ((S._rr == null ? -1 : S._rr) + 1 + (n > 2 && prng() < 0.3 ? 1 : 0)) % n; v = S._rr; }
      v = clamp(v | 0, 0, n - 1); const d = vs && vs[v]; if (!d) { bump(name); return false; }
      const pos = toPos(o.pos), spatial = !!pos && S.bus === 'world', pool = pools[spatial ? 'world3d' : S.bus]; if (!pool) return false;
      const t = ctx.currentTime, prio = o.prio != null ? o.prio : (S.prio || 0), max = S.max || 3, same = [];
      let slot = null, low = null, steal = false;
      for (const s of pool) { if (s.src && s.end <= t) s.src = null; if (!s.src) { if (!slot) slot = s; continue; } if (s.name === name) same.push(s); if (!low || s.prio < low.prio || (s.prio === low.prio && s.t0 < low.t0)) low = s; }
      if (same.length >= max) { slot = same.reduce((a, b) => (a.t0 < b.t0 ? a : b)); steal = true; }
      else if (!slot) { if (low && low.prio <= prio) { slot = low; steal = true; } else return false; }
      let when = t + (o.delay || 0); const gp = slot.g.gain; gp.cancelScheduledValues(t);
      if (steal && slot.src) { gp.setTargetAtTime(0, t, 0.003); try { slot.src.stop(t + 0.014); } catch (e) {} when = Math.max(when, t + 0.014); }
      const jit = o.jitter != null ? o.jitter : (S.jit != null ? S.jit : 0.03), rate = clamp((o.rate || 1) * (1 + jit * prng.bi()), 0.25, 4);
      const src = ctx.createBufferSource(); src.buffer = getBuf(name, v); src.playbackRate.value = rate;
      gp.setValueAtTime(S.g * (o.gain != null ? o.gain : 1) * (1 - 0.06 * prng()), when);
      if (slot.pan) { setPan(slot.pan, pos); slot.pan.refDistance = o.ref || S.ref || 2; slot.pan.rolloffFactor = o.roll || S.roll || 1.2; }
      src.connect(slot.g); src.start(when);
      slot.src = src; slot.name = name; slot.prio = prio; slot.t0 = when; slot.end = when + d.dur / rate + 0.05;
      src.onended = () => { if (slot.src === src) slot.src = null; try { src.disconnect(); } catch (e) {} };
      return true;
    } catch (e) { warn('play ' + name, e); return false; }
  }

  // ---- 5. loops: the level's emitters (with a position) and the always-on beds ---------------------------------------
  const loops = [], MAXPOS = 12, NOOP = { setGain() {}, setPos() {}, stop() {} };
  function startLoop(L, t0, offset) {
    const d = data[L.name] && data[L.name][0]; if (!d || !live()) return false;
    const S = L.S, src = ctx.createBufferSource(), g = ctx.createGain(); let pan = null;
    src.buffer = getBuf(L.name, 0); src.loop = true; src.playbackRate.value = L.sync ? 1 : L.rate * (1 + 0.012 * (L.off * 2 - 1));
    g.gain.value = 0; src.connect(g);
    if (L.pos && S.bus === 'world') { pan = mkPanner(S, L); setPan(pan, L.pos); g.connect(pan); pan.connect(env.bus.world); } else g.connect(env.bus[S.bus] || env.bus.amb);
    const t = t0 || ctx.currentTime; src.start(t, offset != null ? offset : L.off * d.dur);
    g.gain.setValueAtTime(0, t); g.gain.setTargetAtTime(S.g * L.gain, t, L.fadeIn || 0.25);
    L.node = { src, g, pan }; return true;
  }
  function stopLoop(L, tc = 0.1) {
    const n = L.node; if (!n) return; L.node = null;
    try { const t = ctx.currentTime; n.g.gain.cancelScheduledValues(t); n.g.gain.setTargetAtTime(0, t, tc); n.src.onended = () => { try { n.src.disconnect(); n.g.disconnect(); if (n.pan) n.pan.disconnect(); } catch (e) {} }; n.src.stop(t + tc * 7); } catch (e) {}
  }
  function loop(name, o) {
    try {
      o = o || {}; const S = SOUNDS[name]; if (!S) return NOOP;
      const L = { name, S, pos: toPos(o.pos), gain: o.gain != null ? +o.gain || 0 : 1, rate: o.rate || 1, ref: o.ref, roll: o.roll, sync: !!o.sync, fadeIn: o.fadeIn, off: prng(), node: null, want: true };
      loops.push(L);
      return {
        setGain(v) { try { v = +v || 0; if (Math.abs(v - L.gain) < 0.003) return; L.gain = v; if (L.node) L.node.g.gain.setTargetAtTime(S.g * v, ctx.currentTime, 0.1); } catch (e) {} },
        setPos(p) { try { const q = toPos(p); if (!q) return; L.pos = q; if (L.node && L.node.pan) setPan(L.node.pan, q); } catch (e) {} },
        stop() { try { stopLoop(L); const i = loops.indexOf(L); if (i >= 0) loops.splice(i, 1); } catch (e) {} },
      };
    } catch (e) { warn('loop ' + name, e); return NOOP; }
  }
  // start what should sound, stop what is too far: only the nearest MAXPOS positioned loops within 60 m run
  function syncLoops() {
    if (!live()) return;
    const posd = [];
    for (const L of loops) if (L.pos && L.S.bus === 'world') { const dx = L.pos[0] - lp[0], dy = L.pos[1] - lp[1], dz = L.pos[2] - lp[2]; L.d = Math.sqrt(dx * dx + dy * dy + dz * dz); posd.push(L); }
    posd.sort((a, b) => a.d - b.d).forEach((L, i) => { L.want = i < MAXPOS && L.d < 60; });
    let stemsReady = true, anyStem = false;
    for (const L of loops) {
      if (L.sync) { anyStem = true; if (!(data[L.name] && data[L.name][0])) stemsReady = false; continue; }
      if (L.want && !L.node) startLoop(L); else if (!L.want && L.node) stopLoop(L, 0.3);
    }
    if (anyStem && stemsReady && loops.some(L => L.sync && !L.node)) { const t = ctx.currentTime + 0.08; for (const L of loops) if (L.sync) { if (L.node) stopLoop(L, 0.02); startLoop(L, t, 0); } }   // the four stems start on the same tick
  }
  const bed = { open: loop('rain_open', { gain: 0, fadeIn: 1.2 }), arc: loop('rain_arcade', { gain: 0, fadeIn: 1.2 }), wind: loop('wind', { gain: 0, fadeIn: 2 }), stems: STEMS.map(n => loop(n, { gain: 0, sync: 1, fadeIn: 1.5 })) };

  // ---- 6. what each game event sounds like (shared by the live engine and by selfTest) --------------------------------
  let meowI = 0;
  const handlers = (pl, shelterNow, offline) => ({
    step(d) {
      let s = SURF[d.surface] || 'stone'; const run = !!d.run, open = shelterNow() < 0.5;
      try { const p = !offline && (d.pos || (G.player && G.player.pos)); if (s === 'stone' && p && G.ground && G.ground.isPuddle && G.ground.isPuddle(p.x, p.z)) s = 'wet'; } catch (e) {}
      pl('step_' + s, { gain: run ? 1 : 0.7, rate: run ? 1.06 : 1 });
      if (s === 'stone' && open) pl('step_wet', { gain: run ? 0.36 : 0.24, rate: 1.18 });   // the open street is wet everywhere
    },
    jump() { pl('jump'); },
    land(d) { const sp = Math.abs(+d.speed || 0), hard = sp > 4.5, s = SURF[d.surface] || 'stone'; pl('land', { variant: hard ? 1 : 0, gain: clamp(0.4 + sp / 8, 0.4, 1.15) }); if (s !== 'stone') pl('step_' + s, { gain: clamp(0.5 + sp / 10, 0.5, 1.1), rate: 0.94 }); },
    meow(d) {   // a soaked cat complains (the long one); otherwise the plain miaow, the short mew and the questioning one take turns
      let v = d.variant; if (v == null) { const wet = !offline && G.player && +G.player.wet || 0; v = wet > 0.6 && prng() < 0.75 ? 3 : [0, 1, 0, 2, 1, 0, 2][meowI++ % 7]; }
      pl('meow', { variant: v });
    },
    shake() { pl('shake'); },
    purr(d) { st.purrT = Math.max(st.purrT, +d.time || 5); },
    fish(d) { const i = clamp(d.count != null ? d.count - 1 : st.fish, 0, 2); st.fish++; pl('fish_take', { variant: i }); pl('trill', { delay: 0.6, gain: 0.8 }); if (st.moodAuto) st.mood = [0.55, 0.78, 1][i]; },
    start() { st.fish = 0; if (st.moodAuto) st.mood = 0.32; },
    complete() { pl('sting_complete'); st.stingT = 7.5; st.purrT = Math.max(st.purrT, 7); },
    click() { pl('ui_click'); }, hover() { pl('ui_hover'); }, hint() { pl('hint_tick'); },
    thunder(d) { const k = clamp(d.intensity != null ? +d.intensity : 0.6, 0.2, 1); st.thunderSeen = st.t; pl('thunder', { variant: k > 0.6 ? 1 : 0, gain: 0.45 + 0.6 * k, delay: 0.5 + (1 - k) * 1.8 }); },
  });
  const H = handlers(play, () => st.shelterS);
  const resume = () => { try { ensureCtx(); if (ctx && ctx.state !== 'running') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } } catch (e) {} };
  if (G.events && G.events.on) {
    const on = (n, k) => { try { G.events.on(n, d => { try { H[k](d || {}); } catch (e) { warn('event ' + n, e); } }); } catch (e) {} };
    on('cat:step', 'step'); on('cat:jump', 'jump'); on('cat:land', 'land'); on('cat:meow', 'meow'); on('cat:shake', 'shake'); on('cat:purr', 'purr');
    on('fish:take', 'fish'); on('game:start', 'start'); on('game:complete', 'complete'); on('ui:click', 'click'); on('ui:hover', 'hover'); on('hint', 'hint'); on('thunder', 'thunder');
    try { G.events.on('game:start', resume); G.events.on('ui:click', resume); } catch (e) {}
  }
  // the context may only start after a key, click or touch
  if (typeof window !== 'undefined' && window.addEventListener) {
    const EV = ['pointerdown', 'keydown', 'touchend', 'click'];
    const kick = () => { resume(); if (live() || (tried && !ctx)) for (const e of EV) window.removeEventListener(e, kick, true); };
    for (const e of EV) window.addEventListener(e, kick, { capture: true, passive: true });
  }

  if (typeof document !== 'undefined' && document.addEventListener) {   // a hidden tab goes quiet, and comes back
    let slept = false;
    document.addEventListener('visibilitychange', () => { try { if (document.hidden && live()) { slept = true; ctx.suspend(); } else if (!document.hidden && slept) { slept = false; ctx.resume(); } } catch (e) {} });
  }

  // ---- 7. every frame --------------------------------------------------------------------------------------------------
  function update(dt) {
    try {
      dt = Math.min(0.1, +dt || 0); st.t += dt; if (!live()) return;
      const cam = G.camera, m = cam && cam.matrixWorld && cam.matrixWorld.elements;
      if (m && m[12] === m[12] && (m[8] || m[9] || m[10])) {
        const Ls = ctx.listener; lp[0] = m[12]; lp[1] = m[13]; lp[2] = m[14];
        if (Ls.positionX) { Ls.positionX.value = m[12]; Ls.positionY.value = m[13]; Ls.positionZ.value = m[14]; Ls.forwardX.value = -m[8]; Ls.forwardY.value = -m[9]; Ls.forwardZ.value = -m[10]; Ls.upX.value = m[4]; Ls.upY.value = m[5]; Ls.upZ.value = m[6]; }
        else { Ls.setPosition(m[12], m[13], m[14]); Ls.setOrientation(-m[8], -m[9], -m[10], m[4], m[5], m[6]); }
      }
      st.acc += dt;
      if (st.acc > 0.15) {
        st.acc = 0;
        if (st.auto && G.physics && G.physics.shelterAt) { try { st.shelter = G.physics.shelterAt(lp[0], lp[1], lp[2]) ? 1 : 0; } catch (e) {} }   // nobody drives it: follow the roof over the listener
        syncLoops();
      }
      st.shelterS += (st.shelter - st.shelterS) * (1 - Math.exp(-dt * 2.6)); st.moodS += (st.mood - st.moodS) * (1 - Math.exp(-dt * 0.5));
      st.gustT -= dt; if (st.gustT <= 0) { st.gustT = arng.range(4, 9); st.gustTo = arng.range(0.15, 1); } st.gust += (st.gustTo - st.gust) * (1 - Math.exp(-dt * 0.45));
      const s = sstep(0, 1, st.shelterS), on = st.bedOn ? 1 : 0;
      bed.open.setGain(on * lerp(1, 0.1, s)); bed.arc.setGain(on * s); bed.wind.setGain(on * (0.35 + 0.65 * st.gust) * lerp(1, 0.45, s));
      ramp(env.sA.gain, 2.2 * Math.cos(s * PI / 2)); ramp(env.sB.gain, 1.5 * Math.sin(s * PI / 2));
      if (st.stingT > 0) st.stingT -= dt;
      const sg = stemGains(st.moodS), mu = on * (P.amusic === '0' ? 0 : 1) * (st.stingT > 0 ? 0.22 : 1);
      for (let i = 0; i < 4; i++) bed.stems[i].setGain(mu * sg[i]);
      ramp(env.paused.gain, st.paused ? 0 : 1, 0.05); ramp(env.duck.gain, st.paused ? 0.4 : 1, 0.2);
      if (st.purrT > 0) { st.purrT -= dt; if (!st.purr) st.purr = loop('purr', { fadeIn: 0.5 }); if (st.purrT <= 0 && st.purr) { st.purr.stop(); st.purr = null; } }
      if (on && !st.paused && P.aamb !== '0') {   // far-off street life, always on: a bicycle bell now and then, thunder if nobody else sends any
        st.nextBell -= dt; if (st.nextBell <= 0) { st.nextBell = arng.range(28, 70); play('bike_bell', { pos: [lp[0] + (arng() < 0.5 ? -1 : 1) * arng.range(20, 36), 1.1, arng.range(-2, 2)], gain: arng.range(0.6, 1) }); }
        st.nextThunder -= dt; if (st.nextThunder <= 0) { st.nextThunder = arng.range(50, 110); if ((!G.fx || G.fx.stub) && st.t - st.thunderSeen > 150) play('thunder', { gain: arng.range(0.35, 0.7), variant: arng() < 0.4 ? 1 : 0 }); }
      }
    } catch (e) { warn('update', e); }
  }

  // ---- 8. checks without ears -------------------------------------------------------------------------------------------
  // selfTest: a scripted 10 s scene on an OfflineAudioContext through the same mixer: rain (open, then under the arcade
  // from 5 s), wind, music, steps, a jump and landing, meows, the fish chime, a shake, distant thunder. opts: { solo:
  // 'amb'|'music'|'cat'|'world'|'ui', mood, shelter, dur }
  async function selfTest(opts) {
    const o = opts || {}, out = { peak: 0, rms: 0, clipped: 0 };
    try {
      flush();
      const OAC = typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext); if (!OAC) return { ...out, error: 'no OfflineAudioContext' };
      const sr = ctx ? ctx.sampleRate : 44100, dur = o.dur || 10, oc = new OAC(2, Math.round(sr * dur), sr), e = buildGraph(oc), c = new Map(), t0 = nowMs();
      const B = (name, v) => { const k = name + '#' + v; if (!c.has(k)) { const d = data[name] && data[name][v]; c.set(k, toBuffer(oc, SOUNDS[name].ir && !(d && d.sr === sr) ? renderSound(name, v, sr) : d)); } return c.get(k); };
      e.cvA.buffer = B('ir_street', 0); e.cvB.buffer = B('ir_arcade', 0); e.master.gain.value = st.vol;
      if (o.solo) for (const k in e.bus) if (k !== o.solo) e.bus[k].gain.value = 0;
      if (o.dry) e.ret.gain.value = 0;
      let T = 0;
      const at = (name, op) => { op = op || {}; const S = SOUNDS[name], n = S.n || 1, v = clamp((op.variant != null ? op.variant : 0) | 0, 0, n - 1), src = oc.createBufferSource(), g = oc.createGain(); src.buffer = B(name, v); src.playbackRate.value = op.rate || 1; src.loop = !!op.loop; g.gain.value = S.g * (op.gain != null ? op.gain : 1); src.connect(g); g.connect(e.bus[S.bus]); src.start(T + (op.delay || 0)); return g; };
      const sh = t => (o.shelter != null ? +o.shelter : sstep(5, 6.5, t)), h = handlers(at, () => sh(T), true), mood = o.mood != null ? +o.mood : 0.8;
      const gO = at('rain_open', { loop: 1 }), gA = at('rain_arcade', { loop: 1 }), gW = at('wind', { loop: 1 }), N = 64, cO = new Float32Array(N), cA = new Float32Array(N), cW = new Float32Array(N), c1 = new Float32Array(N), c2 = new Float32Array(N);
      for (let i = 0; i < N; i++) { const s = sstep(0, 1, sh(i / (N - 1) * dur)); cO[i] = SOUNDS.rain_open.g * lerp(1, 0.1, s); cA[i] = SOUNDS.rain_arcade.g * s; cW[i] = SOUNDS.wind.g * 0.7 * lerp(1, 0.45, s); c1[i] = 2.2 * Math.cos(s * PI / 2); c2[i] = 1.5 * Math.sin(s * PI / 2); }
      gO.gain.setValueCurveAtTime(cO, 0, dur); gA.gain.setValueCurveAtTime(cA, 0, dur); gW.gain.setValueCurveAtTime(cW, 0, dur); e.sA.gain.setValueCurveAtTime(c1, 0, dur); e.sB.gain.setValueCurveAtTime(c2, 0, dur);
      const sg = stemGains(mood); STEMS.forEach((n, i) => at(n, { loop: 1, gain: sg[i] }));
      for (T = 0.6; T < 3.0; T += 0.36) h.step({ surface: 'stone' });
      T = 1.2; h.thunder({ intensity: 0.5 }); T = 3.2; h.jump({}); T = 3.75; h.land({ surface: 'stone', speed: 4 });
      for (T = 4.0; T < 5.5; T += 0.2) h.step({ surface: 'tile', run: true });
      T = 5.7; h.meow({ variant: 0 }); T = 6.7; const f0 = st.fish, m0 = st.mood; h.fish({ count: 1 }); st.fish = f0; st.mood = m0;
      T = 7.9; h.shake({}); T = 9.0; h.meow({ variant: 1 }); T = 9.5; h.click({});
      const buf = await oc.startRendering(), L = buf.getChannelData(0), R = buf.getChannelData(1), per = [];
      let peak = 0, sum = 0, clipped = 0, nan = 0, acc = 0;
      for (let i = 0; i < L.length; i++) {
        const a = L[i], b = R[i]; if (a !== a || b !== b) { nan++; continue; } const m = Math.max(Math.abs(a), Math.abs(b)); if (m > peak) peak = m; if (m >= 0.999) clipped++; sum += a * a + b * b; acc += a * a + b * b;
        if ((i + 1) % sr === 0) { per.push(+(10 * Math.log10(acc / (2 * sr) + 1e-12)).toFixed(1)); acc = 0; }
      }
      const rms = Math.sqrt(sum / (2 * L.length));
      return { peak: +peak.toFixed(4), rms: +rms.toFixed(4), clipped, nan, rmsDb: +(20 * Math.log10(rms + 1e-9)).toFixed(1), perSecondDb: per, renderMs: +(nowMs() - t0).toFixed(0), solo: o.solo || null };
    } catch (e) { warn('selfTest', e); return { ...out, error: String(e && e.message || e) }; }
  }
  function debug() {
    const sounds = {}, bad = []; let seconds = 0, buffers = 0;
    for (const n of NAMES) { sounds[n] = (data[n] || []).map(d => d && d.stats); for (const d of data[n] || []) if (d) { seconds += d.dur; buffers++; const s = d.stats; if (s.nan || s.peak < 0.02 || s.peak > 0.975 || Math.abs(s.dc) > 0.003 || (s.seam != null && s.seam > 6)) bad.push(n); } }
    let voices = 0; for (const k in pools) for (const s of pools[k]) if (s.src) voices++;
    return { ctx: ctx ? ctx.state : 'none', sampleRate: ctx ? ctx.sampleRate : 0, bootMs: ms.boot, bootDeferred: ms.deferred, ctxMs: ms.ctx || 0, bgMs: +(+ms.bg).toFixed(1), bgWallMs: ms.bgWall, pending: queue.length + (cur ? 1 : 0), names: NAMES.length, buffers, seconds: +seconds.toFixed(1), bad,
      voices, loops: loops.length, loopsPlaying: loops.filter(L => L.node).length, shelter: +st.shelterS.toFixed(2), mood: +st.moodS.toFixed(2), eachMs: ms.each, longestStepMs: ms.steps, sounds };
  }

  const api = {
    ctx: null, ready, names: NAMES.slice(), play, loop,
    setShelter(v) { st.auto = false; st.shelter = clamp(+v || 0, 0, 1); },
    setMood(v) { st.moodAuto = false; st.mood = clamp(+v || 0, 0, 1); },
    setPaused(b) { st.paused = !!b; },
    setVolume(v) { st.vol = clamp(+v || 0, 0, 1.5); try { if (env) env.master.gain.setTargetAtTime(st.vol, ctx.currentTime, 0.05); } catch (e) {} },
    resume, selfTest, debug, update,
    _int: { data, st, ms, live, flush, pools, loops, get analyser() { return analyser; }, get env() { return env; } },
  };
  // with a gesture already behind us (or on the showcase page, which wants its meter) the context can be made right away
  const ua = typeof navigator !== 'undefined' && navigator.userActivation;
  if (typeof window !== 'undefined' && (P.show === 'audio' || !ua || ua.hasBeenActive)) ensureCtx();
  return api;
}

// =====================================================================================================================
// PART 4 — showcase (?show=audio): every sound with its waveform and spectrogram drawn from the real buffer, its numbers,
// a level meter, and the sounds played in turn. URL: aplay=<name> loops one sound; aseq=0 no auto play; abed=1 rain and
// music on underneath.
// =====================================================================================================================
const BUS_COL = { world: '#48d1ff', cat: '#ffb86b', amb: '#3ddc97', music: '#ff4d6d', ui: '#ffc24a' };
const HEAT = [[12, 20, 32], [22, 72, 106], [61, 220, 151], [255, 194, 74], [255, 77, 109], [255, 240, 230]];
export async function showcase(G) {
  const info = { cam: [0, 1.4, 5], target: [0, 0.6, 0], update() {} }, A = G && G.audio;
  if (!A || A.stub || !A._int || typeof document === 'undefined') return info;
  const I = A._int, P = G.params || {}, D = document, el = (tag, cls, txt) => { const e = D.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const css = el('style'); css.textContent = `
#au{position:absolute;inset:0;z-index:30;background:linear-gradient(180deg,#0c1420,#132235 60%,#16283a);color:#f3e9d6;font:12px/1.35 "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;overflow:auto;pointer-events:auto;padding:14px 18px 18px;box-sizing:border-box}
#au header{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:10px}
#au h1{margin:0;font-size:26px;font-weight:900;letter-spacing:.08em;color:#ffb86b}
#au h1 small{display:block;font-size:12px;font-weight:400;letter-spacing:.04em;color:#9fb3c8;margin-top:2px}
#au .st{flex:1;min-width:300px;color:#c9d6e2;font-size:12.5px}
#au .st b{color:#3ddc97;font-weight:700}
#au .st .bad{color:#ff4d6d}
#au .ct{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
#au button{font:inherit;color:#0c1420;background:#ffb86b;border:0;border-radius:14px;padding:5px 12px;cursor:pointer;font-weight:700}
#au button.off{background:#2a3b4f;color:#c9d6e2}
#au .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}
#au .card{background:#101c2b;border:1px solid #223449;border-radius:8px;padding:6px 8px 5px;cursor:pointer;position:relative}
#au .card.on{border-color:#ffb86b;box-shadow:0 0 0 1px #ffb86b,0 0 18px rgba(255,184,107,.35)}
#au .card .h{display:flex;align-items:baseline;gap:6px;white-space:nowrap;overflow:hidden}
#au .card .h b{font:700 12.5px ui-monospace,Menlo,monospace;color:#fff}
#au .card .h span{color:#9fb3c8;overflow:hidden;text-overflow:ellipsis;flex:1}
#au .card .h i{font-style:normal;font-size:10.5px;padding:0 6px;border-radius:8px;color:#0c1420;font-weight:700}
#au .card canvas{display:block;width:100%;height:138px;margin:4px 0 3px;border-radius:4px;background:#0c1420}
#au .card.big{grid-column:1/-1;order:-1}
#au .card.big canvas{height:430px}
#au .card .n{font:11px ui-monospace,Menlo,monospace;color:#c9d6e2;white-space:nowrap;overflow:hidden}
#au .hint{color:#ffc24a}`;
  D.head.appendChild(css);
  const root = el('div'); root.id = 'au'; (D.getElementById('app') || D.body).appendChild(root);
  const head = el('header'), h1 = el('h1', null, '骑楼猫 · 全部声音'), stats = el('div', 'st'), ctl = el('div', 'ct'), meter = el('canvas'), grid = el('div', 'grid');
  h1.appendChild(el('small', null, '没有一个音频文件：每个声音、每个音符都是开机时一个采样一个采样算出来的'));
  meter.width = 380; meter.height = 46; meter.style.cssText = 'width:380px;height:46px;border-radius:6px;background:#0c1420';
  head.append(h1, stats, ctl, meter); root.append(head, grid);
  const btn = (txt, fn) => { const b = el('button', null, txt); b.addEventListener('click', ev => { ev.stopPropagation(); fn(b); }); ctl.appendChild(b); return b; };

  // cards (azoom=<name> or aplay=<name> draws that one across the whole page, with a finer spectrogram)
  const cards = {}, todo = [], ZOOM = P.azoom || P.aplay || '';
  for (const name of NAMES) {
    const S = SOUNDS[name], c = el('div', 'card'), h = el('div', 'h'), cv = el('canvas'), n = el('div', 'n', '正在算…'), tag = el('i', null, S.ir ? 'ir' : S.bus + (S.loop ? ' ∞' : ''));
    tag.style.background = S.ir ? '#b48cff' : BUS_COL[S.bus]; h.append(el('b', null, name), el('span', null, S.zh || ''), tag); const big = name === ZOOM; if (big) c.classList.add('big'); cv.width = big ? 1860 : 300; cv.height = big ? 430 : 138; c.append(h, cv, n); grid.appendChild(c);
    cards[name] = { c, cv, n, drawn: false }; todo.push(name);
    c.addEventListener('click', () => { seq.on = false; bSeq.className = 'off'; audition(name, null, true); });
  }
  const heat = v => { v = clamp(v, 0, 1) * (HEAT.length - 1); const i = Math.min(HEAT.length - 2, Math.floor(v)), u = v - i, a = HEAT[i], b = HEAT[i + 1]; return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; };
  function drawCard(name) {
    const S = SOUNDS[name], vs = (I.data[name] || []).filter(Boolean), k = cards[name]; if (vs.length < (S.n || 1)) return false;
    const cv = k.cv, W = cv.width, Hh = cv.height, big = W > 600, g = cv.getContext('2d'), hw = big ? 110 : 52, hs = Hh - hw - 2, col = S.ir ? '#b48cff' : BUS_COL[S.bus];
    g.fillStyle = '#0c1420'; g.fillRect(0, 0, W, Hh);
    const tot = vs.reduce((a, d) => a + d.dur, 0), gap = vs.length > 1 ? 3 : 0; let x0 = 0;
    for (const d of vs) {
      const w = Math.max(6, Math.round((W - gap * (vs.length - 1)) * d.dur / tot)), x = d.ch[0], n = x.length, y = d.ch[1]; const zoomY = S.ir ? 0.9 / (d.stats.peak || 1) : 1;   // the rooms are tiny numbers: draw them full height
      g.fillStyle = '#132235'; g.fillRect(x0, 0, w, hw); g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x0, hw / 2, w, 1);
      for (let pass = y ? 0 : 1; pass < 2; pass++) {   // right channel underneath in white, left (or mono) on top in the bus colour
        const src = pass ? x : y; g.fillStyle = pass ? col : 'rgba(255,255,255,.45)';
        for (let px = 0; px < w; px++) { let lo = 1, hi = -1; const a = Math.floor(px * n / w), b = Math.max(a + 1, Math.floor((px + 1) * n / w)); for (let i = a; i < b; i++) { const v = src[i]; if (v < lo) lo = v; if (v > hi) hi = v; } const y0 = (1 - hi * zoomY) * hw / 2, y1 = (1 - lo * zoomY) * hw / 2; g.fillRect(x0 + px, y0, 1, Math.max(1, y1 - y0)); }
      }
      // spectrogram 0..8 kHz, 60 dB range
      const size = big ? 1024 : 512, bins = size >> 1, img = g.createImageData(w, hs), mag = new Float32Array(bins), top = Math.min(bins - 1, Math.floor(8000 / (d.sr / size))), cols = [];
      let mx = 1e-9; for (let px = 0; px < w; px++) { const s0 = Math.round(px * Math.max(0, n - size) / Math.max(1, w - 1)) - (n < size ? ((size - n) >> 1) : 0); const m = spectrum(x, s0, size).slice(); cols.push(m); for (let i = 1; i < bins; i++) if (m[i] > mx) mx = m[i]; }
      for (let px = 0; px < w; px++) for (let py = 0; py < hs; py++) { const f = (1 - (py + 0.5) / hs) * 8000, grid1k = big && py > 0 && Math.floor((1 - py / hs) * 8) !== Math.floor((1 - (py - 1) / hs) * 8), b = f / (d.sr / size), bi = Math.floor(b); let v = 0; if (bi < bins - 1) { const m = cols[px]; v = m[bi] + (m[bi + 1] - m[bi]) * (b - bi); } const c3 = heat(v > 0 ? 1 + 20 * Math.log10(v / mx) / 60 : 0), o = (py * w + px) * 4; img.data[o] = c3[0] + (grid1k ? 40 : 0); img.data[o + 1] = c3[1] + (grid1k ? 40 : 0); img.data[o + 2] = c3[2] + (grid1k ? 40 : 0); img.data[o + 3] = 255; }
      g.putImageData(img, x0, hw + 2); x0 += w + gap;
    }
    const s0 = vs[0].stats, pk = Math.max(...vs.map(d => d.stats.peak)), rm = vs.reduce((a, d) => a + d.stats.rms, 0) / vs.length;
    k.n.textContent = `${vs[0].dur.toFixed(2)}s${vs.length > 1 ? '×' + vs.length : ''} 峰${pk.toFixed(2)} 均${rm.toFixed(3)} ${Math.round(vs[0].sr / 1000)}k${vs[0].ch.length > 1 ? ' 立体' : ''}${s0.seam != null ? ' 缝' + s0.seam : ''}` + (big ? '   （上：波形，满格 ±1；下：频谱 0–8 kHz，每格 1 kHz，60 dB）' : '');
    k.drawn = true; return true;
  }

  // playing: one sound at a time, in turn or on click; loops are held for a few seconds
  const seq = { on: !P.aplay && P.aseq !== '0', list: [], i: -1, t: 0.6, h: null, cur: null };
  for (const name of NAMES) for (let v = 0; v < (SOUNDS[name].n || 1); v++) seq.list.push([name, v]);
  function audition(name, v, single) {
    if (seq.h) { seq.h.stop(); seq.h = null; } if (seq.cur) cards[seq.cur].c.classList.remove('on');
    const S = SOUNDS[name], d = (I.data[name] || [])[v || 0]; if (!S || !d) return 0.2;
    seq.cur = name; cards[name].c.classList.add('on');
    if (S.loop) { seq.h = A.loop(name, { gain: 1, fadeIn: 0.05 }); if (single && !seq.on) return 1e9; return Math.min(d.dur, 3.2); }
    A.play(name, v != null ? { variant: v, jitter: 0 } : { jitter: 0 }); return Math.min(d.dur, 3.6) + 0.25;
  }
  const bSeq = btn('▶ 逐个播放', b => { seq.on = !seq.on; b.className = seq.on ? '' : 'off'; if (!seq.on && seq.h) { seq.h.stop(); seq.h = null; } seq.t = 0; A.resume(); }); bSeq.className = seq.on ? '' : 'off';
  const bBed = btn('雨和配乐垫底', b => { I.st.bedOn = !I.st.bedOn; b.className = I.st.bedOn ? '' : 'off'; A.resume(); }); bBed.className = I.st.bedOn ? '' : 'off';
  let sh = 0; const bSh = btn('骑楼下', b => { sh = 1 - sh; A.setShelter(sh); b.className = sh ? '' : 'off'; }); bSh.className = 'off';
  let mood = 0.3; btn('配乐层次 0.3', b => { mood = mood >= 0.99 ? 0 : Math.min(1, mood + 0.35); A.setMood(mood); b.textContent = '配乐层次 ' + mood.toFixed(2); });
  let test = null; const runTest = () => { test = '…'; A.selfTest().then(r => { test = r; I.st.selfTest = r; }); }; btn('自检', runTest);
  A.ready.then(() => { if (P.atest !== '0') runTest(); });

  // meter
  const mg = meter.getContext('2d'); let tb = null, hold = -90, holdT = 0, aT = 0;
  function drawMeter(dt) {
    let pk = 0, sq = 0; if (!tb && I.analyser) tb = new Float32Array(I.analyser.fftSize); if (tb && I.live()) { I.analyser.getFloatTimeDomainData(tb); for (let i = 0; i < tb.length; i++) { const a = Math.abs(tb[i]); if (a > pk) pk = a; sq += tb[i] * tb[i]; } }
    const pdb = 20 * Math.log10(pk + 1e-6), rdb = 10 * Math.log10(sq / (tb ? tb.length : 1) + 1e-12), W = meter.width, Hh = meter.height, X = db => clamp((db + 60) / 60, 0, 1) * (W - 70) + 8;
    holdT -= dt; if (pdb > hold || holdT <= 0) { if (pdb > hold) { hold = pdb; holdT = 1.5; } else hold -= 30 * dt; }
    mg.fillStyle = '#0c1420'; mg.fillRect(0, 0, W, Hh); mg.fillStyle = '#1b2a3c'; mg.fillRect(8, 8, W - 78, 12); mg.fillRect(8, 26, W - 78, 12);
    const gr = mg.createLinearGradient(8, 0, W - 70, 0); gr.addColorStop(0, '#3ddc97'); gr.addColorStop(0.7, '#ffc24a'); gr.addColorStop(1, '#ff4d6d');
    mg.fillStyle = gr; mg.fillRect(8, 8, X(pdb) - 8, 12); mg.fillRect(8, 26, X(rdb) - 8, 12); mg.fillStyle = '#fff'; mg.fillRect(X(hold), 6, 2, 16);
    mg.fillStyle = 'rgba(255,255,255,.35)'; for (const db of [-48, -36, -24, -12, -6]) mg.fillRect(X(db), 4, 1, Hh - 8);
    mg.fillStyle = '#f3e9d6'; mg.font = '11px ui-monospace,Menlo,monospace'; mg.fillText('峰 ' + (pk ? pdb.toFixed(0) : '−∞'), W - 64, 18); mg.fillText('均 ' + (pk ? rdb.toFixed(0) : '−∞'), W - 64, 36);
  }
  function drawStats() {
    const d = A.debug(), t = I.st.selfTest || test;
    let s = `<b>${d.names}</b> 种声音 · <b>${d.buffers}</b> 段 · 共 <b>${d.seconds}</b> 秒 · 开机同步算 <b>${d.bootMs}</b> ms · 后台分片算 <b>${d.bgMs}</b> ms${d.pending ? '（还剩 ' + d.pending + ' 段）' : '，墙钟 ' + (d.bgWallMs / 1000).toFixed(1) + ' s'} · 声卡 ${d.ctx} ${d.sampleRate / 1000}k`;
    if (d.bad.length) s += ` · <span class="bad">数值可疑：${d.bad.join(', ')}</span>`;
    if (t && t !== '…') s += `<br>自检（10 秒场景离线渲染）：峰值 <b>${t.peak}</b> · RMS <b>${t.rms}</b>（${t.rmsDb} dB）· 削波 <b>${t.clipped}</b> 个采样 · 逐秒 ${(t.perSecondDb || []).join(' ')}`; else if (t) s += '<br>自检中…';
    if (!I.live()) s += '<br><span class="hint">浏览器要等一次点击或按键才放声音：点一下页面</span>';
    stats.innerHTML = s;
  }
  let aplayT = 0.5;
  info.update = dt => {
    try {
      for (let k = 0; k < 3 && todo.length; k++) { const nm = todo[0]; if (drawCard(nm)) todo.shift(); else { todo.push(todo.shift()); break; } }
      drawMeter(dt); aT -= dt; if (aT <= 0) { aT = 0.4; drawStats(); }
      if (!I.live()) return;
      if (P.aplay && SOUNDS[P.aplay]) { aplayT -= dt; if (aplayT <= 0) { const r = audition(P.aplay, null, true); aplayT = r > 1e8 ? 1e9 : r + 0.3; } }
      else if (seq.on) { seq.t -= dt; if (seq.t <= 0) { seq.i = (seq.i + 1) % seq.list.length; const [nm, v] = seq.list[seq.i]; seq.t = audition(nm, v); } }
    } catch (e) { if (!info._err) { info._err = 1; console.error('[audio showcase] ' + (e && e.stack || e)); } }
  };
  return info;
}
