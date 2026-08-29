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