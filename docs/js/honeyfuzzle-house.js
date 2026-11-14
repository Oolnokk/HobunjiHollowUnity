(() => {
  'use strict';

  // Honeyfuzzle House: the 1x1 farm building every honeyfuzzle swarm lives in
  // (swarms are never barn animals, and there is no incubator for them). It is
  // registered as a FarmProduction building (config/farm-specializations.js,
  // key 'honeyfuzzleHouse'), so placing, moving, rotating, saving and the
  // carpenter's plan all come from js/farm-production.js. Like a processor it
  // is never entered: the player manages it from outside.
  //
  // One slot per house: a queen settles first, then becomes a live swarm record.
  // Old house.egg saves migrate in ensure(), without resetting their countdown.
  //             (kind 'honeyfuzzle', houseId = entry.id); it hovers over the house
  //             and can be moved to the personal stable from the Livestock list.

  const KEY = 'honeyfuzzleHouse';
  const KIND = 'honeyfuzzle';
  const QUEEN_ITEM = 'honeyfuzzleQueen'; // One queen comes from each harvested stump.
  const LEGACY_EGG_ITEM = 'fertileHoneyfuzzleEgg'; // Existing saved eggs are accepted as queens.
  const DEFAULT_ESTABLISH_DAYS = 2; // Founding a colony takes the former incubation time.
  const SCHEDULER_ID = 'honeyfuzzle-house-swarms';
  const HOVER_HEIGHT = 0.95; // World units above the farm surface: just over the stump's cap.

  let deps = null; // { THREE, getCamera, getCurrentArea, inventory, loadWorldLivestock, saveWorldLivestock, hasFarmPermission, showToast, saveFarmLayout, saveMemberWorldData, surfaceY, refreshInventory, scene }
  const visuals = new Map(); // entry.id -> { entry, avatar, group }
  let schedulerRegistered = false;
  let lastFrameMs = 0;

  function registerQueenItem(itemDefs) {
    if (!itemDefs) return;
    const base = { ...(itemDefs[LEGACY_EGG_ITEM] || {}), ...(itemDefs[QUEEN_ITEM] || {}) }; // Honor explicit queen tuning, else inherit old trade value.
    itemDefs[QUEEN_ITEM] = {
      ...base, label: 'Honeyfuzzle Queen', icon: '👑', cat: 'livestock',
      tags: ['Livestock', 'Queen'], desc: 'A wild queen that can establish a swarm in a Honeyfuzzle House.',
    }; // Shared item registry, used by both the farm and wilderness initializers.
  }
  function init(injectedDeps) { deps = injectedDeps; registerQueenItem(deps?.ITEM_DEFS); }

  const definition = () => window.FARM_SPECIALIZATIONS_CONFIG?.buildings?.[KEY] || {};
  const establishDays = () => Number(definition().establishDays ?? definition().hatchDays) || DEFAULT_ESTABLISH_DAYS;

  const tonicKey = () => window.ANIMAL_GROWTH_CONFIG?.item?.key || 'growthTonic';
  const isHouse = entry => entry?.key === KEY;

  function ensure(entry) { // Convert old saved eggs into establishing queens without discarding their inherited coat.
    if (!entry.house || typeof entry.house !== 'object') entry.house = { queen: null, livestockId: null };
    if (entry.house.queen == null && entry.house.egg) entry.house.queen = entry.house.egg;
    if (entry.house.queen && !Number.isFinite(entry.house.queen.readyAt)) {
      const queen = entry.house.queen;
      queen.readyAt = Number.isFinite(queen.hatchAt) ? queen.hatchAt : (Number(queen.placedAt) || 0) + establishDays();
    }
    delete entry.house.egg;
    if (!('queen' in entry.house)) entry.house.queen = null;
    if (!('livestockId' in entry.house)) entry.house.livestockId = null;
    return entry.house;
  }
  function swarmRecord(entry, byId = null) {
    const house = ensure(entry);
    if (!house.livestockId || !deps) return null;
    const candidate = byId ? byId.get(house.livestockId) : deps.loadWorldLivestock().find(item => item.id === house.livestockId);
    const record = candidate?.kind === KIND ? candidate : null;
    if (!record) house.livestockId = null; // A moved/sold colony leaves the house empty.
    return record;
  }
  function phase(entry) {
    const house = ensure(entry);
    if (swarmRecord(entry)) return 'swarm';
    return house.queen ? 'queen' : 'empty';
  }

  const bagCount = key => Math.max(0, Number(deps?.inventory?.[key]) || 0); // Missing keys are 0, never NaN.

  function persist() {
    deps.saveFarmLayout?.();
    deps.saveMemberWorldData?.();
    deps.refreshInventory?.();
  }

  // ---- actions --------------------------------------------------------------

  function placeQueen(entry) {
    if (!deps.hasFarmPermission('livestock')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    if (phase(entry) !== 'empty') return { ok: false, message: 'This house is already occupied.' };
    const itemKey = bagCount(QUEEN_ITEM) ? QUEEN_ITEM : LEGACY_EGG_ITEM; // Old inventory stacks remain usable.
    if (bagCount(itemKey) < 1) return { ok: false, message: 'You have no Honeyfuzzle Queen.' };
    const now = window.FarmProduction.now();
    deps.inventory[itemKey] = bagCount(itemKey) - 1;
    const colors = window.HoneyfuzzleColors;
    const appearance = colors?.takeQueenAppearance?.(deps.getWorldId?.())
      || (!colors?.takeQueenAppearance ? colors?.takeEggAppearance?.(deps.getWorldId?.()) : null) || null;
    const color = appearance?.color || (!colors?.takeQueenAppearance && !colors?.takeEggAppearance
      ? colors?.takeEggColor?.(deps.getWorldId?.()) : null)
      || colors?.pickForKey('', 'queen' + Math.random()) || null;
    ensure(entry).queen = { placedAt: now, readyAt: now + establishDays(), color,
      genotype: appearance?.genotype || null }; // Preserve the hive queen's inherited primary and secondary markings.
    persist();
    return { ok: true, message: `👑 The queen is settling into her house. Her colony forms in ${establishDays()} days.` };
  }

  function establish(entry) {
    const house = ensure(entry);
    if (!house.queen) return { ok: false, message: 'There is no queen establishing a colony.' };
    const list = deps.loadWorldLivestock();
    const id = 'livestock_' + Math.random().toString(36).slice(2, 10);
    const name = window.CreatureGenetics?.defaultLivestockName?.(KIND) || 'Honeyfuzzle Swarm';
    const genotype = house.queen.genotype || window.CreatureGenetics?.makeDefaultGenotype?.(KIND) || null;
    if (genotype?.base && house.queen.color) genotype.base.color = house.queen.color;
    list.push({
      id, kind: KIND, barnId: null, houseId: entry.id, troughIndex: null, releasedAt: Date.now(),
      lifeStage: 'adult', // House colonies enter the stable as adults, not incubator babies.
      name, genotype, swarmColor: house.queen.color || null, daysUntilResource: null, resourceReady: false, heartLevel: 2,
    });
    deps.saveWorldLivestock(list);
    house.queen = null;
    house.livestockId = id;
    syncVisual(entry);
    persist();
    return { ok: true, message: `🍯 The queen established her colony: a ${name} now lives in the house.` };
  }

  function useTonic(entry) {
    if (!deps.hasFarmPermission('livestock')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    if (phase(entry) !== 'queen') return { ok: false, message: 'There is no queen establishing a colony.' };
    if (bagCount(tonicKey()) < 1) return { ok: false, message: 'You have no Growth Tonic.' };
    deps.inventory[tonicKey()] = bagCount(tonicKey()) - 1;
    return establish(entry); // Growth Tonic speeds colony founding, rather than hatching an adult queen.
  }

  // The existing one-second farm timer remains the sole colony scheduler.
  function tick(buildings, now) {
    if (!deps) return;
    const houses = buildings.filter(isHouse); // Farm houses only; unrelated production buildings are ignored.
    for (const entry of houses) {
      const house = ensure(entry);
      if (house.queen && Number.isFinite(house.queen.readyAt) && now >= house.queen.readyAt) {
        const result = establish(entry);
        if (result.ok) deps.showToast(result.message, true);
      }
    }
    const occupied = houses.some(entry => !!entry.house?.livestockId);
    const recordsById = occupied
      ? new Map(deps.loadWorldLivestock().filter(item => item.kind === KIND).map(item => [item.id, item]))
      : null; // A single inventory/save read serves all houses, after any new colonies establish.
    for (const entry of houses) {
      if (entry.house?.livestockId || visuals.has(entry.id)) syncVisual(entry, undefined, recordsById);
    }
  }

  // ---- hovering swarm visual --------------------------------------------------

  function ensureScheduler() {
    const scheduler = window.RuntimeFrameScheduler;
    if (!scheduler) return;
    if (!schedulerRegistered) {
      scheduler.register(SCHEDULER_ID, updateFrame, { phase: 'post-game', owner: 'HoneyfuzzleHouse', description: 'Animates the swarms hovering over occupied Honeyfuzzle Houses on the farm.', enabled: false });
      schedulerRegistered = true;
    }
    scheduler.setEnabled(SCHEDULER_ID, visuals.size > 0);
  }

  function updateFrame({ timestamp }) {
    if (!deps || deps.getCurrentArea?.() !== 'farm') return;
    const camera = deps.getCamera?.();
    const dt = lastFrameMs ? Math.min(0.1, (timestamp - lastFrameMs) / 1000) : 0;
    lastFrameMs = timestamp;
    for (const { avatar, group } of visuals.values()) {
      avatar.update(30, timestamp, dt, 150); // A slow drift (leaders/trailers show) while hovering.
      if (camera) avatar.frontPlane.rotation.y = Math.atan2(camera.position.x - group.position.x, camera.position.z - group.position.z) - group.rotation.y;
    }
  }

  function removeVisual(entry) {
    const visual = visuals.get(entry?.id);
    if (!visual) return;
    visual.group.parent?.remove(visual.group);
    visual.avatar.dispose();
    visuals.delete(entry.id);
    ensureScheduler();
  }

  function appearanceKey(record) {
    const g = record?.genotype;
    return [record?.swarmColor || g?.base?.color || '', g?.tailfeathers?.color || '',
      g?.tailfeathers?.copies ?? '', g?.tailfeathers?.enabled ?? '',
      g?.spectacles?.color || '', g?.spectacles?.copies ?? '', g?.spectacles?.enabled ?? ''].join('|');
  } // Primitive snapshot detects in-place genetics edits without redundant shader writes.

  function syncVisual(entry, size, recordsById = null) {
    if (!deps || !isHouse(entry) || !window.HoneyfuzzleSwarm || !deps.THREE) return;
    let record = null;
    try { record = entry.house?.livestockId ? swarmRecord(entry, recordsById) : null; }
    catch (error) { window.__farmLog?.(`[honeyfuzzle] house ${entry.id} livestock lookup failed: ${error?.message || error}`, 'warn'); }
    const existing = visuals.get(entry.id);
    if (!record) { if (existing) removeVisual(entry); return; }
    const w = size?.w ?? 1, h = size?.h ?? 1;
    const x = entry.col + w / 2, z = entry.row + h / 2;
    const key = appearanceKey(record); // Only changed primary/secondary pigment should touch GPU color uniforms.
    if (existing) {
      existing.group.position.set(x, deps.surfaceY(x, z) + HOVER_HEIGHT, z);
      if (existing.appearanceKey !== key) {
        existing.avatar.setColor(record.swarmColor || record.genotype?.base?.color);
        existing.avatar.setGenotype(record.genotype);
        existing.appearanceKey = key;
      }
      existing.entry = entry;
      return;
    }
    const avatar = window.HoneyfuzzleSwarm.buildAvatar(deps.THREE, { name: 'house_' + entry.id, seed: window.HoneyfuzzleSwarm.seedFromString(entry.id), modelWidth: 1.2, memberWidth: 0.22, hoverY: 0, color: record.swarmColor || record.genotype?.base?.color || undefined, genotype: record.genotype || null });
    avatar.group.position.set(x, deps.surfaceY(x, z) + HOVER_HEIGHT, z);
    deps.scene.add(avatar.group);
    visuals.set(entry.id, { entry, avatar, group: avatar.group, appearanceKey: key });
    ensureScheduler();
  }

  // ---- management panel ----------------------------------------------------

  function open(entry) {
    if (!deps || !deps.hasFarmPermission('storage')) return;
    ensure(entry);
    document.getElementById('farmProductionModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'farmProductionModal';
    modal.style.cssText = 'position:fixed;inset:0;background:#000b;z-index:11000;display:grid;place-items:center;padding:12px';
    modal.setAttribute('data-ctrl-panel', '');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Honeyfuzzle House');
    const panel = document.createElement('div');
    panel.style.cssText = 'background:#27231e;color:#eee;padding:18px;border:1px solid #89785d;border-radius:12px;max-height:85vh;overflow:auto;width:min(520px,90vw)';
    const title = document.createElement('h3');
    title.textContent = '🍯 Honeyfuzzle House';
    panel.append(title);
    const line = text => { const p = document.createElement('p'); p.textContent = text; panel.append(p); return p; };
    const button = (label, action, disabled = false) => {
      const b = document.createElement('button');
      b.textContent = label; b.className = 'settings-small-btn'; b.disabled = disabled;
      b.onclick = action; panel.append(b); return b;
    };
    const act = fn => () => { const result = fn(); deps.showToast(result.message, result.ok); open(entry); };

    const current = phase(entry);
    if (current === 'empty') {
      line('Empty. Place one Honeyfuzzle Queen here to establish a swarm, or use a Growth Tonic to speed colony formation.');
      const available = bagCount(QUEEN_ITEM) + bagCount(LEGACY_EGG_ITEM); // Existing saved eggs remain usable.
      button(`Place Queen (${available} in bag)`, act(() => placeQueen(entry)), available < 1);
    } else if (current === 'queen') {
      const left = Math.max(0, Math.ceil(entry.house.queen.readyAt - window.FarmProduction.now()));
      line(`👑 A queen is establishing her colony. It forms in about ${left} day${left === 1 ? '' : 's'}.`);
      button(`Use Growth Tonic (${bagCount(tonicKey())} in bag)`, act(() => useTonic(entry)), bagCount(tonicKey()) < 1);
    } else {
      const record = swarmRecord(entry);
      line(`${record?.name || 'A honeyfuzzle swarm'} lives here.`);
      line('Open the Farm tab\'s Livestock list to move it to your stable as a companion. Its house is empty again afterwards.');
    }
    const close = button('Close', () => modal.remove());
    close.setAttribute('data-ctrl-cancel', '');
    modal.append(panel);
    document.body.append(modal);
  }

  function forEachAudioSource(visitor) { // Gives the shared soundscape only the positions of actually occupied, rendered houses.
    if (typeof visitor !== 'function') return;
    for (const [id, visual] of visuals) {
      const position = visual.group?.position; // Farm models use world-tile units (unlike wilderness creature pixel coordinates).
      if (position && visual.group.visible !== false) visitor(String(id), position.x, position.z);
    }
  }

  window.HoneyfuzzleHouse = {
    KEY, KIND, QUEEN_ITEM, LEGACY_EGG_ITEM, registerQueenItem,
    init, ensure, phase, placeQueen, establish, useTonic, tick, open, syncVisual, removeVisual,
    placeEgg: placeQueen, hatch: establish, // Obsolete API aliases keep older integrations functional.
    visualCount: () => visuals.size,
    forEachAudioSource, // Used by HoneyfuzzleAudio's 350ms source scan; no extra per-frame renderer work.
  };
})();
