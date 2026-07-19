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
- `docs/tools/house-piece-author/` and `docs/tools/wall-builder/` — asset-pipeline tools producing modular house pieces and FBSE6 wall GLBs/recipes consumed via `docs/js/WallBuilder.js`.
- `docs/tools/locale-editor/` — authors "locales": small, irregular hand-painted footprints (e.g. Leaf & Pahu's House, the Researcher's Tent, and the Great Fey shrines for Banubu, Hiki-hiki, Mother Rahayobi, and Old Man Nohuknuk) meant to be stamped into the procedurally generated wilderness zones without overlapping generated terrain. Only painted cells belong to the locale — unpainted cells inside the working canvas are "open" so the wilderness generator's own terrain shows through there; the amber outline in the tool marks that blend seam. Exports `hobunji_locale.v1` JSON (tiles use the same tile-type vocabulary as `docs/tools/map-editor/`'s exterior maps) plus objects, named NPC anchors, wilderness-path connectors, and placement rules (allowed zones, clearance buffer, flat-ground requirement). Starter locale files for the six named story locations live under `docs/config/locales/`, indexed by `docs/config/locales/index.json`. **Not yet wired into the wilderness generator or the game** — `docs/js/wilderness-map-generator.js` does not yet place locales, and there is no in-game map/fog-of-war UI to show discovered ones; those are follow-up work.
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
