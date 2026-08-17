(() => {
  'use strict';

  // Bandit camps — a bandit camp is a `placement.mode: "temporary"` locale
  // (see js/temporary-locales.js) stamped into an already-generated
  // wilderness zone at runtime: the zone adapter that bridges
  // TemporaryLocales' own workspace shape to this game's runtime zone
  // layout, tent props (build/loot/burn), the camp lifecycle (spawn/seed/
  // reroll per zone visit, in concert with js/combat/combat-bandit.js's
  // window.BanditCombat.makeEntity for the gang itself), companion
  // perception (sensing nearby camps/dens for the map), and bandit corpse
  // loot. Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern already used by js/mount-system.js and
  // js/combat/combat-bandit.js.
  //
  // Deliberately NOT moved here: the Bounty Board (game.js still owns
  // "hunt down a named captain" quest tracking) and the Wilderness Map
  // rendering (game.js still owns the minimap/full-map canvas draw) —
  // both read this module's public API (isCampCleared/campInstances/
  // perceivedThreats) rather than being pulled in themselves, since
  // neither is bandit-specific.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // ── Zone adapter for TemporaryLocales ─────────────────────────────
  //
  // TemporaryLocales operates on the wilderness generator's own workspace
  // shape ({cols, rows, tiles: tiles[y][x], objects, entry}). A live
  // zone's cached layout (deps.zoneLayouts) is a flatter RUNTIME form: a flat
  // array of {c, r, type, elevTier, incline, floraKind} tile records with
  // no `objects` list at all, because the generator folds its flora and
  // resource objects down into tile types on the way out (a copse/bush/
  // fruitBush/mushroomPatch/beehive all become a SHRUB tile carrying
  // `floraKind`; ore and boulders become ROCK) -- see terrain-preview.js's
  // buildMergedZoneGrid and mergeZoneTiles. So the module's
  // DEFAULT_CLEARABLE_TYPES (which names the generator's pre-fold object
  // types: 'copse', 'diggableRockOre', ...) can never match anything at
  // runtime; _BANDIT_CLEARABLE_TYPES is passed as opts.clearableTypes
  // instead, and this adapter re-inflates the tile grid into the shape
  // findSite/stamp/release expect. Cached per zone so occupiedBy
  // reservations from one camp are visible to the next.
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
        // An incline tile is solid to the game's own movement collision
        // (tileSpeedAt), so it must never end up under a camp.
        ramp: t.type === deps.TileType.RAMP || !!t.incline,
        waterfall: t.type === deps.TileType.WATERFALL,
        terrain: t.type,
        occupiedBy: null,
      };
      tiles[t.r][t.c] = view;
      srcByKey.set(`${t.c},${t.r}`, t);
      // Flora and resource clutter, re-inflated as clearable objects.
      // A generated zone's ROCK tiles are always a generator resource
      // object (diggableRockOre/undiggableBoulder) — mergeZoneTiles
      // suppresses any stray authored decorative rock back to grass unless
      // it carries a generatedObjectType — and DEFAULT_CLEARABLE_TYPES
      // names both, so they're bulldozeable clutter like anything else.
      // release() puts the node straight back, so a camp only ever hides
      // a mining spot for as long as it stands.
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
      // localeMeta short-circuits isBlocked -- never bulldozeable, whatever
      // clearableTypes says.
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

  // stamp()/release() only ever touch the adapter view above, so the real
  // zone layout (and, while the zone is built, its live scene grid) has to
  // be brought in line by hand: a bulldozed flora tile becomes plain grass
  // and its tree/bush mesh gets rebuilt away, exactly the way felling a
  // tree with the axe already does.
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

  // Deliberately does not block movement, same as reagent plants and
  // buried chests -- the tent is a hold-to-interact prop, and making it
  // solid would need a matching entry in the zone's collision grid that
  // release()/burning would then have to unpick.
  function buildBanditTentMesh() {
    const group = new THREE.Group();
    const canvas = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 1.2, 5),
      new THREE.MeshLambertMaterial({ color: 0x8a7550 }));
    canvas.position.y = 0.6;
    canvas.castShadow = true;
    const doorway = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.6),
      new THREE.MeshBasicMaterial({ color: 0x1a1410, side: THREE.DoubleSide }));
    doorway.position.set(0, 0.3, 0.66);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.45, 5),
      new THREE.MeshLambertMaterial({ color: 0x5a4326 }));
    pole.position.y = 0.72;
    group.add(canvas, doorway, pole);
    return group;
  }

  // zoneId -> Map<stampedObjectId, { mesh, light, sfxSource }> for every
  // prop a camp placed (tents plus the locale's own decor).
  const _banditCampMeshes = new Map();

  function banditTentCenterPx(obj) {
    return { x: (obj.x + (obj.w || 1) / 2) * deps.TILE, y: (obj.y + (obj.h || 1) / 2) * deps.TILE };
  }

  // Each camp record caches its own tent objects at stamp time (see
  // spawnBanditCamp) rather than re-filtering the zone view's whole object
  // list — updateBanditTentInteraction runs this every frame, and a large
  // zone's view holds one object per flora/rock tile.
  function _banditZoneTents(zoneId) {
    const out = [];
    for (const rec of (_banditCampInstances.get(zoneId) || [])) {
      for (const prop of rec.props) if (prop.type === 'tent') out.push(prop);
    }
    return out;
  }

  function _disposeBanditProp(zoneId, entry) {
    const zScene = deps.zoneScenes.get(zoneId)?.scene;
    if (zScene) {
      zScene.remove(entry.mesh);
      if (entry.light) zScene.remove(entry.light);
    }
    entry.mesh.traverse?.(o => { if (o.geometry) o.geometry.dispose(); });
    if (entry.sfxSource) window.Music?.unregisterFurnitureSfxSource(entry.sfxSource);
  }

  // (Re)builds every prop for whatever camps this zone currently tracks --
  // idempotent, and re-run on every den-check tick so a zone scene that got
  // disposed and rebuilt (leaving town and coming back) gets its camps back.
  // Tents get their own procedural mesh; the locale's plain decor objects
  // (campfire, supply crates) go through DECORATIVE_FURNITURE_DEFS the same
  // way authored zone decor does, so the camp fire even lights the place.
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
          const mesh = buildBanditTentMesh();
          const center = banditTentCenterPx(obj);
          mesh.position.set(center.x / deps.TILE, y, center.y / deps.TILE);
          deps.markOutline(mesh);
          zi.scene.add(mesh);
          meshes.set(obj.id, { mesh, light: null, sfxSource: null });
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

  // zoneId -> [{ zoneId, instance, tier, gangIds: Set<creatureId>,
  //              props: [stamped tent/decor objects] }]
  const _banditCampInstances = new Map();
  // Zones the deps.player has just (re-)entered; consumed by
  // ensureCurrentZoneBanditCamps so a cleared camp only ever re-rolls
  // between visits, never under the deps.player's feet mid-visit.
  const _banditZoneEntryPending = new Set();
  const _banditZoneWorkInFlight = new Set();

  function banditTierForSite(cfg, view, site) {
    const per = Number(cfg?.difficultyTiers?.tierDistanceTiles || 14);
    const maxTier = Number(cfg?.difficultyTiers?.maxTier ?? 3);
    if (!view?.entry || !(per > 0)) return 0;
    const cx = site.x + site.w / 2, cy = site.y + site.h / 2;
    const dist = Math.hypot(cx - view.entry.x, cy - view.entry.y);
    return deps.clamp(Math.floor(dist / per), 0, maxTier);
  }

  // A camp is cleared once every tent it placed has been burned down AND
  // every bandit it spawned is dead -- the deps.hostileObjects scan mirrors
  // deps.isDenPackAlive, keyed on banditCampInstanceId the way a pack member is
  // keyed on denKey. Looting a tent deliberately does NOT count: it only
  // strips the tent's supplies (interactable.lootable -> false) and leaves
  // it standing, so clearing a camp always means burning it out.
  function isBanditCampCleared(rec) {
    const view = _banditZoneViews.get(rec.zoneId);
    if (!view) return false;
    if (window.TemporaryLocales.livingTents(view, rec.instance).length) return false;
    for (const c of deps.hostileObjects) {
      if (c.banditCampInstanceId === rec.instance.id && c.health > 0) return false;
    }
    return true;
  }

  // Location title card ("<Captain>'s Bandit Camp") when the deps.player
  // crosses INTO a live camp's radius from outside it -- tracks the
  // inside/outside boolean per instance so it fires again on a real
  // re-entry (walk away and come back) instead of only ever once per
  // camp, matching how a genre "Entering X" banner usually behaves.
  // Independent of updateCompanionPerception's own map-reveal system:
  // that one requires an active companion and a much larger sensed
  // range before marking a camp on the map at all; this is a plain
  // proximity trigger off the deps.player's own position, no companion
  // needed, since it's just naming what's already visually right
  // there rather than revealing a hidden threat.
  const BANDIT_CAMP_BANNER_RADIUS_TILES = 10;
  const BANDIT_CAMP_BANNER_CHECK_INTERVAL_S = 0.5;
  let _banditCampBannerAccum = 0;
  // instance.id -> was the deps.player inside the banner radius last check
  const _banditCampBannerInside = new Map();
  function updateBanditCampBanners(dt) {
    _banditCampBannerAccum += dt;
    if (_banditCampBannerAccum < BANDIT_CAMP_BANNER_CHECK_INTERVAL_S) return;
    _banditCampBannerAccum = 0;
    if (!deps.isZoneArea(deps.getCurrentArea())) return;
    const live = new Set();
    for (const rec of (_banditCampInstances.get(deps.getCurrentArea()) || [])) {
      if (isBanditCampCleared(rec)) continue;
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
    // Drop tracking for any instance no longer live (cleared/re-rolled)
    // so a brand new camp that happens to reuse a stale id-adjacent
    // slot starts from a clean "outside" state rather than inheriting
    // whatever the old, unrelated camp's inside/outside flag was.
    for (const id of _banditCampBannerInside.keys()) {
      if (!live.has(id)) _banditCampBannerInside.delete(id);
    }
  }

  // ── Companion Perception: sensing nearby bandit camps/dens ─────────
  //
  // A companion's own species-defined perceptionTiles (see CREATURE_DB —
  // a hunting dog's nose beats a farm bird's) is how far away it can
  // sense danger through cover/foliage that fog-of-war alone wouldn't
  // reveal. An active companion (whistle-summoned, actually present and
  // following the deps.player — not just sitting in the stable) periodically
  // checks every live camp/den in the current zone against this range.
  // The first time one comes into range it's announced once and marked
  // on the map/minimap with its own danger marker (see
  // _drawWildernessMapOnCanvas) until the threat is actually cleared —
  // a camp once every tent is burned and every bandit dead (see
  // isBanditCampCleared), a den once its current pack is wiped (see
  // deps.isDenPackAlive). Clearing removes the marker outright rather than
  // leaving a stale "already handled" icon on the map — a den that
  // later repopulates needs sensing again from scratch, same as never
  // having found it the first time.
  //
  // Deliberately in-memory only, not saved to localStorage: camps
  // re-roll to a new spot once cleared and dens are re-seeded per zone
  // visit already (see forgetZoneBanditState/ensureCurrentZoneDenPacks),
  // so there's no stable location to persist a reveal against across a
  // reload the way _loadDiscoveredLocales persists a fixed landmark.
  const PERCEPTION_CHECK_INTERVAL_S = 0.6;
  let _perceptionCheckAccum = 0;
  const DEFAULT_PERCEPTION_TILES = 6;
  // Global tuning knob on top of each species' own base perceptionTiles
  // (10 tiles "as the crow flies" read as "it's basically already on top
  // of you" in actual play, not a meaningful early-warning distance) --
  // scale every species' range from here rather than re-tuning each
  // CREATURE_DB entry by hand.
  const PERCEPTION_TILES_MULTIPLIER = 4;
  // key ('camp:'+instanceId or 'den:'+denKey) -> { kind, zoneId, col, row, label }
  const _perceivedThreats = new Map();

  function _companionPerceptionRangePx(c) {
    return (c.def?.perceptionTiles ?? DEFAULT_PERCEPTION_TILES) * PERCEPTION_TILES_MULTIPLIER * deps.TILE;
  }

  function updateCompanionPerception(dt) {
    _perceptionCheckAccum += dt;
    if (_perceptionCheckAccum < PERCEPTION_CHECK_INTERVAL_S) return;
    _perceptionCheckAccum = 0;

    // Prune anything that's since been cleared before scanning for new
    // reveals, so a freshly-repopulated den isn't left permanently
    // unmarked just because it was sensed once, long ago, before it was
    // wiped out the first time.
    for (const [key, info] of _perceivedThreats) {
      if (info.kind === 'camp') {
        const rec = (_banditCampInstances.get(info.zoneId) || []).find(r => r.instance.id === info.instanceId);
        if (!rec || isBanditCampCleared(rec)) _perceivedThreats.delete(key);
      } else if (info.kind === 'den') {
        if (!deps.isDenPackAlive(info.denKey)) _perceivedThreats.delete(key);
      }
    }

    if (!deps.isZoneArea(deps.getCurrentArea())) return;
    const layout = deps.zoneLayouts.get(deps.getCurrentArea());
    for (const c of deps.companionObjects) {
      if (c.health <= 0 || c.areaId !== deps.getCurrentArea()) continue;
      // Only the human deps.player's own perception drives map reveals — an
      // NPC's or another master's companion sensing danger wouldn't mean
      // anything to the deps.player.
      if ((c.master || deps.player) !== deps.player) continue;
      const rangePx = _companionPerceptionRangePx(c);
      const label = c.name || c.def?.label || 'Your companion';

      for (const rec of (_banditCampInstances.get(deps.getCurrentArea()) || [])) {
        const key = 'camp:' + rec.instance.id;
        if (_perceivedThreats.has(key) || isBanditCampCleared(rec)) continue;
        const col = rec.instance.site.x + rec.instance.site.w / 2, row = rec.instance.site.y + rec.instance.site.h / 2;
        if (Math.hypot(col * deps.TILE - c.x, row * deps.TILE - c.y) > rangePx) continue;
        _perceivedThreats.set(key, { kind: 'camp', zoneId: deps.getCurrentArea(), instanceId: rec.instance.id, col, row, label: 'Bandit Camp' });
        deps.showToast(`${label} senses a bandit camp nearby — marked on the map!`, false);
      }

      for (const den of (layout?.dens || [])) {
        const denKey = deps.denKeyFor(deps.getCurrentArea(), den);
        const key = 'den:' + denKey;
        if (_perceivedThreats.has(key) || !deps.isDenPackAlive(denKey)) continue;
        const col = den.x + (den.w || 1) / 2, row = den.y + (den.h || 1) / 2;
        if (Math.hypot(col * deps.TILE - c.x, row * deps.TILE - c.y) > rangePx) continue;
        _perceivedThreats.set(key, { kind: 'den', zoneId: deps.getCurrentArea(), denKey, col, row, label: 'Animal Den' });
        deps.showToast(`${label} senses an animal den nearby — marked on the map!`, false);
      }
    }
  }

  // Stamps one camp into an already-generated zone and spawns its gang.
  // Returns the TemporaryLocales instance record, or null if the zone had
  // no room for the footprint.
  async function spawnBanditCamp(zoneId, localeDef, cfg) {
    const view = _banditZoneView(zoneId);
    if (!view) return null;
    const placement = localeDef.placement || {};
    // The authored clearance (2 tiles all round) turns a 9x8 camp into a
    // 13x12 rectangle, which simply does not fit in the two small 22x16
    // zones once terrain is accounted for -- so fall back through tighter
    // buffers rather than silently leaving half the wilderness camp-free.
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

    // A bounty pin (see _activeBountyForZone/generateBountyTask) forces
    // this camp's tier and captain identity to match a wanted poster
    // already promising a specific captain in this zone, but only
    // while that zone doesn't already HAVE a camp carrying the pinned
    // name -- most bounties are generated by adopting an already-live
    // camp's real identity outright (no pin needed at all), so this
    // path only matters for the fallback case: a bounty rolled when no
    // live camp existed anywhere, which has to steer whatever camp
    // gets generated next instead of naming one that already exists.
    const bountyPin = deps.activeBountyForZone(zoneId);
    const alreadyHasPinnedCaptain = bountyPin
      && (_banditCampInstances.get(zoneId) || []).some(r => r.captainName === bountyPin.captainName);
    const pinThisCamp = bountyPin && !alreadyHasPinnedCaptain;
    const tier = pinThisCamp ? bountyPin.tier : banditTierForSite(cfg, view, instance.site);
    const rec = {
      zoneId, instance, tier, gangIds: new Set(),
      props: view.objects.filter(o => o.temporaryLocaleInstanceId === instance.id),
    };
    const tracked = _banditCampInstances.get(zoneId) || [];
    tracked.push(rec);
    _banditCampInstances.set(zoneId, tracked);
    ensureBanditCampMeshes(zoneId);

    const comp = cfg?.gangComposition || {};
    const grunts = (comp.gruntsMin ?? 3) + Math.floor(deps.rnd() * Math.max(1, (comp.gruntsMax ?? 6) - (comp.gruntsMin ?? 3) + 1));
    const lieutenants = (comp.lieutenantsMin ?? 1) + Math.floor(deps.rnd() * Math.max(1, (comp.lieutenantsMax ?? 2) - (comp.lieutenantsMin ?? 1) + 1));
    const roster = [
      ...Array(grunts).fill('grunt'),
      ...Array(lieutenants).fill('lieutenant'),
      ...Array(comp.captains ?? 1).fill('captain'),
    ];
    // Camp centre in world pixels -- the same homeX/homeY + angle/distance
    // scatter spawnPackAtDen uses around a den's footprint.
    const homeX = (instance.site.x + instance.site.w / 2) * deps.TILE;
    const homeY = (instance.site.y + instance.site.h / 2) * deps.TILE;
    let spawned = 0;
    for (const rank of roster) {
      if (zoneId !== deps.getCurrentArea()) break; // deps.player left mid-build; the next visit re-seeds
      const angle = deps.rnd() * Math.PI * 2;
      const dist = deps.TILE * (1.0 + deps.rnd() * 2.6);
      const c = await window.BanditCombat.makeEntity(cfg, rank, tier, homeX + Math.cos(angle) * dist, homeY + Math.sin(angle) * dist, {
        zoneId,
        extra: { homeX, homeY, banditCampInstanceId: instance.id, state: 'idle' },
        nameOverride: (pinThisCamp && rank === 'captain') ? bountyPin.captainName : undefined,
      });
      if (!c) continue;
      deps.hostileObjects.add(c);
      rec.gangIds.add(c.id);
      spawned++;
      // _banditName(rank) only appends a surname for rank==='captain'
      // (see its own comment), so c.name is already the captain's full
      // "First Last" -- captured here for the camp-entry title banner
      // (updateBanditCampBanners) rather than re-deriving it. First
      // captain found wins if gangComposition.captains is ever >1.
      if (rank === 'captain' && !rec.captainName) rec.captainName = c.name;
    }
    window.__farmLog?.(`[bandits] zone "${zoneId}": camp ${instance.id} stamped at (${instance.site.x},${instance.site.y}) tier ${tier}, ${spawned}/${roster.length} gang members spawned.`, 'wildlife');
    if (spawned > 0 && zoneId === deps.getCurrentArea()) deps.showToast('Smoke on the wind — a bandit camp is nearby.', false);
    return instance;
  }

  async function seedBanditCampsForZone(zoneId) {
    const [cfg, localeDefs] = await Promise.all([window.BanditCombat.loadGangConfig(), window.BanditCombat.loadCampLocaleDefs()]);
    if (!cfg || !localeDefs.length) { _banditCampInstances.set(zoneId, []); return; }
    if (!_banditCampInstances.has(zoneId)) _banditCampInstances.set(zoneId, []);
    const maxCamps = Math.max(0, Number(cfg.campLifecycle?.maxCampsPerZone ?? 1));
    for (let i = _banditCampInstances.get(zoneId).length; i < maxCamps; i++) {
      const localeDef = localeDefs[Math.floor(deps.rnd() * localeDefs.length)];
      const maxInstances = Number(localeDef.placement?.maxInstances ?? maxCamps);
      const already = _banditCampInstances.get(zoneId).filter(r => r.instance.localeId === localeDef.id).length;
      if (already >= maxInstances) continue;
      await spawnBanditCamp(zoneId, localeDef, cfg);
    }
  }

  // Releases each cleared camp's footprint (restoring the flora it
  // bulldozed) and stamps a fresh one somewhere else in the same zone, with
  // a brand new gang. Only ever called from the zone-(re)entry branch of
  // ensureCurrentZoneBanditCamps.
  async function rerollBanditCamps(zoneId, clearedRecs) {
    const [cfg, localeDefs] = await Promise.all([window.BanditCombat.loadGangConfig(), window.BanditCombat.loadCampLocaleDefs()]);
    if (!cfg || !localeDefs.length) return;
    const view = _banditZoneView(zoneId);
    if (!view) return;
    const tracked = _banditCampInstances.get(zoneId) || [];
    for (const rec of clearedRecs) {
      for (const id of rec.instance.stampedObjectIds) removeBanditCampProp(zoneId, id);
      window.TemporaryLocales.release(view, rec.instance);
      _syncBanditFlora(zoneId, rec.instance.removedObjectSnapshots, true);
      const idx = tracked.indexOf(rec);
      if (idx >= 0) tracked.splice(idx, 1);
    }
    _banditCampInstances.set(zoneId, tracked);
    await seedBanditCampsForZone(zoneId);
  }

  // A Tothal Shift replaces a zone's whole deps.zoneLayouts entry, so the cached
  // adapter view, every camp instance stamped into it, and every tent mesh
  // built from it all describe terrain that no longer exists. Mirrors
  // forgetZoneDenState; the gang itself needs no cleanup here because
  // performTothalShift's clearHostileObjects() already wipes them, and the
  // zone scene is disposed/rebuilt with the tent meshes gone.
  function forgetZoneBanditState(zoneId) {
    _banditCampMeshes.delete(zoneId);
    _banditCampInstances.delete(zoneId);
    _banditZoneViews.delete(zoneId);
    _banditZoneEntryPending.delete(zoneId);
  }

  // Called alongside ensureCurrentZoneDenPacks on the shared zone-tick (see
  // updateHostileSpawning).
  function ensureCurrentZoneBanditCamps() {
    const zoneId = deps.getCurrentArea();
    if (!deps.isZoneArea(zoneId) || zoneId === deps.DEV_ARENA_ZONE_ID) return;
    if (!window.TemporaryLocales) return;
    // Checked before the pending flag is consumed, so a re-entry that lands
    // while a seed/re-roll is still awaiting its config fetches isn't
    // swallowed -- it's still pending on the next tick.
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
  //
  // Mirrors the Den-Mother nest's hold-to-take (NEST_TAKE_HOLD_S /
  // updateNestInteraction): proximity plus the global deps.getActionHeldDown() flag,
  // no action-bar button to arm first, with a progress bar that resets the
  // moment the deps.player steps away or lets go. A tent has two held actions
  // rather than the nest's one, and they're sequential rather than a menu:
  // the first completed hold LOOTS it (grants the tent's supplies and
  // clears interactable.lootable, leaving the tent standing), the second
  // BURNS it (no loot, tent removed from the world). That keeps the nest's
  // one-action-when-near UX exactly as-is while making both authored
  // interactable flags meaningful, and means clearing a camp always
  // requires burning every tent out rather than just rifling through them.
  const BANDIT_TENT_HOLD_S = 4;
  // Computed lazily (not a top-level const) since deps isn't populated
  // until init() runs, which happens well after this module's own
  // script loads.
  function banditTentNearPx() { return deps.TILE * 1.7; }
  let _banditTentHoldT = 0;
  let _banditTentHoldId = null;
  const _tentActionHudEl = document.getElementById('tentActionHud');
  const _tentActionLabelEl = document.getElementById('tentActionLabel');
  const _tentActionFillEl = document.getElementById('tentActionFill');

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

  function burnBanditTent(zoneId, obj) {
    obj.destroyed = true;
    if (obj.interactable) { obj.interactable.lootable = false; obj.interactable.burnable = false; }
    const view = _banditZoneViews.get(zoneId);
    if (view) {
      const idx = view.objects.indexOf(obj);
      if (idx >= 0) view.objects.splice(idx, 1);
      // Hand the tent's tiles back to the instance's own reservation rather
      // than clearing them outright: the whole padded rect still belongs to
      // this camp until release() runs, and nulling these would let a
      // second camp's findSite place itself inside the first one's footprint.
      for (let r = obj.y; r < obj.y + (obj.h || 1); r++) {
        for (let c = obj.x; c < obj.x + (obj.w || 1); c++) {
          if (view.tiles[r]?.[c]?.occupiedBy === obj.id) view.tiles[r][c].occupiedBy = obj.temporaryLocaleInstanceId;
        }
      }
    }
    removeBanditCampProp(zoneId, obj.id);
    deps.showToast('🔥 Burned the bandit tent down.', true);
  }

  function updateBanditTentInteraction(dt) {
    const zoneId = deps.getCurrentArea();
    const tent = deps.isZoneArea(zoneId) ? nearestBanditTent(zoneId) : null;
    if (!tent || !deps.getActionHeldDown()) {
      if (_banditTentHoldT > 0) { _banditTentHoldT = 0; _banditTentHoldId = null; }
      if (_tentActionHudEl?.classList.contains('visible')) _tentActionHudEl.classList.remove('visible');
      return;
    }
    // Walking from one tent to another restarts the hold rather than
    // carrying accumulated progress across to the new one.
    if (_banditTentHoldId !== tent.id) { _banditTentHoldId = tent.id; _banditTentHoldT = 0; }
    const looting = !!tent.interactable?.lootable;
    // The locale authors its own hold duration per tent (interactable.
    // holdSeconds); BANDIT_TENT_HOLD_S is only the fallback.
    const holdS = Number(tent.interactable?.holdSeconds) > 0
      ? Number(tent.interactable.holdSeconds) : BANDIT_TENT_HOLD_S;
    _banditTentHoldT += dt;
    if (_tentActionLabelEl) _tentActionLabelEl.textContent = looting ? 'Looting Tent...' : 'Burning Tent...';
    if (_tentActionFillEl) _tentActionFillEl.style.width = Math.min(100, (_banditTentHoldT / holdS) * 100) + '%';
    _tentActionHudEl?.classList.add('visible');
    if (_banditTentHoldT < holdS) return;
    _banditTentHoldT = 0;
    _banditTentHoldId = null;
    _tentActionHudEl?.classList.remove('visible');
    if (looting) lootBanditTent(zoneId, tent);
    else burnBanditTent(zoneId, tent);
  }

  // ── Corpse loot ───────────────────────────────────────────────────

  // `gold` is a currency, not an ITEM_DEFS entry (see itemsForScroll's
  // explicit filter) -- it has no 99-stack cap and no icon lookup, so it
  // can't go through the ordinary inventory path makeCorpseWorldObject
  // uses for butchering byproducts.
  function grantBanditLoot(gained) {
    const parts = [];
    for (const [key, qty] of Object.entries(gained || {})) {
      if (key === 'gold') {
        inventory.gold = (inventory.gold || 0) + qty;
        parts.push('💰' + qty + 'g');
        continue;
      }
      inventory[key] = Math.min(99, (inventory[key] || 0) + qty);
      clampInventoryStack(key);
      parts.push(itemIconForKey(key) + '×' + qty);
    }
    return parts;
  }

  // deps.getStoreClothingPieces() only lists what the General Store actually
  // stocks, and the bandit pool includes two items it doesn't
  // (tankan_bodywrap, riverlandskasa_low) — both of which are in the
  // account shop catalog with a proper label/price/category, so fall
  // through to that before resorting to prettifying the raw id.
  function _banditClothingPiece(cosmeticId, rolledSlot) {
    const store = deps.getStoreClothingPieces().find(p => p.id === cosmeticId);
    if (store) return store;
    const shop = (window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || []).find(i => i.id === cosmeticId);
    if (shop) return { id: cosmeticId, label: shop.label, category: shop.category || rolledSlot, usesB: false, price: shop.price ?? 40 };
    const pretty = cosmeticId.split('::').pop().replace(/[_-]+/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
    return { id: cosmeticId, label: pretty, category: rolledSlot, usesB: false, price: 40 };
  }

  // Rebuilds each worn cosmetic as a deps.getPackClothing() entry -- the exact same
  // owned-clothing storage a treasure chest's `clothing` bundle grants
  // through (see makeTreasureChestObject), so a looted bandit's gear shows
  // up in the pack and can be worn/sold like any other clothing item.
  // Cosmetics are not ITEM_DEFS inventory keys, so there is no other path.
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

  // Same { getButtons(), onAction() } shape as makeCorpseWorldObject, which
  // branches here for bandits -- so getCorpseObjectAt and the action bar
  // need no bandit-specific dispatch of their own.
  function makeBanditCorpseWorldObject(c) {
    return {
      id: 'corpse_' + c.id,
      type: 'bandit_corpse',
      getButtons() {
        return [{ icon: '🪙', label: 'Loot ' + (c.name || c.def.label), action: 'obj_loot_corpse', style: 'primary', allowed: true }];
      },
      onAction(action) {
        if (action !== 'obj_loot_corpse') return { ok: false, message: 'Unknown action.' };
        const parts = grantBanditLoot(deps.rollLootPool(c.def.lootPool));
        const specialAmmo = window.RangedWeapons?.rollSpecialAmmoLoot?.() || 0; // Bandits share the same high-chance 0/8 special-ammo resource drop as wildlife.
        if (specialAmmo) parts.push(`🏹 Special Ammo×${specialAmmo}`);
        // 100% of what they were wearing, on top of the rolled table.
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
    forgetZoneState: forgetZoneBanditState,
    ensureCurrentZoneCamps: ensureCurrentZoneBanditCamps,
    updateTentInteraction: updateBanditTentInteraction,
    makeCorpseWorldObject: makeBanditCorpseWorldObject,
    // Marks a zone as just (re-)entered — the one moment
    // ensureCurrentZoneCamps is allowed to release and re-stamp a cleared
    // camp. Called by game.js's enterZone.
    markZoneEntered: (zoneId) => _banditZoneEntryPending.add(zoneId),
    // Interrupts an in-progress tent loot/burn hold — called by game.js's
    // damagePlayer, mirroring how getting hit also interrupts a den-nest
    // egg/baby take (_nestHoldT).
    interruptTentHold: () => { _banditTentHoldT = 0; },
    get campInstances() { return _banditCampInstances; },
    get perceivedThreats() { return _perceivedThreats; },
  };
})();
