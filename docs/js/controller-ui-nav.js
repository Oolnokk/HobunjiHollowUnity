(() => {
  'use strict';

  // Universal controller (gamepad) navigation for every floating menu/panel
  // in the game — the pause menu and every one of its tabs (Inventory,
  // Crafting, the shop/Alchemy panes, Settings, ...), NPC dialogue and its
  // choice buttons, the hearth/campfire cooking UI, the clothing dye panel,
  // the house layout modal, and any panel built after this file was written.
  //
  // How a new panel opts in (this is the whole contract — nothing else to
  // wire up):
  //   data-ctrl-panel   on the panel/modal's root element, OR standard modal
  //                     semantics role="dialog" aria-modal="true". Semantic
  //                     dialogs are discovered automatically unless nested
  //                     inside an explicit data-ctrl-panel owner.
  //                     Visible panels are watched for display/opacity/
  //                     visibility changes; the instant one becomes visible
  //                     it gets controller focus, and focus returns to the
  //                     underlying panel when it closes.
  //   data-ctrl-cancel  optional, on the panel's own close/back/leave
  //                     button. Gamepad B (and keyboard) clicks it.
  //   data-ctrl-tabs    optional, on a row of sibling tab/category buttons
  //                     (e.g. the pause menu's own top tab bar). Gamepad
  //                     LB/RB (and Tab/Shift+Tab) step through its children.
  //   data-ctrl-modal   optional, pins the panel to the top of the stack while visible, even if other panels open later.
  //   data-ctrl-actions optional, receives cancelable hobunji-controller-panel-action
  //                     events (confirm/cancel/previous/next). Prevent default to
  //                     give a letter reader fixed A/B/LB/RB semantics.
  //   data-ctrl-scroll optional, identifies an overflow region for right-stick
  //                     scrolling when focus is in the panel's fixed toolbar.
  //   data-ctrl-default optional, on the element that should receive focus
  //                     first. Unset panels just focus the topmost-leftmost
  //                     focusable thing instead (or whatever already has
  //                     real DOM focus, e.g. an auto-focused search box).
  //   data-ctrl-item    optional, opts a non-natively-interactive element
  //                     (a plain <div> with an onclick, say) into
  //                     navigation. Real buttons/links/inputs/[role=button]/
  //                     [tabindex] are discovered automatically — most
  //                     panels in this game need this on precisely nothing,
  //                     since almost everything here is already a <button>.
  //   data-ctrl-inspect allows a disabled control to be highlighted/read;
  //                     Confirm still cannot activate it.
  //   data-ctrl-group   optional, makes a nested section one selectable group.
  //                     Confirm enters; Back returns to the whole section.
  //                     Existing menu sections, inventories, perk trees and
  //                     tab rows are recognized without extra markup.
  //   data-ctrl-transparent on structural wrappers exposes their descendants
  //                     directly, without hiding or skipping those controls.
  //   data-ctrl-auto-enter opens a sole content owner without a Confirm gate;
  //                     Back releases it so outer menu tabs remain reachable.
  //   data-ctrl-detail  id of an associated detail group. Confirm selects the
  //                     item, enters that sibling, and Back returns to the item.
  //   data-ctrl-detail-panel on the associated group; excludes it from unrelated
  //                     spatial navigation until its item opens it.
  //   data-ctrl-group-open on a group's own toggle with aria-expanded;
  //                     entering a closed group uses that toggle first.
  //   data-ctrl-skip    optional, the opposite of data-ctrl-item — pulls an
  //                     otherwise-focusable element (or an especially risky
  //                     one, e.g. the pause menu's "reset farm" button) out
  //                     of controller navigation.
  //
  // Self-contained on purpose, same as ui-element-editor.js/cooking-system.js
  // etc.: no dependency on game.js internals. The one line of coupling runs
  // the other direction — game.js's own pollControllerInput() checks
  // window.ControllerUI.isActive() and stands down for the frame so the two
  // don't fight over the same button presses.

  const EXPLICIT_PANEL_SELECTOR = '[data-ctrl-panel]';
  const SEMANTIC_PANEL_SELECTOR = '[role="dialog"][aria-modal="true"]';
  const PANEL_SELECTOR = `${EXPLICIT_PANEL_SELECTOR}, ${SEMANTIC_PANEL_SELECTOR}`;
  const TABS_SELECTOR = '[data-ctrl-tabs]';
  const GROUP_SELECTOR = [
    '.mp-pane', '[data-ctrl-subtab]', '[data-ctrl-group]', '[data-ctrl-detail-panel]', '[data-ctrl-tabs]', '[role="tablist"]', 'details',
    '.menu-section', '.progress-skills', '.perk-trees', '.perk-row', '.skill-row', '.farm-section', '.farm-storage-col', '.ship-pane',
    '.inv-grid-area', '.inv-info', '.inv-equip-section', '.inv-key-section',
    '.inv-pack-clothing', '.inv-gear-extra-section', '.perk-tree',
    '.loadout-slot', '.loadout-options', '.cooking-layout > aside', '.cooking-slot', '.cooking-picker', '.cooking-footer',
    '#stableList', '#desktopInputBindings', '#controllerInputBindings',
  ].join(', '); // Reuses authored section boundaries instead of guessing nests from geometric proximity.
  const SUBTAB_SELECTOR = '.menu-section, .farm-section, .farm-storage-col, .progress-skills, .perk-trees, .inv-grid-area, .inv-equip-section, .inv-key-section, .inv-pack-clothing, .inv-gear-extra-section, [data-ctrl-subtab]'; // Large authored sections qualify; individual cards, perk rows and tab bars do not.
  const MENU_SUBTAB_PRIORITY_BY_PANE = Object.freeze({ // Used by controller sub-tab cycling to put frequently checked pages before one-time configuration.
    mpInventory: ['invGridArea', 'invEquipSection', 'invKeySection', 'invPackClothing'],
    mpFarm: ['farmSectionLayout', 'farmSectionLivestock', 'farmSectionStorage', 'farmSectionBuildings', 'farmSectionFoodProcessing', 'farmSectionDew', 'farmSectionFurniture', 'farmSectionCustomize', 'farmhandsSection'],
    mpTasks: ['tasksSectionQuestLog', 'tasksSectionRumors', 'tasksSectionWanted'],
    mpSettings: ['settingsSectionAudio', 'settingsSection7', 'settingsSection6', 'settingsSection0', 'settingsSection8', 'settingsSection1', 'settingsSection9', 'settingsSection10', 'settingsSection11', 'settingsSection2', 'settingsSection3', 'settingsSection4', 'settingsSection5'],
  });
  const subtabsByGroup = new Map(); // Active section ownership also keeps hidden siblings restorable after rebuilds and modal handoffs.
  const lastSubtabByGroupKey = new Map(); // Keeps each menu pane's last controller section across close/reopen and DOM replacement.
  const NAV_SELECTOR = [
    'button', 'a[href]', 'input', 'select', 'textarea', 'summary',
    '[role="button"]', '[tabindex]', '[data-ctrl-item]',
  ].join(', ');
  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'number', 'password', 'tel', 'date', 'time', 'datetime-local', 'month', 'week']);

  const DEADZONE = Number(window.SCRATCHBONES_CONFIG?.game?.input?.gamepadDeadzone) || 0.5;
  const NAV_PRESS = Number(window.SCRATCHBONES_CONFIG?.game?.input?.axisPressThreshold) || 0.55;
  const REPEAT_INITIAL_MS = 380;
  const REPEAT_RATE_MS = 140;
  const CONE_HALF_ANGLE = 34 * Math.PI / 180; // Narrow first-pass intent cone cast from the focused control's center along the physical stick vector.
  const WIDE_CONE_HALF_ANGLE = 58 * Math.PI / 180; // One forgiving retry before falling back to the forward half-plane, preventing dead ends in irregular layouts.
  const CONE_EDGE_FORGIVENESS = 12; // Pixels added around candidate bounds so wide/short controls can be hit by the cone even when their center sits just outside it.
  const STICK_DIRECTION_RESET_COS = Math.cos(25 * Math.PI / 180); // A deliberate ~25° direction change while held counts as a fresh navigation gesture instead of waiting for repeat.
  const UI_ACTIONS = Object.freeze({
    open: 'uiOpenMenu', confirm: 'uiConfirm', cancel: 'uiCancel', tabPrev: 'uiTabPrev', tabNext: 'uiTabNext',
    up: 'uiUp', down: 'uiDown', left: 'uiLeft', right: 'uiRight',
  }); // Used to keep every discrete menu action routed through the configurable controller binding layer.

  function configuredControllerBinding(actionId, currentBindings = undefined) {
    if (currentBindings === undefined) currentBindings = window.InputBindings?.getCurrentBindings?.()?.controller; // Used by non-poll callers while the frame hot path passes its already-resolved live map.
    if (currentBindings && Object.prototype.hasOwnProperty.call(currentBindings, actionId)) return currentBindings[actionId];
    const defaults = window.InputBindings?.getDefaultBindings?.('controller'); // Keeps controller-only action schema/defaults owned by InputBindings.
    return defaults && Object.prototype.hasOwnProperty.call(defaults, actionId) ? defaults[actionId] : null;
  }

  // Reads this frame's shared analog snapshot rather than re-deriving each
  // action's value from the raw Gamepad object on every call.
  function controllerActionDown(frame, actionId, currentBindings = undefined) {
    const bindingCode = configuredControllerBinding(actionId, currentBindings); // Used to resolve this menu action without relying on a physical Gamepad button index.
    return Boolean(bindingCode) && frame.isDown(bindingCode, { stickThreshold: NAV_PRESS });
  }

  // ── visibility ──────────────────────────────────────────────────────
  // Panels in this game hide themselves three different ways (display:none
  // toggled by a class, opacity+pointer-events fade, or plain aria-hidden
  // semantics layered on one of the other two) — rather than special-case
  // each, walk the ancestor chain checking the actual rendered result, the
  // same technique ui-element-editor.js already uses to see through a
  // closed-but-still-laid-out modal.
  function isVisible(el) {
    if (!el || !el.isConnected || el.closest('.ctrl-nav-subtab-hidden')) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      node = node.parentElement;
    }
    return true;
  }

  function isDisabled(el) {
    return !!(el.disabled || el.getAttribute?.('aria-disabled') === 'true');
  }

  function isTextEditable(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    if (el.tagName === 'INPUT') return TEXT_INPUT_TYPES.has((el.type || 'text').toLowerCase());
    return false;
  }

  // ── panel stack ─────────────────────────────────────────────────────
  let stack = [];
  const lastFocusedByPanel = new WeakMap();
  const groupsByPanel = new WeakMap(); // Retains entered nests while a modal temporarily owns focus.
  const releasedAutoGroup = new WeakMap(); // Prevents Back from immediately reentering the automatic content owner.
  let automaticEntryEnabled = false; // Actual controller input enables automatic pages; pointer input restores the complete layout.
  const lastFocusedByGroup = new WeakMap(); // Remembers the control selected when leaving an entered section.
  const knownPanels = new Set(); // Reused by visibility reconciliation so gameplay never scans the entire DOM for panel roots.
  let currentTarget = null;
  let focusPath = null; // Remembers the active control through in-panel DOM rebuilds.
  let scrolledSelection = null; // Reanchors the next directional input to the right-stick scroll host's visible controls.
  const navigationPerf = { targetCount: 0, rectReads: 0 }; // Used by ControllerUI.debugState() to expose the most recent spatial-navigation scan cost without browser devtools.

  // Reconciliation checks panel roots and their ancestors so nested menus
  // disappear with their parents. It is mutation-driven; isActive() stays
  // a constant-time hot-path read during gameplay.
  function panelVisible(el) {
    if (!el || !el.isConnected || el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function visiblePanels() {
    const visible = [];
    for (const panel of knownPanels) {
      if (!panel?.isConnected) {
        knownPanels.delete(panel);
        continue;
      }
      if (panelVisible(panel) && isVisible(panel)) visible.push(panel);
    }
    return visible;
  }

  function activePanel() {
    return stack.length ? stack[stack.length - 1] : null;
  }

  // This is a gameplay hot path: game.js asks every frame and controller
  // polling may ask again. Panel mutations keep `stack` current, so this read
  // must not query the DOM or force computed style/layout.
  function isActive() {
    return stack.length > 0;
  }

  function reconcileStack() {
    const current = visiblePanels();
    const currentSet = new Set(current);
    const prevTop = activePanel();

    for (const panel of stack) {
      if (!currentSet.has(panel)) clearGroups(panel);
    }
    stack = stack.filter(p => currentSet.has(p));
    for (const p of current) {
      if (!stack.includes(p)) stack.push(p);
    }
    // A blocking modal (data-ctrl-modal) stays on top however many panels open after it, so a dialogue or cutscene
    // panel appearing underneath cannot take Confirm/Back away from it.
    const modal = [...stack].reverse().find(p => p.hasAttribute?.('data-ctrl-modal'));
    if (modal && stack[stack.length - 1] !== modal) stack = [...stack.filter(p => p !== modal), modal];

    const newTop = activePanel();
    if (newTop !== prevTop) {
      if (prevTop) lastFocusedByPanel.set(prevTop, currentTarget);
      if (newTop) activatePanel(newTop);
      else deactivateAll();
      // Declared through the shared registry, which emits the owner-change
      // event; nothing else needs to infer menu ownership by patching isActive.
      if (!prevTop && newTop) window.ControllerInput?.setOwner?.('menu');
      if (prevTop && !newTop && window.ControllerInput?.owner === 'menu') window.ControllerInput.setOwner('gameplay');
    }
  }

  function activatePanel(panel) {
    scrolledSelection = null;
    updateHintBar(panel);
    // A real mouse click leaves its target as document.activeElement even
    // after the panel closes around it (nothing blurs it), so a panel
    // closed by clicking its own close button would otherwise "remember"
    // that close button and hand it right back as next open's starting
    // focus — one A press later the panel closes itself again before the
    // player can do anything. Same reasoning as pickDefaultTarget's own
    // cancel-avoidance below, just needed here too since these two
    // fast-paths bypass it.
    const notCancel = el => el && !el.hasAttribute('data-ctrl-cancel') && el;
    const targets = navigationTargets(panel); // Projects remembered controls onto the currently entered nest.
    const remembered = lastFocusedByPanel.get(panel);
    const startFocus =
      notCancel(document.activeElement && belongsToNavigation(document.activeElement, panel) && targets.includes(document.activeElement) && document.activeElement)
      || notCancel(remembered && belongsToNavigation(remembered, panel) && targets.includes(remembered) && remembered)
      || pickDefaultTarget(panel, targets);
    setFocus(startFocus || navigationRoot(panel), { scroll: false });
    updateHintBar(panel);
  }

  function deactivateAll() {
    setFocus(null);
    hideHintBar();
  }

  // ── target discovery ────────────────────────────────────────────────
  function isNavTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute('data-ctrl-transparent')) return false;
    if (el.closest('[data-ctrl-skip]')) return false;
    if (isDisabled(el) && !el.hasAttribute('data-ctrl-inspect')) return false;
    if (el.hasAttribute('tabindex') && Number(el.getAttribute('tabindex')) < 0 && !el.hasAttribute('data-ctrl-item') && !el.matches(GROUP_SELECTOR)) return false;
    return isVisible(el);
  }

  function targetsInPanel(panel) {
    return Array.from(panel.querySelectorAll(`${NAV_SELECTOR}, ${GROUP_SELECTOR}`)).filter(el => isNavTarget(el)
      && (!isGroup(el) || el.textContent?.trim() || el.querySelector(NAV_SELECTOR) || el.querySelector('canvas, img')));
  }

  function isGroup(el) {
    // An actionable card remains an action even when it also uses a section's styling class.
    return !el.hasAttribute('data-ctrl-transparent') && el.matches(GROUP_SELECTOR) && !el.matches('button, a[href], input, select, textarea, summary, [role="button"], [data-ctrl-item]');
  }


  function clearGroups(panel) {
    releasedAutoGroup.delete(panel);
    for (const entry of groupsByPanel.get(panel) || []) {
      restoreSubtabs(entry.node);
      entry.node.classList.remove('ctrl-nav-group-active');
    }
    groupsByPanel.delete(panel);
  }

  function enteredGroups(panel) {
    const entries = groupsByPanel.get(panel) || []; // Validated only for menu actions/mutations, never on idle controller frames.
    let parent = panel; // Ensures a rebuilt section still belongs to the same entered hierarchy.
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]; // Stores the original DOM path so whole-section rebuilds preserve confinement.
      const node = entry.node.isConnected ? entry.node : resolveFocusPath(entry.path, true).container; // Reuses stable ids/data-tree and sibling positions.
      const origin = entry.returnPath ? resolveFocusPath(entry.returnPath).container : null; // Associated siblings belong logically to the source item's current nest.
      const associated = origin && parent.contains(origin) && panel.contains(node) && node?.hasAttribute('data-ctrl-detail-panel');
      if (!node || node === parent || (!parent.contains(node) && !associated) || !isGroup(node) || !isNavTarget(node) || !belongsToNavigation(node, panel)) {
        for (const removed of entries.splice(index)) { restoreSubtabs(removed.node); removed.node.classList.remove('ctrl-nav-group-active'); }
        break;
      }
      if (entry.node !== node) {
        const selectedState = subtabsByGroup.get(entry.node); // Retains section identity or sibling index when its whole owner is rebuilt.
        restoreSubtabs(entry.node);
        if (selectedState) prepareSubtabsWithMemory(node, panel, selectedState.selected.id || null, selectedState.selected.id ? 0 : selectedState.sections.indexOf(selectedState.selected), false);
        entry.node.classList.remove('ctrl-nav-group-active');
        entry.node = node;
      }
      if (!node.classList.contains('ctrl-nav-group-active')) node.classList.add('ctrl-nav-group-active');
      parent = node;
    }
    groupsByPanel.set(panel, entries);
    return entries;
  }

  function navigationRoot(panel) {
    return enteredGroups(panel).at(-1)?.node || panel;
  }

  function groupTarget(el, root, panel) {
    let target = el; // Outermost unentered section becomes the single spatial candidate for its descendants.
    for (let node = el; node && node !== root; node = node.parentElement) {
      if (isGroup(node) && isNavTarget(node) && belongsToNavigation(node, panel) && !(subtabsByGroup.get(root)?.selected === node && subtabsByGroup.get(root)?.transparent)) target = node;
    }
    return target;
  }

  function directTargets(root, panel) {
    const targets = targetsInPanel(root).filter(el => belongsToNavigation(el, panel)); // Only this panel's own controls participate.
    return [...new Set(targets.map(el => groupTarget(el, root, panel)))].filter(target => !(target === subtabsByGroup.get(root)?.selected && subtabsByGroup.get(root)?.transparent) && !target.hasAttribute('data-ctrl-detail-panel'));
  }

  function projectSingleChild(target, panel) {
    if (!isGroup(target)) return target;
    const children = directTargets(target, panel); // A single route is transparent; read-only sections remain selectable for inspection.
    return children.length === 1 && !children[0].hasAttribute('data-ctrl-group-open') ? projectSingleChild(children[0], panel) : target;
  }

  function navigationTargets(panel) {
    let targets = directTargets(navigationRoot(panel), panel).map(target => projectSingleChild(target, panel)); // Projects structural one-child paths before checking content ownership.
    if (automaticEntryEnabled && navigationRoot(panel) === panel) {
      const automatic = targets.find(target => isGroup(target) && (target.hasAttribute('data-ctrl-auto-enter') || target.matches('.mp-pane')) && releasedAutoGroup.get(panel) !== target); // Pause pages and opt-in content owners retain their sub-tabs and Back scope.
      if (automatic) {
        rememberFocusPath(automatic);
        groupsByPanel.set(panel, [{ node: automatic, path: focusPath, explicit: true }]);
        automatic.classList.add('ctrl-nav-group-active');
        prepareSubtabs(automatic, panel, automatic.getAttribute('data-ctrl-initial-subtab'));
        targets = directTargets(automatic, panel).map(target => projectSingleChild(target, panel));
      }
    }
    return targets;
  }

  function restoreSubtabs(group) {
    const state = subtabsByGroup.get(group); // All presentation changes are reversible, including detached/rebuilt nodes.
    if (!state) return;
    for (const section of state.sections) section.classList.remove('ctrl-nav-subtab-hidden');
    group.classList.remove('ctrl-nav-subtabs');
    state.selected.classList.remove('ctrl-nav-subtab-selected');
    subtabsByGroup.delete(group);
  }

  function subtabMemoryKey(group, panel) {
    const pane = group.closest?.('.mp-pane'); // Pane identity separates the same child ids across pause-menu tabs.
    if (pane?.id && pane === group) return pane.id;
    return group.id ? `${pane?.id || panel?.id || 'panel'}:${group.id}` : null; // Anonymous nested groups retain only live DOM state.
  }

  function prioritizeMenuSubtabs(group, sections) {
    const paneId = group.closest?.('.mp-pane')?.id; // Parent menu identifies which sections have an authored frequency order.
    const preferred = MENU_SUBTAB_PRIORITY_BY_PANE[paneId]; // Unknown panes and dynamically generated child groups keep their original DOM order.
    if (!preferred) return sections;
    const ranks = new Map(preferred.map((id, index) => [id, index])); // Used to sort only recognized menu section ids while preserving unlisted siblings.
    return sections.slice().sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
  }

  function prepareSubtabs(group, panel, selectedId = null, offset = 0) {
    return prepareSubtabsWithMemory(group, panel, selectedId, offset, true); // Retain the existing entry point and regression-test extraction boundary.
  }
  function prepareSubtabsWithMemory(group, panel, selectedId = null, offset = 0, restoreLast = true) {
    restoreSubtabs(group);
    const sections = prioritizeMenuSubtabs(group, directTargets(group, panel).filter(target => isGroup(target) && target.matches(SUBTAB_SELECTOR))); // UI keeps its authored layout, while controller LB/RB use the frequency-first sequence.
    if (sections.length < 2) return false;
    const memoryKey = subtabMemoryKey(group, panel); // Shared by restoring/replacing this pane and remembering a user selection.
    const remembered = restoreLast && memoryKey ? lastSubtabByGroupKey.get(memoryKey) : null; // Explicit section jumps and bumper cycles bypass memory.
    const rememberedIndex = remembered?.id ? sections.findIndex(section => section.id === remembered.id) : remembered?.index;
    let index = Number.isInteger(rememberedIndex) && rememberedIndex >= 0 && rememberedIndex < sections.length ? rememberedIndex
      : sections.findIndex(section => section.id && section.id === selectedId); // Stable ids win when the previous section was removed.
    if (index < 0) index = 0;
    const selected = sections[(index + offset + sections.length) % sections.length]; // Bumpers wrap within the borrowed local section set.
    const nestedState = subtabsByGroup.get(selected); // An entered child still owns multiple sections even while its inactive siblings are hidden.
    const transparent = !nestedState && directTargets(selected, panel).filter(target => isGroup(target) && target.matches(SUBTAB_SELECTOR)).length < 2; // Nested multi-section pages remain enterable and can borrow the tab actions in turn.
    subtabsByGroup.set(group, { sections, selected, transparent });
    if (memoryKey) lastSubtabByGroupKey.set(memoryKey, { id: selected.id || null, index: sections.indexOf(selected) }); // Remember the actual selected section, not the opening default.
    group.classList.add('ctrl-nav-subtabs');
    selected.classList.add('ctrl-nav-subtab-selected');
    for (const section of sections) if (section !== selected) section.classList.add('ctrl-nav-subtab-hidden');
    const opener = Array.from(selected.querySelectorAll('[data-ctrl-group-open]')).find(control => isNavTarget(control) && groupTarget(control, selected, panel) === control && control.getAttribute('aria-expanded') === 'false'); // Open a collapsed baby inventory on selection without requiring another Confirm.
    if (opener) opener.click();
    return true;
  }

  function localSubtabs(panel) {
    return [...enteredGroups(panel)].reverse().find(entry => subtabsByGroup.has(entry.node));
  }

  function enterGroup(group, panel, returnPath = null, requestedSection = null) {
    releasedAutoGroup.delete(panel);
    const entries = enteredGroups(panel); // Nested groups unwind one level per Back press.
    rememberFocusPath(group);
    entries.push({ node: group, path: focusPath, returnPath, explicit: true }); // Entered by Confirm; focus-adopted scopes are not, so keyboard Escape/Tab keep closing/switching the menu.
    groupsByPanel.set(panel, entries);
    group.classList.add('ctrl-nav-group-active');
    const opener = Array.from(group.querySelectorAll('[data-ctrl-group-open]')).find(control => isNavTarget(control) && groupTarget(control, group, panel) === control); // Only this group's own toggle may open it; entering a tree list must not open its first child tree.
    if (opener?.getAttribute('aria-expanded') === 'false') opener.click();
    prepareSubtabsWithMemory(group, panel, requestedSection || group.getAttribute('data-ctrl-initial-subtab'), 0, !requestedSection); // Direct page jumps skip remembered-page opener side effects.
    updateHintBar(panel);
    const targets = navigationTargets(panel); // Includes subgroups as whole targets, never their unentered controls.
    const remembered = lastFocusedByGroup.get(group); // Re-entering a group returns to its last surviving control.
    const contents = targets.filter(target => !target.hasAttribute('data-ctrl-group-open')); // Once opened, start on the contents rather than immediately offering to close the tree again.
    setFocus(targets.includes(remembered) ? remembered : pickDefaultTarget(panel, contents.length ? contents : targets) || navigationRoot(panel), { scroll: false });
  }

  function leaveGroup(panel) {
    const entries = enteredGroups(panel); // Recovers rebuilt groups before choosing the parent selection.
    const entry = entries.pop(); // Consumes Back before the panel's close button can run.
    if (!entry) return false;
    if (entry.node.hasAttribute('data-ctrl-auto-enter') || entry.node.matches('.mp-pane')) releasedAutoGroup.set(panel, entry.node);
    lastFocusedByGroup.set(entry.node, currentTarget);
    restoreSubtabs(entry.node);
    entry.node.classList.remove('ctrl-nav-group-active');
    updateHintBar(panel);
    const targets = navigationTargets(panel); // Return to the original item or its nearest surviving neighbor after a consume/equip rebuild.
    const origin = entry.returnPath ? recoverFocusTarget(panel, targets, entry.returnPath) : projectSingleChild(entry.node, panel);
    setFocus(origin || pickDefaultTarget(panel, targets) || navigationRoot(panel));
    return true;
  }

  function adoptFocusedGroups(el, panel) {
    if (currentTarget === el || navigationTargets(panel).includes(el)) return; // Programmatic focus already has an explicit scope; mouse/native focus may choose another section.
    clearGroups(panel);
    const ancestors = []; // Reconstructs nesting when switching from mouse/touch or another native focus owner.
    for (let node = el.parentElement; node && node !== panel; node = node.parentElement) {
      if (isGroup(node) && belongsToNavigation(node, panel) && projectSingleChild(node, panel) === node) ancestors.unshift(node);
    }
    const previousPath = focusPath; // Scope paths must not overwrite the selected control's recovery path.
    const entries = ancestors.map(node => {
      rememberFocusPath(node);
      node.classList.add('ctrl-nav-group-active');
      return { node, path: focusPath };
    });
    focusPath = previousPath;
    groupsByPanel.set(panel, entries);
  }

  function owningRegisteredPanel(el) {
    let owner = el?.closest?.(PANEL_SELECTOR) || null; // Used to map focused descendants back to the registered panel stack without rebuilding every navigation target.
    while (owner && !knownPanels.has(owner)) owner = owner.parentElement?.closest?.(PANEL_SELECTOR) || null;
    return owner;
  }

  function belongsToNavigation(el, panel) {
    const owner = owningRegisteredPanel(el); // Used for constant-small-stack membership checks on focusin/stale-focus paths.
    if (!owner) return false;
    return owner === panel;
  }

  function pickDefaultTarget(panel, availableTargets = null) {
    const explicit = panel.querySelector('[data-ctrl-default]');
    if (explicit && isNavTarget(explicit) && belongsToNavigation(explicit, panel) && (!availableTargets || availableTargets.includes(explicit))) return explicit;
    const targets = availableTargets || navigationTargets(panel);
    // Never default-focus the panel's own close/cancel button — a stray A
    // press on first opening a panel shouldn't be able to instantly back
    // back out of it again.
    const preferred = targets.filter(el => !el.hasAttribute('data-ctrl-cancel'));
    const pool = preferred.length ? preferred : targets;
    if (!pool.length) return null;
    return pool.reduce((best, el) => {
      if (!best) return el;
      const a = el.getBoundingClientRect(), b = best.getBoundingClientRect();
      if (Math.abs(a.top - b.top) > 4) return a.top < b.top ? el : best;
      return a.left < b.left ? el : best;
    }, null);
  }

  function rememberFocusPath(el) {
    const panel = activePanel(); // Limits restoration to the menu that owned this selection.
    if (!el || !panel || !belongsToNavigation(el, panel)) { focusPath = null; return; }
    const steps = []; // Child identities and positions recover rebuilt rows without retaining entire target lists.
    for (let node = el; node && node !== panel; node = node.parentElement) {
      const parent = node.parentElement; // Used to record the control's location within each container.
      if (!parent) return;
      const attribute = ['id', 'data-stack-id', 'data-item-key', 'data-key', 'data-tree', 'data-perk-toggle', 'data-perk', 'data-perk-action'].find(name => node.getAttribute(name)); // Prefer exact stack identity over item type.
      steps.unshift({ node, index: Array.prototype.indexOf.call(parent.children, node),
        attribute, value: attribute ? node.getAttribute(attribute) : null });
    }
    focusPath = { panel, steps };
  }

  function resolveFocusPath(path, strict = false) {
    let siblings = []; // Retains the final row for nearest-enabled-slot fallback.
    let slot = 0; // Locates the old selection when its replacement is disabled or empty.
    let container = path.panel; // Walks the old control's hierarchy inside this menu only.
    for (const step of path.steps) {
      const children = Array.from(container.children); // Read only during stale-focus recovery, never during idle polling.
      const identified = children.find(child => child === step.node)
        || (step.attribute && children.find(child => child.getAttribute(step.attribute) === step.value)); // Used to distinguish a rebuilt section from an unrelated sibling.
      if (strict && step.attribute && !identified) return { container: null, siblings, slot };
      const replacement = identified || children[Math.min(step.index, children.length - 1)]; // A consumed/transferred last stack selects the preceding slot.
      if (!replacement) break;
      siblings = children;
      slot = children.indexOf(replacement);
      container = replacement;
    }
    return { container, siblings, slot };
  }

  function recoverFocusTarget(panel, targets, path = focusPath) {
    if (path?.panel !== panel) return null;
    const { container, siblings, slot } = resolveFocusPath(path); // Shared by control and nested-section rebuild recovery.
    if (targets.includes(container)) return container;
    return targets.find(target => container.contains(target))
      || siblings.filter(child => targets.includes(child)).sort((a, b) => Math.abs(siblings.indexOf(a) - slot) - Math.abs(siblings.indexOf(b) - slot))[0]
      || null;
  }

  // ── focus application ───────────────────────────────────────────────
  function setFocus(el, opts = {}) {
    if (currentTarget && currentTarget !== el) currentTarget.classList.remove('ctrl-nav-focus');
    currentTarget = el || null;
    if (!currentTarget) { focusPath = null; return; }
    rememberFocusPath(currentTarget);
    if (!currentTarget.classList.contains('ctrl-nav-focus')) currentTarget.classList.add('ctrl-nav-focus');
    if (!currentTarget.hasAttribute('tabindex') && currentTarget.tabIndex < 0) currentTarget.tabIndex = -1;
    try { currentTarget.focus({ preventScroll: true }); } catch { /* not every candidate supports real focus */ }
    if (typeof CustomEvent === 'function' && typeof currentTarget.dispatchEvent === 'function') {
      currentTarget.dispatchEvent(new CustomEvent('hobunji-controller-focus', { bubbles: true })); // Native focus previews are optional for lightweight test elements without DOM dispatch.
    }
    if (opts.scroll !== false) {
      try { currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {}
    }
    updateHintBar(activePanel());
  }

  function refreshFocusIfStale(availableTargets = null) {
    const panel = activePanel();
    if (!panel) return;
    const targets = availableTargets || navigationTargets(panel); // Reconcile scope before accepting a stale control.
    if (currentTarget && (targets.includes(currentTarget) || (!targets.length && currentTarget === navigationRoot(panel)))) {
      if (!currentTarget.classList.contains('ctrl-nav-focus')) currentTarget.classList.add('ctrl-nav-focus');
      return;
    }
    setFocus(recoverFocusTarget(panel, targets) || pickDefaultTarget(panel, targets) || navigationRoot(panel), { scroll: !scrolledSelection });
  }

  function visibleNavigationRect(el) {
    const rect = el.getBoundingClientRect(); // Clips against both the screen and every overflow ancestor, including nested scroll panes.
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top); // Visible bounds are also used to score partially visible groups.
    let right = Math.min(window.innerWidth, rect.left + rect.width), bottom = Math.min(window.innerHeight, rect.top + rect.height);
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node); // Only evaluated on the first directional gesture after manual scrolling.
      const clipX = /auto|scroll|hidden|clip/.test(style.overflowX || style.overflow); // CSS overflow clips candidates even when they are still laid out.
      const clipY = /auto|scroll|hidden|clip/.test(style.overflowY || style.overflow);
      if (!clipX && !clipY) continue;
      const bounds = node.getBoundingClientRect(); // One ancestor rectangle supplies both clipping axes.
      if (clipX) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.left + bounds.width); }
      if (clipY) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.top + bounds.height); }
    }
    return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
  }

  function reanchorAfterScroll(panel, dir) {
    if (scrolledSelection?.panel !== panel) return false;
    const candidates = navigationTargets(panel).map(el => ({ el, rect: visibleNavigationRect(el) })).filter(candidate => candidate.rect); // Manual scrolling reanchors inside the entered scope; only Back leaves it.
    if (!candidates.length) return true; // Keep the pending reanchor until more controls become visible; never jump offscreen.
    const current = candidates.find(candidate => candidate.el === currentTarget); // A still-visible selection keeps normal directional intent within visible candidates.
    const hostRect = visibleNavigationRect(scrolledSelection.host) || panel.getBoundingClientRect(); // Anchors a lost selection in the region the player just scrolled.
    const origin = current?.rect || { left: hostRect.left + hostRect.width / 2, top: hostRect.top + hostRect.height / 2, width: 0, height: 0 };
    const best = bestVectorCandidate(candidates, origin, dir, CONE_HALF_ANGLE)
      || bestVectorCandidate(candidates, origin, dir, WIDE_CONE_HALF_ANGLE)
      || bestVectorCandidate(candidates, origin, dir)
      || current?.el || pickDefaultTarget(panel, candidates.map(candidate => candidate.el));
    scrolledSelection = null;
    setFocus(best, { scroll: false });
    updateHintBar(panel);
    return true;
  }

  // ── spatial navigation ──────────────────────────────────────────────
  // Navigation is vector-based rather than reducing an analog throw to four
  // independent cardinal presses. Imagine a narrow invisible cone projected
  // from the current control's center along the stick direction: candidates
  // whose rectangles intersect that cone compete first, then a wider cone,
  // then the forward half-plane as a no-dead-end fallback.
  function rectCenter(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function normalizedDirection(x, y) {
    const magnitude = Math.hypot(Number(x) || 0, Number(y) || 0);
    if (magnitude <= 1e-6) return null;
    return { x: (Number(x) || 0) / magnitude, y: (Number(y) || 0) / magnitude, magnitude };
  }

  function coneMetrics(curRect, candRect, dir, halfAngle) {
    const cur = rectCenter(curRect), cand = rectCenter(candRect);
    const dx = cand.x - cur.x, dy = cand.y - cur.y;
    const forward = dx * dir.x + dy * dir.y;
    if (forward <= 1) return null;
    const lateral = Math.abs(dx * -dir.y + dy * dir.x);
    const halfProjection = Math.abs(dir.y) * candRect.width * 0.5 + Math.abs(dir.x) * candRect.height * 0.5; // Candidate extent perpendicular to the ray, so the cone hits the visible rectangle rather than requiring its center inside.
    const edgeGap = Math.max(0, lateral - halfProjection);
    const coneLimit = forward * Math.tan(halfAngle) + CONE_EDGE_FORGIVENESS;
    if (edgeGap > coneLimit) return null;
    const anglePenalty = edgeGap / Math.max(1, forward); // Strongly prefers something centered on the intended ray when two controls are similarly near.
    return { forward, lateral, edgeGap, score: forward + edgeGap * 2.8 + anglePenalty * 160 };
  }

  function halfPlaneScore(curRect, candRect, dir) {
    const cur = rectCenter(curRect), cand = rectCenter(candRect);
    const dx = cand.x - cur.x, dy = cand.y - cur.y;
    const forward = dx * dir.x + dy * dir.y;
    if (forward <= 1) return null;
    const lateral = Math.abs(dx * -dir.y + dy * dir.x);
    return forward + lateral * 2.2;
  }

  function bestVectorCandidate(candidates, curRect, dir, halfAngle = null) {
    let best = null, bestScore = Infinity;
    for (const candidate of candidates) {
      const cand = candidate.el, candRect = candidate.rect;
      if (cand === currentTarget) continue;
      const metrics = halfAngle == null
        ? { score: halfPlaneScore(curRect, candRect, dir) }
        : coneMetrics(curRect, candRect, dir, halfAngle);
      const score = metrics?.score;
      if (!Number.isFinite(score)) continue;
      if (score < bestScore) { bestScore = score; best = cand; }
    }
    return best;
  }

  function moveVector(x, y) {
    const panel = activePanel();
    if (!panel) return false;
    const direction = normalizedDirection(x, y); // Reanchor before stale-focus recovery can scroll to a rebuilt/offscreen control.
    if (!direction) return false;
    if (reanchorAfterScroll(panel, direction)) return true;
    const targets = navigationTargets(panel); // Built once for this gesture/repeat and shared by focus validation plus candidate scoring.
    navigationPerf.targetCount = targets.length;
    navigationPerf.rectReads = 0;
    refreshFocusIfStale(targets);
    if (!targets.length) return false;
    if (!currentTarget) { setFocus(pickDefaultTarget(panel, targets)); return true; }
    const dir = normalizedDirection(x, y);
    if (!dir) return false;
    const candidates = targets.map(el => ({ el, rect: el.getBoundingClientRect() })); // Used by all cone passes so each candidate layout rectangle is read only once per navigation step.
    navigationPerf.rectReads = candidates.length;
    const currentCandidate = candidates.find(candidate => candidate.el === currentTarget);
    const curRect = currentCandidate?.rect || currentTarget.getBoundingClientRect();
    if (!currentCandidate) navigationPerf.rectReads += 1;
    const best = bestVectorCandidate(candidates, curRect, dir, CONE_HALF_ANGLE)
      || bestVectorCandidate(candidates, curRect, dir, WIDE_CONE_HALF_ANGLE)
      || bestVectorCandidate(candidates, curRect, dir, null);
    if (!best) return false;
    setFocus(best);
    return true;
  }

  function move(dir) {
    switch (dir) {
      case 'left': return moveVector(-1, 0);
      case 'right': return moveVector(1, 0);
      case 'up': return moveVector(0, -1);
      case 'down': return moveVector(0, 1);
      default: return false;
    }
  }



  function moveOrAdjust(dir) {
    // Focused range controls consume horizontal input, so gamepad D-pad and stick can adjust pattern/size sliders without moving focus away.
    if (currentTarget?.tagName === 'INPUT' && currentTarget.type === 'range' && (dir === 'left' || dir === 'right')) {
      const min = Number.isFinite(currentTarget.minAsNumber) ? currentTarget.minAsNumber : Number(currentTarget.min || 0);
      const max = Number.isFinite(currentTarget.maxAsNumber) ? currentTarget.maxAsNumber : Number(currentTarget.max || 100);
      const step = Number(currentTarget.step) > 0 ? Number(currentTarget.step) : 1;
      const next = Math.max(min, Math.min(max, currentTarget.valueAsNumber + (dir === 'right' ? step : -step)));
      if (next !== currentTarget.valueAsNumber) {
        currentTarget.value = String(next);
        currentTarget.dispatchEvent(new Event('input', { bubbles: true }));
        currentTarget.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }
    return move(dir);
  }

  function moveVectorOrAdjust(x, y) {
    // Horizontal stick movement adjusts a focused slider; vertical movement continues spatial navigation.
    if (currentTarget?.tagName === 'INPUT' && currentTarget.type === 'range' && Math.abs(x) > Math.abs(y) * 1.2) {
      return moveOrAdjust(x < 0 ? 'left' : 'right');
    }
    return moveVector(x, y);
  }

  // ── activate / cancel / tabs ────────────────────────────────────────
  // Opt-in panels can give Confirm/Back/bumpers a fixed meaning without polling a second controller path.
  function panelOwnsAction(panel, action) {
    if (!panel.hasAttribute('data-ctrl-actions')) return false;
    return !panel.dispatchEvent(new CustomEvent('hobunji-controller-panel-action', { detail: { action }, cancelable: true }));
  }

  function activate() {
    const panel = activePanel();
    if (!panel || panelOwnsAction(panel, 'confirm')) return;
    refreshFocusIfStale();
    if (!currentTarget) return;
    if (isGroup(currentTarget)) {
      if (currentTarget !== navigationRoot(panel)) enterGroup(currentTarget, panel);
      return;
    }
    if (isDisabled(currentTarget)) return; // Inspectable locked effects can glow without bypassing purchase prerequisites.
    if (currentTarget.tagName === 'SELECT') { currentTarget.focus(); return; }
    if (isTextEditable(currentTarget)) { currentTarget.blur(); return; }
    if (currentTarget.tagName === 'INPUT' && (currentTarget.type === 'checkbox' || currentTarget.type === 'radio')) {
      currentTarget.click();
      return;
    }
    const tabGroup = currentTarget.closest(TABS_SELECTOR); // Tab selection releases its chooser nest so directional input can enter the selected page.
    if (tabGroup) {
      currentTarget.click();
      clearGroups(panel);
      scrolledSelection = null;
      setFocus(groupTarget(tabGroup, panel, panel), { scroll: false });
      return;
    }
    const detailId = currentTarget.getAttribute('data-ctrl-detail'); // Optional association is captured before the item's click can replace its card.
    const returnPath = focusPath; // Preserves exact stack/clothing identity for Back and whole-grid rebuilds.
    currentTarget.click();
    if (!detailId || activePanel() !== panel) return;
    const detail = Array.from(panel.querySelectorAll('[data-ctrl-detail-panel]')).find(node => node.id === detailId); // No CSS selector interpolation; ids are compared literally within this panel.
    if (detail && isGroup(detail) && isNavTarget(detail) && belongsToNavigation(detail, panel)) enterGroup(detail, panel, returnPath);
  }

  function cancel() {
    const panel = activePanel();
    if (!panel || panelOwnsAction(panel, 'cancel')) return;
    if (leaveGroup(panel)) return;
    const btn = Array.from(panel.querySelectorAll('[data-ctrl-cancel]')).find(el => isNavTarget(el) && belongsToNavigation(el, panel));
    if (btn) { btn.click(); return; }
    // Panels added later occasionally omit data-ctrl-cancel. Give B a safe,
    // universal fallback through the same Escape path their keyboard close
    // handlers already support rather than leaving controller users trapped.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }

  function findTabGroup(panel) {
    const groups = Array.from(panel.querySelectorAll(TABS_SELECTOR)).filter(group => isVisible(group) && belongsToNavigation(group, panel)); // Bumpers remain available from every entered section; the outer menu's tab bar is the fallback.
    if (!groups.length) return null;
    if (currentTarget) {
      const containing = groups.find(g => g.contains(currentTarget));
      if (containing) return containing;
    }
    return groups[0];
  }

  const sectionScrollPositions = new WeakMap(); // Each page retains its own positions in shared scrolling ancestors.
  function saveSectionScroll(section, panel) {
    const positions = new Map(); // Stored only when switching pages, never while polling the controller.
    for (let node = section; node && panel.contains(node); node = node.parentElement) {
      if (Number.isFinite(node.scrollTop)) positions.set(node, node.scrollTop);
    }
    sectionScrollPositions.set(section, positions);
  }

  function restoreSectionScroll(section, panel) {
    const positions = sectionScrollPositions.get(section); // New pages start at the top; revisited pages keep their reading position.
    for (let node = section; node && panel.contains(node); node = node.parentElement) {
      if (!Number.isFinite(node.scrollTop)) continue;
      const top = positions?.get(node) || 0; // Also resets an ancestor left scrolled by a different, longer page.
      if (node.scrollTop !== top) node.scrollTop = top;
    }
    cachedScrollHost = null;
  }

  function selectLocalSection(group, panel, nextIndex) {
    if (activePanel() !== panel || !subtabsByGroup.has(group)) return;
    const entries = enteredGroups(panel); // Switching sections drops only descendants of the local owner.
    const state = subtabsByGroup.get(group); // Retains index even for authored sections without ids.
    const next = state.sections[nextIndex]; // Selected DOM identity is retained before restoring sibling visibility.
    if (!next || !entries.some(entry => entry.node === group)) return;
    for (const removed of entries.splice(entries.findIndex(entry => entry.node === group) + 1)) { restoreSubtabs(removed.node); removed.node.classList.remove('ctrl-nav-group-active'); }
    saveSectionScroll(state.selected, panel);
    prepareSubtabsWithMemory(group, panel, next.id || null, next.id ? 0 : nextIndex, false);
    restoreSectionScroll(next, panel);
    lastFocusedByGroup.set(state.selected, currentTarget);
    scrolledSelection = null;
    const targets = navigationTargets(panel); // Fresh controls may have appeared since the last section switch.
    const remembered = lastFocusedByGroup.get(next); // Switching back to a section restores its surviving control.
    setFocus(targets.includes(remembered) ? remembered : pickDefaultTarget(panel, targets) || navigationRoot(panel), { scroll: false });
    updateHintBar(panel);
  }

  function cycleTabs(delta) {
    const panel = activePanel();
    if (!panel || panelOwnsAction(panel, delta < 0 ? 'previous' : 'next')) return;
    const local = localSubtabs(panel); // The deepest entered section borrows configured tab actions until Back leaves it.
    if (local) {
      const state = subtabsByGroup.get(local.node); // The visible choice strip and bumpers share the same section owner.
      selectLocalSection(local.node, panel, (state.sections.indexOf(state.selected) + delta + state.sections.length) % state.sections.length);
      return;
    }
    const group = findTabGroup(panel);
    if (!group) return;
    const items = Array.from(group.children).filter(el => isNavTarget(el) || (el.matches?.(NAV_SELECTOR) && isVisible(el) && !isDisabled(el)));
    if (!items.length) return;
    let idx = items.findIndex(el => el === currentTarget || el.classList.contains('active'));
    if (idx < 0) idx = 0;
    const next = items[(idx + delta + items.length) % items.length];
    next.click();
    clearGroups(panel);
    scrolledSelection = null;
    setFocus(groupTarget(group, panel, panel), { scroll: false });
  }

  // ── on-screen button hint bar ───────────────────────────────────────
  let hintEl = null;
  function ensureHintEl() {
    if (hintEl) return hintEl;
    hintEl = document.createElement('div');
    hintEl.className = 'ctrl-nav-hint-bar';
    hintEl.setAttribute('aria-label', 'Controller navigation');
    hintEl.setAttribute('role', 'group');
    hintEl.setAttribute('data-ctrl-skip', '');
    hintEl.innerHTML =
      '<span class="ctrl-nav-hint"><span class="ctrl-nav-glyph ctrl-nav-glyph-a">A</span>Select</span>' +
      '<span class="ctrl-nav-hint"><span class="ctrl-nav-glyph ctrl-nav-glyph-b">B</span>Back</span>' +
      '<span class="ctrl-nav-hint ctrl-nav-hint-tabs"><span class="ctrl-nav-glyph">LB/RB</span>Switch Tabs</span>' +
      '<span class="ctrl-nav-scroll-hint">Right stick: Scroll</span>' +
      '<div class="ctrl-nav-section-choices" role="group" aria-label="Sections in this page" hidden></div>';
    document.body.appendChild(hintEl);
    return hintEl;
  }

  let padEverSeen = false;
  window.addEventListener('gamepadconnected', () => { padEverSeen = true; updateHintBar(activePanel()); });

  function navigationLabel(node) {
    const authored = node?.getAttribute('aria-label') || node?.querySelector('.settings-section-title, .menu-section-title, .progress-section-title, .farm-storage-col-title, h2, h3')?.textContent; // Uses the same headings players see within each section.
    return String(authored || node?.id?.replace(/^(mp|inv|farm|tasks|settings|stable)(Section)?/, '').replace(/([a-z])([A-Z])/g, '$1 $2') || 'Section').trim();
  }

  function updateSectionChoices(host, local, state, panel) {
    if (!host) return;
    if (!state) {
      if (!host.hidden) host.hidden = true;
      return;
    }
    if (host.hidden) host.hidden = false;
    const signature = state.sections.map(navigationLabel).join('\n'); // Label changes and rebuilt sections refresh the strip only on navigation events.
    if (host._sectionOwner !== local.node || host._sectionSignature !== signature) {
      host.replaceChildren();
      state.sections.forEach((section, index) => {
        const button = document.createElement('button'); // Pointer players can choose an otherwise hidden controller section directly.
        button.type = 'button';
        button.textContent = navigationLabel(section);
        button.addEventListener('click', () => selectLocalSection(local.node, panel, index));
        host.appendChild(button);
      });
      host._sectionOwner = local.node;
      host._sectionSignature = signature;
    }
    Array.from(host.children).forEach((button, index) => {
      const selected = String(state.sections[index] === state.selected); // Visible selection follows the same section state as LB/RB.
      const changed = button.getAttribute('aria-pressed') !== selected; // Unchanged focus updates must not undo a player's manual horizontal scrolling.
      if (changed) button.setAttribute('aria-pressed', selected);
      if (changed && selected === 'true') button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  }

  function updateHintBar(panel) {
    if (!panel || !padEverSeen) { hideHintBar(); return; }
    const el = ensureHintEl();
    const host = panel.id === 'menuPanel' ? panel : document.body; // The main menu reserves footer space; other panels retain their existing floating hints.
    if (el.parentElement !== host) host.appendChild(el);
    el.classList.toggle('ctrl-nav-hint-bar-visible', true);
    const local = localSubtabs(panel); // Also advertises local sections while the outer tab bar is borrowed.
    const hasTabs = !!local || !!findTabGroup(panel); // The hint advertises bumpers wherever the menu has a visible tab bar.
    const hasCancel = true; // B always works: explicit close button first, universal Escape fallback otherwise.
    el.querySelector('.ctrl-nav-hint-tabs').style.display = hasTabs ? '' : 'none';
    const bindings = window.InputBindings; // Hints follow remapped controls rather than hardcoding the physical Xbox defaults.
    const glyphs = el.querySelectorAll('.ctrl-nav-glyph'); // Reuse the existing hint elements.
    const label = action => bindings?.buttonLabel?.(configuredControllerBinding(action)) || ({ uiConfirm: 'A', uiCancel: 'B', uiTabPrev: 'LB', uiTabNext: 'RB' })[action]; // Fallback is only for startup before binding initialization.
    const labels = [label(UI_ACTIONS.confirm), label(UI_ACTIONS.cancel), `${label(UI_ACTIONS.tabPrev)}/${label(UI_ACTIONS.tabNext)}`]; // Same configured actions drive polling and the on-screen hints.
    glyphs.forEach((glyph, index) => { if (glyph.textContent !== labels[index]) glyph.textContent = labels[index]; });
    const tabHint = el.querySelector('.ctrl-nav-hint-tabs'); // Include section position/name so hidden siblings remain discoverable.
    const state = local && subtabsByGroup.get(local.node); // Used only while updating menu hints, never on idle gameplay frames.
    updateSectionChoices(el.querySelector('.ctrl-nav-section-choices'), local, state, panel);
    const sectionLabel = state && navigationLabel(state.selected); // Prefer authored human-facing labels.
    const hintText = state ? ` ${String(sectionLabel).trim()} (${state.sections.indexOf(state.selected) + 1}/${state.sections.length})` : ' Switch pages'; // Communicates the currently borrowed scope.
    if (tabHint.lastChild?.nodeType === 3 && tabHint.lastChild.textContent !== hintText) tabHint.lastChild.textContent = hintText;
    const bBtn = el.querySelectorAll('.ctrl-nav-hint')[1];
    if (bBtn) {
      bBtn.style.display = hasCancel ? '' : 'none';
      const backText = enteredGroups(panel).length ? ' Back to sections' : ' Close'; // Makes the consequence of Back visible at each depth.
      if (bBtn.lastChild?.nodeType === 3 && bBtn.lastChild.textContent !== backText) bBtn.lastChild.textContent = backText;
    }
    const confirmHint = el.querySelector('.ctrl-nav-hint'); // Distinguishes entering a section from activating an item.
    const confirmText = currentTarget && isGroup(currentTarget) ? ' Enter section' : ' Select';
    if (confirmHint?.lastChild?.nodeType === 3 && confirmHint.lastChild.textContent !== confirmText) confirmHint.lastChild.textContent = confirmText;
  }

  function hideHintBar() {
    if (hintEl) hintEl.classList.remove('ctrl-nav-hint-bar-visible');
  }

  // ── gamepad polling (shared authority; cheap when idle) ─────────────
  const dirState = { up: mkDirState(), down: mkDirState(), left: mkDirState(), right: mkDirState() };
  const stickState = { down: false, next: 0, x: 0, y: 0 }; // One analog gesture state prevents diagonals from causing two cardinal moves in the same frame.
  function mkDirState() { return { down: false, next: 0 }; }
  function pollDirection(name, isDown, now, fire) {
    const st = dirState[name];
    if (isDown) {
      if (!st.down) { st.down = true; st.next = now + REPEAT_INITIAL_MS; fire(); }
      else if (now >= st.next) { st.next = now + REPEAT_RATE_MS; fire(); }
    } else {
      st.down = false;
    }
  }

  function resetStickState() {
    stickState.down = false;
    stickState.next = 0;
    stickState.x = 0;
    stickState.y = 0;
  }

  function pollStickVector(rawX, rawY, now) {
    const magnitude = Math.hypot(rawX, rawY);
    if (magnitude < NAV_PRESS) { resetStickState(); return; }
    const x = rawX / Math.max(magnitude, 1e-6), y = rawY / Math.max(magnitude, 1e-6);
    const directionChanged = stickState.down && (x * stickState.x + y * stickState.y) < STICK_DIRECTION_RESET_COS;
    if (!stickState.down || directionChanged) {
      stickState.down = true;
      stickState.x = x;
      stickState.y = y;
      stickState.next = now + REPEAT_INITIAL_MS;
      moveVectorOrAdjust(x, y);
      return;
    }
    stickState.x = x;
    stickState.y = y;
    if (now >= stickState.next) {
      stickState.next = now + REPEAT_RATE_MS;
      moveVectorOrAdjust(x, y);
    }
  }

  const edgeActions = Object.freeze([UI_ACTIONS.confirm, UI_ACTIONS.cancel, UI_ACTIONS.tabPrev, UI_ACTIONS.tabNext, UI_ACTIONS.open]); // Used to track only menu actions that need press edges; directional repeats keep their separate state.
  const actionEdgeState = Object.create(null); // Used as reusable per-action edge memory so active-menu polling does not allocate a Set every frame.
  for (const actionId of edgeActions) actionEdgeState[actionId] = false;
  function resetActionEdges() {
    for (const actionId of edgeActions) actionEdgeState[actionId] = false;
  }
  function actionPressed(actionId, isDown) {
    const pressed = Boolean(isDown) && !actionEdgeState[actionId];
    actionEdgeState[actionId] = Boolean(isDown);
    return pressed;
  }
  let menuOpenEdge = false;
  let cachedScrollHost = null; // Reused while a right-stick gesture remains inside the same visible navigation scope.
  function findScrollHost(panel, direction) {
    if (!panel) return null;
    const scope = subtabsByGroup.get(localSubtabs(panel)?.node)?.selected || navigationRoot(panel); // Prefer the visible local page, including read-only pages.
    const canScroll = element => {
      if (!element || !panel.contains(element) || !isVisible(element)) return false;
      const style = getComputedStyle(element); // Overflow:hidden clips content but must never become a manual scroll destination.
      if (!/auto|scroll|overlay/.test(style.overflowY || style.overflow || '')) return false;
      const max = element.scrollHeight - element.clientHeight; // Direction-aware bounds allow nested scroll regions to hand off at their edges.
      return max > 1 && (direction > 0 ? element.scrollTop < max - 1 : element.scrollTop > 0);
    };
    const sign = Math.sign(direction); // Reversing the stick rechecks the innermost scroller before a previous outer handoff.
    if (cachedScrollHost?.panel === panel && cachedScrollHost.scope === scope && cachedScrollHost.target === currentTarget && cachedScrollHost.sign === sign) {
      if (canScroll(cachedScrollHost.host)) return cachedScrollHost.host;
      if (!cachedScrollHost.host && Date.now() < cachedScrollHost.retryAt) return null;
    }
    const remember = host => { cachedScrollHost = { panel, scope, target: currentTarget, sign, host, retryAt: Date.now() + 150 }; return host; }; // Avoid a full descendant scan on each held-stick frame.
    for (let node = currentTarget; node && panel.contains(node); node = node.parentElement) {
      if ((scope.contains(node) || node.contains(scope)) && canScroll(node)) return remember(node);
    }
    for (const node of scope.querySelectorAll('*')) if (canScroll(node)) return remember(node);
    for (let node = scope; node && panel.contains(node); node = node.parentElement) if (canScroll(node)) return remember(node);
    return remember(null);
  }

  let lastGamepadPollAt = 0; // Used to keep analog right-stick menu scrolling independent of display refresh rate.

  function pollGamepad(frame) {
    const now = frame.now;
    if (!frame.focused) return;
    const pad = frame.pad; // Resolved once per frame by the shared polling authority.
    if (!pad) { resetActionEdges(); menuOpenEdge = false; resetStickState(); return; }
    padEverSeen = true;
    if (pad.buttons?.some(button => button.pressed || Number(button.value) > 0.5) || pad.axes?.some(axis => Math.abs(Number(axis) || 0) > NAV_PRESS)) automaticEntryEnabled = true;

    if (window.InputSettingsPanel?.isControllerListening?.()) {
      resetActionEdges();
      menuOpenEdge = false;
      resetStickState();
      return;
    }

    const currentBindings = window.InputBindings?.getCurrentBindings?.()?.controller || null; // Used by every menu action in this frame so the live binding map is resolved once instead of once per action.
    if (!isActive()) {
      resetStickState();
      // Nothing to navigate — the only job left is offering a way to open
      // the pause menu at all from a controller with no keyboard nearby.
      const openDown = controllerActionDown(frame, UI_ACTIONS.open, currentBindings); // Used to let the configured Menu Open/Close action own this edge instead of a fixed View/Share button.
      resetActionEdges();
      actionEdgeState[UI_ACTIONS.open] = openDown; // Prevents the same held configured open press from immediately closing the menu on its next active frame.
      if (openDown && !menuOpenEdge) {
        document.getElementById('menuBtn')?.click();
      }
      menuOpenEdge = openDown;
      return;
    }
    menuOpenEdge = false;
    if (window.FarmPanel?.handleLayoutControllerFrame?.(frame, actionId => controllerActionDown(frame, actionId, currentBindings))) {
      resetStickState();
      for (const state of Object.values(dirState)) { state.down = false; state.next = 0; } // No menu-navigation repeats leak out after the tile cursor hands control back.
      for (const actionId of edgeActions) actionEdgeState[actionId] = controllerActionDown(frame, actionId, currentBindings); // Held A/B must not activate menu controls when exiting cursor mode.
      return;
    }

    const navStick = window.ControllerInput?.normalizeStick?.(pad.axes[0], pad.axes[1], DEADZONE, 1) || { x: pad.axes[0] || 0, y: pad.axes[1] || 0 };
    const rawAx = Number(pad.axes[0]) || 0, rawAy = Number(pad.axes[1]) || 0; // Used to preserve the physical analog direction before cone scoring.
    const digitalLeft = controllerActionDown(frame, UI_ACTIONS.left, currentBindings);
    const digitalRight = controllerActionDown(frame, UI_ACTIONS.right, currentBindings);
    const digitalUp = controllerActionDown(frame, UI_ACTIONS.up, currentBindings);
    const digitalDown = controllerActionDown(frame, UI_ACTIONS.down, currentBindings);
    const digitalDirectionActive = digitalLeft || digitalRight || digitalUp || digitalDown;
    pollDirection('left', digitalLeft, now, () => moveOrAdjust('left'));
    pollDirection('right', digitalRight, now, () => moveOrAdjust('right'));
    pollDirection('up', digitalUp, now, () => move('up'));
    pollDirection('down', digitalDown, now, () => move('down'));
    if (digitalDirectionActive) resetStickState();
    else pollStickVector(rawAx, rawAy, now); // One true-vector decision per analog gesture/repeat; diagonals never double-step.

    const scrollStick = window.ControllerInput?.normalizeStick?.(pad.axes[2], pad.axes[3], DEADZONE, 1.3) || { y: 0 };
    window.dispatchEvent(new CustomEvent('hobunji-controller-ui-snapshot', { detail: { pad, move: navStick, look: scrollStick } })); // Keeps the in-game debug line live while paused gameplay polling is suspended.
    const scrollDt = lastGamepadPollAt ? Math.min(0.05, Math.max(0, (now - lastGamepadPollAt) / 1000)) : 1 / 60; // Caps resume spikes after a backgrounded tab.
    lastGamepadPollAt = now;
    if (Math.abs(scrollStick.y) > 0.02) {
      const panel = activePanel();
      const scrollHost = findScrollHost(panel, scrollStick.y); // Information pages do not need a selectable control to scroll.
      if (scrollHost) {
        const previousTop = scrollHost.scrollTop; // Only an actual manual scroll invalidates directional focus's old anchor.
        scrollHost.scrollTop += scrollStick.y * 720 * scrollDt;
        if (scrollHost.scrollTop !== previousTop) scrolledSelection = { panel, host: scrollHost };
      }
    }

    const confirmDown = controllerActionDown(frame, UI_ACTIONS.confirm, currentBindings);
    const cancelDown = controllerActionDown(frame, UI_ACTIONS.cancel, currentBindings);
    const tabPrevDown = controllerActionDown(frame, UI_ACTIONS.tabPrev, currentBindings);
    const tabNextDown = controllerActionDown(frame, UI_ACTIONS.tabNext, currentBindings);
    const openDown = controllerActionDown(frame, UI_ACTIONS.open, currentBindings);
    if (actionPressed(UI_ACTIONS.confirm, confirmDown)) activate();
    if (actionPressed(UI_ACTIONS.cancel, cancelDown)) cancel();
    if (actionPressed(UI_ACTIONS.tabPrev, tabPrevDown)) cycleTabs(-1);
    if (actionPressed(UI_ACTIONS.tabNext, tabNextDown)) cycleTabs(1);
    if (actionPressed(UI_ACTIONS.open, openDown)) cancel();
  }
  window.ControllerInput?.subscribe?.('controller-ui-nav', pollGamepad, window.ControllerInput.PRIORITY.menuNav);

  // ── keyboard (arrow-key nav + Enter/Tab) ────────────────────────────
  // Registered on the capture phase so it runs (and can stop propagation)
  // before game.js's own bubble-phase keydown handler ever sees the event
  // — the same technique cooking-system.js already uses for its Escape
  // handling. Escape itself is deliberately left untouched: every panel in
  // this game already closes correctly on Escape via its own handler.
  window.addEventListener('keydown', (event) => {
    if (!isActive()) return;
    // The baby-name popup is a true form, not a game tab strip: allow native Tab/Shift+Tab
    // to move among its text field and buttons. Its own focus trap keeps focus inside.
    if (event.key === 'Tab' && activePanel()?.id === 'animalBabyArrivalOverlay') return;
    if (isTextEditable(document.activeElement)) return;
    if (window.FarmPanel?.handleLayoutCursorKey?.(event)) { // Cursor arrows/Confirm/Escape take priority only while a 3D grid viewport is active.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    switch (event.key) {
      case 'ArrowUp': move('up'); break;
      case 'ArrowDown': move('down'); break;
      case 'ArrowLeft': moveOrAdjust('left'); break;
      case 'ArrowRight': moveOrAdjust('right'); break;
      case 'Enter': case ' ': activate(); break;
      case 'Tab': cycleTabs(event.shiftKey ? -1 : 1); break;
      case 'Escape': { // Unwinds only nests entered with Confirm; otherwise Escape reaches game.js and closes the menu.
        const panel = activePanel();
        if (!enteredGroups(panel).at(-1)?.explicit || !leaveGroup(panel)) return;
        break;
      }
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  }, true);

  // Keep the tracked focus target in sync with real mouse/touch clicks too,
  // so switching input devices mid-session (controller ↔ mouse) never
  // leaves the highlighted target pointing somewhere stale.
  document.addEventListener('pointerdown', event => { if (event.target?.closest?.('.ctrl-nav-section-choices')) return; automaticEntryEnabled = false; const panel = activePanel(); if (panel && subtabsByGroup.size) { clearGroups(panel); updateHintBar(panel); } }, true);

  document.addEventListener('focusin', (event) => {
    const panel = activePanel();
    if (panel && isNavTarget(event.target) && belongsToNavigation(event.target, panel)) {
      adoptFocusedGroups(event.target, panel);
      if (currentTarget && currentTarget !== event.target) currentTarget.classList.remove('ctrl-nav-focus');
      currentTarget = event.target;
      rememberFocusPath(currentTarget);
      if (!currentTarget.classList.contains('ctrl-nav-focus')) currentTarget.classList.add('ctrl-nav-focus');
    }
  }, true);

  // ── panel discovery: MutationObserver (open/close via class/style/attr) ──
  // Split in two so ordinary UI churn doesn't pay for panel-visibility
  // tracking: structuralObserver watches the whole body (subtree+childList,
  // no attributes) purely to notice a panel node itself being
  // added/removed — e.g. cooking-system.js building its layer fresh. Actual
  // visibility toggles (class/style/aria-hidden/hidden) are watched only on
  // the handful of registered panel roots themselves via attrObserver,
  // since panelVisible() above already only ever looks at a panel's own
  // computed style, never an ancestor's. A single document-wide attribute
  // observer used to re-run reconcileStack (a full querySelectorAll +
  // getComputedStyle/getBoundingClientRect pass) on every class/style
  // mutation anywhere in the entire game UI — item icons, tooltips, HUD
  // updates, hover states — which showed up as ~5% of total frame time
  // spent just in querySelectorAll during ordinary inventory browsing.
  let reconcileQueued = false;
  let visibilityEarlyTimer = 0; // Catches the first rendered frame of an opening opacity transition without restoring continuous polling.
  let visibilitySettleTimer = 0; // Rechecks after opacity transitions without polling layout throughout gameplay.
  function scheduleReconcile() {
    if (reconcileQueued) return;
    reconcileQueued = true;
    queueMicrotask(() => {
      reconcileQueued = false;
      reconcileStack();
      const panel = activePanel(); // Refresh section pages only when menu content changed, not from controller idle polling.
      if (panel) {
        for (const entry of enteredGroups(panel)) {
          const state = subtabsByGroup.get(entry.node); // Reapply presentation after dynamic section/list rebuilds.
          if (state) prepareSubtabsWithMemory(entry.node, panel, state.selected.id || null, state.selected.id ? 0 : state.sections.indexOf(state.selected), false);
        }
        refreshFocusIfStale();
        updateHintBar(panel);
      }
    });
  }
  function scheduleVisibilitySettle() {
    clearTimeout(visibilityEarlyTimer);
    clearTimeout(visibilitySettleTimer);
    visibilityEarlyTimer = setTimeout(() => {
      visibilityEarlyTimer = 0;
      reconcileStack();
    }, 32);
    visibilitySettleTimer = setTimeout(() => {
      visibilitySettleTimer = 0;
      reconcileStack();
    }, 240);
  }
  function isControllerPanel(panel) {
    if (!panel?.matches?.(PANEL_SELECTOR)) return false;
    if (panel.matches(SEMANTIC_PANEL_SELECTOR) && !panel.matches(EXPLICIT_PANEL_SELECTOR) && panel.parentElement?.closest?.(EXPLICIT_PANEL_SELECTOR)) return false; // An explicit outer owner wins so a semantic dialog nested inside it cannot create a duplicate stack layer.
    return true;
  }
  function registerPanel(panel) {
    if (!isControllerPanel(panel)) return false;
    const added = !knownPanels.has(panel);
    knownPanels.add(panel);
    watchPanelAttributes(panel);
    return added;
  }
  function registerPanelsIn(node) {
    if (!node || node.nodeType !== 1) return false;
    let changed = registerPanel(node);
    for (const panel of node.querySelectorAll?.(PANEL_SELECTOR) || []) changed = registerPanel(panel) || changed;
    return changed;
  }
  const structuralObserver = new MutationObserver((records) => {
    let panelTreeChanged = false;
    for (const record of records) {
      for (const node of record.addedNodes) panelTreeChanged = registerPanelsIn(node) || panelTreeChanged;
      for (const node of record.removedNodes) {
        if (node.nodeType === 1 && (node.matches?.(PANEL_SELECTOR) || node.querySelector?.(PANEL_SELECTOR))) panelTreeChanged = true;
      }
    }
    const panel = activePanel(); // A target-less panel retries only when its own content changes, not on every HUD text update.
    const panelContentChanged = !!panel && (!currentTarget || subtabsByGroup.size > 0) && records.some(record => panel.contains(record.target) && record.target !== hintEl && !hintEl?.contains(record.target));
    if (panelTreeChanged || (currentTarget && !currentTarget.isConnected) || panelContentChanged) scheduleReconcile();
  });
  const attrObserver = new MutationObserver(() => {
    scheduleReconcile();
    scheduleVisibilitySettle();
  });
  const attrWatchedPanels = new WeakSet();
  function watchPanelAttributes(panel) {
    if (attrWatchedPanels.has(panel)) return;
    attrWatchedPanels.add(panel);
    attrObserver.observe(panel, { attributes: true, attributeFilter: ['class', 'style', 'aria-hidden', 'hidden'] });
    // isVisible() also honors ancestors, so a wrapper toggled with `hidden`/aria-hidden (e.g. the Shipping Box window root) must wake reconcile too. Only those two attributes, so ordinary class/style churn up the tree stays free.
    for (let node = panel.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      attrObserver.observe(node, { attributes: true, attributeFilter: ['aria-hidden', 'hidden'] });
    }
  }
  function startObserving() {
    structuralObserver.observe(document.body, { childList: true, subtree: true });
    document.body.addEventListener('transitionend', (event) => {
      if (event.target?.matches?.(PANEL_SELECTOR)) scheduleReconcile();
    }, true);
  }
  function boot() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', boot, { once: true }); return; }
    registerPanelsIn(document.body);
    startObserving();
    reconcileStack();
  }
  boot();

  window.ControllerUI = {
    isActive,
    activePanel,
    focusPanel(panel) {
      registerPanel(panel);
      reconcileStack();
      if (!stack.includes(panel)) return false;
      const modal = [...stack].reverse().find(entry => entry !== panel && entry.hasAttribute?.('data-ctrl-modal')); // A pinned modal refuses focus theft.
      if (modal && !panel.hasAttribute?.('data-ctrl-modal')) return false;
      stack = stack.filter(entry => entry !== panel);
      stack.push(panel);
      activatePanel(panel);
      window.ControllerInput?.setOwner?.('menu');
      return true;
    }, // Modal owners can synchronously claim focus before staged controls become visible.
    focusedElement: () => currentTarget,
    navigateVector: (x, y) => moveVectorOrAdjust(Number(x) || 0, Number(y) || 0), // Mobile/headless diagnostic seam for reproducing exact diagonal intent without a physical pad.
    // Test/debug seams — let headless verification drive navigation without
    // faking the full Gamepad API.
    press(action) {
      automaticEntryEnabled = true;
      reconcileStack();
      switch (action) {
        case 'up': case 'down': move(action); break;
        case 'left': case 'right': moveOrAdjust(action); break;
        case 'confirm': activate(); break;
        case 'cancel': cancel(); break;
        case 'tabPrev': cycleTabs(-1); break;
        case 'tabNext': cycleTabs(1); break;
      }
    },
    showSection(groupId, sectionId) {
      const panel = activePanel(); // Explicit page jumps support legacy map-placement actions without leaving controls on the overview.
      const group = document.getElementById(groupId); // Existing pause-pane scope retains normal Back behavior.
      if (!panel || !group || !panel.contains(group)) return false;
      clearGroups(panel);
      automaticEntryEnabled = true;
      enterGroup(group, panel, null, sectionId); // Jump directly; do not activate the remembered page first.
      const selected = subtabsByGroup.get(group)?.selected; // Explicit placement-page jumps must also clear an unrelated page's scroll offset.
      if (selected) restoreSectionScroll(selected, panel);
      scrolledSelection = null;
      const targets = navigationTargets(panel); // Read-only pages can focus their scope while the right stick still scrolls.
      setFocus(pickDefaultTarget(panel, targets) || group, { scroll: false });
      updateHintBar(panel);
      return true;
    },
    debugState() {
      reconcileStack();
      const panel = activePanel();
      return {
        stackDepth: stack.length,
        knownPanels: knownPanels.size,
        panelId: panel?.id || panel?.className || null,
        targetTag: currentTarget?.tagName || null,
        targetId: currentTarget?.id || null,
        targetText: (currentTarget?.textContent || '').trim().slice(0, 40),
        navigationMode: 'nested-vector-cone',
        groupDepth: panel ? enteredGroups(panel).length : 0,
        groupId: panel ? navigationRoot(panel).id || navigationRoot(panel).getAttribute('data-tree') || null : null,
        latestChange: 'Controller menu tabs restore the last chosen local section, including after closing or rebuilding a pane.',
        rememberedSubtabs: Object.fromEntries(lastSubtabByGroupKey), // Mobile debug can verify each pane independently.
        subtab: panel ? (() => { const state = subtabsByGroup.get(localSubtabs(panel)?.node); return state ? { id: state.selected.id, index: state.sections.indexOf(state.selected), count: state.sections.length } : null; })() : null,
        detailOriginId: panel ? enteredGroups(panel).at(-1)?.returnPath?.steps.at(-1)?.value || null : null,
        scrollHostId: cachedScrollHost?.host?.id || null,
        pendingScrollReanchor: scrolledSelection?.panel === panel,
        coneHalfAngleDeg: Math.round(CONE_HALF_ANGLE * 180 / Math.PI),
        navigationTargetCount: navigationPerf.targetCount,
        navigationRectReads: navigationPerf.rectReads,
      };
    },
  };
})();
