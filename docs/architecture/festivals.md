# Weeklong town festivals

All five festivals last seven civil days, starting and ending at midnight. Decorations stay throughout the week; residents gather from 10:00 to 22:00 and otherwise resume their ordinary schedules. Roads, building entrances, terrain, and every town exit remain unchanged. The normal town returns automatically, including when the player stays in town across a date change.

| Festival | Dates | Working activities |
| --- | --- | --- |
| Hachutukara | Firstrise 22–28 | Permanent animal-mask gift, temporary resident costumes, a sweet from each resident, Hunundi's story through ordinary dialogue, dance, supervised live sparring with Oddclaw |
| Gorkunash | Highheat 8–14 | Quality-based cooked-meal potluck, dance, existing music minigame and live musician, bottle usable through the ordinary drink/share system |
| Tzizkhanash | Firstfall 22–28 | Wooden ancestor shrines, remembrance text, quality-based offering and choice of a 336-day blessing |
| Feast of the Five Blossoms | Thirdfall 15–21 | Five Blossom Dance, music, five-petal decorations and gathering court |
| Mountaindawn | Shallowfrost 1–7 | Double gift Favor and gift Rapport; a high-potency restorative gift from every available NPC with at least three hearts, including friends outside town |

The seasonal dates use the existing regional calendar, not an invented month-to-season mapping. Thirdfall 15 immediately follows Deadgrass. Highheat 8–14 is the middle Stormtide week. Hachutukara occupies the longest remaining gap. Mountaindawn includes Shallowfrost 5.

**Future-content note:** Omgurku Great Camp does not exist. Its solemn Gorkunash observance is recorded here and in the calendar definition only; no phantom camp, destination, or interaction has been created.

## Playing the skeleton

The guide near town tile 32,34 lists the current activity locations. Most activity courts are on the southern lawn beyond the shop road; Hunundi's Hachutukara storytelling circle and a secondary ancestor shrine sit beside the temple. Each activity has an in-world sign, reusable placeholder ornaments, and a normal action-bar entry. The menus support touch, keyboard, and the existing controller UI. Every festival menu includes **Copy diagnostics**.

- Potluck consumes exactly one chosen quality of cooked food. Quality 1–5 earns 1/3/6/10/16 Favor with each resident, through normal relationship handling.
- Offerings consume exactly one chosen quality of a physical giftable item. Quality is the blessing level, 1–5. Choose movement speed (+2% per level), stamina regeneration (+4%), or positive Favor (+5%). The blessing replaces the prior ancestor blessing and expires after 336 civil days, including sleep and reloads.
- Mountaindawn gifts and Hachutukara sweets can be received directly from nearby friends or collected from the communal table. Both routes share the same annual claim. Three hearts means 120 Favor points.
- Dance participation uses the existing social dance animation for 20 seconds and earns +2 Favor with residents once per festival. Dodge or the leave-dance action cancels. Further dancing is allowed without repeat rewards.
- Friendly duels reuse combat training, borrowed weapons, the shared Oddclaw renderer/AI, and equipment/resource restoration. Three verified hits finish the exercise; completion gives +6 Favor with Spearhead and Oddclaw once per year. Leaving the ring, leaving town, or ending the festival cancels and restores temporary state.
- Other grants are once per year: one animal mask, one liquor bottle, one potluck, and one offering. Capacity is checked before item claims are marked.

Balance values, narrative prose, props, and costumes are intentionally a playable foundation for later bespoke art and choreography.

## Editing layouts

Open the Map Editor, choose **Hobunji Hollow Town**, then select a festival under **Alternate Layouts**. Decor placement, movement, deletion, NPC stations, and 3D preview operate on that layout. Base-level roads, terrain, buildings, and exits stay shared. JSON export, undo, save, and live reflection retain the activity metadata and independent station arrays.

The **Festival prop settings** panel edits any selected layout prop's activity type, label, tile position, reach, ornament preset, and color. Activity reach is drawn in the 2D editor. Moving a dance rug, shrine, table, or duel ring also moves its mechanics. Existing decor transforms remain available. Select **Base (default)** to edit the normal town.

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

Visual browser playtesting remains necessary before merging: inspect each layout in the editor and game, navigate every exit, and try activity menus on a phone. The implementation environment could not install its browser runtime, so automated validation is not a claim of a completed visual playthrough.
