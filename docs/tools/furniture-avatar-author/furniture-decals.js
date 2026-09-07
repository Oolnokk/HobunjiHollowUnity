// Furniture + Avatar Author decal extension.
// Decals are authored in recognized-surface-local coordinates so they follow
// furniture part translation, rotation, and scale without a per-frame sync.
(() => {
'use strict';

const dq = id => document.getElementById(id);
const dclone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const dclamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const decalMeshes = new Map();
const decalTextureCache = new Map();
let selectedDecalId = null;
let decalFileTargetSurfaceId = null;

function ensureDecalState() {
  if (!Array.isArray(state.decals)) state.decals = [];
  return state.decals;
}

function normalizeDecal(record = {}) {
  return {
    id: record.id || uid('decal'),
    name: record.name || 'Furniture Decal',
    surfaceId: record.surfaceId || null,
    surfacePartId: record.surfacePartId || null,
    surfaceType: record.surfaceType || '',
    surfaceFaces: Array.isArray(record.surfaceFaces) ? [...record.surfaceFaces] : [],
    imageSource: record.imageSource || null,
    imageName: record.imageName || '',
    offsetU: Number.isFinite(Number(record.offsetU)) ? Number(record.offsetU) : 0,
    offsetV: Number.isFinite(Number(record.offsetV)) ? Number(record.offsetV) : 0,
    width: Math.max(.001, Number(record.width) || .5),
    height: Math.max(.001, Number(record.height) || .5),
    rotationDeg: Number(record.rotationDeg) || 0,
    normalOffset: Math.max(.0002, Number(record.normalOffset) || .003),
    opacity: dclamp(record.opacity ?? 1, 0, 1),
    visible: record.visible !== false
  };
}

function selectedDecal() {
  return ensureDecalState().find(record => record.id === selectedDecalId) || null;
}

function decalSurface(record) {
  if (!record) return null;
  if (record.surfaceId && surfaceGroups.has(record.surfaceId)) return surfaceGroups.get(record.surfaceId);
  const partId = record.surfacePartId;
  if (!partId) return null;
  let best = null;
  let bestScore = -Infinity;
  const priorFaces = new Set(record.surfaceFaces || []);
  for (const group of surfaceGroups.values()) {
    if (group.partId !== partId) continue;
    let overlap = 0;
    for (const face of group.faceIndices || []) if (priorFaces.has(face)) overlap++;
    const typeScore = record.surfaceType && group.recognizedType === record.surfaceType ? 1000 : 0;
    const score = typeScore + overlap * 10 - Math.abs((group.faceIndices?.length || 0) - priorFaces.size);
    if (score > bestScore) { best = group; bestScore = score; }
  }
  if (best) {
    record.surfaceId = best.id;
    record.surfacePartId = best.partId;
    record.surfaceType = best.recognizedType || '';
    record.surfaceFaces = [...(best.faceIndices || [])];
  }
  return best;
}

function surfaceDimensions(group) {
  const b = group?.bounds || {};
  return {
    width: Math.max(.001, Number(b.maxU) - Number(b.minU) || .001),
    height: Math.max(.001, Number(b.maxV) - Number(b.minV) || .001)
  };
}

function loadDecalTexture(source) {
  if (!source) return Promise.resolve(null);
  if (decalTextureCache.has(source)) return decalTextureCache.get(source);
  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const texture = new THREE.Texture(image);
      texture.encoding = THREE.sRGBEncoding;
      texture.needsUpdate = true;
      resolve(texture);
    };
    image.onerror = () => reject(new Error('Could not load decal image.'));
    image.src = source;
  }).catch(error => { decalTextureCache.delete(source); throw error; });
  decalTextureCache.set(source, promise);
  return promise;
}

function disposeDecalMesh(id) {
  const mesh = decalMeshes.get(id);
  if (!mesh) return;
  mesh.parent?.remove(mesh);
  mesh.geometry?.dispose?.();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials.filter(Boolean)) material.dispose?.();
  const outline = mesh.userData?.outline;
  if (outline) {
    outline.geometry?.dispose?.();
    outline.material?.dispose?.();
  }
  decalMeshes.delete(id);
}

function clearDecalMeshes() {
  for (const id of [...decalMeshes.keys()]) disposeDecalMesh(id);
}

function localSurfaceFrame(group) {
  if (!group) return null;
  const dimensions = surfaceDimensions(group);
  const centerU = (Number(group.bounds?.minU) + Number(group.bounds?.maxU)) / 2;
  const centerV = (Number(group.bounds?.minV) + Number(group.bounds?.maxV)) / 2;
  const projectedCenter = group.basisU.clone().multiplyScalar(centerU)
    .addScaledVector(group.basisV, centerV)
    .addScaledVector(group.localNormal, group.localCentroid.dot(group.localNormal));
  return { dimensions, center: projectedCenter, u: group.basisU, v: group.basisV, normal: group.localNormal };
}

function buildDecalMesh(record) {
  disposeDecalMesh(record.id);
  if (!record.visible || !record.imageSource) return null;
  const group = decalSurface(record);
  const partMesh = group ? meshes.get(group.partId) : null;
  const frame = group ? localSurfaceFrame(group) : null;
  if (!group || !partMesh || !frame) return null;

  const width = Math.max(.001, frame.dimensions.width * record.width);
  const height = Math.max(.001, frame.dimensions.height * record.height);
  const geometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: record.opacity,
    alphaTest: .01,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = record.name || 'Furniture Decal';
  mesh.userData = { type: 'furnitureDecal', id: record.id, surfaceId: group.id };
  mesh.raycast = () => {};

  const halfU = frame.dimensions.width / 2;
  const halfV = frame.dimensions.height / 2;
  mesh.position.copy(frame.center)
    .addScaledVector(frame.u, record.offsetU * halfU)
    .addScaledVector(frame.v, record.offsetV * halfV)
    .addScaledVector(frame.normal, record.normalOffset);
  const basis = new THREE.Matrix4().makeBasis(frame.u, frame.v, frame.normal);
  mesh.quaternion.setFromRotationMatrix(basis);
  mesh.rotateZ(record.rotationDeg * DEG);
  partMesh.add(mesh);
  decalMeshes.set(record.id, mesh);

  if (selectedDecalId === record.id) {
    const points = [
      new THREE.Vector3(-width / 2, -height / 2, .0005),
      new THREE.Vector3(width / 2, -height / 2, .0005),
      new THREE.Vector3(width / 2, height / 2, .0005),
      new THREE.Vector3(-width / 2, height / 2, .0005)
    ];
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x65b8ff, depthTest: false, transparent: true, opacity: .95 })
    );
    outline.renderOrder = 999;
    outline.raycast = () => {};
    mesh.add(outline);
    mesh.userData.outline = outline;
  }

  loadDecalTexture(record.imageSource).then(texture => {
    const live = decalMeshes.get(record.id);
    if (live?.material && texture) {
      live.material.map = texture;
      live.material.needsUpdate = true;
    }
  }).catch(error => log?.(`Decal image failed (${record.imageName || record.id}): ${error.message}`, 'warn'));
  return mesh;
}

function rebuildDecals({ prune = true } = {}) {
  clearDecalMeshes();
  const decals = ensureDecalState();
  for (let i = decals.length - 1; i >= 0; i--) {
    decals[i] = normalizeDecal(decals[i]);
    const group = decalSurface(decals[i]);
    if (!group && prune) decals.splice(i, 1);
  }
  for (const record of decals) buildDecalMesh(record);
  if (selectedDecalId && !decals.some(record => record.id === selectedDecalId)) selectedDecalId = null;
  renderDecalUi();
}

function selectedSurfaceForDecal() {
  const surface = selectedSurface?.();
  if (surface) return surface;
  const ids = activeSurfaceIds?.() || [];
  return ids.length ? surfaceGroups.get(ids[ids.length - 1]) : null;
}

function addDecalFromFile(file, surfaceId) {
  const surface = surfaceGroups.get(surfaceId);
  if (!surface) { log?.('Select a recognized furniture surface before adding a decal.', 'warn'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const record = normalizeDecal({
      id: uid('decal'),
      name: file.name.replace(/\.[^.]+$/, '') || 'Furniture Decal',
      surfaceId: surface.id,
      surfacePartId: surface.partId,
      surfaceType: surface.recognizedType,
      surfaceFaces: [...(surface.faceIndices || [])],
      imageSource: String(reader.result || ''),
      imageName: file.name,
      width: .5,
      height: .5,
      normalOffset: .003
    });
    ensureDecalState().push(record);
    selectedDecalId = record.id;
    buildDecalMesh(record);
    renderDecalUi();
    updateStats?.();
    queueUndoHistory?.('add furniture decal');
    log?.(`Added decal ${record.name} to ${surface.recognizedType || 'surface'}.`);
  };
  reader.readAsDataURL(file);
}

function requestDecalImage() {
  const surface = selectedSurfaceForDecal();
  if (!surface) { log?.('Select a recognized furniture surface first.', 'warn'); return; }
  decalFileTargetSurfaceId = surface.id;
  const input = dq('furnitureDecalFile');
  if (input) { input.value = ''; input.click(); }
}

function retargetSelectedDecal() {
  const record = selectedDecal();
  const surface = selectedSurfaceForDecal();
  if (!record || !surface) { log?.('Select both a decal and a target furniture surface.', 'warn'); return; }
  record.surfaceId = surface.id;
  record.surfacePartId = surface.partId;
  record.surfaceType = surface.recognizedType;
  record.surfaceFaces = [...(surface.faceIndices || [])];
  record.offsetU = 0;
  record.offsetV = 0;
  buildDecalMesh(record);
  renderDecalUi();
  queueUndoHistory?.('retarget furniture decal');
}

function deleteSelectedDecal() {
  const record = selectedDecal();
  if (!record) return;
  state.decals = ensureDecalState().filter(candidate => candidate.id !== record.id);
  disposeDecalMesh(record.id);
  selectedDecalId = null;
  renderDecalUi();
  updateStats?.();
  queueUndoHistory?.('delete furniture decal');
}

function duplicateSelectedDecal() {
  const record = selectedDecal();
  if (!record) return;
  const copy = normalizeDecal({ ...dclone(record), id: uid('decal'), name: `${record.name} Copy`, offsetU: record.offsetU + .08, offsetV: record.offsetV + .08 });
  ensureDecalState().push(copy);
  selectedDecalId = copy.id;
  buildDecalMesh(copy);
  renderDecalUi();
  updateStats?.();
  queueUndoHistory?.('duplicate furniture decal');
}

function fitSelectedDecal() {
  const record = selectedDecal();
  if (!record) return;
  record.offsetU = 0;
  record.offsetV = 0;
  record.width = .96;
  record.height = .96;
  buildDecalMesh(record);
  renderDecalUi();
  queueUndoHistory?.('fit furniture decal');
}

function centerSelectedDecal() {
  const record = selectedDecal();
  if (!record) return;
  record.offsetU = 0;
  record.offsetV = 0;
  buildDecalMesh(record);
  renderDecalUi();
  queueUndoHistory?.('center furniture decal');
}

function updateSelectedDecalFromUi() {
  const record = selectedDecal();
  if (!record) return;
  record.name = dq('decalName')?.value.trim() || record.name;
  record.offsetU = Number(dq('decalOffsetU')?.value) || 0;
  record.offsetV = Number(dq('decalOffsetV')?.value) || 0;
  record.width = Math.max(.001, Number(dq('decalWidth')?.value) || record.width);
  record.height = Math.max(.001, Number(dq('decalHeight')?.value) || record.height);
  record.rotationDeg = Number(dq('decalRotation')?.value) || 0;
  record.normalOffset = Math.max(.0002, Number(dq('decalLift')?.value) || .003);
  record.opacity = dclamp(dq('decalOpacity')?.value ?? 1, 0, 1);
  record.visible = dq('decalVisible')?.checked !== false;
  buildDecalMesh(record);
  renderDecalList();
  queueUndoHistory?.('edit furniture decal');
}

function decalSurfaceLabel(record) {
  const group = decalSurface(record);
  return group ? `${group.recognizedType || 'surface'} · ${group.partId}` : 'missing surface';
}

function renderDecalList() {
  const list = dq('furnitureDecalList');
  if (!list) return;
  list.innerHTML = ensureDecalState().map(record => `<div class="item ${record.id === selectedDecalId ? 'sel' : ''}" data-furniture-decal="${escapeHtml?.(record.id) || record.id}"><div class="item-title">${escapeHtml?.(record.name) || record.name}</div><div class="item-meta">${escapeHtml?.(decalSurfaceLabel(record)) || decalSurfaceLabel(record)} · ${record.imageName ? (escapeHtml?.(record.imageName) || record.imageName) : 'no image'}</div></div>`).join('') || '<div class="muted">No decals authored yet.</div>';
  list.querySelectorAll('[data-furniture-decal]').forEach(element => {
    element.onclick = () => {
      selectedDecalId = element.dataset.furnitureDecal;
      rebuildDecals({ prune: false });
    };
  });
}

function renderDecalEditor() {
  const editor = dq('furnitureDecalEditor');
  if (!editor) return;
  const record = selectedDecal();
  editor.classList.toggle('hidden', !record);
  if (!record) return;
  dq('decalName').value = record.name;
  dq('decalOffsetU').value = record.offsetU;
  dq('decalOffsetV').value = record.offsetV;
  dq('decalWidth').value = record.width;
  dq('decalHeight').value = record.height;
  dq('decalRotation').value = record.rotationDeg;
  dq('decalLift').value = record.normalOffset;
  dq('decalOpacity').value = record.opacity;
  dq('decalVisible').checked = record.visible !== false;
  const label = dq('decalSurfaceReadout');
  if (label) label.textContent = decalSurfaceLabel(record);
}

function renderDecalUi() {
  renderDecalList();
  renderDecalEditor();
}

function installDecalUi() {
  if (dq('furnitureDecalPanel')) return;
  const host = dq('tab-surfaces');
  if (!host) return;
  const panel = document.createElement('div');
  panel.id = 'furnitureDecalPanel';
  panel.className = 'section';
  panel.innerHTML = `<h2>Surface Decals</h2>
    <div class="muted">Place transparent PNG/WebP/JPG artwork over a recognized furniture surface. Decals follow the parent piece and are stored in the furniture JSON.</div>
    <div class="g2"><button id="addFurnitureDecal" class="ok">＋ Add Image to Selected Surface</button><button id="retargetFurnitureDecal">Retarget Selected Decal</button></div>
    <input id="furnitureDecalFile" type="file" accept="image/png,image/webp,image/jpeg" hidden>
    <div id="furnitureDecalList" class="list" style="margin-top:7px"></div>
    <div id="furnitureDecalEditor" class="hidden">
      <hr><div id="decalSurfaceReadout" class="readout muted"></div>
      <label>Name</label><input id="decalName" type="text">
      <div class="g2"><div><label>U offset (-1…1)</label><input id="decalOffsetU" type="number" step="0.02"></div><div><label>V offset (-1…1)</label><input id="decalOffsetV" type="number" step="0.02"></div></div>
      <div class="g2"><div><label>Width (surface fraction)</label><input id="decalWidth" type="number" min="0.001" step="0.02"></div><div><label>Height (surface fraction)</label><input id="decalHeight" type="number" min="0.001" step="0.02"></div></div>
      <div class="g3"><div><label>Rotation°</label><input id="decalRotation" type="number" step="1"></div><div><label>Surface lift</label><input id="decalLift" type="number" min="0.0002" step="0.001"></div><div><label>Opacity</label><input id="decalOpacity" type="number" min="0" max="1" step="0.05"></div></div>
      <label class="row"><input id="decalVisible" type="checkbox"> Visible</label>
      <div class="g2"><button id="centerFurnitureDecal">Center</button><button id="fitFurnitureDecal">Fit Surface</button></div>
      <div class="g2"><button id="duplicateFurnitureDecal">Duplicate</button><button id="deleteFurnitureDecal" class="bad">Delete</button></div>
    </div>`;
  host.prepend(panel);
  dq('addFurnitureDecal').onclick = requestDecalImage;
  dq('retargetFurnitureDecal').onclick = retargetSelectedDecal;
  dq('furnitureDecalFile').addEventListener('change', event => {
    const file = event.target?.files?.[0];
    if (file && decalFileTargetSurfaceId) addDecalFromFile(file, decalFileTargetSurfaceId);
  });
  for (const id of ['decalName','decalOffsetU','decalOffsetV','decalWidth','decalHeight','decalRotation','decalLift','decalOpacity','decalVisible']) {
    dq(id)?.addEventListener('change', updateSelectedDecalFromUi);
  }
  dq('centerFurnitureDecal').onclick = centerSelectedDecal;
  dq('fitFurnitureDecal').onclick = fitSelectedDecal;
  dq('duplicateFurnitureDecal').onclick = duplicateSelectedDecal;
  dq('deleteFurnitureDecal').onclick = deleteSelectedDecal;
}

const originalDecalRepoImport = importRepoFurniture;
importRepoFurniture = async function importRepoFurnitureWithMaterialDefaults(...args) {
  const beforeIds = new Set((state.parts || []).map(part => part.id));
  const result = await originalDecalRepoImport(...args);
  const importedParts = (state.parts || []).filter(part => !beforeIds.has(part.id));
  const texturedParts = importedParts.filter(part => part.materialTexture || part.materialCapTexture);
  if (texturedParts.length) {
    applyEntrySurfaceDefaults({ materialRules: { mapping: 'stretch' } }, texturedParts);
    rebuildFurnitureMeshes();
    log?.(`Applied authored material textures to ${texturedParts.length} repository-imported piece${texturedParts.length === 1 ? '' : 's'}.`);
  }
  return result;
};

const originalDecalBuildPartMesh = buildPartMesh;
buildPartMesh = function buildPartMeshWithDecals(part) {
  const mesh = originalDecalBuildPartMesh(part);
  for (const record of ensureDecalState().filter(item => item.surfacePartId === part.id)) buildDecalMesh(record);
  return mesh;
};

const originalDecalRebuildFurnitureMeshes = rebuildFurnitureMeshes;
rebuildFurnitureMeshes = function rebuildFurnitureMeshesWithDecals(...args) {
  const result = originalDecalRebuildFurnitureMeshes(...args);
  rebuildDecals({ prune: false });
  return result;
};

const originalDecalExport = exportData;
exportData = function exportFurnitureWithDecals(...args) {
  const data = originalDecalExport(...args);
  data.decals = dclone(ensureDecalState());
  data.decalAuthoring = {
    version: 1,
    coordinateSpace: 'recognized-surface-local',
    sizeUnits: 'surface-fraction',
    offsetUnits: 'half-surface-span'
  };
  return data;
};

const originalDecalLoad = loadData;
loadData = function loadFurnitureWithDecals(data, ...args) {
  state.decals = Array.isArray(data?.decals) ? data.decals.map(normalizeDecal) : [];
  selectedDecalId = null;
  const result = originalDecalLoad(data, ...args);
  rebuildDecals({ prune: false });
  renderDecalUi();
  return result;
};

const originalDecalClearFurniture = clearFurniture;
clearFurniture = function clearFurnitureWithDecals(...args) {
  const result = originalDecalClearFurniture(...args);
  state.decals = [];
  selectedDecalId = null;
  clearDecalMeshes();
  renderDecalUi();
  return result;
};

const originalDecalUpdateStats = updateStats;
updateStats = function updateStatsWithDecals(...args) {
  const result = originalDecalUpdateStats(...args);
  const pill = dq('statsPill');
  if (pill) {
    const count = ensureDecalState().length;
    if (/ · \d+ decals?\b/.test(pill.textContent)) pill.textContent = pill.textContent.replace(/ · \d+ decals?\b/, ` · ${count} decals`);
    else pill.textContent += ` · ${count} decals`;
  }
  return result;
};

installDecalUi();
rebuildDecals({ prune: false });
log?.('Furniture decal authoring ready. Select a surface, then add a PNG/WebP/JPG decal.');
})();
