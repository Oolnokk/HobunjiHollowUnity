// Screen-fixed readout of recently acquired items, currency, and XP.
// WorldPopupText sends gains here only after their world-space rows finish.
(() => {
  'use strict';

  const ROOT_ID = 'rewardReadout'; // Used to keep one left-edge HUD container across reward bursts.
  const MAX_VISIBLE = 5; // Used by drain to reserve exactly five readable rows.
  const READ_MS = 9000; // Used for each row's minimum on-screen reading time.
  const GAIN_KINDS = new Set(['loot', 'currency', 'skillXp', 'masteryXp']); // Limits the readout to acquisitions and experience.
  const COLORS = { loot: '#ffffff', currency: '#ffe181', skillXp: '#9de7ff', masteryXp: '#78cfff' }; // Used when the world-popup color settings are unavailable.
  const queued = []; // FIFO reward groups waiting for one of the five visible slots.
  const visible = []; // Active entries with their own expiration deadlines and DOM rows.
  let pendingCount = 0; // Total waiting reward events, including coalesced duplicates.
  let timer = null; // Single deadline timer for the earliest visible row.
  let pausedAt = null; // Wall-clock instant used to preserve reading time while the tab is hidden.
  let root = null; // HUD container created lazily after the document body is available.
  let rows = null; // Five-row list within the HUD container.
  let waitingLabel = null; // Header counter showing rewards still waiting to be read.
  let listeningForVisibility = false; // Avoids installing duplicate visibility listeners.
  let awaitingBody = false; // A pre-DOM reward schedules exactly one retry on page readiness.

  function ensureDom() {
    if (typeof document === 'undefined') return false;
    if (!document.body) {
      if (!awaitingBody && typeof document.addEventListener === 'function') {
        awaitingBody = true;
        document.addEventListener('DOMContentLoaded', () => { awaitingBody = false; drain(); }, { once: true });
      }
      return false;
    }
    if (root?.isConnected) return true;
    if (root) {
      document.body.appendChild(root); // Restore the same five readable rows if the game rebuilds its HUD.
      return true;
    }
    root = document.createElement('aside');
    root.id = ROOT_ID;
    root.hidden = true;
    root.setAttribute('aria-label', 'Recently found items and experience');
    const heading = document.createElement('div'); // Labels the readout without counting as one of its five reward rows.
    heading.className = 'reward-readout-heading';
    heading.textContent = 'Found';
    waitingLabel = document.createElement('span'); // Displays queued overflow without replacing a readable row.
    waitingLabel.className = 'reward-readout-waiting';
    heading.appendChild(waitingLabel);
    rows = document.createElement('div'); // Screen-reader log contains only the rewards themselves.
    rows.className = 'reward-readout-rows';
    rows.setAttribute('role', 'log');
    rows.setAttribute('aria-label', 'Recent rewards');
    rows.setAttribute('aria-live', 'polite');
    rows.setAttribute('aria-relevant', 'additions');
    root.append(heading, rows);
    document.body.appendChild(root);
    if (!listeningForVisibility) {
      document.addEventListener('visibilitychange', onVisibilityChange);
      listeningForVisibility = true;
    }
    return true;
  }

  function showWaitingCount() {
    waitingLabel.textContent = pendingCount ? pendingCount + ' waiting' : '';
    root.hidden = visible.length === 0;
  }

  function showEntry(entry, now) {
    const el = document.createElement('div'); // DOM row stays mounted until its own deadline so new entries do not restart screen-reader announcements.
    el.className = 'reward-readout-row';
    el.textContent = entry.text + (entry.count > 1 ? ' ×' + entry.count : '');
    el.style.color = entry.color || COLORS[entry.kind] || '#ffffff';
    rows.appendChild(el);
    visible.push({ ...entry, element: el, expiresAt: now + READ_MS });
  }

  function schedule() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!visible.length || pausedAt !== null) return;
    const nextExpiration = Math.min(...visible.map(entry => entry.expiresAt)); // Earliest individual row deadline drives the shared timer.
    timer = setTimeout(drain, Math.max(1, nextExpiration - Date.now()));
  }

  function drain() {
    if (!ensureDom()) return;
    if (typeof document !== 'undefined' && document.hidden) {
      if (pausedAt === null) pausedAt = Date.now();
      if (timer !== null) clearTimeout(timer);
      timer = null;
      return;
    }
    const now = Date.now(); // One timestamp for expiration and admission prevents a burst from shrinking later rows' reading time.
    for (let i = visible.length - 1; i >= 0; i--) {
      if (visible[i].expiresAt > now) continue;
      visible[i].element.remove();
      visible.splice(i, 1);
    }
    while (visible.length < MAX_VISIBLE && queued.length) {
      const entry = queued.shift();
      pendingCount -= entry.count;
      showEntry(entry, now);
    }
    showWaitingCount();
    schedule();
  }

  function onVisibilityChange() {
    if (document.hidden) {
      if (pausedAt === null) pausedAt = Date.now();
      if (timer !== null) clearTimeout(timer);
      timer = null;
      return;
    }
    if (pausedAt !== null) {
      const hiddenDuration = Math.max(0, Date.now() - pausedAt); // Hidden time does not count toward the promised reading interval.
      for (const entry of visible) entry.expiresAt += hiddenDuration;
      pausedAt = null;
    }
    drain();
  }

  function enqueue(kind, text, options = {}) {
    const message = String(text ?? '').trim(); // Retains the exact existing floating-list copy.
    if (!GAIN_KINDS.has(kind) || !message || /^[-−]/.test(message)) return false;
    const last = queued[queued.length - 1]; // Adjacent duplicate gains share a waiting slot without losing their quantity.
    if (last && last.kind === kind && last.text === message) last.count++;
    else queued.push({ kind, text: message, color: options.color, count: 1 });
    pendingCount++;
    drain();
    return true;
  }

  function clear() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    queued.length = 0;
    pendingCount = 0;
    visible.splice(0).forEach(entry => entry.element.remove());
    pausedAt = null;
    if (root) root.hidden = true;
    if (waitingLabel) waitingLabel.textContent = '';
  }

  function debugSnapshot() {
    const now = Date.now(); // Mobile debug surfaces can show remaining hold time without a console.
    return {
      latestChange: 'Acquired items and XP move from the world popup to a five-row timed left-screen reading queue.',
      maxVisible: MAX_VISIBLE, readMs: READ_MS,
      visible: visible.map(entry => ({ kind: entry.kind, text: entry.text, count: entry.count, remainingMs: Math.max(0, entry.expiresAt - now) })),
      waiting: pendingCount, waitingGroups: queued.length, paused: pausedAt !== null,
    };
  }

  window.RewardReadout = Object.freeze({ enqueue, clear, debugSnapshot });
})();
