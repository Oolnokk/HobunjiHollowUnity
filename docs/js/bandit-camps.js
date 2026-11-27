(() => {
  'use strict';

  // Bandit camps — temporary-locale zone adapter, props, lifecycle,
  // companion perception, tent interaction, and corpse loot.
  let deps = null;
  const BANDIT_TENT_PIECE_URL = 'config/pieces/bandit-tent.json'; // Authored Researcher-style House Editor piece used by every bandit-camp tent.
  let _banditTentPiece = null; // Cached authored tent piece consumed by buildBanditTentMesh().
  let _banditTentPiecePromise = null; // Shared in-flight fetch so repeated camp setup never duplicates the piece request.

  function _loadBanditTentPiece() {
    if (_banditTentPiece) return Promise.resolve(_banditTentPiece);
    if (_banditTentPiecePromise) return _banditTentPiecePromise;
    _banditTentPiecePromise = fetch(BANDIT_TENT_PIECE_URL)
      .then(response => {
        if (!response.ok) throw new Error(`bandit tent HTTP ${response.status}`);
        return response.json();
      })
      .then(piece => {
        _banditTentPiece = piece;
        return piece;
      })
      .catch(error => {
        _banditTentPiecePromise = null;
        deps?.debugLog?.(`Bandits: authored tent failed to load (${error.message}).`, 'warn');
        return null;
      });
    return _banditTentPiecePromise;
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    Promise.all([window.AuthoredFurniture?.load?.('crateStack'),window.AuthoredFurniture?.load?.('looseCrate')]).then(() => {
      for (const zoneId of _banditCampInstances.keys()) ensureBanditCampMeshes(zoneId);
    });
    _loadBanditTentPiece().then(piece => {
      if (!piece) return;
      for (const zoneId of _banditCampInstances.keys()) ensureBanditCampMeshes(zoneId);
    });
  }

  const _BANDIT_CLEARABLE_TYPES = new Set(['shrub']);
  const _banditZoneViews = new Map();

  function _banditZoneView(zoneId) {
    if (_banditZoneViews.has(zoneId)) return _banditZoneViews.get(zoneId);
    const layout = deps.zoneLayouts.get(zoneId);
    if (!layout?.cols || !layout?.rows) return null;
    const cols = layout.cols, rows = layout.rows;
    const tiles = Array.from({ length: rows }, () => new Array(cols).fill(null));
    const objects = [];
    const srcByKey = new Map();
    for (const t of (layout.tiles || [])) {
      if (!(t.r >= 0 && t.r < rows && t.c >= 0 && t.c < cols)) continue;
      const view = {
        height: t.elevTier || 0,
        water: deps.WATERWAY_TYPES.has(t.type),
        path: t.type === deps.TileType.PATH,
        ramp: t.type === deps.TileType.RAMP || !!t.incline,
        waterfall: t.type === deps.TileType.WATERFALL,
        terrain: t.type,
        occupiedBy: null,
        borderEscarpment: !!t.mapBoundary, // Camps never stamp onto map-boundary escarpments (js/map-boundary-guard.js).
      };
      tiles[t.r][t.c] = view;
      srcByKey.set(`${t.c},${t.r}`, t);
      if (t.type === deps.TileType.SHRUB) {
        const id = `zclutter_${t.c}_${t.r}`; // Only flora is safely removable without rewriting a rock formation's full collider.
        objects.push({
          id, type: 'shrub', x: t.c, y: t.r, w: 1, h: 1,
          srcType: t.type, floraKind: t.floraKind || null,
        });
        view.occupiedBy = id;
      } else if (t.type === deps.TileType.ROCK) {
        const id = `zsolidrock_${t.c}_${t.r}`; // Includes undiggable boulders, ore rocks, and natural cliff faces; no camp may leave an orphaned rock.
        objects.push({ id, type: 'unique', x: t.c, y: t.r, w: 1, h: 1, localeMeta: true });
        view.occupiedBy = id;
      }
    }
    let uniqueSeq = 0;
    const blockRect = (col, row, w, h) => {
      if (!Number.isFinite(col) || !Number.isFinite(row)) return;
      const id = `zunique_${uniqueSeq++}`;
      objects.push({ id, type: 'unique', x: col, y: row, w: w || 1, h: h || 1, localeMeta: true });
      for (let r = row; r < row + (h || 1); r++) {
        for (let cc = col; cc < col + (w || 1); cc++) if (tiles[r]?.[cc]) tiles[r][cc].occupiedBy = id;
      }
    };
    for (const b of (layout.buildings || [])) blockRect(b.gridX || 0, b.gridZ || 0, b.footprintW ?? b.w ?? 1, b.footprintD ?? b.h ?? 1);
    for (const d of (layout.dens || [])) blockRect(d.x, d.y, d.w || 1, d.h || 1);
    for (const d of (layout.decor || [])) blockRect(d.col, d.row, 1, 1);
    for (const f of (layout.furniture || [])) blockRect(f.col, f.row, 1, 1);
    for (const tr of (layout.transitions || [])) blockRect(tr.col, tr.row, 1, 1);
    for (const t of (layout.rootTotems || [])) blockRect(t.x ?? t.col, t.y ?? t.row, t.w || 1, t.h || 1);
    for (const inst of (layout.localeInstances || [])) {
      const boxes = window.WildernessObjectFootprints?.localePlacementBoxes?.(inst) || (inst.objects || []); // Reserve painted locale ground, not merely the furnished interior.
      for (const box of boxes) blockRect(box.x, box.y, box.w || 1, box.h || 1);
    }
    const zdef = deps.EXTERIOR_ZONES[zoneId];
    const entry = layout.toTownExit
      ? { x: layout.toTownExit.col, y: layout.toTownExit.row }
      : (Number.isFinite(zdef?.entryCol) ? { x: zdef.entryCol, y: zdef.entryRow } : null);
    const view = { cols, rows, tiles, objects, entry, _srcByKey: srcByKey, sourceLayout: layout }; // Shared scenery/camp reservation ownership uses the original wilderness layout, not this synthetic tile view.
    _banditZoneViews.set(zoneId, view);
    return view;
  }

  function _syncBanditFlora(zoneId, snapshots, restore) {
    const view = _banditZoneViews.get(zoneId);
    const zi = deps.zoneScenes.get(zoneId);
    let changed = 0;
    for (const snap of (snapshots || [])) {
      if (snap.type !== 'shrub') continue;
      const nextType = restore ? (snap.srcType || deps.TileType.SHRUB) : deps.TileType.GRASS;
      const src = view?._srcByKey.get(`${snap.x},${snap.y}`);
      if (src) {
        src.type = nextType;
        if (restore) src.floraKind = snap.floraKind || null;
      }
      const gridTile = zi?.grid?.[snap.y]?.[snap.x];
      if (gridTile) {
        gridTile.type = nextType;
        if (restore) gridTile.floraKind = snap.floraKind || null;
      }
      changed++;
    }
    if (changed && zi) deps.refreshZoneGroundVisuals(zoneId);
    return changed;
  }

  // ── Tent props ────────────────────────────────────────────────────

  let _banditCanvasTexture = null;
    const _banditFireEffects = new Set();
    const BANDIT_TENT_BURN_S = 8;
  
    function banditCanvasTexture() {
      if (_banditCanvasTexture) return _banditCanvasTexture;
      _banditCanvasTexture = new THREE.TextureLoader().load(
        'assets/textures/canvas.png',
        tex => {
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.needsUpdate = true;
        },
        undefined,
        () => deps?.debugLog?.('Bandits: canvas.png failed to load; tents are using the canvas-color fallback.', 'warn'),
      );
      _banditCanvasTexture.wrapS = _banditCanvasTexture.wrapT = THREE.ClampToEdgeWrapping;
      if ('colorSpace' in _banditCanvasTexture && THREE.SRGBColorSpace) _banditCanvasTexture.colorSpace = THREE.SRGBColorSpace;
      return _banditCanvasTexture;
    }
  
    function buildBanditFireEffect(scale = 1) {
      const group = new THREE.Group();
      const flames = [];
      const colors = [0xff5a16, 0xff9d20, 0xffdf66];
      for (let i = 0; i < 7; i++) {
        const height = 0.34 + (i % 3) * 0.12;
        const material = new THREE.MeshBasicMaterial({
          color: colors[i % colors.length],
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11 + (i % 2) * 0.035, height, 5), material);
        const angle = i * 2.399963229728653;
        const radius = 0.05 + (i % 3) * 0.055;
        flame.position.set(Math.cos(angle) * radius, height * 0.5, Math.sin(angle) * radius);
        flame.userData.banditFlame = {
          phase: i * 1.73,
          baseY: flame.position.y,
          baseScale: 0.82 + (i % 4) * 0.09,
        };
        flames.push(flame);
        group.add(flame);
      }
      group.scale.setScalar(scale);
      group.userData.banditFireEffect = { flames, elapsed: deps?.rnd?.() * 10 || 0 };
      _banditFireEffects.add(group);
      return group;
    }
  
    function updateBanditFireEffects(dt) {
      for (const effect of [..._banditFireEffects]) {
        if (!effect.parent) { _banditFireEffects.delete(effect); continue; }
        const state = effect.userData.banditFireEffect;
        state.elapsed += dt;
        for (const flame of state.flames) {
          const f = flame.userData.banditFlame;
          const wave = Math.sin(state.elapsed * 10.5 + f.phase);
          flame.scale.set(
            f.baseScale * (1 + wave * 0.18),
            f.baseScale * (1 - wave * 0.12),
            f.baseScale * (1 + wave * 0.10),
          );
          flame.position.y = f.baseY + Math.sin(state.elapsed * 7.2 + f.phase) * 0.035;
          flame.rotation.y += dt * (1.5 + (f.phase % 1));
          flame.material.opacity = 0.62 + Math.sin(state.elapsed * 13 + f.phase) * 0.13;
        }
      }
    }
  
    
  function buildBanditTentMesh(obj, elevationY, burning = false) {
    if (!_banditTentPiece || !obj || !window.HousePieceGen?.buildGroupFromPiece) return null;
    const centerCol = obj.x + (obj.w || 1) * 0.5; // Used to keep authored House Editor transforms aligned while the runtime wrapper stays interaction-centered.
    const centerRow = obj.y + (obj.h || 1) * 0.5; // Used with centerCol for tent effects, outline, and prop positioning.
    const authored = window.HousePieceGen.buildGroupFromPiece(THREE, _banditTentPiece, obj.x, obj.y, {
      elevationY,
      rotationDeg: obj.rot || 0,
      matCanvas: new THREE.MeshLambertMaterial({ color: 0xc8b58b, map: banditCanvasTexture(), side: THREE.DoubleSide }),
      matDoorOpening: new THREE.MeshBasicMaterial({ color: 0x1a1410, side: THREE.DoubleSide }),
    });
    authored.position.set(-centerCol, -elevationY, -centerRow);
    const group = new THREE.Group();
    authored.userData.banditTentAimSurface = true; // Only the authored canvas/door surfaces count for loot/burn aim; flames and outlines do not.
    group.add(authored);
    group.userData.projectileCoverHeightTiles = 1.7;
    group.userData.projectileCoverRadiusTiles = 1.5;
    group.userData.projectileCoverKind = 'bandit-tent';
    group.userData.banditTent = true;
    if (burning) group.add(buildBanditFireEffect(3.4));
    return group;
  }

  function buildBanditCampfireMesh() {
    const group = window.ProceduralFurniture?.buildFurnitureGroup?.('campfire', 0x6b4a28) || new THREE.Group();
    group.userData.fireHazard = true; // This camp-owned fire may use a procedural or unloaded furniture visual.
    group.add(buildBanditFireEffect(1.15));
    return group;
  }

  const _banditCampMeshes = new Map();

  function banditTentCenterPx(obj) {
    return { x: (obj.x + (obj.w || 1) / 2) * deps.TILE, y: (obj.y + (obj.h || 1) / 2) * deps.TILE };
  }

  // Stamp a non-rendering tile marker as the cheap runtime collision mask for
  // a standing tent. game.js's tileSpeedAt reads this marker directly; using
  // TileType.ROCK here also made the terrain renderer grow one rock mound on
  // every footprint tile.
  function _applyBanditTentGridCollision(zoneId, obj) {
    const zi = deps.zoneScenes.get(zoneId);
    if (!zi?.grid || !obj) return [];
    const snapshots = [];
    for (let r = obj.y; r < obj.y + (obj.h || 1); r++) {
      for (let c = obj.x; c < obj.x + (obj.w || 1); c++) {
        const tile = zi.grid?.[r]?.[c];
        if (!tile || (tile._banditTentCollisionId && tile._banditTentCollisionId !== obj.id)) continue;
        if (tile._banditTentCollisionId === obj.id) continue;
        snapshots.push({ c, r });
        tile._banditTentCollisionId = obj.id;
      }
    }
    return snapshots;
  }

  function _restoreBanditTentGridCollision(zoneId, entry) {
    const zi = deps.zoneScenes.get(zoneId);
    if (!zi?.grid || !entry?.collisionTiles?.length) return;
    for (const snap of entry.collisionTiles) {
      const tile = zi.grid?.[snap.r]?.[snap.c];
      if (!tile || tile._banditTentCollisionId !== entry.propId) continue;
      delete tile._banditTentCollisionId;
    }
  }

  function _banditZoneTents(zoneId) {
    const out = [];
    for (const rec of (_banditCampInstances.get(zoneId) || [])) {
      for (const prop of rec.props) if (prop.type === 'tent') out.push(prop);
    }
    return out;
  }

  function _disposeBanditProp(zoneId, entry) {
    _restoreBanditTentGridCollision(zoneId, entry);
    if(entry.propId)window.CratePiles?.unregisterPile?.(zoneId,entry.propId);
    const zScene = deps.zoneScenes.get(zoneId)?.scene;
    if (zScene) {
      zScene.remove(entry.mesh);
      if (entry.light) zScene.remove(entry.light);
    }
    entry.mesh.traverse?.(o => { if (o.userData?.banditFireEffect) _banditFireEffects.delete(o); if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
    if (entry.sfxSource) window.Music?.unregisterFurnitureSfxSource(entry.sfxSource);
    window.NearbyVolumeCollision?.invalidate?.();
  }

  function ensureBanditCampMeshes(zoneId) {
    const zi = deps?.zoneScenes?.get?.(zoneId); // The async authored-crate/tent load may finish before a zone scene is registered.
    if (!zi) return;
    let meshes = _banditCampMeshes.get(zoneId);
    if (!meshes) { meshes = new Map(); _banditCampMeshes.set(zoneId, meshes); }
    const live = new Set();
    for (const rec of (_banditCampInstances.get(zoneId) || [])) {
      for (const obj of rec.props) {
        if (obj.destroyed) continue;
        live.add(obj.id);
        const existing = meshes.get(obj.id);
        if (existing && existing.mesh.parent === zi.scene) continue;
        if (existing) { _disposeBanditProp(zoneId, existing); meshes.delete(obj.id); }
        const gridTile = zi.grid?.[obj.y]?.[obj.x];
        const y = gridTile ? deps.tileSurfaceYInArea(gridTile, zoneId) : deps.NORMAL_TOP;
        if (obj.type === 'tent') {
          const mesh = buildBanditTentMesh(obj, y, !!obj.burning);
          if (!mesh) continue;
          const center = banditTentCenterPx(obj);
          mesh.position.set(center.x / deps.TILE, y, center.y / deps.TILE);
          deps.markOutline(mesh);
          zi.scene.add(mesh);
          const collisionTiles = _applyBanditTentGridCollision(zoneId, obj); // Stored on this prop entry so burn/re-roll restores the exact prior tile data.
          meshes.set(obj.id, { mesh, light: null, sfxSource: null, collisionTiles, propId: obj.id });
          window.NearbyVolumeCollision?.invalidate?.();
        } else if (obj.key === 'campfire' && window.ProceduralFurniture) {
          const mesh = buildBanditCampfireMesh();
          const center = banditTentCenterPx(obj);
          mesh.position.set(center.x / deps.TILE, y, center.y / deps.TILE);
          deps.markOutline(mesh);
          zi.scene.add(mesh);
          const light = new THREE.PointLight(0xff7722, 1.4, 3.5);
          light.position.set(center.x / deps.TILE, y + 0.45, center.y / deps.TILE);
          light.userData.furnitureLightMask = true;
          window.FurnitureLightRegistry?.register(light);
          zi.scene.add(light);
          const sfxDef = window.Music?.resolveFurnitureSfx?.({ sfxKey: 'fireplace' });
          const sfxSource = window.Music?.registerFurnitureSfxSource?.(zoneId, center.x / deps.TILE, center.y / deps.TILE, sfxDef);
          meshes.set(obj.id, { mesh, light, sfxSource, collisionTiles: [], propId: obj.id });
        } else if (obj.key === 'crateStack') {
          // Do not create a non-interactive placeholder while the authored recipe loads.
          // init() invokes ensureBanditCampMeshes again after that promise resolves.
          const recipe=window.AuthoredFurniture?.peek?.('crateStack');
          if(!recipe)continue;
          const mesh=window.AuthoredFurniture.buildGroup(recipe);
          mesh.position.set(obj.x+.5,y,obj.y+.5);
          deps.markOutline(mesh);zi.scene.add(mesh);
          meshes.set(obj.id,{mesh,light:null,sfxSource:null,collisionTiles:[],propId:obj.id});
          window.CratePiles?.registerPile?.({id:obj.id,mapId:zoneId,scene:zi.scene,group:mesh,
            count:obj.crateCount??3,lootable:true,onChange:count=>{obj.crateCount=count;}});
        } else if (obj.key && window.ProceduralFurniture) {
          const result = deps.makeDecorativeFurnitureMesh(obj.x, obj.y, obj.key, zi.scene, zoneId);
          if (!result) continue;
          result.mesh.position.y += y;
          if (result.light) result.light.position.y += y;
          meshes.set(obj.id, result);
        }
      }
    }
    for (const [id, entry] of [...meshes]) {
      if (live.has(id)) continue;
      _disposeBanditProp(zoneId, entry);
      meshes.delete(id);
    }
  }

  function senseTargets(scene) {
    if (!scene || !deps?.getCurrentArea) return [];
    const zoneId = deps.getCurrentArea(); // Limits collection to the active camp registry, never cached off-zone props.
    const meshes = _banditCampMeshes.get(zoneId); // Existing prop mesh owners; no scene-wide traversal or duplicate geometry.
    if (!meshes) return [];
    const roots = []; // Living camp tents and fires that Perception can tint as a recognizable landmark.
    for (const record of _banditCampInstances.get(zoneId) || []) {
      const site = record.instance?.site; // Exact temporary-locale camp footprint; every tent shares its center for the 24-tile visibility boundary.
      const anchor = site && Number.isFinite(Number(site.x)) && Number.isFinite(Number(site.y))
        ? { x: Number(site.x) + (Number(site.w) || 1) / 2, z: Number(site.y) + (Number(site.h) || 1) / 2 } : null;
      for (const prop of record.props || []) {
        if (prop.destroyed || (prop.type !== 'tent' && prop.key !== 'campfire')) continue;
        const root = meshes.get(prop.id)?.mesh;
        if (root?.parent === scene && root.visible !== false) roots.push(anchor ? { root, anchor } : root);
      }
    }
    return roots;
  }

  function removeBanditCampProp(zoneId, propId) {
    const meshes = _banditCampMeshes.get(zoneId);
    const entry = meshes?.get(propId);
    if (!entry) return;
    _disposeBanditProp(zoneId, entry);
    meshes.delete(propId);
  }

  // ── Camp lifecycle ────────────────────────────────────────────────

  const _banditCampInstances = new Map();
  const _banditZoneEntryPending = new Set();
  const _banditZoneWorkInFlight = new Set();

  function _campDiscoveryKey(zoneId, slot) { return `camp:${zoneId}:slot:${slot}`; }

  function _nextCampDiscoverySlot(tracked) {
    const used = new Set((tracked || []).map(rec => rec.discoverySlot).filter(Number.isInteger));
    let slot = 0;
    while (used.has(slot)) slot++;
    return slot;
  }

  function _reconcileRememberedCamps(zoneId) {
    const active = (_banditCampInstances.get(zoneId) || [])
      .filter(rec => !isBanditCampCleared(rec))
      .map(rec => ({
        discoveryKey: rec.discoveryKey,
        kind: 'camp', zoneId, label: 'Bandit Camp',
        col: rec.instance.site.x + rec.instance.site.w / 2,
        row: rec.instance.site.y + rec.instance.site.h / 2,
      }));
    window.WildernessMap?.reconcileDiscoveredCamps?.(zoneId, active);
  }

  function banditTierForSite(cfg, view, site) {
    const per = Number(cfg?.difficultyTiers?.tierDistanceTiles || 12);
    const maxTier = Number(cfg?.difficultyTiers?.maxTier ?? 7);
    if (!view?.entry || !(per > 0)) return 0;
    const cx = site.x + site.w / 2, cy = site.y + site.h / 2;
    const dist = Math.hypot(cx - view.entry.x, cy - view.entry.y);
    return deps.clamp(Math.floor(dist / per), 0, maxTier);
  }

  function isBanditCampCleared(rec) {
    const view = _banditZoneViews.get(rec.zoneId);
    if (!view) return false;
    if (window.TemporaryLocales.livingTents(view, rec.instance).length) return false;
    for (const c of deps.hostileObjects) {
      if (c.banditCampInstanceId === rec.instance.id && c.health > 0) return false;
    }
    return true;
  }

  const BANDIT_CAMP_BANNER_RADIUS_TILES = 10;
  const BANDIT_CAMP_BANNER_CHECK_INTERVAL_S = 0.5;
  let _banditCampBannerAccum = 0;
  const _banditCampBannerInside = new Map();
  function updateBanditCampBanners(dt) {
    _banditCampBannerAccum += dt;
    if (_banditCampBannerAccum < BANDIT_CAMP_BANNER_CHECK_INTERVAL_S) return;
    _banditCampBannerAccum = 0;
    if (!deps.isZoneArea(deps.getCurrentArea())) return;
    const live = new Set();
    for (const rec of (_banditCampInstances.get(deps.getCurrentArea()) || [])) {
      if (isBanditCampCleared(rec)) {
        window.WildernessMap?.forgetDiscoveredThreat?.(rec.discoveryKey);
        continue;
      }
      live.add(rec.instance.id);
      const col = rec.instance.site.x + rec.instance.site.w / 2;
      const row = rec.instance.site.y + rec.instance.site.h / 2;
      const distTiles = Math.hypot(col - deps.player.x / deps.TILE, row - deps.player.y / deps.TILE);
      const inside = distTiles <= BANDIT_CAMP_BANNER_RADIUS_TILES;
      if (inside && !_banditCampBannerInside.get(rec.instance.id)) {
        deps.showZoneBanner(rec.captainName ? `${rec.captainName}'s Bandit Camp` : 'Bandit Camp');
      }
      _banditCampBannerInside.set(rec.instance.id, inside);
    }
    for (const id of _banditCampBannerInside.keys()) {
      if (!live.has(id)) _banditCampBannerInside.delete(id);
    }
  }

  const PERCEPTION_CHECK_INTERVAL_S = 0.6;
  let _perceptionCheckAccum = 0;
  const DEFAULT_PERCEPTION_TILES = 6;
  const PERCEPTION_TILES_MULTIPLIER = 4;
  const _perceivedThreats = new Map();

  function forgetDenPerception(denKey) {
    if (!denKey) return false;
    const key = 'den:' + denKey; // Same discovery key updateCompanionPerception uses when a companion first marks this den.
    const removed = _perceivedThreats.delete(key);
    window.WildernessMap?.forgetDiscoveredThreat?.(key); // Also clears any saved waypoint that still points at the den's old physical site.
    return removed;
  }

  function _companionPerceptionRangePx(c) {
    return (c.def?.perceptionTiles ?? DEFAULT_PERCEPTION_TILES) * PERCEPTION_TILES_MULTIPLIER * deps.TILE;
  }

  function updateCompanionPerception(dt) {
    _perceptionCheckAccum += dt;
    if (_perceptionCheckAccum < PERCEPTION_CHECK_INTERVAL_S) return;
    _perceptionCheckAccum = 0;

    for (const [key, info] of _perceivedThreats) {
      if (info.kind === 'camp') {
        const rec = (_banditCampInstances.get(info.zoneId) || []).find(r => r.instance.id === info.instanceId);
        if (!rec || isBanditCampCleared(rec)) {
          _perceivedThreats.delete(key);
          window.WildernessMap?.forgetDiscoveredThreat?.(info.discoveryKey || key);
        }
      } else if (info.kind === 'den') {
        if (!deps.isDenPackAlive(info.denKey)) {
          _perceivedThreats.delete(key);
        }
      }
    }

    if (!deps.isZoneArea(deps.getCurrentArea())) return;
    const layout = deps.zoneLayouts.get(deps.getCurrentArea());
    for (const c of deps.companionObjects) {
      if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
      if ((c.master || deps.player) !== deps.player) continue;
      const rangePx = _companionPerceptionRangePx(c);
      const label = c.name || c.def?.label || 'Your companion';

      for (const den of (layout?.dens || [])) {
        const denKey = deps.denKeyFor(deps.getCurrentArea(), den);
        const key = 'den:' + denKey;
        if (_perceivedThreats.has(key) || !deps.isDenPackAlive(denKey)) continue;
        const col = den.x + (den.w || 1) / 2, row = den.y + (den.h || 1) / 2;
        if (Math.hypot(col * deps.TILE - c.x, row * deps.TILE - c.y) > rangePx) continue;
        const info = { discoveryKey: key, kind: 'den', zoneId: deps.getCurrentArea(), denKey, col, row, label: 'Animal Den' };
        _perceivedThreats.set(key, info);
        window.WildernessMap?.rememberDiscoveredThreat?.(key, info);
        deps.requestCompanionDiscovery?.(c, 'animal-den');
        deps.showToast(`${label} senses an animal den nearby — marked on the map!`, false);
      }
    }
  }

  const ENCOUNTER_CHECK_INTERVAL_S = 5;
  const ENCOUNTER_CHANCE_PER_CHECK = 0.05;
  const ENCOUNTER_COOLDOWN_S = 100;
  const ENCOUNTER_MOVE_SPEED_MIN_PXS = 5;
  const ENCOUNTER_MIN_SPAWN_TILES = 4;
  const ENCOUNTER_MAX_SPAWN_TILES = 6;
  const ENCOUNTER_NEARBY_HOSTILE_TILES = 16;
  const ENCOUNTER_MAX_ACTIVE_S = 180;

  let _encounterCheckAccum = 0;
  let _encounterCooldownRemaining = 0;
  let _activeAmbush = null;

  function _ambushSourceCamp(zoneId) {
    const candidates = (_banditCampInstances.get(zoneId) || [])
      .filter(rec => !isBanditCampCleared(rec) && !_perceivedThreats.has('camp:' + rec.instance.id));
    if (!candidates.length) return null;
    return candidates[Math.floor(deps.rnd() * candidates.length)];
  }

  function _bestAlertCompanion() {
    for (const c of deps.companionObjects) {
      if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
      if ((c.master || deps.player) !== deps.player) continue;
      return c;
    }
    return null;
  }

  function revealCampFromTracking(rec, companion) {
    const key = 'camp:' + rec.instance.id;
    if (!rec || isBanditCampCleared(rec) || _perceivedThreats.has(key)) return false;
    const col = rec.instance.site.x + rec.instance.site.w / 2, row = rec.instance.site.y + rec.instance.site.h / 2;
    const info = { discoveryKey: rec.discoveryKey, kind: 'camp', zoneId: rec.zoneId, instanceId: rec.instance.id, col, row, label: 'Bandit Camp' };
    _perceivedThreats.set(key, info);
    window.WildernessMap?.rememberDiscoveredThreat?.(rec.discoveryKey, info);
    const label = companion?.name || companion?.def?.label || 'Your companion';
    deps.requestCompanionDiscovery?.(companion, 'bandit-camp-tracks');
    deps.showToast(`${label} found tracks leading to a bandit camp — marked on the map!`, false);
    return true;
  }

  async function _spawnAmbushBandit(rec, x, y) {
    const c = await spawnConfiguredBandit(rec, 'grunt', x, y, {
      zoneId: rec.zoneId,
      extra: { state: 'idle', isAmbushBandit: true },
    });
    if (!c) return null;
    deps.hostileObjects.add(c);
    return c;
  }

  async function _tryStartRoadAmbush(zoneId) {
    const rec = _ambushSourceCamp(zoneId);
    if (!rec) return;
    const angle = deps.rnd() * Math.PI * 2;
    const dist = deps.TILE * (ENCOUNTER_MIN_SPAWN_TILES + deps.rnd() * (ENCOUNTER_MAX_SPAWN_TILES - ENCOUNTER_MIN_SPAWN_TILES));
    const originX = deps.player.x + Math.cos(angle) * dist;
    const originY = deps.player.y + Math.sin(angle) * dist;
    const spacing = deps.TILE * 0.9;
    const sideAngle = angle + Math.PI / 2;
    const banditIds = new Set();
    for (const side of [-1, 1]) {
      const x = originX + Math.cos(sideAngle) * spacing * side * 0.5;
      const y = originY + Math.sin(sideAngle) * spacing * side * 0.5;
      const c = await _spawnAmbushBandit(rec, x, y);
      if (c) banditIds.add(c.id);
    }
    if (!banditIds.size) return;
    _activeAmbush = { campRec: rec, banditIds, elapsedS: 0 };
    deps.showToast('Bandits ambush you!', true);
    window.__farmLog?.('[bandits] road ambush: 2 grunts sprung near the player, tied to camp ' + rec.instance.id + '.', 'wildlife');
  }

  function _resolveAmbushVictory(ambush) {
    const rec = ambush.campRec;
    const companion = _bestAlertCompanion();
    if (!companion) return;
    revealCampFromTracking(rec, companion);
  }

  function updateRandomEncounters(dt) {
    const zoneId = deps.getCurrentArea();
    if (!deps.isZoneArea(zoneId)) { _encounterCheckAccum = 0; return; }

    if (_activeAmbush) {
      let anyAlive = false;
      for (const c of deps.hostileObjects) {
        if (_activeAmbush.banditIds.has(c.id) && c.health > 0) { anyAlive = true; break; }
      }
      _activeAmbush.elapsedS += dt;
      if (!anyAlive) _resolveAmbushVictory(_activeAmbush);
      if (!anyAlive || _activeAmbush.elapsedS >= ENCOUNTER_MAX_ACTIVE_S) {
        _activeAmbush = null;
        _encounterCooldownRemaining = ENCOUNTER_COOLDOWN_S;
      }
      return;
    }

    if (_encounterCooldownRemaining > 0) {
      _encounterCooldownRemaining -= dt;
      return;
    }

    if (window.TothalBlizzard?.isShelteringFor?.(zoneId)) {
      _encounterCheckAccum = 0; // Road ambushes must not start while every camp is sheltering; existing active fights still resolve normally.
      return;
    }

    if (Math.hypot(deps.player.vx || 0, deps.player.vy || 0) < ENCOUNTER_MOVE_SPEED_MIN_PXS) {
      _encounterCheckAccum = 0;
      return;
    }

    _encounterCheckAccum += dt;
    if (_encounterCheckAccum < ENCOUNTER_CHECK_INTERVAL_S) return;
    _encounterCheckAccum = 0;

    const nearbyHostileRangePx = deps.TILE * ENCOUNTER_NEARBY_HOSTILE_TILES;
    for (const c of deps.hostileObjects) {
      if (c.health <= 0) continue;
      if (Math.hypot(c.x - deps.player.x, c.y - deps.player.y) <= nearbyHostileRangePx) return;
    }

    if (deps.rnd() > ENCOUNTER_CHANCE_PER_CHECK) return;
    _tryStartRoadAmbush(zoneId);
  }

  const SIMPLE_HYDRA_DELAY_S = 5;
  const SIMPLE_HYDRA_DEFAULT_BURN_S = 8;
  const SIMPLE_HYDRA_REINFORCEMENT_RANKS = ['grunt', 'flasker', 'lieutenant'];

  function simpleHydraPoint(rec, exterior = false) {
    if (exterior) {
      const angle = deps.rnd() * Math.PI * 2;
      const distance = deps.TILE * (1.0 + deps.rnd() * 2.6);
      return {
        x: rec.homeX + Math.cos(angle) * distance,
        y: rec.homeY + Math.sin(angle) * distance,
      };
    }
    const tents = rec.props.filter(o => o.type === 'tent' && !o.destroyed);
    const tent = tents.length ? tents[Math.floor(deps.rnd() * tents.length)] : null;
    if (!tent) return { x: rec.homeX, y: rec.homeY };
    const center = banditTentCenterPx(tent);
    const angle = deps.rnd() * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * deps.TILE * 0.45,
      y: center.y + Math.sin(angle) * deps.TILE * 0.45,
    };
  }

  // Reinforcement ranks are drawn in proportion to what is left in the camp's reserve, so a
  // camp refills with the same mix it was staged with (a lone Flasker is not as likely as
  // the dozen grunts beside it).
  function simpleHydraRank(rec) {
    let total = 0;
    for (const rank of SIMPLE_HYDRA_REINFORCEMENT_RANKS) total += Math.max(0, rec.reserveByRank[rank] || 0);
    if (!(total > 0)) return null;
    let roll = deps.rnd() * total;
    for (const rank of SIMPLE_HYDRA_REINFORCEMENT_RANKS) {
      roll -= Math.max(0, rec.reserveByRank[rank] || 0);
      if (roll < 0) return rank;
    }
    return SIMPLE_HYDRA_REINFORCEMENT_RANKS.find(rank => (rec.reserveByRank[rank] || 0) > 0) || null;
  }

  // One Flasker per `regularBanditsPerFlasker` grunts (the plain "Bandit" rank).
  function flaskerCountForGrunts(comp, grunts) {
    const perFlasker = Math.max(1, Math.floor(Number(comp?.regularBanditsPerFlasker) || 4));
    return Math.floor(Math.max(0, grunts) / perFlasker);
  }

  function rollGruntVariant(rec, rank) {
    const variant = rec.cfg?.gruntVariants?.slagothimBeastmaster;
    if (rank !== 'grunt' || !variant) return null;
    const maxPerCamp = Math.max(0, Number(variant.maxPerCamp ?? 1));
    if ((rec.beastmastersSpawned || 0) >= maxPerCamp) return null;
    const chance = deps.clamp(Number(variant.chancePerGrunt) || 0, 0, 1);
    return deps.rnd() < chance ? variant : null;
  }

  async function spawnBeastmasterCompanion(rec, beastmaster, variant) {
    const creatureKey = String(variant?.companionCreatureKey || 'dabinggi-hound');
    const angle = deps.rnd() * Math.PI * 2;
    const distance = deps.TILE * 0.8;
    const spawnX = beastmaster.x + Math.cos(angle) * distance;
    const spawnY = beastmaster.y + Math.sin(angle) * distance;
    const genotypeKind = window.CreatureGenetics?.SPECIES_ALIAS?.[creatureKey] || creatureKey; // Resolves coat aliases for the standard genetics roll.
    const genotype = window.CreatureGenetics?.makeDefaultGenotype?.(genotypeKind) || null; // The factory uses this to paint the hound's coat, patterns, and eyes.
    const hound = deps.makeCreatureEntity(creatureKey, spawnX, spawnY, {
      genotype,
      scene: beastmaster.scene,
      grid: beastmaster.areaGrid,
      cols: beastmaster.areaCols,
      rows: beastmaster.areaRows,
      master: beastmaster,
      banditCompanion: true,
      banditCampInstanceId: rec.instance.id,
      homeX: rec.homeX,
      homeY: rec.homeY,
      state: 'idle',
    });
    if (!hound) {
      window.__farmLog?.(`[bandits] ${beastmaster.name || 'Beastmaster'} could not spawn companion "${creatureKey}".`, 'warn');
      return null;
    }

    const healthMultiplier = Math.max(0.05, Number(variant.companionHealthMultiplier) || 0.6);
    const staminaMultiplier = Math.max(0.05, Number(variant.companionStaminaMultiplier) || 0.7);
    const damageMultiplier = Math.max(0, Number(variant.companionDamageMultiplier) || 0.4);
    const cooldownMultiplier = Math.max(0.1, Number(variant.companionAttackCooldownMultiplier) || 1.35);
    const tunedDef = {
      ...hound.def,
      hostile: true,
      maxHealth: Math.max(1, Math.round(hound.def.maxHealth * healthMultiplier)),
      maxStamina: Math.max(1, Math.round(hound.def.maxStamina * staminaMultiplier)),
      attackDamage: Math.max(1, Math.round(hound.def.attackDamage * damageMultiplier)),
      attackCooldownS: hound.def.attackCooldownS * cooldownMultiplier,
    };
    hound.def = tunedDef;
    hound.health = hound.maxHealth = tunedDef.maxHealth;
    hound.stamina = hound.maxStamina = tunedDef.maxStamina;
    hound.name = `${beastmaster.name || 'Beastmaster'}'s ${tunedDef.label}`;
    beastmaster.banditCompanionId = hound.id;
    deps.hostileObjects.add(hound);
    deps.companionObjects.add(hound);
    rec.gangIds.add(hound.id);
    window.__farmLog?.(
      `[bandits] Slagothim Beastmaster spawned ${creatureKey} companion ${hound.id} (${hound.maxHealth} HP, ${tunedDef.attackDamage} damage; coat ${hound.genotype?.base?.color || 'missing'}).`,
      'wildlife',
    );
    return hound;
  }

  async function spawnConfiguredBandit(rec, rank, x, y, options = {}) {
    const variant = rollGruntVariant(rec, rank);
    const variantSpecies = variant?.speciesWeights || (variant?.speciesId ? { [variant.speciesId]: 1 } : null); // Beastmaster subspecies use the same 5% Longoran / 1:5 Nuhongan:Tletingan split.
    const entityCfg = variantSpecies ? { ...rec.cfg, speciesWeights: variantSpecies } : rec.cfg;
    const c = await window.BanditCombat.makeEntity(entityCfg, rank, rec.tier, x, y, {
      ...options,
      defOverride: variant ? { ...(options.defOverride || {}), label: variant.label || 'Slagothim Beastmaster' } : options.defOverride,
      extra: {
        ...(options.extra || {}),
        banditVariant: variant ? 'slagothimBeastmaster' : null,
      },
    });
    if (!c || !variant) return c;
    rec.beastmastersSpawned = (rec.beastmastersSpawned || 0) + 1;
    await spawnBeastmasterCompanion(rec, c, variant);
    return c;
  }

  async function spawnSimpleHydraBandit(rec, rank, nameOverride, exterior = false) {
    if (rec.zoneId !== deps.getCurrentArea() || window.TothalBlizzard?.isShelteringFor?.(rec.zoneId)) return null; // Keep unspawned ranks inside intact tents during the shift storm.
    if ((rec.reserveByRank[rank] || 0) <= 0) return null;
    rec.reserveByRank[rank]--; // Claimed before the async avatar build: concurrent callers can never spawn past the camp's reserve.
    const point = simpleHydraPoint(rec, exterior);
    let c = null;
    try {
      c = await spawnConfiguredBandit(rec, rank, point.x, point.y, {
        zoneId: rec.zoneId,
        extra: {
          homeX: rec.homeX,
          homeY: rec.homeY,
          banditCampInstanceId: rec.instance.id,
          state: 'idle',
        },
        nameOverride,
      });
    } finally {
      if (!c) rec.reserveByRank[rank]++; // Failed or thrown builds give the slot back.
    }
    if (!c) return null;
    deps.hostileObjects.add(c);
    rec.gangIds.add(c.id);
    rec.activeRanksById.set(c.id, rank);
    if (rank === 'captain') rec.captainName = c.name || rec.captainName;
    return c;
  }

  function simpleHydraAllTentsBurning(rec) {
    const tents = rec.props.filter(o => o.type === 'tent');
    return tents.length > 0 && tents.every(o => o.burning || o.destroyed);
  }

  const tothalShelteredCampZones = new Set(); // Zones whose camp residents are sheltering; clearing the event restores their saved states.
  const TOTHAL_SHELTER_RECHECK_MS = 2000; // During a storm, recheck same-size roster replacements no more than once every two seconds.
  const tothalShelterSweeps = new Map(); // Zone -> last roster/camp identities and counts; avoids a full hostile scan every update frame.

  function restoreTothalBanditResident(c, camp = null) {
    const prior = c?._tothalTentShelter; // Exact pre-storm draw visibility, position and area for this bandit.
    if (!prior) return;
    delete c._tothalTentShelter;
    if (c.health <= 0 || c.tzatzulCapturedBy) return; // Dead or carried bandits must never teleport during cleanup.
    c.areaId = prior.areaId;
    c.x = camp?.homeX ?? prior.x; c.y = camp?.homeY ?? prior.y; // A regenerated/removed camp must not strand the actor in a fake interior.
    c.state = 'idle';
    const visibility = prior.visibility || {};
    const objects = [c.avatarRef?.group, c.groundShadow, c._banditToolHolder, c._banditRangedToolHolder];
    const before = [visibility.avatar, visibility.shadow, visibility.melee, visibility.ranged];
    for (let i = 0; i < objects.length; i++) if (objects[i] && typeof before[i] === 'boolean') objects[i].visible = before[i];
  }

  function syncTothalBanditTentShelter(zoneId) {
    const storm = !!window.TothalBlizzard?.isShelteringFor?.(zoneId);
    const protectedZone = tothalShelteredCampZones.has(zoneId);
    if (!storm && !protectedZone) return false; // Ordinary weather adds no hostile scan, timer or map allocation.
    const camps = _banditCampInstances.get(zoneId) || null;
    const roster = deps.hostileObjects;
    const rosterCount = roster?.length ?? roster?.size ?? 0;
    const nowMs = window.performance?.now?.() ?? Date.now(); // Monotonic decision clock, not an additional scheduler.
    const previous = tothalShelterSweeps.get(zoneId);
    if (storm && protectedZone && previous?.roster === roster && previous?.rosterCount === rosterCount
        && previous?.camps === camps && previous?.campCount === (camps?.length || 0)
        && nowMs >= previous.checkedAt && nowMs - previous.checkedAt < TOTHAL_SHELTER_RECHECK_MS) return true;
    const campById = new Map((camps || []).map(rec => [rec.instance.id, rec])); // Built only on storm start, roster changes or a throttled refresh.
    for (const c of roster || []) {
      const camp = campById.get(c.banditCampInstanceId);
      if (!storm && c._tothalTentShelter?.zoneId === zoneId) {
        restoreTothalBanditResident(c, camp); // Restore even when its former camp no longer exists.
        continue;
      }
      if (!camp || c.health <= 0 || c.tzatzulCapturedBy) continue; // Never steal a captured fighter or restore a corpse.
      if (storm && !c._tothalTentShelter) {
        c._tothalTentShelter = {
          zoneId, areaId: c.areaId, x: c.x, y: c.y, state: c.state,
          visibility: {
            avatar: c.avatarRef?.group?.visible, shadow: c.groundShadow?.visible,
            melee: c._banditToolHolder?.visible, ranged: c._banditRangedToolHolder?.visible,
          },
        }; // Each drawable keeps its own prior visibility; unequipped weapons stay hidden after the storm.
        c.areaId = 'map_i_tothal_storm_tent_' + zoneId;
        c.x = camp.homeX; c.y = camp.homeY;
        c.state = 'idle'; c.targetCreature = null; c.targetPlayer = false; c._chunkCombatTarget = null;
        if (c.avatarRef?.group) c.avatarRef.group.visible = false;
        if (c.groundShadow) c.groundShadow.visible = false;
        if (c._banditToolHolder) c._banditToolHolder.visible = false;
        if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;
      }
    }
    if (storm) {
      tothalShelteredCampZones.add(zoneId);
      tothalShelterSweeps.set(zoneId, { roster, rosterCount, camps, campCount: camps?.length || 0, checkedAt: nowMs });
    } else {
      tothalShelteredCampZones.delete(zoneId);
      tothalShelterSweeps.delete(zoneId);
    }
    return storm;
  }

  function restoreTothalBanditZonesAfterTravel() {
    if (!tothalShelteredCampZones.size) return; // Ordinary weather has no per-frame roster scan or allocation.
    for (const shelteredZone of tothalShelteredCampZones) { // Clear distant tent assignments after the storm, even when the player is indoors or in another map.
      if (!window.TothalBlizzard?.isShelteringFor?.(shelteredZone)) syncTothalBanditTentShelter(shelteredZone);
    }
  }

  async function updateSimpleHydra(dt) {
    restoreTothalBanditZonesAfterTravel(); // Before the active-zone early return, so fake tent interiors cannot persist off-map.
    const zoneId = deps.getCurrentArea();
    if (!deps.isZoneArea(zoneId)) return;
    const recs = _banditCampInstances.get(zoneId) || [];
    if (syncTothalBanditTentShelter(zoneId)) return; // Do not emerge from tents or refill reserves while the event lasts.
    if (!recs.length) return;
    const liveById = new Map();
    for (const c of deps.hostileObjects) {
      if (c.banditCampInstanceId && c.health > 0) liveById.set(c.id, c);
    }

    for (const rec of recs) {
      if (!rec.activeRanksById) continue;
      if (rec.initialGuardsPending > 0 && !rec.initialGuardSpawnInFlight) {
        if (simpleHydraAllTentsBurning(rec) || (rec.reserveByRank.grunt || 0) <= 0) rec.initialGuardsPending = 0; // Never release guards from destroyed tents or exhausted reserves.
        else {
          const nowMs = window.performance?.now?.() ?? Date.now(); // Recovery uses the existing update clock, not a second scheduler.
          if (nowMs >= (rec.initialGuardNextAtMs || 0)) {
            rec.initialGuardSpawnInFlight = true;
            rec.initialGuardNextAtMs = nowMs + 850; // Stagger delayed avatar builds instead of spawning a storm-sized burst in one frame.
            try {
              const guard = await spawnSimpleHydraBandit(rec, 'grunt', undefined, true); // Reuse the ordinary reserve, variant, and camp membership owner.
              if (guard) { rec.initialGuardsPending--; liveById.set(guard.id, guard); } // This pass took its roster snapshot before awaiting the spawn; don't falsely count a new guard as dead.
            } finally { rec.initialGuardSpawnInFlight = false; }
          }
        }
      }
      let nonCaptainDeaths = 0;
      for (const [id, rank] of [...rec.activeRanksById]) {
        if (liveById.has(id)) continue;
        rec.activeRanksById.delete(id);
        if (rank !== 'captain') nonCaptainDeaths++;
      }
      if (nonCaptainDeaths && !rec.reinforcementPending
          && simpleHydraRank(rec)) {
        rec.reinforcementPending = true;
        rec.reinforcementTimer = Math.max(
          0,
          Number(rec.cfg?.campLifecycle?.simpleHydraDelaySeconds ?? SIMPLE_HYDRA_DELAY_S),
        );
        window.__farmLog?.(
          '[bandits] simple hydra: ' + nonCaptainDeaths
            + ' non-captain death(s); one tent replacement queued.',
          'wildlife',
        );
      }

      if (rec.reinforcementPending && !rec.reinforcementSpawnInFlight) { // This runs every frame while the avatar build below is awaited; without the flag each frame launched another replacement.
        rec.reinforcementTimer -= dt;
        if (rec.reinforcementTimer <= 0) {
          const rank = simpleHydraRank(rec);
          if (rank) {
            rec.reinforcementSpawnInFlight = true;
            let c = null;
            try { c = await spawnSimpleHydraBandit(rec, rank); }
            finally { rec.reinforcementSpawnInFlight = false; }
            if (c) {
              rec.reinforcementPending = false;
              window.__farmLog?.(
                '[bandits] simple hydra: ' + rank + ' emerged from a tent.',
                'wildlife',
              );
            } else {
              rec.reinforcementTimer = 1;
            }
          } else {
            rec.reinforcementPending = false;
          }
        }
      }

      const livingNonCaptains = [...rec.activeRanksById.values()]
        .filter(rank => rank !== 'captain').length;
      const captainReady = !rec.captainSpawned
        && !rec.captainSpawnInFlight
        && (rec.reserveByRank.captain || 0) > 0
        && !rec.reinforcementPending
        && !rec.reinforcementSpawnInFlight
        && (simpleHydraAllTentsBurning(rec)
          || ((rec.reserveByRank.grunt || 0) === 0
            && (rec.reserveByRank.lieutenant || 0) === 0
            && (rec.reserveByRank.flasker || 0) === 0
            && livingNonCaptains === 0));
      if (captainReady) {
        rec.captainSpawnInFlight = true;
        const c = await spawnSimpleHydraBandit(rec, 'captain', rec.captainName);
        if (c) {
          rec.captainSpawned = true;
          window.__farmLog?.(
            '[bandits] simple hydra: captain emerged from the camp.',
            'wildlife',
          );
        } else {
          rec.captainSpawnInFlight = false;
        }
        rec.captainSpawnInFlight = false;
      }
    }
  }

  // Porakaneki camps are placed eagerly for every wilderness zone at world
  // boot (see PorakanekiCamps.ensureWorldCamps), long before a bandit camp
  // for that same zone gets seeded here (lazily, only once the player
  // actually enters it) -- so by the time this runs, any Porakaneki sites
  // already there are real and worth staying away from. TemporaryLocales'
  // own overlap check already refuses to stamp literally on top of one
  // (it's just another locale's carrier object), but with no minimum
  // separation a bandit camp could still land right next door, sharing a
  // chunk with a whole camp's worth of Porakaneki residents the moment
  // either side draws the player into combat.
  function porakanekiAvoidPoints(zoneId, minDistance) {
    if (!(minDistance > 0)) return [];
    const tribes = window.TribeCamps?.list?.() || (window.PorakanekiCamps ? [window.PorakanekiCamps] : []); // Porakaneki and Omgurku camps get the same spacing.
    const camps = tribes.flatMap(tribe => tribe.campCenters?.()?.zones?.[zoneId]?.camps || []);
    if (!camps.length) return [];
    return camps.filter(camp => camp?.center).map(camp => ({ col: camp.center.col, row: camp.center.row, minDistance }));
  }
  function porakanekiAvoidChunks(zoneId) {
    return window.TribeCamps?.reservedCampChunks?.(zoneId) || window.PorakanekiCamps?.reservedCampChunks?.(zoneId) || [];
  } // Hard 16x16 stream-chunk reservation; includes the future chief-camp site.
  function wildernessChunkSizeTiles() {
    return Math.max(1, Math.floor(Number(window.WildernessChunks?.constants?.CHUNK_TILES) || 16));
  } // Canonical chunk size shared with the streamed wilderness renderer.
  function tryStampBanditCamp(view, localeDef, placement, avoidPoints, avoidChunks) {
    let instance = null;
    for (const clearance of [placement.clearanceTiles ?? 2, 1, 0]) {
      instance = window.TemporaryLocales.stamp(view, localeDef, {
        clearanceTiles: clearance,
        requiresFlatGround: placement.requiresFlatGround !== false,
        minDistanceFromEntry: placement.minDistanceFromEntry,
        clearableTypes: _BANDIT_CLEARABLE_TYPES,
        rng: deps.rnd,
        avoidPoints,
        avoidChunks,
        chunkSizeTiles: wildernessChunkSizeTiles(),
      });
      if (instance) break;
    }
    return instance;
  } // Centralizes all retries so the hard chunk exclusion can never be omitted by a fallback.

  async function spawnBanditCamp(zoneId, localeDef, cfg) {
    const view = _banditZoneView(zoneId);
    if (!view) return null;
    const placement = localeDef.placement || {};
    const caveAvoid = window.LocaleTerrainPlacement?.isolatedLocaleAvoidPoints?.(deps.zoneLayouts?.get?.(zoneId)) || []; // Reuse the shared live Banubu cave site, not a duplicate hardcoded location.
    let avoidPoints = porakanekiAvoidPoints(zoneId, placement.minDistanceFromPorakanekiCamp ?? 12).concat(caveAvoid);
    let avoidChunks = porakanekiAvoidChunks(zoneId);
    let instance = tryStampBanditCamp(view, localeDef, placement, avoidPoints, avoidChunks);

    // The authored distance buffer is cosmetic spacing. It may relax, but the
    // same-chunk rule never does: every retry still carries avoidChunks.
    if (!instance && avoidPoints.length) instance = tryStampBanditCamp(view, localeDef, placement, caveAvoid, avoidChunks); // Relax tribe spacing before relaxing Banubu's secluded cave.
    if (!instance && caveAvoid.length) instance = tryStampBanditCamp(view, localeDef, placement, [], avoidChunks); // Never sacrifice a valid bandit camp just because the optional cave buffer is too large.

    // Bandit placement may consume *surplus* Porakaneki hunting camps when chunk
    // space is constrained, but PorakanekiCamps enforces a hard one-camp floor per
    // tribe and zone, and since every tribe now gets exactly one hunting camp there
    // is no surplus: reduceHuntingCampsForBandit() returns null and this loop is a
    // no-op. It stays so a future config with several camps per tribe keeps working.
    // The seasonal chief reservation is never sacrificed either, so a constrained
    // seed places fewer bandit camps rather than erasing Porakaneki from the zone
    // or violating the hard chunk rule.
    while (!instance && (window.TribeCamps || window.PorakanekiCamps)?.reduceHuntingCampsForBandit?.(zoneId)) {
      avoidPoints = porakanekiAvoidPoints(zoneId, placement.minDistanceFromPorakanekiCamp ?? 12).concat(caveAvoid);
      avoidChunks = porakanekiAvoidChunks(zoneId);
      instance = tryStampBanditCamp(view, localeDef, placement, avoidPoints, avoidChunks)
        || tryStampBanditCamp(view, localeDef, placement, caveAvoid, avoidChunks)
        || tryStampBanditCamp(view, localeDef, placement, [], avoidChunks);
    }
    if (!instance) {
      window.__farmLog?.(`[bandits] zone "${zoneId}": no site fits ${localeDef.id} (fallback: no camp placed here).`, 'wildlife');
      return null;
    }
    _syncBanditFlora(zoneId, instance.removedObjectSnapshots, false);

    const bountyPin = deps.activeBountyForZone(zoneId);
    const alreadyHasPinnedCaptain = bountyPin
      && (_banditCampInstances.get(zoneId) || []).some(r => r.captainName === bountyPin.captainName);
    const pinThisCamp = bountyPin && !alreadyHasPinnedCaptain;
    const tier = pinThisCamp ? bountyPin.tier : banditTierForSite(cfg, view, instance.site);
    const tracked = _banditCampInstances.get(zoneId) || [];
    const discoverySlot = _nextCampDiscoverySlot(tracked);
    const rec = {
      zoneId, instance, tier, cfg, discoverySlot, discoveryKey: _campDiscoveryKey(zoneId, discoverySlot), gangIds: new Set(),
      props: view.objects.filter(o => o.temporaryLocaleInstanceId === instance.id),
      homeX: (instance.site.x + instance.site.w / 2) * deps.TILE,
      homeY: (instance.site.y + instance.site.h / 2) * deps.TILE,
      reserveByRank: { grunt: 0, flasker: 0, lieutenant: 0, captain: 0 },
      activeRanksById: new Map(),
      reinforcementPending: false,
      reinforcementSpawnInFlight: false,
      reinforcementTimer: 0,
      initialGuardsPending: 0, // Number of initial exterior guards delayed by storm shelter at camp generation.
      initialGuardSpawnInFlight: false, // Ensures asynchronous resume never spawns duplicate guards.
      initialGuardNextAtMs: 0, // Spreads recovery over several existing update ticks.
      captainSpawned: false,
      captainSpawnInFlight: false,
      beastmastersSpawned: 0,
    };
    tracked.push(rec);
    _banditCampInstances.set(zoneId, tracked);
    ensureBanditCampMeshes(zoneId);

    const comp = cfg?.gangComposition || {};
    const grunts = (comp.gruntsMin ?? 3) + Math.floor(deps.rnd() * Math.max(1, (comp.gruntsMax ?? 6) - (comp.gruntsMin ?? 3) + 1));
    const lieutenants = (comp.lieutenantsMin ?? 1) + Math.floor(deps.rnd() * Math.max(1, (comp.lieutenantsMax ?? 2) - (comp.lieutenantsMin ?? 1) + 1));
    const flaskers = flaskerCountForGrunts(comp, grunts); // One Flasker per four regular bandits (gangComposition.regularBanditsPerFlasker).
    rec.reserveByRank.grunt = grunts;
    rec.reserveByRank.flasker = flaskers;
    rec.reserveByRank.lieutenant = lieutenants;
    rec.reserveByRank.captain = Math.max(0, Number(comp.captains ?? 1));
    rec.captainName = (pinThisCamp ? bountyPin.captainName : null)
      || window.BanditCombat.randomName?.('captain')
      || 'Bandit Captain';
    const initialGuardCount = Math.min(3, rec.reserveByRank.grunt);
    let initialGuards = 0;
    for (let i = 0; i < initialGuardCount; i++) {
      if (window.TothalBlizzard?.isShelteringFor?.(zoneId)) {
        rec.initialGuardsPending = initialGuardCount - i; // Late-generated camps wait for clear weather, then release the usual exterior guard quota.
        break;
      }
      const guard = await spawnSimpleHydraBandit(rec, 'grunt', undefined, true);
      if (guard) initialGuards++;
      else if (window.TothalBlizzard?.isShelteringFor?.(zoneId)) {
        rec.initialGuardsPending = initialGuardCount - i; // Also handle a storm starting while an async avatar is loading.
        break;
      }
    }
    if (!initialGuards && !window.TothalBlizzard?.isShelteringFor?.(zoneId)) {
      window.__farmLog?.('[bandits] simple hydra: initial guards could not spawn.', 'warn');
    }
    const total = grunts + flaskers + lieutenants + rec.reserveByRank.captain;
    window.__farmLog?.(
      '[bandits] zone "' + zoneId + '": camp ' + instance.id
        + ' staged with ' + initialGuards + ' exterior guard(s); ' + Math.max(0, total - initialGuards)
        + ' supporting bandit(s) remain in the simple tent sequence.',
      'wildlife',
    );
    if (initialGuards && zoneId === deps.getCurrentArea()) {
      deps.showToast('Smoke on the wind — a bandit camp is nearby.', false);
    }
    return instance;
  }

  async function seedBanditCampsForZone(zoneId) {
    const [cfg, localeDefs] = await Promise.all([window.BanditCombat.loadGangConfig(), window.BanditCombat.loadCampLocaleDefs()]);
    if (!cfg || !localeDefs.length) {
      _banditCampInstances.set(zoneId, []);
      _reconcileRememberedCamps(zoneId);
      return;
    }
    if (!_banditCampInstances.has(zoneId)) _banditCampInstances.set(zoneId, []);
    const maxCamps = Math.max(0, Number(cfg.campLifecycle?.maxCampsPerZone ?? 1));
    for (let i = _banditCampInstances.get(zoneId).length; i < maxCamps; i++) {
      const localeDef = localeDefs[Math.floor(deps.rnd() * localeDefs.length)];
      const maxInstances = Number(localeDef.placement?.maxInstances ?? maxCamps);
      const already = _banditCampInstances.get(zoneId).filter(r => r.instance.localeId === localeDef.id).length;
      if (already >= maxInstances) continue;
      await spawnBanditCamp(zoneId, localeDef, cfg);
    }
    _reconcileRememberedCamps(zoneId);
  }

  async function rerollBanditCamps(zoneId, clearedRecs) {
    const [cfg, localeDefs] = await Promise.all([window.BanditCombat.loadGangConfig(), window.BanditCombat.loadCampLocaleDefs()]);
    if (!cfg || !localeDefs.length) return;
    const view = _banditZoneView(zoneId);
    if (!view) return;
    const tracked = _banditCampInstances.get(zoneId) || [];
    for (const rec of clearedRecs) {
      window.WildernessMap?.forgetDiscoveredThreat?.(rec.discoveryKey);
      for(const obj of rec.props||[])if(obj.key==='crateStack')window.CratePiles?.forgetPile?.(zoneId,obj.id);
      for (const id of rec.instance.stampedObjectIds) removeBanditCampProp(zoneId, id);
      window.TemporaryLocales.release(view, rec.instance);
      _syncBanditFlora(zoneId, rec.instance.removedObjectSnapshots, true);
      const idx = tracked.indexOf(rec);
      if (idx >= 0) tracked.splice(idx, 1);
    }
    _banditCampInstances.set(zoneId, tracked);
    await seedBanditCampsForZone(zoneId);
  }

  function forgetZoneBanditState(zoneId) {
    for(const rec of _banditCampInstances.get(zoneId)||[])for(const obj of rec.props||[])
      if(obj.key==='crateStack')window.CratePiles?.unregisterPile?.(zoneId,obj.id);
    _banditCampMeshes.delete(zoneId);
    _banditCampInstances.delete(zoneId);
    _banditZoneViews.delete(zoneId);
    _banditZoneEntryPending.delete(zoneId);
    if (tothalShelteredCampZones.has(zoneId)) {
      for (const c of deps?.hostileObjects || []) if (c._tothalTentShelter?.zoneId === zoneId) restoreTothalBanditResident(c); // A forced terrain regeneration must not leave residents stranded in non-existent tent areas.
    }
    tothalShelteredCampZones.delete(zoneId);
    tothalShelterSweeps.delete(zoneId); // The new camp roster will be checked afresh on its next active tick.
    for (const [key, info] of _perceivedThreats) {
      if (info.zoneId !== zoneId) continue;
      _perceivedThreats.delete(key);
    }
    if (_activeAmbush?.campRec.zoneId === zoneId) _activeAmbush = null;
  }

  let campsEnabled = true;

  function ensureCurrentZoneBanditCamps() {
    if (!campsEnabled) return;
    const zoneId = deps.getCurrentArea();
    if (!deps.isZoneArea(zoneId) || zoneId === deps.DEV_ARENA_ZONE_ID) return;
    if (!window.TemporaryLocales) return;
    if (_banditZoneWorkInFlight.has(zoneId)) return;
    const reentered = _banditZoneEntryPending.delete(zoneId);
    if (!_banditCampInstances.has(zoneId)) {
      _banditZoneWorkInFlight.add(zoneId);
      seedBanditCampsForZone(zoneId)
        .catch(e => deps.debugLog('Bandits: camp seed failed: ' + e.message, 'warn'))
        .finally(() => _banditZoneWorkInFlight.delete(zoneId));
      return;
    }
    ensureBanditCampMeshes(zoneId);
    if (!reentered) return;
    const cleared = (_banditCampInstances.get(zoneId) || []).filter(isBanditCampCleared);
    if (!cleared.length) return;
    _banditZoneWorkInFlight.add(zoneId);
    rerollBanditCamps(zoneId, cleared)
      .catch(e => deps.debugLog('Bandits: camp re-roll failed: ' + e.message, 'warn'))
      .finally(() => _banditZoneWorkInFlight.delete(zoneId));
  }

  const BANDIT_TENT_HOLD_S = 4;
  function banditTentNearPx() { return deps.TILE * 1.7; }
  let _banditTentHoldT = 0;
  let _banditTentHoldId = null;
  let _banditTentHoldInterrupted = false;
  let _tentActionHudEl = null;
  let _tentActionLabelEl = null;
  let _tentActionFillEl = null;
  let _lastTentFocus = { result: 'not-checked', nearby: 0, hasRay: false, hasFocusApi: false }; // Mobile-readable focus plumbing/status for Pixel Probe.

  function ensureTentActionHud() {
    _tentActionHudEl ||= document.getElementById('tentActionHud');
    _tentActionLabelEl ||= document.getElementById('tentActionLabel');
    _tentActionFillEl ||= document.getElementById('tentActionFill');
  }

  let _tentActionHudHidden = false; // Tracked here, not read back from the DOM, so the per-frame hide is free once applied.
  function hideTentActionHud() {
    ensureTentActionHud();
    // Called every frame while no tent is in reach; once hidden, rewriting the
    // same attribute/width still queued a DOM mutation and a style recalc per frame.
    if (_tentActionHudHidden && _tentActionHudEl) return;
    _tentActionHudEl?.classList.remove('visible');
    _tentActionHudEl?.setAttribute('aria-hidden', 'true');
    if (_tentActionFillEl) _tentActionFillEl.style.width = '0%';
    _tentActionHudHidden = !!_tentActionHudEl;
  }

  function showTentActionHud(label, percent) {
    ensureTentActionHud();
    if (_tentActionLabelEl) _tentActionLabelEl.textContent = label;
    if (_tentActionFillEl) _tentActionFillEl.style.width = Math.min(100, Math.max(0, percent)) + '%';
    _tentActionHudEl?.setAttribute('aria-hidden', 'false');
    _tentActionHudEl?.classList.add('visible');
    _tentActionHudHidden = false;
  }

  const BANDIT_TENT_AIM_MAX_WORLD = 24; // Camera-ray intersection budget for the visible tent surface, matching the shared world-focus range.
  let _banditTentRaycaster = null; // Reused by aimedBanditTent so checking the target every frame does not allocate a Raycaster.

  function banditTentRayHit(zoneId, obj, raycaster) {
    const root = _banditCampMeshes.get(zoneId)?.get(obj.id)?.mesh; // Registered tent render group, never a proximity-only proxy.
    const surface = root?.children?.find(child => child.userData?.banditTentAimSurface); // The authored canvas mesh, excluding burn flames/outline children.
    if (!root?.visible || !surface?.visible) return null;
    root.updateWorldMatrix?.(true, true);
    return raycaster.intersectObject(surface, true)
      .find(hit => Number.isFinite(hit.distance) && hit.distance >= 0) || null;
  }

  function aimedBanditTent(zoneId) {
    const nearby = _banditZoneTents(zoneId).filter(obj => {
      if (obj.destroyed) return false;
      const center = banditTentCenterPx(obj);
      return Math.hypot(deps.player.x - center.x, deps.player.y - center.y) <= banditTentNearPx();
    });
    if (!nearby.length) {
      _lastTentFocus = { result: 'none-nearby', nearby: 0, hasRay: false, hasFocusApi: !!window.RangedWeapons?.focusCandidates };
      return null;
    }
    const ray = deps.getPlayerInteractionRay?.() || deps.getPlayerAimRay?.();
    if (!ray || !window.RangedWeapons?.focusCandidates) {
      _lastTentFocus = { result: !ray ? 'missing-ray' : 'missing-focus-api', nearby: nearby.length, hasRay: !!ray, hasFocusApi: !!window.RangedWeapons?.focusCandidates };
      return null;
    }
    const origin = ray.origin, dir = ray.direction; // Authoritative cursor/center ray used by the shared world focus resolver.
    if (![origin?.x, origin?.y, origin?.z, dir?.x, dir?.y, dir?.z].every(Number.isFinite)) {
      _lastTentFocus = { result: 'invalid-ray', nearby: nearby.length, hasRay: true, hasFocusApi: true };
      return null;
    }
    const direction = new THREE.Vector3(dir.x, dir.y, dir.z); // Normalized for exact Three.js surface intersection.
    if (direction.lengthSq() < 1e-8) {
      _lastTentFocus = { result: 'invalid-ray', nearby: nearby.length, hasRay: true, hasFocusApi: true };
      return null;
    }
    const raycaster = _banditTentRaycaster ||= new THREE.Raycaster(); // Only one reusable 3D ray query across all nearby tents.
    raycaster.set(new THREE.Vector3(origin.x, origin.y, origin.z), direction.normalize());
    raycaster.near = 0;
    raycaster.far = BANDIT_TENT_AIM_MAX_WORLD;
    let focus = null; // Closest actual tent-surface intersection, not the closest large bounding box.
    for (const obj of nearby) {
      const hit = banditTentRayHit(zoneId, obj, raycaster);
      if (!hit || (focus && focus.distanceWorld <= hit.distance)) continue;
      focus = {
        candidate: { type: 'bandit-tent', id: obj.id, data: obj },
        point: hit.point,
        distanceWorld: hit.distance,
      };
    }
    if (!focus) {
      _lastTentFocus = { result: 'ray-missed', nearby: nearby.length, hasRay: true, hasFocusApi: true };
      return null;
    }
    if (focus.candidate.data.burning || !(focus.candidate.data.interactable?.lootable || focus.candidate.data.interactable?.burnable)) {
      _lastTentFocus = { result: 'not-actionable', nearby: nearby.length, hasRay: true, hasFocusApi: true, tentId: focus.candidate.data.id };
      return null; // A burning/empty tent physically blocks a tent behind it; never aim through its canvas.
    }
    const hostile = window.RangedWeapons.focusedHostile?.(BANDIT_TENT_AIM_MAX_WORLD);
    if (hostile && hostile.distanceWorld <= focus.distanceWorld + 0.05) {
      _lastTentFocus = { result: 'nearer-hostile', nearby: nearby.length, hasRay: true, hasFocusApi: true };
      return null;
    }
    window.DebugHitboxes?.noteInteractionFocus?.(focus);
    _lastTentFocus = { result: 'focused', nearby: nearby.length, hasRay: true, hasFocusApi: true, tentId: focus.candidate.data.id };
    return focus.candidate.data;
  }

  function hasNearbyTent() {
    const zoneId = deps?.getCurrentArea?.();
    return !!(zoneId && deps.isZoneArea(zoneId) && aimedBanditTent(zoneId));
  }

  function getNearbyTentAction() {
    const zoneId = deps?.getCurrentArea?.();
    if (!(zoneId && deps.isZoneArea(zoneId))) return null;
    const tent = aimedBanditTent(zoneId);
    if (!tent || !(tent.interactable?.lootable || tent.interactable?.burnable)) return null;
    return {
      icon: tent.interactable?.lootable ? '🪙' : '🔥',
      label: tent.interactable?.lootable ? 'Loot Tent' : 'Burn Tent',
      action: 'bandit_tent_interact',
      style: 'primary',
      allowed: true,
      worldInteraction: true,
      promptRoot: _banditCampMeshes.get(zoneId)?.get(tent.id)?.mesh || null,
    };
  }

  function lootBanditTent(zoneId, obj) {
    const gained = deps.rollLootPool('banditTent', { zoneId });
    const parts = grantBanditLoot(gained);
    if (obj.interactable) obj.interactable.lootable = false;
    deps.refreshItemScroll(); deps.buildInventoryGrid(); deps.refreshActionBar();
    (deps.scheduleLootMemberSave || deps.saveMemberWorldData)(); // Avoid a full player-save write on the tent-loot frame.
    deps.showToast(parts.length
      ? `Ransacked the tent: ${parts.join(' ')}`
      : 'Nothing worth taking in the tent.', true);
  }

  function finishBurnBanditTent(zoneId, obj) {
    obj.burning = false;
    obj.destroyed = true;
    const view = _banditZoneViews.get(zoneId);
    if (view) {
      const idx = view.objects.indexOf(obj);
      if (idx >= 0) view.objects.splice(idx, 1);
      for (let r = obj.y; r < obj.y + (obj.h || 1); r++) {
        for (let c = obj.x; c < obj.x + (obj.w || 1); c++) {
          if (view.tiles[r]?.[c]?.occupiedBy === obj.id) view.tiles[r][c].occupiedBy = obj.temporaryLocaleInstanceId;
        }
      }
    }
    removeBanditCampProp(zoneId, obj.id);
  }

  function burnBanditTent(zoneId, obj) {
    if (obj.burning || obj.destroyed) return;
    obj.burning = true;
    const rec = (_banditCampInstances.get(zoneId) || []).find(r => r.instance.id === obj.temporaryLocaleInstanceId);
    const burnS = Math.max(0.1, Number(rec?.cfg?.campLifecycle?.tentBurnSeconds ?? BANDIT_TENT_BURN_S));
    obj.burnEndsAt = performance.now() + burnS * 1000;
    if (obj.interactable) { obj.interactable.lootable = false; obj.interactable.burnable = false; }
    const entry = _banditCampMeshes.get(zoneId)?.get(obj.id);
    if (entry?.mesh && !entry.mesh.children.some(child => child.userData?.banditFireEffect)) {
      entry.mesh.add(buildBanditFireEffect(3.4));
    }
    deps.showToast('🔥 The bandit tent is ablaze.', true);
    window.__farmLog?.('[bandits] tent ' + obj.id + ' ignited; it will burn down in ' + burnS + 's.', 'wildlife');
  }

  function igniteAimedTentWithTorch() {
    const zoneId=deps?.getCurrentArea?.(); // Current zone is the only eligible fire-action authority.
    if (!zoneId || !deps.isZoneArea(zoneId)) return false;
    const tent=aimedBanditTent(zoneId); // Uses the existing physical canvas ray and close-range check.
    if (!tent || tent.burning || tent.destroyed) return false;
    burnBanditTent(zoneId,tent);
    return true;
  }

  function igniteTorchMelee(zoneId, matches) {
    if (!deps?.isZoneArea(zoneId) || zoneId !== deps.getCurrentArea()) return false;
    const meshes = _banditCampMeshes.get(zoneId);
    const tent = _banditZoneTents(zoneId).find(prop => !prop.destroyed && !prop.burning && matches(meshes?.get(prop.id)?.mesh));
    if (!tent) return false;
    burnBanditTent(zoneId, tent);
    return true;
  }

  function igniteTorchSegment(zoneId,start,end,maxT=1,radius=0) {
    if (!deps || zoneId !== deps.getCurrentArea() || !deps.isZoneArea(zoneId) || !start || !end) return false;
    const limit=Math.max(0,Math.min(1,Number(maxT) || 0));
    const finish=start.clone().lerp(end,limit); // Cannot ignite a tent behind a projectile-blocking wall.
    const delta=finish.clone().sub(start);
    const box=new THREE.Box3(); // Reused for each tent rather than allocating per camp prop.
    const meshMap=_banditCampMeshes.get(zoneId);
    let first=null;
    for (const tent of _banditZoneTents(zoneId)) {
      if (tent.burning || tent.destroyed) continue;
      const mesh=meshMap?.get(tent.id)?.mesh;
      if (!mesh?.visible) continue;
      mesh.updateWorldMatrix?.(true,true);
      box.setFromObject(mesh).expandByScalar(Math.max(.04,Number(radius)||0));
      if (box.isEmpty()) continue;
      let enter=0, exit=1; // Slab intersection on the real world-space tent bounds.
      for (const axis of ['x','y','z']) {
        const d=delta[axis];
        if (Math.abs(d)<1e-8) { if (start[axis]<box.min[axis] || start[axis]>box.max[axis]) {enter=2;break;} continue; }
        const t0=(box.min[axis]-start[axis])/d, t1=(box.max[axis]-start[axis])/d;
        enter=Math.max(enter,Math.min(t0,t1));
        exit=Math.min(exit,Math.max(t0,t1));
        if (enter>exit) break;
      }
      if (enter<=exit && enter>=0 && enter<=1 && (!first || enter<first.t)) first={tent,t:enter};
    }
    if (!first) return false;
    burnBanditTent(zoneId,first.tent);
    return true;
  }

  function updateBanditTentInteraction(dt) {
    updateBanditFireEffects(dt);
    updateSimpleHydra(dt);
    const zoneIdForBurn = deps.getCurrentArea();
    if (deps.isZoneArea(zoneIdForBurn)) {
      for (const tent of _banditZoneTents(zoneIdForBurn)) {
        if (tent.burning && performance.now() >= (tent.burnEndsAt || 0)) finishBurnBanditTent(zoneIdForBurn, tent);
      }
    }
    const zoneId = deps.getCurrentArea();
    const tent = deps.isZoneArea(zoneId) ? aimedBanditTent(zoneId) : null;
    const actionHeldDown = deps.getActionHeldDown();
    const holdAllowed = window.GameplayInputRouter?.canContinueHold?.('bandit_tent_interact', actionHeldDown) ?? actionHeldDown; // Combat interrupts tent looting/burning until release.
    if (!actionHeldDown) _banditTentHoldInterrupted = false;
    if (actionHeldDown && !holdAllowed) _banditTentHoldInterrupted = true;
    const looting = !!tent?.interactable?.lootable;
    const interacting = !!tent
      && deps.getActiveAction() === 'bandit_tent_interact'
      && holdAllowed
      && !_banditTentHoldInterrupted;
    if (!interacting) {
      if (_banditTentHoldId !== null) { _banditTentHoldT = 0; _banditTentHoldId = null; }
      hideTentActionHud();
      return;
    }
    if (_banditTentHoldId !== tent.id) { _banditTentHoldId = tent.id; _banditTentHoldT = 0; }
    const holdS = Number(tent.interactable?.holdSeconds) > 0
      ? Number(tent.interactable.holdSeconds) : BANDIT_TENT_HOLD_S;
    _banditTentHoldT += dt;
    showTentActionHud(
      looting ? 'Looting Tent...' : 'Burning Tent...',
      (_banditTentHoldT / holdS) * 100,
    );
    if (_banditTentHoldT < holdS) return;
    _banditTentHoldT = 0;
    _banditTentHoldId = null;
    _banditTentHoldInterrupted = true; // One press performs one action; release before burning a tent you just looted.
    hideTentActionHud();
    if (looting) lootBanditTent(zoneId, tent);
    else burnBanditTent(zoneId, tent);
  }

  function grantBanditLoot(gained) {
    const parts = [];
    for (const [key, qty] of Object.entries(gained || {})) {
      if (key === 'gold') {
        deps.inventory.gold = (deps.inventory.gold || 0) + qty;
        parts.push('💰' + qty + 'g');
        continue;
      }
      deps.inventory[key] = Math.min(window.InventoryStacks.MAX_TOTAL, (deps.inventory[key] || 0) + qty);
      deps.clampInventoryStack(key);
      parts.push(deps.itemIconForKey(key) + '×' + qty);
    }
    return parts;
  }

  function _banditClothingPiece(cosmeticId, rolledSlot) {
    const store = deps.getStoreClothingPieces().find(p => p.id === cosmeticId);
    if (store) return store;
    const shop = (window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || []).find(i => i.id === cosmeticId);
    if (shop) return { id: cosmeticId, label: shop.label, category: shop.category || rolledSlot, usesB: false, price: shop.price ?? 40 };
    const pretty = cosmeticId.split('::').pop().replace(/[_-]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
    return { id: cosmeticId, label: pretty, category: rolledSlot, usesB: false, price: 40 };
  }

  function grantFlaskerLoadoutLoot(c, parts) {
    if (c?.banditRank !== 'flasker') return parts;
    const recipeIds = [...new Set(c.def?.banditFlaskLoadout || [])]; // Exact two combat loadout types become the guaranteed corpse drops.
    const tuning = c.def?.banditFlaskerTuning || {}; // Spawn-time tuning keeps quantity stable even if config hot-reloads before looting.
    const minQty = Math.max(1, Math.floor(Number(tuning.lootMinPerType) || 2)); // Used to make every loadout type drop several flasks.
    const maxQty = Math.max(minQty, Math.floor(Number(tuning.lootMaxPerType) || 4)); // Upper bound for each of the two guaranteed stacks.
    for (const recipeId of recipeIds) {
      const key = window.AlchemySystem?.ensureRecipeItemDef?.(recipeId, c.def?.banditFlaskPotencyTier || 0); // Registers the ordinary inventory item before granting it.
      if (!key) continue;
      const qty = minQty + Math.floor(deps.rnd() * (maxQty - minQty + 1));
      const maxStack = Number(window.InventoryStacks?.MAX_TOTAL) || 999999;
      deps.inventory[key] = Math.min(maxStack, (Number(deps.inventory[key]) || 0) + qty);
      const label = window.AlchemySystem?.RECIPE_DEFS?.[recipeId]?.label || 'Flask';
      parts.push(`🧪 ${label}×${qty}`);
    }
    return parts;
  }

  // `source` (optional, the dead entity) lets a Maskbound's mask keep the exact random procedural pattern it was generated with.
  function banditWornClothingItems(roster, source = null) {
    const catalog = deps.getDyeCatalog();
    const items = [];
    const forcedBySlot = roster?.clothingPatterns?.forcedOverpassBySlot || {};
    for (const cosmeticId of (roster?.equippedCosmetics || [])) {
      const armor = roster.metalArmorItems?.find(item => window.MetalArmorSystem?.baseCosmeticId?.(item) === cosmeticId); // Preserve alloy, maximum Temper, and article identity instead of converting armor into dyed cloth.
      if (armor) { items.push(applyLootCurse(JSON.parse(JSON.stringify(armor)), lootCurseFor(roster, cosmeticId, armor.slot))); continue; }
      const slot = roster.cosmeticSlots?.[cosmeticId] || 'torso';
      const piece = _banditClothingPiece(cosmeticId, slot);
      const tintSlot = window.BanditCombat.TINT_SLOT_BY_SLOT[piece.category]; // Loot uses the same clothing channel as the deceased humanoid's portrait.
      const dyeId = roster.appliedDyes?.[tintSlot] || null;
      const dyeBId = tintSlot ? roster.appliedDyes?.[`${tintSlot}_B`] : null; // Preserves ghoul silver trims and draped-pants secondary color in actual looted items.
      const dye = dyeId ? catalog.find(d => d.id === dyeId) : null;
      const dyeB = dyeBId ? catalog.find(d => d.id === dyeBId) : null;
      const lootItem = {
        uid: 'citem_bandit_' + Date.now().toString(36) + '_' + Math.floor(deps.rnd() * 1e6),
        cosmeticId: piece.id,
        slot: piece.category,
        label: (dye ? dye.label + ' ' : '') + piece.label,
        baseLabel: piece.label,
        colorA: deps.dyeToClothingColor(dye),
        colorB: dyeB ? deps.dyeToClothingColor(dyeB) : null,
        price: piece.price,
        sellPrice: Math.floor(piece.price * 0.4),
        sprite: deps.clothingSpriteForCosmetic(piece.id),
      };
      applyLootPattern(lootItem, forcedBySlot[slot], slot);
      const maskPattern = slot === 'mask' ? (source?.avatarRef?.profile?.bodyColors?.__hobunjiWovenClothing || []).find(descriptor => descriptor?.slot === 'mask' && descriptor?.weaving) : null;
      if (maskPattern) lootItem.weaving = JSON.parse(JSON.stringify(maskPattern.weaving)); // The worn mask's own generated primary + overpass patterns and ink colors.
      items.push(applyLootCurse(lootItem, lootCurseFor(roster, cosmeticId, slot)));
    }
    return items;
  }

  // Cursed on loot (cannot be worn until dispelled), like enchanted relic weapons looted bound: a lich's tanged circlet (Garanki dispels it) and a
  // Maskbound's mask (Father Hunundi, later). A lich's other garments, including face wraps, are ordinary.
  function lootCurseFor(roster, cosmeticId, slot) {
    if ((roster?.lichType || roster?.specialLichId) && /circlet/i.test(cosmeticId)) return { kind: 'circlet', dispelBy: 'garanki' };
    if (roster?.maskboundTroop && (slot === 'mask' || window.isPortraitMaskCosmeticId?.(cosmeticId))) return { kind: 'mask', dispelBy: 'hunundi' };
    return null;
  }
  function applyLootCurse(item, curse) {
    if (!item || !curse) return item;
    item.cursed = { ...curse, originalLabel: item.label }; // Dispelling restores the label and clears the flag.
    item.label = 'Cursed ' + item.label;
    return item;
  }
  // A forced woven pattern (including its per-spawn random frame and pattern color) travels with the looted piece as real weaving data.
  function applyLootPattern(item, forced, slot) {
    if (!item || !forced?.pattern) return item;
    const pattern = window.NpcWardrobe?.forcedPatternForRender?.({}, slot, forced) || JSON.parse(JSON.stringify(forced.pattern)); // No body scale: the wearer's own rig differs.
    item.weaving = { ...(item.weaving || {}), forcedOverpassPattern: pattern, ...(Array.isArray(forced.roles) && forced.roles.length ? { forcedOverpassRoles: [...forced.roles] } : {}) };
    const patternHex = forced.fallbackColorC?.hex;
    if (/^#[0-9a-f]{6}$/i.test(patternHex || '')) {
      item.colorC = { hex: patternHex, label: 'Pattern' };
      if (forced.baseUsesPatternColor) { // Draped pants: the base layer is the pattern color, the drape keeps the main color.
        const main = item.colorA;
        item.colorA = { hex: patternHex, label: 'Pattern' };
        item.colorB = main || item.colorB;
      }
    }
    return item;
  }

  let lastEnemyLootMs = 0; // Latest corpse-loot input time for mobile diagnostics.
  function makeBanditCorpseWorldObject(c) {
    const trophyKey = c.isTribeHunter === true
      ? ({ omgurku: 'omgurkuHorn', porakaneki: 'porakanekiQuill' })[c.tribeId] || null
      : c.isPorakanekiHunter === true ? 'porakanekiQuill' : null; // Existing tribal humanoid corpses drop their own trophy, never bandit treasure.
    const holdSeconds = trophyKey ? 0 : (Number(c.lootHoldSeconds) || 0); // Tribal corpses use the ordinary pickup action, not the optional catacomb hold search.
    const canSearch=()=>!c.caveBodyId||window.CaveSiteSystem?.canSearchBody?.(c)===true; // Stale corpse objects cannot survive a cave reset or area change.
    return {
      id: 'corpse_' + c.id,
      type: 'bandit_corpse',
      promptRoot: c.avatarRef?.group || null,
      holdSeconds,
      holdLabel: 'Searching ' + (c.name || c.def.label) + '...',
      getButtons() {
        if (c.ruinNoLoot===true)return []; // Preserve the authored ruin no-loot contract and its existing regression guard.
        if (!canSearch())return []; // Closed, rising, spent, and stale catacomb bodies cannot be searched.
        if (trophyKey && c.corpseLooted === true)return []; // A claimed trophy must not leave a Collect prompt on a preserved corpse.
        if (holdSeconds > 0) return [{ icon: c.lootIcon || '🦴', label: 'Hold to Search', action: 'corpse_hold_loot', style: 'primary', allowed: true, worldInteraction: true, promptRoot: c.avatarRef?.group || null }];
        return [{ icon: trophyKey === 'omgurkuHorn' ? '📯' : trophyKey === 'porakanekiQuill' ? '🪶' : '🪙',
          label: trophyKey ? 'Collect ' + (trophyKey === 'omgurkuHorn' ? 'Omgurku Horn' : 'Porakaneki Quill') : 'Loot ' + (c.name || c.def.label),
          action: 'obj_loot_corpse', style: 'primary', allowed: true }];
      },
      onAction(action) {
        if (action !== 'obj_loot_corpse') return { ok: false, message: 'Unknown action.' };
        if(c.ruinNoLoot===true)return {ok:false,message:'This test-room opponent carries no loot.'}; // Also protects against calling the corpse action directly.
        if (!canSearch())return {ok:false,message:'This body cannot be searched.'}; // Validate again at commit, not only when the hold prompt appears.
        if (trophyKey && c.corpseLooted === true) return { ok: false, message: 'This trophy has already been collected.' }; // Repeated mobile presses cannot mint another tribal currency token.
        if (trophyKey && (Number(deps.inventory[trophyKey]) || 0) >= (Number(window.InventoryStacks?.MAX_TOTAL) || 999)) {
          return { ok: false, message: 'Make room in your pack to collect this trophy.' }; // Never consume the body when its one guaranteed token cannot fit.
        }
        const lootStarted=window.performance?.now?.() ?? Date.now(); // Measure only the active loot input.
        if (trophyKey) window.NpcGifting?.registerTribalTrophyItems?.(deps.ITEM_DEFS, deps.inventoryItems); // Defensive registration when a corpse is opened before NPC gifting initialized.
        // Save the unique bound weapon before consuming the corpse or awarding repeatable ordinary loot.
        const captainWeapon = !trophyKey && c._banditCaptainArmament ? window.BanditCaptainArmaments?.grantCorpseWeapon?.(c) : null;
        if (!trophyKey && c._banditCaptainArmament && !captainWeapon) return { ok: false, message: 'Could not collect the bound weapon. Try again.' };
        const coffinRelic=c.ruinWallCoffin?window.GhoulSpecialVariants?.lootEnchantedWeapon?.(c):null;
        if(c.ruinWallCoffin&&!coffinRelic)return {ok:false,message:'Could not collect the bound weapon; try again.'}; // Preserve corpse if grant fails.
        const parts = grantBanditLoot(trophyKey ? { [trophyKey]: 1 } : deps.rollLootPool(c.def.lootPool, { entity: c }));
        if (trophyKey) c.corpseLooted = true; // Mark the actual source before despawn, not only the temporary interaction object.
        if (!trophyKey) { // Ordinary bandits, ghouls and liches retain every existing corpse bonus; tribe hunters receive their trophy only.
          const specialAmmo = window.RangedWeapons?.rollSpecialAmmoLoot?.() || 0;
          if (specialAmmo) parts.push(`🏹 Special Ammo×${specialAmmo}`);
          grantFlaskerLoadoutLoot(c, parts); // Flaskers always surrender several of both infinite combat loadout types on death.
          const relic = coffinRelic||window.GhoulSpecialVariants?.lootEnchantedWeapon?.(c); // A Shadowknight's enchanted weapon comes off the body, still bound.
          if (relic) parts.push('🗡️ Bound ' + relic.label);
          if (captainWeapon) parts.push('⚒️ ' + captainWeapon);
          for (const item of banditWornClothingItems(c.rosterRecord, c)) {
            deps.getPackClothing().push(item);
            window.MetalArmorSystem?.learnBlueprints?.([item]); // Unlock at acquisition even if the player sells the loot before visiting the smith.
            parts.push('👘 ' + item.label);
          }
        }
        // keepCorpseAfterLoot: the body stays where it fell (e.g. a lich's
        // skeletons it can raise again); it just stops being lootable.
        if (c.keepCorpseAfterLoot) {
          c.corpseLooted = true;
          if(c.caveBodyId)window.CaveSiteSystem?.recordBodyLooted?.(c);
        }
        else { deps.corpseObjects.delete(c); deps.despawnCreature(c); if (captainWeapon) window.BanditCaptainArmaments?.discard?.(c); }
        deps.refreshItemScroll();
        deps.buildInventoryGrid(); // This is a no-op when the Pack is closed.
        if (deps.isMenuOpen?.() !== false) deps.buildPackClothingSection();
        (deps.scheduleLootMemberSave || deps.saveMemberWorldData)();
        lastEnemyLootMs=Math.round((window.performance?.now?.() ?? Date.now())-lootStarted);
        return {
          ok: true, deferMemberSave: true, // Avoid useActiveAction doing an immediate save after we already queued a deferred one.
          message: parts.length
            ? `Looted the ${c.name || c.def.label}: ${parts.join(' ')}`
            : `The ${c.name || c.def.label} carried nothing.`, // Minions/liches share this path; their own name, not the base 'Bandit' def label.
        };
      },
    };
  }

  window.BanditCamps = {
    init,
    _simpleHydra: { campInstances: _banditCampInstances, update: updateSimpleHydra, spawnBandit: spawnSimpleHydraBandit, rankFor: simpleHydraRank, flaskerCountForGrunts },
    tothalShelterSnapshot: () => ({ storm: window.TothalBlizzard?.currentState?.()?.storm || 0,
      shelteredZones: [...tothalShelteredCampZones],
      residentCount: [...deps.hostileObjects].filter(c => !!c._tothalTentShelter).length }), // Mobile-copyable garrison audit. // Test seam: executes the camp reinforcement lifecycle without a full zone.
    isCampCleared: isBanditCampCleared,
    updateCampBanners: updateBanditCampBanners,
    senseTargets, // Active bandit-camp tents/fires for the Perception landmark glow.
    companionPerceptionRangePx: _companionPerceptionRangePx,
    updateCompanionPerception,
    forgetDenPerception,
    updateRandomEncounters,
    forgetZoneState: forgetZoneBanditState,
    ensureCurrentZoneCamps: ensureCurrentZoneBanditCamps,
    updateTentInteraction: updateBanditTentInteraction,
    igniteAimedTentWithTorch, igniteTorchMelee, igniteTorchSegment, // Shared instant ignition for held and thrown lit torches.
    hasNearbyTent,
    getNearbyTentAction,
    makeCorpseWorldObject: makeBanditCorpseWorldObject,
    markZoneEntered: (zoneId) => _banditZoneEntryPending.add(zoneId),
    interruptTentHold: () => {
      const wasHolding = _banditTentHoldId !== null
        || (deps?.getActiveAction?.() === 'bandit_tent_interact' && deps?.getActionHeldDown?.());
      _banditTentHoldT = 0;
      _banditTentHoldId = null;
      _banditTentHoldInterrupted = !!wasHolding;
      hideTentActionHud();
    },
    get tentInteractionDebug() {
      ensureTentActionHud();
      return {
        holdSeconds: _banditTentHoldT,
        tentId: _banditTentHoldId,
        interrupted: _banditTentHoldInterrupted,
        hudReady: !!(_tentActionHudEl && _tentActionLabelEl && _tentActionFillEl),
        hudVisible: !!_tentActionHudEl?.classList.contains('visible'),
        focus: { ..._lastTentFocus },
      };
    },
    get lastEnemyLootMs() { return lastEnemyLootMs; }, // Exposed for mobile performance reports.
    get campInstances() { return _banditCampInstances; },
    get perceivedThreats() { return _perceivedThreats; },
    get campsEnabled() { return campsEnabled; },
    set campsEnabled(v) { campsEnabled = !!v; },
  };
})();
