(() => {
  'use strict';
  if (window.LivestockNurseryGrid) return;

  // Nursery roster presentation + livestock-sale economy. The underlying
  // LivestockNursery remains authoritative for lifecycle, housing, and its
  // interior swarm; this module only consumes its public seams plus the same
  // injected FarmAnimals/FarmPanel dependencies used by the existing farm UI.
  const ECONOMY = Object.freeze({
    adultMaturityPremium: 400,
    babyAdultFraction: 0.15,
    babyRoundTo: 5,
  });
  const SIZE_ORDER = Object.freeze(['small', 'medium', 'large']); // Used to measure how many size steps a baby differs from its species default.
  const SIZE_BADGES = Object.freeze({ '-2': '🔻', '-1': '🔽', '1': '🔼', '2': '🔺' }); // Used on card corners for one-step (blue) and two-step (red) rare sizes.
  const PATTERN_BADGES = Object.freeze({
    colorpoint: '🎭',
    foxtail: '🦊',
    mitts: '🧤',
    spectacles: '👓',
    stripes: '🦓',
    bodystripes: '🐅',
    coloredstripe: '🌈',
    belly: '🟠',
  }); // Used as compact one-emoji identifiers; the detail rail always spells out the exact trait.
  const ALWAYS_PRESENT_PATTERNS = Object.freeze({
    puktuk: new Set(['belly']),
    'voorg-ass': new Set(['belly']),
  }); // Used to keep species-defining anatomy out of the "special trait" badge strip while still listing it in Pattern details.
  const SPECIES_FALLBACK_ICONS = Object.freeze({
    uumkaoii: '🐮',
    'gar-wolf': '🐺',
    'dabinggi-hound': '🐕',
    grehlr: '🐈',
    drenkirra: '🦎',
    puktuk: '🦊',
    'voorg-ass': '🫏',
  }); // Used only until/if an accurate composed genetics portrait cannot be produced.
  const PORTRAIT_CACHE_LIMIT = 128; // Used to bound data-URL portrait memory on very long breeding saves.

  let animalDeps = null; // Captured from FarmAnimals.init; used for Nursery records, permissions, persistence, breeding cleanup, and toasts.
  let panelDeps = null; // Captured from FarmPanel.init; used for wallet persistence/HUD refresh and shared inventory state.
  let originalFarmAnimalsInit = null; // Used to preserve the existing FarmAnimals wrapper chain when capturing deps.
  let originalFarmPanelInit = null; // Used to preserve the existing FarmPanel wrapper chain when capturing deps.
  let originalFarmPanelRender = null; // Used to decorate only after the authoritative Farm panel has rendered.
  let originalSellValueFor = null; // Used as the genetics-only value underneath the new adult maturation premium.
  let livestockObserver = null; // Watches only #farmLivestockList direct children so Nursery replacement is detected without a document-wide observer.
  let portraitObserver = null; // Lazily composes only card portraits that can actually become visible instead of rendering every future page up front.
  let portraitObserverSection = null; // Used to disconnect card observations when FarmPanel replaces the entire Nursery section.
  let selectedBabyId = null; // Used by mouse/controller focus so the right-side detail rail follows the active grid square without rebuilding the Farm panel.
  let decorateQueued = false; // Coalesces render/observer requests into one Nursery enhancement microtask.
  let installed = false; // Makes repeated parser/runtime bridge installs idempotent.
  let mostRecentChange = 'Nursery grid module loaded.'; // Included in mobile-visible diagnostics after every state-changing action.
  const portraitCache = new Map(); // genotype signature -> Promise<string|null>; reused by grid cards and the selected-baby portrait.

  const roundTo = (value, step) => Math.max(step, Math.round(Number(value || 0) / step) * step);
  const currentDeps = () => panelDeps || animalDeps;

  function speciesLabel(kind) {
    return animalDeps?.CREATURE_DB?.[kind]?.label || panelDeps?.CREATURE_DB?.[kind]?.label || String(kind || 'Animal');
  }

  function isBaby(entry) {
    return !!entry && (window.LivestockNursery?.isBaby?.(entry) || entry.lifeStage === 'baby');
  }

  function currentBabies() {
    const list = animalDeps?.loadWorldLivestock?.() || panelDeps?._loadWorldLivestock?.() || [];
    return Array.isArray(list) ? list.filter(isBaby) : [];
  }

  function hasLivestockPermission() {
    const check = animalDeps?.hasFarmPermission || panelDeps?.hasFarmPermission;
    return typeof check !== 'function' || check('livestock') !== false;
  }

  function installEconomyPatch() {
    const genetics = window.CreatureGenetics;
    if (!genetics?.sellValueFor) return false;
    if (genetics.sellValueFor.__nurseryGridEconomy) return true;
    originalSellValueFor = genetics.sellValueFor;
    const wrapped = function nurseryGridAdultSellValue(genotype, kind = 'uumkaoii') {
      const geneticValue = originalSellValueFor.call(this, genotype, kind) || { amount: 0, tier: 'Common' };
      const geneticAmount = Math.max(0, Math.round(Number(geneticValue.amount) || 0));
      return {
        ...geneticValue,
        amount: geneticAmount + ECONOMY.adultMaturityPremium,
        geneticAmount,
        maturityPremium: ECONOMY.adultMaturityPremium,
      };
    };
    Object.defineProperties(wrapped, {
      __nurseryGridEconomy: { value: true },
      __nurseryGridBaseSellValueFor: { value: originalSellValueFor },
    });
    genetics.sellValueFor = wrapped;
    mostRecentChange = `Adult livestock values now include a ${ECONOMY.adultMaturityPremium}g maturity premium.`;
    return true;
  }

  function adultValueFor(entry) {
    const value = window.CreatureGenetics?.sellValueFor?.(entry?.genotype, entry?.kind);
    return Math.max(1, Math.round(Number(value?.amount) || ECONOMY.adultMaturityPremium));
  }

  function babyValueFor(entry) {
    const adultAmount = adultValueFor(entry);
    return {
      amount: roundTo(adultAmount * ECONOMY.babyAdultFraction, ECONOMY.babyRoundTo),
      adultAmount,
      fraction: ECONOMY.babyAdultFraction,
    };
  }

  function sizeInfo(entry, traits) {
    const size = traits?.size || {};
    const sizeClass = String(size.sizeClass || entry?.genotype?.sizeClass || size.label || 'medium').toLowerCase();
    const defaultClass = String(size.defaultSizeClass || animalDeps?.CREATURE_DB?.[entry?.kind]?.defaultSizeClass || 'medium').toLowerCase();
    const actualIndex = SIZE_ORDER.indexOf(sizeClass);
    const defaultIndex = SIZE_ORDER.indexOf(defaultClass);
    const delta = actualIndex >= 0 && defaultIndex >= 0 ? actualIndex - defaultIndex : 0;
    const label = size.label || (sizeClass ? sizeClass[0].toUpperCase() + sizeClass.slice(1) : 'Medium');
    const defaultLabel = defaultClass ? defaultClass[0].toUpperCase() + defaultClass.slice(1) : 'Medium';
    return { sizeClass, defaultClass, label, defaultLabel, delta, badge: SIZE_BADGES[String(delta)] || '' };
  }

  function traitInfo(entry) {
    const traits = window.CreatureGenetics?.genotypeTraits?.(entry?.kind, entry?.genotype) || { colors: [], patterns: [] };
    const colors = Array.isArray(traits.colors) ? traits.colors : [];
    const patterns = Array.isArray(traits.patterns) ? traits.patterns : [];
    const size = sizeInfo(entry, traits);
    const badges = [];
    const specials = [];
    if (size.delta) {
      const direction = size.delta < 0 ? 'smaller' : 'larger';
      const steps = Math.abs(size.delta);
      badges.push(size.badge);
      specials.push(`${size.badge} Rare size: ${size.label} · ${steps} size${steps === 1 ? '' : 's'} ${direction} than normal (${size.defaultLabel})`);
    }
    for (const pattern of patterns) {
      const isAlwaysPresent = ALWAYS_PRESENT_PATTERNS[entry?.kind]?.has(pattern.id);
      if (isAlwaysPresent) continue;
      const badge = PATTERN_BADGES[pattern.id] || '✨';
      badges.push(badge);
      specials.push(`${badge} ${pattern.label}${pattern.carrier && !pattern.enabled ? ' carrier' : ''}`);
    }
    return { traits, colors, patterns, size, badges, specials };
  }

  function genotypePortraitKey(entry) {
    const renderer = window.CreatureGeneticsRender;
    try {
      const signature = renderer?.genotypeSignature?.(entry.kind, entry.genotype);
      if (signature) return `${entry.kind}|${signature}`;
    } catch (_) {}
    try { return `${entry.kind}|${JSON.stringify(entry.genotype || {})}`; }
    catch (_) { return `${entry.kind}|${entry.id}`; }
  }

  function trimPortraitCache() {
    while (portraitCache.size > PORTRAIT_CACHE_LIMIT) {
      const oldest = portraitCache.keys().next().value;
      portraitCache.delete(oldest);
    }
  }

  function portraitUrlFor(entry) {
    const renderer = window.CreatureGeneticsRender;
    if (!renderer?.composeFrame || !entry?.kind || !entry?.genotype) return Promise.resolve(null);
    const key = genotypePortraitKey(entry);
    if (portraitCache.has(key)) return portraitCache.get(key);
    const promise = Promise.resolve(renderer.composeFrame(entry.kind, 'idle', entry.genotype, false))
      .then(canvas => {
        if (!canvas?.toDataURL) return null;
        try { return canvas.toDataURL('image/png'); }
        catch (_) { return null; }
      })
      .catch(error => {
        console.warn('[NurseryGrid] portrait compose failed:', entry.kind, error);
        return null;
      });
    portraitCache.set(key, promise);
    trimPortraitCache();
    return promise;
  }

  function applyCardPortrait(section, card, entry) {
    if (!section || !card || !entry) return;
    portraitUrlFor(entry).then(url => {
      if (!url || !card.isConnected || card.dataset.nurseryBabyId !== String(entry.id)) return;
      card.style.backgroundImage = `url("${url}")`;
      card.dataset.portraitReady = '1';
      if (entry.id === selectedBabyId) setDetailPortrait(section.shadowRoot, entry, url);
    });
  }

  function ensureCardPortraitObserver(section) {
    if (portraitObserverSection !== section) {
      portraitObserver?.disconnect?.();
      portraitObserver = null;
      portraitObserverSection = section;
    }
    if (portraitObserver || typeof IntersectionObserver === 'undefined') return portraitObserver;
    portraitObserver = new IntersectionObserver(entries => {
      for (const observed of entries) {
        if (!observed.isIntersecting) continue;
        const card = observed.target;
        portraitObserver?.unobserve?.(card);
        const entry = card.__nurseryPortraitEntry;
        if (entry) applyCardPortrait(portraitObserverSection, card, entry);
      }
    }, { root: null, rootMargin: '96px' });
    return portraitObserver;
  }

  function scheduleCardPortrait(section, card, entry) {
    card.__nurseryPortraitEntry = entry; // Retained only while the current Nursery section owns this card; observer disconnects when the section is replaced.
    const observer = ensureCardPortraitObserver(section);
    if (observer) observer.observe(card);
    else applyCardPortrait(section, card, entry); // Safe fallback for browsers without IntersectionObserver.
  }

  function ensureDocumentStyles() {
    if (typeof document === 'undefined' || document.getElementById('livestockNurseryGridStyles')) return;
    const style = document.createElement('style'); // Inserted in <head>, outside LivestockNursery's body MutationObserver.
    style.id = 'livestockNurseryGridStyles';
    style.textContent = `
      #livestockNurserySection .nursery-grid-stack {
        display:grid !important;
        grid-template-columns:repeat(7,minmax(0,1fr)) !important;
        align-content:start !important;
        gap:6px !important;
        width:100% !important;
        height:auto !important;
        max-height:none !important;
        min-height:0 !important;
        overflow:visible !important;
        overscroll-behavior:auto !important;
        padding:6px !important;
        scrollbar-gutter:auto !important;
        box-sizing:border-box !important;
      }
      #livestockNurserySection .nursery-grid-card {
        position:relative !important;
        width:100% !important;
        aspect-ratio:1 / 1 !important;
        min-width:0 !important;
        min-height:0 !important;
        padding:0 !important;
        overflow:hidden !important;
        border:1px solid var(--border,#4b443a) !important;
        border-radius:7px !important;
        background-color:rgba(0,0,0,.22) !important;
        background-repeat:no-repeat !important;
        background-position:center !important;
        background-size:contain !important;
        cursor:pointer !important;
        box-sizing:border-box !important;
      }
      #livestockNurserySection .nursery-grid-card > * { visibility:hidden !important; }
      #livestockNurserySection .nursery-grid-card::before {
        content:attr(data-fallback-icon);
        position:absolute;
        inset:0;
        display:grid;
        place-items:center;
        font-size:28px;
        opacity:.65;
        pointer-events:none;
      }
      #livestockNurserySection .nursery-grid-card[data-portrait-ready="1"]::before { content:''; }
      #livestockNurserySection .nursery-grid-card::after {
        content:attr(data-nursery-badges);
        position:absolute;
        top:2px;
        right:3px;
        left:3px;
        text-align:right;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:clip;
        font-size:14px;
        line-height:1.05;
        letter-spacing:-2px;
        filter:drop-shadow(0 1px 1px rgba(0,0,0,.9));
        pointer-events:none;
      }
      #livestockNurserySection .nursery-grid-card[aria-selected="true"] {
        border-color:var(--accent,#d9ad65) !important;
        box-shadow:0 0 0 2px rgba(217,173,101,.35) inset,0 0 0 1px rgba(217,173,101,.4) !important;
        background-color:rgba(217,173,101,.10) !important;
      }
      #livestockNurserySection .nursery-grid-card:focus-visible {
        outline:2px solid #fff !important;
        outline-offset:1px !important;
      }
      #livestockNurserySection .nursery-grid-actions {
        display:flex !important;
        gap:5px !important;
        flex-wrap:wrap !important;
        margin:8px 0 0 !important;
        padding:8px 0 0 !important;
        border-top:1px solid var(--border,#444) !important;
      }
      #livestockNurserySection .nursery-grid-actions button[data-nursery-action] { font-size:0 !important; }
      #livestockNurserySection .nursery-grid-actions button[data-nursery-action]::after {
        content:attr(data-nursery-label);
        font-size:11px;
        white-space:nowrap;
      }
      #livestockNurserySection .nursery-grid-debug-trigger {
        display:inline-flex !important;
        width:max-content !important;
        margin-top:7px !important;
        padding:3px 6px !important;
        border:1px solid var(--border,#444) !important;
        border-radius:5px !important;
        background:rgba(0,0,0,.12) !important;
        cursor:pointer !important;
        font-size:0 !important;
        color:var(--muted,#999) !important;
        line-height:1 !important;
      }
      #livestockNurserySection .nursery-grid-debug-trigger::after {
        content:attr(data-nursery-label);
        font-size:10px;
      }
      #livestockNurserySection .nursery-grid-debug-trigger:focus-visible {
        outline:2px solid #fff !important;
        outline-offset:1px !important;
      }
      #livestockNurserySection .nursery-grid-empty { grid-column:1 / -1; }
    `;
    document.head.appendChild(style);
  }

  function buildShadow(section) {
    if (section.shadowRoot) return section.shadowRoot;
    const shadow = section.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { display:block; }
        .layout { display:grid;grid-template-columns:minmax(0,1fr) minmax(148px,36%);gap:9px;align-items:stretch; }
        .grid-pane,.detail-pane { min-width:0; }
        .grid-pane { display:flex;flex-direction:column; }
        .header { display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 5px; }
        .title { font-weight:700;font-size:12px; }
        .capacity { font-size:10px;color:var(--muted,#999);text-align:right; }
        .capacity.warn { color:#ff9b80;font-weight:700; }
        .hint { font-size:9px;line-height:1.25;color:var(--muted,#999);margin:0 0 6px; }
        .detail-pane { border-left:1px solid var(--border,#444);padding-left:9px;display:flex;flex-direction:column;min-height:148px; }
        .portrait { width:100%;height:92px;flex:0 0 auto;border-radius:6px;background:rgba(0,0,0,.18) center/contain no-repeat;display:grid;place-items:center;font-size:34px;overflow:hidden; }
        .name { font-weight:700;font-size:13px;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
        .species { font-size:10px;color:var(--muted,#999);margin-top:1px; }
        .economy { font-size:10px;margin-top:5px;padding:5px 6px;border-radius:5px;background:rgba(255,220,160,.06);line-height:1.35; }
        .section { margin-top:7px; }
        .section-title { font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#999);font-weight:700;margin-bottom:3px; }
        .line { font-size:10px;line-height:1.3;margin:2px 0;overflow-wrap:anywhere; }
        .swatch { width:9px;height:9px;border-radius:50%;display:inline-block;border:1px solid rgba(255,255,255,.35);vertical-align:-1px;margin-right:4px;box-sizing:border-box; }
        .placeholder { margin:auto 0;color:var(--muted,#999);font-size:11px;line-height:1.35; }
        .details-scroll { min-height:0;overflow-y:auto;overscroll-behavior:contain; }
        ::slotted(.nursery-grid-actions) { margin-top:auto; }
        @media (max-width:520px) {
          .layout { grid-template-columns:minmax(0,1fr) minmax(132px,40%);gap:6px; }
          .detail-pane { padding-left:6px; }
          .portrait { height:76px; }
        }
      </style>
      <div class="layout">
        <div class="grid-pane">
          <div class="header"><div class="title" id="title"></div><div class="capacity" id="capacity"></div></div>
          <div class="hint">Focus a portrait to inspect it. The grid uses Inventory-style square slots and pages only when needed.</div>
          <slot name="grid"></slot>
        </div>
        <aside class="detail-pane">
          <div id="detailPlaceholder" class="placeholder">Select a Nursery baby to inspect its genetics and sale value.</div>
          <div id="detailBody" hidden>
            <div class="portrait" id="detailPortrait"></div>
            <div class="name" id="detailName"></div>
            <div class="species" id="detailSpecies"></div>
            <div class="economy" id="detailEconomy"></div>
            <div class="details-scroll">
              <div class="section"><div class="section-title">Size</div><div class="line" id="detailSize"></div></div>
              <div class="section"><div class="section-title">Colors</div><div id="detailColors"></div></div>
              <div class="section"><div class="section-title">Patterns</div><div id="detailPatterns"></div></div>
              <div class="section"><div class="section-title">Special traits</div><div id="detailSpecials"></div></div>
            </div>
          </div>
          <slot name="actions"></slot>
          <slot name="debug"></slot>
        </aside>
      </div>`;
    return shadow;
  }

  function findGridStack(section) {
    return [...section.children].find(child => child.style?.overflowY === 'auto' && child.style?.flexDirection === 'column') || null;
  }

  function findActionContainer(section) {
    return [...section.children].find(child => [...child.children].some(node => node.tagName === 'BUTTON'
      && (node.dataset?.nurseryAction === 'grow' || /Grow Up/i.test(node.textContent || '')))) || null;
  }

  function findBabyCard(stack, id) {
    return [...(stack?.querySelectorAll?.(':scope > button') || [])].find(card => card.dataset.nurseryBabyId === String(id)) || null;
  }

  function findDebugHost(section, stack, actions) {
    return [...section.children].find(child => child !== stack && child !== actions && child.tagName === 'DIV' && /Babies stay babies/i.test(child.textContent || '')) || null;
  }

  function setLightDomRoles(section, stack, actions, records) {
    stack.slot = 'grid';
    stack.classList.add('nursery-grid-stack');
    const cards = [...stack.querySelectorAll(':scope > button')];
    cards.forEach((card, index) => {
      const entry = records[index];
      if (!entry) return;
      const traits = traitInfo(entry);
      card.classList.add('nursery-grid-card');
      card.dataset.nurseryBabyId = String(entry.id);
      card.dataset.nurseryBadges = traits.badges.join('');
      card.dataset.fallbackIcon = SPECIES_FALLBACK_ICONS[entry.kind] || '🐾';
      card.setAttribute('aria-label', `${entry.name || speciesLabel(entry.kind)}, ${speciesLabel(entry.kind)}${traits.specials.length ? `, ${traits.specials.join(', ')}` : ''}`);
      card.setAttribute('aria-selected', String(entry.id === selectedBabyId));
      scheduleCardPortrait(section, card, entry);
    });
    const empty = stack.querySelector(':scope > div');
    if (empty && !records.length) empty.classList.add('nursery-grid-empty');

    if (actions) {
      actions.slot = 'actions';
      actions.classList.add('nursery-grid-actions');
      const buttons = [...actions.querySelectorAll(':scope > button')];
      if (buttons[0]) buttons[0].dataset.nurseryAction = 'rename';
      if (buttons[1]) buttons[1].dataset.nurseryAction = 'grow';
      if (buttons[2]) buttons[2].dataset.nurseryAction = 'sell';
    }

    const debugHost = findDebugHost(section, stack, actions);
    if (debugHost) {
      debugHost.slot = 'debug';
      debugHost.classList.add('nursery-grid-debug-trigger');
      debugHost.dataset.nurseryAction = 'debug';
      debugHost.dataset.nurseryLabel = '🛠 Copy Nursery Debug';
      debugHost.setAttribute('role', 'button');
      debugHost.tabIndex = 0;
    }
  }

  function appendLine(container, text, color = null) {
    const line = document.createElement('div'); // Lives inside shadow DOM, so it cannot wake the legacy Nursery body observer.
    line.className = 'line';
    if (color) {
      const swatch = document.createElement('span'); // Used to show the exact stored genetic color beside its authored name.
      swatch.className = 'swatch';
      swatch.style.background = color;
      line.appendChild(swatch);
    }
    line.appendChild(document.createTextNode(text));
    container.appendChild(line);
  }

  function setDetailPortrait(shadow, entry, url = null) {
    const portrait = shadow?.getElementById('detailPortrait');
    if (!portrait || !entry) return;
    portrait.textContent = url ? '' : (SPECIES_FALLBACK_ICONS[entry.kind] || '🐾');
    portrait.style.backgroundImage = url ? `url("${url}")` : '';
  }

  function updateActionState(section, entry) {
    const actions = findActionContainer(section);
    if (!actions || !entry) return;
    const buttons = [...actions.querySelectorAll(':scope > button')];
    const rename = buttons.find(button => button.dataset.nurseryAction === 'rename');
    const grow = buttons.find(button => button.dataset.nurseryAction === 'grow');
    const sell = buttons.find(button => button.dataset.nurseryAction === 'sell');
    const canManage = hasLivestockPermission();
    const capacityFull = (window.LivestockNursery?.adultCount?.() || 0) >= (window.LivestockNursery?.adultCapacity?.() || 0);
    const tonicCount = Number(window.AnimalGrowth?.growthTonicCount?.()) || 0;
    const babyValue = babyValueFor(entry);

    if (rename) {
      rename.dataset.nurseryLabel = 'Rename';
      rename.disabled = !canManage;
      rename.title = canManage ? `Rename ${entry.name || 'this baby'}.` : 'Livestock permission required.';
    }
    if (grow) {
      grow.dataset.nurseryLabel = '🧪 Grow Up';
      // AnimalGrowth's legacy document-capture gate keys specifically on
      // textContent === "Grow Up" because the old Nursery button called a
      // private function. This grid calls the wrapped public API instead, so
      // change only the existing text node (characterData, not childList) to
      // keep the old body MutationObserver asleep and prevent a second tonic
      // from being consumed by that legacy gate. The visible label comes from
      // data-nursery-label above.
      if (grow.firstChild?.nodeType === 3 && grow.firstChild.nodeValue !== 'Nursery Grow') grow.firstChild.nodeValue = 'Nursery Grow';
      grow.disabled = !canManage || capacityFull || tonicCount < 1;
      grow.title = !canManage ? 'Livestock permission required.'
        : capacityFull ? 'Build or upgrade a real barn first.'
        : tonicCount < 1 ? 'You need a Growth Tonic.'
        : `Use 1 Growth Tonic (${tonicCount} owned) and move this baby into an open barn.`;
    }
    if (sell) {
      sell.dataset.nurseryLabel = `Sell Baby · ${babyValue.amount}g`;
      sell.disabled = !canManage;
      sell.title = `${babyValue.amount}g is ${Math.round(ECONOMY.babyAdultFraction * 100)}% of this animal's ${babyValue.adultAmount}g adult value.`;
    }
  }

  function renderDetails(section, entry) {
    const shadow = section?.shadowRoot;
    if (!shadow) return;
    const placeholder = shadow.getElementById('detailPlaceholder');
    const body = shadow.getElementById('detailBody');
    if (!entry) {
      if (placeholder) placeholder.hidden = false;
      if (body) body.hidden = true;
      return;
    }
    if (placeholder) placeholder.hidden = true;
    if (body) body.hidden = false;

    const info = traitInfo(entry);
    const value = babyValueFor(entry);
    const name = shadow.getElementById('detailName');
    const species = shadow.getElementById('detailSpecies');
    const economy = shadow.getElementById('detailEconomy');
    const size = shadow.getElementById('detailSize');
    if (name) name.textContent = entry.name || speciesLabel(entry.kind);
    if (species) species.textContent = speciesLabel(entry.kind);
    if (economy) economy.textContent = `Baby sale ${value.amount}g · Adult sale ${value.adultAmount}g · Growth Tonic ${Number(window.AnimalGrowth?.growthTonicCount?.()) || 0} owned`;
    if (size) {
      if (info.size.delta) {
        const direction = info.size.delta < 0 ? 'smaller' : 'larger';
        size.textContent = `${info.size.badge} ${info.size.label} · ${Math.abs(info.size.delta)} size${Math.abs(info.size.delta) === 1 ? '' : 's'} ${direction} than normal ${info.size.defaultLabel}`;
      } else {
        size.textContent = `${info.size.label} · normal size for this species`;
      }
    }

    const colors = shadow.getElementById('detailColors');
    const patterns = shadow.getElementById('detailPatterns');
    const specials = shadow.getElementById('detailSpecials');
    if (colors) {
      colors.replaceChildren();
      if (!info.colors.length) appendLine(colors, 'Default / unnamed colors');
      else info.colors.forEach(color => appendLine(colors, `${color.label}: ${color.colorName || color.color || 'Unnamed'}`, color.color || null));
    }
    if (patterns) {
      patterns.replaceChildren();
      if (!info.patterns.length) appendLine(patterns, 'No authored pattern traits');
      else info.patterns.forEach(pattern => {
        const state = pattern.enabled ? 'Visible' : pattern.carrier ? 'Carrier' : 'Hidden';
        const copies = Number(pattern.copies) || 0;
        appendLine(patterns, `${pattern.label}: ${state} · ${pattern.colorName || 'Unnamed color'} · ${pattern.inheritance || 'unknown'}${copies ? ` · ${copies} cop${copies === 1 ? 'y' : 'ies'}` : ''}`, pattern.color || null);
      });
    }
    if (specials) {
      specials.replaceChildren();
      if (!info.specials.length) appendLine(specials, 'No special traits');
      else info.specials.forEach(text => appendLine(specials, text));
    }

    setDetailPortrait(shadow, entry, null);
    portraitUrlFor(entry).then(url => {
      if (!url || selectedBabyId !== entry.id || section !== document.getElementById('livestockNurserySection')) return;
      setDetailPortrait(shadow, entry, url);
    });
    updateActionState(section, entry);
  }

  function updateHeader(section, records) {
    const shadow = section?.shadowRoot;
    if (!shadow) return;
    const adults = Number(window.LivestockNursery?.adultCount?.()) || 0;
    const capacity = Number(window.LivestockNursery?.adultCapacity?.()) || 0;
    const title = shadow.getElementById('title');
    const capacityEl = shadow.getElementById('capacity');
    if (title) title.textContent = `🍼 Nursery · ${records.length} babies`;
    if (capacityEl) {
      capacityEl.textContent = `Adults ${adults}/${capacity} barn spaces`;
      capacityEl.classList.toggle('warn', adults > capacity);
    }
  }

  function selectBaby(section, id, { scroll = false } = {}) {
    const records = currentBabies();
    const entry = records.find(item => String(item.id) === String(id)) || null;
    if (!entry) return false;
    selectedBabyId = entry.id;
    const stack = findGridStack(section);
    for (const card of stack?.querySelectorAll?.(':scope > button') || []) {
      const selected = card.dataset.nurseryBabyId === String(entry.id);
      card.setAttribute('aria-selected', String(selected));
      if (selected && scroll) card.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    renderDetails(section, entry);
    return true;
  }

  function cleanupBabyBreedingRefs(id) {
    const loadPairs = animalDeps?._loadWorldBreedingPairs;
    const savePairs = animalDeps?._saveWorldBreedingPairs;
    if (typeof loadPairs !== 'function' || typeof savePairs !== 'function') return;
    const pairs = loadPairs() || [];
    const clean = pairs.filter(pair => !(pair?.parentA?.source === 'world' && String(pair.parentA.id) === String(id))
      && !(pair?.parentB?.source === 'world' && String(pair.parentB.id) === String(id)));
    if (clean.length !== pairs.length) savePairs(clean);
  }

  function renameSelected(section) {
    const list = animalDeps?.loadWorldLivestock?.() || [];
    const entry = list.find(item => String(item.id) === String(selectedBabyId));
    if (!entry || !isBaby(entry)) return { ok: false, message: 'That Nursery baby was not found.' };
    if (!hasLivestockPermission()) return { ok: false, message: 'Livestock permission required.' };
    const value = window.prompt?.('Rename baby:', entry.name || speciesLabel(entry.kind));
    const trimmed = String(value || '').trim().slice(0, 30);
    if (!trimmed) return { ok: false, cancelled: true, message: 'Rename cancelled.' };
    entry.name = trimmed;
    animalDeps?.saveWorldLivestock?.(list);
    mostRecentChange = `Renamed Nursery baby ${entry.id} to ${trimmed}.`;
    renderDetails(section, entry);
    const card = findBabyCard(findGridStack(section), entry.id);
    if (card) card.setAttribute('aria-label', `${trimmed}, ${speciesLabel(entry.kind)}`);
    return { ok: true, message: `Renamed to ${trimmed}.` };
  }

  function growSelected() {
    if (!selectedBabyId) return { ok: false, message: 'Select a Nursery baby first.' };
    const result = window.LivestockNursery?.growBaby?.(selectedBabyId) || { ok: false, message: 'Nursery growth is unavailable.' };
    if (result.ok) mostRecentChange = `Grew Nursery baby ${selectedBabyId}.`;
    return result;
  }

  function sellBaby(id) {
    if (!hasLivestockPermission()) return { ok: false, message: 'Livestock permission required.' };
    const deps = currentDeps();
    const inventory = deps?.inventory || animalDeps?.inventory;
    if (!inventory) return { ok: false, message: 'Wallet data is unavailable.' };
    const list = animalDeps?.loadWorldLivestock?.();
    if (!Array.isArray(list)) return { ok: false, message: 'Farm livestock data is unavailable.' };
    const index = list.findIndex(entry => String(entry.id) === String(id));
    const entry = index >= 0 ? list[index] : null;
    if (!entry || !isBaby(entry)) return { ok: false, message: 'That Nursery baby was not found.' };
    const value = babyValueFor(entry);
    list.splice(index, 1);
    cleanupBabyBreedingRefs(entry.id);
    animalDeps?.saveWorldLivestock?.(list);
    inventory.gold = Math.max(0, Number(inventory.gold) || 0) + value.amount;
    deps?.saveMemberWorldData?.();
    if (panelDeps?.spGold) panelDeps.spGold.textContent = `💰 ${inventory.gold}g`;
    window.LivestockNursery?.rerollSwarm?.();
    mostRecentChange = `Sold Nursery baby ${entry.id} (${entry.name || entry.kind}) for ${value.amount}g; adult value ${value.adultAmount}g.`;
    return { ok: true, entry, amount: value.amount, adultAmount: value.adultAmount, message: `Sold ${entry.name || speciesLabel(entry.kind)} for ${value.amount}g.` };
  }

  async function copyDebug() {
    const text = JSON.stringify(debugSnapshot(), null, 2);
    const deps = currentDeps();
    try {
      await navigator.clipboard.writeText(text);
      deps?.showToast?.('Nursery grid debug copied.', true);
    } catch (_) {
      window.prompt?.('Copy Nursery grid debug:', text);
    }
  }

  function handleSectionClick(event, section) {
    const card = event.target?.closest?.('.nursery-grid-card');
    if (card && section.contains(card)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      selectBaby(section, card.dataset.nurseryBabyId, { scroll: true });
      return;
    }
    const action = event.target?.closest?.('[data-nursery-action]');
    if (!action || !section.contains(action)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const actionId = action.dataset.nurseryAction;
    if (actionId === 'debug') { copyDebug(); return; }
    if (!selectedBabyId) return;
    let result = null;
    if (actionId === 'rename') result = renameSelected(section);
    else if (actionId === 'grow') result = growSelected();
    else if (actionId === 'sell') result = sellBaby(selectedBabyId);
    if (!result || result.cancelled) return;
    currentDeps()?.showToast?.(result.message, result.ok !== false);
    if (actionId === 'grow' || actionId === 'sell') {
      window.FarmPanel?.render?.();
      queueDecoration();
    }
  }

  function handleSectionFocus(event, section) {
    const card = event.target?.closest?.('.nursery-grid-card');
    if (!card || !section.contains(card)) return;
    selectBaby(section, card.dataset.nurseryBabyId, { scroll: true });
  }

  function handleSectionKeydown(event, section) {
    const action = event.target?.closest?.('[data-nursery-action="debug"]');
    if (!action || !section.contains(action) || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    copyDebug();
  }

  function decorateNurserySection() {
    if (typeof document === 'undefined') return false;
    installEconomyPatch();
    ensureDocumentStyles();
    const section = document.getElementById('livestockNurserySection');
    if (!section) return false;
    const records = currentBabies();
    if (selectedBabyId && !records.some(entry => String(entry.id) === String(selectedBabyId))) selectedBabyId = null;
    if (!selectedBabyId && records.length) selectedBabyId = records[0].id;
    const stack = findGridStack(section);
    if (!stack) return false;
    const actions = findActionContainer(section);
    const shadow = buildShadow(section);
    setLightDomRoles(section, stack, actions, records);
    updateHeader(section, records);
    renderDetails(section, records.find(entry => String(entry.id) === String(selectedBabyId)) || null);

    if (!section.dataset.nurseryGridEvents) {
      section.dataset.nurseryGridEvents = '1';
      section.addEventListener('click', event => handleSectionClick(event, section), true);
      section.addEventListener('focusin', event => handleSectionFocus(event, section), true);
      section.addEventListener('keydown', event => handleSectionKeydown(event, section), true);
    }
    section.dataset.nurseryGridEnhanced = '1';
    if (shadow && records.length) {
      const selectedCard = findBabyCard(stack, selectedBabyId);
      selectedCard?.setAttribute('data-ctrl-default', '');
    }
    return true;
  }

  function queueDecoration() {
    if (decorateQueued) return;
    decorateQueued = true;
    queueMicrotask(() => {
      decorateQueued = false;
      decorateNurserySection();
    });
  }

  function installLivestockObserver() {
    if (livestockObserver || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return false;
    const attach = () => {
      if (livestockObserver) return true;
      const container = document.getElementById('farmLivestockList');
      if (!container) return false;
      livestockObserver = new MutationObserver(() => queueDecoration());
      livestockObserver.observe(container, { childList: true, subtree: false });
      queueDecoration();
      return true;
    };
    if (attach()) return true;
    document.addEventListener('DOMContentLoaded', attach, { once: true });
    return true;
  }

  function wrapFarmAnimals() {
    const api = window.FarmAnimals;
    if (!api?.init) return false;
    if (api.init.__nurseryGridDepsCapture) return true;
    originalFarmAnimalsInit = api.init;
    const wrapped = function nurseryGridFarmAnimalsInit(injectedDeps, ...args) {
      animalDeps = injectedDeps || null;
      const result = originalFarmAnimalsInit.call(this, injectedDeps, ...args);
      installEconomyPatch();
      queueDecoration();
      return result;
    };
    Object.defineProperty(wrapped, '__nurseryGridDepsCapture', { value: true });
    api.init = wrapped;
    return true;
  }

  function wrapFarmPanel() {
    const api = window.FarmPanel;
    if (!api) return false;
    if (typeof api.init === 'function' && !api.init.__nurseryGridDepsCapture) {
      originalFarmPanelInit = api.init;
      const wrappedInit = function nurseryGridFarmPanelInit(injectedDeps, ...args) {
        panelDeps = injectedDeps || null;
        const result = originalFarmPanelInit.call(this, injectedDeps, ...args);
        queueDecoration();
        return result;
      };
      Object.defineProperty(wrappedInit, '__nurseryGridDepsCapture', { value: true });
      api.init = wrappedInit;
    }
    if (typeof api.render === 'function' && !api.render.__nurseryGridRender) {
      originalFarmPanelRender = api.render;
      const wrappedRender = function nurseryGridFarmPanelRender(...args) {
        const result = originalFarmPanelRender.apply(this, args);
        queueDecoration();
        return result;
      };
      Object.defineProperty(wrappedRender, '__nurseryGridRender', { value: true });
      api.render = wrappedRender;
    }
    return true;
  }

  function debugSnapshot() {
    const records = currentBabies();
    return {
      mostRecentChange,
      installed,
      economy: {
        adultMaturityPremium: ECONOMY.adultMaturityPremium,
        babyAdultFraction: ECONOMY.babyAdultFraction,
        babyRoundTo: ECONOMY.babyRoundTo,
      },
      selectedBabyId,
      babyCount: records.length,
      babies: records.map(entry => {
        const traits = traitInfo(entry);
        const value = babyValueFor(entry);
        return {
          id: entry.id,
          name: entry.name,
          kind: entry.kind,
          size: traits.size,
          badges: traits.badges,
          colors: traits.colors.map(color => ({ label: color.label, name: color.colorName, color: color.color })),
          patterns: traits.patterns.map(pattern => ({ id: pattern.id, label: pattern.label, enabled: pattern.enabled, carrier: pattern.carrier, colorName: pattern.colorName })),
          babySale: value.amount,
          adultSale: value.adultAmount,
        };
      }),
      portraitCacheSize: portraitCache.size,
      lazyPortraitObserverActive: !!portraitObserver,
      sectionEnhanced: typeof document !== 'undefined' && document.getElementById('livestockNurserySection')?.dataset?.nurseryGridEnhanced === '1',
      nursery: window.LivestockNursery?.debugSnapshot?.() || null,
    };
  }

  function install() {
    installEconomyPatch();
    wrapFarmAnimals();
    wrapFarmPanel();
    installLivestockObserver();
    installed = true;
    queueDecoration();
    return true;
  }

  window.LivestockNurseryGrid = {
    ECONOMY,
    install,
    adultValueFor,
    babyValueFor,
    sellBaby,
    decorate: decorateNurserySection,
    debugSnapshot,
  };
  window.__livestockNurseryGridDebug = { snapshot: debugSnapshot, decorate: decorateNurserySection, sellBaby };

  install();
})();