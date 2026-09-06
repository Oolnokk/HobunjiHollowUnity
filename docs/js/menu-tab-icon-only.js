(() => {
  'use strict';

  if (window.HobunjiMenuTabIcons?.version >= 1) return;

  const TAB_SELECTOR = '.mp-tabs .mp-tab[data-mpanel]'; // Used to target only the main menu's navigation tabs.
  const RELATIONSHIPS_PANEL_ID = 'relationships'; // Used to preserve the PNG heart authored by generic-hud-icons.js.
  const STYLE_ID = 'hobunjiMenuTabIconOnlyStyles'; // Used to keep the presentation rules idempotent.
  const debugState = { transformed: 0, lastPanel: null }; // Used by the mobile-safe debug snapshot below.

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Used to keep the tab-only presentation out of the broader stylesheet.
    style.id = STYLE_ID;
    style.textContent = `
      ${TAB_SELECTOR} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 34px;
        gap: 0;
      }
      ${TAB_SELECTOR} .menu-tab-glyph {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        font-size: 1.05em;
        pointer-events: none;
      }
      ${TAB_SELECTOR}[data-mpanel="relationships"] .relationships-tab-heart {
        filter:
          drop-shadow(0 0 2px rgba(255, 113, 143, .76))
          drop-shadow(0 0 6px rgba(255, 113, 143, .34));
      }
    `;
    document.head?.appendChild(style);
  }

  function firstGrapheme(text) {
    const value = String(text || '').trim(); // Used as the source for preserving each tab's existing emoji/symbol.
    if (!value) return '';
    if (typeof Intl?.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' }); // Used to keep variation selectors/ZWJ emoji intact.
      return segmenter.segment(value)[Symbol.iterator]().next().value?.segment || '';
    }
    return Array.from(value)[0] || ''; // Used as the compatibility fallback for simple single-codepoint tab emoji.
  }

  function visibleLabel(tab) {
    const explicit = tab.getAttribute('aria-label') || tab.title; // Used to preserve an existing accessibility label when one already exists.
    if (explicit) return explicit.trim();
    const text = String(tab.textContent || '').trim(); // Used to derive the former visible label before removing it.
    const glyph = firstGrapheme(text);
    const remainder = glyph ? text.slice(glyph.length).trim() : text;
    if (remainder) return remainder === 'Relations' ? 'Relationships' : remainder;
    const panelId = String(tab.dataset.mpanel || '').trim();
    return panelId ? panelId.replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) : 'Menu';
  }

  function makeGlyphNode(glyph) {
    const span = document.createElement('span'); // Used as the retained icon-only content for emoji-backed tabs.
    span.className = 'menu-tab-glyph';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = glyph;
    return span;
  }

  function transformTab(tab) {
    if (!(tab instanceof Element) || tab.dataset.menuTabIconOnly === '1') return false;
    const panelId = String(tab.dataset.mpanel || ''); // Used to distinguish the custom Relationships heart from ordinary emoji tabs.
    const label = visibleLabel(tab); // Used after the visible words are removed so keyboard/screen-reader navigation remains clear.

    if (panelId === RELATIONSHIPS_PANEL_ID) {
      window.HobunjiGenericHudIcons?.scan?.(); // Used to ensure the relationships tab has its PNG heart before we finalize it.
      const heart = tab.querySelector('.relationships-tab-heart');
      if (!heart) return false;
      for (const child of [...tab.childNodes]) if (child !== heart) child.remove();
    } else {
      const glyph = firstGrapheme(tab.textContent); // Used to retain exactly the tab's existing leading emoji/symbol.
      if (!glyph) return false;
      tab.textContent = '';
      tab.appendChild(makeGlyphNode(glyph));
    }

    tab.setAttribute('aria-label', label);
    tab.title = label;
    tab.dataset.menuTabIconOnly = '1';
    debugState.transformed += 1;
    debugState.lastPanel = panelId || null;
    return true;
  }

  function transformAll() {
    document.querySelectorAll(TAB_SELECTOR).forEach(transformTab);
  }

  function debugSnapshot() {
    const tabs = [...document.querySelectorAll(TAB_SELECTOR)]; // Used to inspect all icon-only tab state without devtools.
    return {
      version: 1,
      transformed: debugState.transformed,
      lastPanel: debugState.lastPanel,
      totalTabs: tabs.length,
      iconOnlyTabs: tabs.filter(tab => tab.dataset.menuTabIconOnly === '1').length,
      labels: Object.fromEntries(tabs.map(tab => [tab.dataset.mpanel || '', tab.getAttribute('aria-label') || ''])),
      relationshipHeartGlowing: !!document.querySelector(`${TAB_SELECTOR}[data-mpanel="relationships"] .relationships-tab-heart`),
    };
  }

  injectStyles();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', transformAll, { once: true });
  else transformAll();

  window.HobunjiMenuTabIcons = Object.freeze({ version: 1, refresh: transformAll, debugSnapshot });
  window.__menuTabIconsDebug = debugSnapshot;
})();
