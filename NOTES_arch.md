# NOTES_arch — buildings (`src/arch.js`) and props (`src/props.js`)

Checked on 2026-11-10 against the real render, mats, signs, ground and level modules: zero errors in `show=arch`,
`show=props` and the full game (`shot=1`: 535k triangles, 76 to 98 draw calls, 60 fps at 1600x900).

## For LEVEL (things that differ from the stubs)

- `arch.building(o)` also accepts `floor: true` (adds a tiled arcade floor, for showcases; the ground module owns the real one),
  `balconies: [[floor, bay], ...]` (0 = first upper floor) to force where balconies go, and `colors: {wall, trim, wood, iron,
  glass: [a, b]}` (material names). `floors` = number of UPPER floors, as in the stub (height to the cornice = 4.2 + floors * 3.6;
  `userData.size[1]` includes the parapet or pediment). `side` only changes the seed; mirror or rotate the group yourself.
- `userData.anchors`:
  - `signs`: `kind: 'fascia'` over each shop (z = 2.715, under the arcade) AND on the street face of the first upper floor
    (`face: 'street'`, z <= -0.28; on the balcony front when that bay has a balcony). `kind: 'hanging'` under the arcade
    (normal along x; no rods are modelled). `kind: 'vertical'` with `mount: 'column'` (flat on a column's street face) or
    `mount: 'blade'` (no brackets are modelled).
  - `lamps`: one ceiling point per bay (y = 3.95; a brass ceiling rose is modelled there, the level hangs the pendant).
  - `sconces`: the building's own glowing lights on the inner face of each pier (emissive only; add real lights if you like).
  - `balconies`: `{min, max}` = the slab box (max.y = the walkable floor, 4.2 + floor * 3.6), plus `floor`, `bay`, `rail`.
  - `ledges`, `spouts` (downpipe outlets, for water fx), `windows` (`lit`, `state`, `floor`, `bay`, `door`), `shopDoors`
    (`type`, plus `gap` for a half-raised shutter, `depth` and `lamp` for an open shop).
- Colliders: ledges, balcony slabs, the modern style's "eyebrow" slabs and awning tops are `oneWay: true` (jump up through,
  land on top). Balcony railings have NO collider: a cat slips between the balusters. Open shops are enterable (floor, side
  walls, counter, shelves at the back). Air-conditioner boxes on the facade are small platforms.
- Facing (matches how level.js mounts things today): wall-mounted props (mailbox, ac_unit, awning, home_window) face **+Z**
  with their back on **-Z**; floor-standing props with a front (shelf_goods, congee_stall, urn_copper, pot_steaming) face
  **-Z** (back toward +Z), like the buildings. Origin is the bottom centre of the prop. The awning's y = 0 is the middle of
  its sloping top (high at the wall, -Z); its colliders are four one-way steps.
- `props.build(name, opts)` extras in `userData`: `hooks` (drying_rack: where to hang fish), `hang` (lanterns, birdcage,
  salted_fish: the top point), `steam` (congee_stall, pot_steaming: pot mouths), `lamp`, `seat` (home_window cushion), `spout`.
  Options: `seed`, `interior` (asks mats for the under-the-arcade variants), `w` / `d` / `h` where it makes sense
  (awning, bench, planter, shelf, kerb, crate, drainpipe), `length` (= `w` for lantern_string and cable_span),
  `color` (awning: red / green / stripe; plastic stool: blue), `n` (crate_stack 2 to 4), `fish` (drying_rack: pre-hung,
  non-pickup fish, default 0). The tricycle keeps the front half of its bed empty (the level puts a crate there).
  `props.merge(objects)` bakes placed props into one mesh per material (static batching, not used by the level today).
- One private material: `arch_glow` (unlit `MeshBasicMaterial`, vertex colours, HDR values) for lamp bulbs, flames and the
  baked-light shop interiors. It is shared by every building and prop, so it merges to one draw call.

## What exists

**Buildings** — one function, four styles, any number of bays and floors, deterministic per seed (240 combinations of
style x 1..5 bays x 1..4 floors x 3 seeds built without an error, about 7 ms each).

| style | arcade | upper floors | top | colours | triangles (3 bays, showcase) |
|---|---|---|---|---|---|
| nanyang | elliptical arches, imposts, keystones, panelled piers | pairs of arched windows with fanlights, giant pilasters, apron panels, baluster balconies on scroll consoles | dentil cornice, balustraded parapet with ball finials, curved pediment (山花) with a stained-glass oculus | teal, pink or cream wall, cream or teal trim, red wood | 26,096 (3 floors) |
| baroque | taller near-round arches with roundels | venetian window (arched centre, two side lights, pediment hoods), pilasters per floor, oval medallions | dentil cornice, urns, scrolled broken pediment with an oculus | pink, cream or teal, dark wood | 27,952 (2 floors) |
| modern | flat lintels with rounded corners and speed lines | ribbons of three steel windows under walkable concrete eyebrows, pipe-rail balconies, fins | stepped Art Deco parapet with a glowing fin | cream, teal or pink, green steel | 11,606 (3 floors) |
| plain | flat lintels on corbels, concrete dado | pairs of square windows with lintels, brick bands, iron-railing balconies, air conditioners | corbelled cornice, parapet with a small gable and oculus | grey brick or stained plaster | 11,138 (2 floors) |

Largest 3-bay building met in the test: 45,794 triangles, 15 meshes (a baroque with several balconies). Typical: 12 to 15
meshes (wall, trim, granite, cream ceiling, two woods, two coloured glasses, dark glass, shutter metal, iron, brass, glow,
plus brick for a 趟栊 bay and blue tile for a glazed bay). The level merges them further.

Ground floor per bay: `shutter` (real corrugation, guides, housing, bottom bar, handles, padlock; 30 % are half raised with
light under them), `open` (a 2.4 m deep lit shop: checker floor, dado walls, shelves of goods, counter with jars, sacks,
tub, pendant bulb, the shop's board shutters stacked at the jamb), `tanglong` (grey brick bay, granite frame and threshold,
door brow, the three layers: low half-doors with spindles, one ajar; sliding grille of 13 round bars; board doors open
inside; a lit hall; a barred coloured-glass window) and `glass` (timber shopfront: blue tile riser, mullions, a lit display
of clocks, jars or frames with two red lanterns, coloured-glass transom, door with kick plate and brass handle).
Also: beamed ceiling, ceiling roses, sconces, meter boxes with conduit, fascia and cornice over the shops, downpipes with
hopper heads, pier plinths in two granite steps.

**Props** — 28 names, all built (triangles / meshes):
bench_bamboo 1338/2, stool 300/2 (even seed: bamboo, odd: plastic), crate_wood 360/2, crate_stack 912/3, basket 1356/3,
tricycle 4532/6, bicycle 2690/3, planter 1046/4, potted_plant 832/4 (three kinds), lantern_paper 304/4,
lantern_string 1740/5 (2.4 m; lanterns plus coloured festoon bulbs), awning 378/2, drying_rack 2856/3 (with 3 fish),
salted_fish 484/2, congee_stall 6310/10, pot_steaming 904/5, urn_copper 2046/2, shelf_goods 676/6, mailbox 120/4,
ac_unit 600/5, drainpipe 188/1, cable_span 888/3, trash_bin 1120/2, umbrella 416/3, birdcage 2078/5, table_folding 1364/5,
home_window 958/8, kerb_stone 16/1. One of each: 36,812 triangles, 105 meshes. Geometry is cached per (name, options) and
shared between instances. Unknown names give a 0.5 m grey box with a collider.

## What is faked

- Lit interiors (open shops, 趟栊 hall, shop displays, the room behind `home_window`) are unlit geometry with a per-vertex
  lamp falloff baked into vertex colours. No light is spent on them; from very close they look flatter than the textured street.
- Upper windows are opaque emissive panes (the mats lattice), no rooms behind. The glazed shopfront has no sheet of glass.
- Buildings are shells: side walls, back wall and a flat roof, nothing on the roof.
- Colliders are boxes: an arch is a box from halfway up its rise, the awning slope is four steps, the bicycle is a thin wall.
- Vertex-colour dirt is written only for materials with `vertexColors`; the mats materials do not use it, so today all the
  wear comes from the mats shaders.

## Unfinished / known problems

- Up to 15 meshes per building, above the 12 asked for (the level's static merge hides this).
- The modern style's cream-and-teal version reads a little plain next to the other three.
- The plastic stool is rough; props vary little by seed apart from the kinds listed above.
- `home_window` expects to sit in a hole about 1.24 x 1.5 m (the level cuts one); on a blank wall its back panel shows.
- The level hangs its own pendant lamps and box signs, so buildings no longer model lamps at `anchors.lamps`, sign rods or
  blade brackets (only the anchors remain).

## How to see it

Page: `http://127.0.0.1:5208/dev.html?` plus:

- `show=arch` — four buildings in a row, one per style, with signs on the anchors.
  `only=nanyang` (or `baroque`, `modern`, `plain`, comma list), `arch_bays=3`, `arch_floors=3`,
  `arch_shop=shutter.tanglong.open` (per bay, dot separated), `arch_nosigns=1`, `arch_debug=1` (colliders: red solid, green
  one-way), `arch_seedcolors=1` (let the seed pick colours), `seed=`.
  Cat's view under the arcade: `show=arch&only=nanyang&cam=-5.6,0.38,1.2,6,1.5,2.4`.
- `show=props` — all 28 with name plates. `only=tricycle` shows one from cat height; `only=a,b,c` shows a row;
  `props_seed=2` changes the seed (bamboo stool), `props_debug=1` draws colliders.
- Pictures: `shots/arch_01.jpg`, `arch_front1/2.jpg`, `arch_cat1/2/3.jpg`, `arch_level1/2.jpg` (in the game),
  `shots/props_01.jpg`, `props_a..d.jpg`, `props_tricycle.jpg`, `props_congee.jpg`, `props_home.jpg`.
