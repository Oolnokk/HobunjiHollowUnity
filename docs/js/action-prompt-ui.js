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

  let actionPromptEls = null;
  let pressAction = null; // Used by the retained pointer handler so frame updates don't create new closures.
  let cancelAction = null; // Used by the retained cancel handler while the prompt is visible.
  const styleDebug = { refreshes: 0, appliedWrites: 0, skippedWrites: 0 }; // Used by the mobile Pixel Probe HUD style report.
  function setPromptText(element, property, value) {
    if (element[property] !== value) { element[property] = value; styleDebug.appliedWrites++; }
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
  function actionPromptGlyph(actionId, touchIcon) {
    const lastInputDevice = getLastInputDevice();
    if (lastInputDevice === 'controller') return window.InputBindings.buttonLabel(deps.inputBindings.controller[actionId]);
    if (lastInputDevice === 'touch') return touchIcon || '👆';
    return window.InputBindings.buttonLabel(deps.inputBindings.desktop[actionId]);
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
    getDebug: () => ({ ...styleDebug, visible: !!actionPromptEls?.el.classList.contains('open') }),
  };
})();
