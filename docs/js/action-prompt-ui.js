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
  function init(injectedDeps) { deps = injectedDeps; }

  let actionPromptEls = null;
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
  }

  // Real key/button label on desktop/controller, taken from the player's
  // actual current bindings (not just the defaults) so a rebound key shows
  // correctly here too. Touch has no key to name, so callers pass the same
  // icon already shown for that action in the tool arch (see e.g. the
  // harpoon's 🎣 fallback in _openToolArc).
  function actionPromptGlyph(actionId, touchIcon) {
    const lastInputDevice = deps.getLastInputDevice();
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
    const glyph = actionPromptGlyph(actionId, touchIcon);
    // innerHTML, not textContent: touchIcon may be a real <img> tag (see
    // attackActionIconHTML) when the caller wants this to mirror the arc
    // button's actual equipped-tool sprite instead of a plain emoji —
    // callers only ever pass static developer strings here, never
    // untrusted input, so this is safe.
    const lastInputDevice = deps.getLastInputDevice();
    actionPromptEls.btn.innerHTML = lastInputDevice === 'touch' ? `${glyph} ${verb}` : `[${glyph}] ${verb}`;
    actionPromptEls.btn.onpointerup = (e) => { e.stopPropagation(); onPress?.(); };
    if (cancelText && onCancel) {
      actionPromptEls.cancel.textContent = cancelText;
      actionPromptEls.cancel.style.display = '';
      actionPromptEls.cancel.onpointerup = (e) => { e.stopPropagation(); onCancel(); };
    } else {
      actionPromptEls.cancel.style.display = 'none';
      actionPromptEls.cancel.onpointerup = null;
    }
    if (statusText) {
      actionPromptEls.status.textContent = statusText;
      actionPromptEls.status.className = 'ap-status' + (statusType ? ' ' + statusType : '');
      actionPromptEls.status.style.display = '';
    } else {
      actionPromptEls.status.style.display = 'none';
    }
    if (panicPercent != null) {
      actionPromptEls.panicWrap.style.display = '';
      actionPromptEls.panicFill.style.width = panicPercent + '%';
    } else {
      actionPromptEls.panicWrap.style.display = 'none';
    }
    actionPromptEls.el.classList.add('open');
  }

  function hideActionPrompt() {
    if (!actionPromptEls) return;
    actionPromptEls.el.classList.remove('open');
    actionPromptEls.btn.onpointerup = null;
    actionPromptEls.cancel.onpointerup = null;
  }

  window.ActionPromptUI = {
    init, buildActionPromptDom, actionPromptGlyph, actionPromptColor, showActionPrompt, hideActionPrompt,
  };
})();
