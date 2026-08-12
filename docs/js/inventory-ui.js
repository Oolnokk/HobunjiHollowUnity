(() => {
  'use strict';

  // Injected adapters let the UI expose mobile-friendly dev feedback without owning game state.
  let deps = null;
  // The observer redecorates only when Pack/Gear renderers replace DOM children.
  let inventoryObserver = null;
  // The RAF flag coalesces rebuild bursts into a single decoration pass.
  let decorateQueued = false;

  const STYLE_ID = 'inventoryUiPolishStyles'; // Prevents duplicate injected inventory styles.
  const DEBUG_BUTTON_ID = 'inventoryUiDebugButton'; // Anchors the in-menu mobile debug toggle.

  function init(injectedDeps = {}) {
    deps = injectedDeps;
    installStyles();
    installObserver();
    decorate();
    ensureDebugButton();
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Owns visual polish while existing inventory CSS keeps layout geometry.
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

      #mpInventory .inv-grid-area { border:1px solid #ffffff12; border-radius:var(--inv-radius); background:#0000001a; }
      #mpInventory .inv-item-box { border-color:#ffffff24; background:linear-gradient(#ffffff11,#ffffff08); box-shadow:inset 0 1px #ffffff09,0 1px 3px #0003; transition:transform 80ms ease,background 100ms ease,border-color 100ms ease,box-shadow 100ms ease; }
      #mpInventory .inv-item-box:not(.empty):hover { transform:translateY(-1px); border-color:#ffffff4d; background:linear-gradient(#ffffff1c,#ffffff0e); box-shadow:inset 0 1px #ffffff0f,0 3px 8px #0004; }
      #mpInventory .inv-item-box:not(.empty):active { transform:translateY(1px) scale(.965); }
      #mpInventory .inv-item-box.selected { transform:translateY(-1px); border-color:var(--inv-ui-accent); background:linear-gradient(#f9e28a33,#f9e28a17); box-shadow:0 0 0 1px #f9e28a33,0 0 12px #f9e28a1f,inset 0 1px #ffffff14; }
      #mpInventory .inv-item-box.empty { opacity:.62; }
      #mpInventory .iib-count { bottom:3px; right:3px; min-width:16px; min-height:14px; padding:2px 4px 1px; border:1px solid #ffffff29; border-radius:999px; display:inline-flex; align-items:center; justify-content:center; color:#fff; background:#030906d4; font-weight:800; line-height:1; text-shadow:0 1px 2px #000; }
      #mpInventory .iib-count.zero { color:var(--danger); opacity:.72; }
      #mpInventory .iib-equip-badge { top:3px; left:3px; border:1px solid #f9e28a85; border-radius:999px; padding:1px 3px; background:#f9e28af0; font-weight:800; }

      #mpInventory .inv-info { border-left-color:#ffffff29; background:linear-gradient(#ffffff06,#0000001a); }
      #mpInventory .ii-empty { opacity:.72; line-height:1.5; }
      #mpInventory .ii-icon-wrap { border:1px solid #ffffff1a; background:radial-gradient(circle at 50% 42%,#f9e28a1a,#ffffff06 58%,#0000000d); box-shadow:inset 0 1px #ffffff09; }
      #mpInventory .ii-name { color:var(--text); font-weight:800; line-height:1.25; }
      #mpInventory .ii-price { color:var(--accent); opacity:.88; }
      #mpInventory .ii-tag { border-color:#ffffff29; background:#ffffff0e; }
      #mpInventory .ii-desc { line-height:1.48; }
      #mpInventory .ii-btn { min-height:28px; border-color:#ffffff2b; background:#ffffff0b; transition:transform 80ms ease,background 100ms ease,border-color 100ms ease; }
      #mpInventory .ii-btn:hover { background:#ffffff17; border-color:#ffffff4d; }
      #mpInventory .ii-btn:active { transform:translateY(1px) scale(.985); }
      #mpInventory .ii-btn.equip { background:#50c87814; border-color:#5ede878c; }

      #mpInventory .inv-equip-section { padding:calc(.55 * var(--inv-gap)) var(--inv-pad); border-radius:var(--inv-radius); background:#00000013; }
      #mpInventory .inv-equip-label { color:#f9e28ae6; font-weight:800; letter-spacing:.10em; text-shadow:0 1px 2px #0007; }
      #mpInventory .inv-equip-row { gap:calc(1.15 * var(--inv-gap)); }
      #mpInventory .inv-equip-slot { border-color:#ffffff24; background:linear-gradient(#ffffff10,#ffffff07); box-shadow:inset 0 1px #ffffff09,0 1px 3px #0003; transition:transform 80ms ease,background 100ms ease,border-color 100ms ease,box-shadow 100ms ease,opacity 100ms ease; }
      #mpInventory .inv-equip-slot[role='button']:hover { transform:translateY(-1px); border-color:#ffffff4f; background:linear-gradient(#ffffff1b,#ffffff0c); }
      #mpInventory .inv-equip-slot[role='button']:active { transform:translateY(1px) scale(.975); }
      #mpInventory .inv-equip-slot.occupied { border-color:#ffffff45; }
      #mpInventory .inv-equip-slot.active-slot { border-color:var(--inv-ui-accent); background:linear-gradient(#f9e28a33,#f9e28a13); box-shadow:0 0 0 1px #f9e28a2e,0 0 10px #f9e28a1a; }
      #mpInventory .inv-equip-slot.gear-empty-slot { background:#ffffff06; border-style:dashed; }
      #mpInventory .ies-label { color:#dae8dab8; font-weight:700; }
      #mpInventory .ies-cloth-name,#mpInventory .gear-item-name { color:var(--text); font-weight:700; }
      #mpInventory .ies-mastery { font-size:max(6px,calc(.72 * var(--inv-font-xs))); color:#f9e28ad4; line-height:1; pointer-events:none; }
      #mpInventory .inventory-slot-state { position:absolute; top:3px; left:3px; max-width:calc(100% - 20px); padding:1px 4px; border:1px solid #ffffff21; border-radius:999px; background:#030906b8; color:#f0ffe6d1; font-size:max(6px,calc(.63 * var(--inv-font-xs))); font-weight:800; line-height:1.2; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; pointer-events:none; }
      #mpInventory .inventory-slot-state.active,#mpInventory .inventory-slot-state.worn { border-color:#f9e28a7a; background:#f9e28ae6; color:#182019; }
      #mpInventory .inventory-slot-state.assigned { border-color:#7ee8a26b; background:#26683dc2; color:#c8f7d8; }
      #mpInventory .inventory-slot-state.empty { border-color:#ffffff17; background:#0003; color:#b4cdb88f; }
      #mpInventory .ies-unequip { top:3px; right:3px; width:18px; height:18px; border:1px solid #ffffff1f; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; background:#030906ad; opacity:.75; }

      #mpInventory button:focus-visible,#mpInventory [role='button']:focus-visible { outline:2px solid #f9e28af2; outline-offset:2px; }
      #${DEBUG_BUTTON_ID} { position:absolute; right:4px; bottom:4px; z-index:5; padding:3px 6px; border:1px solid #6ec6f057; border-radius:999px; background:#061114c2; color:#aae1f5e6; font-size:max(7px,calc(.68 * var(--inv-font-xs))); line-height:1.2; opacity:.74; }
      #${DEBUG_BUTTON_ID}:hover { opacity:1; background:#0a1f25eb; }

      @media (pointer:coarse) { #mpInventory .inv-item-box:not(.empty):hover,#mpInventory .inv-equip-slot[role='button']:hover { transform:none; } #mpInventory .ii-btn { min-height:32px; } #mpInventory .ies-unequip { width:21px; height:21px; } }
      @media (prefers-reduced-motion:reduce) { #mpInventory .inv-sub-tab,#mpInventory .inv-cat,#mpInventory .inv-item-box,#mpInventory .inv-equip-slot,#mpInventory .ii-btn { transition:none!important; } }
    `;
    document.head.appendChild(style);
  }

  function installObserver() {
    const pane = document.getElementById('mpInventory'); // Mutation root shared by both inventory views.
    if (!pane || inventoryObserver) return;
    inventoryObserver = new MutationObserver(scheduleDecorate);
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
    decoratePackSlots();
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

  function decorateGearSlots() {
    document.querySelectorAll('#mpInventory .inv-equip-slot').forEach((slot) => {
      const title = slot.title || ''; // Existing gear titles are the source of item/slot status truth.
      const empty = title.includes('(empty)');
      const inertEmptyClothing = slot.classList.contains('clothing-slot') && !slot.classList.contains('occupied');
      slot.classList.toggle('gear-empty-slot', empty);
      decorateOwnedGearName(slot, title);

      let state = '', tone = '';
      if (slot.classList.contains('clothing-owned-slot') && slot.classList.contains('active-slot')) { state = 'Worn'; tone = 'worn'; }
      else if (slot.classList.contains('clothing-slot')) { state = slot.classList.contains('occupied') ? 'Worn' : 'Empty'; tone = slot.classList.contains('occupied') ? 'worn' : 'empty'; }
      else if (empty) { state = 'Empty'; tone = 'empty'; }
      else if (slot.classList.contains('active-slot')) { state = 'Active'; tone = 'active'; }
      else if (/^(hoe|shovel|axe|pick|harpoon|weapon):/i.test(title)) { state = 'Assigned'; tone = 'assigned'; }
      setSlotState(slot, state, tone);

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
      const itemName = title.split(' — ')[0].trim(); // Full clothing name is already present in the stable title string.
      if (itemName) {
        const name = document.createElement('span'); name.className = 'ies-cloth-name gear-owned-clothing-name'; name.textContent = itemName;
        if (label) slot.insertBefore(name, label); else slot.appendChild(name);
      }
    }
  }

  function setSlotState(slot, text, tone) {
    let chip = slot.querySelector(':scope > .inventory-slot-state'); // Status chip distinguishes active/assigned/worn/empty at a glance.
    if (!text) { chip?.remove(); return; }
    if (!chip) { chip = document.createElement('span'); chip.className = 'inventory-slot-state'; slot.appendChild(chip); }
    const wantedClass = `inventory-slot-state ${tone}`.trim();
    if (chip.className !== wantedClass) chip.className = wantedClass;
    if (chip.textContent !== text) chip.textContent = text;
  }

  function makeKeyboardClickable(element, label) {
    element.setAttribute('role', 'button'); element.tabIndex = 0; element.setAttribute('aria-label', label);
    if (element.dataset.inventoryUiKeyboard === '1') return;
    element.dataset.inventoryUiKeyboard = '1';
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); element.click();
    });
  }

  function decorateInfoPanel() {
    const pane = document.getElementById('mpInventory'); // Active mode selects the most useful empty-state instruction.
    const empty = document.getElementById('iiEmpty');
    if (!pane || !empty) return;
    empty.textContent = pane.classList.contains('inv-mode-gear')
      ? 'Select a gear slot or owned item to inspect, equip, or assign it.'
      : 'Select an item to see its details and available actions.';
  }

  function ensureDebugButton() {
    const pane = document.getElementById('mpInventory'); // Dev-only button exposes existing layout bounds without DevTools.
    if (!pane || !deps?.isDevMode?.() || document.getElementById(DEBUG_BUTTON_ID)) return;
    const button = document.createElement('button');
    button.id = DEBUG_BUTTON_ID; button.type = 'button'; button.title = 'Toggle inventory layout debug boundaries';
    button.addEventListener('click', () => {
      const menu = document.getElementById('menuPanel');
      if (!menu) return;
      const enabled = menu.classList.toggle('inv-debug');
      updateDebugButton(); deps?.showToast?.(`Inventory UI bounds ${enabled ? 'on' : 'off'}.`, true);
    });
    pane.appendChild(button); updateDebugButton();
  }

  function updateDebugButton() {
    const button = document.getElementById(DEBUG_BUTTON_ID); // Button text mirrors the existing inv-debug class.
    if (!button) return;
    const enabled = document.getElementById('menuPanel')?.classList.contains('inv-debug');
    button.textContent = enabled ? 'UI BOUNDS ON' : 'UI BOUNDS'; button.setAttribute('aria-pressed', String(Boolean(enabled)));
  }

  function debugSnapshot() {
    const pane = document.getElementById('mpInventory'); // Snapshot supports future in-game bug reports without console access.
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

  window.InventoryUI = { init, decorate, debugSnapshot };
})();
