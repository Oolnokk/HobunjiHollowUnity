(() => {
  'use strict';
  if (window.LivestockNurseryInventoryPaging) return;

  // Inventory-style Nursery pagination. The authoritative Nursery grid owns
  // genetics, actions, portraits, and selection; this module only decides how
  // many of its seven-column square cards fit in the real Animals-column space
  // and hides cards outside the active page. It deliberately does not call the
  // full Nursery decorator while paging.
  const CONFIG = Object.freeze({
    columns: 7,
    fallbackRowsPerPage: 4,
    pagerReservePx: 36,
  });
  const STYLE_ID = 'livestockNurseryInventoryPagingStyles'; // Keeps the inventory-style overrides idempotent.
  const LEGACY_SCROLL_CLASS = 'farm-nursery-scroll'; // Removed from the enhanced grid so FarmMenuLayout's retired compact-scroll path cannot keep handling it as a nested scroller.

  let currentPage = 0; // Retains the visible Nursery page while inspecting babies on that page.
  let activeSection = null; // Distinguishes an in-place page turn from a full Farm-panel rebuild.
  let observer = null; // Watches only direct Farm livestock-section replacement; there is no document-wide paging observer.
  let resizeObserver = null; // Recomputes page capacity only when the real Animals column changes size.
  let observedColumn = null; // Prevents duplicate ResizeObserver registrations across Farm-panel rebuilds.
  let applyQueued = false; // Coalesces mutation/resize bursts into one layout pass.
  let installed = false; // Keeps observer installation idempotent.
  let effectiveRowsPerPage = CONFIG.fallbackRowsPerPage; // Latest measured row capacity, exposed to diagnostics.
  let effectivePageSize = CONFIG.columns * CONFIG.fallbackRowsPerPage; // Latest measured card capacity, exposed to diagnostics.
  let mostRecentChange = 'Inventory-style Nursery paging module loaded.'; // Exposed in mobile-copyable diagnostics.

  function installStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Head-only style insertion cannot wake LivestockNursery's body child-list observer.
    style.id = STYLE_ID;
    style.textContent = `
      /* Inventory uses seven fixed columns whose cells derive their height from
         available width. Nursery mirrors that instead of auto-fill sizing. */
      body #livestockNurserySection .nursery-grid-stack {
        display:grid !important;
        grid-template-columns:repeat(7,minmax(0,1fr)) !important;
        grid-auto-flow:row !important;
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
        padding:0 !important;
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

  function selectedCardIndex(cards) {
    const index = cards.findIndex(card => card.getAttribute('aria-selected') === 'true');
    return index >= 0 ? index : 0;
  }

  function movePagerBelowGrid(section) {
    const shadow = section?.shadowRoot;
    if (!shadow) return null;
    const gridPane = shadow.querySelector('.grid-pane');
    const pagerSlot = shadow.querySelector('slot[name="debug"]');
    if (gridPane && pagerSlot && pagerSlot.parentElement !== gridPane) gridPane.appendChild(pagerSlot); // Shadow-only move; legacy body observer cannot see it.
    const hint = shadow.querySelector('.hint');
    if (hint) hint.textContent = 'Seven square slots across, matching Inventory. Pages only appear when the available grid space is full.';
    return section.querySelector('.nursery-grid-debug-trigger');
  }

  function bindPager(pager) {
    if (!pager || pager.dataset.nurseryPagerBound === '1') return;
    pager.dataset.nurseryPagerBound = '1';
    pager.addEventListener('click', event => {
      if (pager.dataset.nurseryPaging !== '1') return;
      event.preventDefault();
      event.stopPropagation();
      turnPage(1);
    });
    pager.addEventListener('keydown', event => {
      if (pager.dataset.nurseryPaging !== '1') return;
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopPropagation();
      turnPage(event.key === 'ArrowLeft' ? -1 : 1);
    });
  }

  function setPagerState(pager, pageCount) {
    if (!pager) return;
    bindPager(pager);
    if (pageCount <= 1) {
      pager.classList.remove('nursery-page-turn');
      pager.dataset.nurseryPaging = '0';
      pager.dataset.nurseryAction = 'debug'; // Restores LivestockNurseryGrid's ordinary debug action when paging is unnecessary.
      pager.dataset.nurseryLabel = '🛠 Copy Nursery Debug';
      pager.title = 'Copy Nursery diagnostics.';
      pager.setAttribute('aria-label', 'Copy Nursery debug information');
      return;
    }
    pager.classList.add('nursery-page-turn');
    pager.dataset.nurseryPaging = '1';
    pager.removeAttribute('data-nursery-action'); // Prevents the parent grid's debug capture handler from swallowing page-turn input before this control receives it.
    const lastPage = currentPage >= pageCount - 1;
    pager.dataset.nurseryLabel = `${currentPage + 1}/${pageCount} ${lastPage ? '↩' : '▶'}`;
    pager.title = lastPage ? 'Return to the first Nursery page.' : 'Turn to the next Nursery page.';
    pager.setAttribute('aria-label', `Nursery page ${currentPage + 1} of ${pageCount}. ${lastPage ? 'Return to first page' : 'Next page'}.`);
  }

  function numberPx(value, fallback = 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function measurePageGeometry(stack, cards) {
    const cardRowsNeeded = Math.max(1, Math.ceil(cards.length / CONFIG.columns));
    let rows = Math.min(CONFIG.fallbackRowsPerPage, cardRowsNeeded);
    let cellPx = 0;
    let availableHeightPx = 0;

    if (stack && typeof getComputedStyle === 'function') {
      const style = getComputedStyle(stack);
      const gap = numberPx(style.rowGap || style.gap, 6);
      const horizontalGap = numberPx(style.columnGap || style.gap, gap);
      const paddingX = numberPx(style.paddingLeft) + numberPx(style.paddingRight);
      const innerWidth = Math.max(0, Number(stack.clientWidth) - paddingX);
      if (innerWidth > 0) cellPx = Math.max(1, (innerWidth - horizontalGap * (CONFIG.columns - 1)) / CONFIG.columns);

      const column = document.getElementById('farmMenuAnimalsColumn');
      const columnStyle = column && getComputedStyle(column);
      const columnOwnsViewport = column && (columnStyle?.overflowY === 'auto' || columnStyle?.overflowY === 'scroll') && column.clientHeight > 0;
      if (columnOwnsViewport && cellPx > 0) {
        const stackRect = stack.getBoundingClientRect();
        const columnRect = column.getBoundingClientRect();
        const contentTop = stackRect.top - columnRect.top + Number(column.scrollTop || 0); // Stable content offset even if the Animals column is currently scrolled.
        availableHeightPx = Math.max(cellPx, Number(column.clientHeight) - contentTop - CONFIG.pagerReservePx);
        rows = Math.max(1, Math.floor((availableHeightPx + gap) / (cellPx + gap)));
        rows = Math.min(rows, cardRowsNeeded);
      }
    }

    rows = Math.max(1, rows || CONFIG.fallbackRowsPerPage);
    return {
      rows,
      pageSize: Math.max(CONFIG.columns, rows * CONFIG.columns),
      cellPx,
      availableHeightPx,
    };
  }

  function pageCountFor(cardCount, pageSize) {
    return Math.max(1, Math.ceil(cardCount / Math.max(1, pageSize)));
  }

  function observeAnimalsColumn() {
    if (typeof ResizeObserver === 'undefined' || typeof document === 'undefined') return;
    if (!resizeObserver) resizeObserver = new ResizeObserver(() => queueApply());
    const column = document.getElementById('farmMenuAnimalsColumn');
    if (!column || column === observedColumn) return;
    if (observedColumn) resizeObserver.unobserve(observedColumn);
    observedColumn = column;
    resizeObserver.observe(column);
  }

  function applyPage({ focusFirst = false } = {}) {
    const { section, stack, cards } = sectionAndCards();
    if (!section || !stack) return false;

    // The old FarmMenuLayout compact-list helper still knows this DOM node by
    // position. Remove its marker so controller focus/scroll bookkeeping no
    // longer treats the paged square grid as a nested scroll region.
    stack.classList.remove(LEGACY_SCROLL_CLASS);
    if (stack.scrollTop) stack.scrollTop = 0;
    observeAnimalsColumn();

    const geometry = measurePageGeometry(stack, cards);
    effectiveRowsPerPage = geometry.rows;
    effectivePageSize = geometry.pageSize;

    if (section !== activeSection) {
      activeSection = section;
      currentPage = Math.floor(selectedCardIndex(cards) / effectivePageSize);
    }

    const pageCount = pageCountFor(cards.length, effectivePageSize);
    currentPage = Math.max(0, Math.min(currentPage, pageCount - 1));
    const start = currentPage * effectivePageSize;
    const end = start + effectivePageSize;

    let selectedVisibleCard = null;
    cards.forEach((card, index) => {
      const hidden = index < start || index >= end;
      card.hidden = hidden;
      card.removeAttribute('data-ctrl-default'); // Prevents stale defaults from surviving selection/page changes.
      if (!hidden && card.getAttribute('aria-selected') === 'true') selectedVisibleCard = card;
    });
    selectedVisibleCard?.setAttribute('data-ctrl-default', '');

    const pager = movePagerBelowGrid(section);
    setPagerState(pager, pageCount);
    mostRecentChange = `Nursery page ${currentPage + 1}/${pageCount}: ${Math.max(0, Math.min(cards.length, end) - start)} visible of ${cards.length} babies; ${effectiveRowsPerPage} rows fit the Animals column.`;

    if (focusFirst) {
      const first = cards.slice(start, end).find(card => !card.hidden && !card.disabled);
      if (first) first.focus?.({ preventScroll: true }); // focusin already drives NurseryGrid selection/details; clicking again would render them twice.
    }
    return true;
  }

  function turnPage(delta) {
    const { stack, cards } = sectionAndCards();
    if (!stack) return false;
    const geometry = measurePageGeometry(stack, cards);
    effectiveRowsPerPage = geometry.rows;
    effectivePageSize = geometry.pageSize;
    const pageCount = pageCountFor(cards.length, effectivePageSize);
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

  function debugSnapshot() {
    const { cards } = sectionAndCards();
    return {
      mostRecentChange,
      installed,
      columns: CONFIG.columns,
      fallbackRowsPerPage: CONFIG.fallbackRowsPerPage,
      effectiveRowsPerPage,
      effectivePageSize,
      currentPage: currentPage + 1,
      pageCount: pageCountFor(cards.length, effectivePageSize),
      cardCount: cards.length,
      visibleIds: cards.filter(card => !card.hidden).map(card => card.dataset.nurseryBabyId),
      legacyScrollClassPresent: !!document.querySelector?.('#livestockNurserySection .farm-nursery-scroll'),
    };
  }

  function install() {
    installStyles();
    installObserver();
    observeAnimalsColumn();
    installed = true;
    queueApply();
    return true;
  }

  window.LivestockNurseryInventoryPaging = { CONFIG, install, applyPage, turnPage, debugSnapshot };
  window.__livestockNurseryInventoryPagingDebug = { snapshot: debugSnapshot, applyPage, turnPage };
  install();
})();