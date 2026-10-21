# Shared chairs, tables and surface furniture

`js/furniture-table-system.js` registers live furniture in each area. It is initialized once by `game.js`; normal inventory placement, farm save restoration, exterior maps, building interiors and resolved locale children register their final saved record, mesh and furniture definition. It owns no frame loop or holiday rules.

## Chair relationships

Give each table and chair a stable `id`, and put the table's id in the chair's `tableId`. The Map Editor's **Furniture & locale properties** panel edits these links on exterior/interior decor and locale children. The Building Interior Author exposes **Belongs to table** for furniture. Inventory furniture links are preserved in farm/farmhouse saves. Relationships are map-local: `dining` in an inn is distinct from `dining` outdoors.

Locale roots accept `locale` (the legacy `festivalLocale` field is also supported). Local parts have local ids; chair `tableId` and seated station `furnitureId` refer to these ids. Map layout expansion namespaces them under the root and applies the root transform. Moving the locale carries the furniture, seat destinations and links together.

`FurnitureTableSystem.members(area, tableId)` returns current `{id, actor, chairId, tableId, seatIndex}` records. A villager must have reached its actual seated position, not simply reserved a station. The active player seat is included as `id: "player"`. Missing or removed chairs and actors in other maps cannot become table members. `assignTable(area, chairId, tableId)` updates the live record and invokes the save adapter; an empty table id clears the link. Runtime membership never guesses the nearest table.

Chairs use the existing `makeSitInteractable` / `beginSitInteraction` controls. Seat positions come from the canonical authored posterior anchor transformed through the actual mesh, including outdoor elevation, rotation, scale and locale offsets.

## Furniture on surfaces

Furniture Author's existing **Items and furniture on surfaces** catalog includes repository furniture templates. A placement uses `furnitureKey` instead of `itemKey`/`imageUrl`; position, rotation, scale and recognized surface ids use the existing surface-placement format. These records export in `itemPlacements` and render in editor previews and gameplay. Use the normal placement gizmo to move or rotate them.

Nested models pass through the canonical furniture/vessel builder, retaining hollow cups, liquid geometry, authored parts and ambient VFX. Attachments follow the parent transform. Self/indirect containment is rejected, depth is bounded, and replaced placements cancel pending model loads. Disposing placements does not dispose shared furniture textures.

A map instance can supply `surfaceItems` to override a template's placements without mutating the shared template. The serving table is an ordinary long-table template with six `servingPot` placements and one `bowlStack`. The drinks table uses an instance override on `tableSmall`.

## Optional object services

Content can register `registerService(id, {enabled, buttons, onAction, decorate})`, set that id as the parent instance's `serviceId`, and attach arbitrary `service` metadata to surface records. The shared targeter uses each rendered attachment's world position and routes its `obj_*` actions through ordinary world interaction. Providers can implement shops, displays or shared meals without adding a new input route or activity radius.

`festival-system.js` is one provider: it supplies the holiday menu, availability, annual donation and rewards. It owns no chair placement, table membership or pot geometry. Normal social-wheel dancing and instrument sessions earn participation with nearby villagers during gathering hours, anywhere in town. There is no Gorkunash or join-activity input.

## Verification

`node scripts/run-tests.js furniture-table-system furniture-surface-nesting furniture-vessel-runtime gorkunash-locales festivals`

These execute map isolation, explicit assignments, actual occupants, direct object services, nested geometry construction, canonical builder use, recursion rejection, canceled loads, held-food contributions and ordinary wheel participation away from marked locales. Browser validation also renders the real serving assets and checks their tabletop height and parent transforms.

## Reservations, world targets and shared gathering behavior

`isSeatTaken(area, seat, exceptId)` checks the player, approaching NPCs and same-pass planner leases by physical chair plus seat index. Both generic activity planning and gathering selection consult it. Gathering choices stay stable for their shift, try another preferred locale when full, and otherwise choose clear standing ground. Live targets renew the reservation before walking. Occupancy is independent of table assignment.

NPCs use a separate pass through the existing `RangedWeapons.focusCandidates` camera-ray selector. Social reach is six tiles (`movement.npc.socialInteractionRadiusTiles`), measured from the player; scenery/furniture blockers cannot defeat an aimed NPC. An off-ray nearby NPC cannot win. Chairs, serving objects and solid furniture retain the physical furniture pass when no NPC is aimed at. The chosen target is shared by display and press, and disabled occupied-chair prompts remain visible. Movement probes use the same placed furniture transforms, including rotation and scale; doors and mechanisms keep their existing dynamic owners.

Grass suppression merges these footprints with the existing building filter and restores original instances when a locale moves or disappears. The bandstand platform is a normal shortened/stretched `tableLong` child with `walkableElevation` enabled. It registers with the same geometry-derived support registry as the inn stage and porches.

NPC commands remain on **hold Talk**, using the existing command wheel and input-claim owner. Its floating list adds **Hold [current bound input] More**. Ordinary Follow/Wait/Dismiss and festival dance invitations join the existing romance commands. `npc-following.js` contains the movement shared by ordinary companions and dates, including reservation of a separate chair at the seated player's explicitly assigned table. The general social wheel retains solo dance and instrument options.

NPC-only hidden music frames disable physical input before audio initialization, preserving the generated performance when the player uses overworld controls. Player music sessions keep their existing input and backup behavior. Furniture, following and NPC performance diagnostics are included in the mobile Pixel Probe report.

Movement collision builds reusable four-tile spatial buckets once per queried area per scheduler frame. Mechanism classification and transformed footprints are shared across path probes; exact oriented collision remains authoritative. Registration and clearing invalidate the index immediately, while live transforms and collision flags refresh on the next frame. Editor contexts without a frame owner use immediate queries. Pixel Probe includes cumulative collision query, index-build, candidate-test and classification counts.


## Town loader and grass readiness

`TownZoneBuildings.init` must receive `DECORATIVE_FURNITURE_DEFS`, just as the furniture mesh builder does. Its final `registerPlacement` replaces the builder's initial record: an empty definition here loses chair eligibility, width/depth, and walkability. Passing the definitions to GridTileAccessors alone does not wire the town loader.

`BuildingGrassSuppression` can arrive through the late house-pieces dependency loader after the town has initialized. It recovers the existing adapters from `TownZoneBuildings.grassContext()`, immediately filters the current scene, and installs the existing scene-add hook for later grass rebuilds. The init wrapper handles the other load order. Furniture footprint keys include partially intersecting grass tiles; immutable source matrices restore grass after removal. Check both load orders, not just a synthetic registry populated after the filter loads.

`test-town-furniture-wiring.js` executes the actual game dependency bag and late-load sequence. `test-social-interaction-reach.js` executes the production camera-ray selector through scenery and across range/map boundaries.
