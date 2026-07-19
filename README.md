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
- `docs/tools/house-piece-author/` and `docs/tools/wall-builder/` — asset-pipeline tools producing modular house pieces and FBSE6 wall GLBs/recipes consumed via `docs/js/WallBuilder.js`. Piece faces normally render via `wall`/`roof`/etc. tags mapped to brick/shingle materials in `docs/js/HousePieceGen.js`'s `buildGroupFromPiece`; two more tags, `canvas` (flat unshingled/unbricked cloth) and `doorOpening` (flat unlit black, for a dark cutout showing through), were added for `docs/config/pieces/researchers-tent.json` — a hand-authored A-frame tent piece (two full-height sloped canvas panels + a closed back gable + a front gable with a black door triangle bordered by four canvas frame quads) referenced from the `housePieces` asset index. Both new tags are also authorable from the tool's own face-tagging UI, not just hardcoded for this one piece.
- `docs/tools/locale-editor/` — authors "locales": small, irregular hand-painted footprints (e.g. the Great Fey shrines for Banubu, Hiki-hiki, Mother Rahayobi, and Old Man Nohuknuk, plus Leaf & Pahu's House and the Researcher's Tent) meant to be stamped into the procedurally generated wilderness zones without overlapping generated terrain. Only painted cells belong to the locale — unpainted cells inside the working canvas are "open" so the wilderness generator's own terrain shows through there; the amber outline in the tool marks that blend seam. Exports `hobunji_locale.v1` JSON (tiles use the same tile-type vocabulary as `docs/tools/map-editor/`'s exterior maps) plus objects, named NPC anchors, wilderness-path connectors, and placement rules (allowed zones, clearance buffer, flat-ground requirement). Starter locale files for the six named story locations live under `docs/config/locales/`, indexed by `docs/config/locales/index.json`.
- `docs/js/wilderness-map-generator.js`'s `stampLocales` places every `great_fey_shrine`- and `story_poi`-category locale into a zone during a Tothal Shift: it reserves a flat, clear rectangle (footprint + clearance buffer) via the generator's existing occupancy system so nothing else can overlap it, paints the locale's own tiles into the live grid, and registers a `structure` object with a `pathAnchor` so `generatePaths()` routes a path to it like any other landmark — exposed as `workspace.localeInstances`. `docs/game.js`'s `performTothalShift` feeds each zone the locales not yet successfully placed elsewhere this shift, so a singleton locale lands in exactly one of the four zones. A locale's `placement.allowedZones` can restrict it to specific zones, and `placement.sameSectorAsEntry` (used by the Researcher's Tent, restricted to `map_northern_cliffs`) constrains it to the same one of nine equal sectors as that zone's entry gate that shift — exact-sector placement isn't always possible on genuinely cliff-choked terrain near the entry corridor, so it falls back to the closest available spot in the whole zone rather than a uniformly random one. Leaf & Pahu's House is the one locale **not** stamped this way — it already had a fixed, non-relocating anchor via `TOTHAL_PRESERVED_TRANSITIONS` (a real building interior is meant to be authored there later), so it's listed as a constant in `FIXED_LOCALE_LANDMARKS` instead. The Researcher's Tent's own preserved transition now instead tracks wherever `stampLocales` actually placed it that shift.
- The wilderness map: a per-zone fog-of-war (`_zoneLayouts`-scoped, revealed in a radius around the player, wiped whenever that zone's Tothal year goes stale) drives a top-left minimap widget (visible only inside a wilderness zone — this corner is otherwise empty now that health/stamina render as ground-projected resource rings instead of the old `#vitalsBar`) and a full "🗺 Map" tab in the pause menu (press `M`), both in `docs/game.js`/`docs/index.html`/`docs/style.css`. Discovering a locale (walking within the reveal radius) permanently flags it as found in `hobunjiSaveMeta` — the map always draws discovered locales from their *live* current placement rather than a remembered position, so a shrine's marker still tracks it correctly after a later Tothal Shift moves it. A locale can also set `placement.alwaysVisibleOnMap` (used by the Researcher's Tent) to show up on the map from the start, without needing to be discovered first.
- `docs/tools/index.html` — hub that embeds the tools with an NPC database sidebar.

## Runtime NPC avatar demo pipeline

- `docs/js/npc-avatar-preview-utils.js` turns an NPC export or profile into a portrait profile and renders it to an in-memory transparent canvas through `renderPortraitProfile()`.
- `docs/js/png-plane-avatar.js` feeds that canvas through the PNG reference pipeline's single-plane path, building a temporary Three.js `Group` with a front portrait plane and a rear silhouette plane. It does not export a GLB; the generated object is meant to stand in as a demo NPC model at runtime.
- Three.js module URLs and temporary plane defaults live in `docs/config/scratchbones-config.js` under `game.assets.pngPlaneAvatar`.

## Tools (pinned)

[`docs/tools/index.html` @ 8eb721d](https://rawcdn.githack.com/oolnokk/hobunjihollowunity/8eb721d477016c11b55c2c9df5d4c9b3177157ec/docs/tools/index.html)

## Setup note

Serve this repository as static files and load portrait scripts from `docs/js/` so the runtime can fetch configs from `docs/config/` and image assets from `docs/assets/`.

## Future plans: multiplayer

Eventual multiplayer support (one world-owner host + guest players joining
with their own character saves) is a design goal, not yet implemented. See
[`MULTIPLAYER.md`](MULTIPLAYER.md) for the intended model, a review of what
in the current save/combat/AI architecture already lines up with it, and the
desync risks (NPC/creature transforms, combat timing, animation state) that
will need addressing.
