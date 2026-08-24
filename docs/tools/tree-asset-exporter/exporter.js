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

  let selected = ASSETS[0] || null;
  let previewObject = null;
  let busy = false;

  function setStatus(text, cls = '') {
    statusEl.textContent = text;
    statusEl.className = cls;
  }

  function prettySpecies(species) {
    return String(species || '').split('_').map(s => s ? s[0].toUpperCase() + s.slice(1) : '').join(' ');
  }

  function builderFor(entry) {
    const fn = Foliage?.[entry?.builder];
    if (typeof fn !== 'function') throw new Error(`Missing FoliageGenerator.${entry?.builder || '?'}`);
    return fn;
  }

  function buildSource(entry) {
    // forceClimbBranch: shadewood's climb branch is normally a per-tile-
    // instance coin flip (~1 in 6 — see foliage-generator.js's
    // climbBranchChance), which would make an exported reference GLB
    // randomly include or omit it depending on nothing the exporter
    // controls. Forcing it on here makes every exported shadewood
    // deterministically carry the branch, tagged for downstream tools to
    // recognize (see the traverse below).
    const opts = entry.builder === 'buildShadewoodMesh' ? { forceClimbBranch: true } : undefined;
    const object = builderFor(entry)(entry.seed, undefined, opts);
    if (!object) throw new Error(`${entry.builder}(${entry.seed}) returned no object`);
    object.name = `${entry.species}_${String(entry.variant).padStart(2, '0')}`;
    object.updateMatrixWorld?.(true);
    object.traverse?.(child => {
      if (!child?.isMesh) return;
      child.userData = { ...(child.userData || {}), treeSpecies: entry.species, treeVariant: entry.variant };
      // GLTFExporter serializes userData as glTF extras, preserving noOutline
      // on flat leaf-card meshes for the runtime's selective outline pass,
      // and isClimbBranch/climbBranchLocal (set on the "climbBranch" mesh
      // by buildTreeInstance when forceClimbBranch is set above) so a
      // consumer of the exported GLB can find the climb branch node by
      // name ("climbBranch") or by its extras.isClimbBranch flag, and read
      // exactly where it is (extras.climbBranchLocal: local-space a/b
      // endpoints + radius, same convention FoliageGenerator.
      // getClimbBranchWorld expects).
    });
    return object;
  }

  function renderRows() {
    listEl.innerHTML = ASSETS.map(entry => {
      const selectedClass = selected === entry ? ' selected' : '';
      const icon = entry.species === 'shadewood' ? '🌳' : '🌲';
      // Every exported shadewood carries a climb branch (buildSource forces
      // it — see forceClimbBranch above), so this is a straight species
      // check, not a per-variant lookup — flagged here so the tool itself
      // makes it visible which exports include one, not just the extras
      // embedded in the GLB.
      const branchBadge = entry.species === 'shadewood' ? '<span class="branch-badge" title="Exports with a climbable branch (see extras.isClimbBranch)">🪵 branch</span>' : '';
      return `<div class="asset-row${selectedClass}" data-species="${entry.species}" data-variant="${entry.variant}">
        <div class="tree-icon">${icon}</div>
        <div><div class="asset-name">${prettySpecies(entry.species)} · variant ${entry.variant}${branchBadge}</div><div class="asset-file">${entry.filename}</div></div>
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

  if (!THREE || !Foliage || !Library || !window.JSZip || !THREE.GLTFExporter) {
    readyPill.textContent = 'Missing dependency';
    setStatus('Exporter dependencies failed to load. Check network/CDN access and reload.', 'status-bad');
    exportAllBtn.disabled = true;
    exportOneBtn.disabled = true;
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

  function showPreview(entry) {
    if (!entry) return;
    if (previewObject) scene.remove(previewObject);
    try {
      previewObject = buildSource(entry);
      scene.add(previewObject);
      fitCamera(previewObject);
      titleEl.textContent = `${prettySpecies(entry.species)} · variant ${entry.variant}`;
      metaEl.textContent = `${entry.filename} · generator seed ${entry.seed}`;
      setStatus('Preview is the same procedural source object that will be baked into this GLB.', 'status-ok');
    } catch (error) {
      previewObject = null;
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
    await waitForTextures(object);
    object.updateMatrixWorld?.(true);
    const exporter = new THREE.GLTFExporter();
    return new Promise((resolve, reject) => {
      try {
        exporter.parse(object, result => {
          if (result instanceof ArrayBuffer) resolve(result);
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
    readyPill.textContent = value ? 'Exporting…' : '6 variants ready';
  }

  exportOneBtn.addEventListener('click', async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      setStatus(`Baking ${selected.filename}…`);
      const buffer = await exportGlb(selected);
      downloadBlob(new Blob([buffer], { type: 'model/gltf-binary' }), selected.filename);
      setStatus(`Exported ${selected.filename} (${(buffer.byteLength / 1024).toFixed(1)} KiB).`, 'status-ok');
    } catch (error) {
      setStatus(`Export failed: ${error?.message || error}`, 'status-bad');
    } finally { setBusy(false); }
  });

  exportAllBtn.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder('docs/assets/models/trees');
      let totalBytes = 0;
      for (let i = 0; i < ASSETS.length; i++) {
        const entry = ASSETS[i];
        setStatus(`Baking ${i + 1}/${ASSETS.length}: ${entry.filename}…`);
        const buffer = await exportGlb(entry);
        totalBytes += buffer.byteLength;
        folder.file(entry.filename, buffer, { binary: true });
      }
      const index = Library.makeIndex();
      folder.file('index.json', JSON.stringify(index, null, 2) + '\n');
      setStatus('Compressing ZIP…');
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
        platform: 'DOS',
      });
      downloadBlob(blob, 'hobunji_wilderness_tree_assets.zip');
      setStatus(`ZIP complete: 6 GLBs + index.json. Raw GLBs ${(totalBytes / 1024 / 1024).toFixed(2)} MiB; ZIP ${(blob.size / 1024 / 1024).toFixed(2)} MiB.`, 'status-ok');
    } catch (error) {
      setStatus(`ZIP export failed: ${error?.message || error}`, 'status-bad');
    } finally { setBusy(false); }
  });

  renderRows();
  showPreview(selected);
  readyPill.textContent = `${ASSETS.length} variants ready`;
})();
