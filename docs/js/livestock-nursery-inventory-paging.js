(() => {
  'use strict';
  if (window.LivestockNurseryInventoryPaging) return;

  // Inventory-style Nursery pagination. Inventory uses a fixed seven-column
  // square grid; Nursery mirrors that contract with four rows per page. This
  // deliberately avoids scroll-dependent geometry, ResizeObserver churn, and
  // nested scrolling. A page turn exists only when more than 28 babies exist.
  const CONFIG = Object.freeze({
    columns: 7,
    rowsPerPage: 4,
    pageSize: 28,
  });
  const STYLE_ID = 'livestockNurseryInventoryPagingStyles'; // Keeps the inventory-style overrides idempotent.
  const LEGACY_SCROLL_CLASS = 'farm-nursery-scroll'; // Removed whenever paging applies so the old compact-list controller path stays dormant.

  let currentPage = 0; // Retains the visible Nursery page while inspecting babies on that page.
  let activeSection = null; // Distinguishes a page turn from a full Farm-panel rebuild.
  let observer = null; // Watches only direct Farm livestock-section replacement; no subtree/resize observers are needed.
  let applyQueued = false; // Coalesces render mutation bursts into one pagination pass.
  let installed = false; // Keeps observer/listener installation idempotent.
  let applyCount = 0; // Diagnostic counter used to catch unexpected observer churn on mobile/desktop builds.
  let observerWakeCount = 0; // Diagnostic counter used to distinguish real Farm rebuilds from page-turn work.
  let mostRecentChange = 'Inventory-style Nursery paging module loaded.'; // Exposed in mobile-copyable diagnostics.

  function installStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Head-only style insertion cannot wake LivestockNursery's body child-list observer.
    style.id = STYLE_ID;
    style.textContent = `
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
        min-height:30px !important;
        margin:6px 0 0 !important;
        padding:4px 9px !important;
        border:1px solid #ffffff24 !important;
        border-radius:7px !important;
        background:linear-gradient(#ffffff11,#ffffff08) !important;
        color:inherit !important;
        font-size:0 !important;
        cursor:pointer !important;
        box-sizing:border-box !important;
      }
      body #livestockNurserySection .nursery-grid-debug-trigger.nursery-page-turn::after {
        content:attr(data-nursery-label) !important;
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

  function pageCountFor(cardCount) {
    return Math.max(1, Math.ceil(cardCount / CONFIG.pageSize));
  }

  function movePagerBelowGrid(section) {
    const shadow = section?.shadowRoot;
    if (!shadow) return null;
    const gridPane = shadow.querySelector('.grid-pane');
    const pagerSlot = shadow.querySelector('slot[name="debug"]');
    if (gridPane && pagerSlot && pagerSlot.parentElement !== gridPane) gridPane.appendChild(pagerSlot); // Shadow-only move; the legacy body observer cannot see it.
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
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
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
      pager.dataset.nurseryAction = 'debug';
      pager.dataset.nurseryLabel = '🛠 Copy Nursery Debug';
      pager.title = 'Copy Nursery diagnostics.';
      pager.setAttribute('aria-label', 'Copy Nursery debug information');
      return;
    }
    pager.classList.add('nursery-page-turn');
    pager.dataset.nurseryPaging = '1';
    pager.removeAttribute('data-nursery-action'); // Prevents the grid's debug capture handler from swallowing page-turn input.
    const lastPage = currentPage >= pageCount - 1;
    pager.dataset.nurseryLabel = `${currentPage + 1}/${pageCount} ${lastPage ? '↩' : '▶'}`;
    pager.title = lastPage ? 'Return to the first Nursery page.' : 'Turn to the next Nursery page.';
    pager.setAttribute('aria-label', `Nursery page ${currentPage + 1} of ${pageCount}. ${lastPage ? 'Return to first page' : 'Next page'}.`);
  }

  function applyPage({ focusFirst = false } = {}) {
    const { section, stack, cards } = sectionAndCards();
    if (!section || !stack) return false;
    applyCount++;

    // The square grid never owns scrolling. FarmMenuLayout may still know the
    // original compact-list node by position, so clear its old marker whenever
    // a real Farm/Nursery render asks us to paginate.
    stack.classList.remove(LEGACY_SCROLL_CLASS);
    if (stack.scrollTop) stack.scrollTop = 0;

    if (section !== activeSection) {
      activeSection = section;
      currentPage = Math.floor(selectedCardIndex(cards) / CONFIG.pageSize);
    }

    const pageCount = pageCountFor(cards.length);
    currentPage = Math.max(0, Math.min(currentPage, pageCount - 1));
    const start = currentPage * CONFIG.pageSize;
    const end = start + CONFIG.pageSize;

    let selectedVisibleCard = null;
    cards.forEach((card, index) => {
      const hidden = index < start || index >= end;
      card.hidden = hidden;
      card.removeAttribute('data-ctrl-default');
      if (!hidden && card.getAttribute('aria-selected') === 'true') selectedVisibleCard = card;
    });
    selectedVisibleCard?.setAttribute('data-ctrl-default', '');

    const pager = movePagerBelowGrid(section);
    setPagerState(pager, pageCount);
    mostRecentChange = `Nursery page ${currentPage + 1}/${pageCount}: ${Math.max(0, Math.min(cards.length, end) - start)} visible of ${cards.length} babies; fixed ${CONFIG.columns}×${CONFIG.rowsPerPage} Inventory-style page.`;

    if (focusFirst) {
      const first = cards.slice(start, end).find(card => !card.hidden && !card.disabled);
      if (first) first.focus?.({ preventScroll: true });
    }
    return true;
  }

  function turnPage(delta) {
    const { cards } = sectionAndCards();
    const pageCount = pageCountFor(cards.length);
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
      observer = new MutationObserver(() => {
        observerWakeCount++;
        queueApply();
      });
      observer.observe(list, { childList: true, subtree: false });
      queueApply();
      return true;
    };
    if (attach()) return true;
    document.addEventListener('DOMContentLoaded', attach, { once: true });
    return true;
  }

  function debugSnapshot() {
    const { cards, stack } = sectionAndCards();
    return {
      mostRecentChange,
      installed,
      columns: CONFIG.columns,
      rowsPerPage: CONFIG.rowsPerPage,
      pageSize: CONFIG.pageSize,
      currentPage: currentPage + 1,
      pageCount: pageCountFor(cards.length),
      cardCount: cards.length,
      visibleIds: cards.filter(card => !card.hidden).map(card => card.dataset.nurseryBabyId),
      applyCount,
      observerWakeCount,
      legacyScrollClassPresent: !!stack?.classList?.contains(LEGACY_SCROLL_CLASS),
      nestedScrollTop: Number(stack?.scrollTop || 0),
    };
  }

  function install() {
    installStyles();
    installObserver();
    installed = true;
    queueApply();
    return true;
  }

  window.LivestockNurseryInventoryPaging = { CONFIG, install, applyPage, turnPage, debugSnapshot };
  window.__livestockNurseryInventoryPagingDebug = { snapshot: debugSnapshot, applyPage, turnPage };
  install();
})();