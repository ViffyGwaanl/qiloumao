# 骑楼猫 (Qilou Cat) — build contract

One self-contained HTML file. No image files, no audio files, no model files, no network requests: every texture, model,
sign, sound and note of music is produced by code when the page loads. Engine: three.js r180 (inlined at build time).
Several agents build it in parallel, one module each. This file is the only thing they share. Do not change it; if it is
wrong or missing something, write your note in `NOTES_<yourmodule>.md` and work around it.

## The game in one paragraph

A rainy night on a Xiguan arcade street (西关骑楼街) in old Guangzhou. You are a cat, seen in first person from 26 cm above
the ground. Before dawn, find the three salted fish (咸鱼) hung out along the street, each one higher than the last
(a low drying rack; the top of an awning reached over crates and a cargo tricycle; a second-floor balcony reached from the
awning and a shop sign), and carry them home to the lit attic window at the east end. Cats hate rain: out in the open your
wetness meter fills, and when it is full you stop and shake for a second; the arcades and awnings keep you dry. The sky
brightens slowly over about five minutes; the ending card gives your time and a rating. No enemies, no violence.
It must be original: do not copy the look, level, names or characters of any existing game.

## Look (art direction, everyone follows it)

- Bright, saturated, alive. Night, but never murky: warm shop light, neon and lightbox signs, stained-glass windows and
  paper lanterns everywhere, all mirrored in the wet ground. A typical gameplay frame has mean luma >= 90/255 and looks
  colourful at thumbnail size. Dark, grey or washed-out frames are a failure.
- The camera is a cat's: the floor fills the lower half of the frame, so the wet floor is the hero surface: patterned
  cement tiles (花阶砖) under the arcades, granite slabs (麻石) on the street, puddles, rain rings, sharp and blurred reflections.
- Palette: night sky and shadow `#0c1420` to `#16283a`; warm tungsten `#ffb86b`; neon red-pink `#ff4d6d`, jade `#3ddc97`,
  amber `#ffc24a`, cyan `#48d1ff`; stained-glass panes in saturated red, blue, green, yellow, violet; plaster walls in
  cream, teal and faded pink; dark red wood.
- Lingnan details, modelled properly, never white boxes: arcade columns and arches, cornices and pediments, Manchurian
  windows (满洲窗: wooden lattice with coloured glass, lit from inside), sliding wooden bar doors (趟栊门), bamboo chairs,
  copper herbal-tea urns, a congee stall with steaming pots, a cargo tricycle, bicycles, potted plants, paper lanterns,
  awnings, roll-up shutters, downpipes pouring rain water, overhead cables, air-conditioner boxes.
- Text on signs is Chinese, invented shop names only (no real brands, no flags, no logos of real companies):
  陈记粥铺、西关凉茶、珠玑士多、阿婆云吞面、月明茶楼、光明理发、同福钟表、蓬莱照相馆、荔湾艇仔粥、和记五金、永春堂药材.
- Everything is in metres. Real proportions.

## World layout (fixed, so modules agree)

- +X runs along the street (east), +Z across it (south), +Y up. Street centre line z = 0. The block spans x from -30 to 30.
- Carriageway: z from -3.2 to 3.2, ground y = 0 (granite slabs, puddles, open to the rain).
- Arcade walkways: z from 3.2 to 6.2 (south side) and -6.2 to -3.2 (north side), floor y = 0.12 (a kerb), roofed by the
  buildings' upper floors (ceiling at y = 4.2), dry.
- Column line at z = +-3.4 (columns 0.5 m square, one every 4 m: bays are 4 m wide, 15 bays per side).
- Shopfront line (the wall with doors and shutters) at z = +-6.2. Buildings run back to z = +-12 and are 3 or 4 storeys
  (storey height 3.6 m above the 4.2 m arcade). Upper facades stand over the column line (z = +-3.4).
- Player start: (-26, 0.12, 4.7) under the south arcade, facing +X. Home: the lit attic window at (27, 7.9, -3.4), north
  side, second floor, reached along the north balconies (balcony floor y = 4.2, depth 1.0 m, from z = -3.4 to -4.4... see level).
- The cat: eye height 0.26 m, body radius 0.14 m, height 0.3 m, walk 2.2 m/s, run 5 m/s, jump apex 1.35 m (run-jump
  covers 3 m), can stand on anything flat that is at least 0.25 m wide.

## Files and ownership

```
qiloumao/
  CONTRACT.md            this file (read only)
  dev.html               development page: loads src/main.js as ES modules, three from vendor/ (shell, already written)
  src/main.js            boot, context object G, module loader with fallback stubs, main loop, test hooks (shell)
  src/stubs.js           do-nothing stand-ins for every module (shell)
  src/util.js            rng, events, small maths, geometry merge helpers (shell; anyone may ADD functions at the end)
  src/render.js          CORE agent: renderer, HDR post chain, sky, fog, exposure, light pool, quality tiers
  src/ground.js          CORE agent: street and arcade floors, planar reflection, puddles, rain rings
  src/physics.js         CORE agent: box colliders, cat body mover, raycast
  src/fx.js              CORE agent: rain, splashes, drips, steam, fireflies, sparks
  src/mats.js            MATS agent: procedural material library (GPU-generated texture sets)
  src/signs.js           MATS agent: neon signs, lightboxes, painted and stencilled text (2D canvas)
  src/arch.js            ARCH agent: parametric arcade buildings
  src/props.js           ARCH agent: street props
  src/level.js           LEVEL agent: lays out the street, lights, fish, home, colliders, camera path
  src/player.js          LEVEL agent: input (keyboard + mouse, touch), cat controller, wetness
  src/hud.js             LEVEL agent: DOM overlay, title, pause, ending card
  src/game.js            LEVEL agent: mission state machine
  src/audio.js           AUDIO agent: every sound and the music, synthesised sample by sample
  tools/shot.py          take a screenshot of any URL query and print errors, stats and brightness (shell)
  tools/build.mjs        CORE agent: bundle everything into dist/index.html (one file, three.js inlined)
  NOTES_<module>.md      each agent's notes: what is done, what is faked, known problems, how to see it
```

Only edit the files you own. Everything is plain ES modules, no TypeScript, no frameworks, no CDN, no `fetch`, no images,
no `data:` URIs of media. `import * as THREE from 'three'` works in dev (import map) and in the build.

## How to run and look at your work (use this constantly)

The page is served at `http://127.0.0.1:5208/dev.html`. Take a picture with:

```sh
cd <repo>/qiloumao && uv run --quiet --with playwright==1.56.0 --with numpy --with pillow python3 tools/shot.py "show=mats" shots/mats_01.jpg
#   optional: --size 1920x1080  --wait 2.5 (seconds after ready)  --js "window.__G.something()"  --cam "x,y,z,lx,ly,lz"
```

It prints: ready or not, `window.__errors`, console errors, `window.__stats()`, and the picture's mean luma and mean
saturation. Then LOOK at the picture with the Read tool. Work in a loop: write a piece, shoot it, look, fix. Never report
something as done that you have not looked at. Only 2 screenshots run at once across all agents (the tool queues).
Keep your pictures in `shots/<module>_*.jpg` (overwrite old ones; keep the folder small).

URL parameters (implemented by the shell): `show=<module>` (your showcase alone on a test floor, other modules stubbed
unless they exist), `cam=x,y,z,lx,ly,lz`, `fov=`, `shot=1` (skip menus, low-cost settings where sensible), `autostart=1`,
`q=low|medium|high|ultra`, `seed=`, `dt=` (fixed step), `noaudio=1`, `only=<comma list>` (module-specific filter you may read
from `G.params`). Add your own module-specific parameters with your module's prefix and document them in your notes.
Globals: `window.__G` (the context), `__ready` (true after 2 frames), `__frames`, `__errors` (array of strings),
`__fatal`, `__stats()`, `__setShot({cam, fov})`.

## The context object G and the module interface

Every module file exports:

```js
export async function create(G) { ...; return api; }       // build the module; may read G.<earlier modules>
export async function showcase(G) { ...; return { cam: [x,y,z], target: [x,y,z], update(dt) {} }; }  // a test scene for ?show=<name>
```

`G = { THREE, params, quality, rng, events, time: {t, dt, frame}, renderer, scene, camera, render, mats, signs, physics,
       arch, props, ground, level, fx, audio, player, hud, game }`

Boot order: render, mats, signs, physics, arch, props, ground, level, fx, audio, player, hud, game. A module may use any
module before it in that order, and must survive a later or broken one being a stub (`api.stub === true`).
Per frame the shell calls `update(dt)` on: player, game, level, ground, fx, mats, signs, audio, hud, then `render.frame(dt)`.
`G.events`: `on(name, fn)`, `off`, `emit(name, data)`. `G.rng`: seeded generator with `()`, `.range(a,b)`, `.int(a,b)`,
`.pick(arr)`, `.fork()`. Do not use `Math.random` for anything visible: every visitor should get the same street.

### render (CORE)
`{ renderer, scene, camera, sunDir, exposure, tune: {...numbers the post chain reads each frame}, post: { fade, saturation,
flash, wet }, lightPool: { acquire() -> PointLight | null, release(l), flash(pos, color, intensity, life) }, env (PMREM of
the sky), dawn (0 night .. 1 sunrise; game sets it, sky/fog/exposure follow), setQuality(q), resize(), frame(dt), stats() ->
{calls, tris, tex, programs, fps}, onLevelReady() }`. HDR target, bloom that makes neon glow, filmic tone curve, gentle
grade, vignette, grain, FXAA. URL switches `post=0`, `bloom=0`. A night sky with moonlit cloud and distant city glow, drawn
by a shader (no texture files). Hard limits for everyone: at most 8 real PointLights/SpotLights alive at once (ask the
pool); everything else that "glows" is emissive material plus bloom.

### mats (MATS)
`{ get(name, opts) -> THREE.MeshStandardMaterial (cached), names: [...], emissive(color, intensity) -> MeshBasicMaterial,
uniforms: { wet: {value: 1} }, tileOf(name) -> metres per texture repeat, stats() -> {sets, textureMB, genMs}, update(dt) }`
Textures are generated on the GPU (shader -> render target: albedo, roughness/metalness/ao, normal), tiling in world units
(geometry UVs are in metres; helpers in util.js make boxes with metre UVs). Names that must exist:
`granite_slab, tile_flower_a, tile_flower_b, tile_check, plaster_cream, plaster_teal, plaster_pink, plaster_stained,
brick_grey, concrete, wood_dark, wood_red, bamboo, metal_shutter, metal_green, metal_rust, steel, brass, copper,
ceramic_white, ceramic_blue, glass_dark, glass_manchu_a, glass_manchu_b, glass_manchu_c, glass_manchu_d (emissive coloured
panes in a lattice, lit from inside, flicker-free), awning_red, awning_green, awning_stripe, paper_lantern (emissive warm),
rubber, plastic_red, plastic_blue, cardboard, fish_salted, leaf, soil, rope, cloth_white, cloth_blue`.
Wet look: surfaces facing up get darker and glossier with `uniforms.wet`; `opts.interior = true` (under the arcade) gets
only a little. Unknown names return a neutral grey material, never throw.

### signs (MATS)
`{ neon(text, {color, height, vertical}) -> THREE.Object3D (glowing tube letters on a dark board, with its own soft halo),
lightbox(text, {w, h, bg, fg, vertical}) -> Object3D (lit from inside), painted(text, {w, h, color, bg}) -> Object3D
(hand-painted shop board), plaque(text) -> Object3D, names: [...the shop names...], update(dt) (subtle neon flicker) }`
Each returned object has `userData.size = [w, h, d]` and its origin at the centre of its back face. Text is drawn with the
2D canvas and the system fonts `"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`.

### physics (CORE)
`{ boxes: [], addBox({min: Vector3, max: Vector3, surface: 'stone'|'tile'|'wood'|'metal'|'cloth'|'water', oneWay?}) -> box,
removeBox(box), build(), groundHeight(x, z, yFrom) -> y of the highest box top at or below yFrom (0 if none),
moveBody(pos, vel, radius, height, dt) -> { onGround, surface, hitWall }, raycast(origin, dir, maxDist) -> {dist, point,
normal, box} | null, shelterAt(x, y, z) -> true if something is overhead within 12 m }`

### arch (ARCH)
`{ building({ bays: 3, floors: 3, style: 'nanyang'|'baroque'|'modern'|'plain', seed, side: 1 | -1, shop: [...per-bay shop
types: 'shutter'|'open'|'tanglong'|'glass'], colors: {...} }) -> THREE.Group, styles: [...] }`
A building is built in its own space: x from 0 to bays*4, the column line at z = 0, the shopfront wall at z = +2.8, the back
at z = +8.6, ground at y = 0, arcade floor at y = 0.12; the level places and mirrors it. `group.userData = { size, colliders:
[{min, max, surface}] in local space, anchors: { signs: [{pos, normal, w, h, kind: 'fascia'|'hanging'|'vertical'}],
lamps: [{pos}], balconies: [{min, max}], windows: [{pos, w, h}], shopDoors: [{pos, w, h, type}] } }`. Walkable balconies
have colliders. Meshes merged per material (keep draw calls low).

### props (ARCH)
`{ build(name, opts = {seed, ...}) -> THREE.Group with userData.size and userData.colliders (local space), names() }`
Names that must exist: `bench_bamboo, stool, crate_wood, crate_stack, basket, tricycle, bicycle, planter, potted_plant,
lantern_paper, lantern_string, awning, drying_rack, salted_fish, congee_stall, pot_steaming, urn_copper, shelf_goods,
mailbox, ac_unit, drainpipe, cable_span, trash_bin, umbrella, birdcage, table_folding, home_window, kerb_stone`.
`salted_fish` is the pickup (about 0.35 m, hung on a string, slowly turning is done by the level). `home_window` is an open
Manchurian window with a cushion on the sill and warm light. `awning` takes `{w, d, color}` and has a walkable cloth top.
An unknown name returns a correctly sized grey box, never throws.

### ground (CORE)
`{ root, setRain(0..1), setReflections(bool), isPuddle(x, z) -> bool, wetnessAt(x, z) -> 0..1, update(dt) }`
Builds the carriageway (granite, puddles, rain rings) and the two arcade floors (patterned tile, damp sheen) and the kerbs.

### level (LEVEL)
`{ root, playerStart: {pos, yaw}, fish: [{pos: Vector3, taken: false, object}], home: {pos, radius}, lights: [...],
cinematicPath: [{pos, look}], hints: [...], stats: {...}, update(dt) }`. Registers every collider with `G.physics.addBox`.

### fx (CORE)
`{ root, emitter(kind, pos, opts) -> {stop(), setPos(v)} with kinds 'steam' | 'drip' | 'sparks' | 'mist', splash(pos, size),
puff(pos), setRain(0..1), update(dt), stats() }`. Rain streaks follow the camera and do not fall under roofs
(`G.physics.shelterAt`). Splash crowns on open ground.

### audio (AUDIO)
`{ ctx, ready (Promise), names: [...], play(name, {pos, gain, rate}) , loop(name, {pos, gain}) -> {setGain, setPos, stop},
setShelter(0..1) (0 open rain, 1 under a roof), setMood(0..1) (music layers), setPaused(bool), setVolume(v), resume(),
selfTest() -> Promise<{peak, rms, clipped}>, update(dt) }`. Listens to `G.events`: `cat:step {surface, run}`, `cat:jump`,
`cat:land {surface, speed}`, `cat:meow`, `cat:shake`, `cat:purr`, `fish:take {index}`, `game:start`, `game:complete`,
`ui:click`, `thunder`. Must also work when nothing else exists (`show=audio` draws meters and plays everything in turn).

### player (LEVEL)
`{ pos, vel, eye, yaw, pitch, wet (0..1), carrying (0..3), enabled, onGround, speed, reset(), update(dt) }`. Emits the
`cat:*` events above. Controls: WASD / arrows move, mouse look (pointer lock, with a drag fallback), Shift run, Space jump
(hold for a higher jump), E or click to meow, touch: left thumb stick, right thumb look, buttons for jump and meow.

### hud / game (LEVEL)
DOM overlay only (no images): fish counter, wetness ring, a short hint line, title screen (骑楼猫, a one-line blurb, 开始),
pause, ending card (time, wetness shakes, rating names: 落汤猫 / 机灵猫 / 夜行大师). `game = { state, start(), update(dt) }`,
states `title | intro | playing | paused | complete`. The title screen flies the camera along `level.cinematicPath`.

## Quality bar

- It runs at 60 fps at 1920x1080 on an Apple M4 at `q=high`: under 300 draw calls, under 1.5 million triangles, at most
  8 dynamic lights, no shadow maps unless you can afford one. Merge geometry per material; instance repeats.
- Zero console errors and an empty `window.__errors` in your showcase and in the full game.
- Deterministic: the same seed gives the same street, the same sounds.
- Every module has a showcase that shows everything it makes, so a person or an agent can check it at a glance.
- Write your `NOTES_<module>.md` last: what exists (with counts), what is faked, what is unfinished, and the exact
  `show=` URLs and parameters to see each thing.
