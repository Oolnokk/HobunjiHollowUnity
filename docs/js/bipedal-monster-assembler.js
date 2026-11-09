// Reusable creature-body + humanoid-GLB extremities assembler.
// Unlike Omgurku (human torso over creature legs), the painted creature is
// the entire torso/head; one NPC walker still owns locomotion, dialogue and animations.
(function (global) {
  'use strict';
  const TYPE = 'bipedal-monster'; // Saved rig discriminator, not a new creature species.
  const DEFAULT_NPC = 'nohuknuk'; // Old Man Nohuknuk's single authored profile; other hybrids supply their own configuration.
  const DEFAULT_LIMBS = 'engh-sho'; // Fallback donor when a future hybrid has not specified its own GLB models.
  const DEFAULT_NOHUKNUK = Object.freeze({
    type: TYPE, sprite: 'assets/creaturesprites/old_man_nohuknuk.png',
    limbSpecies: DEFAULT_NPC, handModel: 'primate', footModel: 'primate',
    gender: 'male', modelWidth: 1.18, modelHeight: 1.19, bodyOffsetY: 0,
    uvMode: 'stretch-fit',
    materials: {
      body: { texture: 'assets/textures/canvas.png', color: '#CECECE' },
      bone: { texture: 'assets/textures/canvas.png', color: '#0D0D0D' },
    },
    neck: {
      pivot: { x: .35, y: .47 }, center: { x: .19, y: .30 },
      radius: { x: .25, y: .30 }, minDeg: -30, maxDeg: 30, turnSpeedDeg: 120,
    },
  }); // Used when the authored database sidecar hasn't loaded yet (previews and startup).
  const selfUrl = typeof document !== 'undefined' ? document.currentScript?.src : null;
  const docsRoot = selfUrl ? new URL('../', selfUrl).href : null; // Resolves repo assets from either game or nested author pages.
  const active = new Set(); // One record per composed NPC; release removes it on NPC teardown.
  const appearanceById = new Map(); // Character-id-to-rig mapping used to render creature artwork in NPC dialogue.
  const debug = { builds: 0, disposals: 0, facingUpdates: 0, portraitRenders: 0, failures: [], registered: false };
  const normalize = value => String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const angleDiff = (a, b) => Math.atan2(Math.sin(a-b), Math.cos(a-b));
  const clone = value => JSON.parse(JSON.stringify(value));
  const validHex = value => /^#[0-9a-f]{6}$/i.test(String(value || ''));
  const assetUrl = value => docsRoot ? new URL(value, docsRoot).href : value;
  const fail = error => {
    debug.failures.push(String(error?.message || error));
    if (debug.failures.length > 8) debug.failures.shift();
    global.__farmLog?.('[bipedal-monster] ' + debug.failures[debug.failures.length - 1], 'warn');
  };

  function normalizeConfig(source) {
    if (!source || source.type !== TYPE || typeof source.sprite !== 'string' || !source.sprite.trim()) return null;
    const cfg = clone(source); // Each NPC owns its independent editable geometry and surface options.
    cfg.modelWidth = clamp(finite(cfg.modelWidth, 1), .1, 10);
    cfg.modelHeight = clamp(finite(cfg.modelHeight, cfg.modelWidth), .1, 10);
    cfg.bodyOffsetY = clamp(finite(cfg.bodyOffsetY, 0), -cfg.modelHeight, cfg.modelHeight);
    cfg.gender = normalize(cfg.gender) === 'female' ? 'female' : 'male';
    cfg.limbSpecies = normalize(cfg.limbSpecies || DEFAULT_LIMBS);
    return cfg;
  }
  function configForOptions(options) {
    const rec = options?.npcRecord || options?.profile?.npcRecord;
    const id = normalize(rec?.id || options?.profile?.portraitSeatId);
    const raw = rec?.bipedalMonsterRig || rec?.appearance?.bipedalMonsterRig
      || options?.appearance?.bipedalMonsterRig || appearanceById.get(id)
      || (id === DEFAULT_NPC || id === 'old-man-nohuknuk' ? DEFAULT_NOHUKNUK : null);
    return normalizeConfig(raw);
  }
  function materialForSpecies(speciesId, role) {
    const id = normalize(speciesId);
    const record = [...active].find(x => x.speciesId === id);
    const cfg = record?.config || (id === DEFAULT_NPC ? DEFAULT_NOHUKNUK : null);
    const value = cfg?.materials?.[role]; // Per-character material overrides never modify the shared hand/foot material palette.
    return value && validHex(value.color) && typeof value.texture === 'string'
      ? { texture: value.texture, color: value.color, uvMode: cfg.uvMode }
      : null;
  }

  function buildWeightMap(neck) {
    const size = 48; // Runtime fallback for an unpainted monster neck; the Animal Head Rig Painter can replace it.
    const center = neck?.center || { x: .3, y: .3 };
    const radius = neck?.radius || { x: .22, y: .22 };
    const rx = Math.max(.025, finite(radius.x, .22));
    const ry = Math.max(.025, finite(radius.y, .22));
    const data = []; // Used by the canonical AnimalHeadRigRuntime bilinear weight-map decoder.
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (x / (size-1) - finite(center.x, .3)) / rx;
      const dy = (y / (size-1) - finite(center.y, .3)) / ry;
      const d = Math.hypot(dx, dy);
      const t = clamp((1.24 - d) / .58, 0, 1);
      data.push(Math.round(255 * t * t * (3 - 2 * t)));
    }
    return { width: size, height: size, data };
  }
  function headRigFor(cfg, speciesId) {
    const known = global.AnimalHeadRigRuntime?.readSavedRigs?.()?.[speciesId]
      || global.SCRATCHBONES_CONFIG?.game?.animalHeadRigs?.[speciesId]
      || global.HobunjiAuthoredAnimalHeadRigs?.get?.(speciesId);
    if (known?.pivot && (known.weightMap || known.region)) return known; // Explicit painted authoring overrides the soft elliptical starting rig.
    const neck = cfg.neck || {};
    return {
      enabled: true, pivot: neck.pivot || { x: .5, y: .35 },
      weightMap: buildWeightMap(neck),
      minDeg: finite(neck.minDeg, -30), maxDeg: finite(neck.maxDeg, 30),
      restDeg: 0, turnSpeedDeg: finite(neck.turnSpeedDeg, 120), meshResolution: 48,
    };
  }

  function ensureSpecies() {
    const appearance = global.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species;
    if (appearance && !appearance[DEFAULT_NPC]) {
      appearance[DEFAULT_NPC] = {
        label: 'Old Man Nohuknuk', parentSpecies: DEFAULT_LIMBS,
        genders: ['male'], npcOnly: true, playerSelectable: false,
      }; // Appearance and NPC animations inherit the standard humanoid control schema.
    }
    const profiles = global.HobunjiHandModelProfiles;
    if (profiles?.mutate && !profiles.data?.models?.primate) {
      profiles.mutate(data => {
        const donor = data.models?.sloth || data.models?.feline;
        if (!donor) return;
        data.models.primate = {
          ...clone(donor), glb: 'assets/models/hands/hand_primate.glb',
          materialRoles: { MAT_EyeSurface_0c0c0c: 'body', MAT_None_7a4e2e: 'bone' },
        }; // The primate GLB's material NAMES are opposite its physical fur/claw mesh labels.
        data.speciesModels ||= {};
        data.speciesModels[DEFAULT_NPC] = 'primate'; // Nohuknuk alone defaults to the primate model.
      });
    } else if (profiles?.mutate && profiles.data?.speciesModels?.[DEFAULT_NPC] !== 'primate') {
      profiles.mutate(data => { data.speciesModels ||= {}; data.speciesModels[DEFAULT_NPC] = 'primate'; });
    }
    const feet = global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet;
    if (feet?.species) {
      feet.species[DEFAULT_NPC] = {
        glb: 'assets/models/feet/foot_primate.glb',
        materialRoles: { MAT_EyeSurface_0c0c0c: 'body', MAT_None_7a4e2e: 'bone' },
        uvMode: 'stretch-fit',
      }; // Canvas Stretch to Fit is specific to Nohuknuk's feet.
    }
    debug.registered = !!appearance?.[DEFAULT_NPC] && !!feet?.species?.[DEFAULT_NPC];
  }

  function matchingWalker(record) {
    if (record.walker?.root) return record.walker;
    const walkers = global._npcWalkers;
    if (!walkers) return null;
    const all = typeof walkers.values === 'function' ? walkers.values() : Array.isArray(walkers) ? walkers : [];
    for (const walker of all) {
      if (normalize(walker?.rec?.id) === record.npcId) return (record.walker = walker);
    }
    return null;
  }
  function updateFacing(record, camera) {
    const walker = matchingWalker(record);
    const perp = global.PerpRotation;
    if (!walker || !perp || !camera?.getWorldPosition || !walker._npcCharacterRigRoot) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - record.lastFacingAt < 5) return; // Both sides share one render-time solve.
    const dt = record.lastFacingAt ? Math.min(.1, (now-record.lastFacingAt)/1000) : 1/60;
    record.lastFacingAt = now;
    const parent = walker.root; // NPC locomotion/collision stays unmodified; this child owns the appearance-facing offset.
    const worldPoint = parent.getWorldPosition(new record.THREE.Vector3());
    const cameraPoint = camera.getWorldPosition(new record.THREE.Vector3());
    const perps = perp.cameraRelativeCreaturePerpsAtWorldPosition?.(worldPoint, { x: cameraPoint.x, z: cameraPoint.z });
    if (!perps) return;
    const logical = Number.isFinite(walker.desiredRot) ? walker.desiredRot : Number(walker.rot) || 0;
    const moving = (Number(walker._moveSpeedTiles) || 0) > .05;
    const turnLerp = Math.min(1, dt * 10);
    let target = logical, snap = false;
    if (perp.CREATURE_PLANE_ROT_MODE === 'snap' && perp.creatureSnapSwayTarget) {
      const result = perp.creatureSnapSwayTarget(record.perpState, logical, perps, perp.CREATURE_PERP_DEAD_RAD, dt, moving);
      target = result.target; snap = !!result.snap;
    } else if (perp.CREATURE_PLANE_ROT_MODE === 'sway' && perp.creatureDeadzoneTarget) {
      target = perp.creatureDeadzoneTarget(record.perpState, logical, perps, perp.CREATURE_PERP_DEAD_RAD, dt, moving);
    } else if (perp.perpClamp) {
      const result = perp.perpClamp(record.perpState, logical, perps, perp.CREATURE_PERP_DEAD_RAD);
      target = result.effectiveTarget; snap = result.snapTo !== null;
    }
    record.facingYaw = snap || !Number.isFinite(record.facingYaw)
      ? target : record.facingYaw + angleDiff(target, record.facingYaw) * turnLerp;
    const parentYaw = parent.rotation.y; // Visual child correction makes the creature, both GLB hands and both GLB feet use the same yaw.
    walker._npcCharacterRigRoot.rotation.y = angleDiff(record.facingYaw, parentYaw);
    walker._npcCharacterRigRoot.updateMatrixWorld?.(true);
    debug.facingUpdates++;
  }

  function buildComposite(THREE, sourceCanvas, options, original, api) {
    const cfg = configForOptions(options);
    if (!cfg) return original.call(api, THREE, sourceCanvas, options);
    ensureSpecies(); // Late editor instantiation can occur after hand-profile initialization.
    const rec = options.npcRecord || {};
    const speciesId = normalize(options?.speciesId || rec?.species || options?.appearance?.speciesId || DEFAULT_NPC);
    const ref = api.buildAnimalPlaneAvatarModel(THREE, assetUrl(cfg.sprite), {
      modelWidth: cfg.modelWidth, modelHeight: cfg.modelHeight, creatureId: speciesId,
      name: options.name || speciesId + '_bipedal_monster', headRig: headRigFor(cfg, speciesId),
      alphaTest: options.alphaTest,
    }); // Canonical animal sprite, material, mirrored cards, and painted neck; never a second game actor.
    if (!ref?.group) return original.call(api, THREE, sourceCanvas, options);
    // Animal Head Rig replaces both original Mesh objects with new SkinnedMeshes.
    // Keep all downstream facing hooks on the LIVE cards, not their detached predecessors.
    const planes = ref.group.children.filter(node => node.isMesh || node.isSkinnedMesh);
    ref.frontPlane = planes.find(node => node.userData?.hobunjiPlaneFace === 'front') || planes[0] || null;
    ref.backPlane = planes.find(node => node.userData?.hobunjiPlaneFace === 'back') || planes[1] || null;
    const root = new THREE.Group(); // Existing NPC animation parent sees a normal floor-relative portrait Group.
    root.name = options.name || speciesId + '_bipedal_monster';
    const body = ref.group; // Only one creature card assembly is built and owned by this NPC.
    body.position.y = cfg.bodyOffsetY;
    root.add(body);
    root.userData = {
      ...(options.userData || {}),
      bipedalMonsterRig: cfg, bipedalMonster: true,
      speciesId, gender: cfg.gender, pngPipelineMode: TYPE,
      creatureBodyAvatarRef: ref, creatureHeadRig: ref.headRig || null,
      portraitModelWidth: cfg.modelWidth, portraitModelHeight: cfg.modelHeight,
      portraitScaleMultiplier: 1, portraitVerticalPlacementRatio: .5,
      poseCentroidX: 0, poseCentroidY: cfg.modelHeight * .5, poseCentroidZ: 0,
      visualCentroidLocalX: 0, visualCentroidLocalY: cfg.bodyOffsetY, visualCentroidLocalZ: 0,
      handAttachX: -cfg.modelWidth * .35, handAttachY: cfg.modelHeight * .33,
      armLength: cfg.modelWidth * .42, scaledArmLength: cfg.modelWidth * .42,
      poseOrbitAxes: { x: 1, y: 1, z: 1 }, poseOrbitScale: 1,
      neckRig: { available: false, creatureHeadRig: ref.headRig || null },
      sourceCanvas, backCanvas: options.backCanvas || null,
      proceduralBodyRoot: root, proceduralHandParent: root,
    }; // NPC appearance metadata is consumed by the existing hands/feet/equipment/animation solvers.
    const record = {
      THREE, ref, root, config: cfg, speciesId, npcId: normalize(rec.id || options?.profile?.portraitSeatId),
      walker: null, perpState: {}, facingYaw: NaN, lastFacingAt: 0,
    }; // One self-contained assembly record for diagnostics/facing/disposal.
    active.add(record);
    for (const plane of [ref.frontPlane, ref.backPlane]) {
      if (!plane) continue;
      const prior = plane.onBeforeRender;
      plane.onBeforeRender = function bipedalMonsterBeforeRender(renderer, scene, camera, geometry, material, group) {
        updateFacing(record, camera); // Camera-aware creature deadzones drive limbs and body together.
        prior?.call(this, renderer, scene, camera, geometry, material, group);
      };
    }
    debug.builds++;
    return root;
  }

  function install() {
    ensureSpecies();
    const api = global.PNGPlaneAvatar;
    if (!api?.buildSinglePlaneAvatarModel || !api?.buildAnimalPlaneAvatarModel) return false;
    if (!api.buildSinglePlaneAvatarModel.__bipedalMonsterAssembler) {
      const original = api.buildSinglePlaneAvatarModel;
      const wrapped = function buildBipedalMonster(THREE, sourceCanvas, options = {}) {
        return buildComposite(THREE, sourceCanvas, options, original, this);
      };
      wrapped.__bipedalMonsterAssembler = true;
      wrapped.__bipedalMonsterOriginal = original;
      api.buildSinglePlaneAvatarModel = wrapped;
    }
    if (typeof api.disposeAvatarModel === 'function' && !api.disposeAvatarModel.__bipedalMonsterAssembler) {
      const originalDispose = api.disposeAvatarModel;
      const wrappedDispose = function disposeBipedalMonster(root) {
        const record = [...active].find(entry => entry.root === root);
        if (!record) return originalDispose.call(this, root);
        active.delete(record);
        record.walker = null;
        record.ref.dispose?.(); // Owns animal texture-reference release and skinned weighted geometries.
        root.parent?.remove?.(root);
        debug.disposals++;
      };
      wrappedDispose.__bipedalMonsterAssembler = true;
      api.disposeAvatarModel = wrappedDispose;
    }
    return true;
  }

  // Portraits/chatheads also use Nohuknuk's painted creature body, not an inherited Engh-sho face.
  const portraitSourceCache = new Map(); // Each unique sprite is decoded once for dialogue, editor, and spawn portraits.
  function loadPortraitSource(sprite) {
    const url = assetUrl(sprite);
    if (portraitSourceCache.has(url)) return portraitSourceCache.get(url);
    const promise = new Promise(resolve => {
      if (typeof Image === 'undefined') { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { fail('portrait sprite missing: ' + sprite); resolve(null); };
      img.src = url;
    });
    portraitSourceCache.set(url, promise);
    return promise;
  }
  function installPortraitBridge() {
    const preview = global.NpcAvatarPreview;
    const original = preview?.renderProfileToCanvas;
    if (!original || original.__bipedalMonsterPortrait) return;
    const wrapped = async function bipedalMonsterPortrait(canvas, profile, options = {}) {
      const id = normalize(options?.npcRecord?.id || profile?.portraitSeatId);
      const cfg = configForOptions({ ...options, profile });
      if (!cfg || !canvas?.getContext) return original.call(this, canvas, profile, options);
      const img = await loadPortraitSource(cfg.sprite);
      if (!img) return original.call(this, canvas, profile, options);
      const ctx = canvas.getContext('2d');
      const width = canvas.width, height = canvas.height;
      ctx.clearRect(0, 0, width, height);
      if (options.onlyHeadSprite) {
        const neck = cfg.neck || {};
        const cx = finite(neck.center?.x, .3) * img.width;
        const cy = finite(neck.center?.y, .3) * img.height;
        const rx = Math.max(1, finite(neck.radius?.x, .25) * img.width);
        const ry = Math.max(1, finite(neck.radius?.y, .3) * img.height);
        ctx.drawImage(img, Math.max(0, cx-rx), Math.max(0, cy-ry), Math.min(img.width, rx*2), Math.min(img.height, ry*2), 0, 0, width, height);
      } else {
        const scale = Math.min(width/img.width, height/img.height);
        ctx.drawImage(img, (width-img.width*scale)/2, (height-img.height*scale)/2, img.width*scale, img.height*scale);
      }
      debug.portraitRenders++;
      return canvas;
    };
    wrapped.__bipedalMonsterPortrait = true;
    preview.renderProfileToCanvas = wrapped;
  }

  function diagnostics() {
    return {
      ...debug, active: active.size,
      actors: [...active].map(record => ({
        npcId: record.npcId, model: record.config.handModel + '/' + record.config.footModel,
        headRig: !!record.ref.headRig, sprite: record.config.sprite,
        facingYaw: record.facingYaw, walkerBound: !!record.walker,
        fur: record.config.materials?.body?.color, claws: record.config.materials?.bone?.color,
        uvMode: record.config.uvMode,
      })),
    };
  }
  global.HobunjiBipedalMonsterAssembler = Object.freeze({
    type: TYPE, install, normalizeConfig, configForOptions, materialForSpecies,
    headRigFor, diagnostics, defaultNohuknuk: DEFAULT_NOHUKNUK,
  });
  install();
  installPortraitBridge();
  // Optional on-screen diagnostics for mobile: game URL ?bipedalMonsterDebug=1.
  if (typeof document !== 'undefined' && /(?:\?|&)bipedalMonsterDebug=1(?:&|$)/.test(location.search)) {
    const mount = () => {
      if (document.getElementById('bipedalMonsterDebug')) return;
      const panel = document.createElement('details');
      panel.id = 'bipedalMonsterDebug';
      panel.style.cssText = 'position:fixed;z-index:99999;top:70px;left:8px;max-height:55vh;overflow:auto;width:min(330px,90vw);background:#14212fee;color:white;font:12px system-ui;border:1px solid #668ac0;border-radius:8px;padding:8px';
      panel.innerHTML = '<summary>Bipedal monster rig · diagnostics</summary><button type="button">Refresh</button><pre style="white-space:pre-wrap"></pre>';
      panel.querySelector('button').onclick = () => { panel.querySelector('pre').textContent = JSON.stringify(diagnostics(), null, 2); };
      panel.querySelector('button').click();
      document.body.appendChild(panel);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  }
})(window);
