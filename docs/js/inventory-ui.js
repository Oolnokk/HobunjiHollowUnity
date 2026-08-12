(() => {
  'use strict';

  let deps = null; // Injected UI-only adapters; used by the mobile-friendly debug toggle.
  let inventoryObserver = null; // Watches inventory rebuilds so presentation survives existing render functions.
  let decorateQueued = false; // Coalesces mutation bursts into one presentation pass.

  const STYLE_ID = 'inventoryUiPolishStyles'; // Prevents duplicate injected styles across repeated init calls.
  const DEBUG_BUTTON_ID = 'inventoryUiDebugButton'; // Stable id for the in-menu layout-debug control.
  const TOOL_SLOT_NAMES = ['hoe', 'shovel', 'axe', 'pick', 'harpoon', 'weapon'];

  function init(injectedDeps = {}) {
    deps = injectedDeps;
    installStyles();
    installObserver();
    decorate();
    ensureDebugButton();
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Owns presentation only; inventory state/actions stay in existing systems.
    style.id = STYLE_ID;
    style.textContent = `
      #mpInventory { --inv-ui-accent:rgba(249,226,138,.92); }
      #mpInventory .inv-wallet { border:1px solid rgba(240,208,64,.26); border-radius:999px; background:rgba(240,208,64,.07); font-weight:700; text-shadow:0 1px 2px #0008; }

      #mpInventory .inv-sub-tabs { gap:2px; padding:2px; border:1px solid #ffffff1c; border-radius:calc(.95 * var(--inv-row)); background:#0003; overflow:visible; }
      #mpInventory .inv-sub-tab { flex:1 1 0; min-width:0; height:calc(1.75 * var(--inv-row)); padding:0 4px; border:1px solid transparent; border-radius:calc(.78 * var(--inv-row)); display:flex; flex-direction:column; align-items:center; justify-content:center; line-height:1.03; transition:transform 80ms ease,background 100ms ease,border-color 100ms ease,color 100ms ease,box-shadow 100ms ease; }
      #mpInventory .inv-sub-tab::after { display:block; margin-top:1px; font-size:max(6px,calc(.66 * var(--inv-font-xs))); letter-spacing:.12em; opacity:.62; }
      #mpInventory #invTabPack::after { content:'WORLD'; }
      #mpInventory #invTabGear::after { content:'CHARACTER'; }
      #mpInventory .inv-sub-tab:hover { background:#ffffff12; }
      #mpInventory .inv-sub-tab:active { transform:translateY(1px) scale(.975); }
      #mpInventory .inv-sub-tab.active { color:#1a211b; border-color:var(--inv-ui-accent); background:linear-gradient(#ffefa4fa,#e7cb63f0); box-shadow:0 2px 8px #0004,inset 0 1px #fff8; }

      #mpInventory .inv-cats { overflow-x:auto; overflow-y:hidden; scrollbar-width:none; justify-content:flex-start; -webkit-overflow-scrolling:touch; }
      #mpInventory .inv-cats::-webkit-scrollbar { display:none; }
      #mpInventory .inv-cat { flex:0 0 auto; border-color:#ffffff24; background:#ffffff09; transition:transform 80ms ease,background 100ms ease,border-color 100ms ease,color 100ms ease; }
      #mpInventory .inv-cat:hover { color:var(--text); background:#ffffff13; }
      #mpInventory .inv-cat:active { transform:translateY(1px) scale(.97); }
      #mpInventory .inv-cat.active { color:#192019; border-color:var(--inv-ui-accent); background:rgba(249,226,138,.86); font-weight:700; box-shadow:0 1px 5px #0004; }

      /* Pack clothing now participates in the normal grid. The old dedicated clothing strip stays as a hidden data/event source. */
      #mpInventory .inv-pack-clothing { display:none !important; }
      #mpInventory.inv-mode-pack .inv-grid-area--short { height:calc(14 * var(--inv-row)); }
      #mpInventory .inv-grid-area { border:1px solid #ffffff12; border-radius:var(--inv-radius); background:#0000001a; }
      #mpInventory .inv-item-box { border-color:#ffffff24; background:linear-gradient(#ffffff11,#ffffff08); box-shadow:inset 0 1px #ffffff09,0 1px 3px #0003; transition:transform 80ms ease,background 100ms ease,border-color 100ms ease,box-shadow 100ms ease; }
      #mpInventory .inv-item-box:not(.empty):hover { transform:translateY(-1px); border-color:#ffffff4d; background:linear-gradient(#ffffff1c,#ffffff0e); box-shadow:inset 0 1px #ffffff0f,0 3px 8px #0004; }
      #mpInventory .inv-item-box:not(.empty):active { transform:translateY(1px) scale(.965); }
      #mpInventory .inv-item-box.selected { transform:translateY(-1px); border-color:var(--inv-ui-accent); background:linear-gradient(#f9e28a33,#f9e28a17); box-shadow:0 0 0 1px #f9e28a33,0 0 12px #f9e28a1f,inset 0 1px #ffffff14; }
      #mpInventory .inv-item-box.empty { opacity:.62; }
      #mpInventory .inventory-clothing-reserved-empty { display:none !important; }
      #mpInventory .pack-clothing-tile { padding:0; }
      #mpInventory .pack-clothing-tile .ipc-sprite { width:68%; height:68%; object-fit:contain; image-rendering:pixelated; }
      #mpInventory .pack-clothing-tile .ipc-name { display:none; }
      #mpInventory .pack-clothing-tile::after { content:'CLOTHING'; position:absolute; left:3px; bottom:3px; max-width:calc(100% - 6px); overflow:hidden; text-overflow:ellipsis; font-size:max(5px,calc(.56 * var(--inv-font-xs))); letter-spacing:.08em; color:#dce9dd94; pointer-events:none; }
      #mpInventory .iib-count { bottom:3px; right:3px; min-width:16px; min-height:14px; padding:2px 4px 1px; border:1px solid #ffffff29; border-radius:999px; display:inline-flex; align-items:center; justify-content:center; color:#fff; background:#030906d4; font-weight:800; line-height:1; text-shadow:0 1px 2px #000; }
      #mpInventory .iib-count.zero { color:var(--danger); opacity:.72; }
      #mpInventory .iib-equip-badge { top:3px; left:3px; border:1px solid #f9e28a85; border-radius:999px; padding:1px 3px; background:#f9e28af0; font-weight:800; }

      /* Tags were never the useful information here; item descriptions own this space now. */
      #mpInventory #iiTags { display:none !important; }
      #mpInventory .inv-info { border-left-color:#ffffff29; background:linear-gradient(#ffffff06,#0000001a); }
      #mpInventory .ii-empty { opacity:.72; line-height:1.5; }
      #mpInventory .ii-icon-wrap { border:1px solid #ffffff1a; background:radial-gradient(circle at 50% 42%,#f9e28a1a,#ffffff06 58%,#0000000d); box-shadow:inset 0 1px #ffffff09; }
      #mpInventory .ii-name { color:var(--text); font-weight:800; line-height:1.25; }
      #mpInventory .ii-price { color:var(--accent); opacity:.88; }
      #mpInventory .ii-desc { order:4; min-height:calc(4.2 * var(--inv-row)); padding:calc(.45 * var(--inv-row)) calc(.45 * var(--inv-row)); border:1px solid #ffffff14; border-radius:var(--inv-radius); background:#0000001f; line-height:1.48; overflow-y:auto; }
      #mpInventory .ii-desc::before { content:'DESCRIPTION'; display:block; margin-bottom:4px; color:#f9e28ab8; font-size:max(6px,calc(.68 * var(--inv-font-xs))); font-weight:800; letter-spacing:.11em; }
      #mpInventory .ii-actions { order:5; }
      #mpInventory .ii-btn { min-height:28px; border-color:#ffffff2b; background:#ffffff0b; transition:transform 80ms ease,background 100ms ease,border-color 100ms ease; }
      #mpInventory .ii-btn:hover { background:#ffffff17; border-color:#ffffff4d; }
      #mpInventory .ii-btn:active { transform:translateY(1px) scale(.985); }
      #mpInventory .ii-btn.equip { background:#50c87814; border-color:#5ede878c; }

      /* Gear: current loadout is deliberately a different shape than the owned collection beneath it. */
      #mpInventory .inv-equip-section { display:block; padding:calc(.6 * var(--inv-gap)) var(--inv-pad); border-radius:var(--inv-radius); background:#00000013; overflow-y:auto; }
      #mpInventory .gear-loadout-grid { display:grid; grid-template-columns:minmax(54px,.62fr) minmax(112px,1.38fr) minmax(54px,.62fr) minmax(112px,1.38fr); gap:calc(1.2 * var(--inv-gap)); min-height:calc(12.2 * var(--inv-row)); padding-bottom:calc(1.4 * var(--inv-gap)); border-bottom:1px solid #ffffff1a; }
      #mpInventory .gear-loadout-column { min-width:0; display:flex; flex-direction:column; gap:var(--inv-gap); }
      #mpInventory .gear-loadout-heading { min-height:calc(1.45 * var(--inv-row)); display:flex; align-items:center; color:#f9e28ae6; font-size:max(6px,calc(.76 * var(--inv-font-xs))); font-weight:800; letter-spacing:.10em; text-transform:uppercase; }
      #mpInventory .gear-slot-column .inv-equip-label { display:none; }
      #mpInventory .gear-slot-column .inv-equip-row { flex:0 0 auto; min-height:0; display:flex; flex-direction:column; gap:var(--inv-gap); }
      #mpInventory .gear-slot-column .inv-equip-slot { flex:0 0 calc(1.62 * var(--inv-row)); min-height:calc(1.62 * var(--inv-row)); width:100%; flex-direction:row; justify-content:flex-start; gap:3px; padding:2px 3px; overflow:hidden; }
      #mpInventory .gear-slot-column .ies-sprite,#mpInventory .gear-slot-column .ies-cloth-sprite { width:calc(1.15 * var(--inv-row)); height:calc(1.15 * var(--inv-row)); flex:0 0 auto; }
      #mpInventory .gear-slot-column .ies-label { flex:1; min-width:0; font-size:max(5px,calc(.67 * var(--inv-font-xs))); text-align:left; overflow:hidden; text-overflow:ellipsis; }
      #mpInventory .gear-slot-column .ies-cloth-name { display:none; }
      #mpInventory .gear-slot-column .ies-unequip { width:15px; height:15px; top:1px; right:1px; }

      #mpInventory .gear-stats-panel { min-width:0; padding:calc(.5 * var(--inv-gap)); border:1px solid #ffffff17; border-radius:var(--inv-radius); background:#0000001c; overflow:hidden; }
      #mpInventory .gear-stat-list { display:flex; flex-direction:column; gap:calc(.72 * var(--inv-gap)); overflow-y:auto; min-height:0; }
      #mpInventory .gear-stat-item { padding:4px 5px; border:1px solid #ffffff13; border-radius:calc(.75 * var(--inv-radius)); background:#ffffff07; }
      #mpInventory .gear-stat-item-head { display:flex; align-items:baseline; gap:4px; min-width:0; }
      #mpInventory .gear-stat-slot { flex:0 0 auto; color:#f9e28aa8; font-size:max(5px,calc(.62 * var(--inv-font-xs))); font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
      #mpInventory .gear-stat-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text); font-size:var(--inv-font-xs); font-weight:700; }
      #mpInventory .gear-stat-chips { display:flex; flex-wrap:wrap; gap:3px; margin-top:3px; }
      #mpInventory .gear-stat-chip { padding:1px 4px; border:1px solid #ffffff18; border-radius:999px; background:#0003; color:#c9dccb; font-size:max(5px,calc(.61 * var(--inv-font-xs))); line-height:1.25; white-space:nowrap; }
      #mpInventory .gear-stat-chip.emphasis { border-color:#f9e28a4f; color:#f7e9a7; }
      #mpInventory .gear-stats-empty { color:var(--muted); font-size:var(--inv-font-xs); line-height:1.45; opacity:.75; }
      #mpInventory .outfit-stats-placeholder { display:flex; flex:1; min-height:0; align-items:center; justify-content:center; padding:8px; border:1px dashed #ffffff20; border-radius:var(--inv-radius); color:#a9bbaa; background:#ffffff05; text-align:center; font-size:var(--inv-font-xs); line-height:1.5; }

      #mpInventory .gear-owned-section { padding-top:calc(1.2 * var(--inv-gap)); }
      #mpInventory .gear-owned-group + .gear-owned-group { margin-top:calc(1.25 * var(--inv-gap)); }
      #mpInventory .gear-owned-section .inv-equip-label { margin-bottom:calc(.65 * var(--inv-gap)); color:#f9e28ae6; font-weight:800; letter-spacing:.10em; }
      #mpInventory .gear-owned-section .inv-equip-row { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:var(--inv-gap); min-height:0; }
      #mpInventory .gear-owned-section .inv-equip-slot { min-height:calc(3.1 * var(--inv-row)); }
      #mpInventory .gear-owned-section .inv-equip-empty { padding:6px; border:1px dashed #ffffff18; border-radius:var(--inv-radius); color:var(--muted); font-size:var(--inv-font-xs); }

      #mpInventory .inv-equip-slot { border-color:#ffffff24; background:linear-gradient(#ffffff10,#ffffff07); box-shadow:inset 0 1px #ffffff09,0 1px 3px #0003; transition:transform 80ms ease,background 100ms ease,border-color 100ms ease,box-shadow 100ms ease,opacity 100ms ease; }
      #mpInventory .inv-equip-slot[role='button']:hover { transform:translateY(-1px); border-color:#ffffff4f; background:linear-gradient(#ffffff1b,#ffffff0c); }
      #mpInventory .inv-equip-slot[role='button']:active { transform:translateY(1px) scale(.975); }
      #mpInventory .inv-equip-slot.occupied { border-color:#ffffff45; }
      #mpInventory .inv-equip-slot.active-slot { border-color:var(--inv-ui-accent); background:linear-gradient(#f9e28a33,#f9e28a13); box-shadow:0 0 0 1px #f9e28a2e,0 0 10px #f9e28a1a; }
      #mpInventory .inv-equip-slot.gear-empty-slot { background:#ffffff06; border-style:dashed; }
      #mpInventory .ies-label { color:#dae8dab8; font-weight:700; }
      #mpInventory .ies-cloth-name,#mpInventory .gear-item-name,#mpInventory .gear-owned-clothing-name { color:var(--text); font-weight:700; }
      #mpInventory .ies-mastery { font-size:max(6px,calc(.72 * var(--inv-font-xs))); color:#f9e28ad4; line-height:1; pointer-events:none; }
      #mpInventory .inventory-slot-state { position:absolute; top:3px; left:3px; max-width:calc(100% - 20px); padding:1px 4px; border:1px solid #ffffff21; border-radius:999px; background:#030906b8; color:#f0ffe6d1; font-size:max(6px,calc(.63 * var(--inv-font-xs))); font-weight:800; line-height:1.2; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; pointer-events:none; }
      #mpInventory .gear-slot-column .inventory-slot-state { display:none; }
      #mpInventory .inventory-slot-state.worn { border-color:#f9e28a7a; background:#f9e28ae6; color:#182019; }
      #mpInventory .ies-unequip { top:3px; right:3px; width:18px; height:18px; border:1px solid #ffffff1f; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; background:#030906ad; opacity:.75; }

      #mpInventory button:focus-visible,#mpInventory [role='button']:focus-visible { outline:2px solid #f9e28af2; outline-offset:2px; }
      #${DEBUG_BUTTON_ID} { position:absolute; right:4px; bottom:4px; z-index:5; padding:3px 6px; border:1px solid #6ec6f057; border-radius:999px; background:#061114c2; color:#aae1f5e6; font-size:max(7px,calc(.68 * var(--inv-font-xs))); line-height:1.2; opacity:.74; }
      #${DEBUG_BUTTON_ID}:hover { opacity:1; background:#0a1f25eb; }

      @media (pointer:coarse) {
        #mpInventory .inv-item-box:not(.empty):hover,#mpInventory .inv-equip-slot[role='button']:hover { transform:none; }
        #mpInventory .ii-btn { min-height:32px; }
        #mpInventory .ies-unequip { width:21px; height:21px; }
        #mpInventory .gear-slot-column .inv-equip-slot { min-height:calc(1.8 * var(--inv-row)); }
      }
      @media (max-width:720px) {
        #mpInventory .gear-loadout-grid { grid-template-columns:minmax(48px,.55fr) minmax(96px,1.45fr) minmax(48px,.55fr) minmax(96px,1.45fr); gap:2px; }
        #mpInventory .gear-owned-section .inv-equip-row { grid-template-columns:repeat(3,minmax(0,1fr)); }
      }
      @media (prefers-reduced-motion:reduce) { #mpInventory .inv-sub-tab,#mpInventory .inv-cat,#mpInventory .inv-item-box,#mpInventory .inv-equip-slot,#mpInventory .ii-btn { transition:none!important; } }
    `;
    document.head.appendChild(style);
  }

  function installObserver() {
    const pane = document.getElementById('mpInventory'); // Shared mutation root for both inventory views.
    if (!pane || inventoryObserver) return;
    inventoryObserver = new MutationObserver((records) => {
      // Tool-stat rows are presentation generated by decorate() itself; ignore their child mutations so they cannot schedule a self-refresh loop.
      const meaningful = records.some((record) => {
        const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
        return !target?.closest?.('.gear-stat-list');
      });
      if (meaningful) scheduleDecorate();
    });
    inventoryObserver.observe(pane, { childList:true, subtree:true });
    pane.addEventListener('click', scheduleDecorate, true);
  }

  function scheduleDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(() => { decorateQueued = false; decorate(); });
  }

  function decorate() {
    decorateModeTabs();
    syncPackClothingTiles();
    decoratePackSlots();
    buildGearLayout();
    decorateGearSlots();
    decorateInfoPanel();
    updateDebugButton();
  }

  function decorateModeTabs() {
    const pack = document.getElementById('invTabPack'); // Pack mode button receives save-scope semantics.
    const gear = document.getElementById('invTabGear'); // Gear mode button receives save-scope semantics.
    if (pack) setModeSemantics(pack, 'Pack inventory — saved with this world', 'Pack — saved with this world');
    if (gear) setModeSemantics(gear, 'Gear inventory — saved with this character', 'Gear — follows this character between worlds');
    document.querySelectorAll('#mpInventory .inv-cat').forEach((button) => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
  }

  function setModeSemantics(button, ariaLabel, title) {
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    button.setAttribute('aria-label', ariaLabel);
    button.title = title;
  }

  function syncPackClothingTiles() {
    const source = document.getElementById('invPackClothing'); // Existing hidden renderer remains the source of clothing actions/data.
    const grid = document.getElementById('invGrid');
    if (!source || !grid) return;

    const sourceButtons = [...source.querySelectorAll('.inv-pcloth-item')];
    const fingerprint = sourceButtons.map((button) => {
      const img = button.querySelector('img');
      return `${button.textContent.trim()}|${img?.getAttribute('src') || ''}`;
    }).join('||');
    const existing = [...grid.querySelectorAll('.pack-clothing-tile')];
    const needsRebuild = grid.dataset.packClothingFingerprint !== fingerprint || existing.length !== sourceButtons.length;

    if (needsRebuild) {
      existing.forEach((node) => node.remove());
      const firstEmpty = grid.querySelector('.inv-item-box.empty');
      sourceButtons.forEach((sourceButton, index) => {
        const tile = document.createElement('button'); // Clothing uses the exact same box role/geometry as ordinary Pack items.
        tile.type = 'button';
        tile.className = 'inv-item-box pack-clothing-tile';
        tile.dataset.packClothingIndex = String(index);
        tile.title = sourceButton.textContent.trim() || 'Clothing';
        [...sourceButton.children].forEach((child) => tile.appendChild(child.cloneNode(true)));
        tile.addEventListener('click', () => {
          sourceButton.click();
          document.querySelectorAll('#invGrid .pack-clothing-tile.selected').forEach((other) => other.classList.remove('selected'));
          tile.classList.add('selected');
        });
        if (firstEmpty?.parentNode === grid) grid.insertBefore(tile, firstEmpty);
        else grid.appendChild(tile);
      });
      grid.dataset.packClothingFingerprint = fingerprint;
    }

    const activeCategory = document.querySelector('#mpInventory .inv-cat.active')?.dataset.cat || 'all';
    const visible = activeCategory === 'all';
    grid.querySelectorAll('.pack-clothing-tile').forEach((tile) => { tile.style.display = visible ? '' : 'none'; });
    grid.querySelectorAll('.inventory-clothing-reserved-empty').forEach((empty) => empty.classList.remove('inventory-clothing-reserved-empty'));
    if (visible) {
      const emptySlots = [...grid.querySelectorAll('.inv-item-box.empty')];
      emptySlots.slice(Math.max(0, emptySlots.length - sourceButtons.length)).forEach((empty) => empty.classList.add('inventory-clothing-reserved-empty'));
    }
  }

  function decoratePackSlots() {
    document.querySelectorAll('#mpInventory .inv-item-box').forEach((slot) => {
      const empty = slot.classList.contains('empty'); // Empty Pack slots remain decorative rather than fake controls.
      slot.setAttribute('aria-selected', String(slot.classList.contains('selected')));
      if (empty) {
        slot.removeAttribute('role'); slot.removeAttribute('tabindex'); slot.setAttribute('aria-hidden', 'true');
      } else {
        slot.removeAttribute('aria-hidden'); makeKeyboardClickable(slot, slot.title || 'Inventory item');
      }
    });
  }

  function buildGearLayout() {
    const section = document.getElementById('invEquipSection');
    if (!section) return;
    const existingLayout = directChild(section, 'gear-loadout-grid');
    if (existingLayout) {
      renderToolStats(existingLayout.querySelector('.gear-tool-stats'));
      return;
    }

    const children = [...section.children];
    const toolHeader = findDirectLabel(children, 'Tool Slots');
    const ownedToolHeader = findDirectLabel(children, 'Owned Tools');
    const clothingHeader = findDirectLabel(children, 'Clothing');
    const ownedClothingHeader = findDirectLabel(children, 'Owned Clothing');
    if (!toolHeader || !ownedToolHeader || !clothingHeader || !ownedClothingHeader) return;

    const toolRow = toolHeader.nextElementSibling;
    const ownedToolRow = ownedToolHeader.nextElementSibling;
    const clothingRow = clothingHeader.nextElementSibling;
    const ownedClothingRow = ownedClothingHeader.nextElementSibling;
    if (!toolRow || !ownedToolRow || !clothingRow || !ownedClothingRow) return;

    const used = new Set([toolHeader, toolRow, ownedToolHeader, ownedToolRow, clothingHeader, clothingRow, ownedClothingHeader, ownedClothingRow]);
    const leftovers = children.filter((node) => !used.has(node)); // Preserves any future/third-party gear rows instead of dropping them.

    const loadout = document.createElement('div'); // Four-column current-loadout block requested by the UI design.
    loadout.className = 'gear-loadout-grid';

    const toolColumn = makeLoadoutColumn('gear-slot-column gear-tool-slots', 'Tool slots');
    toolHeader.textContent = 'Tools';
    toolColumn.append(toolHeader, toolRow);
    loadout.appendChild(toolColumn);

    const toolStats = makeLoadoutColumn('gear-stats-panel gear-tool-stats', 'Tool effects');
    loadout.appendChild(toolStats);

    const clothingColumn = makeLoadoutColumn('gear-slot-column gear-clothing-slots', 'Clothing slots');
    clothingHeader.textContent = 'Clothing';
    clothingColumn.append(clothingHeader, clothingRow);
    loadout.appendChild(clothingColumn);

    const outfitStats = makeLoadoutColumn('gear-stats-panel gear-outfit-stats', 'Outfit effects');
    const placeholder = document.createElement('div');
    placeholder.className = 'outfit-stats-placeholder';
    placeholder.textContent = 'Outfit-wide stat system in development. This space is reserved for the final combined outfit modifiers.';
    outfitStats.appendChild(placeholder);
    loadout.appendChild(outfitStats);

    const ownedSection = document.createElement('div');
    ownedSection.className = 'gear-owned-section';
    const ownedToolsGroup = document.createElement('div');
    ownedToolsGroup.className = 'gear-owned-group gear-owned-tools';
    ownedToolHeader.textContent = 'Owned Tools & Weapons';
    ownedToolsGroup.append(ownedToolHeader, ownedToolRow);
    const ownedClothingGroup = document.createElement('div');
    ownedClothingGroup.className = 'gear-owned-group gear-owned-clothing';
    ownedClothingHeader.textContent = 'Owned Clothing';
    ownedClothingGroup.append(ownedClothingHeader, ownedClothingRow);
    ownedSection.append(ownedToolsGroup, ownedClothingGroup);

    section.replaceChildren(loadout, ownedSection, ...leftovers);
    renderToolStats(toolStats);
  }

  function directChild(parent, className) {
    return [...parent.children].find((node) => node.classList.contains(className)) || null;
  }

  function findDirectLabel(children, text) {
    return children.find((node) => node.classList.contains('inv-equip-label') && node.textContent.trim() === text) || null;
  }

  function makeLoadoutColumn(extraClass, headingText) {
    const column = document.createElement('div');
    column.className = `gear-loadout-column ${extraClass}`;
    const heading = document.createElement('div');
    heading.className = 'gear-loadout-heading';
    heading.textContent = headingText;
    column.appendChild(heading);
    return column;
  }

  function renderToolStats(panel) {
    if (!panel) return;
    let list = panel.querySelector('.gear-stat-list');
    if (!list) {
      list = document.createElement('div'); // Reused between rerenders so stat refreshes do not disturb the loadout columns.
      list.className = 'gear-stat-list';
      panel.appendChild(list);
    }
    list.innerHTML = '';

    const toolColumn = panel.parentElement?.querySelector('.gear-tool-slots');
    const equippedCells = [...(toolColumn?.querySelectorAll('.inv-equip-slot.occupied') || [])];
    if (!equippedCells.length) {
      const empty = document.createElement('div');
      empty.className = 'gear-stats-empty';
      empty.textContent = 'No tools assigned. Equip a tool to see its current quality and mastery here.';
      list.appendChild(empty);
      return;
    }

    const combatDeps = window.Combat?.deps || null; // Existing combat adapter exposes read-only access to tool metadata when available.
    const ownedMastery = ownedToolMasteryMap();
    for (const cell of equippedCells) {
      const parsed = parseAssignedToolTitle(cell.title);
      if (!parsed) continue;
      const itemKey = findToolKey(combatDeps, parsed.slot, parsed.label);
      const def = itemKey && combatDeps?.TOOL_ITEM_DEFS ? combatDeps.TOOL_ITEM_DEFS[itemKey] : null;
      const mastery = itemKey && typeof combatDeps?.toolMasteryLevel === 'function'
        ? combatDeps.toolMasteryLevel(itemKey)
        : (ownedMastery.get(parsed.label) ?? null);

      const item = document.createElement('div');
      item.className = 'gear-stat-item';
      const head = document.createElement('div');
      head.className = 'gear-stat-item-head';
      const slot = document.createElement('span');
      slot.className = 'gear-stat-slot'; slot.textContent = parsed.slot;
      const name = document.createElement('span');
      name.className = 'gear-stat-name'; name.textContent = parsed.label;
      head.append(slot, name);
      item.appendChild(head);

      const chips = document.createElement('div');
      chips.className = 'gear-stat-chips';
      if (Number.isFinite(Number(mastery))) addStatChip(chips, `Mastery ${Number(mastery)}/5`, true);

      const quality = resolveToolQuality(combatDeps, itemKey, def);
      if (quality.label) addStatChip(chips, `Quality ${quality.label}`, true);
      if (quality.effectMultiplier != null) addStatChip(chips, `Efficacy ×${formatMultiplier(quality.effectMultiplier)}`);
      if (quality.verdigrisPercent != null) addStatChip(chips, `Verdigris ${quality.verdigrisPercent}%`);

      const damageType = itemKey && typeof combatDeps?.weaponDamageTypeForTool === 'function'
        ? combatDeps.weaponDamageTypeForTool(itemKey)
        : def?.dmgType;
      if (parsed.slot === 'weapon' && damageType) addStatChip(chips, titleCase(String(damageType)));

      if (!chips.children.length) {
        addStatChip(chips, 'Current tool data');
      }
      item.appendChild(chips);
      list.appendChild(item);
    }
  }

  function parseAssignedToolTitle(title) {
    const match = String(title || '').match(/^([^:]+):\s*(.+)$/);
    if (!match || /\(empty\)/i.test(match[2])) return null;
    return { slot: match[1].trim().toLowerCase(), label: match[2].trim() };
  }

  function ownedToolMasteryMap() {
    const map = new Map();
    document.querySelectorAll('#mpInventory .gear-owned-tools .inv-equip-slot[title]').forEach((cell) => {
      const match = cell.title.match(/^(.*?) \(Mastery (\d+)\/5\)/);
      if (match) map.set(match[1].trim(), Number(match[2]));
    });
    return map;
  }

  function findToolKey(combatDeps, slot, label) {
    const direct = combatDeps?.equipmentSlots?.[slot];
    if (direct) return direct;
    if (slot === 'weapon') {
      const currentWeapon = combatDeps?.currentWeaponKey?.();
      if (currentWeapon && currentWeapon !== 'none') return currentWeapon;
    }
    const defs = combatDeps?.TOOL_ITEM_DEFS;
    if (!defs) return null;
    return Object.keys(defs).find((key) => defs[key]?.label === label) || null;
  }

  function resolveToolQuality(combatDeps, itemKey, def) {
    if (!itemKey) return {};
    const effectiveMetalKey = combatDeps?.toolEffectiveMetalKey?.(itemKey) || def?.metalKey || null;
    const metal = effectiveMetalKey ? combatDeps?.METAL_DEFS?.[effectiveMetalKey] : null;
    const rawQuality = def?.qualityLabel ?? def?.quality ?? def?.qualityTier ?? null;
    let label = '';
    if (metal?.label) label = metal.label + (metal.tier != null ? ` T${metal.tier}` : '');
    else if (rawQuality != null) label = String(rawQuality);
    else if (effectiveMetalKey) label = titleCase(humanizeKey(effectiveMetalKey));

    const effect = combatDeps?.toolMetalMultiplier?.(itemKey);
    const effectMultiplier = Number.isFinite(Number(effect)) ? Number(effect) : null;
    const verdigris = combatDeps?.toolVerdigrisFraction?.(itemKey);
    const verdigrisPercent = Number.isFinite(Number(verdigris)) && Number(verdigris) > 0
      ? Math.round(Number(verdigris) * 100)
      : null;
    return { label, effectMultiplier, verdigrisPercent };
  }

  function addStatChip(parent, text, emphasis = false) {
    const chip = document.createElement('span');
    chip.className = 'gear-stat-chip' + (emphasis ? ' emphasis' : '');
    chip.textContent = text;
    parent.appendChild(chip);
  }

  function humanizeKey(value) {
    return String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  }

  function titleCase(value) {
    return String(value || '').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function formatMultiplier(value) {
    const rounded = Math.round(Number(value) * 100) / 100;
    return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
  }

  function decorateGearSlots() {
    document.querySelectorAll('#mpInventory .inv-equip-slot').forEach((slot) => {
      const title = slot.title || ''; // Existing titles remain the source of item/slot identity.
      const empty = title.includes('(empty)');
      const inertEmptyClothing = slot.classList.contains('clothing-slot') && !slot.classList.contains('occupied');
      slot.classList.toggle('gear-empty-slot', empty);
      decorateOwnedGearName(slot, title);

      const isOwnedClothing = slot.classList.contains('clothing-owned-slot');
      setSlotState(slot, isOwnedClothing && slot.classList.contains('active-slot') ? 'Worn' : '', 'worn');

      if (inertEmptyClothing) {
        slot.removeAttribute('role'); slot.removeAttribute('tabindex'); slot.setAttribute('aria-disabled', 'true');
      } else {
        slot.removeAttribute('aria-disabled'); makeKeyboardClickable(slot, title || 'Gear slot');
      }
    });
  }

  function decorateOwnedGearName(slot, title) {
    const toolMatch = title.match(/^(.*?) \(Mastery (\d+)\/5\) — click to assign/); // Splits tool name from mastery for legibility.
    const label = slot.querySelector('.ies-label');
    if (toolMatch && label) {
      label.textContent = toolMatch[1]; label.classList.add('gear-item-name');
      let mastery = slot.querySelector('.ies-mastery');
      if (!mastery) { mastery = document.createElement('span'); mastery.className = 'ies-mastery'; label.insertAdjacentElement('afterend', mastery); }
      mastery.textContent = `Mastery ${toolMatch[2]}/5`;
    }
    if (slot.classList.contains('clothing-owned-slot') && !slot.querySelector('.gear-owned-clothing-name')) {
      const itemName = title.split(' — ')[0].trim();
      if (itemName) {
        const name = document.createElement('span');
        name.className = 'gear-owned-clothing-name';
        name.textContent = itemName;
        const slotLabel = slot.querySelector('.ies-label');
        if (slotLabel) slot.insertBefore(name, slotLabel);
        else slot.appendChild(name);
      }
    }
  }

  function setSlotState(slot, state, tone) {
    let badge = slot.querySelector('.inventory-slot-state');
    if (!state) { badge?.remove(); return; }
    if (!badge) { badge = document.createElement('span'); badge.className = 'inventory-slot-state'; slot.appendChild(badge); }
    badge.className = `inventory-slot-state ${tone || ''}`.trim();
    badge.textContent = state;
  }

  function decorateInfoPanel() {
    const empty = document.getElementById('iiEmpty'); // More explicit prompt helps on touch devices where there is no hover affordance.
    if (empty) empty.textContent = 'Select an item to see its description and actions.';
    const tags = document.getElementById('iiTags');
    if (tags) tags.setAttribute('aria-hidden', 'true');
    const detail = document.getElementById('iiDetail');
    if (detail) detail.setAttribute('aria-live', 'polite');
  }

  function makeKeyboardClickable(element, ariaLabel) {
    if (element.tagName !== 'BUTTON') {
      element.setAttribute('role', 'button');
      if (!element.hasAttribute('tabindex')) element.tabIndex = 0;
      if (!element.dataset.inventoryKeyboardBound) {
        element.dataset.inventoryKeyboardBound = '1';
        element.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          element.click();
        });
      }
    }
    if (ariaLabel && !element.getAttribute('aria-label')) element.setAttribute('aria-label', ariaLabel);
  }

  function ensureDebugButton() {
    const pane = document.getElementById('mpInventory');
    if (!pane || document.getElementById(DEBUG_BUTTON_ID)) return;
    const button = document.createElement('button'); // Allows layout-bound debugging on mobile without DevTools.
    button.id = DEBUG_BUTTON_ID;
    button.type = 'button';
    button.textContent = 'UI BOUNDS';
    button.addEventListener('click', () => {
      const menu = document.getElementById('menuPanel');
      if (!menu) return;
      menu.classList.toggle('inv-debug');
      updateDebugButton();
      deps?.showToast?.(`Inventory bounds ${menu.classList.contains('inv-debug') ? 'on' : 'off'}.`, true);
    });
    pane.appendChild(button);
    updateDebugButton();
  }

  function updateDebugButton() {
    const button = document.getElementById(DEBUG_BUTTON_ID);
    if (!button) return;
    const dev = !!deps?.isDevMode?.();
    button.style.display = dev ? '' : 'none';
    const active = document.getElementById('menuPanel')?.classList.contains('inv-debug');
    button.setAttribute('aria-pressed', String(!!active));
    button.textContent = active ? 'UI BOUNDS ON' : 'UI BOUNDS';
  }

  function debugSnapshot() {
    const pane = document.getElementById('mpInventory');
    const mode = pane?.classList.contains('inv-mode-gear') ? 'gear' : 'pack';
    return {
      mode,
      packItems: document.querySelectorAll('#invGrid .inv-item-box:not(.empty)').length,
      integratedPackClothing: document.querySelectorAll('#invGrid .pack-clothing-tile').length,
      gearLoadoutColumns: document.querySelectorAll('#invEquipSection .gear-loadout-grid > .gear-loadout-column').length,
      equippedToolSlots: document.querySelectorAll('#invEquipSection .gear-tool-slots .inv-equip-slot.occupied').length,
      ownedGearTiles: document.querySelectorAll('#invEquipSection .gear-owned-section .inv-equip-slot').length,
      infoHasDescription: !!document.getElementById('iiDesc')?.textContent?.trim(),
      boundsVisible: !!document.getElementById('menuPanel')?.classList.contains('inv-debug'),
    };
  }

  window.InventoryUI = { init, decorate, debugSnapshot };
})();
