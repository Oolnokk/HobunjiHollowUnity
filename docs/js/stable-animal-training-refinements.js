(() => {
  'use strict';

  const progression = window.StableAnimalProgression; // Existing Stable progression remains the persistence/XP/perk authority underneath these refinements.
  if (!progression || window.StableAnimalTrainingRefinements?.installed) return;

  const MAX_STABLE_LEVEL = 10; // User-facing and enforced cap for every stabled animal role.
  const COMBAT_SYNC_MS = 250; // Low-cost cadence for applying perk-derived stats to the currently active companion actor.
  const SPECIES_ALIASES = Object.freeze({ // Normalizes wild/variant keys onto the companion's base species perk tree.
    'gar-wolf-alpha': 'gar-wolf',
    'gar-wolf-den-mother': 'gar-wolf',
    'uumkaoii-wild': 'uumkaoii',
    'uumkaoii-wild-den-mother': 'uumkaoii',
    'grehlr-den-mother': 'grehlr',
    'drenkirra-den-mother': 'drenkirra',
  });

  const SPECIES_COMBAT_PERKS = Object.freeze({ // Species identity lives here; actual combat still consumes the existing creature def fields.
    'dabinggi-hound': Object.freeze([
      { id: 'species_dabinggi_toxicPounce', name: 'Toxic Pounce', maxRank: 3, desc: '+10% attack damage per rank.', speciesKind: 'dabinggi-hound', combat: { damagePerRank: 0.10 } },
      { id: 'species_dabinggi_pursuit', name: 'Pursuit Instinct', maxRank: 3, desc: '-6% attack cooldown per rank.', speciesKind: 'dabinggi-hound', combat: { cooldownReductionPerRank: 0.06 } },
    ]),
    uumkaoii: Object.freeze([
      { id: 'species_uumkaoii_drivingPounce', name: 'Driving Pounce', maxRank: 3, desc: '+8% attack reach per rank.', speciesKind: 'uumkaoii', combat: { rangePerRank: 0.08 } },
      { id: 'species_uumkaoii_deepLungs', name: 'Deep Lungs', maxRank: 3, desc: '-8% attack Stamina cost per rank.', speciesKind: 'uumkaoii', combat: { staminaReductionPerRank: 0.08 } },
    ]),
    'gar-wolf': Object.freeze([
      { id: 'species_garwolf_rendingPounce', name: 'Rending Pounce', maxRank: 3, desc: '+10% attack damage per rank.', speciesKind: 'gar-wolf', combat: { damagePerRank: 0.10 } },
      { id: 'species_garwolf_predatorTempo', name: "Predator's Tempo", maxRank: 3, desc: '-6% attack cooldown per rank.', speciesKind: 'gar-wolf', combat: { cooldownReductionPerRank: 0.06 } },
    ]),
    grehlr: Object.freeze([
      { id: 'species_grehlr_burrowAmbush', name: 'Burrow Ambush', maxRank: 3, desc: '+12% attack damage per rank, including Burrow.', speciesKind: 'grehlr', combat: { damagePerRank: 0.12 } },
      { id: 'species_grehlr_tunnelStamina', name: 'Tunnel Stamina', maxRank: 3, desc: '-8% attack Stamina cost per rank.', speciesKind: 'grehlr', combat: { staminaReductionPerRank: 0.08 } },
    ]),
    drenkirra: Object.freeze([
      { id: 'species_drenkirra_causticVolley', name: 'Caustic Volley', maxRank: 3, desc: '+10% attack damage per rank, including Caustic Pellet.', speciesKind: 'drenkirra', combat: { damagePerRank: 0.10 } },
      { id: 'species_drenkirra_rapidCharge', name: 'Rapid Charge', maxRank: 3, desc: '-6% attack cooldown per rank.', speciesKind: 'drenkirra', combat: { cooldownReductionPerRank: 0.06 } },
    ]),
    puktuk: Object.freeze([
      { id: 'species_puktuk_defensiveRush', name: 'Defensive Rush', maxRank: 3, desc: '+8% attack damage per rank.', speciesKind: 'puktuk', combat: { damagePerRank: 0.08 } },
      { id: 'species_puktuk_quickRecovery', name: 'Quick Recovery', maxRank: 3, desc: '-5% attack cooldown per rank.', speciesKind: 'puktuk', combat: { cooldownReductionPerRank: 0.05 } },
    ]),
  });
  const FALLBACK_COMBAT_PERKS = Object.freeze([ // Future companion species still get a small species-labelled combat branch until authored perks are added.
    { id: 'species_generic_power', name: 'Natural Power', maxRank: 3, desc: '+6% attack damage per rank.', speciesKind: '*', combat: { damagePerRank: 0.06 } },
    { id: 'species_generic_tempo', name: 'Natural Tempo', maxRank: 3, desc: '-4% attack cooldown per rank.', speciesKind: '*', combat: { cooldownReductionPerRank: 0.04 } },
  ]);

  let farmDeps = null; // Captured from FarmAnimals.init so stable entries can be capped before XP/perk mutations.
  let panelDeps = null; // Captured from FarmPanel.init so UI decoration uses the exact Stable array being rendered.
  let installed = false; // Prevents repeated wrapping when the farm bridge retries installation.
  let expandedStableId = null; // The one Stable card currently expanded; null means every tree is collapsed.
  let lastCombatActor = null; // Used to restore a previous companion's original def before another active companion is trained.
  let combatTimer = null; // Owns the lightweight live-companion stat synchronization interval.

  function currentDeps() {
    return farmDeps || panelDeps || null;
  }

  function stableEntries() {
    return currentDeps()?.getStable?.() || [];
  }

  function canonicalSpecies(kind) {
    return SPECIES_ALIASES[kind] || kind || 'unknown';
  }

  function speciesCombatPerksForEntry(entry) {
    const kind = canonicalSpecies(entry?.kind);
    return SPECIES_COMBAT_PERKS[kind] || FALLBACK_COMBAT_PERKS;
  }

  function allSpeciesPerkDefs() {
    return [...Object.values(SPECIES_COMBAT_PERKS).flat(), ...FALLBACK_COMBAT_PERKS];
  }

  function installSpeciesPerkDefinitions() {
    const companionTree = progression.trees?.companion;
    if (!Array.isArray(companionTree)) return;
    const existing = new Set(companionTree.map(def => def.id));
    for (const def of allSpeciesPerkDefs()) {
      if (!existing.has(def.id)) companionTree.push({ ...def });
    }
  }

  function capInt(value, min, max) {
    return Math.max(min, Math.min(max, Math.floor(Number(value) || 0)));
  }

  function installLevelCap(entry) {
    if (!entry || entry.__stableLevelCap10Installed) return entry;
    let levelValue = capInt(entry.level, 0, MAX_STABLE_LEVEL); // Backing value used by the capped enumerable level accessor.
    let xpValue = Math.max(0, Math.floor(Number(entry.stableXp) || 0)); // Backing XP is discarded whenever the animal reaches the cap.
    if (levelValue >= MAX_STABLE_LEVEL) xpValue = 0;
    Object.defineProperty(entry, 'level', {
      configurable: true,
      enumerable: true,
      get() { return levelValue; },
      set(value) {
        levelValue = capInt(value, 0, MAX_STABLE_LEVEL);
        if (levelValue >= MAX_STABLE_LEVEL) xpValue = 0;
      },
    });
    Object.defineProperty(entry, 'stableXp', {
      configurable: true,
      enumerable: true,
      get() { return levelValue >= MAX_STABLE_LEVEL ? 0 : xpValue; },
      set(value) { xpValue = levelValue >= MAX_STABLE_LEVEL ? 0 : Math.max(0, Math.floor(Number(value) || 0)); },
    });
    Object.defineProperty(entry, '__stableLevelCap10Installed', { configurable: true, enumerable: false, value: true });
    return entry;
  }

  function ensureStableCaps() {
    for (const entry of stableEntries()) installLevelCap(entry);
    return stableEntries();
  }

  function roleLabel(entry) {
    const role = progression.roleForEntry?.(entry) || 'companion';
    return role === 'mount' ? 'Mount' : role === 'shoulderPet' ? 'Shoulder pet' : 'Companion';
  }

  function speciesLabel(entry) {
    return window.CREATURE_DB?.[entry?.kind]?.label
      || window.CreatureGenetics?.defaultLivestockName?.(entry?.kind)
      || String(entry?.kind || 'Companion').replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
  }

  function perkDefsForEntry(entry) {
    const role = progression.roleForEntry?.(entry) || 'companion';
    const generic = (progression.trees?.[role] || []).filter(def => !String(def.id).startsWith('species_'));
    return role === 'companion' ? [...generic, ...speciesCombatPerksForEntry(entry)] : generic;
  }

  function perkAllowedForEntry(entry, perkId) {
    return perkDefsForEntry(entry).some(def => def.id === perkId);
  }

  function companionCombatModifiers(entry) {
    const modifiers = { damage: 1, cooldown: 1, range: 1, staminaCost: 1 }; // Multipliers applied only to the active companion's private def clone.
    if (!entry) return modifiers;
    for (const def of speciesCombatPerksForEntry(entry)) {
      const rank = progression.perkRank?.(entry, def.id) || 0;
      const combat = def.combat || {};
      if (combat.damagePerRank) modifiers.damage *= 1 + combat.damagePerRank * rank;
      if (combat.cooldownReductionPerRank) modifiers.cooldown *= Math.max(0.35, 1 - combat.cooldownReductionPerRank * rank);
      if (combat.rangePerRank) modifiers.range *= 1 + combat.rangePerRank * rank;
      if (combat.staminaReductionPerRank) modifiers.staminaCost *= Math.max(0.25, 1 - combat.staminaReductionPerRank * rank);
    }
    return modifiers;
  }

  function liveCompanionActor() {
    const deps = window.Combat?.deps;
    const player = deps?.player;
    if (!player) return null;
    const area = deps.getCurrentArea?.();
    for (const actor of deps.companionObjects || []) {
      if (!actor || actor.health <= 0 || actor.stableRole !== 'companion') continue;
      if ((actor.master || player) !== player) continue;
      if (area && actor.areaId && actor.areaId !== area) continue;
      if (actor.avatarRef?.group?.visible === false) continue;
      return actor;
    }
    return null;
  }

  function restoreCombatActor(actor) {
    if (!actor?._stableTrainingBaseDef) return;
    actor.def = actor._stableTrainingBaseDef;
    delete actor._stableTrainingBaseDef;
    delete actor._stableTrainingCombatSignature;
  }

  function syncCompanionCombatPerks() {
    ensureStableCaps();
    const entry = progression.activeEntryForRole?.('companion') || null;
    const actor = liveCompanionActor();
    if (lastCombatActor && lastCombatActor !== actor) restoreCombatActor(lastCombatActor);
    lastCombatActor = actor;
    if (!entry || !actor?.def) return null;

    if (!actor._stableTrainingBaseDef) actor._stableTrainingBaseDef = actor.def; // Preserves the species/shared definition exactly for later restoration.
    const base = actor._stableTrainingBaseDef;
    const modifiers = companionCombatModifiers(entry);
    const signature = `${entry.id}:${canonicalSpecies(entry.kind)}:${Object.entries(entry.animalPerks || {}).sort().map(([id, rank]) => `${id}=${rank}`).join(',')}`;
    if (actor._stableTrainingCombatSignature === signature) return modifiers;

    actor.def = {
      ...base,
      attackDamage: Number.isFinite(Number(base.attackDamage)) ? Number(base.attackDamage) * modifiers.damage : base.attackDamage,
      attackCooldownS: Number.isFinite(Number(base.attackCooldownS)) ? Number(base.attackCooldownS) * modifiers.cooldown : base.attackCooldownS,
      attackRangePx: Number.isFinite(Number(base.attackRangePx)) ? Number(base.attackRangePx) * modifiers.range : base.attackRangePx,
      attackStaminaCost: Number.isFinite(Number(base.attackStaminaCost)) ? Number(base.attackStaminaCost) * modifiers.staminaCost : base.attackStaminaCost,
    };
    actor._stableTrainingCombatSignature = signature;
    return modifiers;
  }

  function makeText(tag, text, css = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    if (css) element.style.cssText = css;
    return element;
  }

  function makePerkButton(entry, def) {
    const rank = progression.perkRank?.(entry, def.id) || 0;
    const points = progression.availablePoints?.(entry) || 0;
    const button = document.createElement('button');
    button.className = 'settings-small-btn';
    button.style.cssText = 'white-space:normal;text-align:left;min-height:54px;line-height:1.25;';
    button.disabled = entry.lifeStage === 'baby' || points <= 0 || rank >= def.maxRank;
    button.textContent = `${def.name} ${rank}/${def.maxRank}\n${def.desc}`;
    button.addEventListener('click', event => {
      event.stopPropagation();
      const result = progression.spendPoint?.(entry.id, def.id) || { ok: false, message: 'Training unavailable.' };
      currentDeps()?.showToast?.(result.message, result.ok);
      syncCompanionCombatPerks();
      window.FarmPanel?.renderStablePanel?.();
    });
    return button;
  }

  function appendPerkSection(panel, title, entry, defs) {
    if (!defs.length) return;
    panel.appendChild(makeText('div', title, 'font-size:11px;font-weight:800;opacity:.86;margin-top:4px;'));
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:6px;';
    for (const def of defs) grid.appendChild(makePerkButton(entry, def));
    panel.appendChild(grid);
  }

  function buildExpandedTree(entry) {
    const panel = document.createElement('div');
    panel.className = 'stable-entry-perk-tree';
    panel.style.cssText = 'flex:1 0 100%;width:100%;box-sizing:border-box;margin-top:7px;padding:9px;border-top:1px solid rgba(255,255,255,.13);display:flex;flex-direction:column;gap:7px;cursor:default;';
    panel.addEventListener('click', event => event.stopPropagation());

    const points = progression.availablePoints?.(entry) || 0;
    const nextXp = entry.level >= MAX_STABLE_LEVEL ? 0 : progression.xpToNext?.(entry.level) || 0;
    const xpText = entry.level >= MAX_STABLE_LEVEL ? 'MAX LEVEL' : `${entry.stableXp || 0}/${nextXp} XP`;
    panel.appendChild(makeText('div', `Level ${entry.level}/${MAX_STABLE_LEVEL} · ${xpText} · ${points} training point${points === 1 ? '' : 's'} available`, 'font-size:11px;font-weight:700;'));

    const role = progression.roleForEntry?.(entry) || 'companion';
    const genericDefs = (progression.trees?.[role] || []).filter(def => !String(def.id).startsWith('species_'));
    appendPerkSection(panel, role === 'mount' ? 'Mount Training' : role === 'shoulderPet' ? 'Shoulder Pet Training' : 'General Companion Training', entry, genericDefs);
    if (role === 'companion') appendPerkSection(panel, `${speciesLabel(entry)} Combat`, entry, speciesCombatPerksForEntry(entry));

    const debugButton = document.createElement('button');
    debugButton.className = 'settings-small-btn';
    debugButton.textContent = 'Debug This Animal';
    debugButton.addEventListener('click', event => {
      event.stopPropagation();
      const existing = panel.querySelector('.stable-entry-training-debug');
      if (existing) { existing.remove(); return; }
      const pre = document.createElement('pre');
      pre.className = 'stable-entry-training-debug';
      pre.style.cssText = 'margin:0;max-height:220px;overflow:auto;white-space:pre-wrap;font-size:10px;background:rgba(0,0,0,.35);padding:8px;border-radius:6px;';
      pre.textContent = JSON.stringify(debugEntry(entry), null, 2);
      panel.appendChild(pre);
    });
    panel.appendChild(debugButton);
    return panel;
  }

  function decorateStableRows() {
    ensureStableCaps();
    document.getElementById('stableAnimalProgression')?.remove(); // Removes the old separate training block; trees now live inside their own animal cards.
    const list = document.getElementById('stableList');
    if (!list) return;
    const entries = stableEntries();
    const rows = Array.from(list.children || []).filter(child => child?.classList?.contains?.('livestock-trait-row'));

    rows.forEach((row, index) => {
      const entry = entries[index];
      if (!entry) return;
      installLevelCap(entry);
      row.dataset.stableTrainingId = entry.id;
      row.style.cursor = 'pointer';
      row.querySelector('.stable-training-chevron')?.remove();
      row.querySelector('.stable-entry-perk-tree')?.remove();

      const value = row.querySelector('.farm-row-value');
      const points = progression.availablePoints?.(entry) || 0;
      if (value) value.textContent = `${roleLabel(entry)} · Lv. ${entry.level}/${MAX_STABLE_LEVEL}${points > 0 ? ` · ${points} point${points === 1 ? '' : 's'}` : ''}`;

      const chevron = makeText('span', expandedStableId === entry.id ? '▾' : '▸', 'font-size:15px;opacity:.7;margin-left:auto;');
      chevron.className = 'stable-training-chevron';
      row.appendChild(chevron);
      row.setAttribute('aria-expanded', expandedStableId === entry.id ? 'true' : 'false');
      row.addEventListener('click', event => {
        const target = event.target;
        if (target?.closest?.('button,input,select,textarea,a,label')) return;
        expandedStableId = expandedStableId === entry.id ? null : entry.id;
        window.FarmPanel?.renderStablePanel?.();
      });
      if (expandedStableId === entry.id) row.appendChild(buildExpandedTree(entry));
    });
    syncCompanionCombatPerks();
  }

  function debugEntry(entry) {
    const role = progression.roleForEntry?.(entry) || 'companion';
    return {
      id: entry?.id,
      name: entry?.name,
      kind: entry?.kind,
      role,
      level: entry?.level,
      maxLevel: MAX_STABLE_LEVEL,
      xp: entry?.stableXp || 0,
      availablePoints: progression.availablePoints?.(entry) || 0,
      perks: { ...(entry?.animalPerks || {}) },
      speciesCombatPerks: role === 'companion' ? speciesCombatPerksForEntry(entry).map(def => ({ id: def.id, rank: progression.perkRank?.(entry, def.id) || 0, maxRank: def.maxRank })) : [],
      combatModifiers: role === 'companion' ? companionCombatModifiers(entry) : null,
    };
  }

  function patchProgressionApi() {
    installSpeciesPerkDefinitions();
    progression.maxLevel = MAX_STABLE_LEVEL;
    progression.perkDefsForEntry = perkDefsForEntry;
    progression.speciesCombatPerksForEntry = speciesCombatPerksForEntry;
    progression.companionCombatModifiers = companionCombatModifiers;

    if (!progression.__stableLevel10AwardWrapped && typeof progression.awardXp === 'function') {
      const originalAward = progression.awardXp.bind(progression);
      progression.awardXp = function cappedStableAwardXp(entryOrId, amount, source) {
        ensureStableCaps();
        const entry = typeof entryOrId === 'string' ? stableEntries().find(candidate => candidate?.id === entryOrId) : entryOrId;
        if (entry) installLevelCap(entry);
        if (entry?.level >= MAX_STABLE_LEVEL) return { ok: true, levels: 0, amount: 0 };
        const result = originalAward(entryOrId, amount, source);
        if (entry) installLevelCap(entry);
        return result;
      };
      progression.__stableLevel10AwardWrapped = true;
    }

    if (!progression.__speciesSpendGateWrapped && typeof progression.spendPoint === 'function') {
      const originalSpend = progression.spendPoint.bind(progression);
      progression.spendPoint = function speciesGatedSpendPoint(entryId, perkId) {
        ensureStableCaps();
        const entry = stableEntries().find(candidate => candidate?.id === entryId);
        if (!entry) return { ok: false, message: 'Animal not found.' };
        if (!perkAllowedForEntry(entry, perkId)) return { ok: false, message: 'That perk does not belong to this animal.' };
        const result = originalSpend(entryId, perkId);
        syncCompanionCombatPerks();
        return result;
      };
      progression.__speciesSpendGateWrapped = true;
    }

    if (!progression.__level10DebugWrapped && typeof progression.debugSnapshot === 'function') {
      const originalDebug = progression.debugSnapshot.bind(progression);
      progression.debugSnapshot = function level10StableDebug() {
        ensureStableCaps();
        return { ...originalDebug(), maxLevel: MAX_STABLE_LEVEL, expandedStableId, activeCompanionCombat: companionCombatModifiers(progression.activeEntryForRole?.('companion')) };
      };
      window.__stableAnimalProgressionDebug = progression.debugSnapshot;
      progression.__level10DebugWrapped = true;
    }
  }

  function patchFarmAnimals(api) {
    if (!api || api.__stableTrainingRefinementsWrapped) return;
    if (typeof api.init === 'function') {
      const originalInit = api.init.bind(api);
      api.init = function stableTrainingRefinedFarmInit(injectedDeps) {
        farmDeps = injectedDeps;
        const result = originalInit(injectedDeps);
        ensureStableCaps();
        return result;
      };
    }
    if (typeof api.addToStable === 'function') {
      const originalAdd = api.addToStable.bind(api);
      api.addToStable = function stableTrainingRefinedAdd(...args) {
        const result = originalAdd(...args);
        ensureStableCaps();
        return result;
      };
    }
    api.__stableTrainingRefinementsWrapped = true;
  }

  function patchFarmPanel(api) {
    if (!api || api.__stableTrainingRefinementsWrapped) return;
    if (typeof api.init === 'function') {
      const originalInit = api.init.bind(api);
      api.init = function stableTrainingRefinedPanelInit(injectedDeps) {
        panelDeps = injectedDeps;
        const result = originalInit(injectedDeps);
        ensureStableCaps();
        return result;
      };
    }
    if (typeof api.renderStablePanel === 'function') {
      const originalRender = api.renderStablePanel.bind(api);
      api.renderStablePanel = function stableTrainingRefinedStableRender(...args) {
        const result = originalRender(...args);
        decorateStableRows();
        return result;
      };
    }
    api.__stableTrainingRefinementsWrapped = true;
  }

  function install() {
    if (installed) return window.StableAnimalTrainingRefinements;
    installed = true;
    patchProgressionApi();
    patchFarmAnimals(window.FarmAnimals);
    patchFarmPanel(window.FarmPanel);
    ensureStableCaps();
    if (typeof window.setInterval === 'function' && combatTimer == null) combatTimer = window.setInterval(syncCompanionCombatPerks, COMBAT_SYNC_MS);
    return window.StableAnimalTrainingRefinements;
  }

  window.StableAnimalTrainingRefinements = {
    installed: true,
    install,
    maxLevel: MAX_STABLE_LEVEL,
    speciesCombatPerks: SPECIES_COMBAT_PERKS,
    speciesCombatPerksForEntry,
    companionCombatModifiers,
    syncCompanionCombatPerks,
    ensureStableCaps,
    decorateStableRows,
    debugEntry,
    get expandedStableId() { return expandedStableId; },
  };
})();
