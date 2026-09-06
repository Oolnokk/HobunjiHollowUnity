(() => {
  'use strict';

  // Bandit Gangs — a bandit camp is a `placement.mode: "temporary"` locale
  // (see js/temporary-locales.js) stamped into an already-generated
  // wilderness zone at runtime, plus a gang of hostiles spawned around it.
  // Bandits deliberately reuse the entire animal-hostile pipeline
  // (hostileObjects -> updateHostiles -> damageCreature -> beginCreatureDeath
  // -> updateCorpses -> makeCorpseWorldObject) by being shaped exactly like a
  // makeCreatureEntity() result. Extracted out of game.js following the same
  // window.<Namespace> + init(deps) pattern already used by
  // js/mount-system.js and the other js/combat/*.js modules — game.js still
  // owns hostileObjects/damageCreature/updateHostiles/the mesh-update loop
  // and calls into this module's public API at the handful of points where
  // a bandit needs its own AI/visuals instead of wildlife's plain
  // bite-telegraph system. The dev-arena "Testing Arena" combat-log tool
  // (game.js's captureBanditCombatSnapshotText) also reads a few pieces of
  // this module's public API (naturalSwing/engagementReachPx/attackSlots/
  // queueRings/RANK_LABEL/TINT_SLOT_BY_SLOT/GUARD_DAMAGE_ABSORB/
  // MAX_ATTACK_SLOTS) for its per-bandit diagnostic fields — everything else
  // it reports is plain data already sitting on the shared entity object
  // `c` (health, x/y, _banditComboIndex, telegraphState, etc), not
  // module-private state, so it needed no changes.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // ── Bandit Gangs ──────────────────────────────────────────────────
  //
  // A bandit camp is a `placement.mode: "temporary"` locale (see
  // docs/js/temporary-locales.js) stamped into an ALREADY-generated
  // wilderness zone at runtime, plus a gang of hostiles spawned around
  // it. Bandits deliberately reuse the entire animal-hostile pipeline
  // (deps.hostileObjects -> updateHostiles -> damageCreature ->
  // beginCreatureDeath -> updateCorpses -> makeCorpseWorldObject) by
  // being shaped exactly like a makeCreatureEntity() result. Only two
  // things differ: the avatar is a per-instance composed NPC portrait
  // (species + clothing + dyes) rather than a species sprite sheet, and
  // the corpse hands over everything the bandit was wearing on top of
  // its rolled loot table. All tuning lives in
  // docs/config/bandits/bandit-gang-config.json.

  let _banditConfigPromise = null;
  function loadBanditGangConfig() {
    if (_banditConfigPromise) return _banditConfigPromise;
    _banditConfigPromise = (async () => {
      try {
        const r = await fetch('config/bandits/bandit-gang-config.json');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        deps.debugLog('Bandits: gang config load failed: ' + e.message, 'warn');
        return null;
      }
    })();
    return _banditConfigPromise;
  }

  let _banditLocaleDefsPromise = null;
  function loadBanditCampLocaleDefs() {
    if (_banditLocaleDefsPromise) return _banditLocaleDefsPromise;
    _banditLocaleDefsPromise = (async () => {
      // Local override — see the matching comment in
      // loadStampableLocaleDefs above.
      if (window.LocalDBOverrides?.getSourceMode() === 'local') {
        const override = window.LocalDBOverrides.getOverride('locales');
        if (override?.locales) {
          return override.locales.filter(e => e.category === 'bandit_camp');
        }
      }
      try {
        const idxRes = await fetch('config/locales/index.json');
        if (!idxRes.ok) throw new Error(`HTTP ${idxRes.status}`);
        const idx = await idxRes.json();
        const defs = [];
        for (const entry of (idx.locales || []).filter(e => e.category === 'bandit_camp')) {
          try {
            const r = await fetch(entry.file);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            defs.push(await r.json());
          } catch (e) { deps.debugLog(`Bandits: camp locale load failed for ${entry.file}: ${e.message}`, 'warn'); }
        }
        return defs;
      } catch (e) {
        deps.debugLog('Bandits: locale index load failed: ' + e.message, 'warn');
        return [];
      }
    })();
    return _banditLocaleDefsPromise;
  }

  const _banditSpeciesDefPromises = new Map();
  function loadBanditSpeciesDef(speciesId) {
    if (_banditSpeciesDefPromises.has(speciesId)) return _banditSpeciesDefPromises.get(speciesId);
    const p = (async () => {
      try {
        const r = await fetch(`config/species/${speciesId}.json`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        deps.debugLog(`Bandits: species def load failed for ${speciesId}: ${e.message}`, 'warn');
        return null;
      }
    })();
    _banditSpeciesDefPromises.set(speciesId, p);
    return p;
  }

  // ── Roster generation ─────────────────────────────────────────────

  // appliedDyes is keyed by the *tint* slot a cosmetic resolves to, not by
  // its wardrobe slot -- see portrait-utils.js's resolvedTintSlot ladder.
  // Every item in bandit-gang-config.json's clothingPool resolves purely
  // from its own `slot` under that ladder (torso with no colorRange but an
  // explicit tintSlot -> TORSO; hat with a colorRange -> HAT; overwear with
  // a colorRange and no `appearance` block -> CLOTH), which is why this is a
  // flat slot->tintSlot map instead of a per-item JSON fetch. Confirmed
  // against the appliedDyes samples in config/npcs/hobunji-starter-npc-database.json.
  const BANDIT_TINT_SLOT_BY_SLOT = { torso: 'TORSO', overwear: 'CLOTH', hat: 'HAT', hood: 'HOOD' };

  const BANDIT_NAME_PARTS = {
    first: ['Nakku', 'Tobri', 'Hesk', 'Vurra', 'Ommi', 'Dagat', 'Renji', 'Sulko', 'Pahru', 'Marek', 'Iggo', 'Yavra'],
    last: ['Ashjaw', 'Coldhand', 'Rustnail', 'Grinner', 'Sixteeth', 'Mudfoot', 'Blackrope', 'Splitlip', 'Farcry', 'Kettle'],
  };
  function _banditName(rank) {
    const first = BANDIT_NAME_PARTS.first[Math.floor(deps.rnd() * BANDIT_NAME_PARTS.first.length)];
    const last = BANDIT_NAME_PARTS.last[Math.floor(deps.rnd() * BANDIT_NAME_PARTS.last.length)];
    return rank === 'captain' ? `${first} ${last}` : first;
  }

  function _banditWeightedPick(weights) {
    const entries = Object.entries(weights || {}).filter(([k, v]) => !k.startsWith('_') && Number(v) > 0);
    if (!entries.length) return null;
    const total = entries.reduce((a, [, v]) => a + Number(v), 0);
    let r = deps.rnd() * total;
    for (const [key, v] of entries) { r -= Number(v); if (r <= 0) return key; }
    return entries[entries.length - 1][0];
  }

  // Species cosmeticWeights are keyed by wardrobe slot then by the item's
  // BARE base name (`basic_headband`, not `appearance::hat::basic_headband`),
  // and several whitelisted items (bandolier1/tankan_tunic) have no weights
  // entry at all -- so allowedCosmetics is the authority on what a species
  // may wear and cosmeticWeights only biases the pick when it happens to
  // list the item.
  function _banditClothingCandidates(speciesDef, gender, slot, poolIds, exclusiveIds) {
    const genderData = speciesDef?.[gender] || speciesDef?.male || null;
    const allowed = new Set(genderData?.allowedCosmetics || []);
    const exclusive = new Set(exclusiveIds || []);
    const weights = genderData?.cosmeticWeights?.[slot] || null;
    const out = {};
    for (const id of (poolIds || [])) {
      if (!allowed.has(id) && !exclusive.has(id)) continue;
      const bare = id.split('::').pop();
      out[id] = Number(weights?.[bare]) > 0 ? Number(weights[bare]) : 1;
    }
    return out;
  }

  function _banditRollDyeId(cfg) {
    const variants = cfg?.clothingPool?.dyeVariantPool || [];
    const hues = cfg?.clothingPool?.dyeHueFamilyPool || [];
    if (!variants.length || !hues.length) return null;
    const variant = variants[Math.floor(deps.rnd() * variants.length)];
    const hue = hues[Math.floor(deps.rnd() * hues.length)];
    return `dye:CLOTH:${variant}_${hue}`;
  }

  // Produces exactly the record shape makeNpcWalker feeds into
  // NpcAvatarPreview.buildProfileFromNpcExport, plus a `cosmeticSlots`
  // side table the corpse-loot step reads to rebuild each worn item as a
  // packClothing entry without re-deriving its slot.
  async function rollBanditRoster(cfg, rank, nameOverride) {
    const speciesId = _banditWeightedPick(cfg?.speciesWeights) || 'mao-ao';
    const gender = deps.rnd() < 0.5 ? 'male' : 'female';
    const speciesDef = await loadBanditSpeciesDef(speciesId);
    const slots = cfg?.clothingPool?.slots || [];
    const fillP = Number(cfg?.clothingPool?.fillProbabilityByRank?.[rank] ?? 0.5);
    const equippedCosmetics = [];
    const cosmeticSlots = {};
    const appliedDyes = {};
    const candidatesBySlot = {};
    for (const slot of slots) {
      candidatesBySlot[slot] = _banditClothingCandidates(
        speciesDef, gender, slot, cfg?.clothingPool?.itemsBySlot?.[slot], cfg?.clothingPool?.banditExclusiveIds);
    }
    const fillSlot = (slot) => {
      const id = _banditWeightedPick(candidatesBySlot[slot]);
      if (!id || equippedCosmetics.includes(id)) return false;
      equippedCosmetics.push(id);
      cosmeticSlots[id] = slot;
      const tintSlot = BANDIT_TINT_SLOT_BY_SLOT[slot];
      const dyeId = _banditRollDyeId(cfg);
      if (tintSlot && dyeId) appliedDyes[tintSlot] = dyeId;
      return true;
    };
    for (const slot of slots) { if (deps.rnd() < fillP) fillSlot(slot); }
    // See the config's _fillComment -- nobody walks around in nothing, so
    // an all-empty roll force-fills one slot the species can actually wear.
    if (!equippedCosmetics.length) {
      const wearable = slots.filter(s => Object.keys(candidatesBySlot[s] || {}).length);
      if (wearable.length) fillSlot(wearable[Math.floor(deps.rnd() * wearable.length)]);
    }
    // Head covering is never left to chance: every bandit wears a fine_hood,
    // a facewrap, or a headband. The independent per-slot rolls above already
    // land one most of the time -- this only force-fills hat or hood when
    // both came up empty (or unwearable) for this species/gender.
    const HEAD_SLOTS = ['hat', 'hood'];
    if (!HEAD_SLOTS.some(s => Object.values(cosmeticSlots).includes(s))) {
      const headWearable = HEAD_SLOTS.filter(s => Object.keys(candidatesBySlot[s] || {}).length);
      if (headWearable.length) fillSlot(headWearable[Math.floor(deps.rnd() * headWearable.length)]);
    }
    return {
      // nameOverride pins a captain to a specific bounty's persisted
      // identity (see _activeBountyForZone/spawnBanditCamp) instead of
      // a fresh random roll -- unused for grunts/lieutenants, which are
      // never a bounty target.
      name: nameOverride || _banditName(rank),
      appearance: { speciesId, gender, cosmetics: {} },
      equippedCosmetics, appliedDyes, cosmeticSlots,
    };
  }

  // ── Avatar ────────────────────────────────────────────────────────

  function makeGhoulAvatarMineLit(avatarRef) {
    if (!avatarRef?.group) return avatarRef;
    avatarRef.group.traverse(object => {
      if (!object?.isMesh || !object.material) return;
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      let changed = false;
      const litMaterials = sourceMaterials.map(source => {
        if (!source?.isMeshBasicMaterial || !source.map) return source;
        changed = true;
        const lit = new THREE.MeshLambertMaterial({
          name: `${source.name || 'ghoul_sprite'}_mine_lit`,
          map: source.map,
          alphaMap: source.alphaMap || null,
          color: source.color?.clone?.() || new THREE.Color(0xffffff),
          transparent: source.transparent,
          opacity: source.opacity,
          alphaTest: source.alphaTest,
          side: source.side,
          depthTest: source.depthTest,
          depthWrite: source.depthWrite,
          blending: source.blending,
          vertexColors: source.vertexColors,
        });
        lit.premultipliedAlpha = source.premultipliedAlpha;
        lit.polygonOffset = source.polygonOffset;
        lit.polygonOffsetFactor = source.polygonOffsetFactor;
        lit.polygonOffsetUnits = source.polygonOffsetUnits;
        lit.toneMapped = source.toneMapped;
        lit.userData = { ...(source.userData || {}), hobunjiMineLitGhoul: true };
        source.dispose?.();
        return lit;
      });
      if (changed) object.material = Array.isArray(object.material) ? litMaterials : litMaterials[0];
    });
    avatarRef.group.userData = { ...(avatarRef.group.userData || {}), mineLitGhoul: true };
    return avatarRef;
  }

  async function buildBanditAvatar(roster) {
    if (!window.NpcAvatarPreview || !window.PNGPlaneAvatar) return null;
    await window.NpcAvatarPreview.ensurePortraitCosmetics({ assetBase: './assets/', configBase: './config/' });
    const profile = window.NpcAvatarPreview.buildProfileFromNpcExport({
      name: roster.name,
      appearance: roster.appearance,
      equippedCosmetics: roster.equippedCosmetics,
      appliedDyes: roster.appliedDyes,
    });
    if (!profile) return null;
    const avatarCfg = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
    const MODEL_W = avatarCfg.worldModelWidth ?? 0.9;
    const PORTRAIT_SIZE = avatarCfg.previewPortraitCanvasSize ?? 200;
    // forceEyesOpen for the same reason makeNpcWalker needs it: this bakes
    // one static texture at spawn and never re-renders, so an unlucky
    // blink roll would leave the bandit permanently squint-eyed.
    const frontCanvas = document.createElement('canvas');
    frontCanvas.width = frontCanvas.height = PORTRAIT_SIZE;
    await window.NpcAvatarPreview.renderProfileToCanvas(frontCanvas, profile, { forceEyesOpen: true });
    const backCanvas = document.createElement('canvas');
    backCanvas.width = backCanvas.height = PORTRAIT_SIZE;
    await window.NpcAvatarPreview.renderProfileToCanvas(backCanvas, profile, { portraitView: 'behind', forceEyesOpen: true });

    const portrait = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(
      THREE, frontCanvas,
      {
        backCanvas, profile, modelWidth: MODEL_W, modelHeight: MODEL_W, anchorZ: 0,
        alphaTest: avatarCfg.worldAlphaTest ?? 0.01, name: 'bandit_portrait',
      },
    );
    const assembly = portrait.children[0];
    const frontMesh = assembly?.children?.[0];
    const backMesh = assembly?.children?.[1];
    if (!frontMesh || !backMesh) return null;

    // updateCreatureMesh, beginCreatureDeath and updateCorpses all assume
    // the ANIMAL two-plane convention: the flat cutout's face-normal lies
    // along the group's own local X at rest (frontPlane.rotation.y = +PI/2,
    // backPlane = -PI/2), which is exactly what makes rotating the group
    // +PI/2 about Z tip a corpse over to lie face-up. A portrait plane
    // (createSinglePlaneAssembly) instead has its normal along +Z, with the
    // front at rotation.y 0 and the back at PI. Rather than special-casing
    // three shared functions, each portrait mesh gets its own pivot Group
    // standing in as the "plane" those functions rotate, while the mesh
    // keeps rotation.y 0 inside it -- the net normal then lands on the
    // group's +X/-X exactly like an animal's, and the 180 degrees between
    // the two pivots preserves the front/back texture relationship
    // (buildTextureSet already UV-flips the rear canvas).
    //
    // The one thing this convention costs is a quarter turn of apparent
    // facing, which makeBanditEntity pays back via def.aimAngleOffset (see
    // updateCreatureMesh's rawTargetRotY) -- so a bandit still faces the
    // way it walks, and cameraRelativeCreaturePerps' edge-on dead zones
    // land on the correct angles for a front-facing sprite too.
    assembly.remove(frontMesh);
    assembly.remove(backMesh);
    frontMesh.rotation.y = 0;
    backMesh.rotation.y = 0;
    frontMesh.position.z = 0;
    backMesh.position.z = 0;

    // Gives this bandit a genuine neck-turn bone (see item 6: enemies
    // glancing at their combat target) without touching the rigid
    // frontPivot/backPivot Group structure the comment above explains --
    // only frontMesh/backMesh themselves become SkinnedMesh, mirroring
    // exactly how applyAnimalHeadRig upgrades an animal's front/backPlane
    // in place. No authored weight map exists for bandit portraits, so
    // this uses the auto-detected/auto-blended neck rig
    // buildSkinnedSinglePlaneAssembly already relies on for player/NPC
    // walkers (detectNeckPivotPx's full-body alpha-band scan), rather than
    // requiring one to be painted per species/gender.
    const neckPivotPx = window.PNGPlaneAvatar.detectNeckPivotPx?.(frontCanvas, 12);
    const neckPivotNormalized = neckPivotPx
      ? { x: neckPivotPx.x / frontCanvas.width, y: neckPivotPx.y / frontCanvas.height }
      : null;
    const frontNeckSkin = neckPivotNormalized
      ? window.PNGPlaneAvatar.upgradePlaneToAutoNeckSkin?.(THREE, frontMesh, neckPivotNormalized, false, { width: MODEL_W, height: MODEL_W })
      : null;
    const backNeckSkin = neckPivotNormalized
      ? window.PNGPlaneAvatar.upgradePlaneToAutoNeckSkin?.(THREE, backMesh, neckPivotNormalized, true, { width: MODEL_W, height: MODEL_W })
      : null;
    const renderedFrontMesh = frontNeckSkin?.mesh || frontMesh;
    const renderedBackMesh = backNeckSkin?.mesh || backMesh;

    const group = new THREE.Group();
    group.name = 'bandit_avatar_group';
    const frontPivot = new THREE.Group(); frontPivot.name = 'bandit_front_plane';
    const backPivot = new THREE.Group(); backPivot.name = 'bandit_back_plane';
    frontPivot.add(renderedFrontMesh);
    backPivot.add(renderedBackMesh);
    // Keeps the portrait's own species/gender grounding offset (the
    // assembly's y position inside the model root) now that the meshes no
    // longer sit under it.
    frontPivot.position.y = backPivot.position.y = assembly.position.y || 0;
    group.add(frontPivot);
    group.add(backPivot);

    // Procedural feet, mirroring the NPC walker's own ProceduralLegAnimation.attach
    // call (see makeNpcWalker) -- needs its own floor-anchored pivot rather than
    // reusing `group` directly, since (unlike playerMesh/the walker's root) `group`
    // here already IS the sprite's own transform, sitting at world Y = surfY +
    // halfHeight (see makeBanditEntity), not at floor level. A child positioned at
    // local Y = -halfHeight cancels that back out to true floor level -- attach()
    // itself assumes its parent's local Y=0 is the floor (see its own comment).
    const modelWidth = portrait.userData?.portraitModelWidth || MODEL_W;
    const modelHeight = portrait.userData?.portraitModelHeight || MODEL_W;
    // Preserve the portrait box recipe on the converted animal-style root:
    // authored width/height plus vertical placement, with runtime world scale
    // applied later by ranged-weapons' shared player/NPC 3D hitbox resolver.
    group.userData.portraitModelWidth = modelWidth;
    group.userData.portraitModelHeight = modelHeight;
    group.userData.portraitVerticalPlacementRatio = portrait.userData?.portraitVerticalPlacementRatio ?? 0.5;
    group.userData.portraitScaleMultiplier = portrait.userData?.portraitScaleMultiplier ?? 1;
    const legsPivot = new THREE.Group();
    legsPivot.name = 'bandit_legs_pivot';
    legsPivot.position.y = -(modelHeight / 2);
    group.add(legsPivot);
    // legsPivot's rotation.y is kept in sync with the same pngRot-derived
    // planeDelta the front/back planes use (see updateCreatureMesh), not
    // group's own free-tracking groupRot -- so the legs share whichever
    // dead-zone behavior currently governs the visible sprite (see
    // CREATURE_PLANE_ROT_MODE) instead of drifting out of sync with it,
    // same clipping fix applied to the mounted-rider case.
    const legs = window.ProceduralLegAnimation?.attach(THREE, legsPivot, {
      speciesId: roster.appearance.speciesId, gender: roster.appearance.gender,
      bodyColors: profile?.bodyColors || roster.appearance.bodyColors,
      modelWidth, modelHeight, handAttachY: portrait.userData?.handAttachY,
      name: roster.name || 'bandit', profile, portraitSize: PORTRAIT_SIZE,
    }) || null;

    return {
      group, frontPlane: frontPivot, backPlane: backPivot, legsPivot, legs,
      modelWidth, modelHeight,
      // Neck-turn bones for the combat head-look system (see
      // combat-bandit.js's _updateBanditLookAtTarget) -- null when no
      // readable neck pivot could be detected (e.g. a fully transparent
      // portrait canvas), in which case that system just no-ops.
      neckJoint: (frontNeckSkin && backNeckSkin) ? { front: frontNeckSkin.neckBone, back: backNeckSkin.neckBone } : null,
      // The real per-species/gender hand-attach point buildSinglePlaneAvatarModel
      // scans from the actual rendered portrait (png-plane-avatar.js's
      // scanOpaqueVerticalBounds/scanRowFirstOpaqueColumn) -- mirrors how
      // refreshPlayerAvatar reads the same fields (game.js's
      // playerToolBaseX/Y) instead of banditToolBaseXY's generic
      // -width/2,height/2 fallback.
      handAttachX: portrait.userData?.handAttachX,
      handAttachY: portrait.userData?.handAttachY,
      dispose() {
        legs?.dispose();
        frontNeckSkin?.weightedGeometry?.dispose();
        backNeckSkin?.weightedGeometry?.dispose();
        frontNeckSkin?.skeleton?.dispose?.();
        backNeckSkin?.skeleton?.dispose?.();
        // `group` is a freshly built THREE.Group standing in as the avatar's
        // rendered geometry (see the frontMesh/backMesh convention comment
        // above), not the `portrait` object buildSinglePlaneAvatarModel
        // returned. procedural-hand-frame-driver.js's hand rig (and anything
        // chained onto ProceduralHandAttachments.attach) is registered
        // against that original `portrait` avatarRoot, so disposing only
        // `group` disposes the visible geometry but leaves the hand rig
        // (and its sentinels/records) orphaned on every bandit death.
        window.PNGPlaneAvatar.disposeAvatarModel?.(portrait);
        window.PNGPlaneAvatar.disposeAvatarModel?.(group);
      },
    };
  }

  // ── Combatant ─────────────────────────────────────────────────────

  // Tier-0 CAPTAIN baseline; every other rank/tier is this scaled by
  // statWeakenMultiplierByRank * (1 + tier * tierStatBonusPerTier). Sized
  // against CREATURE_DB's own hostiles: a gar-wolf is 38 HP / 12 damage
  // and an alpha 78 / 18, so a tier-0 captain (70 / 17) reads a shade
  // under an alpha, and a tier-0 grunt (x0.55 -> ~39 HP / ~9 damage) is a
  // gar-wolf's worth of health that hits noticeably softer -- a lightly
  // armed thug, not a predator.
  const BANDIT_BASE_MAX_HEALTH = 70;
  // These 5 (plus CREATURE_DB's own per-species attack* fields) are
  // overridden from docs/config/combat/attack-values.json's `bandit`
  // section once it loads (see the window.__attackValuesConfigPromise
  // chain below) — kept as `let` with their original values as the
  // synchronous fallback default, same pattern as every combat-*.js
  // module's applyXConfig.
  let BANDIT_BASE_ATTACK_DAMAGE = 17;
  let BANDIT_ATTACK_RANGE_TILES = 0.9;
  let BANDIT_ATTACK_HALF_CONE_DEG = 44;
  let BANDIT_ATTACK_STAMINA_COST = 12;
  let BANDIT_ATTACK_COOLDOWN_S_CAPTAIN = 0.95;
  let BANDIT_ATTACK_COOLDOWN_S_OTHER = 1.15;
  const BANDIT_BASE_MAX_STAMINA = 46;
  // Rolled mastery is plain data on the combatant (bandits have no
  // gearInventory and never touch the player's tool-mastery XP system) --
  // it only ever scales damage, at this much per level.
  const BANDIT_MASTERY_DAMAGE_PER_LEVEL = 0.06;
  const BANDIT_RANK_LABEL = { grunt: 'Bandit', lieutenant: 'Bandit Lieutenant', captain: 'Bandit Captain' };
  // opportunistJab is excluded -- its bonus condition (target mid-strike-
  // telegraph) has no equivalent on the player, who has no telegraphState.
  const BANDIT_QUICK_ATTACK_IDS = ['exhaustCutter', 'backstabFlick', 'mercySpike'];

  function banditMasteryFor(cfg, rank, tier) {
    const base = Number(cfg?.masteryBaseByRank?.[rank] ?? 0);
    return deps.clamp(Math.round(base + tier), 0, 5);
  }

  // A bandit's actual held weapon -- see weaponMetalTierRangeByRank's
  // _comment in bandit-gang-config.json. Reuses the player's own
  // deps.HELD_SHAPE_DEFS/deps.METAL_DEFS/deps.craftedToolItemKey/deps.metalDmgMultiplier
  // rather than inventing a parallel weapon system, so a bandit's
  // hatchet/fishing-mace/fishing-spear/pick-shovel renders with the
  // exact same crafted-tool sprite+metal recolor the player's own gear
  // uses (see refreshMetalToolWorldTexture).
  // Only shapes that actually go in the weapon slot (see deps.HELD_SHAPE_DEFS
  // -- hoe is 'hoe' slot only, no dmgType at all) can be rolled here.
  // Recomputed fresh each call rather than cached at module load so a
  // shape added to deps.HELD_SHAPE_DEFS later is picked up automatically.
  function banditWeaponShapeKeys() {
    return Object.keys(deps.HELD_SHAPE_DEFS).filter(k => deps.HELD_SHAPE_DEFS[k].slots?.includes('weapon'));
  }
  function banditWeaponFor(cfg, rank, tier) {
    const shapeKeys = banditWeaponShapeKeys();
    const shapeKey = shapeKeys[Math.floor(deps.rnd() * shapeKeys.length)];
    const shape = deps.HELD_SHAPE_DEFS[shapeKey];
    const [minT, maxT] = cfg?.weaponMetalTierRangeByRank?.[rank] || [1, 2];
    const bonusT = tier;
    const maxMetalTier = Math.max(...deps.VERDIGRIS_METAL_KEYS.map(k => deps.METAL_DEFS[k].tier));
    const loT = deps.clamp(Math.round(minT), 1, maxMetalTier), hiT = deps.clamp(Math.round(maxT) + bonusT, loT, maxMetalTier);
    const tierPool = deps.VERDIGRIS_METAL_KEYS.filter(k => deps.METAL_DEFS[k].tier >= loT && deps.METAL_DEFS[k].tier <= hiT);
    const metalKey = (tierPool.length ? tierPool : deps.VERDIGRIS_METAL_KEYS)[Math.floor(deps.rnd() * (tierPool.length || deps.VERDIGRIS_METAL_KEYS.length))];
    const weaponKey = deps.craftedToolItemKey(shapeKey, metalKey);
    return { weaponKey, shapeKey, metalKey, dmgType: shape.dmgType || 'sharp', dmgMultiplier: deps.metalDmgMultiplier(metalKey) };
  }

  function banditRangedWeaponFor(cfg, rank) {
    const chance = Number(cfg?.rangedWeaponChanceByRank?.[rank] ?? 0);
    if (deps.rnd() >= chance) return null;
    return _banditWeightedPick(cfg?.rangedWeaponWeightsByRank?.[rank]) || 'crossbow';
  }

  // A bandit's real ability loadout -- tap1 (Combo) and tap2 (Quick
  // Attack) are available to every rank (matching the player's own
  // always-on tap slots), while hold1/hold2 are gated by
  // heldAbilitiesByRank: only lieutenants/captains get hold1 (Charged
  // Breaker), and only the captain also gets hold2 (Counter Shield).
  // See updateBanditCombatAI for how these are actually executed
  // (window.Combat.beginStagedAction + the real per-ability data tables
  // exposed by combat-combo.js/combat-quickattacks.js/combat-charged-
  // breaker.js/combat-counter-shield.js) -- this function only decides
  // WHICH abilities a bandit carries, not how they run.
  function banditAbilityLoadout(shapeKey, held) {
    return {
      tap1: (deps.HELD_SHAPE_DEFS[shapeKey]?.comboStyle || deps.HELD_SHAPE_DEFS[shapeKey]?.animStyle) === 'thrust' ? 'pokeCombo' : 'swingCombo',
      tap2: BANDIT_QUICK_ATTACK_IDS[Math.floor(deps.rnd() * BANDIT_QUICK_ATTACK_IDS.length)],
      hold1: held >= 1 ? 'chargedBreaker' : null,
      hold2: held >= 2 ? 'counterShield' : null,
    };
  }

  function makeBanditDef(cfg, rank, tier, mastery, modelWidth) {
    const tierRankMultipliers = cfg?.statMultiplierByRankAndTier?.[rank];
    // Tier-indexed rank curves keep low-star camps weak while preserving
    // meaningful supporting ranks in higher-star camps.
    const weaken = Number(
      Array.isArray(tierRankMultipliers)
        ? tierRankMultipliers[Math.min(Math.max(0, tier), tierRankMultipliers.length - 1)]
        : (cfg?.statWeakenMultiplierByRank?.[rank] ?? 1),
    );
    const tierMul = 1 + tier * Number(cfg?.difficultyTiers?.tierStatBonusPerTier ?? 0);
    const statMul = weaken * tierMul;
    const weapon = banditWeaponFor(cfg, rank, tier);
    const rangedWeaponKey = banditRangedWeaponFor(cfg, rank);
    const dmgMul = statMul * (1 + mastery * BANDIT_MASTERY_DAMAGE_PER_LEVEL) * weapon.dmgMultiplier;
    const held = Number(cfg?.heldAbilitiesByRank?.[rank] ?? 0);
    return {
      label: BANDIT_RANK_LABEL[rank] || 'Bandit',
      hostile: true, liveBirth: true,
      maxHealth: Math.max(1, Math.round(BANDIT_BASE_MAX_HEALTH * statMul)),
      maxStamina: Math.max(1, Math.round(BANDIT_BASE_MAX_STAMINA * statMul)),
      moveSpeed: 118 + tier * 4,
      chaseSpeed: 165 + (rank === 'captain' ? 20 : rank === 'lieutenant' ? 10 : 0) + tier * 5,
      attackDamage: Math.max(1, Math.round(BANDIT_BASE_ATTACK_DAMAGE * dmgMul)),
      attackRangePx: deps.TILE * BANDIT_ATTACK_RANGE_TILES,
      attackHalfConeRad: BANDIT_ATTACK_HALF_CONE_DEG * Math.PI / 180,
      attackStaminaCost: BANDIT_ATTACK_STAMINA_COST,
      attackCooldownS: rank === 'captain' ? BANDIT_ATTACK_COOLDOWN_S_CAPTAIN : BANDIT_ATTACK_COOLDOWN_S_OTHER,
      attackTag: weapon.dmgType,
      weaponKey: weapon.weaponKey,
      rangedWeaponKey,
      banditAbilityLoadout: banditAbilityLoadout(weapon.shapeKey, held),
      aiType: 'vigilantProtector',
      aggroRangePx: deps.TILE * (6.2 + (rank === 'captain' ? 1.1 : rank === 'lieutenant' ? 0.5 : 0)),
      leashRangePx: deps.TILE * (10 + (rank === 'captain' ? 2 : rank === 'lieutenant' ? 1 : 0)),
      canClimb: false, canSwim: false,
      modelWidth, tint: 0xffffff,
      // Quarter-turn correction for the portrait plane convention -- see
      // buildBanditAvatar's long comment.
      aimAngleOffset: Math.PI / 2,
      lootPool: 'bandit_' + rank,
    };
  }

  // ── Bandit ability AI ────────────────────────────────────────────
  //
  // Bandits attack through the SAME abilities the player has access to
  // (real Combo/Quick Attack/Charged Breaker/Counter Shield numbers --
  // see combat-combo.js/combat-quickattacks.js/combat-charged-
  // breaker.js/combat-counter-shield.js's `window.Combat.*Data` read-only
  // exports), not a bite-telegraph approximation. This is deliberately a
  // PARALLEL executor rather than a shared one: the real ability modules
  // are hardwired to the single player singleton (deps.player,
  // window.Combat.deps.currentWeaponKey(), etc — see combat-core.js's
  // own "every staged action in this pipeline is a player weapon-tool
  // attack" comment), so reusing them for an NPC attacker would mean
  // refactoring every one of those modules to take an attacker
  // parameter -- real, working code with genuine risk of subtly
  // changing how the player's own combat feels. What IS safely reusable
  // is window.Combat.beginStagedAction (combat-core.js's generic
  // windup/strike/recover timer, which takes no player-specific
  // assumptions at all) and each ability's own numeric data tables,
  // which is what this does. Per MULTIPLAYER.md's own analysis this
  // isn't something multiplayer needs solved either way: multiplayer's
  // model is one full client per player (each with its own independent
  // copy of the singleton combat state), not one process simulating
  // several attackers -- an NPC-vs-player fight is an orthogonal,
  // single-client concern either way.
  //
  // Telegraphing: sets c.telegraphState ('windup'|'strike') exactly like
  // combat-enemy-telegraph.js does, so updateCreatureMesh's existing
  // tint code (amber windup / white strike) gives the player the same
  // visible tell against a bandit as against a wolf, for free.

  // Effectively no pause between the 3 combo steps -- next frame's
  // attackCooldownT check (updateBanditCombatAI) passes immediately once
  // the prior step's own onComplete fires, same as a player tapping the
  // Combo button again the instant the last swing resolves.
  const BANDIT_COMBO_CHAIN_GAP_S = 0.02;
  const BANDIT_HOLD1_COOLDOWN_S = 5;
  const BANDIT_HOLD1_CHANCE = 0.4; // chance to open a fresh engagement with Charged Breaker instead of the combo
  const BANDIT_QUICK_ATTACK_CHANCE = 0.45; // chance to use tap2 instead of continuing tap1 when a condition is favorable
  const BANDIT_GUARD_WINDOW_S = 1.6;
  const BANDIT_GUARD_COOLDOWN_S = 6;
  const BANDIT_GUARD_DAMAGE_ABSORB = 0.7; // fraction of incoming damage blocked while a captain is guarding

  // A bandit's post-attack "jump back" used to always play at the same
  // full deps.JUMP_BACK_DUR_S regardless of whether the attack that
  // triggered it actually landed -- a combo where every step connected
  // looked identical to a total whiff, both backing off by the same
  // amount. Scales the retreat duration down the more of the attempt
  // actually landed (successFrac: 0 = total whiff, 1 = every step/the
  // one attack landed) -- a clean, fully-landed combo barely backs off
  // at all, while a total whiff still gets the complete jump-back (it
  // needs the space to reset and re-approach).
  const BANDIT_RETREAT_MIN_SCALE = 0.3;
  function banditRetreatDurationS(successFrac) {
    return deps.JUMP_BACK_DUR_S * (1 - (1 - BANDIT_RETREAT_MIN_SCALE) * deps.clamp(successFrac, 0, 1));
  }

  // The bandit-side equivalent of combat-combo.js/combat-quickattacks.js/
  // combat-charged-breaker.js's `deps.weaponAbility('cut')` base numbers
  // every step/technique multiplies from -- except a bandit's own
  // def.attackDamage/attackRangePx already carries its full rank/tier/
  // mastery/weapon-metal scaling, so this IS the scaled baseline, not a
  // flat constant every bandit shares.
  function banditAttackBaseline(def) {
    return { damage: def.attackDamage, rangePx: def.attackRangePx, knockbackPxS: deps.HOSTILE_BITE_KNOCKBACK_PX_S };
  }

  // Mirrors combat-quickattacks.js's getConditions(), but for a bandit
  // attacking the player instead of the player attacking a creature --
  // "behind" is recomputed from the player's own facing (player.angle)
  // since the real version reads target.facing (a creature-only field);
  // "enemyStriking" has no equivalent (the player has no telegraphState)
  // and always reads false, which is exactly why opportunistJab (the
  // only technique keyed on it) is excluded from BANDIT_QUICK_ATTACK_IDS.
  function banditQuickAttackConditions(c, targetPlayer) {
    const dxBP = c.x - targetPlayer.x, dyBP = c.y - targetPlayer.y;
    const distBP = Math.max(0.001, Math.hypot(dxBP, dyBP));
    const forwardX = Math.cos(targetPlayer.angle || 0), forwardY = Math.sin(targetPlayer.angle || 0);
    const behindDot = forwardX * (dxBP / distBP) + forwardY * (dyBP / distBP);
    return {
      enemyStriking: false,
      exhausted: !!targetPlayer.exhaustion?.active || targetPlayer.stamina <= targetPlayer.maxStamina * 0.20,
      behind: behindDot < -0.35,
      lowHealth: targetPlayer.health > 0 && targetPlayer.health <= targetPlayer.maxHealth * 0.30,
    };
  }

  // The weapon's own natural at-rest swing style (sweep for hatchet/
  // fishing-mace, thrust for the rest) -- used both at spawn and to
  // reset back to after any ability that plays a DIFFERENT style
  // finishes (see finishBanditAction below).
  function banditNaturalSwing(def) {
    const isSweep = deps.TOOL_ITEM_DEFS[def.weaponKey]?.animStyle === 'sweep';
    return { anim: isSweep ? 'sweep' : 'thrust', pose: isSweep ? window.Combat?.poses?.SWEEP_POSE : null };
  }

  // Ends the current staged action's telegraph tell and, if provided,
  // runs extra bookkeeping (retreat, cooldowns) once it's actually done
  // rather than the moment it's cancelled mid-flight.
  function finishBanditAction(c) {
    c._banditAction = null;
    c.telegraphState = null;
    if (!c._banditLunging) c._banditLungeHopCurrent = 0;
    // Quick Attack and Charged Breaker both hardcode their OWN anim/
    // pose regardless of the equipped weapon ('thrust'/null and
    // 'sweep'/SWEEP_POSE respectively -- see fireBanditQuickAttack/
    // fireBanditChargedBreaker's own comments) and, unlike
    // fireBanditComboStep, nothing ever set these back afterward --
    // once ANY bandit used either ability even once, its idle-between-
    // attacks stance got stuck showing that ability's style forever
    // (regardless of its real weapon) until a combo step happened to
    // fire and correct it by coincidence. Reset unconditionally here so
    // "idle" always means the weapon's own natural rest stance, not
    // whatever the last-fired ability happened to want.
    const natural = banditNaturalSwing(c.def);
    c._banditSwingAnim = natural.anim;
    c._banditSwingPose = natural.pose;
    c._banditSwingDirSign = 1;
    c._banditSwingPower = 1;
  }

  // ── Bandit lunge ─────────────────────────────────────────────────
  //
  // Mirrors beginCombatLunge/updateMovement's player-only lunge block
  // (game.js ~18958-19012) rather than reusing it directly (it writes
  // straight to the single global `player` object throughout). Angle
  // locks at fire time and never re-aims mid-flight -- Pounce's own
  // leap (combat-animal-attacks.js) is the existing creature-side
  // precedent for that choice ("nothing during windup/leap re-aims it,
  // which is what makes the leap genuinely dodgeable"), so this skips
  // the player lunge's mid-flight homing correction rather than
  // reinventing it. deps.tickCreatureLungeTrail (the ground-stamp trail) and
  // deps.tickCreatureFootsteps are already entity-generic -- called exactly
  // the way pounceUpdate already calls them.
  function beginBanditLunge(c, distancePx, durationS, hitTest, targetPlayer) {
    if (durationS <= 0 || c._banditLunging) return;
    const lungeProfile = window.Combat?.meleeLungeProfile?.(distancePx, c._banditAimPitch || 0, 0, c.def?.lungeHeightUnits ?? 1)
      || { distancePx, hopUnits: 0, pitch: c._banditAimPitch || 0 }; // Used to turn high enemy aim into a shorter leap.
    distancePx = lungeProfile.distancePx;
    // Cap the travel distance so an already-close bandit can't lunge
    // straight past a stationary target -- distancePx above is a FIXED
    // per-ability budget (e.g. Step Thrust's full tile*lungeMul) applied
    // regardless of current range, and the ease-out curve below front-
    // loads most of that travel very early, so at point-blank range the
    // bandit shot clean through the target and ended up on the far
    // side with c.facing now ~180 degrees off (confirmed live:
    // diffDeg=180.0 on a Step Thrust that was already within rangePx).
    // Never lunge past haltDist -- the same margin-inside-the-cone
    // distance isPlayerInBanditLungeCone/updateBanditLunge already halt
    // at -- so a close target simply skips the lunge (distancePx <= 0)
    // instead of overshooting it.
    if (targetPlayer && hitTest) {
      const currentDist = Math.hypot(targetPlayer.x - c.x, targetPlayer.y - c.y);
      const haltDist = hitTest.rangePx * BANDIT_LUNGE_HALT_MARGIN;
      distancePx = Math.min(distancePx, Math.max(0, currentDist - haltDist));
      if (distancePx <= 0 && lungeProfile.hopUnits <= 0.01) return;
    }
    c._banditLunging = true;
    c._banditLungeT = durationS;
    c._banditLungeDur = durationS;
    c._banditLungeStartX = c.x;
    c._banditLungeStartY = c.y;
    c._banditLungeDirX = Math.cos(c.facing || 0);
    c._banditLungeDirY = Math.sin(c.facing || 0);
    c._banditLungeDistancePx = distancePx;
    c._banditLungeHopUnits = lungeProfile.hopUnits;
    c._banditLungeHopCurrent = 0;
    c._banditLungeAimPitch = lungeProfile.pitch;
    c._banditLungeHitTest = hitTest;
  }

  // Halts the lunge at a margin INSIDE the real hit-cone (see
  // BANDIT_LUNGE_HALT_MARGIN), not right at its edge -- the actual
  // damage hit-check (fireBandit*'s own onStrike) still uses the real,
  // unshrunk rangePx/halfConeRad, so this margin only affects when the
  // lunge itself stops moving, not what counts as a hit. Without it,
  // the lunge halts the instant the player is barely inside the cone
  // (zero cushion) and the hit-check doesn't actually fire until
  // strikeS later, since the halt only ends the windup-phase movement
  // early -- a real human player, unlike a hostile creature's target,
  // routinely drifts during that gap, and with the real hit-cone now
  // correctly sized (see banditEngagementReachPx's RANGE_SCALE fix,
  // e.g. ~30px for a Forehand Swing) that's enough room to step back
  // outside it before the hit-check ever runs, whiffing an attack that
  // looked like it landed.
  const BANDIT_LUNGE_HALT_MARGIN = 0.68;
  function isPlayerInBanditLungeCone(c, hitTest, targetPlayer) {
    if (!hitTest || targetPlayer.health <= 0) return false;
    return window.Combat?.meleeHit?.(c, targetPlayer, {
      rangePx: hitTest.rangePx * BANDIT_LUNGE_HALT_MARGIN,
      halfConeRad: hitTest.halfConeRad,
      yaw: c.facing,
      pitch: c._banditLungeAimPitch || c._banditAimPitch || 0,
    }) || false;
  }

  // Re-aim rate (rad/sec) for the lunge homing below -- same value and
  // reasoning as the player's own lunge homing (game.js's
  // LUNGE_HOMING_RATE in updateMovement).
  const BANDIT_LUNGE_HOMING_RATE = 6;

  // Returns true while a lunge is in flight (caller should skip its own
  // normal movement/approach logic for the frame).
  function updateBanditLunge(c, dt, targetPlayer) {
    if (!c._banditLunging) return false;
    if (isPlayerInBanditLungeCone(c, c._banditLungeHitTest, targetPlayer)) {
      // Stop horizontal travel but finish the leap arc so the enemy body
      // stays at the aimed elevation through the staged strike.
      c._banditLungeHitTest = null;
      c._banditLungeStartX = c.x;
      c._banditLungeStartY = c.y;
      c._banditLungeDistancePx = 0;
    }
    // Re-aims c.facing toward the target's CURRENT position every
    // frame, capped at BANDIT_LUNGE_HOMING_RATE -- mirrors the player's
    // own lunge homing instead of Pounce's lock-at-fire-and-never-
    // correct precedent this used to follow. Pounce's prey doesn't
    // actively strafe against it; a human player does, and the swing's
    // own hit-cone is narrow (13-42 degree half-angle) and was never
    // re-checked against anything but the frozen fire-time angle, so
    // even a moderate sidestep during the ~0.2-0.4s windup+strike
    // window routinely carried the player clean outside the cone
    // despite being well within range -- a systematic whiff source no
    // amount of range-margin tuning (BANDIT_LUNGE_HALT_MARGIN) could
    // fix, since that only ever widens the RANGE cushion, not the
    // ANGULAR one. fireBandit*'s onStrike/spawnBanditTrailArc calls
    // read c.facing live (not a fire-time-frozen local) so the eventual
    // hit-check and the visual trail both land on wherever this homing
    // actually ends up aiming.
    if (targetPlayer.health > 0) {
      const desiredFacing = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
      const homingT = Math.min(1, BANDIT_LUNGE_HOMING_RATE * dt);
      c.facing += deps.angleDiff(desiredFacing, c.facing) * homingT;
      const aimed = window.Combat?.meleeAimSolution?.(c, targetPlayer, c.facing, c._banditLungeAimPitch || 0);
      if (aimed) c._banditLungeAimPitch += (aimed.pitch - (c._banditLungeAimPitch || 0)) * homingT;
      c._banditAimPitch = c._banditLungeAimPitch;
      c._banditLungeDirX = Math.cos(c.facing);
      c._banditLungeDirY = Math.sin(c.facing);
    }
    c._banditLungeT = Math.max(0, c._banditLungeT - dt);
    const t = 1 - c._banditLungeT / c._banditLungeDur;
    const eased = 1 - Math.pow(1 - t, 3);
    const desiredX = c._banditLungeStartX + c._banditLungeDirX * c._banditLungeDistancePx * eased;
    const desiredY = c._banditLungeStartY + c._banditLungeDirY * c._banditLungeDistancePx * eased;
    c._banditLungeHopCurrent = (c._banditLungeHopUnits || 0) * Math.sin(eased * Math.PI);
    const swept = deps.sweptMove(c.x, c.y, desiredX, desiredY, (x, y) => deps.canOccupyAt(x, y, deps.TILE * 0.32));
    const stepPx = Math.hypot(swept.x - c.x, swept.y - c.y);
    c.x = swept.x; c.y = swept.y;
    // Same-frame overshoot correction: a lunge's own cone-halt (above)
    // normally stops it well outside contact range, but the lunge
    // doesn't home like the player's own does, so a target that
    // sidesteps out of the locked cone mid-flight can otherwise carry
    // the bandit straight through it -- see BANDIT_PLAYER_COLLISION_RADIUS_PX.
    enforceBanditPlayerCollision(c, targetPlayer);
    const dmgTag = c.def.attackTag || 'sharp';
    const afflictionBonuses = window.ResourceSystem?.afflictionBonusesForTag(dmgTag);
    deps.tickCreatureLungeTrail?.(c, stepPx, afflictionBonuses);
    deps.tickCreatureFootsteps?.(c, stepPx);
    if (c._banditLungeT <= 0) { c._banditLunging = false; c._banditLungeHopCurrent = 0; }
    return true;
  }

  function fireBanditComboStep(c, def, loadout, targetPlayer) {
    const comboData = window.Combat?.comboData;
    const steps = comboData?.[loadout.tap1];
    if (!steps || !steps.length) return false;
    // Preserve the selected index before advancing, matching the player
    // combo path. comboData's pitch array is updated in place by
    // applyComboConfig, so the loaded attack-values config remains the
    // authority for bandit mirrors of either combo family too.
    const comboStep = c._banditComboIndex % steps.length;
    const step = steps[comboStep];
    const configuredPitch = comboData.sfxPitchByStep?.[comboStep];
    const sfxPitch = Number.isFinite(configuredPitch) && configuredPitch > 0 ? configuredPitch : undefined;
    const isFinalStep = comboStep === steps.length - 1;
    // Landed-step tally for this combo cycle, reset at the opening step
    // -- see banditRetreatDurationS, which uses it to size the eventual
    // retreat to how much of the combo actually connected.
    if (comboStep === 0) c._banditComboLandCount = 0;
    c._banditComboIndex++;
    const base = banditAttackBaseline(def);
    const damage = Math.max(1, Math.round(base.damage * step.damageMul));
    // combat-combo.js's own RANGE_SCALE (0.6) shrinks the raw
    // rangeMul-scaled cone down from what "read as oversized in
    // practice" for the player -- omitting it here would give bandits a
    // ~67% bigger hit cone than the identical player attack.
    const rangePx = base.rangePx * step.rangeMul * (comboData.RANGE_SCALE ?? 1);
    const halfConeRad = step.halfConeDeg * Math.PI / 180;
    const knockbackPxS = base.knockbackPxS * step.knockbackMul;
    const aimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    c.facing = aimAngle;
    c._banditAimPitch = window.Combat?.meleeAimSolution?.(c, targetPlayer, aimAngle, 0)?.pitch || 0; // Used by this enemy's leap, 3D hit cone, and pitched trail. // lunge direction locks off c.facing -- must be fresh, not last frame's
    c.telegraphState = 'windup';
    c._banditSwingAnim = step.anim; c._banditSwingPose = step.pose || null;
    c._banditSwingDirSign = step.dirSign || 1; c._banditSwingPower = step.power || 1;
    beginBanditLunge(c, deps.TILE * (step.lungeMul || 1) * (comboData?.LUNGE_SCALE || 1.5), step.windupS + step.strikeS, { rangePx, halfConeRad }, targetPlayer);
    // Tracked so onComplete below can tell a whiff from a landed hit --
    // a bandit should only break off (retreat) on a miss or after
    // landing its 3rd/final step, never after landing steps 1-2, which
    // should chain straight into the next step instead.
    let comboStepHit = false;
    c._banditAction = window.Combat.beginStagedAction({
      windupS: step.windupS, strikeS: step.strikeS, recoverS: 0,
      // isBandit -- see cancelAllStaged's own comment: without this tag
      // deps.damagePlayer's stagger-on-hit call cancels EVERY staged action
      // in the shared registry, including THIS one, the instant its own
      // onStrike lands (deps.damagePlayer runs synchronously from inside the
      // onStrike below) -- self-cancelling mid-strike, every time, on
      // every bandit that actually connects. onCancel only clears the
      // swing pose (finishBanditAction), never sets attackCooldownT or
      // (on the final combo step) retreatT/resets comboIndex -- a
      // landing bandit attack was silently skipping its own cooldown
      // and never retreating after its 3-hit combo.
      data: { isBandit: true, comboId: loadout.tap1, comboStep, sfxPitch },
      onStrike: () => {
        c.telegraphState = 'strike';
        // c.facing, not the fire-time aimAngle local -- see
        // updateBanditLunge's homing comment.
        spawnBanditTrailArc(c, rangePx, halfConeRad, c.facing);
        if (window.Combat?.meleeHit?.(c, targetPlayer, { rangePx, halfConeRad, yaw: c.facing, pitch: c._banditAimPitch || 0 })) {
          comboStepHit = true;
          c._banditComboLandCount = (c._banditComboLandCount || 0) + 1;
          // def.attackTag (the bandit's actual rolled weapon material,
          // see weaponDamageTypeForTool/weapon.dmgType) determines both
          // the affliction dealt and the impact sound -- matches the
          // player's own combat-combo.js fix, which no longer tags a
          // swing by combo family (sweep=blunt/thrust=sharp) regardless
          // of the equipped weapon's real material.
          deps.damagePlayer(damage, c.x, c.y, knockbackPxS, { tag: def.attackTag, afflictionBonuses: window.ResourceSystem?.afflictionBonusesForTag(def.attackTag) });
          window.AudioSystem?.playWeaponHitSfx(def.attackTag, c.x, c.y, c.areaId, sfxPitch, ['small', 'medium', 'large'][comboStep]);
        }
      },
      onComplete: () => {
        finishBanditAction(c);
        // Break off on a miss (whiffing a swing isn't worth pressing
        // through) or after landing the final step -- a landed step
        // 1-2 chains straight into the next step instead of retreating.
        const shouldRetreat = isFinalStep || !comboStepHit;
        c.attackCooldownT = shouldRetreat ? def.attackCooldownS : BANDIT_COMBO_CHAIN_GAP_S;
        if (shouldRetreat) {
          c.retreatT = banditRetreatDurationS((c._banditComboLandCount || 0) / steps.length);
          c._banditComboIndex = 0;
          c._banditComboLandCount = 0;
        }
      },
      onCancel: () => finishBanditAction(c),
    });
    return true;
  }

  function fireBanditQuickAttack(c, def, loadout, targetPlayer) {
    const qa = window.Combat?.quickAttackData;
    const techDef = qa?.TECHNIQUES?.[loadout.tap2];
    if (!techDef) return false;
    const cond = banditQuickAttackConditions(c, targetPlayer);
    const tech = window.Combat.buildQuickAttack(techDef, cond);
    const base = banditAttackBaseline(def);
    const damage = Math.max(1, Math.round(base.damage * tech.damageMul));
    // combat-quickattacks.js's own RANGE_SCALE (0.6) shrinks the raw
    // rangeMul-scaled cone -- see the matching comment in
    // fireBanditComboStep, same "read as oversized" fix applies here.
    const rangePx = base.rangePx * tech.rangeMul * (qa.RANGE_SCALE ?? 1);
    const halfConeRad = tech.halfConeDeg * Math.PI / 180;
    const knockbackPxS = base.knockbackPxS * tech.knockbackMul;
    const aimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    c.facing = aimAngle;
    c._banditAimPitch = window.Combat?.meleeAimSolution?.(c, targetPlayer, aimAngle, 0)?.pitch || 0; // Used by this enemy's leap, 3D hit cone, and pitched trail.
    c.telegraphState = 'windup';
    c._banditSwingAnim = 'thrust'; c._banditSwingPose = null;
    c._banditSwingDirSign = 1; c._banditSwingPower = 1;
    beginBanditLunge(c, deps.TILE * (qa.LUNGE_TILE_MUL || 5.5), qa.WINDUP_S + qa.STRIKE_S, { rangePx, halfConeRad }, targetPlayer);
    let techHit = false;
    c._banditAction = window.Combat.beginStagedAction({
      windupS: qa.WINDUP_S, strikeS: qa.STRIKE_S, recoverS: 0,
      data: { isBandit: true }, // see fireBanditComboStep's matching comment
      onStrike: () => {
        c.telegraphState = 'strike';
        // c.facing, not the fire-time aimAngle local -- see
        // updateBanditLunge's homing comment.
        spawnBanditTrailArc(c, rangePx, halfConeRad, c.facing);
        // def.attackTag (the bandit's real weapon material) determines
        // both the affliction and the impact sound -- see
        // combat-quickattacks.js's onTap, which no longer hardcodes
        // 'sharp' regardless of the equipped weapon either.
        if (window.Combat?.meleeHit?.(c, targetPlayer, { rangePx, halfConeRad, yaw: c.facing, pitch: c._banditAimPitch || 0 })) {
          techHit = true;
          deps.damagePlayer(damage, c.x, c.y, knockbackPxS, { tag: def.attackTag, afflictionBonuses: window.ResourceSystem?.afflictionBonusesForTag(def.attackTag) });
          window.AudioSystem?.playWeaponHitSfx(def.attackTag, c.x, c.y, c.areaId, undefined, tech.sourceText === 'no condition bonus' ? 'small' : 'huge');
        }
      },
      onComplete: () => {
        finishBanditAction(c);
        c.attackCooldownT = def.attackCooldownS;
        c.retreatT = banditRetreatDurationS(techHit ? 1 : 0);
        c._banditComboIndex = 0;
      },
      onCancel: () => finishBanditAction(c),
    });
    return true;
  }

  function fireBanditChargedBreaker(c, def, targetPlayer) {
    const cb = window.Combat?.chargedBreakerData;
    if (!cb) return false;
    const chargeT = 0.5 + deps.rnd() * 0.5; // a bandit always "holds" for a decent charge, no button to under-hold
    const base = banditAttackBaseline(def);
    const damage = Math.max(1, Math.round(base.damage * (cb.DAMAGE_MUL_MIN + (cb.DAMAGE_MUL_MAX - cb.DAMAGE_MUL_MIN) * chargeT)));
    const rangePx = base.rangePx * (cb.RANGE_MUL_MIN + (cb.RANGE_MUL_MAX - cb.RANGE_MUL_MIN) * chargeT);
    const halfConeRad = cb.HALF_CONE_DEG * Math.PI / 180;
    const knockbackPxS = base.knockbackPxS * (cb.KNOCKBACK_MUL_MIN + (cb.KNOCKBACK_MUL_MAX - cb.KNOCKBACK_MUL_MIN) * chargeT);
    const aimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    c.facing = aimAngle;
    c._banditAimPitch = window.Combat?.meleeAimSolution?.(c, targetPlayer, aimAngle, 0)?.pitch || 0; // Used by this enemy's leap, 3D hit cone, and pitched trail.
    c.telegraphState = 'windup';
    // Charged Breaker always plays the sweep pose regardless of the
    // equipped weapon's own style (see combat-charged-breaker.js).
    c._banditSwingAnim = 'sweep'; c._banditSwingPose = window.Combat?.poses?.SWEEP_POSE;
    c._banditSwingDirSign = 1; c._banditSwingPower = cb.POWER || 1.7;
    // Real chargedBreaker.js only lunges during the strike (a separate,
    // windupS:0 staged action started once the hold is released) --
    // simplified here to span the bandit's own whole windup+strike
    // instead: ease-out is front-loaded (fastest right at the start),
    // so ticking updateBanditLunge across the full action still closes
    // most of the distance well before onStrike's hit-check fires at
    // the windup->strike boundary, without needing a second staged
    // action just to match the real system's exact timing split.
    beginBanditLunge(c, deps.TILE * (cb.LUNGE_TILE_MUL || 2.0), cb.WINDUP_S + cb.STRIKE_S, { rangePx, halfConeRad }, targetPlayer);
    let techHit = false;
    c._banditAction = window.Combat.beginStagedAction({
      windupS: cb.WINDUP_S, strikeS: cb.STRIKE_S, recoverS: 0,
      data: { isBandit: true }, // see fireBanditComboStep's matching comment
      onStrike: () => {
        c.telegraphState = 'strike';
        // c.facing, not the fire-time aimAngle local -- see
        // updateBanditLunge's homing comment.
        spawnBanditTrailArc(c, rangePx, halfConeRad, c.facing);
        // def.attackTag (bandit's real weapon material) drives both the
        // affliction and the impact sound -- see combat-charged-
        // breaker.js's matching fix (no longer hardcodes 'blunt').
        if (window.Combat?.meleeHit?.(c, targetPlayer, { rangePx, halfConeRad, yaw: c.facing, pitch: c._banditAimPitch || 0 })) {
          techHit = true;
          deps.damagePlayer(damage, c.x, c.y, knockbackPxS, { tag: def.attackTag, heavy: true, afflictionBonuses: window.ResourceSystem?.afflictionBonusesForTag(def.attackTag) });
          window.AudioSystem?.playWeaponHitSfx(def.attackTag, c.x, c.y, c.areaId, undefined, 'huge');
        }
      },
      onComplete: () => {
        finishBanditAction(c);
        c.attackCooldownT = def.attackCooldownS;
        c.retreatT = banditRetreatDurationS(techHit ? 1 : 0);
        c._banditComboIndex = 0;
        c._banditHold1CdT = BANDIT_HOLD1_COOLDOWN_S;
      },
      onCancel: () => finishBanditAction(c),
    });
    return true;
  }

  // Captain-only, hold2. Not a held button either -- a periodic timed
  // window instead: while `_banditGuardUntil` is in the future, an
  // incoming hit (see damageCreature's isBandit branch) is reduced and
  // answered with a real Counter Shield riposte using the exact damage/
  // range/cone multipliers combat-counter-shield.js's own riposte uses.
  function updateBanditGuardWindow(c, dt) {
    if (c._banditGuardUntil > 0) { if (performance.now() >= c._banditGuardUntil) c._banditGuardUntil = 0; return; }
    c._banditGuardCdT = Math.max(0, (c._banditGuardCdT || 0) - dt);
    if (c._banditGuardCdT <= 0) { c._banditGuardUntil = performance.now() + BANDIT_GUARD_WINDOW_S * 1000; c._banditGuardCdT = BANDIT_GUARD_COOLDOWN_S; }
  }

  function fireBanditCounterRiposte(c, def, targetPlayer) {
    const cs = window.Combat?.counterShieldData;
    if (!cs) return;
    const base = banditAttackBaseline(def);
    const damage = Math.max(1, Math.round(base.damage * cs.COUNTER_DAMAGE_MUL));
    const rangePx = base.rangePx * cs.COUNTER_RANGE_MUL;
    const halfConeRad = cs.COUNTER_HALF_CONE_DEG * Math.PI / 180;
    const knockbackPxS = base.knockbackPxS * cs.COUNTER_KNOCKBACK_MUL;
    const aimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    const aimPitch = window.Combat?.meleeAimSolution?.(c, targetPlayer, aimAngle, 0)?.pitch || 0; // Used by the counter's 3D cone and ribbon.
    // Deliberately doesn't touch c._banditAction (a captain can be
    // mid-combo when guarded damage triggers this) or c._banditSwing* --
    // the riposte's own 0.2s swing is brief enough that skipping its
    // dedicated weapon-pose animation (rather than adding a second
    // parallel progress channel just for this) is an acceptable gap.
    window.Combat.beginStagedAction({
      windupS: 0.05, strikeS: 0.15, recoverS: 0,
      data: { isBandit: true }, // see fireBanditComboStep's matching comment
      onStrike: () => {
        // def.attackTag (bandit's real weapon material) drives both the
        // affliction and the impact sound -- matches
        // combat-counter-shield.js's own riposte fix (no longer
        // hardcodes 'sharp' regardless of weapon).
        spawnBanditTrailArc(c, rangePx, halfConeRad, aimAngle, aimPitch);
        if (window.Combat?.meleeHit?.(c, targetPlayer, { rangePx, halfConeRad, yaw: aimAngle, pitch: aimPitch })) {
          deps.damagePlayer(damage, c.x, c.y, knockbackPxS, { tag: def.attackTag, afflictionBonuses: window.ResourceSystem?.afflictionBonusesForTag(def.attackTag) });
          window.AudioSystem?.playWeaponHitSfx(def.attackTag, c.x, c.y, c.areaId, undefined, 'large');
        }
      },
    });
  }

  // "Choose an attack, then judge how close to get" -- gates the
  // approach on whichever combo step is actually about to fire
  // (c._banditComboIndex), not always step 0 -- later steps in a chain
  // often have a noticeably shorter lunge (see SWING_STEPS/POKE_STEPS:
  // step 0 is lungeMul 2.0, steps 1-2 are 1.0), so gating on step 0's
  // bigger number let a bandit commit to swing 2/3 from farther than
  // that step's own lunge could actually close.
  //
  // This used to also take the MAX reach across quickAttack/
  // chargedBreaker on top of combo, on the theory that combo's own
  // current-step reach (rangePx + its FULL lunge budget) is always the
  // smallest of the three since quickAttack/chargedBreaker both have a
  // much bigger raw lunge budget (quick attack's LUNGE_TILE_MUL alone
  // is 5.5 tiles, ~300px vs combo's ~115-195px). That's true of the
  // raw budget, but false of how much of it is actually COVERED by
  // onStrike time: onStrike fires at windupS elapsed, not the lunge's
  // full windupS+strikeS duration, and the ease-out curve is front-
  // loaded, so what matters is windupS as a FRACTION of the whole
  // duration -- a combo step's windupS is typically 55-77% of its
  // total (leaving little of the ease curve uncovered by strike time),
  // while quick attacks share one WINDUP_S/STRIKE_S pair that's only
  // ~42% of their own total. A quick attack's bigger raw budget times
  // a smaller covered fraction can net out SHORTER, by strike time,
  // than combo's smaller budget times its bigger covered fraction --
  // confirmed live: quick attacks committing from the combo-gated
  // ~150-200px range were consistently whiffing 10-50px short, while
  // combo steps from the same gate landed cleanly. banditLungeEaseAtStrike
  // below computes that covered fraction so this can take the real
  // minimum SAFE reach across every ability that could actually fire
  // this cycle, instead of assuming combo's is automatically smallest.
  function banditLungeEaseAtStrike(windupS, strikeS) {
    const total = windupS + strikeS;
    if (total <= 0) return 1;
    const t = Math.min(1, windupS / total);
    return 1 - Math.pow(1 - t, 3);
  }
  // The max currentDist an ability can safely COMMIT from and still
  // land, given only `eased` of its lunge budget is covered by strike
  // time. beginBanditLunge caps the actual travel to (currentDist -
  // haltDist) whenever that's less than the raw budget, so at strike
  // time the bandit sits at currentDist - (currentDist-haltDist)*eased.
  // Solving currentDist - (currentDist-haltDist)*eased <= rangePx for
  // currentDist gives the bound below -- NOT rangePx + budget*eased,
  // which was tried first and is still too generous (confirmed live:
  // quick attacks kept committing from ~150-200px and landing 5-20px
  // short even after that "fix") because it ignores that the UNCOVERED
  // fraction (1-eased) applies to currentDist itself, which grows
  // right along with how far the bandit is allowed to commit from.
  function banditAbilitySafeReachPx(rangePx, lungeBudgetPx, windupS, strikeS) {
    const eased = banditLungeEaseAtStrike(windupS, strikeS);
    if (eased >= 0.999) return rangePx + lungeBudgetPx;
    const haltDist = rangePx * BANDIT_LUNGE_HALT_MARGIN;
    const safeReach = (rangePx - haltDist * eased) / (1 - eased);
    // Can't exceed what's physically reachable if the raw budget ends
    // up being the binding cap instead (a small lungeMul ability).
    return Math.max(rangePx, Math.min(safeReach, haltDist + lungeBudgetPx));
  }
  function banditEngagementReachPx(c, def, loadout, targetPlayer) {
    const base = banditAttackBaseline(def);
    let reach = base.rangePx;
    const combo = window.Combat?.comboData;
    const steps = combo?.[loadout.tap1];
    if (steps?.length) {
      const step = steps[(c._banditComboIndex || 0) % steps.length];
      const comboRangePx = base.rangePx * step.rangeMul * (combo.RANGE_SCALE ?? 1);
      const comboLungePx = deps.TILE * (step.lungeMul || 1) * (combo.LUNGE_SCALE || 1.5);
      reach = banditAbilitySafeReachPx(comboRangePx, comboLungePx, step.windupS, step.strikeS);
    }
    // Quick attack (tap2) can fire on ANY cycle regardless of which
    // combo step is current (see updateBanditCombatAI's conditionFavorable
    // roll), so its own safe reach always constrains this gate too.
    const qa = window.Combat?.quickAttackData;
    const techDef = qa?.TECHNIQUES?.[loadout.tap2];
    if (techDef && targetPlayer) {
      const cond = banditQuickAttackConditions(c, targetPlayer);
      const tech = window.Combat.buildQuickAttack(techDef, cond);
      const qaRangePx = base.rangePx * tech.rangeMul * (qa.RANGE_SCALE ?? 1);
      const qaLungePx = deps.TILE * (qa.LUNGE_TILE_MUL || 5.5);
      reach = Math.min(reach, banditAbilitySafeReachPx(qaRangePx, qaLungePx, qa.WINDUP_S, qa.STRIKE_S));
    }
    // Charged Breaker (hold1) only ever fires as a fresh opener
    // (comboIndex 0) -- only worth constraining the gate for it when
    // that's actually possible this cycle.
    if ((c._banditComboIndex || 0) === 0 && loadout.hold1 === 'chargedBreaker') {
      const cb = window.Combat?.chargedBreakerData;
      if (cb) {
        // A bandit always "holds" for a decent charge (see
        // fireBanditChargedBreaker) -- a representative mid charge is
        // a reasonable stand-in for this gate's range/lunge.
        const chargeT = 0.75;
        const cbRangePx = base.rangePx * (cb.RANGE_MUL_MIN + (cb.RANGE_MUL_MAX - cb.RANGE_MUL_MIN) * chargeT);
        const cbLungePx = deps.TILE * (cb.LUNGE_TILE_MUL || 2.0);
        reach = Math.min(reach, banditAbilitySafeReachPx(cbRangePx, cbLungePx, cb.WINDUP_S, cb.STRIKE_S));
      }
    }
    return reach;
  }

  // ── Multi-attacker coordination ─────────────────────────────────
  //
  // At most BANDIT_MAX_ATTACK_SLOTS bandits are ever actively closing
  // to melee range against a given target at once, each locked to a
  // world angle (around the target) at least BANDIT_SLOT_MIN_ANGLE_RAD
  // from every other slot's angle -- so two attackers flank from
  // genuinely different sides instead of both approaching down the same
  // line. Everyone else stays queued: it orbits at a standoff distance
  // and keeps personal space from other nearby bandits rather than
  // piling into melee range for free hits. Slots aren't explicitly
  // handed back on retreat -- claimBanditAttackSlot's own prune (below)
  // drops a slot the instant its holder dies or leaves 'chase', which
  // covers every release case without needing a separate teardown path.
  const BANDIT_MAX_ATTACK_SLOTS = 2;
  const BANDIT_SLOT_MIN_ANGLE_RAD = 60 * Math.PI / 180;
  const BANDIT_STANDOFF_RANGE_MUL = 1.8;
  // Computed lazily (not a top-level const) since deps isn't populated
  // until init() runs, which happens well after this module's own script
  // loads.
  function banditPersonalSpacePx() { return deps.TILE * 0.85; }
  // Idle sway applied to a waiting bandit's ring/standoff point (see the
  // !readyToStrike branch below) -- a slow guard-stance shift, not a
  // dodge, so it reads as "still in the fight, waiting its turn"
  // instead of a dead stand while a slot/cooldown/stamina frees up.
  // Swept as an ANGLE around the player (see banditRingPoint), not a
  // straight-line Cartesian offset -- a linear offset from a point
  // already at some radius moves partly toward/away from the player as
  // well as sideways (chord vs. arc), and combined with the emergency
  // too-close retreat that branch used to also have (a second, separate
  // target formula it could disagree with frame to frame), that read as
  // shivering forward/backward rather than a clean side-to-side stride.
  // Sweeping the angle instead keeps the bandit on the ring at a
  // constant radius by construction; there's now only ONE positioning
  // formula for the whole waiting state (see readyToStrike below), with
  // the personal-space nudge as the only thing allowed to pull it off
  // the ring, and only when actually crowding another bandit.
  // Chased with BANDIT_STRAFE_SPEED_PX_S (a dedicated slow walking
  // speed), not def.chaseSpeed -- at full chase speed the bandit closes
  // most of the gap to this continuously-recalculated target in a
  // single frame and ends up snapping almost exactly onto it every
  // frame, which (deps.moveCreatureToward never overshoots, so it can't be a
  // bounce-back oscillation) just means any frame-timing irregularity
  // gets reproduced directly in its position with no damping. Capping
  // the speed well below the sway's own peak velocity forces a real lag
  // between the bandit and its target, acting as a low-pass filter.
  const BANDIT_STRAFE_ANGLE_AMPLITUDE_RAD = 30 * Math.PI / 180;
  const BANDIT_STRAFE_HZ = 0.14;
  const BANDIT_STRAFE_SPEED_PX_S = 55;
  const _banditAttackSlots = []; // [{ bandit, angle }]

  function claimBanditAttackSlot(c, towardAngle) {
    for (let i = _banditAttackSlots.length - 1; i >= 0; i--) {
      const s = _banditAttackSlots[i];
      if (s.bandit.health <= 0 || s.bandit.state !== 'chase') _banditAttackSlots.splice(i, 1);
    }
    const existing = _banditAttackSlots.find(s => s.bandit === c);
    if (existing) return existing;
    if (_banditAttackSlots.length >= BANDIT_MAX_ATTACK_SLOTS) return null;
    let angle = towardAngle;
    for (const s of _banditAttackSlots) {
      if (Math.abs(deps.angleDiff(angle, s.angle)) < BANDIT_SLOT_MIN_ANGLE_RAD) angle = s.angle + Math.PI;
    }
    const slot = { bandit: c, angle };
    _banditAttackSlots.push(slot);
    return slot;
  }

  // Queued (non-slot-holding) bandits used to all share one single
  // standoff ring, relying entirely on banditPersonalSpaceAdjust to
  // keep them apart -- fine for 2-3 spares, but a bigger gang (up to
  // gruntsMax+lieutenantsMax+1 per bandit-gang-config.json) packs
  // everyone onto that one ring at once. Spreads them across multiple
  // concentric rings instead, BANDIT_QUEUE_RING_CAPACITY bandits per
  // ring before the next one queues onto a ring further out (see
  // BANDIT_QUEUE_RING_STEP_MUL, applied in the !readyToStrike branch).
  // Mirrors claimBanditAttackSlot's own prune/persist pattern -- a
  // bandit keeps its ring+angle once assigned rather than being
  // reshuffled every frame, which also fixes queued bandits' ring point
  // otherwise recomputing at a fresh towardAngle every single frame
  // (jittering with the player's/bandit's own minor position noise).
  const BANDIT_QUEUE_RING_CAPACITY = 3;
  const BANDIT_QUEUE_RING_STEP_MUL = 0.6;
  const _banditQueueRings = []; // [{ bandit, ringIndex, angle }]

  function claimBanditQueueRing(c, towardAngle) {
    for (let i = _banditQueueRings.length - 1; i >= 0; i--) {
      const q = _banditQueueRings[i];
      if (q.bandit.health <= 0 || q.bandit.state !== 'chase') _banditQueueRings.splice(i, 1);
    }
    const existing = _banditQueueRings.find(q => q.bandit === c);
    if (existing) return existing;
    const countByRing = [];
    for (const q of _banditQueueRings) countByRing[q.ringIndex] = (countByRing[q.ringIndex] || 0) + 1;
    let ringIndex = 0;
    while ((countByRing[ringIndex] || 0) >= BANDIT_QUEUE_RING_CAPACITY) ringIndex++;
    // Spread bandits already on this same ring apart by angle -- not a
    // hard minimum-separation lock like attack slots (queue rings don't
    // need that guarantee), just an even starting spacing so a ring
    // doesn't spawn its members all bunched at the same bearing.
    const onRing = _banditQueueRings.filter(q => q.ringIndex === ringIndex);
    const slice = Math.PI * 2 / (BANDIT_QUEUE_RING_CAPACITY + 1);
    let angle = towardAngle;
    for (const q of onRing) {
      if (Math.abs(deps.angleDiff(angle, q.angle)) < slice) angle += slice;
    }
    const rec = { bandit: c, ringIndex, angle };
    _banditQueueRings.push(rec);
    return rec;
  }

  // A point on a ring of the given radius around the target, at the
  // given world angle -- moving toward this (rather than straight at
  // the target) is what actually draws a bandit around to its assigned
  // flank/standoff side as it closes in, instead of just walking the
  // direct line and hoping the angle check above sorts itself out.
  function banditRingPoint(targetPlayer, angle, radiusPx) {
    return { x: targetPlayer.x + Math.cos(angle) * radiusPx, y: targetPlayer.y + Math.sin(angle) * radiusPx };
  }

  // Nudges a movement target away from any other live bandit closer
  // than BANDIT_PERSONAL_SPACE_PX -- keeps queued gang-mates from
  // stacking on each other while they wait for an attack slot.
  function banditPersonalSpaceAdjust(c, point) {
    let px = point.x, py = point.y;
    const personalSpacePx = banditPersonalSpacePx();
    for (const o of deps.hostileObjects) {
      if (o === c || !o.isBandit || o.health <= 0) continue;
      const dx = px - o.x, dy = py - o.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.001 && dist < personalSpacePx) {
        const push = personalSpacePx - dist;
        px += (dx / dist) * push; py += (dy / dist) * push;
      }
    }
    return { x: px, y: py };
  }

  // A bandit's own rough body radius plus the player's (deps.PLAYER_RADIUS) --
  // the minimum center-to-center distance bandit movement is allowed to
  // close to, enforced unconditionally (including mid-lunge and mid-
  // swing, see updateBanditCombatAI/updateBanditLunge). This used to
  // assume every bandit ability's own rangePx was comfortably bigger
  // than this radius (~32.6px) -- false after combat-combo.js's
  // RANGE_SCALE (0.6) shrunk the real hit cones down: Forehand Swing's
  // rangePx is ~29.7px and Backhand Swing's ~31.2px, BOTH already
  // smaller than this floor, so the push was pinning distance at 32.6px
  // and making those two attacks geometrically impossible to land no
  // matter how well aimed (confirmed live: dist=32.6 on repeated
  // Forehand Swing whiffs). enforceBanditPlayerCollision now caps its
  // own push radius to the active attack's real range (via
  // c._banditLungeHitTest) so this anti-clip floor can never itself
  // exceed what that attack needs to reach.
  // Computed lazily (not a top-level const) since deps isn't populated until
  // init() runs, which happens well after this module's own script loads.
  function banditPlayerCollisionRadiusPx() { return deps.PLAYER_RADIUS + deps.TILE * 0.32; }
  function enforceBanditPlayerCollision(c, targetPlayer) {
    // Also constrained through the brief inter-step gap of an active
    // combo (comboIdx > 0, both this step's lunge and its staged action
    // already finished, but the next step is about to fire within
    // BANDIT_COMBO_CHAIN_GAP_S) -- without this, the instant a landed
    // step's own action completed, this fell back to the full uncapped
    // floor and physically snapped the bandit back out from wherever it
    // had just landed (often well under the floor) to the full 32.6px
    // right before the next combo step fired, pushing steps with a
    // real range near that floor (e.g. Backhand Swing, ~31.2px) outside
    // their own reach for a hit that should have connected (confirmed
    // live: Backhand Swing whiffing at dist=38.7/84.3px immediately
    // after the preceding Forehand Swing landed well inside range).
    const midComboGap = c._banditComboIndex > 0 && !c._banditLunging && !c._banditAction;
    const activeHitTest = (c._banditLunging || c._banditAction || midComboGap) ? c._banditLungeHitTest : null;
    const collisionRadiusPx = banditPlayerCollisionRadiusPx();
    const radiusPx = activeHitTest
      ? Math.min(collisionRadiusPx, activeHitTest.rangePx * BANDIT_LUNGE_HALT_MARGIN)
      : collisionRadiusPx;
    const dx = c.x - targetPlayer.x, dy = c.y - targetPlayer.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= radiusPx || dist < 0.001) return;
    const push = radiusPx - dist;
    const nx = dx / dist, ny = dy / dist;
    const desiredX = c.x + nx * push, desiredY = c.y + ny * push;
    if (deps.creatureCanEnterTile(c.def, desiredX, c.y)) c.x = desiredX;
    if (deps.creatureCanEnterTile(c.def, c.x, desiredY)) c.y = desiredY;
  }

  // Called from updateHostiles' chase-state branch in place of the
  // plain bite-telegraph/behaviorStage machinery for any c.isBandit.
  // Neck-turn "look at target" glance for a bandit's own portrait plane
  // (see buildBanditAvatar's neckJoint) — mirrors the dialogue system's
  // faceNpcDialogueParticipants (game.js), which drives an NPC walker's
  // neckJoint by the residual angle still remaining between its coarse,
  // deadzone-clamped body facing and the true target angle. A bandit's
  // visible plane facing goes through that exact same deadzone (see
  // updateCreatureMesh's CREATURE_PLANE_ROT_MODE snap/sway/halt), so
  // without a head glance it only ever visibly faces one of a handful of
  // camera-relative directions -- the neck bone fills in the rest,
  // reading as "eyes on you" even mid-windup/retreat when c.facing itself
  // is pointed somewhere else for gameplay reasons.
  const BANDIT_NECK_LOOK_MAX_YAW_DEG = 30;
  const BANDIT_NECK_LOOK_TURN_SPEED_DEG = 260;
  const BANDIT_NECK_LOOK_RAD = Math.PI / 180;

  function _updateBanditNeckYaw(c, targetDeg, dt) {
    const neck = c.avatarRef?.neckJoint;
    if (!neck?.front || !neck?.back) return;
    const state = c._banditNeckYaw || (c._banditNeckYaw = { currentDeg: 0 });
    const clampedTarget = Math.max(-BANDIT_NECK_LOOK_MAX_YAW_DEG, Math.min(BANDIT_NECK_LOOK_MAX_YAW_DEG, Number(targetDeg) || 0));
    const step = BANDIT_NECK_LOOK_TURN_SPEED_DEG * Math.max(0, Number(dt) || 0);
    const diff = clampedTarget - state.currentDeg;
    state.currentDeg += Math.max(-step, Math.min(step, diff));
    // Front and back share the same sign here, not mirrored -- unlike an
    // in-plane roll (which reverses handedness under the back card's own
    // ±90°-opposite baseline rotation), a yaw around the shared world-
    // vertical axis reads the same real-world direction on both cards
    // regardless of that baseline difference, so mirroring the sign here
    // would turn the two cards away from each other instead of in tandem.
    neck.front.rotation.y = state.currentDeg * BANDIT_NECK_LOOK_RAD;
    neck.back.rotation.y = state.currentDeg * BANDIT_NECK_LOOK_RAD;
  }

  // Eases the neck glance back to center — called from game.js's hostile
  // loop whenever this bandit isn't actively chasing (updateCombatAI, and
  // therefore _updateBanditLookAtTarget, only ever runs during 'chase').
  function restNeckLook(c, dt) {
    _updateBanditNeckYaw(c, 0, dt);
    c._lookAtDebug = null;
  }

  function _updateBanditLookAtTarget(c, dt, targetPlayer) {
    if (!targetPlayer || targetPlayer.health <= 0) { restNeckLook(c, dt); return; }
    const rawAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    const residualRad = deps.angleDiff(rawAngle, c.facing || 0); // How far the target sits from wherever this bandit's body/plane is currently facing.
    _updateBanditNeckYaw(c, residualRad * 180 / Math.PI, dt);
    // Feeds the "Show Interaction Raycast" debug overlay (see
    // debug-hitboxes.js) — approximates this bandit's own head height off
    // its shared window.CreatureHeadCache entry (built for animal-shaped
    // avatarRefs, but its fallbacks degrade gracefully for a bandit's own
    // portrait-plane avatarRef too).
    const selfHead = window.CreatureHeadCache?.getHeadWorld(c, 'animal');
    const targetHead = deps.getPlayerFaceTarget?.();
    if (selfHead && targetHead) {
      c._lookAtDebug = {
        head: { x: c.x / deps.TILE, y: selfHead.worldY, z: c.y / deps.TILE },
        target: { x: targetHead.x / deps.TILE, y: targetHead.worldY, z: targetHead.y / deps.TILE },
      };
    }
  }

  function updateBanditCombatAI(c, dt, targetPlayer, distToPlayer) {
    const def = c.def, loadout = def.banditAbilityLoadout;
    _updateBanditLookAtTarget(c, dt, targetPlayer);
    const towardAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    const rangedResult = window.RangedWeapons?.updateBanditAI?.(c, dt, targetPlayer, distToPlayer);
    if (rangedResult?.handled) return rangedResult;
    if (c._banditHold1CdT > 0) c._banditHold1CdT = Math.max(0, c._banditHold1CdT - dt);
    if (loadout.hold2 === 'counterShield') updateBanditGuardWindow(c, dt);
    // Unconditional now (was only called from the engaged branch below,
    // skipped while lunging/mid-swing) -- see BANDIT_PLAYER_COLLISION_RADIUS_PX.
    // Covers the retreat/busy states below too: a stationary swinging
    // bandit should still get pushed off if the player walks into it,
    // even though it isn't the one closing the distance.
    enforceBanditPlayerCollision(c, targetPlayer);
    if (updateBanditLunge(c, dt, targetPlayer)) return { aimAngle: c.facing, moving: true };
    if (c.retreatT > 0) {
      c.retreatT = Math.max(0, c.retreatT - dt);
      const awayAng = towardAngle + Math.PI;
      const moving = deps.moveCreatureToward(c, c.x + Math.cos(awayAng) * deps.TILE, c.y + Math.sin(awayAng) * deps.TILE, deps.JUMP_BACK_SPEED, dt);
      return { aimAngle: towardAngle, moving };
    }
    if (c._banditAction) {
      // Keep tracking the target's CURRENT position with c.facing for
      // the rest of the windup/strike, even after updateBanditLunge's
      // own translational movement already halted (see its own
      // halt-margin comment). The real hit-check (fireBandit*'s
      // onStrike) fires later and reads whatever c.facing is AT THAT
      // MOMENT, but nothing kept re-aiming it once the lunge stopped
      // moving early -- which happens routinely, e.g. a bandit that
      // was already near point-blank when it committed to a short step
      // like Forehand Swing halts its lunge almost immediately, then
      // stood frozen facing a stale angle for the rest of the ~0.3s
      // windup+strike with zero further correction. A player free to
      // sidestep, unopposed, for that whole remaining window slips
      // outside even a short-range cone without ever looking like they
      // dodged anything -- a whiff that reads as "missed at point-blank
      // range" in a combat log.
      if (targetPlayer.health > 0) {
        const desiredFacing = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
        const homingT = Math.min(1, BANDIT_LUNGE_HOMING_RATE * dt);
        c.facing += deps.angleDiff(desiredFacing, c.facing) * homingT;
        const aimed = window.Combat?.meleeAimSolution?.(c, targetPlayer, c.facing, c._banditAimPitch || 0);
        if (aimed) c._banditAimPitch += (aimed.pitch - (c._banditAimPitch || 0)) * homingT;
      }
      return { aimAngle: c.facing, moving: false };
    }

    // banditPersonalSpaceAdjust only nudges a MOVEMENT TARGET away from
    // other bandits -- once a bandit is "in range" (below) it stops
    // approaching entirely and just holds position to fight, so with
    // nothing else keeping them apart a fast-moving player can walk two
    // stationary attackers onto the exact same tile as each other.
    // Applied every frame regardless of engage/queued state. Player
    // separation is handled separately, unconditionally at the top of
    // this function, by enforceBanditPlayerCollision -- that one's a hard positional
    // deps.clamp (the player has no "movement target" a bandit could aim
    // short of), this one only ever nudges where a bandit is walking
    // toward, never teleports it.
    const unstack = banditPersonalSpaceAdjust(c, { x: c.x, y: c.y });
    if (Math.hypot(unstack.x - c.x, unstack.y - c.y) > 1) deps.moveCreatureToward(c, unstack.x, unstack.y, def.moveSpeed, dt);

    const engageRangePx = banditEngagementReachPx(c, def, loadout, targetPlayer);
    const slot = claimBanditAttackSlot(c, towardAngle);
    // attackCooldownS (0.95-1.15s) runs noticeably longer than the
    // post-attack retreat step (deps.JUMP_BACK_DUR_S, 0.4s), and retreating
    // only backs up one tile -- well short of engageRangePx once lunge
    // distance is folded in -- so a bandit reliably lands back here
    // still "in range" with real cooldown left on the clock. Gating on
    // cooldown/stamina here alongside range/slot (instead of after, as
    // its own dead-stop return) means that remaining wait is spent the
    // same way "still closing" is: holding/adjusting its ring position
    // and tracking the player, instead of a frozen no-op stand -- this
    // was the actual source of the awkward post-attack pause, not any
    // missing animation. Wildlife's own chase branch never has this gap
    // since it keeps calling deps.moveCreatureToward every frame regardless
    // of its own attackCooldownT.
    // A continuing combo step (comboIdx > 0, already mid-flurry after
    // landing/chaining a prior step -- see fireBanditComboStep's
    // shouldRetreat, which only resets comboIdx to 0 on a miss or the
    // final step) skips the hard stamina gate an opening attack still
    // needs. attackStaminaCost is a flat per-swing cost (e.g. 12)
    // steep against bandits' small stamina pools (16-46 depending on
    // rank/tier), so requiring a full recharge before EVERY step of an
    // already-landing 3-hit combo dropped the bandit out of "ready"
    // between steps into the ring-strafe waiting branch below for up
    // to ~1.5s -- a big, awkward pause with a lot of visible movement
    // mid-combo even while the combo was actively landing.
    // spendStamina below already lets an overspend go into Exhausted
    // debt instead of hard-refusing (see resource-system.js's own
    // "Overspending Stamina never blocks the action" comment) -- this
    // just lets a continuing combo step use that same path instead of
    // hard-blocking on it first, matching how the player's own combo
    // (combat-combo.js) spends stamina unconditionally per step rather
    // than pre-checking it.
    const continuingCombo = c._banditComboIndex > 0;
    const readyToStrike = distToPlayer <= engageRangePx && !!slot && c.attackCooldownT <= 0
      && (continuingCombo || c.stamina >= def.attackStaminaCost) && !deps.isCreatureSwimming(c);
    if (!readyToStrike) {
      // One unified ring formula for the whole waiting state (slot-
      // holder-on-cooldown, stamina-short, or genuinely queued alike),
      // instead of a separate too-close emergency retreat and a
      // separate ring/standoff target that could disagree frame to
      // frame about where the bandit should be -- see the comment on
      // BANDIT_STRAFE_ANGLE_AMPLITUDE_RAD for why that disagreement was
      // reading as forward/backward shivering. baseAngle sweeps with the
      // idle sway (a slot holder swings around its locked flank angle; a
      // queued bandit around its own claimed queue-ring angle -- see
      // claimBanditQueueRing, spreading a big gang's spares across
      // several concentric rings instead of packing them all onto one)
      // and baseRadius is clamped to never sit inside melee range even
      // if engageRangePx*0.85/1.8 would otherwise put it there (a
      // crowded arena's personal-space pushes can shove the "supposed
      // to be far enough out" ring/flank point closer than intended).
      const queueRing = slot ? null : claimBanditQueueRing(c, towardAngle);
      const baseAngle = slot ? slot.angle : (queueRing ? queueRing.angle : towardAngle);
      const baseRadius = Math.max(
        def.attackRangePx * 1.5,
        slot
          ? engageRangePx * 0.85
          : engageRangePx * BANDIT_STANDOFF_RANGE_MUL * (1 + (queueRing?.ringIndex || 0) * BANDIT_QUEUE_RING_STEP_MUL)
      );
      const strafeT = performance.now() / 1000 * BANDIT_STRAFE_HZ * Math.PI * 2 + (c._banditStrafePhase || 0);
      const swayAngle = Math.sin(strafeT) * BANDIT_STRAFE_ANGLE_AMPLITUDE_RAD;
      const ringPoint = banditRingPoint(targetPlayer, baseAngle + swayAngle, baseRadius);
      // Only pulls the bandit off the ring when actually crowding
      // another bandit -- the common case is a pure ring point, so
      // "back off when waiting" and "sway side to side" both fall out
      // of this same call instead of being two separate movements.
      const targetPoint = banditPersonalSpaceAdjust(c, ringPoint);
      // BANDIT_STRAFE_SPEED_PX_S (55px/s) is deliberately slow -- right
      // for the final small-amplitude sway once already near the ring,
      // but an outer queue ring can sit 500-800px out for a big gang
      // (BANDIT_QUEUE_RING_STEP_MUL compounding per ring). Using the
      // sway speed for that ENTIRE approach too meant an outer-ring
      // bandit could take 10+ seconds just to reach its assigned spot,
      // reading as vaguely wandering rather than "queued and waiting."
      // Closes the real distance at normal chase speed, same as
      // everything else in this state machine, and only downshifts to
      // the gentle sway speed once actually close to the target point.
      const distToTarget = Math.hypot(targetPoint.x - c.x, targetPoint.y - c.y);
      const travelSpeed = distToTarget > deps.TILE * 1.5 ? def.chaseSpeed : BANDIT_STRAFE_SPEED_PX_S;
      const moving = deps.moveCreatureToward(c, targetPoint.x, targetPoint.y, travelSpeed, dt);
      return { aimAngle: towardAngle, moving };
    }
    window.ResourceSystem?.spendStamina(c, def.attackStaminaCost, 'bandit attack');
    const openingFresh = c._banditComboIndex === 0;
    let fired = false;
    if (openingFresh && loadout.hold1 === 'chargedBreaker' && (c._banditHold1CdT || 0) <= 0 && deps.rnd() < BANDIT_HOLD1_CHANCE) {
      fired = fireBanditChargedBreaker(c, def, targetPlayer);
    }
    if (!fired) {
      const cond = banditQuickAttackConditions(c, targetPlayer);
      const conditionFavorable = cond.exhausted || cond.behind || cond.lowHealth;
      if (conditionFavorable && deps.rnd() < BANDIT_QUICK_ATTACK_CHANCE) fired = fireBanditQuickAttack(c, def, loadout, targetPlayer);
    }
    if (!fired) fired = fireBanditComboStep(c, def, loadout, targetPlayer);
    // The staged action just created above (inside whichever fire*
    // call ran) gets its own first tick later THIS SAME FRAME --
    // window.Combat.update(dt) runs after updateHostiles in the main
    // loop, so a brand-new action always advances from t=0 the instant
    // it's created. updateBanditLunge's own countdown has no such
    // same-frame catch-up: it only ticks from calls made earlier in
    // THIS invocation of updateBanditCombatAI, before the attack fired,
    // so without this the lunge silently runs exactly one frame's dt
    // BEHIND the staged action for its entire lifetime -- onStrike
    // (driven by the staged action's clock) checks the hit-cone before
    // the lunge has covered as much ground as it should have. Confirmed
    // live: every combo/quick-attack step landed short by a fixed
    // ~1-frame amount regardless of the ability's own duration (e.g.
    // Short Thrust's lungeT read 0.130s remaining out of a 0.210s
    // budget right at onStrike -- only 0.08s had elapsed on the lunge's
    // clock against the staged action's own windupS=0.12s), whiffing
    // attacks with otherwise perfect aim. Ticking the fresh lunge once
    // immediately gives it the same same-frame head start the staged
    // action already has.
    if (fired) updateBanditLunge(c, dt, targetPlayer);
    return { aimAngle: towardAngle, moving: false };
  }

  // ── Bandit weapon visuals ────────────────────────────────────────
  //
  // Reuses the PLAYER's own tool-swing pose math verbatim (fourPhaseLerp,
  // deps.STYLE_NEUTRAL_POSE, window.Combat.poses.SWEEP_POSE, and the same
  // thrust/sweep formulas updateToolMesh itself computes from) instead of
  // a static prop or an invented animation -- "use the player
  // animations," per design direction. What's NOT reused is
  // updateToolMesh itself or the single shared toolHolder/toolSwingT/
  // combatSwing* variables it reads: those are one-per-game singletons
  // (see combat-core.js's own "every staged action in this pipeline is a
  // player weapon-tool attack" comment) that assume exactly one attacker
  // exists. Each bandit gets its own toolHolder-equivalent group
  // (_banditToolHolder, added straight to the scene and repositioned in
  // world space every frame, exactly like the player's toolHolder is),
  // driven by that SAME pure pose math against its own facing/position
  // and its own current ability's windup/strike timing (c._banditAction)
  // instead of the player's. fourPhaseLerp/deps.STYLE_NEUTRAL_POSE/SWEEP_POSE
  // are already stateless pure functions/data -- the only reason this
  // isn't a one-line call into updateToolMesh is that updateToolMesh
  // hardcodes which entity it's posing for throughout.
  function makeBanditToolHolder(scene, weaponKey) {
    const mesh = deps.makeToolPlaneMesh(weaponKey);
    if (!mesh) return null;
    const holder = new THREE.Group();
    holder.name = 'banditToolHolder';
    holder.add(mesh);
    scene.add(holder);
    return holder;
  }

  // Two-phase version of updateToolMesh's fourPhaseLerp: 0->wf rises from
  // neutral to the windup pose (identical formula), then HOLDS at the
  // strike pose for the rest of the action instead of also modeling a
  // separate strike/hold/return split -- a bandit's own staged action has
  // no cosmetic return-tail duration of its own (recoverS is always 0;
  // see fireBanditComboStep etc), so there's no real "SF"/"HF" window to
  // ease across the way the player's longer toolSwingDur has room for.
  // The brief hold-then-freeze in updateBanditToolMesh below covers the
  // return instead.
  function banditPoseLerp(progress, wf, windupV, strikeV, neutralV) {
    if (progress <= wf) return neutralV + (windupV - neutralV) * (progress / Math.max(0.0001, wf));
    return strikeV;
  }

  // How long the weapon keeps showing its last (strike) pose once
  // c._banditAction completes, before resetting straight to neutral --
  // a cheap stand-in for the player's own eased return-to-neutral tail.
  const BANDIT_TOOL_SETTLE_S = 0.15;

  // ── Bandit weapon swing trail ────────────────────────────────────
  //
  // A single-lane simplification of updateCombatConeTrail's ribbon-arc
  // mesh (same tapered/arched shape, same BufferGeometry layout) built
  // per-bandit instead of reading the singleton toolHolder/combatSwing*
  // state: the real version's affliction-colored multi-lane system
  // (up to 4 lanes, one per possible affliction) isn't reproduced --
  // every bandit swing draws one lane, tinted by its own attackTag,
  // which is enough to sell "the blade is sweeping through here" without
  // needing combat-progression.js's player-only upgrade-affliction data.
  const BANDIT_TRAIL_SAMPLES = 12;
  const BANDIT_TRAIL_HALF_THICKNESS_TILES = 0.06;
  const BANDIT_TRAIL_ARCH_UNITS = 0.2;
  const BANDIT_TRAIL_COLOR_BY_TAG = { sharp: 0xd9ffe0, blunt: 0xffc23d };

  function makeBanditTrailMesh() {
    const geo = new THREE.BufferGeometry();
    const vertCount = (BANDIT_TRAIL_SAMPLES + 1) * 2;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const indices = [];
    for (let s = 0; s < BANDIT_TRAIL_SAMPLES; s++) {
      const a = s * 2, b = a + 1, cc = a + 2, d = a + 3;
      indices.push(a, b, cc, b, d, cc);
    }
    geo.setIndex(indices);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, color: 0xffffff,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    return mesh;
  }

  // Called from each fireBandit*'s onStrike (the same moment
  // updateCombatConeTrail's own sweep starts -- WF, not fire-time) so
  // the arc appears exactly when the hit actually lands, not during the
  // windup telegraph.
  function spawnBanditTrailArc(c, rangePx, halfConeRad, angle, pitch = null) {
    const attackTag = c.def.attackTag || 'sharp'; // Used to keep enemy ribbon color aligned with its weapon damage type.
    const color = BANDIT_TRAIL_COLOR_BY_TAG[attackTag] || 0xffffff;
    window.Combat?.spawnMeleeTrail?.({
      actor: c,
      scene: c.scene,
      yaw: angle,
      pitch: pitch ?? c._banditAimPitch ?? 0,
      rangePx,
      halfConeRad,
      halfThickness: BANDIT_TRAIL_HALF_THICKNESS_TILES,
      archUnits: BANDIT_TRAIL_ARCH_UNITS,
      color,
      holdS: BANDIT_TRAIL_HOLD_S,
      fadeS: BANDIT_TRAIL_FADE_S,
    });
  }

  // The real cone trail (updateCombatConeTrail) stays at FULL opacity for
  // its entire visible window and only fades (or, for a tap attack whose
  // strikeFrac is 1, just vanishes outright) right at the very end -- it
  // never dims gradually from the moment it appears. The previous
  // version here faded linearly from spawn across its whole (short)
  // lifetime, so it spent most of its life at low opacity under additive
  // blending -- easy to miss entirely. HOLD_S now keeps it fully bright
  // first, matching how a tap attack's own trail reads, before a brief
  // fade-out standing in for the real system's end-of-swing return tail.
  const BANDIT_TRAIL_HOLD_S = 0.22;
  const BANDIT_TRAIL_FADE_S = 0.16;
  function updateBanditTrailArc(c, dt) {
    const mesh = c._banditTrailMesh;
    if (!mesh || !mesh.visible) return;
    c._banditTrailAge = (c._banditTrailAge || 0) + dt;
    if (c._banditTrailAge < BANDIT_TRAIL_HOLD_S) { mesh.material.opacity = 0.85; return; }
    const fadeT = c._banditTrailAge - BANDIT_TRAIL_HOLD_S;
    const alpha = 1 - fadeT / BANDIT_TRAIL_FADE_S;
    if (alpha <= 0.01) { mesh.visible = false; return; }
    mesh.material.opacity = alpha * 0.85;
  }

  function updateBanditToolMesh(c) {
    const holder = c._banditToolHolder;
    if (!holder) return;
    if (c._rangedMode) {
      holder.visible = false;
      window.RangedWeapons?.updateBanditVisual?.(c);
      return;
    }
    holder.visible = true;
    if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;
    const action = c._banditAction;
    if (!action) {
      if (performance.now() < (c._banditToolSettleUntil || 0)) {
        // Holding last pose briefly -- the weapon holder's own
        // quaternion/position are frozen (nothing below runs), but
        // updateCreatureMesh (which now runs BEFORE this every frame,
        // unconditionally) keeps smoothing c.groupRot/the avatar's
        // rotation.y back toward the plain aim angle the whole time,
        // since it has no idea a swing was ever leaning it. Without
        // reasserting the lean here too, the body visibly turns back
        // to facing the player while the weapon stays frozen leaned
        // out from the swing -- "the character turns independently of
        // the weapon." Keeps both in sync until the settle window
        // actually ends and they reset to plain θ together below.
        if (c._banditToolLastVθ != null) { c.avatarRef.group.rotation.y = c._banditToolLastVθ; c.groupRot = c._banditToolLastVθ; }
        return;
      }
    }
    const anim = c._banditSwingAnim || 'thrust';
    const pose = c._banditSwingPose;
    const dirSign = c._banditSwingDirSign || 1;
    const power = c._banditSwingPower || 1;

    // The sprite plane's own local twist/mirror -- mirrors updateToolMesh's
    // spinPlane handling exactly (see its own comment there): a sweep-style
    // blade needs an extra -90 degree z-twist to lie edge-on into the swing
    // plane instead of sitting flat the way a thrust weapon's sprite does,
    // and dirSign mirrors it across (x-scale flip) for a Backhand-style
    // step. makeBanditToolHolder builds the exact same flat plane mesh
    // (deps.makeToolPlaneMesh) the player equips, but nothing here was ever
    // applying this twist -- every bandit SWEEP weapon (hatchet, fishing
    // mace) rendered lying flat regardless of anim/pose, reading as "held
    // like a thrust weapon" even while stanceAnim/stanceExpected both
    // correctly reported "sweep". Player-only cosmetics (the harpoon-cast
    // twirl, refillTwistOut/Back) don't apply to a bandit's own combat
    // swing, so only the two channels real combat swings actually use are
    // ported here.
    const spinPlane = holder.children[0]?.userData?.toolPlane;
    if (spinPlane) {
      spinPlane.rotation.z = anim === 'sweep' ? -Math.PI / 2 : 0;
      spinPlane.scale.x = anim === 'sweep' ? dirSign : 1;
    }

    let progress = 0, wf = 0.16;
    if (action) {
      const totalS = Math.max(0.0001, action.windupS + action.strikeS);
      progress = Math.min(1, action.t / totalS);
      wf = action.windupS / totalS;
      c._banditToolSettleUntil = performance.now() + BANDIT_TOOL_SETTLE_S * 1000;
    }

    // NEITHER c.facing NOR c.groupRot directly -- the weapon holder is a
    // standalone world object using the exact same rotation.y convention
    // as the player's own tool (θ = playerFacing there). Turns out
    // playerFacing is itself NOT the raw facing angle either: the
    // player's own per-frame update computes it as
    // `-facingAngle + Math.PI / 2` (facingAngle === player.angle, the
    // raw aim angle -- see the player's own mesh-update code) before
    // smoothing/deadzoning. c.facing is the bandit's equivalent of
    // facingAngle/player.angle (the raw aim angle fireBandit*'s own
    // cone/lunge checks use directly) -- so the weapon's own θ needs
    // that SAME `-angle + PI/2` transform applied to c.facing, just
    // WITHOUT def.aimAngleOffset baked in (that offset exists only to
    // correct the bandit portrait RIG's own internal axis quirk -- see
    // buildBanditAvatar -- the weapon holder isn't part of that rig and
    // has no such quirk to correct for).
    //
    // c.groupRot (the avatar body's own rotation.y) is this SAME
    // transform but WITH aimAngleOffset included (see
    // updateCreatureMesh's rawTargetRotY), so at rest groupRot is
    // always θ - aimAngleOffset, a fixed difference. Both groupRot and
    // holder.rotation.y are used completely directly as literal Y
    // rotations (grp.rotation.y = c.groupRot in updateCreatureMesh;
    // holder.quaternion built straight from θ below) -- so a lean
    // (bodyYawRad) carries across the fixed difference by plain
    // addition in EITHER space, without re-deriving anything from
    // c.facing: vθGroup = vθ - aimAngleOffset (see the sweep/thrust
    // branches below). A previous version of this code re-ran the
    // leaned angle back through a fresh `-(angle) + offset` transform,
    // which silently flips bodyYawRad's own sign (the transform negates
    // its argument, including whatever lean had just been added),
    // leaning the avatar body the OPPOSITE way from the weapon it's
    // supposedly holding -- exactly the "independent rotations between
    // avatars and weapons" this replaces.
    const θ = -(c.facing || 0) + Math.PI / 2;
    const aimOffset = c.def.aimAngleOffset || 0;
    const base = banditToolBaseXY(c.avatarRef);
    // playerMesh.position.y is a feet-level origin (playerToolBaseY then
    // adds the hand height on top of that) -- avatarRef.group.position.y
    // is a CENTER-of-model anchor instead (see makeBanditEntity's
    // surfY+halfH spawn position and updateCreatureMesh's ty), so the
    // same +base.y offset needs feet-level Y here too, not center Y.
    const feetY = c.avatarRef.group.position.y - (c.halfHeight || 0);

    if (anim === 'sweep' && pose) {
      const styleNeutral = deps.STYLE_NEUTRAL_POSE.sweep;
      const neutral = { ...styleNeutral, ...(pose.neutral || {}) };
      const chan = (ch, mirror = false) => {
        const w = (neutral[ch] + ((pose.windup?.[ch] ?? neutral[ch]) - neutral[ch]) * power) * (mirror ? dirSign : 1);
        const s = (neutral[ch] + ((pose.strike?.[ch] ?? neutral[ch]) - neutral[ch]) * power) * (mirror ? dirSign : 1);
        const n = neutral[ch] * (mirror ? dirSign : 1);
        return banditPoseLerp(progress, wf, w, s, n);
      };
      const x = chan('x', true), y = chan('y'), z = chan('z');
      const pitchRad = THREE.MathUtils.degToRad(chan('pitch'));
      const yawRad = THREE.MathUtils.degToRad(chan('yaw', true));
      const rollRad = THREE.MathUtils.degToRad(chan('roll', true));
      const bodyYawRad = THREE.MathUtils.degToRad(chan('bodyYaw', true));
      const vθ = θ + bodyYawRad;
      // Leans the avatar body itself into the swing too, not just the
      // weapon -- matches the player's own updateToolMesh, which sets
      // playerMesh.rotation.y = vθ in every branch (the whole character
      // visibly winds up and follows through, not just their weapon).
      // c.groupRot is θ's own space minus the constant aimAngleOffset
      // (see θ's own comment above) -- the lean carries straight across
      // by plain subtraction of that same constant, NOT by re-deriving
      // from c.facing (which would flip bodyYawRad's own sign). Also
      // updates c.groupRot itself (not just the live mesh rotation.y),
      // so next frame's updateCreatureMesh lerp continues from this
      // leaned angle instead of snapping back to the plain aim angle
      // and re-leaning from scratch every single frame while the swing
      // is active. Resolves to plain rest angle (no visible change) at
      // rest, since bodyYawRad is 0 at progress=0 for every style here.
      const vθGroup = vθ - aimOffset;
      c.avatarRef.group.rotation.y = vθGroup;
      c.groupRot = vθGroup;
      c._banditToolLastVθ = vθGroup; // reasserted during the settle window below (already in groupRot-space)
      const vRX = Math.cos(vθ), vRZ = -Math.sin(vθ), vFX = Math.sin(vθ), vFZ = Math.cos(vθ);
      deps.qFac.setFromAxisAngle(deps.tUp, vθ);
      deps.qToolYaw.setFromAxisAngle(deps.tUp, yawRad);
      deps.qAnim.setFromAxisAngle(deps.xAxis, pitchRad);
      deps.qRoll.setFromAxisAngle(deps.zAxis, rollRad);
      holder.quaternion.copy(deps.qFac).multiply(deps.qToolYaw).multiply(deps.qAnim).multiply(deps.qRoll);
      holder.position.set(
        c.x / deps.TILE + vRX * (base.x + x) + vFX * z,
        feetY + base.y + y,
        c.y / deps.TILE + vRZ * (base.x + x) + vFZ * z,
      );
    } else {
      // THRUST -- mirrors updateToolMesh's own thrust branch exactly
      // (same windup-back/jab-forward/lateral/pitch/yaw formulas), used
      // for pokeCombo, every Quick Attack, and the Counter Shield riposte.
      const windupBack = -0.40 * power;
      // neutralV=0, NOT windupBack -- matches the player's own thrust
      // branch, whose equivalent fourPhaseLerp call for jabOff omits an
      // explicit neutralV entirely (defaulting to 0), which is verified
      // intentional (not just "happened to be 0") by deps.STYLE_NEUTRAL_POSE.
      // thrust.z === 0, the authored attack-animation-editor rest value
      // this whole style is built to match at progress=0. Passing
      // windupBack here instead left a bandit's thrust weapon
      // permanently held pulled back (as if crouched mid-windup) even
      // at true idle, never resting at the same neutral extension the
      // player's own weapon sits at.
      const jabOff = banditPoseLerp(progress, wf, windupBack, 0.32 * power, 0);
      const lateral = banditPoseLerp(progress, wf, 0, -0.23 * power, 0);
      const pitchRad = banditPoseLerp(progress, wf, THREE.MathUtils.degToRad(10.31), THREE.MathUtils.degToRad(1), THREE.MathUtils.degToRad(10.31));
      const yawRad = banditPoseLerp(progress, wf, 0, THREE.MathUtils.degToRad(-45) * power, 0);
      const bodyYawRad = banditPoseLerp(progress, wf, THREE.MathUtils.degToRad(-45) * power, THREE.MathUtils.degToRad(46) * power, 0);
      const vθ = θ + bodyYawRad;
      // Leans the avatar body itself into the thrust too -- see the
      // matching comment in the sweep branch above.
      const vθGroup = vθ - aimOffset;
      c.avatarRef.group.rotation.y = vθGroup;
      c.groupRot = vθGroup;
      c._banditToolLastVθ = vθGroup; // reasserted during the settle window above (already in groupRot-space)
      const vRX = Math.cos(vθ), vRZ = -Math.sin(vθ), vFX = Math.sin(vθ), vFZ = Math.cos(vθ);
      deps.qFac.setFromAxisAngle(deps.tUp, vθ);
      deps.qToolYaw.setFromAxisAngle(deps.tUp, yawRad);
      deps.qAnim.setFromAxisAngle(deps.xAxis, pitchRad);
      holder.quaternion.copy(deps.qFac).multiply(deps.qToolYaw).multiply(deps.qAnim);
      holder.position.set(
        c.x / deps.TILE + vRX * (base.x + lateral) + vFX * jabOff,
        feetY + base.y,
        c.y / deps.TILE + vRZ * (base.x + lateral) + vFZ * jabOff,
      );
    }
  }

  // Mirrors refreshPlayerAvatar's own playerToolBaseX/Y exactly: prefers
  // the real per-species/gender hand-attach point scanned off the
  // rendered portrait (buildBanditAvatar's handAttachX/Y, forwarded from
  // buildSinglePlaneAvatarModel), falling back to the generic
  // -width/2,height/2 guess only if that scan didn't produce one.
  function banditToolBaseXY(avatarRef) {
    const w = avatarRef?.modelWidth || 0.9, h = avatarRef?.modelHeight || 0.9;
    return {
      x: avatarRef?.handAttachX ?? (-w / 2),
      y: avatarRef?.handAttachY ?? (h / 2),
    };
  }

  async function makeBanditEntity(cfg, rank, tier, x, y, opts = {}) {
    const roster = opts.rosterOverride || await rollBanditRoster(cfg, rank, opts.nameOverride);
    const avatarRef = await buildBanditAvatar(roster);
    if (roster?.appearance?.speciesId === 'ghoul') makeGhoulAvatarMineLit(avatarRef); // Ghoul PNGs obey the cave's actual light level instead of glowing at full unlit brightness.
    if (!avatarRef) {
      window.__farmLog?.(`[bandits] portrait avatar build failed for a ${rank} (${roster.appearance.speciesId}/${roster.appearance.gender}) -- skipping this gang member.`, 'wildlife');
      return null;
    }
    // Building the portrait is two awaited canvas renders long, so the
    // player can transition out of the zone mid-build. Everything below
    // resolves against whatever area is current NOW (scene, grid, areaId),
    // so a stale spawn would land a bandit in the wrong zone entirely —
    // drop it instead and let the next visit re-seed the camp.
    if (opts.zoneId && opts.zoneId !== deps.getCurrentArea()) {
      avatarRef.dispose();
      return null;
    }
    const mastery = banditMasteryFor(cfg, rank, tier);
    const def = Object.assign(makeBanditDef(cfg, rank, tier, mastery, avatarRef.modelWidth), opts.defOverride || {});
    const targetScene = opts.scene || deps.getActiveScene();
    const targetGrid = opts.grid || deps.getActiveGrid();
    const gridCols = opts.cols || deps.getActiveCols();
    const gridRows = opts.rows || deps.getActiveRows();
    const halfH = avatarRef.modelHeight / 2;
    const col = deps.clamp(Math.floor(x / deps.TILE), 0, gridCols - 1);
    const row = deps.clamp(Math.floor(y / deps.TILE), 0, gridRows - 1);
    const surfY = targetGrid[row]?.[col] ? deps.tileSurfaceYInArea(targetGrid[row][col], deps.getCurrentArea()) : 0;
    avatarRef.group.position.set(x / deps.TILE, surfY + halfH, y / deps.TILE);
    deps.markPngPlane(avatarRef.group);
    targetScene.add(avatarRef.group);
    const banditToolHolder = makeBanditToolHolder(targetScene, def.weaponKey);
    if (!banditToolHolder) window.__farmLog?.(`[bandits] tool holder failed to build for "${def.weaponKey}" -- toolTextures entry missing? (fallback: bandit renders unarmed)`, 'wildlife');
    const banditRangedToolHolder = def.rangedWeaponKey ? makeBanditToolHolder(targetScene, def.rangedWeaponKey) : null;
    if (banditRangedToolHolder) banditRangedToolHolder.visible = false;

    const groundShadow = deps.makeCharacterGroundShadow('bandit_ground_shadow');
    const shadowRadii = deps.creatureGroundShadowRadii(def);
    groundShadow.scale.set(shadowRadii.radiusX, 1, shadowRadii.radiusZ);
    groundShadow.position.set(x / deps.TILE, surfY + deps.characterGroundShadowSurfaceOffset(), y / deps.TILE);
    targetScene.add(groundShadow);

    const c = {
      id: 'bandit_' + rank + '_' + (performance.now() | 0) + '_' + Math.floor(deps.rnd() * 100000),
      creatureKey: 'bandit-' + rank, def, avatarRef, groundShadow,
      x, y, vx: 0, vy: 0,
      halfHeight: halfH,
      health: def.maxHealth, maxHealth: def.maxHealth,
      stamina: def.maxStamina, maxStamina: def.maxStamina,
      facing: 0, groupRot: 0, pngRot: 0, perpState: {},
      scaleY: 1,
      attackCooldownT: 0, retreatT: 0, hitFlashT: 0,
      knockbackT: 0, knockbackVX: 0, knockbackVY: 0,
      runFrame: 0, runFrameDistPx: 0, currentFrameUrl: null,
      isCompanion: false, master: null,
      name: roster.name,
      state: 'idle',
      wanderTarget: null, wanderT: 0,
      homeX: x, homeY: y,
      scene: targetScene, areaGrid: targetGrid, areaCols: gridCols, areaRows: gridRows, areaId: deps.getCurrentArea(),
      isBandit: true, banditRank: rank, banditTier: tier, banditMastery: mastery,
      banditWeaponMeshAttached: !!banditToolHolder,
      _banditToolHolder: banditToolHolder,
      _banditRangedToolHolder: banditRangedToolHolder,
      _rangedLoaded: true, _rangedMode: false, _rangedAction: null, _rangedCooldownT: 0,
      // Idle/approach rest pose matches the weapon's own natural swing
      // style (see banditNaturalSwing) until an ability fire overwrites
      // these with its own (see fireBanditComboStep/fireBanditQuickAttack
      // /fireBanditChargedBreaker/fireBanditCounterRiposte) -- reset
      // back to this same natural style once the action completes (see
      // finishBanditAction) rather than staying stuck on whichever
      // ability last fired -- see updateBanditToolMesh.
      _banditSwingAnim: banditNaturalSwing(def).anim,
      _banditSwingPose: banditNaturalSwing(def).pose,
      _banditSwingDirSign: 1, _banditSwingPower: 1, _banditToolSettleUntil: 0,
      // Ability-AI state -- see updateBanditCombatAI/damageCreature's
      // isBandit branch/the leaving-chase reset above for where these
      // get driven and cleared.
      _banditAction: null, _banditComboIndex: 0,
      _banditHold1CdT: 0, _banditGuardUntil: 0, _banditGuardCdT: 0, _banditLastCounterAt: -99,
      // Per-bandit phase offset for the idle side-to-side strafe applied
      // while queued/waiting (see BANDIT_STRAFE_* below) -- randomized so
      // a gang doesn't all sway in unison.
      _banditStrafePhase: deps.rnd() * Math.PI * 2,
      rosterRecord: roster,
      ...opts.extra,
    };
    window.ResourceSystem?.initEntity(c);
    if (def.rangedWeaponKey) window.RangedWeapons?.setLoaded?.(def.rangedWeaponKey, true, c);
    return c;
  }

  // Overrides the baseline melee constants above from docs/config/combat/
  // attack-values.json's `bandit` section, same synchronous-default-then-
  // override pattern as every other combat-*.js module's applyXConfig --
  // called by game.js's window.__attackValuesConfigPromise handler (which
  // owns CREATURE_DB's own equivalent override) once that fetch resolves.
  function applyBanditConfig(cfg) {
    if (!cfg) return;
    if (cfg.BASE_ATTACK_DAMAGE != null) BANDIT_BASE_ATTACK_DAMAGE = cfg.BASE_ATTACK_DAMAGE;
    if (cfg.attackRangeTiles != null) BANDIT_ATTACK_RANGE_TILES = cfg.attackRangeTiles;
    if (cfg.attackHalfConeDeg != null) BANDIT_ATTACK_HALF_CONE_DEG = cfg.attackHalfConeDeg;
    if (cfg.attackStaminaCost != null) BANDIT_ATTACK_STAMINA_COST = cfg.attackStaminaCost;
    if (cfg.attackCooldownSCaptain != null) BANDIT_ATTACK_COOLDOWN_S_CAPTAIN = cfg.attackCooldownSCaptain;
    if (cfg.attackCooldownSOther != null) BANDIT_ATTACK_COOLDOWN_S_OTHER = cfg.attackCooldownSOther;
  }

  window.BanditCombat = {
    init,
    applyBanditConfig,
    loadGangConfig: loadBanditGangConfig,
    loadCampLocaleDefs: loadBanditCampLocaleDefs,
    makeEntity: makeBanditEntity,
    // Rolls a name the same way a fresh gang member's roster does (see
    // rollBanditRoster) — used standalone by game.js's generateBountyTask
    // when no live camp exists yet to adopt a captain's real identity from.
    randomName: _banditName,
    updateCombatAI: updateBanditCombatAI,
    restNeckLook,
    updateToolMesh: updateBanditToolMesh,
    updateTrailArc: updateBanditTrailArc,
    fireCounterRiposte: fireBanditCounterRiposte,
    naturalSwing: banditNaturalSwing,
    engagementReachPx: banditEngagementReachPx,
    RANK_LABEL: BANDIT_RANK_LABEL,
    TINT_SLOT_BY_SLOT: BANDIT_TINT_SLOT_BY_SLOT,
    GUARD_DAMAGE_ABSORB: BANDIT_GUARD_DAMAGE_ABSORB,
    MAX_ATTACK_SLOTS: BANDIT_MAX_ATTACK_SLOTS,
    get attackSlots() { return _banditAttackSlots; },
    get queueRings() { return _banditQueueRings; },
  };
})();
