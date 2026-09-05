// Procedural Animation Editor: harden Ground / Rest controls against the
// preview canvas / overlay input stack. This file intentionally owns only UI
// input routing; pose math remains in procedural-limb-pose-author.js.
(function (global) {
  'use strict';

  const CANONICAL_SOURCE_STORAGE_KEY = 'hobunjiNpcPlaneAvatarRepoViewer.source.v1';

  // The editor itself reads hobunjiNpcPlaneAvatarRepoViewer.source.v1. Earlier
  // Ground/Carry builds accidentally pinned a similarly named extension-only
  // key, which let the adapter come from the GitHack commit while the avatar
  // runtime still came from an older saved revision. Correct the real editor
  // key here and reload once before installing the input bridge.
  function pinCanonicalEditorSource() {
    const pinned = global.HobunjiProceduralGroundCarryDiagnostics?.pinnedSource;
    if (!pinned?.owner || !pinned?.repo || !/^[0-9a-f]{40}$/i.test(String(pinned.ref || ''))) return 'none';
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(CANONICAL_SOURCE_STORAGE_KEY) || '{}') || {}; } catch (_) {}
    const ref = String(pinned.ref).toLowerCase();
    const changed = stored.owner !== pinned.owner || stored.repo !== pinned.repo || String(stored.ref || '').toLowerCase() !== ref;
    const next = {
      ...stored,
      owner: pinned.owner,
      repo: pinned.repo,
      ref,
      docsRoot: stored.docsRoot || 'docs/',
      dbPath: stored.dbPath || 'config/npcs/hobunji-starter-npc-database.json',
    };
    try { localStorage.setItem(CANONICAL_SOURCE_STORAGE_KEY, JSON.stringify(next)); }
    catch (error) {
      console.error('[Ground/Carry source pin] Could not persist canonical editor source.', error);
      return 'error';
    }
    global.__HOBUNJI_PINNED_EDITOR_SOURCE__ = Object.freeze({ owner: pinned.owner, repo: pinned.repo, ref });
    const reloadKey = `hobunji.proceduralAnimationEditor.canonicalPinReload.${ref}`;
    if (changed) {
      let alreadyReloaded = false;
      try { alreadyReloaded = sessionStorage.getItem(reloadKey) === '1'; } catch (_) {}
      if (!alreadyReloaded) {
        try { sessionStorage.setItem(reloadKey, '1'); } catch (_) {}
        console.info(`[Ground/Carry source pin] Corrected canonical editor source to ${ref.slice(0, 12)}; reloading once.`);
        window.location.reload();
        return 'reload';
      }
    } else {
      try { sessionStorage.removeItem(reloadKey); } catch (_) {}
    }
    return changed ? 'guarded' : 'ready';
  }

  const canonicalPinAction = pinCanonicalEditorSource();
  if (canonicalPinAction === 'reload') return;
  if (global.ProceduralGroundRestInputBridge?.installed) return;

  const PANEL_ID = 'proceduralGroundRestPanel';
  const BUTTON_ID = 'proceduralGroundRestQuickBtn';
  const STYLE_ID = 'proceduralGroundRestInputBridgeStyles';
  let pointerDispatchAt = 0;
  let inputCount = 0;
  let lastPose = null;
  const pendingEditorMessages = [];
  const forwardedWrapperLines = new Set();

  function editorLog(message, level = 'info', extra = null) {
    const logger = global.HobunjiGameplayBackdrop?.log;
    if (logger) {
      while (pendingEditorMessages.length) {
        const pending = pendingEditorMessages.shift();
        logger(pending.message, pending.level, pending.extra);
      }
      logger(message, level, extra);
      return true;
    }
    pendingEditorMessages.push({ message, level, extra });
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
    console[method]?.(message, extra ?? '');
    return false;
  }

  function forwardWrapperDiagnostics() {
    const diagnostics = global.HobunjiProceduralGroundCarryDiagnostics;
    const lines = diagnostics?.getLines?.() || [];
    for (const line of lines) {
      if (!line || forwardedWrapperLines.has(line)) continue;
      forwardedWrapperLines.add(line);
      editorLog(line, /failed|error|incomplete/i.test(line) ? 'error' : /warn|corrected|reload/i.test(line) ? 'warn' : 'info');
    }
    const floating = document.getElementById('proceduralGroundCarryDiagnostics');
    if (floating) floating.hidden = true;
  }

  function labelLiveStateReadout(id, label) {
    const pre = document.getElementById(id);
    if (!pre || pre.dataset.canonicalStateLabel === 'true') return;
    pre.dataset.canonicalStateLabel = 'true';
    pre.setAttribute('aria-label', `${label}; not a debug log`);
    const note = document.createElement('div');
    note.className = 'muted small';
    note.dataset.groundCarryStateLabel = id;
    note.textContent = `${label} · live state only, not the copyable Diagnostics log`;
    pre.parentElement?.insertBefore(note, pre);
  }

  function normalizeStateReadouts() {
    labelLiveStateReadout('groundRestDebug', 'Ground / Rest state');
    labelLiveStateReadout('carryDebug', 'Carry state');
  }

  function emit(message, kind = 'good') {
    const level = kind === 'bad' ? 'error' : kind === 'warn' ? 'warn' : 'info';
    editorLog(`[Ground/Rest input] ${message}`, level);
    forwardWrapperDiagnostics();
  }

  function status(message, kind = 'good') {
    const pill = document.getElementById('statusPill');
    if (pill) {
      pill.textContent = message;
      pill.className = `pill ${kind}`;
    }
    emit(message, kind);
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#${PANEL_ID}{pointer-events:auto!important;touch-action:manipulation!important;z-index:2147483000!important}
#${PANEL_ID} *{pointer-events:auto!important}
#${PANEL_ID} [data-ground-pose],#${PANEL_ID} button{touch-action:manipulation!important;user-select:none;-webkit-user-select:none}
#${BUTTON_ID}{pointer-events:auto!important;touch-action:manipulation!important}
#proceduralGroundCarryDiagnostics,#proceduralGroundCarryDiagnosticsStyle{display:none!important}
[data-ground-carry-state-label]{margin-top:8px;margin-bottom:3px}
`;
    document.head.appendChild(style);
  }

  async function selectPose(pose, source) {
    const api = global.HobunjiProceduralLimbPoseAuthor;
    inputCount += 1;
    lastPose = pose;
    if (!api?.setPose) {
      status(`Ground / Rest input reached ${source}, but pose API is missing`, 'bad');
      return false;
    }
    status(`Ground / Rest input ${inputCount}: ${pose} · ${source}`);
    try {
      await api.setPose(pose);
      const debug = api.getDebug?.() || {};
      status(`Ground / Rest applied: ${pose} · state ${debug.pose || 'unknown'}`);
      editorLog(`[Ground/Rest pose] ${pose} live hierarchy`, 'info', debug);
      return true;
    } catch (error) {
      status(`Ground / Rest ${pose} failed: ${error?.message || error}`, 'bad');
      return false;
    }
  }

  function poseButtonFromEvent(event) {
    const target = event.target?.closest?.('[data-ground-pose]');
    return target && target.closest?.(`#${PANEL_ID}`) ? target : null;
  }

  document.addEventListener('pointerdown', event => {
    const button = poseButtonFromEvent(event);
    if (!button) return;
    pointerDispatchAt = performance.now();
    event.preventDefault();
    event.stopImmediatePropagation();
    selectPose(button.dataset.groundPose, 'pointerdown-capture');
  }, { capture: true, passive: false });

  document.addEventListener('click', event => {
    const button = poseButtonFromEvent(event);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (performance.now() - pointerDispatchAt < 450) return;
    selectPose(button.dataset.groundPose, 'click-capture');
  }, true);

  document.addEventListener('pointerdown', event => {
    const button = event.target?.closest?.(`#${BUTTON_ID}`);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    global.HobunjiProceduralLimbPoseAuthor?.openPanel?.();
    normalizeStateReadouts();
    status('Ground / Rest input bridge opened panel');
  }, { capture: true, passive: false });

  injectStyles();
  normalizeStateReadouts();
  const observer = new MutationObserver(() => {
    injectStyles();
    normalizeStateReadouts();
    forwardWrapperDiagnostics();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // The wrapper starts before the editor's public logger is always available.
  // Replay its early boot lines into the canonical copyable Diagnostics panel
  // once that logger comes online, then keep future input messages there too.
  [0, 100, 400, 1200, 2500, 5000, 8000].forEach(delay => setTimeout(forwardWrapperDiagnostics, delay));

  global.ProceduralGroundRestInputBridge = Object.freeze({
    installed: true,
    selectPose,
    getDebug: () => ({ installed: true, inputCount, lastPose, canonicalPinAction }),
  });

  editorLog(`[Ground/Carry source pin] canonical key ${canonicalPinAction} · ${global.__HOBUNJI_PINNED_EDITOR_SOURCE__?.ref?.slice?.(0, 12) || 'unresolved'}`, canonicalPinAction === 'error' ? 'error' : canonicalPinAction === 'guarded' ? 'warn' : 'info');
  status('Ground / Rest input bridge loaded · canonical Diagnostics log active');
})(window);
