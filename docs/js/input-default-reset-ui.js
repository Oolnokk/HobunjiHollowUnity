// Adds separate Reset to Defaults controls beneath the keyboard and controller
// binding lists and owns the final player-facing Settings section order.
//
// This file keeps the historical input-default-reset-ui.js path because the
// controller helper loader already owns it, but SettingsMenuOrder below is the
// single presentation-order authority for #mpSettings. Feature modules remain
// responsible for creating and wiring their own controls; this module only
// groups/reorders the finished sections so script load order cannot scramble
// the menu.
(() => {
  'use strict';

  if (window.InputDefaultsResetUI?.installed) return;

  const TARGETS = Object.freeze([
    { device: 'desktop', containerId: 'desktopInputBindings', rowId: 'desktopInputResetDefaultsRow', label: 'Reset Keyboard to Defaults' },
    { device: 'controller', containerId: 'controllerInputBindings', rowId: 'controllerInputResetDefaultsRow', label: 'Reset Controller to Defaults' },
  ]); // Used by the observer and explicit refresh hook so both input sections get independent reset controls.

  const SETTINGS_SECTION_ORDER = Object.freeze([
    'Primary Save Folder',
    'Cloud Save',
    'Combat',
    'World',
    'Camera',
    'Input',
    'Visual Effects',
    'Billboard Sprites',
    'Weeds',
    'Performance',
    'Progression',
    'Cloud Forest (perf testing)',
    'Nearby Projectile Cover (perf testing)',
    'Dev Tools',
  ]); // Used to keep the Settings menu grouped by player intent instead of whichever runtime helper happened to insert first.

  const SETTINGS_SECTION_RANKS = new Map(SETTINGS_SECTION_ORDER.map((label, index) => [label, index * 100])); // Used by organizeSettingsPane() to sort known headings while leaving future/unknown sections in a predictable slot.
  SETTINGS_SECTION_RANKS.set('Local Save Folder', SETTINGS_SECTION_RANKS.get('Primary Save Folder')); // The folder-save module renames this heading after boot; both labels must sort identically before/after that rename.

  let observer = null; // Watches Settings re-renders because InputSettingsPanel and several runtime helpers add/replace Settings content after boot.
  let refreshQueued = false; // Coalesces bursts of DOM mutations into one reset-button + Settings-order refresh per animation frame.
  let lastOrderChangedAt = 0; // Used by the in-game debug surface to show whether the organizer recently had to repair section order.

  function resetDevice(device, status) {
    const reset = window.InputBindings?.resetDeviceToDefaults; // Uses the binding layer's device-isolated reset so UI code never reconstructs defaults itself.
    if (typeof reset !== 'function') {
      if (status) status.textContent = 'Reset is unavailable until input bindings finish loading.';
      return false;
    }
    const ok = reset(device); // Restores this device only, including only this device's authored mode shifts.
    if (!ok) {
      if (status) status.textContent = 'Could not reset controls.';
      return false;
    }
    window.InputSettingsPanel?.render?.();
    return true;
  }

  function appendResetControl(target) {
    const container = document.getElementById(target.containerId); // Anchors the button directly inside the corresponding keyboard/controller section.
    if (!container || document.getElementById(target.rowId)) return false;

    const row = document.createElement('div'); // Uses the same row class as Copy Controls JSON so alignment stays consistent with existing Settings styling.
    row.id = target.rowId;
    row.className = 'input-binding-row input-reset-defaults-row';

    const spacer = document.createElement('span'); // Preserves the existing two-column binding row alignment without introducing a stylesheet dependency.
    const button = document.createElement('button'); // Gives keyboard/controller their own independently actionable reset affordance.
    button.type = 'button';
    button.className = 'settings-small-btn';
    button.textContent = target.label;

    const status = document.createElement('div'); // Surfaces reset failures in-game/mobile instead of relying on the browser console.
    status.className = 'input-binding-warning';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    button.addEventListener('click', () => resetDevice(target.device, status));
    row.append(spacer, button, status);
    container.appendChild(row);
    return true;
  }

  function settingsTitleLabel(title) {
    if (!title) return '';
    const directLabel = [...title.children].find(child => child.tagName === 'SPAN'); // Cloud Forest's title also contains a reset button; use its label span so button text cannot become part of the sort key.
    const raw = directLabel?.textContent || title.textContent || '';
    return raw.trim().replace(/\s+/g, ' ');
  }

  function ensureWorldSection() {
    const banditToggle = document.getElementById('settingBanditCamps'); // Existing player-facing world-generation toggle that currently sits inside the projectile-cover performance block.
    const banditRow = banditToggle?.closest?.('.settings-row'); // Used to move only the Bandit Camps setting without touching its behavior or input id.
    if (!banditRow) return false;

    let title = document.getElementById('worldSettingsTitle'); // Stable heading id lets later refreshes verify the row remains in its own semantic section.
    if (!title) {
      title = document.createElement('div');
      title.id = 'worldSettingsTitle';
      title.className = 'settings-section-title';
      title.style.marginTop = '10px';
      title.textContent = 'World';
      banditRow.before(title);
      return true;
    }

    if (title.nextElementSibling !== banditRow) {
      banditRow.before(title);
      return true;
    }
    return false;
  }

  function progressionSplitsInput(title, lastInputRow) {
    if (!title || !lastInputRow || typeof title.compareDocumentPosition !== 'function') return false;
    return Boolean(title.compareDocumentPosition(lastInputRow) & Node.DOCUMENT_POSITION_FOLLOWING); // True only when the Progression heading appears before the final Lyre row, meaning it is actually cutting the Input section in half.
  }

  function ensureProgressionBoundary() {
    const title = document.getElementById('progressionResetSettingsTitle'); // Runtime-injected Progression heading that historically lands after Held Mode Shifts, before later Lyre input rows.
    const lastInputRow = document.getElementById('lyreFreeplayKeySettings')?.closest?.('.settings-row'); // Last authored row in the Input section; Progression must not appear before this row.
    if (!progressionSplitsInput(title, lastInputRow)) return false;

    const skillRow = document.getElementById('resetSkillProgressBtn')?.closest?.('.settings-row'); // First destructive Progression action moved together with its heading.
    const moteRow = document.getElementById('resetMotesOfProwessBtn')?.closest?.('.settings-row'); // Second destructive Progression action moved together with its heading.
    const status = document.getElementById('progressionResetStatus'); // Mobile-safe result/error readout that belongs to the Progression section.
    const progressionNodes = [title, skillRow, moteRow, status].filter(Boolean); // Complete injected Progression block moved as one unit without recreating listeners.
    if (!progressionNodes.length) return false;

    const fragment = document.createDocumentFragment(); // Preserves existing nodes/listeners while repairing the section boundary before the general section sorter runs.
    for (const node of progressionNodes) fragment.appendChild(node);
    lastInputRow.after(fragment);
    return true;
  }

  function collectSettingsSections(pane) {
    const children = [...pane.children]; // Snapshot used so grouping is stable even when the organizer later moves whole sections.
    const sections = [];
    let active = null;

    for (const child of children) {
      if (child.classList?.contains('settings-section-title')) {
        active = {
          title: child,
          label: settingsTitleLabel(child),
          nodes: [child],
          originalIndex: sections.length,
        }; // Stores the title plus every following sibling up to the next title as one indivisible Settings section.
        sections.push(active);
      } else if (active) {
        active.nodes.push(child);
      }
    }
    return sections;
  }

  function sectionRank(section) {
    if (SETTINGS_SECTION_RANKS.has(section.label)) return SETTINGS_SECTION_RANKS.get(section.label);
    return 950 + (section.originalIndex / 1000); // Future/unknown sections stay after normal player settings but before the explicit Progression/advanced/developer blocks.
  }

  function organizeSettingsPane() {
    const pane = document.querySelector('#mpSettings > .settings-pane'); // Only the real Settings pane is reordered; similarly styled Farm/Stable sections are intentionally ignored.
    if (!pane) return false;

    ensureWorldSection();
    ensureProgressionBoundary();
    const sections = collectSettingsSections(pane);
    if (sections.length < 2) return false;

    const ordered = [...sections].sort((a, b) => {
      const rankDelta = sectionRank(a) - sectionRank(b);
      return rankDelta || (a.originalIndex - b.originalIndex);
    }); // Stable sort preserves author order among any future sections this version does not know yet.

    const alreadyOrdered = ordered.every((section, index) => section === sections[index]);
    if (alreadyOrdered) return false;

    const fragment = document.createDocumentFragment(); // Moves each existing node rather than cloning/rebuilding it, preserving listeners, ids, values, and module-owned state.
    for (const section of ordered) {
      for (const node of section.nodes) fragment.appendChild(node);
    }
    pane.appendChild(fragment);
    lastOrderChangedAt = Date.now();
    return true;
  }

  function refreshSettingsUi() {
    refreshQueued = false;
    for (const target of TARGETS) appendResetControl(target);
    organizeSettingsPane();
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(refreshSettingsUi);
  }

  function currentSettingsOrder() {
    const pane = document.querySelector('#mpSettings > .settings-pane'); // Used by the mobile-safe debug surface to report the actual rendered heading sequence.
    if (!pane) return [];
    return [...pane.children]
      .filter(child => child.classList?.contains('settings-section-title'))
      .map(settingsTitleLabel);
  }

  function inputBoundaryIsIntact() {
    const title = document.getElementById('progressionResetSettingsTitle'); // Compared with the final Input row to expose the exact historical split-input failure in diagnostics.
    const lastInputRow = document.getElementById('lyreFreeplayKeySettings')?.closest?.('.settings-row'); // Same boundary anchor used by ensureProgressionBoundary().
    return !progressionSplitsInput(title, lastInputRow);
  }

  function boot() {
    refreshSettingsUi();
    if (observer || !document.body || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(queueRefresh); // Re-adds missing reset rows and re-applies deterministic section order after late runtime injections.
    // Every row this file reads or writes lives inside #mpSettings (static
    // Settings markup, present from load), so watching document.body's entire
    // subtree meant any unrelated DOM change anywhere queued a refresh for no
    // reason.
    observer.observe(document.getElementById('mpSettings') || document.body, { childList: true, subtree: true });
  }

  window.addEventListener('hobunji-input-bindings-reset', queueRefresh);

  window.SettingsMenuOrder = Object.freeze({
    refresh: organizeSettingsPane,
    getDebug: () => ({
      currentOrder: currentSettingsOrder(),
      intendedOrder: [...SETTINGS_SECTION_ORDER],
      worldSectionPresent: Boolean(document.getElementById('worldSettingsTitle')),
      banditCampsUnderWorld: document.getElementById('worldSettingsTitle')?.nextElementSibling?.contains?.(document.getElementById('settingBanditCamps')) || false,
      inputBoundaryIntact: inputBoundaryIsIntact(),
      lastOrderChangedAt,
      observing: Boolean(observer),
    }),
  });

  window.InputDefaultsResetUI = Object.freeze({
    installed: true,
    refresh: refreshSettingsUi,
    resetDevice,
    getDebug: () => ({
      desktopButtonPresent: Boolean(document.getElementById('desktopInputResetDefaultsRow')),
      controllerButtonPresent: Boolean(document.getElementById('controllerInputResetDefaultsRow')),
      settingsOrder: currentSettingsOrder(),
      inputBoundaryIntact: inputBoundaryIsIntact(),
      observing: Boolean(observer),
    }),
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();