// NPC-tended farmland. A Map Editor "farm plot" (Tilled / Trench strokes grouped in the side panel, saved as
// `farmPlots` on an exterior map) with a worker lineup assigned is no longer plain painted terrain: its tiles start
// as grass and the lineup's NPCs keep them up on their own, during the plot's farming hours:
//
//   till plot   tillers keep it tilled (hoe) → seeders sow the plot's crop on tilled soil → harvesters pick ready crops
//   dig plot    diggers keep it dug (the player's dig animation); rain fills the dug tiles and the water stays
//
// Every lineup is ordered: the first NPC who is free does the work, the rest are backups for when that NPC is following
// you, out on a date with you, or married to you. A plot with no worker is left alone and stays ordinary painted tiles.
//
// Only tiles inside a plot are simulated, and they are drawn as small overlay meshes in the area's own scene (a flat
// patch, a pit, a crop) rather than by editing the merged town/zone ground, so a busy field costs a handful of meshes.
// Movement is the ordinary schedule: a NpcScheduling target override hands a lineup NPC the next job as a target at the
// work tile, and the walker plays the player's own hoe / dig animation there (js/tool-activity-stages.js).
(() => {
  'use strict';
  if (window.NpcFarmPlots) return;

  const TICK_MS = 500;
  const JOB_SECONDS = { till: 4, seed: 2.5, harvest: 2.5, dig: 5 };
  const JOB_LABEL = { till: 'tilling the soil', seed: 'sowing seeds', harvest: 'harvesting', dig: 'digging a trench' };
  const IDLE_TILLED_DAYS = 2; // Bare tilled soil gets overgrown if no one sows it.
  const SILT_CHANCE = 0.35; // Chance a rained-on dug tile silts back in (so diggers have upkeep, like the player's trenches).
  const DEFAULT_HOURS = [8, 16];

  let deps = null;
  let timer = 0;
  const plotsById = new Map(); // plot id → normalized plot
  const managedKeys = new Map(); // "mapIdOrArea:c,r" → plot id (only plots with a worker lineup)
  let states = {}; // plot id → { "c,r": { tilled, dug, crop, age, ready, water, idle } }
  const claims = new Map(); // npcId → { plotId, key, job, standC, standR, workedS, ageS, area }
  const claimedKeys = new Set(); // "plotId:c,r"
  const workerIds = new Set(); // Every NPC named in a managed plot's lineups; everyone else skips job lookup entirely.
  const visuals = new Map(); // area → { group, tiles: Map(key → { objects[], sig }) }
  let rainedToday = false;
  let saveTimer = 0;
  const debug = { jobsDone: 0, lastJob: null };

  const num = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const keyOf = (c, r) => `${c},${r}`;
  const area = id => deps?.normalizeNpcArea?.(id) || id;

  // ── Registration ──────────────────────────────────────────────────────
  function init(injected) {
    deps = injected || {};
    for (const plot of plotsById.values()) plot.area = area(plot.mapId); // Maps can register before the area names are known.
    // Town farmwork is a world-level override. Family work must run *inside* RomanceSystem /
    // RomanceFamily's own overrides, otherwise it preempts sleep, town visits and child vat duties.
    window.NpcScheduling?.registerTargetOverride?.('farm-plots', rec => targetFor(rec));
    if (!timer) timer = setInterval(() => { try { tick(); } catch (error) { console.warn('[NpcFarmPlots] tick failed', error); } }, TICK_MS);
    return api;
  }

  function rebuildWorkers() {
    workerIds.clear();
    for (const p of plotsById.values()) if (p.managed) for (const role of ['tillers', 'seeders', 'harvesters', 'diggers']) for (const id of p[role]) workerIds.add(id);
  }
  function lineupOf(plot, role) { return Array.isArray(plot[role]) ? plot[role].filter(Boolean) : []; }

  // Called when an exterior map loads. Replaces that map's plots (a map reload must not duplicate them).
  function registerMap(mapId, rawPlots) {
    // A workspace/map reload must not retain jobs, claims, or overlay meshes from the old map.
    const staleIds = new Set([...plotsById.values()].filter(plot => plot.mapId === mapId).map(plot => plot.id));
    for (const [npcId, claim] of [...claims]) if (staleIds.has(claim.plotId)) releaseClaim(npcId);
    for (const [id, plot] of [...plotsById]) if (plot.mapId === mapId) plotsById.delete(id);
    for (const v of visuals.values()) for (const key of [...v.tiles.keys()]) {
      if (staleIds.has(key.split(':')[0])) disposeTile(v, key);
    }
    syncedVersion = 0;
    for (const key of [...managedKeys.keys()]) if (key.startsWith(`${mapId}:`)) managedKeys.delete(key);
    for (const raw of Array.isArray(rawPlots) ? rawPlots : []) {
      if (!raw?.id || !Array.isArray(raw.tiles) || !raw.tiles.length) continue;
      const kind = raw.kind === 'dig' ? 'dig' : 'till';
      const plot = {
        id: String(raw.id), mapId, area: area(mapId), kind, label: raw.label || raw.id, crop: raw.crop || '',
        tillers: lineupOf(raw, 'tillers'), seeders: lineupOf(raw, 'seeders'), harvesters: lineupOf(raw, 'harvesters'), diggers: lineupOf(raw, 'diggers'),
        startWorked: raw.startWorked !== false, // Show the plot as painted (tilled / dug) until upkeep lapses; false starts it bare.
        hours: Array.isArray(raw.hours) && raw.hours.length === 2 ? [num(raw.hours[0], DEFAULT_HOURS[0]), num(raw.hours[1], DEFAULT_HOURS[1])] : DEFAULT_HOURS.slice(),
        tiles: raw.tiles.map(t => ({ c: Math.floor(num(t[0], 0)), r: Math.floor(num(t[1], 0)) })),
      };
      plot.managed = kind === 'till' ? !!(plot.tillers.length || plot.seeders.length || plot.harvesters.length) : plot.diggers.length > 0;
      plotsById.set(plot.id, plot);
      if (plot.managed) for (const t of plot.tiles) managedKeys.set(`${mapId}:${keyOf(t.c, t.r)}`, plot.id);
    }
    rebuildWorkers();
  }

  // The player's own farm: plots drawn in the farm editor (js/farm-plot-editor.js) and worked by family — the spouse and
  // children. These act on the live farm grid (real tilled soil, trenches and crops, with the real water sim), so nothing
  // is drawn or simulated here; seeds come out of Farm Storage.
  function registerFarmPlots(rawPlots) {
    const staleIds = new Set([...plotsById.values()].filter(plot => plot.grid).map(plot => plot.id));
    for (const [npcId, claim] of [...claims]) if (staleIds.has(claim.plotId)) releaseClaim(npcId);
    for (const [id, plot] of [...plotsById]) if (plot.grid) plotsById.delete(id);
    for (const raw of Array.isArray(rawPlots) ? rawPlots : []) {
      if (!raw?.id || !Array.isArray(raw.tiles) || !raw.tiles.length) continue;
      const kind = raw.kind === 'dig' ? 'dig' : 'till';
      const workers = lineupOf(raw, 'workers');
      const plot = {
        id: String(raw.id), mapId: 'farm', area: 'farm', grid: true, family: true, kind, label: raw.label || raw.id, crop: raw.crop || '',
        tillers: kind === 'till' ? workers : [], seeders: kind === 'till' ? workers : [], harvesters: [], diggers: kind === 'dig' ? workers : [],
        startWorked: false,
        hours: Array.isArray(raw.hours) && raw.hours.length === 2 ? [num(raw.hours[0], DEFAULT_HOURS[0]), num(raw.hours[1], 17)] : [8, 17],
        tiles: raw.tiles.map(t => ({ c: Math.floor(num(t[0], 0)), r: Math.floor(num(t[1], 0)) })),
      };
      plot.managed = workers.length > 0;
      plotsById.set(plot.id, plot);
    }
    rebuildWorkers();
  }

  // The map loaders ask this so a managed plot's tiles start as plain grass instead of tilled / trench.
  function isManagedTile(mapId, c, r) { return managedKeys.has(`${mapId}:${keyOf(c, r)}`); }

  // ── Who is free to work ───────────────────────────────────────────────
  // A lineup NPC is skipped while they are following you (companion), on a date with you, or married to you.
  function unavailable(npcId, plot) {
    if (window.RomanceSystem?.isOnDateWith?.(npcId)) return true;
    if (!plot?.family && window.RomanceSystem?.getSpouse?.()?.npcId === npcId) {
      // Only the spouse's scheduled town visit may operate their previous town field. The
      // farmhouse, bed, pregnancy, and date retain priority at every other time.
      if (!window.RomanceSystem?.spouseTownVisitNow?.(npcId)) return true;
    }
    if (window.NpcFollowing?.isCompanion?.(npcId)) return true;
    return false;
  }
  function activeWorker(plot, role) {
    return lineupOf(plot, role).find(id => !unavailable(id, plot)) || null;
  }
  function inHours(plot) {
    const hour = num(window.CalendarSystem?.getHour?.(), 12);
    const [from, to] = plot.hours;
    return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
  }

  // ── Tile state ────────────────────────────────────────────────────────
  function stateOf(plot, c, r, create = false) {
    let plotState = states[plot.id];
    if (!plotState) {
      if (!create && !plot.startWorked) return null;
      plotState = states[plot.id] = {};
      if (plot.startWorked) for (const t of plot.tiles) plotState[keyOf(t.c, t.r)] = plot.kind === 'dig' ? { dug: true } : { tilled: true }; // As authored in the Map Editor.
    }
    const key = keyOf(c, r);
    if (!plotState[key] && create) plotState[key] = {};
    return plotState[key] || null;
  }
  const tileOf = (plot, c, r) => plot.grid ? (deps?.farmTileInfo?.(c, r) || { blocked: true }) : (stateOf(plot, c, r) || {});

  function cropDef(crop) { return deps?.cropData?.[crop] || null; }

  // ── Job picking ───────────────────────────────────────────────────────
  function jobsFor(plot, npcId) {
    const jobs = []; // { c, r, job }
    if (plot.grid) {
      if (plot.kind === 'dig') {
        if (activeWorker(plot, 'diggers') !== npcId) return jobs;
        for (const t of plot.tiles) { const i = tileOf(plot, t.c, t.r); if (i.canDig && !i.dug) jobs.push({ c: t.c, r: t.r, job: 'dig' }); }
        return jobs;
      }
      const tiller = activeWorker(plot, 'tillers') === npcId;
      const seeder = plot.crop && activeWorker(plot, 'seeders') === npcId && deps?.seedAvailable?.(plot.crop);
      for (const t of plot.tiles) {
        const i = tileOf(plot, t.c, t.r);
        if (seeder && i.tilled && !i.crop) jobs.push({ c: t.c, r: t.r, job: 'seed' });
        else if (tiller && i.canTill) jobs.push({ c: t.c, r: t.r, job: 'till' });
      }
      return jobs;
    }
    if (plot.kind === 'dig') {
      if (activeWorker(plot, 'diggers') !== npcId) return jobs;
      for (const t of plot.tiles) if (!tileOf(plot, t.c, t.r).dug) jobs.push({ c: t.c, r: t.r, job: 'dig' });
      return jobs;
    }
    const harvester = activeWorker(plot, 'harvesters') === npcId;
    const seeder = plot.crop && cropDef(plot.crop) && activeWorker(plot, 'seeders') === npcId;
    const tiller = activeWorker(plot, 'tillers') === npcId;
    for (const t of plot.tiles) {
      const s = tileOf(plot, t.c, t.r);
      if (harvester && s.tilled && s.crop && s.ready) jobs.push({ c: t.c, r: t.r, job: 'harvest' });
      else if (seeder && s.tilled && !s.crop) jobs.push({ c: t.c, r: t.r, job: 'seed' });
      else if (tiller && !s.tilled) jobs.push({ c: t.c, r: t.r, job: 'till' });
    }
    return jobs;
  }

  const JOB_PRIORITY = { harvest: 0, seed: 1, till: 2, dig: 0 };
  function pickJob(npcId, walker, { familyOnly = false } = {}) {
    const here = walker?.root?.position;
    let best = null;
    for (const plot of plotsById.values()) {
      if (!plot.managed || !!plot.family !== familyOnly || !inHours(plot)) continue;
      for (const job of jobsFor(plot, npcId)) {
        if (claimedKeys.has(`${plot.id}:${keyOf(job.c, job.r)}`)) continue;
        const sameArea = walker && walker.area === plot.area;
        const dist = sameArea && here ? Math.hypot(here.x - (job.c + 0.5), here.z - (job.r + 0.5)) : 1000;
        const score = JOB_PRIORITY[job.job] * 100 + dist;
        if (!best || score < best.score) best = { plot, ...job, score };
      }
    }
    return best;
  }

  // The tile an NPC stands on to work (c, r): the nearest walkable neighbour, else the tile itself.
  function standSpot(plot, job, walker) {
    const here = walker?.root?.position;
    let best = null;
    for (const [dc, dr] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const c = job.c + dc, r = job.r + dr;
      if (window.NpcPathfinding?.isNpcTileWalkable?.(plot.area, c, r) === false) continue;
      if (plotTileAt(plot, c, r) && dc !== 0 && dr !== 0) continue; // Prefer not trampling the field diagonally.
      const dist = here ? Math.hypot(here.x - (c + 0.5), here.z - (r + 0.5)) : 0;
      if (!best || dist < best.dist) best = { c, r, dist };
    }
    return best || { c: job.c, r: job.r };
  }
  const plotTileAt = (plot, c, r) => plot.tiles.some(t => t.c === c && t.r === r);

  function claimFor(npcId, walker, { familyOnly = false } = {}) {
    let claim = claims.get(npcId);
    if (claim) {
      const plot = plotsById.get(claim.plotId);
      // Drop claims whose plot/hours/worker changed (e.g. the NPC just started following you).
      const stale = !plot || !plot.managed || !!plot.family !== familyOnly || !inHours(plot) || !jobsFor(plot, npcId).some(j => j.c === claim.c && j.r === claim.r && j.job === claim.job);
      if (!stale) return claim;
      releaseClaim(npcId);
    }
    const picked = pickJob(npcId, walker, { familyOnly });
    if (!picked) return null;
    const spot = standSpot(picked.plot, picked, walker);
    claim = { plotId: picked.plot.id, area: picked.plot.area, c: picked.c, r: picked.r, job: picked.job, standC: spot.c, standR: spot.r, workedS: 0, ageS: 0 };
    claims.set(npcId, claim);
    claimedKeys.add(`${claim.plotId}:${keyOf(claim.c, claim.r)}`);
    return claim;
  }
  function releaseClaim(npcId) {
    const claim = claims.get(npcId);
    if (!claim) return;
    claimedKeys.delete(`${claim.plotId}:${keyOf(claim.c, claim.r)}`);
    claims.delete(npcId);
  }

  // ── Schedule override ─────────────────────────────────────────────────
  function targetFor(rec, { familyOnly = false } = {}) {
    if (!rec?.id || !workerIds.has(rec.id)) return null;
    // This provider is registered before the festival and flood-shelter providers.
    // Town chores must release their workers so those higher-priority social/safety
    // schedules can take over. Family plots remain governed by the family routine.
    if (!familyOnly && (window.WaterSystem?.isTownFloodEmergency?.() || window.FestivalSystem?.festivalHours?.())) return null;
    const walker = deps?.findWalker?.(rec.id) || null;
    if (walker?._doorstepVisitor) return null;
    const claim = claimFor(rec.id, walker, { familyOnly });
    if (!claim) return null;
    const tool = claim.job === 'till' ? { toolKey: 'bronzehoe', toolIntervalSec: 1.6 }
      : claim.job === 'dig' ? { toolKey: window.ToolActivityStages?.toolKeyFor?.('dig') || 'pickshovel', toolActivity: 'dig', toolFlip: true }
      : {};
    return {
      area: claim.area, c: claim.standC, r: claim.standR, pose: 'stand', id: `farm-${claim.job}-${claim.plotId}-${claim.c},${claim.r}`,
      activity: JOB_LABEL[claim.job], rotY: (-Math.atan2(claim.r - claim.standR, claim.c - claim.standC) + Math.PI / 2) * 180 / Math.PI,
      ...tool,
    };
  }

  // ── Doing the work ────────────────────────────────────────────────────
  function applyJob(plot, claim) {
    if (plot.grid) {
      if (deps?.applyFarmJob?.(claim.job, claim.c, claim.r, plot.crop)) { debug.jobsDone += 1; debug.lastJob = { plot: plot.id, job: claim.job, c: claim.c, r: claim.r, at: Date.now() }; }
      return;
    }
    const s = stateOf(plot, claim.c, claim.r, true);
    if (claim.job === 'till') { s.tilled = true; s.idle = 0; }
    else if (claim.job === 'seed') { s.crop = plot.crop; s.age = 0; s.ready = false; s.idle = 0; }
    else if (claim.job === 'harvest') { s.crop = ''; s.age = 0; s.ready = false; s.idle = 0; }
    else if (claim.job === 'dig') { s.dug = true; s.water = rainedToday ? 1 : (s.water || 0); }
    debug.jobsDone += 1;
    debug.lastJob = { plot: plot.id, job: claim.job, c: claim.c, r: claim.r, at: Date.now() };
    refreshTile(plot, claim.c, claim.r);
    scheduleSave();
  }

  function tick() {
    if (!deps || !plotsById.size) return;
    const dt = TICK_MS / 1000;
    const raining = !!deps.isRaining?.();
    if (raining) rainShower();
    for (const [npcId, claim] of [...claims]) {
      const plot = plotsById.get(claim.plotId);
      if (!plot) { releaseClaim(npcId); continue; }
      claim.ageS += dt;
      const walker = deps.findWalker?.(npcId);
      const at = walker?.area === claim.area && walker.root
        && Math.hypot(walker.root.position.x - (claim.standC + 0.5), walker.root.position.z - (claim.standR + 0.5)) <= 1.2;
      // A walker that is not simulating (another area, not drawn) has no path to wait on: the work simply takes its time.
      const unseen = !walker || walker.area !== deps.getCurrentArea?.();
      if (at || (unseen && claim.ageS > JOB_SECONDS[claim.job] * 2)) claim.workedS += dt;
      if (claim.workedS >= JOB_SECONDS[claim.job]) { releaseClaim(npcId); applyJob(plot, claim); }
      else if (claim.ageS > 180) releaseClaim(npcId); // Unreachable tile: let the planner pick something else.
    }
    syncVisuals(deps.getCurrentArea?.());
  }

  // Rain fills every dug tile and the water stays; remember it rained so silting can apply at day end.
  function rainShower() {
    rainedToday = true;
    for (const plot of plotsById.values()) {
      if (plot.kind !== 'dig' || !plot.managed || plot.grid) continue;
      for (const t of plot.tiles) {
        const s = stateOf(plot, t.c, t.r);
        if (s?.dug && !s.water) { s.water = 1; refreshTile(plot, t.c, t.r); scheduleSave(); }
      }
    }
  }

  // Day rollover (game.js advanceDay): crops grow, bare soil overgrows, rained-on trenches may silt in.
  function onNewDay() {
    for (const plot of plotsById.values()) {
      if (!plot.managed || plot.grid) continue; // The farm's own grid grows, waters and silts itself.
      for (const t of plot.tiles) {
        const s = stateOf(plot, t.c, t.r);
        if (!s) continue;
        if (plot.kind === 'dig') {
          if (s.dug && rainedToday && Math.random() < SILT_CHANCE) { s.dug = false; s.water = 0; }
        } else if (s.tilled && s.crop) {
          const def = cropDef(s.crop);
          s.age = num(s.age, 0) + 1;
          s.ready = !!def && s.age >= def.growDays;
        } else if (s.tilled) {
          s.idle = num(s.idle, 0) + 1;
          if (s.idle >= IDLE_TILLED_DAYS) { s.tilled = false; s.idle = 0; }
        }
        refreshTile(plot, t.c, t.r);
      }
    }
    rainedToday = false;
    scheduleSave();
  }

  // ── Drawing ───────────────────────────────────────────────────────────
  const shared = {};
  function sharedAssets() {
    const THREE = window.THREE;
    if (shared.patch || !THREE) return shared;
    shared.patch = new THREE.BoxGeometry(0.94, 0.05, 0.94);
    shared.pit = new THREE.BoxGeometry(0.94, 0.04, 0.94);
    shared.water = new THREE.PlaneGeometry(0.8, 0.8);
    shared.tilledMat = new THREE.MeshLambertMaterial({ color: 0x6b4a30 });
    shared.pitMat = new THREE.MeshLambertMaterial({ color: 0x2d1d10 });
    shared.waterMat = new THREE.MeshBasicMaterial({ color: 0x3b6f9a, transparent: true, opacity: 0.85 });
    return shared;
  }

  function visualFor(areaId) {
    let v = visuals.get(areaId);
    const scene = deps?.getAreaScene?.(areaId);
    if (v?.group.parent === scene && scene) return v;
    if (!scene || !window.THREE) return null;
    if (!v) v = { group: new window.THREE.Group(), tiles: new Map() };
    v.group.name = 'npc_farm_plots';
    scene.add(v.group);
    visuals.set(areaId, v);
    for (const o of v.tiles.values()) o.sig = null; // Re-add everything into the (possibly rebuilt) scene.
    return v;
  }

  function disposeTile(v, key) {
    const entry = v.tiles.get(key);
    if (!entry) return;
    for (const object of entry.objects) {
      v.group.remove(object);
      if (object.userData.ownMaterial) object.material.dispose?.();
      if (object.userData.ownGeometry) object.traverse?.(n => n.geometry?.dispose?.());
    }
    v.tiles.delete(key);
  }

  function drawTile(plot, c, r) {
    const v = visualFor(plot.area);
    if (!v) return;
    const key = `${plot.id}:${keyOf(c, r)}`;
    const s = tileOf(plot, c, r);
    const growth = s.crop && cropDef(s.crop) ? Math.min(1, num(s.age, 0) / cropDef(s.crop).growDays) : 0;
    const bucket = growth < 0.15 ? 0 : growth < 0.45 ? 1 : growth < 0.8 ? 2 : 3;
    const sig = `${s.tilled ? 1 : 0}${s.dug ? 1 : 0}${s.water ? 1 : 0}|${s.crop || ''}|${bucket}${s.ready ? 'r' : ''}`;
    const existing = v.tiles.get(key);
    if (existing && existing.sig === sig) return;
    disposeTile(v, key);
    if (!s.tilled && !s.dug) return;
    const assets = sharedAssets(), THREE = window.THREE;
    const y = num(deps.surfaceY?.(plot.area, c, r), 0);
    const objects = [];
    if (s.dug) {
      const pit = new THREE.Mesh(assets.pit, assets.pitMat);
      pit.position.set(c + 0.5, y + 0.02, r + 0.5);
      objects.push(pit);
      if (s.water) {
        const water = new THREE.Mesh(assets.water, assets.waterMat);
        water.rotation.x = -Math.PI / 2;
        water.position.set(c + 0.5, y + 0.046, r + 0.5);
        objects.push(water);
      }
    } else {
      const patch = new THREE.Mesh(assets.patch, assets.tilledMat);
      patch.position.set(c + 0.5, y + 0.025, r + 0.5);
      objects.push(patch);
      if (s.crop) {
        const built = deps.buildCropMesh?.(s.crop, growth, !!s.ready, c, r);
        if (built?.mesh) {
          built.mesh.position.set(c + 0.5, y + 0.05 + built.lift, r + 0.5);
          built.mesh.userData.ownGeometry = true;
          objects.push(built.mesh);
        }
      }
    }
    for (const object of objects) v.group.add(object);
    v.tiles.set(key, { objects, sig });
  }

  function refreshTile(plot, c, r) {
    if (!plot.grid && plot.area === deps?.getCurrentArea?.()) drawTile(plot, c, r);
  }

  // Draws every tile of this area's plots once the player is there (cheap when nothing changed: signatures compare).
  let lastSyncedArea = null, syncedVersion = 0;
  function syncVisuals(currentArea) {
    if (!currentArea) return;
    if (lastSyncedArea !== currentArea) { lastSyncedArea = currentArea; syncedVersion = 0; }
    if (syncedVersion > 0 && visuals.get(currentArea)?.group.parent !== deps?.getAreaScene?.(currentArea)) syncedVersion = 0; // Scene was rebuilt.
    if (syncedVersion > 0) return;
    let any = false;
    for (const plot of plotsById.values()) {
      if (plot.area !== currentArea || !plot.managed || plot.grid) continue;
      for (const t of plot.tiles) drawTile(plot, t.c, t.r);
      any = true;
    }
    if (any && visuals.get(currentArea)?.group.parent) syncedVersion = 1;
  }

  // ── Persistence ───────────────────────────────────────────────────────
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = 0; try { deps?.saveMemberWorldData?.(); } catch (_) {} }, 4000);
  }
  function serialize() { return JSON.parse(JSON.stringify({ version: 1, states, rainedToday })); }
  function restore(saved) {
    states = saved && typeof saved === 'object' && saved.states && typeof saved.states === 'object' ? JSON.parse(JSON.stringify(saved.states)) : {};
    rainedToday = saved?.rainedToday === true;
    claims.clear(); claimedKeys.clear();
    for (const v of visuals.values()) for (const key of [...v.tiles.keys()]) disposeTile(v, key);
    syncedVersion = 0;
  }

  const api = {
    init, registerMap, registerFarmPlots, isManagedTile, onNewDay, serialize, restore,
    targetFor, tick,
    plots: () => [...plotsById.values()],
    snapshot: () => ({
      plots: [...plotsById.values()].map(p => ({ id: p.id, area: p.area, kind: p.kind, managed: p.managed, tiles: p.tiles.length, hours: p.hours })),
      claims: [...claims].map(([npc, c]) => ({ npc, ...c })),
      drawn: Object.fromEntries([...visuals].map(([areaId, v]) => [areaId, { tiles: v.tiles.size, meshes: v.group.children.length, attached: !!v.group.parent }])),
      debug: { ...debug },
    }),
    _test: { states: () => states, applyJob, jobsFor, pickJob, onNewDay, tick, rainShower },
  };
  window.NpcFarmPlots = api;
})();
