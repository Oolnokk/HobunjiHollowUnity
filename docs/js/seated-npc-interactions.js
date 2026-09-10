// Seated control scheme: what Action 1/2/3 do while the player is sitting in
// furniture (see game.js's sitInteraction), plus the small radial-adjacent
// popup Action 1's hold opens once a nearby NPC is in view.
//
//   Dodge       Stand up (game.js's performContextAction — cancels this
//               wheel first if it's open, otherwise ends the seat).
//   A1 tap      Talk to whoever the seated free-look camera is aimed at
//               (game.js's seatedFocusWalker — genuinely camera/reticle
//               based, not the standing nearbyNpcWalker proximity check).
//   A1 hold     Locks that focus and opens this module's popup with every
//               currently-applicable interaction for them.
//   A2          The best contextual shortcut for the current focus (Call
//               Over / Ask to Sit With Me), or nothing if none applies.
//   A3          Wait (game.js's calendar_wait action → CalendarSystem).
//
// "Same table" (needed for Offer Drink) is resolved in game.js — see its
// playerSeatTable/npcSeatTable/isNpcAtPlayersTable — since it has to walk
// interiorFurnitureObjects and the NPC station registry, both private to
// that closure. This module only consumes the yes/no answer.
//
// Call Over / Ask to Sit With Me are real invitations through the NPC
// Activity Planner's free-time opportunity scoring (deps.inviteNpcOver/
// inviteNpcToSeat — see npc-activity-planner.js's pendingPlayerInvitations),
// the same "propose, and the invited NPC's own next planner tick decides"
// mechanism already used for NPC-to-NPC chat invites. An NPC only actually
// comes if their own scoring picks it as the best thing to do right now —
// an obligated NPC can (and should) just not show up, and an unanswered
// invitation expires on its own. This is deliberately not a forced
// walker.currentScheduleTarget override, which has no supported "temporarily
// override, then restore" hook and would fight the planner's own replanning
// every tick.
(() => {
  'use strict';

  if (window.SeatedSocialInteractions?.installed) return;

  let deps = null;
  const state = { open: false, focusWalker: null, lock: null };
  let overlay = null;

  function npcDisplayName(walker) {
    return walker?.rec?.name || walker?.rec?.displayName || 'them';
  }

  function log(message, level) {
    deps?.log?.(`[seated-social] ${message}`, level);
  }

  // ── Action bar (Action 1/2/3 while seated) ──────────────────────────
  function talkButton(walker) {
    return {
      icon: '💬',
      label: walker ? `Talk: ${npcDisplayName(walker)}` : 'Talk',
      action: 'seated_talk',
      style: 'primary',
      allowed: true, // A miss (no one in view) shows a toast instead of disabling the tap.
    };
  }

  function contextualButton(walker) {
    if (!walker || deps?.isNpcBlackedOut?.(walker.rec?.id) || deps?.isNpcAtPlayersTable?.(walker)) return null;
    if (deps?.hasEmptySeatAtPlayersTable?.()) {
      return { icon: '🪑', label: 'Ask to Sit With Me', action: 'seated_ask_to_sit', style: 'secondary', allowed: true };
    }
    return { icon: '👋', label: 'Call Over', action: 'seated_call_over', style: 'secondary', allowed: true };
  }

  function waitButton() {
    return { icon: '⏳', label: 'Wait', action: 'calendar_wait', style: 'secondary', allowed: true };
  }

  function computeActionButtons() {
    const walker = deps?.getFocusedWalker?.();
    const btns = [talkButton(walker)];
    const contextual = contextualButton(walker);
    if (contextual) btns.push(contextual);
    btns.push(waitButton());
    return btns;
  }

  // ── Action 1/2/3 tap dispatch ────────────────────────────────────────
  function talkToFocusedNpc() {
    const walker = deps?.getFocusedWalker?.();
    if (!walker) { deps?.showToast?.('No one nearby to talk to.', false); return; }
    if (deps?.isNpcBlackedOut?.(walker.rec?.id)) { deps?.showToast?.(`${npcDisplayName(walker)} is passed out.`, false); return; }
    deps?.openNpcDialogue?.(walker);
  }

  function dispatchAction(action) {
    if (action === 'seated_talk') { talkToFocusedNpc(); return; }
    if (action === 'calendar_wait') { window.CalendarSystem?.openTimePassage?.('wait'); return; }
    if (action === 'seated_call_over') { const w = deps?.getFocusedWalker?.(); if (w) callOver(w); return; }
    if (action === 'seated_ask_to_sit') { const w = deps?.getFocusedWalker?.(); if (w) askToSitWithMe(w); return; }
  }

  // ── Wheel sector actions ─────────────────────────────────────────────
  function talk(walker) {
    close();
    deps?.openNpcDialogue?.(walker);
  }

  function callOver(walker) {
    close();
    deps?.recordNpcMemory?.(walker.rec?.id, 'called-over');
    const invited = !!deps?.inviteNpcOver?.(walker);
    deps?.showToast?.(invited
      ? `You wave ${npcDisplayName(walker)} over.`
      : `${npcDisplayName(walker)} doesn't seem to notice.`, invited);
  }

  function askToSitWithMe(walker) {
    close();
    deps?.recordNpcMemory?.(walker.rec?.id, 'asked-to-sit');
    const invited = !!deps?.inviteNpcToSeat?.(walker);
    deps?.showToast?.(invited
      ? `You ask ${npcDisplayName(walker)} to join you.`
      : 'There\'s no open seat at your table right now.', invited);
  }

  function offerDrink(walker, itemKey) {
    const offered = !!deps?.offerDrinkToNpc?.(walker, itemKey);
    close();
    if (!offered) deps?.showToast?.('Nothing to offer.', false);
  }

  function buildSectors(walker) {
    if (!walker) return [];
    if (deps?.isNpcBlackedOut?.(walker.rec?.id)) return [];
    const sectors = [{ id: 'talk', icon: '💬', label: `Talk to ${npcDisplayName(walker)}`, onSelect: () => talk(walker) }];
    if (deps?.isNpcAtPlayersTable?.(walker)) {
      for (const drink of deps?.findAvailableDrinkBottles?.() || []) {
        sectors.push({
          id: `offer_drink_${drink.key}`,
          icon: drink.def?.icon || '🍷',
          label: `Offer ${drink.def?.label || drink.key} (${drink.status.remaining}/${drink.status.total})`,
          onSelect: () => offerDrink(walker, drink.key),
        });
      }
    } else {
      sectors.push({ id: 'call_over', icon: '👋', label: `Call ${npcDisplayName(walker)} Over`, onSelect: () => callOver(walker) });
      if (deps?.hasEmptySeatAtPlayersTable?.()) {
        sectors.push({ id: 'ask_to_sit', icon: '🪑', label: 'Ask to Sit With Me', onSelect: () => askToSitWithMe(walker) });
      }
    }
    return sectors;
  }

  // ── Overlay UI ───────────────────────────────────────────────────────
  function ensureUi() {
    if (overlay) return;
    if (!document.getElementById('seatedNpcWheelStyles')) {
      const style = document.createElement('style');
      style.id = 'seatedNpcWheelStyles';
      style.textContent = `
#seatedNpcWheelOverlay{position:fixed;inset:0;z-index:12040;background:rgba(0,0,0,.35);display:none;align-items:flex-end;justify-content:center;padding-bottom:14vh;touch-action:none}
#seatedNpcWheelOverlay.open{display:flex}
#seatedNpcWheelPanel{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:14px;background:var(--glass);border:2px solid var(--border-bright);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);min-width:220px;max-width:86vw}
#seatedNpcWheelPanel .seated-wheel-title{color:var(--muted);font:600 11px/1.2 "Pixelify Sans",system-ui,sans-serif;text-transform:uppercase;letter-spacing:.05em;text-align:center;margin-bottom:2px}
.seated-wheel-option{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;border:2px solid var(--border-bright);background:var(--glass-2);color:var(--text);font:600 13px/1.2 "Pixelify Sans",system-ui,sans-serif;cursor:pointer}
.seated-wheel-option .seated-wheel-icon{font-size:1.3em}
.seated-wheel-option:active{background:rgba(249,226,138,.18)}
.seated-wheel-cancel{text-align:center;color:var(--muted);font:11px/1.3 "DM Mono",monospace;margin-top:2px}
`;
      document.head.appendChild(style);
    }

    overlay = document.createElement('div');
    overlay.id = 'seatedNpcWheelOverlay';
    overlay.setAttribute('aria-hidden', 'true');
    const panel = document.createElement('div');
    panel.id = 'seatedNpcWheelPanel';
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener('pointerdown', event => {
      if (event.target === overlay) cancel(); // Tapping outside the panel cancels, same as Dodge.
    });
  }

  function showOverlay(sectors) {
    ensureUi();
    const panel = document.getElementById('seatedNpcWheelPanel');
    panel.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'seated-wheel-title';
    title.textContent = npcDisplayName(state.focusWalker);
    panel.appendChild(title);
    for (const sector of sectors) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'seated-wheel-option';
      button.innerHTML = `<span class="seated-wheel-icon">${sector.icon}</span><span>${sector.label}</span>`;
      button.addEventListener('pointerup', event => {
        event.preventDefault();
        event.stopPropagation();
        sector.onSelect?.();
      });
      panel.appendChild(button);
    }
    const cancelHint = document.createElement('div');
    cancelHint.className = 'seated-wheel-cancel';
    cancelHint.textContent = 'Dodge to cancel';
    panel.appendChild(cancelHint);
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function hideOverlay() {
    overlay?.classList.remove('open');
    overlay?.setAttribute('aria-hidden', 'true');
  }

  // ── Open/close lifecycle ─────────────────────────────────────────────
  function close() {
    if (!state.open) return false;
    state.open = false;
    state.focusWalker = null;
    state.lock?.release?.();
    state.lock = null;
    hideOverlay();
    deps?.refreshActionBar?.();
    return true;
  }

  function cancel() {
    return close();
  }

  function isOpen() {
    return state.open;
  }

  function openWheel() {
    if (state.open) return true;
    if (!deps?.isSeatedActive?.()) return false;
    const walker = deps?.getFocusedWalker?.();
    if (!walker) { deps?.showToast?.('No one nearby to talk to.', false); return false; }
    const sectors = buildSectors(walker);
    if (!sectors.length) { deps?.showToast?.('Nothing to do here right now.', false); return false; }
    state.open = true;
    state.focusWalker = walker; // "Lock focus" — frozen for the wheel's duration even if the camera drifts while it's open.
    state.lock = deps?.actionLocks?.acquire?.({
      owner: 'seated-npc-interaction-wheel',
      reason: `Choosing an action for ${npcDisplayName(walker)}`,
      participants: [{ id: deps?.playerParticipantId || 'player', channels: ['movement', 'tools', 'actions'] }],
    }) || null;
    showOverlay(sectors);
    log(`opened for npc=${walker.rec?.id || 'unknown'} with ${sectors.length} option(s)`);
    return true;
  }

  function init(injectedDeps) {
    deps = injectedDeps || null;
    return api;
  }

  const api = Object.freeze({
    installed: true,
    init,
    isOpen,
    openWheel,
    cancel,
    dispatchAction,
    computeActionButtons,
    getDebug: () => ({ open: state.open, focusNpcId: state.focusWalker?.rec?.id || null }),
  });
  window.SeatedSocialInteractions = api;
})();
