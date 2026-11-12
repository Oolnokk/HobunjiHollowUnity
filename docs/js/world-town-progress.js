// World → Town Progress: read-only summary of existing TownMine and Great Fey quest saves.
// This is intentionally a presentation adapter, not another Town Value or quest authority.
(function (global) {
  'use strict';

  const PANE_ID = 'mpWorldProgress'; // Identifies the World Progress page for rendering and controller navigation.
  const TAB_ID = 'worldProgress'; // Matches the existing menu's data-mpanel → mpPane convention.
  const BANUBU_QUEST_ID = 'banubu_fish_pies'; // The canonical questProgress key shared with BanubuQuestline.
  const LADDER_TOTAL = 9; // TownMine's nine permanent, ten-floor ladder upgrades.
  const GREAT_FEY = Object.freeze([
    { id: 'banubu', label: 'Lord Banubu', specified: 5, playable: 2, implementation: 'partial' },
    { id: 'hiki_hiki', label: 'Hiki-hiki', specified: null, playable: 0, implementation: 'unbuilt' },
    { id: 'mother_rahayobi', label: 'Mother Rahayobi', specified: null, playable: 0, implementation: 'unbuilt' },
    { id: 'nohuknuk', label: 'Old Man Nohuknuk', specified: null, playable: 0, implementation: 'unbuilt' },
  ]); // Only Banubu has authored quests; absent totals for the others are unknown, not zero.
  let lastSnapshot = null; // Reused by the mobile-accessible diagnostics when the page is open.
  let renderCount = 0; // Exposed in diagnostics to catch duplicate or unexpectedly frequent renders.

  function boundedInt(value, max) {
    const n = Number(value); // Converts save data into safe progress values before display.
    return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : 0;
  }

  function questState() {
    const liveProfile = global.__hobunjiPlayerProfile; // Only inspect the active member's quest state, never another character/world.
    if (!liveProfile) return null;
    // Banubu's read-only accessor reads the live injected quest store without creating or migrating saves.
    if (typeof global.BanubuQuestline?.peekQuestState === 'function') return global.BanubuQuestline.peekQuestState();
    return liveProfile.questProgress?.[BANUBU_QUEST_ID] || null;
  }

  function banubuProgress(state) {
    const stage = boundedInt(state?.stage, 5); // Active stage 1/2 means its preceding requests, not this one, are complete.
    const completed = state?.status === 'blocked' || state?.status === 'finished'
      ? 2 : Math.min(2, Math.max(0, stage - 1)); // The authored controller blocks at stage 3 after the second turn-in.
    let next = 'Find and speak with Lord Banubu.';
    if (state?.status === 'blocked') next = 'Both playable requests finished. Quests 3–5 await implementation.';
    else if (stage === 2) next = state.status === 'active'
      ? 'In progress: Nine Leaf Tea.' : 'Next: accept the Nine Leaf Tea request.';
    else if (stage === 1) next = state.status === 'active'
      ? 'In progress: Three-Fish Pie.' : 'Next: accept the Three-Fish Pie request.';
    else if (state?.status === 'intro') next = 'Speak with Banubu to begin his requests.';
    return { completed, stage, status: String(state?.status || 'not-started'), next };
  }

  function snapshot() {
    const mine = global.TownMine; // Canonical owner of every currently implemented Town Value increment.
    const saved = mine?.serialize?.() || null; // Never duplicate or persist mine/upgrade data in the presentation layer.
    const installed = !!mine && typeof mine.getTownValue === 'function';
    const townValue = installed ? boundedInt(mine.getTownValue(), 1000000) : null;
    const mineValue = boundedInt(saved?.townValue, 1000000);
    const tiers = [...new Set((Array.isArray(saved?.unlockedShortcutTiers) ? saved.unlockedShortcutTiers : [])
      .map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= LADDER_TOTAL))].sort((a, b) => a - b);
    const foundry = !!(mine?.hasImprovement?.('foundry') || saved?.improvements?.includes?.('foundry'));
    const banubu = banubuProgress(questState());
    const fey = GREAT_FEY.map(entry => ({
      ...entry,
      completed: entry.id === 'banubu' ? banubu.completed : 0,
      next: entry.id === 'banubu' ? banubu.next : 'No playable questline has been authored yet.',
    })); // All four Fey remain visible even before discovery; unknown totals stay explicit.
    const playable = fey.reduce((total, entry) => total + entry.playable, 0);
    const completed = fey.reduce((total, entry) => total + entry.completed, 0);
    const specified = fey.reduce((total, entry) => total + (entry.specified || 0), 0);
    return {
      townValue, mineValue, foundry, foundryValue: foundry ? 3 : 0,
      tiers, ladderTotal: LADDER_TOTAL, deepestFloor: boundedInt(saved?.deepestFloor, 100),
      fey, feyCount: fey.length, playable, completed, specified,
      unspecifiedFeyCount: fey.filter(entry => entry.specified === null).length,
      banubuStatus: banubu.status,
    };
  }

  function node(tag, className, text) {
    const item = document.createElement(tag); // Shared small DOM factory avoids inserting untrusted quest/save strings as HTML.
    if (className) item.className = className;
    if (text !== undefined) item.textContent = String(text);
    return item;
  }

  function infoRow(title, detail, label, progress, maximum) {
    const row = node('div', 'town-progress-row'); // Reused for each canonical Town Value source.
    const content = node('div', 'town-progress-row-info');
    const heading = node('div', 'town-progress-row-title', title);
    const description = node('div', 'town-progress-muted', detail);
    const amount = node('div', 'town-progress-row-value', label);
    content.append(heading, description);
    if (maximum > 0) {
      const bar = node('div', 'town-progress-track');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', title);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(maximum));
      bar.setAttribute('aria-valuenow', String(Math.min(maximum, progress)));
      const fill = node('div', 'town-progress-fill');
      fill.style.width = (Math.min(maximum, progress) / maximum * 100) + '%';
      bar.appendChild(fill);
      content.appendChild(bar);
    }
    row.append(content, amount);
    return row;
  }

  function render() {
    if (typeof document === 'undefined') return null;
    const host = document.getElementById(PANE_ID);
    if (!host) return null;
    const data = snapshot(); // Render only on opening or explicit refresh, never once per gameplay frame.
    lastSnapshot = data;
    renderCount += 1;
    const page = node('div', 'town-progress-page');
    const hero = node('section', 'town-progress-hero');
    const heroLabel = node('div', 'town-progress-kicker', 'Town Value');
    const value = node('div', 'town-progress-value', data.townValue === null ? '—' : data.townValue);
    const heroDetail = node('div', 'town-progress-muted',
      data.townValue === null ? 'Town progression is not loaded.' :
      'Permanent town improvements and mine-ladder extensions determine this value.');
    hero.append(heroLabel, value, heroDetail);
    page.appendChild(hero);

    const feySection = node('section', 'town-progress-section');
    feySection.appendChild(node('h2', 'town-progress-heading', 'Great Fey quests'));
    feySection.appendChild(node('p', 'town-progress-overview',
      data.completed + ' / ' + data.playable + ' playable quests completed · ' +
      data.playable + ' playable of ' + data.specified + ' specified quests'));
    feySection.appendChild(node('p', 'town-progress-muted',
      data.feyCount + ' Great Fey · ' + data.unspecifiedFeyCount +
      ' questline totals not yet defined. Unknown future quests are not included in the count.'));
    const cards = node('div', 'town-progress-fey-list');
    for (const entry of data.fey) {
      const card = node('article', 'town-progress-fey-card');
      const header = node('div', 'town-progress-fey-top');
      const title = node('h3', 'town-progress-fey-name', entry.label);
      const status = node('span', 'town-progress-status ' +
        (entry.implementation === 'partial' ? 'is-partial' : 'is-unbuilt'),
        entry.implementation === 'partial' ? 'Partly under construction' : 'Under construction');
      header.append(title, status);
      const count = node('div', 'town-progress-fey-count',
        entry.completed + ' / ' + entry.playable + ' playable completed · ' +
        (entry.specified === null ? 'Total quests TBD' : entry.specified + ' specified'));
      card.append(header, count);
      const bar = node('div', 'town-progress-track');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', entry.label + ' playable quest completion');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(entry.playable));
      bar.setAttribute('aria-valuenow', String(entry.completed));
      if (entry.playable) {
        const fill = node('div', 'town-progress-fill');
        fill.style.width = (entry.completed / entry.playable * 100) + '%';
        bar.appendChild(fill);
        card.appendChild(bar);
      }
      if (entry.id === 'banubu') {
        card.appendChild(node('div', 'town-progress-muted',
          'Quest 1: Three-Fish Pie · Quest 2: Nine Leaf Tea · Quests 3–5: not yet playable.'));
      }
      card.appendChild(node('p', 'town-progress-detail', entry.next));
      cards.appendChild(card);
    }
    feySection.appendChild(cards);
    page.appendChild(feySection);

    const sources = node('section', 'town-progress-section');
    sources.appendChild(node('h2', 'town-progress-heading', 'Other ways to raise Town Value'));
    sources.appendChild(node('p', 'town-progress-muted',
      'These are the Town Value increases currently implemented. Great Fey requests do not currently award Town Value.'));
    sources.appendChild(infoRow('Town mine ladder extensions',
      data.tiers.length + ' of ' + data.ladderTotal + ' built · deepest floor reached: ' + data.deepestFloor + '/100',
      '+' + data.mineValue + ' Town Value', data.tiers.length, data.ladderTotal));
    sources.appendChild(infoRow('Foundry upgrade',
      data.foundry ? 'Built at Kzubug’s smithy through Hunundi’s town proposal.' :
        'Not built · talk to Father Hunundi to review the Foundry proposal.',
      (data.foundry ? '+' + data.foundryValue : '+0 / +3') + ' Town Value', data.foundry ? 1 : 0, 1));
    if (data.mineValue !== data.tiers.length) {
      sources.appendChild(node('p', 'town-progress-muted',
        'Note: saved mine Town Value differs from the number of built ladder extensions (for example, a developer adjustment). The total uses the saved value.'));
    }
    page.appendChild(sources);

    const diagnostics = node('details', 'town-progress-diagnostics');
    diagnostics.appendChild(node('summary', '', 'Progress diagnostics'));
    diagnostics.appendChild(node('pre', '', JSON.stringify({ ...data, renderCount }, null, 2)));
    page.appendChild(diagnostics);
    host.replaceChildren(page);
    return data;
  }

  function install() {
    const tab = document.querySelector('#menuPanel .mp-tab[data-mpanel="' + TAB_ID + '"]');
    const pane = document.getElementById(PANE_ID);
    if (!tab || !pane || tab.dataset.townProgressBound === '1') return;
    tab.dataset.townProgressBound = '1'; // Prevents duplicate handlers when optional modules reinitialize.
    tab.addEventListener('click', () => {
      // Give game.js's ordinary tab switcher first chance; cover older hard-coded switchers.
      Promise.resolve().then(() => {
        if (!tab.classList.contains('active') || !pane.classList.contains('active')) {
          document.querySelectorAll('#menuPanel .mp-tab[data-mpanel]').forEach(button => button.classList.remove('active'));
          document.querySelectorAll('#menuPanel .mp-pane').forEach(other => other.classList.remove('active'));
          tab.classList.add('active');
          pane.classList.add('active');
        }
        render();
      });
    });
    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver(() => { if (tab.classList.contains('active')) render(); });
      observer.observe(tab, { attributes: true, attributeFilter: ['class'] }); // Controller and programmatic tab changes refresh the same page.
      const menu = document.getElementById('menuPanel');
      if (menu) {
        const menuObserver = new MutationObserver(() => {
          if (tab.classList.contains('active')) render();
        });
        menuObserver.observe(menu, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] }); // Reopening an already-selected tab refreshes it.
      }
    }
    global.addEventListener?.('hobunjiPlayerReady', () => {
      if (tab.classList.contains('active')) render();
    }); // Startup/character switching should display the correct active member.
    if (tab.classList.contains('active')) render();
  }

  global.TownProgressPanel = Object.freeze({
    version: 1, snapshot, render,
    debugSnapshot: () => ({ renderCount, lastSnapshot, panePresent: !!global.document?.getElementById(PANE_ID) }),
  }); // Read-only mobile diagnostics available even before the tab is opened.
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }
})(typeof window !== 'undefined' ? window : globalThis);
