// Procedural Animation Editor: integrated Pants Rig Author + live 3D garment preview.
(function () {
  'use strict';

  if (window.ProceduralPantsRigAuthor?.installed) return;

  const SELF_SCRIPT_SRC = document.currentScript?.src || ''; // Keeps all dynamically loaded pieces on the same branch/commit as the procedural editor.
  const PANEL_ID = 'proceduralPantsRigPanel'; // Used to find/reuse the docked authoring workspace.
  const BUTTON_ID = 'proceduralPantsRigQuickBtn'; // Used for the visible Animation HUD entry button.
  const CORE_SCRIPT_ID = 'proceduralPantsRigCoreScript'; // Prevents duplicate shared pants-math loads.
  const DEFAULT_GARMENT_ID = 'pants_basic'; // Matches the repository asset authored by the user.
  const DEFAULT_IMAGE_PATH = 'assets/cosmetics/clothes/legs/pants_basic.png'; // Runtime-relative path stored in authored garment data.
  const DEFAULT_IMAGE_URL = SELF_SCRIPT_SRC
    ? new URL('../assets/cosmetics/clothes/legs/pants_basic.png', SELF_SCRIPT_SRC).href
    : new URL('../../assets/cosmetics/clothes/legs/pants_basic.png', window.location.href).href; // Used only by the Three.js preview texture.
  const AUTHOR_URL = SELF_SCRIPT_SRC
    ? new URL('../tools/pants-rig-author/index.html?embedded=1', SELF_SCRIPT_SRC).href
    : new URL('../pants-rig-author/index.html?embedded=1', window.location.href).href; // Embeds the existing author inside Procedural Animation rather than duplicating it.
  const PREVIEW_SEGMENTS = 32; // Dense enough to show painted deformation while remaining cheap on mobile.

  const state = { // Keeps all editor-only UI/mesh state together for mobile diagnostics and clean disposal.
    panel: null,
    iframe: null,
    quickButton: null,
    liveToggle: null,
    status: null,
    open: false,
    coreReady: false,
    preview: null,
    lastProjectSignature: '',
    lastModel: null,
    lastIdentityKey: '',
    forceRebuild: true,
    frameCount: 0,
  };

  function normalizeSpecies(value) {
    return String(value || '').trim().toLowerCase().replace(/_/g, '-');
  }

  function normalizeGender(value) {
    return String(value || '').trim().toLowerCase();
  }

  function identityKey(identity) {
    return `${normalizeSpecies(identity?.speciesId)}::${normalizeGender(identity?.gender)}`;
  }

  function editorLog(message, level = 'info', extra = null) {
    const backdropLog = window.HobunjiGameplayBackdrop?.log;
    if (backdropLog) { backdropLog(message, level, extra); return; }
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    fn(`[Pants Rig] ${message}`, extra ?? '');
  }

  function setStatus(message, kind = 'good') {
    if (state.status) {
      state.status.textContent = message;
      state.status.dataset.kind = kind;
    }
    const pill = document.getElementById('statusPill');
    if (pill && state.open) {
      pill.textContent = message;
      pill.className = kind === 'warn' ? 'pill warn' : 'pill good';
    }
  }

  function loadCore() {
    if (window.HobunjiPantsRig) {
      state.coreReady = true;
      return Promise.resolve(window.HobunjiPantsRig);
    }
    const existing = document.getElementById(CORE_SCRIPT_ID);
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', () => { state.coreReady = !!window.HobunjiPantsRig; resolve(window.HobunjiPantsRig); }, { once: true });
        existing.addEventListener('error', reject, { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script'); // Loads only the shared math; the 2D author remains inside its embedded iframe.
      script.id = CORE_SCRIPT_ID;
      script.async = false;
      script.src = SELF_SCRIPT_SRC
        ? new URL('pants-rig-core.js', SELF_SCRIPT_SRC).href
        : new URL('../../js/pants-rig-core.js', window.location.href).href;
      script.addEventListener('load', () => {
        state.coreReady = !!window.HobunjiPantsRig;
        if (state.coreReady) resolve(window.HobunjiPantsRig);
        else reject(new Error('pants-rig-core loaded without installing HobunjiPantsRig.'));
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${script.src}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  function authorApi() {
    try { return state.iframe?.contentWindow?.__pantsRigAuthorDebug || null; }
    catch (_) { return null; }
  }

  function selectedIdentity() {
    const backdrop = window.HobunjiGameplayBackdrop;
    const selected = backdrop?.getSelectedNpc?.(); // Uses the exact NPC currently shown by Procedural Animation when available.
    const appearance = selected?.appearance || {};
    const speciesId = appearance.speciesId || selected?.speciesId || selected?.species || selected?.fighter?.speciesId;
    const gender = appearance.gender || selected?.gender || selected?.fighter?.gender;
    if (speciesId && gender) return { speciesId, gender };
    const childState = authorApi()?.state?.(); // Falls back to the 2D author's current canonical portrait if the preview host has no selected NPC yet.
    const fighter = childState?.fighter;
    return fighter ? { speciesId: fighter.speciesId || fighter.id, gender: fighter.gender } : null;
  }

  function syncAuthorToProceduralIdentity() {
    const identity = selectedIdentity();
    if (!identity) return null;
    authorApi()?.setCharacter?.(identity.speciesId, identity.gender);
    return identity;
  }

  function currentAuthorProject() {
    const api = authorApi();
    if (!api?.exportProject) return null;
    try { return api.exportProject(); }
    catch (error) {
      editorLog('Could not read the embedded pants project.', 'warn', error);
      return null;
    }
  }

  function currentGarmentId() {
    return String(authorApi()?.state?.()?.garmentId || DEFAULT_GARMENT_ID);
  }

  function findPortraitPlane(model) {
    let preferred = null; // Prefers the avatar's canonical front/skinned PNG plane and ignores the pants preview itself.
    let fallback = null;
    model?.traverse?.((node) => {
      if (!node?.isMesh || node.userData?.hobunjiPantsPreview) return;
      if (!fallback && node.geometry) fallback = node;
      const face = String(node.userData?.hobunjiPlaneFace || '').toLowerCase();
      const name = String(node.name || '').toLowerCase();
      if (!preferred && (face === 'front' || /front.*plane|plane.*front/.test(name) || node.isSkinnedMesh)) preferred = node;
    });
    return preferred || fallback;
  }

  function portraitDimensions(model, plane) {
    const params = plane?.geometry?.parameters || {};
    const width = Number(model?.userData?.portraitModelWidth) || Number(params.width) || 0.9;
    const height = Number(model?.userData?.portraitModelHeight) || Number(params.height) || width;
    return { width: Math.max(0.05, width), height: Math.max(0.05, height) };
  }

  function findLegNodes(model) {
    if (!model?.getObjectByName) return null;
    const nodes = {
      leftThigh: model.getObjectByName('left_thigh'),
      leftCalf: model.getObjectByName('left_calf'),
      rightThigh: model.getObjectByName('right_thigh'),
      rightCalf: model.getObjectByName('right_calf'),
    }; // Reuses the procedural editor's live IK hierarchy directly; no second skeleton is created.
    return Object.values(nodes).every(Boolean) ? nodes : null;
  }

  function relativeMatrix(THREE, node, model) {
    model.updateMatrixWorld?.(true);
    node.updateMatrixWorld?.(true);
    const inverseModel = new THREE.Matrix4().copy(model.matrixWorld).invert(); // Converts the editor's live bone transform into avatar-local space.
    return new THREE.Matrix4().multiplyMatrices(inverseModel, node.matrixWorld);
  }

  function captureLegMatrices(THREE, nodes, model) {
    if (!nodes) return null;
    return {
      leftThigh: relativeMatrix(THREE, nodes.leftThigh, model),
      leftCalf: relativeMatrix(THREE, nodes.leftCalf, model),
      rightThigh: relativeMatrix(THREE, nodes.rightThigh, model),
      rightCalf: relativeMatrix(THREE, nodes.rightCalf, model),
    };
  }

  function legDeltas(THREE, rest, current) {
    if (!rest || !current) return null;
    const deltas = {};
    for (const channel of ['leftThigh', 'leftCalf', 'rightThigh', 'rightCalf']) {
      const inverseRest = new THREE.Matrix4().copy(rest[channel]).invert();
      deltas[channel] = new THREE.Matrix4().multiplyMatrices(current[channel], inverseRest);
    }
    return deltas;
  }

  function forwardStaticFit(Core, garment, character, point) {
    const controls = Core.buildLegOpeningFitControls(garment, Number(character?.legThickness) || 1); // Uses the exact one-time leg-opening controls as the 2D author.
    const displacement = Core.inverseDistanceDisplacement(point, controls.source, controls.target, 2);
    return {
      x: Core.clamp(point.x + displacement.x),
      y: Core.clamp(point.y + displacement.y),
    };
  }

  function garmentSourceUrl(garment) {
    const path = String(garment?.image || DEFAULT_IMAGE_PATH).trim() || DEFAULT_IMAGE_PATH;
    if (/^https?:/i.test(path)) return path;
    if (path.startsWith('assets/')) return SELF_SCRIPT_SRC
      ? new URL(`../${path}`, SELF_SCRIPT_SRC).href
      : new URL(`../../${path}`, window.location.href).href;
    return DEFAULT_IMAGE_URL;
  }

  function loadTexture(THREE, url) {
    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader(); // Loads the clean PNG only; editor guides/weight colors are never baked into this texture.
      loader.setCrossOrigin?.('anonymous');
      loader.load(url, texture => {
        if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        resolve(texture);
      }, undefined, reject);
    });
  }

  function disposePreview() {
    const preview = state.preview;
    if (!preview) return;
    preview.mesh?.removeFromParent?.();
    preview.geometry?.dispose?.();
    preview.material?.dispose?.();
    preview.texture?.dispose?.();
    state.preview = null;
  }

  function createGeometry(THREE, Core, model, plane, garment, character) {
    const transform = Core.solveAffine(garment.pantsBeltSpline, character.portraitBeltSpline); // Maps pants PNG space into the authored species/gender portrait waist space.
    if (!transform) return null;
    const dimensions = portraitDimensions(model, plane);
    const weightGrid = garment.weightMap?.encoding === 'rle8' ? Core.decodeWeightGridRle(garment.weightMap) : garment.weightMap;
    const vertexCount = (PREVIEW_SEGMENTS + 1) * (PREVIEW_SEGMENTS + 1);
    const positions = new Float32Array(vertexCount * 3); // Dynamic current positions deformed from the immutable basePositions each frame.
    const basePositions = new Float32Array(vertexCount * 3); // Neutral avatar-local pants vertices before procedural leg motion.
    const uvs = new Float32Array(vertexCount * 2); // Samples the clean source PNG; static leg thickness is geometry-space only in this live author preview.
    const weights = new Float32Array(vertexCount * 5); // belt,leftThigh,leftCalf,rightThigh,rightCalf in Core.WEIGHT_CHANNELS order.
    const indices = [];
    model.updateMatrixWorld?.(true);
    plane.updateMatrixWorld?.(true);
    let vertex = 0;
    const localPoint = new THREE.Vector3();
    const worldPoint = new THREE.Vector3();
    for (let row = 0; row <= PREVIEW_SEGMENTS; row++) {
      const v = row / PREVIEW_SEGMENTS;
      for (let col = 0; col <= PREVIEW_SEGMENTS; col++, vertex++) {
        const u = col / PREVIEW_SEGMENTS;
        const fitted = forwardStaticFit(Core, garment, character, { x: u, y: v });
        const portrait = Core.applyAffine(transform, fitted);
        localPoint.set((portrait.x - 0.5) * dimensions.width, (0.5 - portrait.y) * dimensions.height, 0.012); // Portrait y is down; Three.js local y is up.
        worldPoint.copy(localPoint);
        plane.localToWorld(worldPoint); // Preserves any assembly offset/rotation already used by the procedural editor's actual portrait plane.
        model.worldToLocal(worldPoint);
        basePositions[vertex * 3] = positions[vertex * 3] = worldPoint.x;
        basePositions[vertex * 3 + 1] = positions[vertex * 3 + 1] = worldPoint.y;
        basePositions[vertex * 3 + 2] = positions[vertex * 3 + 2] = worldPoint.z;
        uvs[vertex * 2] = u;
        uvs[vertex * 2 + 1] = 1 - v;
        const sampled = Core.sampleWeights(weightGrid, u, v);
        let sum = 0;
        Core.WEIGHT_CHANNELS.forEach((channel, channelIndex) => {
          const value = Math.max(0, Number(sampled[channel]) || 0);
          weights[vertex * 5 + channelIndex] = value;
          sum += value;
        });
        if (!(sum > 0)) { weights[vertex * 5] = 1; sum = 1; }
        if (Math.abs(sum - 1) > 0.0001) {
          for (let channelIndex = 0; channelIndex < 5; channelIndex++) weights[vertex * 5 + channelIndex] /= sum;
        }
      }
    }
    for (let row = 0; row < PREVIEW_SEGMENTS; row++) {
      for (let col = 0; col < PREVIEW_SEGMENTS; col++) {
        const a = row * (PREVIEW_SEGMENTS + 1) + col;
        const b = a + 1;
        const c = a + PREVIEW_SEGMENTS + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.getAttribute('position').setUsage?.(THREE.DynamicDrawUsage || 35048);
    geometry.computeBoundingSphere();
    return { geometry, basePositions, weights };
  }

  async function rebuildPreview(model, project, identity) {
    const THREE = window.THREE;
    const Core = window.HobunjiPantsRig;
    if (!THREE || !Core || !model || !project || !identity) return false;
    const garmentId = currentGarmentId();
    const garment = project.garments?.[garmentId] || project.garments?.[DEFAULT_GARMENT_ID] || Object.values(project.garments || {})[0];
    const character = project.characters?.[identityKey(identity)];
    const plane = findPortraitPlane(model);
    const nodes = findLegNodes(model);
    if (!garment || !character || !plane || !nodes) {
      setStatus(!nodes ? 'Pants 3D preview is waiting for the procedural leg chain.' : 'Author the current species beltline before 3D preview.', 'warn');
      disposePreview();
      return false;
    }
    const built = createGeometry(THREE, Core, model, plane, garment, character);
    if (!built) {
      setStatus('Could not solve pants beltline mapping for this species.', 'warn');
      disposePreview();
      return false;
    }
    const texture = await loadTexture(THREE, garmentSourceUrl(garment));
    if (model !== window.HobunjiGameplayBackdrop?.getAvatarModel?.()) {
      texture.dispose?.();
      built.geometry.dispose?.();
      return false;
    }
    disposePreview();
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.01,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }); // Unlit PNG-plane material matches the editor/game's sprite presentation and avoids lighting differences.
    const mesh = new THREE.Mesh(built.geometry, material);
    mesh.name = 'ProceduralPantsRigLivePreview';
    mesh.renderOrder = 28;
    mesh.frustumCulled = false;
    mesh.userData.hobunjiPantsPreview = true;
    model.add(mesh);
    model.updateMatrixWorld?.(true);
    state.preview = {
      model,
      mesh,
      geometry: built.geometry,
      material,
      texture,
      basePositions: built.basePositions,
      weights: built.weights,
      nodes,
      restMatrices: captureLegMatrices(THREE, nodes, model),
      garmentId,
      identityKey: identityKey(identity),
    };
    setStatus('Live pants preview bound to this Procedural Animation avatar + IK legs.', 'good');
    return true;
  }

  function updatePreviewPose() {
    const preview = state.preview;
    const THREE = window.THREE;
    if (!preview || !THREE || !preview.model?.parent) return;
    const current = captureLegMatrices(THREE, preview.nodes, preview.model);
    const deltas = legDeltas(THREE, preview.restMatrices, current);
    if (!deltas) return;
    const position = preview.geometry.getAttribute('position');
    const base = preview.basePositions;
    const weights = preview.weights;
    const source = new THREE.Vector3();
    const transformed = new THREE.Vector3();
    const output = new THREE.Vector3();
    const channels = ['leftThigh', 'leftCalf', 'rightThigh', 'rightCalf'];
    for (let vertex = 0; vertex < position.count; vertex++) {
      source.set(base[vertex * 3], base[vertex * 3 + 1], base[vertex * 3 + 2]);
      const beltWeight = weights[vertex * 5] || 0;
      output.copy(source).multiplyScalar(beltWeight);
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
        const weight = weights[vertex * 5 + channelIndex + 1] || 0;
        if (weight <= 0.0001) continue;
        transformed.copy(source).applyMatrix4(deltas[channels[channelIndex]]);
        output.addScaledVector(transformed, weight);
      }
      position.setXYZ(vertex, output.x, output.y, output.z);
    }
    position.needsUpdate = true;
    preview.geometry.computeBoundingSphere();
  }

  function projectSignature(project, identity, model) {
    const garmentId = currentGarmentId();
    const garment = project?.garments?.[garmentId] || project?.garments?.[DEFAULT_GARMENT_ID] || null;
    const character = project?.characters?.[identityKey(identity)] || null;
    if (!garment || !character) return `${model?.uuid || ''}|${garmentId}|missing`;
    return `${model?.uuid || ''}|${garmentId}|${identityKey(identity)}|${JSON.stringify({
      belt: garment.pantsBeltSpline,
      openings: garment.legOpenings,
      bones: garment.legBones,
      weights: garment.weightMap,
      image: garment.image,
      portraitBelt: character.portraitBeltSpline,
      legThickness: character.legThickness,
    })}`; // Includes every authored value that changes mesh mapping/weighting so edits become visible without a manual rebuild.
  }

  async function syncPreviewBinding() {
    if (!state.open || !state.liveToggle?.checked) {
      disposePreview();
      return;
    }
    const backdrop = window.HobunjiGameplayBackdrop;
    if (backdrop?.getPreviewMode?.() === 'creature') {
      disposePreview();
      setStatus('Pants rig preview is for humanoid NPC/player portraits, not creature mode.', 'warn');
      return;
    }
    const model = backdrop?.getAvatarModel?.();
    const identity = syncAuthorToProceduralIdentity();
    const project = currentAuthorProject();
    if (!model || !identity || !project) {
      setStatus('Waiting for the procedural avatar and embedded pants author…', 'warn');
      return;
    }
    const signature = projectSignature(project, identity, model);
    if (state.forceRebuild || state.lastModel !== model || state.lastProjectSignature !== signature || state.lastIdentityKey !== identityKey(identity)) {
      state.forceRebuild = false;
      state.lastModel = model;
      state.lastProjectSignature = signature;
      state.lastIdentityKey = identityKey(identity);
      await rebuildPreview(model, project, identity);
    }
  }

  function injectStyles() {
    if (document.getElementById('proceduralPantsRigStyles')) return;
    const style = document.createElement('style'); // Makes Pants Rig behave like the editor's existing Impact/Dance floating workspaces.
    style.id = 'proceduralPantsRigStyles';
    style.textContent = `
#${PANEL_ID}{position:absolute;z-index:120;top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));width:min(620px,52vw);max-width:calc(100% - 16px);display:none;grid-template-rows:auto minmax(0,1fr);overflow:hidden;border:1px solid rgba(255,255,255,.18);border-radius:15px;background:rgba(7,16,26,.985);box-shadow:0 22px 70px rgba(0,0,0,.62)}
#${PANEL_ID}.open{display:grid}
#${PANEL_ID} .pantsRigHostHeader{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:7px 9px;border-bottom:1px solid rgba(255,255,255,.12);background:linear-gradient(180deg,rgba(22,37,56,.99),rgba(11,20,31,.99))}
#${PANEL_ID} .pantsRigHostTitle{font-size:12px;font-weight:800;color:#dce9ff}.pantsRigHostSub{font-size:10px;color:#9eb2cb;margin-top:2px}
#${PANEL_ID} .pantsRigHostTools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
#${PANEL_ID} .pantsRigHostTools label{display:flex;align-items:center;gap:5px;font-size:10px;color:#c7d5e8;white-space:nowrap}
#${PANEL_ID} .pantsRigHostTools input{width:auto}
#${PANEL_ID} .pantsRigHostTools button{min-height:34px;padding:5px 8px}
#${PANEL_ID} .pantsRigHostBody{display:grid;grid-template-rows:minmax(0,1fr) auto;min-height:0}
#${PANEL_ID} iframe{width:100%;height:100%;border:0;background:#07101a}
#${PANEL_ID} .pantsRigHostStatus{padding:5px 8px;border-top:1px solid rgba(255,255,255,.1);font:10px/1.35 ui-monospace,monospace;color:#9edfbf;background:#07101a}.pantsRigHostStatus[data-kind="warn"]{color:#ffc857}
@media(max-width:700px) and (orientation:portrait){#${PANEL_ID}{top:auto;left:max(4px,env(safe-area-inset-left));right:max(4px,env(safe-area-inset-right));bottom:max(4px,env(safe-area-inset-bottom));width:auto;height:min(58dvh,690px);max-width:none;border-radius:13px}#${PANEL_ID} .pantsRigHostHeader{padding:5px 7px}.pantsRigHostSub{display:none}}
@media(max-height:520px) and (orientation:landscape){#${PANEL_ID}{top:max(4px,env(safe-area-inset-top));right:max(4px,env(safe-area-inset-right));bottom:max(4px,env(safe-area-inset-bottom));width:min(560px,48vw);border-radius:11px}}
`;
    document.head.appendChild(style);
  }

  function setOpen(open) {
    state.open = !!open;
    state.panel?.classList.toggle('open', state.open);
    state.quickButton?.classList.toggle('active', state.open);
    if (state.open) {
      state.forceRebuild = true;
      syncAuthorToProceduralIdentity();
      setStatus('Pants Rig open · 3D preview uses the live Procedural Animation avatar.', 'good');
    } else {
      disposePreview();
    }
  }

  function buildPanel() {
    const modalRoot = document.getElementById('gameModalOverlayRoot'); // Uses the same full-viewport layer as Impact instead of making Pants Rig a separate tool page.
    const actionRow = document.querySelector('#animationHud .animationHudActions');
    if (!modalRoot || !actionRow || document.getElementById(PANEL_ID)) return false;
    injectStyles();

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'Pants Rig Author');
    panel.innerHTML = `
      <header class="pantsRigHostHeader">
        <div><div class="pantsRigHostTitle">👖 Pants Rig Author</div><div class="pantsRigHostSub">2D rig/weights + live 3D deformation on this procedural avatar</div></div>
        <div class="pantsRigHostTools">
          <label><input id="proceduralPantsLive3d" type="checkbox" checked> Live 3D</label>
          <button id="proceduralPantsRebind" type="button" class="secondary">Rebind</button>
          <button id="proceduralPantsClose" type="button" class="secondary" aria-label="Close Pants Rig">×</button>
        </div>
      </header>
      <div class="pantsRigHostBody">
        <iframe id="proceduralPantsRigFrame" title="Pants Rig Author"></iframe>
        <div id="proceduralPantsRigStatus" class="pantsRigHostStatus">Loading pants author…</div>
      </div>`;
    modalRoot.appendChild(panel);
    state.panel = panel;
    state.iframe = panel.querySelector('#proceduralPantsRigFrame');
    state.liveToggle = panel.querySelector('#proceduralPantsLive3d');
    state.status = panel.querySelector('#proceduralPantsRigStatus');
    state.iframe.addEventListener('load', () => {
      state.forceRebuild = true;
      setTimeout(() => {
        syncAuthorToProceduralIdentity();
        authorApi()?.loadDefaultPants?.();
        authorApi()?.renderWeightOverlay?.();
      }, 0);
    });
    state.iframe.src = AUTHOR_URL;
    state.liveToggle.addEventListener('change', () => {
      state.forceRebuild = true;
      if (!state.liveToggle.checked) disposePreview();
    });
    panel.querySelector('#proceduralPantsRebind').addEventListener('click', () => {
      state.forceRebuild = true;
      syncAuthorToProceduralIdentity();
      setStatus('Rebinding pants preview to the current procedural avatar…', 'good');
    });
    panel.querySelector('#proceduralPantsClose').addEventListener('click', () => setOpen(false));

    const quick = document.createElement('button');
    quick.id = BUTTON_ID;
    quick.type = 'button';
    quick.className = 'secondary';
    quick.textContent = 'Pants';
    quick.title = 'Open Pants Rig Author on the current Procedural Animation avatar';
    quick.addEventListener('click', () => setOpen(!state.open));
    actionRow.appendChild(quick);
    state.quickButton = quick;

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.open) setOpen(false);
    });
    const observer = new MutationObserver(() => { // Restores the workspace if the editor rebuilds/clears its modal root.
      if (state.panel && !modalRoot.contains(state.panel)) modalRoot.appendChild(state.panel);
    });
    observer.observe(modalRoot, { childList: true });
    return true;
  }

  async function frame() {
    state.frameCount++;
    if (state.open && state.liveToggle?.checked) {
      updatePreviewPose(); // Runs every rendered frame so animation-author IK changes are reflected immediately in the pants mesh.
      if (state.frameCount % 12 === 0) await syncPreviewBinding(); // Rechecks author edits/avatar identity about five times per second without rebuilding every frame.
    }
    requestAnimationFrame(() => { frame().catch(error => editorLog('Pants Rig frame error', 'warn', error)); });
  }

  async function init() {
    await loadCore();
    const install = () => {
      if (buildPanel()) {
        editorLog('Integrated Pants Rig Author ready inside Procedural Animation.');
        requestAnimationFrame(() => { frame().catch(error => editorLog('Pants Rig loop failed', 'warn', error)); });
        return true;
      }
      return false;
    };
    if (!install()) {
      const started = performance.now();
      const retry = () => {
        if (install()) return;
        if (performance.now() - started > 12000) {
          editorLog('Could not find the procedural editor HUD/modal root for Pants Rig.', 'warn');
          return;
        }
        requestAnimationFrame(retry);
      };
      requestAnimationFrame(retry);
    }
  }

  window.ProceduralPantsRigAuthor = {
    installed: true,
    open: () => setOpen(true),
    close: () => setOpen(false),
    rebuild: () => { state.forceRebuild = true; },
    getPreviewMesh: () => state.preview?.mesh || null,
    getAuthorFrame: () => state.iframe || null,
    debugSnapshot: () => ({
      open: state.open,
      coreReady: state.coreReady,
      live3d: !!state.liveToggle?.checked,
      authorReady: !!authorApi(),
      garmentId: currentGarmentId(),
      identity: selectedIdentity(),
      modelName: window.HobunjiGameplayBackdrop?.getAvatarModel?.()?.name || null,
      previewBound: !!state.preview,
      previewVertices: state.preview?.geometry?.getAttribute?.('position')?.count || 0,
      proceduralLegs: !!findLegNodes(window.HobunjiGameplayBackdrop?.getAvatarModel?.()),
    }),
  }; // Mobile-readable diagnostics and direct open/rebuild hooks without DevTools.

  init().catch(error => editorLog(`Pants Rig integration failed: ${error?.message || error}`, 'error', error));
})();
