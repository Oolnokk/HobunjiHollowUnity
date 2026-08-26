// Player-facing Compendium — searchable explanations of the game's core systems.
// The affliction and skill sections intentionally read the live registries so
// newly-authored entries appear without duplicating their names/descriptions here.
(() => {
  'use strict';
  if (window.CompendiumUI) return;

  const CATEGORIES = Object.freeze([
    { id: 'all', label: 'All' },
    { id: 'resources', label: 'Resources' },
    { id: 'afflictions', label: 'Afflictions' },
    { id: 'mastery', label: 'Mastery' },
    { id: 'loadouts', label: 'Loadouts' },
    { id: 'skills', label: 'Skills' },
    { id: 'alchemy', label: 'Alchemy' },
  ]); // Used by the Compendium's category filter bar.

  const debug = {
    installed: false,
    renders: 0,
    lastRenderAt: 0,
    activeCategory: 'all',
    query: '',
    visibleEntries: 0,
    totalEntries: 0,
    errors: [],
  }; // Used by the mobile-friendly Compendium diagnostics/API.

  let tab = null; // Used to activate the Compendium from the existing menu tab bar.
  let pane = null; // Used as the menu's Compendium tab panel.
  let content = null; // Used as the scrollable section host rebuilt on every render.
  let searchInput = null; // Used to preserve and apply the player's text filter.
  let categoryBar = null; // Used to keep category button pressed states in sync.
  let activeCategory = 'all'; // Used by render() to filter whole system sections.
  let query = ''; // Used by render() to filter individual Compendium entries.

  const pretty = value => String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());

  function element(tagName, className = '', text = '') {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== '') node.textContent = text;
    return node;
  }

  function noteList(notes = []) {
    const clean = notes.filter(Boolean);
    if (!clean.length) return null;
    const list = element('ul', 'compendium-notes');
    for (const note of clean) list.appendChild(element('li', '', note));
    return list;
  }

  function entryCard(definition) {
    const card = element('article', 'compendium-entry');
    const heading = element('div', 'compendium-entry-head');
    if (definition.icon) heading.appendChild(element('span', 'compendium-entry-icon', definition.icon));
    const copy = element('div', 'compendium-entry-title-wrap');
    copy.appendChild(element('div', 'compendium-entry-title', definition.title));
    if (definition.kicker) copy.appendChild(element('div', 'compendium-entry-kicker', definition.kicker));
    heading.appendChild(copy);
    card.appendChild(heading);
    if (definition.text) card.appendChild(element('p', 'compendium-entry-copy', definition.text));
    const notes = noteList(definition.notes);
    if (notes) card.appendChild(notes);

    const searchable = [
      definition.title,
      definition.kicker,
      definition.text,
      ...(definition.notes || []),
      ...(definition.keywords || []),
    ].filter(Boolean).join(' ').toLowerCase();
    card.dataset.compendiumSearch = searchable;
    return card;
  }

  function section(definition) {
    const wrap = element('section', 'compendium-section');
    wrap.dataset.compendiumCategory = definition.id;
    const header = element('div', 'compendium-section-header');
    const titleRow = element('div', 'compendium-section-title-row');
    if (definition.icon) titleRow.appendChild(element('span', 'compendium-section-icon', definition.icon));
    titleRow.appendChild(element('h2', 'compendium-section-title', definition.title));
    header.appendChild(titleRow);
    if (definition.intro) header.appendChild(element('p', 'compendium-section-intro', definition.intro));
    wrap.appendChild(header);

    const grid = element('div', 'compendium-grid');
    for (const entry of definition.entries) grid.appendChild(entryCard(entry));
    wrap.appendChild(grid);
    return wrap;
  }

  function resourceSection() {
    return section({
      id: 'resources',
      icon: '◉',
      title: 'Resources',
      intro: 'The three ground rings are not interchangeable: Health keeps you alive, Stamina pays for effort, and Footing keeps you upright. Exhaustion is what happens when you force actions past normal Stamina.',
      entries: [
        {
          title: 'Health', icon: '♥', kicker: 'Survival',
          text: 'Damage removes Health. Some afflictions deal Health damage directly or temporarily reduce how much Health you can hold.',
          notes: ['Health can recover while you are out of active danger.', 'At 0 Health, the character is defeated.'],
          keywords: ['red ring hp life'],
        },
        {
          title: 'Stamina', icon: '◆', kicker: 'Effort',
          text: 'Attacks and other strenuous actions spend Stamina. It normally refills when you have room to recover.',
          notes: ['Winded Stamina lowers your effective Stamina maximum.', 'Several Stamina afflictions turn spending afflicted portions into other penalties.'],
          keywords: ['yellow ring energy attacks dodge'],
        },
        {
          title: 'Footing', icon: '⬡', kicker: 'Balance',
          text: 'Footing measures how stable you are against stagger, knockback, and knockdown instead of how tired or injured you are.',
          notes: ['Taking Footing damage can stagger you.', 'Reaching 0 Footing puts you prone; Footing begins recovering after the knockdown delay.'],
          keywords: ['balance stagger prone knockdown poise'],
        },
        {
          title: 'Exhaustion / Black Stamina', icon: '◐', kicker: 'Overexertion',
          text: 'If an action costs more Stamina than you have, the action is still allowed, but you enter Exhausted instead of getting a free pass.',
          notes: ['While Exhausted, further Stamina costs drain Black Stamina.', 'As Black Stamina empties, attacks can slow dramatically.', 'When Black Stamina recovers to full, Exhaustion clears and normal Stamina returns.'],
          keywords: ['black stamina debt exhausted overspend slow'],
        },
      ],
    });
  }

  function afflictionSection() {
    const registry = window.ResourceSystem?.AFFLICTIONS || {};
    const entries = Object.entries(registry)
      .sort(([, a], [, b]) => String(a?.name || '').localeCompare(String(b?.name || '')))
      .map(([id, definition]) => {
        const resource = pretty(definition?.resource || 'status');
        const family = definition?.family ? `${pretty(definition.family)} family` : '';
        const tags = Array.isArray(definition?.tags) && definition.tags.length
          ? `Tags: ${definition.tags.map(pretty).join(', ')}.` : '';
        const recovery = definition?.recovers === true
          ? 'Uses the standard passive affliction-recovery rule.'
          : definition?.recovers === false
            ? 'Not cleared by the standard passive affliction-recovery rule.'
            : '';
        return {
          title: definition?.name || pretty(id),
          icon: definition?.resource === 'stamina' ? '◆' : '♥',
          kicker: [resource, family].filter(Boolean).join(' · '),
          text: definition?.desc || 'A status effect tracked by the resource system.',
          notes: [recovery, tags],
          keywords: [id, definition?.resource, definition?.family, ...(definition?.tags || [])],
        };
      });

    if (!entries.length) {
      entries.push({
        title: 'Affliction registry unavailable', icon: '!', kicker: 'Diagnostics',
        text: 'The Compendium could not read ResourceSystem.AFFLICTIONS yet. Close and reopen this tab after the game finishes loading.',
      });
    }

    return section({
      id: 'afflictions',
      icon: '☣',
      title: 'Afflictions',
      intro: 'Afflictions are buildup attached to Health or Stamina. Their exact behavior comes from the live combat resource registry below, so this list follows the game as new central afflictions are added.',
      entries,
    });
  }

  function masterySection() {
    return section({
      id: 'mastery',
      icon: '★',
      title: 'Tool & Weapon Mastery',
      intro: 'Mastery is experience with a specific equipped tool or weapon. It has five ranks and is separate from broad character Skills such as Combat or Farming.',
      entries: [
        {
          title: 'What Mastery Does', icon: '★', kicker: '0–5 ranks',
          text: 'Mastery is attached to the individual tool/weapon entry you use. Higher ranks open that item’s deeper combat technique upgrades; ranged weapons also open their ammo-loadout ranks.',
          notes: ['Mastery is not the same thing as your Combat Skill level.', 'A different weapon has its own Mastery progress and build.'],
          keywords: ['rank levels weapon tool individual'],
        },
        {
          title: 'Combat Mastery', icon: '⚔', kicker: 'Earned on kills',
          text: 'Combat use only awards Mastery when you actually kill an enemy with the equipped weapon. The gain scales with enemy difficulty.',
          notes: ['Pure combat weapons receive double the normal combat Mastery gain.', 'Ranged weapons count as pure combat weapons and receive that doubled gain.'],
          keywords: ['kill enemy difficulty ranged sword double xp'],
        },
        {
          title: 'Hoe Mastery', icon: '🌾', kicker: 'Earned on harvest',
          text: 'A hoe gains Mastery when you successfully harvest a crop while that hoe is equipped.',
          notes: ['The gain scales with the value of the harvested yield.', 'Crop quality and quantity can therefore make a harvest worth more Mastery.'],
          keywords: ['farming crop harvest quality worth'],
        },
        {
          title: 'Shovel Mastery', icon: '⛏', kicker: 'Earned on treasure',
          text: 'A shovel gains Mastery when it exposes buried treasure, not for ordinary digging.',
          notes: ['The gain scales with the treasure’s value.', 'Its value-based rate is half the hoe’s crop-harvest rate.'],
          keywords: ['dig digging buried treasure chest worth half'],
        },
        {
          title: 'Motes of Prowess', icon: '◆', kicker: 'Technique currency',
          text: 'Mastery opens technique levels; Motes of Prowess pay for the choice you make at those levels.',
          notes: ['Technique level N costs N Motes to choose or change.', 'Mastery and Motes are two different gates: rank opens the level, Motes buy the option.'],
          keywords: ['mote prowess currency upgrade choose change'],
        },
      ],
    });
  }

  function loadoutSection() {
    return section({
      id: 'loadouts',
      icon: '⚔',
      title: 'Combat Loadouts',
      intro: 'Your two weapon-action inputs each have a tap and a hold behavior. The Loadout tab decides which compatible techniques occupy the selectable slots for the weapon you are currently using.',
      entries: [
        {
          title: 'Four Input Slots', icon: '①', kicker: 'Tap 1 · Tap 2 · Hold 1 · Hold 2',
          text: 'A quick press and a held press are separate actions. That turns the two weapon-action inputs into four combat slots.',
          notes: ['Tap 1 is your weapon’s Combo.', 'Tap 2 is a selectable Quick Attack.', 'Hold 1 accepts Offensive Holds.', 'Hold 2 accepts Defensive or Offensive Holds.'],
          keywords: ['left click right click action 1 action 2 tap hold'],
        },
        {
          title: 'Combo Slot', icon: '↯', kicker: 'Automatically weapon-matched',
          text: 'Tap 1 is not manually replaced. It always follows the combo style of the weapon you have equipped, so swapping weapon types can change the combo immediately.',
          keywords: ['tap1 swing combo poke automatic read only'],
        },
        {
          title: 'Per-Weapon Choices', icon: '🗡', kicker: 'Remembered separately',
          text: 'Quick Attack and Held choices are stored per weapon. Switching weapons switches to that weapon’s saved loadout, and switching back restores its previous choices.',
          keywords: ['saved remember swap weapons quick attack defensive offensive'],
        },
        {
          title: 'Technique Upgrade Trees', icon: '🌿', kicker: 'Five levels per ability',
          text: 'Each combat ability has a five-level upgrade tree. Each level offers a choice of effects rather than automatically granting everything on that row.',
          notes: ['A level needs the weapon’s matching Mastery rank.', 'Levels are taken in order; you cannot skip past an earlier unchosen level.', 'Sharp and blunt weapons can offer different upgrade effects for the same technique.'],
          keywords: ['ability progression tree sharp blunt affliction upgrade mastery'],
        },
        {
          title: 'Ranged Loadouts', icon: '🏹', kicker: 'Ammo ranks',
          text: 'Ranged weapon Mastery uses the same five-rank idea but builds an ammo loadout: odd ranks choose Basic Ammo effects, while even ranks choose Special Ammo slots.',
          notes: ['Basic Ammo effects are free once chosen and repeated effects can stack.', 'Special Ammo uses the ranged weapon’s shared Special Ammo charges when fired.'],
          keywords: ['crossbow scatterbow basic special ammo rank charges'],
        },
      ],
    });
  }

  function skillSection() {
    const registry = window.SkillSystem?.SKILLS || {};
    const entries = Object.entries(registry).map(([id, definition]) => ({
      title: definition?.label || pretty(id),
      icon: definition?.icon || '•',
      kicker: `Character Skill · level 0–${window.SkillSystem?.MAX_LEVEL || 20}`,
      text: definition?.effect || 'A persistent character skill improved through related play.',
      notes: ['Skills are broad character progression. They are separate from the five-rank Mastery attached to individual tools and weapons.'],
      keywords: [id, 'skill xp experience level'],
    }));

    if (!entries.length) {
      entries.push({
        title: 'Skill registry unavailable', icon: '!', kicker: 'Diagnostics',
        text: 'The Compendium could not read SkillSystem.SKILLS yet. Close and reopen this tab after the game finishes loading.',
      });
    }

    return section({
      id: 'skills',
      icon: '✦',
      title: 'Character Skills',
      intro: 'Skills are long-term character progression up to level 20. They improve broad activities; temporary food bonuses can raise their effective level without changing the saved base level.',
      entries,
    });
  }

  function alchemySection() {
    return section({
      id: 'alchemy',
      icon: '⚗',
      title: 'Alchemy',
      intro: 'Alchemy is a trait-combination system. Reagents tell you their traits; the puzzle is learning which combinations of those traits produce useful authored reactions.',
      entries: [
        {
          title: 'The Three Traits', icon: '△', kicker: 'Humour · Drive · Magnetism',
          text: 'Every reagent carries one Humour, one Drive, and one Elemental Magnetism. A valid reaction is one authored combination containing one trait from each category.',
          notes: ['Humour: Breath, Bones, Flesh, Blood, Bile, or Senses.', 'Drive: Restore, Afflict, Greaten, or Lighten.', 'Magnetism: Water, Fire, Earth, or Wind.'],
          keywords: ['trait reagent humour drive magnetism water fire earth wind'],
        },
        {
          title: 'Mixing Reagents', icon: '⚗', kicker: 'Two or three ingredients',
          text: 'A brew uses two or three reagents, and every selected ingredient has to contribute at least one of the three required trait categories.',
          notes: ['With two reagents, one supplies two categories and the other supplies the third.', 'With three reagents, each ingredient supplies exactly one category.', 'Selections with no possible authored reaction are incompatible rather than wasting the ingredients.'],
          keywords: ['brew compatible invalid ingredients table'],
        },
        {
          title: 'Discovery & Targeting', icon: '?', kicker: 'Learn reactions by use',
          text: 'Brewing reveals the reaction you made; consuming a raw reagent reveals that reagent’s native reaction. Once a recipe is discovered, you can target it instead of leaving the result fully random.',
          notes: ['Alchemy Skill raises the chance that a targeted brew becomes the intended valid reaction.', 'If targeting fails, the brew becomes another valid reaction from the same ingredient set.', 'If only one reaction is possible, targeting is effectively certain.'],
          keywords: ['recipe discovered target probability skill random'],
        },
        {
          title: 'What Drives Mean', icon: '↕', kicker: 'The predictable part',
          text: 'Drive tells you the broad job of a reaction before you know the exact recipe.',
          notes: ['Restore heals, restores resources, or cleanses.', 'Afflict usually creates throwable offensive flasks, with a few drinkable narcotic exceptions.', 'Greaten strengthens a stat or capability.', 'Lighten reduces a burden or makes movement/effort easier.'],
          keywords: ['restore afflict greaten lighten flask buff cure'],
        },
        {
          title: 'Elemental Character', icon: '◇', kicker: 'How the effect tends to feel',
          text: 'Elemental Magnetism helps shape a reaction’s tempo and character rather than simply meaning “elemental damage.”',
          notes: ['Water tends toward recovery and long duration.', 'Earth tends toward resilience, stability, and weight.', 'Wind tends toward speed, lightness, and efficiency.', 'Fire tends toward stronger, shorter bursts.'],
          keywords: ['duration recovery resilience speed short long'],
        },
      ],
    });
  }

  function buildSections() {
    return [resourceSection(), afflictionSection(), masterySection(), loadoutSection(), skillSection(), alchemySection()];
  }

  function applyFilters() {
    if (!content) return;
    const needle = query.trim().toLowerCase();
    let visibleEntries = 0;
    let totalEntries = 0;

    content.querySelectorAll('.compendium-section').forEach(sectionNode => {
      const categoryMatches = activeCategory === 'all' || sectionNode.dataset.compendiumCategory === activeCategory;
      let visibleInSection = 0;
      sectionNode.querySelectorAll('.compendium-entry').forEach(card => {
        totalEntries++;
        const searchMatches = !needle || card.dataset.compendiumSearch.includes(needle);
        const visible = categoryMatches && searchMatches;
        card.hidden = !visible;
        if (visible) visibleInSection++;
      });
      sectionNode.hidden = !categoryMatches || visibleInSection === 0;
      visibleEntries += visibleInSection;
    });

    const empty = content.querySelector('.compendium-empty');
    if (empty) empty.remove();
    if (!visibleEntries) {
      content.appendChild(element('div', 'compendium-empty', 'No Compendium entries match that search.'));
    }

    debug.activeCategory = activeCategory;
    debug.query = query;
    debug.visibleEntries = visibleEntries;
    debug.totalEntries = totalEntries;
    updateCategoryButtons();
  }

  function updateCategoryButtons() {
    if (!categoryBar) return;
    categoryBar.querySelectorAll('[data-compendium-category]').forEach(button => {
      const selected = button.dataset.compendiumCategory === activeCategory;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function isDevMode() {
    try { return !!window.Combat?.deps?.isDevMode?.(); } catch (_) { return false; }
  }

  function formatDebug() {
    return [
      `Compendium installed: ${debug.installed}`,
      `renders: ${debug.renders}`,
      `filter: ${debug.activeCategory} / ${debug.query || '(none)'}`,
      `visible entries: ${debug.visibleEntries}/${debug.totalEntries}`,
      `ResourceSystem: ${window.ResourceSystem?.AFFLICTIONS ? 'ready' : 'missing'}`,
      `SkillSystem: ${window.SkillSystem?.SKILLS ? 'ready' : 'missing'}`,
      `errors: ${debug.errors.length ? debug.errors.join(' | ') : 'none'}`,
    ].join('\n');
  }

  function render() {
    if (!content) return;
    try {
      content.innerHTML = '';
      for (const sectionNode of buildSections()) content.appendChild(sectionNode);
      if (isDevMode()) {
        const diagnostics = element('details', 'compendium-diagnostics');
        diagnostics.appendChild(element('summary', '', 'Compendium diagnostics'));
        diagnostics.appendChild(element('pre', '', formatDebug()));
        content.appendChild(diagnostics);
      }
      debug.renders++;
      debug.lastRenderAt = Date.now();
      applyFilters();
    } catch (error) {
      const message = error?.stack || error?.message || String(error);
      debug.errors.push(message);
      console.error('[compendium] render failed', error);
      content.innerHTML = '';
      content.appendChild(element('div', 'compendium-empty', 'The Compendium could not render. Open Debug and copy CompendiumUI.formatDebug() if the problem persists.'));
    }
  }

  function activate() {
    if (!tab || !pane) return;
    document.querySelectorAll('#menuPanel .mp-tab').forEach(button => {
      const selected = button === tab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    document.querySelectorAll('#menuPanel .mp-pane').forEach(panel => panel.classList.toggle('active', panel === pane));
    render();
    requestAnimationFrame(() => searchInput?.focus?.({ preventScroll: true }));
  }

  function injectStyles() {
    if (document.getElementById('compendiumStyles')) return;
    const style = document.createElement('style');
    style.id = 'compendiumStyles';
    style.textContent = `
      #mpCompendium { padding: 0; overflow: hidden; }
      .compendium-pane { height: 100%; min-height: 0; display: grid; grid-template-rows: auto auto 1fr; background: rgba(8,18,13,0.24); }
      .compendium-top { display: flex; gap: 14px; align-items: end; justify-content: space-between; padding: 14px 18px 10px; border-bottom: 1px solid var(--border); }
      .compendium-heading { min-width: 0; }
      .compendium-title { color: var(--accent); font-size: clamp(17px, 2.4vw, 24px); line-height: 1.05; }
      .compendium-subtitle { margin-top: 4px; max-width: 720px; color: var(--muted); font-size: 11px; line-height: 1.45; }
      .compendium-search { width: min(360px, 38vw); min-width: 190px; padding: 8px 10px; border-radius: 9px; border: 1px solid var(--border-bright); outline: none; background: rgba(0,0,0,0.22); color: var(--text); font: inherit; font-size: 11px; }
      .compendium-search:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-dim); }
      .compendium-categories { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 18px; border-bottom: 1px solid var(--border); }
      .compendium-category { padding: 5px 9px; border: 1px solid var(--border); border-radius: 999px; background: rgba(255,255,255,0.04); color: var(--muted); font-size: 10px; }
      .compendium-category:hover, .compendium-category.active { color: var(--accent); border-color: rgba(249,226,138,0.55); background: var(--accent-dim); }
      .compendium-content { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 14px 18px 24px; -webkit-overflow-scrolling: touch; }
      .compendium-section { max-width: 1180px; margin: 0 auto 20px; }
      .compendium-section[hidden], .compendium-entry[hidden] { display: none !important; }
      .compendium-section-header { margin-bottom: 8px; }
      .compendium-section-title-row { display: flex; align-items: center; gap: 7px; }
      .compendium-section-icon { color: var(--accent); font-size: 16px; }
      .compendium-section-title { color: var(--accent); font-size: 15px; font-weight: 700; }
      .compendium-section-intro { margin-top: 4px; max-width: 900px; color: var(--muted); font-size: 10px; line-height: 1.5; }
      .compendium-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 8px; align-items: stretch; }
      .compendium-entry { min-width: 0; padding: 10px 11px; border: 1px solid var(--border); border-radius: 10px; background: rgba(255,255,255,0.035); }
      .compendium-entry-head { display: flex; align-items: flex-start; gap: 7px; }
      .compendium-entry-icon { flex: 0 0 auto; min-width: 18px; color: var(--accent); font-size: 14px; text-align: center; }
      .compendium-entry-title-wrap { min-width: 0; }
      .compendium-entry-title { color: var(--text); font-size: 11px; font-weight: 700; line-height: 1.3; }
      .compendium-entry-kicker { margin-top: 1px; color: var(--muted); font-size: 8px; line-height: 1.3; text-transform: uppercase; letter-spacing: 0.06em; }
      .compendium-entry-copy { margin-top: 7px; color: var(--text); font-size: 9px; line-height: 1.5; opacity: 0.94; }
      .compendium-notes { margin: 7px 0 0 17px; color: var(--muted); font-size: 8.5px; line-height: 1.45; }
      .compendium-notes li + li { margin-top: 3px; }
      .compendium-empty { max-width: 620px; margin: 30px auto; padding: 18px; border: 1px dashed var(--border-bright); border-radius: 10px; color: var(--muted); text-align: center; font-size: 10px; }
      .compendium-diagnostics { max-width: 1180px; margin: 16px auto 0; padding: 8px 10px; border: 1px dashed var(--border); border-radius: 8px; color: var(--muted); font-size: 9px; }
      .compendium-diagnostics pre { margin-top: 7px; white-space: pre-wrap; overflow-wrap: anywhere; }
      @media (max-width: 720px) {
        .compendium-top { align-items: stretch; flex-direction: column; gap: 8px; padding: 10px 12px 8px; }
        .compendium-search { width: 100%; min-width: 0; }
        .compendium-categories { flex-wrap: nowrap; overflow-x: auto; padding: 7px 12px; scrollbar-width: thin; }
        .compendium-category { flex: 0 0 auto; }
        .compendium-content { padding: 10px 12px 18px; }
        .compendium-grid { grid-template-columns: 1fr; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function install() {
    if (debug.installed) return true;
    const tabs = document.querySelector('#menuPanel .mp-tabs');
    const body = document.querySelector('#menuPanel .mp-body');
    if (!tabs || !body) {
      debug.errors.push('menuPanel tabs/body not found');
      return false;
    }

    injectStyles();

    tab = document.getElementById('mpCompendiumTab') || element('button', 'mp-tab', '📖 Compendium');
    tab.id = 'mpCompendiumTab';
    tab.type = 'button';
    tab.dataset.mpanel = 'compendium';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'mpCompendium');
    tab.setAttribute('aria-selected', 'false');
    const settingsTab = tabs.querySelector('.mp-tab[data-mpanel="settings"]');
    if (!tab.isConnected) tabs.insertBefore(tab, settingsTab || null);

    pane = document.getElementById('mpCompendium') || element('div', 'mp-pane');
    pane.id = 'mpCompendium';
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', tab.id);
    if (!pane.isConnected) body.appendChild(pane);
    pane.innerHTML = '';

    const shell = element('div', 'compendium-pane');
    const top = element('div', 'compendium-top');
    const heading = element('div', 'compendium-heading');
    heading.appendChild(element('div', 'compendium-title', 'Compendium'));
    heading.appendChild(element('div', 'compendium-subtitle', 'Player guide to the systems that matter moment-to-moment. Search by a mechanic, status, resource, or progression term.'));
    top.appendChild(heading);
    searchInput = element('input', 'compendium-search');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search the Compendium…';
    searchInput.setAttribute('aria-label', 'Search the Compendium');
    searchInput.value = query;
    searchInput.addEventListener('input', () => { query = searchInput.value; applyFilters(); });
    top.appendChild(searchInput);
    shell.appendChild(top);

    categoryBar = element('div', 'compendium-categories');
    categoryBar.setAttribute('aria-label', 'Compendium categories');
    for (const category of CATEGORIES) {
      const button = element('button', 'compendium-category', category.label);
      button.type = 'button';
      button.dataset.compendiumCategory = category.id;
      button.setAttribute('aria-pressed', String(category.id === activeCategory));
      button.addEventListener('click', () => { activeCategory = category.id; applyFilters(); });
      categoryBar.appendChild(button);
    }
    shell.appendChild(categoryBar);

    content = element('div', 'compendium-content');
    shell.appendChild(content);
    pane.appendChild(shell);

    tab.addEventListener('click', event => {
      // Existing menu tab listeners were bound before this runtime-injected tab
      // existed. Own this one click completely, while leaving every old tab's
      // handler untouched.
      event.stopPropagation();
      activate();
    });
    document.addEventListener('click', event => {
      const clickedTab = event.target?.closest?.('#menuPanel .mp-tab');
      if (!clickedTab || clickedTab === tab) return;
      tab.classList.remove('active');
      tab.setAttribute('aria-selected', 'false');
      pane.classList.remove('active');
    });

    debug.installed = true;
    render();
    return true;
  }

  window.CompendiumUI = {
    install,
    render,
    open: activate,
    getDebug: () => ({ ...debug, errors: [...debug.errors] }),
    formatDebug,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
