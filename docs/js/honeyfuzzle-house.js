(() => {
  'use strict';

  // Honeyfuzzle House: the 1x1 farm building every honeyfuzzle swarm lives in
  // (swarms are never barn animals, and there is no incubator for them). It is
  // registered as a FarmProduction building (config/farm-specializations.js,
  // key 'honeyfuzzleHouse'), so placing, moving, rotating, saving and the
  // carpenter's plan all come from js/farm-production.js. Like a processor it
  // is never entered: the player manages it from outside.
  //
  // The house has one slot, stored on the production entry as
  //   entry.house = { egg: null | { placedAt, hatchAt }, livestockId: null | id }
  //   empty  -> place a fertile honeyfuzzle egg in it
  //   egg    -> wait hatchDays of world time, or feed it a Growth Tonic to hatch it now
  //   swarm  -> the hatched swarm is an ordinary world-livestock record
  //             (kind 'honeyfuzzle', houseId = entry.id); it hovers over the house
  //             and can be moved to the personal stable from the Livestock list.

  const KEY = 'honeyfuzzleHouse';
  const KIND = 'honeyfuzzle';
  const EGG_ITEM = 'fertileHoneyfuzzleEgg';
  const DEFAULT_HATCH_DAYS = 2;
  const SCHEDULER_ID = 'honeyfuzzle-house-swarms';
  const HOVER_HEIGHT = 0.95; // World units above the farm surface: just over the stump's cap.

  let deps = null; // { THREE, getCamera, getCurrentArea, inventory, loadWorldLivestock, saveWorldLivestock, hasFarmPermission, showToast, saveFarmLayout, saveMemberWorldData, surfaceY, refreshInventory, scene }
  const visuals = new Map(); // entry.id -> { entry, avatar, group }
  let schedulerRegistered = false;
  let lastFrameMs = 0;

  function init(injectedDeps) { deps = injectedDeps; }

  const definition = () => window.FARM_SPECIALIZATIONS_CONFIG?.buildings?.[KEY] || {};
  const hatchDays = () => Number(definition().hatchDays) || DEFAULT_HATCH_DAYS;
  const tonicKey = () => window.ANIMAL_GROWTH_CONFIG?.item?.key || 'growthTonic';
  const isHouse = entry => entry?.key === KEY;

  function ensure(entry) { // Older/foreign entries get an empty slot lazily.
    if (!entry.house || typeof entry.house !== 'object') entry.house = { egg: null, livestockId: null };
    if (!('egg' in entry.house)) entry.house.egg = null;
    if (!('livestockId' in entry.house)) entry.house.livestockId = null;
    return entry.house;
  }

  function swarmRecord(entry) {
    const house = ensure(entry);
    if (!house.livestockId || !deps) return null;
    const record = deps.loadWorldLivestock().find(item => item.id === house.livestockId && item.kind === KIND) || null;
    if (!record) house.livestockId = null; // Moved to the stable or sold: the house is empty again.
    return record;
  }

  function phase(entry) {
    const house = ensure(entry);
    if (swarmRecord(entry)) return 'swarm';
    return house.egg ? 'egg' : 'empty';
  }

  const bagCount = key => Math.max(0, Number(deps?.inventory?.[key]) || 0); // Missing keys are 0, never NaN.

  function persist() {
    deps.saveFarmLayout?.();
    deps.saveMemberWorldData?.();
    deps.refreshInventory?.();
  }

  // ---- actions --------------------------------------------------------------

  function placeEgg(entry) {
    if (!deps.hasFarmPermission('livestock')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    if (phase(entry) !== 'empty') return { ok: false, message: 'This house is already occupied.' };
    if (bagCount(EGG_ITEM) < 1) return { ok: false, message: 'You have no fertile honeyfuzzle egg.' };
    const now = window.FarmProduction.now();
    deps.inventory[EGG_ITEM] = bagCount(EGG_ITEM) - 1;
    const colors = window.HoneyfuzzleColors;
    const appearance = colors?.takeEggAppearance?.(deps.getWorldId?.()) || null; // New saves carry an inherited genotype; old queues return {color, genotype:null}.
    const color = appearance?.color || (!colors?.takeEggAppearance ? colors?.takeEggColor?.(deps.getWorldId?.()) : null)
      || colors?.pickForKey('', 'egg' + Math.random()) || null; // Old bag-only eggs still receive a valid randomized primary pigment.
    ensure(entry).egg = { placedAt: now, hatchAt: now + hatchDays(), color,
      genotype: appearance?.genotype || null }; // Persist the original hive's tailfeathers/spectacles until hatching.
    persist();
    return { ok: true, message: `🥚 The egg is tucked into the house. It hatches in ${hatchDays()} days.` };
  }

  function hatch(entry) {
    const house = ensure(entry);
    if (!house.egg) return { ok: false, message: 'There is no egg to hatch.' };
    const list = deps.loadWorldLivestock();
    const id = 'livestock_' + Math.random().toString(36).slice(2, 10);
    const name = window.CreatureGenetics?.defaultLivestockName?.(KIND) || 'Honeyfuzzle Swarm';
    const genotype = house.egg.genotype || window.CreatureGenetics?.makeDefaultGenotype?.(KIND) || null; // New eggs inherit their hive markings; legacy color-only eggs roll fresh genes.
    if (genotype?.base && house.egg.color) genotype.base.color = house.egg.color; // Preserve the mother's hive-region primary color.
    list.push({
      id, kind: KIND, barnId: null, houseId: entry.id, troughIndex: null, releasedAt: Date.now(),
      lifeStage: 'adult', // barnId:null alone reads as a Nursery baby (livestock-nursery.js isBaby); a hatched swarm is ready to live in its house or be taken as a companion.
      name, genotype, swarmColor: house.egg.color || null, daysUntilResource: null, resourceReady: false, heartLevel: 2,
    });
    deps.saveWorldLivestock(list);
    house.egg = null;
    house.livestockId = id;
    syncVisual(entry);
    persist();
    return { ok: true, message: `🍯 The egg hatched: a ${name} now lives in the house.` };
  }

  function useTonic(entry) {
    if (!deps.hasFarmPermission('livestock')) return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    if (phase(entry) !== 'egg') return { ok: false, message: 'There is no egg waiting to hatch.' };
    if (bagCount(tonicKey()) < 1) return { ok: false, message: 'You have no Growth Tonic.' };
    deps.inventory[tonicKey()] = bagCount(tonicKey()) - 1;
    return hatch(entry);
  }

  // FarmProduction's one-second timer: hatches every egg whose time has come.
  function tick(buildings, now) {
    if (!deps) return;
    for (const entry of buildings) {
      if (!isHouse(entry)) continue;
      if (entry.house?.egg && Number.isFinite(entry.house.egg.hatchAt) && now >= entry.house.egg.hatchAt) {
        const result = hatch(entry);
        if (result.ok) deps.showToast(result.message, true);
      }
      if (entry.house?.livestockId || visuals.has(entry.id)) syncVisual(entry); // Drops the hovering swarm once it has been moved to the stable.
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

  function syncVisual(entry, size) {
    if (!deps || !isHouse(entry) || !window.HoneyfuzzleSwarm || !deps.THREE) return;
    let record = null;
    try { record = entry.house?.livestockId ? swarmRecord(entry) : null; } // A visual must never break loading the building itself.
    catch (error) { window.__farmLog?.(`[honeyfuzzle] house ${entry.id} livestock lookup failed: ${error?.message || error}`, 'warn'); }
    const wants = !!record;
    const existing = visuals.get(entry.id);
    if (!wants) { if (existing) removeVisual(entry); return; }
    const w = size?.w ?? 1, h = size?.h ?? 1;
    const x = entry.col + w / 2, z = entry.row + h / 2;
    if (existing) {
      existing.group.position.set(x, deps.surfaceY(x, z) + HOVER_HEIGHT, z);
      existing.avatar.setColor(record.swarmColor || record.genotype?.base?.color);
      existing.avatar.setGenotype(record.genotype); // A changed genotype on a living swarm is visible without rebuilding its GPU geometry.
      existing.entry = entry;
      return;
    }
    const avatar = window.HoneyfuzzleSwarm.buildAvatar(deps.THREE, { name: 'house_' + entry.id, seed: window.HoneyfuzzleSwarm.seedFromString(entry.id), modelWidth: 1.2, memberWidth: 0.22, hoverY: 0, color: record.swarmColor || record.genotype?.base?.color || undefined, genotype: record.genotype || null });
    avatar.group.position.set(x, deps.surfaceY(x, z) + HOVER_HEIGHT, z);
    deps.scene.add(avatar.group);
    visuals.set(entry.id, { entry, avatar, group: avatar.group });
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
      line('Empty. Set a fertile honeyfuzzle egg inside and wait for it to hatch, or give it a Growth Tonic to hatch it at once.');
      button(`Place Fertile Egg (${bagCount(EGG_ITEM)} in bag)`, act(() => placeEgg(entry)), bagCount(EGG_ITEM) < 1);
    } else if (current === 'egg') {
      const left = Math.max(0, Math.ceil(entry.house.egg.hatchAt - window.FarmProduction.now()));
      line(`🥚 A fertile egg is warming inside. It hatches in about ${left} day${left === 1 ? '' : 's'}.`);
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
    KEY, KIND, EGG_ITEM,
    init, ensure, phase, placeEgg, hatch, useTonic, tick, open, syncVisual, removeVisual,
    visualCount: () => visuals.size,
    forEachAudioSource, // Used by HoneyfuzzleAudio's 350ms source scan; no extra per-frame renderer work.
  };
})();
