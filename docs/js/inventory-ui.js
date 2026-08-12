(() => {
  'use strict';

  // Dependency adapters are supplied by EquipmentPanel and are only used for dev-mode feedback.
  let deps = null;
  // The observer keeps newly rebuilt Pack/Gear tiles decorated without coupling to game.js rebuild calls.
  let inventoryObserver = null;
  // The RAF guard coalesces bursts of DOM mutations into one decoration pass.
  let decorateQueued = false;

  // Stable DOM ids prevent duplicate style/debug nodes when init() is called more than once.
  const STYLE_ID = 'inventoryUiPolishStyles';
  const DEBUG_BUTTON_ID = 'inventoryUiDebugButton';

  function init(injectedDeps = {}) {
    deps = injectedDeps;
    installStyles();
    installObserver();
    decorateInventoryUi();
    ensureDebugButton();
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    // The style node owns presentation only; inventory data and actions stay in their existing systems.
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #mpInventory {
        --inv-ui-strong: rgba(249,226,138,0.86);
        --inv-ui-soft: rgba(249,226,138,0.14);
        --inv-ui-panel: rgba(6,14,10,0.34);
      }

      #mpInventory .inv-wallet {
        border: 1px solid rgba(240,208,64,0.26);
        border-radius: 999px;
        background: rgba(240,208,64,0.07);
        font-weight: 700;
        text-shadow: 0 1px 2px rgba(0,0,0,0.45);
      }

      #mpInventory .inv-sub-tabs {
        gap: 2px;
        padding: 2px;
        border: 1px solid rgba(255,255,255,0.11);
        border-radius: calc(0.95 * var(--inv-row));
        background: rgba(0,0,0,0.18);
        overflow: visible;
      }
      #mpInventory .inv-sub-tab {
        flex: 1 1 0;
        min-width: 0;
        height: calc(1.75 * var(--inv-row));
        padding: 0 4px;
        border: 1px solid transparent;
        border-radius: calc(0.78 * var(--inv-row));
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0;
        line-height: 1.03;
        transition: transform 80ms ease, background 100ms ease, border-color 100ms ease, color 100ms ease, box-shadow 100ms ease;
      }
      #mpInventory .inv-sub-tab::after {
        display: block;
        margin-top: 1px;
        font-size: max(6px, calc(0.66 * var(--inv-font-xs)));
        letter-spacing: 0.12em;
        opacity: 0.62;
      }
      #mpInventory #invTabPack::after { content: 'WORLD'; }
      #mpInventory #invTabGear::after { content: 'CHARACTER'; }
      #mpInventory .inv-sub-tab:hover { background: rgba(255,255,255,0.07); }
      #mpInventory .inv-sub-tab:active { transform: translateY(1px) scale(0.975); }
      #mpInventory .inv-sub-tab.active {
        color: #1a211b;
        border-color: rgba(249,226,138,0.92);
        background: linear-gradient(180deg, rgba(255,239,164,0.98), rgba(231,203,99,0.94));
        box-shadow: 0 2px 8px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.55);
      }
      #mpInventory .inv-sub-tab.active::after { opacity: 0.72; }

      #mpInventory .inv-cats {
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
        justify-content: flex-start;
        -webkit-overflow-scrolling: touch;
      }
      #mpInventory .inv-cats::-webkit-scrollbar { display: none; }
      #mpInventory .inv-cat {
        flex: 0 0 auto;
        border-color: rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.035);
        transition: transform 80ms ease, background 100ms ease, border-color 100ms ease, color 100ms ease;
      }
      #mpInventory .inv-cat:hover { color: var(--text); background: rgba(255,255,255,0.075); }
      #mpInventory .inv-cat:active { transform: translateY(1px) scale(0.97); }
      #mpInventory .inv-cat.active {
        color: #192019;
        border-color: rgba(249,226,138,0.92);
        background: var(--inv-ui-strong);
        font-weight: 700;
        box-shadow: 0 1px 5px rgba(0,0,0,0.24);
      }

      #mpInventory .inv-key-section,
      #mpInventory .inv-pack-clothing,
      #mpInventory .inv-equip-section {
        border-radius: var(--inv-radius);
      }

      #mpInventory .inv-grid-area {
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: var(--inv-radius);
        background: rgba(0,0,0,0.10);
      }
      #mpInventory .inv-item-box {
        border-color: rgba(255,255,255,0.14);
        background: linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.032));
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.035), 0 1px 3px rgba(0,0,0,0.18);
        transition: transform 80ms ease, background 100ms ease, border-color 100ms ease, box-shadow 100ms ease;
      }
      #mpInventory .inv-item-box:not(.empty):hover {
        transform: translateY(-1px);
        border-color: rgba(255,255,255,0.30);
        background: linear-gradient(180deg, rgba(255,255,255,0.11), rgba(255,255,255,0.055));
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 3px 8px rgba(0,0,0,0.22);
      }
      #mpInventory .inv-item-box:not(.empty):active { transform: translateY(1px) scale(0.965); }
      #mpInventory .inv-item-box.selected {
        transform: translateY(-1px);
        border-color: rgba(249,226,138,0.94);
        background: linear-gradient(180deg, rgba(249,226,138,0.20), rgba(249,226,138,0.09));
        box-shadow: 0 0 0 1px rgba(249,226,138,0.20), 0 0 12px rgba(249,226,138,0.12), inset 0 1px 0 rgba(255,255,255,0.08);
      }
      #mpInventory .inv-item-box.empty { opacity: 0.62; }
      #mpInventory .iib-count {
        bottom: 3px;
        right: 3px;
        min-width: 16px;
        min-height: 14px;
        padding: 2px 4px 1px;
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        background: rgba(3,9,6,0.83);
        font-weight: 800;
        line-height: 1;
        text-shadow: 0 1px 2px #000;
      }
      #mpInventory .iib-count.zero { color: var(--danger); opacity: 0.72; }
      #mpInventory .iib-equip-badge {
        top: 3px;
        left: 3px;
        border: 1px solid rgba(249,226,138,0.52);
        border-radius: 999px;
        padding: 1px 3px;
        background: rgba(249,226,138,0.94);
        font-weight: 800;
      }

      #mpInventory .inv-info {
        border-left-color: rgba(255,255,255,0.16);
        background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(0,0,0,0.10));
      }
      #mpInventory .ii-empty {
        opacity: 0.72;
        line-height: 1.5;
      }
      #mpInventory .ii-icon-wrap {
        border: 1px solid rgba(255,255,255,0.10);
        background: radial-gradient(circle at 50% 42%, rgba(249,226,138,0.10), rgba(255,255,255,0.025) 58%, rgba(0,0,0,0.05));
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
      }
      #mpInventory .ii-name {
        color: var(--text);
        font-weight: 800;
        line-height: 1.25;
        text-wrap: balance;
      }
      #mpInventory .ii-price { color: var(--accent); opacity: 0.88; }
      #mpInventory .ii-tag {
        border-color: rgba(255,255,255,0.16);
        background: rgba(255,255,255,0.055);
      }
      #mpInventory .ii-desc { line-height: 1.48; }
      #mpInventory .ii-btn {
        min-height: 28px;
        border-color: rgba(255,255,255,0.17);
        background: rgba(255,255,255,0.045);
        transition: transform 80ms ease, background 100ms ease, border-color 100ms ease;
      }
      #mpInventory .ii-btn:hover { background: rgba(255,255,255,0.09); border-color: rgba(255,255,255,0.30); }
      #mpInventory .ii-btn:active { transform: translateY(1px) scale(0.985); }
      #mpInventory .ii-btn.equip {
        background: rgba(80,200,120,0.08);
        border-color: rgba(94,222,135,0.55);
      }

      #mpInventory .inv-equip-section {
        padding: calc(0.55 * var(--inv-gap)) var(--inv-pad);
        background: rgba(0,0,0,0.075);
      }
      #mpInventory .inv-equip-label {
        color: rgba(249,226,138,0.90);
        font-weight: 800;
        letter-spacing: 0.10em;
        text-shadow: 0 1px 2px rgba(0,0,0,0.45);
      }
      #mpInventory .inv-equip-row { gap: calc(1.15 * var(--inv-gap)); }
      #mpInventory .inv-equip-slot {
        border-color: rgba(255,255,255,0.14);
        background: linear-gradient(180deg, rgba(255,255,255,0.062), rgba(255,255,255,0.026));
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.035), 0 1px 3px rgba(0,0,0,0.18);
        transition: transform 80ms ease, background 100ms ease, border-color 100ms ease, box-shadow 100ms ease, opacity 100ms ease;
      }
      #mpInventory .inv-equip-slot[role='button']:hover {
        transform: translateY(-1px);
        border-color: rgba(255,255,255,0.31);
        background: linear-gradient(180deg, rgba(255,255,255,0.105), rgba(255,255,255,0.048));
      }
      #mpInventory .inv-equip-slot[role='button']:active { transform: translateY(1px) scale(0.975); }
      #mpInventory .inv-equip-slot.occupied { border-color: rgba(255,255,255,0.27); }
      #mpInventory .inv-equip-slot.active-slot {
        border-color: rgba(249,226,138,0.92);
        background: linear-gradient(180deg, rgba(249,226,138,0.20), rgba(249,226,138,0.075));
        box-shadow: 0 0 0 1px rgba(249,226,138,0.18), 0 0 10px rgba(249,226,138,0.10);
      }
      #mpInventory .inv-equip-slot.gear-empty-slot {
        background: rgba(255,255,255,0.022);
        border-style: dashed;
      }
      #mpInventory .ies-label { color: rgba(218,232,218,0.72); font-weight: 700; }
      #mpInventory .ies-cloth-name,
      #mpInventory .gear-item-name {
        color: var(--text);
        font-weight: 700;
      }
      #mpInventory .ies-mastery {
        font-size: max(6px, calc(0.72 * var(--inv-font-xs)));
        color: rgba(249,226,138,0.83);
        line-height: 1;
        pointer-events: none;
      }
      #mpInventory .inventory-slot-state {
        position: absolute;
        top: 3px;
        left: 3px;
        max-width: calc(100% - 20px);
        padding: 1px 4px;
        border: 1px solid rgba(255,255,255,0.13);
        border-radius: 999px;
        background: rgba(3,9,6,0.72);
        color: rgba(240,255,230,0.82);
        font-size: max(6px, calc(0.63 * var(--inv-font-xs)));
        font-weight: 800;
        line-height: 1.2;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        pointer-events: none;
      }
      #mpInventory .inventory-slot-state.active,
      #mpInventory .inventory-slot-state.worn {
        border-color: rgba(249,226,138,0.48);
        background: rgba(249,226,138,0.90);
        color: #182019;
      }
      #mpInventory .inventory-slot-state.assigned {
        border-color: rgba(126,232,162,0.42);
        background: rgba(38,104,61,0.76);
        color: #c8f7d8;
      }
      #mpInventory .inventory-slot-state.empty {
        border-color: rgba(255,255,255,0.09);
        background: rgba(0,0,0,0.20);
        color: rgba(180,205,184,0.56);
      }
      #mpInventory .ies-unequip {
        top: 3px;
        right: 3px;
        width: 18px;
        height: 18px;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(3,9,6,0.68);
        opacity: 0.75;
      }
      #mpInventory .ies-unequip:active { transform: scale(0.92); }

      #mpInventory button:focus-visible,
      #mpInventory [role='button']:focus-visible {
        outline: 2px solid rgba(249,226,138,0.95);
        outline-offset: 2px;
      }

      #${DEBUG_BUTTON_ID} {
        position: absolute;
        right: 4px;
        bottom: 4px;
        z-index: 5;
        padding: 3px 6px;
        border: 1px solid rgba(110,198,240,0.34);
        border-radius: 999px;
        background: rgba(6,17,20,0.76);
        color: rgba(170,225,245,0.90);
        font-size: max(7px, calc(0.68 * var(--inv-font-xs)));
        line-height: 1.2;
        opacity: 0.74;
      }
      #${DEBUG_BUTTON_ID}:hover { opacity: 1; background: rgba(10,31,37,0.92); }

      @media (pointer: coarse) {
        #mpInventory .inv-item-box:not(.empty):hover,
        #mpInventory .inv-equip-slot[role='button']:hover { transform: none; }
        #mpInventory .ii-btn { min-height: 32px; }
        #mpInventory .ies-unequip { width: 21px; height: 21px; }
      }

      @media (prefers-reduced-motion: reduce) {
        #mpInventory .inv-sub-tab,
        #mpInventory .inv-cat,
        #mpInventory .inv-item-box,
        #mpInventory .inv-equip-slot,
        #mpInventory .ii-btn { transition: none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function installObserver() {
    // The inventory pane is the mutation root rebuilt by both Pack and Gear renderers.
    const pane = document.getElementById('mpInventory');
    if (!pane || inventoryObserver) return;
    inventoryObserver = new MutationObserver(scheduleDecorate);
    inventoryObserver.observe(pane, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    pane.addEventListener('click', scheduleDecorate, true);
  }

  function scheduleDecorate() {
    if (decorateQueued) return;
    decorateQueued = true;
    requestAnimationFrame(() => {
      decorateQueued = false;
      decorateInventoryUi();
    });
  }

  function decorateInventoryUi() {
    decorateModeTabs();
    decoratePackSlots();
    decorateGearSlots();
    decorateInfoPanel();
    updateDebugButton();
  }

  function decorateModeTabs() {
    // Pack/Gear buttons announce both current mode and save scope to assistive tech.
    const packTab = document.getElementById('invTabPack');
    const gearTab = document.getElementById('invTabGear');
    if (packTab) {
      packTab.setAttribute('aria-pressed', String(packTab.classList.contains('active')));
      packTab.setAttribute('aria-label', 'Pack inventory — saved with this world');
      packTab.title = 'Pack — saved with this world';
    }
    if (gearTab) {
      gearTab.setAttribute('aria-pressed', String(gearTab.classList.contains('active')));
      gearTab.setAttribute('aria-label', 'Gear inventory — saved with this character');
      gearTab.title = 'Gear — follows this character between worlds';
    }

    // Category buttons expose the selected filter consistently after game.js rebuilds.
    document.querySelectorAll('#mpInventory .inv-cat').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    });
  }

  function decoratePackSlots() {
    // Pack tiles are built in game.js; this layer only adds interaction semantics and selection state.
    document.querySelectorAll('#mpInventory .inv-item-box').forEach((slot) => {
      const isEmpty = slot.classList.contains('empty');
      slot.setAttribute('aria-selected', String(slot.classList.contains('selected')));
      if (isEmpty) {
        slot.removeAttribute('role');
        slot.removeAttribute('tabindex');
        slot.setAttribute('aria-hidden', 'true');
        return;
      }
      slot.removeAttribute('aria-hidden');
      makeKeyboardClickable(slot, slot.getAttribute('title') || 'Inventory item');
    });
  }

  function decorateGearSlots() {
    // Gear tiles are rebuilt by EquipmentPanel; derive richer status/name cues from their stable classes and titles.
    document.querySelectorAll('#mpInventory .inv-equip-slot').forEach((slot) => {
      const title = slot.getAttribute('title') || '';
      const isEmpty = title.includes('(empty)');
      const inactiveEmptyClothing = slot.classList.contains('clothing-slot') && !slot.classList.contains('occupied');

      slot.classList.toggle('gear-empty-slot', isEmpty);
      decorateOwnedGearName(slot, title);

      let stateText = '';
      let stateTone = '';
      if (slot.classList.contains('clothing-owned-slot') && slot.classList.contains('active-slot')) {
        stateText = 'Worn';
        stateTone = 'worn';
      } else if (slot.classList.contains('clothing-slot')) {
        stateText = slot.classList.contains('occupied') ? 'Worn' : 'Empty';
        stateTone = slot.classList.contains('occupied') ? 'worn' : 'empty';
      } else if (isEmpty) {
        stateText = 'Empty';
        stateTone = 'empty';
      } else if (slot.classList.contains('active-slot')) {
        stateText = 'Active';
        stateTone = 'active';
      } else if (/^(hoe|shovel|axe|pick|harpoon|weapon):/i.test(title)) {
        stateText = 'Assigned';
        stateTone = 'assigned';
      }
      setSlotState(slot, stateText, stateTone);

      if (inactiveEmptyClothing) {
        slot.removeAttribute('role');
        slot.removeAttribute('tabindex');
        slot.setAttribute('aria-disabled', 'true');
      } else {
        slot.removeAttribute('aria-disabled');
        makeKeyboardClickable(slot, title || 'Gear slot');
      }
    });
  }

  function decorateOwnedGearName(slot, title) {
    // Owned tool tiles get their full name and mastery split into two readable lines instead of a truncated "Lv" label.
    if (/\(Mastery \d+\/5\)/.test(title) && title.includes('— click to assign')) {
      const nameMatch = title.match(/^(.*?) \(Mastery (\d+)\/5\)/);
      const label = slot.querySelector('.ies-label');
      if (nameMatch && label) {
        label.textContent = nameMatch[1];
        label.classList.add('gear-item-name');
        let mastery = slot.querySelector('.ies-mastery');
        if (!mastery) {
          mastery = document.createElement('span');
          mastery.className = 'ies-mastery';
          label.insertAdjacentElement('afterend', mastery);
        }
        mastery.textContent = `Mastery ${nameMatch[2]}/5`;
      }
    }

    // Owned clothing tiles already carry the full name in title text; surface it directly on the tile.
    if (slot.classList.contains('clothing-owned-slot')) {
      const itemName = title.split(' — ')[0].trim();
      if (itemName && !slot.querySelector('.gear-owned-clothing-name')) {
        const name = document.createElement('span');
        name.className = 'ies-cloth-name gear-owned-clothing-name';
        name.textContent = itemName;
        const slotLabel = slot.querySelector('.ies-label');
        if (slotLabel) slot.insertBefore(name, slotLabel);
        else slot.appendChild(name);
      }
    }
  }

  function setSlotState(slot, text, tone) {
    // Status chips are purely descriptive and are regenerated idempotently after every gear rebuild.
    let chip = slot.querySelector(':scope > .inventory-slot-state');
    if (!text) {
      chip?.remove();
      return;
    }
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'inventory-slot-state';
      slot.appendChild(chip);
    }
    chip.className = `inventory-slot-state ${tone || ''}`.trim();
    chip.textContent = text;
  }

  function makeKeyboardClickable(element, label) {
    element.setAttribute('role', 'button');
    element.tabIndex = 0;
    element.setAttribute('aria-label', label);
    if (element.dataset.inventoryUiKeyboard === '1') return;
    element.dataset.inventoryUiKeyboard = '1';
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      element.click();
    });
  }

  function decorateInfoPanel() {
    // The empty-state copy changes with the active inventory mode so the next action is explicit.
    const pane = document.getElementById('mpInventory');
    const empty = document.getElementById('iiEmpty');
    if (!pane || !empty) return;
    empty.textContent = pane.classList.contains('inv-mode-gear')
      ? 'Select a gear slot or owned item to inspect, equip, or assign it.'
      : 'Select an item to see its details and available actions.';
  }

  function ensureDebugButton() {
    const pane = document.getElementById('mpInventory');
    if (!pane || !deps?.isDevMode?.() || document.getElementById(DEBUG_BUTTON_ID)) return;
    // The in-panel debug button makes layout-boundary diagnostics reachable on mobile without DevTools.
    const button = document.createElement('button');
    button.id = DEBUG_BUTTON_ID;
    button.type = 'button';
    button.title = 'Toggle inventory layout debug boundaries';
    button.addEventListener('click', () => {
      const menuPanel = document.getElementById('menuPanel');
      if (!menuPanel) return;
      const enabled = menuPanel.classList.toggle('inv-debug');
      updateDebugButton();
      deps?.showToast?.(`Inventory UI bounds ${enabled ? 'on' : 'off'}.`, true);
    });
    pane.appendChild(button);
    updateDebugButton();
  }

  function updateDebugButton() {
    const button = document.getElementById(DEBUG_BUTTON_ID);
    if (!button) return;
    // The label reflects the existing style.css inv-debug class rather than keeping duplicate state.
    const enabled = document.getElementById('menuPanel')?.classList.contains('inv-debug');
    button.textContent = enabled ? 'UI BOUNDS ON' : 'UI BOUNDS';
    button.setAttribute('aria-pressed', String(Boolean(enabled)));
  }

  function debugSnapshot() {
    // This lightweight snapshot is exposed for any future in-game debug viewer to consume directly.
    const pane = document.getElementById('mpInventory');
    const grid = document.getElementById('invGrid');
    return {
      mode: pane?.classList.contains('inv-mode-gear') ? 'gear' : 'pack',
      packSlots: grid?.querySelectorAll('.inv-item-box').length || 0,
      packOccupied: grid?.querySelectorAll('.inv-item-box:not(.empty)').length || 0,
      gearSlots: pane?.querySelectorAll('.inv-equip-slot').length || 0,
      selectedPackItems: grid?.querySelectorAll('.inv-item-box.selected').length || 0,
      boundsDebug: Boolean(document.getElementById('menuPanel')?.classList.contains('inv-debug')),
    };
  }

  window.InventoryUI = {
    init,
    decorate: decorateInventoryUi,
    debugSnapshot,
  };
})();
