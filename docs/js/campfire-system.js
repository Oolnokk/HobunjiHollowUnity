// Portable campfire: one per current map visit, persisted across page sessions,
// destroyed on a real map change, and used as a sleep/login checkpoint.
(() => {
  'use strict';
  if (window.CampfireSystem) return;

  const ITEM_KEY = 'campfireKit';
  const NAME = 'Campfire';
  const ICON = '🔥';
  const CRAFT_COST = Object.freeze({ wood: 3, stone: 4 });
  const INTERACT_RADIUS_TILES = 1.8;
  const SAVE_FIELD = 'campfireState';
  const STATE_VERSION = 1;

  const state = {
    craftingDeps: null,
    furnitureDeps: null,
    worldDeps: null,
    calendarDeps: null,
    camera: null,
    armed: false,
    record: null,
    visual: null,
    profileKey: '',
    bootstrapDone: false,
    restoring: false,
    lastArea: '',
    pendingSleep: null,
    controllerWasDown: false,
    actionButtonId: '',
  };

  const pointerRay = typeof THREE !== 'undefined' ? new THREE.Raycaster() : null;
  const pointerNdc = typeof THREE !== 'undefined' ? new THREE.Vector2() : null;
  const pointerPlane = typeof THREE !== 'undefined' ? new THREE.Plane(new THREE.Vector3(0, 1, 0), 0) : null;
  const pointerHit = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
  const downRay = typeof THREE !== 'undefined' ? new THREE.Raycaster() : null;
  const downOrigin = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
  const downDirection = typeof THREE !== 'undefined' ? new THREE.Vector3(0, -1, 0) : null;
  const normalScratch = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;

  function log(message, level = 'info', category = 'world') {
    window.__farmLog?.(`[campfire] ${message}`, level, category);
  }

  function profileIdentity() {
    const profile = window.__hobunjiPlayerProfile;
    const worldId = profile?.worldId;
    const characterId = profile?.characterId;
    return worldId && characterId ? { worldId, characterId, key: `${worldId}::${characterId}` } : null;
  }

  function withMember(mutator) {
    const id = profileIdentity();
    if (!id) return null;
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      const world = (meta?.worlds || []).find(entry => entry.id === id.worldId);
      if (!world) return null;
      world.members ||= {};
      const member = world.members[id.characterId] || (world.members[id.characterId] = { joinedAt: Date.now() });
      const value = mutator(member, world, meta);
      localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
      return value;
    } catch (error) {
      log(`save metadata update failed: ${error?.message || error}`, 'warn', 'storage');
      return null;
    }
  }

  function loadRecord() {
    return withMember(member => {
      const value = member[SAVE_FIELD];
      if (!value || value.version !== STATE_VERSION || !value.area) return null;
      return JSON.parse(JSON.stringify(value));
    });
  }

  function persistRecord(record = state.record) {
    withMember(member => {
      if (record) member[SAVE_FIELD] = JSON.parse(JSON.stringify(record));
      else delete member[SAVE_FIELD];
    });
  }

  function ownedCount() {
    return Math.max(0, Number(state.craftingDeps?.inventory?.[ITEM_KEY]) || 0);
  }

  function setOwnedCount(value) {
    const deps = state.craftingDeps;
    if (!deps?.inventory) return;
    deps.inventory[ITEM_KEY] = Math.max(0, Math.min(99, Math.round(Number(value) || 0)));
    deps.clampInventoryStack?.(ITEM_KEY);
    deps.buildInventoryGrid?.();
    deps.saveMemberWorldData?.();
    state.furnitureDeps?.render?.();
  }

  function woodCount() {
    const inv = state.craftingDeps?.inventory || {};
    return (Number(inv.pineLog) || 0) + (Number(inv.shadewoodLog) || 0);
  }

  function consumeWood(amount) {
    const deps = state.craftingDeps;
    let remaining = Math.max(0, amount | 0);
    for (const key of ['pineLog', 'shadewoodLog']) {
      if (remaining <= 0) break;
      const have = Number(deps.inventory[key]) || 0;
      const take = Math.min(have, remaining);
      deps.inventory[key] = have - take;
      deps.clampInventoryStack?.(key);
      remaining -= take;
    }
  }

  function craft() {
    const deps = state.craftingDeps;
    if (!deps?.inventory) return false;
    if (ownedCount() >= 99) {
      deps.showToast?.('Campfire stack is full.', false);
      return false;
    }
    if (woodCount() < CRAFT_COST.wood) {
      deps.showToast?.(`Not enough wood — need ${CRAFT_COST.wood} Pine/Shadewood Logs.`, false);
      return false;
    }
    if ((Number(deps.inventory.stone) || 0) < CRAFT_COST.stone) {
      deps.showToast?.(`Not enough stone — need ${CRAFT_COST.stone}.`, false);
      return false;
    }
    consumeWood(CRAFT_COST.wood);
    deps.inventory.stone -= CRAFT_COST.stone;
    deps.clampInventoryStack?.('stone');
    deps.inventory[ITEM_KEY] = Math.min(99, (Number(deps.inventory[ITEM_KEY]) || 0) + 1);
    deps.showToast?.(`${ICON} Crafted a ${NAME}.`, true);
    deps.buildInventoryGrid?.();
    deps.saveMemberWorldData?.();
    state.furnitureDeps?.render?.();
    return true;
  }

  function currentArea() {
    return state.worldDeps?.getCurrentArea?.() || state.furnitureDeps?.getCurrentArea?.() || '';
  }

  function isPortableMap(area = currentArea()) {
    const deps = state.worldDeps;
    if (!area || !deps) return false;
    // Campsites are outdoor-only. Farm and generated exterior zones are valid;
    // interiors/buildings/town are map changes and therefore destroy the camp.
    return area === 'farm' || !!deps.EXTERIOR_ZONES?.[area];
  }

  function areaBounds(area = currentArea()) {
    const d = state.worldDeps;
    if (!d) return null;
    if (area === 'farm') return { cols: Number(d.COLS) || 1, rows: Number(d.ROWS) || 1 };
    const z = d.EXTERIOR_ZONES?.[area];
    if (!z) return null;
    const built = d.buildZoneScene?.(area);
    return {
      cols: Number(built?.cols ?? z.cols) || 1,
      rows: Number(built?.rows ?? z.rows) || 1,
    };
  }

  function clampTile(value, max) {
    return Math.max(0, Math.min(Math.max(0, max - 1), Math.floor(value)));
  }

  function pointerTile(clientX, clientY) {
    if (!state.camera || !pointerRay || !pointerPlane || !pointerHit) return null;
    const canvas = document.getElementById('threeContainer');
    const rect = canvas?.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return null;
    pointerNdc.x = ((Number(clientX) - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((Number(clientY) - rect.top) / rect.height) * 2 + 1;
    pointerRay.setFromCamera(pointerNdc, state.camera);
    const scene = state.worldDeps?.getActiveScene?.(); // Active terrain is authoritative on elevated wilderness maps.
    const hits = scene ? pointerRay.intersectObjects(scene.children || [], true) : [];
    for (const hit of hits) {
      if (!hit?.object?.isMesh || likelyNonGroundObject(hit.object)) continue;
      if (hit.face?.normal && normalScratch) {
        normalScratch.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (normalScratch.y < 0.35) continue;
      }
      if (!Number.isFinite(hit.point?.x) || !Number.isFinite(hit.point?.y) || !Number.isFinite(hit.point?.z)) continue;
      const bounds = areaBounds();
      if (!bounds) return null;
      return {
        col: clampTile(hit.point.x, bounds.cols),
        row: clampTile(hit.point.z, bounds.rows),
        surfaceY: hit.point.y,
      };
    }

    const d = state.worldDeps;
    const playerCol = Math.floor((Number(d?.player?.x) || 0) / (Number(d?.TILE) || 1)); // Fallback plane follows the player's terrain tier, never global y=0.
    const playerRow = Math.floor((Number(d?.player?.y) || 0) / (Number(d?.TILE) || 1));
    const playerTile = d?.getActiveGrid?.()?.[playerRow]?.[playerCol];
    const fallbackY = Number(d?.tileSurfaceYInArea?.(playerTile, currentArea())) || 0;
    pointerPlane.constant = -fallbackY;
    if (!pointerRay.ray.intersectPlane(pointerPlane, pointerHit)) return null;
    const bounds = areaBounds();
    if (!bounds) return null;
    return {
      col: clampTile(pointerHit.x, bounds.cols),
      row: clampTile(pointerHit.z, bounds.rows),
      surfaceY: fallbackY,
    };
  }

  function objectBelongsToIgnoredRoot(object) {
    const d = state.worldDeps;
    let node = object;
    while (node) {
      if (node === state.visual?.group || node === d?.playerMesh || node === d?.toolHolder || node === d?.reticleMesh || node === d?.reticleCircleMesh || node === d?.reticleRingMesh || node === d?.reticleWavyGroup) return true;
      node = node.parent;
    }
    return false;
  }

  function likelyNonGroundObject(object) {
    if (!object) return true;
    if (objectBelongsToIgnoredRoot(object)) return true;
    if (object.userData?.isBillboard || object.userData?.isPngPlaneAvatar) return true;
    const names = [];
    let node = object;
    for (let depth = 0; node && depth < 4; depth++, node = node.parent) names.push(String(node.name || ''));
    const name = names.join(' ').toLowerCase();
    return /avatar|creature|npc|companion|foliage|tree|shrub|bush|crop|furniture|building|roof|wall|door|totem|tent/.test(name);
  }

  // Programmatic/fallback placement resolves a tile's actual visible surface
  // with a downward ray so plateau/ramp camps do not sink to elevation 0.
  function surfaceYAtTile(col, row) {
    const scene = state.worldDeps?.getActiveScene?.();
    if (!scene || !downRay || !downOrigin || !downDirection) return 0;
    downOrigin.set(col + 0.5, 256, row + 0.5);
    downRay.set(downOrigin, downDirection);
    downRay.near = 0;
    downRay.far = 512;
    const hits = downRay.intersectObjects(scene.children || [], true);
    for (const hit of hits) {
      if (!hit?.object?.isMesh || likelyNonGroundObject(hit.object)) continue;
      if (hit.face?.normal && normalScratch) {
        normalScratch.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (normalScratch.y < 0.35) continue;
      }
      if (Number.isFinite(hit.point?.y)) return hit.point.y;
    }
    return 0;
  }

  function disposeVisual() {
    const visual = state.visual;
    if (!visual) return;
    try { visual.scene?.remove?.(visual.group); } catch (_) {}
    try { visual.scene?.remove?.(visual.light); } catch (_) {}
    try { window.Music?.unregisterFurnitureSfxSource?.(visual.sfxSource); } catch (_) {}
    visual.group?.traverse?.(obj => {
      obj.geometry?.dispose?.();
      if (Array.isArray(obj.material)) obj.material.forEach(mat => mat?.dispose?.());
      else obj.material?.dispose?.();
    });
    state.visual = null;
  }

  function markOutlined(mesh) {
    mesh.layers?.enable?.(1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function buildVisual(record, scene) {
    if (!record || !scene || typeof THREE === 'undefined') return null;
    const group = new THREE.Group();
    group.name = 'player_campfire';

    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x77736d });
    const logMat = new THREE.MeshLambertMaterial({ color: 0x5c3820 });
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xff7a22 });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffbd45, transparent: true, opacity: 0.88, depthWrite: false });

    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      const stone = markOutlined(new THREE.Mesh(new THREE.DodecahedronGeometry(0.11, 0), stoneMat.clone()));
      stone.position.set(Math.cos(a) * 0.34, 0.09, Math.sin(a) * 0.34);
      stone.scale.y = 0.65;
      group.add(stone);
    }
    for (const rot of [-Math.PI / 4, Math.PI / 4, Math.PI / 2]) {
      const logMesh = markOutlined(new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.085, 0.62, 7), logMat.clone()));
      logMesh.rotation.z = Math.PI / 2;
      logMesh.rotation.y = rot;
      logMesh.position.y = 0.14;
      group.add(logMesh);
    }
    const ember = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.05, 10), emberMat);
    ember.position.y = 0.09;
    group.add(ember);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.48, 7), flameMat);
    flame.name = 'campfire_flame';
    flame.position.y = 0.38;
    group.add(flame);

    group.position.set(record.col + 0.5, Number(record.surfaceY) || 0, record.row + 0.5);
    scene.add(group);

    const light = new THREE.PointLight(0xff7a24, 1.55, 7, 2);
    light.position.set(record.col + 0.5, (Number(record.surfaceY) || 0) + 0.55, record.row + 0.5);
    light.userData.furnitureLightMask = true;
    scene.add(light);

    const fireSfx = window.AudioSystem?.gameAudioConfig?.()?.furnitureSfx?.fireplace;
    const sfxSource = fireSfx && window.Music?.registerFurnitureSfxSource
      ? window.Music.registerFurnitureSfxSource(record.area, record.col + 0.5, record.row + 0.5, fireSfx)
      : null;

    state.visual = { scene, group, light, flame, sfxSource };
    return state.visual;
  }

  function ensureVisual() {
    if (!state.record || currentArea() !== state.record.area) return false;
    const scene = state.worldDeps?.getActiveScene?.();
    if (!scene) return false;
    if (state.visual?.scene === scene && state.visual.group?.parent === scene) return true;
    disposeVisual();
    return !!buildVisual(state.record, scene);
  }

  function destroy({ refund = false, persist = true, reason = 'removed' } = {}) {
    const had = !!state.record;
    disposeVisual();
    state.record = null;
    state.pendingSleep = null;
    state.armed = false;
    if (persist) persistRecord(null);
    if (refund && had) setOwnedCount(ownedCount() + 1);
    syncActionButton();
    state.furnitureDeps?.render?.();
    if (had) log(`${reason}; checkpoint cleared${refund ? ' and kit returned' : ''}.`);
    return had;
  }

  function placeAtTile(col, row, resolvedSurfaceY = null) {
    const d = state.worldDeps;
    const area = currentArea();
    if (!d || !state.craftingDeps?.inventory) return false;
    if (!isPortableMap(area)) {
      d.showToast?.('Campfires can only be placed outdoors.', false);
      return false;
    }
    if (ownedCount() < 1) {
      d.showToast?.('No Campfire in inventory.', false);
      armPlacement(false);
      return false;
    }
    const bounds = areaBounds(area);
    if (!bounds) return false;
    col = clampTile(col, bounds.cols);
    row = clampTile(row, bounds.rows);
    if (d.canPlaceCampfireAt?.(col, row) === false) {
      d.showToast?.('Place the campfire on a clear, dry tile.', false);
      return false;
    }

    // One campsite per map visit. Replacing it intentionally does not refund
    // the old kit; the newly placed fire consumes the new crafted kit.
    if (state.record) destroy({ refund: false, persist: false, reason: 'replaced by a newer campfire' });
    setOwnedCount(ownedCount() - 1);
    state.record = {
      version: STATE_VERSION,
      area,
      col,
      row,
      surfaceY: Number.isFinite(resolvedSurfaceY) ? resolvedSurfaceY : surfaceYAtTile(col, row),
      placedAt: Date.now(),
      checkpoint: null,
    };
    persistRecord();
    ensureVisual();
    armPlacement(false);
    d.showToast?.(`${ICON} Campfire placed. Sleep here to make this your next-login checkpoint.`, true);
    state.furnitureDeps?.render?.();
    syncActionButton();
    return true;
  }

  function placeAtPointer(clientX, clientY) {
    if (!state.armed) return false;
    const tile = pointerTile(clientX, clientY);
    if (!tile) {
      state.worldDeps?.showToast?.('Could not find a ground tile there.', false);
      return false;
    }
    return placeAtTile(tile.col, tile.row, tile.surfaceY);
  }

  function armPlacement(enabled = true) {
    const next = !!enabled;
    if (next && !isPortableMap()) {
      state.worldDeps?.showToast?.('Campfires can only be placed outdoors.', false);
      return false;
    }
    if (next && ownedCount() < 1) {
      state.worldDeps?.showToast?.('Craft a Campfire first.', false);
      return false;
    }
    state.armed = next;
    state.furnitureDeps?.render?.();
    return true;
  }

  function nearCampfire() {
    const d = state.worldDeps;
    if (!state.record || currentArea() !== state.record.area || !d?.player || !d.TILE) return false;
    const px = Number(d.player.x) / d.TILE;
    const pz = Number(d.player.y) / d.TILE;
    return Math.hypot(px - (state.record.col + 0.5), pz - (state.record.row + 0.5)) <= INTERACT_RADIUS_TILES;
  }

  function beginSleep() {
    if (!nearCampfire() || state.pendingSleep) return false;
    const calendar = state.calendarDeps?.calendar;
    if (!calendar || typeof window.CalendarSystem?.openTimePassage !== 'function') return false;
    const opened = window.CalendarSystem.openTimePassage('sleep'); // Only an actually opened sleep dialog may arm a checkpoint.
    if (!opened) return false;
    state.pendingSleep = { day: Number(calendar.day), time01: Number(calendar.time01) };
    return true;
  }

  function completeSleepCheckpoint(event) {
    if (!state.pendingSleep || event?.detail?.kind !== 'sleep') return false;
    state.pendingSleep = null;
    const d = state.worldDeps;
    if (!state.record || currentArea() !== state.record.area || !d?.player) return false;
    state.record.checkpoint = {
      x: Number(d.player.x),
      y: Number(d.player.y),
      angle: Number(d.player.angle) || 0,
    };
    state.record.sleptAt = Date.now();
    persistRecord();
    state.craftingDeps?.saveMemberWorldData?.();
    d.showToast?.('🔥 Campfire checkpoint saved. You will return here next login.', true);
    log(`sleep checkpoint saved area=${state.record.area} x=${state.record.checkpoint.x.toFixed(1)} y=${state.record.checkpoint.y.toFixed(1)}`, 'info', 'storage');
    return true;
  }

  function cancelPendingSleepIfClosed() {
    if (!state.pendingSleep) return;
    const backdrop = document.querySelector?.('.time-passage-backdrop'); // A closed dialog without a sleep event means cancel/backdrop/Escape.
    if (!backdrop?.classList?.contains('open')) state.pendingSleep = null;
  }

  async function restoreCheckpoint() {
    const d = state.worldDeps;
    const rec = state.record;
    if (!d || !rec?.checkpoint || !isPortableMap(rec.area) || typeof d.restoreCampfireCheckpoint !== 'function') return false;
    state.restoring = true;
    try {
      const restored = await d.restoreCampfireCheckpoint(rec); // game.js owns the complete zone-entry lifecycle and private facing state.
      if (!restored) return false;
      state.lastArea = rec.area;
      ensureVisual();
      log(`restored login checkpoint in ${rec.area} at ${d.player.x.toFixed(1)},${d.player.y.toFixed(1)}`, 'info', 'storage');
      return true;
    } catch (error) {
      log(`checkpoint restore failed: ${error?.message || error}`, 'warn', 'storage');
      return false;
    } finally {
      state.restoring = false;
    }
  }

  function bootstrap() {
    if (state.bootstrapDone || !state.worldDeps || !window.__hobunjiGameStarted) return;
    const id = profileIdentity();
    if (!id) return;
    state.profileKey = id.key;
    state.record = loadRecord();
    state.bootstrapDone = true;
    state.lastArea = currentArea();
    if (state.record?.checkpoint) void restoreCheckpoint();
    else if (state.record?.area === currentArea()) ensureVisual();
    log(state.record ? `restored persisted campfire state for ${state.record.area}${state.record.checkpoint ? ' with checkpoint' : ' (not yet slept)'}` : 'no persisted campfire for this member', 'info', 'storage');
  }

  function mapLifecycleTick() {
    bootstrap();
    const id = profileIdentity();
    if (state.bootstrapDone && id?.key && state.profileKey && id.key !== state.profileKey) {
      disposeVisual();
      state.record = null;
      state.bootstrapDone = false;
      state.profileKey = '';
      state.lastArea = currentArea();
      return;
    }
    if (!state.bootstrapDone || state.restoring) return;
    const area = currentArea();
    if (state.lastArea && area && area !== state.lastArea) {
      const old = state.lastArea;
      state.lastArea = area;
      if (state.record) destroy({ refund: false, persist: true, reason: `map changed ${old} -> ${area}` });
      armPlacement(false);
    } else if (area) {
      state.lastArea = area;
    }
    if (state.record) ensureVisual();
  }

  function controllerCodeDown(code) {
    if (!code) return false;
    let pad = null;
    try { pad = Array.from(navigator.getGamepads?.() || []).find(Boolean) || null; } catch (_) {}
    if (!pad) return false;
    const threshold = Number(window.__hobunjiInputBindingContext?.inputDefaults?.axisPressThreshold) || 0.55;
    if (code === 'LeftTrigger') return !!pad.buttons?.[6]?.pressed || Number(pad.buttons?.[6]?.value || 0) >= threshold;
    if (code === 'RightTrigger') return !!pad.buttons?.[7]?.pressed || Number(pad.buttons?.[7]?.value || 0) >= threshold;
    const m = /^Button(\d+)$/.exec(code);
    return m ? (!!pad.buttons?.[Number(m[1])]?.pressed || Number(pad.buttons?.[Number(m[1])]?.value || 0) >= threshold) : false;
  }

  function syncActionButton() {
    const near = nearCampfire();
    const ids = ['btnAction1', 'btnAction2', 'btnAction3', 'btnAction4', 'btnAction5', 'btnAction6', 'btnAction7', 'btnAction8'];
    let button = state.actionButtonId ? document.getElementById(state.actionButtonId) : null;
    if (near) {
      if (!button || (button.dataset.campfireInjected !== '1' && !button.classList.contains('abt-hidden'))) {
        button = ids.map(id => document.getElementById(id)).find(el => el?.dataset.campfireInjected === '1' || el?.classList.contains('abt-hidden')) || null;
        state.actionButtonId = button?.id || '';
      }
      if (button) {
        const desktop = window.matchMedia?.('(pointer: fine)')?.matches;
        const code = window.InputBindingRuntime?.bindingFor?.('desktop', 'interact');
        const key = desktop && code ? `<span class="abt-key">[${window.InputBindingRuntime?.labelForCode?.(code) || code}]</span>` : '';
        button.dataset.campfireInjected = '1';
        button.dataset.action = 'campfire_sleep';
        button.classList.remove('abt-hidden', 'blocked');
        button.innerHTML = `${key}<span class="abt-icon">😴</span><span class="abt-label">Sleep</span>`;
      }
    } else if (button?.dataset.campfireInjected === '1') {
      if (button.dataset.action === 'campfire_sleep') {
        button.classList.add('abt-hidden');
        delete button.dataset.action;
        button.innerHTML = '';
      }
      delete button.dataset.campfireInjected;
      state.actionButtonId = '';
    }
  }

  function updateVisual(now) {
    const visual = state.visual;
    if (!visual) return;
    const t = now * 0.001;
    if (visual.flame) {
      visual.flame.scale.y = 0.92 + Math.sin(t * 8.3) * 0.09 + Math.sin(t * 13.7) * 0.04;
      visual.flame.rotation.y = t * 0.7;
    }
    if (visual.light) visual.light.intensity = 1.45 + Math.sin(t * 10.7) * 0.12 + Math.sin(t * 17.1) * 0.07;
  }

  function tick(now) {
    mapLifecycleTick();
    cancelPendingSleepIfClosed();
    syncActionButton();
    updateVisual(now);
    const interactCode = window.InputBindingRuntime?.bindingFor?.('controller', 'interact');
    const down = nearCampfire() && controllerCodeDown(interactCode);
    if (down && !state.controllerWasDown) beginSleep();
    state.controllerWasDown = down;
    requestAnimationFrame(tick);
  }

  function physicalAction(event) {
    if (!nearCampfire() || state.armed) return null;
    if (event.type === 'keydown') return window.InputBindingRuntime?.actionFor?.('desktop', event.code);
    return null;
  }

  function gameplayPointerTarget(target) {
    const three = document.getElementById('threeContainer');
    return !!three && (target === three || three.contains(target));
  }

  // Touch/pen placement can arrive here directly. Mouse placement is routed
  // through InputBindingRuntime (which registered its capture listener earlier)
  // and calls the same public placeAtPointer method below.
  window.addEventListener('pointerdown', event => {
    if (!state.armed || !gameplayPointerTarget(event.target) || event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    placeAtPointer(event.clientX, event.clientY);
  }, true);

  window.addEventListener('keydown', event => {
    if (event.repeat || physicalAction(event) !== 'interact') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginSleep();
  }, true);

  document.addEventListener('pointerdown', event => {
    const button = event.target?.closest?.('[data-action="campfire_sleep"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginSleep();
  }, true);

  window.addEventListener('hobunji-time-passage', completeSleepCheckpoint);

  function patchDevSpawner(value) {
    if (!value || value.__campfirePatched) return value;
    const rawInit = value.init;
    if (typeof rawInit === 'function') {
      value.init = function campfireDevSpawnerInit(injectedDeps, ...rest) {
        state.worldDeps = injectedDeps;
        return rawInit.call(this, injectedDeps, ...rest);
      };
    }
    value.__campfirePatched = true;
    return value;
  }

  function patchCalendarSystem(value) {
    if (!value || value.__campfirePatched) return value;
    const rawInit = value.init;
    if (typeof rawInit === 'function') {
      value.init = function campfireCalendarInit(injectedDeps, ...rest) {
        state.calendarDeps = injectedDeps;
        return rawInit.call(this, injectedDeps, ...rest);
      };
    }
    value.__campfirePatched = true;
    return value;
  }

  function patchPixelProbe(value) {
    if (!value || value.__campfirePatched) return value;
    const rawInit = value.init;
    if (typeof rawInit === 'function') {
      value.init = function campfirePixelProbeInit(injectedDeps, ...rest) {
        state.camera = injectedDeps?.camera || state.camera;
        return rawInit.call(this, injectedDeps, ...rest);
      };
    }
    value.__campfirePatched = true;
    return value;
  }

  function interceptGlobal(name, patcher) {
    let current = window[name];
    if (current) { patcher(current); return; }
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && !descriptor.configurable) {
      const poll = () => {
        if (window[name]) patcher(window[name]);
        else requestAnimationFrame(poll);
      };
      poll();
      return;
    }
    const previousGet = descriptor?.get; // Preserve earlier feature interceptors waiting on the same late global.
    const previousSet = descriptor?.set;
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get() { return previousGet ? previousGet.call(window) : current; },
      set(value) {
        if (previousSet) previousSet.call(window, value);
        const assigned = previousGet ? previousGet.call(window) : value; // Earlier setters may have wrapped or replaced the assignment.
        current = patcher(assigned);
      },
    });
  }

  function attachCraftingDeps(deps) { state.craftingDeps = deps; }
  function attachFurnitureDeps(deps) { state.furnitureDeps = deps; }

  function snapshot() {
    return {
      itemKey: ITEM_KEY,
      owned: ownedCount(),
      armed: state.armed,
      area: currentArea(),
      portableMap: isPortableMap(),
      near: nearCampfire(),
      campfire: state.record ? JSON.parse(JSON.stringify(state.record)) : null,
      checkpointActive: !!state.record?.checkpoint,
      visualLive: !!state.visual?.group?.parent,
      bootstrapDone: state.bootstrapDone,
      restoring: state.restoring,
      pendingSleep: state.pendingSleep ? { ...state.pendingSleep } : null,
      cameraReady: !!state.camera,
      profileKey: state.profileKey,
    };
  }

  window.CampfireSystem = Object.freeze({
    ITEM_KEY, NAME, ICON, CRAFT_COST,
    attachCraftingDeps,
    attachFurnitureDeps,
    craft,
    ownedCount,
    woodCount,
    armPlacement,
    placeAtPointer,
    get armed() { return state.armed; },
    canPlaceHere: isPortableMap,
    current: () => state.record ? JSON.parse(JSON.stringify(state.record)) : null,
    nearCampfire,
    beginSleep,
    remove: (refund = true) => destroy({ refund: !!refund, persist: true, reason: 'removed manually' }),
    snapshot,
  });

  interceptGlobal('DevSpawner', patchDevSpawner);
  interceptGlobal('CalendarSystem', patchCalendarSystem);
  interceptGlobal('PixelProbe', patchPixelProbe);
  requestAnimationFrame(tick);
  log('portable campfire runtime installed; waiting for game dependencies.', 'info', 'general');
})();
