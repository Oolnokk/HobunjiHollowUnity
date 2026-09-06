(() => {
  'use strict';

  // Bandit camps — temporary-locale zone adapter, props, lifecycle,
  // companion perception, tent interaction, and corpse loot.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

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
      };
      tiles[t.r][t.c] = view;
      srcByKey.set(`${t.c},${t.r}`, t);
      if (t.type === deps.TileType.SHRUB || t.type === deps.TileType.ROCK) {
        const id = `zclutter_${t.c}_${t.r}`;
        objects.push({
          id, type: 'shrub', x: t.c, y: t.r, w: 1, h: 1,
          srcType: t.type, floraKind: t.floraKind || null,
        });
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
      for (const o of (inst.objects || [])) blockRect(o.x, o.y, o.w || 1, o.h || 1);
    }
    const zdef = deps.EXTERIOR_ZONES[zoneId];
    const entry = layout.toTownExit
      ? { x: layout.toTownExit.col, y: layout.toTownExit.row }
      : (Number.isFinite(zdef?.entryCol) ? { x: zdef.entryCol, y: zdef.entryRow } : null);
    const view = { cols, rows, tiles, objects, entry, _srcByKey: srcByKey };
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
  
    // Five separate triangles give every flat tent panel a full 0..1 UV
    // island. ConeGeometry shares its UV strip around the circumference,
    // which repeated/sliced canvas.png instead of stretching one copy cleanly
    // across each panel.
    function buildBanditTentCanvasGeometry() {
      const sides = 5, radius = 0.9, height = 1.2;
      const positions = [], uvs = [];
      for (let i = 0; i < sides; i++) {
        const a0 = -Math.PI / 2 + i * Math.PI * 2 / sides;
        const a1 = -Math.PI / 2 + (i + 1) * Math.PI * 2 / sides;
        positions.push(
          Math.cos(a0) * radius, 0, Math.sin(a0) * radius,
          Math.cos(a1) * radius, 0, Math.sin(a1) * radius,
          0, height, 0,
        );
        uvs.push(0, 0, 1, 0, 0.5, 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.computeVertexNormals();
      return geo;
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
  
    
  function buildBanditTentMesh(burning = false) {
    const group = new THREE.Group();
    const canvas = new THREE.Mesh(
      buildBanditTentCanvasGeometry(),
      new THREE.MeshLambertMaterial({ color: 0xc8b58b, map: banditCanvasTexture(), side: THREE.DoubleSide }),
    );
    canvas.castShadow = true;
    const doorway = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.6),
      new THREE.MeshBasicMaterial({ color: 0x1a1410, side: THREE.DoubleSide }));
    doorway.position.set(0, 0.3, 0.905);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.45, 5),
      new THREE.MeshLambertMaterial({ color: 0x5a4326 }));
    pole.position.y = 0.72;
    // Preserve main-branch projectile-cover metadata.
    group.userData.projectileCoverHeightTiles = 1.45;
    group.userData.projectileCoverRadiusTiles = 0.9;
    group.userData.projectileCoverKind = 'bandit-tent';
    group.userData.banditTent = true;
    group.add(canvas, doorway, pole);
    if (burning) group.add(buildBanditFireEffect(3.4));
    return group;
  }

  function buildBanditCampfireMesh() {
    const group = window.ProceduralFurniture?.buildFurnitureGroup?.('campfire', 0x6b4a28) || new THREE.Group();
    group.add(buildBanditFireEffect(1.15));
    return group;
  }

  const _banditCampMeshes = new Map();

  function banditTentCenterPx(obj) {
    return { x: (obj.x + (obj.w || 1) / 2) * deps.TILE, y: (obj.y + (obj.h || 1) / 2) * deps.TILE };
  }

  // Use the game's existing solid ROCK tile path as a cheap runtime collision
  // mask for a standing tent. The underlying tile type is restored verbatim
  // when the tent is removed, so no mesh/radius collision runs each frame.
  function _applyBanditTentGridCollision(zoneId, obj) {
    const zi = deps.zoneScenes.get(zoneId);
    if (!zi?.grid || !obj) return [];
    const snapshots = [];
    for (let r = obj.y; r < obj.y + (obj.h || 1); r++) {
      for (let c = obj.x; c < obj.x + (obj.w || 1); c++) {
        const tile = zi.grid?.[r]?.[c];
        if (!tile || (tile._banditTentCollisionId && tile._banditTentCollisionId !== obj.id)) continue;
        if (tile._banditTentCollisionId === obj.id) continue;
        snapshots.push({ c, r, type: tile.type, floraKind: tile.floraKind, generatedObjectType: tile.generatedObjectType });
        tile.type = deps.TileType.ROCK;
        tile.floraKind = null;
        tile.generatedObjectType = null;
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
      tile.type = snap.type;
      tile.floraKind = snap.floraKind;
      tile.generatedObjectType = snap.generatedObjectType;
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
    const zi = deps.zoneScenes.get(zoneId);
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
          const mesh = buildBanditTentMesh(!!obj.burning);
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
          const light = new THREE.PointLight(0xff7722, 1.4, 7);
          light.position.set(center.x / deps.TILE, y + 0.45, center.y / deps.TILE);
          light.userData.furnitureLightMask = true;
          zi.scene.add(light);
          const sfxDef = window.Music?.resolveFurnitureSfx?.({ sfxKey: 'fireplace' });
          const sfxSource = window.Music?.registerFurnitureSfxSource?.(zoneId, center.x / deps.TILE, center.y / deps.TILE, sfxDef);
          meshes.set(obj.id, { mesh, light, sfxSource, collisionTiles: [], propId: obj.id });
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
    const per = Number(cfg?.difficultyTiers?.tierDistanceTiles || 14);
    const maxTier = Number(cfg?.difficultyTiers?.maxTier ?? 3);
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
          // A den is a lasting geographic discovery even while its current
          // pack is dead and waiting to respawn; only a Tothal Shift moves
          // it and expires the saved marker.
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

      // Bandit camps are no longer sensed by proximity — see
      // revealCampFromTracking, triggered by winning a random road ambush
      // (updateRandomEncounters), for how a companion now finds them.

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

  // ── Random road ambush (Skyrim-style random encounter) ─────────────
  // While the player is actually travelling through a wilderness zone, a
  // periodic low-probability roll can drop a pair of bandits on them —
  // the same "random encounter zone" idea Skyrim uses on its overworld
  // roads: no fixed trigger point, just a timed chance check gated on
  // the player being out in the world and moving. Winning the fight is
  // what tips the player's companion off to the source camp; the camp
  // stays hidden until then.
  const ENCOUNTER_CHECK_INTERVAL_S = 5;
  const ENCOUNTER_CHANCE_PER_CHECK = 0.05;
  const ENCOUNTER_COOLDOWN_S = 100;
  const ENCOUNTER_MOVE_SPEED_MIN_PXS = 5;
  // Kept inside a grunt's ~6.2-tile aggroRangePx (see combat-bandit.js) so
  // the pair notices and closes in right away instead of standing idle.
  const ENCOUNTER_MIN_SPAWN_TILES = 4;
  const ENCOUNTER_MAX_SPAWN_TILES = 6;
  const ENCOUNTER_NEARBY_HOSTILE_TILES = 16;
  const ENCOUNTER_MAX_ACTIVE_S = 180;

  let _encounterCheckAccum = 0;
  let _encounterCooldownRemaining = 0;
  let _activeAmbush = null; // { campRec, banditIds: Set<id> }

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
    const c = await window.BanditCombat.makeEntity(rec.cfg, 'grunt', rec.tier, x, y, {
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
      // No victory reveal past the timeout — either the player fled or the
      // pair leashed back to idle; the tracks go cold instead of blocking
      // every future roll forever.
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

  // ── Simple hydra camp sequence ────────────────────────────────────
  // One exterior guard is active at a time. Each non-captain death can
  // produce one delayed replacement; the captain is reserved for the end.
  const SIMPLE_HYDRA_DELAY_S = 5;
  const SIMPLE_HYDRA_DEFAULT_BURN_S = 8;

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

  function simpleHydraRank(rec) {
    const choices = [];
    if ((rec.reserveByRank.lieutenant || 0) > 0) choices.push('lieutenant');
    if ((rec.reserveByRank.grunt || 0) > 0) choices.push('grunt');
    return choices.length ? choices[Math.floor(deps.rnd() * choices.length)] : null;
  }

  async function spawnSimpleHydraBandit(rec, rank, nameOverride, exterior = false) {
    if (rec.zoneId !== deps.getCurrentArea()) return null;
    const point = simpleHydraPoint(rec, exterior);
    const c = await window.BanditCombat.makeEntity(rec.cfg, rank, rec.tier, point.x, point.y, {
      zoneId: rec.zoneId,
      extra: {
        homeX: rec.homeX,
        homeY: rec.homeY,
        banditCampInstanceId: rec.instance.id,
        state: 'idle',
      },
      nameOverride,
    });
    if (!c) return null;
    deps.hostileObjects.add(c);
    rec.gangIds.add(c.id);
    rec.activeRanksById.set(c.id, rank);
    rec.reserveByRank[rank] = Math.max(0, (rec.reserveByRank[rank] || 0) - 1);
    if (rank === 'captain') rec.captainName = c.name || rec.captainName;
    return c;
  }

  function simpleHydraAllTentsBurning(rec) {
    const tents = rec.props.filter(o => o.type === 'tent');
    return tents.length > 0 && tents.every(o => o.burning || o.destroyed);
  }

  async function updateSimpleHydra(dt) {
    const zoneId = deps.getCurrentArea();
    if (!deps.isZoneArea(zoneId)) return;
    const recs = _banditCampInstances.get(zoneId) || [];
    if (!recs.length) return;
    const liveById = new Map();
    for (const c of deps.hostileObjects) {
      if (c.banditCampInstanceId && c.health > 0) liveById.set(c.id, c);
    }

    for (const rec of recs) {
      if (!rec.activeRanksById) continue;
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

      if (rec.reinforcementPending) {
        rec.reinforcementTimer -= dt;
        if (rec.reinforcementTimer <= 0) {
          const rank = simpleHydraRank(rec);
          if (rank) {
            const c = await spawnSimpleHydraBandit(rec, rank);
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
        && (simpleHydraAllTentsBurning(rec)
          || ((rec.reserveByRank.grunt || 0) === 0
            && (rec.reserveByRank.lieutenant || 0) === 0
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

  async function spawnBanditCamp(zoneId, localeDef, cfg) {
    const view = _banditZoneView(zoneId);
    if (!view) return null;
    const placement = localeDef.placement || {};
    let instance = null;
    for (const clearance of [placement.clearanceTiles ?? 2, 1, 0]) {
      instance = window.TemporaryLocales.stamp(view, localeDef, {
        clearanceTiles: clearance,
        requiresFlatGround: placement.requiresFlatGround !== false,
        minDistanceFromEntry: placement.minDistanceFromEntry,
        clearableTypes: _BANDIT_CLEARABLE_TYPES,
        rng: deps.rnd,
      });
      if (instance) break;
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
      reserveByRank: { grunt: 0, lieutenant: 0, captain: 0 },
      activeRanksById: new Map(),
      reinforcementPending: false,
      reinforcementTimer: 0,
      captainSpawned: false,
      captainSpawnInFlight: false,
    };
    tracked.push(rec);
    _banditCampInstances.set(zoneId, tracked);
    ensureBanditCampMeshes(zoneId);

    const comp = cfg?.gangComposition || {};
    const grunts = (comp.gruntsMin ?? 3) + Math.floor(deps.rnd() * Math.max(1, (comp.gruntsMax ?? 6) - (comp.gruntsMin ?? 3) + 1));
    const lieutenants = (comp.lieutenantsMin ?? 1) + Math.floor(deps.rnd() * Math.max(1, (comp.lieutenantsMax ?? 2) - (comp.lieutenantsMin ?? 1) + 1));
    rec.reserveByRank.grunt = grunts;
    rec.reserveByRank.lieutenant = lieutenants;
    rec.reserveByRank.captain = Math.max(0, Number(comp.captains ?? 1));
    rec.captainName = (pinThisCamp ? bountyPin.captainName : null)
      || window.BanditCombat.randomName?.('captain')
      || 'Bandit Captain';
    const initialGuardCount = Math.min(3, rec.reserveByRank.grunt);
    let initialGuards = 0;
    for (let i = 0; i < initialGuardCount; i++) {
      const guard = await spawnSimpleHydraBandit(rec, 'grunt', undefined, true);
      if (guard) initialGuards++;
    }
    if (!initialGuards) {
      window.__farmLog?.('[bandits] simple hydra: initial guards could not spawn.', 'warn');
    }
    const total = grunts + lieutenants + rec.reserveByRank.captain;
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
    _banditCampMeshes.delete(zoneId);
    _banditCampInstances.delete(zoneId);
    _banditZoneViews.delete(zoneId);
    _banditZoneEntryPending.delete(zoneId);
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

  // ── Tent hold actions: loot, then burn ────────────────────────────

  const BANDIT_TENT_HOLD_S = 4;
  function banditTentNearPx() { return deps.TILE * 1.7; }
  let _banditTentHoldT = 0;
  let _banditTentHoldId = null;
  let _banditTentHoldInterrupted = false; // Prevents a damaging hit from auto-restarting the same still-held interaction; cleared on release.
  let _tentActionHudEl = null;
  let _tentActionLabelEl = null;
  let _tentActionFillEl = null;

  // This module loads in <head>, before index.html creates the HUD nodes.
  // Resolve them lazily on first use instead of permanently caching null.
  function ensureTentActionHud() {
    _tentActionHudEl ||= document.getElementById('tentActionHud');
    _tentActionLabelEl ||= document.getElementById('tentActionLabel');
    _tentActionFillEl ||= document.getElementById('tentActionFill');
  }

  function hideTentActionHud() {
    ensureTentActionHud();
    _tentActionHudEl?.classList.remove('visible');
    _tentActionHudEl?.setAttribute('aria-hidden', 'true');
    if (_tentActionFillEl) _tentActionFillEl.style.width = '0%';
  }

  function showTentActionHud(label, percent) {
    ensureTentActionHud();
    if (_tentActionLabelEl) _tentActionLabelEl.textContent = label;
    if (_tentActionFillEl) _tentActionFillEl.style.width = Math.min(100, Math.max(0, percent)) + '%';
    _tentActionHudEl?.setAttribute('aria-hidden', 'false');
    _tentActionHudEl?.classList.add('visible');
  }

  function nearestBanditTent(zoneId) {
    let best = null, bestDist = Infinity;
    for (const obj of _banditZoneTents(zoneId)) {
      if (obj.destroyed) continue;
      const center = banditTentCenterPx(obj);
      const dist = Math.hypot(deps.player.x - center.x, deps.player.y - center.y);
      if (dist <= banditTentNearPx() && dist < bestDist) { best = obj; bestDist = dist; }
    }
    return best;
  }

  function banditTentInteractionBox(zoneId, obj) {
    const mesh = _banditCampMeshes.get(zoneId)?.get(obj.id)?.mesh;
    if (mesh?.isObject3D) {
      mesh.updateWorldMatrix?.(true, true);
      const meshBox = new THREE.Box3().setFromObject(mesh);
      if (!meshBox.isEmpty()) return meshBox.expandByScalar(0.12);
    }
    const center = banditTentCenterPx(obj);
    const tile = deps.TILE || 1;
    const gridTile = deps.zoneScenes.get(zoneId)?.grid?.[obj.y]?.[obj.x];
    const groundY = gridTile ? deps.tileSurfaceYInArea(gridTile, zoneId) : deps.NORMAL_TOP;
    return new THREE.Box3(
      new THREE.Vector3(center.x / tile - 0.9, groundY, center.y / tile - 0.9),
      new THREE.Vector3(center.x / tile + 0.9, groundY + 1.45, center.y / tile + 0.9),
    );
  }

  function aimedBanditTent(zoneId) {
    // Candidate tents are limited to the existing interaction radius before
    // the 3D focus pass, keeping ray arbitration cheap across large camps.
    const nearby = _banditZoneTents(zoneId).filter(obj => {
      if (obj.destroyed) return false;
      const center = banditTentCenterPx(obj);
      return Math.hypot(deps.player.x - center.x, deps.player.y - center.y) <= banditTentNearPx();
    });
    if (!nearby.length) return null;
    const ray = deps.getPlayerInteractionRay?.() || deps.getPlayerAimRay?.(); // Current centered world-interaction ray used to determine what the player is looking at.
    if (!ray || !window.RangedWeapons?.focusCandidates) return null;
    const candidates = nearby.map(obj => ({ // World-space tent boxes presented to the shared focus/hostile arbitration.
      type: 'bandit-tent', id: obj.id, data: obj,
      box: banditTentInteractionBox(zoneId, obj),
    }));
    const focus = window.RangedWeapons.focusCandidates(candidates, 24); // Closest visible candidate under the centered reticle.
    if (!focus?.candidate?.data) return null;
    const hostile = window.RangedWeapons.focusedHostile?.(24); // A nearer hostile keeps Action 1 reserved for combat.
    if (hostile && hostile.distanceWorld <= focus.distanceWorld + 0.05) return null;
    window.DebugHitboxes?.noteInteractionFocus?.(focus);
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
    if (!tent) return null;
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
    const gained = deps.rollLootPool('banditTent');
    const parts = grantBanditLoot(gained);
    if (obj.interactable) obj.interactable.lootable = false;
    deps.refreshItemScroll(); deps.buildInventoryGrid(); deps.refreshActionBar();
    deps.saveMemberWorldData();
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
    // Match Drenkirra nest-taking: only the aimed context action may advance
    // the hold, and releasing or changing actions cancels its progress.
    const actionHeldDown = deps.getActionHeldDown();
    if (!actionHeldDown) _banditTentHoldInterrupted = false;
    const looting = !!tent?.interactable?.lootable;
    const interacting = !!tent
      && deps.getActiveAction() === 'bandit_tent_interact'
      && actionHeldDown
      && !_banditTentHoldInterrupted;
    if (!interacting) {
      if (_banditTentHoldT > 0) { _banditTentHoldT = 0; _banditTentHoldId = null; }
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
    hideTentActionHud();
    if (looting) lootBanditTent(zoneId, tent);
    else burnBanditTent(zoneId, tent);
  }

  // ── Corpse loot ───────────────────────────────────────────────────

  function grantBanditLoot(gained) {
    const parts = [];
    for (const [key, qty] of Object.entries(gained || {})) {
      if (key === 'gold') {
        deps.inventory.gold = (deps.inventory.gold || 0) + qty;
        parts.push('💰' + qty + 'g');
        continue;
      }
      deps.inventory[key] = Math.min(99, (deps.inventory[key] || 0) + qty);
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

  function banditWornClothingItems(roster) {
    const catalog = deps.getDyeCatalog();
    const items = [];
    for (const cosmeticId of (roster?.equippedCosmetics || [])) {
      const slot = roster.cosmeticSlots?.[cosmeticId] || 'torso';
      const piece = _banditClothingPiece(cosmeticId, slot);
      const dyeId = roster.appliedDyes?.[window.BanditCombat.TINT_SLOT_BY_SLOT[piece.category]] || null;
      const dye = dyeId ? catalog.find(d => d.id === dyeId) : null;
      items.push({
        uid: 'citem_bandit_' + Date.now().toString(36) + '_' + Math.floor(deps.rnd() * 1e6),
        cosmeticId: piece.id,
        slot: piece.category,
        label: (dye ? dye.label + ' ' : '') + piece.label,
        baseLabel: piece.label,
        colorA: deps.dyeToClothingColor(dye),
        colorB: null,
        price: piece.price,
        sellPrice: Math.floor(piece.price * 0.4),
        sprite: deps.clothingSpriteForCosmetic(piece.id),
      });
    }
    return items;
  }

  function makeBanditCorpseWorldObject(c) {
    return {
      id: 'corpse_' + c.id,
      type: 'bandit_corpse',
      promptRoot: c.avatarRef?.group || null,
      getButtons() {
        return [{ icon: '🪙', label: 'Loot ' + (c.name || c.def.label), action: 'obj_loot_corpse', style: 'primary', allowed: true }];
      },
      onAction(action) {
        if (action !== 'obj_loot_corpse') return { ok: false, message: 'Unknown action.' };
        const parts = grantBanditLoot(deps.rollLootPool(c.def.lootPool));
        const specialAmmo = window.RangedWeapons?.rollSpecialAmmoLoot?.() || 0;
        if (specialAmmo) parts.push(`🏹 Special Ammo×${specialAmmo}`);
        for (const item of banditWornClothingItems(c.rosterRecord)) {
          deps.getPackClothing().push(item);
          parts.push('👘 ' + item.label);
        }
        deps.corpseObjects.delete(c);
        deps.despawnCreature(c);
        deps.refreshItemScroll();
        deps.buildInventoryGrid();
        deps.buildPackClothingSection();
        deps.saveMemberWorldData();
        return {
          ok: true,
          message: parts.length
            ? `Looted the ${c.def.label}: ${parts.join(' ')}`
            : `The ${c.def.label} carried nothing.`,
        };
      },
    };
  }

  window.BanditCamps = {
    init,
    isCampCleared: isBanditCampCleared,
    updateCampBanners: updateBanditCampBanners,
    companionPerceptionRangePx: _companionPerceptionRangePx,
    updateCompanionPerception,
    updateRandomEncounters,
    forgetZoneState: forgetZoneBanditState,
    ensureCurrentZoneCamps: ensureCurrentZoneBanditCamps,
    updateTentInteraction: updateBanditTentInteraction,
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
      };
    },
    get campInstances() { return _banditCampInstances; },
    get perceivedThreats() { return _perceivedThreats; },
    get campsEnabled() { return campsEnabled; },
    set campsEnabled(v) { campsEnabled = !!v; },
  };
})();
