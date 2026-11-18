(() => {
  'use strict';

  // Contextual bottom-of-screen "press X to do Y" action prompt, extracted
  // out of game.js following the same window.<Namespace> + init(deps)
  // pattern as js/dye-system.js. Shared across the game (fishing is the
  // first caller) — resolves its own key/button/icon label from the
  // player's current input device so callers only ever describe *what*
  // the action does, never how to trigger it on any particular device.
  //
  // lastInputDevice is a game.js `let`, reassigned on every device switch,
  // so it's threaded through as a getter rather than a captured reference.
  // inputBindings is a game.js `const`, only ever mutated in place, so a
  // direct reference is safe.
  let deps = null;
  function init(injectedDeps) {
    deps = injectedDeps;
    ensureDialogueChoiceSelectionStyle();
  }

  // Dialogue rows already receive .ctrl-nav-focus from the shared controller/
  // keyboard navigator. Make that state obvious inside the choice container
  // itself instead of relying only on the generic outer glow.
  function ensureDialogueChoiceSelectionStyle() {
    if (document.getElementById('dialogueChoiceSelectionStyle')) return;
    const style = document.createElement('style'); // Used by the NPC dialogue row focus state below.
    style.id = 'dialogueChoiceSelectionStyle';
    style.textContent = `
      #npcDialogue .dlg-opt.ctrl-nav-focus,
      #npcDialogue .dlg-opt:focus-visible {
        background: rgba(249, 226, 138, 0.18) !important;
        outline: 2px solid var(--accent) !important;
        outline-offset: -2px !important;
        box-shadow: inset 0 0 0 1px rgba(249, 226, 138, 0.42), 0 0 14px rgba(249, 226, 138, 0.26) !important;
        color: #fff;
      }
    `;
    document.head.appendChild(style);
  }

  function getLastInputDevice() {
    return deps?.getLastInputDevice?.() || null;
  } // Shared by HUD affordances that need to mirror the same canonical last-input state as world action prompts.


  const ARCH_ACTIONS = Object.freeze(['action1', 'action2', 'action3', 'itemAction1', 'itemAction2']); // Shared physical arch slots used by game.js and the ruin adapter.
  const TOUCH_ACTION_LABELS = Object.freeze({
    action1: 'Action 1', action2: 'Action 2', action3: 'Action 3',
    itemAction1: 'Item Action 1', itemAction2: 'Item Action 2',
    jump: 'Jump', dodge: 'Dodge', toolSelect: 'Tool Select',
  }); // Names printed beside actionable touch-world prompts.

  function currentBindings() {
    return window.InputBindings?.getCurrentBindings?.() || deps?.inputBindings || {};
  } // Uses live remaps with the initialized game.js binding reference as fallback.

  function controllerActionAvailable(actionId, requireOwnership = false) {
    const binding = currentBindings().controller?.[actionId]; // Physical key currently assigned to this semantic action.
    if (!binding) return false;
    const owner = window.InputBindings?.resolveActionForButton?.('controller', binding); // Applies dungeon Jump priority and other contextual remaps.
    return owner === actionId || (!requireOwnership && !owner);
  }

  function requiresInteractFallback(device = getLastInputDevice()) {
    return device === 'touch' || (device === 'controller' && !controllerActionAvailable('interact'));
  } // Touch has no Interact key; inside ruins the controller's Interact key may be claimed by Jump.

  function createActionArchLayout(buttons, heldMode, sitInteraction) {
    const nonClimbBtns = buttons.filter(b => b.action !== 'climb_branch' && b.nativeInput !== true); // Only these occupy the five physical action buttons.
    const isItemButton = b => b.inputAction === 'itemAction1' || b.inputAction === 'itemAction2'
      || b.action === 'consume_held_item' || b.action === 'consume_food_item' || b.action === 'play_instrument'
      || b.action.startsWith('alchemy_flask_') || b.action.startsWith('plant_')
      || b.action.startsWith('place_') || b.action.startsWith('spawn_'); // Item-owned actions use separate arch slots in tool mode.
    const toolBtns = nonClimbBtns.filter(b => !isItemButton(b)); // Used by active-action selection and the physical tool arch.
    const itemBtns = nonClimbBtns.filter(isItemButton); // Used by the physical item arch.
    const slots = heldMode === 'item' && !sitInteraction
      ? [nonClimbBtns[0], nonClimbBtns[1], nonClimbBtns[2], nonClimbBtns[3], nonClimbBtns[4]]
      : [toolBtns[0], toolBtns[1], toolBtns[2], itemBtns[0], itemBtns[1]]; // One layout supplies both the buttons and their floating hints.
    return { nonClimbBtns, toolBtns, itemBtns, slots };
  }

  function worldPromptLabel(actionId, device = getLastInputDevice(), touchIcon = '✋', touchOverride = null) {
    if (!actionId) return '';
    if (device === 'touch') return actionId === 'interact' ? '' : (touchOverride || TOUCH_ACTION_LABELS[actionId] || touchIcon);
    return actionPromptGlyph(actionId, null, device);
  } // Shared renderer for game.js prompts and the direct native-ruin popup.

  function resolveWorldPromptInputs(buttons, archLayout = null, device = getLastInputDevice()) {
    return buttons.map(button => {
      const physicalSlot = archLayout?.slots?.indexOf(button) ?? -1; // Prompt-only casks and native Dodge rows have no tool arch slot.
      const archAction = physicalSlot >= 0 ? ARCH_ACTIONS[physicalSlot] : null; // Physical input, not the arbitrary order of actions supplied.
      const useArch = button.inputAction === 'interact' && physicalSlot >= 0 && requiresInteractFallback(device); // Interact is unavailable on touch or Jump-owned controllers.
      const archAvailable = device !== 'controller' || controllerActionAvailable(archAction); // Don't suggest an unbound/stolen controller arch key.
      const actionId = (useArch ? (archAvailable ? archAction : '') :
        button.inputAction || (button.action === 'climb_branch' ? 'jump' : archAction)) || '';
      const touchOverride = button.touchInputLabel || (physicalSlot >= 0 ? TOUCH_ACTION_LABELS[archAction] : null); // Name the real touch arch button, including item slots.
      return {
        actionId,
        label: worldPromptLabel(actionId, device, button.icon, touchOverride),
        color: actionId ? actionPromptColor(actionId) : '#B8C5C0',
      };
    });
  }

  let actionPromptEls = null;
  let pressAction = null; // Used by the retained pointer handler so frame updates don't create new closures.
  let cancelAction = null; // Used by the retained cancel handler while the prompt is visible.
  const styleDebug = { refreshes: 0, appliedWrites: 0, skippedWrites: 0 }; // Used by the mobile Pixel Probe HUD style report.
  const lastWrittenHtml = new WeakMap(); // element -> last source string written to innerHTML
  function setPromptText(element, property, value) {
    // innerHTML reads re-serialize the subtree and come back browser-normalised (<img> attribute
    // quoting, entities), so they never equal the source string for icon markup: compare against what
    // this module last wrote instead, which makes the identical-value skip actually hit.
    const current = property === 'innerHTML' ? lastWrittenHtml.get(element) : element[property];
    if (current !== value) {
      element[property] = value;
      if (property === 'innerHTML') lastWrittenHtml.set(element, value);
      styleDebug.appliedWrites++;
    }
    else styleDebug.skippedWrites++;
  }
  function setPromptDisplay(element, display) {
    if (element.style.display !== display) { element.style.display = display; styleDebug.appliedWrites++; }
    else styleDebug.skippedWrites++;
  }
  function buildActionPromptDom() {
    if (actionPromptEls) return;
    const el = document.getElementById('actionPrompt');
    if (!el) return;
    // World prompts use the same stacked list-row treatment as merchant
    // dialogue choices, including when there is only one available action.
    el.innerHTML = `
      <div class="ap-list">
        <button class="dlg-opt dlg-opt-visible ap-world-option ap-btn" id="apBtn"></button>
        <button class="dlg-opt dlg-opt-visible ap-world-option ap-cancel" id="apCancel"></button>
      </div>
      <div class="ap-status" id="apStatus"></div>
      <div class="ap-panic-wrap" id="apPanicWrap"><div class="ap-panic-fill" id="apPanicFill"></div></div>`;
    actionPromptEls = {
      el,
      btn: document.getElementById('apBtn'),
      cancel: document.getElementById('apCancel'),
      status: document.getElementById('apStatus'),
      panicWrap: document.getElementById('apPanicWrap'),
      panicFill: document.getElementById('apPanicFill'),
    };
    actionPromptEls.btn.onpointerup = event => { event.stopPropagation(); pressAction?.(); };
    actionPromptEls.cancel.onpointerup = event => { event.stopPropagation(); cancelAction?.(); };
  }

  // Real key/button label on desktop/controller, taken from the player's
  // actual current bindings (not just the defaults) so a rebound key shows
  // correctly here too. Touch has no key to name, so callers pass the same
  // icon already shown for that action in the tool arch (see e.g. the
  // harpoon's 🎣 fallback in _openToolArc).
  function actionPromptGlyph(actionId, touchIcon, device = getLastInputDevice()) {
    if (!actionId) return '';
    if (device === 'touch') return touchIcon || '👆';
    if (device === 'controller' && !controllerActionAvailable(actionId)) return ''; // Never advertise a button stolen by Jump or another action.
    const desktopOrPad = device === 'controller' ? 'controller' : 'desktop'; // Keyboard and mouse share desktop bindings.
    const binding = currentBindings()[desktopOrPad]?.[actionId]; // Live remaps, rather than stale defaults.
    return binding ? window.InputBindings.buttonLabel(binding) : '';
  }

  function actionPromptColor(actionId) {
    return window.ActionArchSlotColors?.inputColors?.[actionId] || '#B8C5C0';
  }

  function showActionPrompt({ actionId, touchIcon, verb, onPress, cancelText, onCancel, statusText, statusType, panicPercent }) {
    buildActionPromptDom();
    if (!actionPromptEls) return;
    styleDebug.refreshes++;
    const glyph = actionPromptGlyph(actionId, touchIcon);
    // The prompt can refresh each frame during fishing and moving ruin puzzles.
    // Write only changed values: assigning identical HTML, classes or styles
    // creates DOM mutations that fan out through the other HUD observers.
    const lastInputDevice = getLastInputDevice();
    const buttonHtml = lastInputDevice === 'touch' ? `${glyph} ${verb}` : `[${glyph}] ${verb}`; // Retains authored touch image markup.
    setPromptText(actionPromptEls.btn, 'innerHTML', buttonHtml);
    pressAction = onPress || null;

    if (cancelText && onCancel) {
      setPromptText(actionPromptEls.cancel, 'textContent', cancelText);
      setPromptDisplay(actionPromptEls.cancel, '');
      cancelAction = onCancel;
    } else {
      setPromptDisplay(actionPromptEls.cancel, 'none');
      cancelAction = null;
    }
    if (statusText) {
      setPromptText(actionPromptEls.status, 'textContent', statusText);
      setPromptText(actionPromptEls.status, 'className', 'ap-status' + (statusType ? ' ' + statusType : ''));
      setPromptDisplay(actionPromptEls.status, '');
    } else {
      setPromptDisplay(actionPromptEls.status, 'none');
    }
    if (panicPercent != null) {
      setPromptDisplay(actionPromptEls.panicWrap, '');
      const panicWidth = panicPercent + '%'; // Used to preserve the existing panic-fill scale.
      if (actionPromptEls.panicFill.style.width !== panicWidth) { actionPromptEls.panicFill.style.width = panicWidth; styleDebug.appliedWrites++; }
      else styleDebug.skippedWrites++;
    } else {
      setPromptDisplay(actionPromptEls.panicWrap, 'none');
    }
    if (!actionPromptEls.el.classList.contains('open')) { actionPromptEls.el.classList.add('open'); styleDebug.appliedWrites++; }
    else styleDebug.skippedWrites++;
  }

  function hideActionPrompt() {
    if (!actionPromptEls) return;
    if (actionPromptEls.el.classList.contains('open')) { actionPromptEls.el.classList.remove('open'); styleDebug.appliedWrites++; }
    else styleDebug.skippedWrites++;
    pressAction = null;
    cancelAction = null;
  }

  window.ActionPromptUI = {
    init, getLastInputDevice, buildActionPromptDom, actionPromptGlyph, actionPromptColor, showActionPrompt, hideActionPrompt,
    archActions: ARCH_ACTIONS, controllerActionAvailable, requiresInteractFallback, createActionArchLayout, worldPromptLabel, resolveWorldPromptInputs,
    getDebug: () => ({ ...styleDebug, visible: !!actionPromptEls?.el.classList.contains('open') }),
  };
})();
