// Map-scoped furniture relationships and direct interactions. Holiday content
// supplies service providers; chairs, tables and surface attachments stay reusable.
(() => {
  'use strict';
  const EMPTY = new Map(); // Shared empty lookup; missing maps allocate nothing in world interaction probes.
  const areas = new Map(); // Area -> placed furniture, indexed once at placement/rebuild time.
  const services = new Map(); // Provider id -> content-owned meal/shop/display actions.
  const collisionAreas = new Map(); // Per-area reusable spatial buckets for the many NPC pathfinding probes in a frame.
  const collisionStats = { queries:0, builds:0, candidates:0, classifications:0 }; // Mobile Pixel Probe counters; read only when diagnostics are requested.
  const COLLISION_CELL = 4; // Tile width of broad-phase buckets; exact oriented tests still decide collisions.
  let deps = null; // Existing game seating and actor adapters, injected by game.js.
  const point = { x: 0, y: 0, z: 0 }; // Non-Three fallback used by data-only editor/tests.
  function areaId(area) { return area === 'map_hobunji_town' || area === 'hobunji_main_town' ? 'town' : area; }
  function init(value) { deps = value; collisionAreas.clear(); surfaceProbe.valid=false; }
  function clearArea(area) { surfaceProbe.valid=false; for(const entry of entries(area).values())window.HobunjiWalkableElevation?.unregister?.(`placed-furniture:${areaId(area)}:${entry.id}`); areas.delete(areaId(area)); collisionAreas.delete(areaId(area)); focusStamp=null; }
  function registerPlacement(area, record, root, def = {}) {
    area = areaId(area);
    let entries = areas.get(area); // One registry per map, so identical table ids never cross interiors.
    if (!entries) areas.set(area, entries = new Map());
    const id = String(record.id || `${record.key || record.itemKey}:${record.col},${record.row}`); // Stable authored id; inventory placements retain a coordinate fallback.
    for (const [key, entry] of entries) if (entry.root === root || (record.id && key === id)) entries.delete(key); // Overlapping rugs own distinct ids; a coincident tile cannot evict another rug or table entry.
    const entry = { id, area, record, root, def }; // Holds live roots so moving/rotating a table carries its surface contents and targeting together.
    entries.set(id, entry);
    collisionAreas.delete(area); // Same-frame placement/replacement must invalidate the broad phase too.
    focusStamp = null; // Placement changes invalidate any cached interaction target.
    window.NpcFurnitureWardrobes?.primeArea?.(area); // Authored map storage receives its real furniture-to-NPC binding asynchronously.
    surfaceProbe.valid=false; // New/replaced furniture must be visible to camera proximity immediately.
    entry.height = record.key === 'wardrobe' || record.itemKey === 'wardrobeFurniture' ? 2.2 : def.sit ? 1 : .8; // Tall wardrobes remain focusable before their authored geometry finishes loading.
    window.AuthoredFurniture?.load?.(record.key)?.then(data => {
      if (!data || !window.THREE?.Box3 || !root.parent || entries.get(id)!==entry) return;
      surfaceProbe.valid=false; // Asset readiness invalidates camera proximity even while the player remains stationary.
      const bounds = new window.THREE.Box3().setFromObject(root); // One asset-readiness measurement, never scene traversal during interaction queries.
      if (!bounds.isEmpty()) entry.height=(bounds.max.y-bounds.min.y)/Math.max(.001,Math.abs(root.scale?.y||1));
      if(record.walkableElevation)window.HobunjiWalkableElevation?.registerObject?.(root,{id:`placed-furniture:${area}:${id}`,kind:'placed-furniture',area,sourceId:id,sourceKey:record.key}); // Reuses the inn-stage/porch support registry for both player and NPC elevation.
    });
    if (Array.isArray(record.surfaceItems) && root?.userData) {
      root.userData.instanceSurfacePlacements = record.surfaceItems;
      window.AuthoredFurniture?.load?.(record.key)?.then(data => {
        if (data && root.parent && entries.get(id) === entry) window.AuthoredFurniture.setItemPlacements(root, data, record.surfaceItems);
      });
    }
    if (root?.userData) root.userData.furnitureRelationship = { id, area, tableId: record.tableId || null };
    return entry;
  }
  function unregisterPlacement(area, idOrRoot) {
    const list = entries(area); // Removing one overlapping rug must not evict any unrelated instance on the same tile.
    for (const [id, entry] of list) if (id === idOrRoot || entry.root === idOrRoot) {
      list.delete(id);
      collisionAreas.delete(areaId(area)); focusStamp = null; surfaceProbe.valid = false;
      return true;
    }
    return false;
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
  // Resolve a scheduled bed from the exact placed surface, including building-map post offsets/scale.
  // Station tiles may occupy either half of a double bed, so keep that tile's lateral position.
  // Scheduled sleepers retain their authored station location for navigation while matching the mattress surface.
  function lieTransform(area, target) {
    if (!target || target.pose !== 'lie' || !window.THREE) return null;
    const stationCol = Number(target.c ?? target.col), stationRow = Number(target.r ?? target.row); // Walkable navigation tile; may sit just beside the bed collider.
    const col = Number(target.bedCol ?? stationCol), row = Number(target.bedRow ?? stationRow); // Explicit bed origin lets spouse sleep targets resolve even when navigation uses an adjacent tile.
    if (![stationCol, stationRow, col, row].every(Number.isFinite)) return null;
    const bedKeys = new Set(['basicBed', 'doubleBed', 'bedroll']); // Only actual sleeping furniture can supply a mattress, never a nearby wardrobe/table.
    const id = target.furnitureId || target.bedId || null; // Map-editor furnished stations may have a specific bed reference.
    let entry = id ? entries(area).get(String(id)) : null;
    if (!entry || !bedKeys.has(entry.record.key)) {
      entry = [...entries(area).values()].find(item => {
        if (!item.root?.parent || !bedKeys.has(item.record.key)) return false;
        const w = Number(item.def?.fw) || 1, d = Number(item.def?.fd) || 1;
        return col >= item.record.col && row >= item.record.row && col < item.record.col + w && row < item.record.row + d;
      });
    }
    if (!entry?.root?.parent) return null;
    const data = window.AuthoredFurniture?.peek?.(entry.record.key);
    const top = window.AuthoredFurniture?.sleepSurfaceHeight?.(data);
    if (!Number.isFinite(top)) return null;
    entry.root.updateWorldMatrix?.(true, false);
    const location = new window.THREE.Vector3(0, top, 0);
    entry.root.localToWorld(location);
    const centerX = Number(entry.record.col) + (Number(entry.def?.fw) || 1) * 0.5;
    const centerZ = Number(entry.record.row) + (Number(entry.def?.fd) || 1) * 0.5;
    const stationOffsetX = target.bedCenter ? 0 : stationCol + 0.5 - centerX;
    const stationOffsetZ = target.bedCenter ? 0 : stationRow + 0.5 - centerZ; // Spouses sleep on the mattress center; authored multi-station beds retain their individual side offsets.
    const rot = (Number(entry.record.rotY ?? entry.record.rotYDeg) || 0) * Math.PI / 180;
    const x = location.x + stationOffsetX * Math.cos(rot) + stationOffsetZ * Math.sin(rot);
    const z = location.z - stationOffsetX * Math.sin(rot) + stationOffsetZ * Math.cos(rot);
    const floor = deps?.surfaceY?.(areaId(area), x, z) || 0;
    return { x, z, y: location.y, floorY: floor, facingRad: rot, furnitureId: entry.id, key: entry.record.key };
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
      footprintHalfDepth: (window.AuthoredFurniture?.seatedKneeReach?.(data) || 0.11) * (entry.root.scale?.z || 1), anchorZ: anchor.position.z || 0 }; // Calves bend at the actual seat edge, not the tile footprint.
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
    if (deps?.focusCandidates) { const target=focusedTarget(area); return target?.kind==='service' ? target : null; }
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
  function serviceObject(target) {
    return { getButtons: () => (target.provider.buttons?.(target) || []).map(button => ({ ...button, worldInteraction:true, promptRoot:target.holder })),
      onAction: action => target.provider.onAction?.(action,target) || {ok:false} };
  }
  function wardrobeObject(area, entry) {
    const binding = window.NpcFurnitureWardrobes?.ownerForPlacement?.(area, entry.record); // The placement's own ID/metadata selects the NPC, never proximity to the NPC.
    if (!binding || !entry.root?.parent) return null;
    return {
      id: 'wardrobe:' + entry.id, promptRoot: entry.root, // WorldPopupText floats over the actual rendered wardrobe or chest.
      getButtons: () => [{ icon: '👗', label: window.NpcFurnitureWardrobes?.nameForOwner?.(binding.npcId) + "'s Wardrobe",
        action: 'obj_open_wardrobe', style: 'primary', allowed: true, worldInteraction: true,
        promptRoot: entry.root }],
      onAction: action => {
        if (action !== 'obj_open_wardrobe') return { ok: false, message: 'Unknown wardrobe action.' };
        const current = window.NpcFurnitureWardrobes?.ownerForPlacement?.(area, entry.record); // Validate the same furniture assignment again on button press.
        if (current?.npcId !== binding.npcId) return { ok: false, message: 'Wardrobe assignment changed.' };
        return window.NpcFurnitureWardrobes?.openWardrobe?.(current.npcId, area, entry.id, current)
          ? { ok: true, message: '', deferMemberSave: true } : { ok: false, message: 'Wardrobe unavailable.' };
      },
    };
  }
  function chairObject(area, entry) {
    const interactable=deps?.makeSitInteractable?.(entry.record.key,entry.record.col,entry.record.row,entry.def.fw||1,entry.def.fd||1,entry.record.rotY ?? entry.record.rotYDeg ?? 0);
    if(!interactable)return null;
    const occupied=()=>isSeatTaken(area,{...entry.record,seatIndex:0},'player'); // Recheck reservations on press as well as prompt generation.
    return {...interactable, getButtons:()=>occupied() ? [{icon:'🪑',label:'Occupied',action:'obj_sit',allowed:false,showWhenUnavailable:true,worldInteraction:true,promptRoot:entry.root}]
      : interactable.getButtons().map(button=>({...button,worldInteraction:true,promptRoot:entry.root})),
      onAction:action=>occupied()?{ok:false,message:'Someone has already taken this seat.'}:interactable.onAction(action)};
  }
  function objectAt(area, col, row) {
    window.NpcFurnitureWardrobes?.primeArea?.(area); // Idempotent warm-up for authored rooms whose furniture registered before the wardrobe module loaded.
    if(deps?.focusCandidates) {
      const target=focusedTarget(area); // Directional selection replaces the ground-tile fallback whenever the game's ray owner is available.
      return target?.kind==='wardrobe' ? wardrobeObject(area,target.entry)
        : target?.kind==='chair' ? chairObject(area,target.entry)
        : target?.kind==='service' ? serviceObject(target) : null;
    }
    const target = aimedService(area); // Service objects use the same obj_* dispatch as every other world interaction.
    if (target && Math.floor(deps.getAim().c) === col && Math.floor(deps.getAim().r) === row) {
      return { getButtons: () => (target.provider.buttons?.(target) || []).map(button => ({ ...button, worldInteraction: true, promptRoot: target.holder })),
        onAction: action => target.provider.onAction?.(action, target) || { ok: false } };
    }
    for (const entry of entries(area).values()) {
      const wardrobe = window.NpcFurnitureWardrobes?.ownerForPlacement?.(area, entry.record);
      if ((!entry.def.sit && !wardrobe) || !entry.root?.parent) continue;
      const x = entry.record.col, z = entry.record.row; // Preserve actual rotation, scale and offsets for exterior benches and storage furniture.
      entry.root.updateWorldMatrix?.(true, false);
      const matrix = entry.root.matrixWorld?.elements;
      const yaw = matrix ? Math.atan2(matrix[8], matrix[10]) : (Number(entry.record.rotY ?? entry.record.rotYDeg) || 0) * Math.PI / 180, dx = col + .5 - entry.root.position.x, dz = row + .5 - entry.root.position.z;
      const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      if (Math.abs(lx) > (entry.def.fw || 1) * (entry.root.scale?.x || 1) / 2 || Math.abs(lz) > (entry.def.fd || 1) * (entry.root.scale?.z || 1) / 2) continue;
      return wardrobe ? wardrobeObject(area, entry) : chairObject(area, entry);
    }
    return null;
  }
  function refreshServices() {
    for (const list of areas.values()) for (const entry of list.values()) {
      const provider = services.get(entry.record.serviceId); // Content can update soup/stock visibility without rebuilding or replacing the furniture.
      if (provider) for (const holder of surfaceTargets(entry)) provider.decorate?.(holder, holder.userData.surfacePlacement);
    }
  }
  function seatKey(area, seat) {
    const chair = findSeat(area, seat); // Canonical physical seat identity also unifies station aliases.
    const id = chair?.id || seat?.furnitureId || `${seat?.col ?? seat?.c},${seat?.row ?? seat?.r}`;
    return `${areaId(area)}:${id}:${seat?.seatIndex || 0}`;
  }
  function seatNow() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  const seatClaims = new Map(); // Short leases cover same-pass planner queries before walkers publish their chosen targets.
  function setSeatTarget(id, target) {
    if (!id) return;
    if (target?.pose !== 'sit') { seatClaims.delete(id); return; }
    seatClaims.set(id, { key:seatKey(target.area, target), target, until:seatNow()+5000 });
  }
  function isSeatTaken(area, seat, exceptId = '') {
    const key = seatKey(area, seat), now = seatNow(); // Reservations count while approaching, not just after the sitting pose starts.
    const player = deps?.getPlayerSeat?.();
    if (exceptId !== 'player' && player && areaId(deps.getArea()) === areaId(area) && seatKey(area, player) === key) return true;
    for (const [id, claim] of seatClaims) {
      if (claim.until < now) { seatClaims.delete(id); continue; }
      if (id !== exceptId && claim.key === key) return true;
    }
    for (const walker of deps?.getWalkers?.() || []) {
      const target = walker.currentScheduleTarget; // Live targets retain reservations throughout a long walk or pause.
      if (walker.rec?.id === exceptId || walker.rec?.dead || walker.rec?.deceased || target?.pose !== 'sit') continue;
      if (seatKey(target.area || walker.area, target) === key) return true;
    }
    return false;
  }
  function companionSeat(area, npcId) {
    const player=deps?.getPlayerSeat?.(); // Follower/date dining uses the player's actual assigned table, never nearest-table guessing.
    if(player?.phase!=='active' || areaId(deps.getArea())!==areaId(area))return null;
    const table=tableForSeat(area,player);
    if(!table)return null;
    const previous=seatClaims.get(npcId)?.target; // Keep a companion in its own reserved chair when another table seat becomes free.
    if(previous && areaId(previous.area)===areaId(area) && tableForSeat(area,previous)?.id===table.id && !isSeatTaken(area,previous,npcId))return previous;
    for(const entry of entries(area).values()) {
      if(!entry.def.sit || !entry.root?.parent || entry.record.tableId!==table.id)continue;
      const count=window.AuthoredFurniture?.seatCount?.(window.AuthoredFurniture.peek(entry.record.key)) || 1;
      for(let seatIndex=0;seatIndex<count;seatIndex++) {
        const target={area:areaId(area),furnitureId:entry.id,furnitureKey:entry.record.key,c:entry.record.col,r:entry.record.row,seatIndex,rotY:entry.record.rotY ?? entry.record.rotYDeg ?? 0,pose:'sit'};
        if(isSeatTaken(area,target,npcId))continue;
        setSeatTarget(npcId,target);return target;
      }
    }
    return null;
  }
  function placementFrame(entry) {
    const stamp=deps?.frameId?.(); // Movement probes share one transformed footprint per furniture instance per frame.
    if(stamp!=null && entry.frameStamp===stamp)return entry.frame;
    entry.frameStamp=stamp;
    const root = entry.root; // Live matrices carry editor offsets, scale and grid rotation into every footprint query.
    root.updateWorldMatrix?.(true, false);
    const matrix = root.matrixWorld?.elements;
    const yaw = matrix ? Math.atan2(matrix[8], matrix[10]) : (Number(entry.record.rotY ?? entry.record.rotYDeg) || 0)*Math.PI/180;
    return entry.frame = { x:matrix?.[12] ?? root.position.x, z:matrix?.[14] ?? root.position.z,
      y:matrix?.[13] ?? root.position.y ?? 0, cos:Math.cos(yaw), sin:Math.sin(yaw),
      w:(entry.def.fw || 1)*Math.abs(root.scale?.x || 1)/2, d:(entry.def.fd || 1)*Math.abs(root.scale?.z || 1)/2 };
  }
  function solid(entry) {
    const stamp=deps?.frameId?.(); // Classification is shared by collision and targeting, never normalized per path probe.
    if(stamp!=null && entry.solidStamp===stamp)return entry.isSolid;
    entry.solidStamp=stamp;
    collisionStats.classifications++;
    return entry.isSolid = !entry.def.walkable && !entry.def.wallOrnament && !entry.record.wallPlacement && !entry.record.nonColliding && !entry.record.walkableElevation
      && !window.InteriorFurnitureGrid?.isDynamicMechanism?.(entry.record) && !/^(?:woodenDoor|door)$/.test(entry.record.key); // Dynamic doors/mechanisms retain their existing collision authority.
  }
  function collisionIndex(area, stamp) {
    let index=collisionAreas.get(area); // Reuse bucket maps/arrays after warmup instead of allocating for each query/frame.
    if(index?.stamp===stamp)return index;
    if(!index)collisionAreas.set(area,index={columns:new Map(),buckets:[],stamp:null});
    for(const bucket of index.buckets)bucket.length=0;
    index.stamp=stamp;collisionStats.builds++;
    for(const entry of entries(area).values()) {
      if(!entry.root?.parent || !solid(entry))continue;
      const f=placementFrame(entry), ex=Math.abs(f.cos)*f.w+Math.abs(f.sin)*f.d, ez=Math.abs(f.sin)*f.w+Math.abs(f.cos)*f.d; // Conservative world AABB encloses the rotated footprint.
      if(!Number.isFinite(f.x+f.z+ex+ez))continue;
      for(let c=Math.floor((f.x-ex)/COLLISION_CELL);c<=Math.floor((f.x+ex)/COLLISION_CELL);c++) {
        let column=index.columns.get(c); // Numeric keys avoid constructing a tile string for every path probe.
        if(!column)index.columns.set(c,column=new Map());
        for(let r=Math.floor((f.z-ez)/COLLISION_CELL);r<=Math.floor((f.z+ez)/COLLISION_CELL);r++) {
          let bucket=column.get(r); // A spanning table belongs to every overlapped cell.
          if(!bucket){column.set(r,bucket=[]);index.buckets.push(bucket);}
          bucket.push(entry);
        }
      }
    }
    return index;
  }
  function entryBlocksBox(entry,x,z,half,worldY) {
    if(!entry.root?.parent)return false;
    collisionStats.candidates++;
    const f=placementFrame(entry), dx=x-f.x, dz=z-f.z; // OBB/AABB separating axes preserve rotated narrow furniture and whole-body clearance.
    if(Number.isFinite(worldY) && (worldY<f.y || worldY>f.y+(entry.height||1)*Math.abs(entry.root.scale?.y||1)))return false;
    const c=Math.abs(f.cos), s=Math.abs(f.sin), margin=half*(c+s);
    return Math.abs(dx*f.cos-dz*f.sin)<f.w+margin && Math.abs(dx*f.sin+dz*f.cos)<f.d+margin
      && Math.abs(dx)<f.w*c+f.d*s+half && Math.abs(dz)<f.w*s+f.d*c+half;
  }
  function blocksBox(area, x, z, half = 0, worldY = null) {
    if(!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(half) || half<0)return false;
    collisionStats.queries++;
    area=areaId(area);
    if(!areas.has(area))return false;
    const stamp=deps?.frameId?.(); // Editors without a frame owner retain immediate live-transform queries.
    if(stamp==null) {
      for(const entry of entries(area).values())if(entry.root?.parent && solid(entry) && entryBlocksBox(entry,x,z,half,worldY))return true;
      return false;
    }
    const index=collisionIndex(area,stamp), visit=collisionStats.queries; // Global query id survives same-frame index replacement; no per-query Set.
    for(let c=Math.floor((x-half)/COLLISION_CELL);c<=Math.floor((x+half)/COLLISION_CELL);c++) {
      const column=index.columns.get(c); // Empty space returns without visiting any furniture.
      if(!column)continue;
      for(let r=Math.floor((z-half)/COLLISION_CELL);r<=Math.floor((z+half)/COLLISION_CELL);r++) {
        const bucket=column.get(r); // Missing buckets allocate nothing in the pathfinding hot loop.
        if(!bucket)continue;
        for(const entry of bucket) {
          if(entry.collisionVisit===visit)continue;
          entry.collisionVisit=visit;
          if(entryBlocksBox(entry,x,z,half,worldY))return true;
        }
      }
    }
    return false;
  }
  function grassFootprintKeys(area) {
    const keys = new Set(); // Computed only on placement/rebuild; grass filtering restores from its existing immutable source matrices.
    for (const entry of entries(area).values()) {
      if (!entry.root?.parent || entry.record.clearGrass === false) continue;
      const f=placementFrame(entry), locale=entry.record.locale || entry.record.festivalLocale; // Locale clear space may exceed the root furniture's visible footprint.
      const w=Math.max(f.w, (Number(locale?.width)||0)/2), d=Math.max(f.d,(Number(locale?.depth)||0)/2);
      const ex=Math.abs(f.cos)*w+Math.abs(f.sin)*d, ez=Math.abs(f.sin)*w+Math.abs(f.cos)*d;
      for(let r=Math.floor(f.z-ez);r<Math.ceil(f.z+ez);r++)for(let c=Math.floor(f.x-ex);c<Math.ceil(f.x+ex);c++) {
        const dx=c+.5-f.x, dz=r+.5-f.z;
        if(Math.abs(dx*f.cos-dz*f.sin)<w+.5*(Math.abs(f.cos)+Math.abs(f.sin)) && Math.abs(dx*f.sin+dz*f.cos)<d+.5*(Math.abs(f.cos)+Math.abs(f.sin)))keys.add(`${c},${r}`);
      }
    }
    return keys;
  }
  const socialCandidates = []; // NPC-only ray pass ignores scenery, while furniture keeps its physical blockers.
  const focusCandidates = []; // Reused candidate buffer; the existing ranged targeting owner supplies the actual camera ray/slab intersection.
  const unobstructedCandidates = []; // Reused to find the first actual hit past a service table's oversized collision bounds.
  let focusStamp = null, focusArea = null, focused = null; // One consistent NPC/chair/service winner for prompt and press in the same frame.
  function focusedTarget(area) {
    if (!deps?.focusCandidates) return null;
    const stamp=deps.frameId?.();
    if (stamp != null && stamp === focusStamp && area === focusArea) return focused;
    focusStamp=stamp;focusArea=area;focusCandidates.length=0;socialCandidates.length=0;
    const player=deps.getPlayerPosition(); // Interaction reach is measured from the player, never from the trailing camera.
    for(const entry of entries(area).values()) {
      if(!entry.root?.parent)continue;
      const f=placementFrame(entry);
      if(Math.hypot(f.x-player.x,f.z-player.z)>3+Math.max(f.w,f.d))continue;
      const wardrobe = window.NpcFurnitureWardrobes?.ownerForPlacement?.(area, entry.record); // Camera-targeted storage, whether authored or player-assigned.
      if(entry.def.sit || solid(entry) || wardrobe) {
        const ex=Math.abs(f.cos)*f.w+Math.abs(f.sin)*f.d, ez=Math.abs(f.sin)*f.w+Math.abs(f.cos)*f.d;
        const box=entry.focusBox ||= {min:{},max:{}}; // Plain cached bounds avoid constructing Three.js objects during frame work.
        Object.assign(box.min,{x:f.x-ex,y:f.y,z:f.z-ez});Object.assign(box.max,{x:f.x+ex,y:f.y+(entry.height||1)*Math.abs(entry.root.scale?.y||1),z:f.z+ez});
        focusCandidates.push({kind:wardrobe?'wardrobe':entry.def.sit?'chair':'blocker',entry,box});
      }
      const provider=services.get(entry.record.serviceId);
      if(!provider || provider.enabled?.()===false)continue;
      for(const holder of surfaceTargets(entry)) {
        const p=holder.userData.targetScratch ||= new window.THREE.Vector3(); // Attachment transforms follow a moved/rotated/scaled table.
        holder.getWorldPosition(p);
        const box=holder.userData.focusBox ||= {min:{},max:{}};
        Object.assign(box.min,{x:p.x-.23,y:p.y,z:p.z-.23});Object.assign(box.max,{x:p.x+.23,y:p.y+.35,z:p.z+.23});
        focusCandidates.push({kind:'service',entry,holder,provider,placement:holder.userData.surfacePlacement,box});
      }
    }
    const addNpc=walker=>{
      if(!walker || walker.combatTutorialSuspended || walker.rec?.dead || walker.rec?.deceased || walker.root?.visible===false || areaId(walker.area)!==areaId(area))return;
      const p=walker.root?.position;
      if(!p || Math.hypot(p.x-player.x,p.z-player.z)>(deps.npcReach?.() || 6))return;
      const hitbox=deps.actorHitbox?.(walker); // Canonical portrait dimensions include species scale and seated body placement.
      if(hitbox)socialCandidates.push({kind:'npc',walker,hitbox});
    };
    for(const walker of deps.getWalkers?.() || [])addNpc(walker);
    addNpc(deps.extraWalker?.());
    // Aim uses the actual (possibly raised) camera ray. Nearby NPCs keep their
    // priority; a broad table blocker must not hide a pot that its ray hits.
    const socialHit = deps.focusCandidates(socialCandidates, 40) || null; // NPC priority remains unless the physical wardrobe is visibly nearer to the camera.
    const furnitureHit = deps.focusCandidates(focusCandidates, 40) || null; // Same actual camera-ray intersections as every other world object.
    if (furnitureHit?.candidate?.kind === 'wardrobe' && (!socialHit || furnitureHit.distanceWorld < socialHit.distanceWorld)) {
      focused = furnitureHit.candidate; return focused; // Standing in front of a wardrobe cannot be overridden by an NPC farther behind it.
    }
    const socialFocus = socialHit?.candidate || null;
    if (socialFocus) { focused = socialFocus; return focused; }
    const furnitureFocus = furnitureHit?.candidate || null; // Still respects unrelated furniture blockers.
    if (furnitureFocus?.kind === 'blocker' && furnitureFocus.entry.record.serviceId) {
      unobstructedCandidates.length = 0;
      for (const candidate of focusCandidates) {
        // Only the hit table's own broad-phase blocker is ignored. An unrelated
        // obstruction inside that box still wins before any serving object behind it.
        if (candidate !== furnitureFocus) unobstructedCandidates.push(candidate);
      }
      const visible = deps.focusCandidates(unobstructedCandidates, 40)?.candidate;
      focused = visible?.kind === 'service' && visible.entry === furnitureFocus.entry
        ? visible : furnitureFocus;
    } else focused = furnitureFocus;
    return focused;
  }

  const SURFACE_PROBE_REFRESH_MS = 100; // Moving/async furniture is rechecked at most ten times per second while the player stays in one tile.
  const surfaceProbe = { valid:false, area:null, col:null, row:null, expiresAt:0, scans:0, cacheHits:0, candidates:0 }; // One reusable camera query cache and mobile performance counters.
  let surfacePoint = null, surfaceNormal = null; // Reused world-space probe vectors; furniture transforms remain live without scene traversal.
  const surfaceView = { active:false, furnitureId:null, surfaceId:null, height:null }; // Latest copyable camera probe, also returned without frame allocations.
  function nearbySurface(area, x, z) {
    if (!window.THREE?.Vector3 || !Number.isFinite(x) || !Number.isFinite(z)) {
      surfaceProbe.valid=false; surfaceView.active=false; surfaceView.furnitureId=null; surfaceView.surfaceId=null; surfaceView.height=null;
      return surfaceView;
    }
    const col=Math.floor(x), row=Math.floor(z), key=areaId(area); // Tile-only proximity makes sub-tile movement and camera rotation free cache hits.
    const now=typeof performance!=='undefined' ? performance.now() : Date.now(); // Monotonic browser clock bounds stale moved-furniture results.
    if (surfaceProbe.valid && surfaceProbe.area===key && surfaceProbe.col===col && surfaceProbe.row===row && now<surfaceProbe.expiresAt) {
      surfaceProbe.cacheHits++; return surfaceView;
    }
    surfaceProbe.valid=true; surfaceProbe.area=key; surfaceProbe.col=col; surfaceProbe.row=row; surfaceProbe.expiresAt=now+SURFACE_PROBE_REFRESH_MS; surfaceProbe.scans++;
    surfaceView.active=false; surfaceView.furnitureId=null; surfaceView.surfaceId=null; surfaceView.height=null;
    surfacePoint ||= new window.THREE.Vector3(); surfaceNormal ||= new window.THREE.Vector3();
    for (const entry of entries(area).values()) {
      if (!entry.root?.parent || entry.root.visible===false) continue;
      surfaceProbe.candidates++; // Counts furniture tested only on cache misses, never on normal camera-frame hits.
      const f=placementFrame(entry); // Broad phase uses the existing placed furniture footprint and world transform.
      const dxTile=f.x-(col+.5), dzTile=f.z-(row+.5); // The character tile and its eight neighbors form a world-aligned three-by-three square.
      const axes=Math.abs(f.cos)+Math.abs(f.sin); // Projection of that square onto either rotated furniture axis.
      const extentX=Math.abs(f.cos)*f.w+Math.abs(f.sin)*f.d, extentZ=Math.abs(f.sin)*f.w+Math.abs(f.cos)*f.d; // Live rotated footprint bounds include every occupied tile of a long table.
      if (Math.abs(dxTile)>=1.5+extentX || Math.abs(dzTile)>=1.5+extentZ
        || Math.abs(dxTile*f.cos-dzTile*f.sin)>=f.w+1.5*axes
        || Math.abs(dxTile*f.sin+dzTile*f.cos)>=f.d+1.5*axes) continue; // Separating-axis test rejects footprints outside the same/neighboring tiles, including corner gaps.
      const data=window.AuthoredFurniture?.peek?.(entry.record.key); // Cached authored data; camera probes never start loads.
      for (const surface of data?.recognizedSurfaces || []) {
        if (surface.role==='wallAttachment' || !surface.localCentroid || !surface.localNormal) continue;
        const mesh=entry.root.userData?.meshById?.get(surface.partId); // Same part-space authority used by surface item placement.
        if (!mesh || mesh.visible===false) continue;
        mesh.updateWorldMatrix?.(true,false);
        surfaceNormal.fromArray(surface.localNormal).transformDirection(mesh.matrixWorld);
        if (surfaceNormal.y<.7) continue;
        surfacePoint.fromArray(surface.localCentroid).applyMatrix4(mesh.matrixWorld);
        surfaceView.active=true; surfaceView.furnitureId=entry.id; surfaceView.surfaceId=surface.id; surfaceView.height=surfacePoint.y;
        return surfaceView;
      }
    }
    return surfaceView;
  }

  function invalidateFocus() { focusStamp = null; } // Public invalidation for async wardrobe registry loads and changed house assignments.

  function snapshot(area = deps?.getArea?.()) {
    return { latestChange: 'Camera lift depends only on an authored upward surface occupying the player tile or any of eight neighboring tiles; looking direction and camera pitch do not affect it.',
      surfaceCamera:{...surfaceView,probe:{...surfaceProbe,refreshMs:SURFACE_PROBE_REFRESH_MS}}, collision:{...collisionStats},
      socialReach:deps?.npcReach?.()||6, socialIgnoresColliders:true, area: areaId(area), focused:focused?.kind || null, focusedNpc:focused?.walker?.rec?.id || null, seatReservations:seatClaims.size, placements: [...entries(area).values()].map(entry => ({ id: entry.id, tableId: entry.record.tableId || null, serviceId: entry.record.serviceId || null, wardrobeFor: window.NpcFurnitureWardrobes?.ownerForPlacement?.(area, entry.record)?.npcId || null })) };
  }
  window.FurnitureTableSystem = { nearbySurface, init, clearArea, registerPlacement, unregisterPlacement, assignTable, tableForSeat, members, findSeat, seatTransform, lieTransform, registerService, aimedService, objectAt, refreshServices, invalidateFocus, snapshot, seatKey, isSeatTaken, setSeatTarget, blocksBox, grassFootprintKeys, focusedTarget, companionSeat };
})();
