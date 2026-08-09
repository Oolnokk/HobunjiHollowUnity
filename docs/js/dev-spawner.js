(() => {
  'use strict';

  // Dev Tools: Testing Arena teleport + creature/bandit/foliage spawner
  // panel — an empty sandbox zone built for isolated combat/AI/rendering
  // testing without needing a real wilderness zone's terrain generation.
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its sibling systems. currentArea/
  // _currentBuildingMapId are threaded as getter/setter pairs since
  // they're plain `let`s reassigned all over game.js's area-transition
  // code; farmEditMode/toggleFarmEditMode/isFarmOwner come in through deps
  // purely because _refreshEditorButtonVisibility shares one top-right UI
  // slot between the farm-editor pencil button and the dev-spawner paw
  // button and has to toggle both.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const DEV_ARENA_ZONE_ID = 'map_dev_arena';
  // Remembers where the player was standing before warping into the arena
  // so the same Settings button can toggle them back out again — unlike a
  // den-warp's target, the arena has no natural "return" spot of its own
  // (see EXTERIOR_ZONES.map_dev_arena's exitCol/Row comment for the
  // walk-out fallback).
  let _devArenaReturnAnchor = null;

  function _addPlayerToScene(toScene) {
    if (!toScene) return;
    toScene.add(deps.playerMesh); toScene.add(deps.playerGroundShadow);
    toScene.add(deps.toolHolder); toScene.add(deps.reticleMesh);
    toScene.add(deps.reticleCircleMesh); toScene.add(deps.reticleRingMesh);
    toScene.add(deps.reticleWavyGroup);
  }

  function teleportToDevArena() {
    if (deps.getCurrentArea() === DEV_ARENA_ZONE_ID) {
      const back = _devArenaReturnAnchor || { area: 'farm', x: (deps.COLS / 2) * deps.TILE, y: (deps.ROWS / 2) * deps.TILE };
      _devArenaReturnAnchor = null;
      deps.setDebugWeather(null);
      deps.startSceneTransition(() => {
        const fromScene = deps.getActiveScene();
        if (fromScene) { fromScene.remove(deps.playerMesh); fromScene.remove(deps.playerGroundShadow); }
        if (deps._isBuildingArea(deps.getCurrentArea())) deps.setCurrentBuildingMapId(null);
        deps.setCurrentArea(back.area);
        deps.player.x = back.x; deps.player.y = back.y;
        deps.player.vx = 0; deps.player.vy = 0;
        deps._snapCameraTarget();
        _addPlayerToScene(deps.getActiveScene());
        deps.refreshActionBar();
        deps.showToast('Left the Testing Arena.', true);
        deps.closeMenu();
      });
      return;
    }
    _devArenaReturnAnchor = { area: deps.getCurrentArea(), x: deps.player.x, y: deps.player.y };
    deps.startSceneTransition(() => {
      const fromScene = deps.getActiveScene();
      if (fromScene) { fromScene.remove(deps.playerMesh); fromScene.remove(deps.playerGroundShadow); }
      if (deps._isBuildingArea(deps.getCurrentArea())) deps.setCurrentBuildingMapId(null);
      deps.setCurrentArea(DEV_ARENA_ZONE_ID);
      const zdef = deps.EXTERIOR_ZONES[DEV_ARENA_ZONE_ID];
      deps.player.x = (zdef.entryCol + 0.5) * deps.TILE;
      deps.player.y = (zdef.entryRow + 0.5) * deps.TILE;
      deps.player.vx = 0; deps.player.vy = 0;
      deps._snapCameraTarget();
      _addPlayerToScene(deps.buildZoneScene(DEV_ARENA_ZONE_ID)?.scene);
      deps.refreshActionBar();
      deps.showToast('Teleported to the Testing Arena — creature spawner unlocked.', true);
      deps.closeMenu();
      // Pays the mask-JSON + base/pattern sprite network fetch up front
      // instead of on the first Spawn click — a fully-patterned species
      // is over a megabyte of images, so without this the cold fetch
      // happens WHILE the first spawned creature is standing there
      // plain/undyed, which is what actually reads as "no colors" (the
      // recolor math itself is fast; the network round-trip isn't). Not
      // a blocking loading screen — just a toast so the wait is visible
      // instead of silent, since it can take a few seconds on a slow
      // connection/CDN.
      if (window.CreatureGeneticsRender) {
        deps.showToast('Warming up creature art…', true);
        window.CreatureGeneticsRender.prewarm()
          .then(() => deps.showToast('Creature art ready — spawn away.', true))
          .catch(() => {});
      }
    });
  }

  // Creatures the dev spawn menu has placed in the arena this session — a
  // separate tracking set from hostileObjects/companionObjects (which this
  // panel also adds its spawns to, so the normal AI/render tick loops pick
  // them up) purely so "Auto Kill All" only ever touches arena test
  // subjects, never a real wild pack or summoned companion.
  const _arenaSpawnedCreatures = new Set();
  let devSpawnSelectedKey = null; // set from deps.CREATURE_DB's first key on first render
  // Bandits aren't CREATURE_DB entries (see makeBanditEntity) and every
  // spawn is async (portrait render), so they're addressable in this same
  // species grid via a 'bandit:<rank>' key instead of a real CREATURE_DB
  // key — spawnDevArenaCreature/spawnDevArenaBandit branch on that prefix.
  // Camps never auto-place in the dev arena (see
  // ensureCurrentZoneBanditCamps's DEV_ARENA_ZONE_ID exclusion, same
  // reasoning as packSpecies/herbivoreSpecies being empty there) so this
  // panel is the only way to get a bandit into it.
  const DEV_SPAWN_BANDIT_RANKS = ['grunt', 'lieutenant', 'captain'];
  let devSpawnBanditTier = 0;

  // Same species FoliageGenerator builds for a real wilderness zone's
  // SHRUB tiles (see game.js's _buildZoneFloorMeshes) — spawning them here
  // lets a tree/stump's view-corridor culling and camera-occlusion fade
  // (see updateZoneVegetationCulling) get exercised and screenshotted
  // without needing an actual zone (Southern Cloud Forest's real terrain
  // alone takes a couple minutes to generate). skipOcclusionFade/scale2x
  // mirror that same switch's own per-species handling exactly, so a
  // spawned bush/shrub behaves (and doesn't fade) the same as a real one.
  const DEV_SPAWN_FOLIAGE_TYPES = {
    crownedPine: { label: 'Crowned Pine', build: (seed) => window.FoliageGenerator.buildCrownedPineMesh(seed, 0) },
    shadewood: { label: 'Shadewood', build: (seed) => window.FoliageGenerator.buildShadewoodMesh(seed, 0) },
    stump: { label: 'Old Stump', build: (seed) => window.FoliageGenerator.buildStumpMesh(seed, 0) },
    bush: { label: 'Wilderness Bush', build: (seed) => window.FoliageGenerator.buildWildernessBushMesh(seed, 0), skipOcclusionFade: true },
    shrub: { label: 'Generic Shrub', build: (seed) => window.FoliageGenerator.buildShrubMesh(seed, 0), skipOcclusionFade: true, scale2x: true },
  };
  let devSpawnFoliageSelectedKey = Object.keys(DEV_SPAWN_FOLIAGE_TYPES)[0];
  let _arenaFoliageSeedCounter = 0;
  // Separate from _arenaSpawnedCreatures — these are plain decorative
  // meshes, not AI entities, so "Clear Objects" just removes/disposes them
  // directly instead of going through damageCreature.
  const _arenaSpawnedFoliage = new Set();

  function renderDevSpawnPanel() {
    if (devSpawnSelectedKey === null) devSpawnSelectedKey = Object.keys(deps.CREATURE_DB)[0];
    const grid = document.getElementById('devSpawnSpeciesGrid');
    if (grid) {
      const creatureBtns = Object.keys(deps.CREATURE_DB).map(key => {
        const label = deps.CREATURE_DB[key].label || key;
        const active = key === devSpawnSelectedKey ? ' fed-active' : '';
        return `<button type="button" class="fed-btn${active}" data-species="${deps.esc(key)}">${deps.esc(label)}</button>`;
      });
      const banditBtns = DEV_SPAWN_BANDIT_RANKS.map(rank => {
        const key = 'bandit:' + rank;
        const label = window.BanditCombat.RANK_LABEL[rank] || rank;
        const active = key === devSpawnSelectedKey ? ' fed-active' : '';
        return `<button type="button" class="fed-btn${active}" data-species="${deps.esc(key)}">🗡️ ${deps.esc(label)}</button>`;
      });
      grid.innerHTML = creatureBtns.concat(banditBtns).join('');
    }
    const tierGrid = document.getElementById('devSpawnBanditTierGrid');
    if (tierGrid) {
      tierGrid.innerHTML = [0, 1, 2, 3].map(t => {
        const active = t === devSpawnBanditTier ? ' fed-active' : '';
        return `<button type="button" class="fed-btn${active}" data-tier="${t}">Tier ${t}</button>`;
      }).join('');
    }
    const countEl = document.getElementById('devArenaSpawnCount');
    if (countEl) countEl.textContent = String(_arenaSpawnedCreatures.size);
    const foliageGrid = document.getElementById('devSpawnFoliageGrid');
    if (foliageGrid) {
      foliageGrid.innerHTML = Object.entries(DEV_SPAWN_FOLIAGE_TYPES).map(([key, def]) => {
        const active = key === devSpawnFoliageSelectedKey ? ' fed-active' : '';
        return `<button type="button" class="fed-btn${active}" data-foliage="${deps.esc(key)}">${deps.esc(def.label)}</button>`;
      }).join('');
    }
    const foliageCountEl = document.getElementById('devArenaFoliageCount');
    if (foliageCountEl) foliageCountEl.textContent = String(_arenaSpawnedFoliage.size);
    const activeWeather = deps.getDebugWeather();
    document.querySelectorAll('#devArenaWeatherGrid [data-weather]').forEach(button => {
      button.classList.toggle('fed-active', button.dataset.weather === activeWeather);
    });
    const rainSettings = deps.getRainPlaneSettings();
    document.querySelectorAll('#devRainPlaneModeGrid [data-rain-mode]').forEach(button => {
      button.classList.toggle('fed-active', button.dataset.rainMode === rainSettings.mode);
    });
    document.querySelectorAll('#devRainPositionRuleGrid [data-rain-rule], #devRainRotationRuleGrid [data-rain-rule], #devRainScaleRuleGrid [data-rain-rule]').forEach(button => {
      button.classList.toggle('fed-active', Boolean(rainSettings[button.dataset.rainRule]));
    });
    const spacingInput = document.getElementById('devRainRowSpacing');
    const frontInput = document.getElementById('devRainFrontCount');
    const behindInput = document.getElementById('devRainBehindCount');
    const speedInput = document.getElementById('devRainSpeedMultiplier');
    if (spacingInput && document.activeElement !== spacingInput) spacingInput.value = String(rainSettings.rowSpacingTiles);
    if (frontInput && document.activeElement !== frontInput) frontInput.value = String(rainSettings.frontCount);
    if (behindInput && document.activeElement !== behindInput) behindInput.value = String(rainSettings.behindCount);
    if (speedInput && document.activeElement !== speedInput) speedInput.value = String(rainSettings.speedMultiplier);
  }

  function setArenaWeather(mode) {
    if (deps.getCurrentArea() !== DEV_ARENA_ZONE_ID) return;
    if (!['clear', 'rain', 'storm'].includes(mode)) return;
    deps.setDebugWeather(mode);
    const label = mode === 'storm' ? 'Storm' : mode === 'rain' ? 'Rain' : 'Clear weather';
    deps.showToast(`${label} forced in the Testing Arena.`, true);
    renderDevSpawnPanel();
  }

  // Rolls the exact same cosmetic-gene odds a wild den pack (or a
  // farm-bought crate) gets — see makeDefaultGenotype — before placing the
  // creature, so this panel doubles as the place to confirm which
  // species' genes actually render (see CreatureGeneticsRender.SPECIES:
  // today only gar-wolf/dabinggi-hound have real cosmetic art; any other
  // species spawned here with a genotype will keep showing its plain
  // default sprite/tint instead — that's the "why don't my genes show up"
  // bug this whole panel exists to help chase down, not a spawner bug).
  function spawnDevArenaCreature(creatureKey) {
    if (deps.getCurrentArea() !== DEV_ARENA_ZONE_ID) return;
    const def = deps.CREATURE_DB[creatureKey];
    if (!def) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = deps.TILE * (1.5 + Math.random() * 2.5);
    const x = deps.player.x + Math.cos(angle) * dist;
    const y = deps.player.y + Math.sin(angle) * dist;
    // Roll against the "family" species (see window.CreatureGenetics.SPECIES_ALIAS) —
    // same normalization getOrMakeDenGenotype applies for wild packs — so
    // gar-wolf-alpha/den-mother variants get real pattern genes too,
    // instead of makeDefaultGenotype silently no-opping on an exact key
    // window.CreatureGenetics.PATTERN_DEFS never defines.
    const genotypeKind = window.CreatureGenetics.SPECIES_ALIAS[creatureKey] || creatureKey;
    const genotype = window.CreatureGenetics.makeDefaultGenotype(genotypeKind);
    const creature = deps.makeCreatureEntity(creatureKey, x, y, { homeX: x, homeY: y, state: 'idle', genotype });
    if (!creature) { deps.showToast(`Could not spawn "${creatureKey}" — missing CREATURE_DB entry.`, false); return; }
    // Same real-AI registration the cutscene combat stager uses (see
    // runCombat's combatOnIds loop) — hostile species chase/attack via
    // updateHostiles, everything else follows/defends the player via
    // updateCompanions, instead of a bespoke test-only behavior.
    if (def.hostile) {
      deps.hostileObjects.add(creature);
    } else {
      creature.isCompanion = true;
      creature.master = deps.player;
      deps.companionObjects.add(creature);
    }
    _arenaSpawnedCreatures.add(creature);
    const renderSupported = !!window.CreatureGeneticsRender?.SPECIES?.[genotypeKind];
    const msg = `[dev-arena] spawned ${creatureKey} #${creature.id} (aiSet=${def.hostile ? 'hostileObjects' : 'companionObjects'}, genotypeKind=${genotypeKind}, renderSupported=${renderSupported}) genotype=${JSON.stringify(genotype)}`;
    window.__farmLog?.(msg, 'wildlife');
    console.log(msg);
    renderDevSpawnPanel();
  }

  // Bandit counterpart to spawnDevArenaCreature — async because building a
  // bandit's portrait avatar is (see buildBanditAvatar), and rolled
  // against devSpawnBanditTier instead of the zone-distance tier a real
  // camp would use, so every rank/tier combination in
  // bandit-gang-config.json can be spawned on demand for testing.
  async function spawnDevArenaBandit(rank, tier) {
    if (deps.getCurrentArea() !== DEV_ARENA_ZONE_ID) return;
    const cfg = await window.BanditCombat.loadGangConfig();
    if (!cfg) { deps.showToast('Could not spawn bandit — bandit-gang-config.json failed to load.', false); return; }
    if (deps.getCurrentArea() !== DEV_ARENA_ZONE_ID) return; // player left mid-await
    const angle = Math.random() * Math.PI * 2;
    const dist = deps.TILE * (1.5 + Math.random() * 2.5);
    const x = deps.player.x + Math.cos(angle) * dist;
    const y = deps.player.y + Math.sin(angle) * dist;
    const creature = await window.BanditCombat.makeEntity(cfg, rank, tier, x, y, {
      zoneId: DEV_ARENA_ZONE_ID,
      extra: { homeX: x, homeY: y, state: 'idle' },
    });
    if (!creature) { deps.showToast(`Could not spawn bandit "${rank}" — see console/log for details.`, false); return; }
    deps.hostileObjects.add(creature);
    _arenaSpawnedCreatures.add(creature);
    const msg = `[dev-arena] spawned bandit ${rank} tier ${tier} #${creature.id} (species=${creature.rosterRecord?.appearance?.speciesId}, mastery=${creature.banditMastery}, maxHealth=${creature.maxHealth}, attackDamage=${creature.def.attackDamage})`;
    window.__farmLog?.(msg, 'wildlife');
    console.log(msg);
    renderDevSpawnPanel();
  }

  function devArenaAutoKillAll() {
    const toKill = [..._arenaSpawnedCreatures];
    for (const c of toKill) {
      _arenaSpawnedCreatures.delete(c);
      if (c.health > 0) deps.damageCreature(c, c.health, undefined, undefined, 0, {});
    }
    deps.showToast(`Auto-killed ${toKill.length} arena creature${toKill.length === 1 ? '' : 's'}.`, true);
    renderDevSpawnPanel();
  }

  // Places a real FoliageGenerator tree/bush/stump near the player, wired
  // into the exact same view-corridor culling + camera-occlusion fade a
  // real zone's own trees get (see game.js's updateZoneVegetationCulling)
  // by computing the same cullSphere bounding-sphere tag
  // _buildZoneFloorMeshes does and pushing it onto this zone's own
  // cullables list — the only other place that list is ever built is
  // once, at zone-build time (see buildZoneScene), so a tree spawned
  // after that has to be added here by hand rather than picked up
  // automatically.
  function spawnDevArenaFoliage(key) {
    const currentArea = deps.getCurrentArea();
    if (currentArea !== DEV_ARENA_ZONE_ID) return;
    const typeDef = DEV_SPAWN_FOLIAGE_TYPES[key];
    if (!typeDef) return;
    if (!window.FoliageGenerator) { deps.showToast('Could not spawn — FoliageGenerator not loaded.', false); return; }
    const vegGroup = typeDef.build(_arenaFoliageSeedCounter++);
    if (typeDef.scale2x) vegGroup.scale.multiplyScalar(2);
    if (typeDef.skipOcclusionFade) vegGroup.userData.skipOcclusionFade = true;
    const angle = Math.random() * Math.PI * 2;
    const dist = deps.TILE * (1.5 + Math.random() * 2.5);
    const x = deps.player.x + Math.cos(angle) * dist;
    const y = deps.player.y + Math.sin(angle) * dist;
    const col = Math.floor(x / deps.TILE), row = Math.floor(y / deps.TILE);
    const targetGrid = deps.getActiveGrid();
    const surfY = targetGrid?.[row]?.[col] ? deps.tileSurfaceYInArea(targetGrid[row][col], currentArea) : 0;
    vegGroup.position.set(x / deps.TILE, surfY, y / deps.TILE);
    const box = new THREE.Box3().setFromObject(vegGroup);
    if (!box.isEmpty()) {
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const xzRadius = Math.hypot((box.max.x - box.min.x) / 2, (box.max.z - box.min.z) / 2);
      vegGroup.userData.cullSphere = { x: sphere.center.x, z: sphere.center.z, radius: sphere.radius, xzRadius };
    }
    deps.getActiveScene().add(vegGroup);
    deps.markOutline(vegGroup);
    const zi = deps.zoneScenes.get(DEV_ARENA_ZONE_ID);
    if (zi && vegGroup.userData.cullSphere) {
      zi.cullables = zi.cullables || [];
      zi.cullables.push(vegGroup);
    }
    _arenaSpawnedFoliage.add(vegGroup);
    renderDevSpawnPanel();
  }

  function devArenaClearFoliage() {
    const zi = deps.zoneScenes.get(DEV_ARENA_ZONE_ID);
    const toRemove = [..._arenaSpawnedFoliage];
    for (const vegGroup of toRemove) {
      _arenaSpawnedFoliage.delete(vegGroup);
      deps.treeFadeActive.delete(vegGroup);
      vegGroup.parent?.remove(vegGroup);
      if (zi?.cullables) {
        const idx = zi.cullables.indexOf(vegGroup);
        if (idx !== -1) zi.cullables.splice(idx, 1);
      }
      vegGroup.traverse(o => {
        if (!o.isMesh) return;
        o.geometry?.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) { m?.map?.dispose(); m?.dispose(); }
      });
    }
    deps.showToast(`Cleared ${toRemove.length} arena object${toRemove.length === 1 ? '' : 's'}.`, true);
    renderDevSpawnPanel();
  }

  function toggle() {
    const panel = document.getElementById('devSpawnPanel');
    const btn = document.getElementById('devSpawnBtn');
    const open = panel?.style.display !== 'flex';
    if (panel) panel.style.display = open ? 'flex' : 'none';
    if (btn) btn.classList.toggle('fed-open', open);
    if (open) renderDevSpawnPanel();
  }

  // Pencil (farm editor) and 🐾 (dev spawner) toggle buttons share one
  // top-right UI slot and are mutually exclusive by area: farmEditBtn
  // previously had NO visibility gating at all and stayed on screen in
  // every area (town, wilderness, indoors) even though the editor itself
  // only ever does anything on the farm — this is what actually hides it
  // everywhere else, and reveals the spawner only inside the arena. Both
  // are unlimited free-spawn cheat tools (no inventory cost, no
  // permission/ownership nuance beyond isFarmOwner), so both are also
  // gated behind the player's own Dev Mode setting — a real player never
  // sees either button, regardless of area or farm ownership.
  function refreshEditorButtonVisibility() {
    const currentArea = deps.getCurrentArea();
    const devMode = deps.isDevMode();
    const showFarmEdit = devMode && currentArea === 'farm' && deps.isFarmOwner();
    const showDevSpawn = devMode && currentArea === DEV_ARENA_ZONE_ID;
    if (!showDevSpawn && deps.getDebugWeather()) deps.setDebugWeather(null);
    const farmBtn = document.getElementById('farmEditBtn');
    const spawnBtn = document.getElementById('devSpawnBtn');
    if (farmBtn) farmBtn.style.display = showFarmEdit ? '' : 'none';
    if (spawnBtn) spawnBtn.style.display = showDevSpawn ? '' : 'none';
    if (!showFarmEdit && deps.getFarmEditMode()) deps.toggleFarmEditMode();
    if (!showDevSpawn) {
      const panel = document.getElementById('devSpawnPanel');
      if (panel && panel.style.display !== 'none') { panel.style.display = 'none'; spawnBtn?.classList.remove('fed-open'); }
    }
  }

  function _bindListeners() {
    document.getElementById('devTeleportArenaBtn')?.addEventListener('click', teleportToDevArena);
    document.getElementById('devSpawnSpeciesGrid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.fed-btn');
      if (!btn) return;
      devSpawnSelectedKey = btn.dataset.species;
      renderDevSpawnPanel();
    });
    document.getElementById('devSpawnFoliageGrid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.fed-btn');
      if (!btn) return;
      devSpawnFoliageSelectedKey = btn.dataset.foliage;
      renderDevSpawnPanel();
    });
    document.getElementById('devSpawnBanditTierGrid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.fed-btn');
      if (!btn) return;
      devSpawnBanditTier = deps.clamp(Math.round(Number(btn.dataset.tier)) || 0, 0, 3);
      renderDevSpawnPanel();
    });
    document.getElementById('devSpawnBtnAction')?.addEventListener('click', () => {
      if (devSpawnSelectedKey?.startsWith('bandit:')) {
        spawnDevArenaBandit(devSpawnSelectedKey.slice('bandit:'.length), devSpawnBanditTier);
      } else {
        spawnDevArenaCreature(devSpawnSelectedKey);
      }
    });
    document.getElementById('devKillAllBtn')?.addEventListener('click', devArenaAutoKillAll);
    document.getElementById('devSpawnFoliageBtnAction')?.addEventListener('click', () => {
      spawnDevArenaFoliage(devSpawnFoliageSelectedKey);
    });
    document.getElementById('devClearFoliageBtn')?.addEventListener('click', devArenaClearFoliage);
    document.getElementById('devArenaWeatherGrid')?.addEventListener('click', (e) => {
      const button = e.target.closest('[data-weather]');
      if (button) setArenaWeather(button.dataset.weather);
    });
    document.getElementById('devRainPlaneModeGrid')?.addEventListener('click', (e) => {
      const button = e.target.closest('[data-rain-mode]');
      if (!button) return;
      deps.setRainPlaneSettings({ mode: button.dataset.rainMode });
      renderDevSpawnPanel();
    });
    const bindRainRuleGrid = (id) => document.getElementById(id)?.addEventListener('click', (e) => {
      const button = e.target.closest('[data-rain-rule]');
      if (!button) return;
      const current = deps.getRainPlaneSettings();
      deps.setRainPlaneSettings({ [button.dataset.rainRule]: !current[button.dataset.rainRule] });
      renderDevSpawnPanel();
    });
    bindRainRuleGrid('devRainPositionRuleGrid');
    bindRainRuleGrid('devRainRotationRuleGrid');
    bindRainRuleGrid('devRainScaleRuleGrid');
    const bindRainNumber = (id, key) => document.getElementById(id)?.addEventListener('change', (e) => {
      deps.setRainPlaneSettings({ [key]: e.target.value });
      renderDevSpawnPanel();
    });
    bindRainNumber('devRainRowSpacing', 'rowSpacingTiles');
    bindRainNumber('devRainFrontCount', 'frontCount');
    bindRainNumber('devRainBehindCount', 'behindCount');
    bindRainNumber('devRainSpeedMultiplier', 'speedMultiplier');
  }

  function initWithBinding(injectedDeps) {
    init(injectedDeps);
    _bindListeners();
  }

  window.DevSpawner = {
    init: initWithBinding,
    DEV_ARENA_ZONE_ID,
    getArenaSpawnedCreatures: () => _arenaSpawnedCreatures,
    teleportToDevArena,
    toggle,
    refreshEditorButtonVisibility,
    setArenaWeather,
  };
})();
