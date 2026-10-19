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

**Two-avatar Festival Wheel Dance integrated:** `js/festival-wheel-dance-runtime.js` reproduces the Animation Author's four-second, twelve-fps-key-compatible root curve: the leader and follower share two synchronized revolutions, four 22-degree tilt-jump cycles, inward-facing orientation, and 0.4012 world-unit separation. Gameplay applies both avatar root transforms once per rendered frame after ordinary movement and NPC updates; while the pair is active the NPC walker scheduler is temporarily suspended and the player is movement/tool locked, with Leave available on Action 1. Stop, scene exit, combat/modal interruption, or NPC removal restores both original avatar transforms and releases locks. A simulated-time playback clock, not idle/paused wall time, awards precisely 15 Festival Fun per completed second, and the existing mobile FestivalSystem diagnostics report the live pair and animation progress. The game does **not** fall back to a solo dance if pair animation cannot start.

**Still in progress:** the alternate eligibility of one heart plus over 200 normal Rapport is not reachable with the present standard Rapport cap and needs a relationship-system design decision. World visuals, interaction reach, avatar scale offsets, and new furniture placement should also be verified in-game before merging. The PR's current merge conflicts also require reconciliation.
