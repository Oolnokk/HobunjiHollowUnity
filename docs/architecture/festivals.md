# Weeklong town festivals

All five festivals last seven civil days, starting and ending at midnight. Decorations stay throughout the week; residents gather from 15:00 to 01:00 and otherwise resume their ordinary schedules. Roads, building entrances, terrain, and every town exit remain unchanged. The normal town returns automatically, including when the player stays in town across a date change.

| Festival | Dates | Working activities |
| --- | --- | --- |
| Hachutukara | Firstrise 22–28 | Permanent animal-mask gift, temporary resident costumes, a sweet from each resident, Hunundi's story through ordinary dialogue, dance, supervised live sparring with Oddclaw |
| Gorkunash | Highheat 8–14 | Movable bandstand (Foroji/Kaboku alternating Kurraya sets), dance floor, outdoor dining and six-pot feast with one contributed meal; 200 Festival Fun converts to one heart overnight |
| Tzizkhanash | Firstfall 22–28 | Wooden ancestor shrines, remembrance text, quality-based offering and choice of a 336-day blessing |
| Feast of the Five Blossoms | Thirdfall 15–21 | Five Blossom Dance, music, five-petal decorations and gathering court |
| Mountaindawn | Shallowfrost 1–7 | Double gift Favor and gift Rapport; a high-potency restorative gift from every available NPC with at least three hearts, including friends outside town |

The seasonal dates use the existing regional calendar, not an invented month-to-season mapping. Thirdfall 15 immediately follows Deadgrass. Highheat 8–14 is the middle Stormtide week. Hachutukara occupies the longest remaining gap. Mountaindawn includes Shallowfrost 5.

**Future-content note:** Omgurku Great Camp does not exist. Its solemn Gorkunash observance is recorded here and in the calendar definition only; no phantom camp, destination, or interaction has been created.

## Playing the skeleton

The Gorkunash festival guide board has been retired. Its dining, dancing, and music attractions are relocatable locale roots whose furnishings and NPC activity destinations follow them in the festival Map Editor. The other festival layouts still have their individual activity prompts. Most active courts are on the southern lawn beyond the shop road; Hunundi's Hachutukara storytelling circle and a secondary ancestor shrine sit beside the temple. Other festivals retain their activity signs and action-bar entries. Gorkunash uses ordinary chair and surface-object interactions; dancing and instruments use the existing social wheel anywhere in town. The menus support touch, keyboard, and the existing controller UI. Every festival menu includes **Copy diagnostics**.

- Gorkunash's single potluck donation consumes one selected-quality cooked meal and awards each eligible resident ten times their normal positive gift Favor; villagers who dislike or hate it receive no Favor. Five dishes change daily, and the contributed sixth pot is replaced by another daily meal from the following day onward. A festival-only bowl carries ten portions, each adding five minutes of a separate food buff up to a fifty-minute cap. Fullness lasts eighteen game hours starting at the first portion and blocks further meals at ten stacks.
- Offerings consume exactly one chosen quality of a physical giftable item. Quality is the blessing level, 1–5. Choose movement speed (+2% per level), stamina regeneration (+4%), or positive Favor (+5%). The blessing replaces the prior ancestor blessing and expires after 336 civil days, including sleep and reloads.
- Mountaindawn gifts and Hachutukara sweets can be received directly from nearby friends or collected from the communal table. Both routes share the same annual claim. Three hearts means 120 Favor points.
- Dance participation uses the existing social dance animation for 20 seconds and earns +2 Favor with residents once per festival. Dodge or the leave-dance action cancels. Further dancing is allowed without repeat rewards.
- Friendly duels reuse combat training, borrowed weapons, the shared Oddclaw renderer/AI, and equipment/resource restoration. Three verified hits finish the exercise; completion gives +6 Favor with Spearhead and Oddclaw once per year. Leaving the ring, leaving town, or ending the festival cancels and restores temporary state.
- Other grants are once per year: one animal mask, one liquor bottle, one potluck, and one offering. Capacity is checked before item claims are marked.

Balance values, narrative prose, props, and costumes are intentionally a playable foundation for later bespoke art and choreography.

## Editing layouts

Open the Map Editor, choose **Hobunji Hollow Town**, then select a festival under **Alternate Layouts**. Decor placement, movement, deletion, NPC stations, and 3D preview operate on that layout. Base-level roads, terrain, buildings, and exits stay shared. JSON export, undo, save, and live reflection retain the activity metadata and independent station arrays.

The **Furniture & locale properties** panel edits any selected layout prop's activity type, label, tile position, reach, ornament preset, and color. Activity reach is drawn in the 2D editor. Moving a dance rug, shrine, table, or duel ring also moves its mechanics. Existing decor transforms remain available. Select **Base (default)** to edit the normal town.

Keep clear circulation lanes between activity groups. Do not place props over paths or entrance thresholds. Dedicated host stations use `festivalNpcId`; ordinary gathering stations use `festivalRole: "guest"`. A station with `toolKey: "kurraya"` and `roles: ["music-performance"]` supplies the existing music performance system.

## Owners and reuse

- `festival-dialogue.js`: authored Gorkunash conversations and greetings, selected only while Gorkunash is current and the shared gathering-hours check is active (15:00 inclusive to 01:00 exclusive). DialogueContent contextual providers run after queued scenes and NPC-specific quest providers; this provider replaces only General Chat fallback trees. Other authored story trees retain priority. Ambient greetings keep the existing proximity, daily ledger, relationship and nickname policy, and quest greeting overrides. Kinami and Father Hunundi receive no festive greetings. Kinami's ordinary greeting leads to the optional festival question; the supplied historical and political statements remain the individual speakers' dialogue.
- **Oliphanti lore:** Mashtzarr and Mammakh are subspecies of the larger Oliphanti species. The existing `mammakhbuur` asset ID also counts as Mammakh for dialogue. Dzibim says “our people” to these players and skips the outsider passage; other players hear “my people” and that additional passage. This ancestry relationship does not change rendering IDs or avatar rigs.
- Kinami uses her existing home stations/position during Gorkunash gatherings. Hunundi's NPC-keyed presence provider reuses the ordinary visitor departure, despawn, arrival and flood-shelter authority. He walks to the town's existing northern exit; no destination or new map is invented. Normal startup outside gatherings retains his regular schedule. `NpcScheduling.hasPresenceSchedule` lets the existing spawn lifecycle recognize both weekly visitors and contextual resident absences without modifying shared NPC records.
- `festival-calendar.js`: shared names, dates, activity lists, blessing definitions. `MapLayoutSystem` accepts `{ festival: "id" }` conditions; calendar cells use the same definitions.
- `festival-system.js`: activity-handler registry, authoritative proximity checks, annual member claims, quality consumption, rewards, attendance override, temporary costumes, timed participation, and date-based blessing expiry.
- `festival-ui.js`: activity menus; game state remains in the system. Uses CharacterActionLocks and ControllerUI conventions.
- `festival-props.js`: dressing on existing furniture and canonical PNG text surfaces. Explicit disposal releases its private materials/textures without touching shared furniture assets.
- `game.js`: module initialization/save/restore, normal action dispatch, and safe live town rebuilding through the existing map-preview seam. Raw exterior maps are preserved separately from their resolved layouts.
- NPC scheduling replaces map-owned stations on layout change. Wardrobe appearance decorators never overwrite saved outfits. Dialogue accepts a queued conversation tree. Combat training accepts a transient quest and an authored practice area, without a new combat implementation.

Annual claims and the ancestor blessing live in `member.festivals`. Dance progress and borrowed sparring state are deliberately transient. NPC costumes are render overlays. Scene changes defer during dialogue, combat, menus, transitions, and movement locks.

## Verification

`node scripts/run-tests.js festival combat-tutorial favor-heart-balance npc-gifting harlyao-calendar`

Festival tests execute shipped rules and layout selection, exact-quality consumption, inventory-capacity rejection, remote-friend eligibility, annual renewal, save/restore, blessing expiry across a year boundary, costume immutability, and interrupted dancing. Integration tests execute editor copy-on-write/JSON round-trips, station cleanup, live town start/end/failure recovery, and spatial checks against actual furniture footprints, rotated buildings, paths, exits, and other props. Combat tests execute transient world-space sparring and cleanup.

Visual browser playtesting remains necessary before merging: inspect each layout in the editor and game, navigate every exit, and try activity menus on a phone. The real serving assets have been rendered and their surface transforms checked in a browser; automated validation is not a claim of a completed saved-game playthrough.

## Gorkunash implementation note (draft)

The Gorkunash Map Editor uses `festivalLocale` metadata on the decor root to define nested `parts` and `slots`. `MapLayoutSystem.getEffectiveMapData` expands them after the active layout resolves; moving or rotating the root automatically moves both ordinary rendered furniture and NPC pathfinding destinations. The base town is not modified. Festival dancing and meals accumulate independent Festival Fun; at each midnight 200 Festival Fun becomes 40 Favor (one heart). A mobile-readable `FestivalSystem.diagnostics()` snapshot reports the selected locale, bowl, fullness, food effects and claims.

**Gameplay integration now present:** the festival bowl is a transient, transparent-PNG held item. Taking it automatically equips item mode; selecting another item, tool or weapon discards it. Guests sit in a chair derived from the moveable dining locale and use the ordinary Eat prompt while the authored Drink animation expends a portion at strike; its n/10 badge appears on the action arch. The player aims directly at an individual serving pot to fill a bowl, or contributes the normally held cooked meal. Pots and the bowl stack are separate authored furniture on the serving table’s recognized surface. The sixth pot is visually empty until a donated meal fills it, then rotates to another meal the next day. Only actual occupants of chairs explicitly assigned to the same table earn the 25 Festival Fun for each bite. The shared chair/table system supports interiors, exteriors and locales; see [shared furniture relationships](furniture-table-system.md).

The wide wooden pennant arches are real `festivalArch` furniture keys, with adjustable `festivalArchWidth` and reusable PNG wood/flag materials. They intentionally have walk-through footprints and six authored main-road placements.

**Procedural Festival Wheel Dance:** `js/festival-wheel-dance-runtime.js` retains the preview's four-second rhythm, two inward-facing revolutions and alternating hops. Each action captures the participants' real species/gender shoulders, arm reaches, posterior anchors, leg bends, sole offsets and eye landmarks. Height difference contributes a bounded base tilt; hop lift and pair spacing are limited by anatomy. The lower partner supports the hop with folding knees while the other partner's legs dangle along world gravity. The support pivots around its posterior and retains floor contacts; very short legs use a reach-limited ground slide rather than an impossible joint pose. Two quadratic reach intervals bound partner spacing, and the two arm-reach spheres supply each shared wrist contact. This is a constant amount of work for two participants, without a crowd scan, search solver or extra frame loop.

Whole-character width and height are intentionally independent (`HobunjiCharacterRigScale`), and PNG-facing roots can be mirrored. The dance preserves these scales. Posterior offsets use the signed per-axis transform; world-vertical leg reach uses the inverse-scaled direction, and planted-leg limits are solved in canonical rig-local coordinates. Hand contact uses the smaller absolute parent axis as a conservative world reach, so it never stretches an authored arm. Only nonfinite or singular scales are rejected, with the actual axes included in `lastStartFailure`. Runtime diagnostics expose each actor's `rigScale` and `verticalLegFactor`; capture failures retain their specific code rather than reporting every failure as missing rigs.

The existing procedural leg handle exposes `motionAnatomy()` and `applyWorldFootTargets()`. The latter uses the shared fixed-length two-bone solver, bounds knee flex below 90 degrees, keeps soles level and updates the same bones used by pants deformation. A rare `anatomyRevision()` change refreshes cached dimensions after imported feet or the torso-width scan finish. Rest lengths are unsigned distances: some authored posterior anchors lie below the sprite root, so a signed posterior height must never be treated as a physical leg length.

Hand rigs expose a scoped pose provider. The ordinary hand frame driver honors it in pre-render, render-sentinel and explicit/async synchronization paths; tool/idle fallback must not overwrite paired hand contacts. The action releases this provider on stop. Pose/facing/head channels on the existing character lock prevent additive body sway, ordinary billboard facing and camera-driven neck clamps from undoing the solved pair. Those ordinary channels resume after release. Mutual gaze uses the preview's eye-marker offset, parent-space yaw/pitch solve and 38°/32° limits. The existing cinematic camera follows the partner's moving eye point from behind the player; its normal collision/framing owner runs once after the paired pose settles.

Action 1 or Dodge stops the pair through `WorldActionInputClaims`. Action 2 switches between follow and orbit views, with matching touch-arch buttons that retain priority over aimed furniture/NPCs. Follow uses the live horizontal shoulder offset and focuses the partner's eye landmark. Orbit frames the whole pair from at least 4.5 tiles away and runs at −4°/s in world space, opposite the pair's spin; both dancers retain automatic mutual gaze. The existing cinematic owner blends and collision-checks both views, and the orbit clock pauses with the dance. Stop, scene exit, combat/modal interruption, avatar replacement, partner removal or a new cinematic restores the original roots/rigs and releases the action's camera/input/hand owners. A new cinematic is never deactivated by dance cleanup. The simulation clock, rather than idle/paused wall time, awards precisely 15 Festival Fun per completed second. Mobile festival diagnostics include support role, crouch, segment/reach measurements, support slides, gaze angles and camera target. No solo dance is substituted when the paired pose cannot start.

Both social wheels use 20px labels with percentage placement above, rather than inside, clipped wedges. Follow, dance and date responses share `AmbientDialogue.showSocialResponse`; the older alcohol-response name remains an alias to that same owner. Friendly Follow invitations can be refused at negative normal Rapport. Date eligibility and the existing acceptance confirmation remain authoritative; refusals and confirmed acceptance use ambient speech.

**Still in progress:** the alternate eligibility of one heart plus over 200 normal Rapport is not reachable with the present standard Rapport cap and needs a relationship-system design decision. World visuals, interaction reach, avatar scale offsets, and new furniture placement should also be verified in-game before merging. The PR's current merge conflicts also require reconciliation.


## Buffet meal routine and stage coverage

`NpcSharedMeals` supplies cached ordinary schedule targets through the festival scheduling override. Authored `mealRole` stations (`bowls`, `fill`, `queue`) move with the dining locale. The serving table stays solid, has no seat/table membership, and remains available only for bowl/meal service. NPCs reserve distinct queue/serving points, physically arrive, take a bowl, fill it, and then reserve an explicitly linked chair at a separate dining table. Existing household/workplace bonds and ambient friend circles weight table choice; actual members and approaching reservations both count. Full tables cause waiting and eventually another locale, never duplicate occupancy.

Seated meals last 10–20 game minutes, with bites 2–5 game minutes apart. Completion hands control to `NpcFestivalDance.decide` (see below) instead of a coin flip. The existing 200ms festival tick advances phases; frame-by-frame pathfinding reads cached targets. Missing asynchronously registered stations retry; layout changes, closing hours, floods, death, Follow/date ownership and route timeouts release meal state/reservations. `FestivalSystem.diagnostics().sharedMeals` reports phases, service counts, table IDs and bites.

Visible diners use the existing authored Drink clip through `NpcDrinkInteraction.playAutonomous`. Its action lock applies only to the NPC; it never hides, moves, or locks the player. Off-camera diners advance logical meals without creating animations. Bowls and ambient held items publish root-keyed held-item targets to the existing procedural hand frame driver, sharing its grip math and final-render ownership. Cleanup releases the target, prop and lock.

Foroji walks to the stage from 14:00 before the 15:00 gathering. Kaboku starts his relief walk at 19:30. Foroji's normal shift ends at 20:00, but he remains assigned until Kaboku is physically on stage. Both use ordinary Kurraya performance stations and the established music authority. Flood/emergency and explicit social overrides retain their existing precedence.

Focused checks: `node scripts/run-tests.js npc-shared-meals town-furniture-wiring social-interaction-reach`. A controlled Chromium fixture also executes the shipped town init bag, real Three.js transforms and authored chair anchor: Sit succeeds at 02:00, 14:00, 17:00 and 23:00; both buffet ends collide; late/rebuilt grass has zero footprint leaks and restores after furniture removal; an autonomous meal fires its strike once and releases its NPC lock without touching the player. This is a controlled fixture, not a completed saved-game playthrough.


Accepted paired-dance invitations first stop a solo dance, finish the player's standing transition, interrupt the NPC meal, release its chair and clear an autonomous eating clip. A transient invitation target reuses `NpcFollowing.target` to approach from the six-tile social range; choreography starts only within its physical reach. The existing festival tick waits for a standing partner and retries late rig readiness for at most twenty active seconds. Dodge/Action 2, scene/event changes, emergency suspension or cancellation clears the invitation and prevents a late camera takeover. Preparation awards no Festival Fun. Mobile diagnostics include pending time and the exact `lastStartFailure` code/actor (hands, neck, legs, camera, floor height or anatomical reach). Unrelated failures no longer claim that there is not enough room.

The paired action's NPC lock uses `NpcCharacterState.participantId` (`npc:<id>`) and includes the pose channel, matching the same participant used by autonomous meals, drunken/idle animation and ordinary character actions. The old bare NPC ID did not protect that participant. `test-festival-dance-invitations.js` covers solo/seated preparation, approach, readiness retry, cancellation, timeout and specific messages; the procedural pair regression verifies the participant and pose lock.


Close-contact clothing uses the garment owner's scoped `setDepthBiasLimit(owner, limit)` API. During a pair, the `paired-dance` scope limits the whole-garment cosmetic foot-covering pull to zero; depth testing, skinning, portrait masks and ordinary polygon offset remain in force. That prevents an artificial camera-directed pull from drawing a partner's pants over a nearer portrait. Cancel/stop releases the scope and restores the exact ordinary bias, including when a garment attaches or is replaced during the dance. Camera mode, counter-orbit angle, horizontal offset, camera position/target and each garment's effective bias are included in the existing dance diagnostics.


## Character-driven NPC festival behavior (Gorkunash)

The gathering runs whether or not the player is in town: `NpcSharedMeals.update` rides the existing 200 ms festival tick and game-time minutes, and visible-only work (eating clips, bowl carry) is skipped off camera. One game minute is about 0.47 real seconds (672 s per game day), so a 10–20 minute plate is roughly 5–9 real seconds and a 16–28 minute song roughly 7–13 s.

`js/npc-festival-dance.js` (`window.NpcFestivalDance`) holds the pure rules; `npc-shared-meals.js` is the thin state machine. There is no scripted sequence beyond the physical buffet path (bowl, pot, chair). Every free-time decision (arriving, finishing a plate, finishing a song, a mingle ending) weighs three options with `decide`:

- **Seconds** — appetite (stable per-NPC hash, higher for children), dulled by each plate already eaten and revived by a long dance.
- **Dance** — `danceDrive`: the same inhibition number and `danceThresholdFor` curve the ambient dance equation uses, plus shyness, sociability, drunkenness and stamina (fewer songs for the elderly, more for children). It is zero without a partner or without music.
- **Mingle** — stand around the dance floor facing the stage; likelier for sociable and elderly characters.

Dance rules come from the authored `socialRelationships` graph: **married** guests (a `partner` pair, or the player's spouse) dance only with their spouse and nobody else; **unmarried romanceable** adults dance with any other unmarried romanceable non-relative and usually swap partners after each song (a repeat partner is weighted down; friends and shared liking for dancing weight up); everyone else dances only with known friends or relatives, or alone if genuinely uninhibited. A waiting spouse also calls their partner away from the table once half a plate is eaten and weights their next decision toward the floor.

Pairs claim two adjacent authored dance spots (`pairSlots` groups the floor's stations by nearest neighbour, so moving the dance locale in the editor moves the pairs), walk there, and begin on the same beat only once both have arrived. Both carry `socialDance`/`socialLookAt` so the existing render-time NPC dance presentation animates them facing each other; nothing is animated while the player is elsewhere.

**Music is a hard prerequisite.** `FestivalSystem.musicPlaying` (an on-duty Kurraya performer in town, or the player playing there) gates starting and continuing every dance; when it stops, dancers drop out within one tick. If Foroji or Kaboku is dead or absent the other covers the stage for the whole gathering. Instrument audio is non-positional, so it is audible everywhere in town.

While Gorkunash's gathering hours (15:00–01:00) are active the ordinary town soundtrack and ambient cues are suppressed (`FestivalSystem.silencesTownMusic`, consulted by `music-system.js` for town BGM and cue eligibility only; combat music, weather and other ambience are untouched).

Tests: `node scripts/run-tests.js npc-festival-dance npc-shared-meals`.

**Buffet flow.** Guests first walk to a real queue spot (or a clear tile by the serving table) and reserve the bowl point only when they are at the front, so one guest's long walk from a house never blocks the line. The authored `buffet_queue_*` slots sit on the west side of the bowl stack (before the bowls, with the pots further east) so the line moves with the flow of service.

**Stage reliability.** `FestivalSystem` watches whichever musician is due on the bandstand. If their route fails for 20 game minutes, or they have not arrived after 90, they are relieved for that day and the other musician takes the stage (`stageDuty`/`watchStage`). Known content issue found while testing: in `map_i_general_store` Foroji's "Checking Shelves" spot (2,6) is a dead-end aisle sealed by the stool at (4,6), so a direct route from the aisle to the town fails; Kaboku covers the whole gathering in that case.
