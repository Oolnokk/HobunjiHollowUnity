# Enemy Loadout Workshop

Open `docs/tools/enemy-loadout-editor/index.html` on a static server or a commit-pinned repository preview. No game save or account is required.

The workshop calls the real BanditCombat, MinionCombat, MaskboundGuardianCombat and HarlyaoLichCombat factories in an isolated scene. It loads the current game catalog rather than keeping a second weapon/material table. Tribe equipment and Avenger mounts come from the authored camp configs. Cultural weapon rules use the same trust-giver NPC database and bridge as the game.

## Authoring

Select an enemy, choose a difficulty, Town Value and seed, then roll. Replay seed reproduces the visual/combat roll; generated smith item identifiers and timestamps remain per-instance. Roll 8 creates a comparison strip. Clicking an earlier card restores its stored roster and definition rather than rolling it again. History retains up to 32 records.

Use the pool tabs to inspect possibilities and enable explicit overrides. Weight 0 excludes a choice; all enabled pools need at least one positive weight. Native appearance/clothing eligibility depends on species and gender; native headwear/pants guarantees still apply unless that slot is explicitly overridden. NPC-only anatomy restrictions still apply. Liches use their tradition's spell AI: primary and summon toggles are separate from ordinary melee attack slots.

The viewport includes orbit/zoom and front/back/fit views, actual hands/feet/garments and compound mounts, idle/walk/sprint/hover, individual combo steps, quick attacks, held attack gestures, ranged/flask poses, scrub/loop/speed controls, bone guides, mask glow/fake-light footprint, and PNG capture. It previews animation and equipment, not target damage, projectile collisions or tactical combat AI.

Draft rules save to this tool's localStorage. Import/export handles `hobunji_enemy_loadouts.v1` JSON. Export this enemy saves the rolled roster and combat definition separately. To apply authored pools to game spawns, replace `docs/config/combat/enemy-loadouts.json` with the exported rules and commit it. The shipped file has an empty `rules` object, so opening or editing the tool never changes live game balance.

## Runtime ownership

`docs/js/combat/enemy-loadout-rules.js` owns validation, weighted pools, seed generation and per-instance changes. BanditCombat applies it at its shared factory boundary, covering tribe hunters, undead, liches and Maskbound Minion subclasses. The cultural-weapon bridge preserves explicit authored weapon/ranged/attack overrides; it does not re-roll Minion subclasses. The lich casting owner reads its special-attack toggles.

The standalone scene owns its animation loop. Gameplay remains on its existing frame owner. Held-action bootstrap treats this page as an isolated authoring context, avoiding installation of gameplay-only scheduler hooks.

`node scripts/run-tests.js enemy-loadout bandit weapon-trust maskbound` checks the shared rule behavior and nearby spawn contracts.
