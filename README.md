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

## Setup note

Serve this repository as static files and load portrait scripts from `docs/js/` so the runtime can fetch configs from `docs/config/` and image assets from `docs/assets/`.
