(() => {
  'use strict';

  // The rest of the Farm/Stable hub stays in farm-panel-core.js. Stable
  // training is rendered here directly instead of post-processing whatever
  // markup the core renderer happened to create. During ordinary index.html
  // parsing this keeps the core synchronous, just like the former single file.
  const CORE_SRC = 'js/farm-panel-core.js?v=20260912stableNative2';

  let stableDeps = null;
  let expandedStableId = null;

  function esc(value) {
    if (stableDeps?.esc) return stableDeps.esc(value);
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function progression() {
    return window.StableAnimalProgression || null;
  }

  function refinements() {
    return window.StableAnimalTrainingRefinements || null;
  }

  function stableMaxLevel() {
    const value = Number(progression()?.maxLevel ?? refinements()?.maxLevel);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 10;
  }

  const STABLE_KIND_ICONS = {
    'dabinggi-hound': '🐕',
    'gar-wolf': '🐺',
    uumkaoii: '🦆',
    grehlr: '🦨',
    drenkirra: '🪿',
    puktuk: '🐑',
  };

  const STABLE_ROLE_META = {
    mount: { icon: '🐴', label: 'Mount' },
    companion: { icon: '🐕', label: 'Companion' },
    shoulderPet: { icon: '🐿️', label: 'Shoulder pet' },
  };

  function stableRole(entry) {
    return progression()?.roleForEntry?.(entry)
      || window.CreatureGenetics?.stableEntryRole?.(entry)
      || entry?.role
      || 'companion';
  }

  function roleMeta(entry) {
    return STABLE_ROLE_META[stableRole(entry)] || STABLE_ROLE_META.companion;
  }

  function activeStableIdForRole(role) {
    if (!stableDeps) return null;
    return role === 'mount' ? stableDeps.getActiveMountId?.()
      : role === 'shoulderPet' ? stableDeps.getActiveShoulderPetId?.()
      : stableDeps.getActiveCompanionId?.();
  }

  function setActiveStableIdForRole(role, id) {
    if (!stableDeps) return;
    if (role === 'mount') stableDeps.setActiveMountId?.(id);
    else if (role === 'shoulderPet') stableDeps.setActiveShoulderPetId?.(id);
    else stableDeps.setActiveCompanionId?.(id);
  }

  function safeTraitColor(value) {
    const normalized = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : '#777777';
  }

  function livestockTraitsHtml(genotype, kind) {
    const traits = window.CreatureGenetics?.genotypeTraits?.(kind, genotype);
    if (!traits?.size) return '';
    const size = traits.size;
    const sizeHtml = `<div class="farm-size-trait size-${esc(size.sizeClass)}"><span class="farm-size-name">${esc(size.label)}</span><span>${esc(size.roleLabel)}</span>${size.isNonDefault ? '<b>Rare size</b>' : ''}</div>`;
    const colorHtml = (traits.colors || []).map(trait => {
      const color = safeTraitColor(trait.color);
      return `<div class="farm-trait-chip"><i style="background:${color}"></i><span><strong>${esc(trait.label)}</strong><small>${esc(trait.colorName)}</small></span></div>`;
    }).join('');
    const patternHtml = (traits.patterns || []).map(trait => {
      const color = safeTraitColor(trait.color);
      const copyText = `${trait.copies} cop${trait.copies === 1 ? 'y' : 'ies'} · ${trait.inheritance}`;
      const heading = trait.carrier ? `Carries ${trait.label}` : trait.label;
      return `<div class="farm-trait-chip pattern${trait.carrier ? ' carrier' : ''}"><i style="background:${color}"></i><span><strong>${esc(heading)}</strong><small>${esc(trait.colorName)} · ${esc(copyText)}</small></span></div>`;
    }).join('');
    const plainHtml = genotype?.base && !(traits.patterns || []).length ? '<div class="farm-trait-plain">No visible or carried patterns</div>' : '';
    return `<div class="farm-traits">${sizeHtml}<div class="farm-color-traits">${colorHtml}${patternHtml}${plainHtml}</div></div>`;
  }

  function speciesLabel(entry) {
    return window.CREATURE_DB?.[entry?.kind]?.label
      || window.CreatureGenetics?.defaultLivestockName?.(entry?.kind)
      || String(entry?.kind || 'Companion').replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
  }

  function normalizeStableEntry(entry) {
    progression()?.normalizeEntry?.(entry);
    refinements()?.ensureStableCaps?.();
    const max = stableMaxLevel();
    entry.level = Math.max(0, Math.min(max, Math.floor(Number(entry.level) || 0)));
    if (entry.level >= max) entry.stableXp = 0;
    return entry;
  }

  function perkDefsForEntry(entry) {
    const api = progression();
    if (!api) return [];
    if (typeof api.perkDefsForEntry === 'function') return api.perkDefsForEntry(entry) || [];
    const role = stableRole(entry);
    const generic = (api.trees?.[role] || []).filter(def => !String(def.id).startsWith('species_'));
    if (role !== 'companion') return generic;
    const species = typeof api.speciesCombatPerksForEntry === 'function' ? api.speciesCombatPerksForEntry(entry) || [] : [];
    return [...generic, ...species];
  }

  function availablePoints(entry) {
    return Math.max(0, Math.floor(Number(progression()?.availablePoints?.(entry)) || 0));
  }

  function makeText(tag, text, css = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    if (css) element.style.cssText = css;
    return element;
  }

  function makePerkButton(entry, def) {
    const api = progression();
    const rank = Math.max(0, Math.floor(Number(api?.perkRank?.(entry, def.id)) || 0));
    const points = availablePoints(entry);
    const button = document.createElement('button');
    button.className = 'settings-small-btn stable-perk-btn';
    button.style.cssText = 'white-space:normal;text-align:left;min-height:54px;line-height:1.25;';
    button.disabled = entry.lifeStage === 'baby' || points <= 0 || rank >= def.maxRank;
    button.textContent = `${def.name} ${rank}/${def.maxRank}\n${def.desc}`;
    button.addEventListener('click', event => {
      event.stopPropagation();
      const result = api?.spendPoint?.(entry.id, def.id) || { ok: false, message: 'Training unavailable.' };
      stableDeps?.showToast?.(result.message, result.ok);
      refinements()?.syncCompanionCombatPerks?.();
      window.FarmPanel?.renderStablePanel?.();
    });
    return button;
  }

  function appendPerkSection(panel, title, entry, defs) {
    if (!defs.length) return;
    panel.appendChild(makeText('div', title, 'font-size:11px;font-weight:800;opacity:.86;margin-top:4px;'));
    const grid = document.createElement('div');
    grid.className = 'stable-perk-grid';
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:6px;';
    defs.forEach(def => grid.appendChild(makePerkButton(entry, def)));
    panel.appendChild(grid);
  }

  function stableDebugEntry(entry) {
    const role = stableRole(entry);
    return {
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      role,
      level: entry.level,
      maxLevel: stableMaxLevel(),
      xp: entry.stableXp || 0,
      availablePoints: availablePoints(entry),
      perks: { ...(entry.animalPerks || {}) },
      perkIds: perkDefsForEntry(entry).map(def => def.id),
      combatModifiers: role === 'companion' ? refinements()?.companionCombatModifiers?.(entry) || null : null,
    };
  }

  function buildStablePerkTree(entry) {
    const api = progression();
    const max = stableMaxLevel();
    const role = stableRole(entry);
    const panel = document.createElement('div');
    panel.className = 'stable-entry-perk-tree';
    panel.style.cssText = 'flex:1 0 100%;width:100%;box-sizing:border-box;margin-top:7px;padding:9px;border-top:1px solid rgba(255,255,255,.13);display:flex;flex-direction:column;gap:7px;cursor:default;';
    panel.addEventListener('click', event => event.stopPropagation());

    if (!api) {
      panel.appendChild(makeText('div', 'Animal training failed to load. Use Debug This Animal below and report the result.', 'font-size:11px;color:#ff9d8f;'));
    } else {
      const points = availablePoints(entry);
      const nextXp = entry.level >= max ? 0 : Number(api.xpToNext?.(entry.level)) || 0;
      const xpText = entry.level >= max ? 'MAX LEVEL' : `${entry.stableXp || 0}/${nextXp} XP`;
      panel.appendChild(makeText('div', `Level ${entry.level}/${max} · ${xpText} · ${points} training point${points === 1 ? '' : 's'} available`, 'font-size:11px;font-weight:700;'));

      const defs = perkDefsForEntry(entry);
      const genericDefs = defs.filter(def => !String(def.id).startsWith('species_'));
      const speciesDefs = defs.filter(def => String(def.id).startsWith('species_'));
      appendPerkSection(panel, role === 'mount' ? 'Mount Training' : role === 'shoulderPet' ? 'Shoulder Pet Training' : 'General Companion Training', entry, genericDefs);
      if (role === 'companion') appendPerkSection(panel, `${speciesLabel(entry)} Combat`, entry, speciesDefs);
      if (!defs.length) panel.appendChild(makeText('div', 'No training perks are registered for this animal.', 'font-size:11px;opacity:.75;'));
    }

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
      pre.textContent = JSON.stringify(stableDebugEntry(entry), null, 2);
      panel.appendChild(pre);
    });
    panel.appendChild(debugButton);
    return panel;
  }

  function renderStablePanelNative() {
    const list = document.getElementById('stableList');
    if (!list || !stableDeps) return;
    const stable = stableDeps.getStable?.() || [];
    if (expandedStableId && !stable.some(entry => entry?.id === expandedStableId)) expandedStableId = null;
    list.innerHTML = stable.length ? '' : '<div class="farm-note">Your stable is empty. Add an undeployed creature item from the Inventory tab.</div>';

    stable.forEach(entry => {
      normalizeStableEntry(entry);
      const role = stableRole(entry);
      const meta = roleMeta(entry);
      const isActive = entry.id === activeStableIdForRole(role);
      const isExpanded = expandedStableId === entry.id;
      const points = availablePoints(entry);
      const max = stableMaxLevel();
      const row = document.createElement('div');
      row.className = 'farm-row livestock-trait-row stable-training-row';
      row.dataset.stableTrainingId = entry.id;
      row.style.cursor = 'pointer';
      row.style.flexWrap = 'wrap';
      row.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      row.innerHTML =
        `<button class="settings-small-btn farm-companion-btn${isActive ? ' active' : ''}" title="${isActive ? `Active ${meta.label.toLowerCase()}` : `Set as ${meta.label.toLowerCase()}`}">${meta.icon}</button>` +
        `<span class="farm-row-icon">${STABLE_KIND_ICONS[entry.kind] || '🐾'}</span>` +
        `<input class="farm-row-name" value="${esc(entry.name || window.CreatureGenetics?.defaultLivestockName?.(entry.kind) || entry.kind)}" maxlength="30">` +
        `<span class="farm-row-value">${esc(meta.label)} · Lv. ${entry.level}/${max}${points > 0 ? ` · ${points} point${points === 1 ? '' : 's'}` : ''}</span>` +
        `<span class="stable-training-chevron" style="font-size:15px;opacity:.7;margin-left:auto;">${isExpanded ? '▾' : '▸'}</span>` +
        livestockTraitsHtml(entry.genotype, entry.kind);

      row.querySelector('.farm-companion-btn')?.addEventListener('click', event => {
        event.stopPropagation();
        setActiveStableIdForRole(role, isActive ? null : entry.id);
        stableDeps.saveStable?.();
        renderStablePanelNative();
      });
      row.querySelector('.farm-row-name')?.addEventListener('change', event => {
        const trimmed = event.target.value.trim().slice(0, 30);
        if (!trimmed) return;
        entry.name = trimmed;
        stableDeps.saveStable?.();
      });
      row.addEventListener('click', event => {
        const target = event.target;
        if (target?.closest?.('button,input,select,textarea,a,label')) return;
        expandedStableId = isExpanded ? null : entry.id;
        renderStablePanelNative();
      });
      if (isExpanded) row.appendChild(buildStablePerkTree(entry));
      list.appendChild(row);
    });

    refinements()?.syncCompanionCombatPerks?.();
  }

  function installNativeStableRenderer() {
    const panel = window.FarmPanel;
    if (!panel || panel.__nativeStableTrainingRenderer) return;

    // Prevent the progression modules from wrapping this renderer back into
    // their old post-render decoration path. They still own XP, persistence,
    // rapport, alerts, mount modifiers, and companion combat effects.
    panel.__stableAnimalProgressionWrapped = true;
    panel.__stableTrainingRefinementsWrapped = true;

    const originalInit = typeof panel.init === 'function' ? panel.init.bind(panel) : null;
    panel.init = function nativeStablePanelInit(injectedDeps) {
      stableDeps = injectedDeps;
      const result = originalInit?.(injectedDeps);
      progression()?.install?.();
      refinements()?.install?.();
      refinements()?.ensureStableCaps?.();
      return result;
    };
    panel.renderStablePanel = renderStablePanelNative;
    panel.stableTrainingDebug = () => ({ expandedStableId, maxLevel: stableMaxLevel(), animals: (stableDeps?.getStable?.() || []).map(stableDebugEntry) });
    panel.__nativeStableTrainingRenderer = true;
    window.__stablePanelTrainingDebug = panel.stableTrainingDebug;
  }

  // document.write() only inserts the parser token while an external script is
  // executing; the inserted farm-panel-core.js does not execute until this
  // script returns. Arm the FarmPanel publication itself so the native Stable
  // renderer is installed at the exact moment the core publishes its API.
  // If the nursery bridge already owns the setter, delegate through it first so
  // all of its installers still run, then patch the resulting FarmPanel value.
  function armNativeInstallOnFarmPanelPublication() {
    if (window.FarmPanel) { installNativeStableRenderer(); return; }
    const descriptor = Object.getOwnPropertyDescriptor(window, 'FarmPanel');
    if (descriptor && descriptor.configurable === false) return;

    let pending = null;
    const previousGet = descriptor?.get;
    const previousSet = descriptor?.set;
    const enumerable = descriptor?.enumerable ?? true;

    Object.defineProperty(window, 'FarmPanel', {
      configurable: true,
      enumerable,
      get() {
        return previousGet ? previousGet.call(window) : pending;
      },
      set(value) {
        if (previousSet) {
          previousSet.call(window, value);
        } else {
          pending = value;
          Object.defineProperty(window, 'FarmPanel', {
            configurable: true,
            enumerable,
            writable: true,
            value,
          });
        }
        installNativeStableRenderer();
      },
    });
  }

  function loadCoreThenInstall() {
    if (window.FarmPanel) { installNativeStableRenderer(); return; }
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
      armNativeInstallOnFarmPanelPublication();
      document.write(`<script src="${CORE_SRC}" data-farm-panel-core="1"><\/script>`);
      return;
    }
    const script = document.createElement('script');
    script.src = CORE_SRC;
    script.dataset.farmPanelCore = '1';
    script.onload = installNativeStableRenderer;
    script.onerror = () => console.error('[FarmPanel] failed to load farm-panel-core.js');
    document.head.appendChild(script);
  }

  loadCoreThenInstall();
})();