(() => {
  'use strict';

  const THREE = window.THREE;
  const mapper = window.HobunjiSurfaceStretchUV;
  const tileRing = window.HobunjiSurfaceTileRing;
  if (!THREE?.BufferGeometry || !mapper?.mapGeometry || !tileRing?.applyTileMeasuredRingUv || window.WildernessLabSurfaceOutlineTuning?.installed) return;

  const MIN_SOURCE_EDGE = 0.02;
  const MAX_SOURCE_EDGE = 0.49;
  const DEFAULT_SOURCE_EDGE = 0.45;
  const TILE_RING_WORLD_WIDTH = 1;
  const BANK_Y_OFFSET = 0.008;
  const CANVAS_URL = '../../assets/textures/canvas.png';
  const WATER_KEYS = new Set(['water', 'river', 'stream', 'waterfall']);

  const state = {
    installed: true,
    sourceEdgeFraction: readConfiguredSourceEdge(),
    scene: null,
    overlay: null,
    sourceGeometry: null,
    cells: [],
    waterTriangles: 0,
    components: 0,
    boundarySegments: 0,
    visualRebuilds: 0,
    lastError: null,
  };

  let outlineTexture = null;
  let outlineTextureLoading = false;
  let uiInstalled = false;
  let prepareTimer = 0;
  let rebuildRaf = 0;

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
  }

  function readConfiguredSourceEdge() {
    const value = Number(window.NaturalSurfaceMaterialConfig?.perimeterFrame?.sourceEdgeFraction);
    return Number.isFinite(value) ? clamp(value, MIN_SOURCE_EDGE, MAX_SOURCE_EDGE) : DEFAULT_SOURCE_EDGE;
  }

  function writeConfiguredSourceEdge(value) {
    const next = clamp(value, MIN_SOURCE_EDGE, MAX_SOURCE_EDGE);
    window.NaturalSurfaceMaterialConfig = window.NaturalSurfaceMaterialConfig || {};
    window.NaturalSurfaceMaterialConfig.perimeterFrame = window.NaturalSurfaceMaterialConfig.perimeterFrame || {};
    window.NaturalSurfaceMaterialConfig.perimeterFrame.sourceEdgeFraction = next;
    window.NaturalSurfaceMaterialConfig.perimeterFrame.tileRingWorldWidth = Number(window.NaturalSurfaceMaterialConfig.perimeterFrame.tileRingWorldWidth) || TILE_RING_WORLD_WIDTH;
    window.NaturalSurfaceMaterialConfig.perimeterFrame.scope = 'water-and-snow';
    state.sourceEdgeFraction = next;
    return next;
  }

  function disposeOverlay() {
    const overlay = state.overlay;
    if (!overlay) return;
    overlay.parent?.remove?.(overlay);
    overlay.geometry?.dispose?.();
    overlay.material?.dispose?.();
    state.overlay = null;
  }

  function disposeSource() {
    state.sourceGeometry?.dispose?.();
    state.sourceGeometry = null;
    state.cells = [];
    state.waterTriangles = 0;
    state.components = 0;
    state.boundarySegments = 0;
  }

  function materialIndexForElement(geometry, elementOffset) {
    const groups = geometry?.groups || [];
    if (!groups.length) return 0;
    for (const group of groups) {
      if (elementOffset >= group.start && elementOffset < group.start + group.count) return Number(group.materialIndex || 0);
    }
    return 0;
  }

  function terrainKeyAt(node, geometry, elementOffset) {
    const materialIndex = materialIndexForElement(geometry, elementOffset);
    const material = Array.isArray(node?.material) ? node.material[materialIndex] : node?.material;
    return String(material?.userData?.terrainKey || node?.userData?.terrainKey || '').toLowerCase();
  }

  function sourceIndex(indexAttribute, element) {
    return indexAttribute ? Number(indexAttribute.getX(element)) : element;
  }

  function findPreviewScene() {
    const scenes = [...(window.__wildernessLabScenes || [])];
    for (const scene of scenes) {
      let found = false;
      scene.traverse?.(node => {
        if (found || !node?.isMesh || node.userData?.wildernessLabBankOutlinePreview) return;
        const key = String((Array.isArray(node.material) ? node.material[0] : node.material)?.userData?.terrainKey || node.userData?.terrainKey || '').toLowerCase();
        if (WATER_KEYS.has(key)) found = true;
      });
      if (found) return scene;
    }
    return scenes[0] || null;
  }

  function collectWaterwaySurface(scene) {
    const positions = [];
    const cells = new Map();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normal = new THREE.Vector3();
    let triangles = 0;
    scene.updateMatrixWorld?.(true);

    scene.traverse?.(node => {
      if (!node?.isMesh || node.userData?.wildernessLabBankOutlinePreview || node.parent?.userData?.environmentSurfaceMicroPlateau) return;
      const geometry = node.geometry;
      const position = geometry?.getAttribute?.('position');
      if (!position) return;
      const index = geometry.index || null;
      const elementCount = Math.floor(Number(index?.count ?? position.count) / 3) * 3;
      for (let element = 0; element < elementCount; element += 3) {
        if (!WATER_KEYS.has(terrainKeyAt(node, geometry, element))) continue;
        const ia = sourceIndex(index, element);
        const ib = sourceIndex(index, element + 1);
        const ic = sourceIndex(index, element + 2);
        a.set(position.getX(ia), position.getY(ia), position.getZ(ia)).applyMatrix4(node.matrixWorld);
        b.set(position.getX(ib), position.getY(ib), position.getZ(ib)).applyMatrix4(node.matrixWorld);
        c.set(position.getX(ic), position.getY(ic), position.getZ(ic)).applyMatrix4(node.matrixWorld);
        ab.subVectors(b, a);
        ac.subVectors(c, a);
        normal.crossVectors(ab, ac);
        if (normal.lengthSq() <= 1e-12) continue;
        normal.normalize();
        if (normal.y < 0.15) continue;
        positions.push(a.x, a.y + BANK_Y_OFFSET, a.z, b.x, b.y + BANK_Y_OFFSET, b.z, c.x, c.y + BANK_Y_OFFSET, c.z);
        const col = Math.floor(((a.x + b.x + c.x) / 3) + 1e-7);
        const row = Math.floor(((a.z + b.z + c.z) / 3) + 1e-7);
        cells.set(`${col},${row}`, { col, row, visible: true });
        triangles++;
      }
    });
    return { positions, cells: [...cells.values()], triangles };
  }

  function makeOutlineTexture(source) {
    const image = source?.image;
    const width = image?.naturalWidth || image?.width;
    const height = image?.naturalHeight || image?.height;
    if (!width || !height) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const keep = pixels.data[i + 3] > 0 && pixels.data[i] <= 1 && pixels.data[i + 1] <= 1 && pixels.data[i + 2] <= 1;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 0;
      if (!keep) pixels.data[i + 3] = 0;
    }
    context.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  function loadOutlineTexture() {
    if (outlineTexture || outlineTextureLoading) return;
    outlineTextureLoading = true;
    new THREE.TextureLoader().load(CANVAS_URL, source => {
      outlineTextureLoading = false;
      try {
        outlineTexture = makeOutlineTexture(source);
        source.dispose?.();
        if (!outlineTexture) throw new Error('canvas source had no usable image');
        scheduleVisualRebuild();
      } catch (error) {
        state.lastError = `outline texture conversion failed: ${error?.message || error}`;
      }
    }, undefined, error => {
      outlineTextureLoading = false;
      state.lastError = `outline texture load failed: ${error?.message || error}`;
    });
  }

  function prepareWaterway(retry = 0) {
    prepareTimer = 0;
    const scene = findPreviewScene();
    if (!scene) {
      if (retry < 8) prepareTimer = setTimeout(() => prepareWaterway(retry + 1), 50);
      updateUiStatus('scene pending');
      return;
    }
    state.scene = scene;
    disposeOverlay();
    disposeSource();
    const source = collectWaterwaySurface(scene);
    state.waterTriangles = source.triangles;
    state.cells = source.cells;
    if (source.positions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.positions, 3));
      state.sourceGeometry = geometry;
    }
    loadOutlineTexture();
    rebuildVisualOnly();
  }

  function buildMappedGeometry() {
    if (!state.sourceGeometry || !state.cells.length) return null;
    const working = state.sourceGeometry.clone();
    const position = working.getAttribute('position');
    const originalY = new Float32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      originalY[i] = position.getY(i);
      position.setY(i, 0);
    }
    position.needsUpdate = true;
    let mapped;
    try { mapped = mapper.mapGeometry(working, { label: 'wilderness-lab-water-bank', angleToleranceDeg: 89 }); }
    catch (error) {
      state.lastError = `water bank mapping failed: ${error?.message || error}`;
      working.dispose?.();
      return null;
    }
    const mappedPosition = mapped?.getAttribute?.('position');
    const uv = mapped?.getAttribute?.('uv');
    if (!mappedPosition || !uv || mappedPosition.count !== originalY.length) {
      if (mapped && mapped !== working) mapped.dispose?.();
      working.dispose?.();
      return null;
    }
    for (let i = 0; i < mappedPosition.count; i++) mappedPosition.setY(i, originalY[i]);
    mappedPosition.needsUpdate = true;
    const report = tileRing.applyTileMeasuredRingUv(mapped, state.cells, {
      attributeName: 'uv',
      tileRingWorldWidth: Number(window.NaturalSurfaceMaterialConfig?.perimeterFrame?.tileRingWorldWidth) || TILE_RING_WORLD_WIDTH,
      sourceEdgeFraction: state.sourceEdgeFraction,
    });
    if (!report) {
      if (mapped !== working) mapped.dispose?.();
      working.dispose?.();
      return null;
    }
    state.components = report.componentCount || 0;
    state.boundarySegments = report.boundarySegmentCount || 0;
    if (mapped !== working) working.dispose?.();
    return mapped;
  }

  function rebuildVisualOnly() {
    rebuildRaf = 0;
    disposeOverlay();
    if (!state.scene || !outlineTexture) {
      updateUiStatus(outlineTexture ? '' : 'outline texture loading');
      return;
    }
    const geometry = buildMappedGeometry();
    if (!geometry) {
      updateUiStatus();
      return;
    }
    const material = new THREE.MeshBasicMaterial({
      map: outlineTexture,
      color: 0xffffff,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'wilderness_lab_water_bank_outline_preview';
    mesh.renderOrder = 45;
    mesh.userData = { wildernessLabBankOutlinePreview: true, sourceEdgeFraction: state.sourceEdgeFraction };
    mesh.raycast = () => {};
    state.scene.add(mesh);
    state.overlay = mesh;
    state.visualRebuilds++;
    updateUiStatus();
  }

  function scheduleVisualRebuild() {
    if (rebuildRaf) return;
    rebuildRaf = requestAnimationFrame(rebuildVisualOnly);
  }

  function schedulePrepare() {
    clearTimeout(prepareTimer);
    prepareTimer = setTimeout(() => prepareWaterway(0), 0);
  }

  function updateUiStatus(extra = '') {
    const status = document.getElementById('surfaceOutlineLiveStatus');
    if (!status) return;
    const percent = (state.sourceEdgeFraction * 100).toFixed(0);
    const terrain = state.waterTriangles ? `${state.waterTriangles.toLocaleString()} waterway tri` : 'no waterway surface found';
    status.textContent = `${percent}% protected · ${terrain}${extra ? ` · ${extra}` : ''}`;
  }

  function setSourceEdgeFraction(value) {
    const next = writeConfiguredSourceEdge(value);
    const range = document.getElementById('surfaceOutlineSourceEdge');
    const number = document.getElementById('surfaceOutlineSourceEdgeNum');
    if (range) range.value = String(next);
    if (number) number.value = String(next);
    scheduleVisualRebuild();
    updateUiStatus();
    return next;
  }

  function installUi() {
    if (uiInstalled) return true;
    const sidebar = document.querySelector('.sidebar-scroll');
    if (!sidebar) return false;
    uiInstalled = true;
    const card = document.createElement('details');
    card.className = 'card';
    card.open = true;
    card.id = 'surfaceOutlineTuningCard';
    card.innerHTML = `
      <summary>Water bank + snow outline tuning</summary>
      <div class="card-body">
        <div class="help">Protected source-band width for the transparent black <b>water-bank outline</b> and Western Slope <b>snow</b> only. Grass keeps its normal tiled wavy_surface texture; Coldmuck slush and cliffs are unchanged. Higher values make the authored outline thinner. Dragging this does <b>not</b> regenerate the wilderness.</div>
        <div class="control">
          <label for="surfaceOutlineSourceEdge">Protected source band</label>
          <input id="surfaceOutlineSourceEdge" type="range" min="${MIN_SOURCE_EDGE}" max="${MAX_SOURCE_EDGE}" step="0.01" value="${state.sourceEdgeFraction}">
          <input id="surfaceOutlineSourceEdgeNum" type="number" min="${MIN_SOURCE_EDGE}" max="${MAX_SOURCE_EDGE}" step="0.01" value="${state.sourceEdgeFraction}">
        </div>
        <div class="row"><span class="chip" id="surfaceOutlineLiveStatus"></span><button class="secondary" id="surfaceOutlineReset" type="button">Reset 0.45</button></div>
      </div>`;
    const cards = [...sidebar.querySelectorAll(':scope > details.card')];
    const advanced = cards.find(item => item.querySelector(':scope > summary')?.textContent?.includes('Advanced overrides'));
    sidebar.insertBefore(card, advanced || null);

    const range = document.getElementById('surfaceOutlineSourceEdge');
    const number = document.getElementById('surfaceOutlineSourceEdgeNum');
    const sync = (source, other) => {
      const value = setSourceEdgeFraction(source.value);
      source.value = String(value);
      other.value = String(value);
    };
    range.addEventListener('input', () => sync(range, number));
    number.addEventListener('input', () => sync(number, range));
    document.getElementById('surfaceOutlineReset')?.addEventListener('click', () => setSourceEdgeFraction(DEFAULT_SOURCE_EDGE));
    updateUiStatus();
    return true;
  }

  function installPreviewAdapter(api) {
    if (!api || api.__wildernessLabWaterBankTuning || typeof api.renderWorkspace !== 'function') return;
    const previous = api.renderWorkspace.bind(api);
    api.renderWorkspace = function wildernessLabWaterBankRenderWorkspace(...args) {
      const result = previous(...args);
      schedulePrepare();
      return result;
    };
    api.__wildernessLabWaterBankTuning = true;
  }

  function hookPreviewAssignment() {
    if (window.WildernessLabPreview) {
      installPreviewAdapter(window.WildernessLabPreview);
      return;
    }
    setTimeout(hookPreviewAssignment, 0);
  }

  writeConfiguredSourceEdge(state.sourceEdgeFraction);
  hookPreviewAssignment();
  loadOutlineTexture();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { if (!installUi()) setTimeout(installUi, 50); }, { once: true });
  } else if (!installUi()) setTimeout(installUi, 50);

  window.WildernessLabSurfaceOutlineTuning = {
    installed: true,
    scope: 'water-and-snow',
    setSourceEdgeFraction,
    rebuild: schedulePrepare,
    snapshot() {
      return {
        sourceEdgeFraction: state.sourceEdgeFraction,
        waterTriangles: state.waterTriangles,
        components: state.components,
        boundarySegments: state.boundarySegments,
        visualRebuilds: state.visualRebuilds,
        lastError: state.lastError,
      };
    },
  };
})();