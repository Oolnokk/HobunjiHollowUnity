(() => {
  'use strict';
  if (window.LivestockNurseryInventoryPaging) return;

  // Presentation correction layered over LivestockNurseryGrid. The Inventory
  // pack uses seven fixed square columns; Nursery now mirrors that geometry
  // instead of auto-fill cards inside a nested scrollbar. Overflow is paged.
  const CONFIG = Object.freeze({
    columns: 7,
    rowsPerPage: 4,
    pageSize: 28,
  });
  const STYLE_ID = 'livestockNurseryInventoryPagingStyles'; // Used to keep the inventory-style override idempotent.

  let currentPage = 0; // Used to retain the visible Nursery page while inspecting babies on that page.
  let activeSection = null; // Used to distinguish an in-place page turn from a full Farm-panel rebuild.
  let observer = null; // Watches only Farm livestock section replacement; paging itself performs no light-DOM child mutations.
  let applyQueued = false; // Coalesces core/grid observer churn into one paging/layout pass.
  let installed = false; // Used to keep document capture handlers and observers idempotent.
  let mostRecentChange = 'Inventory-style Nursery paging module loaded.'; // Exposed in mobile-copyable diagnostics.

  function installStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Head-only style insertion cannot wake LivestockNursery's body child-list observer.
    style.id = STYLE_ID;
    style.textContent = `
      /* Same fundamental geometry as Inventory: seven fixed columns with
         square cells derived from the available grid width. */
      body #livestockNurserySection .nursery-grid-stack {
        display:grid !important;
        grid-template-columns:repeat(7,minmax(0,1fr)) !important;
        grid-auto-rows:auto !important;
        align-content:start !important;
        gap:6px !important;
        width:100% !important;
        height:auto !important;
        min-height:0 !important;
        max-height:none !important;
        overflow:visible !important;
        overscroll-behavior:auto !important;
        padding:6px !important;
        scrollbar-gutter:auto !important;
        border:1px solid #ffffff12 !important;
        border-radius:7px !important;
        background:#0000001a !important;
        box-sizing:border-box !important;
      }
      body #livestockNurserySection .nursery-grid-card {
        display:block !important;
        position:relative !important;
        min-width:0 !important;
        min-height:0 !important;
        width:100% !important;
        height:auto !important;
        aspect-ratio:1 / 1 !important;
        align-self:stretch !important;
        justify-self:stretch !important;
        box-sizing:border-box !important;
      }
      body #livestockNurserySection .nursery-grid-card[hidden] { display:none !important; }
      body #livestockNurserySection .nursery-grid-debug-trigger.nursery-page-turn {
        display:flex !important;
        align-items:center !important;
        justify-content:flex-end !important;
        align-self:stretch !important;
        width:100% !important;
        min-height:28px !important;
        margin:6px 0 0 !important;
        padding:4px 8px !important;
        border:1px solid #ffffff24 !important;
        border-radius:7px !important;
        background:linear-gradient(#ffffff11,#ffffff08) !important;
        color:inherit !important;
        cursor:pointer !important;
        box-sizing:border-box !important;
      }
      body #livestockNurserySection .nursery-grid-debug-trigger.nursery-page-turn::after {
        font-size:12px !important;
        font-weight:800 !important;
        letter-spacing:.02em !important;
      }
      body #livestockNurserySection .nursery-grid-debug-trigger.nursery-page-turn:hover {
        border-color:#ffffff4d !important;
        background:linear-gradient(#ffffff1c,#ffffff0e) !important;
      }
    `;
    document.head.appendChild(style);
  }

  function sectionAndCards() {
    if (typeof document === 'undefined') return { section: null, stack: null, cards: [] };
    const section = document.getElementById('livestockNurserySection');
    const stack = section?.querySelector?.('.nursery-grid-stack') || null;
    const cards = stack ? [...stack.querySelectorAll(':scope > .nursery-grid-card')] : [];
    return { section, stack, cards };
  }

  function selectedBabyId() {
    try { return window.LivestockNurseryGrid?.debugSnapshot?.()?.selectedBabyId ?? null; }
    catch (_) { return null; }
  }

  function movePagerBelowGrid(section) {
    const shadow = section?.shadowRoot;
    if (!shadow) return null;
    const gridPane = shadow.querySelector('.grid-pane');
    const pagerSlot = shadow.querySelector('slot[name="debug"]');
    if (gridPane && pagerSlot && pagerSlot.parentElement !== gridPane) gridPane.appendChild(pagerSlot); // Shadow-only move; legacy body observer cannot see it.
    const hint = shadow.querySelector('.hint');
    if (hint) hint.textContent = 'Seven square slots across, matching Inventory. Turn the page only when the Nursery exceeds one page.';
    return section.querySelector('.nursery-grid-debug-trigger');
  }

  function setPagerLabel(pager, pageCount) {
    if (!pager) return;
    if (pageCount <= 1) {
      pager.classList.remove('nursery-page-turn');
      pager.dataset.nurseryPaging = '0';
      pager.dataset.nurseryLabel = '🛠 Copy Nursery Debug';
      pager.title = 'Copy Nursery diagnostics.';
      return;
    }
    pager.classList.add('nursery-page-turn');
    pager.dataset.nurseryPaging = '1';
    const lastPage = currentPage >= pageCount - 1;
    pager.dataset.nurseryLabel = `${currentPage + 1}/${pageCount} ${lastPage ? '↩' : '▶'}`;
    pager.title = lastPage ? 'Return to the first Nursery page.' : 'Turn to the next Nursery page.';
  }

  function pageCountFor(cards) {
    return Math.max(1, Math.ceil(cards.length / CONFIG.pageSize));
  }

  function pageForSelected(cards) {
    const selectedId = selectedBabyId();
    if (selectedId == null) return 0;
    const index = cards.findIndex(card => card.dataset.nurseryBabyId === String(selectedId));
    return index < 0 ? 0 : Math.floor(index / CONFIG.pageSize);
  }

  function applyPage({ focusFirst = false } = {}) {
    // Grid module owns genetics/details; ask it to finish its synchronous
    // decoration first if the Farm panel just rebuilt underneath us.
    window.LivestockNurseryGrid?.decorate?.();
    const { section, cards } = sectionAndCards();
    if (!section) return false;

    if (section !== activeSection) {
      activeSection = section;
      currentPage = pageForSelected(cards);
    }

    const pageCount = pageCountFor(cards);
    currentPage = Math.max(0, Math.min(currentPage, pageCount - 1));
    const start = currentPage * CONFIG.pageSize;
    const end = start + CONFIG.pageSize;
    cards.forEach((card, index) => { card.hidden = index < start || index >= end; });

    const pager = movePagerBelowGrid(section);
    setPagerLabel(pager, pageCount);
    mostRecentChange = `Nursery page ${currentPage + 1}/${pageCount}: ${Math.min(cards.length, end) - start} visible of ${cards.length} babies.`;

    if (focusFirst) {
      const first = cards.slice(start, end).find(card => !card.hidden && !card.disabled);
      if (first) {
        first.focus?.({ preventScroll: true });
        first.click?.(); // Reuses NurseryGrid's authoritative selection/detail path.
      }
    }
    return true;
  }

  function turnPage(delta) {
    const { cards } = sectionAndCards();
    const pageCount = pageCountFor(cards);
    if (pageCount <= 1) return false;
    currentPage = (currentPage + delta + pageCount) % pageCount;
    applyPage({ focusFirst: true });
    return true;
  }

  function queueApply() {
    if (applyQueued) return;
    applyQueued = true;
    queueMicrotask(() => {
      applyQueued = false;
      applyPage();
    });
  }

  function installObserver() {
    if (observer || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return false;
    const attach = () => {
      if (observer) return true;
      const list = document.getElementById('farmLivestockList');
      if (!list) return false;
      observer = new MutationObserver(() => queueApply());
      observer.observe(list, { childList: true, subtree: false });
      queueApply();
      return true;
    };
    if (attach()) return true;
    document.addEventListener('DOMContentLoaded', attach, { once: true });
    return true;
  }

  function installInputHandlers() {
    if (typeof document === 'undefined' || document.documentElement?.dataset?.nurseryInventoryPagingInput === '1') return;
    document.documentElement.dataset.nurseryInventoryPagingInput = '1';

    // Capture before LivestockNurseryGrid's section-level debug handler. The
    // existing light-DOM debug host becomes the controller-focusable page arrow
    // only while multiple pages exist; on a single page it remains Debug.
    document.addEventListener('click', event => {
      const pager = event.target?.closest?.('.nursery-grid-debug-trigger.nursery-page-turn');
      if (!pager || pager.dataset.nurseryPaging !== '1') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      turnPage(1);
    }, true);

    document.addEventListener('keydown', event => {
      const pager = event.target?.closest?.('.nursery-grid-debug-trigger.nursery-page-turn');
      if (!pager || pager.dataset.nurseryPaging !== '1') return;
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      turnPage(event.key === 'ArrowLeft' ? -1 : 1);
    }, true);
  }

  function debugSnapshot() {
    const { cards } = sectionAndCards();
    return {
      mostRecentChange,
      installed,
      columns: CONFIG.columns,
      rowsPerPage: CONFIG.rowsPerPage,
      pageSize: CONFIG.pageSize,
      currentPage: currentPage + 1,
      pageCount: pageCountFor(cards),
      cardCount: cards.length,
      visibleIds: cards.filter(card => !card.hidden).map(card => card.dataset.nurseryBabyId),
    };
  }

  function install() {
    installStyles();
    installInputHandlers();
    installObserver();
    installed = true;
    queueApply();
    return true;
  }

  window.LivestockNurseryInventoryPaging = { CONFIG, install, applyPage, turnPage, debugSnapshot };
  window.__livestockNurseryInventoryPagingDebug = { snapshot: debugSnapshot, applyPage, turnPage };
  install();
})();