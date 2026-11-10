// Fortified bandit strongholds — an alternative bandit-camp presentation, not an extra spawn.
// Scene geometry uses ProceduralFurniture's existing textured-part material pipeline.
// Cave generation, occupants and saves remain owned by CaveSiteSystem.
(() => {
  'use strict';
  if (window.BanditStrongholds) return;

  const DEFAULT_REPLACEMENT_FRACTION = 0.25; // Used when the gang config omits stronghold tuning.
  const siteRegistrations = new Map(); // Map id -> exterior camp record, for teardown and mobile diagnostics.
  const interiorScenes = new Map(); // Map id -> already-installed prop group, avoiding duplicate draws on reentry.
  const latest = { event: 'not seeded', failed: 0 }; // Latest useful on-device diagnostic; no console required.
  const pendingBarrels = new Set(); // Prevents duplicate asynchronous furniture builds for the same barrel id.
  const BARREL_LOOT = Object.freeze({ // Independent, data-like drop rules; no copy of the Shattercask projectile simulation.
    contrabandBarrel: Object.freeze({ gold:[6,14], alcoholCount:[1,3], narcoticChance:.42, komanineChance:.2 }),
    flaskBarrel: Object.freeze({ gold:[1,4], flaskCount:[3,6], distinctRecipes:2 }),
  });
  const WOOD = Object.freeze({ color: '#7a4924', materialRole: 'wood', materialTexture: 'boards.png' }); // Aging Barrel's planked wood, not a new procedural texture.
  const DARK_WOOD = Object.freeze({ color: '#6b4a28', materialRole: 'wood', materialTexture: 'boards.png' }); // Same darker fittings and boards as authored barrels.
  const STONE = Object.freeze({ color: '#777267', materialRole: 'stone', materialTexture: 'carved_smooth.png' });
  const METAL = Object.freeze({ color: '#43b3ae', materialRole: 'metal', materialTexture: 'carved_smooth.png' }); // Aging Barrel's existing verdigris hoop color/material.

  function hash(text) {
    let value = 2166136261 >>> 0; // FNV-1a site selection never consumes the combat/spawn RNG.
    for (const ch of String(text)) { value ^= ch.charCodeAt(0); value = Math.imul(value, 16777619) >>> 0; }
    return value >>> 0;
  }

  function replacementFraction(cfg) {
    const raw = Number(cfg?.fortifiedStrongholds?.replacementFraction);
    return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : DEFAULT_REPLACEMENT_FRACTION;
  }

  function shouldFortify(zoneId, slot, cfg) {
    const cycle = Number(window.CalendarSystem?.tothalCycle?.() || 0); // Tothal changes may generate a new set of camps.
    const roll = hash('fortified-camp-v1:' + zoneId + ':' + slot + ':' + cycle) / 4294967296;
    return roll < replacementFraction(cfg);
  }

  function part(name, x, y, z, sx, sy, sz, surface = WOOD, kind = 'box') {
    return { id: name, name, kind, ...surface, transform: { x, y, z, sx, sy, sz } };
  }

  function registerRecipes() {
    const catalog = window.ProceduralFurniture?.CATALOG;
    if (!catalog) return false;
    if (catalog.fortifiedWatchtower) return true;
    const planks = [
      part('tower-deck', 0, 1.45, 0, 1.75, .18, 1.75),
      part('tower-crossbar-n', 0, 2.12, -.81, 1.75, .11, .14),
      part('tower-crossbar-s', 0, 2.12, .81, 1.75, .11, .14),
      part('tower-crossbar-w', -.81, 2.12, 0, .14, .11, 1.75),
      part('tower-crossbar-e', .81, 2.12, 0, .14, .11, 1.75),
      part('tower-roof', 0, 2.75, 0, 1.9, .13, 1.9, DARK_WOOD),
      part('tower-ladder', .2, .7, .85, .45, 1.38, .08, DARK_WOOD),
    ];
    for (const sx of [-.7, .7]) for (const sz of [-.7, .7]) {
      planks.push(part('tower-post-' + sx + '-' + sz, sx, 1.32, sz, .15, 2.64, .15));
    }
    catalog.fortifiedWatchtower = planks;
    catalog.fortifiedLowRail = [
      part('rail-low-plank-a', 0, .48, 0, 1.85, .29, .16),
      part('rail-low-plank-b', 0, .79, 0, 1.85, .24, .16, DARK_WOOD),
      part('rail-post-left', -.83, .55, 0, .14, 1.1, .18),
      part('rail-post-right', .83, .55, 0, .14, 1.1, .18),
    ];
    catalog.fortifiedHighCover = [
      part('cover-plank-low', 0, .40, 0, 1.85, .52, .2),
      part('cover-plank-middle', 0, .95, 0, 1.85, .52, .2, DARK_WOOD),
      part('cover-plank-upper', 0, 1.5, 0, 1.85, .52, .2),
      part('cover-post-left', -.8, .94, 0, .19, 1.88, .25),
      part('cover-post-right', .8, .94, 0, .19, 1.88, .25),
    ];
    catalog.fortifiedCaveArch = [
      part('arch-stone-left', -.91, 1, .06, .52, 2.04, .7, STONE),
      part('arch-stone-right', .91, 1, .06, .52, 2.04, .7, STONE),
      part('arch-stone-lintel', 0, 2.14, .06, 2.36, .5, .7, STONE),
      part('arch-wood-lintel', 0, 1.79, -.18, 1.4, .15, .18),
      part('arch-wood-side-left', -.61, .86, -.21, .14, 1.71, .18),
      part('arch-wood-side-right', .61, .86, -.21, .14, 1.71, .18),
    ]; // Intentionally no black portal plane: the native cave transition renders the opening.
    catalog.fortifiedWolfStake = [
      part('stake-wood-post',0,.53,0,.18,1.06,.18,WOOD),
      part('stake-ground-base',0,.08,0,.38,.16,.38,DARK_WOOD),
      part('stake-chain-ring',0,.77,0,.31,.09,.31,METAL,'hoop'),
    ]; // Exactly the same board/metal roles and texture families as existing Aging Barrel furniture.
    return true;
  }

  function siteProps(rec) {
    const site = rec?.instance?.site;
    if (!site || site.w < 5 || site.h < 5) return [];
    const cx = Math.floor(site.x + site.w / 2);
    const cy = Math.floor(site.y + site.h / 2);
    const minX = site.x, maxX = site.x + site.w - 1;
    const minY = site.y, maxY = site.y + site.h - 1;
    let pieceIndex = 0; // Guarantees separate mesh/collision identities for twin towers and matching barricades.
    const coord = (key, x, y, rotate = 0) => {
      const index = pieceIndex++;
      return {
        id: rec.instance.id + ':' + key + ':' + index,
        coverId: 'exterior:' + rec.discoverySlot + ':' + index,
        key, x: Math.max(minX, Math.min(maxX, x)),
        y: Math.max(minY, Math.min(maxY, y)), w: 1, h: 1, rotY: rotate,
        strongholdProp: true,
      };
    };
    const props = [
      coord('fortifiedCaveArch', cx, cy),
      coord('fortifiedWatchtower', minX + 1, minY + 1),
      coord('fortifiedWatchtower', maxX - 1, minY + 1),
      coord('fortifiedLowRail', cx - 2, cy + 1),
      coord('fortifiedLowRail', cx + 2, cy + 1),
      coord('fortifiedHighCover', minX + 1, cy),
      coord('fortifiedHighCover', maxX - 1, cy),
    ];
    for(const slot of [0,1]){
      const stake=coord('fortifiedWolfStake',slot===0?minX+2:maxX-2,cy-1);
      stake.strongholdStake=true;stake.wolfSlot=slot;stake.freed=false;
      stake.interactable={holdSeconds:.85}; // Uses the existing tent hold/aim action, not a parallel mobile input.
      props.push(stake);
    }
    return props;
  }

  function upsertEntrance(rec, deps, mapId) {
    const site = rec.instance.site;
    const col = Math.floor(site.x + site.w / 2);
    const row = Math.floor(site.y + site.h / 2);
    const id = 'bandit_fortified_' + rec.discoverySlot + '_enter';
    const transition = { id, col, row, label: 'Fortified Cave Stronghold',
      target: 'building', targetMapId: mapId };
    const layout = deps.zoneLayouts?.get?.(rec.zoneId);
    if (!layout) return false;
    const set = list => {
      if (!Array.isArray(list)) return;
      const index = list.findIndex(t => t?.id === id);
      if (index >= 0) list[index] = transition; else list.push(transition);
    };
    layout.transitions ||= [];
    set(layout.transitions);
    const live = deps.zoneScenes?.get?.(rec.zoneId);
    if (live?.transitions) set(live.transitions); // Cached wilderness scenes need their own runtime transition.
    const ground = live?.grid?.[row]?.[col];
    if (live?.scene && window.THREE && !live.scene.children.some(child => child.userData?.banditStrongholdTransitionId === id)) {
      const THREE = window.THREE;
      const ring = new THREE.Mesh(new THREE.RingGeometry(.22, .36, 24),
        new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: .5, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      const surface = Number(deps.tileSurfaceYInArea?.(ground, rec.zoneId));
      ring.position.set(col + .5, (Number.isFinite(surface) ? surface : 0) + .02, row + .5);
      ring.userData.banditStrongholdTransitionId = id;
      window.EnvironmentSurfaceMicroPlateau?.bindGroundProjection?.(ring);
      live.scene.add(ring);
    }
    return true;
  }

  function upgradeCamp(rec, deps) {
    if (rec?.stronghold) return true; // Re-entry and async setup cannot duplicate an already converted camp.
    if (!rec || !deps || !registerRecipes()) return false;
    if (!siteProps(rec).length) return false;
    const site = window.CaveSiteSystem?.registerFortifiedStronghold?.(rec.zoneId, rec.discoverySlot);
    if (!site?.mapId) return false;
    if (!upsertEntrance(rec, deps, site.mapId)) return false;
    for (const prop of rec.props) if (prop.type === 'tent') prop.destroyed = true; // Physical walls replace the Simple Hydra tent stage.
    const props = siteProps(rec);
    for(const prop of props)if(prop.strongholdStake)
      prop.freed=!!window.CaveSiteSystem?.strongholdWolfStatus?.(site.mapId,prop.wolfSlot)?.freed;
    rec.props.push(...props);
    rec.instance.stampedObjectIds.push(...props.map(prop => prop.id)); // Same locale release lifecycle as existing camp furniture.
    rec.stronghold = { mapId: site.mapId, slot: rec.discoverySlot, entrance: site.mapId };
    siteRegistrations.set(site.mapId, { zoneId: rec.zoneId, slot: rec.discoverySlot, instanceId: rec.instance.id });
    latest.event = 'fortified ' + rec.zoneId + ' slot ' + rec.discoverySlot;
    window.__farmLog?.('[bandit-stronghold] ' + latest.event, 'world');
    return true;
  }

  function removeCamp(rec, deps, retire = false) {
    const mapId = rec?.stronghold?.mapId;
    if (!mapId) return;
    const id = 'bandit_fortified_' + rec.discoverySlot + '_enter';
    const layout = deps?.zoneLayouts?.get?.(rec.zoneId);
    const live = deps?.zoneScenes?.get?.(rec.zoneId);
    for (const holder of [layout, live]) {
      if (holder?.transitions) holder.transitions = holder.transitions.filter(t => t?.id !== id);
    }
    window.BanditStrongholdWolves?.forgetExterior?.(rec,deps); // Native animal owner removes the live rig; the cave save preserves rescue/death.
    for (const prop of rec.props || []) if (prop.coverId) window.BanditStrongholdCover?.unregister?.(rec.zoneId,prop.coverId);
    for (const ring of [...(live?.scene?.children || [])]) if (ring.userData?.banditStrongholdTransitionId === id) {
      live.scene.remove(ring); ring.geometry?.dispose(); ring.material?.dispose();
    }
    siteRegistrations.delete(mapId);
    if (retire) window.CaveSiteSystem?.forgetFortifiedStronghold?.(mapId); // Never erase saved cave progress merely because an exterior scene is unloaded.
  }

  function buildInteriorProps(mapId, mapData, scene) {
    if (!scene || !mapData?.caveSite?.fortifiedStronghold || !registerRecipes()) return 0;
    const previous = interiorScenes.get(mapId);
    if (previous?.scene === scene) { ensureBarrels(mapId, mapData, scene); return previous.group.children.length; }
    if (previous) {
      window.BanditStrongholdCover?.forgetScope?.(mapId); // Old interior collision references must not survive its scene.
      previous.scene.remove(previous.group);
    }
    const THREE = window.THREE;
    if (!THREE) return 0;
    const group = new THREE.Group(); // A single parent owns every decorative barricade; no extra frame loop.
    group.name = 'fortified-bandit-interior';
    const floor = (mapData.floor || []).filter(tile => Array.isArray(tile) && tile.length >= 2);
    const exitCol = Number(mapData.exitCol) || 0, exitRow = Number(mapData.exitRow) || 0;
    const candidates = floor.map(([col, row]) => ({ col, row, distance: Math.hypot(col - exitCol, row - exitRow) }))
      .filter(tile => tile.distance >= 4 && tile.distance <= 12)
      .sort((a,b) => a.distance-b.distance || a.col-b.col || a.row-b.row);
    const selected = [];
    for (const tile of candidates) {
      if (selected.length >= 4) break;
      if (selected.some(other => Math.hypot(other.col-tile.col,other.row-tile.row)<3)) continue;
      selected.push(tile);
      const key = selected.length % 2 ? 'fortifiedLowRail' : 'fortifiedHighCover';
      const piece = window.ProceduralFurniture.buildFurnitureGroup(key);
      piece.position.set(tile.col+.5, Number(mapData.floorSurfaceY)||0, tile.row+.5);
      piece.rotation.y = (tile.col < exitCol ? -1 : 1) * Math.PI/2;
      group.add(piece);
      const coverId = 'interior:' + (selected.length - 1); // Stable slot identity, independent of scene mesh/async initialization.
      window.BanditStrongholdCover?.register?.({
        scope:mapId, saveMapId:mapId, id:coverId, key, mesh:piece,
        col:tile.col, row:tile.row, y:Number(mapData.floorSurfaceY)||0,
        getGrid:()=>window.CaveSiteSystem?.activeStrongholdGrid?.(mapId),
        onDestroyed:()=>group.remove(piece),
      });
    }
    scene.add(group);
    interiorScenes.set(mapId, { scene, group });
    latest.event = 'interior barricades ' + selected.length + ' (' + mapId + ')';
    ensureBarrels(mapId, mapData, scene); // Loads existing Aging Barrel art and shared Burden physics asynchronously.
    return selected.length;
  }

  function barrelPlans(plan) {
    return plan?.strongholdBarrels || plan?.caveSitePlan?.strongholdBarrels || []; // Cave decoration and live plan expose the same immutable placements.
  }

  function rollUnit(key) {
    return hash(String(key)) / 4294967296; // Saved encounter gets stable loot even if unrelated game RNG changes.
  }
  function rollCount(key, range) {
    return range[0] + Math.floor(rollUnit(key) * (range[1] - range[0] + 1));
  }

  function registerKomanineItem(deps) {
    if (!deps?.ITEM_DEFS) return;
    const defs = deps.ITEM_DEFS; // Uses the same item registry as processed liquor and Technique Scrolls.
    if (!defs.komanine) defs.komanine = {
      icon:'📦', label:'Komanine', cat:'material', sellPrice:150,
      tags:['Contraband','Illegal','Komanine'],
      desc:'A sealed illicit shipment of Komanine. Consumption and gameplay effects are not yet specified.',
    }; // Inert trade good only — deliberately no consumption action, buff, recipe or drug mechanic.
    if (Array.isArray(deps.inventoryItems) && !deps.inventoryItems.some(item => item.key === 'komanine'))
      deps.inventoryItems.push({ key:'komanine', icon:'📦', label:'KOMANINE', max:999 });
  }

  function installItemRegistration() {
    const api = window.ItemProcessing;
    if (!api?.init || api.__banditStrongholdItemPatched) return false;
    const init = api.init; // Existing processor initialization remains the owner of dynamic liquor item definitions.
    api.init = function strongholdItemInit(deps, ...args) {
      const result = init.call(this, deps, ...args);
      registerKomanineItem(deps);
      return result;
    };
    api.__banditStrongholdItemPatched = true;
    return true;
  }

  function contrabandLoot(mapId, barrelId) {
    const id = mapId + ':' + barrelId;
    const rules = BARREL_LOOT.contrabandBarrel;
    const loot = { gold: rollCount(id + ':gold', rules.gold) }; // Nonempty even if specialty definitions have not loaded.
    const options = ['needlegrain', 'heftroot']; // Existing barrel-aging recipes, never hand-made alcohol effects.
    const source = options[Math.floor(rollUnit(id + ':liquor') * options.length)];
    const output = window.ItemProcessing?.getProcessingOutput?.('barrelAging', source);
    if (output?.key) {
      window.ItemProcessing?.ensureProcessedItemDef?.(output);
      loot[output.key] = rollCount(id + ':bottles', rules.alcoholCount);
    }
    const narcotic = Object.values(window.AlchemySystem?.RECIPE_DEFS || {}).find(recipe =>
      /narcotic|rush|frenzy/i.test([recipe?.id, recipe?.label, ...(recipe?.tags||[])].join(' ')));
    if (narcotic && rollUnit(id + ':narcotic') < rules.narcoticChance) {
      const key = window.AlchemySystem?.ensureRecipeItemDef?.(narcotic.id, 1);
      if (key) loot[key] = (loot[key] || 0) + 1;
    }
    if (rollUnit(id + ':komanine') < rules.komanineChance) loot.komanine = 1;
    return loot;
  }

  function flaskLoot(mapId, barrelId) {
    const id = mapId + ':' + barrelId;
    const rules = BARREL_LOOT.flaskBarrel;
    const loot = { gold: rollCount(id + ':gold', rules.gold) };
    const recipes = [...(window.BanditCombat?.availableFlaskRecipeIds?.() || [])].sort(); // Existing authored throw effects, not guessed item keys.
    if (!recipes.length) return loot; // A late alchemy init leaves at least currency instead of an undefined inventory entry.
    const first = Math.floor(rollUnit(id + ':first-recipe') * recipes.length);
    const selected = [recipes[first]];
    if (recipes.length > 1 && rules.distinctRecipes > 1) {
      const rest = recipes.filter(recipe => recipe !== selected[0]);
      selected.push(rest[Math.floor(rollUnit(id + ':second-recipe') * rest.length)]);
    }
    const count = rollCount(id + ':flask-count', rules.flaskCount);
    for (let i=0; i<count; i++) {
      const key = window.AlchemySystem?.ensureRecipeItemDef?.(selected[i % selected.length], 1);
      if (key) loot[key] = (loot[key] || 0) + 1;
    }
    return loot;
  }

  function barrelImpact(burden, cause) {
    const id = burden?.id, mapId = burden?.mapId;
    if (!id || !mapId) return false;
    const claimed = window.CaveSiteSystem?.claimFortifiedBarrel?.(mapId, id);
    window.Shattercasks?.discardBurden?.(burden); // Same carried/stowed/flying cleanup as an ordinary smashed crate.
    if (!claimed) return true; // Duplicate projectile+ground impact must never grant twice.
    const contents = burden.kind === 'flaskBarrel' ? flaskLoot(mapId,id) : contrabandLoot(mapId,id);
    const gained = window.Shattercasks?.grantBurdenLoot?.(contents) || [];
    latest.event = 'shattered ' + burden.kind + ' (' + cause + '): ' + id;
    window.__farmLog?.('[bandit-stronghold] ' + latest.event + ': ' + JSON.stringify(contents), 'world');
    window.AudioSystem?.playObjectSfxKey?.('woodBreak'); // Existing object SFX, no new audio/particles runtime.
    if (gained.length) window.__farmLog?.('[bandit-stronghold] obtained ' + gained.join(', '), 'world');
    return true;
  }

  function ensureBarrels(mapId, plan, scene) {
    const stronghold = window.CaveSiteSystem;
    if (!scene || !window.Shattercasks?.registerBurden || !window.AuthoredFurniture?.load || !stronghold) return 0;
    const positions = barrelPlans(plan);
    let pending = 0; // Cheap return value for the mobile diagnostic snapshot.
    for (const barrel of positions) {
      if (!barrel || !['contrabandBarrel','flaskBarrel'].includes(barrel.kind)) continue;
      const id = mapId + ':' + String(barrel.id); // Map-qualified identity survives cave scene construction/re-entry.
      if (!stronghold.fortifiedBarrelStatus?.(mapId,id)?.available) continue;
      if (window.Shattercasks.getBurden?.(id,mapId) || pendingBarrels.has(id)) continue;
      pendingBarrels.add(id);
      pending++;
      Promise.resolve(window.AuthoredFurniture.load('agingBarrel')).then(recipe => {
        if (!recipe || interiorScenes.get(mapId)?.scene !== scene || !stronghold.fortifiedBarrelStatus?.(mapId,id)?.available)
          return;
        const group = window.AuthoredFurniture.buildGroup(recipe); // Identical boards/metal hoops to the existing aging furniture.
        const x = Number(barrel.col) + .5, z = Number(barrel.row) + .5;
        group.position.set(x, Number(plan?.floorSurfaceY || 0), z);
        const borrow = window.AuthoredFurniture.peek?.('looseCrate')?.carryable || {}; // The shared crate hand/carry rig is already authored for physical Burdens.
        const barrelPart = recipe.parts?.find(part => part.kind === 'barrel');
        const centerY = Number(barrelPart?.transform?.y) || .43; // Aging Barrel's actual geometry center keeps the rig origin on its body.
        const barrelHalfWidth = Math.max(.2, Number(barrelPart?.transform?.sy) / 2 || .42); // Aging Barrel is horizontal (rotated barrel primitive).
        const carryable = {
          ...borrow,
          enabled: true,
          billboardAnchor: { ...(borrow.billboardAnchor || {}), coordinateSpace:'posterior-relative',
            position: { x:0,y:centerY,z:-.25 }, size:1 },
          handTargets: {
            left: { x:barrelHalfWidth,y:centerY,z:0,rotation:{x:180,y:0,z:-90} },
            right: { x:-barrelHalfWidth,y:centerY,z:0,rotation:{x:0,y:0,z:90} },
          },
          hitbox: { enabled:true,center:{x:0,y:centerY,z:0},size:{x:barrelHalfWidth*2,y:centerY*2,z:Math.max(.5,Number(barrelPart?.transform?.sz)||.76)} },
        }; // Computed from authored barrel dimensions; both variants share one existing carry/throw renderer.
        const registered = window.Shattercasks.registerBurden({
          id, kind:barrel.kind, mapId, scene, group, data:{ ...recipe, carryable }, hanging:false,
          displayName:barrel.kind === 'flaskBarrel' ? 'Flask Barrel' : 'Contraband Barrel',
          onPickup:() => stronghold.markFortifiedBarrelTaken?.(mapId,id),
          onImpact:barrelImpact,
        });
        if (!registered) group.parent?.remove(group);
        else latest.event = 'spawned ' + barrel.kind + ' ' + id;
      }).catch(error => {
        latest.failed++;
        window.__farmLog?.('[bandit-stronghold] barrel load failed: ' + error.message, 'warn');
      }).finally(() => pendingBarrels.delete(id));
    }
    return pending;
  }

  function forgetInterior(mapId) {
    window.BanditStrongholdWolves?.forgetInterior?.(String(mapId)); // Enemy targets/avatars may not survive a retired cave scene.
    window.BanditStrongholdCover?.forgetScope?.(String(mapId)); // Releases collision and capability records before disposing meshes.
    const old = interiorScenes.get(String(mapId)); // Only models belonging to this cave may be disposed on a map reset.
    if (!old) return false;
    old.group.parent?.remove(old.group);
    old.group.traverse?.(node => { node.geometry?.dispose?.(); node.material?.dispose?.(); });
    interiorScenes.delete(String(mapId));
    return true;
  }

  function debugSnapshot() {
    return { ...latest, replacementDefault: DEFAULT_REPLACEMENT_FRACTION,
      activeSites: [...siteRegistrations.entries()].map(([mapId, site]) => ({ mapId, ...site })),
      interiorMaps: [...interiorScenes.keys()], pendingBarrels: pendingBarrels.size, barrelLootRules: BARREL_LOOT,
      cover:window.BanditStrongholdCover?.debugSnapshot?.()||null,
      wolves:window.BanditStrongholdWolves?.debugSnapshot?.()||null, style: 'authored boards.png wood and carved_smooth.png stone via ProceduralFurniture' };
  }

  window.BanditStrongholds = Object.freeze({
    shouldFortify, replacementFraction, registerRecipes, upgradeCamp, removeCamp,
    buildInteriorProps, ensureBarrels, forgetInterior, debugSnapshot, installItemRegistration, BARREL_LOOT, __test: Object.freeze({ hash, siteProps }),
  });
  registerRecipes();
  installItemRegistration();
})();