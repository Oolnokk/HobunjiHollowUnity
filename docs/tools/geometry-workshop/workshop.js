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
  let sourceName = 'model'; // Name for diagnostics and exported GLB files.
  let generation = 0; // Invalidates stale async loads and recomputations.
  let updating = false; // Disables competing export operations while a preview is building.
  const host = $('canvas-host'); // In-tool shared WebGL comparison viewport.
  const sceneA = new T.Scene(), sceneB = new T.Scene(); // Isolated views; original and candidate never overlap.
  const camera = new T.PerspectiveCamera(39, 1, 0.02, 2000); // Identical camera for both geometries.
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' }); // One context for two comparison views.
  let lastWidth = 0, lastHeight = 0; // Avoid resizing/reallocating the canvas on every animation frame.
  const controls = T.OrbitControls ? new T.OrbitControls(camera, renderer.domElement) : null; // Touch-friendly orbital review.
  if (!Core || !T.GLTFLoader || !T.GLTFExporter || !T.WebGLRenderer) {
    $('busy').textContent = 'Missing dependency';
    $('loading-note').textContent = 'Three.js, GLTFLoader or mesh processing failed to load.';
    return;
  }
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.autoClear = true;
  host.appendChild(renderer.domElement);
  if (controls) {
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.screenSpacePanning = true;
  }
  function prepareScene(scene) {
    scene.background = new T.Color(0x111d2a);
    scene.add(new T.HemisphereLight(0xe3efff, 0x324052, 1.5));
    const key = new T.DirectionalLight(0xffffff, 1.12);
    key.position.set(3, 8, 5);
    scene.add(key);
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
  function setBusy(value) {
    updating = value;
    $('load').disabled = value;
    $('update').disabled = value;
    $('export').disabled = value || !candidate || !original || !Core.preservedMaterials(original,candidate);
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
    const w = renderer.domElement.width, h = renderer.domElement.height;
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
  function disposeCandidate() {
    if (!candidate) return;
    sceneB.remove(candidate);
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
    $('materials').textContent = (safe ? '✓ Materials and group assignments preserved. ' : '⚠ Material assignments changed — export disabled. ') +
      $('materials').textContent;
    for (const note of result.warnings) log(note, false);
    $('export').disabled = !safe;
    if (!safe) log('Material preservation validation failed', true);
    else log('Preview built. Actual triangle reduction: ' + percent + '%.');
  }
  async function updatePreview() {
    if (!original) { log('Load an object first.', true); return; }
    const version = ++generation;
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
      sceneB.add(candidate);
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
    for (const key of ['repository', 'generated', 'local']) $('source-' + key).hidden = key !== kind;
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
  async function loadCurrent() {
    if (updating) return;
    const token = ++generation;
    setBusy(true);
    try {
      let next, name;
      switch ($('source-kind').value) {
        case 'local': {
          const file = $('file').files?.[0];
          if (!file || !/\.glb$/i.test(file.name)) throw new Error('Choose a .glb file to load.');
          if (file.size > 32 * 1024 * 1024) throw new Error('GLB exceeds the 32 MB preview limit.');
          next = await parseGLB(await file.arrayBuffer());
          name = file.name;
          break;
        }
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
      if (token !== generation) return;
      disposeCandidate();
      if (original) sceneA.remove(original);
      original = next;
      original.name ||= name;
      sourceName = name;
      sceneA.add(original);
      fitCamera(original);
      listMaterials(original);
      $('summary').textContent = Core.stats(original).triangles.toLocaleString() + ' source triangles. Processing…';
      log('Loaded ' + name);
    } catch (error) {
      if (token === generation) log('Load failed: ' + (error?.message || error), true);
      return;
    } finally {
      if (token === generation) setBusy(false);
    }
    await updatePreview();
  }
  async function exportGLB() {
    if (!candidate || updating || !Core.preservedMaterials(original, candidate)) return;
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
      const filename = sourceName.replace(/\.glb$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_') +
        ($('remesh').checked ? '_remeshed' : '') + '_lod-' + $('reduction').value + '.glb';
      const url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
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
  $('update').addEventListener('click', updatePreview);
  $('export').addEventListener('click', exportGLB);
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
