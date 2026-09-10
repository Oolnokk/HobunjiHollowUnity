// Action-arch readability layer.
//
// Adds two deliberately separate text treatments to gameplay arch controls:
// 1) a short centered meaning label over non-attack item/tool/utility icons;
// 2) the live configured keyboard/controller binding at the icon's lower-right,
//    positioned like a downward/rightward exponent. The centered label uses the
//    same white-text + heavy black cutout-outline language as combo numerals.
(() => {
  'use strict';

  if (window.ArchButtonLabels?.installed) return;

  const ACTION_SLOT_BY_BUTTON_ID = Object.freeze({
    btnAction1: 'action1',
    btnAction2: 'action2',
    btnAction3: 'action3',
    btnItemAction1: 'action4',
    btnItemAction2: 'action5',
  }); // Maps the five rendered action buttons to their configurable physical action slots.
  const FIXED_BINDING_ACTION_BY_BUTTON_ID = Object.freeze({
    dodgeBtn: 'dodge',
    btnWeaponSwitch: 'weaponSwitch',
    toolBtn: 'toolSelect',
    itemBtn: 'itemSelect',
    btnCallMount: 'toggleMount',
    btnUtilityMenu: 'utilityMenu',
    btnMeleeAutoTarget: 'meleeAutoTargetToggle',
    btnSwapTarget: 'swapTarget',
  }); // Maps permanent arch controls to the same semantic actions exposed in Settings.
  const FIXED_MEANING_BY_BUTTON_ID = Object.freeze({
    dodgeBtn: 'DODGE',
    btnWeaponSwitch: 'SWAP',
    toolBtn: 'TOOLS',
    itemBtn: 'ITEMS',
    btnCallMount: 'MOUNT',
    btnUtilityMenu: 'UTILITY',
    btnMeleeAutoTarget: 'TARGET',
    btnSwapTarget: 'TARGET',
    btnAmmoSelect: 'AMMO',
    potionBtn: 'POTION',
  }); // Keeps permanent-symbol wording short enough to remain legible across the icon itself.
  const ATTACK_ACTION_IDS = new Set([
    'cut', 'slash', 'stab', 'strike', 'attack', 'quick_attack', 'charged_attack',
    'flurry_attack', 'defensive_attack', 'melee_attack', 'ranged_attack',
  ]); // Prevents centered meaning text from being added to combat attacks; their existing combat icon treatment stays untouched.
  const DECORATED_SELECTOR = [
    '#dodgeBtn',
    '#toolSelect button',
    '#actionStack button',
    '#btnAmmoSelect',
    '#potionBtn',
  ].join(','); // Limits the observer/refresh work to gameplay arch controls rather than every button on the page.

  let refreshQueued = false; // Coalesces action-bar rebuilds and remap events into one animation-frame decoration pass.
  let observer = null; // Exposed in diagnostics so mobile testing can confirm dynamic action-bar rebuilds are being watched.

  function injectStyles() {
    if (document.getElementById('archButtonLabelStyles')) return;
    const style = document.createElement('style'); // Owns only the two text overlays and suppression of the older top-corner desktop badge.
    style.id = 'archButtonLabelStyles';
    style.textContent = `
      /* held-seed-desktop-capture still maintains this legacy badge for routing
         diagnostics; visually replace it with the unified live badge below. */
      #actionStack .abt-key { display:none !important; }

      .arch-meaning-label,
      .arch-input-binding {
        position:absolute;
        z-index:12;
        pointer-events:none;
        user-select:none;
        -webkit-user-select:none;
        color:#fff;
        font-family:'DM Mono','KhymeryyanRomanLetters+Numbers',monospace;
        font-weight:800;
        line-height:1;
        white-space:nowrap;
        paint-order:stroke fill;
        -webkit-font-smoothing:antialiased;
        text-rendering:geometricPrecision;
      }

      /* Visually matches the combo numeral's destination-out halo: the broad,
         dark stroke covers/cuts through whatever PNG/SVG/emoji sits beneath,
         then the white glyph is painted on top. */
      .arch-meaning-label {
        left:4%;
        right:4%;
        top:50%;
        transform:translateY(-50%);
        overflow:hidden;
        text-align:center;
        text-overflow:clip;
        font-size:clamp(6px, calc(0.155 * var(--col)), 9px);
        letter-spacing:-0.055em;
        -webkit-text-stroke:2.8px rgba(0,0,0,.96);
        text-shadow:0 0 2px #000, 0 0 3px #000;
      }
      .arch-meaning-label.long { font-size:clamp(5.5px, calc(0.135 * var(--col)), 8px); }
      .arch-meaning-label.very-long { font-size:clamp(5px, calc(0.115 * var(--col)), 7px); letter-spacing:-0.085em; }

      /* Mirrored counterpart to a top-right exponent: the binding hangs from
         the lower-right edge of the icon/button instead of sitting underneath. */
      .arch-input-binding {
        right:1%;
        bottom:1%;
        transform:translate(30%, 30%);
        max-width:92%;
        overflow:hidden;
        text-overflow:clip;
        text-align:right;
        font-size:clamp(5.5px, calc(0.125 * var(--col)), 8px);
        letter-spacing:-0.07em;
        -webkit-text-stroke:2.3px rgba(0,0,0,.96);
        text-shadow:0 0 2px #000, 0 0 3px #000;
      }

      #toolSelect button,
      #dodgeBtn,
      #actionStack button,
      #btnAmmoSelect,
      #potionBtn { overflow:visible; }
    `;
    document.head.appendChild(style);
  }

  function currentBindings() {
    return window.InputBindings?.getCurrentBindings?.() || null;
  }

  function defaultBinding(device, actionId) {
    const defaults = window.InputBindings?.getDefaultBindings?.(device); // Used only during boot or when a live binding map has not been initialized yet.
    if (defaults && Object.prototype.hasOwnProperty.call(defaults, actionId)) return defaults[actionId];
    const action = window.SCRATCHBONES_CONFIG?.game?.input?.actions?.find(entry => entry?.id === actionId); // Final authored fallback for early parser-time refreshes.
    return action?.[device] ?? null;
  }

  function bindingFor(device, actionId) {
    if (!actionId) return null;
    const live = currentBindings()?.[device]; // Used so Settings remaps update the badge immediately without reloading the game.
    if (live && Object.prototype.hasOwnProperty.call(live, actionId)) return live[actionId];
    return defaultBinding(device, actionId);
  }

  function compactDesktopBinding(code) {
    if (!code) return '';
    const pieces = String(code).split('+').map(piece => piece.trim()).filter(Boolean); // Used to preserve modifier chords while removing verbose browser-code prefixes.
    return pieces.map(piece => {
      if (piece === 'Shift') return '⇧';
      if (piece === 'Control' || piece === 'Ctrl') return '⌃';
      if (piece === 'Alt') return '⌥';
      if (piece === 'Meta') return '⌘';
      if (piece === 'Space') return 'SPC';
      if (piece === 'Enter') return 'ENT';
      if (piece === 'Escape') return 'ESC';
      if (piece === 'Comma') return ',';
      if (piece === 'Period') return '.';
      if (piece.startsWith('Key')) return piece.slice(3).toUpperCase();
      if (piece.startsWith('Digit')) return piece.slice(5);
      if (piece === 'ArrowUp') return '↑';
      if (piece === 'ArrowDown') return '↓';
      if (piece === 'ArrowLeft') return '←';
      if (piece === 'ArrowRight') return '→';
      if (piece.startsWith('Mouse')) return `M${Number(piece.slice(5)) + 1}`;
      return piece.replace(/^Button/, 'B').toUpperCase();
    }).join('');
  }

  function compactControllerBinding(code) {
    if (!code) return '';
    const labels = {
      Button0: 'A', Button1: 'B', Button2: 'X', Button3: 'Y',
      Button4: 'LB', Button5: 'RB', Button8: 'VIEW', Button9: 'MENU',
      Button10: 'L3', Button11: 'R3', Button12: 'D↑', Button13: 'D↓',
      Button14: 'D←', Button15: 'D→', LeftTrigger: 'LT', RightTrigger: 'RT',
      RightStickLeft: 'RS←', RightStickRight: 'RS→', RightStickUp: 'RS↑', RightStickDown: 'RS↓',
    }; // Standard Gamepad labels keep configured controller bindings readable in a subscript-sized marker.
    return labels[code] || String(code).replace(/^Button/, 'B').toUpperCase();
  }

  function bindingText(actionId) {
    if (!actionId) return '';
    const desktop = compactDesktopBinding(bindingFor('desktop', actionId)); // Shown first so keyboard-only players retain the familiar left-to-right reading order.
    const controller = compactControllerBinding(bindingFor('controller', actionId)); // Shown alongside desktop when both inputs are configured.
    return [desktop, controller].filter(Boolean).join('·') || '—';
  }

  function bindingActionForButton(button) {
    if (!button?.id) return null;
    return FIXED_BINDING_ACTION_BY_BUTTON_ID[button.id]
      || ACTION_SLOT_BY_BUTTON_ID[button.id]
      || null;
  }

  function normalizedText(value) {
    return String(value || '').replace(/[_/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function visibleActionLabel(button) {
    return normalizedText(
      button?.querySelector?.('.abt-label, .ts-lbl, .arc-label')?.textContent
      || button?.getAttribute?.('aria-label')
      || button?.title
      || ''
    );
  }

  function isAttackButton(button) {
    if (!button) return false;
    if (button.classList?.contains('combat-dual-input') || button.dataset?.combatSlot) return true;
    const action = normalizedText(button.dataset?.action).toLowerCase().replace(/\s+/g, '_'); // Used for the brief frame before combat decoration classes are applied.
    return ATTACK_ACTION_IDS.has(action);
  }

  function compactMeaning(value) {
    const text = normalizedText(value).toUpperCase(); // Used to preserve the actual visible action wording rather than inventing a second action vocabulary.
    if (!text) return '';
    const stripped = text
      .replace(/^HOLD (TO )?/, '')
      .replace(/^TAP (TO )?/, '')
      .replace(/^SELECT /, '')
      .replace(/^USE /, 'USE ')
      .trim(); // Removes interaction-instruction boilerplate that does not describe what the icon itself means.
    if (stripped.length <= 16) return stripped;
    const words = stripped.split(' '); // Used to keep long generated labels readable without shrinking them into illegibility.
    if (words.length > 1 && words[0].length <= 12) return words[0];
    return stripped.slice(0, 15);
  }

  function meaningForButton(button) {
    if (!button || isAttackButton(button)) return '';
    const fixed = FIXED_MEANING_BY_BUTTON_ID[button.id];
    if (fixed) return fixed;
    if (!button.closest?.('#actionStack')) return '';
    return compactMeaning(visibleActionLabel(button));
  }

  function ensureTextOverlay(button, className, text) {
    let overlay = [...(button?.children || [])].find(child => child.classList?.contains(className)) || null; // Direct-child lookup avoids confusing labels embedded inside dynamically rebuilt icon hosts.
    if (!text) {
      overlay?.remove?.();
      return null;
    }
    if (!overlay) {
      overlay = document.createElement('span'); // Used as the stable presentation layer that survives icon-host replacement by action-arch-icons.js.
      overlay.className = className;
      overlay.setAttribute('aria-hidden', 'true');
      button.appendChild(overlay);
    }
    if (overlay.textContent !== text) overlay.textContent = text;
    return overlay;
  }

  function decorateButton(button) {
    if (!button) return;
    const meaning = meaningForButton(button); // Centered only for non-attack actions per the player's request.
    const meaningOverlay = ensureTextOverlay(button, 'arch-meaning-label', meaning);
    if (meaningOverlay) {
      meaningOverlay.classList.toggle('long', meaning.length > 8 && meaning.length <= 12);
      meaningOverlay.classList.toggle('very-long', meaning.length > 12);
    }

    const bindingAction = bindingActionForButton(button); // Used independently of meaning text so attack buttons can still show their configured physical input.
    const binding = bindingText(bindingAction);
    ensureTextOverlay(button, 'arch-input-binding', binding);
    if (bindingAction) button.dataset.archBindingAction = bindingAction;
    else delete button.dataset.archBindingAction;
  }

  function refresh() {
    refreshQueued = false;
    document.querySelectorAll(DECORATED_SELECTOR).forEach(decorateButton);
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(refresh);
  }

  function debugSnapshot() {
    return [...document.querySelectorAll(DECORATED_SELECTOR)].map(button => ({
      id: button.id || null,
      action: button.dataset?.action || null,
      attack: isAttackButton(button),
      meaning: button.querySelector?.(':scope > .arch-meaning-label')?.textContent || null,
      bindingAction: button.dataset?.archBindingAction || null,
      binding: button.querySelector?.(':scope > .arch-input-binding')?.textContent || null,
    }));
  }

  function install() {
    injectStyles();
    window.addEventListener('hobunji-input-bindings-changed', queueRefresh);
    window.addEventListener('hobunji-input-bindings-reset', queueRefresh);
    window.addEventListener('hobunjiPlayerReady', queueRefresh);
    observer = new MutationObserver(queueRefresh); // Watches contextual item/tool actions because refreshActionBar rebuilds their icon/label contents frequently.
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-action', 'data-combat-slot', 'aria-label', 'class', 'title'],
    });
    queueRefresh();
  }

  window.ArchButtonLabels = {
    installed: true,
    refresh: queueRefresh,
    getDebug: debugSnapshot,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
