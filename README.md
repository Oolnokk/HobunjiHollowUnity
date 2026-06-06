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

## Runtime NPC avatar demo pipeline

- `docs/tools/npc-portrait-editor/index.html` exports NPC JSON with `appearance`, `equippedCosmetics`, and `appliedDyes`.
- `docs/tools/npc-avatar-preview/index.html` accepts those JSON exports, or generates randomized characters from the shared portrait cosmetics config.
- `docs/js/npc-avatar-preview-utils.js` turns either input into a portrait profile and renders it to an in-memory transparent canvas through `renderPortraitProfile()`.
- `docs/js/png-plane-avatar.js` feeds that canvas through the PNG reference pipeline's single-plane path, building a temporary Three.js `Group` with a front portrait plane and a rear silhouette plane. It does not export a GLB; the generated object is meant to stand in as a demo NPC model at runtime.
- Three.js module URLs and temporary plane defaults live in `docs/config/scratchbones-config.js` under `game.assets.pngPlaneAvatar`.

## Setup note

Serve this repository as static files and load portrait scripts from `docs/js/` so the runtime can fetch configs from `docs/config/` and image assets from `docs/assets/`.
