# NOTES — mats (materials) and signs (lettering)

Files: `src/mats.js` (64 KB), `src/signs.js` (28 KB). Nothing else was edited. No image files, no `Math.random`, no network.

## What exists

### mats.js
- **40 material names** (every name in the contract; checked in the running game: none missing), made from **32 texture
  sets** by **24 surface shaders**. Unknown names return one shared neutral grey `MeshStandardMaterial` and warn once.
- Each set = 3 mip-mapped, seamlessly tiling maps made on the GPU on first `get()`: albedo (sRGB; alpha = tint amount, or
  glow mask on the emissive sets), ORM (r ao, g roughness, b metalness, **a height**), normal (from a 16-bit height).
  4 draws per set (surface into a 3-attachment scratch target, then albedo / ORM / normal passes).
- GLSL toolbox shared by all shaders: integer hash, periodic gradient noise, fbm (stretchable), voronoi, scratches,
  box SDF, anti-aliased coverage, and a paint / plaster damage model (flake, halo, wash-down run).
- Sizes follow `G.quality.tex`: the four floors, the two plasters and the brick at full size; 13 sets at half; 12 at a
  quarter. Above 1024 (q=ultra) only the four floors grow.
- Measured (`G.mats.stats()`), all 32 sets generated:

  | quality | texture memory | generation (CPU side) |
  |---|---|---|
  | low (512) | 44.6 MB | about 125 ms |
  | medium / high (1024) | 176 MB | 90 to 200 ms; 380 ms inside the full game; 2.7 s on the very first run (cold shader cache, two browsers running) |
  | ultra (2048 floors) | 368 MB | about 150 ms |

  Generation is lazy, so a level only pays for the sets it uses. The scratch targets are freed 3 s after the last set.
- Every material is a cached `MeshStandardMaterial` patched with `onBeforeCompile` (one shared program per mode):
  two broad octaves of world-space variation (hides tiling) and one fine octave that fades with distance (keeps
  close-ups crisp at cat height), a grime film pulled into crevices, and the rain look driven by `uniforms.wet` and the
  world normal: tops darker, more saturated and glossy, a standing film in joints and in broad patches, streaks on
  walls, a splashed dark band in the lowest half metre, undersides dry. `opts.interior` gets 12 %.
- The three floor tile sets store normals 4x steeper and scale them back in the material (granite 3x), because an 8-bit
  normal map cannot hold the 0.3 degree tilt each tile is laid with. That tilt is what breaks up reflections tile by tile.

API beyond the contract:
- `get(name, { interior, color, emissive, side, wet, rough, grime })`: `color` re-tints (plaster, wood, paint, plastic,
  ceramic, cloth, lantern); `emissive` multiplies the glow of the glass and lantern; cached per option set.
- `uniforms.glow` (default 1) scales every Manchurian window and lantern at once. `uniforms.wet` as in the contract.
- `textures(name)` -> `{ map, orm, normal, tile, size, normalScale }`; `prewarm([names])`; `stats().perSetMs`.
- `material.userData = { mats, tile, set, uniforms, patch }`. A module that clones a material must re-install
  `onBeforeCompile` itself (three does not copy it); `ground.js` already does, and it reads my fragment variable
  `qlOrm` (`.a` = height). Do not rename `qlOrm`.

Things other modules should know:
- `tileOf()` is one number; every set is square. Granite: 2.2 m tile, slabs 0.37 x about 1.1 m with the long side along V.
  Floor tiles: 0.8 m = 4 x 4 tiles of 20 cm. Manchurian glass: one sash panel per 0.6 m, frame on the tile border, so
  windows sized in multiples of 0.6 m with centred UVs fit exactly. Wood boards and bamboo run along V. Shutter slats
  run along U (7.5 cm pitch).
- Geometry UVs must be in metres. The shell's 80 m test floor has 0..1 UVs; both my showcases rescale it.

### signs.js
- `neon`, `lightbox`, `painted`, `plaque`, all with vertical text (`plaque` is horizontal only), `names` (the 11 shop
  names), `update(dt)`, plus `stats()`. Every object has `userData.size = [w, h, d]`, origin at the centre of the back face.
- All drawn on 2D canvas into shared 2048 px atlas pages (shelf packing, best fit): 79 signs in the showcase = 3 pages
  (64 MB with mips); the game's 99 signs = 4 pages (85 MB). Three shared materials per page kind.
- Neon: dark board with frame, slats and screws; tube = coloured glass stroke with a thinner near-white core (two font
  weights), glow pooled on the board; values 2.4 so the bloom catches it; a second additive quad is the soft halo.
  2 draw calls. About 28 % of signs (chosen by a hash of the text, or `opts.flicker`) breathe by 2.5 % and dip 10 to 24 %
  for 0.1 to 0.22 s every 4 to 10 s, eased; never a strobe.
- Lightbox: lit face with two soft tube bands, frame with screws, rule line, rain streaks and dust; faint halo. 2 draw calls.
- Painted board: brush lettering with carved shadow and raised edge, wood grain, gold rule border and studs, flaked
  and scratched paint. Plaque: blue enamel plate with chips and rusty screws. 1 draw call each, lit by the scene.
- Options beyond the contract: `neon(text, { w, h, flicker })` (`w`, `h` are limits the sign is scaled down to fit;
  `height` is the board height of a horizontal sign and the board width of a vertical one), `painted(..., { vertical })`,
  `plaque(text, { w, h, bg, fg })` (grows wider than 0.5 m for long text).

## What is faked
- Neon tubes are a flat drawing on the board (no depth). The halo is a picture, not light: it does not light the wall
  or the street, the level's pool lights do that.
- Lightboxes and neon are unlit (`MeshBasicMaterial`); their sides are a dark swatch.
- Painted boards and plaques glow at 14 % of their own picture so they stay readable at night; they have no normal map
  and no rain look.
- Manchurian glass is opaque: the "light inside" is a baked glow mask times the pane colour (peak about 2.0, deep
  colours so bloom keeps the hue). Nothing is seen through it. The lattice relief is only a normal map.
- The paper lantern's hot centre is a view-angle term, not a bulb.
- Brass and copper have metalness capped at 0.72 so they keep their colour under a dark sky.
- Rain is static: no running drops, no animation in the materials (the ground module animates the floors).
- `leaf` is a foliage mosaic for blobs and cards, not a single leaf with a cut-out. `bamboo` is a strip pattern that
  does not know the circumference of the pole it is on.
- Runtime variation uses a float hash and can differ slightly between GPUs; the baked textures use an integer hash.
- `genMs` is CPU-side time (program compile + draw submission); the GPU work itself is not waited for.

## Unfinished / known problems
- No triplanar mode and no alpha-cut materials: surfaces without metre UVs will stretch.
- Sign atlas pages are never freed and text cannot be changed after creation.
- Brush lettering uses the system's Kai / Weibei / Songti face, falling back to the contract's sans stack; the look
  depends on what the visitor has installed (checked on macOS only).
- `plaster_*` flakes repeat every 2.4 m; on a very large blank wall (the signs showcase) the repeat is visible.
- 176 MB of textures if a level uses all 40 names at q=high. Halving the 13 mid sets would save about 40 MB.
- First-run shader compile was 2.7 s once; later runs 0.1 to 0.4 s. I did not find out how much of the 2.7 s was mine.

## How to see it (page served at http://127.0.0.1:5208/dev.html)
- `?show=mats` — everything: 40 spheres + panels with labels in 4 rows, four 6 x 3 m floor patches with a lamp each
  (overview uses fov 40).
- Cat height (0.26 m above the patch, looking along it):
  - granite `?show=mats&cam=-6.0,0.28,3.7,-0.3,0.12,4.0`
  - tile_flower_a `?show=mats&cam=0.3,0.28,3.7,6.0,0.12,4.0`
  - tile_flower_b `?show=mats&cam=-6.0,0.28,7.0,-0.3,0.12,7.3`
  - tile_check `?show=mats&cam=0.3,0.28,7.0,6.0,0.12,7.3`
- Manchurian glass close up `?show=mats&cam=-5.6,1.2,-2.3,-5.6,0.45,-4.6`
- `&only=brass,copper,fish_salted` (one row of the named ones), `&wet=0` .. `1`, `&interior=1`, `&mats_maps=1` (raw
  albedo / ORM / normal above each), `&mats_lamp=14` (lamp strength), `&q=low|ultra`.
- `?show=signs` — a wall with all 11 names as neon, lightbox and painted board, each horizontal and vertical, and 13
  plaques. Close up: `?show=signs&cam=-7.6,7.3,2.3,-7.6,7.3,0`.
- Console: `__G.mats.stats()`, `__G.signs.stats()`, `__G.mats.uniforms.wet.value = 0`, `__G.mats.uniforms.glow.value = 1.5`.
- Pictures: `shots/mats_01.jpg`, `mats_cat_granite.jpg`, `mats_cat_fa.jpg`, `mats_cat_fb.jpg`, `mats_cat_ck.jpg`,
  `mats_r3.jpg` (glass), `signs_01.jpg`, `signs_c1.jpg`, `mats_game.jpg` (in the street).
