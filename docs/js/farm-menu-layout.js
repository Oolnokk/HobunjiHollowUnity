(() => {
  'use strict';
  if (window.FarmMenuLayout) return;

  // Farm-tab presentation layer. The underlying FarmPanel renderers remain
  // authoritative; this module only moves their existing DOM sections into a
  // clearer workspace and preserves controller focus across Nursery rerenders.
  const STYLE_ID = 'farmMenuLayoutStyles';
  const WORKSPACE_ID = 'farmMenuWorkspace';
  const ANIMALS_COLUMN_ID = 'farmMenuAnimalsColumn';
  const OPERATIONS_COLUMN_ID = 'farmMenuOperationsColumn';
  const BREEDING_ACTIONS_ID = 'farmBreedingPrimaryActions';
  const ACTIVE_BREEDING_ID = 'farmActiveBreedingGroup';
  const WORLD_GROUP_ID = 'farmWorldLivestockGroup';
  const STABLE_GROUP_ID = 'farmStableBreedingGroup';
  const NURSERY_SCROLL_CLASS = 'farm-nursery-scroll';

  let installed = false; // Used to keep the DOM observer/listeners idempotent.
  let observer = null; // Watches FarmPanel's partial rerenders and reapplies presentation structure.
  let applyQueued = false; // Coalesces bursts of FarmPanel/Nursery DOM mutations into one layout pass.
  let applying = false; // Prevents our own node moves from recursively rebuilding the workspace.
  let lastControllerSnapshotAt = 0; // Used to distinguish controller-owned Nursery focus from ordinary pointer focus.
  let nurseryFocusIndex = null; // Used to restore the same Nursery baby after its selected-state rerender replaces the button node.
  let nurseryScrollTop = 0; // Used to preserve the Nursery's local scroll position across that same replacement.
  let nurseryRestoreQueued = false; // Prevents multiple focus restorations during one mutation burst.

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #mpFarm .farm-pane {
        width: 100%;
        max-width: none;
        box-sizing: border-box;
      }
      #${WORKSPACE_ID} {
        width: 100%;
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(300px, .85fr);
        gap: 12px;
        align-items: start;
        box-sizing: border-box;
        margin-top: 10px;
      }
      #${ANIMALS_COLUMN_ID}, #${OPERATIONS_COLUMN_ID} {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .farm-menu-column-label {
        padding: 0 2px 2px;
        color: var(--muted, #999);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      #${WORKSPACE_ID} > .farm-menu-column > .farm-section {
        min-width: 0;
        box-sizing: border-box;
        padding: 10px;
        border: 1px solid var(--border, #4b443a);
        border-radius: 9px;
        background: rgba(0, 0, 0, .10);
      }
      #${ANIMALS_COLUMN_ID} > .farm-section[data-farm-menu-kind="livestock"] {
        border-color: color-mix(in srgb, var(--accent, #d9ad65) 52%, var(--border, #4b443a));
        background: color-mix(in srgb, var(--accent, #d9ad65) 5%, rgba(0, 0, 0, .10));
      }
      #${BREEDING_ACTIONS_ID} {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 7px;
        align-items: stretch;
        margin: 2px 0 7px;
        padding: 7px;
        border: 1px solid color-mix(in srgb, var(--accent, #d9ad65) 55%, var(--border, #4b443a));
        border-radius: 8px;
        background: color-mix(in srgb, var(--accent, #d9ad65) 9%, transparent);
      }
      #farmPairBtn {
        min-height: 34px;
        font-weight: 800;
        border-color: var(--accent, #d9ad65);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent, #d9ad65) 32%, transparent);
      }
      #${ACTIVE_BREEDING_ID} {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 4px 0 8px;
        padding: 7px 8px;
        border-left: 3px solid color-mix(in srgb, var(--accent, #d9ad65) 65%, transparent);
        background: rgba(255, 255, 255, .025);
      }
      #${ACTIVE_BREEDING_ID}[hidden] { display: none !important; }
      .farm-animal-subsection {
        margin-top: 7px;
        padding-top: 7px;
        border-top: 1px solid color-mix(in srgb, var(--border, #4b443a) 78%, transparent);
      }
      .farm-animal-subsection-title {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 5px;
        font-size: 11px;
        font-weight: 800;
      }
      .farm-animal-subsection-title small {
        color: var(--muted, #999);
        font-size: 9px;
        font-weight: 500;
      }
      #${STABLE_GROUP_ID} {
        margin-top: 10px;
        padding: 8px;
        border: 1px solid color-mix(in srgb, var(--border, #4b443a) 85%, transparent);
        border-radius: 8px;
        background: rgba(255, 255, 255, .025);
      }
      #${STABLE_GROUP_ID} .farm-animal-subsection-title {
        color: var(--accent, #d9ad65);
      }
      #livestockNurserySection {
        margin-bottom: 7px !important;
      }
      #livestockNurserySection .${NURSERY_SCROLL_CLASS} {
        scrollbar-gutter: stable;
        overscroll-behavior: contain;
      }
      #farmLivestockList > .farm-note[data-farm-menu-empty="world"] {
        margin: 5px 0;
      }
      @media (max-width: 900px) {
        #${WORKSPACE_ID} { grid-template-columns: minmax(0, 1fr); }
        #${BREEDING_ACTIONS_ID} { grid-template-columns: minmax(0, 1fr); }
      }
    `;
    document.head.appendChild(style);
  }

  function makeColumn(id, label) {
    const column = document.createElement('div'); // Used as one of the two top-level Farm workspace columns.
    column.id = id;
    column.className = 'farm-menu-column';
    const heading = document.createElement('div'); // Used as a low-noise orientation label rather than another nested card title.
    heading.className = 'farm-menu-column-label';
    heading.textContent = label;
    column.appendChild(heading);
    return column;
  }

  function sectionTitle(section) {
    return section?.querySelector?.(':scope > .settings-section-title') || section?.querySelector?.('.settings-section-title') || null;
  }

  function classifySection(section) {
    if (section.querySelector('#farmLivestockList')) return 'livestock';
    if (section.querySelector('#farmGlanceCanvas')) return 'layout';
    if (section.querySelector('#farmBuildingsList')) return 'buildings';
    if (section.querySelector('#farmProcessorsGrid')) return 'processors';
    if (section.querySelector('#farmDewList')) return 'dew';
    if (section.querySelector('#farmFurnitureList')) return 'furniture';
    const title = String(sectionTitle(section)?.textContent || '').trim().toLowerCase();
    return title ? title.replace(/[^a-z0-9]+/g, '-') : 'other';
  }

  function ensureWorkspace() {
    const pane = document.querySelector('#mpFarm .farm-pane');
    if (!pane) return null;
    let workspace = document.getElementById(WORKSPACE_ID);
    if (!workspace) {
      workspace = document.createElement('div'); // Used to consume the Farm tab's previously empty right half.
      workspace.id = WORKSPACE_ID;
      const animals = makeColumn(ANIMALS_COLUMN_ID, 'Animals & breeding'); // Primary Farm-management column.
      const operations = makeColumn(OPERATIONS_COLUMN_ID, 'Farm & facilities'); // Layout/buildings/processors/etc. column.
      workspace.appendChild(animals);
      workspace.appendChild(operations);
      const header = pane.querySelector(':scope > .farm-header');
      if (header?.nextSibling) pane.insertBefore(workspace, header.nextSibling);
      else pane.appendChild(workspace);
    }

    const animals = document.getElementById(ANIMALS_COLUMN_ID);
    const operations = document.getElementById(OPERATIONS_COLUMN_ID);
    if (!animals || !operations) return workspace;

    const directSections = [...pane.children].filter(child => child.classList?.contains('farm-section')); // Fresh core sections start as direct Farm-pane children.
    for (const section of directSections) {
      const kind = classifySection(section); // Used to keep existing section state/listeners while changing only presentation hierarchy.
      section.dataset.farmMenuKind = kind;
      (kind === 'livestock' ? animals : operations).appendChild(section);
    }
    return workspace;
  }

  function ensureBreedingActions(livestockSection) {
    if (!livestockSection) return;
    const title = sectionTitle(livestockSection);
    if (title && title.textContent.trim() === 'Livestock') title.textContent = 'Animals & Breeding';

    let bar = document.getElementById(BREEDING_ACTIONS_ID);
    if (!bar) {
      bar = document.createElement('div'); // Used to make the high-value breeding action impossible to lose among roster rows.
      bar.id = BREEDING_ACTIONS_ID;
      if (title?.nextSibling) livestockSection.insertBefore(bar, title.nextSibling);
      else livestockSection.prepend(bar);
    }
    const pairButton = document.getElementById('farmPairBtn'); // Existing FarmPanel button; moved, never cloned, so its handler/state stay authoritative.
    const addButton = document.getElementById('farmAddLivestockBtn'); // Existing add-livestock control shares the compact primary action bar.
    if (pairButton && pairButton.parentElement !== bar) bar.appendChild(pairButton);
    if (addButton && addButton.parentElement !== bar) bar.appendChild(addButton);
  }

  function ensureActiveBreedingGroup(livestockSection) {
    if (!livestockSection) return;
    const note = document.getElementById('farmBreedingPairsNote');
    const list = document.getElementById('farmBreedingPairsList');
    if (!note || !list) return;
    let group = document.getElementById(ACTIVE_BREEDING_ID);
    if (!group) {
      group = document.createElement('div'); // Used to visually separate pairs already breeding from selectable candidates below.
      group.id = ACTIVE_BREEDING_ID;
      const heading = document.createElement('div');
      heading.className = 'farm-animal-subsection-title';
      heading.textContent = 'Active breeding';
      group.appendChild(heading);
      const roster = document.getElementById('farmLivestockList');
      if (roster) livestockSection.insertBefore(group, roster);
      else livestockSection.appendChild(group);
    }
    if (note.parentElement !== group) group.appendChild(note);
    if (list.parentElement !== group) group.appendChild(list);
    group.hidden = !String(note.textContent || '').trim() && !list.querySelector('.farm-row');
  }

  function makeAnimalGroup(id, titleText, detailText) {
    const group = document.createElement('div'); // Used to make Farm livestock and personal Stable candidates unmistakably separate.
    group.id = id;
    group.className = 'farm-animal-subsection';
    const heading = document.createElement('div');
    heading.className = 'farm-animal-subsection-title';
    const title = document.createElement('span');
    title.textContent = titleText;
    const detail = document.createElement('small');
    detail.textContent = detailText;
    heading.appendChild(title);
    heading.appendChild(detail);
    group.appendChild(heading);
    const rows = document.createElement('div');
    rows.className = 'farm-list farm-animal-subsection-rows';
    group.appendChild(rows);
    return group;
  }

  function directGroupRows(group) {
    return group?.querySelector?.(':scope > .farm-animal-subsection-rows') || null;
  }

  function organizeLivestockCandidates() {
    const container = document.getElementById('farmLivestockList');
    if (!container) return;
    const nursery = container.querySelector(':scope > #livestockNurserySection');
    // LivestockNursery always adds the compact Nursery section after tagging
    // current world rows. Waiting for it avoids racing the identity decorator.
    if (!nursery) return;

    const allRows = [...container.querySelectorAll('.farm-row.livestock-trait-row')]; // Includes rows already inside our groups on repeat passes.
    const taggedWorldRows = allRows.filter(row => row.dataset.nurseryWorldLivestockId); // Canonical world/stable split supplied by LivestockNursery.
    if (allRows.length && !taggedWorldRows.length) return;

    let worldGroup = document.getElementById(WORLD_GROUP_ID);
    if (!worldGroup || !container.contains(worldGroup)) {
      worldGroup = makeAnimalGroup(WORLD_GROUP_ID, 'Farm livestock', 'housed / outdoors adults');
      container.appendChild(worldGroup);
    }
    let stableGroup = document.getElementById(STABLE_GROUP_ID);
    if (!stableGroup || !container.contains(stableGroup)) {
      stableGroup = makeAnimalGroup(STABLE_GROUP_ID, 'Your Stable', 'breeding candidates only');
      container.appendChild(stableGroup);
    }
    const worldRows = directGroupRows(worldGroup);
    const stableRows = directGroupRows(stableGroup);
    if (!worldRows || !stableRows) return;

    for (const row of allRows) {
      const target = row.dataset.nurseryWorldLivestockId ? worldRows : stableRows; // Personal Stable rows deliberately have no world-livestock ID tag.
      if (row.parentElement !== target) target.appendChild(row);
    }

    const legacyStableHeader = [...container.querySelectorAll(':scope > .farm-note')].find(note => /your stable\s*\(breeding only/i.test(note.textContent || ''));
    legacyStableHeader?.remove();
    const emptyWorldNotes = [...container.querySelectorAll(':scope > .farm-note')].filter(note => /no livestock on the farm/i.test(note.textContent || ''));
    for (const note of emptyWorldNotes) {
      note.dataset.farmMenuEmpty = 'world';
      if (note.parentElement !== worldRows) worldRows.appendChild(note);
    }
    worldGroup.hidden = !worldRows.children.length;
    stableGroup.hidden = !stableRows.children.length;
  }

  function nurseryScrollRegion(section) {
    if (!section) return null;
    const existing = section.querySelector('.' + NURSERY_SCROLL_CLASS);
    if (existing) return existing;
    const candidate = [...section.children].find(child => [...child.children].some(grandchild => grandchild.tagName === 'BUTTON'));
    if (candidate) candidate.classList.add(NURSERY_SCROLL_CLASS);
    return candidate || null;
  }

  function decorateNurseryRows() {
    const section = document.getElementById('livestockNurserySection');
    const scroll = nurseryScrollRegion(section);
    if (!scroll) return;
    const buttons = [...scroll.children].filter(child => child.tagName === 'BUTTON'); // Compact baby rows only; Rename/Grow/Debug live outside this scroll host.
    buttons.forEach((button, index) => { button.dataset.farmNurseryIndex = String(index); });
    if (nurseryFocusIndex != null && nurseryFocusIndex >= buttons.length) nurseryFocusIndex = buttons.length ? buttons.length - 1 : null;
  }

  function controllerWasRecent() {
    return performance.now() - lastControllerSnapshotAt < 500;
  }

  function captureNurseryFocus(target) {
    const button = target?.closest?.('#livestockNurserySection .' + NURSERY_SCROLL_CLASS + ' > button');
    if (!button || !controllerWasRecent()) return;
    const index = Number(button.dataset.farmNurseryIndex); // Used to restore the corresponding replacement button after selected-state rerender.
    if (Number.isFinite(index)) nurseryFocusIndex = index;
    const scroll = button.parentElement;
    if (scroll) nurseryScrollTop = scroll.scrollTop;
  }

  function restoreNurseryFocus() {
    if (nurseryRestoreQueued || nurseryFocusIndex == null || !controllerWasRecent()) return;
    nurseryRestoreQueued = true;
    requestAnimationFrame(() => {
      nurseryRestoreQueued = false;
      const section = document.getElementById('livestockNurserySection');
      const scroll = nurseryScrollRegion(section);
      if (!scroll) return;
      const buttons = [...scroll.children].filter(child => child.tagName === 'BUTTON'); // Used to map the remembered index onto the rebuilt compact list.
      const button = buttons[Math.max(0, Math.min(buttons.length - 1, nurseryFocusIndex))];
      if (!button) return;
      scroll.scrollTop = nurseryScrollTop;
      try { button.focus({ preventScroll: true }); } catch (_) { button.focus?.(); }
      // ControllerUI's focusin listener adopts this replacement node as its
      // currentTarget. Reapply local scroll after focus in case a browser
      // ignores preventScroll for a nested overflow region.
      scroll.scrollTop = nurseryScrollTop;
      requestAnimationFrame(() => { if (scroll.isConnected) scroll.scrollTop = nurseryScrollTop; });
    });
  }

  function applyLayout() {
    if (applying || typeof document === 'undefined') return;
    const pane = document.querySelector('#mpFarm .farm-pane');
    if (!pane) return;
    applying = true;
    try {
      ensureStyles();
      ensureWorkspace();
      const livestockSection = document.getElementById('farmLivestockList')?.closest('.farm-section') || null; // Used as the one authoritative Animals & Breeding card.
      if (livestockSection) livestockSection.dataset.farmMenuKind = 'livestock';
      ensureBreedingActions(livestockSection);
      ensureActiveBreedingGroup(livestockSection);
      decorateNurseryRows();
      organizeLivestockCandidates();
      restoreNurseryFocus();
    } finally {
      applying = false;
    }
  }

  function scheduleApply() {
    if (applyQueued) return;
    applyQueued = true;
    queueMicrotask(() => {
      applyQueued = false;
      applyLayout();
    });
  }

  function debugSnapshot() {
    const nurserySection = document.getElementById('livestockNurserySection');
    const nurseryScroll = nurseryScrollRegion(nurserySection);
    const worldRows = document.querySelectorAll('#' + WORLD_GROUP_ID + ' .farm-row.livestock-trait-row').length;
    const stableRows = document.querySelectorAll('#' + STABLE_GROUP_ID + ' .farm-row.livestock-trait-row').length;
    return {
      mostRecentChange: 'Farm tab uses two top-level columns, breeding actions are promoted, farm/stable candidates are split, and Nursery controller focus/scroll survive selected-state rerenders.',
      installed,
      workspace: !!document.getElementById(WORKSPACE_ID),
      animalsColumnSections: [...document.querySelectorAll('#' + ANIMALS_COLUMN_ID + ' > .farm-section')].map(section => section.dataset.farmMenuKind || classifySection(section)),
      operationsColumnSections: [...document.querySelectorAll('#' + OPERATIONS_COLUMN_ID + ' > .farm-section')].map(section => section.dataset.farmMenuKind || classifySection(section)),
      worldCandidateRows: worldRows,
      stableCandidateRows: stableRows,
      nurseryFocusIndex,
      nurseryScrollTop,
      nurseryRenderedScrollTop: nurseryScroll?.scrollTop ?? null,
      focusedElement: document.activeElement?.id || document.activeElement?.dataset?.farmNurseryIndex || document.activeElement?.className || null,
    };
  }

  function install() {
    if (installed || typeof document === 'undefined') return installed;
    installed = true;
    window.addEventListener('hobunji-controller-ui-snapshot', () => { lastControllerSnapshotAt = performance.now(); }, { passive: true });
    document.addEventListener('focusin', event => captureNurseryFocus(event.target), true);
    document.addEventListener('scroll', event => {
      const scroll = event.target?.classList?.contains?.(NURSERY_SCROLL_CLASS) ? event.target : null;
      if (scroll && controllerWasRecent()) nurseryScrollTop = scroll.scrollTop;
    }, true);
    document.addEventListener('pointerdown', event => {
      if (!event.target?.closest?.('#livestockNurserySection')) return;
      // Pointer users should keep normal browser focus/scroll behavior; only a
      // controller-owned selection requests continuity restoration.
      lastControllerSnapshotAt = -Infinity;
    }, true);

    const beginObserving = () => {
      const pane = document.getElementById('mpFarm');
      if (!pane || observer) return;
      observer = new MutationObserver(() => scheduleApply());
      observer.observe(pane, { childList: true, subtree: true });
      scheduleApply();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', beginObserving, { once: true });
    else beginObserving();
    return true;
  }

  window.FarmMenuLayout = { install, apply: applyLayout, debugSnapshot };
  window.__farmMenuLayoutDebug = { snapshot: debugSnapshot, apply: applyLayout };
  install();
})();