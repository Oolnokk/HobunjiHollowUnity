// Early shared structure-asset preload for Hobunji Hollow.
//
// This module deliberately owns only immutable structure-source readiness:
// the shared brick GLB bytes, shingle template, and common house textures.
// Town/farm/house systems still own their scene meshes and rebuild policy.
// Loading this before game.js lets the browser/network/GLTF work overlap the
// save-selection/onboarding period instead of first happening during play.
(() => {
  'use strict';

  const WALL_GLB_NAME = 'Roughbrick1.glb'; // Used to identify the shared WallBuilder template and prefetched binary.
  const currentScript = document.currentScript; // Used to resolve asset URLs from this file instead of the current page path.
  const docsBaseUrl = currentScript?.src ? new URL('../', currentScript.src) : new URL('./', document.baseURI); // Used as the stable docs/ asset root.
  const wallGlbUrl = new URL(`assets/models/${WALL_GLB_NAME}`, docsBaseUrl).href; // Used by the parser-time brick-byte fetch.
  const shingleBaseUrl = new URL('assets/models/', docsBaseUrl).href; // Used by HousePieceGen's shared shingle-template preload.
  const textureUrls = [ // Used to warm/decode the three images shared by Highland-style structures.
    new URL('assets/textures/boards.png', docsBaseUrl).href,
    new URL('assets/textures/carved_smooth.png', docsBaseUrl).href,
    new URL('assets/textures/canvas.png', docsBaseUrl).href,
  ];
  const startedAt = performance.now(); // Used by the in-game preload timing diagnostics.
  const state = { // Used by snapshot() and the in-game Debug log to verify that preload actually helped.
    wallSourceReady: false,
    wallBytes: 0,
    wallFetchMs: null,
    shingleReady: false,
    shingleMs: null,
    texturesReady: 0,
    texturesTotal: textureUrls.length,
    wallBuilderPreloadUses: 0,
    wallBuilderFallbacks: 0,
    preexistingDefaultEntriesReplaced: 0,
    ensureCalls: 0,
    readyAtMs: null,
    errors: [],
  };
  const heldImages = []; // Keeps decoded common texture images alive while startup consumers begin creating Three textures.
  const pendingLogs = []; // Buffers diagnostics until game.js exposes the mobile-visible __farmLog Debug panel sink.
  let logFlushTimer = null; // Used to keep exactly one pending Debug-log flush timer alive.
  let logFlushAttempts = 0; // Used to stop polling for __farmLog on non-game pages/tools.
  let readyLogSent = false; // Used to emit the successful readiness summary once per page load.

  function elapsedMs() {
    return Math.max(0, performance.now() - startedAt);
  }

  function flushLogs() {
    logFlushTimer = null;
    if (typeof window.__farmLog === 'function') {
      while (pendingLogs.length) {
        const entry = pendingLogs.shift();
        window.__farmLog(entry.message, entry.level);
      }
      return;
    }
    if (!pendingLogs.length || ++logFlushAttempts >= 60) return;
    logFlushTimer = setTimeout(flushLogs, 500);
  }

  function debugLog(message, level = 'info') {
    const text = `[structure-preload] ${message}`;
    if (level === 'warn') console.warn(text);
    else console.info(text);
    pendingLogs.push({ message: text, level });
    if (!logFlushTimer && logFlushAttempts < 60) logFlushTimer = setTimeout(flushLogs, 250);
  }

  function recordError(label, error) {
    const message = `${label}: ${error?.message || error}`;
    state.errors.push(message);
    debugLog(message, 'warn');
  }

  const wallBytesPromise = fetch(wallGlbUrl, { cache: 'force-cache' }) // Used by the WallBuilder load bridge so the first real wall build reuses an early request.
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${wallGlbUrl}`);
      return response.arrayBuffer();
    })
    .then(buffer => {
      state.wallSourceReady = true;
      state.wallBytes = buffer.byteLength;
      state.wallFetchMs = elapsedMs();
      return buffer;
    })
    .catch(error => {
      recordError('brick source preload failed', error);
      throw error;
    });

  const shinglePromise = (window.HousePieceGen?.loadShingleGlb // Used by ensureReady() and shared automatically with every later HousePieceGen caller.
    ? window.HousePieceGen.loadShingleGlb(shingleBaseUrl)
    : Promise.reject(new Error('HousePieceGen.loadShingleGlb unavailable')))
    .then(() => {
      state.shingleReady = true;
      state.shingleMs = elapsedMs();
      return true;
    })
    .catch(error => {
      recordError('shingle preload failed', error);
      return false;
    });

  function preloadImage(url) {
    return new Promise(resolve => {
      const image = new Image(); // Used to populate and decode the browser image cache before Three TextureLoader asks for the same URL.
      heldImages.push(image);
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        const decoded = typeof image.decode === 'function' ? image.decode().catch(() => {}) : Promise.resolve(); // Used to move image decode work into startup when supported.
        decoded.finally(() => resolve(true));
      };
      image.onerror = () => resolve(false);
      image.src = url;
    });
  }

  const texturePromise = Promise.all(textureUrls.map(preloadImage)).then(results => { // Used by diagnostics; texture failure never blocks structure geometry.
    state.texturesReady = results.filter(Boolean).length;
    return state.texturesReady === state.texturesTotal;
  });

  function installWallBuilderBridge() {
    const prototype = window.WallBuilder?.prototype; // Used to intercept only the existing default-GLB loader, leaving every build API unchanged.
    if (!prototype || prototype.loadDefaultGlb?.__hobunjiStructurePreloadBridge) return;
    const originalLoadDefaultGlb = prototype.loadDefaultGlb; // Used as the exact fallback if the early byte fetch or parse fails.
    if (typeof originalLoadDefaultGlb !== 'function') return;

    function loadDefaultGlbFromEarlyBytes() {
      if (this._defaultGlbLoadPromise) return this._defaultGlbLoadPromise;
      const wallBuilder = this; // Used throughout this one shared load promise without changing WallBuilder's public API.
      const preloadBackedLoad = wallBytesPromise
        .then(buffer => {
          // WallBuilder's temporary brown-box placeholder intentionally uses
          // the SAME Roughbrick1.glb library key as the eventual real model.
          // Merely seeing that key therefore does not mean the real GLB is
          // ready. Always parse/register the prefetched source here so a
          // placeholder that raced ahead is replaced before readiness resolves.
          if (wallBuilder.glbLibrary?.has(WALL_GLB_NAME)) {
            state.preexistingDefaultEntriesReplaced++;
            debugLog('replacing a pre-existing default wall entry with the real preloaded Roughbrick1.glb source');
          }
          state.wallBuilderPreloadUses++;
          return wallBuilder.loadGlbFromBuffer(buffer.slice(0), WALL_GLB_NAME);
        })
        .then(name => {
          const tintRequest = wallBuilder._defaultGlbTintRequest; // Used to preserve WallBuilder's existing tint-request-before-load behavior.
          if (tintRequest) wallBuilder.tintDefaultGlb(tintRequest.pngPath, tintRequest.fillColor);
          return name;
        })
        .catch(error => {
          state.wallBuilderFallbacks++;
          wallBuilder._defaultGlbLoadPromise = null;
          debugLog(`early brick bytes unavailable to WallBuilder; using original loader (${error?.message || error})`, 'warn');
          return originalLoadDefaultGlb.call(wallBuilder);
        });
      wallBuilder._defaultGlbLoadPromise = preloadBackedLoad;
      return preloadBackedLoad;
    }

    loadDefaultGlbFromEarlyBytes.__hobunjiStructurePreloadBridge = true;
    prototype.loadDefaultGlb = loadDefaultGlbFromEarlyBytes;
  }

  installWallBuilderBridge();

  async function ensureReady(wallBuilder) {
    state.ensureCalls++;
    const wallReadyPromise = wallBuilder?.loadDefaultGlb // Used to make readiness specific to the actual shared gameplay WallBuilder instance.
      ? wallBuilder.loadDefaultGlb().then(() => true).catch(error => { recordError('brick WallBuilder load failed', error); return false; })
      : Promise.resolve(false);
    const [wallReady, shingleReady, texturesReady] = await Promise.all([wallReadyPromise, shinglePromise, texturePromise]);

    if (wallReady) wallBuilder.tintDefaultGlb('assets/textures/carved_smooth.png', '#4d4d4d');
    if (shingleReady) window.HousePieceGen?.tintShingleMaterial?.('assets/textures/carved_smooth.png', '#7d7355');

    const ready = !!(wallReady && shingleReady); // Used by callers to decide whether placeholder geometry/rebuild fallback is still necessary.
    if (ready && state.readyAtMs == null) state.readyAtMs = elapsedMs();
    if (ready && !readyLogSent) {
      readyLogSent = true;
      debugLog(`final brick+shingle sources ready in ${Math.round(state.readyAtMs)}ms; common textures ${state.texturesReady}/${state.texturesTotal}; WallBuilder early-byte uses=${state.wallBuilderPreloadUses}; replaced pre-existing default entries=${state.preexistingDefaultEntriesReplaced}`);
    }
    return {
      ready,
      wallReady: !!wallReady,
      shingleReady: !!shingleReady,
      texturesReady: !!texturesReady,
      elapsedMs: elapsedMs(),
    };
  }

  function snapshot() {
    return {
      ...state,
      elapsedMs: elapsedMs(),
      wallGlbUrl,
      shingleBaseUrl,
      pendingDebugLogs: pendingLogs.length,
    };
  }

  window.StructurePreload = {
    ensureReady,
    snapshot,
  };
  window.__structurePreloadDebug = snapshot;
  debugLog('started before game.js; brick bytes, shingle GLB, and common Highland textures are warming during startup');
})();
