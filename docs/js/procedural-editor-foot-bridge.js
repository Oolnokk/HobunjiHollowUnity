// Procedural Animation Editor adapter for repository-authored feet + limb-author IK.
//
// The editor predates the shared gameplay ProceduralLegAnimation hierarchy: its
// `ExperimentalFeet` objects are direct gait transforms while its leg bones are
// debug lines only. Keep those existing transforms authoritative for editor gait,
// but replace their primitive visual children with the repository-configured GLB
// and let Ground/Manual IK drive the exact same foot transforms while those modes
// are active. No second gait or physics loop is created here.
(function (global) {
  'use strict';

  if (!/\/tools\/procedural-animation-editor\/(?:index\.html)?$/.test(location.pathname)) return;
  if (global.HobunjiProceduralEditorFootBridge) return;

  const SCRIPT_URL = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null;
  const DOCS_BASE = SCRIPT_URL ? new URL('../', SCRIPT_URL) : new URL('../../', location.href);
  const AUTHORED_VISUAL_NAME = 'HobunjiRepoAuthoredFootVisual';
  const REFERENCE_HEIGHT = 0.9; // Mao'ao male reference export was authored in the editor's 0.9 world-model basis.
  const GLB_AUTOFIT_MULTIPLIER = 2; // Matches ProceduralLegAnimation's configured-foot autofit.
  const GROUND_MODES = new Set(['crossLegged', 'kneel', 'sideLeanLeft', 'sideLeanRight', 'lieSideLeft', 'lieSideRight', 'lieBack']);
  const CROSS_LEGGED_REFERENCE = Object.freeze({
    // Normalized directly from the user's accepted Mao'ao male Manual IK export.
    left: Object.freeze({
      foot: Object.freeze({ x: -0.032269477130428825 / REFERENCE_HEIGHT, yOffset: 0.003114029792394735 / REFERENCE_HEIGHT, z: 0.0891998118916785 / REFERENCE_HEIGHT }),
      knee: Object.freeze({ x: -0.1247820704974712 / REFERENCE_HEIGHT, yFromFoot: 0.01009871564111151 / REFERENCE_HEIGHT, z: 0.03980844038359077 / REFERENCE_HEIGHT }),
    }),
    right: Object.freeze({
      foot: Object.freeze({ x: 0.029829823623628127 / REFERENCE_HEIGHT, yOffset: -0.003114029792394735 / REFERENCE_HEIGHT, z: 0.08425773718554744 / REFERENCE_HEIGHT }),
      knee: Object.freeze({ x: 0.11696889134621108 / REFERENCE_HEIGHT, yFromFoot: 0.007033488588301522 / REFERENCE_HEIGHT, z: 0.031655216353630194 / REFERENCE_HEIGHT }),
    }),
  });

  const state = {
    THREE: null,
    loaderPromise: null,
    glbCache: new Map(),
    decoratedModel: null,
    solverPatched: false,
    originalFixedSolver: null,
    latestGroundTargets: { left: null, right: null },
    driveFrame: 0,
    lastMode: 'normal',
  };

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function normalizeGender(value) {
    return String(value || '').trim().toLowerCase() === 'female' ? 'female' : 'male';
  }
  function selectedIdentity() {
    const backdrop = global.HobunjiGameplayBackdrop;
    const npc = backdrop?.getSelectedNpc?.() || {};
    const appearance = npc.appearance || npc.fighter?.appearance || npc.profile?.fighter || npc;
    return {
      speciesId: normalizeKey(appearance.speciesId || appearance.species || npc.speciesId || npc.species || 'mao-ao'),
      gender: normalizeGender(appearance.gender || npc.gender || 'male'),
      bodyColors: appearance.bodyColors || npc.bodyColors || {},
    };
  }
  function modelContext() {
    const backdrop = global.HobunjiGameplayBackdrop;
    if (backdrop?.getPreviewMode?.() !== 'npc') return null;
    const model = backdrop?.getAvatarModel?.();
    if (!model) return null;
    const poseRoot = model.parent || null;
    const avatarLiftRoot = poseRoot?.parent || null;
    const locomotionRoot = avatarLiftRoot?.parent || null;
    if (!locomotionRoot) return null;
    const feetRoot = (locomotionRoot.children || []).find(child => /_ExperimentalFeet$/i.test(String(child?.name || ''))) || null;
    if (!feetRoot) return { backdrop, model, locomotionRoot, feetRoot: null, feet: null };
    const feet = {};
    for (const side of ['left', 'right']) {
      const suffix = side === 'left' ? /_LeftFoot$/i : /_RightFoot$/i;
      feet[side] = (feetRoot.children || []).find(child => suffix.test(String(child?.name || ''))) || null;
    }
    return { backdrop, model, locomotionRoot, feetRoot, feet };
  }
  function modelHeight(model) {
    return Number(model?.userData?.portraitModelHeight) || Number(model?.userData?.gameModelHeight) || 0.9;
  }
  function feetSettings() {
    return global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet || {};
  }
  function canonicalSpecies(speciesId) {
    const aliases = global.HOBUNJI_TRANSFORM_SPECIES_ALIASES || {};
    return normalizeKey(aliases[speciesId] || speciesId);
  }
  function configuredFoot(speciesId) {
    const species = canonicalSpecies(speciesId);
    const table = feetSettings().species || {};
    return table[species] || table[speciesId] || null;
  }
  function footScaleFor(speciesId, gender) {
    const table = feetSettings().footScale || {};
    const species = canonicalSpecies(speciesId);
    const direct = table[species]?.[gender] ?? table[speciesId]?.[gender];
    const value = Number(direct ?? table.default ?? 1);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }
  function targetFootHeight(speciesId, gender, height) {
    const settings = feetSettings();
    const footHeightFraction = Number(settings.footHeightFraction) > 0 ? Number(settings.footHeightFraction) : 0.11;
    const sizeBalance = Number(settings.sizeBalanceMultiplier) > 0 ? Number(settings.sizeBalanceMultiplier) : 1;
    const radius = height * footHeightFraction * 0.5 * footScaleFor(speciesId, gender) * sizeBalance;
    const sphereScaleY = ['kenkari', 'rakakoan'].includes(canonicalSpecies(speciesId)) ? 1 : 0.75;
    return radius * sphereScaleY * 2 * GLB_AUTOFIT_MULTIPLIER;
  }
  function bodyColorHex(speciesId, bodyColors) {
    const descriptor = bodyColors?.A;
    if (descriptor?.hex) return descriptor.hex;
    const reference = typeof global._dyeReferenceHexForSlot === 'function' ? global._dyeReferenceHexForSlot('A', speciesId) : '#7dc89a';
    if (typeof global._resolveTargetRgbColor === 'function') {
      const rgb = global._resolveTargetRgbColor(descriptor, reference);
      if (Array.isArray(rgb)) return '#' + rgb.slice(0, 3).map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('');
    }
    return reference;
  }
  function colorForRole(role, speciesId, bodyColors) {
    if (role === 'bone') return '#D8C7A3';
    if (role === 'keratin') return '#44484D';
    return bodyColorHex(speciesId, bodyColors);
  }
  function resolveAsset(path) {
    const raw = String(path || '');
    if (!raw || /^(?:https?:|data:|blob:|file:)/i.test(raw) || raw.startsWith('/')) return raw;
    return new URL(raw.startsWith('assets/') ? raw : `assets/${raw.replace(/^\.\//, '')}`, DOCS_BASE).href;
  }
  async function ensureThree() {
    if (state.THREE) return state.THREE;
    if (!global.PNGPlaneAvatar?.loadThreeModules) throw new Error('PNGPlaneAvatar.loadThreeModules is unavailable.');
    state.THREE = (await global.PNGPlaneAvatar.loadThreeModules()).THREE;
    return state.THREE;
  }
  async function loader() {
    if (state.loaderPromise) return state.loaderPromise;
    state.loaderPromise = ensureThree().then(async THREE => {
      if (typeof THREE.GLTFLoader === 'function') return new THREE.GLTFLoader();
      const configured = global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.threeModuleUrl || 'https://esm.sh/three@0.128.0';
      const version = configured.match(/three@([0-9.]+)/)?.[1] || '0.128.0';
      const module = await import(`https://esm.sh/three@${version}/examples/jsm/loaders/GLTFLoader.js?deps=three@${version}`);
      return new module.GLTFLoader();
    });
    return state.loaderPromise;
  }
  async function sourceGlb(path) {
    const url = resolveAsset(path);
    if (state.glbCache.has(url)) return state.glbCache.get(url);
    const promise = loader().then(glbLoader => new Promise((resolve, reject) => {
      glbLoader.load(url, gltf => resolve(gltf?.scene || gltf), undefined, reject);
    })).catch(error => { state.glbCache.delete(url); throw error; });
    state.glbCache.set(url, promise);
    return promise;
  }
  function markOutline(root) {
    root?.traverse?.(child => {
      if (!child.isMesh) return;
      child.layers?.enable?.(1);
      global.HobunjiOutlines?.markMaterialSeamId?.(child);
    });
  }
  async function buildConfiguredVisual(speciesId, gender, bodyColors, height, side) {
    const THREE = await ensureThree();
    const config = configuredFoot(speciesId);
    if (!config?.glb) return null;
    const source = await sourceGlb(config.glb);
    const clone = source.clone(true);
    const roles = config.materialRoles || {};
    clone.traverse(child => {
      if (!child.isMesh) return;
      if (child.geometry?.clone) child.geometry = child.geometry.clone();
      const recolor = material => {
        if (!material) return material;
        const owned = material.clone?.() || material;
        const role = roles[material.name] || roles[owned.name] || 'body';
        owned.color?.set?.(colorForRole(role, speciesId, bodyColors));
        owned.needsUpdate = true;
        return owned;
      };
      child.material = Array.isArray(child.material) ? child.material.map(recolor) : recolor(child.material);
      child.castShadow = true;
      child.receiveShadow = true;
    });
    clone.updateMatrixWorld?.(true);
    let box = new THREE.Box3().setFromObject(clone);
    const rawHeight = Math.max(1e-6, box.max.y - box.min.y);
    const targetHeight = targetFootHeight(speciesId, gender, height);
    clone.scale.multiplyScalar(targetHeight / rawHeight);
    clone.updateMatrixWorld?.(true);
    box = new THREE.Box3().setFromObject(clone);
    const centerX = (box.min.x + box.max.x) * 0.5;
    const centerZ = (box.min.z + box.max.z) * 0.5;
    clone.position.x -= centerX;
    clone.position.y -= box.min.y;
    clone.position.z -= centerZ;
    const wrapper = new THREE.Group();
    wrapper.name = AUTHORED_VISUAL_NAME;
    wrapper.userData.repoConfiguredFoot = { speciesId, gender, path: config.glb, side };
    wrapper.add(clone);
    if (side === 'left') wrapper.scale.x = -1;
    markOutline(wrapper);
    return wrapper;
  }
  function importedOverrideFor(model, side) {
    const custom = model?.userData?.experimentalFeet?.anatomy?.customGlb;
    return custom?.[side] || null;
  }
  async function decorateSide(context, side, identity) {
    const outer = context.feet?.[side];
    if (!outer || importedOverrideFor(context.model, side)) return false;
    const config = configuredFoot(identity.speciesId);
    if (!config?.glb) return false;
    const key = `${canonicalSpecies(identity.speciesId)}::${identity.gender}::${modelHeight(context.model).toFixed(6)}::${config.glb}`;
    if (outer.userData?.repoAuthoredFootKey === key && outer.getObjectByName?.(AUTHORED_VISUAL_NAME)) return true;
    const previous = outer.getObjectByName?.(AUTHORED_VISUAL_NAME);
    previous?.parent?.remove?.(previous);
    const visual = await buildConfiguredVisual(identity.speciesId, identity.gender, identity.bodyColors, modelHeight(context.model), side);
    if (!visual || !outer.parent) return false;
    const contactRadiusY = Number(context.model.userData?.experimentalFeet?.contactRadiusY) || 0;
    visual.position.y = -contactRadiusY; // editor gait transform is centered at fallback contact radius; GLB itself is bottom-aligned.
    for (const child of outer.children || []) {
      if (child !== previous && child !== visual) {
        child.userData = child.userData || {};
        if (!Object.prototype.hasOwnProperty.call(child.userData, 'repoFootOriginalVisible')) child.userData.repoFootOriginalVisible = child.visible;
        child.visible = false;
      }
    }
    outer.add(visual);
    outer.userData = outer.userData || {};
    outer.userData.repoAuthoredFootKey = key;
    outer.userData.repoAuthoredFootPath = config.glb;
    return true;
  }
  async function decorateCurrentFeet(attempt = 0, expectedModel = null) {
    const context = modelContext();
    if (!context?.model || (expectedModel && context.model !== expectedModel)) return false;
    if (!context.feetRoot || !context.feet?.left || !context.feet?.right) {
      if (attempt < 180) requestAnimationFrame(() => decorateCurrentFeet(attempt + 1, context.model));
      return false;
    }
    const identity = selectedIdentity();
    try {
      await Promise.all(['left', 'right'].map(side => decorateSide(context, side, identity)));
      state.decoratedModel = context.model;
      context.model.userData = context.model.userData || {};
      context.model.userData.repoAuthoredFeet = {
        speciesId: identity.speciesId,
        gender: identity.gender,
        source: configuredFoot(identity.speciesId)?.glb || null,
        editorTransform: 'existing ExperimentalFeet gait groups',
      };
      return true;
    } catch (error) {
      console.warn('[ProceduralEditorFootBridge] Repository foot visual failed; editor fallback remains available.', error);
      return false;
    }
  }

  function currentMode() {
    const select = document.getElementById('limbPoseSelect');
    if (select?.value) return select.value;
    const author = global.HobunjiProceduralLimbPoseAuthor;
    if (author && author.dormant !== true && typeof author.getExport === 'function') return author.getExport()?.currentPose || 'normal';
    return 'normal';
  }
  function footCenterY(context) {
    const analysis = context?.model?.userData?.experimentalFeet || {};
    const localGround = Number(analysis.groundLocalY);
    const contact = Number(analysis.contactRadiusY);
    if (Number.isFinite(localGround) && Number.isFinite(contact)) return localGround + contact;
    const leftY = Number(context?.feet?.left?.position?.y);
    const rightY = Number(context?.feet?.right?.position?.y);
    if (Number.isFinite(leftY) && Number.isFinite(rightY)) return (leftY + rightY) * 0.5;
    return Number.isFinite(contact) ? contact : 0;
  }
  function crossLeggedTarget(side, context) {
    const THREE = state.THREE;
    const reference = CROSS_LEGGED_REFERENCE[side];
    const h = modelHeight(context.model);
    const baseY = footCenterY(context);
    const foot = new THREE.Vector3(reference.foot.x * h, baseY + reference.foot.yOffset * h, reference.foot.z * h);
    const knee = new THREE.Vector3(reference.knee.x * h, foot.y + reference.knee.yFromFoot * h, reference.knee.z * h);
    return { foot, knee };
  }
  function inferSide(root) {
    return Number(root?.x) <= 0 ? 'left' : 'right';
  }
  function correctedGroundOptions(THREE, options, context) {
    const copied = { ...options };
    copied.target = options.target?.clone?.() || options.target;
    copied.pole = options.pole?.clone?.() || options.pole;
    const groundLocalY = Number(context?.model?.userData?.experimentalFeet?.groundLocalY);
    // Limb Pose Author's generic contact helper sees only contactRadiusY on this
    // older editor. Add the editor floor-root offset back before solving.
    if (Number.isFinite(groundLocalY) && Math.abs(groundLocalY) > 1e-9) {
      if (copied.target) copied.target.y += groundLocalY;
      if (copied.pole) copied.pole.y += groundLocalY;
    }
    return copied;
  }
  function installSolverPatch(attempt = 0) {
    if (state.solverPatched) return true;
    const api = global.LegBones;
    if (typeof api?.solveFixedTwoBoneChain !== 'function' || typeof api?.solveSubdividedChain !== 'function') {
      if (attempt < 240) requestAnimationFrame(() => installSolverPatch(attempt + 1));
      return false;
    }
    state.originalFixedSolver = api.solveFixedTwoBoneChain;
    api.solveFixedTwoBoneChain = function proceduralEditorFootBridgeSolveFixed(THREE, options = {}) {
      const mode = currentMode();
      if (!GROUND_MODES.has(mode)) return state.originalFixedSolver.apply(this, arguments);
      const context = modelContext();
      if (!context?.model || !context.feetRoot) return state.originalFixedSolver.apply(this, arguments);
      const side = inferSide(options.root);
      let solved;
      if (mode === 'crossLegged') {
        const reference = crossLeggedTarget(side, context);
        solved = api.solveSubdividedChain(THREE, {
          root: options.root,
          target: reference.foot,
          joint: reference.knee,
          jointFraction: 0.5,
        });
        solved.referencePose = 'mao-ao-male-user-cross-legged-2026-09-02';
      } else {
        solved = state.originalFixedSolver.call(this, THREE, correctedGroundOptions(THREE, options, context));
      }
      state.latestGroundTargets[side] = solved?.solvedTarget?.clone?.() || null;
      return solved;
    };
    api.solveFixedTwoBoneChain.__hobunjiProceduralEditorFootBridge = true;
    state.solverPatched = true;
    return true;
  }

  function locomotionPointToParent(context, point, parent) {
    const converted = point.clone();
    context.locomotionRoot.updateWorldMatrix?.(true, false);
    context.locomotionRoot.localToWorld(converted);
    parent.updateWorldMatrix?.(true, false);
    parent.worldToLocal(converted);
    return converted;
  }
  function moveEditorFoot(context, side, target) {
    const foot = context.feet?.[side];
    if (!foot?.parent || !target) return false;
    foot.position.copy(locomotionPointToParent(context, target, foot.parent));
    foot.updateMatrixWorld?.(true);
    return true;
  }
  function manualFootTargets() {
    const author = global.HobunjiProceduralLimbPoseAuthor;
    if (!author || author.dormant === true || typeof author.getExport !== 'function') return null;
    const manual = author.getExport()?.manual;
    if (!manual || manual.releasedToPhysics) return null;
    return manual.sides || null;
  }
  function syncDrivenFeet() {
    state.driveFrame = 0;
    const mode = currentMode();
    const context = modelContext();
    if (context?.feetRoot && context.feet) {
      if (mode === 'manual') {
        const targets = manualFootTargets();
        for (const side of ['left', 'right']) {
          const p = targets?.[side]?.foot;
          if (p && state.THREE) moveEditorFoot(context, side, new state.THREE.Vector3(Number(p.x), Number(p.y), Number(p.z)));
        }
      } else if (GROUND_MODES.has(mode)) {
        if (mode === 'crossLegged' && state.THREE) {
          // Keep direct editor feet synchronized even on the first frame before
          // the wrapped fixed solver has been called.
          for (const side of ['left', 'right']) state.latestGroundTargets[side] = crossLeggedTarget(side, context).foot;
        }
        for (const side of ['left', 'right']) moveEditorFoot(context, side, state.latestGroundTargets[side]);
      } else if (state.lastMode !== mode) {
        state.latestGroundTargets.left = null;
        state.latestGroundTargets.right = null;
      }
    }
    state.lastMode = mode;
    // Manual/ground need continuous endpoint ownership. Normal/carry do not: stop
    // completely and let the existing editor animate until a mode-control event
    // wakes this bridge again.
    if (mode === 'manual' || GROUND_MODES.has(mode)) state.driveFrame = requestAnimationFrame(syncDrivenFeet);
  }
  function ensureDriveLoop() {
    if (!state.driveFrame) state.driveFrame = requestAnimationFrame(syncDrivenFeet);
  }

  function activateLimbBridge() {
    installSolverPatch();
    ensureDriveLoop();
    decorateCurrentFeet();
  }
  function start() {
    ensureThree().then(() => {
      decorateCurrentFeet();
    }).catch(error => console.warn('[ProceduralEditorFootBridge] Three.js unavailable:', error));
    window.addEventListener('hobunji-backdrop-api-ready', () => decorateCurrentFeet());
    window.addEventListener('hobunji-backdrop-avatar-changed', () => setTimeout(() => decorateCurrentFeet(), 0));
    window.addEventListener('hobunji-backdrop-creature-changed', () => { state.decoratedModel = null; });
    document.addEventListener('change', event => {
      if (event.target?.id === 'limbPoseSelect') ensureDriveLoop();
    }, true);
    document.addEventListener('click', event => {
      if (['limbManualStart', 'limbManualResume', 'limbManualPhysics', 'limbResetPose', 'limbApplyCarryMovement'].includes(event.target?.id)) {
        requestAnimationFrame(ensureDriveLoop);
      }
    }, true);
  }

  global.HobunjiProceduralEditorFootBridge = Object.freeze({
    version: 1,
    activateLimbBridge,
    installSolverPatch,
    decorateCurrentFeet,
    crossLeggedReference: CROSS_LEGGED_REFERENCE,
    getDebug() {
      const context = modelContext();
      return {
        mode: currentMode(),
        solverPatched: state.solverPatched,
        authoredFootSource: context?.model?.userData?.repoAuthoredFeet || null,
        hasExperimentalFeet: Boolean(context?.feetRoot),
        latestGroundTargets: state.latestGroundTargets,
      };
    },
  });

  start();
})(window);
