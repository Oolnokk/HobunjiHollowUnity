# Ruin Room Authoring

The Ruin Room Author adds a shared authored/procedural definition layer on top of the Debris-ifier V50 interior network. V50 remains responsible for room/hallway topology, plateau elevations, wall construction, room connectivity and the physical support system. Room authoring runs after V50 has assigned room bounds and doorway coordinates, but before V50 derives wall panels and floor geometry from the network's `floorSet`.

## Open the editor

Use **Tools → World → Ruin Room Author** at `docs/tools/index.html`. The editor loads the same `DevRandomRuinRoomAuthoring` runtime as the playable Random Test Ruin.

- **Save locally** stores the library in this browser's `localStorage`. The game will use it on the next ruin generation in this browser.
- **Export JSON** downloads `room-library.json`. Replace `docs/config/ruin-room-authoring/room-library.json` with that file to share the authored library in the repository.
- **Import JSON** loads an exported or repository library into the editor. Save locally to make an imported library active in this browser.

The local browser library takes precedence over the repository JSON. Clearing or replacing that saved browser entry returns the game to the repository library.

## One definition format, two room sources

`hobunji_ruin_room_library.v1` contains two collections:

1. `templates` — fixed authored floor masks, doorway/entrance connections, placement spots and puzzle links.
2. `proceduralProfiles` — dimension/room-class matching rules and normalized placement spots for rooms whose footprint remains V50-generated.

Both collections use a `weight` during per-room deterministic selection. A matching template and matching procedural profile compete in the same weighted selection, so authors can bias generation toward authored set pieces without eliminating procedural variety. The same room seed selects the same source, template rotation and profile.

### Template footprints

A template's `footprint.rows` uses one character per V50 cell:

- `#` = walkable floor retained from the V50 room rectangle.
- `.` = void carved out of the floor.

The mask must be rectangular, between 3×3 and 48×48, and have one connected walkable component. V50's actual floor mesh, boundary walls, floor support map, plateau data and later collision scan consume the carved `floorSet`; this is not merely an editor preview or decorative overlay.

Template dimensions must exactly match the selected V50 room dimensions after an allowed 0°, 90°, 180° or 270° rotation. Every actual corridor doorway and the room entrance must match a declared connection on the same edge, at the same offset and with enough width. Required connections must also exist in the generated network. A template that does not fit is skipped; the room falls back to weighted procedural profile selection.

Connection offsets are measured in cells from the north/west start of the edge. `kind` is `corridor` or `entrance`. Connection cells must remain floor in the mask.

### Procedural profiles

Profiles match a generated room by minimum/maximum width, height and doorway count, with optional size-class or room-ID restrictions. Their spots use normalized `u`/`v` coordinates from 0 to 1; they do not change the room outline. If no authored template or profile matches, the runtime retains the original generated room with no additional authoring spots.

## Placement spots and allowlists

Each spot has a stable `id`, label, location, optional `required` flag, `maxUses` and `clearance`. Template spots use integer cell coordinates (`x`/`z`); procedural spots use normalized coordinates (`u`/`v`). Their world coordinates use the same two-unit padding and cell size as the playable ruin composers. `clearance` is a world-space separation radius: two distinct claimed spots must be at least the sum of their radii apart. A module that cannot honor that spacing is rejected before it is built.

Every spot has three independent allowlists:

- `mechanisms` — doors, moving platforms, lifts, puzzle blocks, traversal structures and other mechanism modules.
- `activators` — pressure plates, braziers, projectile targets, levers and other activation devices.
- `decorations` — pillars, statues, treasure, rubble, vegetation and architectural dressing.

List exact runtime type IDs to constrain a category. `*` (or `any`) permits any type in that category. An empty list permits none. `maxUses` is shared across the categories for that spot; separate mechanism and activator locations should normally have separate spots.

V50's mechanism/activator placement checks both categories before creating the activator. If a template/profile has puzzle links, the next unclaimed link requires its exact mechanism and activator spots; the pair is claimed together. Without explicit links, V50 claims any compatible unoccupied mechanism and activator spots.

The auxiliary puzzle composer kit exposes `roomAuthoringPlan`, `canClaimRoomSpot`, `availableRoomSpot` and `claimRoomSpot`. Chord-plate formations, unanchored canopies, ceiling glyphs, eligible cycling lifts and sarcophagus groups use the selected spot as their spatial anchor. Rope variants and ceiling-rail target runs use the spot's cross-room coordinate while retaining their safe traversal/door-clearance calculations. Some compound modules (such as a lock door reused from a V50 threshold, or a lift reserved for a rope/annex composition) retain their functional doorway/pit anchor; their spot remains an allowlist/capacity assignment rather than moving a required traversal connection. Rope variants, lava basins, rope payoffs and ceiling-rail target encounters filter candidate rooms by their configured category.

The room runtime snapshot includes the chosen plan per room and successful/rejected module claims in `roomAuthoring.diagnostics`. Required spots and links that no module claimed are listed as `missingRequiredSpots` and `missingRequiredLinks`; they are surfaced as authoring diagnostics rather than making an otherwise safe ruin generation fail.

## Puzzle relationships

A `puzzleLinks` entry references an activator spot and a mechanism spot by ID:

```json
{
  "id": "north-lever-opens-gate",
  "activatorSpot": "north-lever",
  "mechanismSpot": "central-gate",
  "relation": "activates",
  "required": true
}
```

V50 claims the referenced pair atomically. The activator is physically anchored to its authored spot: pressure-plate layouts try that exact center, linked-cube pairs use it as their center, and glyph targets select the nearest usable wall/pillar positions around it. The V50 doorway mechanism itself remains fixed to its generated corridor connection; its mechanism spot is the allowed/linked room slot, not permission to detach a door from its wall. The `relation` is retained in the plan and diagnostics, while V50's existing movement/activation implementation remains authoritative.

## Safety boundaries

- V50 source remains byte-for-byte protected by its SHA-verified embedded runtime patching workflow. Room authoring is integrated through verified exact-string patches in `debrisifier-01.js`.
- Templates only carve cells from an existing room's V50 bounding rectangle. They do not expand rooms, move corridors or reroute room connections.
- A non-matching template is ignored instead of distorting the network.
- The support/plateau authority is not rebuilt from the visual footprint. Carved cells are excluded from V50 floor mesh and support generation before those systems are constructed.
- No authored local data is written to a save file or committed automatically. Export is the explicit handoff for repository-wide authoring.
