# NOTES_level — street layout, the cat, the overlay, the rules

Files: `src/level.js`, `src/player.js`, `src/hud.js`, `src/game.js`. Checked on 2026-11-10 against the real render, mats,
signs, physics, arch, props, ground, fx and audio modules: `dev.html?autostart=1` is ready with an empty `__errors`,
60 fps at 1920x1080 (q=high), 180 to 223 draw calls in total (89 to 110 main pass, the rest reflection and post),
about 561k triangles, 7 pooled lights. The last section, "Integration pass", lists what changed after all five modules
landed; the text below is kept up to date with it.

## What exists

**The street (`level.js`)**
- 14 buildings from `G.arch.building`: 5 on the south side, 5 on the north (turned 180 degrees), and 2 at each end turned
  across the street with `floor: true`, so both ends close with a lit arcade you can walk into but not through. Styles are
  mixed, 2 to 4 bays each, 2 or 3 upper floors. The north-east building is one upper floor only: the attic stands on it.
- 147 props, 148 sign objects (22 shops, each with one name: a board over the door, a neon or lightbox on the street
  face, a small lightbox hung across the walkway on two rods, some with a painted board down a column; box signs on
  the row buildings' blade anchors with their own iron arms, except through the scaffold; two-faced signs are one sign plus a clone, so no extra texture).
- A pendant lamp (cord, enamel shade, bulb) on every ceiling rose, 15 paper lanterns by doors, 5 strings of lanterns and
  5 cable spans across the street, bird cages, letter boxes.
- Level-built pieces: a bamboo scaffold with planks and a tarp, two air-conditioner cages with tin rain covers, the
  cornice ledge at 7.8 m, the attic (a dormer room rising from the low building's parapet, green tin roof, the
  `home_window` prop on its street face, a lantern, plants), fish strings and their bamboo poles, a party wall behind
  the low roof.
- Everything static (buildings, props, signs, my own geometry: 999 meshes) is baked into 88 meshes, one per material.
  Nothing is left unmerged except the three fish, their glows and strings.
- 524 colliders registered with `G.physics.addBox` (the parts' local boxes turned into world boxes).
- 175 lamp positions (`level.lights`): pendants, pier sconces, open-shop lamps, neon spill in the sign's colour, lantern
  strings, the fish, the home window. 7 lights from `G.render.lightPool` (one is left for flashes) go to the ones nearest
  a point 2.5 m ahead of the camera; a swap fades through zero.
- After the first frames (fx and audio boot later than the level): steam emitters over the pots, drips at the buildings'
  spouts, and the audio loops the AUDIO notes asked for (neon buzz, congee pots, gutters, rain on the awnings, the clock
  shop, a radio behind two shutters).
- `cinematicPath` (10 points, Catmull-Rom, 46 s) from the cat's start along the route to the attic window.

**The cat (`player.js`)**: eye 0.26 m, radius 0.14 m, height 0.3 m, field of view 78 degrees (83 when running), walk 2.2,
run 5.0, jump 9 m/s against 30 m/s2. Measured in the page: apex 1.35 m, 0.60 s in the air, a run-jump carries 3.00 m, a
tap gives 0.69 m. Coyote time 0.12 s, jump buffer 0.15 s, full control in the air. Footsteps every 0.36 m (0.6 m running)
with the surface name, a small head bob, a spring dip on landing, a slight roll into turns. Wetness: 12 s in the open
fills it, 5 s under cover empties it; at 1 the cat stops for one second, the camera shakes, droplets fly
(`G.fx.splash`), `cat:shake`, wetness back to 0.3. Position is clamped to the block; if the cat is ever inside a box it
is put back on the last safe spot. Mouse look with pointer lock, drag when the lock is refused, arrows left/right or J/L
turn, I/K look up and down, arrows up/down also walk. Touch: left thumb stick (pushed to the edge = run), right thumb
look, 跳 and 喵 buttons.

**The overlay (`hud.js`)**: three fish outlines that fill in with a pop, a wetness ring (turns pink and throbs above
0.78, with a short label), one hint line, a 喵 bubble, three whiskers at each screen edge on a spring that follows the
head turn, the title screen, pause, the ending card (rating, time, shakes, fish, 再来一次), a fade layer.

**The rules (`game.js`)**: `title | intro | playing | paused | complete`. A fish within 0.5 m of the cat's head is taken
(`fish:take`), the hint moves to the lowest fish still hanging; with three fish, standing within 1.15 m of the window
ends the game. `G.render.dawn` = play time / 300 s. `G.audio.setMood` 0.15 on the title, 0.25 + 0.22 per fish, 1 at
home. Ratings: 夜行大师 = 150 s or less with at most 1 shake; 机灵猫 = before dawn (300 s) with at most 4 shakes;
落汤猫 otherwise.

## The route, jump by jump

Heights are the walkable tops in the running game (read back from `G.physics.groundHeight`), "distance" is launch point
to landing point on the ground plan, "edge gap" is the open air between the two platforms.

| # | from (top y) | to (top y) | rise | distance | edge gap | note |
|---|---|---|---|---|---|---|
| 1 | street (0) | crate stack on the north kerb (0.92) | +0.92 | 0.62 | 0 | from the street side |
| 2 | crate stack (0.92) | crate on the tricycle's load (1.34) | +0.42 | 0.68 | 0.40 | |
| 3 | load (1.34) | awning A (2.25 where you land, 2.34 at the wall) | +0.91 | 0.56 | 0.25 | fish 2 hangs over the awning |
| 4 | awning A (2.25) | AC cover 1 (3.27) | +1.02 | 0.68 | 0 | the cage is solid, the tin cover is the step |
| 5 | AC cover 1 (3.27) | scaffold deck (4.24) | +0.97 | 0 | 0 | straight up through the planks (one-way) |
| 6 | scaffold deck (4.24) | balcony (4.20) | -0.04 | 0.84 | 0 | over the balustrade, 0.92 m high, 0.19 m thick; fish 3 inside |
| 7 | balcony (4.20) | crate stack on the balcony (5.12) | +0.92 | 0.69 | 0 | |
| 8 | crate stack (5.12) | AC cover 2 (6.12) | +1.00 | 0.79 | 0.43 | over the east balustrade |
| 9 | AC cover 2 (6.12) | window awning (6.97) | +0.85 | 0.35 | 0 (overlap) | up through the cloth |
| 10 | window awning (7.02) | cornice (7.80) | +0.78 | 0 | 0 | straight up through the one-way ledge |

Between 5 and 6 the cat walks 8.8 m along the scaffold deck (0.88 m wide) and round the building's down-pipe, which
comes up through the deck. After 10 it walks 8 m east along the cornice (0.6 m wide) to the attic window at x = 27 and
steps up 0.13 m onto the sill. Fish 1 hangs
from the drying rack in the south arcade at x = -12.1, its tail 0.79 m above the floor: walking under it is enough, a
hop takes it from a little further away. The largest rise is 1.02 m against an apex of 1.35 m.

How it was tested: `G.game.selfTest()` starts the game and plays every leg in `level.route.legs` with the real
controller at 60 steps a second (a small steering bot sets `player.bot`; picking up the fish and reaching home go through
the normal game code). Results in the full game with the real modules:

| run | result |
|---|---|
| walking | 3 fish, home, state `complete`, 29.8 s, 0 shakes, all 10 jumps landed |
| running (`{run: true}`) | same, 17.1 s |
| jump speed cut to 93 % (apex 1.17 m), no rain (`{jumpScale: 0.93, dry: true}`) | same: every jump still lands |
| 13 s standing in the open, then 6 s under the arcade | 1 shake at 12 s, wetness 0.3 after it, 0 after the shelter |

```sh
uv run --quiet --with playwright==1.56.0 --with numpy --with pillow python3 tools/shot.py "autostart=1&noaudio=1" shots/level_02.jpg \
  --js "JSON.stringify(window.__G.game.selfTest({}))"        # also leaves the ending card in the picture
```

## How to see each thing

| what | URL |
|---|---|
| the game from the title screen | `dev.html` |
| straight into play | `dev.html?autostart=1` (or `shot=1`, or `show=game`) |
| the street without the cat, camera on the title path | `dev.html?show=level` ; `lv_u=0..1` holds one point of the path ; `cam=x,y,z,lx,ly,lz` pins it |
| the cat alone in the street (no overlay) | `dev.html?show=player` ; `ppos=x,y,z` (feet), `pyaw=` and `ppitch=` in radians (yaw -1.5708 looks east) |
| each overlay screen with sample values | `dev.html?show=hud&hud=title` / `play` / `pause` / `end` ; `rating=落汤猫` |
| fewer pooled lights, brighter lamps | `lights=0..8` (default 7), `lv_light=1.3` |
| put the cat somewhere in the running game | `--js "window.__G.player.place(new window.__G.THREE.Vector3(21,7.8,-2.92), -1.5708, 0.05)"` |

Pictures: `shots/level_03.jpg` (start, with the overlay), `level_11.jpg` (cat's eye on the carriageway, luma 107),
`level_16.jpg` (north arcade, luma 126), `level_04.jpg` and `level_22.jpg` (tricycle, crates, awning), `level_08.jpg`
(AC cage and fish 2), `level_05.jpg`, `level_13.jpg`, `level_14.jpg` (scaffold, balcony, fish 3), `level_15.jpg`
(cornice), `level_06.jpg` (the attic), `level_09.jpg` (title), `level_17.jpg` (pause), `level_02.jpg` (ending card),
`level_19.jpg` (844x390).

## Differences from the contract, on purpose

- With real sizes the climb to fish 2 is crate stack, then a crate on the tricycle's load, then the awning (the bed
  itself is 0.53 m, lower than the stack). The awning hangs at 2.34 m.
- Fish 3 to home goes up at the balcony (crate stack, AC cover, window awning) and then east along the cornice; the box
  sign is no longer a step.
- The home window is at (27, 7.83 sill, -3.15), on the facade plane. `level.home.pos` keeps the contract's
  (27, 7.9, -3.4).
- Arrow keys: up and down walk, left and right turn (the contract says arrows move, the brief asked for arrows to turn).
- Every balcony's balustrade is solid here (ARCH gives them no collider): the cat hops over them.
- Thin level platforms (awnings, AC covers, scaffold, cornice) are one-way like the buildings' ledges.

## Faked or unfinished

- The cat is two front paws and a shadow, nothing else: no tail, no body in mirrors; the fish carried are only counted
  in the overlay.
- No person has played it: it was played by script (see the integration pass). Mouse look with pointer lock, the drag
  fallback and the touch controls were not exercised in a real browser session or on a phone.
- The building's down-pipe comes up through the scaffold deck (a hole is cut in the planks); it has a collider and the
  cat walks round it.
- The fish glow is a sprite with a generated gradient texture (three extra draw calls); the string stays after the fish
  is taken.
- Dressing is a hand-written table of positions; props are not checked against door thresholds or each other.
- The title camera flies a fixed path and passes close to a table and a stool near its start.
- The ending camera is a fixed view from in front of the window.
- With stub buildings or props the level still builds (its own balcony slabs, ledge and pendants), but that path was
  last run before the real modules landed.
- Shop names beyond the contract's eleven are my own inventions (三姑糖水, 兴隆杂货, 巧姐裁缝, 顺发单车行, 金声唱片, 榕记花店, 福记烧腊,
  阿珍双皮奶, 荣记修鞋, 德叔凉果, 泮塘马蹄糕).

## Integration pass (after all five modules landed; I could edit every file)

1. **Sound in the world.** `level.js` registers the loops the AUDIO notes asked for, on the first frames (audio boots
   after the level): neon buzz at every neon sign and neon box sign, the congee pots, gutter pour at the buildings' spouts,
   rain on the two awnings, the clock at 同福钟表, a radio behind two shuttered shops. `player.js` feeds `setShelter` while
   the cat is played, `game.js` feeds it from the camera on the title and ending screens; `setMood` follows the fish count.
   In the running game: `audio.debug()` gives 58 loops registered, 19 playing, `bad: []`; `await audio.selfTest()` gives
   peak 0.67, RMS 0.1145, 0 clipped, 0 NaN.
2. **Other modules' loose ends.**
   - Vertex-colour dirt is on: `mats.get(name, { vc: true })` returns a vertex-coloured twin of a library material
     (`mats.js`), the arch/props kit asks for it for everything but the glowing panes (`arch.js`), and the level uses the
     same twins for its own geometry, so the bake still gives one mesh per material (79 of the 88 merged meshes carry
     colours). Seen as darker feet on crates, piers and walls; mean luma of a street frame drops from 102 to 97.
   - Rails: every balcony's balustrade now has colliders (front and both ends), not only the one on the route.
   - The dev page asked for `/favicon.ico` (a 404). `main.js` now draws the tab icon on a canvas, so neither the dev page
     nor the built file requests anything.
3. **Paws and shadow** (`player.js`): two ginger forelegs with cream toes (one shared geometry, vertex colours, 2 draw
   calls) hang from the camera and reach into the bottom of the frame when running (a gallop, one a little ahead) and when
   jumping (both forward, tucked on the way down); hidden when standing and walking. A soft cat-shaped shadow (ears, head,
   body, tail; a canvas texture) lies on the floor under the cat, thrown slightly forward so the ears show at the bottom
   of the view; it fades and grows with height in a jump. `paws=0` and `pshadow=0` switch them off.
4. **Played by script, like a person.** A driver (`--js`, kept in the notes below as a recipe) clicks 开始 on the title
   screen, waits for the intro, then plays with real `keydown` / `keyup` events on real frames: arrows to turn, W A S D
   relative to where the cat looks, Space held for jumps, E for a meow. First run: the cat fell off the 0.3 m ledge between
   the first AC cage and the scaffold, which then began only after the down-pipe. Fixes: the scaffold deck now starts
   above the AC cage and runs to the balcony, 0.88 m wide, with the pipe as an obstacle to walk round; the cornice to the
   attic is 0.6 m wide instead of 0.43; three hints were reworded to say where to go next. Second run: title > playing,
   three fish, home, ending card on screen (夜行大师, 0:33, 0 shakes), 36 s of real time, no errors.
5. **Showrooms.** `?show=render|mats|signs|arch|props|ground|level|fx|audio|player|hud`: each ready, `__errors` empty
   (`shots/show_sheet.jpg` is all eleven on one sheet).
6. **Build.** `node tools/build.mjs`: all five checks pass. `dist/index.html` and `release/qiloumao.html` are the same
   1,057,768 bytes. Both run `?autostart=1` with empty errors, no stubs, zero entries in
   `performance.getEntriesByType('resource')`, and the scripted route completes inside the built file. In play at
   1920x1080 on the M4 (headless Chrome, q=high): 60 fps, 560,884 triangles, 110 draw calls in the main view at the start
   position (223 with the mirror and post passes), 96 / 195 in the middle of the street. Own source: 6,030 lines in 16
   files (`wc -l src/*.js`).

Pictures from this pass: `shots/level_p1.jpg` (paws, running), `level_p2.jpg` (paws, jumping), `dist_03.jpg` (release
build, the shadow's ears at the bottom edge), `level_13.jpg` (the wide scaffold), `level_play.jpg` (ending card after the
key-driven run), `dist_01.jpg`, `show_sheet.jpg`.

The key-driven run, for whoever changes the route next (the driver reads `level.route.legs`, so it follows the layout):
it turns with ArrowLeft / ArrowRight until the nose is within 0.06 rad of the next point, holds W, taps A / D to get back
on the line or for the last half metre, holds Space for a jump leg and steers the same way in the air. It reports the leg
it failed on and where the cat ended up.
