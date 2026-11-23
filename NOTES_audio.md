# NOTES — audio (`src/audio.js`)

Everything the player hears. No audio files: 35 sounds (57 buffers with variants, 197 s of audio in total) are computed
sample by sample into `Float32Array`s when the page loads and played through the Web Audio API.

## How to see and hear it

| what | URL (after `http://127.0.0.1:5208/dev.html?`) |
|---|---|
| every sound: waveform, spectrogram (0–8 kHz), duration, peak, RMS, loop seam; level meter; plays them in turn | `show=audio` |
| one sound across the whole page with a finer spectrogram, played on a loop | `show=audio&aplay=meow` (any name below) |
| same big picture without playing | `show=audio&azoom=music_pluck&aseq=0` |
| rain and music running underneath while you click cards | `show=audio&abed=1` |
| no automatic playing / no automatic self test | `aseq=0`, `atest=0` |
| in the game: no music, no far-off bell and thunder of my own, another volume | `amusic=0`, `aamb=0`, `vol=0.6` |

A real browser only starts sound after a click or key press (the page says so); the screenshot tool starts it at once.
Buttons on the page: play in turn, rain and music underneath, under the arcade (shelter 0/1), music layers (mood), self test.
Click a card to hear that sound.

Numbers without ears (run with `tools/shot.py "show=audio" shots/audio_01.jpg --wait 5 --js "<expr>"`):

- `window.__G.audio.debug()` → `{ctx, bootMs, ctxMs, bgMs, bgWallMs, pending, names, buffers, seconds, bad: [], voices,
  loops, loopsPlaying, shelter, mood, eachMs, longestStepMs, sounds: {name: [{dur, ch, sr, peak, rms, dc, nan, seam,
  edgeDb}]}}`. `bad` lists any sound with NaN, a silent or over-full buffer, DC offset or a loop seam; it is empty.
  `seam` = the jump from the last sample to the first in units of the usual sample-to-sample step; `edgeDb` = level of
  the first 5 ms against the last 5 ms.
- `await window.__G.audio.selfTest()` → 10 s scripted scene on an `OfflineAudioContext` through the same mixer (rain in
  the open, then under the arcade from 5 s, wind, music at mood 0.8, walking and running steps, a jump and landing, two
  meows, the fish chime and chirrup, a shake, thunder, a UI click). Last result: **peak 0.67, RMS 0.1145 (−18.8 dB),
  0 clipped, 0 NaN**, per second between −20.5 and −16.9 dB. Options: `{solo: 'amb'|'music'|'cat'|'world'|'ui', mood,
  shelter, dry: true, dur}`. Solo levels: rain bed −22 dB (−21 open, −23.5 under the arcade), music −26.5 dB at mood 0.3
  and −24 dB at mood 1 (so it stays under the rain), walking steps about −35 dB, a meow about −19 dB for its second.
- Node: the recipe part has no browser dependencies. `import('./src/audio.js')` gives `renderSound(name, variant)`,
  `SOUNDS`, `NAMES`, `MUSIC`, `DSP` (the toolbox), `spectrum`, `fft`, `analyse`.

Timings on the M4: boot (synchronous: 18 steps, jump, 2 landings, 4 meows, both rain loops) **58–75 ms** in an idle
browser, 120–200 ms while other agents' renders were loading the machine. There is a budget (150 ms, `aboot=<ms>`): if
the boot runs past it, what is left moves to the front of the background queue (`debug().bootDeferred` lists it), so the
worst case is the budget plus one sound; without that, one loaded run took 808 ms. Background rendering of the rest:
450–700 ms of CPU in slices of 5 ms (longest single step about 20 ms: one music note), finished 1.5–2 s after boot
(3–5 s on the loaded machine). The AudioContext itself costs 160–270 ms the first time in headless Chrome; it is made
on the first gesture, not at boot.

## What exists

DSP toolbox (PART 1): seeded noise (mulberry32 for decisions, xorshift for bulk noise), biquads written out (lp, hp, bp,
notch, peak, shelves; fixed and time-varying), envelopes and fades, pitch-swept sine, bubble chirp, bank of decaying
partials, fixed-pitch harmonic sums, Karplus-Strong string with an all-pass for exact tuning (measured within 0.2 cent),
variable-speed reader (bends, vibrato), grain scatterer, wrap-around mixing, equal-power loop cross-fader, tail wrapper,
a harmonic-by-harmonic voice with four moving resonances, FFT and analysis. Seed of each sound = FNV hash of its name
(+ 7919 × variant); no `Math.random` anywhere, playback jitter also comes from seeded generators.

Sounds (PART 2), name → what it is:

- Weather: `rain_open` (6 s stereo loop: hiss + low wash + about 1,340 placed drops and taps + 54 near splats + 44
  puddle plinks), `rain_arcade` (duller bed, 420 far drops, three eave drip lines), `rain_awning`, `gutter_pour`,
  `wind` (8 s stereo), `thunder` ×2 (7 s stereo).
- Street: `neon_buzz`, `congee_pot`, `clock_tick`, `radio_far` (16 s: its own tune, bowed lead + plucked off-beat,
  squeezed to 400–2600 Hz), `bike_bell` ×2, `drip` ×3.
- Cat: `step_stone / tile / wood / metal / wet / cloth` ×3 each, `jump`, `land` ×2 (soft, from a height), `shake`
  (stereo), `meow` ×4 (plain miaow, short high mew, "mrrow?" that starts as a rolled trill and rises, long complaining
  one with a rasp), `trill` (chirrup), `purr` (4 s loop, two breaths, about 25 pulses a second).
- Pick-ups and UI: `fish_take` ×3 (wet slap + warm chime, a step higher for each fish), `hint_tick`, `ui_click`,
  `ui_hover`.
- Music: E 羽 (the set G A B D E), 80 BPM, 8 bars, 24 s, four stems that loop together: `music_pad`, `music_pluck`
  (Karplus-Strong zither: grace notes, slow tremolo, vibrato, a bend, a sweep up the strings into bar 5), `music_wood`,
  `music_bell` (bell motif with echoes + two singing-bowl notes). `sting_complete` (7.5 s) settles on G 宫.
  All notes are arrays in `MUSIC`.
- Rooms: `ir_street`, `ir_arcade` (rendered at the context's sample rate, unit energy).

Engine (PART 3): buses world / cat / amb / music / ui → compressor (−15 dB, 3:1) → soft clipper (never above 0.93) →
master. Two convolvers cross-faded by shelter. One-shot voice pools per bus (8 positioned, 4 world, 8 cat, 4 amb, 2
music, 4 ui) with per-sound caps and stealing by priority. Positioned sounds go through PannerNodes (equal power,
inverse distance; per-sound `ref` / `roll`); the listener follows `G.camera` every frame. Loops: any number may be
registered, the nearest 12 positioned ones within 60 m actually run; each starts at a seeded offset so copies of the
same loop do not comb. Always on: both rain loops (cross-faded by shelter), wind with seeded gusts, the four stems
(started on one clock tick). A hidden tab is suspended.

Events handled: `cat:step {surface, run, pos}` (stone on a puddle becomes wet; the open street adds a faint wet layer),
`cat:jump`, `cat:land {surface, speed}` (soft or hard by speed), `cat:meow` (a cat wetter than 0.6 mostly uses the
complaining one), `cat:shake`, `cat:purr` (purr for 5 s), `fish:take` (chime for the n-th fish, a chirrup 0.6 s later),
`game:start`, `game:complete` (sting, stems ducked for 7.5 s, purr), `ui:click`, `ui:hover`, `hint`, `thunder
{intensity}` (delayed 0.5–2 s, louder variant above 0.6).

API beyond the contract: `debug()`, `play(name, {pos, gain, rate, variant, delay, jitter, ref, roll, prio})`,
`loop(name, {pos, gain, rate, ref, roll, fadeIn})`, `ctx` is `null` until the first gesture.

## For the level (not done yet on the level side)

`level.js` does not call `G.audio.loop` yet, so the street's emitters are silent in the game. They only need a position:

```js
G.audio.loop('neon_buzz',   { pos: signPos });          // each neon sign (any number; the nearest 12 loops play)
G.audio.loop('congee_pot',  { pos: potPos });           // steaming pots, the congee stall
G.audio.loop('clock_tick',  { pos: clockShopDoor });    // 同福钟表
G.audio.loop('radio_far',   { pos: behindAShutter });   // one or two closed shops
G.audio.loop('gutter_pour', { pos: pipeFoot });         // the six down-pipes (x + 0.33, 0.25, s * 2.95)
G.audio.loop('rain_awning', { pos: awningCentre });     // awnings over the street
G.audio.play('drip', { pos });                          // single drips, if wanted with fx 'drip'
```

## Faked, and known limits

- Nobody has listened to this. It was checked by numbers and pictures only (spectra, harmonic levels of the meows over
  time, octave bands of the rain, tuning, loop seams, the offline mix). The meows have the pitch arc, the moving
  resonances (energy centre 0.7 → 1.9 → 0.5 kHz), jitter, breath and a rasp, but whether they read as a cat needs ears.
- No occlusion: walls do not muffle. Shelter is one number (from `player` via `setShelter`; if nobody calls it, I ask
  `physics.shelterAt` at the camera).
- Reverb is two short synthetic impulse responses; the wet level was set by measurement (about −11 dB under the dry
  sound in the street, −8 dB under the arcade for the cat's sounds).
- A sound asked for before its buffer exists is skipped (and moved to the front of the queue), not delayed.
- A bicycle bell every 28–70 s at 20–36 m, and thunder every 50–110 s only when there is no fx module, are started by
  the engine itself (seeded), not by the level. `aamb=0` turns that off.
- Float buffers stay in memory next to the AudioBuffers (about 60 MB together) so `debug`, `selfTest` and the showcase
  can read them.
- The suspended-context path (a real browser before the first click) could not be reproduced in headless Chrome, which
  starts contexts without a gesture; it was exercised with `ctx.suspend()`.
