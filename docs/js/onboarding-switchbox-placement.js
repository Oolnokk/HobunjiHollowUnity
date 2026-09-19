// Hobunji Hollow — onboarding placement guard for the dev Testing Switchbox.
// dev-testing-switchbox.js owns the switches themselves; this module only controls where its onboarding surface may appear.
(() => {
  'use strict';

  const MODULE_ID = 'hobunjiOnboardingSwitchboxPlacement'; // Prevents duplicate observer/style installation.
  const SECTION_ID = 'devSwitchboxSaveSelectSection'; // Existing section created by dev-testing-switchbox.js.
  if (window[MODULE_ID]) return;

  const status = {
    installed: true,
    visibleStep: null,
    placedInWorldSelect: false,
    collapsedByDefault: true,
    lastError: null,
  }; // Mobile-visible diagnostic state for this placement guard.

  let observer = null; // Watches onboarding-core card replacements and the later switchbox injection.
  let refreshQueued = false; // Coalesces mutation bursts into one placement pass.

  function installStyle() {
    if (document.getElementById(`${MODULE_ID}Style`)) return;
    const style = document.createElement('style');
    style.id = `${MODULE_ID}Style`;
    style.textContent = `
/* The switchbox script loads much later than onboarding. Keep its injected section
   invisible until this guard confirms it belongs to the World step, preventing
   even a one-frame character-creator height collapse. */
#${SECTION_ID}:not([data-world-select-placed="1"]){display:none!important}
#${SECTION_ID}[data-world-select-placed="1"]{display:flex}
#${SECTION_ID} .ob-world-switchbox-details{width:100%;box-sizing:border-box}
`;
    document.head.appendChild(style);
  }

  function currentVisibleCard() {
    for (const card of document.querySelectorAll('#ob-overlay .ob-card')) {
      const computed = getComputedStyle(card);
      if (computed.display !== 'none' && computed.visibility !== 'hidden') return card;
    }
    return null;
  }

  function isWorldSelectCard(card) {
    return !!card?.querySelector('#slPlay') && !!card?.querySelector('#slBackToCharacter');
  }

  function cardStep(card) {
    if (!card) return null;
    if (isWorldSelectCard(card)) return 'world';
    if (card.querySelector('#ob-portrait-canvas')) return 'character-create';
    if (card.querySelector('#slCharNext')) return 'character-select';
    if (card.querySelector('#slSourceContinue')) return 'save-source';
    return 'other';
  }

  function makeCollapsedDetails(section) {
    if (section.dataset.worldSelectPlaced === '1') return;

    const oldTitle = section.querySelector('.sl-section-label');
    const panel = oldTitle?.nextElementSibling || [...section.children].find(child => child !== oldTitle) || null;
    const details = document.createElement('details');
    details.className = 'sl-dev-details ob-world-switchbox-details';
    details.dataset.devSwitchboxWorldDetails = '1';
    // Intentionally no `open` attribute: every freshly rendered World step starts collapsed.

    const summary = document.createElement('summary');
    summary.textContent = oldTitle?.textContent || '🧪 Testing Switchbox — dev-only';
    details.appendChild(summary);
    if (panel) details.appendChild(panel);

    section.replaceChildren(details);
    section.dataset.worldSelectPlaced = '1';
  }

  function refreshPlacement() {
    refreshQueued = false;
    const card = currentVisibleCard();
    const section = document.getElementById(SECTION_ID);
    status.visibleStep = cardStep(card);
    status.placedInWorldSelect = false;
    status.lastError = null;

    if (!section) return; // dev-testing-switchbox.js may not have loaded/injected yet.

    try {
      if (!card || !isWorldSelectCard(card) || section.parentElement !== card) {
        section.removeAttribute('data-world-select-placed');
        section.style.display = 'none';
        return;
      }

      makeCollapsedDetails(section);
      section.style.removeProperty('display');

      // Keep the switchbox inside the World step's content flow, immediately
      // before the Back/Play footer instead of appended beneath the whole card.
      const footer = card.querySelector('.sl-footer');
      if (footer && section.nextElementSibling !== footer) footer.before(section);

      status.placedInWorldSelect = true;
    } catch (error) {
      status.lastError = String(error?.message || error);
      console.warn('[Onboarding Switchbox Placement]', error);
    }
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(refreshPlacement);
  }

  // Everything refreshPlacement() reads/writes (#ob-overlay's .ob-card cards,
  // #devSwitchboxSaveSelectSection) lives inside #ob-overlay, which
  // onboarding-core.js creates later as a direct child of document.body and
  // isn't in static markup, so it can't be `getElementById`'d up front.
  // Watching document.body's entire subtree meant any unrelated DOM change
  // anywhere queued a refresh for no reason. Same two-tier pattern as
  // folder-save-primary.js/save-startup-gate.js: a cheap direct-children-only
  // watch on body just to notice the overlay appearing, then a real observer
  // scoped to #ob-overlay itself (still subtree, since the placement logic
  // inspects nested descendants like #slPlay/#slBackToCharacter).
  function attachOverlayObserver(overlay) {
    if (!overlay || overlay.__switchboxPlacementObserved) return;
    overlay.__switchboxPlacementObserved = true;
    new MutationObserver(queueRefresh).observe(overlay, { childList: true, subtree: true });
    queueRefresh();
  }

  function install() {
    installStyle();
    const overlay = document.getElementById('ob-overlay');
    if (overlay) attachOverlayObserver(overlay);
    else {
      observer = new MutationObserver(() => {
        const nowOverlay = document.getElementById('ob-overlay');
        if (nowOverlay) attachOverlayObserver(nowOverlay);
      });
      observer.observe(document.body, { childList: true });
    }
    queueRefresh();
  }

  window[MODULE_ID] = {
    status,
    refresh: refreshPlacement,
  };
  window.HOBUNJI_ONBOARDING_SWITCHBOX_PLACEMENT_STATUS = status;

  if (document.body) install();
  else document.addEventListener('DOMContentLoaded', install, { once: true });
})();
