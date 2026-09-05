(() => {
  'use strict';

  // Kurraya hold assembly + reactive twitch — extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern already used
  // by js/fishing-minigame.js and js/mount-system.js.
  //
  // Ported directly from the reference mockup's authored two-plane
  // "avatarEquipmentAuthoring.kurraya" fit (EMBEDDED_FOROJI_RECORD in the
  // uploaded HAMusicMinigameV2.html — a front-view plane crossed with a
  // top-view plane, tilted together) and its note-reactive twitch
  // (triggerKurrayaGameplayTwitch/updateKurrayaGameplayTwitch) instead of a
  // plain flat billboard: front.png alone read as a static 2D cutout from
  // most angles, and an idle sine sway had nothing to do with the actual
  // music. The twitch fires per real sounded note instead (see
  // js/music-minigame.js's 'sounded-note' relay), so the instrument visibly
  // reacts to what's actually playing rather than looping on its own
  // independent clock.
  let deps = null;
  function init(injectedDeps) {
    deps = injectedDeps;
    installHostedSampleHook();
    installMinimalPerformanceUiHook();
  }

  const KURRAYA_TOP_ASSET = { path: 'assets/toolsprites/kurraya_top.png', width: 318, height: 247 };
  const KURRAYA_AUDIO_ASSET = { path: 'assets/audio/music/instruments/sfx_kurraya_pluck.m4a', filename: 'sfx_kurraya_pluck.m4a' }; // Bundled pluck fed into every hosted Kurraya sampler before it can sound notes.
  const KURRAYA_MUSIC_FRAME_SRC = 'assets/minigames/lyre-performance.html'; // Identifies both the player's visible performance iframe and ambient NPC performance iframes.
  const KURRAYA_MINIMAL_PERFORMANCE_UI = true; // Temporary presentation flag used to leave only notes, Auto Pick/arpeggio selection, and scale selection visible during player performances.
  const KURRAYA_MINIMAL_UI_HIDDEN_SELECTORS = [ // Host-side music chrome suppressed while the temporary minimal presentation is active.
    '#compactSongPicker',
    '#musicLayoutHud',
    '#musicModeShiftHud',
    '#musicPerformanceHud',
    '#musicMinigameCloseBtn',
    '#leftMusicControls .concertinaGroupHead',
    '#leftMusicControls .edgeStickSide',
    '#leftMusicControls .autoPickCrossHint',
    '#rightMusicControls .concertinaGroupHead',
    '#rightMusicControls .concertinaStrumWrap',
  ];
  const KURRAYA_SAMPLE_RESTORE_WAIT_MS = 350; // Gives the minigame's IndexedDB restore a short chance to reuse an already-analyzed bundled sample.
  const KURRAYA_SAMPLE_IMPORT_TIMEOUT_MS = 5000; // Prevents a failed browser decoder from blocking Kurraya controls indefinitely.
  const KURRAYA_SAMPLE_ANALYSIS_WAIT_MS = 1400; // Lets the existing root-note analyzer finish before the first pitched performance begins.
  const KURRAYA_SAMPLE_GATED_BRIDGE_METHODS = [ // Sound-producing/control methods queued behind sample readiness so no fallback-pluck note leaks through first.
    'noteDown', 'noteUp', 'bankDown', 'bankUp', 'tap',
    'leftStick', 'setAutoPickMode', 'rightStick', 'releaseLeftStick', 'releaseRightStick',
    'resetHarmony', 'setHarmonyPattern', 'startGameplaySong', 'startBackupPreviewSong',
    'startAmbientLead', 'stopBackupPreview', 'enterJamMode',
  ];
  // The front plane's own geometry/scale already comes from the caller's
  // TOOL_ITEM_DEFS.kurraya/toolTextures — only the top plane's relationship
  // to it, and the whole assembly's rest tilt, are authored data here.
  const KURRAYA_TOP_PART = {
    position: { x: 0.0005558199292840047, y: 0.43167346207010837, z: -0.155 },
    rotationDeg: { x: 90, y: -1.987846675914698e-16, z: -178.43603708156874 },
    scaleRelativeToFront: 0.46 / 0.46, // Both parts were authored at the same 0.46 plane scale — kept as an explicit ratio rather than assuming equal.
  };
  // Of the assembly's authored attachment tilt (x≈0°, y≈5.2°, z≈-72.4°),
  // Z is the one clearly off a clean 90°-multiple — chooseKurrayaTwitchAxis
  // in the reference mockup picks exactly this axis for this exact fit.
  const KURRAYA_REST_ROTATION = { x: 0, y: 5.212597280558908 * Math.PI / 180, z: -72.398815421906 * Math.PI / 180 };
  const KURRAYA_TWITCH_AXIS = 'z';

  let _hostedSampleHookInstalled = false; // Ensures init() registers the document-level iframe load hook only once.
  let _minimalPerformanceUiHookInstalled = false; // Ensures the host DOM observer for the temporary minimal Kurraya presentation is registered only once.
  let _minimalPerformanceUiRefreshPending = false; // Coalesces UI mutations into one animation-frame refresh while music controls are being rebuilt.

  function sampleLog(message, level = 'info') {
    window.__farmLog?.(`kurraya sample: ${message}`, level);
  }

  function isKurrayaMusicFrame(frame) {
    const src = frame?.getAttribute?.('src') || ''; // Used to ignore unrelated iframes and the player's about:blank teardown load.
    return src.includes(KURRAYA_MUSIC_FRAME_SRC);
  }

  function setMinimalElementHidden(element, hidden) {
    if (!element) return;
    const savedDisplayAttribute = 'data-kurraya-minimal-display'; // Stores any pre-existing inline display value so temporary suppression can be reversed cleanly.
    if (hidden) {
      if (!element.hasAttribute(savedDisplayAttribute)) element.setAttribute(savedDisplayAttribute, element.style.display || '');
      element.style.setProperty('display', 'none', 'important');
      return;
    }
    if (!element.hasAttribute(savedDisplayAttribute)) return;
    const previousDisplay = element.getAttribute(savedDisplayAttribute) || ''; // Restores the exact inline display value that existed before minimal mode hid the element.
    element.style.removeProperty('display');
    if (previousDisplay) element.style.display = previousDisplay;
    element.removeAttribute(savedDisplayAttribute);
  }

  function setMinimalFrameHidden(frame, hidden) {
    if (!frame) return;
    const savedOpacityAttribute = 'data-kurraya-minimal-opacity'; // Stores the iframe's prior inline opacity while its visual minigame surface is temporarily suppressed.
    const savedPointerAttribute = 'data-kurraya-minimal-pointer-events'; // Stores the iframe's prior pointer behavior while host-side controls remain interactive.
    if (hidden) {
      if (!frame.hasAttribute(savedOpacityAttribute)) frame.setAttribute(savedOpacityAttribute, frame.style.opacity || '');
      if (!frame.hasAttribute(savedPointerAttribute)) frame.setAttribute(savedPointerAttribute, frame.style.pointerEvents || '');
      frame.style.opacity = '0';
      frame.style.pointerEvents = 'none';
      return;
    }
    if (frame.hasAttribute(savedOpacityAttribute)) {
      const previousOpacity = frame.getAttribute(savedOpacityAttribute) || ''; // Restores the iframe's previous inline opacity when the performance closes.
      frame.style.removeProperty('opacity');
      if (previousOpacity) frame.style.opacity = previousOpacity;
      frame.removeAttribute(savedOpacityAttribute);
    }
    if (frame.hasAttribute(savedPointerAttribute)) {
      const previousPointerEvents = frame.getAttribute(savedPointerAttribute) || ''; // Restores the iframe's previous inline pointer behavior after minimal mode ends.
      frame.style.removeProperty('pointer-events');
      if (previousPointerEvents) frame.style.pointerEvents = previousPointerEvents;
      frame.removeAttribute(savedPointerAttribute);
    }
  }

  function applyMinimalPerformanceUi() {
    if (!KURRAYA_MINIMAL_PERFORMANCE_UI || typeof document === 'undefined') return;
    const overlay = document.getElementById('musicMinigameOverlay'); // Supplies the authoritative open/closed state for the player's visible Kurraya performance.
    const performanceOpen = Boolean(overlay?.classList.contains('open')); // Gates suppression so normal page chrome is restored immediately after the performance closes.
    const playerFrame = document.getElementById('musicMinigameFrame'); // Keeps the music engine alive and focusable while hiding its lyre/chart presentation surface.
    setMinimalFrameHidden(playerFrame, performanceOpen);
    for (const selector of KURRAYA_MINIMAL_UI_HIDDEN_SELECTORS) {
      document.querySelectorAll(selector).forEach(element => setMinimalElementHidden(element, performanceOpen));
    }
  }

  function queueMinimalPerformanceUiRefresh() {
    if (_minimalPerformanceUiRefreshPending || typeof requestAnimationFrame !== 'function') return;
    _minimalPerformanceUiRefreshPending = true;
    requestAnimationFrame(() => {
      _minimalPerformanceUiRefreshPending = false;
      applyMinimalPerformanceUi();
    });
  }

  function installMinimalPerformanceUiHook() {
    if (!KURRAYA_MINIMAL_PERFORMANCE_UI || _minimalPerformanceUiHookInstalled || typeof document === 'undefined' || !document.documentElement) return;
    _minimalPerformanceUiHookInstalled = true;
    const observer = new MutationObserver(queueMinimalPerformanceUiRefresh); // Watches the overlay class plus dynamically-created song/HUD/control chrome from music-minigame.js.
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    queueMinimalPerformanceUiRefresh();
  }

  function waitForAnalysisText(readout, predicate, timeoutMs) {
    return new Promise(resolve => {
      const currentText = readout?.textContent || ''; // Used for the immediate-success path when the minigame already finished the requested sample step.
      if (!readout || predicate(currentText)) { resolve(Boolean(readout)); return; }
      let finished = false; // Shared by the observer and timeout so the promise resolves exactly once.
      const observer = new MutationObserver(() => { // Watches the minigame's existing mobile-visible diagnostics instead of reaching into its private sampler state.
        const nextText = readout.textContent || ''; // Used to test each sampler/analysis status update against the requested completion condition.
        if (!predicate(nextText) || finished) return;
        finished = true;
        clearTimeout(timeoutId);
        observer.disconnect();
        resolve(true);
      });
      const timeoutId = setTimeout(() => { // Releases the bridge if decoding/analysis fails or a browser never emits the expected status text.
        if (finished) return;
        finished = true;
        observer.disconnect();
        resolve(false);
      }, timeoutMs);
      observer.observe(readout, { childList: true, subtree: true, characterData: true });
    });
  }

  function assignFileToInput(input, file, frameWindow) {
    const DataTransferClass = frameWindow?.DataTransfer || window.DataTransfer; // Preferred browser-native way to provide the bundled File to the existing picker handler.
    if (typeof DataTransferClass === 'function') {
      const transfer = new DataTransferClass(); // Supplies a real FileList so the minigame follows its normal manual-import code path unchanged.
      transfer.items.add(file);
      input.files = transfer.files;
      return () => {};
    }
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    return () => { try { delete input.files; } catch {} };
  }

  async function importBundledSampleIntoFrame(frame, bridge) {
    const frameDocument = frame.contentDocument; // Used to drive the minigame's existing hidden audio-file input and read its diagnostics.
    const frameWindow = frame.contentWindow; // Supplies realm-correct File/DataTransfer constructors for Android and other stricter browsers.
    const readout = frameDocument?.getElementById('analysisReadout'); // Existing Mobile Debug/readout is the source of truth for import and root-analysis completion.
    const input = frameDocument?.getElementById('audioFile'); // Existing sampler import input owns decode, normalization, pitch analysis, markers, caching, and error handling.
    if (!frameDocument || !frameWindow || !bridge || !readout || !input) throw new Error('hosted sampler controls were not available');

    try { await bridge.wakeAudio?.(); } catch {}
    const restored = await waitForAnalysisText( // Reuses normalized IndexedDB PCM on later frames instead of decoding the M4A repeatedly.
      readout,
      text => text.includes(`Restored ${KURRAYA_AUDIO_ASSET.filename}`),
      KURRAYA_SAMPLE_RESTORE_WAIT_MS
    );
    if (restored) {
      sampleLog(`restored ${KURRAYA_AUDIO_ASSET.filename} from sampler cache`);
      return;
    }

    const response = await fetch(KURRAYA_AUDIO_ASSET.path); // Loads the repo-authored source once when this frame does not already have the bundled sample restored.
    if (!response.ok) throw new Error(`sample fetch returned HTTP ${response.status}`);
    const blob = await response.blob(); // Preserves the M4A bytes while allowing the existing file-import handler to decode them normally.
    const file = new frameWindow.File([blob], KURRAYA_AUDIO_ASSET.filename, { type: blob.type || 'audio/mp4' }); // Makes the repo asset indistinguishable from a user-selected sample to the existing sampler pipeline.
    const cleanupInputFiles = assignFileToInput(input, file, frameWindow); // Removes only the fallback synthetic FileList shim when one was needed.
    const importReady = waitForAnalysisText( // Starts listening before dispatch so very fast decoders cannot race past the readiness check.
      readout,
      text => text.startsWith(`Ready: ${KURRAYA_AUDIO_ASSET.filename}`) || text.startsWith('Import failed:'),
      KURRAYA_SAMPLE_IMPORT_TIMEOUT_MS
    );
    input.dispatchEvent(new frameWindow.Event('change', { bubbles: true }));
    const imported = await importReady; // Holds playback until the existing decoder has either accepted or rejected the bundled sample.
    cleanupInputFiles();
    const importText = readout.textContent || ''; // Used to distinguish a successful ready state from the import handler's visible failure state.
    if (!imported || importText.startsWith('Import failed:')) throw new Error(importText || 'sample import timed out');

    await waitForAnalysisText( // Root analysis updates sampleRootMidi; waiting here keeps the first ambient/player notes correctly pitched.
      readout,
      text => text.startsWith('Analyzed '),
      KURRAYA_SAMPLE_ANALYSIS_WAIT_MS
    );
    sampleLog(`loaded ${KURRAYA_AUDIO_ASSET.filename} through the existing sampler`);
  }

  function gateHostedMusicBridge(frame) {
    let bridge = null; // Filled from the same-origin minigame window and then wrapped before target-phase iframe load listeners can start playback.
    try { bridge = frame.contentWindow?.HobunjiMusicControlBridge || null; } catch {}
    if (!bridge || bridge.__kurrayaBundledSampleGate) return;
    const sampleReady = importBundledSampleIntoFrame(frame, bridge).catch(error => { // Shared promise preserves bridge call order and falls back gracefully if this browser cannot decode the M4A.
      sampleLog(`could not load ${KURRAYA_AUDIO_ASSET.filename}: ${error?.message || error}; using sampler fallback`, 'warn');
    });
    Object.defineProperty(bridge, '__kurrayaBundledSampleGate', { configurable: true, value: sampleReady });

    for (const methodName of KURRAYA_SAMPLE_GATED_BRIDGE_METHODS) {
      const original = bridge[methodName]; // Retains each minigame bridge operation so it can run unchanged after sample readiness.
      if (typeof original !== 'function') continue;
      bridge[methodName] = (...args) => sampleReady.then(() => original.apply(bridge, args));
    }
  }

  function installHostedSampleHook() {
    if (_hostedSampleHookInstalled || typeof document === 'undefined') return;
    _hostedSampleHookInstalled = true;
    document.addEventListener('load', event => {
      const frame = event.target; // Resource-load capture reaches dynamically-created ambient iframes as well as the player's persistent music iframe.
      if (!(frame instanceof HTMLIFrameElement) || !isKurrayaMusicFrame(frame)) return;
      gateHostedMusicBridge(frame);
    }, true);
  }

  let _kurrayaTopTexture = null;
  function kurrayaTopTexture() {
    if (_kurrayaTopTexture) return _kurrayaTopTexture;
    const THREE = deps.THREE;
    _kurrayaTopTexture = deps.toolTexLoader.load(KURRAYA_TOP_ASSET.path);
    _kurrayaTopTexture.magFilter = THREE.NearestFilter;
    _kurrayaTopTexture.minFilter = THREE.NearestFilter;
    return _kurrayaTopTexture;
  }

  // Builds the crossed front+top plane assembly at its authored rest tilt.
  // Position/scale of the outer group is left to the caller (station-tool
  // props and the player's held-item holder each have their own existing
  // hand-attachment convention); only the parts' relative geometry to each
  // other is authored here.
  function buildAssembly() {
    const THREE = deps.THREE;
    const frontTex = deps.toolTextures.kurraya;
    if (!frontTex) return null;
    const def = deps.getKurrayaDef?.();
    const frontW = deps.TOOL_MODEL_WIDTH * 0.92, frontH = frontW * ((def?._imgH || 663) / (def?._imgW || 320));
    const group = new THREE.Group();
    group.name = 'kurraya_assembly';
    const frontGeo = new THREE.PlaneGeometry(frontW, frontH);
    const frontMat = new THREE.MeshBasicMaterial({ map: frontTex, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide });
    const front = new THREE.Mesh(frontGeo, frontMat);
    front.renderOrder = deps.heldObjectRenderOrder;
    group.add(front);

    const topAspect = KURRAYA_TOP_ASSET.height / KURRAYA_TOP_ASSET.width;
    const topW = frontW * KURRAYA_TOP_PART.scaleRelativeToFront;
    const topGeo = new THREE.PlaneGeometry(topW, topW * topAspect);
    const topMat = new THREE.MeshBasicMaterial({ map: kurrayaTopTexture(), transparent: true, alphaTest: 0.05, side: THREE.DoubleSide });
    const top = new THREE.Mesh(topGeo, topMat);
    top.renderOrder = deps.heldObjectRenderOrder;
    // The reference mockup builds front/top as siblings with their OWN
    // individual 0.46 mesh scale, while position lives in their shared
    // parent's un-scaled local space — so top.position is already an
    // absolute offset calibrated against that same 0.46 front scale, not a
    // fraction of frontW to be multiplied in. Converting by (frontW/0.46)
    // instead of frontW alone reproduces that reference scale exactly
    // (this fit's frontW happens to equal 0.46 already) while staying
    // correct if frontW is ever tuned differently.
    const REFERENCE_FRONT_SCALE = 0.46;
    const topPosScale = frontW / REFERENCE_FRONT_SCALE;
    top.position.set(KURRAYA_TOP_PART.position.x * topPosScale, KURRAYA_TOP_PART.position.y * topPosScale, KURRAYA_TOP_PART.position.z * topPosScale);
    top.rotation.set(
      THREE.MathUtils.degToRad(KURRAYA_TOP_PART.rotationDeg.x),
      THREE.MathUtils.degToRad(KURRAYA_TOP_PART.rotationDeg.y),
      THREE.MathUtils.degToRad(KURRAYA_TOP_PART.rotationDeg.z)
    );
    group.add(top);

    group.rotation.set(KURRAYA_REST_ROTATION.x, KURRAYA_REST_ROTATION.y, KURRAYA_REST_ROTATION.z);
    group.userData.kurrayaAssembly = true;
    return group;
  }

  // One twitch-state record per performer (the player, or a given NPC) —
  // see triggerTwitch/updateTwitch below.
  function newTwitchState() { return { active: false, axis: KURRAYA_TWITCH_AXIS, base: 0, amplitude: 0.04, startedAt: 0, durationMs: 0, phase: 0, frequency: 16 }; }

  function triggerTwitch(twitchState, group) {
    if (!group?.userData.kurrayaAssembly) return;
    const axis = twitchState.axis;
    if (twitchState.active) group.rotation[axis] = twitchState.base; // Every retrigger first returns to the exact rest angle, matching restoreKurrayaGameplayTwitch.
    else twitchState.base = KURRAYA_REST_ROTATION[axis];
    twitchState.active = true;
    twitchState.amplitude = Math.min(0.22, (Number(twitchState.amplitude) || 0.04) + 0.06 + Math.random() * 0.025);
    twitchState.startedAt = performance.now();
    twitchState.durationMs = 270 + Math.random() * 120;
    twitchState.phase = Math.random() * Math.PI * 2;
    twitchState.frequency = 16 + Math.random() * 8;
  }

  function updateTwitch(twitchState, group) {
    if (!twitchState.active || !group?.userData.kurrayaAssembly) return;
    const now = performance.now();
    const elapsed = now - twitchState.startedAt;
    const axis = twitchState.axis;
    if (elapsed >= twitchState.durationMs) {
      group.rotation[axis] = twitchState.base;
      twitchState.active = false;
      return;
    }
    const progress = elapsed / twitchState.durationMs;
    const envelope = Math.pow(1 - progress, 1.35);
    const offset = Math.sin((elapsed / 1000) * twitchState.frequency + twitchState.phase) * twitchState.amplitude * envelope;
    group.rotation[axis] = twitchState.base + offset;
  }

  window.KurrayaInstrument = { init, buildAssembly, newTwitchState, triggerTwitch, updateTwitch };
})();