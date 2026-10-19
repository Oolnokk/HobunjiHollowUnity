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
