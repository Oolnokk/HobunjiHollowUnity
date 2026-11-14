# Parser-ordered classic script groups

The static game page needs classic, synchronous scripts in strict order. To reduce
unrelated PRs editing `docs/index.html`, compatible *late* scripts can move to
separate manifests in `docs/js/bootstrap/classic-groups/`.

Currently migrated:
- `qol.js`: toast, arrival, hotkeys, inventory search.
- `guild.js`: guild progression, magic checkpoint, vault signal.
- `render.js`: actor/mesh/grass culling and depth snapshot.
- `festival.js`: ancestor figures, activities, festivals, offering rituals and festive UI.
- `npc-schedule.js`: NPC agendas, social relations, seating, pathfinding, routes and Nohuknuk wilderness AI.
- `combat-main.js`: weapon shape stats, combat runtime, attack abilities, input, progression and enchantments.
- `combat-enemies.js`: ranged weapons/reticles and authored enemy combat variants.
- `ruin-puzzles.js`: melody camera/plate systems, V50 mechanisms, puzzles and checkpoints.
- `dialogue.js`: cinematic/dialogue camera support, text/voice runtime and dialogue content.

The stable index entry is:
```html
<script src="js/bootstrap/classic-script-group-loader.js?v=20261114classicGroups3" data-classic-group="qol"></script>
```

The loader runs while the HTML parser is active, writes a uniquely queried
manifest script, and that manifest writes its versioned child scripts in order.
`document.write` is intentional here: *async* dynamic insertion changes the
initialization semantics of the existing classic-script runtime. **Never invoke
this loader on DOMContentLoaded, asynchronously, or after parsing**.

To add or update a script in an existing group:
1. Edit only that group's ordered `scriptUrls` array, including the new
   `?v=<new token>` for changed modules. Do not edit `index.html`.
2. Keep evaluation-time dependencies ahead of consumers; keep `game.js`
   outside these groups.
3. Run `node scripts/test-classic-script-groups.js` and the normal regression
   suite. The test discovers groups and allows new members without editing a shared
   test file, while guarding the baseline dependency order.

The manifests are fetched with `?load=<Date.now()>` per navigation so manifest
edits do not require touching a common index cache token. Child modules retain
their usual versioned cache URLs; this costs one tiny extra manifest request per
group. The loader itself remains cache-versioned in `index.html` and should
rarely need changes.

Tests that need the **effective** shipped script list can import
`expandClassicScriptGroups` from `scripts/classic-script-group-index.js`.
This replaces each group loader tag at its parser position in the HTML string.
Do not silently assume a moved script is missing because it no longer appears
literally in `index.html`.

This first migration intentionally leaves early startup scripts and inline
boot handoff scripts in place. They have stronger parser/side-effect coupling.

## Dependency notes for migrated festival and NPC systems

- `festival.js` preserves the existing order from ancestor figures through festival UI. It loads after the combat tutorial modules, before tutorial unlock visitors and before `game.js` initializes festival systems.
- `npc-schedule.js` preserves the four agenda/activity/planner modules before `npc-scheduling.js`. `npc-scheduling.js` must come before the farm worker bridge and social seating bridge.
- Authored `config/npcs/social-relations.js` must load before the social seating bridge; both `NpcActivities.resolveDestination` and `NpcScheduling.findStationsByRole` must exist before that bridge executes. `npc-pathfinding.js`, `nohuknuk-wilderness.js` and the route graph load before the cutscene preview handoff and `game.js`.
- The original long HTML explanations were moved here so no new registration edits are needed in the shared entrypoint. Add or update scripts in one manifest only.
- `scripts/test-festival-npc-classic-script-groups.js` enforces the original 22-module subsequence. Future modules may be inserted but must not reorder the original required dependencies.


## Startup load failures (mobile)

The classic-script-group-loader installs one capture-phase error listener when the first group loads. If a manifest fails to download or evaluate, it records the name in window.HobunjiClassicScriptGroups.failedGroups and shows a single on-screen role=alert message. Normal startup adds no DOM elements, no polling, and no duplicate listeners. The new test-classic-script-group-failures.js exercises the actual loader with a simulated browser.

## Combat, dialogue and ruin-puzzle migration (third stage)

- These four groups deliberately occupy their *original* positions in the parser. Combat foundational systems remain after weapon assemblies and before movement collision. Enemy/ranged combat remains after swept movement and before bandit camps; it therefore does not change the bandit/bounty dependency chain.
- The dialogue group stays after Pixel Probe and before combat tutorial content; cinematic camera, collisions, framing, text, character voice ownership, and dialogue content retain their evaluation order.
- The ruin-puzzles group stays after ruin-layer defense and before WildernessMap. Melody camera framing must precede puzzle melody, glyphs, and challenges. Native V50 floor modules must precede connector/checkpoint consumers.
- Ranged reticle and weapon scripts share the `combat-enemies.js` manifest because they are adjacent to the authored enemy combat group and must still precede bandit combat.
- `scripts/test-combat-dialogue-puzzle-script-groups.js` checks manifest ownership and the original dependency-order anchors, not merely whether a module appears somewhere in the HTML.
- This stage adds four parser-blocking manifest fetches. A successful static-order test does not measure mobile startup latency; profile it before considering more broad migrations.

### Early parsing failures

Combat and puzzle groups may load in the document head, before `document.body` exists. The manifest-error listener queues exactly one `DOMContentLoaded` callback on the first such failure. It then displays all accumulated failed group names in the existing on-screen alert. Successful loads install no additional listener or UI. `scripts/test-classic-script-group-failures.js` covers head-time failures and duplicate reporting.
