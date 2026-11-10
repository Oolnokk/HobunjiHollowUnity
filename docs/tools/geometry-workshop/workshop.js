// Geometry Workshop interface: a tools-hub pane with one shared camera and material-safe side-by-side previews.
(() => {
  'use strict';
  const T = window.THREE; // Three.js r128, also used by the game and Tree Asset Exporter.
  const Core = window.GeometryWorkshopCore; // Non-destructive geometry operations shared by both previews.
  const $ = id => document.getElementById(id);
  const assetPaths = [
    'assets/models/hands/hand_feline.glb',
    'assets/models/hands/hand_pachyderm.glb',
    'assets/models/hands/hand_parrot.glb',
    'assets/models/hands/hand_sloth.glb',
    'assets/models/feet/foot_feline.glb',
    'assets/models/feet/foot_pachyderm.glb',
    'assets/models/feet/foot_sloth.glb',
    'assets/models/trees/crowned_pine_01.glb',
    'assets/models/trees/crowned_pine_02.glb',
    'assets/models/trees/crowned_pine_03.glb',
    'assets/models/trees/shadewood_01.glb',
    'assets/models/trees/shadewood_02.glb',
    'assets/models/trees/shadewood_03.glb'
  ]; // Quick picks; the editable path also accepts other game GLBs.
  const builderNames = [
    'buildCrownedPineMesh', 'buildShadewoodMesh', 'buildJungleTreeMesh', 'buildBoulderMesh',
    'buildDeadTreeMesh', 'buildDeadBushMesh', 'buildWildernessBushMesh', 'buildKomaHedgeBushMesh',
    'buildStumpMesh', 'buildShrubMesh', 'buildWeedsMesh', 'buildNeedlegrainMesh', 'buildHeftrootMesh'
  ]; // Existing public FoliageGenerator builders used by gameplay.
  const messages = []; // Latest on-page diagnostics, available without a console.
  let original = null; // Currently loaded source object; never mutated by the workshop.
  let candidate = null; // Generated preview clone with its own edited geometry.
  let displayOriginal = null, displayCandidate = null; // Disposable gameplay-shaded scene copies, never exported.
  let sourceName = 'model'; // Name for diagnostics and exported GLB files.
  let downloadUrl = null; // Retains a manual-tap GLB link on mobile until replaced.
  let profileUrl = null; // Retains a separate manual-tap JSON download on mobile.
  let originalOwnsResources = false; // Imported GLBs own GPU buffers; generated objects may use shared generator caches.
  let candidateMatchesControls = false; // Only current successful preview settings permit an optimized GLB export.
  let latestResult = null; // Last successful preview's source/candidate triangle statistics for quality JSON metadata.
  let linkedGame = null; // Optional game tab opened directly by this workshop.
  let liveBuffer = null, liveName = ''; // Captured live GLB bytes/label for the existing load/preview pipeline.
  let activePick = null; // One-shot game canvas listener, cancelled on another pick or Escape.
  let generation = 0; // Invalidates stale async loads and recomputations.
  let updating = false; // Disables competing export operations while a preview is building.
  const host = $('canvas-host'); // In-tool shared WebGL comparison viewport.
  if (!T?.Scene || !T?.WebGLRenderer || !T?.GLTFLoader || !T?.GLTFExporter || !Core) {
    $('busy').textContent = 'Missing dependency';
    $('loading-note').textContent = 'Three.js, GLTFLoader or mesh processing failed to load.';
    return;
  }
  const sceneA = new T.Scene(), sceneB = new T.Scene(); // Isolated views; original and candidate never overlap.
  const RenderPreview = window.GeometryWorkshopGamePreview; // Game shader, lighting and texture bridge shared by both views.
  const camera = new T.PerspectiveCamera(39, 1, 0.02, 2000); // Identical camera for both geometries.
  let renderer = null; // One WebGL context shared by both views.
  try { renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' }); }
  catch (error) {
    $('busy').textContent = '3D preview unavailable';
    $('loading-note').textContent = 'WebGL initialization failed: ' + (error?.message || error);
    return;
  }
  let lastWidth = 0, lastHeight = 0; // Avoid resizing/reallocating the canvas on every animation frame.
  const controls = T.OrbitControls ? new T.OrbitControls(camera, renderer.domElement) : null; // Touch-friendly orbital review.
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.outputEncoding = T.LinearEncoding; // Live game r128 output is linear; sRGB would double-convert authored colors.
  renderer.autoClear = true;
  host.appendChild(renderer.domElement);
  if (controls) {
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.screenSpacePanning = true;
  }
  function prepareScene(scene) {
    scene.background = new T.Color(0x162118); // Placeholder until the actual game lighting is installed.
    const grid = new T.GridHelper(20, 20, 0x36556a, 0x263746);
    grid.material.opacity = 0.25;
    grid.material.transparent = true;
    scene.add(grid);
  }
  prepareScene(sceneA);
  prepareScene(sceneB);
  function log(line, error = false) {
    messages.unshift(new Date().toLocaleTimeString() + (error ? ' ERROR ' : ' ') + String(line));
    if (messages.length > 50) messages.length = 50;
    $('log').textContent = messages.join('\n');
    $('busy').textContent = error ? 'Error — see diagnostics' : line;
    $('busy').style.color = error ? '#fda4af' : '#9ae6cc';
  }
  const renderPreview = RenderPreview?.build?.(renderer, [sceneA, sceneB], camera, host, (message, error) => {
    $('game-render-status').textContent = message; // On-screen mobile-friendly report; never silently fake game parity.
    log(message, error);
  });
  if (!renderPreview) log('Game preview adapter missing; displaying original material data without shell outlines.', true);
  else renderPreview.init().catch(error => log('Game render initialization failed: ' + error.message, true));
  function displayPath() {
    const kind = $('source-kind').value;
    return kind === 'repository' ? $('repo-path').value.trim() : $('game-source-path').value.trim();
  }
  function addDisplay(scene, root) {
    if (!root) return null;
    const display = renderPreview?.decorate(root, displayPath(), $('game-surfaces').checked, $('sample-body-color').value) || root.clone(true);
    scene.add(display);
    return display;
  }
  function rebuildDisplays() {
    renderPreview?.disposeDisplay(sceneA, displayOriginal);
    renderPreview?.disposeDisplay(sceneB, displayCandidate);
    displayOriginal = addDisplay(sceneA, original);
    displayCandidate = addDisplay(sceneB, candidate);
    $('game-surface-status').textContent = $('game-surfaces').checked
      ? 'Game hand/foot PNG material roles · representative body tint ' + $('sample-body-color').value + ' · display-only'
      : 'Source GLB embedded materials · display-only, no overrides';
  }
  function setBusy(value) {
    updating = value;
    $('load').disabled = value;
    $('update').disabled = value;
    // A preview must be built with exactly the controls shown at export time.
    // Lock settings during asynchronous processing so sliders cannot invalidate a request mid-flight.
    for (const id of ['source-kind', 'repo-preset', 'repo-path', 'generator', 'seed', 'file', 'pick-scope',
      'pick-game', 'remesh', 'edge-size', 'reduction', 'error', 'protect-cards', 'quality-tier', 'game-source-path',
      'game-surfaces', 'sample-body-color']) $(id).disabled = value;
    $('export').disabled = value || !candidateMatchesControls || !candidate || !original || !Core.preservedMaterials(original,candidate);
    $('export-json').disabled = $('export').disabled;
  }
  function titleText(node) {
    return (node.name || 'unnamed mesh').slice(0, 72);
  }
  function listMaterials(root) {
    const count = new Map();
    root?.traverse(node => {
      if (!node.isMesh) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) {
        const name = m?.name || m?.type || '(no material)';
        count.set(name, (count.get(name) || 0) + 1);
      }
    });
    const lines = [...count.entries()].slice(0, 16).map(([name, n]) => name + (n > 1 ? ' ×' + n : ''));
    if (count.size > 16) lines.push('…' + (count.size - 16) + ' more');
    $('materials').textContent = 'Material slots (' + count.size + ' distinct names): ' + (lines.join(', ') || 'none');
  }
  function fitCamera(object) {
    object.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new T.Vector3());
    const size = box.getSize(new T.Vector3());
    const radius = Math.max(size.length(), 0.1);
    camera.near = Math.max(0.001, radius / 1000);
    camera.far = Math.max(100, radius * 70);
    camera.position.copy(center).add(new T.Vector3(radius * 1.0, radius * 0.56, radius * 1.25));
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    if (controls) { controls.target.copy(center); controls.update(); }
  }
  function resize() {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    if (w !== lastWidth || h !== lastHeight) { renderer.setSize(w, h, false); lastWidth = w; lastHeight = h; }
    camera.aspect = Math.max(0.1, (w / 2) / h);
    camera.updateProjectionMatrix();
  }
  function draw() {
    requestAnimationFrame(draw);
    if (!host.clientWidth || !host.clientHeight || document.hidden) return;
    resize();
    controls?.update();
    // WebGLRenderer.setViewport/setScissor take CSS pixels and scale internally;
    // drawing-buffer dimensions would double the offsets on high-DPI mobile.
    const w = host.clientWidth, h = host.clientHeight;
    if (renderPreview) renderPreview.render(w, h);
    else {
      const half = Math.floor(w / 2);
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, half, h);
      renderer.setScissor(0, 0, half, h);
      renderer.render(sceneA, camera);
      renderer.setViewport(half, 0, w - half, h);
      renderer.setScissor(half, 0, w - half, h);
      renderer.render(sceneB, camera);
      renderer.setScissorTest(false);
    }
  }
  function disposeImported(rootObject) {
    if (!rootObject) return;
    const geometries = new Set(); // Independent imported mesh buffers released on source replacement.
    const materials = new Set(); // Imported glTF materials may be shared among meshes in the same file.
    const textures = new Set(); // Maps/textures owned by those imported materials only.
    rootObject.traverse(node => {
      if (!node.isMesh) return;
      if (node.geometry) geometries.add(node.geometry);
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (!material) continue;
        materials.add(material);
        for (const key of ['map', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'displacementMap', 'lightMap', 'envMap', 'clearcoatMap', 'clearcoatNormalMap', 'transmissionMap']) {
          if (material[key]?.isTexture) textures.add(material[key]);
        }
      }
    });
    for (const geometry of geometries) geometry.dispose?.();
    for (const material of materials) material.dispose?.();
    for (const texture of textures) texture.dispose?.();
  }
  function releaseOriginal() {
    if (!original) return;
    renderPreview?.disposeDisplay(sceneA, displayOriginal);
    displayOriginal = null;
    if (originalOwnsResources) disposeImported(original);
    original = null;
    originalOwnsResources = false;
  }
  function disposeCandidate() {
    if (!candidate) return;
    renderPreview?.disposeDisplay(sceneB, displayCandidate);
    displayCandidate = null;
    // Candidate clones may share geometries with original on skipped meshes.
    const owned = new Set();
    original?.traverse?.(node => { if (node.isMesh && node.geometry) owned.add(node.geometry); });
    candidate.traverse(node => { if (node.isMesh && node.geometry && !owned.has(node.geometry)) node.geometry.dispose(); });
    candidate = null;
  }
  function showStats(result) {
    const before = result.source, after = result.result;
    const percent = before.triangles ? ((1 - after.triangles / before.triangles) * 100).toFixed(1) : '0';
    $('summary').textContent = before.triangles.toLocaleString() + ' → ' + after.triangles.toLocaleString() +
      ' triangles (' + percent + '% reduction); ' +
      before.vertices.toLocaleString() + ' → ' + after.vertices.toLocaleString() + ' vertices; ' +
      after.meshes + ' mesh(es), ' + after.materialSlots + ' material slots.';
    const safe = Core.preservedMaterials(original, candidate);
    const processingRequested = $('remesh').checked || Number($('reduction').value) > 0;
    const meaningfulResult = !processingRequested || result.details.length > 0; // No-op/unsupported outputs must not be labeled optimized exports.
    $('materials').textContent = (safe ? '✓ Materials and group assignments preserved. ' : '⚠ Material assignments changed — export disabled. ') +
      $('materials').textContent;
    for (const note of result.warnings) log(note, false);
    candidateMatchesControls = safe && meaningfulResult; // Export approval belongs to this completed preview and applied processing.
    latestResult = candidateMatchesControls ? result : null; // Only current measured geometry may be described by exported quality profiles.
    $('export').disabled = !candidateMatchesControls;
    $('export-json').disabled = !candidateMatchesControls;
    if (!safe) log('Material preservation validation failed', true);
    else if (!meaningfulResult) log('No processable geometry was changed; export disabled. Check diagnostics or reduce protection.', true);
    else log('Preview built. Actual triangle reduction: ' + percent + '%.');
  }
  async function updatePreview() {
    if (!original) { log('Load an object first.', true); return; }
    const version = ++generation;
    candidateMatchesControls = false; // A failed reprocess must never leave stale export enabled.
    latestResult = null;
    setBusy(true);
    try {
      const options = {
        remesh: $('remesh').checked,
        edgePercent: Number($('edge-size').value),
        reduction: Number($('reduction').value),
        errorTolerance: Number($('error').value) / 100,
        protectCards: $('protect-cards').checked,
      }; // Editable preview parameters, never written to gameplay configuration.
      log('Processing ' + sourceName + '…');
      const result = await Core.process(original, options);
      if (version !== generation) return;
      disposeCandidate();
      candidate = result.object;
      displayCandidate = addDisplay(sceneB, candidate);
      listMaterials(original);
      showStats(result);
      $('loading-note').textContent = 'Original and preview use the same camera and material definitions.';
    } catch (error) {
      if (version === generation) log('Preview failed: ' + (error?.message || error), true);
    } finally {
      if (version === generation) setBusy(false);
    }
  }
  function populateSources() {
    for (const path of assetPaths) {
      const entry = document.createElement('option');
      entry.value = path;
      entry.textContent = path.replace('assets/models/', '');
      $('repo-preset').appendChild(entry);
    }
    for (const name of builderNames) {
      const entry = document.createElement('option');
      entry.value = 'foliage:' + name;
      entry.textContent = 'Foliage: ' + name.replace(/^build/, '').replace(/Mesh$/, '');
      $('generator').appendChild(entry);
    }
    for (const name of Object.keys(window.ProceduralFurniture?.CATALOG || {}).sort()) {
      const entry = document.createElement('option');
      entry.value = 'furniture:' + name;
      entry.textContent = 'Furniture: ' + name;
      $('generator').appendChild(entry);
    }
  }
  function showSourceKind() {
    const kind = $('source-kind').value;
    for (const key of ['repository', 'generated', 'local', 'live']) $('source-' + key).hidden = key !== kind;
  }
  async function parseGLB(data) {
    return new Promise((resolve, reject) => {
      new T.GLTFLoader().parse(data, '', gltf => {
        if (!gltf?.scene) return reject(new Error('GLB contains no scene'));
        resolve(gltf.scene);
      }, reject);
    });
  }
  function buildGenerated() {
    const [family, name] = $('generator').value.split(':');
    const seed = Math.max(-10000, Math.min(10000, Math.trunc(Number($('seed').value) || 0)));
    if (family === 'furniture') {
      if (!Object.hasOwn(window.ProceduralFurniture?.CATALOG || {}, name)) throw new Error('Unknown procedural furniture recipe');
      return window.ProceduralFurniture.buildFurnitureGroup(name, 0x99765d);
    }
    if (family === 'foliage' && builderNames.includes(name) && typeof window.FoliageGenerator?.[name] === 'function') {
      if (name === 'buildNeedlegrainMesh' || name === 'buildHeftrootMesh') return window.FoliageGenerator[name](0.8, seed, seed + 1);
      return window.FoliageGenerator[name](seed, seed + 1);
    }
    throw new Error('Unknown game mesh generator');
  }
  function findGame() {
    const parent = window.parent !== window ? window.parent : null;
    const candidates = [linkedGame, window.opener]; // Same-origin games launched from the workshop.
    try { if (parent) candidates.push(parent.__hobunjiToolsGameWindow, parent.opener); } catch (_) { /* Cross-origin embedding must not break the tool. */ }
    for (const game of candidates) {
      try {
        if (game && !game.closed && game !== window && game.THREE && game.GridTileAccessors?.getActiveScene) return game;
      } catch (_) { /* Other origin: never access it. */ }
    }
    return null;
  }
  function pickStatus(message, error = false) {
    $('live-status').textContent = message;
    log(message, error);
  }
  function openLinkedGame() {
    const current = findGame();
    if (current) { try { current.focus(); } catch (_) {} pickStatus('Linked game tab focused.'); return; }
    linkedGame = window.open('index.html', '_blank');
    pickStatus(linkedGame ? 'Linked game opened. Enter a world, enable Dev Mode, then return here to arm picking.' : 'Browser blocked the game tab. Enable popups and try again.', !linkedGame);
  }
  function cancelPick() {
    if (!activePick) return;
    const entry = activePick;
    activePick = null;
    try {
      entry.canvas.removeEventListener('pointerdown', entry.onPointer, true);
      entry.game.removeEventListener('keydown', entry.onKey, true);
    } catch (_) {}
  }
  async function loadGameExporter(game) {
    if (game.THREE?.GLTFExporter) return;
    await new Promise((resolve, reject) => {
      const script = game.document.createElement('script'); // Game uses its own Three.js realm for correct material/geometry serialization.
      script.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/exporters/GLTFExporter.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load GLTFExporter into the game tab'));
      game.document.head.appendChild(script);
    });
    if (!game.THREE.GLTFExporter) throw new Error('GLTFExporter did not initialize in the game tab');
  }
  async function capturePicked(game, hit, scene) {
    let target = hit.object;
    if ($('pick-scope').value === 'group') {
      for (let node = target.parent; node && node !== scene && !node.isScene; node = node.parent) {
        if (!node.name || !node.children?.length) continue;
        const meshCount = Core.stats(node);
        if (meshCount.meshes > 1 && meshCount.triangles <= Core.MAX_OUTPUT_TRIANGLES) {
          target = node; break;
        }
      }
    }
    const counts = Core.stats(target);
    if (!counts.meshes || counts.triangles > Core.MAX_OUTPUT_TRIANGLES) throw new Error('Pick a smaller object; this capture exceeds the mobile mesh budget.');
    const custom = [];
    target.traverse(node => {
      if (!node.isMesh) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      if (mats.some(mat => mat?.isShaderMaterial || mat?.isRawShaderMaterial)) custom.push(node.name || 'unnamed mesh');
    });
    if (custom.length) throw new Error('Cannot serialize custom shader materials without losing their appearance. Choose an authored/standard-material mesh instead.');
    await loadGameExporter(game);
    const bytes = await new Promise((resolve, reject) => {
      game.THREE.GLTFExporter && new game.THREE.GLTFExporter().parse(target, result => {
        if (!(result instanceof game.ArrayBuffer)) return reject(new Error('Game exporter returned non-binary data'));
        resolve(result);
      }, { binary: true, onlyVisible: true, includeCustomExtensions: true });
    });
    liveBuffer = Uint8Array.from(new Uint8Array(bytes)).buffer; // Convert the game window's ArrayBuffer into this frame's realm before parsing.
    liveName = (target.name || target.type || 'game-mesh') + '.glb';
    pickStatus('Captured ' + counts.triangles.toLocaleString() + ' triangles from ' + (target.name || 'game mesh') + '. Building preview…');
    $('source-kind').value = 'live';
    showSourceKind();
    await loadCurrent();
  }
  function armGamePick() {
    cancelPick();
    const game = findGame();
    if (!game) { pickStatus('No linked game tab found. Use Open linked game and enable Dev Mode there.', true); return; }
    const dev = game.document.getElementById('settingDevMode')?.checked;
    if (!dev) { pickStatus('Enable Dev Mode in the game Settings before selecting scene geometry.', true); return; }
    const scene = game.GridTileAccessors.getActiveScene();
    const camera = game.Combat?.deps?.getActiveCamera?.() || game.BanditCombat?.deps?.getActiveCamera?.() || game.DevRandomRuinInteractions?.activeCamera?.();
    const canvas = game.__hobunjiGameRenderer?.domElement;
    if (!scene?.isScene || !camera || !canvas) { pickStatus('Game renderer not ready. Enter a playable area first.', true); return; }
    const onKey = event => { if (event.key === 'Escape') { cancelPick(); pickStatus('Game mesh selection cancelled.'); } };
    const onPointer = event => {
      event.preventDefault();
      event.stopImmediatePropagation?.();
      cancelPick();
      try {
        const bounds = canvas.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width * 2 - 1;
        const y = -(event.clientY - bounds.top) / bounds.height * 2 + 1;
        const ray = new game.THREE.Raycaster();
        ray.setFromCamera(new game.THREE.Vector2(x,y), camera);
        const hit = ray.intersectObjects(scene.children, true).find(item =>
          item.object?.isMesh && item.object.geometry && item.object.visible !== false &&
          !item.object.userData?.furniturePattern && item.object.material);
        if (!hit) { pickStatus('No mesh at that position. Arm selection again and tap a solid object.', true); return; }
        capturePicked(game, hit, scene).catch(error => pickStatus('Capture failed: ' + (error?.message || error), true));
      } catch (error) { pickStatus('Mesh pick failed: ' + (error?.message || error), true); }
    };
    activePick = { game, canvas, onKey, onPointer };
    canvas.addEventListener('pointerdown', onPointer, true);
    game.addEventListener('keydown', onKey, true);
    pickStatus('Pick armed. Switch to the game tab and tap a 3D mesh; the workshop will receive its GLB.');
    try { game.focus(); } catch (_) {}
  }

  async function loadCurrent() {
    if (updating) return;
    const token = ++generation;
    setBusy(true);
    let next = null, name = '', ownsResources = false; // Staged source is released if loading fails or another selection wins.
    try {
      const kind = $('source-kind').value;
      ownsResources = kind !== 'generated'; // The shared procedural generator cache owns generated source resources.
      switch (kind) {
        case 'local': {
          const file = $('file').files?.[0];
          if (!file || !/\.glb$/i.test(file.name)) throw new Error('Choose a .glb file to load.');
          if (file.size > 32 * 1024 * 1024) throw new Error('GLB exceeds the 32 MB preview limit.');
          next = await parseGLB(await file.arrayBuffer());
          name = file.name;
          break;
        }
        case 'live':
          if (!liveBuffer) throw new Error('Pick a visible game mesh first.');
          next = await parseGLB(liveBuffer);
          name = liveName || 'live-mesh.glb';
          break;
        case 'generated':
          name = $('generator').value + '_seed-' + $('seed').value;
          next = buildGenerated();
          break;
        case 'repository': {
          const path = $('repo-path').value.trim();
          if (!/^assets\/models\/[a-zA-Z0-9_./-]+\.glb$/i.test(path) || path.includes('..')) throw new Error('Use a repository path under assets/models/ ending in .glb.');
          const response = await fetch(path);
          if (!response.ok) throw new Error('Asset fetch failed: HTTP ' + response.status + ' (' + path + ')');
          const data = await response.arrayBuffer();
          if (data.byteLength > 32 * 1024 * 1024) throw new Error('GLB exceeds the 32 MB preview limit.');
          next = await parseGLB(data);
          name = path.split('/').pop();
          break;
        }
        default: throw new Error('Unsupported source selection');
      }
      if (!next?.traverse || !Core.stats(next).meshes) throw new Error('Source contains no triangle meshes');
      if (token !== generation) { if (ownsResources) disposeImported(next); return; }
      disposeCandidate();
      candidateMatchesControls = false; // Old source/preview export is invalid once a new object is selected.
      latestResult = null;
      $('game-source-path').value = kind === 'repository' ? $('repo-path').value.trim() : '';
      $('json-download').replaceChildren();
      if (profileUrl) { URL.revokeObjectURL(profileUrl); profileUrl = null; }
      releaseOriginal();
      original = next;
      originalOwnsResources = ownsResources;
      original.name ||= name;
      sourceName = name;
      displayOriginal = addDisplay(sceneA, original);
      $('manual-download').replaceChildren();
      if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
      fitCamera(original);
      listMaterials(original);
      $('summary').textContent = Core.stats(original).triangles.toLocaleString() + ' source triangles. Processing…';
      log('Loaded ' + name);
    } catch (error) {
      if (next && ownsResources && next !== original) disposeImported(next);
      if (token === generation) log('Load failed: ' + (error?.message || error), true);
      return;
    } finally {
      if (token === generation) setBusy(false);
    }
    await updatePreview();
  }
  function optimizedFilename() {
    return sourceName.replace(/\.glb$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_') +
      ($('remesh').checked ? '_remeshed' : '') + '_lod-' + $('reduction').value + '.glb';
  }
  function exportQualityJson() {
    if (!candidateMatchesControls || !latestResult || updating) return;
    const quality = window.GeometryQuality; // Shared, strict schema with the game-side profile importer.
    const source = $('game-source-path').value.trim();
    const tier = $('quality-tier').value;
    if (!quality?.modelPath(source) || !quality.TIERS.includes(tier)) {
      log('Enter a valid gameplay source path under assets/models/ ending in .glb.', true);
      $('diagnostics').open = true;
      return;
    }
    const optimized = source.slice(0, source.lastIndexOf('/') + 1) + optimizedFilename();
    const settings = {
      remesh: $('remesh').checked,
      edgePercent: Number($('edge-size').value),
      reductionPercent: Number($('reduction').value),
      maximumErrorPercent: Number($('error').value),
      preserveTransparentCards: $('protect-cards').checked,
    }; // Metadata documents the exact workshop preview used to bake the optimized model.
    const report = {
      schema: quality.SCHEMA,
      profiles: [{
        source,
        variants: { [tier]: optimized },
        metadata: {
          sourceType: $('source-kind').value,
          generatedFrom: $('source-kind').value === 'generated' ? {
            generator: $('generator').value, seed: Number($('seed').value),
          } : null,
          sourceTriangles: latestResult.source.triangles,
          outputTriangles: latestResult.result.triangles,
          sourceVertices: latestResult.source.vertices,
          outputVertices: latestResult.result.vertices,
          actualReductionPercent: Number((100 * (1 - latestResult.result.triangles / Math.max(1,latestResult.source.triangles))).toFixed(2)),
          materialSlots: latestResult.result.materialSlots,
          workshopSettings: settings,
        },
      }],
    };
    try {
      quality.validate(report); // Exported documents can be imported by the game without editing schema fields.
      if (profileUrl) URL.revokeObjectURL(profileUrl);
      profileUrl = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + '\n'], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = profileUrl;
      link.download = optimizedFilename().replace(/\.glb$/, '_quality-' + tier + '.json');
      link.textContent = 'Tap to save ' + link.download;
      $('json-download').replaceChildren(link);
      link.click();
      log('Exported quality JSON for ' + tier + '. Publish ' + optimized + ' alongside its profile to use it in-game.');
    } catch (error) {
      log('Quality JSON failed: ' + (error?.message || error), true);
      $('diagnostics').open = true;
    }
  }
  async function exportGLB() {
    if (!candidate || !candidateMatchesControls || updating || !Core.preservedMaterials(original, candidate)) return;
    const unsupported = [];
    candidate.traverse(node => {
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (materials.some(m => m?.isShaderMaterial || m?.isRawShaderMaterial)) unsupported.push(titleText(node));
    });
    if (unsupported.length) {
      log('Export refused: GLB cannot preserve custom shader materials on ' + unsupported.slice(0, 4).join(', ') + '. Preview remains available.', true);
      $('diagnostics').open = true;
      return;
    }
    setBusy(true);
    try {
      const buffer = await new Promise((resolve, reject) => {
        new T.GLTFExporter().parse(candidate, data => {
          if (!(data instanceof ArrayBuffer)) return reject(new Error('Exporter returned non-binary data'));
          resolve(data);
        }, { binary: true, onlyVisible: true, includeCustomExtensions: true });
      });
      const filename = optimizedFilename();
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      link.textContent = 'Tap to save ' + filename;
      $('manual-download').replaceChildren(link);
      link.click(); // Browser may suppress this on mobile; manual link remains available.
      log('Exported ' + filename + ' (' + buffer.byteLength.toLocaleString() + ' bytes).');
    } catch (error) {
      log('GLB export failed: ' + (error?.message || error), true);
      $('diagnostics').open = true;
    } finally { setBusy(false); }
  }
  populateSources();
  showSourceKind();
  $('source-kind').addEventListener('change', showSourceKind);
  $('repo-preset').addEventListener('change', () => { $('repo-path').value = $('repo-preset').value; });
  $('load').addEventListener('click', loadCurrent);
  $('open-game').addEventListener('click', openLinkedGame);
  $('pick-game').addEventListener('click', armGamePick);
  // Pagehide cleanup above also cancels an armed live pick.
  $('update').addEventListener('click', updatePreview);
  function invalidatePreview() {
    candidateMatchesControls = false; // Sliders/input changes invalidate the candidate until Update preview succeeds.
    $('export').disabled = true;
    $('export-json').disabled = true;
    latestResult = null;
    if (candidate) $('loading-note').textContent = 'Settings changed. Update preview before exporting.';
  }
  for (const id of ['remesh','edge-size','reduction','error','protect-cards']) $(id).addEventListener('input', invalidatePreview);
  $('export').addEventListener('click', exportGLB);
  $('export-json').addEventListener('click', exportQualityJson);
  $('game-lighting').addEventListener('change', () => renderPreview?.setMode($('game-lighting').value));
  for (const id of ['game-surfaces', 'sample-body-color']) $(id).addEventListener('change', () => {
    if (!updating) rebuildDisplays(); // Only scene materials change; optimized geometry/export stays unmodified.
  }); // Color pickers can emit dozens of input events; build tinted CanvasTextures only once on commit.
  window.addEventListener('pagehide', () => {
    cancelPick();
    disposeCandidate();
    releaseOriginal();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    if (profileUrl) URL.revokeObjectURL(profileUrl);
    renderPreview?.dispose();
    renderer.dispose();
  });
  $('copy-report').addEventListener('click', async () => {
    const report = sourceName + '\n' + $('summary').textContent + '\n' + $('materials').textContent + '\n' + $('log').textContent;
    try { await navigator.clipboard.writeText(report); log('Report copied.'); }
    catch (e) { $('diagnostics').open = true; $('log').focus(); log('Clipboard unavailable; select the text above to copy.', true); }
  });
  for (const [id, output, suffix] of [['edge-size', 'edge-out', '%'], ['reduction', 'reduction-out', '%'], ['error', 'error-out', '%']]) {
    $(id).addEventListener('input', () => { $(output).textContent = $(id).value + suffix; });
  }
  if (!window.MeshoptSimplifier?.supported) log('Meshoptimizer WASM unavailable. Remeshing works; decimation requires WebAssembly.', true);
  else log('Material-safe meshoptimizer loaded; previews are non-destructive.');
  draw();
  loadCurrent();
})();
