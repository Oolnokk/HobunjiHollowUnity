// Procedural Animation Editor: integrated Pants Rig Author + live 3D garment preview.
(function () {
  'use strict';

  if (window.ProceduralPantsRigAuthor?.installed) return;

  const SELF_SCRIPT_SRC = document.currentScript?.src || ''; // Keeps dynamically loaded authoring pieces on this exact branch/commit.
  const PANEL_ID = 'proceduralPantsRigPanel'; // Identifies the Pants workspace hosted by Procedural Animation.
  const BUTTON_ID = 'proceduralPantsRigQuickBtn'; // Identifies the visible Animation HUD entry button.
  const CORE_SCRIPT_ID = 'proceduralPantsRigCoreScript'; // Prevents duplicate shared pants-math loads.
  const DEFAULT_GARMENT_ID = 'pants_basic'; // Matches the repository garment uploaded by the user.
  const DEFAULT_IMAGE_PATH = 'assets/cosmetics/clothes/legs/pants_basic.png'; // Runtime-relative path stored with the authored garment.
  const DEFAULT_IMAGE_URL = SELF_SCRIPT_SRC
    ? new URL('../assets/cosmetics/clothes/legs/pants_basic.png', SELF_SCRIPT_SRC).href
    : new URL('../../assets/cosmetics/clothes/legs/pants_basic.png', window.location.href).href; // Supplies the clean PNG to the live preview.
  const AUTHOR_URL = SELF_SCRIPT_SRC
    ? new URL('../tools/pants-rig-author/index.html?embedded=1', SELF_SCRIPT_SRC).href
    : new URL('../pants-rig-author/index.html?embedded=1', window.location.href).href; // Hosts the existing 2D author inside Procedural Animation.
  const PREVIEW_SEGMENTS = 32; // Gives the garment enough vertices for smooth painted leg weights while staying mobile-friendly.
  const DYNAMIC_DRAW_USAGE = 35048; // Three.js DynamicDrawUsage numeric value used without requiring a global THREE namespace.
  const DOUBLE_SIDE = 2; // Three.js DoubleSide numeric value used without requiring a global THREE namespace.

  const state = { // Owns the editor-only Pants UI and preview resources.
    panel: null,
    iframe: null,
    quickButton: null,
    liveToggle: null,
    status: null,
    open: false,
    coreReady: false,
    preview: null,
    lastModel: null,
    lastIdentityKey: '',
    forceRebuild: true,
    frameCount: 0,
    buildGeneration: 0,
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
    const backdropLog = window.HobunjiGameplayBackdrop?.log; // Reuses the procedural tool's in-page diagnostics when available.
    if (backdropLog) { backdropLog(message, level, extra); return; }
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    fn(`[Pants Rig] ${message}`, extra ?? '');
  }

  function setStatus(message, kind = 'good') {
    if (state.status) {
      state.status.textContent = message;
      state.status.dataset.kind = kind;
    }
    const pill = document.getElementById('statusPill'); // Mirrors important Pants state into the procedural editor's mobile-visible status pill.
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
    const existing = document.getElementById(CORE_SCRIPT_ID); // Shares an in-flight core load if this adapter is evaluated twice.
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', () => {
          state.coreReady = !!window.HobunjiPantsRig;
          state.coreReady ? resolve(window.HobunjiPantsRig) : reject(new Error('Pants rig core did not install.'));
        }, { once: true });
        existing.addEventListener('error', reject, { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script'); // Loads only shared rig math; all preview rendering stays on the procedural editor's native Three objects.
      script.id = CORE_SCRIPT_ID;
      script.async = false;
      script.src = SELF_SCRIPT_SRC
        ? new URL('pants-rig-core.js', SELF_SCRIPT_SRC).href
        : new URL('../../js/pants-rig-core.js', window.location.href).href;
      script.addEventListener('load', () => {
        state.coreReady = !!window.HobunjiPantsRig;
        state.coreReady ? resolve(window.HobunjiPantsRig) : reject(new Error('pants-rig-core loaded without installing HobunjiPantsRig.'));
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
    const backdrop = window.HobunjiGameplayBackdrop; // Reads the exact Procedural Animation preview selection.
    const selected = backdrop?.getSelectedNpc?.();
    const appearance = selected?.appearance || {};
    const speciesId = appearance.speciesId || selected?.speciesId || selected?.species || selected?.fighter?.speciesId;
    const gender = appearance.gender || selected?.gender || selected?.fighter?.gender;
    if (speciesId && gender) return { speciesId, gender };
    const fighter = authorApi()?.state?.()?.fighter; // Falls back to the embedded author's canonical portrait selection before an NPC is selected.
    return fighter ? { speciesId: fighter.speciesId || fighter.id, gender: fighter.gender } : null;
  }

  function syncAuthorToProceduralIdentity() {
    const identity = selectedIdentity(); // Keeps portrait-belt authoring on the same species/gender as the live 3D avatar.
    if (!identity) return null;
    authorApi()?.setCharacter?.(identity.speciesId, identity.gender);
    return identity;
  }

  function currentAuthorProject() {
    const api = authorApi(); // Reads the dense/current editor state through its existing export boundary rather than duplicating weight serialization.
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
    let preferred = null; // Prefers the canonical front/skinned portrait plane used by the procedural preview.
    let fallback = null; // Keeps the preview functional for older rigid-plane builds.
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
    const parameters = plane?.geometry?.parameters || {}; // Reads authored plane dimensions when model metadata has not been published yet.
    const width = Number(model?.userData?.portraitModelWidth) || Number(parameters.width) || 0.9;
    const height = Number(model?.userData?.portraitModelHeight) || Number(parameters.height) || width;
    return { width: Math.max(0.05, width), height: Math.max(0.05, height) };
  }

  function findLegNodes(model) {
    if (!model?.getObjectByName) return null;
    const nodes = { // These are the procedural editor's existing IK transforms, not a Pants-specific skeleton.
      leftThigh: model.getObjectByName('left_thigh'),
      leftCalf: model.getObjectByName('left_calf'),
      rightThigh: model.getObjectByName('right_thigh'),
      rightCalf: model.getObjectByName('right_calf'),
    };
    return Object.values(nodes).every(Boolean) ? nodes : null;
  }

  function constructorNamed(instance, name) {
    let proto = instance; // Walks native Three prototype chains so this adapter never needs window.THREE, which the procedural editor intentionally does not expose.
    while (proto) {
      const ctor = proto.constructor;
      if (ctor?.name === name) return ctor;
      proto = Object.getPrototypeOf(proto);
    }
    return null;
  }

  function deriveRuntime(model, plane) {
    if (!model || !plane?.geometry) return null;
    const Vector3 = model.position?.constructor; // Used for garment-space/world-space point conversion and weighted skinning.
    const Matrix4 = model.matrixWorld?.constructor; // Used for rest-relative procedural-bone transforms.
    const BufferGeometry = constructorNamed(plane.geometry, 'BufferGeometry') || plane.geometry.constructor; // Used to create the dynamic garment mesh geometry.
    const sourcePosition = plane.geometry.getAttribute?.('position'); // Supplies a real BufferAttribute prototype from the editor's Three instance.
    const BufferAttribute = constructorNamed(sourcePosition, 'BufferAttribute') || sourcePosition?.constructor; // Used to install dynamic position/UV arrays.
    let meshSample = null; // Finds a normal Mesh constructor so a skinned portrait does not accidentally create a SkinnedMesh with no skeleton.
    model.traverse?.((node) => {
      if (!meshSample && node?.isMesh && !node?.isSkinnedMesh && !node.userData?.hobunjiPantsPreview) meshSample = node;
    });
    let Mesh = meshSample?.constructor || null;
    if (!Mesh && plane.isSkinnedMesh) Mesh = Object.getPrototypeOf(plane.constructor?.prototype || null)?.constructor || null;
    if (!Mesh) Mesh = plane.constructor;
    const materials = Array.isArray(plane.material) ? plane.material : [plane.material]; // Chooses the visible portrait material as a cloning template.
    const sourceMaterial = materials.find(material => material?.map) || materials.find(Boolean) || null;
    const sourceTexture = sourceMaterial?.map || null;
    if (![Vector3, Matrix4, BufferGeometry, BufferAttribute, Mesh, sourceMaterial, sourceTexture].every(Boolean)) return null;
    return { Vector3, Matrix4, BufferGeometry, BufferAttribute, Mesh, sourceMaterial, sourceTexture };
  }

  function relativeMatrix(Runtime, node, model) {
    model.updateMatrixWorld?.(true);
    node.updateMatrixWorld?.(true);
    const inverseModel = new Runtime.Matrix4().copy(model.matrixWorld).invert(); // Converts a live procedural-bone transform into avatar-local space.
    return new Runtime.Matrix4().multiplyMatrices(inverseModel, node.matrixWorld);
  }

  function captureLegMatrices(Runtime, nodes, model) {
    if (!Runtime || !nodes) return null;
    return {
      leftThigh: relativeMatrix(Runtime, nodes.leftThigh, model),
      leftCalf: relativeMatrix(Runtime, nodes.leftCalf, model),
      rightThigh: relativeMatrix(Runtime, nodes.rightThigh, model),
      rightCalf: relativeMatrix(Runtime, nodes.rightCalf, model),
    };
  }

  function legDeltas(Runtime, rest, current) {
    if (!Runtime || !rest || !current) return null;
    const deltas = {}; // Rest→current matrices are applied by the four painted leg channels each frame.
    for (const channel of ['leftThigh', 'leftCalf', 'rightThigh', 'rightCalf']) {
      const inverseRest = new Runtime.Matrix4().copy(rest[channel]).invert();
      deltas[channel] = new Runtime.Matrix4().multiplyMatrices(current[channel], inverseRest);
    }
    return deltas;
  }

  function forwardStaticFit(Core, garment, character, point) {
    const controls = Core.buildLegOpeningFitControls(garment, Number(character?.legThickness) || 1); // Uses the exact one-time species/gender leg-opening fit as the 2D author.
    const displacement = Core.inverseDistanceDisplacement(point, controls.source, controls.target, 2);
    return { x: Core.clamp(point.x + displacement.x), y: Core.clamp(point.y + displacement.y) };
  }

  function garmentSourceUrl(garment) {
    const path = String(garment?.image || DEFAULT_IMAGE_PATH).trim() || DEFAULT_IMAGE_PATH;
    if (/^https?:/i.test(path)) return path;
    if (path.startsWith('assets/')) return SELF_SCRIPT_SRC
      ? new URL(`../${path}`, SELF_SCRIPT_SRC).href
      : new URL(`../../${path}`, window.location.href).href;
    return DEFAULT_IMAGE_URL;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image(); // Loads the clean repository PNG; no workspace spline/weight colors ever enter the 3D texture.
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load pants texture ${url}`));
      image.src = url;
    });
  }

  async function clonePreviewTexture(Runtime, url) {
    const image = await loadImage(url); // Replaces only the cloned texture image while preserving the procedural editor's native texture class/filter/wrapping settings.
    const texture = Runtime.sourceTexture.clone();
    texture.image = image;
    texture.needsUpdate = true;
    return texture;
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

  function createGeometry(Runtime, Core, model, plane, garment, character) {
    const transform = Core.solveAffine(garment.pantsBeltSpline, character.portraitBeltSpline); // Maps the pants beltline into this species/gender's authored portrait beltline.
    if (!transform) return null;
    const dimensions = portraitDimensions(model, plane);
    const weightGrid = garment.weightMap?.encoding === 'rle8' ? Core.decodeWeightGridRle(garment.weightMap) : garment.weightMap; // Uses the exact painted five-channel weight data.
    const vertexCount = (PREVIEW_SEGMENTS + 1) * (PREVIEW_SEGMENTS + 1); // Allocates one regular deformable grid over the clean PNG.
    const positions = new Float32Array(vertexCount * 3);
    const basePositions = new Float32Array(vertexCount * 3); // Remains neutral so animation deformation never accumulates frame-to-frame.
    const uvs = new Float32Array(vertexCount * 2);
    const weights = new Float32Array(vertexCount * 5); // Channel order is Core.WEIGHT_CHANNELS.
    const indices = [];
    model.updateMatrixWorld?.(true);
    plane.updateMatrixWorld?.(true);
    let vertex = 0;
    const localPoint = new Runtime.Vector3(); // Reused while mapping fitted PNG pixels through the real portrait plane.
    const worldPoint = new Runtime.Vector3(); // Reused to convert that portrait position back into avatar-local space.
    for (let row = 0; row <= PREVIEW_SEGMENTS; row++) {
      const v = row / PREVIEW_SEGMENTS;
      for (let col = 0; col <= PREVIEW_SEGMENTS; col++, vertex++) {
        const u = col / PREVIEW_SEGMENTS;
        const fitted = forwardStaticFit(Core, garment, character, { x: u, y: v });
        const portrait = Core.applyAffine(transform, fitted);
        localPoint.set((portrait.x - 0.5) * dimensions.width, (0.5 - portrait.y) * dimensions.height, 0.012);
        worldPoint.copy(localPoint);
        plane.localToWorld(worldPoint); // Includes the exact Procedural Animation portrait assembly transform.
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
    const geometry = new Runtime.BufferGeometry(); // Created from the live editor's own BufferGeometry constructor, not window.THREE.
    geometry.setAttribute('position', new Runtime.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new Runtime.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.getAttribute('position').setUsage?.(DYNAMIC_DRAW_USAGE);
    geometry.computeBoundingSphere();
    return { geometry, basePositions, weights };
  }

  async function rebuildPreview(model, project, identity) {
    const Core = window.HobunjiPantsRig;
    if (!Core || !model || !project || !identity) return false;
    const garmentId = currentGarmentId();
    const garment = project.garments?.[garmentId] || project.garments?.[DEFAULT_GARMENT_ID] || Object.values(project.garments || {})[0];
    const character = project.characters?.[identityKey(identity)];
    const plane = findPortraitPlane(model);
    const nodes = findLegNodes(model);
    const Runtime = deriveRuntime(model, plane); // Derives all Three constructors from this exact preview instead of relying on a nonexistent/foreign global THREE.
    if (!garment || !character || !plane || !nodes || !Runtime) {
      const reason = !nodes ? 'procedural leg chain' : !character ? 'authored species beltline' : !Runtime ? 'native 3D constructors' : 'garment data';
      setStatus(`Pants 3D preview is waiting for ${reason}.`, 'warn');
      disposePreview();
      return false;
    }
    const built = createGeometry(Runtime, Core, model, plane, garment, character);
    if (!built) {
      setStatus('Could not solve pants beltline mapping for this species.', 'warn');
      disposePreview();
      return false;
    }
    const generation = ++state.buildGeneration; // Rejects stale async image loads if the user changes NPC/garment mid-build.
    const texture = await clonePreviewTexture(Runtime, garmentSourceUrl(garment));
    if (generation !== state.buildGeneration || model !== window.HobunjiGameplayBackdrop?.getAvatarModel?.()) {
      texture.dispose?.();
      built.geometry.dispose?.();
      return false;
    }
    disposePreview();
    const material = Runtime.sourceMaterial.clone(); // Cloning preserves the procedural editor's actual sprite shader/texture conventions.
    material.map = texture;
    material.transparent = true;
    material.alphaTest = 0.01;
    material.side = DOUBLE_SIDE;
    material.depthWrite = false;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    if ('skinning' in material) material.skinning = false; // Prevents a material cloned from a SkinnedMesh portrait from requesting missing skin attributes on the Pants mesh.
    material.color?.set?.(0xffffff);
    material.needsUpdate = true;
    const mesh = new Runtime.Mesh(built.geometry, material); // Plain Mesh constructor is derived from the editor's own scene/model hierarchy.
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
      runtime: Runtime,
      basePositions: built.basePositions,
      weights: built.weights,
      nodes,
      restMatrices: captureLegMatrices(Runtime, nodes, model),
      garmentId,
      identityKey: identityKey(identity),
    };
    setStatus('Live pants preview bound to this Procedural Animation avatar + its existing IK legs.', 'good');
    return true;
  }

  function updatePreviewPose() {
    const preview = state.preview;
    if (!preview || !preview.model?.parent) return;
    const Runtime = preview.runtime; // Uses the same native constructors captured when this preview mesh was created.
    const current = captureLegMatrices(Runtime, preview.nodes, preview.model);
    const deltas = legDeltas(Runtime, preview.restMatrices, current);
    if (!deltas) return;
    const position = preview.geometry.getAttribute('position');
    const base = preview.basePositions;
    const weights = preview.weights;
    const source = new Runtime.Vector3(); // Neutral source vertex reused across the current deformation pass.
    const transformed = new Runtime.Vector3(); // Holds one channel's rest→current transformed vertex.
    const output = new Runtime.Vector3(); // Accumulates the normalized five-channel result.
    const channels = ['leftThigh', 'leftCalf', 'rightThigh', 'rightCalf'];
    for (let vertex = 0; vertex < position.count; vertex++) {
      source.set(base[vertex * 3], base[vertex * 3 + 1], base[vertex * 3 + 2]);
      const beltWeight = weights[vertex * 5] || 0;
      output.copy(source).multiplyScalar(beltWeight); // Belt influence stays rigidly attached to the procedural avatar body root.
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
    const model = backdrop?.getAvatarModel?.(); // Exact avatar currently driven by Procedural Animation.
    const identity = syncAuthorToProceduralIdentity();
    const identityChanged = identityKey(identity) !== state.lastIdentityKey; // Triggers a new species/gender static fit and belt mapping.
    const modelChanged = model !== state.lastModel; // Triggers rebinding when Procedural Animation swaps its preview avatar.
    if (!model || !identity) {
      setStatus('Waiting for a Procedural Animation avatar…', 'warn');
      return;
    }
    if (!state.forceRebuild && !identityChanged && !modelChanged && state.preview) return;
    const project = currentAuthorProject(); // Export/weight encoding is only paid when an edit/avatar change actually requires a rebuild.
    if (!project) {
      setStatus('Waiting for the embedded Pants Rig Author…', 'warn');
      return;
    }
    state.forceRebuild = false;
    state.lastModel = model;
    state.lastIdentityKey = identityKey(identity);
    await rebuildPreview(model, project, identity);
  }

  function injectStyles() {
    if (document.getElementById('proceduralPantsRigStyles')) return;
    const style = document.createElement('style'); // Makes Pants behave like the existing Impact/Dance authoring workspaces.
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
      setStatus('Pants Rig open · Live 3D uses the exact Procedural Animation avatar/IK legs.', 'good');
    } else {
      state.buildGeneration++; // Invalidates any in-flight texture load before the panel disappears.
      disposePreview();
    }
  }

  function buildPanel() {
    const modalRoot = document.getElementById('gameModalOverlayRoot'); // Keeps Pants inside the Procedural Animation tool's existing full-viewport UI layer.
    const actionRow = document.querySelector('#animationHud .animationHudActions'); // Receives the new Pants workspace entry beside existing animation actions.
    if (!modalRoot || !actionRow || document.getElementById(PANEL_ID)) return false;
    injectStyles();

    const panel = document.createElement('section'); // Floating/docked authoring panel; on mobile it becomes a bottom sheet.
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'Pants Rig Author');
    panel.innerHTML = `
      <header class="pantsRigHostHeader">
        <div><div class="pantsRigHostTitle">👖 Pants Rig Author</div><div class="pantsRigHostSub">2D rig + visible weight paint + live deformation on this procedural avatar</div></div>
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

    const quick = document.createElement('button'); // Makes Pants a first-class Procedural Animation workspace instead of a separate tool-hub page.
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
    window.addEventListener('message', event => {
      if (event.source !== state.iframe?.contentWindow || event.data?.type !== 'hobunji-pants-rig-changed') return;
      state.forceRebuild = true; // Rebuilds geometry/weights after a completed 2D authoring gesture rather than serializing the project every animation frame.
    });
    const observer = new MutationObserver(() => {
      if (state.panel && !modalRoot.contains(state.panel)) modalRoot.appendChild(state.panel); // Restores the workspace if the procedural preview rebuilds its modal layer.
    });
    observer.observe(modalRoot, { childList: true });
    return true;
  }

  async function frame() {
    state.frameCount++;
    if (state.open && state.liveToggle?.checked) {
      updatePreviewPose(); // Reads the procedural IK transforms every rendered frame.
      if (state.forceRebuild || state.frameCount % 30 === 0) await syncPreviewBinding(); // Periodic check catches avatar swaps even if no authoring event fired.
    }
    requestAnimationFrame(() => { frame().catch(error => editorLog('Pants Rig frame error', 'warn', error)); });
  }

  async function init() {
    await loadCore();
    const install = () => {
      if (!buildPanel()) return false;
      editorLog('Integrated Pants Rig Author ready inside Procedural Animation.');
      requestAnimationFrame(() => { frame().catch(error => editorLog('Pants Rig loop failed', 'warn', error)); });
      return true;
    };
    if (!install()) {
      const started = performance.now(); // Bounds retries while the giant procedural editor finishes building its HUD/modal roots.
      const retry = () => {
        if (install()) return;
        if (performance.now() - started > 12000) {
          editorLog('Could not find the Procedural Animation HUD/modal root for Pants Rig.', 'warn');
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
      globalThreeRequired: false,
    }),
  }; // Mobile-readable diagnostics without needing a console.

  init().catch(error => editorLog(`Pants Rig integration failed: ${error?.message || error}`, 'error', error));
})();
