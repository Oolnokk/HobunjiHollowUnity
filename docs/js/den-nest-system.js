(() => {
  'use strict';

  // Wilderness den teleport (Dev Tools + Wildlife panel) and Den-Mother
  // nest hold-to-take egg/baby interaction. Extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern as its
  // sibling js/dev-spawner.js, which does near-identical zone-teleport
  // work — same deps.playerMesh/toolHolder/reticle* scene-add bundle, same
  // getCurrentArea/setCurrentArea + setCurrentBuildingMapId getter/setter
  // pair for the `let`s reassigned all over game.js's area-transition code.
  //
  // Audited every reference before extracting: player/inventory/_zoneLayouts/
  // _buildingScenes/_denNests are all `const`s only ever mutated in place
  // (never reassigned), so they're passed by direct reference. currentArea
  // and _currentBuildingMapId are the only two `let`s this cluster itself
  // reassigns (inside a scene-transition callback) — threaded as the same
  // setCurrentArea/setCurrentBuildingMapId setters dev-spawner.js already
  // uses. s_showInteractionRaycast/activeAction/actionHeldDown are `let`s
  // reassigned elsewhere but only ever read here, so plain getters suffice.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function _addPlayerToScene(toScene) {
    if (!toScene) return;
    toScene.add(deps.playerMesh); toScene.add(deps.playerGroundShadow);
    toScene.add(deps.toolHolder); toScene.add(deps.reticleMesh);
    toScene.add(deps.reticleCircleMesh); toScene.add(deps.reticleRingMesh);
    toScene.add(deps.reticleWavyGroup);
  }

  // Cycles through a zone's dens in a shuffled, non-repeating order (per
  // zone) instead of an independent random pick every press — with only a
  // handful of dens per zone, plain Math.random() made it easy to land on
  // the same 1-2 dens over and over by chance. Reshuffles whenever the den
  // count changes (e.g. after a Tothal Shift), so a full lap always visits
  // every den on the map exactly once before any repeat.
  const _denTeleportCycle = new Map(); // zoneId -> { order: number[], idx: number, length: number }
  function _pickCycledDen(zoneId, dens) {
    let state = _denTeleportCycle.get(zoneId);
    if (!state || state.length !== dens.length) {
      const order = dens.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(window.GameRandom.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      state = { order, idx: 0, length: dens.length };
      _denTeleportCycle.set(zoneId, state);
      window.__farmLog?.(`[wildlife] den teleport cycle rebuilt for ${zoneId}: ${dens.length} dens, order [${order.join(',')}]`, 'wildlife');
    }
    const den = dens[state.order[state.idx]];
    window.__farmLog?.(`[wildlife] den teleport ${zoneId}: picking cycle slot ${state.idx + 1}/${state.order.length} -> den ${den.id}`, 'wildlife');
    state.idx = (state.idx + 1) % state.order.length;
    return den;
  }

  // Dev Tools: warp to a den's mouth on the CURRENT map only — no
  // zone-switching, since the request is specifically "does this map have
  // one" (farm/town/buildings never do; a wilderness zone does once its
  // Tothal Shift has run — see _zoneLayouts' `dens` field).
  function teleportToRandomDen() {
    // Called from inside a den's own cavern (dark, no landmarks, and
    // "no dens on this map" made no sense there since a cavern's own
    // _zoneLayouts entry doesn't exist) — resolve the exterior zone this
    // cavern belongs to (see _denCavernZoneOf) and warp there, landing at a
    // den mouth like the zone-side path below instead of requiring a
    // separate exit step first.
    if (deps._isCavernBuildingArea(deps.getCurrentArea())) {
      const zoneId = window.WildlifeSpawn.denCavernZoneOf(deps.getCurrentArea());
      const dens = zoneId ? deps._zoneLayouts.get(zoneId)?.dens : null;
      if (!zoneId || !dens || !dens.length) {
        deps.showToast("No dens found for this burrow's map.", false);
        return;
      }
      const den = _pickCycledDen(zoneId, dens);
      const anchor = den.mouthAnchor || { x: den.x + (den.w || 1) / 2, y: den.y + (den.h || 1) / 2 };
      deps.startSceneTransition(() => {
        const fromScene = deps._buildingScenes.get(deps.getCurrentArea())?.scene || null;
        if (fromScene) { fromScene.remove(deps.playerMesh); fromScene.remove(deps.playerGroundShadow); }
        deps.setCurrentBuildingMapId(null);
        deps.setCurrentArea(zoneId);
        deps.player.x = (anchor.x + 0.5) * deps.TILE;
        deps.player.y = (anchor.y + 0.5) * deps.TILE;
        deps.player.vx = 0; deps.player.vy = 0;
        deps._snapCameraTarget();
        _addPlayerToScene(deps.buildZoneScene(zoneId, anchor.x, anchor.y)?.scene);
        deps.refreshActionBar();
        deps.showToast(`Teleported to a den (${dens.length} on this map).`, true);
        deps.closeMenu();
      });
      return;
    }
    const dens = deps._zoneLayouts.get(deps.getCurrentArea())?.dens;
    if (!dens || !dens.length) {
      deps.showToast('No dens on this map.', false);
      return;
    }
    const den = _pickCycledDen(deps.getCurrentArea(), dens);
    const anchor = den.mouthAnchor || { x: den.x + (den.w || 1) / 2, y: den.y + (den.h || 1) / 2 };
    deps.player.x = (anchor.x + 0.5) * deps.TILE;
    deps.player.y = (anchor.y + 0.5) * deps.TILE;
    deps.player.vx = 0; deps.player.vy = 0;
    deps._snapCameraTarget();
    window.WildernessChunks?.primeZone(deps.getCurrentArea(), anchor.x, anchor.y);
    deps.showToast(`Teleported to a den (${dens.length} on this map).`, true);
    deps.closeMenu();
  }

  // Warps the player straight to a specific den's mouth on its own zone,
  // from anywhere (farm, town, another zone, or inside any
  // building/cavern) — used by the Wildlife panel's per-den Teleport
  // button. Unlike teleportToRandomDen (which only ever targets "whichever
  // map you're currently on"), this always resolves the exact zone the
  // picked den belongs to and does a full scene swap if that's not where
  // the player already is.
  function warpToDenAnchor(zoneId, den) {
    const anchor = den.mouthAnchor || { x: den.x + (den.w || 1) / 2, y: den.y + (den.h || 1) / 2 };
    const land = () => {
      deps.player.x = (anchor.x + 0.5) * deps.TILE;
      deps.player.y = (anchor.y + 0.5) * deps.TILE;
      deps.player.vx = 0; deps.player.vy = 0;
      deps._snapCameraTarget();
      window.WildernessChunks?.primeZone(zoneId, anchor.x, anchor.y);
    };
    if (deps.getCurrentArea() === zoneId) {
      land();
      deps.showToast(`Teleported to den ${den.id}.`, true);
      deps.closeMenu();
      return;
    }
    deps.startSceneTransition(() => {
      const fromScene = deps.getActiveScene();
      if (fromScene) { fromScene.remove(deps.playerMesh); fromScene.remove(deps.playerGroundShadow); }
      if (deps._isBuildingArea(deps.getCurrentArea())) deps.setCurrentBuildingMapId(null);
      deps.setCurrentArea(zoneId);
      land();
      _addPlayerToScene(deps.buildZoneScene(zoneId, anchor.x, anchor.y)?.scene);
      deps.refreshActionBar();
      deps.showToast(`Teleported to den ${den.id}.`, true);
      deps.closeMenu();
    });
  }

  // ── Den-Mother nest: hold-to-take egg/baby (see _denNests, populated in
  // loadBuildingScene) ──────────────────────────────────────────────────
  // _nestHoldT itself is NOT module-private state — it's also reset by
  // branch-fall damage and player-hit interrupts elsewhere in game.js, and
  // read by another module's own getNestHoldT() getter — so it's threaded
  // through as a getter+setter pair rather than owned here.
  const NEST_TAKE_HOLD_S = 5;
  let _nestTakeHudEl = null, _nestTakeLabelEl = null, _nestTakeFillEl = null;

  function isPlayerNearDenNest(nest) {
    const cx = (nest.col + nest.w / 2) * deps.TILE, cy = (nest.row + nest.h / 2) * deps.TILE;
    return Math.hypot(deps.player.x - cx, deps.player.y - cy) <= deps.TILE * 1.6;
  }

  function aimedCavernNest(nest) {
    if (!nest || nest.remaining <= 0 || !isPlayerNearDenNest(nest)) return null;
    const interactionRay = deps.currentPlayerInteractionRay();
    if (!interactionRay || !window.RangedWeapons?.focusCandidates) return null;
    const cx = (nest.col + nest.w / 2) * deps.TILE, cy = (nest.row + nest.h / 2) * deps.TILE;
    const groundY = deps.activeSurfaceYAtWorld(cx / deps.TILE, cy / deps.TILE);
    const halfW = Math.max(0.5, nest.w / 2), halfH = Math.max(0.5, nest.h / 2);
    const box = new THREE.Box3(
      new THREE.Vector3(cx / deps.TILE - halfW, groundY, cy / deps.TILE - halfH),
      new THREE.Vector3(cx / deps.TILE + halfW, groundY + 0.75, cy / deps.TILE + halfH),
    );
    const focus = window.RangedWeapons.focusCandidates([{ type: 'nest', id: deps.getCurrentArea(), data: nest, box }], 24);
    if (!focus) return null;
    const hostile = window.RangedWeapons.focusedHostile?.(24);
    if (hostile && hostile.distanceWorld <= focus.distanceWorld + 0.05) return null;
    window.DebugHitboxes?.noteInteractionFocus?.(focus);
    return nest;
  }

  function currentAimedNest() {
    const branchNest = window.ClimbSystem?.getAimedNest?.() || null;
    if (branchNest) return branchNest;
    return aimedCavernNest(deps._denNests.get(deps.getCurrentArea()));
  }

  function refreshInteractionFocusDebug() {
    if (!deps.getShowInteractionRaycast()) return;
    // Match computeActionButtons priority: a nest owns the shared input
    // before branch climbing is considered.
    if (currentAimedNest()) return;
    if (deps._isZoneArea(deps.getCurrentArea()) && !deps.player.climbing) window.ClimbSystem?.getClimbTarget?.();
  }

  function updateNestInteraction(dt) {
    if (!_nestTakeHudEl) {
      _nestTakeHudEl = document.getElementById('nestTakeHud');
      _nestTakeLabelEl = document.getElementById('nestTakeLabel');
      _nestTakeFillEl = document.getElementById('nestTakeFill');
    }
    const nest = currentAimedNest();
    const taking = nest && deps.getActiveAction() === 'nest_take' && deps.getActionHeldDown();
    deps.player._nestTakeActive = !!taking;
    if (!taking) {
      if (deps.getNestHoldT() > 0) deps.setNestHoldT(0);
      if (_nestTakeHudEl?.classList.contains('visible')) _nestTakeHudEl.classList.remove('visible');
      return;
    }
    const nestHoldT = deps.getNestHoldT() + dt;
    deps.setNestHoldT(nestHoldT);
    if (_nestTakeLabelEl) _nestTakeLabelEl.textContent = nest.liveBirth ? 'Taking Baby...' : 'Taking Egg...';
    if (_nestTakeFillEl) _nestTakeFillEl.style.width = Math.min(100, (nestHoldT / NEST_TAKE_HOLD_S) * 100) + '%';
    _nestTakeHudEl?.classList.add('visible');
    if (nestHoldT >= NEST_TAKE_HOLD_S) {
      deps.setNestHoldT(0);
      deps.player._nestTakeActive = false;
      _nestTakeHudEl?.classList.remove('visible');
      nest.remaining--;
      deps.inventory[nest.itemKey] = Math.min(99, (deps.inventory[nest.itemKey] || 0) + 1);
      window.FarmAnimals.queueItemGenotype(nest.itemKey, nest.genotype);
      deps.clampInventoryStack(nest.itemKey);
      deps.buildInventoryGrid(); deps.refreshItemScroll(); deps.refreshActionBar();
      deps.saveMemberWorldData();
      deps.showToast(`${deps.itemIconForKey(nest.itemKey)} Took ${deps.ITEM_DEFS[nest.itemKey]?.label || nest.itemKey}${nest.remaining > 0 ? ` (${nest.remaining} left)` : ''}`, true);
    }
  }

  // Delegated so it keeps working across every re-render of the Wildlife
  // panel's den list (container.innerHTML replacement would otherwise drop
  // per-button listeners each time).
  function _bindListeners() {
    document.getElementById('devTeleportDenBtn')?.addEventListener('click', teleportToRandomDen);
    document.getElementById('wildlifeDenList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.wildlife-den-teleport-btn');
      if (!btn) return;
      const zoneId = btn.dataset.zone, denId = btn.dataset.den;
      const den = deps._zoneLayouts.get(zoneId)?.dens?.find(d => d.id === denId);
      if (!den) { deps.showToast('That den no longer exists on the current map.', false); return; }
      warpToDenAnchor(zoneId, den);
    });
  }

  window.DenNestSystem = {
    init: (injectedDeps) => { init(injectedDeps); _bindListeners(); },
    teleportToRandomDen, warpToDenAnchor,
    isPlayerNearDenNest, aimedCavernNest, currentAimedNest,
    refreshInteractionFocusDebug, updateNestInteraction,
  };
})();
