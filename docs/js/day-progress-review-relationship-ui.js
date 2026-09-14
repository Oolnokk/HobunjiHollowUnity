(() => {
  'use strict';

  if (Number(window.DayProgressReviewRelationshipUi?.version) >= 1) return;

  const ROOT_ID = 'hobunjiDayProgressReview';
  const STYLE_ID = 'dayProgressReviewRelationshipUiStyles';
  let observer = null;
  let rootObserver = null;

  function liveWalkers() {
    const walkers = window.__hobunjiFurnitureDebug?.getNpcWalkers?.();
    return Array.isArray(walkers) ? walkers : [];
  }

  function walkerForName(name) {
    const normalized = String(name || '').trim().toLowerCase();
    if (!normalized) return null;
    return liveWalkers().find(walker => String(walker?.rec?.name || walker?.rec?.displayName || '').trim().toLowerCase() === normalized) || null;
  }

  function formatNumber(value) {
    const numeric = Math.round((Number(value) || 0) * 100) / 100;
    return Number.isInteger(numeric) ? String(numeric) : String(numeric).replace(/0+$/, '').replace(/\.$/, '');
  }

  function fractionLabel(hearts) {
    const value = Math.round((Number(hearts) || 0) * 100) / 100;
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    const abs = Math.abs(value);
    if (Math.abs(abs - 0.25) < 0.001) return `${sign}¼ heart`;
    if (Math.abs(abs - 0.5) < 0.001) return `${sign}½ heart`;
    if (Math.abs(abs - 0.75) < 0.001) return `${sign}¾ heart`;
    return `${sign}${formatNumber(abs)} heart${abs === 1 ? '' : 's'}`;
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} .day-review-card.relationship-avatar-ready{display:grid;grid-template-columns:58px minmax(0,1fr);gap:12px;align-items:start}
      #${ROOT_ID} .day-review-avatar{width:54px;height:54px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;border:1px solid rgba(230,207,157,.28);background:rgba(0,0,0,.28);font-size:24px;line-height:1;align-self:start}
      #${ROOT_ID} .day-review-avatar canvas{display:block;width:100%;height:100%;object-fit:contain}
      #${ROOT_ID} .day-review-card-body{min-width:0}
      #${ROOT_ID} .day-review-heart-equivalent{display:inline-block;margin-left:6px;font-size:11px;font-weight:400;opacity:.66;white-space:nowrap}
      #${ROOT_ID} .day-review-conversion .day-review-heart-equivalent{display:block;margin:2px 0 0;font-size:10px;text-align:center}
      @media(max-width:520px){#${ROOT_ID} .day-review-card.relationship-avatar-ready{grid-template-columns:48px minmax(0,1fr);gap:9px}#${ROOT_ID} .day-review-avatar{width:44px;height:44px}}
    `;
    document.head.appendChild(style);
  }

  function installAvatar(card) {
    if (!card || card.classList.contains('relationship-avatar-ready')) return;
    const person = card.querySelector('.day-review-person');
    const nameEl = person?.querySelector('strong');
    if (!person || !nameEl) return;

    const walker = walkerForName(nameEl.textContent);
    const body = document.createElement('div');
    body.className = 'day-review-card-body';
    while (card.firstChild) body.appendChild(card.firstChild);

    const avatar = document.createElement('div');
    avatar.className = 'day-review-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    const fallback = document.createElement('span');
    fallback.textContent = String(nameEl.textContent || '?').trim().charAt(0).toUpperCase() || '•';
    avatar.appendChild(fallback);

    card.append(avatar, body);
    card.classList.add('relationship-avatar-ready');
    if (walker?.rec?.id) card.dataset.dayReviewNpcId = String(walker.rec.id);

    if (!walker?.profile || !window.AmbientDialogue?.renderChatheadImage) return;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    window.AmbientDialogue.renderChatheadImage(canvas, walker.profile, { seatId: walker.rec?.id || nameEl.textContent })
      .then(ok => {
        if (!ok || !avatar.isConnected) return;
        avatar.replaceChildren(canvas);
      })
      .catch(() => {});
  }

  function exactFavorHeartDelta(card) {
    const npcId = card?.dataset?.dayReviewNpcId;
    if (!npcId) return null;
    const ledger = window.DayProgressReview?.debugSnapshot?.()?.ledger;
    const raw = Number(ledger?.relationships?.[npcId]?.favorDelta);
    return Number.isFinite(raw) ? raw : null;
  }

  function decorateFavorDelta(card) {
    const favor = card.querySelector('.day-review-deltas .day-review-favor');
    const valueEl = favor?.querySelector('b');
    if (!favor || !valueEl || favor.dataset.favorPointsDecorated === '1') return;
    const heartDelta = exactFavorHeartDelta(card);
    if (heartDelta == null || !heartDelta) return;
    const points = window.NpcFavorBalance?.heartsToFavorPoints?.(heartDelta);
    if (!Number.isFinite(Number(points))) return;
    const signed = Number(points) > 0 ? `+${formatNumber(points)}` : `−${formatNumber(Math.abs(points))}`;
    valueEl.textContent = signed;
    const equivalent = document.createElement('small');
    equivalent.className = 'day-review-heart-equivalent';
    equivalent.textContent = `(${fractionLabel(heartDelta)})`;
    favor.appendChild(equivalent);
    favor.dataset.favorPointsDecorated = '1';
  }

  function decorateRapportConversion(card) {
    const conversion = card.querySelector('.day-review-conversion');
    if (!conversion || conversion.dataset.favorPointsDecorated === '1') return;
    const rapportText = conversion.querySelector('.day-review-orb.day-review-rapport strong')?.textContent;
    const rapport = Number(String(rapportText || '').replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(rapport) || rapport <= 0) return;
    const rate = Number(window.SCRATCHBONES_CONFIG?.game?.socialRelationships?.rapportToFavorRate);
    const safeRate = Number.isFinite(rate) ? Math.max(0, rate) : 0.10;
    const favorPoints = Math.round(rapport * safeRate);
    const hearts = window.NpcFavorBalance?.favorPointsToHearts?.(favorPoints);
    if (!Number.isFinite(Number(hearts))) return;

    const favorOrb = conversion.querySelector('.day-review-orb.day-review-favor');
    if (favorOrb) {
      const equivalent = document.createElement('small');
      equivalent.className = 'day-review-heart-equivalent';
      equivalent.textContent = fractionLabel(hearts);
      favorOrb.appendChild(equivalent);
    }
    const formula = conversion.querySelector('.day-review-formula');
    if (formula) formula.textContent = `${formula.textContent} = ${fractionLabel(hearts)}`;
    conversion.dataset.favorPointsDecorated = '1';
  }

  function processRoot(root) {
    installStyles();
    for (const card of root.querySelectorAll('.day-review-card')) {
      installAvatar(card);
      decorateFavorDelta(card);
      decorateRapportConversion(card);
    }
  }

  function observeRoot(root) {
    if (!root || observer) return;
    processRoot(root);
    observer = new MutationObserver(() => processRoot(root));
    observer.observe(root, { childList: true, subtree: true });
  }

  function findOrObserveRoot() {
    const root = document.getElementById(ROOT_ID);
    if (root) {
      observeRoot(root);
      rootObserver?.disconnect();
      rootObserver = null;
      return true;
    }
    if (!rootObserver && typeof MutationObserver === 'function') {
      rootObserver = new MutationObserver(findOrObserveRoot);
      rootObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
    return false;
  }

  findOrObserveRoot();

  window.DayProgressReviewRelationshipUi = Object.freeze({
    version: 1,
    refresh: () => {
      const root = document.getElementById(ROOT_ID);
      if (root) processRoot(root);
    },
  });
})();