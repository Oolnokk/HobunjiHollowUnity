(() => {
  'use strict';

  // The rest of the Farm/Stable hub stays in farm-panel-core.js. Stable
  // training is rendered here directly instead of post-processing whatever
  // markup the core renderer happened to create. During ordinary index.html
  // parsing this keeps the core synchronous, just like the former single file.
  const CORE_SRC = 'js/farm-panel-core.js?v=20261004stableStow1';

  const MAX_OUT_OF_STORAGE_STABLE_ANIMALS = 8; // Caps the Stable roster kept accessible outside indefinite stowage.
  let stableDeps = null; // Holds the live Stable save and UI dependencies.
  let expandedStableId = null; // Tracks the animal training row expanded in the Stable panel.
  let stableBabyInventoryCollapsed = true; // Keeps the dedicated baby inventory closed by default.
  let stableStowageCollapsed = true; // Keeps stored adult animals tucked away until requested.

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

  function growth() {
    return window.AnimalGrowth || null;
  }

  function petRapport() {
    return window.StableAnimalTownFamiliarity || null;
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
    petRapport()?.normalizeEntry?.(entry); // Pet Rapport lives on the same stable entry and is normalized before either UI/debug reads it.
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

  function formatPetRapport(value) {
    const rounded = Math.round((Number(value) || 0) * 100) / 100; // Compact point text keeps fractional multiplier credit legible without floating tails.
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '').replace(/\.$/, '');
  }

  function petRapportHeartsHtml(entry) {
    const api = petRapport();
    const maxHearts = Math.max(1, Math.floor(Number(api?.maxPetRapportHearts) || 10)); // Pet Rapport is a positive 0..10-heart track, unlike NPCs' negative-to-positive relationship row.
    const heartProgress = Math.max(0, Math.min(maxHearts, Number(api?.getPetHearts?.(entry)) || 0));
    const completed = Math.floor(heartProgress);
    const fraction = heartProgress - completed;
    const hearts = [];
    for (let index = 0; index < maxHearts; index++) {
      if (index < completed) {
        hearts.push('💛');
      } else if (index === completed && fraction > 0.0001) {
        const width = Math.round(fraction * 1000) / 10; // Same clipped-heart percentage convention used by the Relationships Favor renderer.
        hearts.push(`<span class="stable-pet-rapport-partial-heart" style="position:relative;display:inline-block;width:1.05em;overflow:hidden;vertical-align:-.08em"><span aria-hidden="true">🤍</span><span aria-hidden="true" style="position:absolute;left:0;top:0;width:${width}%;overflow:hidden;white-space:nowrap">💛</span></span>`);
      } else if (index === completed && completed < maxHearts) {
        hearts.push('🩶');
      } else {
        hearts.push('🤍');
      }
    }
    return hearts.join('');
  }

  function buildPetRapportSection(entry) {
    const api = petRapport();
    if (!api?.getPetRapport || !api?.getPetHearts) return null;
    const points = Number(api.getPetRapport(entry)) || 0;
    const hearts = Number(api.getPetHearts(entry)) || 0;
    const maxHearts = Math.max(1, Math.floor(Number(api.maxPetRapportHearts) || 10));
    const maxPoints = Number(api.maxPetRapportPoints?.()) || maxHearts * (Number(api.pointsPerHeart?.()) || 40);
    const section = document.createElement('div');
    section.className = 'stable-pet-rapport';
    section.style.cssText = 'display:flex;flex-direction:column;gap:3px;padding:6px 8px;border-radius:7px;background:rgba(255,214,74,.07);border:1px solid rgba(255,214,74,.18);';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11px;';
    header.appendChild(makeText('strong', 'Pet Rapport'));
    header.appendChild(makeText('span', `${formatPetRapport(points)}/${formatPetRapport(maxPoints)}`, 'opacity:.72;font-size:10px;'));
    section.appendChild(header);
    const heartRow = document.createElement('div');
    heartRow.className = 'stable-pet-rapport-hearts';
    heartRow.style.cssText = 'font-size:16px;line-height:1.15;letter-spacing:1px;white-space:nowrap;overflow:hidden;';
    heartRow.innerHTML = petRapportHeartsHtml(entry);
    heartRow.setAttribute('role', 'img');
    heartRow.setAttribute('aria-label', `Pet Rapport ${formatPetRapport(hearts)} of ${maxHearts} hearts`);
    section.appendChild(heartRow);
    return section;
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
    const rapportApi = petRapport();
    return {
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      lifeStage: entry.lifeStage,
      role,
      level: entry.level,
      maxLevel: stableMaxLevel(),
      xp: entry.stableXp || 0,
      petRapport: rapportApi?.getPetRapport?.(entry) ?? null,
      petRapportHearts: rapportApi?.getPetHearts?.(entry) ?? null,
      knownByTown: rapportApi?.isKnownByTown?.(entry) ?? null,
      availablePoints: availablePoints(entry),
      perks: { ...(entry.animalPerks || {}) },
      perkIds: perkDefsForEntry(entry).map(def => def.id),
      combatModifiers: role === 'companion' ? refinements()?.companionCombatModifiers?.(entry) || null : null,
    };
  }

  function stableAgeSection(title, note, options = {}) {
    const section = document.createElement('div'); // Used as the native Stable age-group container.
    section.className = 'stable-age-section';
    const heading = options.onToggle ? document.createElement('button') : makeText('div', title); // Used as a collapse control only for inventories that opt in.
    heading.className = options.onToggle ? 'settings-section-title stable-inventory-toggle' : 'settings-section-title';
    if (options.onToggle) {
      heading.type = 'button';
      heading.style.cssText = 'display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:0;cursor:pointer;';
      heading.textContent = `${options.collapsed ? '▸' : '▾'} ${title}`;
      heading.setAttribute('aria-expanded', options.collapsed ? 'false' : 'true');
      heading.addEventListener('click', options.onToggle);
    }
    section.appendChild(heading);
    const body = document.createElement('div'); // Contains every note and row so the section fully collapses.
    body.className = 'stable-age-section-body';
    body.hidden = !!options.collapsed;
    if (note) {
      const noteEl = makeText('div', note); // Used to explain the rules that differ between baby and adult animals.
      noteEl.className = 'farm-note';
      body.appendChild(noteEl);
    }
    const rows = document.createElement('div'); // Used as the destination for rows belonging to this age group.
    rows.className = 'farm-list';
    body.appendChild(rows);
    section.appendChild(body);
    return { section, rows, body };
  }

  function stableIsBaby(entry) {
    const api = growth(); // Used to keep the native Stable renderer on AnimalGrowth's canonical life-stage rule.
    return typeof api?.isBaby === 'function' ? api.isBaby(entry) : entry?.lifeStage === 'baby';
  }

  function growStableEntry(entry, equip) {
    const api = growth(); // Used to delegate tonic consumption/persistence instead of duplicating growth state here.
    const result = api?.growStableBaby?.(entry.id, { equip }) || { ok: false, message: 'Animal growth failed to load.' }; // Used for the user-facing result and toast.
    stableDeps?.showToast?.(result.message, result.ok !== false);
    return result;
  }

  function activeStableIds() {
    return new Set(['companion', 'mount', 'shoulderPet'].map(role => activeStableIdForRole(role)).filter(Boolean)); // Prioritizes currently deployed animals during old-save cap migration.
  }

  function normalizeStableStorage(stable) {
    let changed = false; // Reports whether normalization should be persisted by the Stable panel.
    const activeIds = activeStableIds(); // Keeps existing deployed animals out when migrating oversized legacy rosters.
    stable.forEach(entry => {
      if (typeof entry.stowed !== 'boolean') {
        entry.stowed = false;
        changed = true;
      }
      if (entry.stowed && activeIds.has(entry.id)) {
        entry.stowed = false;
        changed = true;
      }
    });

    const accessible = stable.filter(entry => !entry.stowed);
    if (accessible.length > MAX_OUT_OF_STORAGE_STABLE_ANIMALS) {
      const keep = new Set(accessible.filter(entry => activeIds.has(entry.id)).slice(0, MAX_OUT_OF_STORAGE_STABLE_ANIMALS).map(entry => entry.id));
      for (const entry of accessible) {
        if (keep.size >= MAX_OUT_OF_STORAGE_STABLE_ANIMALS) break;
        keep.add(entry.id);
      }
      for (const entry of accessible) {
        if (keep.has(entry.id)) continue;
        entry.stowed = true;
        changed = true;
      }
    }
    return changed;
  }

  function setStableStowed(entry) {
    const stable = stableDeps?.getStable?.() || []; // Uses the canonical Stable array so storage state follows existing save/load.
    if (!stable.includes(entry)) return;
    if (entry.stowed) {
      const outCount = stable.filter(candidate => !candidate.stowed).length;
      if (outCount >= MAX_OUT_OF_STORAGE_STABLE_ANIMALS) {
        stableDeps?.showToast?.(`Your Stable is full outside storage (${MAX_OUT_OF_STORAGE_STABLE_ANIMALS}). Stow an animal first.`, false);
        return;
      }
      entry.stowed = false;
    } else {
      const role = stableRole(entry);
      if (activeStableIdForRole(role) === entry.id) setActiveStableIdForRole(role, null);
      entry.stowed = true;
    }
    stableDeps?.saveStable?.();
    renderStablePanelNative();
  }

  function installStableStorageAcquisitionGuard() {
    const farmAnimals = window.FarmAnimals; // Wraps the canonical item-to-Stable action so a full accessible roster sends new animals straight to stowage.
    if (!farmAnimals || typeof farmAnimals.addToStable !== 'function' || farmAnimals.__stableStorageAcquisitionGuard) return;
    const originalAddToStable = farmAnimals.addToStable;
    const guardedAddToStable = function stableStorageGuardedAdd(...args) {
      const result = originalAddToStable.apply(this, args);
      if (!result?.ok || !result.entry) return result;
      const stable = stableDeps?.getStable?.() || [];
      const otherOutCount = stable.filter(candidate => candidate !== result.entry && !candidate.stowed).length;
      result.entry.stowed = otherOutCount >= MAX_OUT_OF_STORAGE_STABLE_ANIMALS;
      if (result.entry.stowed) {
        const role = stableRole(result.entry);
        if (activeStableIdForRole(role) === result.entry.id) setActiveStableIdForRole(role, null);
      }
      stableDeps?.saveStable?.();
      return result.entry.stowed
        ? { ...result, message: `${result.message} All ${MAX_OUT_OF_STORAGE_STABLE_ANIMALS} accessible Stable places were occupied, so this animal was stowed.` }
        : result;
    };
    guardedAddToStable.__stableStorageAcquisitionGuard = true;
    farmAnimals.addToStable = guardedAddToStable;
    farmAnimals.__stableStorageAcquisitionGuard = true;
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

      const rapportSection = buildPetRapportSection(entry); // Relationship display belongs above all trainable perks so it reads as state, not as another perk.
      if (rapportSection) panel.appendChild(rapportSection);

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
    growth()?.normalizeStableLifeStages?.();
    const stable = stableDeps.getStable?.() || [];
    if (normalizeStableStorage(stable)) stableDeps.saveStable?.(); // Migrates old saves and enforces the eight-animal accessible-roster limit.
    const outCount = stable.filter(entry => !entry.stowed).length;
    if (expandedStableId && !stable.some(entry => entry?.id === expandedStableId)) expandedStableId = null;
    list.innerHTML = '';
    if (!stable.length) {
      list.innerHTML = '<div class="farm-note">Your stable is empty. Add an undeployed creature item from the Inventory tab.</div>';
      refinements()?.syncCompanionCombatPerks?.();
      return;
    }

    const tonicLabel = growth()?.CONFIG?.item?.label || 'Growth Tonic'; // Used in baby-section guidance and growth controls.
    const tonicIcon = growth()?.CONFIG?.item?.icon || '🧪'; // Used to keep the native grow button consistent with AnimalGrowth.
    list.appendChild(makeText('div', `Outside storage: ${outCount}/${MAX_OUT_OF_STORAGE_STABLE_ANIMALS}. Stowed animals remain here indefinitely.`, 'font-size:11px;opacity:.8;margin:0 0 8px;'));
    const babies = stableAgeSection('🐣 Baby Animals', `Baby Stable animals cannot be mounts, companions, or shoulder pets until you use a ${tonicLabel}.`, {
      collapsed: stableBabyInventoryCollapsed,
      onToggle: () => { stableBabyInventoryCollapsed = !stableBabyInventoryCollapsed; renderStablePanelNative(); },
    }); // Dedicated, fully collapsible baby inventory.
    const adults = stableAgeSection('🐾 Adult Animals', 'Adult Stable animals can fill their normal role.'); // Receives every available adult row.
    const stowedRows = document.createElement('div'); // Holds stowed adults without removing them from the saved Stable roster.
    stowedRows.className = 'farm-list';
    const stowedAdultCount = stable.filter(entry => entry.stowed && !stableIsBaby(entry)).length;
    const stowedBabyCount = stable.filter(entry => entry.stowed && stableIsBaby(entry)).length;

    stable.forEach(entry => {
      normalizeStableEntry(entry);
      const role = stableRole(entry);
      const meta = roleMeta(entry);
      const baby = stableIsBaby(entry); // Used throughout the row to gate role assignment and growth controls.
      const isStowedAdult = entry.stowed && !baby; // Stowed babies remain in their dedicated inventory; adults move into the stowage drawer.
      const isActive = !baby && !entry.stowed && entry.id === activeStableIdForRole(role);
      const isExpanded = expandedStableId === entry.id;
      const points = availablePoints(entry);
      const max = stableMaxLevel();
      const row = document.createElement('div');
      row.className = 'farm-row livestock-trait-row stable-training-row';
      row.dataset.stableTrainingId = entry.id;
      row.dataset.stableLifeStage = baby ? 'baby' : 'adult';
      row.style.cursor = 'pointer';
      row.style.flexWrap = 'wrap';
      row.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      row.innerHTML =
        `<button class="settings-small-btn farm-companion-btn${isActive ? ' active' : ''}" title="${entry.stowed ? 'Stowed — take this animal out of storage first' : baby ? `${tonicLabel} required — grow and set as ${meta.label.toLowerCase()}` : isActive ? `Active ${meta.label.toLowerCase()}` : `Set as ${meta.label.toLowerCase()}`}" ${entry.stowed ? 'disabled' : ''}>${meta.icon}</button>` +
        `<span class="farm-row-icon">${STABLE_KIND_ICONS[entry.kind] || '🐾'}</span>` +
        `<input class="farm-row-name" value="${esc(entry.name || window.CreatureGenetics?.defaultLivestockName?.(entry.kind) || entry.kind)}" maxlength="30">` +
        `<span class="farm-row-value">${baby ? 'Baby · ' : ''}${entry.stowed ? 'Stowed · ' : ''}${esc(meta.label)} · Lv. ${entry.level}/${max}${points > 0 ? ` · ${points} point${points === 1 ? '' : 's'}` : ''}</span>` +
        `<span class="stable-training-chevron" style="font-size:15px;opacity:.7;margin-left:auto;">${isExpanded ? '▾' : '▸'}</span>` +
        livestockTraitsHtml(entry.genotype, entry.kind);

      row.querySelector('.farm-companion-btn')?.addEventListener('click', event => {
        event.stopPropagation();
        if (baby) {
          const equipAfterGrowth = !entry.stowed && growth()?.CONFIG?.stable?.growAndEquipOnRoleClick !== false; // Stowed babies mature in place and cannot bypass the storage boundary by auto-equipping.
          growStableEntry(entry, equipAfterGrowth);
          return;
        }
        if (entry.stowed) return;
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
      const stowButton = document.createElement('button'); // Moves this animal between the accessible roster and indefinite Stable storage.
      stowButton.className = 'settings-small-btn stable-stow-btn';
      stowButton.textContent = entry.stowed ? 'Take Out' : 'Stow';
      stowButton.title = entry.stowed ? `Take this animal out of storage (${outCount}/${MAX_OUT_OF_STORAGE_STABLE_ANIMALS} currently out).` : 'Keep this animal in Stable storage indefinitely.';
      stowButton.addEventListener('click', event => { event.stopPropagation(); setStableStowed(entry); });
      row.appendChild(stowButton);
      if (baby) {
        const growButton = document.createElement('button'); // Used as the explicit one-way Stable maturation control.
        growButton.className = 'settings-small-btn stable-grow-btn';
        growButton.textContent = `${tonicIcon} Grow Up`;
        growButton.title = `${tonicLabel}: ${growth()?.growthTonicCount?.() ?? 0} owned`;
        growButton.addEventListener('click', event => {
          event.stopPropagation();
          growStableEntry(entry, false);
        });
        row.appendChild(growButton);
      }
      if (isExpanded) row.appendChild(buildStablePerkTree(entry));
      (baby ? babies.rows : isStowedAdult ? stowedRows : adults.rows).appendChild(row);
    });

    if (!babies.rows.children.length) babies.rows.innerHTML = '<div class="farm-note">No baby animals in your Stable.</div>';
    if (!adults.rows.children.length) adults.rows.innerHTML = '<div class="farm-note">No adult animals are outside storage.</div>';
    list.appendChild(babies.section);
    list.appendChild(adults.section);
    if (stowedAdultCount || stowedBabyCount) {
      const stowedSection = document.createElement('div'); // A compact drawer keeps stowed adult animals out of the main roster.
      stowedSection.className = 'stable-stowage-section';
      const stowedHeading = makeText('button', `▸ Stowed Animals · ${stowedAdultCount + stowedBabyCount}`);
      stowedHeading.type = 'button';
      stowedHeading.style.cssText = 'display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:0;cursor:pointer;';
      stowedHeading.className = 'settings-section-title stable-inventory-toggle';
      stowedHeading.setAttribute('aria-expanded', stableStowageCollapsed ? 'false' : 'true');
      stowedHeading.addEventListener('click', () => { stableStowageCollapsed = !stableStowageCollapsed; renderStablePanelNative(); });
      stowedSection.appendChild(stowedHeading);
      const stowedBody = document.createElement('div');
      stowedBody.className = 'stable-stowage-body';
      stowedBody.hidden = stableStowageCollapsed;
      stowedBody.appendChild(makeText('div', `${stowedAdultCount} adult${stowedAdultCount === 1 ? '' : 's'} and ${stowedBabyCount} bab${stowedBabyCount === 1 ? 'y' : 'ies'} in indefinite storage. Stowed babies remain in Baby Animals.`, 'font-size:11px;opacity:.8;'));
      if (!stableStowageCollapsed) {
        stowedHeading.textContent = `▾ Stowed Animals · ${stowedAdultCount + stowedBabyCount}`;
        stowedBody.appendChild(stowedRows);
      }
      stowedSection.appendChild(stowedBody);
      list.appendChild(stowedSection);
    }
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
      installStableStorageAcquisitionGuard();
      progression()?.install?.();
      petRapport()?.install?.();
      refinements()?.install?.();
      refinements()?.ensureStableCaps?.();
      growth()?.normalizeStableLifeStages?.();
      return result;
    };
    panel.renderStablePanel = renderStablePanelNative;
    panel.stableTrainingDebug = () => {
      const stable = stableDeps?.getStable?.() || []; // Used to expose age counts alongside per-animal Stable diagnostics.
      return {
        mostRecentChange: 'Stable animals can be stowed indefinitely; eight remain outside storage, and the Baby inventory collapses by default.',
        expandedStableId,
        maxLevel: stableMaxLevel(),
        babyCount: stable.filter(stableIsBaby).length,
        adultCount: stable.filter(entry => !stableIsBaby(entry)).length,
        stowedCount: stable.filter(entry => entry.stowed).length,
        outsideStorageCount: stable.filter(entry => !entry.stowed).length,
        outsideStorageLimit: MAX_OUT_OF_STORAGE_STABLE_ANIMALS,
        animals: stable.map(stableDebugEntry),
      };
    };
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
