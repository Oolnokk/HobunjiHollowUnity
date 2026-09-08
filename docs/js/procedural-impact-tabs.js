// Procedural Animation Editor adapter loader.
// Keeps the current-main Impact/Dance workspace intact in
// procedural-impact-tabs-core.js, then layers editor-native Ground / Rest and
// Carry authoring beside it from the exact same branch/commit as this script.
(function () {
  'use strict';

  const SELF_SCRIPT_SRC = document.currentScript?.src || '';
  // This is the source-settings key the procedural editor itself reads.
  // A previous Ground/Carry build accidentally used an extension-only lookalike
  // key, allowing the adapter and editor runtime to come from different SHAs.
  const SOURCE_STORAGE_KEY = 'hobunjiNpcPlaneAvatarRepoViewer.source.v1';
  const DIAGNOSTIC_ID = 'proceduralGroundCarryDiagnostics';
  const DIAGNOSTIC_STYLE_ID = 'proceduralGroundCarryDiagnosticsStyle';
  const diagnosticLines = [];

  function revisionFromUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, document.baseURI);
      const host = url.hostname.toLowerCase();
      if (host !== 'raw.githack.com' && host !== 'raw.githubusercontent.com') return null;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 3 || !/^[0-9a-f]{40}$/i.test(parts[2])) return null;
      return {
        owner: decodeURIComponent(parts[0]),
        repo: decodeURIComponent(parts[1]),
        ref: parts[2].toLowerCase(),
        host,
      };
    } catch (_) {
      return null;
    }
  }

  const PINNED_SOURCE = revisionFromUrl(SELF_SCRIPT_SRC) || revisionFromUrl(window.location.href);

  function renderDiagnostics() {
    if (!document.body) return;
    if (!document.getElementById(DIAGNOSTIC_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = DIAGNOSTIC_STYLE_ID;
      style.textContent = `
#${DIAGNOSTIC_ID}{position:fixed;left:max(8px,env(safe-area-inset-left));bottom:max(8px,env(safe-area-inset-bottom));z-index:2147483646;width:min(620px,calc(100vw - 16px));max-height:min(28vh,180px);overflow:auto;pointer-events:none;margin:0;padding:7px 9px;border:1px solid rgba(121,190,255,.6);border-radius:8px;background:rgba(2,10,18,.88);box-shadow:0 5px 22px rgba(0,0,0,.45);color:#d9efff;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap}
#${DIAGNOSTIC_ID}[data-tone="bad"]{border-color:rgba(255,106,106,.8);color:#ffd4d4}
`;
      document.head.appendChild(style);
    }
    let pre = document.getElementById(DIAGNOSTIC_ID);
    if (!pre) {
      pre = document.createElement('pre');
      pre.id = DIAGNOSTIC_ID;
      pre.setAttribute('aria-live', 'polite');
      document.body.appendChild(pre);
    }
    pre.textContent = diagnosticLines.slice(-8).join('\n');
  }

  function emitDiagnostic(message, tone = 'info') {
    const stamp = new Date().toLocaleTimeString();
    const line = `[Ground/Carry ${stamp}] ${String(message)}`;
    diagnosticLines.push(line);
    if (diagnosticLines.length > 40) diagnosticLines.shift();
    if (tone === 'bad') console.error(line);
    else if (tone === 'warn') console.warn(line);
    else console.info(line);
    renderDiagnostics();
    const pre = document.getElementById(DIAGNOSTIC_ID);
    if (pre) pre.dataset.tone = tone === 'bad' ? 'bad' : 'info';
  }

  window.HobunjiProceduralGroundCarryDiagnostics = Object.freeze({
    emit: emitDiagnostic,
    getLines: () => diagnosticLines.slice(),
    get pinnedSource() { return PINNED_SOURCE ? { ...PINNED_SOURCE } : null; },
  });

  function forcePinnedSourceSettings() {
    if (!PINNED_SOURCE) {
      emitDiagnostic('No commit SHA found in adapter/page URL; editor source setting left unchanged.', 'warn');
      return 'none';
    }
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(SOURCE_STORAGE_KEY) || '{}') || {};
    } catch (_) {
      stored = {};
    }
    const sourceChanged = stored.owner !== PINNED_SOURCE.owner
      || stored.repo !== PINNED_SOURCE.repo
      || String(stored.ref || '').toLowerCase() !== PINNED_SOURCE.ref;
    const next = {
      ...stored,
      owner: PINNED_SOURCE.owner,
      repo: PINNED_SOURCE.repo,
      ref: PINNED_SOURCE.ref,
      docsRoot: stored.docsRoot || 'docs/',
      dbPath: stored.dbPath || 'config/npcs/hobunji-starter-npc-database.json',
    };
    try {
      localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      emitDiagnostic(`Could not persist pinned source: ${error?.message || error}`, 'bad');
      return 'error';
    }
    window.__HOBUNJI_PINNED_EDITOR_SOURCE__ = Object.freeze({ ...PINNED_SOURCE });
    const reloadKey = `hobunji.proceduralAnimationEditor.pinReload.${PINNED_SOURCE.ref}`;
    if (sourceChanged) {
      let alreadyReloaded = false;
      try { alreadyReloaded = sessionStorage.getItem(reloadKey) === '1'; } catch (_) {}
      if (!alreadyReloaded) {
        try { sessionStorage.setItem(reloadKey, '1'); } catch (_) {}
        emitDiagnostic(`Corrected stale runtime source to ${PINNED_SOURCE.ref.slice(0, 12)}; reloading once before editor startup captures it.`, 'warn');
        window.location.reload();
        return 'reload';
      }
      emitDiagnostic(`Pinned source was corrected but reload guard was already set for ${PINNED_SOURCE.ref.slice(0, 12)}.`, 'warn');
    } else {
      try { sessionStorage.removeItem(reloadKey); } catch (_) {}
    }
    emitDiagnostic(`Pinned editor runtime source to ${PINNED_SOURCE.ref.slice(0, 12)} before source resolution.`);
    return 'ready';
  }

  function syncPinnedSourceInputs() {
    if (!PINNED_SOURCE) return;
    const fields = {
      ownerInput: PINNED_SOURCE.owner,
      repoInput: PINNED_SOURCE.repo,
      refInput: PINNED_SOURCE.ref,
    };
    for (const [id, value] of Object.entries(fields)) {
      const input = document.getElementById(id);
      if (input) input.value = value;
    }
  }

  // This MUST remain synchronous and above boot(). If the editor already read
  // stale settings earlier in this load, the one-time reload guarantees the
  // next document starts with the commit-pinned source before any capture.
  const pinAction = forcePinnedSourceSettings();
  if (pinAction === 'reload') return;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      syncPinnedSourceInputs();
      renderDiagnostics();
    }, { once: true });
  } else {
    syncPinnedSourceInputs();
    renderDiagnostics();
  }

  const src = (relative) => SELF_SCRIPT_SRC
    ? new URL(relative, SELF_SCRIPT_SRC).href
    : new URL(`../../js/${relative}`, window.location.href).href;

  function loadScript(id, url, ready) {
    if (ready?.()) return Promise.resolve(true);
    const existing = document.getElementById(id) || [...document.scripts].find((script) => script.src === url);
    if (existing) return new Promise((resolve) => {
      if (ready?.()) return resolve(true);
      existing.addEventListener('load', () => resolve(ready ? !!ready() : true), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
    });
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.id = id;
      script.async = false;
      script.src = url;
      script.addEventListener('load', () => resolve(ready ? !!ready() : true), { once: true });
      script.addEventListener('error', () => {
        emitDiagnostic(`Failed to load ${url}`, 'bad');
        resolve(false);
      }, { once: true });
      document.head.appendChild(script);
    });
  }

  function waitForCondition(label, predicate, timeoutMs = 120000, intervalMs = 50) {
    const started = performance.now();
    return new Promise(resolve => {
      const check = () => {
        let ready = false;
        try { ready = !!predicate(); } catch (_) {}
        if (ready) return resolve(true);
        if (performance.now() - started >= timeoutMs) {
          emitDiagnostic(`Timed out waiting for ${label}.`, 'bad');
          return resolve(false);
        }
        setTimeout(check, intervalMs);
      };
      check();
    });
  }

  async function waitForEditorThreeHost() {
    const hostReady = await waitForCondition(
      'PNGPlaneAvatar Three.js host',
      () => typeof window.PNGPlaneAvatar?.loadThreeModules === 'function'
    );
    if (!hostReady) return false;
    try {
      const modules = await window.PNGPlaneAvatar.loadThreeModules();
      const threeReady = !!(modules?.THREE || window.THREE);
      emitDiagnostic(`Editor Three.js host ready before Ground/Rest bootstrap: ${threeReady}.`, threeReady ? 'info' : 'bad');
      return threeReady;
    } catch (error) {
      emitDiagnostic(`Editor Three.js host failed before Ground/Rest bootstrap: ${error?.message || error}`, 'bad');
      return false;
    }
  }

  async function boot() {
    emitDiagnostic('Adapter boot started; preserving current-main Impact/Dance core.');
    await loadScript(
      'proceduralImpactTabsCoreScript',
      src('procedural-impact-tabs-core.js'),
      () => Boolean(document.getElementById('proceduralDanceModeScript') || window.ProceduralDanceMode?.installed)
    );

    await loadScript(
      'proceduralGroundCarryLegBonesScript',
      src('leg-bones.js'),
      () => typeof window.LegBones?.solveFixedTwoBoneChain === 'function'
    );

    await loadScript(
      'proceduralAnatomyProfilesScript',
      src('../config/procedural-anatomy-profiles.js'),
      () => Boolean(window.HOBUNJI_PROCEDURAL_ANATOMY_PROFILES?.resolve)
    );

    await loadScript(
      'proceduralLimbManualAuthorScript',
      src('procedural-limb-manual-author.js'),
      () => Boolean(window.ProceduralLimbManualAuthor?.create)
    );

    // Ground/Rest resolves THREE exactly once inside its bootstrap. Loading the
    // module before the editor's repository-backed PNGPlaneAvatar runtime exists
    // leaves that closure permanently with state.THREE === null: buttons update
    // pose state but applyPoseFrame() returns before touching any live transform.
    // Wait for the canonical host first so a successful pose can actually render.
    const threeHostReady = await waitForEditorThreeHost();

    // Manual IK must wrap renderer.render before Ground / Rest does. Ground then
    // applies its body/preset first and calls into this bridge, which applies the
    // draggable limb override immediately before the real render.
    const manualBridgeLoaded = threeHostReady && await loadScript(
      'proceduralGroundRestManualBridgeScript',
      src('procedural-ground-rest-manual-bridge.js'),
      () => Boolean(window.ProceduralGroundRestManualBridge?.installed)
    );
    let manualBridgeReady = false;
    if (manualBridgeLoaded) {
      try { manualBridgeReady = await window.ProceduralGroundRestManualBridge.whenRenderHookReady(); }
      catch (error) { emitDiagnostic(`Ground/Rest Manual IK bridge readiness failed: ${error?.message || error}`, 'bad'); }
    }
    emitDiagnostic(`Ground/Rest Manual IK bridge loaded before preset hook: ${!!manualBridgeReady}`);

    const groundLoaded = threeHostReady && await loadScript(
      'proceduralGroundRestModeScript',
      src('procedural-limb-pose-author.js'),
      () => Number(window.HobunjiProceduralLimbPoseAuthor?.version) >= 5
    );
    emitDiagnostic(`Ground/Rest pose module loaded after Three host: ${!!groundLoaded}`);

    const groundInputLoaded = groundLoaded && await loadScript(
      'proceduralGroundRestInputBridgeScript',
      src('procedural-ground-rest-input-bridge.js'),
      () => Boolean(window.ProceduralGroundRestInputBridge?.installed)
    );
    emitDiagnostic(`Ground/Rest input bridge loaded: ${!!groundInputLoaded}`);

    const carryLoaded = await loadScript(
      'proceduralCarryWalkModeScript',
      src('procedural-carry-walk-mode.js'),
      () => Boolean(window.ProceduralCarryWalkMode?.installed)
    );
    emitDiagnostic(`Carry locomotion module loaded: ${!!carryLoaded}`);

    const status = document.getElementById('statusPill');
    const ready = Boolean(threeHostReady && manualBridgeReady && groundLoaded && groundInputLoaded && carryLoaded && window.HobunjiProceduralLimbPoseAuthor?.version >= 5 && window.ProceduralGroundRestManualBridge?.installed && window.ProceduralGroundRestInputBridge?.installed && window.ProceduralCarryWalkMode?.installed);
    if (status) {
      status.textContent = ready
        ? 'Ground / Rest + Manual IK + Carry ready · Three host + pointer input active'
        : `Ground / Rest adapter incomplete · three ${!!threeHostReady} · manual ${!!manualBridgeReady} · ground ${!!groundLoaded} · input ${!!groundInputLoaded} · carry ${!!carryLoaded}`;
      status.className = `pill ${ready ? 'good' : 'bad'}`;
    }
    emitDiagnostic(ready ? 'Ground / Rest + Manual IK + Carry READY.' : 'Ground / Rest adapter incomplete.', ready ? 'info' : 'bad');
    console.info('[Procedural adapters] Current-main Impact/Dance + editor-native Ground/Rest + Manual IK + hardened pointer input + Regular-derived Carry loaded.');
  }

  boot();
})();
