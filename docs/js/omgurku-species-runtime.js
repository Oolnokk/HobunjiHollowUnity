// NPC-only Omgurku: one humanoid NPC identity/AI/combat rig, with a Voorg-ass
// quadruped lower half. There is NO mount, rider AI, or spawned wildlife.
// Both halves share the NPC's existing world transform and facing.
//
// The same single-actor composite also renders ridden mounts (MOUNTS below):
// an ordinary rider portrait seated on a full, headed creature card, requested
// with options.mountSpecies (BanditCombat forwards roster.mountSpecies, e.g.
// js/porakaneki-avengers.js's Nazgraku riders). Still one actor, no mount AI.
(() => {
  'use strict';

  const ID = 'omgurku'; // Distinct NPC species key used by portraits, wardrobe, saves and gameplay.
  const BODY = 'engh-sho'; // Existing shoulder/hand/weapon/wardrobe rig donor for the humanoid half.
  const LOWER_RIG = 'voorg-ass'; // Existing animal plane/shoulder rig donor; never creates a Voorg-ass actor.
  const FRAMES = Object.freeze(['idle', 'run1', 'run2']); // Authored lower PNGs, decoded by the shared animal-plane texture cache.
  const SPRITES = Object.freeze(Object.fromEntries(FRAMES.map(frame => [frame, `assets/creaturesprites/omgurku-lower_${frame}.png`])));
  // Ridden mounts: whole creature cards whose floor/saddle placement is derived
  // from the creature's authored rig profile (see mountPlacement). Mounted
  // animals use the regular whiskered sprites, matching game.js's CREATURE_DB note.
  const MOUNTS = Object.freeze({
    nazgraku: Object.freeze({
      lowerRig: 'nazgraku', sizeClass: 'large', modelWidth: 1.21, spriteAspect: 378 / 900, // Same plane recipe as CREATURE_DB.nazgraku.
      sprites: Object.freeze(Object.fromEntries(FRAMES.map(frame => [frame, `assets/creaturesprites/nazgraku_${frame}.png`]))),
    }),
  });
  const DEFAULT_PLACEMENT = Object.freeze({
    lowerWidth: 1.77, lowerHeight: 0.74, visibleFloorCorrection: 0.245,
    saddleU: 0.24, saddleV: 0.249, lowerDeadzoneDegrees: 13,
    joinDepth: -0.06, riderScale: 0.885,
    upperOffsetX: 0, upperOffsetY: 0, upperOffsetZ: 0,
    lowerOffsetX: 0, lowerOffsetY: 0, lowerOffsetZ: 0,
  }); // Latest user calibration; authored overrides live in config/species/omgurku.json.
  const DOCS_ROOT = (() => { // Absolute docs-root URL captured while this script still has currentScript.
    try { return new URL('../', document.currentScript?.src || new URL('js/', location.href)).href; }
    catch (_) { return new URL('./', location.href).href; }
  })();
  const LOCAL_PLACEMENT_KEY = 'hobunji.omgurku.hybridPlacement.v1';
  const placement = { ...DEFAULT_PLACEMENT }; // Applied to every live composite by applyPlacement().
  const live = new Set(); // Tracks currently attached Omgurku roots for one low-frequency shared gait update.
  const LOWER_TINT_KIND = 'omgurku-lower';
  let coatTextureCache = null; // Shared generated native animal-coat textures; refcounted through CreatureTextureCache.
  let mountCoatTextureCache = null; // Genotype-composited mount coats (base recolour, patterns, eyes), keyed like the wild-creature cache.
  const status = { // Surfaced by the in-page mobile debugger and debugSnapshot().
    registered: false, rigProfiles: 0, handInherited: false, wardrobeInherited: false,
    paletteInherited: false, lowerRig: LOWER_RIG, lastError: null, builds: 0, disposals: 0,
    tintedFrames: 0, coatColor: null, facingUpdates: 0,
  };
  const normalize = value => String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const optionSpecies = options => normalize(options?.speciesId || options?.profile?.fighter?.speciesId ||
    options?.profile?.appearance?.speciesId || options?.appearance?.speciesId || options?.npcRecord?.appearance?.speciesId);
  const isOmgurku = options => optionSpecies(options) === ID;
  const mountFor = options => MOUNTS[normalize(options?.mountSpecies)] || null;

  function installSpeciesData() {
    const config = window.SCRATCHBONES_CONFIG?.game; // Read the canonical mutable appearance config only after parser bootstrap.
    const species = config?.appearanceEditor?.species;
    if (species) {
      species[ID] = { label: 'Omgurku', parentSpecies: BODY, genders: ['male'], npcOnly: true, playerSelectable: false };
      status.registered = true;
    }
    const source = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[`${BODY}::male`];
    const characters = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters;
    if (source && characters) {
      const next = clone(source); // Independent authored anchors; never rewrite Engh-sho.
      next.species = ID;
      next.gender = 'male';
      if (next.shoulderPerchRule) next.shoulderPerchRule.appearanceSpeciesId = ID;
      if (next.posteriorRule) next.posteriorRule.appearanceSpeciesId = ID;
      if (next.anatomy) {
        delete next.anatomy.rigScale;
        delete next.anatomy.rigScaleX;
        delete next.anatomy.rigScaleY;
        delete next.anatomy.headScale;
        delete next.anatomy.headOffsetY;
      }
      characters[`${ID}::male`] = next;
      status.rigProfiles = 1;
      window.applyHobunjiAttachmentRigProfileCorrections?.();
    }
    const hand = window.HobunjiHandModelProfiles;
    if (hand?.mutate) {
      hand.mutate(data => {
        data.speciesModels ||= {};
        if (data.speciesModels[BODY]) data.speciesModels[ID] = data.speciesModels[BODY];
      });
      status.handInherited = !!hand.data?.speciesModels?.[ID];
    }
    // Headless quadrupeds get no humanoid foot rig, but keep Engh-sho hand GLBs.
    const profiles = config?.portrait?.armOnlyOpacityMask?.profiles;
    if (profiles?.[`${BODY}:male`]) profiles[`${ID}:male`] = clone(profiles[`${BODY}:male`]);
    const pose = window.HobunjiSpeciesPoseScale;
    if (pose?.resolveAxes && pose?.register) {
      try { pose.register(ID, 'male', pose.resolveAxes(BODY, 'male')); } catch (_) {}
    }
  }

  function installWardrobe() {
    const original = window.resolveOptionLayers; // Existing option resolver remains authoritative for every other fighter.
    if (typeof original !== 'function' || original.__omgurkuWardrobeWrapped) return;
    const wrapped = function resolveOmgurkuWardrobe(option, fighter) {
      if (normalize(fighter?.speciesId) !== ID) return original.apply(this, arguments);
      // Omgurku-specific allowedCosmetics/exclusiveSlotCosmetics gate headwear;
      // actual clothing sprite paths still come from the matching Engh-sho body.
      return original.call(this, option, { ...fighter, speciesId: BODY });
    };
    wrapped.__omgurkuWardrobeWrapped = true;
    wrapped.__omgurkuWardrobeOriginal = original;
    window.resolveOptionLayers = wrapped;
    status.wardrobeInherited = true;
  }

  function installPalette() {
    const previous = window.loadPortraitCosmetics; // Shared asynchronous species load and per-fighter body color range registry.
    if (typeof previous !== 'function' || previous.__omgurkuPaletteWrapped) return;
    const wrapped = async function loadOmgurkuColors() {
      const cosmetics = await previous.apply(this, arguments);
      const map = cosmetics?.bodyColorRangesByGender;
      const fighters = window.getPortraitFighters?.() || [];
      const donor = fighters.find(f => normalize(f.speciesId) === BODY && f.gender === 'male');
      const ours = fighters.find(f => normalize(f.speciesId) === ID && f.gender === 'male');
      if (map && donor && ours && map[donor.id]) map[ours.id] = map[donor.id];
      return cosmetics;
    };
    wrapped.__omgurkuPaletteWrapped = true;
    wrapped.__omgurkuPaletteOriginal = previous;
    window.loadPortraitCosmetics = wrapped;
    status.paletteInherited = true;
  }

  // Same body-color A descriptor normalization used by the procedural hands.
  function resolveBodyColorA(options = {}) {
    const colors = options.profile?.bodyColors || options.appearance?.bodyColors
      || options.npcRecord?.appearance?.bodyColors || options.bodyColors || {};
    const reference = window._dyeReferenceHexForSlot?.('A', ID) || '#7dc89a';
    if (/^#[\da-f]{6}$/i.test(String(colors.A?.hex || ''))) return colors.A.hex.toLowerCase();
    const rgb = window._resolveTargetRgbColor?.(colors.A, reference);
    if (Array.isArray(rgb) && rgb.length >= 3)
      return '#' + rgb.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
    return reference;
  }

  function ensureCoatRenderer() {
    const renderer = window.CreatureGeneticsRender;
    if (!renderer?.SPECIES || typeof renderer.composeFrame !== 'function') return null;
    // Clone Voorg-Ass's #99BF99 keyed shade-fill contract, but not its belly
    // or eye overlay; the authored Omgurku lower frames are headless.
    window.VoorgAssRegistration?.ensureRendererSpecies?.(renderer.SPECIES);
    const donor = renderer.SPECIES[LOWER_RIG];
    if (!donor) return null;
    if (!renderer.SPECIES[LOWER_TINT_KIND]) renderer.SPECIES[LOWER_TINT_KIND] = {
      prefix: LOWER_TINT_KIND,
      baseShadeReferenceHex: donor.baseShadeReferenceHex,
      baseRecolorKeyHex: donor.baseRecolorKeyHex,
      baseRecolorHueTolerance: donor.baseRecolorHueTolerance,
      baseRecolorMinSaturationRatio: donor.baseRecolorMinSaturationRatio,
      fullBaseRecolor: false,
      base: { ...SPRITES },
      patterns: [],
    };
    if (!coatTextureCache && window.CreatureTextureCache?.create) {
      coatTextureCache = window.CreatureTextureCache.create('omgurku-hybrid-coat',
        null, new Map(), { frameSetOf: key => {
          const parts = String(key).split('|');
          return parts[0] + '|' + (parts[2] || '');
        } });
    }
    return renderer;
  }

  // A ridden mount is a real creature: the same genotype compositor wild/farm Nazgraku use paints its coat, markings and eyes. The raw
  // sprite is the uncoloured, eyeless base art, so without this a mount shows as a pale blank card. Until a frame's composite is ready
  // (or when no genotype/compositor exists, e.g. a stripped-down harness) the raw frame stays visible.
  function prepareMountCoat(THREE, record) {
    const c = record?.root?.userData?.omgurkuComposite;
    const renderer = window.CreatureGeneticsRender;
    const genotype = c?.mountGenotype;
    const kind = c?.mount?.lowerRig;
    if (!c || !genotype || !kind || !renderer?.SPECIES?.[kind] || typeof renderer.composeFrame !== 'function' || !window.CreatureTextureCache?.create) return false;
    mountCoatTextureCache ||= window.CreatureTextureCache.create('omgurku-mount-coat', null, new Map(), { frameSetOf: window.CreatureTextureCache.genotypeFrameSetKey });
    const signature = renderer.genotypeSignature(kind, genotype);
    for (let i = 0; i < FRAMES.length; i++) {
      const ref = c.lowerRefs[i], frame = FRAMES[i];
      const key = `${kind}|${frame}|${signature}|${renderer.eyeStateKey?.(false) || 'o'}`;
      mountCoatTextureCache.retain(ref, key);
      const attach = pair => {
        if (!record.root.userData?.omgurkuComposite || window.CreatureTextureCache?.isDisposed?.(ref) || mountCoatTextureCache.keyFor(ref) !== key) return;
        const frontMat = ref.frontPlane?.material, backMat = ref.backPlane?.material;
        if (!frontMat || !backMat) return;
        if (frontMat.map !== pair.front) { frontMat.map = pair.front; frontMat.needsUpdate = true; }
        if (backMat.map !== pair.back) { backMat.map = pair.back; backMat.needsUpdate = true; }
        status.mountCoatFrames = (status.mountCoatFrames || 0) + 1;
      };
      const cached = mountCoatTextureCache.get(key);
      if (cached) { attach(cached); continue; }
      if (!coatJobs.has(key)) {
        const job = renderer.composeFrame(kind, frame, genotype, false)
          .then(canvas => {
            if (!canvas) return null;
            const display = window.CreatureTextureCache.fitGeneratedCanvas?.(canvas) || canvas;
            const front = new THREE.CanvasTexture(display); front.colorSpace = THREE.SRGBColorSpace;
            const back = new THREE.CanvasTexture(display); back.colorSpace = THREE.SRGBColorSpace;
            back.wrapS = THREE.RepeatWrapping; back.repeat.set(-1, 1); back.offset.set(1, 0); // Same mirrored back card as the wild-creature textures.
            return mountCoatTextureCache.put(key, { front, back });
          })
          .catch(error => { status.lastError = 'mount coat: ' + String(error?.message || error); return null; })
          .finally(() => coatJobs.delete(key));
        coatJobs.set(key, job);
      }
      coatJobs.get(key).then(pair => { if (pair) attach(pair); });
    }
    return true;
  }

  const coatJobs = new Map(); // One compositing job per native sprite and resolved swatch.
  function prepareLowerCoat(THREE, record) {
    const c = record?.root?.userData?.omgurkuComposite;
    if (c?.mount) return prepareMountCoat(THREE, record);
    const renderer = ensureCoatRenderer();
    if (!c || !renderer || !coatTextureCache) return false;
    status.coatColor = c.tintColor;
    for (let i = 0; i < FRAMES.length; i++) {
      const ref = c.lowerRefs[i], frame = FRAMES[i];
      const key = LOWER_TINT_KIND + '|' + frame + '|' + c.tintColor + '|0';
      coatTextureCache.retain(ref, key); // Canonical animal disposer releases its generated-texture owner.
      const attach = pair => {
        if (!record.root.userData?.omgurkuComposite || window.CreatureTextureCache?.isDisposed?.(ref)
          || coatTextureCache.keyFor(ref) !== key) return;
        const frontMat = ref.frontPlane?.material, backMat = ref.backPlane?.material;
        if (!frontMat || !backMat) return;
        if (frontMat.map !== pair.front) { frontMat.map = pair.front; frontMat.needsUpdate = true; }
        const back = window.PNGPlaneAvatar?.backMapFor?.(backMat, pair) || pair.back;
        if (backMat.map !== back) { backMat.map = back; backMat.needsUpdate = true; }
        status.tintedFrames++;
      };
      const cached = coatTextureCache.get(key);
      if (cached) { attach(cached); continue; }
      if (!coatJobs.has(key)) {
        const job = renderer.composeFrame(LOWER_TINT_KIND, frame, { base: { color: c.tintColor } })
          .then(canvas => {
            if (!canvas) return null;
            const display = window.CreatureTextureCache.fitGeneratedCanvas(canvas);
            const texture = window.HobunjiSpritePngSurface.makeCanvasTexture(THREE, display, key); // Match the shared PNG appearance contract.
            return coatTextureCache.put(key, { front: texture, back: texture });
          })
          .catch(error => {
            status.lastError = 'lower tint: ' + String(error?.message || error);
            console.warn('[omgurku] lower coat tint unavailable; keeping raw frames', error);
            return null;
          })
          .finally(() => coatJobs.delete(key));
        coatJobs.set(key, job);
      }
      coatJobs.get(key).then(pair => { if (pair) attach(pair); });
    }
    return true;
  }

  function bindNpcFacing(record) {
    if (record.walker || !record.npcId) return;
    const collection = window._npcWalkers;
    const walkers = typeof collection?.values === 'function' ? collection.values()
      : (Array.isArray(collection) ? collection : []);
    for (const walker of walkers) {
      if (!walker || walker.rec?.id !== record.npcId || typeof walker.applyFacingDeadzone !== 'function') continue;
      record.walker = walker;
      break;
    }
  }

  function releaseRecord(record) {
    live.delete(record);
    record.walker = null;
  }

  const diffAngle = (a,b) => Math.atan2(Math.sin(a-b), Math.cos(a-b));
  function updateIndependentFacing(record, camera) {
    const c = record.root.userData.omgurkuComposite;
    if (!c || !camera?.getWorldPosition) return;
    const now = performance.now();
    if (now - c.lastFaceSample < 4) return;
    const dt = c.lastFaceSample ? Math.min(.1,(now - c.lastFaceSample) / 1000) : 1/60;
    c.lastFaceSample = now;
    const perp = window.PerpRotation;
    if (!perp) return;
    const origin = record.root.getWorldPosition(c.positionScratch);
    const cameraPos = camera.getWorldPosition(c.cameraScratch);
    const cameraWorld = c.cameraWorld; // Reuse camera coordinates across render callbacks.
    cameraWorld.x = cameraPos.x; cameraWorld.z = cameraPos.z;
    const npcPerps = perp.cameraRelativePerpsAtWorldPosition?.(origin,cameraWorld);
    const animalPerps = perp.cameraRelativeCreaturePerpsAtWorldPosition?.(origin,cameraWorld);
    if (!npcPerps || !animalPerps) return;
    let rootYaw = Number(record.root.rotation?.y) || 0;
    if (record.root.getWorldDirection) {
      const dir = record.root.getWorldDirection(c.directionScratch);
      rootYaw = Math.atan2(dir.x,dir.z);
    }
    if (Number.isFinite(record.walker?.desiredRot)) c.rawNpcYaw = record.walker.desiredRot; // Read the NPC's authoritative raw heading without wrapping its per-frame method.
    const previewRaw = record.root.userData.omgurkuPreviewRawYaw;
    const preview = Number.isFinite(previewRaw);
    const rawYaw = preview ? previewRaw : (Number.isFinite(c.rawNpcYaw) ? c.rawNpcYaw : rootYaw);
    if (preview && perp.perpClamp) {
      const bodyYaw = Number(record.root.userData.omgurkuPreviewBodyYaw) || 0; // Attack turning goes through the same NPC deadzone, so the portrait never becomes an edge-on sliver.
      const desired = perp.perpClamp(c.npcFacing ||= {},rawYaw + bodyYaw,npcPerps,perp.PERP_DEAD_RAD).effectiveTarget;
      const rendered = Number.isFinite(c.previewNpcYaw)
        ? c.previewNpcYaw + diffAngle(desired,c.previewNpcYaw) * Math.min(1,dt*10)
        : desired;
      c.previewNpcYaw = rendered;
      c.upper.rotation.y = diffAngle(rendered,rootYaw);
    }
    // Real NPC walkers already clamp the portrait root; never re-clamp game NPCs.
    let target = rawYaw, snap = false;
    const dead = c.placement.lowerDeadzoneDegrees * Math.PI / 180; // Independent authored lower-half exclusion angle.
    if (perp.CREATURE_PLANE_ROT_MODE === 'snap' && perp.creatureSnapSwayTarget) {
      const result = perp.creatureSnapSwayTarget(c.animalFacing,rawYaw,animalPerps,dead,dt,c.frame !== 'idle');
      target = result.target; snap = result.snap;
    } else if (perp.CREATURE_PLANE_ROT_MODE === 'sway' && perp.creatureDeadzoneTarget) {
      target = perp.creatureDeadzoneTarget(c.animalFacing,rawYaw,animalPerps,dead,dt,c.frame !== 'idle');
    } else if (perp.perpClamp) {
      const result = perp.perpClamp(c.animalFacing,rawYaw,animalPerps,dead); // Priority edge changes must cut across the excluded angles, matching creature cards.
      target = result.effectiveTarget; snap = result.snapTo !== null;
    }
    c.animalYaw = snap || !Number.isFinite(c.animalYaw) ? target
      : c.animalYaw + diffAngle(target,c.animalYaw) * Math.min(1,dt*10);
    for (const ref of c.lowerRefs) {
      ref.group.rotation.y = diffAngle(c.animalYaw,rootYaw);
      // pivotLowerAroundJoin propagates the final position/yaw into both cards once.
    }
    // Reposition the lower card around its fixed attachment before either half renders.
    pivotLowerAroundJoin(record);
    c.upper.updateMatrixWorld?.(true);
    c.connector?.update?.();
    status.facingUpdates++;
  }

  function installFacingCallbacks(record) {
    const c = record.root.userData.omgurkuComposite; // Cache both halves once, before rendering begins.
    const planes = []; // Either half can render first after transparent-object sorting.
    c.upper.traverse?.(node => { if (node.isMesh) planes.push(node); });
    for (const ref of c.lowerRefs) planes.push(ref.frontPlane, ref.backPlane);
    for (const plane of planes) {
      if (!plane) continue;
      const previous = plane.onBeforeRender; // Preserve canonical sprite hooks.
      plane.onBeforeRender = function omgurkuIndependentFacing(renderer,scene,camera,geometry,material,group) {
        updateIndependentFacing(record,camera);
        previous?.call(this,renderer,scene,camera,geometry,material,group);
      };
    }
  }

  function setPreviewFacing(root, radians) {
    if (!root?.userData?.omgurkuComposite) return false;
    root.userData.omgurkuPreviewRawYaw = Number(radians) || 0;
    root.userData.omgurkuComposite.npcFacing = {};
    root.userData.omgurkuComposite.animalFacing = {};
    return true;
  }

  // Keep the humanoid weapon/hand frame fixed. The animal turns like a lever
  // around its authored saddle instead of translating the armed upper body.
  function pivotLowerAroundJoin(record) {
    const c = record?.root?.userData?.omgurkuComposite;
    if (!c) return;
    const p = c.placement;
    const saddleZ = (0.5 - p.saddleU) * p.lowerWidth; // Radius from lower card center to its fixed attachment.
    for (const ref of c.lowerRefs) {
      const yaw = Number(ref.group.rotation?.y) || 0; // Each gait card shares the animal's deadzone rotation.
      ref.group.position.x = p.lowerOffsetX - Math.sin(yaw) * saddleZ;
      ref.group.position.z = p.lowerOffsetZ + saddleZ * (1 - Math.cos(yaw));
      ref.group.updateMatrixWorld?.(true);
    }
    const join = record.root.userData.omgurkuJoin; // Debug marker remains at the fixed saddle.
    if (join) { join.x = p.lowerOffsetX; join.z = p.lowerOffsetZ + saddleZ; }
  }

  function applyPlacement(record) {
    const c = record?.root?.userData?.omgurkuComposite; // Keeps the named NPC's root fixed while both visual halves reposition together.
    if (!c) return;
    const p = c.placement; // Shared live Omgurku calibration, or a mount's own derived placement.
    const w = p.lowerWidth, h = p.lowerHeight;
    const rigOffset = c.mount ? NaN : Number(window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.['omgurku-lower']?.groundOffsets?.medium); // Mounts already encode their own authored lift in visibleFloorCorrection.
    const autoCenterY = h / 2 - p.visibleFloorCorrection; // Preserves current placement for Auto/0.
    const lowerFloorY = Number.isFinite(rigOffset) && Math.abs(rigOffset) > 1e-8 ? rigOffset : autoCenterY; // Nonzero is absolute floor-to-plane-center height.
    const centerY = lowerFloorY + p.lowerOffsetY; // Both joined halves move together; existing local calibration remains independent.
    const joinY = centerY + (0.5 - p.saddleV) * h;
    const joinZ = (0.5 - p.saddleU) * w + p.lowerOffsetZ;
    c.upper.position.set(p.lowerOffsetX + p.upperOffsetX,
      joinY + p.upperOffsetY, joinZ + p.joinDepth + p.upperOffsetZ);
    c.upper.scale.setScalar(p.riderScale);
    // Rebuilding the animal models is necessary to change their plane dimensions;
    // changing a composite scale here avoids GPU texture churn while dragging sliders.
    const lowerScaleX = w / c.builtLowerWidth, lowerScaleY = h / c.builtLowerHeight;
    for (const ref of c.lowerRefs) {
      ref.group.position.set(p.lowerOffsetX, centerY, p.lowerOffsetZ);
      ref.group.scale.set(lowerScaleX, lowerScaleY, lowerScaleX);
    }
    // Canonical hand anchors are floor-relative, while the portrait is centered.
    // Mount the rider floor beneath its portrait; saddle translation, yaw and
    // scale then carry the existing idle hands and attack poses together.
    c.riderFrame.position.y = -(Number(c.upper.userData.portraitModelHeight) || 0) / 2;
    for (const key of ['handAttachX','handAttachY','portraitModelHeight','portraitModelWidth','armLength','scaledArmLength','armLengthBySide']) {
      if (c.upper.userData?.[key] !== undefined) record.root.userData[key] = c.upper.userData[key];
    }
    record.root.userData.omgurkuJoin = { x: 0, y: joinY, z: joinZ, lowerCenterY: centerY };
    pivotLowerAroundJoin(record);
    c.connector?.update?.(true);
  }

  function setFrame(record, frame) {
    const c = record.root.userData.omgurkuComposite;
    if (c.frame === frame) return;
    for (let i = 0; i < FRAMES.length; i++) c.lowerRefs[i].group.visible = FRAMES[i] === frame;
    c.frame = frame;
  }

  function gaitTick() {
    if (typeof document !== 'undefined' && document.hidden) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const record of live) {
      bindNpcFacing(record); // Reads the walker's raw facing only; no second AI.
      if (!record.coatInitialized) record.coatInitialized = prepareLowerCoat(record.THREE, record);
      const root = record.root;
      if (!root.parent || !root.visible) continue;
      const c = root.userData.omgurkuComposite;
      if (!c) { live.delete(record); continue; }
      // Position comes exclusively from the existing NPC walker path/schedule/AI.
      // Do not independently translate the animal, and do not run another AI tick.
      const position = root.getWorldPosition(c.positionScratch);
      const previewSpeed = root.userData.omgurkuPreviewSpeed; // Explicit standalone-authoring input; ordinary NPCs retain movement-driven gait.
      const moved = Number.isFinite(previewSpeed) ? previewSpeed > 0.01 : c.lastPosition
        && Math.hypot(position.x - c.lastPosition.x, position.z - c.lastPosition.z) > 0.005;
      if (!c.lastPosition) c.lastPosition = position.clone();
      else c.lastPosition.copy(position);
      setFrame(record, moved ? FRAMES[1 + (Math.floor(now * 0.006) % 2)] : FRAMES[0]);
    }
  }

  // A mount's card size, floor lift and saddle come from the creature's own
  // authored rig profile (the same sizeScales/groundOffsets/saddle anchor the
  // player's mount seat uses), and the rider is raised so its authored
  // posterior rests on that saddle instead of fusing at the waist.
  function mountPlacement(mount, upper, riderSpeciesId, riderGender, genotype = null) {
    const rig = window.HOBUNJI_ATTACHMENT_RIG_PROFILES;
    const profile = rig?.creatures?.[mount.lowerRig];
    const sizeClass = String(genotype?.sizeClass || mount.sizeClass).toLowerCase(); // The creature's own Size gene (wild specimens roll the species default), exactly what a wild/ridden Nazgraku uses.
    mount = { ...mount, sizeClass };
    const size = profile?.sizeScales?.[mount.sizeClass];
    const sx = Number(size?.x) > 0 ? Number(size.x) : 1, sy = Number(size?.y) > 0 ? Number(size.y) : 1;
    const w = mount.modelWidth * sx, h = mount.modelWidth * mount.spriteAspect * sy;
    const authoredLift = Number(profile?.groundOffsets?.[mount.sizeClass]);
    const groundLift = Number.isFinite(authoredLift) && authoredLift > 0 ? authoredLift : h / 2; // Zero is the authored "Auto" sentinel.
    const saddle = profile?.anchors?.saddle?.position || {};
    const riderHeight = Number(upper?.userData?.portraitModelHeight) || 0.9;
    const riderRule = rig?.characters?.[`${riderSpeciesId}::${riderGender}`]?.posteriorRule;
    const posteriorY = Number(window.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY?.(riderRule, riderHeight, null)); // Floor-relative seat height.
    return {
      ...DEFAULT_PLACEMENT,
      lowerWidth: w, lowerHeight: h,
      visibleFloorCorrection: h / 2 - groundLift,
      saddleU: Math.max(0, Math.min(1, 0.5 - (Number(saddle.z) || 0) / mount.modelWidth)),
      saddleV: Math.max(0, Math.min(1, 0.5 - (Number(saddle.y) || 0) * sy / h)),
      joinDepth: 0, riderScale: 1,
      upperOffsetY: riderHeight / 2 - (Number.isFinite(posteriorY) ? posteriorY : riderHeight * 0.32),
    };
  }

  function installHybridRenderer() {
    const api = window.PNGPlaneAvatar;
    const original = api?.buildSinglePlaneAvatarModel;
    if (!original || typeof api?.buildAnimalPlaneAvatarModel !== 'function' || original.__omgurkuHybridWrapped) return;
    const wrapped = function buildOmgurkuNpc(THREE, sourceCanvas, options = {}) {
      const omgurku = isOmgurku(options);
      const mount = omgurku ? null : mountFor(options); // Omgurku already has its own fused lower half.
      if (!omgurku && !mount) return original.apply(this, arguments);
      const upper = original.call(this, THREE, sourceCanvas, omgurku ? { ...options, speciesId: ID, gender: 'male' } : options); // Resolve the canonical hand/anatomy rig for appearance-only callers too.
      if (!upper) return upper;
      const riderSpecies = omgurku ? ID : (normalize(upper.userData?.speciesId) || optionSpecies(options));
      const riderGender = omgurku ? 'male' : (upper.userData?.gender || options.gender || options.profile?.fighter?.gender || 'male');
      const lowerPlacement = mount ? mountPlacement(mount, upper, riderSpecies, riderGender, options.mountGenotype) : placement;
      const lowerSprites = mount ? mount.sprites : SPRITES;
      const lowerRig = mount ? mount.lowerRig : LOWER_RIG;
      const lowerRefs = [];
      let record = null; // Allows partial composite construction to unwind safely.
      try {
        for (const frame of FRAMES) {
          lowerRefs.push(api.buildAnimalPlaneAvatarModel(THREE, new URL(lowerSprites[frame], DOCS_ROOT).href, {
            modelWidth: lowerPlacement.lowerWidth,
            modelHeight: lowerPlacement.lowerHeight,
            name: `${mount ? `${lowerRig}_mount` : 'omgurku'}_${frame}`,
            creatureId: lowerRig, // Canonical creature shoulder/body UV rig (Omgurku: Voorg-ass rig with its own already-headless pixels).
            alphaTest: options.alphaTest,
          }));
        }
        const root = new THREE.Group(); // Sole NPC avatar group: collisions, dialogue, held items and movement remain under this parent.
        root.name = options.name || (mount ? 'Mounted_Rider_Hybrid' : 'Omgurku_NPC_Hybrid');
        const riderFrame = new THREE.Group(); // Floor-relative humanoid pose frame, mounted under the centered upper portrait.
        riderFrame.name = 'Omgurku_Mounted_Rider_Floor';
        upper.add(riderFrame);
        root.userData = { ...upper.userData, speciesId: riderSpecies, gender: riderGender, omgurkuNpc: omgurku,
          mountSpecies: mount ? lowerRig : null, avatarGroundLift: 0,
          proceduralHandParent: riderFrame, proceduralBodyRoot: upper };
        upper.userData.proceduralHandParent = riderFrame;
        root.add(upper);
        for (const ref of lowerRefs) root.add(ref.group);
        const c = {
          upper, riderFrame, lowerRefs, frame: null, builtLowerWidth: lowerPlacement.lowerWidth, builtLowerHeight: lowerPlacement.lowerHeight,
          placement: lowerPlacement, mount, mountGenotype: mount ? (options.mountGenotype || null) : null, // Omgurku records share the live calibration object; mounts own a derived one.
          positionScratch: new THREE.Vector3(), lastPosition: null,
          cameraScratch: new THREE.Vector3(), directionScratch: new THREE.Vector3(), cameraWorld: { x: 0, z: 0 },
          rawNpcYaw: null, npcFacing: null, animalFacing: {}, animalYaw: null, lastFaceSample: 0,
          lastAnimalFacingAt: 0, tintColor: mount ? null : resolveBodyColorA(options),
        };
        root.userData.omgurkuComposite = c;
        record = { root, THREE, npcId: options.npcRecord?.id || null, coatInitialized: false }; // Same record owns facing and genotype visuals.
        live.add(record);
        // Optional garment bridge; no mesh or GPU work until an authored/uploaded
        // PNG is enabled. Parent is this SAME NPC root, not a second actor.
        if (!mount && window.HobunjiOmgurkuConnector?.snapshot()?.enabled)
          c.connector = window.HobunjiOmgurkuConnector.create(THREE,root);
        applyPlacement(record);
        installFacingCallbacks(record);
        record.coatInitialized = prepareLowerCoat(THREE, record);
        setFrame(record, 'idle');
        status.builds += 1;
        return root;
      } catch (error) {
        if (record) {
          releaseRecord(record);
          record.root.userData.omgurkuComposite?.connector?.dispose?.();
          record.root.remove(upper);
          delete upper.userData.proceduralHandParent;
        }
        for (const ref of lowerRefs) ref?.dispose?.();
        status.lastError = String(error?.message || error);
        window.__farmLog?.(`[omgurku] hybrid build failed: ${status.lastError}`, 'warn');
        return upper; // Keep a visible humanoid NPC instead of breaking the walker spawn.
      }
    };
    wrapped.__omgurkuHybridWrapped = true;
    wrapped.__omgurkuHybridOriginal = original;
    api.buildSinglePlaneAvatarModel = wrapped;

    const dispose = api.disposeAvatarModel; // Canonical NPC wardrobe/area teardown must also release three shared lower textures.
    if (typeof dispose === 'function' && !dispose.__omgurkuHybridWrapped) {
      const disposeWrapped = function disposeOmgurkuNpc(root) {
        const c = root?.userData?.omgurkuComposite;
        if (!c) return dispose.call(this, root);
        for (const record of live) if (record.root === root) { releaseRecord(record); break; }
        if (c.disposed) return;
        c.disposed = true;
        c.connector?.dispose?.();
        for (const ref of c.lowerRefs) ref?.dispose?.();
        // Do not call the generic recursive disposal on the combined root:
        // animal texture maps are refcounted by buildAnimalPlaneAvatarModel.
        dispose.call(this, c.upper);
        root.parent?.remove?.(root);
        delete root.userData.proceduralHandParent;
        delete c.upper.userData.proceduralHandParent;
        status.disposals += 1;
      };
      disposeWrapped.__omgurkuHybridWrapped = true;
      disposeWrapped.__omgurkuHybridOriginal = dispose;
      api.disposeAvatarModel = disposeWrapped;
    }
  }

  function setPlacement(values = {}) {
    for (const key of Object.keys(DEFAULT_PLACEMENT)) {
      const n = Number(values[key]);
      if (!Object.prototype.hasOwnProperty.call(values, key) || !Number.isFinite(n)) continue;
      if (key === 'saddleU' || key === 'saddleV') placement[key] = Math.max(0, Math.min(1, n));
      else if (key === 'lowerDeadzoneDegrees') placement[key] = Math.max(0, Math.min(89, n));
      else if (key === 'riderScale') placement[key] = Math.max(0.5, Math.min(1.5, n));
      else if (key === 'lowerWidth') placement[key] = Math.max(0.4, Math.min(5, n));
      else if (key === 'lowerHeight') placement[key] = Math.max(0.2, Math.min(3, n));
      else if (key === 'visibleFloorCorrection') placement[key] = Math.max(-0.75, Math.min(1.5, n));
      else placement[key] = Math.max(-1.5, Math.min(1.5, n));
    }
    for (const record of live) applyPlacement(record);
    return { ...placement };
  }

  function setConnector(config, options = {}) {
    const bridge = window.HobunjiOmgurkuConnector;
    if (!bridge)return null;
    const next = bridge.set(config,options);
    for(const record of live){
      const c=record.root.userData.omgurkuComposite;
      if(!c||c.mount)continue;
      if(next.enabled && !c.connector)c.connector=bridge.create(record.THREE,record.root);
      if(!next.enabled && c.connector){c.connector.dispose();c.connector=null;}
      c.connector?.update(true);
    }
    return next;
  }

  function readLocalPlacement() {
    try {
      const data = JSON.parse(localStorage.getItem(LOCAL_PLACEMENT_KEY) || 'null');
      return data?.speciesId === ID && data?.hybridPlacement && typeof data.hybridPlacement === 'object'
        ? data.hybridPlacement : null;
    } catch (_) { return null; }
  }

  function saveLocalPlacement(values = placement) {
    const next = setPlacement(values);
    localStorage.setItem(LOCAL_PLACEMENT_KEY, JSON.stringify({
      schema: 'hobunji.hybrid-placement.v1', speciesId: ID, hybridPlacement: next,
    }));
    return next;
  }

  function clearLocalPlacement() {
    try { localStorage.removeItem(LOCAL_PLACEMENT_KEY); } catch (_) {}
    setPlacement(DEFAULT_PLACEMENT);
    return { ...placement };
  }

  async function loadAuthoredPlacement() {
    const local = readLocalPlacement();
    if (local) { setPlacement(local); status.placementSource = 'local override'; }
    // Continue loading the species document for its independent connector,
    // even when an unrelated local saddle calibration is present.
    try {
      const response = await fetch(new URL('config/species/omgurku.json', DOCS_ROOT));
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const cfg = await response.json();
      // A local setting saved while this request was in flight always wins.
      const latestLocal = readLocalPlacement();
      if (latestLocal) { setPlacement(latestLocal); status.placementSource = 'local override'; }
      else if (cfg.hybridPlacement) { setPlacement(cfg.hybridPlacement); status.placementSource = 'authored species config'; }
      // A user's uploaded local connector always wins. Authored config is
      // optional; older builds continue working without a connector asset.
      const bridge=window.HobunjiOmgurkuConnector;
      let hasLocal=false;
      try{hasLocal=!!localStorage.getItem(bridge?.storageKey);}catch(_){}
      if(bridge && !hasLocal && cfg.connector) setConnector(cfg.connector);
    } catch (error) { status.placementSource = 'built-in fallback'; status.placementLoadError = String(error?.message || error); }
  }

  function debugSnapshot() {
    return {
      ...status, liveCount: live.size, placement: { ...placement }, sprites: { ...SPRITES },
      liveFrames: [...live].map(({ root }) => {
        const c = root.userData.omgurkuComposite;
        return {
          name: root.name, mount: c?.mount?.lowerRig || null, frame: c?.frame, join: root.userData.omgurkuJoin,
          parented: !!root.parent, avatarGroundLift: root.userData.avatarGroundLift, appliedLift: root.position.y,
          handParentIsRider: root.userData.proceduralHandParent === c?.riderFrame,
          riderFloorY: c?.riderFrame?.position.y ?? null,
          lowerDeadzoneDegrees: (c?.placement || placement).lowerDeadzoneDegrees,
          handRigAttached: !!root.userData.proceduralHandRig,
          upperYaw: c?.upper?.rotation?.y ?? null,
          lowerYaw: c?.lowerRefs?.[0]?.group?.rotation?.y ?? null,
          rawNpcYaw: c?.rawNpcYaw ?? null,
          requestedPreviewYaw: root.userData.omgurkuPreviewRawYaw ?? null,
          coatColor: c?.tintColor ?? null,
          connector: c?.connector ? {enabled:c.connector.mesh.visible,tint:{...c.connector.tintStatus},
            triangles: c.connector.mesh.geometry.index?.count / 3} : null,
        };
      }),
    };
  }

  function installMobileDebug() {
    if (typeof document === 'undefined' || !/(?:\?|&)omgurkuDebug=1(?:&|$)/.test(location.search)) return;
    const mount = () => {
      if (!document.body || document.getElementById('omgurku-debug')) return;
      const panel = document.createElement('details'); // Opt-in mobile controls; never visible to ordinary players.
      panel.id = 'omgurku-debug';
      panel.style.cssText = 'position:fixed;z-index:100000;left:8px;top:70px;max-height:65vh;overflow:auto;width:min(340px,92vw);color:#fff;background:#152333ee;border:1px solid #7aa7ca;padding:10px;border-radius:10px;font:12px system-ui';
      panel.innerHTML = '<summary style="cursor:pointer">Omgurku rig debug</summary><pre style="white-space:pre-wrap;font:11px monospace"></pre>';
      const pre = panel.querySelector('pre'); // Live build/asset/rig errors remain visible without DevTools.
      for (const [key,min,max,step] of [['saddleU',0,1,.005],['saddleV',0,1,.005],['joinDepth',-.35,.35,.01],['riderScale',.5,1.5,.01]]) {
        const label = document.createElement('label');
        label.style.cssText = 'display:block;margin:7px 0';
        label.textContent = key;
        const input = document.createElement('input');
        input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = placement[key];
        input.style.width = '100%';
        input.addEventListener('input', () => { setPlacement({ [key]: Number(input.value) }); pre.textContent = JSON.stringify(debugSnapshot(), null, 2); });
        label.appendChild(input); panel.appendChild(label);
      }
      const refresh = document.createElement('button');
      refresh.textContent = 'Refresh diagnostics';
      refresh.addEventListener('click', () => { pre.textContent = JSON.stringify(debugSnapshot(), null, 2); });
      panel.appendChild(refresh); document.body.appendChild(panel);
      pre.textContent = JSON.stringify(debugSnapshot(), null, 2);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  }

  function install() {
    installSpeciesData();
    installWardrobe();
    installPalette();
    installHybridRenderer();
    return debugSnapshot();
  }

  const ready = loadAuthoredPlacement(); // Editors await the same authored/local configuration as gameplay.
  window.HobunjiOmgurkuSpecies = Object.freeze({
    ready,
    id: ID, bodySpecies: BODY, lowerRigSpecies: LOWER_RIG, sprites: SPRITES, mounts: MOUNTS, mountPlacement,
    install, setPlacement, setConnector, setPreviewFacing,
    setPreviewMotion(root,speed) { if(root?.userData?.omgurkuComposite)root.userData.omgurkuPreviewSpeed=Number.isFinite(speed)?Math.max(0,speed):undefined; }, saveLocalPlacement, clearLocalPlacement, defaultPlacement: DEFAULT_PLACEMENT,
    localPlacementKey: LOCAL_PLACEMENT_KEY, debugSnapshot,
  });
  install();
  installMobileDebug();
  setInterval(gaitTick, 100); // One shared, bounded-frequency visual gait tick; no parallel NPC simulation.
})();
