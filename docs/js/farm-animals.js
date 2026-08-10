(() => {
  'use strict';

  // Farm livestock: barn day/night homing, daytime station-wander AI, the
  // per-species animal factories (uumkao'ii + pattern-layer species),
  // adding/housing/collecting livestock, the milking/venom/stink-oil
  // harvest interaction, breeding, and the per-frame animal mesh update.
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern already used by js/wild-treasure.js and
  // js/dew-vats.js. Generic furniture chair-sitting sat interleaved in the
  // same game.js section (resolveSeatWorldTransform/beginSitInteraction/
  // endSitInteraction/updateSitInteraction/makeSitInteractable — nothing
  // livestock-specific) and stayed behind in game.js rather than being
  // dragged along here; it still needs to know whether a harvest
  // interaction is in progress (to block sitting), so that's exposed via
  // isHarvesting(). LIVESTOCK_ITEM_KINDS/DEN_MOTHER_DEFS/DEN_MOTHER_ITEM_KEYS
  // stay declared in game.js (both are read from outside this system too —
  // the Inventory panel and the wild den-mother nest system respectively)
  // and are threaded through as plain deps instead. grid/farmBuildings/
  // stable/currentArea/BARN_TIERS/_playerData are all reassigned wholesale
  // at various points in game.js, so they're threaded through as getters
  // rather than captured references, same reasoning as js/dye-system.js's
  // gearInventory getter. activeCameraMode/activeCameraTarget/facingAngle
  // are both read AND written here (the harvest interaction zooms the
  // camera in and restores it after), so those three get getter+setter
  // pairs instead.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function canSpawnAt(col, row) {
    const grid = deps.getGrid();
    const tile = grid[row]?.[col];
    if (!tile || deps.getWorldObjectAt(col, row)) return false;
    if (tile.crop || deps.isSolid(tile.type) || tile.type === deps.TileType.TRENCH || tile.type === deps.TileType.RIVER || tile.type === deps.TileType.STREAM) return false;
    return true;
  }

  // ── Barn day/night + resource collection, shared by every farm-
  // livestock factory (makeUumkaoiiAnimal, makePatternLivestockAnimal).
  // At night, an animal assigned to a barn walks toward it and "goes
  // inside" (hidden + its tile freed) until morning, when it re-emerges
  // beside the barn. Unassigned (stasis) livestock never spawn at all
  // (see addFromItem), so this only ever runs for housed ones.
  function _farmAnimalBarnTick(animal) {
    const night = window.Music?.isNightTime();
    if (animal._barnHome) {
      if (!night) _farmAnimalWakeUp(animal);
      return true;
    }
    const rec = deps.loadWorldLivestock().find(l => l.id === animal.livestockId);
    const farmBuildings = deps.getFarmBuildings();
    const barn = rec?.barnId ? farmBuildings.find(b => b.id === rec.barnId && b.kind === 'barn') : null;
    if (!night || !barn) return false; // no barn, or daytime — fall through to normal wander
    _farmAnimalStepTowardBarn(animal, barn);
    return true;
  }

  // Takes exactly one greedy tile-hop toward (targetCol,targetRow) —
  // shared by barn-homing (_farmAnimalStepTowardBarn) and daytime
  // station-wander (_farmAnimalWanderTick) so there's one place that
  // knows how to move an animal one tile, instead of two hand-copies.
  // Prefers the diagonal-ish direction first, then straightens out along
  // whichever single axis still has distance left, then (if fully
  // blocked) tries every other cardinal direction rather than giving up
  // immediately — onStep, if given, runs after a successful hop with the
  // tile the animal just left (uumkao'ii's dew-pile drop uses this).
  // Returns true if it actually moved, false if every direction was
  // blocked (caller decides what "stuck" means for it).
  function _farmAnimalStepToward(animal, targetCol, targetRow, onStep, isBlocked) {
    const dc = Math.sign(targetCol - animal.col), dr = Math.sign(targetRow - animal.row);
    const dirs = [{ dc, dr }, { dc, dr: 0 }, { dc: 0, dr }, { dc: 1, dr: 0 }, { dc: -1, dr: 0 }, { dc: 0, dr: 1 }, { dc: 0, dr: -1 }]
      .filter(d => d.dc || d.dr);
    for (const d of dirs) {
      const nc = animal.col + d.dc, nr = animal.row + d.dr;
      if (nc < 0 || nc >= deps.COLS || nr < 0 || nr >= deps.ROWS) continue;
      if (!canSpawnAt(nc, nr)) continue;
      if (isBlocked?.(nc, nr)) continue;
      const oldCol = animal.col, oldRow = animal.row;
      deps.worldObjects.delete(animal.col + ',' + animal.row);
      animal.col = nc; animal.row = nr; animal.targetCol = nc; animal.targetRow = nr;
      deps.worldObjects.set(nc + ',' + nr, animal);
      animal.targetRot = -Math.atan2(d.dr, d.dc) + Math.PI / 2;
      onStep?.(oldCol, oldRow);
      return true;
    }
    return false;
  }

  // A barn's rendered structure (roof eaves, foundation slab) visually
  // extends past its own reserved w×h footprint tiles, so a wandering
  // animal standing on the tile immediately outside that footprint can
  // still end up rendered behind/underneath the barn from the camera —
  // effectively invisible despite never having stepped onto an occupied
  // tile. This is the same 1-tile "personal space" ring the night
  // barn-homing walk already uses to decide when it's close enough to
  // go inside (see _farmAnimalStepTowardBarn's own touchingBarn check
  // below) — station-wander reuses it too so daytime wandering can never
  // park an animal somewhere that visual overlap could hide it.
  function _tileTouchesAnyBarn(col, row) {
    for (const barn of deps.getFarmBuildings()) {
      if (col >= barn.col - 1 && col <= barn.col + barn.w && row >= barn.row - 1 && row <= barn.row + barn.h) return true;
    }
    return false;
  }

  function _farmAnimalStepTowardBarn(animal, barn) {
    const cx = barn.col + barn.w / 2, cz = barn.row + barn.h / 2;
    const touchingBarn = animal.col >= barn.col - 1 && animal.col <= barn.col + barn.w
      && animal.row >= barn.row - 1 && animal.row <= barn.row + barn.h;
    if (touchingBarn) {
      deps.worldObjects.delete(animal.col + ',' + animal.row);
      animal.avatarRef.group.visible = false;
      animal._barnHome = true;
      return;
    }
    _farmAnimalStepToward(animal, Math.round(cx - 0.5), Math.round(cz - 0.5));
  }

  // ── Daytime station wander ───────────────────────────────────────────
  // Replaces the old "re-roll a brand new random direction almost every
  // tick" wander (which produced visible jitter/reversal, since a fresh
  // decision could interrupt a hop that hadn't even finished lerping
  // yet), with something closer to NPC scheduling: pick one random nearby
  // tile as a "station", walk there one tile at a time (never starting
  // the next hop until the previous one has visually finished), rest
  // there for a random duration, then pick a new station and repeat.
  // Bounded to a radius around the animal's own spawn tile (its "pen",
  // even though there's no literal fence data) rather than its current
  // position, so repeated station-hops can't slowly drift it across the
  // whole farm.
  const FARM_ANIMAL_WANDER_RADIUS_TILES = 5;
  const FARM_ANIMAL_WANDER_WAIT_MIN_SEC = 2;
  const FARM_ANIMAL_WANDER_WAIT_MAX_SEC = 6;

  function _farmAnimalPickWanderTarget(animal) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const dc = Math.round((deps.rnd() * 2 - 1) * FARM_ANIMAL_WANDER_RADIUS_TILES);
      const dr = Math.round((deps.rnd() * 2 - 1) * FARM_ANIMAL_WANDER_RADIUS_TILES);
      if (!dc && !dr) continue;
      const nc = animal.homeCol + dc, nr = animal.homeRow + dr;
      if (nc < 0 || nc >= deps.COLS || nr < 0 || nr >= deps.ROWS) continue;
      if (!canSpawnAt(nc, nr) || _tileTouchesAnyBarn(nc, nr)) continue;
      animal.wanderTargetCol = nc;
      animal.wanderTargetRow = nr;
      return;
    }
    // Pen's momentarily crowded/blocked in every sampled spot — try
    // again shortly instead of re-rolling every single tick.
    animal.wanderWaitT = 0.5 + deps.rnd() * 0.5;
  }

  function _farmAnimalWanderTick(animal, dt, onStep) {
    if (animal.wanderWaitT > 0) { animal.wanderWaitT -= dt; return; }
    if (animal.wanderTargetCol == null) { _farmAnimalPickWanderTarget(animal); return; }
    if (animal.col === animal.wanderTargetCol && animal.row === animal.wanderTargetRow) {
      // Reached the station tile — rest here before picking a new one.
      animal.wanderTargetCol = null;
      animal.wanderTargetRow = null;
      animal.wanderWaitT = FARM_ANIMAL_WANDER_WAIT_MIN_SEC
        + deps.rnd() * (FARM_ANIMAL_WANDER_WAIT_MAX_SEC - FARM_ANIMAL_WANDER_WAIT_MIN_SEC);
      return;
    }
    // Only take the next hop once the previous one has actually finished
    // lerping into place (same arrival epsilon update() uses for its own
    // idle-facing check) — this, not a throttle/chance roll, is what
    // stops a new decision from ever interrupting a hop mid-stride.
    const arrived = Math.abs(animal.wx - (animal.targetCol + 0.5)) < 0.04
      && Math.abs(animal.wz - (animal.targetRow + 0.5)) < 0.04;
    if (!arrived) return;
    if (_farmAnimalStepToward(animal, animal.wanderTargetCol, animal.wanderTargetRow, onStep, _tileTouchesAnyBarn)) {
      animal._wanderPath = null;
      return;
    }
    // The direct/greedy hop is fully blocked (e.g. a barn now sits between
    // here and the station) — try a real grid path around it before giving
    // up on this station outright. Cheap: only runs once movement actually
    // stalls, and is bounded to a small local box since farm wander targets
    // are always nearby (see FARM_ANIMAL_WANDER_RADIUS_TILES).
    if (!animal._wanderPath || !animal._wanderPath.length) {
      const isWalkable = (c, r) => canSpawnAt(c, r) && !_tileTouchesAnyBarn(c, r);
      const path = window.TilePathfinding?.findPath(animal.col, animal.row, animal.wanderTargetCol, animal.wanderTargetRow, isWalkable, {
        bounds: window.TilePathfinding.boxAround(animal.col, animal.row, animal.wanderTargetCol, animal.wanderTargetRow, 5),
      });
      if (path && path.length) animal._wanderPath = path;
    }
    if (animal._wanderPath && animal._wanderPath.length) {
      const hop = animal._wanderPath[0];
      if (_farmAnimalStepToward(animal, hop.col, hop.row, onStep, _tileTouchesAnyBarn)) {
        animal._wanderPath.shift();
        return;
      }
    }
    // Still nothing — give up on this station and rest briefly before
    // trying a new one, rather than spinning in place.
    animal._wanderPath = null;
    animal.wanderTargetCol = null;
    animal.wanderTargetRow = null;
    animal.wanderWaitT = 0.5 + deps.rnd() * 0.5;
  }

  function _farmAnimalWakeUp(animal) {
    const rec = deps.loadWorldLivestock().find(l => l.id === animal.livestockId);
    const farmBuildings = deps.getFarmBuildings();
    const barn = rec?.barnId ? farmBuildings.find(b => b.id === rec.barnId && b.kind === 'barn') : null;
    const spot = (barn && deps.findOpenTileNearBarn(barn)) || (canSpawnAt(animal.col, animal.row) ? { col: animal.col, row: animal.row } : null);
    if (!spot) return; // no room to emerge yet — stay home another tick
    animal.col = spot.col; animal.row = spot.row; animal.targetCol = spot.col; animal.targetRow = spot.row;
    animal.wx = spot.col + 0.5; animal.wz = spot.row + 0.5;
    // Re-centers the station-wander pen on wherever it actually emerges
    // beside its barn each morning, not its original (possibly far-off)
    // spawn tile, and drops any stale station target/rest timer left
    // over from before it went inside for the night.
    animal.homeCol = spot.col; animal.homeRow = spot.row;
    animal.wanderTargetCol = null; animal.wanderTargetRow = null; animal.wanderWaitT = 0;
    deps.worldObjects.set(spot.col + ',' + spot.row, animal);
    animal.avatarRef.group.visible = true;
    animal._barnHome = false;
  }

  function _farmAnimalGetButtons(animal, label, icon) {
    const rec = deps.loadWorldLivestock().find(l => l.id === animal.livestockId);
    const resDef = rec ? deps.LIVESTOCK_RESOURCE_DEFS[rec.kind] : null;
    if (rec?.resourceReady && resDef) {
      const itemLabel = deps.ITEM_DEFS[resDef.itemKey]?.label || resDef.itemKey;
      const verb = deps.LIVESTOCK_RESOURCE_VERB[rec.kind] || 'Collect';
      return [{ icon: deps.ITEM_DEFS[resDef.itemKey]?.icon || icon, label: `${verb} ${itemLabel}`, action: 'obj_collect_' + animal.id, style: 'primary', allowed: true }];
    }
    return [{ icon, label, action: 'obj_' + animal.id, style: 'secondary', allowed: false }];
  }

  function _farmAnimalOnAction(animal, action, fallbackMessage) {
    if (action === 'obj_collect_' + animal.id) {
      const rec = deps.loadWorldLivestock().find(l => l.id === animal.livestockId);
      const resDef = rec ? deps.LIVESTOCK_RESOURCE_DEFS[rec.kind] : null;
      if (resDef?.interactive) { beginHarvestInteraction(animal); return { ok: true }; }
      return collectResource(animal.livestockId);
    }
    return { ok: false, message: fallbackMessage };
  }

  function makeUumkaoiiAnimal(col, row, livestockId, genotype) {
    const ANIMAL_W = 1.275;
    const ANIMAL_H = ANIMAL_W * (451 / 641); // sprite is 641x451 px
    const sizeScale = window.CreatureGenetics.creatureSizeScale('uumkaoii', genotype); // Uses the Animation Author's class-specific proportions.
    const halfH = ANIMAL_H * sizeScale.y / 2; // Grounds the visibly scaled farm animal.

    const spriteUrl = "assets/creaturesprites/uumkao'ii.png";
    const avatarRef = window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(THREE, spriteUrl, {
      modelWidth: ANIMAL_W, modelHeight: ANIMAL_H,
      name: 'uumkaoii_' + col + '_' + row,
    });
    avatarRef.frontPlane = avatarRef.group.children[0] || null;
    avatarRef.backPlane  = avatarRef.group.children[1] || null;
    avatarRef.group.scale.set(sizeScale.x, sizeScale.y, 1);

    const grid = deps.getGrid();
    const initSurfY = deps.tileSurfaceY(grid[row][col].type);
    avatarRef.group.position.set(col + 0.5, initSurfY + halfH, row + 0.5);
    avatarRef.group.rotation.y = Math.PI / 2; // start facing east
    deps._markPngPlane(avatarRef.group);
    deps.scene.add(avatarRef.group);
    // Ground-anchor the visible art on its own real opaque bottom pixel
    // (see makeCreatureEntity/creaturePlaneGroundOffset) instead of the
    // raw sprite rectangle's edge, without moving the prism itself --
    // shoulderGrip/saddle attachment anchors are authored relative to
    // the prism's own frame, so leaving it untouched (only the plane
    // meshes shift within it) keeps them landing on the exact same
    // pixels regardless of this correction.
    deps.resolveCreatureGroundAnchorRatio(spriteUrl, (bottomRatio) => {
      const offsetY = deps.creaturePlaneGroundOffset(ANIMAL_H, bottomRatio);
      if (avatarRef.frontPlane) avatarRef.frontPlane.position.y = offsetY;
      if (avatarRef.backPlane) avatarRef.backPlane.position.y = offsetY;
    });

    // Composites the always-on fur+plates layers onto the plain base —
    // see CreatureGeneticsRender.SPECIES.uumkaoii and makeDefaultGenotype's
    // uumkaoii branch. Mirrors makePatternLivestockAnimal's one-shot
    // idle-only composite below (a farm animal never runs, so there's no
    // per-frame retry loop to wire up the way the wild/companion
    // CREATURE_DB path needs via updateCreatureAnimFrame).
    if (genotype && window.CreatureGeneticsRender) {
      window.CreatureGeneticsRender.composeFrame('uumkaoii', 'idle', genotype).then(canvas => {
        if (!canvas) return;
        const frontTex = new THREE.CanvasTexture(canvas); frontTex.colorSpace = THREE.SRGBColorSpace;
        const backTex = new THREE.CanvasTexture(canvas); backTex.colorSpace = THREE.SRGBColorSpace;
        backTex.wrapS = THREE.RepeatWrapping; backTex.repeat.set(-1, 1); backTex.offset.set(1, 0);
        for (const child of avatarRef.group.children) {
          if (!child.material) continue;
          if (child.name.endsWith('_front_plane')) { child.material.map = frontTex; child.material.needsUpdate = true; }
          else if (child.name.endsWith('_back_plane')) { child.material.map = backTex; child.material.needsUpdate = true; }
        }
      }).catch(() => {});
    }

    const animal = {
      id: 'uumkaoii_' + col + '_' + row + '_' + (performance.now() | 0),
      livestockId: livestockId || ('livestock_' + Math.random().toString(36).slice(2, 10)),
      type: 'animal', animalKey: 'uumkaoii', genotype,
      col, row, targetCol: col, targetRow: row,
      homeCol: col, homeRow: row, // station-wander pen center — see _farmAnimalWanderTick
      wanderTargetCol: null, wanderTargetRow: null, wanderWaitT: 0,
      wx: col + 0.5, wz: row + 0.5, wy: initSurfY + halfH,
      halfHeight: halfH, avatarRef,
      groupRot: Math.PI / 2, targetRot: Math.PI / 2,
      perpState: {},

      getButtons() {
        return _farmAnimalGetButtons(this, "Uumkao’ii", '\u{1F986}');
      },
      onAction(action) {
        return _farmAnimalOnAction(this, action, "The uumkao’ii ignores you.");
      },
      tick(dt) {
        if (this._harvestFrozen) return;
        if (_farmAnimalBarnTick(this)) return;
        // Drops a persistent dew pile on whichever tile a station-wander
        // hop happens to leave next, once this uumkao'ii's dew cooldown
        // has reset (see window.DewVats.drop) — opportunistic rather than
        // urgent, since the wander cycle already produces hops regularly
        // enough.
        _farmAnimalWanderTick(this, dt || 0, (oldCol, oldRow) => {
          const livestockList = deps.loadWorldLivestock();
          const rec = livestockList.find(l => l.id === this.livestockId);
          if (rec?.dewReady && window.DewVats.drop(oldCol, oldRow, rec.dewColor || deps.UUMKAOII_DEFAULT_DEW_COLOR)) {
            rec.dewReady = false;
            rec.dewDaysUntil = deps.UUMKAOII_DEW_COOLDOWN_DAYS;
            rec.dewReadyStaleDays = 0;
            deps.saveWorldLivestock(livestockList);
          }
        });
      },
      update(dt) {
        const tx = this.targetCol + 0.5, tz = this.targetRow + 0.5;
        const grid = deps.getGrid();
        const tile = grid[this.targetRow]?.[this.targetCol];
        const ty = tile ? deps.tileSurfaceY(tile.type) + this.halfHeight : this.wy;
        const sp = Math.min(1, dt * 4);
        this.wx += (tx - this.wx) * sp;
        this.wz += (tz - this.wz) * sp;
        this.wy += (ty - this.wy) * sp;
        this.wy += Math.sin(performance.now() / 420 + this.targetCol * 1.3) * 0.006;
        this.avatarRef.group.position.set(this.wx, this.wy, this.wz);

        // Once it's settled at its target tile (not mid-hop), an animal has no
        // specific direction to look — let it rest broadside to the camera.
        const idle = Math.abs(tx - this.wx) < 0.02 && Math.abs(tz - this.wz) < 0.02;
        const lookTarget = idle ? deps.nearestAngleAmong(this.groupRot, deps.cameraRelativePerps()) : this.targetRot;
        const { effectiveTarget, snapTo } = deps.perpClamp(this.perpState, lookTarget, deps.cameraRelativeCreaturePerps(), deps.CREATURE_PERP_DEAD_RAD);
        if (snapTo !== null) this.groupRot = effectiveTarget;
        else this.groupRot += deps.angleDiff(effectiveTarget, this.groupRot) * 0.18;
        this.avatarRef.group.rotation.y = this.groupRot;
      },
      reset() {
        deps.scene.remove(avatarRef.group);
        avatarRef.dispose();
      },
    };
    return animal;
  }

  // Farm-display width per pattern-layer livestock species — deliberately
  // its own scale from CREATURE_DB's wild-creature modelWidth (a farm
  // pen animal reads better a bit smaller/denser than its full-size wild
  // counterpart), so it can't just read CREATURE_DB[kind].modelWidth
  // directly. A kind missing here falls back to dabinggi-hound's 1.7
  // rather than silently mis-sizing — add an entry for any new
  // pattern-layer species instead of expanding a size ternary.
  const LIVESTOCK_ANIMAL_WIDTH = window.SCRATCHBONES_CONFIG?.game?.livestock?.animalWidths || {};

  // Pattern-layer species (gar-wolf, dabinggi-hound) as placeable farm
  // livestock — same tile-hopping wander/no-combat shape as
  // makeUumkaoiiAnimal, but with its genotype actually rendered via
  // creature-genetics-render.js's recolor+composite pipeline (falls
  // back to the plain uncolored sprite, already loaded synchronously
  // below, until that async compose resolves).
  function makePatternLivestockAnimal(kind, label, icon, col, row, livestockId, genotype) {
    const ANIMAL_W = LIVESTOCK_ANIMAL_WIDTH[kind] || 1.7;
    const ANIMAL_H = ANIMAL_W * (deps.CREATURE_DB[kind]?.spriteAspect || (600 / 1375));
    const sizeScale = window.CreatureGenetics.creatureSizeScale(kind, genotype); // Uses the Animation Author's class-specific proportions.
    const halfH = ANIMAL_H * sizeScale.y / 2; // Grounds the visibly scaled farm animal.
    const baseUrl = window.CreatureGeneticsRender?.SPECIES?.[kind]?.base?.idle || `assets/creaturesprites/${kind}_idle.png`;

    const avatarRef = window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(THREE, baseUrl, {
      modelWidth: ANIMAL_W, modelHeight: ANIMAL_H,
      name: kind.replace(/-/g, '_') + '_' + col + '_' + row,
    });
    avatarRef.frontPlane = avatarRef.group.children[0] || null;
    avatarRef.backPlane  = avatarRef.group.children[1] || null;
    avatarRef.group.scale.set(sizeScale.x, sizeScale.y, 1);

    const grid = deps.getGrid();
    const initSurfY = deps.tileSurfaceY(grid[row][col].type);
    avatarRef.group.position.set(col + 0.5, initSurfY + halfH, row + 0.5);
    avatarRef.group.rotation.y = Math.PI / 2; // start facing east
    deps._markPngPlane(avatarRef.group);
    deps.scene.add(avatarRef.group);
    // Ground-anchor on the sprite's own real opaque bottom pixel (see
    // makeCreatureEntity/creaturePlaneGroundOffset) rather than the raw
    // sprite rectangle's edge, without moving the prism itself -- a
    // genotype recolor (composed further below) only changes color, not
    // the base silhouette, so scanning baseUrl stays correct regardless
    // of genotype, and leaving the prism untouched keeps this species'
    // shoulderGrip/saddle attachment anchors (authored relative to the
    // prism, and shared with the wild/companion creature path for the
    // same kind) landing on the exact same pixels as before.
    deps.resolveCreatureGroundAnchorRatio(baseUrl, (bottomRatio) => {
      const offsetY = deps.creaturePlaneGroundOffset(ANIMAL_H, bottomRatio);
      if (avatarRef.frontPlane) avatarRef.frontPlane.position.y = offsetY;
      if (avatarRef.backPlane) avatarRef.backPlane.position.y = offsetY;
    });

    if (genotype && window.CreatureGeneticsRender) {
      window.CreatureGeneticsRender.composeFrame(kind, 'idle', genotype).then(canvas => {
        if (!canvas) return;
        const frontTex = new THREE.CanvasTexture(canvas); frontTex.colorSpace = THREE.SRGBColorSpace;
        const backTex = new THREE.CanvasTexture(canvas); backTex.colorSpace = THREE.SRGBColorSpace;
        backTex.wrapS = THREE.RepeatWrapping; backTex.repeat.set(-1, 1); backTex.offset.set(1, 0);
        for (const child of avatarRef.group.children) {
          if (!child.material) continue;
          if (child.name.endsWith('_front_plane')) { child.material.map = frontTex; child.material.needsUpdate = true; }
          else if (child.name.endsWith('_back_plane')) { child.material.map = backTex; child.material.needsUpdate = true; }
        }
      }).catch(() => {});
    }

    const animal = {
      id: kind + '_' + col + '_' + row + '_' + (performance.now() | 0),
      livestockId: livestockId || ('livestock_' + Math.random().toString(36).slice(2, 10)),
      type: 'animal', animalKey: kind, genotype,
      col, row, targetCol: col, targetRow: row,
      homeCol: col, homeRow: row, // station-wander pen center — see _farmAnimalWanderTick
      wanderTargetCol: null, wanderTargetRow: null, wanderWaitT: 0,
      wx: col + 0.5, wz: row + 0.5, wy: initSurfY + halfH,
      halfHeight: halfH, avatarRef,
      groupRot: Math.PI / 2, targetRot: Math.PI / 2,
      perpState: {},

      getButtons() {
        return _farmAnimalGetButtons(this, label, icon);
      },
      onAction(action) {
        return _farmAnimalOnAction(this, action, `The ${label.toLowerCase()} ignores you.`);
      },
      tick(dt) {
        if (this._harvestFrozen) return;
        if (_farmAnimalBarnTick(this)) return;
        _farmAnimalWanderTick(this, dt || 0);
      },
      update(dt) {
        const tx = this.targetCol + 0.5, tz = this.targetRow + 0.5;
        const grid = deps.getGrid();
        const tile = grid[this.targetRow]?.[this.targetCol];
        const ty = tile ? deps.tileSurfaceY(tile.type) + this.halfHeight : this.wy;
        const sp = Math.min(1, dt * 4);
        this.wx += (tx - this.wx) * sp;
        this.wz += (tz - this.wz) * sp;
        this.wy += (ty - this.wy) * sp;
        this.wy += Math.sin(performance.now() / 420 + this.targetCol * 1.3) * 0.006;
        this.avatarRef.group.position.set(this.wx, this.wy, this.wz);

        const idle = Math.abs(tx - this.wx) < 0.02 && Math.abs(tz - this.wz) < 0.02;
        const lookTarget = idle ? deps.nearestAngleAmong(this.groupRot, deps.cameraRelativePerps()) : this.targetRot;
        const { effectiveTarget, snapTo } = deps.perpClamp(this.perpState, lookTarget, deps.cameraRelativeCreaturePerps(), deps.CREATURE_PERP_DEAD_RAD);
        if (snapTo !== null) this.groupRot = effectiveTarget;
        else this.groupRot += deps.angleDiff(effectiveTarget, this.groupRot) * 0.18;
        this.avatarRef.group.rotation.y = this.groupRot;
      },
      reset() {
        deps.scene.remove(avatarRef.group);
        avatarRef.dispose();
      },
    };
    return animal;
  }
  function makeGarWolfAnimal(col, row, livestockId, genotype) {
    return makePatternLivestockAnimal('gar-wolf', 'Gar-wolf', '🐺', col, row, livestockId, genotype);
  }
  function makeDabinggiHoundAnimal(col, row, livestockId, genotype) {
    return makePatternLivestockAnimal('dabinggi-hound', 'Dabinggi-hound', '🐕', col, row, livestockId, genotype);
  }
  function makeGrehlrAnimal(col, row, livestockId, genotype) {
    return makePatternLivestockAnimal('grehlr', 'Grehlr', '🐾', col, row, livestockId, genotype);
  }
  function makeDrenkirraAnimal(col, row, livestockId, genotype) {
    return makePatternLivestockAnimal('drenkirra', 'Drenkirra', '🪿', col, row, livestockId, genotype);
  }

  // Livestock kind → factory, so restoring saved livestock on world load
  // can dispatch by kind without hardcoding uumkao'ii — the array this
  // reads is meant to grow into other livestock types later.
  const LIVESTOCK_FACTORIES = { uumkaoii: makeUumkaoiiAnimal, 'gar-wolf': makeGarWolfAnimal, 'dabinggi-hound': makeDabinggiHoundAnimal, grehlr: makeGrehlrAnimal, drenkirra: makeDrenkirraAnimal };

  // itemKey -> FIFO queue of genotypes carried by not-yet-hatched units of
  // that item — populated when a Den-Mother's nest grants an egg/baby
  // (see game.js's updateNestInteraction), so the resulting
  // livestock/companion shares its pack's exact genes instead of rolling
  // a fresh random one. Not persisted: this only bridges "just took it
  // from the nest" to "added it to the farm/stable this same session" —
  // a stack of eggs carried across a save/reload falls back to a fresh
  // roll, same as any item whose instance-level data isn't part of the
  // save format.
  const _pendingLivestockGenotypes = {};
  function queueItemGenotype(itemKey, genotype) {
    if (!genotype) return;
    (_pendingLivestockGenotypes[itemKey] || (_pendingLivestockGenotypes[itemKey] = [])).push(genotype);
    window.__farmLog?.(`[genotype] queued a carried genotype for ${itemKey} (${_pendingLivestockGenotypes[itemKey].length} pending)`, 'wildlife');
  }
  function _consumeLivestockItemGenotype(itemKey) {
    const genotype = _pendingLivestockGenotypes[itemKey]?.shift() || null;
    window.__farmLog?.(`[genotype] addFromItem/addToStable(${itemKey}): ${genotype ? 'used a carried genotype from the nest queue' : 'no carried genotype pending — rolling a fresh one'}`, 'wildlife');
    return genotype;
  }

  // Adds a creature from an undeployed crate item to the farm's
  // livestock — the only way to do so now (see the Farm tab's Livestock
  // panel). Previously this fired directly off "using" the item on a
  // targeted tile with no ownership check; it's now gated behind the
  // 'livestock' farmhand permission like every other farm-alteration
  // action, and always picks its own open tile rather than a reticle
  // target, since it's invoked from the menu rather than the world.
  // Adding livestock no longer spawns it directly — with barns in the
  // picture, a released creature starts unassigned ("stasis": no world
  // presence, resource cooldown paused) until assigned to a built barn
  // with an open slot from the Farm tab's Livestock panel (see
  // assignToBarn), which is what actually spawns it.
  function addFromItem(itemKey) {
    if (!deps.hasFarmPermission('livestock')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can add livestock." };
    const kind = deps.LIVESTOCK_ITEM_KINDS[itemKey];
    if (!kind) return { ok: false, message: 'That item cannot be added to the farm.' };
    if ((deps.inventory[itemKey] || 0) < 1) return { ok: false, message: 'None of that item in bag.' };
    const genotype = _consumeLivestockItemGenotype(itemKey) || window.CreatureGenetics.makeDefaultGenotype(kind);
    deps.inventory[itemKey]--;
    deps.clampInventoryStack(itemKey);
    // Livestock belongs to the world, not this character — persisted
    // separately from saveMemberWorldData() so it stays behind for
    // anyone who plays this world, not just whoever added it.
    const livestock = deps.loadWorldLivestock();
    const id = 'livestock_' + Math.random().toString(36).slice(2, 10);
    livestock.push({
      id, kind, barnId: null, releasedAt: Date.now(),
      name: window.CreatureGenetics.defaultLivestockName(kind), genotype,
      daysUntilResource: deps.LIVESTOCK_RESOURCE_DEFS[kind]?.cooldownDays ?? null, resourceReady: false,
      ...(kind === 'uumkaoii' ? { dewColor: deps.UUMKAOII_DEFAULT_DEW_COLOR, dewDaysUntil: deps.UUMKAOII_DEW_COOLDOWN_DAYS, dewReady: false } : {}),
    });
    deps.saveWorldLivestock(livestock);
    return { ok: true, message: `🦆 ${window.CreatureGenetics.defaultLivestockName(kind)} is waiting in stasis — assign it to a barn from the Farm tab to bring it out.` };
  }

  // Assigns unhoused (or re-homes already-housed) livestock to a built
  // barn with an open slot — this is what actually spawns it into the
  // world; see addFromItem/demolishBarn/unassignFromBarn for the other
  // transitions in/out of stasis.
  function assignToBarn(livestockId, barnId) {
    if (!deps.hasFarmPermission('livestock')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    const farmBuildings = deps.getFarmBuildings();
    const barn = farmBuildings.find(b => b.id === barnId && b.kind === 'barn' && b.stage === 'built');
    if (!barn) return { ok: false, message: 'That barn is not built yet.' };
    const list = deps.loadWorldLivestock();
    const rec = list.find(l => l.id === livestockId);
    if (!rec) return { ok: false, message: 'Livestock not found.' };
    if (rec.barnId === barnId) return { ok: true, message: `${rec.name} is already housed there.` };
    const tier = deps.getBarnTiers()[barn.tier];
    const occupants = list.filter(l => l.barnId === barnId).length;
    if (occupants >= tier.slots) return { ok: false, message: `${tier.label} is full (${tier.slots} slots).` };
    const wasAssigned = !!rec.barnId;
    rec.barnId = barnId;
    if (rec.daysUntilResource == null) rec.daysUntilResource = deps.LIVESTOCK_RESOURCE_DEFS[rec.kind]?.cooldownDays ?? null;
    if (rec.kind === 'uumkaoii' && rec.dewDaysUntil == null) {
      rec.dewColor = rec.dewColor || deps.UUMKAOII_DEFAULT_DEW_COLOR;
      rec.dewDaysUntil = deps.UUMKAOII_DEW_COOLDOWN_DAYS;
      rec.dewReady = false;
    }
    deps.saveWorldLivestock(list);
    if (!wasAssigned) {
      const spot = deps.findOpenTileNearBarn(barn);
      if (spot) {
        const factory = LIVESTOCK_FACTORIES[rec.kind];
        const animal = factory ? factory(spot.col, spot.row, rec.id, rec.genotype) : null;
        if (animal) { deps.worldObjects.set(spot.col + ',' + spot.row, animal); deps.animalObjects.add(animal); }
      }
    }
    return { ok: true, message: `${rec.name} assigned to the ${tier.label}.` };
  }

  // Sends a housed animal back to stasis — despawns it if currently in
  // the world, pauses its resource cooldown, but keeps the record (and
  // its genotype/name) so re-assigning it later just picks up again.
  function unassignFromBarn(livestockId) {
    if (!deps.hasFarmPermission('livestock')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    const list = deps.loadWorldLivestock();
    const rec = list.find(l => l.id === livestockId);
    if (!rec) return { ok: false, message: 'Livestock not found.' };
    rec.barnId = null;
    rec.assignedVatId = null; // can't work a vat while unhoused — same gate as dew/egg cooldowns
    deps.saveWorldLivestock(list);
    const animal = [...deps.animalObjects].find(a => a.livestockId === livestockId);
    if (animal) { deps.worldObjects.delete(animal.col + ',' + animal.row); deps.animalObjects.delete(animal); animal.reset && animal.reset(); }
    return { ok: true, message: `${rec.name} moved to stasis.` };
  }

  // Gives the ready resource item and resets the cooldown — called from
  // the animal's own "Collect" action button (see _farmAnimalOnAction).
  function collectResource(livestockId) {
    const list = deps.loadWorldLivestock();
    const rec = list.find(l => l.id === livestockId);
    if (!rec) return { ok: false, message: 'Livestock not found.' };
    const resDef = deps.LIVESTOCK_RESOURCE_DEFS[rec.kind];
    if (!resDef || !rec.resourceReady) return { ok: false, message: 'Nothing to collect yet.' };
    deps.inventory[resDef.itemKey] = Math.min(99, (deps.inventory[resDef.itemKey] || 0) + 1);
    rec.resourceReady = false;
    rec.daysUntilResource = resDef.cooldownDays;
    deps.saveWorldLivestock(list);
    return { ok: true, message: `Collected 1 ${deps.ITEM_DEFS[resDef.itemKey]?.label || resDef.itemKey}.` };
  }

  // Advances every housed animal's resource cooldown by one day — called
  // from game.js's advanceDay()/sleepInBed() alongside tickCropDay().
  // Unassigned (stasis) livestock simply aren't touched here, which is
  // the "cooldown paused" behavior — no separate bookkeeping needed.
  function tickResources() {
    const list = deps.loadWorldLivestock();
    let changed = false;
    list.forEach(l => {
      const resDef = deps.LIVESTOCK_RESOURCE_DEFS[l.kind];
      if (resDef && l.barnId && !l.resourceReady) {
        if (l.daysUntilResource == null) l.daysUntilResource = resDef.cooldownDays;
        l.daysUntilResource--;
        if (l.daysUntilResource <= 0) l.resourceReady = true;
        changed = true;
      }
      // Uumkao'ii dew cooldown — separate from the egg resource above;
      // see UUMKAOII_DEW_COOLDOWN_DAYS.
      if (l.kind === 'uumkaoii' && l.barnId) {
        if (!l.dewReady) {
          if (l.dewDaysUntil == null) l.dewDaysUntil = deps.UUMKAOII_DEW_COOLDOWN_DAYS;
          l.dewDaysUntil--;
          if (l.dewDaysUntil <= 0) { l.dewReady = true; l.dewReadyStaleDays = 0; }
          changed = true;
        }
        if (l.dewReady) {
          // Assigned-to-a-vat takes priority over dropping a pile at all:
          // the dew goes straight into squeezed milk/curds instead of
          // needing to be dug up first. See window.DewVats.autoSqueezeAtVat
          // — falls through to the ordinary pile-drop behavior below if
          // the vat was since demolished (also clears the stale
          // assignment so it doesn't keep trying every day).
          if (l.assignedVatId) {
            if (window.DewVats.autoSqueezeAtVat(l.assignedVatId, l.dewColor || deps.UUMKAOII_DEFAULT_DEW_COLOR)) {
              l.dewReady = false;
              l.dewDaysUntil = deps.UUMKAOII_DEW_COOLDOWN_DAYS;
              changed = true;
              return;
            }
            l.assignedVatId = null;
          }
          // The pile ideally appears from inside the live uumkao'ii's own
          // tick() (see makeUumkaoiiAnimal) as it wanders — but that only
          // runs while the player is actually on the farm AND the animal
          // isn't mid barn-homing/asleep (_farmAnimalBarnTick short-
          // circuits wandering entirely at night), so waiting on it
          // indefinitely can leave dewReady stuck true forever if that
          // alignment never happens to occur — this was reported as
          // "never found one" despite the mechanic otherwise working.
          // First tick it's ready: give the live wander-hop a chance to
          // produce the nicer "dropped at its feet" flourish, same as
          // before, but ONLY when actually on the farm to see it — off-
          // farm still resolves immediately like it always has. Every
          // subsequent tick it's STILL unresolved (l.dewReadyStaleDays
          // counts real advanceDay/sleepInBed calls, not frames), force
          // the same random-open-tile placement regardless of area
          // instead of leaving it stuck another indefinite stretch.
          if (l.dewReadyStaleDays == null) l.dewReadyStaleDays = 0;
          const forceDrop = deps.getCurrentArea() !== 'farm' || l.dewReadyStaleDays >= 1;
          if (forceDrop && window.DewVats.dropOnRandomOpenTile(l.dewColor || deps.UUMKAOII_DEFAULT_DEW_COLOR)) {
            l.dewReady = false;
            l.dewDaysUntil = deps.UUMKAOII_DEW_COOLDOWN_DAYS;
            l.dewReadyStaleDays = 0;
          } else {
            l.dewReadyStaleDays++;
          }
          changed = true;
        }
      }
    });
    if (changed) deps.saveWorldLivestock(list);
  }

  // ── Livestock harvest interaction (milking/venom/stink-oil extraction) ──
  // Modeled on the NPC dialogue system's own player-staging
  // (game.js's updateNpcDialogueStaging/faceNpcDialogueParticipants):
  // while the interaction runs, game.js's updateMovement is fully
  // replaced by updateHarvestInteraction, which quick-lerps (not snaps —
  // see HARVEST_TRANSITION_S) the player into the authored handler
  // position relative to the animal, holds there for the interaction's
  // duration, grants the resource, then lerps back to wherever the
  // player started. The animal itself is frozen in place for the whole
  // thing (`_harvestFrozen`, checked at the top of both farm-animal
  // tick()s) so it can't wander out from under the player mid-interaction.
  let harvestInteraction = null;
  const HARVEST_TRANSITION_S = 0.35; // matches MOUNT_TRANSITION_S's quick-lerp feel
  const HARVEST_ACTIVE_DURATION_S = 2; // matches the authored milking/stink-oil templates' own duration

  // Player stand-spot offset (tile units, in the animal's own unrotated
  // local frame — rotated by the animal's current groupRot into world
  // space), extracted from the animation-author tool's authored
  // two-actor templates: gar-wolf/dabinggi-hound from
  // AUTHORED_MILKING_TEMPLATE's farmerBaseTransform+
  // animalAnchorTransform (dabinggi-hound additionally offset by
  // venomExtractionHandlerDelta, since venom reuses the milking track —
  // see applyVenomExtractionPreset), grehlr from
  // AUTHORED_STINK_OIL_GREHLR_TEMPLATE_V1524's handler.baseTransform.
  // Only the ground-plane (x/z) position is representable here — the
  // templates' full 3D handler rotation (a crouched/kneeling pose) has
  // no equivalent on a flat 2.5D billboard character, so the player
  // instead just faces the animal directly once in position.
  const HARVEST_HANDLER_OFFSET = {
    'gar-wolf': { x: -0.243, z: 0.249 },
    'dabinggi-hound': { x: -0.493, z: 0.429 },
    'grehlr': { x: 0.064, z: -0.86 },
  };

  function isHarvesting() {
    return !!harvestInteraction;
  }

  function beginHarvestInteraction(animal) {
    if (harvestInteraction || !animal) return;
    const offset = HARVEST_HANDLER_OFFSET[animal.animalKey];
    if (!offset) { collectResource(animal.livestockId); return; } // no authored spot — just collect instantly
    const theta = animal.groupRot;
    const dx = offset.x * Math.cos(theta) + offset.z * Math.sin(theta);
    const dz = -offset.x * Math.sin(theta) + offset.z * Math.cos(theta);
    const animalPxX = animal.wx * deps.TILE, animalPxY = animal.wz * deps.TILE;
    const targetX = animalPxX + dx * deps.TILE, targetY = animalPxY + dz * deps.TILE;
    const targetAngle = Math.atan2(animalPxY - targetY, animalPxX - targetX);
    animal._harvestFrozen = true;
    harvestInteraction = {
      animal, livestockId: animal.livestockId,
      phase: 'in', t: 0,
      startX: deps.player.x, startY: deps.player.y, startAngle: deps.getFacingAngle(),
      targetX, targetY, targetAngle,
      prevCameraMode: deps.getCameraMode(), prevCameraTarget: deps.getCameraTarget(),
    };
    // Auto-zooms onto the animal the same way opening NPC dialogue swaps
    // in its own tighter camera mode (see game.js's openNpcDialogue) — no
    // separate tween function needed, the existing per-frame follow-lerp
    // in the main loop (updateCameraPosition's camLerp) eases the camera
    // into the new mode's framing smoothly over the 'in' transition below.
    deps.setCameraMode('harvestInteraction');
    deps.setCameraTarget(animal.avatarRef?.group || null);
  }

  function updateHarvestInteraction(dt) {
    const h = harvestInteraction;
    if (!h) return;
    deps.player.vx = 0; deps.player.vy = 0;
    if (h.phase === 'active') {
      deps.setFacingAngle(h.targetAngle); deps.player.angle = deps.getFacingAngle();
      h.t += dt;
      if (h.t >= HARVEST_ACTIVE_DURATION_S) {
        const result = collectResource(h.livestockId);
        if (result?.message) deps.showToast(result.message, !!result.ok);
        h.phase = 'out'; h.t = 0;
      }
      return;
    }
    h.t = Math.min(1, h.t + dt / HARVEST_TRANSITION_S);
    const e = h.t;
    const [fromX, fromY, fromAngle, toX, toY, toAngle] = h.phase === 'in'
      ? [h.startX, h.startY, h.startAngle, h.targetX, h.targetY, h.targetAngle]
      : [h.targetX, h.targetY, h.targetAngle, h.startX, h.startY, h.startAngle];
    deps.player.x = fromX + (toX - fromX) * e;
    deps.player.y = fromY + (toY - fromY) * e;
    deps.setFacingAngle(fromAngle + deps.angleDiff(toAngle, fromAngle) * e);
    deps.player.angle = deps.getFacingAngle();
    if (e >= 1) {
      if (h.phase === 'in') { h.phase = 'active'; h.t = 0; }
      else {
        if (h.animal) h.animal._harvestFrozen = false;
        // Mirrors game.js's closeNpcDialogue own restore of camera mode/
        // target — the per-frame camLerp eases the camera back out to
        // wherever it was before the interaction zoomed in.
        deps.setCameraMode(h.prevCameraMode ?? (deps.cameraConfig().defaultMode || 'default'));
        deps.setCameraTarget(h.prevCameraTarget ?? null);
        harvestInteraction = null;
      }
    }
  }

  // Adds a creature from an item straight into the character's personal
  // stable — no farm/ownership involved at all (any character, anywhere,
  // can do this with their own bag item), unlike addFromItem() above. A
  // stabled animal is untradeable and can never be placed on any farm;
  // it becomes a nameable, eventually-levelable companion instead.
  function addToStable(itemKey) {
    const kind = deps.LIVESTOCK_ITEM_KINDS[itemKey];
    if (!kind) return { ok: false, message: 'That item cannot be added to a stable.' };
    if ((deps.inventory[itemKey] || 0) < 1) return { ok: false, message: 'None of that item in bag.' };
    deps.inventory[itemKey]--;
    deps.clampInventoryStack(itemKey);
    const entry = {
      id: 'stable_' + Math.random().toString(36).slice(2, 10),
      kind, name: window.CreatureGenetics.defaultLivestockName(kind), genotype: _consumeLivestockItemGenotype(itemKey) || window.CreatureGenetics.makeDefaultGenotype(kind),
      aiType: deps.companionAiTypeForKind(kind), level: 0, stabledAt: Date.now(),
    };
    deps.getStable().push(entry);
    deps._autoAssignStableRole(entry);
    deps.saveStable();
    return { ok: true, message: `${entry.name} added to your stable!`, entry };
  }

  // Recreates every animal this world's owner (or any farmhand) has ever
  // released, from the world's own saved livestock list — called once
  // per world load, after furniture placement so canSpawnAt's occupancy
  // check sees the final tile state.
  function respawnWorldLivestock() {
    const farmBuildings = deps.getFarmBuildings();
    for (const entry of deps.loadWorldLivestock()) {
      const factory = LIVESTOCK_FACTORIES[entry.kind];
      if (!factory) continue;
      // Entries saved before barns existed have no 'barnId' property at
      // all (vs. the new stasis default of an explicit null) — treat
      // those as already-free-roaming and keep spawning them at their
      // saved spot, same as always. New-format entries only spawn when
      // actually housed in a still-existing, built barn.
      const isLegacyRoaming = !('barnId' in entry);
      let col = entry.col, row = entry.row;
      if (!isLegacyRoaming) {
        if (!entry.barnId) continue; // stasis — no world presence
        const barn = farmBuildings.find(b => b.id === entry.barnId && b.kind === 'barn' && b.stage === 'built');
        if (!barn) continue; // barn demolished/not yet built — stays in stasis until reassigned
        const spot = deps.findOpenTileNearBarn(barn);
        if (!spot) continue;
        col = spot.col; row = spot.row;
      } else if (!canSpawnAt(col, row)) {
        continue;
      }
      const animal = factory(col, row, entry.id, entry.genotype);
      if (!animal) continue;
      deps.worldObjects.set(col + ',' + row, animal);
      deps.animalObjects.add(animal);
    }
  }

  // Gestation length for a set breeding pair, in in-game days — resolved
  // by tickBreeding() on the same day-tick crops use.
  const LIVESTOCK_GESTATION_DAYS = 3;

  // Resolves every breeding pair whose gestation has elapsed: crosses
  // the parents' genotypes (crossOffspring), spawns the offspring on an
  // open tile, and appends it to world.livestock. Pairs are consumed on
  // resolution — a farmhand must re-pair to breed again. Called from
  // game.js's advanceDay()/sleepInBed() alongside tickCropDay().
  // A breeding-pair parent ref is { source: 'world'|'stable', id, characterId? }
  // — 'world' points into this farm's own livestock, 'stable' points into
  // a specific character's personal stable (characterId required so the
  // pair still resolves correctly even if a *different* character is the
  // one currently playing when gestation completes).
  function refsEqual(a, b) {
    return !!a && !!b && a.source === b.source && a.id === b.id;
  }
  function currentCharacterId() {
    return (window.__hobunjiPlayerProfile || deps.getPlayerData())?.characterId || null;
  }
  function _loadCharacterStable(characterId) {
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      return (meta?.characters || []).find(c => c.id === characterId)?.stable ?? [];
    } catch { return []; }
  }
  function resolveBreedingParent(ref, worldLivestock) {
    if (!ref) return null;
    if (ref.source === 'stable') return _loadCharacterStable(ref.characterId).find(s => s.id === ref.id) || null;
    return worldLivestock.find(l => l.id === ref.id) || null;
  }

  function tickBreeding() {
    const pairs = deps._loadWorldBreedingPairs();
    if (!pairs.length) return;
    const livestock = deps.loadWorldLivestock();
    const remainingPairs = [];
    let changed = false;
    for (const pair of pairs) {
      if (deps.calendar.day < pair.readyDay) { remainingPairs.push(pair); continue; }
      const parentA = resolveBreedingParent(pair.parentA, livestock);
      const parentB = resolveBreedingParent(pair.parentB, livestock);
      changed = true;
      if (!parentA || !parentB) continue; // a parent was sold/removed/stable-emptied — pair quietly lapses
      const kind = parentA.kind;
      const childGenotype = window.CreatureGenetics.crossOffspring(parentA.genotype, parentB.genotype, kind);
      // Newborns start in stasis just like a freshly-released crate
      // animal — the owner assigns them to a barn from the Farm tab
      // when there's room, same as any other unhoused livestock.
      livestock.push({
        id: 'livestock_' + Math.random().toString(36).slice(2, 10), kind, barnId: null, releasedAt: Date.now(),
        name: window.CreatureGenetics.defaultLivestockName(kind), genotype: childGenotype,
        daysUntilResource: deps.LIVESTOCK_RESOURCE_DEFS[kind]?.cooldownDays ?? null, resourceReady: false,
      });
      deps.showToast(`🐣 A new ${window.CreatureGenetics.defaultLivestockName(kind)} was born! It's waiting in stasis until you assign it to a barn.`, true);
    }
    if (changed) {
      deps.saveWorldLivestock(livestock);
      deps._saveWorldBreedingPairs(remainingPairs);
    }
  }

  function clearAnimalObjects() {
    deps.animalObjects.forEach(obj => {
      deps.worldObjects.delete(obj.col + ',' + obj.row);
      obj.reset && obj.reset();
    });
    deps.animalObjects.clear();
  }

  function updateAnimalMeshes(dt) {
    // .tick() drives wander/barn-homing steps (throttled internally via
    // each animal's own tickCounter); .update(dt) is the continuous
    // position/rotation lerp toward wherever tick() last moved it. One
    // loadWorldLivestock() read for the whole frame rather than one per
    // animal per tick -- in-place mutations (e.g. a dew drop resetting
    // rec.dewReady) stay visible to every other animal in this same pass
    // since it's the same array reference, and saveWorldLivestock still
    // persists it for real, so this is purely a read-dedup, not a
    // staleness risk.
    deps.setWorldLivestockFrameCache(deps.loadWorldLivestock());
    for (const animal of deps.animalObjects) { animal.tick && animal.tick(dt); animal.update(dt); }
    deps.setWorldLivestockFrameCache(null);
  }

  window.FarmAnimals = {
    init,
    canSpawnAt,
    queueItemGenotype,
    addFromItem,
    assignToBarn,
    unassignFromBarn,
    tickResources,
    isHarvesting,
    updateHarvestInteraction,
    addToStable,
    respawnWorldLivestock,
    refsEqual,
    currentCharacterId,
    resolveBreedingParent,
    tickBreeding,
    clearAnimalObjects,
    updateAnimalMeshes,
    GESTATION_DAYS: LIVESTOCK_GESTATION_DAYS,
  };
})();
