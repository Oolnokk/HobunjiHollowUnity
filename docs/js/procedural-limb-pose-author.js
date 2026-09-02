// Procedural Animation Editor extension: species-aware hands, shoulder targets,
// generated elbows, fixed-length ground/rest leg IK, and a two-hand awkward
// upright carry walk overlay. It deliberately attaches through the editor's
// public HobunjiGameplayBackdrop API and model hierarchy instead of rewriting
// the 2 MB embedded editor HTML.
(() => {
  'use strict';

  if (!/\/tools\/procedural-animation-editor\/(?:index\.html)?$/.test(location.pathname)) return;
  if (window.HobunjiProceduralLimbPoseAuthor) return;

  const SCRIPT_URL = document.currentScript?.src ? new URL(document.currentScript.src, location.href) : null; // Resolves the repo-paired docs root for dependency loads below.
  const DOCS_BASE = SCRIPT_URL ? new URL('../', SCRIPT_URL) : new URL('../../', location.href); // Keeps hand/anatomy dependencies on the same branch/commit as this adapter.
  const STORAGE_KEY = 'hobunji.proceduralLimbPoseAuthor.v1'; // Persists per-species thickness tuning and the last selected pose on mobile.
  const PANEL_ID = 'proceduralLimbPosePanel'; // Stable DOM id used when the preview clears/rebuilds its modal layer.
  const STYLE_ID = 'proceduralLimbPoseStyles'; // Prevents duplicate CSS when tool adapters are evaluated twice.
  const GUIDE_ROOT_NAME = 'ProceduralLimbPoseGuides'; // Lets avatar rebuild cleanup find only this extension's Three.js helpers.
  const CARRY_OBJECT_NAME = 'ProceduralCarryObjectProxy'; // Identifies the authoring-only heavy object proxy in diagnostics.
  const POSE_LABELS = Object.freeze({ // Drives both the pose selector and exported normalized pose ids.
    crossLegged: 'Cross-legged',
    kneel: 'Kneeling',
    sideLeanLeft: 'Side lean · left',
    sideLeanRight: 'Side lean · right',
    lieSideLeft: 'Lie on side · left',
    lieSideRight: 'Lie on side · right',
    lieBack: 'Lie on back',
    carryUpright: 'Walk · keep heavy object upright',
  });
  const CARRY_MOVEMENT = Object.freeze({ // Existing movement sliders receive these values when the carry style is applied.
    animationSpeed: 1.35,
    animationSprintMultiplier: 1.15,
    animationAcceleration: 4.2,
    animationTurnAcceleration: 3.1,
    animationDeceleration: 7.5,
    animationTurnResponse: 3.8,
    animationBob: 0.012,
    animationSway: 0.11,
    animationDrift: 0.02,
    animationIrregularity: 0.08,
    animationStumble: 0,
  });

  const runtime = { // Mutable adapter state shared by UI events and the animation frame update.
    THREE: null,
    handThree: null,
    backdrop: null,
    model: null,
    poseRoot: null,
    avatarLiftRoot: null,
    locomotionRoot: null,
    feetRoot: null,
    feet: { left: null, right: null },
    handRig: null,
    guideRoot: null,
    guideMeshes: {},
    carryObject: null,
    speciesId: 'mao-ao',
    gender: 'male',
    modelHeight: 0.9,
    modelWidth: 0.9,
    floorLift: 0.45,
    posteriorY: 0.3,
    anatomy: null,
    poseId: 'crossLegged',
    showGuides: true,
    carryWeight: 0.86,
    carryAwkwardness: 0.82,
    carryObjectHeightFraction: 0.72,
    carryObjectWidthFraction: 0.48,
    carryObjectDepthFraction: 0.24,
    priorLocomotionPosition: null,
    priorTime: performance.now(),
    lastDebug: null,
  };

  function normalizeSpecies(value) { // Matches attachment-rig/profile keys when reading the currently selected NPC.
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeGender(value) { // Maps all authoring records to canonical male/female rig keys.
    return String(value || '').trim().toLowerCase() === 'female' ? 'female' : 'male';
  }

  function clamp(value, min, max) { // Bounds sliders, persisted values, and IK-derived ratios before they reach Three.js transforms.
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function loadScript(relativePath, ready) { // Loads one dependency once and resolves when its expected global is ready.
    if (ready?.()) return Promise.resolve();
    const src = new URL(relativePath, DOCS_BASE).href; // Uses this adapter's branch/commit rather than the editor's repository picker.
    const existing = [...document.scripts].find(script => script.src === src); // Reuses a dependency already requested by another adapter.
    if (existing) return new Promise(resolve => {
      if (ready?.()) return resolve();
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', resolve, { once: true });
    });
    return new Promise((resolve, reject) => {
      const script = document.createElement('script'); // Dependency element appended to the tool document head.
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${relativePath}`));
      document.head.appendChild(script);
    });
  }

  async function ensureDependencies() { // Makes anatomy profiles and real hand attachments available before constructing a pose rig.
    await loadScript('config/procedural-anatomy-profiles.js?v=20260902a', () => Boolean(window.HOBUNJI_PROCEDURAL_ANATOMY_PROFILES));
    await loadScript('config/hand-model-profiles.js?v=20260902a', () => Boolean(window.HobunjiHandModelProfiles));
    await loadScript('js/procedural-hand-attachments.js?v=20260902a', () => Boolean(window.ProceduralHandAttachments));
    const modules = await window.PNGPlaneAvatar.loadThreeModules(); // Returns the exact Three.js module instance used by the procedural preview.
    runtime.THREE = modules.THREE;
    const configuredThreeUrl = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.threeModuleUrl || 'https://esm.sh/three@0.165.0'; // Keeps GLTFLoader on the same Three.js version as the editor.
    const version = configuredThreeUrl.match(/three@([0-9.]+)/)?.[1] || '0.165.0'; // Used only for the hand GLB loader module URL below.
    try {
      const loaderModule = await import(`https://esm.sh/three@${version}/examples/jsm/loaders/GLTFLoader.js?deps=three@${version}`); // Supplies GLTFLoader to the otherwise editor-agnostic hand attachment module.
      runtime.handThree = Object.assign({}, runtime.THREE, { GLTFLoader: loaderModule.GLTFLoader });
    } catch (error) {
      runtime.handThree = runtime.THREE; // Leaves procedural fallback hands available if the optional GLB loader cannot be fetched.
      console.warn('[Limb pose author] GLTFLoader unavailable; using generated hand fallback.', error);
    }
  }

  function selectedIdentity() { // Extracts species/gender from the public selected NPC record without depending on editor-private helpers.
    const npc = runtime.backdrop?.getSelectedNpc?.() || {}; // Current preview NPC returned as a safe clone by the editor API.
    const appearance = npc.appearance || npc.fighter?.appearance || npc.profile?.fighter || npc; // Covers current and legacy NPC export shapes.
    return {
      speciesId: normalizeSpecies(appearance.speciesId || appearance.species || npc.speciesId || npc.species || 'mao-ao'),
      gender: normalizeGender(appearance.gender || npc.gender || 'male'),
      bodyColors: appearance.bodyColors || npc.bodyColors || {},
    };
  }

  function profileForIdentity(speciesId, gender) { // Reads the canonical attachment-rig shoulder/posterior/anatomy record.
    const aliases = window.HOBUNJI_TRANSFORM_SPECIES_ALIASES || {}; // Keeps Ghoul/Rakako'an numeric transforms live-linked to their parent rigs.
    const canonicalSpecies = aliases[speciesId] || speciesId; // Used only when a direct alias record is not already installed.
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {}; // Canonical source of shoulder anchors and authored arm-length offset.
    return characters[`${speciesId}::${gender}`] || characters[`${canonicalSpecies}::${gender}`] || null;
  }

  function posteriorYFor(profile, modelHeight, model) { // Resolves the same floor-relative posterior used by runtime legs and chair seating.
    const resolved = Number(profile?.resolvedPosteriorPosition?.y); // Preferred live value when Animation Author has already published it.
    if (Number.isFinite(resolved)) return resolved;
    const rule = profile?.posteriorRule || {}; // Supplies floor-relative percentage for current v9+ profiles.
    const percentFromFloor = Number(rule.heightPercentFromFloor); // Direct posterior height percentage authored per species/gender.
    if (Number.isFinite(percentFromFloor)) return modelHeight * percentFromFloor / 100;
    const handAttachY = Number(model?.userData?.handAttachY); // Legacy profile fallback shares the same hand attach reference as runtime.
    const shared = window.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(rule, modelHeight, handAttachY); // Reuses canonical legacy math when available.
    if (Number.isFinite(shared)) return shared;
    return (Number.isFinite(handAttachY) ? handAttachY : modelHeight / 2) + modelHeight * (Number(rule.heightPercentOffset) || -18) / 100;
  }

  function shoulderFloorPoint(profile, side) { // Returns one canonical floor-relative shoulder target from attachment-rig-profiles.js.
    const anchorName = side === 'left' ? 'leftHandShoulder' : 'rightHandShoulder'; // Maps author side to the existing rig anchor name.
    const position = profile?.anchors?.[anchorName]?.position; // Authored floor-relative shoulder coordinate used by procedural hands in game.
    if (![position?.x, position?.y, position?.z].every(value => Number.isFinite(Number(value)))) return null;
    return { x: Number(position.x), y: Number(position.y), z: Number(position.z) };
  }

  function resolvedAnatomy(profile) { // Combines canonical limb lengths with the new editable radius/split profile.
    const tuned = window.HOBUNJI_PROCEDURAL_ANATOMY_PROFILES?.resolve?.(runtime.speciesId, runtime.gender) || {}; // Default per-species/gender thickness data.
    const stored = readStoredProfile(runtime.speciesId, runtime.gender); // Local authoring overrides entered in this tool.
    const settings = { ...tuned, ...stored }; // Current complete anatomy settings shown in the UI and export.
    const leftShoulder = shoulderFloorPoint(profile, 'left'); // Supplies one side of the existing arm-length measurement.
    const rightShoulder = shoulderFloorPoint(profile, 'right'); // Supplies the other side so asymmetric shoulder Y still produces one stable length.
    const armOffset = Number(profile?.anatomy?.armLengthHeightPercentOffset) || 0; // Existing species/gender authored arm-length extension below posterior.
    const freeHandY = runtime.posteriorY - runtime.modelHeight * armOffset / 100; // Matches procedural-hand-shoulder-aim.js's free-hand vertical anchor.
    const armLengths = [leftShoulder, rightShoulder].filter(Boolean).map(shoulder => Math.hypot(shoulder.y - freeHandY, shoulder.z)); // Measures total arm length from canonical shoulder to free-hand rest height.
    const totalArmLength = armLengths.length ? armLengths.reduce((sum, value) => sum + value, 0) / armLengths.length : runtime.modelHeight * 0.36; // Fallback remains proportional for an unauthored future species.
    const upperArmFraction = clamp(settings.upperArmFraction ?? 0.52, 0.35, 0.68); // Splits total canonical arm length at the generated elbow.
    const feetAnalysis = runtime.model?.userData?.experimentalFeet || {}; // Existing procedural-foot analysis supplies species-aware idle foot anchors.
    const leftIdle = feetAnalysis.leftIdle || { x: -runtime.modelWidth * 0.08, y: 0, z: 0 }; // Used to estimate fixed anatomical leg length without inventing a second height table.
    const hipFloor = { x: Number(leftIdle.x) || -runtime.modelWidth * 0.08, y: runtime.posteriorY, z: 0 }; // Mirrors the runtime leg-bones hip convention.
    const footFloor = { x: Number(leftIdle.x) || hipFloor.x, y: Number(leftIdle.y) || 0, z: Number(leftIdle.z) || 0 }; // Existing idle foot target for the same species.
    const totalLegLength = Math.max(runtime.modelHeight * 0.20, Math.hypot(hipFloor.x - footFloor.x, hipFloor.y - footFloor.y, hipFloor.z - footFloor.z)); // Fixed ground-pose leg length derived from the current procedural-foot setup.
    return {
      ...settings,
      totalArmLength,
      upperArmLength: totalArmLength * upperArmFraction,
      forearmLength: totalArmLength * (1 - upperArmFraction),
      upperLegLength: totalLegLength * 0.5,
      lowerLegLength: totalLegLength * 0.5,
      upperArmRadius: runtime.modelHeight * Number(settings.upperArmRadiusHeightFraction || 0.045),
      forearmRadius: runtime.modelHeight * Number(settings.forearmRadiusHeightFraction || 0.038),
      thighRadius: runtime.modelHeight * Number(settings.thighRadiusHeightFraction || 0.065),
      calfRadius: runtime.modelHeight * Number(settings.calfRadiusHeightFraction || 0.052),
      torsoRadius: runtime.modelHeight * Number(settings.torsoRadiusHeightFraction || 0.155),
      armLengthSource: profile ? 'attachment-rig shoulder → posterior/free-hand anchor' : 'model-height fallback',
      legLengthSource: feetAnalysis.leftIdle ? 'procedural-feet idle hip → foot' : 'model-height fallback',
    };
  }

  function savedState() { // Reads the tool-only authoring state while tolerating stale/corrupt local storage.
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }

  function saveState(next) { // Persists mobile-friendly authoring controls between reloads without mutating repository config at runtime.
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
  }

  function readStoredProfile(speciesId, gender) { // Returns only radius/elbow overrides for the current species+gender key.
    return savedState().anatomy?.[`${speciesId}::${gender}`] || {};
  }

  function writeStoredProfile(values) { // Saves current anatomy fields under the same key used by attachment-rig profiles.
    const state = savedState(); // Existing authoring state retained for other species and pose selection.
    state.anatomy = state.anatomy || {};
    state.anatomy[`${runtime.speciesId}::${runtime.gender}`] = values;
    state.poseId = runtime.poseId;
    saveState(state);
  }

  function injectStyles() { // Adds a compact, touch-friendly modal suitable for the user's common mobile workflow.
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Owns only this adapter's UI/guide styles.
    style.id = STYLE_ID;
    style.textContent = `
#${PANEL_ID}:not([open]){display:none!important}
#${PANEL_ID}[open]{position:absolute!important;z-index:12;top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));bottom:max(8px,env(safe-area-inset-bottom));width:min(470px,calc(100vw - 16px));display:grid!important;grid-template-rows:auto minmax(0,1fr);overflow:hidden;border:1px solid rgba(255,255,255,.18);border-radius:15px;background:rgba(7,16,26,.985);box-shadow:0 22px 70px rgba(0,0,0,.62)}
#${PANEL_ID}>summary{min-height:48px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.12);cursor:pointer;font-weight:850;background:linear-gradient(180deg,rgba(22,37,56,.99),rgba(11,20,31,.99))}
#${PANEL_ID} .limbPoseBody{min-height:0;overflow:auto;padding:10px;display:grid;gap:10px;-webkit-overflow-scrolling:touch}
#${PANEL_ID} .limbPoseGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
#${PANEL_ID} .limbPoseGrid .full{grid-column:1/-1}
#${PANEL_ID} .limbPoseCard{border:1px solid rgba(255,255,255,.11);border-radius:12px;padding:9px;background:rgba(255,255,255,.035)}
#${PANEL_ID} .limbPoseCard h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;color:var(--muted);letter-spacing:.4px}
#${PANEL_ID} .limbPoseActions{display:flex;gap:7px;flex-wrap:wrap}
#${PANEL_ID} .limbPoseActions button{flex:1 1 120px}
#${PANEL_ID} pre{max-height:180px;font-size:10px}
@media(max-width:700px){#${PANEL_ID}[open]{top:auto;right:max(4px,env(safe-area-inset-right));left:max(4px,env(safe-area-inset-left));bottom:max(4px,env(safe-area-inset-bottom));width:auto;height:min(55dvh,620px)}}
`;
    document.head.appendChild(style);
  }

  function numberField(id, label, min, max, step) { // Builds one reusable numeric anatomy/carry control for the modal.
    return `<div><label for="${id}">${label}</label><input id="${id}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}"></div>`;
  }

  function buildPanel() { // Creates the Ground / Carry authoring workspace without touching the giant editor markup.
    if (document.getElementById(PANEL_ID)) return document.getElementById(PANEL_ID);
    injectStyles();
    const panel = document.createElement('details'); // Modal panel restored automatically if the preview clears its overlay root.
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <summary>Ground / Carry anatomy</summary>
      <div class="limbPoseBody">
        <div class="limbPoseCard">
          <h3>Pose</h3>
          <div class="limbPoseGrid">
            <div class="full"><label for="limbPoseSelect">Procedural pose</label><select id="limbPoseSelect">${Object.entries(POSE_LABELS).map(([id,label]) => `<option value="${id}">${label}</option>`).join('')}</select></div>
            <div class="full"><label><input id="limbPoseShowGuides" type="checkbox" checked> Show shoulder / elbow / knee / radius guides</label></div>
          </div>
        </div>
        <div class="limbPoseCard">
          <h3>Species + gender anatomy</h3>
          <div id="limbPoseIdentity" class="small muted"></div>
          <div class="limbPoseGrid">
            ${numberField('limbUpperArmFraction','Upper arm share of total arm',0.35,0.68,0.01)}
            ${numberField('limbUpperArmRadius','Upper-arm radius · height fraction',0.015,0.12,0.001)}
            ${numberField('limbForearmRadius','Forearm radius · height fraction',0.012,0.10,0.001)}
            ${numberField('limbThighRadius','Thigh radius · height fraction',0.02,0.14,0.001)}
            ${numberField('limbCalfRadius','Calf radius · height fraction',0.015,0.12,0.001)}
            ${numberField('limbTorsoRadius','Torso radius · height fraction',0.06,0.30,0.002)}
          </div>
          <div class="authorHelp">Arm and leg lengths are not duplicated here. Arms come from the authored species+gender shoulders/posterior/arm-length offset; legs come from the current procedural-feet hip→idle-foot geometry. These settings only add the elbow split and collision/clearance thickness.</div>
        </div>
        <div class="limbPoseCard">
          <h3>Heavy upright object</h3>
          <div class="limbPoseGrid">
            ${numberField('limbCarryWeight','Weight',0,1,0.01)}
            ${numberField('limbCarryAwkwardness','Awkwardness',0,1,0.01)}
            ${numberField('limbCarryHeight','Object height · avatar height',0.3,1.4,0.01)}
            ${numberField('limbCarryWidth','Object width · avatar width',0.25,1.1,0.01)}
          </div>
          <div class="limbPoseActions"><button id="limbApplyCarryMovement" class="good" type="button">Apply heavy carry walk</button></div>
        </div>
        <div class="limbPoseActions"><button id="limbResetPose" class="secondary" type="button">Reset body / feet</button><button id="limbDownloadJson" class="secondary" type="button">Download pose JSON</button></div>
        <div class="limbPoseCard"><h3>Mobile debug</h3><pre id="limbPoseDebug">Waiting for avatar…</pre></div>
      </div>`;
    return panel;
  }

  function addQuickButton(panel) { // Adds an always-visible entry beside Play/Reset/Impact in the existing animation HUD.
    const actionRow = document.querySelector('#animationHud .animationHudActions'); // Existing mobile-visible procedural movement button row.
    if (!actionRow || document.getElementById('limbPoseQuickBtn')) return;
    const button = document.createElement('button'); // Opens/closes this extension's modal without requiring setup-panel scrolling.
    button.id = 'limbPoseQuickBtn';
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = 'Ground / Carry';
    button.addEventListener('click', () => { panel.open = !panel.open; button.classList.toggle('active', panel.open); });
    panel.addEventListener('toggle', () => button.classList.toggle('active', panel.open));
    actionRow.appendChild(button);
  }

  function attachPanel(panel) { // Keeps the modal alive across editor preview UI rebuilds that replace overlay children.
    const modalRoot = runtime.backdrop?.modalRoot || document.getElementById('gameModalOverlayRoot'); // Public backdrop root preferred when available.
    if (!modalRoot) return;
    if (!modalRoot.contains(panel)) modalRoot.appendChild(panel);
    const observer = new MutationObserver(() => { if (!modalRoot.contains(panel)) modalRoot.appendChild(panel); }); // Restores only this adapter-owned panel after clearPreviewUi().
    observer.observe(modalRoot, { childList: true });
  }

  function poseRootFloorPoint(point) { // Converts a floor-relative rig anchor into the current pose root's local centered coordinate space.
    return new runtime.THREE.Vector3(point.x, point.y - runtime.floorLift, point.z); // AvatarLiftRoot already supplies +modelHeight/2 in this editor.
  }

  function floorPointToLocomotion(point) { // Applies current body pose rotation/translation, then converts into the foot/guide root coordinate space.
    const local = poseRootFloorPoint(point); // Starts from the canonical floor-relative body anchor.
    runtime.poseRoot.updateWorldMatrix(true, false);
    runtime.poseRoot.localToWorld(local);
    runtime.locomotionRoot.updateWorldMatrix(true, false);
    runtime.locomotionRoot.worldToLocal(local);
    return local;
  }

  function makeGuideMaterial(opacity = 0.55) { // Shared transparent guide material; guide visibility is controlled separately by the UI checkbox.
    return new runtime.THREE.MeshBasicMaterial({ color: 0x6ba9ff, transparent: true, opacity, depthTest: false, depthWrite: false });
  }

  function disposeGuideRoot() { // Removes only authoring helpers while leaving avatar, feet, hands, and editor-owned gizmos intact.
    if (!runtime.guideRoot) return;
    runtime.guideRoot.traverse(child => { child.geometry?.dispose?.(); child.material?.dispose?.(); });
    runtime.guideRoot.parent?.remove(runtime.guideRoot);
    runtime.guideRoot = null;
    runtime.guideMeshes = {};
    runtime.carryObject = null;
  }

  function ensureGuideRoot() { // Builds reusable spheres/cylinders for shoulder/elbow/knee/radius visualization.
    if (runtime.guideRoot?.parent === runtime.locomotionRoot) return;
    disposeGuideRoot();
    const THREE = runtime.THREE; // Three.js constructors used for all authoring-only anatomy helpers below.
    const root = new THREE.Group(); // Lives beside procedural feet in locomotion coordinates, so ground contact remains stable while torso rotates.
    root.name = GUIDE_ROOT_NAME;
    root.renderOrder = 80;
    runtime.locomotionRoot.add(root);
    runtime.guideRoot = root;
    for (const side of ['left','right']) {
      for (const joint of ['shoulder','elbow','hand','hip','knee','foot']) {
        const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), makeGuideMaterial(joint === 'shoulder' || joint === 'hip' ? 0.7 : 0.5)); // Joint marker scaled to the corresponding authored radius each frame.
        sphere.name = `${side}_${joint}_guide`;
        sphere.renderOrder = 80;
        root.add(sphere);
        runtime.guideMeshes[`${side}.${joint}`] = sphere;
      }
      for (const segment of ['upperArm','forearm','thigh','calf']) {
        const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), makeGuideMaterial(0.25)); // Radius/length are updated from anatomy and IK each frame.
        cylinder.name = `${side}_${segment}_guide`;
        cylinder.renderOrder = 79;
        root.add(cylinder);
        runtime.guideMeshes[`${side}.${segment}`] = cylinder;
      }
    }
    const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), makeGuideMaterial(0.12)); // Clearance proxy centered at the posterior/torso core.
    torso.name = 'torso_radius_guide';
    root.add(torso);
    runtime.guideMeshes.torso = torso;
  }

  function positionSphere(key, point, radius) { // Places/scales one anatomy joint marker in locomotion-local coordinates.
    const mesh = runtime.guideMeshes[key];
    if (!mesh) return;
    mesh.position.copy(point);
    mesh.scale.setScalar(Math.max(0.008, radius));
    mesh.visible = runtime.showGuides;
  }

  function positionSegment(key, a, b, radius) { // Fits one cylinder between solved two-bone endpoints while preserving thickness settings.
    const mesh = runtime.guideMeshes[key];
    if (!mesh) return;
    const direction = b.clone().sub(a); // Segment vector used for midpoint, length, and orientation.
    const length = direction.length(); // Physical segment length stays equal to the species-derived IK solution.
    if (length < 1e-6) { mesh.visible = false; return; }
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.set(Math.max(0.006, radius), length, Math.max(0.006, radius));
    mesh.quaternion.setFromUnitVectors(new runtime.THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.visible = runtime.showGuides;
  }

  function feetObjects() { // Finds the current editor-owned procedural feet without reaching into its private `procedural` object.
    const root = runtime.locomotionRoot?.children?.find(child => /_ExperimentalFeet$/.test(child.name || '')) || null; // Existing feet root created by buildExperimentalFeetForAvatar().
    const left = root?.children?.find(child => /LeftFoot/i.test(child.name || '')) || null; // Existing left foot assembly moved by ground poses.
    const right = root?.children?.find(child => /RightFoot/i.test(child.name || '')) || null; // Existing right foot assembly moved by ground poses.
    return { root, left, right };
  }

  function applyFootTargets(targets) { // Moves the editor's existing real foot assemblies to ground-pose endpoints.
    if (!runtime.feetRoot || !targets) return;
    for (const side of ['left','right']) {
      const foot = runtime.feet[side]; // Reuses current species-specific procedural or imported GLB foot visual.
      const target = targets[side]; // Locomotion-local target generated by the selected ground pose.
      if (!foot || !target) continue;
      foot.position.copy(target);
      foot.rotation.x = Number(target.rollX) || 0;
      foot.rotation.z = Number(target.rollZ) || 0;
    }
  }

  function currentFloorY() { // Returns locomotion-local ground center used by the current procedural feet analysis.
    const analysis = runtime.model?.userData?.experimentalFeet || {}; // Existing editor feet metadata includes exact ground/contact radii.
    return Number(analysis.groundLocalY) || 0;
  }

  function footContactY() { // Places the existing foot assembly center flush with its authored ground-contact radius.
    const analysis = runtime.model?.userData?.experimentalFeet || {}; // Current species foot shape metadata.
    return currentFloorY() + (Number(analysis.contactRadiusY) || runtime.modelHeight * 0.025);
  }

  function bodyPoseFor(poseId) { // Resolves torso translation/rotation while keeping the posterior close to the ground without a seat target.
    const radius = runtime.anatomy.torsoRadius; // Species/gender torso clearance used to keep the portrait from cutting through the ground.
    const h = runtime.modelHeight; // Scales all non-seat rest offsets consistently across species.
    const poses = {
      crossLegged: { posteriorHeight: radius * 0.92, x: 0, z: 0, pitch: 0, roll: 0 },
      kneel: { posteriorHeight: radius * 1.12, x: 0, z: -h * 0.035, pitch: -6, roll: 0 },
      sideLeanLeft: { posteriorHeight: radius * 1.12, x: -radius * 0.55, z: 0, pitch: 0, roll: 24 },
      sideLeanRight: { posteriorHeight: radius * 1.12, x: radius * 0.55, z: 0, pitch: 0, roll: -24 },
      lieSideLeft: { posteriorHeight: radius * 0.95, x: -radius * 0.28, z: 0, pitch: 0, roll: 82 },
      lieSideRight: { posteriorHeight: radius * 0.95, x: radius * 0.28, z: 0, pitch: 0, roll: -82 },
      lieBack: { posteriorHeight: radius * 0.92, x: 0, z: -h * 0.05, pitch: -82, roll: 0 },
      carryUpright: { posteriorHeight: runtime.posteriorY, x: 0, z: 0, pitch: 4 + runtime.carryWeight * 5, roll: 0 },
    }; // Every pose is expressed around the same authored posterior rather than a hardcoded character origin.
    return poses[poseId] || poses.crossLegged;
  }

  function applyBodyPose(poseId) { // Applies a rest/carry torso pose only after movement playback has been paused for ground poses.
    const pose = bodyPoseFor(poseId); // Selected normalized torso pose above.
    runtime.poseRoot.position.set(pose.x, pose.posteriorHeight - runtime.posteriorY, pose.z);
    runtime.poseRoot.rotation.set(runtime.THREE.MathUtils.degToRad(pose.pitch), 0, runtime.THREE.MathUtils.degToRad(pose.roll));
    runtime.poseRoot.scale.set(1, 1, 1);
    runtime.poseRoot.updateMatrixWorld(true);
  }

  function solveLimb(root, target, upperLength, lowerLength, pole) { // Uses the extended canonical LegBones solver for both knees and generated elbows.
    return window.LegBones.solveFixedTwoBoneChain(runtime.THREE, { root, target, upperLength, lowerLength, pole });
  }

  function groundTargets(poseId, hips) { // Produces foot and knee-pole targets from species-scaled anatomy instead of one generic seated silhouette.
    const h = runtime.modelHeight; // Scales normalized rest offsets for each species/gender.
    const floor = footContactY(); // Exact center Y that keeps existing feet flush with the current ground plane.
    const side = poseId.endsWith('Right') ? 1 : -1; // Chooses the open/support side for mirrored side-rest poses.
    if (poseId === 'crossLegged') return {
      feet: { left: new runtime.THREE.Vector3(h * 0.12, floor, h * 0.08), right: new runtime.THREE.Vector3(-h * 0.12, floor, h * 0.05) },
      poles: { left: new runtime.THREE.Vector3(-h * 0.38, floor + h * 0.08, h * 0.15), right: new runtime.THREE.Vector3(h * 0.38, floor + h * 0.08, h * 0.15) },
    };
    if (poseId === 'kneel') return {
      feet: { left: new runtime.THREE.Vector3(hips.left.x, floor, -h * 0.23), right: new runtime.THREE.Vector3(hips.right.x, floor, -h * 0.23) },
      poles: { left: new runtime.THREE.Vector3(hips.left.x - h * 0.03, floor + h * 0.07, h * 0.24), right: new runtime.THREE.Vector3(hips.right.x + h * 0.03, floor + h * 0.07, h * 0.24) },
    };
    if (poseId.startsWith('sideLean')) return {
      feet: { left: new runtime.THREE.Vector3(-side * h * 0.05, floor, h * 0.22), right: new runtime.THREE.Vector3(side * h * 0.17, floor, h * 0.12) },
      poles: { left: new runtime.THREE.Vector3(-h * 0.30, floor + h * 0.11, h * 0.16), right: new runtime.THREE.Vector3(h * 0.30, floor + h * 0.11, h * 0.16) },
    };
    if (poseId.startsWith('lieSide')) return {
      feet: { left: new runtime.THREE.Vector3(-h * 0.05, floor, h * 0.28), right: new runtime.THREE.Vector3(h * 0.05, floor, h * 0.10) },
      poles: { left: new runtime.THREE.Vector3(-h * 0.16, floor + h * 0.10, h * 0.14), right: new runtime.THREE.Vector3(h * 0.16, floor + h * 0.10, h * 0.14) },
    };
    if (poseId === 'lieBack') return {
      feet: { left: new runtime.THREE.Vector3(-h * 0.10, floor, h * 0.33), right: new runtime.THREE.Vector3(h * 0.10, floor, h * 0.33) },
      poles: { left: new runtime.THREE.Vector3(-h * 0.13, floor + h * 0.20, h * 0.17), right: new runtime.THREE.Vector3(h * 0.13, floor + h * 0.20, h * 0.17) },
    };
    return null;
  }

  function handTargets(poseId, shoulders, legSolve) { // Places hands on knees/floor/body/object while generated elbows preserve each species' arm length.
    const h = runtime.modelHeight; // Scales pose-specific target offsets.
    const floor = currentFloorY(); // Floor surface used by support-hand poses.
    const torso = runtime.anatomy.torsoRadius; // Keeps resting hands clear of the body proxy.
    if (poseId === 'crossLegged') return {
      left: { target: legSolve.left.joint.clone().add(new runtime.THREE.Vector3(0, runtime.anatomy.thighRadius * 1.2, h * 0.015)), pole: shoulders.left.clone().add(new runtime.THREE.Vector3(-h * 0.20, -h * 0.05, -h * 0.08)) },
      right: { target: legSolve.right.joint.clone().add(new runtime.THREE.Vector3(0, runtime.anatomy.thighRadius * 1.2, h * 0.015)), pole: shoulders.right.clone().add(new runtime.THREE.Vector3(h * 0.20, -h * 0.05, -h * 0.08)) },
    };
    if (poseId === 'kneel') return {
      left: { target: legSolve.left.joint.clone().add(new runtime.THREE.Vector3(0, runtime.anatomy.thighRadius * 1.35, -h * 0.03)), pole: shoulders.left.clone().add(new runtime.THREE.Vector3(-h * 0.18, -h * 0.03, -h * 0.04)) },
      right: { target: legSolve.right.joint.clone().add(new runtime.THREE.Vector3(0, runtime.anatomy.thighRadius * 1.35, -h * 0.03)), pole: shoulders.right.clone().add(new runtime.THREE.Vector3(h * 0.18, -h * 0.03, -h * 0.04)) },
    };
    if (poseId.startsWith('sideLean')) {
      const supportLeft = poseId.endsWith('Left'); // Selects the arm that bears body weight against the floor.
      const supportTarget = new runtime.THREE.Vector3((supportLeft ? -1 : 1) * h * 0.29, floor + runtime.anatomy.forearmRadius, h * 0.02); // Palm planted outside the torso radius.
      const restTarget = new runtime.THREE.Vector3((supportLeft ? 1 : -1) * torso * 0.25, floor + torso * 1.75, h * 0.08); // Free hand rests across lap/torso.
      return supportLeft
        ? { left: { target: supportTarget, pole: new runtime.THREE.Vector3(-h * 0.27, floor + h * 0.15, -h * 0.04) }, right: { target: restTarget, pole: shoulders.right.clone().add(new runtime.THREE.Vector3(h * 0.15, -h * 0.03, -h * 0.08)) } }
        : { left: { target: restTarget, pole: shoulders.left.clone().add(new runtime.THREE.Vector3(-h * 0.15, -h * 0.03, -h * 0.08)) }, right: { target: supportTarget, pole: new runtime.THREE.Vector3(h * 0.27, floor + h * 0.15, -h * 0.04) } };
    }
    if (poseId.startsWith('lieSide')) {
      const onLeft = poseId.endsWith('Left'); // Chooses the lower arm whose elbow/hand create a head-resting silhouette.
      const headRest = new runtime.THREE.Vector3((onLeft ? -1 : 1) * h * 0.19, floor + torso * 1.2, -h * 0.02); // Lower hand near the head/upper torso.
      const upperRest = new runtime.THREE.Vector3((onLeft ? 1 : -1) * h * 0.04, floor + torso * 1.15, h * 0.14); // Upper hand lies in front of the body.
      return onLeft
        ? { left: { target: headRest, pole: new runtime.THREE.Vector3(-h * 0.26, floor + h * 0.06, 0) }, right: { target: upperRest, pole: shoulders.right.clone().add(new runtime.THREE.Vector3(h * 0.14, -h * 0.05, -h * 0.08)) } }
        : { left: { target: upperRest, pole: shoulders.left.clone().add(new runtime.THREE.Vector3(-h * 0.14, -h * 0.05, -h * 0.08)) }, right: { target: headRest, pole: new runtime.THREE.Vector3(h * 0.26, floor + h * 0.06, 0) } };
    }
    if (poseId === 'lieBack') return {
      left: { target: new runtime.THREE.Vector3(-h * 0.18, floor + runtime.anatomy.forearmRadius, h * 0.02), pole: new runtime.THREE.Vector3(-h * 0.28, floor + h * 0.08, -h * 0.03) },
      right: { target: new runtime.THREE.Vector3(h * 0.18, floor + runtime.anatomy.forearmRadius, h * 0.02), pole: new runtime.THREE.Vector3(h * 0.28, floor + h * 0.08, -h * 0.03) },
    };
    return null;
  }

  function ensureCarryObject() { // Creates one authoring-only proxy box used by the upright carry style.
    if (runtime.carryObject?.parent === runtime.guideRoot) return runtime.carryObject;
    const THREE = runtime.THREE; // Three.js constructors used for the proxy geometry/material.
    const object = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.28, wireframe: true, depthTest: false })); // Large box stands in for any awkward item while keeping the tool asset-agnostic.
    object.name = CARRY_OBJECT_NAME;
    object.renderOrder = 78;
    runtime.guideRoot.add(object);
    runtime.carryObject = object;
    return object;
  }

  function updateCarryPose(now, shoulders) { // Keeps both hands locked to a swaying upright object while movement continues underneath.
    const h = runtime.modelHeight; // Scales object height/forward offset to the selected species.
    const w = runtime.modelWidth; // Scales object width to the selected avatar's final game width.
    const object = ensureCarryObject(); // Authoring proxy whose grip points drive both hands.
    const dt = Math.max(0.001, Math.min(0.05, (now - runtime.priorTime) / 1000)); // Stable speed estimate even after tab throttling.
    const currentPos = runtime.locomotionRoot.position.clone(); // Existing editor movement root used to infer how hard the carrier is moving.
    const priorPos = runtime.priorLocomotionPosition || currentPos.clone(); // Previous frame position for movement-speed estimation.
    const speed = currentPos.distanceTo(priorPos) / dt; // Drives weight lag/sway without needing editor-private movement state.
    runtime.priorLocomotionPosition = currentPos;
    runtime.priorTime = now;
    const motion = clamp(speed / 2.4, 0, 1); // Normalized approximate walking intensity for the object counter-sway.
    const awkward = runtime.carryAwkwardness; // User-authored irregularity amplitude.
    const weight = runtime.carryWeight; // User-authored backward lean and lag strength.
    const time = now / 1000; // Continuous phase source for small balance corrections.
    const swayX = Math.sin(time * 2.15) * h * 0.022 * awkward * (0.35 + motion); // Slow side correction visible even at low speed.
    const swayY = Math.sin(time * 3.05 + 0.7) * h * 0.010 * awkward * motion; // Smaller vertical struggle avoids floaty object bob.
    const center = new runtime.THREE.Vector3(swayX, runtime.posteriorY + h * 0.12 + swayY, h * (0.26 + weight * 0.05)); // Floor-relative object center before current torso pose transform.
    const centerLocomotion = floorPointToLocomotion(center); // Converts object center through the same body transform as shoulders.
    object.position.copy(centerLocomotion);
    object.scale.set(w * runtime.carryObjectWidthFraction, h * runtime.carryObjectHeightFraction, w * runtime.carryObjectDepthFraction);
    object.rotation.set(-0.05 * weight + Math.sin(time * 1.7) * 0.035 * awkward, 0, Math.sin(time * 2.4) * 0.055 * awkward * (0.4 + motion));
    object.visible = true;
    object.updateMatrixWorld(true);

    const leftGrip = new runtime.THREE.Vector3(-0.5, 0.14, 0.52); // Upper-left grip gives one arm a stabilizing high hold.
    const rightGrip = new runtime.THREE.Vector3(0.5, -0.12, 0.52); // Lower-right grip makes the object read as genuinely awkward rather than symmetrical.
    object.localToWorld(leftGrip);
    object.localToWorld(rightGrip);
    runtime.locomotionRoot.worldToLocal(leftGrip);
    runtime.locomotionRoot.worldToLocal(rightGrip);
    return {
      left: { target: leftGrip, pole: shoulders.left.clone().add(new runtime.THREE.Vector3(-h * 0.24, h * 0.02, -h * 0.08)) },
      right: { target: rightGrip, pole: shoulders.right.clone().add(new runtime.THREE.Vector3(h * 0.24, -h * 0.02, -h * 0.08)) },
      speed,
      motion,
    };
  }

  function handWorldQuaternion(side, shoulderLocal, handLocal) { // Aims each real hand's shoulder-pointing +Y axis back along its solved forearm.
    const directionLocal = shoulderLocal.clone().sub(handLocal).normalize(); // Forearm-to-shoulder direction in locomotion coordinates.
    const directionWorld = directionLocal.transformDirection(runtime.locomotionRoot.matrixWorld); // World direction required by ProceduralHandAttachments.placeHandWorld().
    return new runtime.handThree.Quaternion().setFromUnitVectors(new runtime.handThree.Vector3(0, 1, 0), directionWorld); // Shoulder-facing hand orientation; right-hand authored mirror remains inside the hand visual.
  }

  function placeRealHand(side, shoulder, solved) { // Moves the existing game hand model/fallback to the IK endpoint rather than drawing a fake hand proxy.
    if (!runtime.handRig || !solved) return;
    const handLocal = solved.solvedTarget; // Fixed-length clamped endpoint produced by canonical two-bone math.
    const handWorld = handLocal.clone(); // Converted below because the hand attachment API accepts world-space frames.
    runtime.locomotionRoot.localToWorld(handWorld);
    const shoulderWorld = shoulder.clone(); // Same-space shoulder needed for shoulder-facing hand orientation.
    runtime.locomotionRoot.localToWorld(shoulderWorld);
    const quaternion = new runtime.handThree.Quaternion().setFromUnitVectors(new runtime.handThree.Vector3(0, 1, 0), shoulderWorld.clone().sub(handWorld).normalize()); // Direct shoulder compass for the authored resting/carry endpoint.
    runtime.handRig.placeHandWorld(side, handWorld, quaternion);
  }

  function updateLimbGuides(side, shoulder, arm, hip, leg) { // Draws radius-aware solved segments and joints for one side of the body.
    positionSphere(`${side}.shoulder`, shoulder, runtime.anatomy.upperArmRadius * 1.15);
    positionSphere(`${side}.elbow`, arm.joint, Math.max(runtime.anatomy.upperArmRadius, runtime.anatomy.forearmRadius));
    positionSphere(`${side}.hand`, arm.solvedTarget, runtime.anatomy.forearmRadius * 0.9);
    positionSegment(`${side}.upperArm`, shoulder, arm.joint, runtime.anatomy.upperArmRadius);
    positionSegment(`${side}.forearm`, arm.joint, arm.solvedTarget, runtime.anatomy.forearmRadius);
    positionSphere(`${side}.hip`, hip, runtime.anatomy.thighRadius * 1.1);
    positionSphere(`${side}.knee`, leg.joint, Math.max(runtime.anatomy.thighRadius, runtime.anatomy.calfRadius));
    positionSphere(`${side}.foot`, leg.solvedTarget, runtime.anatomy.calfRadius * 0.85);
    positionSegment(`${side}.thigh`, hip, leg.joint, runtime.anatomy.thighRadius);
    positionSegment(`${side}.calf`, leg.joint, leg.solvedTarget, runtime.anatomy.calfRadius);
  }

  function updateTorsoGuide() { // Shows the body clearance radius that keeps limbs and ground from occupying the torso volume.
    const torso = runtime.guideMeshes.torso; // Reusable authoring-only sphere proxy.
    if (!torso) return;
    const center = floorPointToLocomotion({ x: 0, y: runtime.posteriorY + runtime.anatomy.torsoRadius * 0.35, z: 0 }); // Centers proxy slightly above posterior so it covers the body core.
    torso.position.copy(center);
    torso.scale.set(runtime.anatomy.torsoRadius, runtime.anatomy.torsoRadius * 1.25, runtime.anatomy.torsoRadius * 0.78);
    torso.visible = runtime.showGuides;
  }

  function updatePoseFrame(now) { // Solves and renders the selected rest/carry anatomy every animation frame.
    if (!runtime.model || !runtime.poseRoot || !runtime.locomotionRoot || !runtime.anatomy || !window.LegBones?.solveFixedTwoBoneChain) return;
    if (runtime.poseId !== 'carryUpright') applyBodyPose(runtime.poseId); // Ground poses stay fixed while carry lets movement continue underneath.
    else applyBodyPose('carryUpright');
    const profile = profileForIdentity(runtime.speciesId, runtime.gender); // Current canonical shoulder/posterior record.
    const leftShoulderFloor = shoulderFloorPoint(profile, 'left') || { x: -runtime.modelWidth * 0.18, y: runtime.modelHeight * 0.68, z: 0 }; // Fallback only for future unauthored rigs.
    const rightShoulderFloor = shoulderFloorPoint(profile, 'right') || { x: runtime.modelWidth * 0.18, y: runtime.modelHeight * 0.68, z: 0 }; // Mirrored fallback for unauthored rigs.
    const shoulders = { left: floorPointToLocomotion(leftShoulderFloor), right: floorPointToLocomotion(rightShoulderFloor) }; // Posed shoulder targets used by arm IK and visible markers.
    const hipHalfWidth = Math.max(runtime.modelWidth * 0.055, runtime.anatomy.torsoRadius * 0.34); // Species-scaled hip separation for generated leg roots.
    const hips = { left: floorPointToLocomotion({ x: -hipHalfWidth, y: runtime.posteriorY, z: 0 }), right: floorPointToLocomotion({ x: hipHalfWidth, y: runtime.posteriorY, z: 0 }) }; // Posed hip roots derived from the authored posterior.

    let legSolve = null; // Holds fixed-length knees/feet for ground poses; carry keeps the editor's live walking feet/legs.
    let handPose = null; // Holds solved hand targets/poles for either ground rest or carry.
    if (runtime.poseId === 'carryUpright') {
      const carry = updateCarryPose(now, shoulders); // Both hands stay on the moving object while regular procedural locomotion advances.
      handPose = carry;
      const feetAnalysis = runtime.model.userData?.experimentalFeet || {}; // Current live feet used only for guide continuity during carry walking.
      const leftFoot = runtime.feet.left?.position?.clone() || new runtime.THREE.Vector3(-hipHalfWidth, footContactY(), 0); // Existing left gait endpoint.
      const rightFoot = runtime.feet.right?.position?.clone() || new runtime.THREE.Vector3(hipHalfWidth, footContactY(), 0); // Existing right gait endpoint.
      legSolve = {
        left: solveLimb(hips.left, leftFoot, runtime.anatomy.upperLegLength, runtime.anatomy.lowerLegLength, hips.left.clone().add(new runtime.THREE.Vector3(-runtime.modelHeight * 0.08, 0, runtime.modelHeight * 0.20))),
        right: solveLimb(hips.right, rightFoot, runtime.anatomy.upperLegLength, runtime.anatomy.lowerLegLength, hips.right.clone().add(new runtime.THREE.Vector3(runtime.modelHeight * 0.08, 0, runtime.modelHeight * 0.20))),
      };
    } else {
      runtime.carryObject && (runtime.carryObject.visible = false);
      const targets = groundTargets(runtime.poseId, hips); // Species-scaled foot endpoints and knee bend poles for selected rest pose.
      if (!targets) return;
      legSolve = {
        left: solveLimb(hips.left, targets.feet.left, runtime.anatomy.upperLegLength, runtime.anatomy.lowerLegLength, targets.poles.left),
        right: solveLimb(hips.right, targets.feet.right, runtime.anatomy.upperLegLength, runtime.anatomy.lowerLegLength, targets.poles.right),
      };
      applyFootTargets({ left: legSolve.left.solvedTarget, right: legSolve.right.solvedTarget });
      handPose = handTargets(runtime.poseId, shoulders, legSolve);
    }

    if (!handPose) return;
    const armSolve = {
      left: solveLimb(shoulders.left, handPose.left.target, runtime.anatomy.upperArmLength, runtime.anatomy.forearmLength, handPose.left.pole),
      right: solveLimb(shoulders.right, handPose.right.target, runtime.anatomy.upperArmLength, runtime.anatomy.forearmLength, handPose.right.pole),
    }; // Generated elbows preserve the existing authored total arm length while targets move between poses.
    placeRealHand('left', shoulders.left, armSolve.left);
    placeRealHand('right', shoulders.right, armSolve.right);
    updateLimbGuides('left', shoulders.left, armSolve.left, hips.left, legSolve.left);
    updateLimbGuides('right', shoulders.right, armSolve.right, hips.right, legSolve.right);
    updateTorsoGuide();
    runtime.lastDebug = {
      identity: `${runtime.speciesId}::${runtime.gender}`,
      pose: runtime.poseId,
      model: { width: runtime.modelWidth, height: runtime.modelHeight, floorLift: runtime.floorLift, posteriorY: runtime.posteriorY },
      anatomy: {
        armLengthSource: runtime.anatomy.armLengthSource,
        totalArmLength: runtime.anatomy.totalArmLength,
        upperArmLength: runtime.anatomy.upperArmLength,
        forearmLength: runtime.anatomy.forearmLength,
        legLengthSource: runtime.anatomy.legLengthSource,
        upperLegLength: runtime.anatomy.upperLegLength,
        lowerLegLength: runtime.anatomy.lowerLegLength,
        upperArmRadius: runtime.anatomy.upperArmRadius,
        forearmRadius: runtime.anatomy.forearmRadius,
        thighRadius: runtime.anatomy.thighRadius,
        calfRadius: runtime.anatomy.calfRadius,
        torsoRadius: runtime.anatomy.torsoRadius,
      },
      reach: { leftArm: armSolve.left.reachable, rightArm: armSolve.right.reachable, leftLeg: legSolve.left.reachable, rightLeg: legSolve.right.reachable },
      hands: runtime.handRig?.getDebug?.() || null,
    };
  }

  function renderDebug() { // Mirrors the most useful runtime state into the visible panel so mobile testing never depends on DevTools.
    const pre = document.getElementById('limbPoseDebug'); // Existing debug <pre> created by buildPanel().
    if (pre) pre.textContent = runtime.lastDebug ? JSON.stringify(runtime.lastDebug, null, 2) : 'Waiting for avatar…';
  }

  function animationLoop(now) { // Keeps carry grips and anatomy guides synchronized with editor locomotion/model changes.
    try { updatePoseFrame(now); } catch (error) {
      runtime.lastDebug = { error: String(error?.stack || error) }; // Surfaces solver/integration failures in the mobile-visible debug panel.
    }
    if ((Math.floor(now / 250) !== Math.floor((now - 16) / 250))) renderDebug();
    requestAnimationFrame(animationLoop);
  }

  function sliderValue(id, fallback) { // Reads one number input while guarding against blank/invalid mobile edits.
    const value = Number(document.getElementById(id)?.value); // Current DOM value entered by the author.
    return Number.isFinite(value) ? value : fallback;
  }

  function syncInputsFromAnatomy() { // Loads the current species/gender defaults or saved overrides into authoring controls.
    const a = runtime.anatomy; // Complete resolved anatomy record for the current avatar.
    if (!a) return;
    document.getElementById('limbUpperArmFraction').value = Number(a.upperArmFraction).toFixed(3);
    document.getElementById('limbUpperArmRadius').value = Number(a.upperArmRadiusHeightFraction).toFixed(3);
    document.getElementById('limbForearmRadius').value = Number(a.forearmRadiusHeightFraction).toFixed(3);
    document.getElementById('limbThighRadius').value = Number(a.thighRadiusHeightFraction).toFixed(3);
    document.getElementById('limbCalfRadius').value = Number(a.calfRadiusHeightFraction).toFixed(3);
    document.getElementById('limbTorsoRadius').value = Number(a.torsoRadiusHeightFraction).toFixed(3);
    document.getElementById('limbCarryWeight').value = runtime.carryWeight.toFixed(2);
    document.getElementById('limbCarryAwkwardness').value = runtime.carryAwkwardness.toFixed(2);
    document.getElementById('limbCarryHeight').value = runtime.carryObjectHeightFraction.toFixed(2);
    document.getElementById('limbCarryWidth').value = runtime.carryObjectWidthFraction.toFixed(2);
    document.getElementById('limbPoseSelect').value = runtime.poseId;
    document.getElementById('limbPoseShowGuides').checked = runtime.showGuides;
    const identity = document.getElementById('limbPoseIdentity'); // Visible anatomy source/length summary above the numeric controls.
    if (identity) identity.textContent = `${runtime.speciesId} · ${runtime.gender} · arm ${a.totalArmLength.toFixed(3)} (${a.armLengthSource}) · leg ${(a.upperLegLength + a.lowerLegLength).toFixed(3)} (${a.legLengthSource})`;
  }

  function readAnatomyInputs() { // Applies editable thickness/elbow split without changing canonical shoulder/posterior/length data.
    const values = {
      upperArmFraction: clamp(sliderValue('limbUpperArmFraction', runtime.anatomy?.upperArmFraction || 0.52), 0.35, 0.68),
      upperArmRadiusHeightFraction: clamp(sliderValue('limbUpperArmRadius', runtime.anatomy?.upperArmRadiusHeightFraction || 0.045), 0.015, 0.12),
      forearmRadiusHeightFraction: clamp(sliderValue('limbForearmRadius', runtime.anatomy?.forearmRadiusHeightFraction || 0.038), 0.012, 0.10),
      thighRadiusHeightFraction: clamp(sliderValue('limbThighRadius', runtime.anatomy?.thighRadiusHeightFraction || 0.065), 0.02, 0.14),
      calfRadiusHeightFraction: clamp(sliderValue('limbCalfRadius', runtime.anatomy?.calfRadiusHeightFraction || 0.052), 0.015, 0.12),
      torsoRadiusHeightFraction: clamp(sliderValue('limbTorsoRadius', runtime.anatomy?.torsoRadiusHeightFraction || 0.155), 0.06, 0.30),
    }; // Stored values remain normalized fractions so they apply consistently after character scale changes.
    writeStoredProfile(values);
    runtime.anatomy = resolvedAnatomy(profileForIdentity(runtime.speciesId, runtime.gender));
    syncInputsFromAnatomy();
  }

  function dispatchMovementValue(id, value) { // Updates one existing procedural movement slider through the editor's own input listener.
    const input = document.getElementById(id); // Existing editor control that owns the actual procedural settings state.
    if (!input) return;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function applyCarryMovement() { // Reuses the existing movement engine, changing only parameters needed to sell a heavy upright load.
    for (const [id, value] of Object.entries(CARRY_MOVEMENT)) dispatchMovementValue(id, value);
    runtime.poseId = 'carryUpright';
    document.getElementById('limbPoseSelect').value = runtime.poseId;
    runtime.backdrop?.setMovementPlayback?.(true);
    runtime.priorLocomotionPosition = runtime.locomotionRoot?.position?.clone() || null;
    runtime.priorTime = performance.now();
    const badge = document.getElementById('animationPresetBadge'); // Makes the custom movement intent visible in the existing HUD.
    if (badge) badge.textContent = 'Heavy upright carry';
  }

  function resetPose() { // Returns body and procedural feet to the editor's own baseline before leaving the custom ground workspace.
    runtime.backdrop?.resetMovement?.();
    runtime.poseRoot?.position?.set(0, 0, 0);
    runtime.poseRoot?.rotation?.set(0, 0, 0);
    runtime.carryObject && (runtime.carryObject.visible = false);
    runtime.priorLocomotionPosition = null;
  }

  function exportObject() { // Builds a portable schema containing normalized anatomy settings and procedural pose rules.
    const stored = readStoredProfile(runtime.speciesId, runtime.gender); // Only explicit author overrides are written back, not computed world lengths.
    return {
      schema: 'hobunji-procedural-limb-pose-library.v1',
      speciesId: runtime.speciesId,
      gender: runtime.gender,
      anatomy: {
        ...stored,
        computed: {
          totalArmLength: runtime.anatomy?.totalArmLength || null,
          upperArmLength: runtime.anatomy?.upperArmLength || null,
          forearmLength: runtime.anatomy?.forearmLength || null,
          upperLegLength: runtime.anatomy?.upperLegLength || null,
          lowerLegLength: runtime.anatomy?.lowerLegLength || null,
          armLengthSource: runtime.anatomy?.armLengthSource || null,
          legLengthSource: runtime.anatomy?.legLengthSource || null,
        },
      },
      currentPose: runtime.poseId,
      groundPoseIds: Object.keys(POSE_LABELS).filter(id => id !== 'carryUpright'),
      carryUpright: {
        movement: CARRY_MOVEMENT,
        weight: runtime.carryWeight,
        awkwardness: runtime.carryAwkwardness,
        objectHeightFraction: runtime.carryObjectHeightFraction,
        objectWidthFraction: runtime.carryObjectWidthFraction,
        objectDepthFraction: runtime.carryObjectDepthFraction,
        gripRule: 'two hands remain locked to opposing object-side grips; generated elbows preserve species+gender arm length',
      },
      solver: 'LegBones.solveFixedTwoBoneChain',
      shoulderSource: 'HOBUNJI_ATTACHMENT_RIG_PROFILES.characters[species::gender].anchors.left/rightHandShoulder',
      posteriorSource: 'attachment-rig posteriorRule / resolvedPosteriorPosition',
    };
  }

  function downloadExport() { // Downloads current settings directly from the browser, including on mobile.
    const blob = new Blob([JSON.stringify(exportObject(), null, 2)], { type: 'application/json' }); // Portable authoring JSON payload.
    const url = URL.createObjectURL(blob); // Temporary download URL released immediately after click.
    const link = document.createElement('a'); // One-shot hidden anchor used because the editor has no public downloadJson API.
    link.href = url;
    link.download = `hobunji_limb_pose_${runtime.speciesId}_${runtime.gender}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function wirePanel(panel) { // Connects touch/keyboard controls to live pose state once.
    if (panel.dataset.limbPoseWired === 'true') return;
    panel.dataset.limbPoseWired = 'true';
    document.getElementById('limbPoseSelect').addEventListener('change', event => {
      runtime.poseId = POSE_LABELS[event.target.value] ? event.target.value : 'crossLegged';
      const state = savedState(); // Preserves anatomy values while recording the last selected pose.
      state.poseId = runtime.poseId;
      saveState(state);
      if (runtime.poseId === 'carryUpright') applyCarryMovement();
      else runtime.backdrop?.setMovementPlayback?.(false);
    });
    document.getElementById('limbPoseShowGuides').addEventListener('change', event => { runtime.showGuides = Boolean(event.target.checked); });
    for (const id of ['limbUpperArmFraction','limbUpperArmRadius','limbForearmRadius','limbThighRadius','limbCalfRadius','limbTorsoRadius']) document.getElementById(id).addEventListener('change', readAnatomyInputs);
    for (const [id, key, min, max] of [
      ['limbCarryWeight','carryWeight',0,1], ['limbCarryAwkwardness','carryAwkwardness',0,1],
      ['limbCarryHeight','carryObjectHeightFraction',0.3,1.4], ['limbCarryWidth','carryObjectWidthFraction',0.25,1.1],
    ]) document.getElementById(id).addEventListener('input', () => { runtime[key] = clamp(sliderValue(id, runtime[key]), min, max); });
    document.getElementById('limbApplyCarryMovement').addEventListener('click', applyCarryMovement);
    document.getElementById('limbResetPose').addEventListener('click', resetPose);
    document.getElementById('limbDownloadJson').addEventListener('click', downloadExport);
  }

  async function attachCurrentAvatar() { // Rebuilds only this extension's hands/guides when the editor changes NPC/species/gender.
    runtime.backdrop = window.HobunjiGameplayBackdrop;
    runtime.model = runtime.backdrop?.getAvatarModel?.() || null;
    if (!runtime.model || runtime.backdrop?.getPreviewMode?.() !== 'npc') return;
    const identity = selectedIdentity(); // Current species/gender/body-color record used by profiles and hands.
    runtime.speciesId = identity.speciesId;
    runtime.gender = identity.gender;
    runtime.modelHeight = Number(runtime.model.userData?.portraitModelHeight) || Number(runtime.model.userData?.gameModelHeight) || 0.9;
    runtime.modelWidth = Number(runtime.model.userData?.portraitModelWidth) || runtime.modelHeight;
    runtime.floorLift = Number(runtime.model.userData?.gameGrounding?.avatarHeightHalfLift) || runtime.modelHeight / 2;
    runtime.poseRoot = runtime.model.parent || null;
    runtime.avatarLiftRoot = runtime.poseRoot?.parent || null;
    runtime.locomotionRoot = runtime.avatarLiftRoot?.parent || null;
    if (!runtime.poseRoot || !runtime.locomotionRoot) return;
    const profile = profileForIdentity(runtime.speciesId, runtime.gender); // Canonical rig profile used for posterior, shoulders, and existing arm-length extension.
    runtime.posteriorY = posteriorYFor(profile, runtime.modelHeight, runtime.model);
    const feet = feetObjects(); // Existing editor foot assemblies preserved and reused by ground poses.
    runtime.feetRoot = feet.root;
    runtime.feet.left = feet.left;
    runtime.feet.right = feet.right;
    runtime.anatomy = resolvedAnatomy(profile);
    runtime.handRig?.dispose?.();
    runtime.handRig = window.ProceduralHandAttachments?.attach?.(runtime.handThree || runtime.THREE, runtime.poseRoot, {
      name: 'procedural_pose_author',
      avatarRoot: runtime.model,
      speciesId: runtime.speciesId,
      gender: runtime.gender,
      modelHeight: runtime.modelHeight,
      bodyColors: identity.bodyColors,
    }) || null; // Real hand GLBs are used when available; the hand module keeps its generated fallback otherwise.
    ensureGuideRoot();
    const remembered = savedState().poseId; // Restores the author's last ground/carry family after avatar rebuild.
    if (POSE_LABELS[remembered]) runtime.poseId = remembered;
    syncInputsFromAnatomy();
    runtime.lastDebug = { attached: `${runtime.speciesId}::${runtime.gender}`, handRig: Boolean(runtime.handRig), feetFound: Boolean(runtime.feetRoot) };
  }

  async function start() { // Installs the extension after both the editor public API and hand/anatomy dependencies are ready.
    await ensureDependencies();
    const waitForBackdrop = () => new Promise(resolve => {
      if (window.HobunjiGameplayBackdrop) return resolve(window.HobunjiGameplayBackdrop);
      window.addEventListener('hobunji-backdrop-api-ready', event => resolve(event.detail || window.HobunjiGameplayBackdrop), { once: true });
    }); // Avoids racing the editor's large module initialization.
    runtime.backdrop = await waitForBackdrop();
    const panel = buildPanel(); // Touch-friendly workspace created once and restored after preview rebuilds.
    attachPanel(panel);
    addQuickButton(panel);
    wirePanel(panel);
    await attachCurrentAvatar();
    window.addEventListener('hobunji-backdrop-avatar-changed', () => setTimeout(() => attachCurrentAvatar().catch(console.error), 0));
    window.addEventListener('hobunji-backdrop-creature-changed', () => { runtime.handRig?.dispose?.(); runtime.handRig = null; disposeGuideRoot(); });
    requestAnimationFrame(animationLoop);
    console.info('[Limb pose author] Ground/rest anatomy + heavy upright carry workspace ready.');
  }

  window.HobunjiProceduralLimbPoseAuthor = {
    version: 1,
    getDebug: () => runtime.lastDebug,
    getExport: exportObject,
    refreshAvatar: attachCurrentAvatar,
    applyCarryMovement,
    resetPose,
  };

  start().catch(error => {
    console.error('[Limb pose author] Failed to initialize:', error);
    runtime.lastDebug = { initializationError: String(error?.stack || error) };
  });
})();
