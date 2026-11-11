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
  const barrelScenesByMapId = new Map(); // Exact scene identities prevent late authored barrel loads after changing maps.
  const BARREL_LOOT = Object.freeze({ // Independent, data-like drop rules; no copy of the Shattercask projectile simulation.
    contrabandBarrel: Object.freeze({ gold:[6,14], alcoholCount:[1,3], narcoticChance:.42, komanineChance:.2 }),
    flaskBarrel: Object.freeze({ gold:[1,4], flaskCount:[3,6], distinctRecipes:2 }),
  });
  const WOOD = Object.freeze({ color: '#7a4924', materialRole: 'wood', materialTexture: 'boards.png', materialTextureTint:'#f1e7d7' }); // Existing plank texture, dusty sun-bleached salvage.
  const DARK_WOOD = Object.freeze({ color: '#6b4a28', materialRole: 'wood', materialTexture: 'boards.png', materialTextureTint:'#bfa890' }); // Same boards, darkened by age and accumulated grime.
  const SCARRED_WOOD = Object.freeze({ color:'#57432d', materialRole:'wood', materialTexture:'boards.png', materialTextureTint:'#958579' }); // Old broken boards; one shared original texture, not an added texture.
  const STONE = Object.freeze({ color: '#777267', materialRole: 'stone', materialTexture: 'carved_smooth.png', materialTextureTint:'#d0c9bd' }); // Chipped existing carved stone.
  const METAL = Object.freeze({ color: '#43b3ae', materialRole: 'metal', materialTexture: 'carved_smooth.png', materialTextureTint:'#9fbeb7' }); // Existing verdigris fittings, still in the carved-stone texture family.

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

  function part(name, x, y, z, sx, sy, sz, surface = WOOD, kind = 'box', distress = null) {
    const transform = { x, y, z, sx, sy, sz }; // Existing furniture author primitive; optional rotation makes salvage boards genuinely crooked.
    if (distress) for (const axis of ['rx', 'ry', 'rz']) {
      if (Number.isFinite(distress[axis])) transform[axis] = distress[axis];
    }
    const shape = distress ? Object.fromEntries(Object.entries(distress).filter(([key]) => !['rx','ry','rz'].includes(key))) : {};
    return { id: name, name, kind, ...surface, ...shape, transform };
  }

  function registerRecipes() {
    const catalog = window.ProceduralFurniture?.CATALOG;
    if (!catalog) return false;
    if (catalog.fortifiedWatchtower) return true;
    // These are deliberately mismatched salvaged planks rather than smooth walls or a flat roof.
    // Every wood/stone/metal surface still uses the same texture family as existing furniture.
    const tower = [
      part('frame-front-sill', 0, .45, -.70, 1.66, .17, .20, DARK_WOOD, 'box', { rz: 3, topScaleX: .95 }),
      part('frame-back-sill', .06, .54, .70, 1.73, .15, .17, WOOD, 'box', { rz: -4 }),
      part('frame-left-joist', -.71, 1.39, 0, .14, .18, 1.8, DARK_WOOD),
      part('frame-right-joist', .70, 1.43, 0, .15, .18, 1.8, WOOD, 'box', { rx: 3 }),
      part('brace-front-left', -.43, .94, -.76, .13, 1.41, .13, WOOD, 'box', { rz: -30 }),
      part('brace-back-right', .43, .99, .75, .13, 1.32, .13, DARK_WOOD, 'box', { rz: 28 }),
      part('brace-left-face', -.76, .98, -.39, .12, 1.40, .13, WOOD, 'box', { rx: -29 }),
      part('brace-right-face', .76, .96, .37, .11, 1.34, .12, DARK_WOOD, 'box', { rx: 33 }),
    ];
    for (const [index, x] of [-.72, .72].entries()) for (const [side, z] of [-.72, .72].entries()) {
      const height = 2.92 + (index ? -.14 : .05) + (side ? -.10 : .04); // Four uneven timber uprights hold a level-ish deck.
      tower.push(part('tower-post-'+index+'-'+side, x, height/2, z, .17, height, .18,
        (index+side)%2 ? DARK_WOOD : WOOD, 'box',
        { rz:index ? -3 : 4, rx:side ? -3 : 2, topScaleX:.88, topScaleZ:.86, bottomScaleX:1.12 }));
    }
    for (let i=0;i<6;i++) {
      if (i===2) continue; // Missing, broken deck board: an unmistakable gap between patched planks.
      const z=-.66+i*.26;
      tower.push(part('deck-reclaimed-'+i, (i%2?-.03:.03), 1.52+(i%3)*.015, z,
        i===4?1.48:1.81,.12,.245, i%2?DARK_WOOD:WOOD,'box',
        { rz:(i%3-1)*2.6, topScaleX:i===4?.78:.94, bottomScaleX:1.06 }));
    }
    tower.push(
      part('deck-repair-scrap',-.31,1.59,-.15,.76,.10,.22,WOOD,'box',{ ry:19, topScaleX:.72 }),
      part('rail-broken-front-left',-.47,2.13,-.77,.88,.15,.15,WOOD,'box',{ rz:-9,topScaleX:.78 }),
      part('rail-broken-front-right',.53,2.05,-.79,.56,.13,.13,SCARRED_WOOD,'box',{ rz:13,topScaleX:.72 }),
      part('rail-side-right',.77,2.05,-.14,.14,.13,1.17,WOOD,'box',{ rx:8 }),
      part('rail-side-left-stump',-.78,1.91,.48,.13,.13,.54,DARK_WOOD,'box',{ rx:-10 }),
      part('ladder-rail-left',.11,.78,.91,.10,1.49,.11,DARK_WOOD,'box',{ rz:8 }),
      part('ladder-rail-right',.56,.80,.95,.09,1.58,.12,WOOD,'box',{ rz:-4 }),
      part('ladder-rung-low',.33,.35,1.0,.45,.09,.11,WOOD,'box',{rz:-7}),
      part('ladder-rung-mid',.33,.73,.98,.47,.08,.12,DARK_WOOD,'box',{rz:9}),
      part('ladder-rung-high-scrap',.34,1.11,.98,.36,.08,.11,WOOD,'box',{rz:-15,topScaleX:.72}),
      part('roof-main-beam',0,3.14,-.04,1.78,.14,.18,DARK_WOOD,'box',{rz:3}),
      part('roof-repair-angled-beam',.12,3.10,.45,1.50,.12,.14,WOOD,'box',{rz:-5}),
    );
    for(let i=0;i<5;i++) {
      if (i===3) continue; // A large missing roof patch exposes the hurried repairs beneath.
      const z=-.76+i*.38;
      tower.push(part('roof-patch-'+i,(i%2?-.13:.07),3.28+(i%3)*.035,z,
        i===4?1.17:1.92,.11,.33,i%2?DARK_WOOD:WOOD,'box',
        { rz:i%2?7:-4,rx:(i-2)*2,topScaleX:i===4?.69:.93,bottomScaleX:1.05 }));
    }
    tower.push(
      part('roof-repair-scrap',-.37,3.37,.28,.62,.09,.47,SCARRED_WOOD,'box',{ry:-20,rz:6,topScaleX:.77}),
      part('patch-metal-strap',-.72,1.97,-.80,.23,.29,.055,METAL,'box',{rz:-18,topScaleX:.79}),
    );
    catalog.fortifiedWatchtower=tower;

    // Firing-height rails deliberately don't form one intact continuous plane.
    catalog.fortifiedLowRail=[
      part('rail-left-post',-.80,.52,0,.16,1.04,.17,WOOD,'box',{rz:7,topScaleX:.79}),
      part('rail-right-post',.77,.56,.01,.17,1.13,.17,DARK_WOOD,'box',{rz:-5,topScaleX:.84}),
      part('rail-bottom-salvage',-.37,.38,-.02,1.14,.23,.17,WOOD,'box',{rz:-4,topScaleX:.86}),
      part('rail-bottom-splinter',.48,.35,-.03,.65,.16,.17,DARK_WOOD,'box',{rz:9,topScaleX:.53}),
      part('rail-upper-short',-.41,.79,.02,1.12,.17,.16,DARK_WOOD,'box',{rz:6,topScaleX:.72}),
      part('rail-upper-jagged',.55,.73,-.025,.56,.15,.14,SCARRED_WOOD,'box',{rz:-12,topScaleX:.55}),
      part('repair-cross-scrap',-.05,.57,.16,.14,.84,.15,WOOD,'box',{rz:-33,topScaleX:.62}),
      part('repair-metal-binding',-.76,.73,-.12,.20,.13,.08,METAL,'box',{rz:7}),
    ];

    catalog.fortifiedHighCover=[
      part('cover-left-post',-.81,.88,0,.18,1.76,.20,WOOD,'box',{rz:5,topScaleX:.73}),
      part('cover-right-battered-post',.78,.76,0,.19,1.52,.21,DARK_WOOD,'box',{rz:-8,topScaleX:.65}),
      part('cover-low-plank',-.11,.34,-.025,1.77,.39,.19,WOOD,'box',{rz:-3,topScaleX:.96}),
      part('cover-middle-board',-.05,.80,.035,1.85,.39,.20,DARK_WOOD,'box',{rz:5,topScaleX:.90}),
      part('cover-upper-left',-.41,1.22,.015,1.12,.36,.19,WOOD,'box',{rz:-6,topScaleX:.72}),
      part('cover-upper-right-fragment',.53,1.38,-.025,.75,.24,.17,SCARRED_WOOD,'box',{rz:14,topScaleX:.56}),
      part('cover-top-shattered-stump',-.57,1.61,.025,.52,.17,.18,WOOD,'box',{rz:17,topScaleX:.42}),
      part('repair-diagonal-scrap',.27,.92,.17,.15,1.53,.14,WOOD,'box',{rz:31,topScaleX:.83}),
      part('repair-top-patch',.18,1.48,.22,.66,.15,.13,DARK_WOOD,'box',{rz:-18,topScaleX:.67}),
      part('repair-metal-bracket',-.77,1.10,-.12,.26,.25,.09,METAL,'box',{rz:-12,topScaleX:.77}),
    ];

    catalog.fortifiedCaveArch=[
      part('arch-stone-left-base',-.91,.55,.055,.58,1.10,.72,STONE,'box',{rz:3,topScaleX:.89}),
      part('arch-stone-left-chipped',-.91,1.60,.055,.51,1.02,.65,STONE,'box',{rz:-5,topScaleZ:.90}),
      part('arch-stone-right-base',.92,.52,.065,.59,1.04,.75,STONE,'box',{rz:-4,topScaleX:.86}),
      part('arch-stone-right-upper',.90,1.57,.06,.52,1.06,.66,STONE,'box',{rz:6,topScaleZ:.88}),
      part('arch-stone-lintel-left',-.59,2.19,.04,1.15,.46,.74,STONE,'box',{rz:5,topScaleX:.91}),
      part('arch-stone-lintel-right',.60,2.20,.035,1.16,.40,.70,STONE,'box',{rz:-6,topScaleX:.85}),
      part('arch-wood-side-left',-.63,.88,-.26,.17,1.75,.18,DARK_WOOD,'box',{rz:-8,topScaleX:.67}),
      part('arch-wood-side-right',.66,.84,-.25,.16,1.69,.17,WOOD,'box',{rz:7,topScaleX:.84}),
      part('arch-wood-repair-lintel',.01,1.75,-.25,1.56,.14,.16,WOOD,'box',{rz:-6,topScaleX:.86}),
      part('arch-wood-repair-scrap',-.53,1.32,-.40,.14,.83,.14,SCARRED_WOOD,'box',{rz:36}),
      part('arch-metal-corner-binding',.63,1.61,-.37,.25,.13,.09,METAL,'box',{rz:12}),
    ]; // No black portal plane; the existing cave transition still renders its own opening.

    catalog.fortifiedWolfStake=[
      part('stake-wood-post',-.02,.49,0,.17,.98,.18,WOOD,'box',{rz:-7,topScaleX:.58,topScaleZ:.66}),
      part('stake-ground-base',0,.09,0,.35,.16,.37,DARK_WOOD,'box',{ry:16,topScaleX:.78}),
      part('stake-chain-ring',-.03,.74,0,.30,.08,.31,METAL,'hoop'),
      part('stake-repair-splinter',.10,.32,-.07,.08,.36,.08,DARK_WOOD,'box',{rz:15,topScaleX:.54}),
    ]; // The original chain remains a stretched PNG between this stake and its real wolf.
    return true;
  }

  function distressFurnitureGroup(group, seed) {
    if (!group?.children || !String(seed||'')) return group;
    for (const mesh of group.children) {
      if (!/^(?:repair-|roof-patch-|deck-repair-|patch-|rail-upper-jagged|cover-upper-right-fragment)/.test(mesh.name||'')) continue;
      const mark=hash(String(seed)+':damage:'+mesh.name); // Stable per campsite/slot and cave re-entry; consumes no gameplay RNG.
      const offset = (mark%101)/100-.5; // Very small hand-placement variation only on non-loadbearing repair scraps.
      if (mesh.rotation) mesh.rotation.z += offset*.13;
      if (mesh.position) { mesh.position.y += offset*.045; mesh.position.x += offset*.055; }
      if (/^roof-patch-/.test(mesh.name||'') && mark%13===0) mesh.visible=false; // Some tower roofs lost a further board.
    }
    return group;
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

  function chargeLaneForMap(mapData) {
    const floor=(mapData?.floor||[]).filter(tile=>Array.isArray(tile)&&tile.length>=2)
      .map(([col,row])=>({col:Number(col),row:Number(row)}))
      .filter(tile=>Number.isFinite(tile.col)&&Number.isFinite(tile.row));
    const entry={col:Number(mapData?.exitCol)||0,row:Number(mapData?.exitRow)||0};
    if(floor.length<12)return null; // Do not invent a lane in tiny/generated single-puzzle rooms.
    let goal=floor[0], length=0;
    for(const tile of floor) {
      const distance=Math.hypot(tile.col-entry.col,tile.row-entry.row);
      if(distance>length){length=distance;goal=tile;}
    } // One linear scan, not a full sort every time a cave scene mounts.
    if(length<7)return null;
    const axis={x:(goal.col-entry.col)/length,z:(goal.row-entry.row)/length};
    const lateral={x:-axis.z,z:axis.x}; // Opposite-facing cover flanks a shared, unobstructed center line.
    const used=new Set(),placements=[];
    const alongs=[4.5,7.5,10.5].filter(value=>value<length-1);
    for(const [i,along] of alongs.entries())for(const side of [-1,1]){
      const x=entry.col+axis.x*along+lateral.x*side*2.55;
      const z=entry.row+axis.z*along+lateral.z*side*2.55;
      let tile=null, nearest=1.4; // Six short O(N) floor scans instead of sorting all cave tiles 6 times.
      for(const candidate of floor){
        const distance=Math.hypot(candidate.col-x,candidate.row-z);
        if(distance>=nearest||used.has(candidate.col+','+candidate.row))continue;
        const relX=candidate.col-entry.col,relZ=candidate.row-entry.row;
        const across=Math.abs(relX*lateral.x+relZ*lateral.z);
        if(across<1.7||placements.some(p=>Math.hypot(p.col-candidate.col,p.row-candidate.row)<2.1))continue;
        nearest=distance;tile=candidate;
      }
      if(!tile)continue;
      used.add(tile.col+','+tile.row);
      placements.push({col:tile.col,row:tile.row,side,along,
        key:i%2===0?'fortifiedLowRail':'fortifiedHighCover',
        rotY:Math.atan2(axis.z,axis.x)*180/Math.PI}); // Native furniture rotation; no independent cover geometry.
    }
    return {entry,goal,axis,lateral,length,placements};
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
    const lane=chargeLaneForMap(mapData); // Reuse the logical cave-floor planner; no separate lane geometry or extra frame update.
    const selected = []; // Only positions safely offset from the charge lane become physical cover blockers.
    for (const tile of lane?.placements || []) {
      selected.push(tile);
      const key = tile.key;
      const piece = distressFurnitureGroup(window.ProceduralFurniture.buildFurnitureGroup(key), mapId+':'+selected.length);
      piece.position.set(tile.col+.5, Number(mapData.floorSurfaceY)||0, tile.row+.5);
      piece.rotation.y = (Number(tile.rotY)||0) * Math.PI/180;
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
    interiorScenes.set(mapId, { scene, group, chargeLane:lane });
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
    barrelScenesByMapId.set(String(mapId),scene); // Treasury also uses the same physical barrel owner without adding furniture cover.
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
        if (!recipe || barrelScenesByMapId.get(String(mapId)) !== scene || !stronghold.fortifiedBarrelStatus?.(mapId,id)?.available)
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
    barrelScenesByMapId.delete(String(mapId)); // Async barrel loads cannot repopulate a retired or restored cave scene.
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
      chargeLaneLayouts:[...interiorScenes].map(([mapId,record])=>({
        mapId,coverPieces:record.group.children.length,laneLength:record.chargeLane?.length||0,
        chargedCenterClearance:1.7,
      })),
      cover:window.BanditStrongholdCover?.debugSnapshot?.()||null,
      wolves:window.BanditStrongholdWolves?.debugSnapshot?.()||null,
      throws:window.BanditStrongholdCombat?.debugSnapshot?.()||null,
      boss:window.BanditStrongholdBoss?.debugSnapshot?.()||null, style: 'authored boards.png wood and carved_smooth.png stone via ProceduralFurniture' };
  }

  window.BanditStrongholds = Object.freeze({
    shouldFortify, replacementFraction, registerRecipes, distressFurnitureGroup, upgradeCamp, removeCamp,
    buildInteriorProps, chargeLaneForMap, ensureBarrels, forgetInterior, debugSnapshot, installItemRegistration, BARREL_LOOT, __test: Object.freeze({ hash, siteProps }),
  });
  registerRecipes();
  installItemRegistration();
})();