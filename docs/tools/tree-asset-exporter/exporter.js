(() => {
  'use strict';

  const THREE = window.THREE;
  const Foliage = window.FoliageGenerator;
  const Library = window.TreeAssetLibrary;
  const ASSETS = Library?.ASSETS || [];
  const listEl = document.getElementById('asset-list');
  const viewport = document.getElementById('viewport');
  const statusEl = document.getElementById('status');
  const readyPill = document.getElementById('ready-pill');
  const exportAllBtn = document.getElementById('export-all');
  const exportOneBtn = document.getElementById('export-one');
  const titleEl = document.getElementById('preview-title');
  const metaEl = document.getElementById('preview-meta');
  const decimateRange = document.getElementById('decimate-percent');
  const decimateValue = document.getElementById('decimate-value');
  const decimateStats = document.getElementById('decimate-stats');

  let selected = ASSETS[0] || null;
  let previewObject = null;
  let busy = false;
  let previewGeneration = 0;

  function setStatus(text, cls = '') {
    statusEl.textContent = text;
    statusEl.className = cls;
  }

  function prettySpecies(species) {
    return String(species || '').split('_').map(s => s ? s[0].toUpperCase() + s.slice(1) : '').join(' ');
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(95, Number(value) || 0));
  }

  function decimationPercent() {
    return clampPercent(decimateRange?.value);
  }

  function exportFilename(entry) {
    const reduction = decimationPercent();
    if (!reduction) return entry.filename;
    const base = String(entry.filename || 'tree.glb').replace(/\.glb$/i, '');
    return `${base}_lod-decimate-${reduction}.glb`;
  }

  function updateDecimationUi() {
    const reduction = decimationPercent();
    if (decimateValue) decimateValue.textContent = `${reduction}%`;
    if (decimateStats && !busy) {
      decimateStats.textContent = reduction
        ? `Target: keep ${100 - reduction}% of triangles`
        : 'Original geometry';
    }
    exportAllBtn.textContent = reduction ? 'Export all 6 LODs as ZIP' : 'Export all 6 as ZIP';
    exportOneBtn.textContent = reduction ? 'Export selected LOD GLB' : 'Export selected GLB';
  }

  function builderFor(entry) {
    const fn = Foliage?.[entry?.builder];
    if (typeof fn !== 'function') throw new Error(`Missing FoliageGenerator.${entry?.builder || '?'}`);
    return fn;
  }

  function buildSource(entry) {
    const object = builderFor(entry)(entry.seed);
    if (!object) throw new Error(`${entry.builder}(${entry.seed}) returned no object`);
    object.name = `${entry.species}_${String(entry.variant).padStart(2, '0')}`;
    object.updateMatrixWorld?.(true);
    object.traverse?.(child => {
      if (!child?.isMesh) return;
      child.userData = { ...(child.userData || {}), treeSpecies: entry.species, treeVariant: entry.variant };
      // GLTFExporter serializes userData as glTF extras, preserving noOutline
      // on flat leaf-card meshes for the runtime's selective outline pass.
    });
    return object;
  }

  function renderRows() {
    listEl.innerHTML = ASSETS.map(entry => {
      const selectedClass = selected === entry ? ' selected' : '';
      const icon = entry.species === 'shadewood' ? '🌳' : '🌲';
      return `<div class="asset-row${selectedClass}" data-species="${entry.species}" data-variant="${entry.variant}">
        <div class="tree-icon">${icon}</div>
        <div><div class="asset-name">${prettySpecies(entry.species)} · variant ${entry.variant}</div><div class="asset-file">${entry.filename}</div></div>
        <div class="seed">seed ${entry.seed}</div>
      </div>`;
    }).join('');
    listEl.querySelectorAll('.asset-row').forEach(row => row.addEventListener('click', () => {
      const species = row.dataset.species;
      const variant = Number(row.dataset.variant);
      selected = ASSETS.find(entry => entry.species === species && entry.variant === variant) || selected;
      renderRows();
      showPreview(selected);
    }));
  }

  if (!THREE || !Foliage || !Library || !window.JSZip || !THREE.GLTFExporter || !window.MeshoptSimplifier) {
    readyPill.textContent = 'Missing dependency';
    setStatus('Exporter dependencies failed to load. Check network/CDN access and reload.', 'status-bad');
    exportAllBtn.disabled = true;
    exportOneBtn.disabled = true;
    if (decimateRange) decimateRange.disabled = true;
    return;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
  camera.position.set(4.2, 3.2, 5.5);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = false;
  viewport.appendChild(renderer.domElement);

  const controls = THREE.OrbitControls ? new THREE.OrbitControls(camera, renderer.domElement) : null;
  if (controls) {
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.target.set(0, 1.1, 0);
  }

  scene.add(new THREE.HemisphereLight(0xddeeff, 0x263321, 1.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(4, 7, 5);
  scene.add(key);
  const grid = new THREE.GridHelper(12, 24, 0x365068, 0x24384b);
  grid.material.transparent = true;
  grid.material.opacity = 0.45;
  scene.add(grid);

  function resize() {
    const w = Math.max(1, viewport.clientWidth);
    const h = Math.max(1, viewport.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(viewport);
  resize();

  function fitCamera(object) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.25);
    camera.position.set(center.x + radius * 1.35, center.y + radius * 0.75, center.z + radius * 1.65);
    camera.near = Math.max(0.005, radius / 100);
    camera.far = Math.max(50, radius * 25);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(center);
      controls.update();
    } else camera.lookAt(center);
  }

  function triangleCount(object) {
    let triangles = 0;
    object?.traverse?.(child => {
      if (!child?.isMesh || !child.geometry) return;
      const geometry = child.geometry;
      if (geometry.index) triangles += Math.floor(geometry.index.count / 3);
      else triangles += Math.floor((geometry.getAttribute('position')?.count || 0) / 3);
    });
    return triangles;
  }

  function isLeafCardMesh(mesh) {
    const geometry = mesh?.geometry;
    const position = geometry?.getAttribute?.('position');
    const uv = geometry?.getAttribute?.('uv');
    const index = geometry?.index;
    if (!mesh?.userData?.noOutline || !position || !uv || !index) return false;
    return position.count >= 4
      && position.count % 4 === 0
      && index.count % 6 === 0
      && position.count / 4 === index.count / 6;
  }

  function subsetAttribute(attribute, usedOldIndices) {
    if (attribute?.isInterleavedBufferAttribute) {
      throw new Error('LOD decimation does not support interleaved tree vertex attributes');
    }
    const itemSize = attribute.itemSize;
    const SourceArray = attribute.array.constructor;
    const output = new SourceArray(usedOldIndices.length * itemSize);
    for (let dstIndex = 0; dstIndex < usedOldIndices.length; dstIndex++) {
      const srcIndex = usedOldIndices[dstIndex];
      const srcOffset = srcIndex * itemSize;
      const dstOffset = dstIndex * itemSize;
      for (let component = 0; component < itemSize; component++) {
        output[dstOffset + component] = attribute.array[srcOffset + component];
      }
    }
    const result = new THREE.BufferAttribute(output, itemSize, attribute.normalized);
    result.name = attribute.name || '';
    return result;
  }

  function compactGeometry(sourceGeometry, sourceIndices) {
    const position = sourceGeometry.getAttribute('position');
    const oldToNew = new Int32Array(position.count);
    oldToNew.fill(-1);
    const usedOldIndices = [];
    const remappedIndices = new Array(sourceIndices.length);

    for (let i = 0; i < sourceIndices.length; i++) {
      const oldIndex = sourceIndices[i];
      let newIndex = oldToNew[oldIndex];
      if (newIndex < 0) {
        newIndex = usedOldIndices.length;
        oldToNew[oldIndex] = newIndex;
        usedOldIndices.push(oldIndex);
      }
      remappedIndices[i] = newIndex;
    }

    const IndexArray = usedOldIndices.length > 65535 ? Uint32Array : Uint16Array;
    const outputIndices = new IndexArray(remappedIndices);
    const output = sourceGeometry.clone();

    for (const name of Object.keys(sourceGeometry.attributes)) {
      output.setAttribute(name, subsetAttribute(sourceGeometry.getAttribute(name), usedOldIndices));
    }

    output.morphAttributes = {};
    for (const [name, attributes] of Object.entries(sourceGeometry.morphAttributes || {})) {
      output.morphAttributes[name] = attributes.map(attribute => subsetAttribute(attribute, usedOldIndices));
    }

    output.clearGroups();
    output.setIndex(new THREE.BufferAttribute(outputIndices, 1));
    output.setDrawRange(0, outputIndices.length);
    output.boundingBox = null;
    output.boundingSphere = null;
    output.computeBoundingBox();
    output.computeBoundingSphere();
    return output;
  }

  function thinLeafCards(mesh, reductionPercent) {
    const geometry = mesh.geometry;
    const cardCount = geometry.index.count / 6;
    const targetCards = Math.max(1, Math.min(cardCount, Math.round(cardCount * (1 - reductionPercent / 100))));
    if (targetCards >= cardCount) return { before: cardCount * 2, after: cardCount * 2, cardsRemoved: 0 };

    const source = geometry.index.array;
    const selectedIndices = new Uint32Array(targetCards * 6);
    let write = 0;
    for (let i = 0; i < targetCards; i++) {
      const cardIndex = Math.min(cardCount - 1, Math.floor((i + 0.5) * cardCount / targetCards));
      const sourceOffset = cardIndex * 6;
      for (let j = 0; j < 6; j++) selectedIndices[write++] = source[sourceOffset + j];
    }

    const previous = mesh.geometry;
    mesh.geometry = compactGeometry(previous, selectedIndices);
    previous.dispose?.();
    return {
      before: cardCount * 2,
      after: targetCards * 2,
      cardsRemoved: cardCount - targetCards,
    };
  }

  function simplifySolidMesh(mesh, reductionPercent) {
    const geometry = mesh.geometry;
    const position = geometry?.getAttribute?.('position');
    const index = geometry?.index;
    if (!position || !index || index.count < 6) {
      const triangles = index ? Math.floor(index.count / 3) : 0;
      return { before: triangles, after: triangles, skipped: true };
    }
    if (Array.isArray(mesh.material) || (geometry.groups?.length || 0) > 0) {
      const triangles = Math.floor(index.count / 3);
      return { before: triangles, after: triangles, skipped: true };
    }

    const keepRatio = 1 - reductionPercent / 100;
    const targetIndexCount = Math.max(3, Math.floor(index.count * keepRatio / 3) * 3);
    if (targetIndexCount >= index.count) {
      const triangles = Math.floor(index.count / 3);
      return { before: triangles, after: triangles, skipped: false };
    }

    const sourceIndices = new Uint32Array(index.count);
    sourceIndices.set(index.array);
    const sourcePositions = position.array instanceof Float32Array
      ? position.array
      : Float32Array.from(position.array);

    const [simplifiedIndices, error] = window.MeshoptSimplifier.simplify(
      sourceIndices,
      sourcePositions,
      position.itemSize,
      targetIndexCount,
      1,
      ['Prune'],
    );

    if (!simplifiedIndices?.length || simplifiedIndices.length > sourceIndices.length) {
      throw new Error('meshoptimizer returned an invalid simplified index buffer');
    }

    const previous = mesh.geometry;
    mesh.geometry = compactGeometry(previous, simplifiedIndices);
    previous.dispose?.();
    return {
      before: Math.floor(sourceIndices.length / 3),
      after: Math.floor(simplifiedIndices.length / 3),
      error,
      skipped: false,
    };
  }

  async function applyDecimation(object, reductionPercent) {
    const requested = clampPercent(reductionPercent);
    const before = triangleCount(object);
    if (!requested || !before) {
      return { requested, before, after: before, actualReduction: 0, leafCardsRemoved: 0, skippedMeshes: 0 };
    }

    if (!window.MeshoptSimplifier?.supported) {
      throw new Error('LOD decimation requires WebAssembly support in this browser');
    }
    await window.MeshoptSimplifier.ready;

    const meshes = [];
    object.traverse?.(child => {
      if (child?.isMesh) meshes.push(child);
    });

    let leafCardsRemoved = 0;
    let skippedMeshes = 0;
    for (const mesh of meshes) {
      if (isLeafCardMesh(mesh)) {
        leafCardsRemoved += thinLeafCards(mesh, requested).cardsRemoved;
      } else {
        const result = simplifySolidMesh(mesh, requested);
        if (result.skipped) skippedMeshes++;
      }
    }

    object.updateMatrixWorld?.(true);
    const after = triangleCount(object);
    const actualReduction = before > 0 ? (1 - after / before) * 100 : 0;
    object.userData = {
      ...(object.userData || {}),
      lodDecimation: {
        requestedReductionPercent: requested,
        sourceTriangles: before,
        outputTriangles: after,
        actualReductionPercent: Number(actualReduction.toFixed(2)),
      },
    };
    return { requested, before, after, actualReduction, leafCardsRemoved, skippedMeshes };
  }

  function formatStats(stats) {
    if (!stats?.requested) return `${stats?.after ?? 0} triangles · original geometry`;
    const skipped = stats.skippedMeshes ? ` · ${stats.skippedMeshes} mesh(es) skipped` : '';
    const cards = stats.leafCardsRemoved ? ` · ${stats.leafCardsRemoved} leaf cards removed` : '';
    return `${stats.before.toLocaleString()} → ${stats.after.toLocaleString()} triangles · ${stats.actualReduction.toFixed(1)}% actual reduction${cards}${skipped}`;
  }

  function disposeObjectGeometry(object) {
    object?.traverse?.(child => {
      if (child?.isMesh) child.geometry?.dispose?.();
    });
  }

  async function showPreview(entry) {
    if (!entry) return;
    const generation = ++previewGeneration;
    const reduction = decimationPercent();
    try {
      setStatus(reduction ? `Building ${reduction}% decimated LOD preview…` : 'Building full-detail preview…');
      const nextObject = buildSource(entry);
      const stats = await applyDecimation(nextObject, reduction);

      if (generation !== previewGeneration) {
        disposeObjectGeometry(nextObject);
        return;
      }

      if (previewObject) {
        scene.remove(previewObject);
        disposeObjectGeometry(previewObject);
      }
      previewObject = nextObject;
      scene.add(previewObject);
      fitCamera(previewObject);
      titleEl.textContent = `${prettySpecies(entry.species)} · variant ${entry.variant}`;
      metaEl.textContent = reduction
        ? `${exportFilename(entry)} · generator seed ${entry.seed} · requested ${reduction}% decimation`
        : `${entry.filename} · generator seed ${entry.seed}`;
      if (decimateStats) decimateStats.textContent = formatStats(stats);
      setStatus(
        reduction
          ? `LOD preview ready. ${formatStats(stats)}. Leaf planes are removed whole so their UVs stay intact.`
          : 'Preview is the same procedural source object that will be baked into this GLB.',
        'status-ok',
      );
    } catch (error) {
      if (generation !== previewGeneration) return;
      setStatus(`Preview failed: ${error?.message || error}`, 'status-bad');
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    controls?.update();
    renderer.render(scene, camera);
  }
  animate();

  function mapsIn(object) {
    const maps = new Set();
    object.traverse?.(child => {
      if (!child?.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) continue;
        for (const key of ['map', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
          if (material[key]) maps.add(material[key]);
        }
      }
    });
    return [...maps];
  }

  async function waitForTextures(object, timeoutMs = 15000) {
    const textures = mapsIn(object);
    if (!textures.length) return;
    const started = performance.now();
    while (true) {
      const pending = textures.filter(tex => !tex?.image || (typeof tex.image.complete === 'boolean' && !tex.image.complete));
      if (!pending.length) return;
      if (performance.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${pending.length} foliage texture(s)`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  async function exportGlb(entry) {
    const object = buildSource(entry);
    const reduction = decimationPercent();
    const stats = await applyDecimation(object, reduction);
    await waitForTextures(object);
    object.updateMatrixWorld?.(true);
    const exporter = new THREE.GLTFExporter();
    return new Promise((resolve, reject) => {
      try {
        exporter.parse(object, result => {
          if (result instanceof ArrayBuffer) resolve({ buffer: result, stats });
          else reject(new Error('GLTFExporter returned JSON instead of binary GLB'));
        }, { binary: true, onlyVisible: false, truncateDrawRange: false });
      } catch (error) { reject(error); }
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function setBusy(value) {
    busy = value;
    exportAllBtn.disabled = value;
    exportOneBtn.disabled = value;
    if (decimateRange) decimateRange.disabled = value;
    readyPill.textContent = value ? 'Exporting…' : `${ASSETS.length} variants ready`;
    updateDecimationUi();
  }

  exportOneBtn.addEventListener('click', async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const filename = exportFilename(selected);
      const reduction = decimationPercent();
      setStatus(`Baking ${filename}${reduction ? ` at ${reduction}% decimation` : ''}…`);
      const { buffer, stats } = await exportGlb(selected);
      downloadBlob(new Blob([buffer], { type: 'model/gltf-binary' }), filename);
      setStatus(`Exported ${filename} (${(buffer.byteLength / 1024).toFixed(1)} KiB). ${formatStats(stats)}.`, 'status-ok');
    } catch (error) {
      setStatus(`Export failed: ${error?.message || error}`, 'status-bad');
    } finally { setBusy(false); }
  });

  exportAllBtn.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      const reduction = decimationPercent();
      const zip = new JSZip();
      const folder = zip.folder('docs/assets/models/trees');
      let totalBytes = 0;
      let sourceTriangles = 0;
      let outputTriangles = 0;
      const lodFiles = [];

      for (let i = 0; i < ASSETS.length; i++) {
        const entry = ASSETS[i];
        const filename = exportFilename(entry);
        setStatus(`Baking ${i + 1}/${ASSETS.length}: ${filename}…`);
        const { buffer, stats } = await exportGlb(entry);
        totalBytes += buffer.byteLength;
        sourceTriangles += stats.before;
        outputTriangles += stats.after;
        lodFiles.push({
          species: entry.species,
          variant: entry.variant,
          filename,
          sourceTriangles: stats.before,
          outputTriangles: stats.after,
        });
        folder.file(filename, buffer, { binary: true });
      }

      if (reduction) {
        folder.file('lod-decimation.json', JSON.stringify({
          requestedReductionPercent: reduction,
          generatedAt: new Date().toISOString(),
          files: lodFiles,
        }, null, 2) + '\n');
      } else {
        const index = Library.makeIndex();
        folder.file('index.json', JSON.stringify(index, null, 2) + '\n');
      }

      setStatus('Compressing ZIP…');
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
        platform: 'DOS',
      });
      const zipName = reduction
        ? `hobunji_wilderness_tree_lod_decimate_${reduction}.zip`
        : 'hobunji_wilderness_tree_assets.zip';
      downloadBlob(blob, zipName);
      const actualReduction = sourceTriangles > 0 ? (1 - outputTriangles / sourceTriangles) * 100 : 0;
      setStatus(
        reduction
          ? `LOD ZIP complete: 6 GLBs + lod-decimation.json. ${sourceTriangles.toLocaleString()} → ${outputTriangles.toLocaleString()} triangles (${actualReduction.toFixed(1)}% actual reduction). ZIP ${(blob.size / 1024 / 1024).toFixed(2)} MiB.`
          : `ZIP complete: 6 GLBs + index.json. Raw GLBs ${(totalBytes / 1024 / 1024).toFixed(2)} MiB; ZIP ${(blob.size / 1024 / 1024).toFixed(2)} MiB.`,
        'status-ok',
      );
    } catch (error) {
      setStatus(`ZIP export failed: ${error?.message || error}`, 'status-bad');
    } finally { setBusy(false); }
  });

  decimateRange?.addEventListener('input', updateDecimationUi);
  decimateRange?.addEventListener('change', () => showPreview(selected));

  renderRows();
  updateDecimationUi();
  showPreview(selected);
  readyPill.textContent = `${ASSETS.length} variants ready`;
})();
