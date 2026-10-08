// Hold-Action-1 NPC command wheel.
//
// Facing an NPC, Action 1 is "Talk". A tap still talks exactly as before; a
// hold opens a radial wheel of commands for that NPC (Ask on a Date, and on
// a date: Follow / Wait / Dismiss / Propose — options come from
// RomanceSystem.commandOptionsFor). The physical press is owned through
// WorldActionInputClaims, so touch, mouse, keyboard and controller all share
// one tap/hold path without game.js learning about the wheel.
//
// Selecting: drag (touch/mouse) or tilt the left stick toward a slice and
// release. Releasing with nothing highlighted leaves the wheel open so a
// slice can be tapped/clicked, or confirmed with Action 1. Dodge / Escape /
// tapping the middle closes it.
(() => {
  'use strict';
  if (window.NpcCommandWheel) return;

  const OWNER_ID = 'npc-command-wheel';
  const HOLD_MS = 320; // Press length that turns a Talk tap into the wheel.
  const POLL_MS = 100; // Claim refresh cadence: cheap reads only, claims rewritten only on change.
  const PRESS_GUARD_MS = 260; // Ignores the stray Action 1 press a click on the wheel itself can produce.
  const RADIUS_PX = 170;

  let deps = null;
  let claimedWalker = null;
  let claimSignature = null; // null forces the next syncClaims to re-evaluate; '' means "no NPC claimed".
  let press = null; // { walker, at, timer }
  let wheelState = null; // { walker, options, selected, latched, center }
  let overlay = null, wheelEl = null, centerEl = null;
  let lastCloseAt = 0;
  let lock = null;
  const debug = { lastOpen: null, lastCommit: null, lastTap: null };

  function nowMs() { return performance.now(); }

  // ── Claims ────────────────────────────────────────────────────────────
  function optionsFor(walker) {
    try { return window.RomanceSystem?.commandOptionsFor?.(walker) || []; } catch (_) { return []; }
  }
  function eligibleWalker() {
    if (!deps) return null;
    if (deps.isDialogueOpen?.() || deps.isMenuOpen?.() || deps.isFarmEditMode?.()) return null;
    const walker = deps.getNearbyNpcWalker?.();
    if (!walker || walker.isPorakanekiHunter || walker._doorstepVisitor || walker._slagothimTrader) return null;
    return optionsFor(walker).length ? walker : null;
  }
  function syncClaims() {
    if (wheelState || press) return; // Keep the claim stable for the life of a press / open wheel.
    const walker = eligibleWalker();
    const signature = walker ? String(walker.rec?.id || '') : '';
    if (signature === claimSignature) return;
    claimSignature = signature;
    claimedWalker = walker;
    const registry = window.WorldActionInputClaims;
    if (!registry) return;
    if (!walker) { registry.clearClaims(OWNER_ID); return; }
    const claim = actionId => ({ actionId, label: `Talk / Commands: ${walker.rec?.name || 'NPC'}`, priority: 500, onPress: detail => onPress(detail), onRelease: detail => onRelease(detail) });
    registry.setClaims(OWNER_ID, [claim('action1'), claim('interact')]);
  }

  function onPress() {
    if (wheelState) { commit(); return; }
    if (nowMs() - lastCloseAt < PRESS_GUARD_MS) return;
    const walker = claimedWalker;
    if (!walker) return;
    clearTimeout(press?.timer);
    press = { walker, at: nowMs(), timer: setTimeout(() => { if (press?.walker === walker) openWheel(walker, false); }, HOLD_MS) };
  }
  function onRelease(detail) {
    const active = press;
    press = null;
    if (active) clearTimeout(active.timer);
    if (detail?.canceled) { if (wheelState && !wheelState.latched) closeWheel(); return; }
    if (wheelState) {
      if (wheelState.selected >= 0) commit();
      else wheelState.latched = true;
      return;
    }
    if (!active?.walker) return;
    debug.lastTap = { npcId: active.walker.rec?.id || null, at: Date.now() };
    deps?.openNpcDialogue?.(active.walker); // A tap is the original Talk.
  }

  // ── Wheel UI ──────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('npcCommandWheelStyles')) return;
    const style = document.createElement('style');
    style.id = 'npcCommandWheelStyles';
    style.textContent = `
#npcCommandOverlay{position:fixed;inset:0;z-index:12060;background:rgba(0,0,0,.24);display:none;touch-action:none;user-select:none}
#npcCommandOverlay.open{display:block}
#npcCommandWheel{position:absolute;left:50%;top:50%;width:min(${RADIUS_PX * 2}px,78vmin);height:min(${RADIUS_PX * 2}px,78vmin);transform:translate(-50%,-50%);border-radius:50%;overflow:hidden;background:rgba(20,10,16,.9);box-shadow:0 0 0 2px rgba(255,190,214,.32),0 18px 70px rgba(0,0,0,.68)}
#npcCommandWheel .socialActionSector{position:absolute;inset:0;border:0;padding:0;background:rgba(255,255,255,.045);pointer-events:none}
#npcCommandWheel .socialActionSector.active{background:rgba(255,120,160,.32)}
#npcCommandWheel .socialActionSector.current .socialActionLabel{color:#ffd1df}
#npcCommandWheel .socialActionSector.muted .socialActionLabel{opacity:.5}
#npcCommandWheel .socialActionLabel{position:absolute;left:50%;top:50%;width:104px;text-align:center;color:#fff;font:700 12px/1.12 "Pixelify Sans",system-ui,sans-serif;text-shadow:0 2px 4px #000}
#npcCommandWheel .socialActionIcon{display:block;font-size:24px;line-height:1;margin-bottom:5px}
#npcCommandWheelCenter{position:absolute;left:50%;top:50%;width:34%;height:34%;transform:translate(-50%,-50%);border-radius:50%;display:grid;place-items:center;text-align:center;padding:10px;box-sizing:border-box;background:rgba(10,4,8,.96);box-shadow:0 0 0 2px rgba(255,190,214,.24);color:#fff;font:700 12px/1.2 "Pixelify Sans",system-ui,sans-serif;pointer-events:none}
`;
    document.head.appendChild(style);
  }
  function sectorPolygon(index, count) {
    const step = 360 / count;
    const start = -90 + index * step - step / 2;
    const points = ['50% 50%'];
    for (let i = 0; i <= 8; i++) {
      const angle = (start + step * (i / 8)) * Math.PI / 180;
      points.push(`${(50 + Math.cos(angle) * 50).toFixed(3)}% ${(50 + Math.sin(angle) * 50).toFixed(3)}%`);
    }
    return `polygon(${points.join(',')})`;
  }
  function buildOverlay() {
    if (overlay) return;
    injectStyles();
    overlay = document.createElement('div');
    overlay.id = 'npcCommandOverlay';
    overlay.setAttribute('aria-hidden', 'true');
    wheelEl = document.createElement('div');
    wheelEl.id = 'npcCommandWheel';
    wheelEl.setAttribute('role', 'menu');
    centerEl = document.createElement('div');
    centerEl.id = 'npcCommandWheelCenter';
    overlay.appendChild(wheelEl);
    document.body.appendChild(overlay);
    overlay.addEventListener('pointerdown', event => {
      if (!wheelState) return;
      event.preventDefault();
      event.stopPropagation();
      selectFromPoint(event.clientX, event.clientY);
      if (!wheelState.latched) return;
      if (wheelState.selected >= 0) commit(); else closeWheel();
    });
  }
  function renderWheel() {
    const { options, walker } = wheelState;
    wheelEl.textContent = '';
    const rect = wheelEl.getBoundingClientRect();
    const radius = Math.min(RADIUS_PX, (rect.width || RADIUS_PX * 2) / 2);
    options.forEach((option, index) => {
      const sector = document.createElement('div');
      sector.className = 'socialActionSector' + (option.active ? ' current' : '') + (option.muted ? ' muted' : '');
      sector.style.clipPath = sectorPolygon(index, options.length);
      const angle = -Math.PI / 2 + index * (Math.PI * 2 / options.length);
      const label = document.createElement('span');
      label.className = 'socialActionLabel';
      label.style.transform = `translate(-50%,-50%) translate(${Math.cos(angle) * radius * 0.64}px,${Math.sin(angle) * radius * 0.64}px)`;
      const icon = document.createElement('span');
      icon.className = 'socialActionIcon';
      icon.textContent = option.icon || '•';
      label.append(icon, document.createTextNode(option.label || option.id));
      sector.appendChild(label);
      wheelEl.appendChild(sector);
    });
    centerEl.textContent = walker.rec?.name || 'Commands';
    wheelEl.appendChild(centerEl);
  }
  function setSelected(index) {
    if (!wheelState) return;
    const next = Number.isInteger(index) && index >= 0 && index < wheelState.options.length ? index : -1;
    if (next === wheelState.selected) return;
    wheelState.selected = next;
    wheelEl.querySelectorAll('.socialActionSector').forEach((sector, i) => sector.classList.toggle('active', i === next));
    centerEl.textContent = next >= 0 ? wheelState.options[next].label : (wheelState.walker.rec?.name || 'Commands');
  }
  function selectFromVector(x, y, deadzone = 0.3) {
    if (Math.hypot(x, y) < deadzone) { setSelected(-1); return; }
    const count = wheelState.options.length;
    const normalized = (Math.atan2(y, x) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    setSelected(Math.round(normalized / (Math.PI * 2 / count)) % count);
  }
  function selectFromPoint(clientX, clientY) {
    const center = wheelState?.center;
    if (!center) return;
    const dx = clientX - center.x, dy = clientY - center.y;
    if (Math.hypot(dx, dy) < center.radius * 0.34) { setSelected(-1); return; }
    selectFromVector(dx / center.radius, dy / center.radius, 0);
  }
  function onWindowPointerMove(event) {
    if (!wheelState) return;
    selectFromPoint(event.clientX, event.clientY); // Pointer capture on the held touch button still bubbles here, so drag-to-select works mid-hold.
  }
  function onKeyDown(event) {
    if (!wheelState) return;
    if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeWheel(); return; }
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= wheelState.options.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setSelected(digit - 1);
      commit();
    }
  }
  function pollController(frame) {
    if (!wheelState || !frame?.pad) return;
    const x = Number(frame.pad.axes?.[0]) || 0, y = Number(frame.pad.axes?.[1]) || 0;
    if (Math.hypot(x, y) > 0.3) selectFromVector(x, y);
    const dodge = window.InputBindings?.getCurrentBindings?.()?.controller?.dodge || 'Button1';
    if (frame.isDown?.(dodge)) closeWheel();
  }

  function openWheel(walker, latched) {
    const options = optionsFor(walker);
    if (!options.length) return false;
    buildOverlay();
    wheelState = { walker, options, selected: -1, latched: !!latched, center: null };
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    renderWheel();
    const rect = wheelEl.getBoundingClientRect();
    wheelState.center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: rect.width / 2 };
    if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (_) {} }
    lock?.release?.();
    lock = window.CharacterActionLocks?.acquire?.({ owner: OWNER_ID, reason: 'Choosing an NPC command', participants: [{ id: 'player', channels: ['movement', 'tools', 'actions'] }] }) || null;
    debug.lastOpen = { npcId: walker.rec?.id || null, options: options.map(o => o.id), at: Date.now() };
    return true;
  }
  function closeWheel() {
    if (!wheelState) return false;
    wheelState = null;
    lastCloseAt = nowMs();
    overlay?.classList.remove('open');
    overlay?.setAttribute('aria-hidden', 'true');
    lock?.release?.();
    lock = null;
    claimSignature = null; // Re-evaluate options/claims after whatever the command changed.
    return true;
  }
  function commit() {
    const current = wheelState;
    if (!current) return false;
    const option = current.selected >= 0 ? current.options[current.selected] : null;
    closeWheel();
    if (!option) return false;
    debug.lastCommit = { npcId: current.walker.rec?.id || null, option: option.id, at: Date.now() };
    try { option.run?.(); } catch (error) { console.warn('[NpcCommandWheel] command failed', option.id, error); }
    return true;
  }

  function init(injected) {
    deps = injected || {};
    window.addEventListener('pointermove', onWindowPointerMove, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', () => { if (wheelState && !wheelState.latched) closeWheel(); });
    window.ControllerInput?.subscribe?.(OWNER_ID, pollController, window.ControllerInput?.PRIORITY?.socialWheel);
    setInterval(syncClaims, POLL_MS);
    return api;
  }

  const api = {
    init,
    open: walker => openWheel(walker || claimedWalker, true),
    close: closeWheel,
    commit,
    select: setSelected,
    isOpen: () => !!wheelState,
    snapshot: () => ({
      claimedNpcId: claimedWalker?.rec?.id || null,
      pressed: !!press,
      open: !!wheelState,
      latched: !!wheelState?.latched,
      options: wheelState ? wheelState.options.map(o => o.id) : null,
      selected: wheelState?.selected ?? -1,
      ...debug,
    }),
    _test: { syncClaims, onPress, onRelease, HOLD_MS },
  };
  window.NpcCommandWheel = api;
})();
