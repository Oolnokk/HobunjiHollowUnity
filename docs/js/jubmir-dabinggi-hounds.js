(() => {
  'use strict';

  const OWNER_NPC_ID = 'jubmir'; // Used to bind the authored hound pair to Jubmir's live scheduled walker.
  const CREATURE_KIND = 'dabinggi-hound'; // Used for both runtime companions and the rescue-cutscene coat override.
  const HOUND_COUNT = 2; // Used to keep exactly two authored hounds around Jubmir whenever he is present.
  const POLL_MS = 100; // Used to follow scheduler/area transitions without touching the main render loop.
  const BASE_COLOR = '#4f3f36'; // Existing Black-Brown fur swatch; used as the pair's shared near-black base coat.
  const STRIPE_COLOR = '#ae8430'; // Existing Golden fur swatch; used for the pair's shared goldish stripe layer.
  const status = { // Mobile-readable diagnostics exposed through debugSnapshot().
    installed: false,
    ownerPresent: false,
    ownerArea: null,
    activeHounds: 0,
    geneticsOverrideInstalled: false,
    lastError: null,
    latestChange: 'Jubmir now carries two black-brown, golden-striped Dabinggi-hounds that use the normal animal companion AI around his live NPC walker; the opening rescue uses the same authored coat.',
  };

  let timer = null; // Stores the lightweight scheduler poll started by install().
  let master = null; // Stable companion-master adapter updated from Jubmir's walker each poll.
  const hounds = new Set(); // Tracks only Jubmir-owned spawned hounds so cleanup never touches player companions.
  let originalMakeDefaultGenotype = null; // Preserves CreatureGenetics.makeDefaultGenotype before the rescue-only wrapper is installed.

  function makeJubmirHoundGenotype() {
    return {
      base: { color: BASE_COLOR, copies: 2, inheritance: 'dominant' },
      mitts: { color: BASE_COLOR, copies: 0, inheritance: 'dominant', enabled: false },
      spectacles: { color: BASE_COLOR, copies: 0, inheritance: 'dominant', enabled: false },
      stripes: { color: STRIPE_COLOR, copies: 2, inheritance: 'dominant', enabled: true },
      sizeClass: 'medium',
    };
  }

  function isOpeningRescueActive() {
    try {
      return window.OpeningStoryCutscene?.debugSnapshot?.().phase === 'rescue';
    } catch (_) {
      return false;
    }
  }

  function installGeneticsOverride() {
    const genetics = window.CreatureGenetics; // Shared genetics API patched only at its public default-genotype seam.
    if (!genetics?.makeDefaultGenotype) return false;
    if (genetics.makeDefaultGenotype.__jubmirHoundRescueCoat) {
      status.geneticsOverrideInstalled = true;
      return true;
    }
    originalMakeDefaultGenotype = genetics.makeDefaultGenotype.bind(genetics);
    const wrappedMakeDefaultGenotype = function jubmirHoundDefaultGenotype(kind, ...rest) { // Supplies authored rescue hounds while leaving every ordinary roll untouched.
      if (kind === CREATURE_KIND && isOpeningRescueActive()) return makeJubmirHoundGenotype();
      return originalMakeDefaultGenotype(kind, ...rest);
    };
    Object.defineProperty(wrappedMakeDefaultGenotype, '__jubmirHoundRescueCoat', { value: true });
    genetics.makeDefaultGenotype = wrappedMakeDefaultGenotype;
    status.geneticsOverrideInstalled = true;
    return true;
  }

  function liveWalkers() {
    const walkers = window._npcWalkers; // Scheduler-owned live NPC walkers; supports both current Map and legacy array shapes.
    if (walkers instanceof Map) return [...walkers.values()];
    return Array.isArray(walkers) ? walkers : [];
  }

  function walkerNpcId(walker) {
    return String(walker?.rec?.id || '').trim().toLowerCase();
  }

  function findJubmirWalker() {
    return liveWalkers().find(walker =>
      walkerNpcId(walker) === OWNER_NPC_ID
      && walker?.root?.position
      && walker.root.visible !== false
    ) || null;
  }

  function combatDeps() {
    return window.Combat?.deps || null;
  }

  function cutsceneOwnsCreatures(deps) {
    const value = deps?.cutscenePreviewActive; // Existing companion-sync guard exposed by game.js; supports boolean or getter forms.
    return typeof value === 'function' ? !!value() : !!value;
  }

  function updateMaster(walker, deps) {
    const tile = Number(deps?.TILE) || 32; // Converts scheduler tile-space roots into creature pixel-space coordinates.
    if (!master) {
      master = { x: 0, y: 0, angle: 0, climbing: false, areaId: null, npcId: OWNER_NPC_ID }; // Shape matches game.js's documented companion master contract.
    }
    master.x = Number(walker.root.position.x) * tile;
    master.y = Number(walker.root.position.z) * tile;
    master.angle = Number(walker.rot) || Number(walker.root.rotation?.y) || 0;
    master.climbing = false;
    master.areaId = walker.area || null;
    return master;
  }

  function removeHound(hound, deps) {
    if (!hound) return;
    deps?.companionObjects?.delete?.(hound);
    try {
      deps?.despawnCreature?.(hound);
    } catch (error) {
      status.lastError = error?.message || String(error);
    }
    hounds.delete(hound);
  }

  function cleanup(deps = combatDeps()) {
    for (const hound of [...hounds]) removeHound(hound, deps);
    status.activeHounds = 0;
  }

  function pruneDeadOrForeign(deps) {
    for (const hound of [...hounds]) {
      if (!hound || hound.health <= 0 || hound.master !== master || (master?.areaId && hound.areaId && hound.areaId !== master.areaId)) {
        removeHound(hound, deps);
      }
    }
  }

  function spawnHound(slot, deps) {
    if (typeof deps?.makeCreatureEntity !== 'function' || !deps?.companionObjects?.add || !master) return null;
    const tile = Number(deps.TILE) || 32; // Sets a compact two-sided formation around Jubmir before normal companion AI takes over.
    const side = slot % 2 === 0 ? -1 : 1; // Alternates the authored pair to Jubmir's left and right on spawn.
    const spawnX = master.x + side * tile * 0.72;
    const spawnY = master.y + tile * 0.48;
    const genotype = makeJubmirHoundGenotype(); // Shared exact coat data used by both persistent entourage slots.
    const hound = deps.makeCreatureEntity(CREATURE_KIND, spawnX, spawnY, {
      isCompanion: true,
      master,
      homeX: master.x,
      homeY: master.y,
      state: 'idle',
      genotype,
      name: 'Jubmir’s Dabinggi-hound',
    });
    if (!hound) return null;
    hound.isCompanion = true;
    hound.master = master;
    hound.genotype = genotype;
    hound.npcCompanionOwnerId = OWNER_NPC_ID;
    hound.npcCompanionSlot = slot;
    deps.companionObjects.add(hound);
    hounds.add(hound);
    return hound;
  }

  function sync() {
    try {
      installGeneticsOverride();
      const deps = combatDeps(); // Live combat/game dependency object supplies the canonical creature and companion collections.
      const walker = findJubmirWalker(); // Active scheduler representation determines whether Jubmir is visibly present in this area.
      status.ownerPresent = !!walker;
      status.ownerArea = walker?.area || null;
      if (!deps || !walker || cutsceneOwnsCreatures(deps)) {
        cleanup(deps);
        return false;
      }
      updateMaster(walker, deps);
      pruneDeadOrForeign(deps);
      while (hounds.size < HOUND_COUNT) {
        const usedSlots = new Set([...hounds].map(hound => Number(hound.npcCompanionSlot))); // Prevents both respawned hounds from taking the same side.
        const slot = [0, 1].find(candidate => !usedSlots.has(candidate)); // Selects the first missing authored pair slot.
        if (slot == null || !spawnHound(slot, deps)) break;
      }
      status.activeHounds = hounds.size;
      return hounds.size === HOUND_COUNT;
    } catch (error) {
      status.lastError = error?.message || String(error);
      window.__farmLog?.(`[jubmir-hounds] ${status.lastError}`, 'error');
      return false;
    }
  }

  function install() {
    if (status.installed) return true;
    status.installed = true;
    installGeneticsOverride();
    sync();
    timer = setInterval(sync, POLL_MS);
    return true;
  }

  function debugSnapshot() {
    return {
      ...status,
      coat: { base: BASE_COLOR, stripes: STRIPE_COLOR, pattern: 'stripes' },
      trackedHounds: [...hounds].map(hound => ({
        slot: hound.npcCompanionSlot,
        health: hound.health,
        areaId: hound.areaId,
        state: hound.state,
        x: hound.x,
        y: hound.y,
      })),
      master: master ? { x: master.x, y: master.y, areaId: master.areaId } : null,
    };
  }

  window.JubmirDabinggiHounds = Object.freeze({
    install,
    sync,
    cleanup,
    makeJubmirHoundGenotype,
    debugSnapshot,
    __test: Object.freeze({ findJubmirWalker, updateMaster, installGeneticsOverride }),
  });
})();
