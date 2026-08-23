# HobunjiHollowUnity

Portrait system scaffold imported from `Oolnokk/ScratchbonesGame` (source commit `c5253f18223b425ec0ebbb39295b7b3fae452d8e`) with game-specific runtime/screens excluded.

## Imported portrait scaffold

- `docs/js/portrait-utils.js` and `docs/js/portrait-breathing.js` runtime code.
- `docs/config/species/**`, `docs/config/cosmetics/**`, and `docs/config/animations/breathing-default.json`.
- Portrait-related assets under:
  - `docs/assets/fightersprites/**`
  - `docs/assets/portraitsprites/**`
  - `docs/assets/cosmetics/**`
  - `docs/assets/hud/spriteopacitymask_cloud.png`

## Dev tools (docs/tools/)

The game is `docs/index.html` (+ `docs/game.js`, `docs/onboarding.js`). All tools target the game's real data interfaces:

- `docs/tools/map-editor/` — agnostic grid map editor with two categories (exterior / interior) for the farm, town, wilderness zones, and house interiors. Supports tiles, crops, world objects, processing furniture, decor, shared NPC Routes, legacy NPC path import compatibility, and map-to-map transition spots. Sends linked maps to the game as `hobunji_farm_layout_v3` (localStorage) and exports `hobunji_map.v1` JSON. The game consumes `routes` as shared navigation infrastructure, keeps `npcPaths` only as legacy data, and uses NPC schedules to pick target positions; NPCs beeline unless blocked, use Routes around blockers, and leave Routes once they stop improving progress toward the target. `transitions` remain gold ring markers that warp the player between maps.
- `docs/tools/character-studio/` — merged appearance + NPC database editor. Edits `appearance`, `equippedCosmetics`, `appliedDyes`; can write directly to the game's `hobunjiPlayerProfile` ("Set as my player"); manages `hobunji_npc_database.v2` records with live portrait and 3D PNG-plane previews.
  NPC records may also set `restingExpression` to one of the expressions configured in `game.portrait.expressions.available`. Dialogue lines with an authored `expression` temporarily override it; lines without one use the NPC's resting expression.
- `docs/tools/house-piece-author/` and `docs/tools/wall-builder/` — asset-pipeline tools producing modular house pieces and FBSE6 wall GLBs/recipes consumed via `docs/js/WallBuilder.js`. Piece faces normally render via `wall`/`roof`/etc. tags mapped to brick/shingle materials in `docs/js/HousePieceGen.js`'s `buildGroupFromPiece`; two more tags, `canvas` (flat unshingled/unbricked cloth) and `doorOpening` (flat unlit black, for a dark cutout showing through), were added for `docs/config/pieces/researchers-tent.json` — a hand-authored A-frame tent piece (two full-height sloped canvas panels + a closed back gable + a front gable with a black door triangle bordered by four canvas frame quads) referenced from the `housePieces` asset index. Both new tags are also authorable from the tool's own face-tagging UI, not just hardcoded for this one piece.
- `docs/tools/locale-editor/` — authors "locales": small, irregular hand-painted footprints (e.g. the Great Fey shrines for Banubu, Hiki-hiki, Mother Rahayobi, and Old Man Nohuknuk, plus Leaf & Pahu's House and the Researcher's Tent) meant to be stamped into the procedurally generated wilderness zones without overlapping generated terrain. Only painted cells belong to the locale — unpainted cells inside the working canvas are "open" so the wilderness generator's own terrain shows through there; the amber outline in the tool marks that blend seam. Exports `hobunji_locale.v1` JSON (tiles use the same tile-type vocabulary as `docs/tools/map-editor/`'s exterior maps) plus objects, named NPC anchors, wilderness-path connectors, and placement rules (allowed zones, clearance buffer, flat-ground requirement). Starter locale files for the six named story locations live under `docs/config/locales/`, indexed by `docs/config/locales/index.json`.
- `docs/js/wilderness-map-generator.js`'s `stampLocales` places every `great_fey_shrine`- and `story_poi`-category locale into a zone during a Tothal Shift: it reserves a flat, clear rectangle (footprint + clearance buffer) via the generator's existing occupancy system so nothing else can overlap it, paints the locale's own tiles into the live grid, and registers a `structure` object with a `pathAnchor` so `generatePaths()` routes a path to it like any other landmark — exposed as `workspace.localeInstances`. `docs/game.js`'s `performTothalShift` feeds each zone the locales not yet successfully placed elsewhere this shift, so a singleton locale lands in exactly one of the four zones. A locale's `placement.allowedZones` can restrict it to specific zones, and `placement.sameSectorAsEntry` (used by the Researcher's Tent, restricted to `map_northern_cliffs`) constrains it to the same one of nine equal sectors as that zone's entry gate that shift — exact-sector placement isn't always possible on genuinely cliff-choked terrain near the entry corridor, so it falls back to the closest available spot in the whole zone rather than a uniformly random one. Leaf & Pahu's House is the one locale **not** stamped this way — it already had a fixed, non-relocating anchor via `TOTHAL_PRESERVED_TRANSITIONS` (a real building interior is meant to be authored there later), so it's listed as a constant in `FIXED_LOCALE_LANDMARKS` instead. The Researcher's Tent's own preserved transition now instead tracks wherever `stampLocales` actually placed it that shift. `requiresFlatGround` only verifies the *raw* generated height was uniform across a locale's footprint — it says nothing about whether those tiles carry a `plateauGroupId` from whatever terrain was there before, or what's just outside the locale's own edge. `docs/js/terrain-preview.js`'s `mergeZoneTilesInto` (which every zone scene's terrain actually renders from) reclassifies a plateau-tagged tile as a sloped/incline "ring" cell purely from adjacency to a differently-grouped (or ungrouped) neighbor, regardless of its own raw height — so a locale placed on/against a plateau (which "Northern Cliffs" terrain is dense with) could carry a stale tag straight into that reclassification and render as solid cliff geometry the flatness check never would have flagged. Rather than always flattening a locale to ground level to dodge that (which would visually sink it below a real plateau it's genuinely sitting on top of), `stampLocale` samples the ring of tiles just outside its placement rectangle for the majority matching-height `plateauGroupId` and adopts it on every locale-painted tile, folding the locale into that plateau's own mask as interior cells — the ring boundary `mergeZoneTilesInto` computes then lands on the locale's own outer edge instead of cutting across its middle. A locale can opt out via `placement.groundOnly` (exposed as a checkbox in the locale editor) to always render at flat ground level regardless of what it lands on, for content deliberately meant to read as a cut into the landscape.
- Garanki Gabu (the Researcher's Tent's NPC) only has schedule stations that get registered once the (fire-and-forget) Tothal Shift finishes stamping his tent, which hasn't necessarily happened yet when `spawnScheduledNpcs()` runs at module init. `spawnScheduledNpcs()` defers any NPC with no resolvable schedule target and retries via `_retrySpawnDeferredNpcs` (every 1s, up to 30 attempts) until the shift catches up, so an NPC is only ever *created* once there's a real station to spawn at — but this only works if an unresolved schedule actually reports back `null`. Garanki's `scheduleHooks` used to carry a `defaultPosition: {c:20, r:20}` safety-net fallback (added to fix an earlier, different bug: he wasn't spawning at all) — but a fallback that always resolves to *something* means `resolveNpcScheduleTarget` never returns `null` for him, so the deferral above never triggered: he'd spawn immediately at that arbitrary tile before the tent even existed, and once his schedule re-resolved to his real (and correct) station a moment later, he'd have no way to actually get there — same-zone movement only knows how to beeline or follow an authored route, neither of which spans ~150 cliff-choked tiles with no route network in a wilderness zone, so he'd sit there permanently `idle`, correctly *aware* of where he should be but physically unable to path there. `defaultPosition` has been removed entirely — now a `null` target defers him properly, so he's never created until his real, already-nearby station is available and no pathing across the map is ever needed. (One station still had its own registration gap: `station_researchers_tent_sleep` lives in `config/maps/map_i_researchers_tent.json`'s own `npcStations`, only registered once `loadBuildingScene('map_i_researchers_tent')` runs — normally lazily, the first time a player walks in. `performTothalShift` now proactively calls it itself, right after registering the tent's desk/statue stations, so that station is never the one left unregistered either.)
- The wilderness map: a per-zone fog-of-war (`_zoneLayouts`-scoped, revealed in a radius around the player, wiped whenever that zone's Tothal year goes stale) drives a top-left minimap widget (visible only inside a wilderness zone — this corner is otherwise empty now that health/stamina render as ground-projected resource rings instead of the old `#vitalsBar`) and a full "🗺 Map" tab in the pause menu (press `M`), both in `docs/game.js`/`docs/index.html`/`docs/style.css`. Discovering a locale (walking within the reveal radius) permanently flags it as found in `hobunjiSaveMeta` — the map always draws discovered locales from their *live* current placement rather than a remembered position, so a shrine's marker still tracks it correctly after a later Tothal Shift moves it. A locale can also set `placement.alwaysVisibleOnMap` (used by the Researcher's Tent) to show up on the map from the start, without needing to be discovered first. Garanki Gabu specifically is drawn as his own live portrait (the baked head-with-cosmetics canvas from `makeNpcWalker`'s `avatarFrontCanvas`, the same image his dialogue portrait uses) rather than a plain dot, on whichever zone tab he's actually in right now.
- **Root cause of the tent/Garanki bugs surviving several rounds of fixes**: `_loadTownFromWorkspace` (loading `config/town-workspace-v1.json`) had its own legacy code, predating the Tothal Shift procedural generator, that also called `_zoneLayouts.set(zoneId, ...)` for all four of `EXTERIOR_ZONES`' zones — using a hand-authored layout from *before* the locale-stamping/tent-piece/NPC-schedule system existed (that layout's own "Northern Cliffs" data included a fake placeholder tent building and a hand-placed "Garanki's Bluff" plateau submap with no real NPC). `performTothalShift`'s own `_zoneLayouts.set` for the same zones ran later at world start, so the two competed for the same map with no visible sign a conflict was even happening — depending on load timing, the player could easily end up standing on (and testing bug fixes against) the stale hand-authored version the whole session, explaining why fixes to the dynamic placement/rendering code appeared to have zero effect. `_loadTownFromWorkspace` now skips building a zone layout entirely for any `EXTERIOR_ZONES` id (`performTothalShift` owns those completely); every other exterior map still goes through the static path unchanged, and town's own authored gates into the four wilderness zones are unaffected since the zone-id set they're classified against isn't the thing that changed. Separately, `config/town-workspace-v1.json` also still carried a stale `map_i_researchers_tent` map-editor stub (6×6, no furniture) whose one transition sent the player through `enterBuilding('map_northern_cliffs', 0, 0)` on exit — treating the wilderness zone as if it were a building interior and landing them at the zone's raw origin corner, almost always inside boundary/escarpment terrain. `loadBuildingScene`'s `_wsOverride` mechanism (source-of-truth override for building interiors, keyed by map id) unconditionally preferred that stale stub's transitions over the real authored `config/maps/map_i_researchers_tent.json` interior's own `exits[]`, regardless of anything fixed on the dynamic-generation side. Removed that stub entirely (and its now-orphaned reference from the static Northern Cliffs entry) — `loadBuildingScene` now uses the authored interior's own exit untouched.
- The Researcher's Tent's exterior mesh is rendered via `zoneData.buildings` (`docs/game.js`'s `performTothalShift`), keyed off `locale_researchers_tent.json`'s `obj_structure` (now `w:3,h:3`, matching `researchers-tent.json`'s actual 3x3 footprint — a smaller authored footprint here used to let the desk/statues overlap the rendered tent). The player-facing "enter the tent" trigger tile is derived from that structure's own footprint edge (one step off whichever side `TENT_DOOR_ROTATION_BY_SIDE` turns the door to face), not from the locale's path connector — the connector only marks where the wilderness path enters the *locale* (see `stampLocale`'s `pathAnchor` use of it), which can sit several tiles away across a clearing, so using it directly as the interior-transition trigger used to place that trigger nowhere near the actual door. The interior itself is a real authored `hobunji_building_interior.v1` map (`docs/config/maps/map_i_researchers_tent.json`) with a new `wallStyle: "canvas"` (flat cloth-colored panels via `buildCanvasWalls`, alongside the existing `"cavern"` rock-wall style) instead of falling back to the generic brick-walled placeholder room every other unauthored interior gets. Garanki's `station_researchers_tent_sleep` lives inside that interior file (not the exterior zone) so his 20:00–08:00 sleeping rule doesn't stand him inside/behind the opaque exterior tent mesh. His `scheduleHooks` also carries a `defaultPosition` fallback now — `spawnScheduledNpcs()` runs at module init, before the fire-and-forget Tothal Shift has registered any of his dynamically-stamped stations, and previously had no resolvable target at all at that point, so he was silently skipped and never spawned; the fallback just needs to resolve to *something* until the shift finishes and his `update()` loop (which re-resolves his schedule every frame) retargets him to the real station on the very next frame.
- `docs/tools/index.html` — hub that embeds the tools with an NPC database sidebar.

## Runtime NPC avatar demo pipeline

- `docs/js/npc-avatar-preview-utils.js` turns an NPC export or profile into a portrait profile and renders it to an in-memory transparent canvas through `renderPortraitProfile()`.
- `docs/js/png-plane-avatar.js` feeds that canvas through the PNG reference pipeline's single-plane path, building a temporary Three.js `Group` with a front portrait plane and a rear silhouette plane. It does not export a GLB; the generated object is meant to stand in as a demo NPC model at runtime.
- Three.js module URLs and temporary plane defaults live in `docs/config/scratchbones-config.js` under `game.assets.pngPlaneAvatar`.

## Tools (pinned)

[`docs/tools/index.html` @ 8eb721d](https://rawcdn.githack.com/oolnokk/hobunjihollowunity/8eb721d477016c11b55c2c9df5d4c9b3177157ec/docs/tools/index.html)

## Setup note

Serve this repository as static files and load portrait scripts from `docs/js/` so the runtime can fetch configs from `docs/config/` and image assets from `docs/assets/`.

## Camera: Shoulder Cam is the default

The over-the-shoulder camera (`Settings → Camera → Shoulder Cam`, `docs/game.js`'s
`s_shoulderSurf`/`SHOULDER_SURF_MODE`) shipped as an experimental toggle and has
graduated to the standard camera — it now ships on by default and is no longer
labeled experimental in Settings. It's a close, near-eye-level view: mouse looks
around freely (Pointer Lock on desktop), WASD moves relative to where you're
looking rather than the camera's fixed azimuth, and separate horizontal/vertical
framing offsets (also in Settings) ease between a default and a combat stance so
a drawn weapon/tool doesn't sit in the middle of the screen. The plain fixed
follow camera is still reachable by unchecking the toggle.

## Southern Cloud Forest fog

The Southern Cloud Forest (`map_southern_cloud_forest`) sets its own zone
config in `EXTERIOR_ZONES` (`docs/game.js`) to make the fog both thicker and
actually present, and to make its vegetation cull radial instead of
directional:

- **`fogDensity: 0.055`** vs. every other zone's shared `0.018`, read by
  `buildZoneScene`. Thematically, a *cloud* forest with no clouds in it was an
  obvious gap. `fogColor` is white (`0xffffff`) instead of every other zone's
  dark tint, so the mist reads as bright overcast weather rather than gloom.
- **`vegCullRadiusTiles: 34`** — `updateZoneVegetationCulling` uses its
  presence to swap the other zones' camera-forward/rear/width box for a plain
  circle centered on the *player*. Shoulder Cam lets the camera actually look
  down the length of the forest now, which had made that box's forward pop-in
  edge (`VEG_CULL_FORWARD_TILES`, 42 tiles) visible; 34 tiles is where
  `fogDensity` above has already made `FogExp2` ~97% opaque, so the (now
  uniform-in-every-direction) pop-in ring stays hidden in the mist. A full
  circle that size does mean more renders behind/beside the player than the
  old forward-biased box did — an acceptable trade since the fog is now doing
  the work that box used to.
- **`docs/js/cloud-forest-fog.js`** (`window.CloudForestFog`) adds three
  large, translucent white cylinders centered on the player — scaled to
  0.42×/0.70×/1.00× `vegCullRadiusTiles` — that the camera always renders from
  the inside (`THREE.BackSide`). A flat per-pixel `FogExp2` alone reads as
  computed haze; real geometry the camera sits inside of gives the mist actual
  visual presence, drifting and layered on top of (not replacing) the
  ordinary fog. Each layer is textured with a procedurally-painted white
  "spray paint" `CanvasTexture` (soft random blotches, wrap-seamless) used as
  a fallback — the module also tries `assets/textures/cloud_forest_mist.png`
  first and upgrades to it transparently if that asset ever shows up. Follows
  the same self-contained `window.<Namespace>` + `init(deps)`/`update(dt)`
  module shape as `docs/js/rain-planes.js`, and is wired into the same
  per-frame update tick in `docs/game.js`.

## Outlines are fog-aware; the furniture seam pass is off

`shellOutlineMat` (`docs/game.js`, the inverted-hull "Shell Outlines" pass —
the dark border on rocks/crops/terrain steps) now declares `fog: true` and
merges in `THREE.UniformsLib.fog`, so it mixes its black line toward whichever
scene's actual `fogColor`/`fogDensity` is active based on distance, by hand in
its own vertex/fragment shaders (the built-in `fog_vertex`/`fog_fragment`
chunks assume a view-space variable named `mvPosition`, which this shader
calls `viewPos`, so the same math is written out explicitly instead of using
`#include`). In the Cloud Forest specifically, this means an outline far
enough away to already be swallowed by the white mist now actually fades
into it instead of staying a crisp black line poking through.

Two other, separate outline sources existed alongside the shell pass:

- **Depth-edge outlines** (`s_depthOutlines`, Settings → Visual Effects →
  "Depth Outlines") — already off by default; unchanged.
- **Furniture material-seam outlines** (`_markFurnitureEdgeId`/the
  composite shader's `idEdge` — catches boundaries between two touching
  parts of the same furniture group, e.g. a chair leg against its seat) had
  no Settings toggle at all and simply ran unconditionally whenever Shell
  Outlines was on. It's now gated behind a new `s_furnitureSeamOutlines`
  flag (`docs/game.js`), defaulted to `false`: it isn't fog-aware like the
  shell pass above, so leaving it on would keep drawing crisp seam lines
  straight through the Cloud Forest's mist. The render pass that builds its
  source buffer is skipped entirely while off (not just hidden), and a new
  `uSeamOutlinesOn` uniform zeroes its contribution in the composite shader
  regardless of that buffer's contents.

## Future plans: multiplayer

Eventual multiplayer support (one world-owner host + guest players joining
with their own character saves) is a design goal, not yet implemented. See
[`MULTIPLAYER.md`](MULTIPLAYER.md) for the intended model, a review of what
in the current save/combat/AI architecture already lines up with it, and the
desync risks (NPC/creature transforms, combat timing, animation state) that
will need addressing.
