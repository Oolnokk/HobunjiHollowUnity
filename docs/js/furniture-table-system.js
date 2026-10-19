// Map-scoped furniture relationships and direct interactions. Holiday content
// supplies service providers; chairs, tables and surface attachments stay reusable.
(() => {
  'use strict';
  const EMPTY = new Map(); // Shared empty lookup; missing maps allocate nothing in world interaction probes.
  const areas = new Map(); // Area -> placed furniture, indexed once at placement/rebuild time.
  const services = new Map(); // Provider id -> content-owned meal/shop/display actions.
  let deps = null; // Existing game seating and actor adapters, injected by game.js.
  const point = { x: 0, y: 0, z: 0 }; // Non-Three fallback used by data-only editor/tests.
  function areaId(area) { return ['map_hobunji_town', 'hobunji_main_town'].includes(area) ? 'town' : area; }
  function init(value) { deps = value; }
  function clearArea(area) { areas.delete(areaId(area)); }
  function registerPlacement(area, record, root, def = {}) {
    area = areaId(area);
    let entries = areas.get(area); // One registry per map, so identical table ids never cross interiors.
    if (!entries) areas.set(area, entries = new Map());
    const id = String(record.id || `${record.key || record.itemKey}:${record.col},${record.row}`); // Stable authored id; inventory placements retain a coordinate fallback.
    for (const [key, entry] of entries) if (entry.root === root || (entry.record.col === record.col && entry.record.row === record.row && entry.record.key === record.key)) entries.delete(key);
    const entry = { id, area, record, root, def }; // Holds live roots so moving/rotating a table carries its surface contents and targeting together.
    entries.set(id, entry);
    if (Array.isArray(record.surfaceItems) && root?.userData) {
      root.userData.instanceSurfacePlacements = record.surfaceItems;
      window.AuthoredFurniture?.load?.(record.key)?.then(data => {
        if (data && root.parent && entries.get(id) === entry) window.AuthoredFurniture.setItemPlacements(root, data, record.surfaceItems);
      });
    }
    if (root?.userData) root.userData.furnitureRelationship = { id, area, tableId: record.tableId || null };
    return entry;
  }
  function entries(area) { return areas.get(areaId(area)) || EMPTY; }
  function findSeat(area, seat) {
    if (!seat) return null;
    const id = seat.furnitureId || seat.id; // Schedule stations may explicitly reference a chair instance.
    const list = entries(area); // Coordinate fallback supports existing authored stations and player save data.
    if (id && list.get(id)?.def.sit && list.get(id).root?.parent) return list.get(id);
    for (const entry of list.values()) if (entry.def.sit && entry.root?.parent && entry.record.col === (seat.col ?? seat.c) && entry.record.row === (seat.row ?? seat.r)) return entry;
    return null;
  }
  function tableForSeat(area, seat) {
    const entry = findSeat(area, seat); // Membership is explicit, never inferred from whichever table happens to be nearest.
    const table = entry?.record.tableId ? entries(area).get(entry.record.tableId) : null; // Deleted/moved-away furniture cannot retain ghost members.
    return table?.root?.parent ? table : null;
  }
  function assignTable(area, chairId, tableId) {
    const list = entries(area), chair = list.get(chairId); // Reused by editors/debug tooling; the caller persists the same record.
    if (!chair?.def.sit || (tableId && !list.has(tableId)) || chairId === tableId) return false;
    chair.record.tableId = tableId || '';
    deps?.assignmentChanged?.(areaId(area), chair.record);
    return true;
  }
  function seatTransform(area, seat) {
    const entry = findSeat(area, seat); // Respects the actual outdoor/interior mesh transform, including locale offsets.
    const data = entry && window.AuthoredFurniture?.peek?.(entry.record.key); // Canonical furniture-author posterior anchor.
    const anchor = data && window.AuthoredFurniture.seatAnchorFor(data, seat?.seatIndex || 0);
    if (!anchor || !entry.root?.localToWorld || !window.THREE) return null;
    const location = entry.seatScratch ||= new window.THREE.Vector3();
    location.set(anchor.position.x || 0, anchor.position.y || 0, anchor.position.z || 0); // Only used when a seated pose is requested; no scene traversal.
    entry.root.updateWorldMatrix?.(true, false);
    entry.root.localToWorld(location);
    const floor = deps?.surfaceY?.(areaId(area), location.x, location.z) || 0; // Seat Y remains floor-relative for the existing leg solver.
    const matrix = entry.root.matrixWorld?.elements; // Includes grid quarter-turns and post-placement transforms, not just residual authored yaw.
    const rootYaw = matrix ? Math.atan2(matrix[8], matrix[10]) * 180 / Math.PI : Number(entry.record.rotY ?? entry.record.rotYDeg) || 0;
    const yaw = rootYaw + (anchor.rotationDeg?.y || 0);
    return { x: location.x, y: location.y - floor, z: location.z, facingRad: Math.PI / 2 - yaw * Math.PI / 180,
      normalDeg: { x: anchor.rotationDeg?.x || 0, z: anchor.rotationDeg?.z || 0 },
      footprintHalfDepth: (data.footprint?.d || 1) * (entry.root.scale?.z || 1) / 2, anchorZ: anchor.position.z || 0 };
  }
  function members(area, tableId) {
    area = areaId(area);
    if (!entries(area).has(tableId)) return [];
    const result = [], occupied = new Set(); // One actual occupant per chair/seat; queued guests are excluded.
    function add(id, seat, actor, position) {
      const chair = findSeat(area, seat); // A station assignment alone is not proof that its NPC has arrived.
      if (!chair || tableForSeat(area, seat)?.id !== tableId) return;
      const key = `${chair.id}:${seat.seatIndex || 0}`; // Bench seat indices are separate memberships.
      const transform = seatTransform(area, seat);
      const x = transform?.x ?? chair.record.col + (chair.def.fw || 1) / 2;
      const z = transform?.z ?? chair.record.row + (chair.def.fd || 1) / 2;
      if (!position || Math.hypot(position.x - x, position.z - z) > .35 || occupied.has(key)) return;
      occupied.add(key); result.push({ id, actor, chairId: chair.id, tableId, seatIndex: seat.seatIndex || 0 });
    }
    const player = deps?.getPlayerSeat?.(); // Player wins a contested seat; NPC reservations cannot duplicate the occupant.
    if (player?.phase === 'active' && areaId(deps.getArea()) === area) add('player', player, null, deps.getPlayerPosition?.());
    for (const walker of deps?.getWalkers?.() || []) {
      if (!walker.rec?.id || areaId(walker.area) !== area || walker.rec?.dead || walker.rec?.deceased || walker.currentScheduleTarget?.pose !== 'sit') continue;
      add(walker.rec.id, walker.currentScheduleTarget, walker, walker.root?.position);
    }
    return result;
  }
  function registerService(id, provider) { if (provider) services.set(id, provider); else services.delete(id); }
  function surfaceTargets(entry) {
    const layer = entry.root?.userData?.authoredItemPlacements; // Existing Furniture Author surface placements, including real 3D children.
    return (layer?.children || []).filter(holder => holder.userData?.surfacePlacement?.service);
  }
  function aimedService(area, aim = deps?.getAim?.()) {
    if (!aim || !Number.isFinite(aim.c) || !Number.isFinite(aim.r)) return null;
    let best = null, distance = .65; // Exact rendered attachment anchors replace hardcoded six-pot coordinate offsets.
    for (const entry of entries(area).values()) {
      if (!entry.record.serviceId || !entry.root?.parent) continue;
      const provider = services.get(entry.record.serviceId); // A provider can suspend its own content without changing furniture or global interactions.
      if (!provider || provider.enabled?.() === false) continue;
      for (const holder of surfaceTargets(entry)) {
        const location = holder.userData.targetScratch ||= window.THREE ? new window.THREE.Vector3() : { ...point }; // Reused by all subsequent aim checks.
        holder.getWorldPosition(location);
        const d = Math.hypot(location.x - aim.c, location.z - aim.r);
        if (d < distance) { distance = d; best = { entry, holder, placement: holder.userData.surfacePlacement, provider }; }
      }
    }
    return best;
  }
  function objectAt(area, col, row) {
    const target = aimedService(area); // Service objects use the same obj_* dispatch as every other world interaction.
    if (target && Math.floor(deps.getAim().c) === col && Math.floor(deps.getAim().r) === row) {
      return { getButtons: () => (target.provider.buttons?.(target) || []).map(button => ({ ...button, worldInteraction: true, promptRoot: target.holder })),
        onAction: action => target.provider.onAction?.(action, target) || { ok: false } };
    }
    for (const entry of entries(area).values()) {
      if (!entry.def.sit || !entry.root?.parent) continue;
      const x = entry.record.col, z = entry.record.row; // Preserve actual rotation, scale and offsets for exterior benches as well as single chairs.
      entry.root.updateWorldMatrix?.(true, false);
      const matrix = entry.root.matrixWorld?.elements;
      const yaw = matrix ? Math.atan2(matrix[8], matrix[10]) : (Number(entry.record.rotY ?? entry.record.rotYDeg) || 0) * Math.PI / 180, dx = col + .5 - entry.root.position.x, dz = row + .5 - entry.root.position.z;
      const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      if (Math.abs(lx) > (entry.def.fw || 1) * (entry.root.scale?.x || 1) / 2 || Math.abs(lz) > (entry.def.fd || 1) * (entry.root.scale?.z || 1) / 2) continue;
      const interactable = deps?.makeSitInteractable?.(entry.record.key, x, z, entry.def.fw || 1, entry.def.fd || 1, entry.record.rotY ?? entry.record.rotYDeg ?? 0); // The canonical Sit action still owns transitions and controls.
      if (!interactable) return null;
      const occupied = () => { const table=tableForSeat(area, entry.record); return table && members(area, table.id).some(member=>member.chairId===entry.id && member.id!=='player'); }; // Revalidated on press, not merely when the button was shown.
      return { ...interactable, getButtons: () => occupied() ? [{icon:'🪑',label:'Occupied',action:'obj_sit',style:'primary',allowed:false}] : interactable.getButtons(),
        onAction: action => occupied() ? {ok:false,message:'Someone is already sitting there.'} : interactable.onAction(action) };
    }
    return null;
  }
  function refreshServices() {
    for (const list of areas.values()) for (const entry of list.values()) {
      const provider = services.get(entry.record.serviceId); // Content can update soup/stock visibility without rebuilding or replacing the furniture.
      if (provider) for (const holder of surfaceTargets(entry)) provider.decorate?.(holder, holder.userData.surfacePlacement);
    }
  }
  function snapshot(area = deps?.getArea?.()) {
    return { latestChange: 'Direct outdoor seating, explicit chair/table membership, and authored surface furniture services.',
      area: areaId(area), placements: [...entries(area).values()].map(entry => ({ id: entry.id, tableId: entry.record.tableId || null, serviceId: entry.record.serviceId || null })) };
  }
  window.FurnitureTableSystem = { init, clearArea, registerPlacement, assignTable, tableForSeat, members, findSeat, seatTransform, registerService, aimedService, objectAt, refreshServices, snapshot };
})();
