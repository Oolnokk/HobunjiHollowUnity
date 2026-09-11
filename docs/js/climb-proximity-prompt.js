// Contextual climb affordance for every target owned by ClimbSystem.
// Uses the existing climb target/action APIs so plateau, branch, and structural-roof rules cannot drift from the prompt.
(() => {
  'use strict';

  if (window.HobunjiClimbPrompt) return;

  const POLL_MS = 100; // Used to keep structural-roof scene scans responsive without doing them every render frame.
  const ACTION_ID = 'dodge'; // Used because the existing climb action is entered through the dodge/climb input path.
  const PROMPT_ID = 'climbProximityPrompt';
  const STYLE_ID = 'climbProximityPromptStyle';

  let currentTarget = null; // Used by the touch/click handler so it executes the same target currently being advertised.
  let lastDebug = { visible: false, targetType: null, verb: null, glyph: null, reason: 'waiting for climb target' };

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PROMPT_ID} {
        position: fixed;
        left: 50%;
        bottom: max(110px, 15vh);
        transform: translateX(-50%);
        z-index: 65;
        display: none;
        align-items: center;
        justify-content: center;
        min-width: 150px;
        max-width: min(82vw, 360px);
        padding: 9px 14px;
        border: 1px solid rgba(255,255,255,.28);
        border-radius: 10px;
        background: rgba(10,14,16,.88);
        color: #fff;
        font: 600 14px/1.2 system-ui, sans-serif;
        text-align: center;
        box-shadow: 0 3px 14px rgba(0,0,0,.32);
        backdrop-filter: blur(3px);
        pointer-events: auto;
        touch-action: manipulation;
        user-select: none;
      }
      #${PROMPT_ID}.open { display: flex; }
    `;
    document.head.appendChild(style);
  }

  function ensurePrompt() {
    let el = document.getElementById(PROMPT_ID);
    if (el) return el;
    ensureStyle();
    el = document.createElement('button');
    el.id = PROMPT_ID;
    el.type = 'button';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Climb');
    el.addEventListener('pointerup', event => {
      event.preventDefault();
      event.stopPropagation();
      activateCurrentTarget();
    });
    document.body.appendChild(el);
    return el;
  }

  function uiBlocksPrompt() {
    return !!(window.PlayerChat?.isOpen
      || document.getElementById('npcDialogue')?.classList?.contains('open')
      || document.getElementById('menuPanel')?.classList?.contains('open'));
  }

  function targetVerb(target) {
    if (target?.type === 'roof') return 'Climb Building';
    if (target?.type === 'wall') return 'Climb Plateau';
    if (target?.type === 'branchJumpDown') return 'Jump Down';
    return 'Climb';
  }

  function currentGlyph() {
    try {
      return window.ActionPromptUI?.actionPromptGlyph?.(ACTION_ID, '🧗') || 'Climb';
    } catch (_) {
      return 'Climb';
    }
  }

  function mountedTargetUnavailable(target) {
    const rideState = window.ClimbSystem?.debug?.mountRideState || 'none';
    if (rideState === 'none') return false;
    // Wall targets intentionally remain available because mounted plateau climbs
    // delegate to Mounts.startClimbLeap. Branches and roofs still require dismounting.
    return target?.type !== 'wall';
  }

  function hide(reason = 'no climb target') {
    currentTarget = null;
    const el = document.getElementById(PROMPT_ID);
    el?.classList?.remove('open');
    lastDebug = { visible: false, targetType: null, verb: null, glyph: null, reason };
  }

  function refresh() {
    const system = window.ClimbSystem;
    const player = window.Combat?.deps?.player;
    if (!system?.getClimbTarget || !system?.startClimb) return hide('ClimbSystem unavailable');
    if (uiBlocksPrompt()) return hide('UI blocks world prompts');
    if (player?._hobunjiFallState || player?.climbing || player?.prone || player?.dodging || player?.lunging) {
      return hide('player is in another movement state');
    }

    let target = null;
    try { target = system.getClimbTarget(); }
    catch (error) { return hide(`target error: ${error?.message || error}`); }
    if (!target) return hide('no climb target');
    if (mountedTargetUnavailable(target)) return hide('target requires dismounting');

    const el = ensurePrompt();
    const glyph = currentGlyph();
    const verb = targetVerb(target);
    const touch = window.ActionPromptUI?.getLastInputDevice?.() === 'touch';
    el.textContent = touch ? `${glyph} ${verb}` : `[${glyph}] ${verb}`;
    el.dataset.targetType = target.type || 'climb';
    el.setAttribute('aria-label', verb);
    el.classList.add('open');
    currentTarget = target;
    lastDebug = { visible: true, targetType: target.type || null, verb, glyph, reason: 'climb target available' };
    return target;
  }

  function activateCurrentTarget() {
    const system = window.ClimbSystem;
    if (!system?.startClimb) return false;
    // Re-resolve on press so a prompt cannot execute stale geometry after the
    // player turns, a streamed chunk changes, or a building target disappears.
    const target = refresh();
    if (!target || mountedTargetUnavailable(target)) return false;
    const started = !!system.startClimb(target);
    if (started) hide('climb started');
    return started;
  }

  const pollId = typeof window.setInterval === 'function'
    ? window.setInterval(refresh, POLL_MS)
    : 0; // Used by getDebug to confirm that proximity prompting is actively polling.

  window.HobunjiClimbPrompt = Object.freeze({
    refresh,
    activateCurrentTarget,
    getDebug() { return { ...lastDebug, pollRunning: !!pollId, pollMs: POLL_MS, actionId: ACTION_ID }; },
  });
})();
