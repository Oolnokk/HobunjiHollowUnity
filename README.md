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

- `docs/tools/map-editor/` — agnostic grid map editor with two categories (exterior / interior) for the farm, town, wilderness zones, and house interiors. Supports tiles, crops, world objects, processing furniture, decor, NPC paths, and map-to-map transition spots. Sends linked maps to the game as `hobunji_farm_layout_v3` (localStorage) and exports `hobunji_map.v1` JSON.
- `docs/tools/character-studio/` — merged appearance + NPC database editor. Edits `appearance`, `equippedCosmetics`, `appliedDyes`; can write directly to the game's `hobunjiPlayerProfile` ("Set as my player"); manages `hobunji_npc_database.v2` records with live portrait and 3D PNG-plane previews.
- `docs/tools/house-piece-author/` and `docs/tools/wall-builder/` — asset-pipeline tools producing modular house pieces and FBSE6 wall GLBs/recipes consumed via `docs/js/WallBuilder.js`.
- `docs/tools/index.html` — hub that embeds the tools with an NPC database sidebar.

## Runtime NPC avatar demo pipeline

- `docs/js/npc-avatar-preview-utils.js` turns an NPC export or profile into a portrait profile and renders it to an in-memory transparent canvas through `renderPortraitProfile()`.
- `docs/js/png-plane-avatar.js` feeds that canvas through the PNG reference pipeline's single-plane path, building a temporary Three.js `Group` with a front portrait plane and a rear silhouette plane. It does not export a GLB; the generated object is meant to stand in as a demo NPC model at runtime.
- Three.js module URLs and temporary plane defaults live in `docs/config/scratchbones-config.js` under `game.assets.pngPlaneAvatar`.

## Setup note

Serve this repository as static files and load portrait scripts from `docs/js/` so the runtime can fetch configs from `docs/config/` and image assets from `docs/assets/`.
