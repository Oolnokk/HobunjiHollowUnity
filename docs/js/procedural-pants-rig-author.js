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
  const LEG_ACROSS_SCALE = 'balanced'; // Garment legs stretch ALONG their bone to meet the 3D leg and widen by the square root of that stretch, so proportions hold for any species' leg length.
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
    if (performance.now() < (window.ProceduralPantsRigStatusHoldUntil || 0)) return; // A just-finished button action's result stays readable.
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

  function legSearchRoot(model) {
    let root = model; // The editor keeps its solved leg chain on the floor-anchored locomotion root, a sibling branch of the avatar model rather than a child of it.
    while (root?.parent && root.parent.type !== 'Scene') root = root.parent;
    return root;
  }

  function portraitsFlipped() {
    return window.PNGPlaneAvatar?.getPortraitsFlipped?.() === true; // The game mirrors every portrait texture by default (UV repeat.x = -1); garment geometry must mirror with it.
  }

  function findLegNodes(model) {
    const root = legSearchRoot(model);
    if (!root?.getObjectByName) return null;
    const flipped = portraitsFlipped(); // Mirrored art puts the garment's image-left leg on the screen-right side, which is where the right_* IK nodes live.
    const nodes = { // These are the procedural editor's existing IK transforms, not a Pants-specific skeleton.
      leftThigh: root.getObjectByName(flipped ? 'right_thigh' : 'left_thigh'),
      leftCalf: root.getObjectByName(flipped ? 'right_calf' : 'left_calf'),
      rightThigh: root.getObjectByName(flipped ? 'left_thigh' : 'right_thigh'),
      rightCalf: root.getObjectByName(flipped ? 'left_calf' : 'right_calf'),
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

  // Live 3D leg bones in avatar-local space, written into `scratch.bones3D` (no per-frame allocation). The hip is the
  // thigh node's origin, the knee is the calf node's origin, and the ankle is the calf origin plus calf-down * calfLength
  // (the solver publishes calfLength on the calf node; without it the leg is assumed straight, calf as long as thigh).
  function readLiveBones(preview) {
    const { model, nodes, scratch } = preview;
    model.updateWorldMatrix?.(true, false); // Ancestors only: the leg chain and the avatar sit on different branches of the locomotion hierarchy.
    const inverseModel = scratch.inverseModel.copy(model.matrixWorld).invert();
    for (const [side, thigh, calf] of [['left', nodes.leftThigh, nodes.leftCalf], ['right', nodes.rightThigh, nodes.rightCalf]]) {
      thigh.updateWorldMatrix?.(true, false);
      calf.updateWorldMatrix?.(true, false);
      const bones = scratch.bones3D[side];
      scratch.point.setFromMatrixPosition(thigh.matrixWorld).applyMatrix4(inverseModel);
      bones.hip.x = scratch.point.x; bones.hip.y = scratch.point.y; bones.hip.z = scratch.point.z;
      scratch.point.setFromMatrixPosition(calf.matrixWorld).applyMatrix4(inverseModel);
      bones.knee.x = scratch.point.x; bones.knee.y = scratch.point.y; bones.knee.z = scratch.point.z;
      const calfLength = Number(calf.userData?.hobunjiCalfLength) > 0 ? Number(calf.userData.hobunjiCalfLength) : Math.abs(calf.position.y);
      scratch.point.set(0, -calfLength, 0).applyMatrix4(calf.matrixWorld).applyMatrix4(inverseModel);
      bones.ankle.x = scratch.point.x; bones.ankle.y = scratch.point.y; bones.ankle.z = scratch.point.z;
    }
    return scratch.bones3D;
  }

  function makeBoneScratch(Runtime) {
    const joint = () => ({ x: 0, y: 0, z: 0 });
    const leg = () => ({ hip: joint(), knee: joint(), ankle: joint() });
    return { inverseModel: new Runtime.Matrix4(), point: new Runtime.Vector3(), bones3D: { left: leg(), right: leg() }, aim: { left: leg(), right: leg() }, transforms: [null, null, null, null, null] };
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
    state.buildGeneration++; // Invalidates any in-flight async rebuild so it cannot re-attach a mesh after this disposal.
    const preview = state.preview;
    if (!preview) return;
    preview.mesh?.parent?.remove?.(preview.mesh); // three r128 (this editor) lacks the newer one-call detach helper, so detach via the parent.
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
    // One placement for everything on the garment: a PNG-space point -> leg-thickness fit -> belt affine -> portrait
    // plane -> avatar-local. The 2D bone joints below go through exactly the same path as the vertices, so a joint and
    // the vertices around it keep their relationship.
    const placeOnPlane = (u, v) => {
      const fitted = forwardStaticFit(Core, garment, character, { x: u, y: v });
      const portrait = Core.applyAffine(transform, fitted);
      localPoint.set((portraitsFlipped() ? 0.5 - portrait.x : portrait.x - 0.5) * dimensions.width, (0.5 - portrait.y) * dimensions.height, 0.012); // Mirrors with the UV-flipped portrait texture.
      worldPoint.copy(localPoint);
      plane.localToWorld(worldPoint); // Includes the exact Procedural Animation portrait assembly transform.
      model.worldToLocal(worldPoint);
      return worldPoint;
    };
    for (let row = 0; row <= PREVIEW_SEGMENTS; row++) {
      const v = row / PREVIEW_SEGMENTS;
      for (let col = 0; col <= PREVIEW_SEGMENTS; col++, vertex++) {
        const u = col / PREVIEW_SEGMENTS;
        placeOnPlane(u, v);
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
    const legBones = Core.normalizeLegBones(garment.legBones); // Knees are the exact midpoint of hip and ankle, whatever the stored data says.
    const bones2D = {}; // The authored 2D bones in the garment's rest space (avatar-local), aligned onto the live 3D bones every frame.
    for (const side of ['left', 'right']) {
      bones2D[side] = {};
      for (const joint of ['hip', 'knee', 'ankle']) {
        const placed = placeOnPlane(legBones[side][joint].x, legBones[side][joint].y);
        bones2D[side][joint] = { x: placed.x, y: placed.y, z: placed.z };
      }
    }
    const beltCenter = { x: 0, y: 0 }; // Centre of the pants beltline in avatar-local space: the belt scale grows/shrinks the garment about it.
    for (const point of garment.pantsBeltSpline) {
      const placed = placeOnPlane(point.x, point.y);
      beltCenter.x += placed.x / garment.pantsBeltSpline.length;
      beltCenter.y += placed.y / garment.pantsBeltSpline.length;
    }
    const origin = placeOnPlane(0, 0).clone(), across = placeOnPlane(1, 0).clone().sub(origin), down = placeOnPlane(0, 1).clone().sub(origin);
    const normal = across.cross(down).normalize(); // The portrait plane's normal in avatar-local space: legs that swing forward/back tilt the garment about it.
    return { geometry, basePositions, weights, bones2D, beltCenter, planeNormal: { x: normal.x, y: normal.y, z: normal.z } };
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
      bones2D: built.bones2D,
      beltCenter: built.beltCenter,
      planeNormal: built.planeNormal,
      beltScale: Math.min(3.5, Math.max(1.7, Number(character.beltScale) || 1.75)),
      legRollGain: Math.min(4, Math.max(1, Number(character.legRollGain) || 2)),
      scratch: makeBoneScratch(Runtime),
      garmentId,
      identityKey: identityKey(identity),
    };
    setStatus('Live pants preview bound to this Procedural Animation avatar + its existing IK legs.', 'good');
    return true;
  }

  // Every frame each of the four leg bones (left/right thigh and calf) is aligned from its authored 2D position onto
  // the live 3D bone: rotated to the 3D direction and stretched along the bone so its length matches, so the garment
  // legs follow the avatar's legs however they are posed. The belt weight stays rigid with the body. Thigh and calf
  // both carry the knee to the same 3D point, so a vertex at the knee cannot tear apart between them.
  function updatePreviewPose() {
    const preview = state.preview;
    const Core = window.HobunjiPantsRig;
    if (!preview || !preview.model?.parent || !Core) return;
    const measured = readLiveBones(preview);
    const live = preview.scratch.aim; // The garment aims at the live legs with their sideways (z) swing exaggerated by the roll gain.
    Core.amplifyLegRoll(measured.left, preview.legRollGain, live.left);
    Core.amplifyLegRoll(measured.right, preview.legRollGain, live.right);
    const flat = preview.bones2D;
    const transforms = preview.scratch.transforms; // Channel order is Core.WEIGHT_CHANNELS: belt, leftThigh, leftCalf, rightThigh, rightCalf.
    const options = { perpendicularScale: LEG_ACROSS_SCALE, normal: preview.planeNormal };
    const s = preview.beltScale, c = preview.beltCenter; // Belt-weighted pixels scale vertically about the beltline centre; leg-weighted pixels follow their bones.
    transforms[0] = s === 1 ? null : { a: 1, b: 0, c: 0, d: s, tx: 0, ty: c.y * (1 - s) }; // Vertical only: the beltline spline already controls width.
    transforms[1] = Core.alignBoneSegment3D(flat.left.hip, flat.left.knee, live.left.hip, live.left.knee, options);
    transforms[2] = Core.alignBoneSegment3D(flat.left.knee, flat.left.ankle, live.left.knee, live.left.ankle, options);
    transforms[3] = Core.alignBoneSegment3D(flat.right.hip, flat.right.knee, live.right.hip, live.right.knee, options);
    transforms[4] = Core.alignBoneSegment3D(flat.right.knee, flat.right.ankle, live.right.knee, live.right.ankle, options);
    const position = preview.geometry.getAttribute('position');
    Core.skinWeightedPositions(preview.basePositions, preview.weights, transforms, position.array);
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
    // Swapping NPCs while Pants is open rebuilds the procedural leg chain (and may keep the same model object), which
    // leaves the preview skinning against the previous NPC's now-detached leg nodes. Compare against the live chain.
    const liveNodes = findLegNodes(model);
    const nodesChanged = !!state.preview && (!liveNodes || Object.keys(liveNodes).some(key => liveNodes[key] !== state.preview.nodes[key]));
    if (!state.forceRebuild && !identityChanged && !modelChanged && !nodesChanged && state.preview) return;
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
#${PANEL_ID}{position:absolute;z-index:120;top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));width:min(620px,52vw);max-width:calc(100% - 16px);display:none;flex-direction:column;min-height:0;overflow:hidden;border:1px solid rgba(255,255,255,.18);border-radius:15px;background:rgba(7,16,26,.985);box-shadow:0 22px 70px rgba(0,0,0,.62)}
#${PANEL_ID}.open{display:flex}
#${PANEL_ID} .pantsRigHostTools button{-webkit-tap-highlight-color:rgba(107,169,255,.45)}
@media(pointer:coarse){#${PANEL_ID} .pantsRigHostTools button{min-height:44px}}
#${PANEL_ID}.pantsRigExpanded{top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));width:auto;max-width:none;height:auto;box-shadow:0 0 0 100vmax rgba(2,6,12,.62),0 22px 70px rgba(0,0,0,.7)}
#${PANEL_ID} .pantsRigHostHeader{flex:0 0 auto;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:7px 9px;border-bottom:1px solid rgba(255,255,255,.12);background:linear-gradient(180deg,rgba(22,37,56,.99),rgba(11,20,31,.99))}
#${PANEL_ID} .pantsRigHostTitle{font-size:12px;font-weight:800;color:#dce9ff}.pantsRigHostSub{font-size:10px;color:#9eb2cb;margin-top:2px}
#${PANEL_ID} .pantsRigHostTools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}
#${PANEL_ID} .pantsRigHostTools label{display:flex;align-items:center;gap:5px;font-size:10px;color:#c7d5e8;white-space:nowrap}
#${PANEL_ID} .pantsRigHostTools input{width:auto}
#${PANEL_ID} .pantsRigHostTools button{min-height:34px;padding:5px 8px}
#${PANEL_ID} .pantsRigHostBody{flex:1 1 0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
#${PANEL_ID} iframe{display:block;flex:1 1 0;min-height:0;width:100%;border:0;background:#07101a}
#${PANEL_ID} .pantsRigHostStatus{flex:0 0 auto;max-height:4.5em;overflow:auto;white-space:pre-wrap;padding:5px 8px;border-top:1px solid rgba(255,255,255,.1);font:10px/1.35 ui-monospace,monospace;color:#9edfbf;background:#07101a}.pantsRigHostStatus[data-kind="warn"]{color:#ffc857}
@media(max-width:700px) and (orientation:portrait){#${PANEL_ID}{top:auto;left:max(4px,env(safe-area-inset-left));right:max(4px,env(safe-area-inset-right));bottom:max(4px,env(safe-area-inset-bottom));width:auto;height:min(58dvh,690px);max-width:none;border-radius:13px}#${PANEL_ID} .pantsRigHostHeader{padding:5px 7px}.pantsRigHostSub{display:none}}
@media(max-height:520px) and (orientation:landscape){#${PANEL_ID}{top:max(4px,env(safe-area-inset-top));right:max(4px,env(safe-area-inset-right));bottom:max(4px,env(safe-area-inset-bottom));width:min(560px,48vw);border-radius:11px}}
`;
    document.head.appendChild(style);
  }

  function avoidFootingHud() {
    const panel = state.panel;
    if (!panel) return;
    panel.style.removeProperty('top'); // Restores the stylesheet position before measuring.
    if (panel.classList.contains('pantsRigExpanded')) return; // The enlarged floating window is layered above the Footing HUD, so it needs no avoidance.
    if (window.matchMedia?.('(max-width:700px) and (orientation:portrait)').matches) return; // Portrait phones anchor the panel to the bottom instead.
    const hud = document.getElementById('footingHud'); // Sits on a higher layer than the modal root and would cover the host header (Live 3D / Apply to NPC).
    const bottom = hud?.getBoundingClientRect?.().bottom || 0;
    if (bottom > 0) panel.style.top = `${Math.ceil(bottom) + 6}px`;
  }

  const EXPANDED_Z_INDEX = '200'; // Above the Footing HUD (24), loading overlay (35), NPC drawer (70), debug panel (90) and the placement/foot docks (180/181).
  function setExpanded(expanded, title = '') { // Floating window above everything while exactly one author workspace is enlarged.
    const panel = state.panel;
    if (!panel) return;
    const root = panel.parentElement; // #gameModalOverlayRoot: its z-index (20) sits under the HUD, so lift the whole layer.
    const sub = panel.querySelector('.pantsRigHostSub');
    if (expanded) {
      if (root && root.dataset.pantsPreviousZ == null) root.dataset.pantsPreviousZ = root.style.zIndex || '';
      if (root) root.style.zIndex = EXPANDED_Z_INDEX;
      if (sub) { if (sub.dataset.pantsPreviousText == null) sub.dataset.pantsPreviousText = sub.textContent; sub.textContent = title ? `Enlarged · ${title}` : 'Enlarged workspace'; }
    } else {
      if (root && root.dataset.pantsPreviousZ != null) { root.style.zIndex = root.dataset.pantsPreviousZ; delete root.dataset.pantsPreviousZ; }
      if (sub && sub.dataset.pantsPreviousText != null) { sub.textContent = sub.dataset.pantsPreviousText; delete sub.dataset.pantsPreviousText; }
    }
    panel.classList.toggle('pantsRigExpanded', !!expanded);
    if (state.open) avoidFootingHud();
  }

  function setOpen(open) {
    state.open = !!open;
    state.panel?.classList.toggle('open', state.open);
    state.quickButton?.classList.toggle('active', state.open);
    if (state.open) {
      avoidFootingHud();
      state.forceRebuild = true;
      syncAuthorToProceduralIdentity();
      setStatus('Pants Rig open · Live 3D uses the exact Procedural Animation avatar/IK legs.', 'good');
    } else {
      setExpanded(false);
      try { state.iframe?.contentWindow?.postMessage({ type: 'hobunji-pants-rig-exit-enlarge' }, window.location.origin); } catch (_) {}
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
      <div class="pantsRigHostHeader"><!-- Deliberately a div: the editor stylesheet hides every header element with display:none !important. -->
        <div><div class="pantsRigHostTitle">👖 Pants Rig Author</div><div class="pantsRigHostSub">2D rig + visible weight paint + live deformation on this procedural avatar</div></div>
        <div class="pantsRigHostTools">
          <label><input id="proceduralPantsLive3d" type="checkbox" checked> Live 3D</label>
          <button id="proceduralPantsRebind" type="button" class="secondary">Rebind</button>
          <button id="proceduralPantsClose" type="button" class="secondary" aria-label="Close Pants Rig">×</button>
        </div>
      </div>
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
    panel.querySelector('#proceduralPantsRebind').addEventListener('click', event => {
      const button = event.currentTarget;
      button.classList.add('active'); // Immediate tap feedback.
      setTimeout(() => button.classList.remove('active'), 600);
      window.ProceduralPantsRigStatusHoldUntil = 0; // Rebind's own status should show right away.
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
    window.addEventListener('resize', () => { if (state.open) avoidFootingHud(); });
    window.addEventListener('message', event => {
      if (event.source === state.iframe?.contentWindow && event.data?.type === 'hobunji-pants-rig-enlarge') { setExpanded(event.data.enlarged === true, String(event.data.title || '')); return; }
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
      window.dispatchEvent(new Event('hobunji-pants-rig-panel-ready')); // Lets host-header add-ons (Apply to NPC) attach whenever the panel exists, however late the editor built its HUD.
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

  // How well the garment's 2D bones currently sit on the live 3D leg bones, per side, in avatar-local units. Every
  // *Error should be ~0 and kneeMidpointError3D is 0 for an unbent leg (the solver puts the knee at exactly half).
  function boneAlignmentReport() {
    const preview = state.preview;
    const Core = window.HobunjiPantsRig;
    if (!preview || !Core) return null;
    const measured = readLiveBones(preview);
    const live = { left: Core.amplifyLegRoll(measured.left, preview.legRollGain, { hip: {}, knee: {}, ankle: {} }), right: Core.amplifyLegRoll(measured.right, preview.legRollGain, { hip: {}, knee: {}, ankle: {} }) };
    const options = { perpendicularScale: LEG_ACROSS_SCALE, normal: preview.planeNormal };
    const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, (p.z || 0) - (q.z || 0));
    const through = (t, p) => ({ x: t.m[0] * p.x + t.m[1] * p.y + t.m[2] * p.z + t.tx, y: t.m[3] * p.x + t.m[4] * p.y + t.m[5] * p.z + t.ty, z: t.m[6] * p.x + t.m[7] * p.y + t.m[8] * p.z + t.tz });
    const report = {};
    for (const side of ['left', 'right']) {
      const l = live[side], f = preview.bones2D[side];
      const thigh = Core.alignBoneSegment3D(f.hip, f.knee, l.hip, l.knee, options);
      const calf = Core.alignBoneSegment3D(f.knee, f.ankle, l.knee, l.ankle, options);
      report[side] = {
        length2D: { thigh: distance(f.hip, f.knee), calf: distance(f.knee, f.ankle) },
        length3D: { thigh: distance(l.hip, l.knee), calf: distance(l.knee, l.ankle) },
        stretch: { thigh: thigh.stretch, calf: calf.stretch },
        kneeMidpointError3D: distance(l.knee, Core.kneeAtMidpoint(l.hip, l.ankle)),
        hipError: distance(through(thigh, f.hip), l.hip),
        kneeErrorThigh: distance(through(thigh, f.knee), l.knee),
        kneeErrorCalf: distance(through(calf, f.knee), l.knee),
        ankleError: distance(through(calf, f.ankle), l.ankle),
        live3D: { hip: { ...l.hip }, knee: { ...l.knee }, ankle: { ...l.ankle } },
        rest2D: { hip: { ...f.hip }, knee: { ...f.knee }, ankle: { ...f.ankle } },
      };
    }
    return report;
  }

  window.ProceduralPantsRigAuthor = {
    installed: true,
    getBoneAlignment: boneAlignmentReport,
    getPreviewData: () => (state.preview ? { base: state.preview.basePositions, weights: state.preview.weights, positions: state.preview.geometry.getAttribute('position').array } : null),
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
