(() => {
  'use strict';

  // Co-op time HUD (js/time-consensus.js). One panel, three states, priority order:
  //   1. the local player is knocked out   -> "Out cold" + the revive-window countdown
  //   2. another player is knocked out     -> "<name> is down - revive them" + countdown
  //   3. the local player is resting       -> "Waiting for the others to sleep (n/m)"
  // It does nothing in single-player. The frame callback is only enabled while a vote or
  // knockout exists, and every DOM write is compared first (no idle MutationObserver churn).

  const SCHEDULER_ID = 'TimeConsensusHud';
  let els = null;
  let key = '';          // Last rendered state; identical frames write nothing.
  let registered = false;

  function build() {
    if (els || typeof document === 'undefined' || !document.body) return els;
    const root = document.createElement('div');
    root.id = 'timeConsensusHud';
    root.style.cssText = 'position:fixed;top:22%;left:var(--play-center,50%);transform:translateX(-50%);z-index:55;pointer-events:none;display:none;min-width:220px;max-width:calc(100vw - 24px);text-align:center;padding:8px 16px;border-radius:12px;background:rgba(14,12,28,.82);border:1px solid rgba(190,170,255,.45);color:#f2ecff;font:600 14px/1.35 system-ui,sans-serif;';
    const text = document.createElement('div');
    const track = document.createElement('div');
    track.style.cssText = 'margin-top:6px;height:6px;border-radius:3px;background:rgba(255,255,255,.18);overflow:hidden;';
    const fill = document.createElement('div');
    fill.style.cssText = 'height:100%;width:100%;background:#b9a4ff;';
    track.appendChild(fill);
    root.appendChild(text);
    root.appendChild(track);
    document.body.appendChild(root);
    els = { root, text, track, fill };
    return els;
  }

  const clock = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const nameOf = entity => entity?.name || entity?.displayName || 'A friend';

  // Pure: the panel's content for the current consensus state (or null to hide).
  function describe(snapshot, reg, windowMs) {
    if (!snapshot.length) return null;
    const local = reg?.getLocalPlayer();
    const localId = local ? reg.idOf(local) : null;
    const mine = snapshot.find(e => e.id === localId);
    if (mine?.type === 'knockout') {
      const secs = Math.ceil(mine.remainingMs / 1000);
      return { text: `Out cold — a friend has ${clock(secs)} to revive you, or time passes`, pct: Math.round(100 * mine.remainingMs / windowMs), danger: true };
    }
    const down = snapshot.filter(e => e.type === 'knockout' && e.id !== localId).sort((a, b) => a.remainingMs - b.remainingMs)[0];
    if (down) {
      const secs = Math.ceil(down.remainingMs / 1000);
      return { text: `${nameOf(reg.getById(down.id))} is down — revive them within ${clock(secs)}`, pct: Math.round(100 * down.remainingMs / windowMs), danger: true };
    }
    if (mine?.type === 'rest') {
      const resting = snapshot.filter(e => e.type === 'rest').length;
      return { text: `💤 Waiting for the others to sleep (${resting}/${reg.playerCount()})`, pct: null, danger: false };
    }
    return null;
  }

  function render() {
    const tc = window.TimeConsensus;
    const shown = tc ? describe(tc.snapshot(), window.ActorRegistry, tc.REVIVE_WINDOW_MS) : null;
    const nextKey = shown ? `${shown.text}|${shown.pct}|${shown.danger}` : '';
    if (nextKey === key) return;
    key = nextKey;
    const e = build();
    if (!e) return;
    if (!shown) { if (e.root.style.display !== 'none') e.root.style.display = 'none'; return; }
    if (e.root.style.display !== 'block') e.root.style.display = 'block';
    if (e.text.textContent !== shown.text) e.text.textContent = shown.text;
    const trackDisplay = shown.pct === null ? 'none' : 'block';
    if (e.track.style.display !== trackDisplay) e.track.style.display = trackDisplay;
    const width = (shown.pct ?? 0) + '%';
    if (e.fill.style.width !== width) e.fill.style.width = width;
    const color = shown.danger ? '#ff5a46' : '#b9a4ff';
    if (e.fill.style.background !== color) e.fill.style.background = color;
  }

  function setActive(active) { window.RuntimeFrameScheduler?.setEnabled?.(SCHEDULER_ID, active); }

  // The scheduler may load after this script, so it is registered on the first consensus event, not at load.
  function ensureRegistered() {
    if (registered || !window.RuntimeFrameScheduler?.register) return registered;
    registered = true;
    window.RuntimeFrameScheduler.register(SCHEDULER_ID, () => {
      render();
      if (!window.TimeConsensus.snapshot().length) setActive(false); // Nothing left to count down: stop ticking.
    }, { phase: 'post-game', owner: 'TimeConsensusHud', description: 'Revive-window countdown and "waiting for the others to sleep" panel.', enabled: false });
    return true;
  }

  function start() {
    window.TimeConsensus?.onEvent?.(() => { if (ensureRegistered()) setActive(true); });
  }

  window.TimeConsensusHud = { start, describe, render, SCHEDULER_ID };
  start();
})();
