// Wilderness ruin sites: the ways into generated ruins.
//
//   Cliff entrances  locale_ruin_entrance copies (js/ruin-site-locales.js),
//                    placed against plateau cliffs every Tothal Shift. A
//                    tunnel runs from the courtyard's cliff edge back into the
//                    rock to a sealed stone door; striking every glyph on the
//                    courtyard's target pillars opens it. Once someone climbs
//                    out of that ruin's exit ladder the door collapses into
//                    rubble until the next Shift.
//   Burrow holes     a rare buried treasure turns out to be a shaft into a
//                    ruin. The hole stays open, and marked on the map, until
//                    that ruin is cleared or the next Shift, then fills in.
//
// Every visible piece is authored furniture (docs/config/furniture-authored/
// ruinEntranceTunnel, ruinEntranceDoor, ruinEntranceDoorRubble,
// ruinTargetPillar, ruinPillarBroken, ruinPillarStump, ruinRubblePile,
// ruinBurrowHole), editable in the Furniture Author. This module places them,
// gives them collision, projectile hits and prompts, and keeps each site's
// state for the current Tothal cycle.
//
// Entering a site generates the ruin with js/dev-random-ruin-interior-map.js
// (window.DevRandomRuin), seeded from the site so the same door always leads
// to the same layout this cycle.
(() => {
  'use strict';

  const RL = window.RuinSiteLocales;
  const A = window.AuthoredFurniture;
  if (!window.THREE || !RL || !A?.load) return;

  const PIECES = ['ruinEntranceTunnel', 'ruinEntranceDoor', 'ruinEntranceDoorRubble', 'ruinTargetPillar', 'ruinPillarBroken', 'ruinPillarStump', 'ruinRubblePile', 'ruinBurrowHole'];
  const STORE_KEY = 'hobunjiRuinSites.v1';
  const DEFAULT_HOLE_CHANCE = .06;
  const FACING_VECTORS = { north:{ x:0, z:-1 }, east:{ x:1, z:0 }, south:{ x:0, z:1 }, west:{ x:-1, z:0 } }; // Outward (approach) direction per authored facing.
  const DOOR_INSET = .3; // Leaf sits this far inside the cliff line so the tunnel's front lip frames it.
  const PILLAR_HALF = .43;
  const TUNNEL_HEIGHT = 3.57; // ruinEntranceTunnel roof top in its authored units.

  let deps = null;
  let piecesReady = null;
  const sitesByZone = new Map(); // zoneId -> [site]
  const rendered = new Map(); // zoneId -> { group, sites:[runtime] }
  let activeVisit = null; // { kind:'entrance'|'hole', id, zoneId }
  let rangedHookInstalled = false;
  const debug = { registered:0, rendered:0, lastEnter:null, lastExit:null, lastHit:null, holeRolls:0 };

  // ── Persistent per-world, per-cycle state ─────────────────────────────────
  function worldId() { return deps?.tothalWorldId?.() || 'default'; }
  function cycle() { return Number(deps?.currentTothalYear?.()) || 1; }
  function loadStore() {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (_) { all = {}; }
    const key = worldId();
    let entry = all[key];
    if (!entry || entry.cycle !== cycle()) entry = { cycle:cycle(), entrances:{}, holes:{} }; // A Tothal Shift wipes every site: new ruins, holes filled.
    return { all, key, entry };
  }
  function state() { return loadStore().entry; }
  function saveState(entry) {
    const store = loadStore();
    store.all[store.key] = entry;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store.all)); } catch (_) {}
  }
  function entranceState(id) { return state().entrances[id] || { struck:[], open:false, spent:false }; }
  function updateEntrance(id, patch) {
    const entry = state();
    entry.entrances[id] = { ...(entry.entrances[id] || { struck:[], open:false, spent:false }), ...patch };
    saveState(entry);
    return entry.entrances[id];
  }

  function seedFor(id) { return RL.hashString(`${worldId()}|${cycle()}|${id}`) >>> 0; }
  function rngFor(id) {
    let s = seedFor(id) || 1;
    return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return (s >>> 8) / 16777216; };
  }
  function config(path, fallback) { return window.DevRandomRuinConfig?.get?.(path, fallback) ?? fallback; }

  function ensurePieces() {
    if (!piecesReady) piecesReady = Promise.all(PIECES.map(key => A.load(key)));
    return piecesReady;
  }
  function build(key) {
    const data = A.peek(key);
    if (!data) return null;
    const group = A.buildGroup(data);
    group.userData.ruinSiteKey = key;
    return group;
  }

  // ── Locale registration (called from performTothalShift per zone) ────────
  function registerWorkspace(zoneId, workspace) {
    const sites = [];
    for (const instance of workspace?.localeInstances || []) {
      if (instance?.category !== RL.CATEGORY) continue;
      const door = (instance.objects || []).find(object => object.kind === 'ruinDoor');
      if (!door) continue;
      const facing = door.visual?.facing || 'north';
      sites.push({
        id:instance.localeId, zoneId, name:instance.name || 'Sealed Ruin', facing,
        floorTier:Number.isFinite(Number(instance.floorTier)) ? Number(instance.floorTier) : null,
        door:{ x:Number(door.x) + Number(door.w || 1) / 2, z:Number(door.y) + Number(door.h || 1) / 2, w:Number(door.w || 1), h:Number(door.h || 1), rubbleKey:door.visual?.rubbleKey || 'ruinEntranceDoorRubble' },
        slots:(instance.objects || []).filter(object => object.kind === 'ruinSlot').map(object => ({ id:object.id, x:Number(object.x) + Number(object.w || 1) / 2, z:Number(object.y) + Number(object.h || 1) / 2 })),
      });
    }
    sitesByZone.set(String(zoneId), sites);
    debug.registered = [...sitesByZone.values()].reduce((sum, list) => sum + list.length, 0);
    return sites;
  }

  function expandLocaleDefs(defs, tothalCycle, zoneIds) {
    return RL.expandLocaleDefs(defs, tothalCycle, zoneIds, worldId());
  }

  // Site layout: door line, pillar roles. Deterministic per site id + cycle.
  function layoutFor(site) {
    const out = FACING_VECTORS[site.facing] || FACING_VECTORS.north;
    const depth = site.facing === 'north' || site.facing === 'south' ? site.door.h : site.door.w;
    const doorPoint = { x:site.door.x - out.x * (depth / 2 + DOOR_INSET), z:site.door.z - out.z * (depth / 2 + DOOR_INSET) };
    const approach = { x:doorPoint.x + out.x * 3.2, z:doorPoint.z + out.z * 3.2 };
    const rng = rngFor(site.id);
    const slots = site.slots.slice();
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    const targetCount = Math.max(1, Math.round(config('sites.targetPillars', 3)));
    const debrisKeys = ['ruinPillarBroken', 'ruinPillarStump', 'ruinRubblePile'];
    const debrisChance = config('sites.debrisChance', .75);
    const roles = slots.map((slot, index) => {
      if (index < targetCount) return { ...slot, role:'target', key:'ruinTargetPillar', id:`target_${slot.id}` };
      if (rng() < debrisChance) return { ...slot, role:'debris', key:debrisKeys[Math.floor(rng() * debrisKeys.length)], rotation:rng() * Math.PI * 2 };
      return { ...slot, role:'empty' };
    });
    return { out, doorPoint, approach, roles, rotation:Math.atan2(out.x, out.z) };
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function groundY(zGrid, x, z, tier) {
    const sampled = Number(zGrid?.[Math.floor(z)]?.[Math.floor(x)]?.elevTier) || 0;
    return deps.NORMAL_TOP + (Number.isFinite(tier) ? tier : sampled) * deps.PLATEAU_UNIT;
  }

  function worldBox(object) {
    object.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(object);
  }

  function blockerFromBox(box, shrink = 0) {
    return { minX:box.min.x + shrink, maxX:box.max.x - shrink, minZ:box.min.z + shrink, maxZ:box.max.z - shrink, minY:box.min.y, maxY:box.max.y };
  }

  function buildZoneMeshes(zScene, zGrid, mapId) {
    const zoneId = String(mapId || '');
    const previous = rendered.get(zoneId);
    if (previous?.group?.parent) previous.group.parent.remove(previous.group);
    rendered.delete(zoneId);
    const sites = sitesByZone.get(zoneId) || [];
    const holes = Object.entries(state().holes || {}).filter(([, hole]) => hole.zoneId === zoneId);
    if (!zScene || (!sites.length && !holes.length)) return;
    ensurePieces().then(() => {
      if (!zScene.parent && zScene.type !== 'Scene') return;
      const group = new THREE.Group();
      group.name = 'ruinSites';
      const runtime = { group, zoneId, sites:[], holes:[], blockers:[], cells:new Map() };
      for (const site of sites) runtime.sites.push(buildEntrance(site, group, zGrid, runtime));
      for (const [id, hole] of holes) {
        const built = buildHole(id, hole, group, zGrid, runtime);
        if (built) runtime.holes.push(built);
      }
      zScene.add(group);
      rendered.set(zoneId, runtime);
      debug.rendered = runtime.sites.length;
      window.FurniturePuzzleRuntime && runtime.sites.forEach(registerPuzzle);
      deps?.refreshActionBar?.();
    });
  }

  function place(group, parent, x, y, z, rotation) {
    group.position.set(x, y, z);
    group.rotation.y = rotation;
    parent.add(group);
    return group;
  }

  function buildEntrance(site, parent, zGrid, runtime) {
    const saved = entranceState(site.id);
    const layout = layoutFor(site);
    const y = groundY(zGrid, layout.approach.x, layout.approach.z, site.floorTier);
    const record = { site, layout, y, pillars:[], door:null, tunnel:null, rubble:null };
    // Fit the tunnel's height to the host cliff so its roof meets the cliff
    // lip instead of standing proud of a one-tier (2.5 unit) step.
    let cliffTop = y;
    for (const inward of [1.2, 2, 2.8]) {
      const px = layout.doorPoint.x - layout.out.x * inward, pz = layout.doorPoint.z - layout.out.z * inward;
      cliffTop = Math.max(cliffTop, groundY(zGrid, px, pz, null));
    }
    const heightScale = Math.max(.78, Math.min(1.45, (cliffTop - y + .15) / TUNNEL_HEIGHT));
    record.heightScale = heightScale;
    record.tunnel = build('ruinEntranceTunnel');
    if (record.tunnel) {
      place(record.tunnel, parent, layout.doorPoint.x, y, layout.doorPoint.z, layout.rotation);
      record.tunnel.scale.y = heightScale;
      record.tunnel.traverse(node => { if (node.isMesh) node.userData.cameraObstacle = true; });
      for (const id of ['wall_left', 'wall_right']) {
        const mesh = record.tunnel.userData.meshById?.get?.(id);
        if (mesh) runtime.blockers.push(blockerFromBox(worldBox(mesh)));
      }
    }
    if (saved.spent) {
      record.rubble = build(site.door.rubbleKey);
      if (record.rubble) {
        place(record.rubble, parent, layout.doorPoint.x, y, layout.doorPoint.z, layout.rotation);
        record.rubble.scale.y = Math.min(1.2, heightScale / .92);
        runtime.blockers.push(blockerFromBox(worldBox(record.rubble), .05));
      }
    } else {
      record.door = build('ruinEntranceDoor');
      if (record.door) {
        place(record.door, parent, layout.doorPoint.x, y, layout.doorPoint.z, layout.rotation);
        record.door.scale.y = Math.min(1.2, heightScale / .92); // Door keeps its proportions inside a squatter or taller tunnel.
        runtime.blockers.push(blockerFromBox(worldBox(record.door)));
      }
    }
    for (const slot of layout.roles) {
      if (slot.role === 'empty') continue;
      const piece = build(slot.key);
      if (!piece) continue;
      const py = groundY(zGrid, slot.x, slot.z, site.floorTier);
      const facingApproach = Math.atan2(layout.approach.x - slot.x, layout.approach.z - slot.z); // Glyph faces the courtyard's approach point.
      place(piece, parent, slot.x, py, slot.z, slot.role === 'target' ? facingApproach : slot.rotation);
      piece.traverse(node => { if (node.isMesh) node.userData.cameraObstacle = true; });
      if (slot.role === 'target') {
        const struck = saved.struck.includes(slot.id) || saved.open || saved.spent;
        const entry = { slot, object:piece, struck, box:worldBox(piece).expandByScalar(.06) };
        piece.userData.ruinSiteTargetId = slot.id;
        window.FurnitureDecalRuntime?.setGlowState?.(piece, struck ? 1 : 0);
        record.pillars.push(entry);
        runtime.blockers.push({ minX:slot.x - PILLAR_HALF, maxX:slot.x + PILLAR_HALF, minZ:slot.z - PILLAR_HALF, maxZ:slot.z + PILLAR_HALF, minY:py, maxY:py + 2.6 });
      } else {
        runtime.blockers.push(blockerFromBox(worldBox(piece), .12));
      }
    }
    const doorObject = makeDoorObject(record);
    const span = 1.6;
    for (let dz = -2.5; dz <= 1.5; dz += .5) {
      for (let dx = -span; dx <= span; dx += .5) {
        const along = { x:layout.out.x * dz, z:layout.out.z * dz }; // dz > 0 is out toward the approach.
        const across = { x:layout.out.z * dx, z:-layout.out.x * dx };
        const cx = Math.floor(layout.doorPoint.x + along.x + across.x), cz = Math.floor(layout.doorPoint.z + along.z + across.z);
        runtime.cells.set(`${cx},${cz}`, doorObject);
      }
    }
    return record;
  }

  function registerPuzzle(record) {
    const mapId = `ruinSite:${record.site.id}`;
    const objectById = new Map();
    const records = [];
    if (record.door) { objectById.set('door', record.door); records.push({ id:'door', key:'ruinEntranceDoor' }); }
    for (const pillar of record.pillars) { objectById.set(pillar.slot.id, pillar.object); records.push({ id:pillar.slot.id, key:'ruinTargetPillar' }); }
    window.FurniturePuzzleRuntime.registerMap(mapId, records, objectById, []);
    for (const pillar of record.pillars) window.FurnitureDecalRuntime?.setGlowState?.(pillar.object, pillar.struck ? 1 : 0);
    if (record.door && entranceState(record.site.id).open) window.FurniturePuzzleRuntime.applyMechanism(record.door, 1);
  }

  function makeDoorObject(record) {
    const site = record.site;
    const approach = record.layout.approach;
    return {
      id:`ruinsite_${site.id}`, type:'ruin_door', col:Math.floor(approach.x), row:Math.floor(approach.z), mesh:record.door || record.rubble,
      label:'🏛️ Sealed Ruin',
      getButtons() {
        const saved = entranceState(site.id);
        if (saved.spent) return [{ icon:'🪨', label:'Collapsed — the passage is choked with rubble', action:'obj_ruin_site_door', style:'secondary', allowed:false }];
        if (!saved.open) {
          const total = record.pillars.length;
          const struck = record.pillars.filter(pillar => pillar.struck).length;
          return [{ icon:'🔴', label:`Sealed — strike every glyph pillar (${struck}/${total})`, action:'obj_ruin_site_door', style:'secondary', allowed:false }];
        }
        return [{ icon:'🚪', label:'Enter the ruin', action:'obj_ruin_site_door', style:'primary', allowed:true }];
      },
      onAction(action) {
        if (action !== 'obj_ruin_site_door') return { ok:false, message:'Unknown action.' };
        const saved = entranceState(site.id);
        if (saved.spent) return { ok:false, message:'The way in has collapsed.' };
        if (!saved.open) return { ok:false, message:'The door is sealed. Strike every glyph pillar in the courtyard.' };
        enterSite({ kind:'entrance', id:site.id, zoneId:site.zoneId, name:site.name, returnAt:approach });
        return { ok:true, message:'You step through into the dark.' };
      },
    };
  }

  function openDoor(record) {
    updateEntrance(record.site.id, { open:true, struck:record.pillars.map(pillar => pillar.slot.id) });
    if (record.door) {
      if (!window.FurniturePuzzleRuntime?.setMechanism?.(`ruinSite:${record.site.id}`, 'door', true)) window.FurniturePuzzleRuntime?.applyMechanism?.(record.door, 1);
    }
    deps?.showToast?.('The ruin door grinds open.', true);
    window.AudioSystem?.playSfx?.('stone_door');
  }

  function strike(record, pillar) {
    if (pillar.struck) return false;
    pillar.struck = true;
    window.FurnitureDecalRuntime?.setGlowState?.(pillar.object, 1);
    const saved = entranceState(record.site.id);
    const struck = [...new Set([...(saved.struck || []), pillar.slot.id])];
    updateEntrance(record.site.id, { struck });
    const done = record.pillars.filter(entry => entry.struck).length;
    debug.lastHit = { site:record.site.id, target:pillar.slot.id, done, total:record.pillars.length };
    if (done >= record.pillars.length && !saved.open) openDoor(record);
    else deps?.showToast?.(`Glyph struck (${done}/${record.pillars.length}).`, true);
    return true;
  }

  // ── Burrow holes ──────────────────────────────────────────────────────────
  function holeId(zoneId, col, row) { return `hole:${zoneId}:${col},${row}`; }

  function buildHole(id, hole, parent, zGrid, runtime) {
    if (hole.state === 'cleared') { fillHole(id, hole); return null; }
    const piece = build('ruinBurrowHole');
    if (!piece) return null;
    const tile = zGrid?.[hole.row]?.[hole.col];
    const y = groundY(zGrid, hole.col + .5, hole.row + .5, null) + (tile?.type === deps.TileType?.TRENCH ? deps.TRENCH_TOP : 0);
    place(piece, parent, hole.col + .5, y, hole.row + .5, 0);
    const object = {
      id:`ruinhole_${hole.zoneId}_${hole.col}_${hole.row}`, type:'ruin_hole', col:hole.col, row:hole.row, mesh:piece,
      label:'🕳️ Ruin Burrow',
      getButtons() { return [{ icon:'🪜', label:'Climb down into the ruin', action:'obj_ruin_hole', style:'primary', allowed:true }]; },
      onAction(action) {
        if (action !== 'obj_ruin_hole') return { ok:false, message:'Unknown action.' };
        enterSite({ kind:'hole', id, zoneId:hole.zoneId, name:'Ruin Burrow', returnAt:{ x:hole.col + .5, z:hole.row + 1.5 } });
        return { ok:true, message:'You climb down the shaft.' };
      },
    };
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (!dx || !dz) runtime.cells.set(`${hole.col + dx},${hole.row + dz}`, object);
    return { id, piece, object };
  }

  // Called by js/wild-treasure.js when a flagged placement's trench is dug.
  function openHole(mapId, col, row) {
    const entry = state();
    const id = holeId(mapId, col, row);
    if (entry.holes[id]) return false;
    entry.holes[id] = { zoneId:String(mapId), col, row, state:'open', openedDay:deps?.calendar?.day ?? null };
    saveState(entry);
    deps?.showToast?.('The treasure gives way — it was the roof of a buried ruin!', true);
    const zi = deps?._zoneScenes?.get?.(mapId);
    if (zi) buildZoneMeshes(zi.scene, zi.grid, mapId);
    syncMapMarkers();
    return true;
  }

  function fillHole(id, hole) {
    if (hole.filled) return;
    const zi = deps?._zoneScenes?.get?.(hole.zoneId);
    const tile = zi?.grid?.[hole.row]?.[hole.col];
    if (!tile) return;
    if (tile.type === deps.TileType?.TRENCH) {
      tile.type = deps.TileType.GRASS;
      tile.depth = 0;
      deps.recordWildernessChunkTileDelta?.(hole.zoneId, hole.col, hole.row);
      setTimeout(() => window.ZoneRegrowth?.refreshZoneGroundVisuals?.(hole.zoneId, hole.col, hole.row), 0);
    }
    const entry = state();
    if (entry.holes[id]) { entry.holes[id].filled = true; saveState(entry); }
  }

  // ── Map markers (same localeInstances proxy approach as porakaneki camps) ─
  const MARKER_FLAG = '__ruinSiteMarker';
  function trackNearby(actor, master, dt) {
    if (actor.stableRole !== 'companion') return;
    const progression = window.StableAnimalProgression; // Uses the existing active companion training authority.
    if (!progression?.perkRank(progression.activeEntryForRole('companion'), 'ruinTracking')) return;
    actor._ruinTrackTimer = Math.max(0, (actor._ruinTrackTimer || 0) - dt);
    if (actor._ruinTrackTimer > 0) return;
    actor._ruinTrackTimer = 1;
    const zoneId = String(deps?.getCurrentArea?.()); // Site coordinates are in tiles; the companion master uses pixels.
    const tile = Number(deps?.TILE) || 32; // Shared game tile size supplied by RuinSites.init.
    const entry = state(); // Discovery persists for this world's current Tothal cycle.
    for (const site of sitesByZone.get(zoneId) || []) {
      if (entry.entrances[site.id]?.spent || entry.entrances[site.id]?.tracked) continue;
      if (Math.hypot(site.door.x - master.x / tile, site.door.z - master.y / tile) > 18) continue;
      entry.entrances[site.id] = { ...(entry.entrances[site.id] || {}), tracked:true };
      saveState(entry);
      syncMapMarkers();
      deps?.showToast?.(`${actor.def?.label || 'Your companion'} found a ruin!`, true, true);
    }
  }

  function syncMapMarkers() {
    const layouts = deps?._zoneLayouts;
    if (!layouts) return;
    const byZone = new Map();
    const entrances = state().entrances; // Saved tracking discoveries become ordinary visible locale markers.
    for (const [zoneId, sites] of sitesByZone) {
      const layout = layouts.get(zoneId); // Existing locale instances own map positioning and discovery presentation.
      for (const instance of layout?.localeInstances || []) {
        if (sites.some(site => site.id === instance.localeId && entrances[site.id]?.tracked)) instance.alwaysVisible = true;
      }
    }
    for (const [id, hole] of Object.entries(state().holes || {})) {
      if (hole.state !== 'open') continue;
      if (!byZone.has(hole.zoneId)) byZone.set(hole.zoneId, []);
      byZone.get(hole.zoneId).push({ localeId:`ruin_hole_${hole.zoneId}_${hole.col}_${hole.row}`, name:'Ruin Burrow', category:'ruin_hole', x:hole.col - .5, y:hole.row - .5, alwaysVisible:true, objects:[], connectors:[], [MARKER_FLAG]:true, ruinHoleId:id });
    }
    for (const [zoneId, layout] of layouts) {
      if (!layout || !Array.isArray(layout.localeInstances)) continue;
      const kept = layout.localeInstances.filter(instance => !instance?.[MARKER_FLAG]);
      const added = byZone.get(zoneId) || [];
      if (kept.length === layout.localeInstances.length && !added.length) continue;
      layout.localeInstances = [...kept, ...added];
    }
  }

  // ── Entering / leaving ────────────────────────────────────────────────────
  function enterSite(visit) {
    const R = window.DevRandomRuin;
    if (!R?.generate) { deps?.showToast?.('The ruin is not ready yet — try again in a moment.', false); return false; }
    activeVisit = { ...visit };
    debug.lastEnter = { ...visit, at:Date.now() };
    const returnAnchor = { area:visit.zoneId, x:visit.returnAt.x * deps.TILE, y:visit.returnAt.z * deps.TILE };
    Promise.resolve(R.generate(seedFor(visit.id), { site:true, label:visit.kind === 'hole' ? 'Buried Ruin' : 'Ancient Ruin', returnAnchor }))
      .then(ok => { if (!ok) activeVisit = null; })
      .catch(() => { activeVisit = null; });
    return true;
  }

  function randomExit(excludeZone) {
    const zones = (window.WildernessMapGenerator?.zoneMapIds?.() || []).filter(zoneId => deps?._zoneLayouts?.has?.(zoneId));
    const rng = rngFor(`exit|${Date.now()}`);
    const ordered = zones.slice().sort(() => rng() - .5);
    for (const zoneId of ordered) {
      const zi = deps.buildZoneScene?.(zoneId);
      if (!zi?.grid) continue;
      const tiles = deps.findZoneFlatEmptyTiles?.(zoneId, 24, rng, []) || [];
      const pick = tiles[Math.floor(rng() * tiles.length)];
      if (pick) return { zoneId, col:pick.col, row:pick.row };
    }
    return excludeZone ? { zoneId:excludeZone, col:null, row:null } : null;
  }

  // Sanctum exit ladder. Returns true when this module handled the exit.
  function completeActiveRuin() {
    const visit = activeVisit;
    const R = window.DevRandomRuin;
    if (!visit || !R?.exitTo) return false;
    if (visit.kind === 'entrance') updateEntrance(visit.id, { spent:true, open:true });
    else {
      const entry = state();
      if (entry.holes[visit.id]) { entry.holes[visit.id].state = 'cleared'; saveState(entry); }
      syncMapMarkers();
    }
    const exit = randomExit(visit.zoneId);
    debug.lastExit = { visit, exit, at:Date.now() };
    activeVisit = null;
    if (!exit) return false;
    R.exitTo(() => Promise.resolve(deps.enterZone(exit.zoneId, exit.col ?? undefined, exit.row ?? undefined)).then(() => {
      const zi = deps._zoneScenes?.get?.(visit.zoneId);
      if (zi) buildZoneMeshes(zi.scene, zi.grid, visit.zoneId); // Spent door becomes rubble / hole fills in right away.
    }));
    deps?.showToast?.('You climb out into daylight somewhere unfamiliar.', true);
    return true;
  }

  // The ruin's ordinary entrance exit just steps back outside.
  function onRuinLeft() { activeVisit = null; }

  // ── Game integration ──────────────────────────────────────────────────────
  function objectAt(area, col, row) {
    return rendered.get(String(area))?.cells.get(`${col},${row}`) || null;
  }

  function blocksBox(area, x, z, half, worldY) {
    const runtime = rendered.get(String(area));
    if (!runtime) return false;
    for (const box of runtime.blockers) {
      if (x + half <= box.minX || x - half >= box.maxX || z + half <= box.minZ || z - half >= box.maxZ) continue;
      if (worldY != null && (worldY < box.minY - .05 || worldY > box.maxY + .05)) continue;
      return true;
    }
    return false;
  }

  function segmentBoxEnter(start, end, box) {
    let enter = 0, exit = 1;
    for (const axis of ['x', 'y', 'z']) {
      const d = end[axis] - start[axis];
      if (Math.abs(d) < 1e-9) { if (start[axis] < box.min[axis] || start[axis] > box.max[axis]) return null; continue; }
      let t0 = (box.min[axis] - start[axis]) / d, t1 = (box.max[axis] - start[axis]) / d;
      if (t0 > t1) [t0, t1] = [t1, t0];
      enter = Math.max(enter, t0); exit = Math.min(exit, t1);
      if (enter > exit) return null;
    }
    return enter;
  }

  function projectileHit(start, end) {
    const runtime = rendered.get(String(deps?.getCurrentArea?.()));
    if (!runtime) return null;
    let best = null;
    for (const record of runtime.sites) {
      for (const pillar of record.pillars) {
        const t = segmentBoxEnter(start, end, pillar.box);
        if (t == null || (best && t >= best.t)) continue;
        best = { t, record, pillar };
      }
    }
    return best;
  }

  function installRangedHook() {
    if (rangedHookInstalled || !window.RangedWeapons?.update || !window.NearbyVolumeCollision?.segmentHit) return false;
    const ranged = window.RangedWeapons, cover = window.NearbyVolumeCollision;
    const nativeUpdate = ranged.update, nativeSegmentHit = cover.segmentHit;
    let depth = 0;
    ranged.update = function (...args) { depth++; try { return nativeUpdate.apply(this, args); } finally { depth--; } };
    cover.segmentHit = function (start, end, radiusWorld = 0) {
      const ordinary = nativeSegmentHit.call(this, start, end, radiusWorld);
      if (depth <= 0 || !rendered.size) return ordinary;
      const hit = projectileHit(start, end);
      if (!hit || (ordinary && Number(ordinary.t) <= hit.t)) return ordinary;
      strike(hit.record, hit.pillar);
      return { t:hit.t, distanceWorld:(start.distanceTo?.(end) || 0) * hit.t, object:hit.pillar.object, kind:'ruinSiteTarget', key:hit.pillar.slot.id, point:start.clone?.().lerp ? start.clone().lerp(end, hit.t) : null };
    };
    rangedHookInstalled = true;
    return true;
  }

  // Rare-hole roll used by js/wild-treasure.js when it scatters a zone's chests.
  function treasureHoleChance() { return Math.max(0, Math.min(1, Number(config('sites.treasureHoleChance', DEFAULT_HOLE_CHANCE)) || 0)); }
  function holeAt(mapId, col, row) { return state().holes[holeId(mapId, col, row)] || null; }

  function init(injected) {
    deps = injected;
    window.AreaFootprintBlockers?.register?.('ruin-sites', { area:null, blocksBox:(x, z, half, worldY) => blocksBox(deps?.getCurrentArea?.(), x, z, half, worldY) });
    installRangedHook();
    ensurePieces();
    syncMapMarkers();
    const map = window.WildernessMap;
    if (map?.renderMapPanel && !map.renderMapPanel.__ruinSitesWrapped) {
      const original = map.renderMapPanel.bind(map);
      const wrapped = function ruinSitesMapRender(...args) { syncMapMarkers(); return original(...args); }; // A Tothal Shift replaces every layout, so re-add hole markers before each draw.
      wrapped.__ruinSitesWrapped = true;
      try { map.renderMapPanel = wrapped; } catch (_) {}
    }
  }

  window.RuinSites = Object.freeze({
    init, registerWorkspace, expandLocaleDefs, buildZoneMeshes, objectAt, completeActiveRuin, onRuinLeft,
    openHole, holeAt, treasureHoleChance, syncMapMarkers, installRangedHook, trackNearby,
    isInSite:() => !!activeVisit,
    debugSnapshot:() => ({
      ...debug, cycle:cycle(), active:activeVisit, rangedHookInstalled,
      zones:Object.fromEntries([...sitesByZone].map(([zoneId, sites]) => [zoneId, sites.map(site => ({ id:site.id, facing:site.facing, door:site.door, state:entranceState(site.id) }))])),
      rendered:Object.fromEntries([...rendered].map(([zoneId, runtime]) => [zoneId, { sites:runtime.sites.map(record => ({ id:record.site.id, doorPoint:record.layout.doorPoint, approach:record.layout.approach, y:record.y, pillars:record.pillars.map(p => ({ id:p.slot.id, x:p.slot.x, z:p.slot.z, struck:p.struck })), spent:!!record.rubble })), holes:runtime.holes.map(h => h.id), blockers:runtime.blockers.length, cells:runtime.cells.size }])),
      holes:state().holes,
      mapMarkers:[...(deps?._zoneLayouts?.values?.() || [])].reduce((sum, layout) => sum + (layout?.localeInstances || []).filter(instance => instance?.[MARKER_FLAG]).length, 0),
    }),
    debugStrikeAll(zoneId) {
      const runtime = rendered.get(String(zoneId || deps?.getCurrentArea?.()));
      for (const record of runtime?.sites || []) for (const pillar of record.pillars) strike(record, pillar);
      return !!runtime;
    },
    debugEnter(siteId) {
      for (const runtime of rendered.values()) {
        const record = runtime.sites.find(entry => !siteId || entry.site.id === siteId);
        if (record) return makeDoorObject(record).onAction('obj_ruin_site_door');
      }
      return null;
    },
  });
})();
