(() => {
  'use strict';
  if (window.FarmMenuLayout) return;

  // Farm-tab presentation layer. FarmPanel/LivestockNursery still own all
  // state and behavior; this module only rearranges their existing DOM into a
  // flatter full-height workspace and preserves Nursery controller continuity.
  const STYLE_ID = 'farmMenuLayoutStyles';
  const WORKSPACE_ID = 'farmMenuWorkspace';
  const ANIMALS_COLUMN_ID = 'farmMenuAnimalsColumn';
  const OPERATIONS_COLUMN_ID = 'farmMenuOperationsColumn';
  const BREEDING_ACTIONS_ID = 'farmBreedingPrimaryActions';
  const ACTIVE_BREEDING_ID = 'farmActiveBreedingGroup';
  const WORLD_HEADING_ID = 'farmWorldLivestockHeading';
  const STABLE_HEADING_ID = 'farmStableBreedingHeading';
  const WORLD_IDENTITY_SENTINEL_ID = 'farmWorldLivestockIdentitySentinel';
  const NURSERY_SCROLL_CLASS = 'farm-nursery-scroll';
  const LEGACY_GROUP_IDS = ['farmWorldLivestockGroup', 'farmStableBreedingGroup'];

  let installed = false; // Used to keep observers/listeners idempotent.
  let observer = null; // Watches FarmPanel/Nursery partial rerenders inside the Farm pane.
  let applyQueued = false; // Coalesces mutation bursts into one layout pass.
  let applying = false; // Prevents synchronous reentry while nodes are being moved.
  let lastControllerInputAt = -Infinity; // Used only after an actual controller button/stick input, not merely a connected pad.
  let nurseryFocusIndex = null; // Used to restore the corresponding baby button after selected-state rerender.
  let nurseryScrollTop = 0; // Used to preserve the Nursery's own compact-list scroll position.
  let nurseryFocusArmed = false; // True only while controller interaction owns a Nursery baby row.
  let nurseryRestoreQueued = false; // Prevents duplicate rAF focus restorations per mutation burst.

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #mpFarm {
        overflow: hidden;
      }
      #mpFarm .farm-pane {
        width: 100%;
        max-width: none;
        height: 100%;
        min-height: 0;
        box-sizing: border-box;
        gap: 10px;
      }
      #mpFarm .farm-header {
        flex: 0 0 auto;
      }
      #${WORKSPACE_ID} {
        width: 100%;
        flex: 1 1 auto;
        min-height: 0;
        height: 0;
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(300px, .85fr);
        gap: 16px;
        align-items: stretch;
        box-sizing: border-box;
      }
      #${ANIMALS_COLUMN_ID}, #${OPERATIONS_COLUMN_ID} {
        min-width: 0;
        min-height: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 0;
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        padding-right: 5px;
      }
      .farm-menu-column-label {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 2px 10px;
        color: var(--accent, #d9ad65);
        font-size: 16px;
        line-height: 1.1;
        font-weight: 800;
        letter-spacing: .055em;
        text-transform: uppercase;
      }
      .farm-menu-column-label::after {
        content: '';
        flex: 1 1 auto;
        height: 1px;
        background: linear-gradient(90deg, color-mix(in srgb, var(--accent, #d9ad65) 65%, transparent), transparent);
      }
      #${WORKSPACE_ID} > .farm-menu-column > .farm-section {
        flex: 0 0 auto;
        min-width: 0;
        box-sizing: border-box;
        padding: 11px 2px 13px;
        border: 0;
        border-top: 1px solid color-mix(in srgb, var(--border, #4b443a) 78%, transparent);
        border-radius: 0;
        background: transparent;
      }
      #${WORKSPACE_ID} > .farm-menu-column > .farm-menu-column-label + .farm-section {
        border-top: 0;
        padding-top: 2px;
      }
      #${WORKSPACE_ID} > .farm-menu-column > .farm-section > .settings-section-title {
        display: flex;
        align-items: center;
        gap: 9px;
        margin: 0 0 7px;
        color: var(--text, #eee);
        font-size: 14px;
        line-height: 1.1;
        font-weight: 800;
        letter-spacing: .025em;
      }
      #${WORKSPACE_ID} > .farm-menu-column > .farm-section > .settings-section-title::after {
        content: '';
        flex: 1 1 auto;
        height: 1px;
        background: linear-gradient(90deg, color-mix(in srgb, var(--border-bright, #777) 92%, transparent), transparent);
      }
      #${ANIMALS_COLUMN_ID} > .farm-section[data-farm-menu-kind="livestock"] {
        padding-bottom: 18px;
        background: linear-gradient(90deg, color-mix(in srgb, var(--accent, #d9ad65) 4%, transparent), transparent 58%);
      }
      #${BREEDING_ACTIONS_ID} {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 7px;
        align-items: stretch;
        margin: 5px 0 7px;
        padding: 7px 0;
        border-top: 1px solid color-mix(in srgb, var(--accent, #d9ad65) 45%, var(--border, #4b443a));
        border-bottom: 1px solid color-mix(in srgb, var(--accent, #d9ad65) 45%, var(--border, #4b443a));
        background: linear-gradient(90deg, color-mix(in srgb, var(--accent, #d9ad65) 8%, transparent), transparent 72%);
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
        margin: 8px 0 4px;
        padding: 8px 0 4px;
        border: 0;
        border-top: 1px solid color-mix(in srgb, var(--border, #4b443a) 72%, transparent);
        background: transparent;
      }
      #${ACTIVE_BREEDING_ID}[hidden] { display: none !important; }
      #${ACTIVE_BREEDING_ID} > .farm-animal-divider {
        border-top: 0;
        padding-top: 0;
      }
      .farm-animal-divider {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 10px 0 5px;
        padding-top: 8px;
        border-top: 1px solid color-mix(in srgb, var(--border, #4b443a) 72%, transparent);
        font-size: 13px;
        line-height: 1.1;
        font-weight: 800;
      }
      .farm-animal-divider::after {
        content: '';
        flex: 1 1 auto;
        height: 1px;
        background: linear-gradient(90deg, color-mix(in srgb, var(--border-bright, #777) 88%, transparent), transparent);
      }
      .farm-animal-divider small {
        flex: 0 0 auto;
        color: var(--muted, #999);
        font-size: 10px;
        font-weight: 500;
      }
      #${STABLE_HEADING_ID} {
        color: var(--accent, #d9ad65);
        margin-top: 12px;
      }
      #farmLivestockList {
        max-height: none !important;
        overflow: visible !important;
        min-height: 0;
        gap: 4px;
        padding-bottom: 6px;
      }
      #farmLivestockList > #livestockNurserySection {
        order: -10;
        margin: 2px 0 3px !important;
        padding: 4px 0 5px !important;
        border: 0 !important;
        border-top: 1px solid color-mix(in srgb, var(--border, #4b443a) 72%, transparent) !important;
        border-radius: 0 !important;
        background: transparent !important;
      }
      #livestockNurserySection > div:first-child {
        min-height: 0;
        gap: 6px !important;
        margin-bottom: 2px !important;
      }
      #livestockNurserySection > div:first-child > strong {
        font-size: 12px !important;
        line-height: 1.05;
      }
      #livestockNurserySection > div:first-child > span {
        font-size: 9px !important;
        line-height: 1.05;
      }
      #livestockNurserySection > div:nth-child(2) {
        margin-bottom: 3px !important;
        font-size: 8px !important;
        line-height: 1.05 !important;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #livestockNurserySection .${NURSERY_SCROLL_CLASS},
      #livestockNurserySection > div:nth-child(3) {
        max-height: 76px !important;
        min-height: 0 !important;
        overflow-y: scroll !important;
        overflow-x: hidden !important;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        scrollbar-width: thin;
        touch-action: pan-y;
        -webkit-overflow-scrolling: touch;
        gap: 2px !important;
        padding-right: 3px !important;
      }
      #livestockNurserySection .${NURSERY_SCROLL_CLASS} > button,
      #livestockNurserySection > div:nth-child(3) > button {
        flex: 0 0 auto !important;
        min-height: 0 !important;
        padding: 2px 4px !important;
        border-radius: 4px !important;
      }
      #livestockNurserySection .${NURSERY_SCROLL_CLASS} > button > div:first-child,
      #livestockNurserySection > div:nth-child(3) > button > div:first-child {
        gap: 4px !important;
        font-size: 10px !important;
        line-height: 1.05 !important;
      }
      #livestockNurserySection .${NURSERY_SCROLL_CLASS} > button > div:last-child,
      #livestockNurserySection > div:nth-child(3) > button > div:last-child {
        margin-top: 1px !important;
        font-size: 8px !important;
        line-height: 1.05 !important;
      }
      #livestockNurserySection > div:last-child:not(.${NURSERY_SCROLL_CLASS}) {
        gap: 4px !important;
        margin-top: 3px !important;
        padding-top: 3px !important;
      }
      #livestockNurserySection > div:last-child:not(.${NURSERY_SCROLL_CLASS}) > .settings-small-btn {
        padding: 2px 6px !important;
        font-size: 9px !important;
      }
      #farmLivestockList > .farm-note[data-farm-menu-empty="world"] {
        margin: 5px 0;
      }
      @media (max-width: 900px) {
        #mpFarm { overflow-y: auto; overflow-x: hidden; }
        #mpFarm .farm-pane { height: auto; min-height: 100%; }
        #${WORKSPACE_ID} {
          flex: 0 0 auto;
          height: auto;
          min-height: 0;
          grid-template-columns: minmax(0, 1fr);
          gap: 8px;
        }
        #${ANIMALS_COLUMN_ID}, #${OPERATIONS_COLUMN_ID} {
          height: auto;
          overflow: visible;
          padding-right: 0;
          scrollbar-gutter: auto;
        }
        #${BREEDING_ACTIONS_ID} { grid-template-columns: minmax(0, 1fr); }
      }
    `;
    document.head.appendChild(style);
  }

  function makeColumn(id, label) {
    const column = document.createElement('div'); // Used as one of the two top-level Farm workspace columns.
    column.id = id;
    column.className = 'farm-menu-column';
    const heading = document.createElement('div'); // Used as a low-noise orientation label rather than another nested panel.
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
      workspace = document.createElement('div'); // Used to fill the Farm pane below its header instead of leaving the right side unused.
      workspace.id = WORKSPACE_ID;
      workspace.appendChild(makeColumn(ANIMALS_COLUMN_ID, 'Animals & breeding'));
      workspace.appendChild(makeColumn(OPERATIONS_COLUMN_ID, 'Farm & facilities'));
      const header = pane.querySelector(':scope > .farm-header');
      if (header?.nextSibling) pane.insertBefore(workspace, header.nextSibling);
      else pane.appendChild(workspace);
    }

    const animals = document.getElementById(ANIMALS_COLUMN_ID);
    const operations = document.getElementById(OPERATIONS_COLUMN_ID);
    if (!animals || !operations) return workspace;
    const directSections = [...pane.children].filter(child => child.classList?.contains('farm-section')); // Fresh core sections start as direct Farm-pane children.
    for (const section of directSections) {
      const kind = classifySection(section); // Used to preserve the real section nodes/listeners while changing only their presentation hierarchy.
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
      bar = document.createElement('div'); // Used to keep the breeding action prominent without another nested card.
      bar.id = BREEDING_ACTIONS_ID;
      if (title?.nextSibling) livestockSection.insertBefore(bar, title.nextSibling);
      else livestockSection.prepend(bar);
    }
    const pairButton = document.getElementById('farmPairBtn'); // Existing FarmPanel button; moved rather than cloned so its live handler/state remain authoritative.
    const addButton = document.getElementById('farmAddLivestockBtn'); // Existing add-livestock control shares the same flat action strip.
    const oldParents = new Set([pairButton?.parentElement, addButton?.parentElement].filter(Boolean)); // Used to remove the obsolete empty toolbar wrapper after its controls move.
    if (pairButton && pairButton.parentElement !== bar) bar.appendChild(pairButton);
    if (addButton && addButton.parentElement !== bar) bar.appendChild(addButton);
    for (const parent of oldParents) {
      if (parent !== bar && parent.classList?.contains('farm-toolbar') && !parent.children.length) parent.remove();
    }
  }

  function makeDivider(id, titleText, detailText = '') {
    const heading = document.createElement('div'); // Used as a flat section divider; unlike the previous implementation it never wraps roster rows.
    heading.id = id;
    heading.className = 'farm-animal-divider';
    const title = document.createElement('span');
    title.textContent = titleText;
    heading.appendChild(title);
    if (detailText) {
      const detail = document.createElement('small');
      detail.textContent = detailText;
      heading.appendChild(detail);
    }
    return heading;
  }

  function ensureActiveBreedingGroup(livestockSection) {
    if (!livestockSection) return;
    const note = document.getElementById('farmBreedingPairsNote');
    const list = document.getElementById('farmBreedingPairsList');
    if (!note || !list) return;
    let group = document.getElementById(ACTIVE_BREEDING_ID);
    if (!group) {
      group = document.createElement('div'); // Kept only as a semantic pair block; CSS deliberately renders it flat.
      group.id = ACTIVE_BREEDING_ID;
      group.appendChild(makeDivider('farmActiveBreedingHeading', 'Active breeding'));
      const roster = document.getElementById('farmLivestockList');
      if (roster) livestockSection.insertBefore(group, roster);
      else livestockSection.appendChild(group);
    }
    if (note.parentElement !== group) group.appendChild(note);
    if (list.parentElement !== group) group.appendChild(list);
    group.hidden = !String(note.textContent || '').trim() && !list.querySelector('.farm-row');
  }

  function flattenLegacyRosterGroups(container) {
    for (const id of LEGACY_GROUP_IDS) {
      const group = document.getElementById(id);
      if (!group || !container.contains(group)) continue;
      const rows = [...group.querySelectorAll('.farm-row.livestock-trait-row')]; // Used to recover rows from the previous nested-group presentation during hot reloads.
      const notes = [...group.querySelectorAll('.farm-note[data-farm-menu-empty="world"]')]; // Used to preserve the core empty-roster note while removing its old wrapper.
      rows.forEach(row => container.appendChild(row));
      notes.forEach(note => container.appendChild(note));
      group.remove();
    }
  }

  function ensureRosterHeading(container, id, title, detail) {
    let heading = document.getElementById(id);
    if (!heading || !container.contains(heading)) {
      heading = makeDivider(id, title, detail);
      container.appendChild(heading);
    }
    return heading;
  }

  function ensureWorldIdentitySentinel(container, rosterRows) {
    let sentinel = document.getElementById(WORLD_IDENTITY_SENTINEL_ID);
    const hasTaggedWorldRow = rosterRows.some(row => row.dataset.nurseryWorldLivestockId); // Used to know whether a real surviving world row already keeps Nursery's ID binding in repeat-pass mode.
    const needsSentinel = !hasTaggedWorldRow && rosterRows.length > 0; // Covers the all-world-babies-removed + Stable-candidates-remain edge without affecting empty rosters.
    if (needsSentinel && (!sentinel || !container.contains(sentinel))) {
      sentinel = document.createElement('div'); // Hidden row exists only so LivestockNursery never mistakes surviving Stable rows for a fresh world-row prefix on its next observer pass.
      sentinel.id = WORLD_IDENTITY_SENTINEL_ID;
      sentinel.className = 'farm-row livestock-trait-row';
      sentinel.dataset.nurseryWorldLivestockId = '__farm_menu_identity_sentinel__';
      sentinel.hidden = true;
      container.appendChild(sentinel);
    } else if (!needsSentinel && sentinel?.parentElement === container) {
      sentinel.remove();
      sentinel = null;
    }
    return sentinel;
  }

  function organizeLivestockCandidates() {
    const container = document.getElementById('farmLivestockList');
    if (!container) return;
    const nursery = container.querySelector(':scope > #livestockNurserySection');
    // Nursery creation happens only after LivestockNursery tags current world
    // rows by saved ID, so its presence is the safe point to split world vs
    // personal-Stable rows without guessing from array position.
    if (!nursery) return;

    flattenLegacyRosterGroups(container);
    const rows = [...container.querySelectorAll(':scope > .farm-row.livestock-trait-row')].filter(row => row.id !== WORLD_IDENTITY_SENTINEL_ID); // Direct real rows only: no nested wrappers or hidden identity sentinel.
    ensureWorldIdentitySentinel(container, rows);
    const worldRows = rows.filter(row => row.dataset.nurseryWorldLivestockId);
    const stableRows = rows.filter(row => !row.dataset.nurseryWorldLivestockId);
    const legacyStableHeader = [...container.querySelectorAll(':scope > .farm-note')].find(note => /your stable\s*\(breeding only/i.test(note.textContent || ''));
    legacyStableHeader?.remove();
    const emptyWorldNotes = [...container.querySelectorAll(':scope > .farm-note')].filter(note => /no livestock on the farm/i.test(note.textContent || ''));
    emptyWorldNotes.forEach(note => { note.dataset.farmMenuEmpty = 'world'; });

    const worldHeading = ensureRosterHeading(container, WORLD_HEADING_ID, 'Farm livestock', 'housed / outdoors adults');
    const stableHeading = ensureRosterHeading(container, STABLE_HEADING_ID, 'Your Stable', 'breeding candidates only');
    stableHeading.hidden = stableRows.length === 0;

    const desiredNodes = [nursery, worldHeading, ...worldRows, ...emptyWorldNotes, stableHeading, ...stableRows]; // Used as the one flat visual order for every visible roster element we manage.
    const managed = new Set(desiredNodes); // Used to ignore the hidden identity sentinel and any future unrelated child FarmPanel may add.
    const currentManaged = [...container.children].filter(child => managed.has(child)); // Used to make this mutation-observer presentation pass idempotent.
    const alreadyOrdered = currentManaged.length === desiredNodes.length && desiredNodes.every((node, index) => currentManaged[index] === node); // Prevents our own node moves from generating another observer pass once the roster is already correct.
    if (!alreadyOrdered) desiredNodes.forEach(node => container.appendChild(node));
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
    return performance.now() - lastControllerInputAt < 650;
  }

  function controllerSnapshotHasInput(detail) {
    const move = detail?.move || {};
    const look = detail?.look || {};
    const analog = Math.max(Math.abs(Number(move.x) || 0), Math.abs(Number(move.y) || 0), Math.abs(Number(look.x) || 0), Math.abs(Number(look.y) || 0)); // Used to ignore idle connected controllers and stick drift below the normalized deadzone.
    const buttonDown = Array.from(detail?.pad?.buttons || []).some(button => button?.pressed || Number(button?.value) > 0.5); // Used to recognize an actual confirm/tab/cancel/etc. press without depending on a fixed physical mapping.
    return buttonDown || analog > 0.15;
  }

  function nurseryRowButton(target) {
    return target?.closest?.('#livestockNurserySection .' + NURSERY_SCROLL_CLASS + ' > button') || null;
  }

  function captureNurseryFocus(target) {
    const button = nurseryRowButton(target);
    if (!button || !controllerWasRecent()) return false;
    const index = Number(button.dataset.farmNurseryIndex); // Used to restore the corresponding replacement button after selected-state rerender.
    if (Number.isFinite(index)) nurseryFocusIndex = index;
    const scroll = button.parentElement;
    if (scroll) nurseryScrollTop = scroll.scrollTop;
    nurseryFocusArmed = true;
    return true;
  }

  function handleFarmFocusIn(target) {
    if (!controllerWasRecent()) return;
    if (captureNurseryFocus(target)) return;
    if (document.getElementById('mpFarm')?.contains(target)) nurseryFocusArmed = false;
  }

  function restoreNurseryFocus() {
    if (nurseryRestoreQueued || !nurseryFocusArmed || nurseryFocusIndex == null || !controllerWasRecent()) return;
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
      // ControllerUI adopts this replacement node through its existing focusin
      // listener. Reapply local scroll because some browsers ignore
      // preventScroll for nested overflow regions.
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
      const livestockSection = document.getElementById('farmLivestockList')?.closest('.farm-section') || null; // Used as the authoritative Animals & Breeding section.
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
    const roster = document.getElementById('farmLivestockList');
    const directRows = roster ? [...roster.querySelectorAll(':scope > .farm-row.livestock-trait-row')].filter(row => row.id !== WORLD_IDENTITY_SENTINEL_ID) : [];
    return {
      mostRecentChange: 'Farm animal UI is flat: one full-height scrolling animal column, direct Farm/Stable roster rows, prominent breeding actions, and Nursery controller focus/scroll continuity.',
      installed,
      workspace: !!document.getElementById(WORKSPACE_ID),
      animalsColumnSections: [...document.querySelectorAll('#' + ANIMALS_COLUMN_ID + ' > .farm-section')].map(section => section.dataset.farmMenuKind || classifySection(section)),
      operationsColumnSections: [...document.querySelectorAll('#' + OPERATIONS_COLUMN_ID + ' > .farm-section')].map(section => section.dataset.farmMenuKind || classifySection(section)),
      rosterDirectRows: directRows.length,
      worldCandidateRows: directRows.filter(row => row.dataset.nurseryWorldLivestockId).length,
      stableCandidateRows: directRows.filter(row => !row.dataset.nurseryWorldLivestockId).length,
      worldIdentitySentinel: !!document.getElementById(WORLD_IDENTITY_SENTINEL_ID),
      legacyNestedGroupsRemaining: LEGACY_GROUP_IDS.filter(id => !!document.getElementById(id)),
      nurseryFocusIndex,
      nurseryScrollTop,
      nurseryFocusArmed,
      nurseryRenderedScrollTop: nurseryScroll?.scrollTop ?? null,
      focusedElement: document.activeElement?.id || document.activeElement?.dataset?.farmNurseryIndex || document.activeElement?.className || null,
    };
  }

  function install() {
    if (installed || typeof document === 'undefined') return installed;
    installed = true;
    window.addEventListener('hobunji-controller-ui-snapshot', event => {
      if (!controllerSnapshotHasInput(event.detail)) return;
      lastControllerInputAt = performance.now();
      captureNurseryFocus(document.activeElement); // Captures a newly navigated row even when its focusin happened earlier in the same controller poll.
    }, { passive: true });
    document.addEventListener('focusin', event => handleFarmFocusIn(event.target), true);
    document.addEventListener('click', event => captureNurseryFocus(event.target), true);
    document.addEventListener('scroll', event => {
      const scroll = event.target?.classList?.contains?.(NURSERY_SCROLL_CLASS) ? event.target : null;
      if (scroll && controllerWasRecent()) nurseryScrollTop = scroll.scrollTop;
    }, true);
    document.addEventListener('pointerdown', event => {
      if (!document.getElementById('mpFarm')?.contains(event.target)) return;
      // Pointer input takes ownership immediately. An idle connected gamepad
      // no longer refreshes lastControllerInputAt, so the following click
      // cannot accidentally re-arm controller-only Nursery restoration.
      lastControllerInputAt = -Infinity;
      nurseryFocusArmed = false;
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