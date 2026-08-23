// Dedicated gameplay action-arch artwork and combat tap/hold presentation.
// Keeps equipment/inventory sprites out of the HUD controls while leaving the
// underlying input, loadout, cooldown, and action logic in game.js untouched.
(() => {
  'use strict';
  if (window.ActionArchIcons?.installed) return;

  const ICON_BASE = new URL('assets/hud/action_icons/', document.baseURI).href; // Base path used for all dedicated HUD PNGs.
  const ICON_FILES = Object.freeze([
    'ammo_select.png',
    'charged_attack.png',
    'defensive_attack.png', // Intentionally routed now; the PNG can be uploaded later without another code change.
    'draw_melee.png',
    'draw_pick.png',
    'draw_ranged.png',
    'draw_shovel.png',
    'flurry_attack.png',
    'item_select.png',
    'potion_select.png',
    'quick_attack.png',
    'tool_select.png',
  ]);
  const iconLoadState = new Map(); // filename -> preload record used to avoid ever attaching a broken <img>.
  const comboState = new Map(); // combo ability id -> { nextStep, lastTriggeredAt } for the next-tap HUD indicator.
  const comboRasterCache = new Map(); // next-step number -> composed white draw-melee/numeral data URL.
  let refreshQueued = false; // Coalesces DOM/input/loadout changes into one HUD refresh frame.
  let observer = null; // Stored for debug status and duplicate-install protection.
  let combatWrapped = false; // Prevents wrapping Combat.beginStagedAction more than once.
  let refreshTimer = 0; // Low-frequency loadout/combo-expiry watcher.

  const STATIC_ICON_BY_ID = Object.freeze({
    btnAmmoSelect: 'ammo_select.png',
    potionBtn: 'potion_select.png',
    toolBtn: 'tool_select.png',
    itemBtn: 'item_select.png',
  });

  const TOOL_SLOT_ICON_BY_LABEL = Object.freeze({
    shovel: 'draw_shovel.png',
    pick: 'draw_pick.png',
    weapon: 'draw_melee.png',
    melee: 'draw_melee.png',
    'melee weapon': 'draw_melee.png',
    ranged: 'draw_ranged.png',
    'ranged weapon': 'draw_ranged.png',
  });

  const COMBO_ROTATION_DEG = Object.freeze({ 1: -90, 2: -45, 3: 0 });
  const COMBAT_ACTION_BY_SLOT = Object.freeze({ 1: 'cut', 2: 'slash' }); // Maps Combat.input slots to the semantic weapon actions game.js places on the arch.
  const ACTION_BUTTON_IDS = Object.freeze(['btnAction1', 'btnAction2', 'btnAction3']); // Buttons world context can repopulate/reorder.

  function injectStyles() {
    if (document.getElementById('actionArchIconStyles')) return;
    const style = document.createElement('style');
    style.id = 'actionArchIconStyles';
    style.textContent = `
      /* Dedicated art is authored black; the live HUD always presents it white. */
      .action-arch-png, .combat-combo-raster {
        filter: brightness(0) invert(1);
      }

      /* Outermost permanent arch: exactly 25% larger hit areas than the authored 0.6-col controls. */
      #toolSelect button:not(#btnMeleeAutoTarget),
      #btnAmmoSelect, #potionBtn {
        width: clamp(33px, calc(0.75 * var(--col)), 46px) !important;
        height: clamp(33px, calc(0.75 * var(--col)), 46px) !important;
      }
      #toolSelect #btnMeleeAutoTarget {
        width: clamp(38px, calc(0.875 * var(--col)), 53px) !important;
        height: clamp(38px, calc(0.875 * var(--col)), 53px) !important;
      }

      .action-arch-png {
        width: 78%; height: 78%;
        display: block; margin: auto;
        object-fit: contain; pointer-events: none;
      }
      .arc-slot .action-arch-png { width: 74%; height: 74%; }

      /* Weapon action buttons are two-sided coins: tap attack front, held attack back. */
      .combat-dual-input .abt-icon {
        position: absolute !important;
        inset: 0;
        width: 100%; height: 100%;
        font-size: inherit !important;
        display: block;
        overflow: visible;
        pointer-events: none;
      }
      .combat-coin {
        position: absolute;
        inset: 0;
        perspective: 260px;
        pointer-events: none;
      }
      .combat-coin-inner {
        position: absolute;
        inset: 0;
        transform-style: preserve-3d;
        transition: transform 155ms cubic-bezier(.2,.72,.22,1);
        will-change: transform;
      }
      .combat-dual-input.combat-hold-flipped .combat-coin-inner {
        transform: rotateY(180deg);
      }
      .combat-coin-face {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        border-radius: 50%;
        overflow: hidden;
      }
      .combat-coin-back { transform: rotateY(180deg); }
      .combat-main-symbol {
        position: absolute;
        left: 18%; top: 18%;
        width: 64%; height: 64%;
        display: grid; place-items: center;
      }
      .combat-main-symbol .action-arch-png,
      .combat-main-symbol .combat-combo-raster {
        width: 100%; height: 100%; object-fit: contain;
      }
      .combat-hold-exponent {
        position: absolute;
        right: 8%; top: 6%;
        width: 27%; height: 27%;
        display: grid; place-items: center;
        transform: translate(16%, -16%);
        filter: drop-shadow(0 1px 2px rgba(0,0,0,.65));
      }
      .combat-hold-exponent .action-arch-png { width: 100%; height: 100%; }
      .combat-slot-x {
        display: grid; place-items: center;
        width: 100%; height: 100%;
        color: #fff;
        font-family: 'KhymeryyanRomanLetters+Numbers', 'DM Mono', monospace;
        font-weight: 800;
        line-height: 1;
        font-size: 1.45em;
        text-shadow: 0 1px 3px rgba(0,0,0,.9);
      }
      .combat-hold-exponent .combat-slot-x { font-size: 0.9em; }
      .combat-combo-raster { display: block; }

      @media (prefers-reduced-motion: reduce) {
        .combat-coin-inner { transition-duration: 1ms; }
      }
    `;
    document.head.appendChild(style);
  }

  function report(message, level = 'items') {
    if (typeof window.__farmLog === 'function') window.__farmLog(`[action-arch-icons] ${message}`, level);
  }

  function preloadIcon(file) {
    const existing = iconLoadState.get(file);
    if (existing) return existing;
    const record = {
      file,
      url: new URL(file, ICON_BASE).href,
      state: 'loading',
      image: null,
    };
    iconLoadState.set(file, record);
    const image = new Image();
    record.image = image;
    image.onload = () => {
      record.state = 'loaded';
      if (file === 'draw_melee.png') comboRasterCache.clear();
      queueRefresh();
    };
    image.onerror = () => {
      record.state = 'failed';
      // defensive_attack.png is intentionally wired before the asset exists.
      // Keep its X fallback quiet; every other missing file is unexpected.
      if (file !== 'defensive_attack.png') report(`Failed to load ${record.url}; keeping the generic/X fallback.`, 'error');
      queueRefresh();
    };
    image.src = record.url;
    return record;
  }

  function loadedIcon(file) {
    const record = preloadIcon(file);
    return record.state === 'loaded' ? record : null;
  }

  function createDedicatedImage(file, alt = '') {
    const record = loadedIcon(file);
    if (!record) return null;
    const img = document.createElement('img');
    img.src = record.url;
    img.alt = alt;
    img.draggable = false;
    img.className = 'action-arch-png';
    img.dataset.actionArchIcon = file;
    return img;
  }

  function createX() {
    const span = document.createElement('span');
    span.className = 'combat-slot-x';
    span.textContent = 'X';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  function normalize(value) {
    return String(value || '')
      .replace(/[_&/\\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function visibleLabel(element) {
    return normalize(
      element?.getAttribute?.('aria-label') ||
      element?.title ||
      element?.querySelector?.('.arc-label, .abt-label, .ts-lbl')?.textContent ||
      element?.textContent || ''
    );
  }

  function iconHost(element) {
    if (!element) return null;
    if (element.id === 'toolBtn') return element.querySelector('#toolBtnIcon') || element;
    if (element.id === 'btnWeaponSwitch') return element.querySelector('#btnWeaponSwitchIcon') || element.querySelector('.abt-icon') || element;
    if (element.classList?.contains('arc-slot')) return element.querySelector('.arc-icon') || element;
    return element.querySelector('.abt-icon') || element;
  }

  function staticIconFor(element) {
    if (!element) return null;
    const byId = STATIC_ICON_BY_ID[element.id];
    if (byId) return byId;
    if (element.id === 'btnWeaponSwitch') {
      const label = visibleLabel(element).toLowerCase();
      if (label.includes('ranged')) return 'draw_ranged.png';
      if (label.includes('melee')) return 'draw_melee.png';
    }
    if (element.classList?.contains('arc-slot')) {
      const label = normalize(element.querySelector('.arc-label')?.textContent).toLowerCase();
      return TOOL_SLOT_ICON_BY_LABEL[label] || null;
    }
    return null;
  }

  function applyStaticIcon(element) {
    const file = staticIconFor(element);
    if (!file) return false;
    const record = loadedIcon(file);
    if (!record) return false;
    const host = iconHost(element);
    if (!host) return false;
    if (host.querySelector?.(`img[data-action-arch-icon="${file}"]`)) return true;
    const image = createDedicatedImage(file, visibleLabel(element));
    if (!image) return false;
    host.replaceChildren(image);
    host.style.display = 'inline-flex';
    host.style.alignItems = 'center';
    host.style.justifyContent = 'center';
    if (host.id === 'toolBtnIcon') {
      host.style.width = '100%';
      host.style.height = '100%';
    }
    element.dataset.actionArchIcon = file;
    return true;
  }

  function attackTypeFor(abilityId, def) {
    if (!abilityId || !def) return null;
    if (def.category === 'combo') return 'combo';
    if (def.category === 'quickAttack') return 'quick';
    if (def.category === 'defensiveHold') return 'defensive';
    // Offensive hold is a broad loadout category; distinguish the actual
    // move type from the registered ability itself rather than the slot.
    const descriptor = `${abilityId} ${def.label || ''}`.toLowerCase();
    if (descriptor.includes('flurry')) return 'flurry';
    if (descriptor.includes('charged') || descriptor.includes('charge') || descriptor.includes('breaker')) return 'charged';
    return null;
  }

  function iconForAttackType(type) {
    return ({
      quick: 'quick_attack.png',
      charged: 'charged_attack.png',
      flurry: 'flurry_attack.png',
      defensive: 'defensive_attack.png',
    })[type] || null;
  }

  function comboNextStep(comboId) {
    const state = comboState.get(comboId);
    if (!state) return 1;
    const resetS = Number(window.Combat?.comboData?.COMBO_RESET_S) || 0.9;
    if (performance.now() - state.lastTriggeredAt > resetS * 1000) return 1;
    return state.nextStep || 1;
  }

  function installCombatActionTracker() {
    const combat = window.Combat;
    if (!combat || combatWrapped || typeof combat.beginStagedAction !== 'function') return false;
    const originalBegin = combat.beginStagedAction;
    combat.beginStagedAction = function actionArchTrackedBeginStagedAction(opts) {
      const action = originalBegin.apply(this, arguments);
      const comboId = opts?.data?.comboId;
      const comboStep = Number(opts?.data?.comboStep);
      if (comboId && Number.isInteger(comboStep)) {
        const stepCount = Array.isArray(combat.comboData?.[comboId]) ? combat.comboData[comboId].length : 3;
        const nextStep = ((comboStep + 1) % Math.max(1, stepCount)) + 1;
        comboState.set(comboId, { nextStep, lastTriggeredAt: performance.now() });
        queueRefresh();
      }
      return action;
    };
    combatWrapped = true;
    return true;
  }

  function ensureFontThenRefresh() {
    if (!document.fonts?.ready) return;
    document.fonts.ready.then(() => {
      comboRasterCache.clear();
      queueRefresh();
    }).catch(() => {});
  }

  function comboRaster(step) {
    step = Math.min(3, Math.max(1, Number(step) || 1));
    if (comboRasterCache.has(step)) return comboRasterCache.get(step);
    const record = loadedIcon('draw_melee.png');
    if (!record?.image?.naturalWidth) return null;

    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const image = record.image;
    const maxSide = 94;
    const scale = Math.min(maxSide / image.naturalWidth, maxSide / image.naturalHeight);
    const dw = image.naturalWidth * scale;
    const dh = image.naturalHeight * scale;
    const rotation = (COMBO_ROTATION_DEG[step] ?? 0) * Math.PI / 180;

    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(rotation);
    ctx.drawImage(image, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);

    const numeral = String(step);
    const font = `700 56px "KhymeryyanRomanLetters+Numbers", "DM Mono", monospace`;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    ctx.globalCompositeOperation = 'destination-out';
    ctx.save();
    ctx.filter = 'blur(1.6px)';
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(0,0,0,.92)';
    ctx.strokeText(numeral, size / 2, size / 2 + 2);
    ctx.fillText(numeral, size / 2, size / 2 + 2);
    ctx.restore();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#000';
    ctx.strokeText(numeral, size / 2, size / 2 + 2);
    ctx.fillText(numeral, size / 2, size / 2 + 2);

    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = '#fff';
    ctx.font = font;
    ctx.fillText(numeral, size / 2, size / 2 + 2);

    let url = null;
    try { url = canvas.toDataURL('image/png'); } catch (_) {}
    if (url) comboRasterCache.set(step, url);
    return url;
  }

  function mainSymbolFor(slotId) {
    const combat = window.Combat;
    const abilityId = combat?.loadout?.getSlot?.(slotId) || null;
    const def = abilityId ? combat?.abilities?.get?.(abilityId) : null;
    const type = attackTypeFor(abilityId, def);

    if (type === 'combo') {
      const step = comboNextStep(abilityId);
      const url = comboRaster(step);
      if (!url) return { node: createX(), key: `combo:${abilityId}:${step}:pending`, label: def?.label || 'Combo' };
      const img = document.createElement('img');
      img.src = url;
      img.alt = `${def?.label || 'Combo'} — next attack ${step}`;
      img.draggable = false;
      img.className = 'combat-combo-raster';
      return { node: img, key: `combo:${abilityId}:${step}`, label: img.alt };
    }

    const file = iconForAttackType(type);
    const image = file ? createDedicatedImage(file, def?.label || abilityId || '') : null;
    if (image) return { node: image, key: `${type}:${abilityId}:${file}`, label: def?.label || abilityId || type };
    return { node: createX(), key: `x:${slotId}:${abilityId || 'empty'}:${type || 'unknown'}`, label: abilityId ? `${def?.label || abilityId} icon unavailable` : 'No ability slotted' };
  }

  function actionButtons() {
    return ACTION_BUTTON_IDS.map(id => document.getElementById(id)).filter(Boolean);
  }

  function combatButtonForSlot(slotIndex) {
    const action = COMBAT_ACTION_BY_SLOT[slotIndex];
    if (!action || !window.Combat?.loadout) return null;
    return actionButtons().find(button => !button.classList.contains('abt-hidden') && String(button.dataset.action || '').toLowerCase() === action) || null;
  }

  function clearStaleCombatOwnership(activeButtons) {
    actionButtons().forEach(button => {
      if (activeButtons.has(button)) return;
      button.classList.remove('combat-dual-input', 'combat-hold-flipped');
      button.removeAttribute('data-combat-icon-signature');
      button.removeAttribute('data-combat-slot');
      const contextLabel = button.querySelector('.abt-label')?.textContent?.trim(); // Restores the world action's accessible name after combat previously owned this physical button.
      if (contextLabel) button.setAttribute('aria-label', contextLabel);
      [...button.children].forEach(child => {
        if (child.classList?.contains('combat-hold-exponent')) child.remove();
      });
      const host = button.querySelector('.abt-icon');
      if (host) host.style.visibility = '';
    });
  }

  function renderCombatButton(slotIndex, button) {
    if (!button) return;
    const host = button.querySelector('.abt-icon');
    if (!host) return;

    const tap = mainSymbolFor(`tap${slotIndex}`);
    const hold = mainSymbolFor(`hold${slotIndex}`);
    const holding = Boolean(window.Combat?.input?.getState?.(slotIndex)?.holding);
    const signature = `${button.dataset.action || ''}|${tap.key}|${hold.key}|${holding ? 1 : 0}`;

    button.classList.add('combat-dual-input');
    button.classList.toggle('combat-hold-flipped', holding);
    button.dataset.combatSlot = String(slotIndex);
    const accessibleLabel = `${tap.label}; hold: ${hold.label}`;
    if (button.getAttribute('aria-label') !== accessibleLabel) button.setAttribute('aria-label', accessibleLabel);
    if (button.dataset.combatIconSignature === signature && host.querySelector('.combat-coin')) return;
    button.dataset.combatIconSignature = signature;

    const coin = document.createElement('span');
    coin.className = 'combat-coin';
    coin.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('span');
    inner.className = 'combat-coin-inner';

    const front = document.createElement('span');
    front.className = 'combat-coin-face combat-coin-front';
    const frontMain = document.createElement('span');
    frontMain.className = 'combat-main-symbol';
    frontMain.appendChild(tap.node);
    const exponent = document.createElement('span');
    exponent.className = 'combat-hold-exponent';
    exponent.appendChild(hold.node.cloneNode(true));
    front.append(frontMain, exponent);

    const back = document.createElement('span');
    back.className = 'combat-coin-face combat-coin-back';
    const backMain = document.createElement('span');
    backMain.className = 'combat-main-symbol';
    backMain.appendChild(hold.node);
    back.appendChild(backMain);

    inner.append(front, back);
    coin.appendChild(inner);
    host.replaceChildren(coin);
    host.style.visibility = 'visible';
  }

  function refreshCombatButtons() {
    installCombatActionTracker();
    const assignments = new Map(); // slot -> current physical button after world-context ordering.
    [1, 2].forEach(slotIndex => {
      const button = combatButtonForSlot(slotIndex);
      if (button) assignments.set(slotIndex, button);
    });
    clearStaleCombatOwnership(new Set(assignments.values()));
    assignments.forEach((button, slotIndex) => renderCombatButton(slotIndex, button));
  }

  function refreshStaticIcons() {
    document.querySelectorAll('#toolBtn, #itemBtn, #btnWeaponSwitch, #btnAmmoSelect, #potionBtn, .arc-slot').forEach(applyStaticIcon);
  }

  function refresh() {
    refreshQueued = false;
    refreshStaticIcons();
    refreshCombatButtons();
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(refresh);
  }

  function debugSnapshot() {
    const combat = window.Combat;
    const assignments = Object.fromEntries([1, 2].map(slotIndex => [
      `slot${slotIndex}`,
      combatButtonForSlot(slotIndex)?.id || null,
    ]));
    return {
      installed: Boolean(observer),
      iconBase: ICON_BASE,
      icons: Object.fromEntries(ICON_FILES.map(file => [file, iconLoadState.get(file)?.state || 'not-requested'])),
      combatActive: Boolean(assignments.slot1 || assignments.slot2),
      assignments,
      actions: Object.fromEntries(actionButtons().map(button => [button.id, button.dataset.action || null])),
      loadout: combat?.loadout?.get?.() || null,
      input1: combat?.input?.getState?.(1) || null,
      input2: combat?.input?.getState?.(2) || null,
      combo: [...comboState.entries()].map(([id, state]) => ({ id, ...state, shownNextStep: comboNextStep(id) })),
    };
  }

  function install() {
    if (observer) return;
    injectStyles();
    ICON_FILES.forEach(preloadIcon);
    ensureFontThenRefresh();
    installCombatActionTracker();

    window.addEventListener('hobunji-combat-input-state', queueRefresh);
    window.addEventListener('hobunjiPlayerReady', queueRefresh);

    observer = new MutationObserver(queueRefresh);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-action', 'aria-label', 'class', 'title'],
    });

    // Loadout changes are intentionally owned by combat-loadout.js and do not
    // currently emit an event. This cheap watcher also resets combo artwork as
    // soon as COMBO_RESET_S expires without adding a dependency back to game.js.
    refreshTimer = window.setInterval(queueRefresh, 100);
    refresh();
  }

  window.ActionArchIcons = {
    installed: false,
    refresh: queueRefresh,
    debugSnapshot,
    files: ICON_FILES,
    combatButtonForSlot,
    get iconBase() { return ICON_BASE; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      install();
      window.ActionArchIcons.installed = true;
    }, { once: true });
  } else {
    install();
    window.ActionArchIcons.installed = true;
  }
})();
