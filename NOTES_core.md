# NOTES_core — render, ground, fx, build (CORE agent)

Files: `src/render.js`, `src/ground.js`, `src/fx.js`, `tools/build.mjs`. `src/physics.js` is unchanged.
Last build: `dist/index.html` = 1,048,423 bytes (1024 KB), copy at `release/qiloumao.html`. It was built while other
modules were still changing, so run `node tools/build.mjs` again after the last edit of any module.

## How to see each thing

| What | URL (http://127.0.0.1:5208/…) |
|---|---|
| Post chain at a glance: 21 spheres (roughness x metalness), 20 emissive bars in 10 palette colours at two strengths, lit boxes, mirror ball | `dev.html?show=render` |
| Same with pieces switched off | `…&post=0`, `…&bloom=0`, `…&r_auto=0` (no eye adaptation), `…&r_exp=1.6`, `…&r_bloom=0.4` |
| Wet street, puddles, rings, mirror, tiles, kerbs (4 buildings, 6 signs, 6 glowing boxes, 9 lanterns, 6 lights) | `dev.html?show=ground` |
| Mirror off (environment map only) | `dev.html?show=ground&refl=0` or `&q=low` |
| Rain, roof shelter, splash crowns, drips, a pouring pipe, steam, mist, sparks, puffs | `dev.html?show=fx` (`&thunder=0` stops the lightning) |
| Sky at any hour | `dev.html?autostart=1&r_dawn=0` … `1` (pins dawn; the game's own value is ignored) |
| Full game, cat height on the carriageway | `dev.html?autostart=1&cam=-20,0.3,1.2,0,1.6,-0.5` |
| Looking west at the moon | `dev.html?autostart=1&cam=14,1,0.3,-30,13,-0.3` |
| The single file | `dist/index.html?autostart=1` |

Live tuning from the console: `__G.render.tune` (32 entries, 42 numbers: exposure, autoExposure, bloom, bloomRadius, toneMix, split,
saturation, vignette, grain, fog, ambient, shopGlow, moon, env …), `__G.ground.tune` (ring, streak, distort, film, f0,
dark, boost, gain, clipY), `__G.render.post` (fade, saturation, flash, wet), `__G.render.lightning(1)`.

## What exists

**render.js**
- HDR half-float scene target, MSAA from `quality.msaa`, internal size = canvas x `quality.scale`, capped per tier
  (1.0 / 1.6 / 2.4 / 3.8 million pixels). 14 full-screen passes per frame: 6 bloom downsamples (13 taps, partial Karis
  on the first), 5 tent upsamples, 1 metering pass (one pixel, log average, eased), grade, final.
- Bloom has no threshold: the picture is mixed with its blurred copy (`tune.bloom` 0.26), every step a convex mix.
- Grade: exposure x eye adaptation, ACES fit pulled 30 % toward a hue-keeping curve, teal shadows / warm highlights,
  S-curve, lifted teal blacks, saturation, vignette, fade, sRGB. Final pass: FXAA on stored luma, light sharpen, grain,
  dither. `post.wet` bends the edges of the frame like water on the eye.
- Sky shader on a box at the far plane: gradient, city glow, stars, moon (low in the west, on the street axis), one
  cloud deck lit by a second density sample toward the moon, sunrise colours in the east driven by `dawn`, sheet
  lightning. A PMREM of it is `scene.environment`, re-baked whenever dawn has moved 0.04.
- Lights: 1 hemisphere, 1 directional (moon sliding toward the sun), 8 pooled PointLights always in the scene (free ones
  at intensity 0, so programs never recompile). `lightPool.acquire / release / flash / lights / used()`.
- Fog colour and density, light colours, environment strength and exposure all follow `dawn`.
- `stats()`: `calls` and `tris` are the MAIN VIEW ONLY (what the other modules control). The mirror pass and the post
  passes are reported apart: `reflCalls`, `postCalls`, `totalCalls`.
- Extras beyond the contract: `render.prePasses` (functions run before the main view), `render.renderWorld(cam, target)`,
  `render.size`, `render.onResize(fn)`, `render.noiseTex`, `render.lightning(power)`; it listens to the `thunder` event.

**ground.js**
- 5 meshes: carriageway, two arcade floors, 140 kerb stones merged into one, a dark apron under everything.
  2 colliders (the arcade floors). Materials are clones of `granite_slab`, `tile_flower_a/b` with `onBeforeCompile`
  chained after the library's own hook.
- Puddle map 1024x96 computed on the CPU: two noise octaves, camber toward the gutters, 14 hand-placed basins; about a
  third of the carriageway is standing water. `isPuddle` and `wetnessAt` read the same array. When the material comes
  from mats, its height channel (`qlOrm.a`) is added, so joints and pits fill first.
- Rain rings: 3 layers of cells in the pixel shader, puddles only, fading out by 24 m.
- True planar reflection about y = 0 with an oblique near plane, half resolution on medium/high, full on ultra, off on
  low; mip-mapped. Puddles read it sharp, wet stone reads 7 taps blurred and stretched vertically.

**fx.js** (5 draw calls, 7 when sparks and the splash pool are active)
- 7000 rain streaks x `quality.rain`, 1100 ambient splash crowns, 48 pooled `splash()` crowns, 560 drip slots (up to
  360 found automatically along roof and awning edges, 200 for emitters), 360 soft sprites, 128 sparks.
- A top-down roof map (320x112 cells of 25 cm) rasterised from `G.physics.boxes`; rebuilt when the box count changes.
- `emitter(kind, pos, opts)`: `steam`, `mist`, `sparks`, `drip`. `opts.rate` MULTIPLIES the usual rate (1 = normal).
  A `drip` emitter less than 0.8 m above the ground pours like a downpipe (`opts.pour` forces it either way).
- fx emits `thunder` every 50 to 95 s while it rains (not in other modules' showcases).

**build.mjs**: esbuild IIFE, minified, three inlined; a missing module file becomes a throwing stub so the shell's
fallback still works; prints size and five checks.

## What is faked

- The "bounce of the shop lamps": one line added to three's `lights_fragment_begin` chunk. Below about 4 m every lit
  material also receives the hemisphere light's ground colour (warm). This is global and affects every module's
  materials. Scale with `tune.shopGlow`, 0 switches it off.
- Wet stone uses a low roughness for three's Fresnel maths and a separate blur for the mirror lookup; the bright part
  of the mirror picture is multiplied up (`ground.tune.boost` 1.6), because signs are modelled far dimmer than real.
- The environment map holds the sky plus six invented coloured lobes standing in for the street; it never contains the
  buildings, and its clouds do not move.
- Arcade floors (y 0.12) reuse the y = 0 mirror read 7 cm lower: far lights line up, feet of things standing on the
  tiles are off by a few centimetres.
- Rain, steam and splashes are not in the mirror. Soft sprites are neither sorted nor depth-faded against geometry.
- Rain only knows roofs that are colliders. Sparks bounce on the roof map, not on real geometry.
- No shadow maps anywhere.

## Unfinished / known problems

- Shell gap: `stubs.js` has no physics stand-in, so `show=render|mats|signs` died in boot. render.js installs the real
  physics as that stub at start-up.
- No fallback for a GPU without half-float render targets.
- Eye adaptation can be seen breathing when turning from a lit shop to the dark sky (`tune.autoSpeed`, `autoMax`).
- First use of sparks and of `splash()` compiles a program (a hitch of a few ms).
- Frame rate was read in headless Chrome with vsync: 60 at 1920x1080 on high and on ultra, 30 to 45 whenever a second
  screenshot ran beside it. No measurement of headroom beyond 60.
- `q=low` has no MSAA and no FXAA: thin cables alias into dashes.
- Dawn was checked at 0, 0.55 and 1 with still frames only, not as a five-minute run.
