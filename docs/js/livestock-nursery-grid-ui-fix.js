(() => {
  'use strict';
  if (window.LivestockNurseryGridUiFix) return;

  // Narrow compatibility layer for two light-DOM details the enhanced Nursery
  // cannot change from inside LivestockNurseryGrid's private helpers:
  // 1) Grow Up must stay controller-focusable when barns are full, because the
  //    outdoor-growth wrapper now makes that a valid maturation path.
  // 2) The legacy "Babies stay babies..." note is real player information, not
  //    a debug button. Give it its own wrapping slot under the portrait grid and
  //    repurpose the redundant legacy header as the debug/pager host instead.
  let animalDeps = null; // Captured from FarmAnimals.init for livestock permission checks.
  let originalFarmAnimalsInit = null; // Preserves the existing farm wrapper chain while capturing deps.
  let originalFarmPanelRender = null; // Used to apply the fix after every authoritative Farm render.
  let queued = false; // Coalesces Farm render + input events into one light DOM correction.
  let installed = false; // Makes bridge/runtime installs idempotent.
  let applyCount = 0; // Mobile-copyable diagnostic for detecting unexpected UI churn.
  let mostRecentChange = 'Nursery grow/help UI compatibility loaded.'; // Exposes the latest applied correction.

  function hasLivestockPermission() {
    const check = animalDeps?.hasFarmPermission;
    return typeof check !== 'function' || check('livestock') !== false;
  }

  function findSection() {
    return typeof document === 'undefined' ? null : document.getElementById('livestockNurserySection');
  }

  function findActions(section) {
    return [...(section?.children || [])].find(child => [...(child?.children || [])].some(node =>
      node?.tagName === 'BUTTON' && (node.dataset?.nurseryAction === 'grow' || /Nursery Grow|Grow Up/i.test(node.textContent || '')))) || null;
  }

  function findHelpHost(section, actions) {
    return [...(section?.children || [])].find(child => child !== actions && child?.tagName === 'DIV'
      && /Babies stay babies indefinitely/i.test(child.textContent || '')) || null;
  }

  function findLegacyHeaderHost(section, actions, helpHost) {
    return [...(section?.children || [])].find(child => child !== actions && child !== helpHost && child?.tagName === 'DIV'
      && child.querySelector?.(':scope > strong') && /Nursery/i.test(child.textContent || '')) || null;
  }

  function ensureShadowHelpSlot(section) {
    const shadow = section?.shadowRoot;
    const gridPane = shadow?.querySelector?.('.grid-pane');
    const gridSlot = shadow?.querySelector?.('slot[name="grid"]');
    if (!shadow || !gridPane || !gridSlot) return null;
    let helpSlot = shadow.querySelector('slot[name="help"]');
    if (!helpSlot) {
      helpSlot = document.createElement('slot'); // Shadow-only mutation cannot wake the legacy Nursery light-DOM observer.
      helpSlot.name = 'help';
      gridSlot.insertAdjacentElement('afterend', helpSlot);
    } else if (helpSlot.parentElement !== gridPane) {
      gridSlot.insertAdjacentElement('afterend', helpSlot);
    }
    return helpSlot;
  }

  function ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById('livestockNurseryGridUiFixStyles')) return;
    const style = document.createElement('style'); // Head-only style insertion avoids Farm/Nursery observer feedback.
    style.id = 'livestockNurseryGridUiFixStyles';
    style.textContent = `
      #livestockNurserySection .nursery-grid-help {
        display:block !important;
        width:100% !important;
        max-width:100% !important;
        min-width:0 !important;
        margin:7px 0 0 !important;
        padding:5px 6px !important;
        box-sizing:border-box !important;
        white-space:normal !important;
        overflow-wrap:anywhere !important;
        word-break:normal !important;
        line-height:1.3 !important;
        font-size:10px !important;
        color:var(--muted,#999) !important;
        border:1px solid var(--border,#444) !important;
        border-radius:5px !important;
        background:rgba(0,0,0,.10) !important;
        cursor:default !important;
      }
      #livestockNurserySection .nursery-grid-debug-trigger > * {
        display:none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function repairHelpAndDebugHosts(section) {
    const actions = findActions(section);
    const helpHost = findHelpHost(section, actions);
    const headerHost = findLegacyHeaderHost(section, actions, helpHost);
    if (!helpHost || !headerHost || !ensureShadowHelpSlot(section)) return false;

    // The help note now owns a real left-column row and is never an interactive
    // pager/debug target. Remove any state left by the earlier enhancement.
    helpHost.slot = 'help';
    helpHost.classList.add('nursery-grid-help');
    helpHost.classList.remove('nursery-grid-debug-trigger', 'nursery-page-turn');
    delete helpHost.dataset.nurseryAction;
    delete helpHost.dataset.nurseryLabel;
    delete helpHost.dataset.nurseryPaging;
    helpHost.removeAttribute('role');
    helpHost.removeAttribute('tabindex');
    helpHost.removeAttribute('aria-label');
    helpHost.title = '';

    // The original header is redundant because the shadow UI renders its own
    // Nursery title/capacity header. Reuse that existing light-DOM node rather
    // than creating another button that would wake the legacy observer.
    headerHost.slot = 'debug';
    headerHost.classList.add('nursery-grid-debug-trigger');
    headerHost.dataset.nurseryAction = 'debug';
    headerHost.dataset.nurseryLabel = '🛠 Copy Nursery Debug';
    headerHost.setAttribute('role', 'button');
    headerHost.tabIndex = 0;

    // Paging already knows how to turn whichever .nursery-grid-debug-trigger
    // exists into the controller-focusable page arrow when >28 babies exist.
    window.LivestockNurseryInventoryPaging?.applyPage?.();
    return true;
  }

  function repairGrowButton(section) {
    const actions = findActions(section);
    if (!actions) return false;
    const grow = [...actions.querySelectorAll(':scope > button')].find(button =>
      button.dataset.nurseryAction === 'grow' || /Nursery Grow|Grow Up/i.test(button.textContent || ''));
    if (!grow) return false;

    const canManage = hasLivestockPermission();
    const tonicCount = Number(window.AnimalGrowth?.growthTonicCount?.()) || 0;
    const adults = Number(window.LivestockNursery?.adultCount?.()) || 0;
    const capacity = Number(window.LivestockNursery?.adultCapacity?.()) || 0;
    const hasOpenBarnStall = adults < capacity;

    // Full barns no longer disable maturation: the public growth path now
    // matures the animal outdoors. Only permission or lacking a tonic blocks it.
    grow.disabled = !canManage || tonicCount < 1;
    grow.title = !canManage ? 'Livestock permission required.'
      : tonicCount < 1 ? 'You need a Growth Tonic.'
      : hasOpenBarnStall
        ? `Use 1 Growth Tonic (${tonicCount} owned) and move this baby into an open barn.`
        : `Use 1 Growth Tonic (${tonicCount} owned). Barns are full, so this baby will grow up outdoors until you house it.`;
    return true;
  }

  function apply() {
    ensureStyles();
    const section = findSection();
    if (!section?.shadowRoot) return false;
    const helpFixed = repairHelpAndDebugHosts(section);
    const growFixed = repairGrowButton(section);
    if (!helpFixed && !growFixed) return false;
    applyCount++;
    mostRecentChange = `Nursery UI fixed: help note wraps below the grid; Grow Up is ${growFixed ? 'capacity-independent' : 'unchanged'}.`;
    return true;
  }

  function queueApply() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      // LivestockNurseryGrid also decorates in a microtask after Farm renders;
      // one second microtask guarantees its private updateActionState has run.
      queueMicrotask(() => {
        queued = false;
        apply();
      });
    });
  }

  function wrapFarmAnimals() {
    const api = window.FarmAnimals;
    if (!api?.init) return false;
    if (api.init.__nurseryGridUiFixDepsCapture) return true;
    originalFarmAnimalsInit = api.init;
    const wrapped = function nurseryGridUiFixFarmAnimalsInit(injectedDeps, ...args) {
      animalDeps = injectedDeps || null;
      return originalFarmAnimalsInit.call(this, injectedDeps, ...args);
    };
    Object.defineProperty(wrapped, '__nurseryGridUiFixDepsCapture', { value: true });
    api.init = wrapped;
    return true;
  }

  function wrapFarmPanel() {
    const api = window.FarmPanel;
    if (!api?.render) return false;
    if (api.render.__nurseryGridUiFix) return true;
    originalFarmPanelRender = api.render;
    const wrapped = function nurseryGridUiFixFarmPanelRender(...args) {
      const result = originalFarmPanelRender.apply(this, args);
      queueApply();
      return result;
    };
    Object.defineProperty(wrapped, '__nurseryGridUiFix', { value: true });
    api.render = wrapped;
    return true;
  }

  function installInputRefresh() {
    if (typeof document === 'undefined' || document.documentElement?.dataset?.nurseryGridUiFixInput === '1') return;
    if (document.documentElement) document.documentElement.dataset.nurseryGridUiFixInput = '1';
    const refreshAfterNurseryInput = event => {
      const section = findSection();
      if (!section || !section.contains(event.target)) return;
      queueApply();
    };
    // Capture at document level so the grid's own stopImmediatePropagation
    // cannot suppress the post-input correction on mouse or controller focus.
    document.addEventListener('click', refreshAfterNurseryInput, true);
    document.addEventListener('focusin', refreshAfterNurseryInput, true);
  }

  function debugSnapshot() {
    const section = findSection();
    const actions = findActions(section);
    const grow = actions ? [...actions.querySelectorAll(':scope > button')].find(button => button.dataset.nurseryAction === 'grow') : null;
    const help = findHelpHost(section, actions);
    return {
      installed,
      depsReady: !!animalDeps,
      applyCount,
      mostRecentChange,
      grow: grow ? { disabled: !!grow.disabled, title: grow.title } : null,
      help: help ? { slot: help.slot, className: help.className, text: help.textContent } : null,
    };
  }

  function install() {
    wrapFarmAnimals();
    wrapFarmPanel();
    installInputRefresh();
    installed = true;
    queueApply();
    return true;
  }

  window.LivestockNurseryGridUiFix = { install, apply, debugSnapshot };
  window.__livestockNurseryGridUiFixDebug = { snapshot: debugSnapshot, apply };
  install();
})();