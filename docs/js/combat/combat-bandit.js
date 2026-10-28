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
  const COMBAT_FROWN_COMPOSER = Object.freeze({ // Static portrait composer used once per humanoid hostile to pre-bake the combat mouth without touching global dialogue/expression state.
    getExpression: () => 'frown',
    getInterpolatedPoints: () => null,
    getOverlayOnlyPoints: () => null,
    getAnimData: () => null,
  });
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
        _banditConfigPromise = null; // A failed request must be retryable from the arena instead of caching null for the session.
        deps?.debugLog?.('Bandits: gang config load failed: ' + e.message, 'warn');
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
  const BANDIT_TINT_SLOT_BY_SLOT = { torso: 'TORSO', overwear: 'CLOTH', hat: 'HAT', hood: 'HOOD', pants: 'PANTS' };

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
    const slotRestriction = genderData?.exclusiveSlotCosmetics?.[slot]; // Species restrictions also apply to bandit-exclusive facewraps.
    const out = {};
    for (const id of (poolIds || [])) {
      if (Array.isArray(slotRestriction) && slotRestriction.length && !slotRestriction.includes(id)) continue;
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

  const GHOUL_OVERWEAR_POOL = Object.freeze(['tankan_bodywrap', 'fine_bodywrap', 'rugged_poncho', 'fine_poncho']); // All existing upper garments plus the authored two-dye Fine Body Wrap, sampled uniformly per Ghoul.
  const GHOUL_PANTS_POOL = Object.freeze(['pants_basic', 'draped_pants']); // Equal-probability trouser choices, independent of gender.
  const GHOUL_BANDOLIER_CHANCE = 0.5; // Empty-roster mine ghouls now actually roll a bandolier; previously only inherited bandoliers could appear.
  const GHOUL_HEADBAND_ID = 'appearance::hat::basic_headband'; // Valid Mao-ao headwear article used for the ghoul's common head covering.
  const GHOUL_HEADBAND_CHANCE = 0.6; // Cloth headbands remain the most common ghoul headwear.
  const GHOUL_FACEWRAP_CHANCE = 0.2; // Facewraps share the hood slot; fine hoods fill the remaining 20%.
  const GHOUL_PRIMARY_DYE = 'dye:CLOTH:pale_blue'; // All ghoul clothing channels' primary color, including bandoliers and leg garments.
  const GHOUL_SECONDARY_DYE = 'dye:CLOTH:silver'; // Matching secondary/trim dye on fine hoods, drapes and any two-color clothing.

  function styleGhoulRoster(roster) {
    if (roster?.appearance?.speciesId !== 'ghoul') return roster;
    const current = Array.isArray(roster.equippedCosmetics) ? roster.equippedCosmetics : []; // The incoming mine roster may already include a hood, wrap, bandolier or older pants.
    const priorSlots = roster.cosmeticSlots || {}; // Slot ownership also identifies clothing not in the small explicit item pools.
    // The ghoul wardrobe chooses exactly one head covering; remove any previously assigned hats or hoods first.
    const removed = new Set(); // Used to remove only clothing replaced by the single overwear/hood/pants rolls.
    for (const id of current) {
      if (priorSlots[id] === 'overwear' || GHOUL_OVERWEAR_POOL.includes(id) || priorSlots[id] === 'pants'
          || ['basic_pants', 'layered_skirt', ...GHOUL_PANTS_POOL].includes(id)
          || priorSlots[id] === 'hood' || priorSlots[id] === 'hat'
          || id.startsWith('appearance::hat::') || ['fine_hood', 'ragged_hood', 'facewrap'].includes(id)) removed.add(id);
    }
    const next = current.filter(id => !removed.has(id)); // Other equipped articles, including already rolled bandoliers, survive.
    const alreadyHasTorso = next.some(id => id === 'bandolier1' || priorSlots[id] === 'torso'); // Prevents adding a second torso article to a pre-equipped ghoul.
    if (!alreadyHasTorso && deps.rnd() < GHOUL_BANDOLIER_CHANCE) {
      next.push('bandolier1');
      priorSlots.bandolier1 = 'torso';
    } else if (next.includes('bandolier1')) {
      priorSlots.bandolier1 = 'torso'; // Repairs old external rosters that supplied a bandolier without its loot slot.
    }
    const overwear = GHOUL_OVERWEAR_POOL[Math.floor(deps.rnd() * GHOUL_OVERWEAR_POOL.length)]; // Each authored upper-body silhouette has equal weight.
    const pants = GHOUL_PANTS_POOL[deps.rnd() < 0.5 ? 0 : 1]; // Exactly 50/50 simple versus draped for fresh ghoul spawns.
    const headwearRoll = deps.rnd(); // One independent roll picks exactly one ghoul head covering.
    const headwear = headwearRoll < GHOUL_HEADBAND_CHANCE ? GHOUL_HEADBAND_ID
      : headwearRoll < GHOUL_HEADBAND_CHANCE + GHOUL_FACEWRAP_CHANCE ? 'facewrap' : 'fine_hood'; // All selections inherit Pale Blue/Silver dye channels.
    const headwearSlot = headwear === GHOUL_HEADBAND_ID ? 'hat' : 'hood'; // Loot and portrait assembly need the actual headwear slot.
    for (const id of removed) delete priorSlots[id];
    for (const [id, slot] of [[overwear, 'overwear'], [pants, 'pants'], [headwear, headwearSlot]]) {
      if (!id) continue;
      next.push(id);
      priorSlots[id] = slot;
    }
    roster.equippedCosmetics = next;
    roster.cosmeticSlots = priorSlots;
    roster.appliedDyes ||= {};
    for (const slot of Object.values(BANDIT_TINT_SLOT_BY_SLOT)) {
      roster.appliedDyes[slot] = GHOUL_PRIMARY_DYE;
      roster.appliedDyes[`${slot}_B`] = GHOUL_SECONDARY_DYE;
    }
    return roster;
  }

  // Produces exactly the record shape makeNpcWalker feeds into
  // NpcAvatarPreview.buildProfileFromNpcExport, plus a `cosmeticSlots`
  // side table the corpse-loot step reads to rebuild each worn item as a
  // packClothing entry without re-deriving its slot.
  async function rollBanditRoster(cfg, rank, nameOverride, genderOverride = null) {
    const speciesId = _banditWeightedPick(cfg?.speciesWeights) || 'mao-ao';
    const gender = genderOverride === 'male' || genderOverride === 'female'
      ? genderOverride : (deps.rnd() < 0.5 ? 'male' : 'female'); // Only callers such as male Slagothim traders supply an override.
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
      if (object.userData?.hobunjiPantsGarment && object.geometry?.computeVertexNormals) {
        object.geometry.computeVertexNormals(); // The deformable pants have positions/UVs but no normals; Lambert lighting otherwise makes them black.
        object.userData.hobunjiPantsLitNormals = true; // PantsGarmentRenderer refreshes normals only when the lit ghoul's legs deform.
      }
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
        lit.onBeforeCompile = source.onBeforeCompile;
        lit.customProgramCacheKey = source.customProgramCacheKey;
        lit.userData = { ...(source.userData || {}), hobunjiMineLitGhoul: true };
        source.dispose?.();
        return lit;
      });
      if (changed) object.material = Array.isArray(object.material) ? litMaterials : litMaterials[0];
    });
    avatarRef.group.userData = { ...(avatarRef.group.userData || {}), mineLitGhoul: true };
    return avatarRef;
  }

  function applyRosterDyesToProfile(profile, roster) {
    if (!profile || !roster) return {}; // Shared hostile portrait guard; callers still retain the untinted profile if no roster exists.
    const accountCatalog = window.ScratchbonesAccount?.getDyeCatalog?.() || []; // Preferred live account catalog when it has finished initializing.
    const configCatalog = window.SCRATCHBONES_CONFIG?.game?.dyes?.catalog || []; // Full authored fallback remains available even if the account shim momentarily reports an empty list.
    const catalog = accountCatalog.length ? accountCatalog : configCatalog; // Same authored dye definitions the inventory/loot presentation uses.
    const byId = new Map(catalog.map(dye => [dye?.id, dye])); // One lookup table avoids rescanning the full catalog for every clothing slot.
    const bodyColors = { ...(profile.bodyColors || {}) }; // Clone so randomProfile's palette object is never mutated behind another consumer's back.
    const resolved = {}; // Mobile/debug-readable proof of the exact dye id/hex baked into this hostile's world portrait.
    for (const [tintSlot, dyeId] of Object.entries(roster.appliedDyes || {})) {
      const dye = byId.get(dyeId);
      if (!dye) continue;
      const tint = { ...(dye.color || {}) }; // Preserve fitted legacy HSV/filter metadata for compatibility with existing portrait tint consumers.
      if (dye.hex) {
        tint.hex = dye.hex; // Absolute catalog color makes hostile rendering deterministic and identical to the inventory swatch.
        tint.tintMode = 'hexShadeFill';
      }
      bodyColors[tintSlot] = tint;
      resolved[tintSlot] = { dyeId, hex: dye.hex || null };
    }
    profile.bodyColors = bodyColors;
    return resolved;
  }

  function ensureEnemyPants(roster) {
    const speciesId = String(roster?.appearance?.speciesId || '').trim().toLowerCase().replace(/_/g, '-'); // Both excluded lower-body anatomies bypass the hostile garment fallback.
    if (!roster || speciesId === 'omgurku' || speciesId === 'porakaneki') return null;
    const renderer = window.PantsGarmentRenderer; // Existing garment registry and NPC dye fallback.
    if (!renderer) return null;
    if (!renderer.garmentForCosmetics(roster.equippedCosmetics)) {
      renderer.ensureNpcPants(roster, { garmentId: deps.rnd() < 0.5 ? 'pants_basic' : 'draped_pants', preferSpeciesGarment: false });
    }
    const garmentId = renderer.garmentForCosmetics(roster.equippedCosmetics); // Loot and the avatar read the same garment and PANTS dye.
    if (garmentId) {
      roster.cosmeticSlots ||= {};
      roster.cosmeticSlots[garmentId] = 'pants';
    }
    return garmentId;
  }

  async function buildBanditAvatar(roster) {
    if (!window.NpcAvatarPreview || !window.PNGPlaneAvatar) throw new Error('Humanoid portrait modules are unavailable.');
    characterBuildStatus.stage = 'cosmetics';
    await window.NpcAvatarPreview.ensurePortraitCosmetics({ assetBase: './assets/', configBase: './config/' });
    characterBuildStatus.garmentId = ensureEnemyPants(roster); // Existing mobile build diagnostics show the selected leg garment.
    characterBuildStatus.stage = 'profile';
    const avatarData = window.MetalArmorSystem?.decorateAvatarDataWithMetalArmor?.(roster, roster.metalArmorItems || []) || roster; // Portrait colors retain the same alloy/Temper state as corpse loot.
    const profile = window.NpcAvatarPreview.buildProfileFromNpcExport(avatarData);
    if (!profile) throw new Error('Humanoid portrait profile could not be built.');
    const resolvedRosterDyes = applyRosterDyesToProfile(profile, roster); // Final world-avatar authority: visible pixels must use the same appliedDyes record that loot preserves.
    const avatarCfg = window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
    const MODEL_W = avatarCfg.worldModelWidth ?? 0.9;
    const PORTRAIT_SIZE = avatarCfg.previewPortraitCanvasSize ?? 200;
    // forceEyesOpen for the same reason makeNpcWalker needs it: this bakes
    // one static texture at spawn and never re-renders, so an unlucky
    // blink roll would leave the bandit permanently squint-eyed.
    const frontCanvas = document.createElement('canvas');
    frontCanvas.width = frontCanvas.height = PORTRAIT_SIZE;
    characterBuildStatus.stage = 'front-portrait';
    await window.NpcAvatarPreview.renderProfileToCanvas(frontCanvas, profile, { forceEyesOpen: true });
    const neutralFrontCanvas = document.createElement('canvas'); // Immutable neutral/resting source used to restore this enemy immediately when combat ends.
    neutralFrontCanvas.width = neutralFrontCanvas.height = PORTRAIT_SIZE;
    neutralFrontCanvas.getContext('2d').drawImage(frontCanvas, 0, 0);
    const combatFrownCanvas = document.createElement('canvas'); // Pre-baked frown source used for synchronous combat entry and therefore available before an afterimage snapshots the live texture.
    combatFrownCanvas.width = combatFrownCanvas.height = PORTRAIT_SIZE;
    characterBuildStatus.stage = 'combat-portrait';
    await window.NpcAvatarPreview.renderProfileToCanvas(combatFrownCanvas, profile, {
      forceEyesOpen: true,
      breathingComposer: COMBAT_FROWN_COMPOSER,
      seatId: 'bandit-combat-frown',
    });
    const backCanvas = document.createElement('canvas');
    backCanvas.width = backCanvas.height = PORTRAIT_SIZE;
    characterBuildStatus.stage = 'back-portrait';
    await window.NpcAvatarPreview.renderProfileToCanvas(backCanvas, profile, { portraitView: 'behind', forceEyesOpen: true });
    characterBuildStatus.stage = 'portrait-model';
    const portrait = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(
      THREE, frontCanvas,
      {
        backCanvas, profile, modelWidth: MODEL_W, modelHeight: MODEL_W, anchorZ: 0,
        alphaTest: avatarCfg.worldAlphaTest ?? 0.01, name: 'bandit_portrait',
        mountSpecies: roster.mountSpecies || null, // Ridden mount card (omgurku-species-runtime.js MOUNTS); returns a compound avatar.
      },
    );
    if (portrait.userData?.proceduralBodyRoot) { // Compound avatars (Omgurku rider + quadruped, mounted riders) keep their own hierarchy instead of being split into two rigid planes.
      return buildCompoundBanditAvatar(portrait, {
        roster, profile, resolvedRosterDyes, frontCanvas, backCanvas, neutralFrontCanvas, combatFrownCanvas, MODEL_W,
      });
    }
    const assembly = portrait.children[0];
    const frontMesh = assembly?.children?.[0];
    const backMesh = assembly?.children?.[1];
    if (!frontMesh || !backMesh) throw new Error('Humanoid portrait model has no front/back mesh.');

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
    characterBuildStatus.stage = 'neck-rig';
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
    frontPivot.rotation.y = Math.PI / 2; // Bind pants in the same rest orientation used by gameplay and corpse rendering.
    backPivot.rotation.y = -Math.PI / 2;
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
    group.userData.armLength = portrait.userData?.armLength ?? null; // Anatomical reach retained independently from weapon pose scaling.
    group.userData.scaledArmLength = portrait.userData?.scaledArmLength ?? null; // Rendered-space reach retained for non-combat anatomy consumers.
    group.userData.poseOrbitScale = portrait.userData?.poseOrbitScale ?? 1; // Explicit species+gender weapon-orbit multiplier.
    group.userData.poseOrbitAxes = portrait.userData?.poseOrbitAxes ?? null; // Per-axis { x, y, z } orbit; null on legacy portraits.
    group.userData.speciesId = portrait.userData?.speciesId || roster.appearance.speciesId; // Used by shared vertical pose-height mapping after the portrait is converted into the bandit group.
    group.userData.gender = portrait.userData?.gender || roster.appearance.gender; // Paired with speciesId for the same shared pose-height lookup.
    group.userData.handAttachX = portrait.userData?.handAttachX; // Preserves the scanned raw hand anchor for melee/ranged pose mapping.
    group.userData.handAttachY = portrait.userData?.handAttachY; // Preserves the scanned raw hand anchor for melee/ranged pose mapping.
    group.userData.visualCentroidLocalY = portrait.userData?.visualCentroidLocalY ?? 0; // Converted bandit group remains center-anchored, so this is its visual-center offset.
    group.userData.poseCentroidY = portrait.userData?.poseCentroidY ?? (modelHeight * 0.5);
    const legsPivot = new THREE.Group();
    legsPivot.name = 'bandit_legs_pivot';
    legsPivot.position.y = -(modelHeight / 2);
    group.add(legsPivot);
    const legsFrame = new THREE.Group(); // Converts the NPC leg rig's portrait-local axes into the enemy's side-facing convention.
    legsFrame.name = 'bandit_legs_frame';
    legsFrame.rotation.y = Math.PI / 2;
    legsPivot.add(legsFrame);
    const handsPivot = new THREE.Group(); // Floor-relative parent for procedural hands, matching the leg rig's center-anchored-hostile correction.
    handsPivot.name = 'bandit_hands_pivot';
    handsPivot.position.y = -(modelHeight / 2);
    group.add(handsPivot);
    portrait.position.set(0, -(modelHeight / 2), 0); // The original PNGPlaneAvatar root is now a metadata/hand-driver sentinel at the hostile's true floor origin.
    portrait.userData.proceduralHandParent = handsPivot; // ProceduralHandFrameDriver attaches rendered hands to this visible hostile hierarchy instead of the discarded portrait assembly.
    group.add(portrait); // Its front/back meshes were already extracted above, so parenting it enables hand discovery without double-rendering the portrait.
    // legsPivot's rotation.y is kept in sync with the same pngRot-derived
    // planeDelta the front/back planes use (see updateCreatureMesh), not
    // group's own free-tracking groupRot -- so the legs share whichever
    // dead-zone behavior currently governs the visible sprite (see
    // CREATURE_PLANE_ROT_MODE) instead of drifting out of sync with it,
    // same clipping fix applied to the mounted-rider case.
    characterBuildStatus.stage = 'leg-rig';
    const legs = window.ProceduralLegAnimation?.attach(THREE, legsFrame, {
      speciesId: roster.appearance.speciesId, gender: roster.appearance.gender,
      bodyColors: profile?.bodyColors || roster.appearance.bodyColors,
      modelWidth, modelHeight, handAttachY: portrait.userData?.handAttachY,
      name: roster.name || 'bandit', profile, portraitSize: PORTRAIT_SIZE,
    }) || null;

    const enemyPants = window.PantsGarmentRenderer?.garmentForCosmetics(roster.equippedCosmetics); // Same rig, dyes, update and disposal owner as town NPCs.
    if (legs && enemyPants) {
      frontPivot.userData.portraitModelWidth = modelWidth;
      frontPivot.userData.portraitModelHeight = modelHeight;
      const pants = window.PantsGarmentRenderer.attachToLegs(THREE, legs, { // Finish creating the mesh before downstream ghost/ghoul material conversion.
        avatarGroup: frontPivot, speciesId: roster.appearance.speciesId, gender: roster.appearance.gender, // Follow the portrait's facing/death pivot while sampling the sibling leg rig in world space.
        name: roster.name || 'enemy', garmentId: enemyPants,
        appearance: window.PantsGarmentRenderer.appearanceFromBodyColors(profile.bodyColors),
        overlayMask: window.PantsGarmentRenderer.buildOverlayMask(frontCanvas, profile, { forceEyesOpen: true }),
      });
      characterBuildStatus.pantsAttached = !!pants && await pants.readyPromise;
    }

    return {
      group, frontPlane: frontPivot, backPlane: backPivot, legsPivot, legs,
      handsPivot, handRigAvatarRoot: portrait, textureRoot: portrait, resolvedRosterDyes,
      frontCanvas, backCanvas, neutralFrontCanvas, combatFrownCanvas, profile,
      combatExpressionActive: false,
      modelWidth, modelHeight,
      speciesId: portrait.userData?.speciesId || roster.appearance.speciesId,
      gender: portrait.userData?.gender || roster.appearance.gender,
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
      armLength: portrait.userData?.armLength,
      poseOrbitScale: portrait.userData?.poseOrbitScale ?? 1,
      poseOrbitAxes: portrait.userData?.poseOrbitAxes ?? null,
      visualCentroidLocalY: portrait.userData?.visualCentroidLocalY ?? 0,
      poseCentroidY: portrait.userData?.poseCentroidY ?? (modelHeight * 0.5),
      dispose() {
        legs?.dispose();
        frontNeckSkin?.weightedGeometry?.dispose();
        backNeckSkin?.weightedGeometry?.dispose();
        frontNeckSkin?.skeleton?.dispose?.();
        backNeckSkin?.skeleton?.dispose?.();
        // The original portrait root is intentionally retained as the procedural-hand driver's registered avatarRoot.
        // Dispose it explicitly first so its hand rig/sentinel are released before the converted visible hostile group.
        portrait.parent?.remove?.(portrait);
        window.PNGPlaneAvatar.disposeAvatarModel?.(portrait);
        window.PNGPlaneAvatar.disposeAvatarModel?.(group);
      },
    };
  }

  // Compound hostile avatar: the whole PNGPlaneAvatar root (a floor-origin
  // group owning the rider portrait, its hand frame and the animal halves)
  // sits inside frontPivot. That pivot receives the same rotations
  // updateCreatureMesh/creature-death give a portrait plane, so facing, lean
  // and corpse tipping carry the compound unchanged; backPivot stays empty
  // because the rider portrait already renders its own back face.
  function buildCompoundBanditAvatar(portrait, { roster, profile, resolvedRosterDyes, frontCanvas, backCanvas, neutralFrontCanvas, combatFrownCanvas, MODEL_W }) {
    const upper = portrait.userData.proceduralBodyRoot; // Rider portrait root; owns the textures the combat frown refreshes.
    const riderFrame = portrait.userData.proceduralHandParent; // Floor-relative rider frame the procedural hands already attach to.
    const modelWidth = upper.userData?.portraitModelWidth || MODEL_W;
    const modelHeight = upper.userData?.portraitModelHeight || MODEL_W;
    const group = new THREE.Group();
    group.name = 'bandit_avatar_group';
    const frontPivot = new THREE.Group(); frontPivot.name = 'bandit_front_plane';
    const backPivot = new THREE.Group(); backPivot.name = 'bandit_back_plane';
    portrait.position.set(0, -(modelHeight / 2), 0); // The hostile group is center-anchored; the compound root is a floor origin.
    frontPivot.add(portrait);
    group.add(frontPivot);
    group.add(backPivot);
    group.userData.portraitModelWidth = modelWidth;
    group.userData.portraitModelHeight = modelHeight;
    group.userData.portraitVerticalPlacementRatio = upper.userData?.portraitVerticalPlacementRatio ?? 0.5;
    group.userData.portraitScaleMultiplier = upper.userData?.portraitScaleMultiplier ?? 1;
    group.userData.armLength = upper.userData?.armLength ?? null;
    group.userData.scaledArmLength = upper.userData?.scaledArmLength ?? null;
    group.userData.poseOrbitScale = upper.userData?.poseOrbitScale ?? 1;
    group.userData.poseOrbitAxes = upper.userData?.poseOrbitAxes ?? null;
    group.userData.speciesId = portrait.userData?.speciesId || roster.appearance.speciesId;
    group.userData.gender = portrait.userData?.gender || roster.appearance.gender;
    group.userData.handAttachX = upper.userData?.handAttachX;
    group.userData.handAttachY = upper.userData?.handAttachY;
    group.userData.visualCentroidLocalY = upper.userData?.visualCentroidLocalY ?? 0;
    group.userData.poseCentroidY = upper.userData?.poseCentroidY ?? (modelHeight * 0.5);
    return {
      group, frontPlane: frontPivot, backPlane: backPivot, legsPivot: null, legs: null,
      handsPivot: null, handRigAvatarRoot: portrait, textureRoot: upper, resolvedRosterDyes,
      riderMount: { root: portrait, upper, riderFrame }, // Weapon holders are world objects; applyRiderMount moves them onto the mounted rider.
      frontCanvas, backCanvas, neutralFrontCanvas, combatFrownCanvas, profile,
      combatExpressionActive: false,
      modelWidth, modelHeight,
      speciesId: group.userData.speciesId,
      gender: group.userData.gender,
      neckJoint: null, // The rider portrait has no auto neck skin; the head-look system no-ops.
      handAttachX: upper.userData?.handAttachX,
      handAttachY: upper.userData?.handAttachY,
      armLength: upper.userData?.armLength,
      poseOrbitScale: upper.userData?.poseOrbitScale ?? 1,
      poseOrbitAxes: upper.userData?.poseOrbitAxes ?? null,
      visualCentroidLocalY: group.userData.visualCentroidLocalY,
      poseCentroidY: group.userData.poseCentroidY,
      dispose() {
        portrait.parent?.remove?.(portrait);
        window.PNGPlaneAvatar.disposeAvatarModel?.(portrait); // Compound disposer releases refcounted animal textures and the hand rig.
        window.PNGPlaneAvatar.disposeAvatarModel?.(group);
      },
    };
  }

  // Weapon poses are solved for a standing humanoid whose floor is the hostile
  // group's floor. A mounted rider stands on its saddle instead, scaled, and
  // offset forward/sideways inside the compound root; re-express the finished
  // holder point about that rider floor so the procedural hands reach it.
  function applyRiderMount(c, holder) {
    const mount = c?.avatarRef?.riderMount;
    const group = c?.avatarRef?.group;
    if (!mount || !holder || !group) return false;
    const { root, upper, riderFrame } = mount;
    const scale = Number(upper.scale?.x) || 1;
    const localX = upper.position.x * (root.scale?.x || 1);
    const localZ = upper.position.z * (root.scale?.z || 1);
    const localY = upper.position.y + (Number(riderFrame?.position?.y) || 0) * scale;
    const yaw = (group.rotation.y || 0) + (c.avatarRef.frontPlane?.rotation?.y || 0); // Compound root yaw in world space.
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const floorY = group.position.y - (c.halfHeight || 0);
    const p = holder.position;
    const dx = p.x - group.position.x, dy = p.y - floorY, dz = p.z - group.position.z;
    p.set(
      group.position.x + localX * cos + localZ * sin + dx * scale,
      floorY + localY + dy * scale,
      group.position.z - localX * sin + localZ * cos + dz * scale,
    );
    holder.scale.multiplyScalar(scale);
    return true;
  }

  function copyBanditExpressionCanvas(target, source) {
    if (!target?.getContext || !source) return false;
    const ctx = target.getContext('2d'); // Live portrait canvas receives a complete pre-baked face in one synchronous draw before any movement afterimage can sample it.
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(source, 0, 0, target.width, target.height);
    return true;
  }

  function setCombatExpression(entity, active) {
    const avatarRef = entity?.avatarRef;
    const next = !!active;
    if (!avatarRef?.frontCanvas || avatarRef.combatExpressionActive === next) return false;
    const source = next ? avatarRef.combatFrownCanvas : avatarRef.neutralFrontCanvas; // Combat uses frown; leaving combat restores the exact spawn portrait rather than assuming neutral authoring.
    if (!copyBanditExpressionCanvas(avatarRef.frontCanvas, source)) return false;
    const textureRoot = avatarRef.textureRoot || avatarRef.handRigAvatarRoot; // Original PNGPlaneAvatar root still owns the texture objects shared by the extracted visible hostile meshes.
    if (!window.PNGPlaneAvatar?.refreshSinglePlaneAvatarModel?.(textureRoot, avatarRef.frontCanvas, { backCanvas: avatarRef.backCanvas })) return false;
    avatarRef.combatExpressionActive = next;
    entity._combatExpression = next ? 'frown' : 'rest'; // Mobile/debug-readable state proving the visible hostile portrait has switched.
    return true;
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
  const BANDIT_RANK_LABEL = { grunt: 'Bandit', flasker: 'Bandit Flasker', lieutenant: 'Bandit Lieutenant', captain: 'Bandit Captain' };
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
  function banditWeaponShapeKeys(cfg) {
    const allWeaponShapes = Object.keys(deps.HELD_SHAPE_DEFS).filter(k => deps.HELD_SHAPE_DEFS[k].slots?.includes('weapon')); // Canonical fallback pool used by ordinary bandits exactly as before.
    const configuredPool = Array.isArray(cfg?.weaponShapePool) ? cfg.weaponShapePool : null; // Optional caller-scoped subset used by special humanoid enemies such as arena Harlyao Skeletons.
    if (!configuredPool?.length) return allWeaponShapes;
    const allowed = new Set(configuredPool); // Used only for this selection pass so invalid/non-weapon shape ids are ignored safely.
    const filtered = [...allowed].filter(shapeKey => deps.HELD_SHAPE_DEFS[shapeKey]?.slots?.includes('weapon')); // Explicit minion pools validate definitions directly, without the ordinary bandit enumeration filter. // Final validated melee pool consumed by banditWeaponFor().
    return filtered.length ? filtered : allWeaponShapes;
  }
  function banditWeaponFor(cfg, rank, tier) {
    const shapeKeys = banditWeaponShapeKeys(cfg); // Caller-specific pool when supplied; otherwise the unchanged full weapon-slot pool.
    const shapeKey = shapeKeys[Math.floor(deps.rnd() * shapeKeys.length)]; // Selected melee shape used for held rendering, attacks, and ability style.
    const shape = deps.HELD_SHAPE_DEFS[shapeKey]; // Canonical shape metadata supplies damage type and animation semantics.
    const configuredMetalKey = typeof cfg?.weaponMetalKey === 'string' && deps.METAL_DEFS[cfg.weaponMetalKey] ? cfg.weaponMetalKey : null; // Optional fixed material used by special callers; null preserves rank/tier metal rolling.
    const [minT, maxT] = cfg?.weaponMetalTierRangeByRank?.[rank] || [1, 2];
    const bonusT = tier;
    const maxMetalTier = Math.max(...deps.VERDIGRIS_METAL_KEYS.map(k => deps.METAL_DEFS[k].tier));
    const loT = deps.clamp(Math.round(minT), 1, maxMetalTier), hiT = deps.clamp(Math.round(maxT) + bonusT, loT, maxMetalTier);
    const tierPool = deps.VERDIGRIS_METAL_KEYS.filter(k => deps.METAL_DEFS[k].tier >= loT && deps.METAL_DEFS[k].tier <= hiT);
    const rolledMetalKey = (tierPool.length ? tierPool : deps.VERDIGRIS_METAL_KEYS)[Math.floor(deps.rnd() * (tierPool.length || deps.VERDIGRIS_METAL_KEYS.length))]; // Existing rank/tier material roll retained for ordinary bandits.
    const metalKey = configuredMetalKey || rolledMetalKey; // Final material passed to item-key generation and damage scaling.
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

  function availableBanditFlaskRecipeIds() {
    return Object.values(window.AlchemySystem?.RECIPE_DEFS || {})
      .filter(definition => definition?.useMode === 'throw')
      .map(definition => definition.id);
  }

  function rollBanditFlaskLoadout(cfg) {
    const available = availableBanditFlaskRecipeIds(); // Used to keep Flaskers automatically in sync with every authored throwable Afflict recipe.
    const requested = Math.max(1, Math.floor(Number(cfg?.flasker?.loadoutSize) || 2)); // Used to author loadout size in the existing bandit config.
    const pool = [...available]; // Per-bandit copy used for sampling without replacement.
    const picked = []; // Used by AI and corpse loot; exactly two entries with the current authored tuning when possible.
    while (picked.length < requested && pool.length) {
      const index = Math.min(pool.length - 1, Math.floor((deps?.rnd?.() ?? Math.random()) * pool.length));
      picked.push(pool.splice(index, 1)[0]);
    }
    return picked;
  }

  function banditFlaskerTuning(cfg) {
    const authored = cfg?.flasker || {}; // Single tuning authority shared by AI and corpse-loot metadata.
    return {
      loadoutSize: Math.max(1, Math.floor(Number(authored.loadoutSize) || 2)),
      minThrowRangeTiles: Math.max(0.5, Number(authored.minThrowRangeTiles) || 2.25),
      maxThrowRangeTiles: Math.max(2, Number(authored.maxThrowRangeTiles) || 10),
      throwCooldownSeconds: Math.max(0.25, Number(authored.throwCooldownSeconds) || 2.35),
      lootMinPerType: Math.max(1, Math.floor(Number(authored.lootMinPerType) || 2)),
      lootMaxPerType: Math.max(1, Math.floor(Number(authored.lootMaxPerType) || 4)),
    };
  }

  function updateBanditFlaskAI(c, dt, targetPlayer, distToPlayer) {
    if (c?.banditRank !== 'flasker') return null;
    const loadout = c.def?.banditFlaskLoadout || []; // Two recipe ids rolled once for this Flasker and never consumed by AI use.
    if (!loadout.length || !window.AlchemyFlasks?.throwFromEntity) return null;
    const tuning = c.def?.banditFlaskerTuning || banditFlaskerTuning(null); // Spawn-authored tuning survives config reloads consistently with other bandit defs.
    const towardAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x); // Used to keep the hostile facing its current flask target during the shared staged throw.
    const minRangePx = tuning.minThrowRangeTiles * deps.TILE; // Inside this range Flaskers fall back to their normal melee weapon.
    const maxRangePx = tuning.maxThrowRangeTiles * deps.TILE; // Outside this range ordinary bandit approach logic closes distance first.
    c._banditFlaskCooldownT = Math.max(0, (c._banditFlaskCooldownT || 0) - dt);

    if (c._banditFlaskActionActive) {
      c.facing = towardAngle;
      return { handled: true, aimAngle: towardAngle, moving: false, flasker: true };
    }

    if (c._banditAction || c._banditLunging || c.retreatT > 0) return null; // Existing melee/recovery owns the actor until it finishes.
    if (distToPlayer < minRangePx || distToPlayer > maxRangePx) return null;
    if (c._banditFlaskCooldownT > 0) {
      c.facing = towardAngle;
      return { handled: true, aimAngle: towardAngle, moving: false, flasker: true };
    }

    const recipeId = loadout[c._banditFlaskIndex % loadout.length]; // Alternates the two persistent loadout types instead of randomly starving one.
    c._banditFlaskIndex = (c._banditFlaskIndex + 1) % Math.max(1, loadout.length);
    const throwAnimation = window.HeldActionAnimations?.throwFlask || window.HeldActionAnimations?.weaponThrowSpin; // Exact player/Attack-Editor hatchet throw is both pose and timing authority.
    if (!throwAnimation?.poses || !window.Combat?.beginStagedAction) return null;
    const durationS = Math.max(0.2, Number(throwAnimation.durationS) || 1.04); // Used for the same total throw cadence authored in the Attack Editor.
    const windupS = Math.max(0.12, durationS * Math.max(0.05, Math.min(0.95, Number(throwAnimation.windupFrac) || 0.49))); // Projectile release begins where the shared hatchet animation enters its strike.
    const strikeS = Math.max(0.05, durationS - windupS); // Keeps the authored strike/follow-through visible after release.
    c._banditFlaskPendingRecipeId = recipeId;
    c._banditFlaskAnimationKey = 'throwFlask'; // Mobile/debug proof of the shared animation identity.
    c._banditFlaskActionActive = true; // Used by the tool renderer to swap the melee weapon for the held flask during this staged action.
    c._banditSwingAnim = throwAnimation.style || 'chop'; // updateBanditToolMesh consumes the exact shared animation style instead of a Flasker-only pose approximation.
    c._banditSwingPose = throwAnimation.poses; // Exact authored neutral/windup/strike poses from HeldActionAnimations.throwFlask.
    c._banditSwingDirSign = 1;
    c._banditSwingPower = 1;
    c._banditSwingPoseScale = 1;
    c._banditSwingWindupCurve = null;
    c.telegraphState = 'windup';
    c.facing = towardAngle;
    c._banditAction = window.Combat.beginStagedAction({
      windupS, strikeS, recoverS: 0,
      data: { isBandit: true, attacker: c, flasker: true, recipeId, animationKey: 'throwFlask' },
      onStrike: () => {
        const pendingRecipeId = c._banditFlaskPendingRecipeId || recipeId; // Captured at windup start so alternating order cannot change mid-throw.
        c._banditFlaskPendingRecipeId = null;
        const launched = window.AlchemyFlasks.throwFromEntity(c, pendingRecipeId, c.def?.banditFlaskPotencyTier || 0, targetPlayer.x, targetPlayer.y);
        c.telegraphState = launched ? 'strike' : null;
      },
      onComplete: () => {
        c._banditFlaskActionActive = false;
        c._banditFlaskCooldownT = tuning.throwCooldownSeconds;
        finishBanditAction(c);
      },
      onCancel: () => {
        c._banditFlaskActionActive = false;
        c._banditFlaskPendingRecipeId = null;
        c._banditFlaskCooldownT = Math.min(0.5, tuning.throwCooldownSeconds);
        finishBanditAction(c);
      },
    });
    return { handled: true, aimAngle: towardAngle, moving: false, flasker: true };
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
    const isFlasker = rank === 'flasker'; // Used to reserve this rank's ranged role for its infinite two-flask loadout.
    const rangedWeaponKey = isFlasker ? null : banditRangedWeaponFor(cfg, rank);
    const banditFlaskLoadout = isFlasker ? rollBanditFlaskLoadout(cfg) : []; // Per-entity definition; uses never decrement it.
    const flaskerTuning = isFlasker ? banditFlaskerTuning(cfg) : null; // Shared AI/loot tuning stored with this spawned hostile.
    const shapeStats = window.WeaponShapeStats?.forShape?.(weapon.shapeKey) || { power: 1, speed: 1, range: 1, efficiency: 1 }; // NPCs use the same physical shape stats as player weapons.
    const dmgMul = statMul * (1 + mastery * BANDIT_MASTERY_DAMAGE_PER_LEVEL) * weapon.dmgMultiplier * shapeStats.power;
    const held = Number(cfg?.heldAbilitiesByRank?.[rank] ?? 0);
    return {
      label: BANDIT_RANK_LABEL[rank] || 'Bandit',
      hostile: true, liveBirth: true,
      maxHealth: Math.max(1, Math.round(BANDIT_BASE_MAX_HEALTH * statMul)),
      maxStamina: Math.max(1, Math.round(BANDIT_BASE_MAX_STAMINA * statMul)),
      moveSpeed: 118 + tier * 4,
      chaseSpeed: 165 + (rank === 'captain' ? 20 : rank === 'lieutenant' ? 10 : 0) + tier * 5,
      attackDamage: Math.max(1, Math.round(BANDIT_BASE_ATTACK_DAMAGE * dmgMul)),
      attackRangePx: deps.TILE * BANDIT_ATTACK_RANGE_TILES * shapeStats.range,
      attackHalfConeRad: Math.min(Math.PI, BANDIT_ATTACK_HALF_CONE_DEG * Math.PI / 180 * shapeStats.range),
      attackStaminaCost: BANDIT_ATTACK_STAMINA_COST / shapeStats.efficiency,
      attackCooldownS: (rank === 'captain' ? BANDIT_ATTACK_COOLDOWN_S_CAPTAIN : BANDIT_ATTACK_COOLDOWN_S_OTHER) / shapeStats.speed,
      attackTag: weapon.dmgType,
      weaponKey: weapon.weaponKey,
      weaponShapeStats: shapeStats, // Used below to keep NPC attack windups, lunges and affliction delivery in sync.
      rangedWeaponKey,
      banditFlaskLoadout,
      banditFlaskerTuning: flaskerTuning,
      banditFlaskPotencyTier: isFlasker ? Math.max(0, Math.min(4, tier)) : 0, // Used for both infinite AI throws and the matching corpse drops.
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

  function resolvedBanditCombatTarget(c, fallbackTarget) {
    const target = c?._chunkCombatTarget; // Set only by the tribe camps' active-player-chunk ecology pass.
    if (!target) return fallbackTarget;
    const alive = Number(target.health) > 0;
    const sameArea = !target.areaId || !c?.areaId || target.areaId === c.areaId;
    if (alive && sameArea) return target;
    c._chunkCombatTarget = null;
    return fallbackTarget;
  } // Keeps ordinary player combat unchanged whenever no local faction target is assigned.
  function damageBanditCombatTarget(c, target, amount, fromX, fromY, knockbackPxS, opts = {}) {
    const actorTarget = target && (
      target.isBandit === true
      || target.isPorakanekiHunter === true
      || target.banditCompanion === true
      || typeof target.creatureKey === 'string'
    ); // Staged swings keep the actor classification even if the 5 Hz ecology pass changes c._chunkCombatTarget before impact.
    if (actorTarget && typeof deps.damageCreature === 'function') {
      return deps.damageCreature(target, amount, fromX, fromY, knockbackPxS, {
        ...opts,
        friendlyFire: true,
        factionCombat: true,
        attacker: c,
      });
    }
    return deps.damagePlayer(amount, fromX, fromY, knockbackPxS, { ...opts, attacker: c });
  } // Bandit ability code is shared by bandit-vs-player and chunk-local actor-vs-actor fights.

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
    const targetFacing = Number.isFinite(Number(targetPlayer.angle)) ? Number(targetPlayer.angle) : (Number(targetPlayer.facing) || 0); // Creatures use facing; the player uses angle.
    const forwardX = Math.cos(targetFacing), forwardY = Math.sin(targetFacing);
    const behindDot = forwardX * (dxBP / distBP) + forwardY * (dyBP / distBP);
    const staminaForCondition = window.ResourceSystem?.getDepletionEquivalentCurrent?.(targetPlayer, 'stamina') ?? targetPlayer.stamina; // Mirrors the player's Exhaust Cutter semantics for enemy ability AI.
    const healthForCondition = window.ResourceSystem?.getDepletionEquivalentCurrent?.(targetPlayer, 'health') ?? targetPlayer.health; // Mirrors the player's Mercy Spike semantics for enemy ability AI.
    return {
      enemyStriking: false,
      exhausted: !!targetPlayer.exhaustion?.active || staminaForCondition <= targetPlayer.maxStamina * 0.20,
      behind: behindDot < -0.35,
      lowHealth: targetPlayer.health > 0 && healthForCondition <= targetPlayer.maxHealth * 0.30,
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
    const action = c._banditAction;
    c._banditAction = null;
    c.telegraphState = null;
    if (!c._banditLunging) c._banditLungeHopCurrent = 0;
    // The player's swing doesn't stop when its strike lands: it holds the strike pose, then eases back to
    // neutral (game.js triggerWeaponSwingVisual). A COMPLETED melee action hands its swing to a tail that
    // updateBanditToolMesh keeps playing on the same shared clock (SharedAttackPose.swingTimeline) before
    // resetting to the weapon's rest stance. A cancelled action (staggered mid-windup) and a Flasker throw
    // reset immediately, as before.
    if (action && !action.cancelled && !action.data?.flasker && window.SharedAttackPose) {
      const durationS = Math.max(0.0001, action.windupS + action.strikeS + (Number(c._banditSwingReturnS) || 0));
      c._banditToolTail = {
        startMs: performance.now(),
        baseElapsedS: action.windupS + action.strikeS,
        durationS,
        windupFrac: action.windupS / durationS,
        strikeFrac: (action.windupS + action.strikeS) / durationS,
        holdS: Number(c._banditSwingHoldS) || 0,
      };
      return;
    }
    c._banditToolTail = null;
    resetBanditSwingToNatural(c);
  }

  // Quick Attack and Charged Breaker both hardcode their OWN anim/
  // pose regardless of the equipped weapon ('thrust'/null and
  // 'sweep'/SWEEP_POSE respectively -- see fireBanditQuickAttack/
  // fireBanditChargedBreaker's own comments) and nothing ever set these
  // back afterward -- once ANY bandit used either ability even once, its
  // idle-between-attacks stance got stuck showing that ability's style
  // forever (regardless of its real weapon). Reset unconditionally once
  // the swing (and its tail) is over so "idle" always means the weapon's
  // own natural rest stance, not whatever the last-fired ability wanted.
  function resetBanditSwingToNatural(c) {
    const natural = banditNaturalSwing(c.def);
    c._banditSwingAnim = natural.anim;
    c._banditSwingPose = natural.pose;
    c._banditSwingDirSign = 1;
    c._banditSwingPower = 1;
    c._banditSwingPoseScale = 1; // Used by updateBanditToolMesh to clear any sampled partial Charged Breaker amplitude after the action ends.
    c._banditSwingWindupCurve = null;
    c._banditSwingHoldS = 0;
    c._banditSwingReturnS = 0;
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
    const heavyDistanceMul = window.ResourceSystem?.timedDebuffModifier?.(c, 'dodgeLungeDistance') ?? 1; // Heavy shortens enemy attack lunges without altering their authored windup/strike timing.
    const lungeProfile = window.Combat?.meleeLungeProfile?.(
      distancePx * heavyDistanceMul,
      c._banditAimPitch || 0,
      0,
      c.def?.lungeHeightUnits ?? 1,
      hitTest?.pitchDistanceResistance || 0,
    ) || { distancePx, hopUnits: 0, pitch: c._banditAimPitch || 0 }; // Used to turn high enemy aim into a shorter leap, with per-attack resistance when authored.
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
    c.avatarRef?.legs?.beginLunge?.(c._banditLungeDirX, c._banditLungeDirY);
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
      debug: false, // Per-frame halt probe; recording it would overwrite this bandit's real strike collider in Show Hitboxes.
    }) || false;
  }

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
    // Facing and lunge direction stay fixed after windup begins, leaving a real backstab window.
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

  // Stops a lunge wherever it is (stagger, death, leaving chase). updateBanditLunge
  // only lowers the hop while it runs, so a lunge cut off mid-arc must lower it
  // here or the bandit stays drawn (and collides) in mid-air until its next lunge.
  function cancelBanditLunge(c) {
    if (!c) return;
    c._banditLunging = false;
    c._banditLungeHopCurrent = 0;
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
    const shapeStats = def.weaponShapeStats || window.WeaponShapeStats?.DEFAULT || { power: 1, speed: 1, range: 1, efficiency: 1 }; // Rolled shape drives humanoid combo animations.
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
    const halfConeRad = Math.min(Math.PI, step.halfConeDeg * Math.PI / 180 * shapeStats.range);
    const knockbackPxS = base.knockbackPxS * step.knockbackMul * shapeStats.power;
    const aimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    c.facing = aimAngle;
    c._banditAimPitch = window.Combat?.meleeAimSolution?.(c, targetPlayer, aimAngle, 0)?.pitch || 0; // Used by this enemy's leap, 3D hit cone, and pitched trail. // lunge direction locks off c.facing -- must be fresh, not last frame's
    c.telegraphState = 'windup';
    // The same authored pose the player's combo plays for this step (power already applied), or the step's own.
    const stepPose = window.Combat?.comboStepPose?.(loadout.tap1, step) || null;
    c._banditSwingAnim = step.anim; c._banditSwingPose = stepPose || step.pose || null;
    c._banditSwingDirSign = step.dirSign || 1; c._banditSwingPower = stepPose ? 1 : (step.power || 1);
    c._banditSwingPoseScale = 1; c._banditSwingWindupCurve = null;
    c._banditSwingHoldS = (step.holdS || 0) / shapeStats.speed; c._banditSwingReturnS = (step.returnS || 0) / shapeStats.speed; // Same pause / finisher tail combat-combo.js hands the player's swing visual.
    beginBanditLunge(c, deps.TILE * (step.lungeMul || 1) * (comboData?.LUNGE_SCALE || 1.5), (step.windupS + step.strikeS) / shapeStats.speed, { rangePx, halfConeRad }, targetPlayer);
    // Tracked so onComplete below can tell a whiff from a landed hit --
    // a bandit should only break off (retreat) on a miss or after
    // landing its 3rd/final step, never after landing steps 1-2, which
    // should chain straight into the next step instead.
    let comboStepHit = false;
    c._banditAction = window.Combat.beginStagedAction({
      windupS: step.windupS / shapeStats.speed, strikeS: step.strikeS / shapeStats.speed, recoverS: 0,
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
      data: { isBandit: true, attacker: c, comboId: loadout.tap1, comboStep, sfxPitch, voiceCategory: 'combo', voiceAbilityId: loadout.tap1 },
      onStrike: () => {
        c.telegraphState = 'strike';
        // The hit and trail use the facing frozen when pre-windup alignment completed.
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
          damageBanditCombatTarget(c, targetPlayer, damage, c.x, c.y, knockbackPxS, { tag: def.attackTag, afflictionBonuses: window.CombatAttackEvents?.scaleAfflictions?.(window.ResourceSystem?.afflictionBonusesForTag(def.attackTag), def.weaponShapeStats?.power || 1) || window.ResourceSystem?.afflictionBonusesForTag(def.attackTag) });
          window.AudioSystem?.playWeaponHitSfx(def.attackTag, c.x, c.y, c.areaId, sfxPitch, ['small', 'medium', 'large'][comboStep]);
        }
      },
      onComplete: () => {
        finishBanditAction(c);
        // Break off on a miss (whiffing a swing isn't worth pressing
        // through) or after landing the final step -- a landed step
        // 1-2 chains straight into the next step instead of retreating.
        const shouldRetreat = isFinalStep || !comboStepHit;
        c.attackCooldownT = shouldRetreat ? def.attackCooldownS : BANDIT_COMBO_CHAIN_GAP_S / shapeStats.speed;
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
    const shapeStats = def.weaponShapeStats || window.WeaponShapeStats?.DEFAULT || { power: 1, speed: 1, range: 1, efficiency: 1 }; // Quick-attack timing follows the equipped bandit shape.
    const base = banditAttackBaseline(def);
    // combat-quickattacks.js's own RANGE_SCALE (0.6) shrinks the raw
    // rangeMul-scaled cone -- see the matching comment in
    // fireBanditComboStep, same "read as oversized" fix applies here.
    const rangePx = base.rangePx * tech.rangeMul * (qa.RANGE_SCALE ?? 1);
    const halfConeRad = Math.min(Math.PI, tech.halfConeDeg * Math.PI / 180 * shapeStats.range);
    const aimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    c.facing = aimAngle;
    c._banditAimPitch = window.Combat?.meleeAimSolution?.(c, targetPlayer, aimAngle, 0)?.pitch || 0; // Used by this enemy's leap, 3D hit cone, and pitched trail.
    c.telegraphState = 'windup';
    c._banditSwingAnim = 'thrust'; c._banditSwingPose = qa.quickAttackPose?.() || null; // The player's Quick Attack jab.
    c._banditSwingDirSign = 1; c._banditSwingPower = 1;
    c._banditSwingPoseScale = 1; c._banditSwingWindupCurve = null;
    c._banditSwingHoldS = (qa.HOLD_S || 0) / shapeStats.speed; c._banditSwingReturnS = 0; // Same post-strike pause the player's quick attack swing visual gets.
    beginBanditLunge(c, deps.TILE * (qa.LUNGE_TILE_MUL || 5.5), (qa.WINDUP_S + qa.STRIKE_S) / shapeStats.speed, { rangePx, halfConeRad }, targetPlayer);
    let techHit = false;
    c._banditAction = window.Combat.beginStagedAction({
      windupS: qa.WINDUP_S / shapeStats.speed, strikeS: qa.STRIKE_S / shapeStats.speed, recoverS: 0,
      data: { isBandit: true, attacker: c, voiceCategory: 'quickAttack', voiceAbilityId: loadout.tap2 }, // Shared vocal owner gives NPC quick attacks the same release grunt as the player.
      onStrike: () => {
        c.telegraphState = 'strike';
        // The hit and trail use the facing frozen when pre-windup alignment completed.
        spawnBanditTrailArc(c, rangePx, halfConeRad, c.facing);
        // def.attackTag (the bandit's real weapon material) determines
        // both the affliction and the impact sound -- see
        // combat-quickattacks.js's onTap, which no longer hardcodes
        // 'sharp' regardless of the equipped weapon either.
        if (window.Combat?.meleeHit?.(c, targetPlayer, { rangePx, halfConeRad, yaw: c.facing, pitch: c._banditAimPitch || 0 })) {
          techHit = true;
          const impactTech = window.Combat.buildQuickAttack(techDef, banditQuickAttackConditions(c, targetPlayer), qa.isBonusEffectReady?.(targetPlayer) ?? true); // Target conditions and the shared per-victim bonus cooldown are resolved at actual contact.
          const impactDamage = Math.max(1, Math.round(base.damage * impactTech.damageMul));
          const impactKnockback = base.knockbackPxS * impactTech.knockbackMul * shapeStats.power;
          damageBanditCombatTarget(c, targetPlayer, impactDamage, c.x, c.y, impactKnockback, { tag: def.attackTag, afflictionBonuses: window.CombatAttackEvents?.scaleAfflictions?.(window.ResourceSystem?.afflictionBonusesForTag(def.attackTag), def.weaponShapeStats?.power || 1) || window.ResourceSystem?.afflictionBonusesForTag(def.attackTag) });
          window.AudioSystem?.playWeaponHitSfx(def.attackTag, c.x, c.y, c.areaId, undefined, impactTech.bonusActive ? 'huge' : 'small');
          if (impactTech.bonusActive) {
            qa.beginBonusEffectCooldown?.(targetPlayer, techDef); // NPC versus player, NPC or animal shares the same target-owned bonus gate.
            window.AudioSystem?.playQuickAttackBonusSfx?.(targetPlayer.x, targetPlayer.y, targetPlayer.areaId || c.areaId);
          }
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
    const shapeStats = def.weaponShapeStats || window.WeaponShapeStats?.DEFAULT || { power: 1, speed: 1, range: 1, efficiency: 1 }; // NPCs scale charge windup and strike as one animation.
    const chargeT = 0.5 + deps.rnd() * 0.5; // Bandit charge is expressed in the same Neutral→Windup POSE percentage as the player's.
    const base = banditAttackBaseline(def);
    const damage = Math.max(1, Math.round(base.damage * (cb.DAMAGE_MUL_MIN + (cb.DAMAGE_MUL_MAX - cb.DAMAGE_MUL_MIN) * chargeT)));
    const rangePx = base.rangePx * (cb.RANGE_MUL_MIN + (cb.RANGE_MUL_MAX - cb.RANGE_MUL_MIN) * chargeT);
    const halfConeDeg = cb.HALF_CONE_DEG_MIN + (cb.HALF_CONE_DEG_MAX - cb.HALF_CONE_DEG_MIN) * chargeT;
    const halfConeRad = Math.min(Math.PI, halfConeDeg * Math.PI / 180 * shapeStats.range);
    const knockbackPxS = base.knockbackPxS * (cb.KNOCKBACK_MUL_MIN + (cb.KNOCKBACK_MUL_MAX - cb.KNOCKBACK_MUL_MIN) * chargeT) * shapeStats.power;
    const lungeTileMul = cb.LUNGE_TILE_MUL_MIN + (cb.LUNGE_TILE_MUL_MAX - cb.LUNGE_TILE_MUL_MIN) * chargeT;
    const pitchDistanceResistance = cb.LUNGE_GRAVITY_RESIST_MIN
      + (cb.LUNGE_GRAVITY_RESIST_MAX - cb.LUNGE_GRAVITY_RESIST_MIN) * chargeT;
    const windupS = (cb.holdSecondsForPoseCharge?.(chargeT) ?? (cb.WINDUP_S * chargeT)) / shapeStats.speed;
    const aimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    c.facing = aimAngle;
    c._banditAimPitch = window.Combat?.meleeAimSolution?.(c, targetPlayer, aimAngle, 0)?.pitch || 0;
    c.telegraphState = 'windup';
    c._banditSwingAnim = 'sweep';
    c._banditSwingPose = window.Combat?.poses?.SWEEP_POSE;
    c._banditSwingDirSign = 1;
    c._banditSwingPower = cb.POWER || 1.7;
    c._banditSwingPoseScale = chargeT; // Used by updateBanditToolMesh to show the sampled partial pose without changing the legacy heavy-attack identity field.
    // The player's held windup decelerates (Combat.windupCurve with WINDUP_SLOWDOWN) over MAX_CHARGE_S / weapon speed;
    // this swing covers the first windupS of that curve, so updateBanditToolMesh replays the same shape over this
    // shorter windup. windupS is already divided by speed, so speed goes back in to find how much of the curve it covers.
    const fullChargeS = Number(cb.MAX_CHARGE_S ?? cb.WINDUP_S) || 0;
    c._banditSwingWindupCurve = fullChargeS > 0 && cb.WINDUP_SLOWDOWN > 0
      ? { slowdown: cb.WINDUP_SLOWDOWN, span: Math.min(1, windupS * shapeStats.speed / fullChargeS) }
      : null;
    c._banditSwingHoldS = (cb.HOLD_S || 0) / shapeStats.speed; c._banditSwingReturnS = 0; // Same post-strike pause the player's Charged Breaker release gets.
    // Bandit AI has no literal held input, so it samples a pose charge and
    // derives how long the shared nonlinear windup would need to reach it.
    beginBanditLunge(
      c,
      deps.TILE * lungeTileMul,
      windupS + cb.STRIKE_S / shapeStats.speed,
      { rangePx, halfConeRad, pitchDistanceResistance },
      targetPlayer,
    );
    let techHit = false;
    c._banditAction = window.Combat.beginStagedAction({
      windupS,
      strikeS: cb.STRIKE_S / shapeStats.speed,
      recoverS: 0,
      data: { isBandit: true, attacker: c, voiceCategory: 'offensiveHold', voiceAbilityId: 'chargedBreaker' },
      onStrike: () => {
        c.telegraphState = 'strike';
        spawnBanditTrailArc(c, rangePx, halfConeRad, c.facing);
        if (window.Combat?.meleeHit?.(c, targetPlayer, {
          rangePx, halfConeRad, yaw: c.facing, pitch: c._banditAimPitch || 0,
        })) {
          techHit = true;
          damageBanditCombatTarget(c, targetPlayer, damage, c.x, c.y, knockbackPxS, {
            tag: def.attackTag,
            heavy: true,
            afflictionBonuses: window.CombatAttackEvents?.scaleAfflictions?.(window.ResourceSystem?.afflictionBonusesForTag(def.attackTag), def.weaponShapeStats?.power || 1) || window.ResourceSystem?.afflictionBonusesForTag(def.attackTag),
          });
          window.AudioSystem?.playWeaponHitSfx(def.attackTag, c.x, c.y, c.areaId, undefined, 'huge');
        }
      },
      onComplete: () => {
        finishBanditAction(c);
        c.attackCooldownT = def.attackCooldownS;
        c.retreatT = banditRetreatDurationS(techHit ? 1 : 0);
        c._banditComboIndex = 0;
        c._banditHold1CdT = BANDIT_HOLD1_COOLDOWN_S / shapeStats.speed;
      },
      onCancel: () => finishBanditAction(c),
    });
    if (c._banditSwingWindupCurve) c._banditSwingWindupCurve.action = c._banditAction; // The curve belongs to this one windup only.
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
    const halfConeRad = Math.min(Math.PI, cs.COUNTER_HALF_CONE_DEG * Math.PI / 180 * (def.weaponShapeStats?.range || 1));
    const knockbackPxS = base.knockbackPxS * cs.COUNTER_KNOCKBACK_MUL * (def.weaponShapeStats?.power || 1);
    const aimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    const aimPitch = window.Combat?.meleeAimSolution?.(c, targetPlayer, aimAngle, 0)?.pitch || 0; // Used by the counter's 3D cone and ribbon.
    // Deliberately doesn't touch c._banditAction (a captain can be
    // mid-combo when guarded damage triggers this) or c._banditSwing* --
    // the riposte's own 0.2s swing is brief enough that skipping its
    // dedicated weapon-pose animation (rather than adding a second
    // parallel progress channel just for this) is an acceptable gap.
    window.Combat.beginStagedAction({
      windupS: 0.05 / (def.weaponShapeStats?.speed || 1), strikeS: 0.15 / (def.weaponShapeStats?.speed || 1), recoverS: 0, // NPC counterstrike duration follows its weapon shape instead of a fixed 0.2s.
      data: { isBandit: true, attacker: c, voiceCategory: 'quickAttack', voiceAbilityId: 'counterShield' }, // Counter ripostes are active NPC voice events too.
      onStrike: () => {
        // def.attackTag (bandit's real weapon material) drives both the
        // affliction and the impact sound -- matches
        // combat-counter-shield.js's own riposte fix (no longer
        // hardcodes 'sharp' regardless of weapon).
        spawnBanditTrailArc(c, rangePx, halfConeRad, aimAngle, aimPitch);
        if (window.Combat?.meleeHit?.(c, targetPlayer, { rangePx, halfConeRad, yaw: aimAngle, pitch: aimPitch })) {
          damageBanditCombatTarget(c, targetPlayer, damage, c.x, c.y, knockbackPxS, { tag: def.attackTag, afflictionBonuses: window.CombatAttackEvents?.scaleAfflictions?.(window.ResourceSystem?.afflictionBonusesForTag(def.attackTag), def.weaponShapeStats?.power || 1) || window.ResourceSystem?.afflictionBonusesForTag(def.attackTag) });
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
        const cbLungeMul = cb.LUNGE_TILE_MUL_MIN + (cb.LUNGE_TILE_MUL_MAX - cb.LUNGE_TILE_MUL_MIN) * chargeT;
        const cbLungePx = deps.TILE * cbLungeMul;
        const cbWindupS = (cb.holdSecondsForPoseCharge?.(chargeT) ?? (cb.WINDUP_S * chargeT)) / (def.weaponShapeStats?.speed || 1);
        reach = Math.min(reach, banditAbilitySafeReachPx(cbRangePx, cbLungePx, cbWindupS, cb.STRIKE_S));
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

  function claimBanditAttackSlot(c, towardAngle, target) {
    for (let i = _banditAttackSlots.length - 1; i >= 0; i--) {
      const s = _banditAttackSlots[i];
      if (s.bandit.health <= 0 || s.bandit.state !== 'chase' || !s.bandit.avatarRef?.group?.parent) _banditAttackSlots.splice(i, 1);
    }
    const existing = _banditAttackSlots.find(s => s.bandit === c);
    if (existing?.target === target) return existing;
    if (existing) _banditAttackSlots.splice(_banditAttackSlots.indexOf(existing), 1); // Switching opponents releases the previous fight's slot.
    const competing = _banditAttackSlots.filter(s => s.bandit.areaId === c.areaId && s.target === target); // Only this active target/area shares attack slots; old encounters cannot starve mine ghouls.
    if (competing.length >= BANDIT_MAX_ATTACK_SLOTS) return null;
    let angle = towardAngle;
    for (const s of competing) {
      if (Math.abs(deps.angleDiff(angle, s.angle)) < BANDIT_SLOT_MIN_ANGLE_RAD) angle = s.angle + Math.PI;
    }
    const slot = { bandit: c, target, angle };
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

  function claimBanditQueueRing(c, towardAngle, target) {
    for (let i = _banditQueueRings.length - 1; i >= 0; i--) {
      const q = _banditQueueRings[i];
      if (q.bandit.health <= 0 || q.bandit.state !== 'chase' || !q.bandit.avatarRef?.group?.parent) _banditQueueRings.splice(i, 1);
    }
    const existing = _banditQueueRings.find(q => q.bandit === c);
    if (existing?.target === target) return existing;
    if (existing) _banditQueueRings.splice(_banditQueueRings.indexOf(existing), 1); // Reassign the waiting ring when a creature changes combat target.
    const countByRing = [];
    for (const q of _banditQueueRings) if (q.bandit.areaId === c.areaId && q.target === target) countByRing[q.ringIndex] = (countByRing[q.ringIndex] || 0) + 1;
    let ringIndex = 0;
    while ((countByRing[ringIndex] || 0) >= BANDIT_QUEUE_RING_CAPACITY) ringIndex++;
    // Spread bandits already on this same ring apart by angle -- not a
    // hard minimum-separation lock like attack slots (queue rings don't
    // need that guarantee), just an even starting spacing so a ring
    // doesn't spawn its members all bunched at the same bearing.
    const onRing = _banditQueueRings.filter(q => q.ringIndex === ringIndex && q.bandit.areaId === c.areaId && q.target === target);
    const slice = Math.PI * 2 / (BANDIT_QUEUE_RING_CAPACITY + 1);
    let angle = towardAngle;
    for (const q of onRing) {
      if (Math.abs(deps.angleDiff(angle, q.angle)) < slice) angle += slice;
    }
    const rec = { bandit: c, target, ringIndex, angle };
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

  // Bandits frequently request two personal-space nudges each frame. Index the whole
  // hostile collection once per short simulation window, then inspect local buckets
  // instead of scanning every hostile for each bandit (quadratic in crowded towns).
  // Bucket size is twice the avoidance radius; a 3×3 neighborhood also tolerates
  // normal within-frame movement before the next refresh. Always use live positions
  // for the actual push so neither the distance nor the order-dependent nudge is stale.
  const banditSpacingBuckets = new Map(); // Buckets contain WeakRefs, never owning unloaded actor/avatar graphs.
  const banditSpacingRefs = new WeakMap(); // Reuse the same WeakRef per actor instead of allocating one every rebuild.
  const banditSpacingOrder = new WeakMap(); // The spatial cache must not retain retired combatants.
  const banditSpacingCandidates = []; // Reused scratch avoids a fresh neighbors array per bandit/frame.
  const banditSpacingSeen = new Set(); // Avoid duplicate candidates when a push crosses cells.
  function compareBanditSpacingOrder(a, b) { return banditSpacingOrder.get(a) - banditSpacingOrder.get(b); }
  let banditSpacingBuiltAt = -Infinity;
  let banditSpacingCollection = null;
  let banditSpacingCount = -1;
  let banditSpacingCellSize = 0;
  const BANDIT_SPACING_REFRESH_MS = 12;

  function refreshBanditSpacingBuckets(personalSpacePx) {
    const hostiles = deps.hostileObjects;
    const count = hostiles?.size ?? hostiles?.length ?? 0;
    const cellSize = Math.max(1, personalSpacePx * 2);
    const tick = performance.now();
    if (banditSpacingCollection === hostiles && banditSpacingCount === count
      && banditSpacingCellSize === cellSize && tick - banditSpacingBuiltAt < BANDIT_SPACING_REFRESH_MS) return;
    banditSpacingBuckets.clear();
    let order = 0;
    for (const hostile of hostiles || []) {
      if (!hostile?.isBandit || hostile.health <= 0) continue;
      banditSpacingOrder.set(hostile, order++);
      const key = Math.floor(hostile.x / cellSize) + ',' + Math.floor(hostile.y / cellSize);
      let bucket = banditSpacingBuckets.get(key);
      if (!bucket) { bucket = []; banditSpacingBuckets.set(key, bucket); }
      let reference = banditSpacingRefs.get(hostile);
      if (!reference) {
        reference = new WeakRef(hostile);
        banditSpacingRefs.set(hostile, reference);
      }
      bucket.push(reference);
    }
    banditSpacingCollection = hostiles;
    banditSpacingCount = count;
    banditSpacingCellSize = cellSize;
    banditSpacingBuiltAt = tick;
  }

  function appendSpacingNeighbors(cellX, cellY, minOrder) {
    for (let y = cellY - 1; y <= cellY + 1; y++) {
      for (let x = cellX - 1; x <= cellX + 1; x++) {
        const bucket = banditSpacingBuckets.get(x + ',' + y);
        if (!bucket) continue;
        for (const reference of bucket) {
          const actor = reference.deref();
          if (!actor || banditSpacingSeen.has(actor)) continue;
          // Once passed in source order, a bandit cannot push the point again
          // even if a subsequent nudge brings it back within avoidance range.
          if (banditSpacingOrder.get(actor) <= minOrder) continue;
          banditSpacingSeen.add(actor);
          banditSpacingCandidates.push(actor);
        }
      }
    }
  }

  // Nudges a movement target away from nearby living bandits. An actor can
  // push the target into the NEXT grid cell; expand the candidate set then,
  // so downstream actors still influence it in original hostile list order.
  function banditPersonalSpaceAdjust(c, point) {
    let px = point.x, py = point.y;
    const personalSpacePx = banditPersonalSpacePx();
    refreshBanditSpacingBuckets(personalSpacePx);
    const candidates = banditSpacingCandidates;
    candidates.length = 0;
    banditSpacingSeen.clear();
    let cellX = Math.floor(px / banditSpacingCellSize);
    let cellY = Math.floor(py / banditSpacingCellSize);
    appendSpacingNeighbors(cellX, cellY, -1);
    candidates.sort(compareBanditSpacingOrder);
    for (let i = 0; i < candidates.length; i++) {
      const o = candidates[i];
      if (o === c || o.health <= 0) continue;
      const dx = px - o.x, dy = py - o.y;
      const dist = Math.hypot(dx, dy);
      if (!(dist > 0.001 && dist < personalSpacePx)) continue; // Preserve the old NaN/non-finite neighbor rejection.
      const push = personalSpacePx - dist;
      px += (dx / dist) * push; py += (dy / dist) * push;
      const nextX = Math.floor(px / banditSpacingCellSize);
      const nextY = Math.floor(py / banditSpacingCellSize);
      if (nextX !== cellX || nextY !== cellY) {
        cellX = nextX; cellY = nextY;
        appendSpacingNeighbors(cellX, cellY, banditSpacingOrder.get(o));
        // Newly entered buckets may contain as-yet-unvisited bandits
        // interleaved with existing candidates. Keep their original order.
        candidates.sort(compareBanditSpacingOrder);
      }
    }
    // Scratch collections otherwise keep the last crowd alive when a zone
    // unloads without another combat update.
    candidates.length = 0;
    banditSpacingSeen.clear();
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
    window.PerpRotation?.clearHeadtrackHint?.(c.perpState); // No combat target: the sprite's dead-zone edge falls back to movement history / the player.
    c._lookAtDebug = null;
  }

  // Fallback only while a humanoid hostile is actually moving without a
  // committed combat gaze. All bandits, barbarians, ghouls, skeletons and
  // minions reuse this portrait/neck rig; wildlife keeps its authored gaze.
  function updateMovementHeadLook(c, dt, moving, movementHeading) {
    if (!c?.avatarRef?.neckJoint || c.prone || !moving || !Number.isFinite(movementHeading)) return false;
    if (c.state === 'chase' || c.state === 'patrol-chase' || c._banditAction || c._banditLunging) return false;
    const carrot = window.NpcMovementHeadTarget; // Shared forward target used by town NPC walkers too.
    if (!carrot) return false;
    const head = window.CreatureHeadCache?.getHeadWorld?.(c, 'animal');
    const eyeY = Number(head?.worldY); // Hostile group is model-center anchored, unlike an NPC walker's floor-root.
    if (!Number.isFinite(eyeY)) return false;
    const origin = { x: c.x / deps.TILE, y: 0, z: c.y / deps.TILE }; // World tile-space root used to place the invisible carrot.
    const target = carrot.targetAhead(origin, Math.cos(movementHeading), Math.sin(movementHeading), eyeY);
    if (!target) return false;
    const residual = deps.angleDiff(movementHeading, Number(c.facing) || 0); // Camera-relative portrait/body yaw remains authoritative.
    _updateBanditNeckYaw(c, residual * 180 / Math.PI, dt);
    c._lookAtDebug = { head: { x: origin.x, y: eyeY, z: origin.z }, target }; // Existing mobile interaction-ray overlay visualizes the carrot when requested.
    return true;
  }

  function _updateBanditLookAtTarget(c, dt, targetPlayer) {
    if (!targetPlayer || targetPlayer.health <= 0) { restNeckLook(c, dt); return; }
    const rawAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    // 'headtrack' tier of the sprite's dead-zone corrective direction, so the
    // player can read WHO a bandit/barbarian is going for even while its
    // facing sits in the camera dead zone (world bearing, x/z = c.x/c.y).
    window.PerpRotation?.setHeadtrackHint?.(c.perpState ||= {}, Math.atan2(targetPlayer.x - c.x, targetPlayer.y - c.y));
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

  const ghoulWyrmApiByActor = new WeakMap(); // One Wyrm-witch adapter per actor; no temporary closures for ordinary bandits or per-frame allocations.

  function updateBanditCombatAI(c, dt, targetPlayer, distToPlayer) {
    targetPlayer = resolvedBanditCombatTarget(c, targetPlayer);
    if (!targetPlayer || Number(targetPlayer.health) <= 0) return { aimAngle: c.facing || 0, moving: false };
    distToPlayer = Math.hypot(targetPlayer.x - c.x, targetPlayer.y - c.y);
    const def = c.def, loadout = def.banditAbilityLoadout;
    _updateBanditLookAtTarget(c, dt, targetPlayer);
    const towardAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    if (c.mineWyrmWitchType) {
      let witchApi = ghoulWyrmApiByActor.get(c); // Stable callback reused for this witch; ordinary humanoids do not allocate spell state per frame.
      if (!witchApi) {
        witchApi = {
          TILE: deps.TILE, moveToward: deps.moveCreatureToward, canOccupyAt: deps.canOccupyAt,
          getCurrentArea: deps.getCurrentArea, // Discard an in-flight Wyrm spell when its owning mine room unloads.
          damage: (target, amount, fromX, fromY, knockback, options) => damageBanditCombatTarget(c, target, amount, fromX, fromY, knockback, options),
        };
        ghoulWyrmApiByActor.set(c, witchApi);
      }
      const witchResult = window.GhoulWyrmWitches?.update?.(c, dt, targetPlayer, distToPlayer, witchApi); // Dedicated spells run before normal ranged/melee.
      if (witchResult?.handled) return witchResult;
    }
    const flaskResult = updateBanditFlaskAI(c, dt, targetPlayer, distToPlayer); // Flaskers get first refusal on ranged combat before ordinary crossbow/melee logic.
    if (flaskResult?.handled) return flaskResult;
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
      // The transient lock is already gone: committed windup/strike facing stays fixed.
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
    const slot = claimBanditAttackSlot(c, towardAngle, targetPlayer);
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
      && (continuingCombo || c.stamina >= def.attackStaminaCost);
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
      const queueRing = slot ? null : claimBanditQueueRing(c, towardAngle, targetPlayer);
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
    const alignment = window.Combat?.attackAlignmentStep?.(c, targetPlayer, dt, {
      turnMultiplier: window.Combat?.postAttackTurnMultiplier?.(c) ?? 1,
    }); // Shared ±45° gate turns before stamina is spent or any windup begins.
    if (alignment && (!alignment.eligible || !alignment.aligned)) {
      if (alignment.eligible) c.facing = alignment.nextFacing;
      else {
        // Outside the ±45° alignment cone, the shared alignment helper refuses to turn.
        // Turn the actor INTO eligibility first; otherwise any flank/spawn facing away waits forever while only dodging.
        const delta = deps.angleDiff(alignment.desiredFacing, c.facing || 0); // Turn toward the same screen-corrected bearing that determines attack eligibility.
        const step = (window.Combat?.ATTACK_ALIGNMENT_TURN_RATE_RAD_S || Math.PI * 2) * Math.max(0, dt);
        c.facing = (c.facing || 0) + Math.sign(delta) * Math.min(Math.abs(delta), step);
      }
      return { aimAngle: c.facing, moving: false };
    }
    if (alignment?.aligned) c.facing = alignment.desiredFacing;
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
  // Plays the PLAYER's own tool-swing poses through the SAME code the player
  // uses: window.SharedAttackPose (js/combat/shared-attack-pose.js) owns the
  // swing interpolation, the per-style rest poses, the mirroring rule and the
  // legacy thrust arc, and the player's updateToolMesh samples it too -- so
  // editing a pose formula there changes the player, bandits, ghouls,
  // skeletons and every other BanditCombat humanoid together ("use the
  // player animations," per design direction). What's NOT shared is
  // updateToolMesh itself or the single shared toolHolder/toolSwingT/
  // combatSwing* variables it reads: those are one-per-game singletons
  // (see combat-core.js's own "every staged action in this pipeline is a
  // player weapon-tool attack" comment) that assume exactly one attacker
  // exists. Each bandit gets its own toolHolder-equivalent group
  // (_banditToolHolder, added straight to the scene and repositioned in
  // world space every frame, exactly like the player's toolHolder is),
  // placed against its own facing/position and its own current ability's
  // windup/strike timing (c._banditAction) instead of the player's.
  // Hostile weapons use the same base + calculated-height held-item scale as
  // the player's (HobunjiHandToolGrips.heldItemPlacementForTool), so the
  // procedural hand's grip target -- which already expands by that scale --
  // lands on the visible weapon. Recomputed only when grip/height data changes.
  let banditWeaponScaleRevision = 0;
  let banditWeaponScaleSubscribed = false;
  function syncBanditWeaponScale(c, holder, weaponKey, gripContext = 'melee') {
    const visual = holder?.children?.[0]; // makeToolPlaneMesh group; pose/spin transforms live on the holder and toolPlane instead.
    const grips = window.HobunjiHandToolGrips;
    if (!visual || !weaponKey || !grips?.effectiveToolScaleForTool) return;
    if (!banditWeaponScaleSubscribed && grips.subscribe) {
      grips.subscribe(() => { banditWeaponScaleRevision += 1; });
      banditWeaponScaleSubscribed = true;
    }
    const data = visual.userData;
    if (data.banditWeaponScaleKey === weaponKey && data.banditWeaponScaleRevision === banditWeaponScaleRevision) return;
    const group = c?.avatarRef?.group;
    const speciesId = c?.avatarRef?.speciesId || group?.userData?.speciesId || '';
    const gender = c?.avatarRef?.gender || group?.userData?.gender || 'male';
    const placement = grips.heldItemPlacementForTool?.(weaponKey, gripContext, { speciesId, gender }); // Base size about the origin, height about the grip.
    const scale = Number(placement?.scale ?? grips.effectiveToolScaleForTool(weaponKey, speciesId, gender));
    visual.scale.setScalar(Number.isFinite(scale) && scale > 0 ? scale : 1);
    if (placement?.offset) visual.position.set(placement.offset.x, placement.offset.y, placement.offset.z); // Grip stays fixed under the hand.
    data.banditWeaponScaleKey = weaponKey;
    data.banditWeaponScaleRevision = banditWeaponScaleRevision;
    data.banditWeaponScale = visual.scale.x; // Mobile/debug readout of the applied effective scale.
  }

  function makeBanditToolHolder(scene, weaponKey) {
    const mesh = deps.makeToolPlaneMesh(weaponKey);
    if (!mesh) return null;
    const holder = new THREE.Group();
    holder.name = 'banditToolHolder';
    holder.add(mesh);
    scene.add(holder);
    return holder;
  }


  const BANDIT_FLASK_TOOL_KEY = 'throwingflask'; // Used by the shared hand-grip registry while the Flasker visually holds an inventory flask.
  const BANDIT_FLASK_SPRITE = 'assets/objectsprites/throwing_flask.png'; // Used by the runtime Flasker holder; Attack Editor uses the same source PNG.
  function makeBanditFlaskToolHolder(scene) {
    if (!scene || !THREE?.Group) return null;
    const holder = new THREE.Group();
    holder.name = 'banditFlaskToolHolder';
    holder.visible = false;
    const visual = new THREE.Group(); // Grip-scaled child matching makeBanditToolHolder's visual-child convention.
    visual.name = 'banditFlaskGripVisual';
    visual.userData = { toolPlane: null };
    holder.userData = { toolPlane: null, banditFlaskHolder: true };
    holder.add(visual);
    scene.add(holder);
    new THREE.TextureLoader().load(BANDIT_FLASK_SPRITE, texture => {
      if (!holder.parent) { texture.dispose?.(); return; }
      // Flaskers hold an ordinary authored PNG, not a custom-effect surface.
      // Use the same texture configuration as body and player-held tool planes.
      const spriteSurface = window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit;
      if (spriteSurface?.configureTexture) spriteSurface.configureTexture(THREE, texture, 'bandit-throwing-flask');
      else {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
      }
      const widthPx = texture.image?.naturalWidth || texture.image?.width || 1;
      const heightPx = texture.image?.naturalHeight || texture.image?.height || 1;
      const width = 0.5;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(width, width * heightPx / Math.max(1, widthPx)),
        spriteSurface?.makeMaterial
          ? spriteSurface.makeMaterial(THREE, texture, 'bandit-throwing-flask', { side: THREE.DoubleSide })
          : new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.001, side: THREE.DoubleSide }),
      );
      plane.rotation.x = -Math.PI / 2;
      visual.add(plane);
      visual.userData.toolPlane = plane;
      holder.userData.toolPlane = plane;
    }, undefined, error => window.__farmLog?.(`[bandits] throwing flask sprite failed to load: ${error?.message || error}`, 'warn', 'combat'));
    return holder;
  }

  // An enemy's swing plays the player's own clock: SharedAttackPose.swingTimeline turns the staged action's
  // windup/strike (and the ability's own holdS/returnS, the same data combat-combo.js hands the player's swing
  // visual) into windup -> strike travel -> hold -> eased return. The staged action itself ends at its strike
  // (recoverS is always 0); finishBanditAction hands the rest of the timeline to c._banditToolTail.
  const banditTimeline = { totalS: 0, wf: 0, sf: 0, hf: 0 }; // Scratch for the timeline of the enemy being drawn; consumed synchronously.
  let banditPoseSample = null; // One SharedAttackPose sample reused by every bandit's per-frame pose; created lazily and consumed synchronously inside updateBanditToolMesh.

  // ── Bandit weapon swing trail ────────────────────────────────────
  // Use the same affliction palette as the player's weapon cone. Most NPC
  // attacks have one baseline tag affliction; upgraded/multi-affliction
  // attacks can draw up to four adjacent lanes using the shared ribbon owner.
  const BANDIT_TRAIL_HALF_THICKNESS_TILES = 0.06;
  const BANDIT_TRAIL_ARCH_UNITS = 0.2;
  const BANDIT_TRAIL_HOLD_S = 0.22;
  const BANDIT_TRAIL_FADE_S = 0.16;
  const BANDIT_TRAIL_COLOR_BY_TAG = { sharp: 0xd9ffe0, blunt: 0xffc23d, poison: 0x93ff78 };

  function banditTrailColors(c) {
    const tag = c.def?.attackTag || 'sharp';
    const palette = window.ResourceRings;
    const bonuses = window.ResourceSystem?.afflictionBonusesForTag?.(tag);
    if (!bonuses || !palette?.AFFLICTION_COLORS) return [BANDIT_TRAIL_COLOR_BY_TAG[tag] || 0xffffff];
    const colors = [];
    for (const [affliction, multiplier] of Object.entries(bonuses)) {
      if (!(Number(multiplier) > 0)) continue;
      const original = palette.AFFLICTION_COLORS[affliction];
      if (original != null) colors.push(palette.neonizeColor?.(original) ?? original);
      if (colors.length === 4) break;
    }
    return colors.length ? colors : [BANDIT_TRAIL_COLOR_BY_TAG[tag] || 0xffffff];
  }

  function spawnBanditTrailArc(c, rangePx, halfConeRad, angle, pitch = null) {
    const colors = banditTrailColors(c);
    const count = colors.length;
    // Color lanes split only the VISUAL mesh. Show Hitboxes must still show
    // the original full gameplay cone, not just lane zero's narrow wedge.
    if (count > 1) window.Combat?.spawnMeleeTrail?.({
      actor: c, scene: c.scene, yaw: angle, pitch: pitch ?? c._banditAimPitch ?? 0,
      rangePx, halfConeRad, debugOnly: true,
    });
    for (let lane = 0; lane < count; lane++) {
      // Every lane claims an adjacent slice of the attack's visual cone.
      // The union has exactly the original attack width; damage uses the
      // untouched shared meleeHit collider, not this decorative subdivision.
      const laneHalfCone = halfConeRad / count;
      const laneYaw = angle + (2 * lane + 1 - count) * laneHalfCone;
      window.Combat?.spawnMeleeTrail?.({
        actor: c,
        scene: c.scene,
        yaw: laneYaw,
        pitch: pitch ?? c._banditAimPitch ?? 0,
        rangePx,
        halfConeRad: laneHalfCone,
        halfThickness: BANDIT_TRAIL_HALF_THICKNESS_TILES,
        archUnits: BANDIT_TRAIL_ARCH_UNITS,
        color: colors[lane],
        holdS: BANDIT_TRAIL_HOLD_S,
        fadeS: BANDIT_TRAIL_FADE_S,
        debug: count === 1, // Multi-lane attacks record their complete cone separately above.
      });
    }
  }

  // A dual-wield weapon rests in its two-weapon idle stance, exactly like the player's (the grip state at Neutral
  // carries dualWieldIdleBlend 1); every other weapon rests one-handed, which is "no animation grip". Computed once
  // per weapon: the grip sampler allocates, and this is the same object every idle frame.
  function restGripFor(c, toolKey) {
    const grips = window.HobunjiHandToolGrips;
    if (!toolKey || !grips?.isDualWieldWeapon?.(toolKey)) return null;
    const cached = c._banditRestGrip;
    if (cached && cached.key === toolKey) return cached.grip;
    const grip = grips.animationGripAt?.(0, { windupFrac: 0.16, strikeFrac: 0.16, holdFrac: 1, poseScale: 1 }, {}, 'attack', toolKey) ?? null;
    c._banditRestGrip = { key: toolKey, grip };
    return grip;
  }

  function updateBanditToolMesh(c) {
    const handDriverRoot = c?.avatarRef?.handRigAvatarRoot; // Final pre-render hand driver reads the live melee/ranged/flask holder selected below.
    const flaskActive = !!c._banditFlaskActionActive && !!c._banditFlaskToolHolder; // During a staged Flasker throw the held flask replaces the backup melee weapon.
    const useRanged = !flaskActive && !!c._rangedMode && !!c._banditRangedToolHolder;
    if (handDriverRoot?.userData) {
      handDriverRoot.userData.proceduralHandToolHolder = flaskActive ? c._banditFlaskToolHolder : (useRanged ? c._banditRangedToolHolder : c._banditToolHolder);
      handDriverRoot.userData.proceduralHandToolKey = flaskActive ? BANDIT_FLASK_TOOL_KEY : (useRanged ? c.def?.rangedWeaponKey : c.def?.weaponKey);
      handDriverRoot.userData.proceduralHandGripContext = (flaskActive || useRanged) ? 'ranged' : 'melee';
      if (useRanged) handDriverRoot.userData.proceduralHandAnimationGrip = null; // Ordinary ranged poses never opt into the melee 2H ranges; Flaskers intentionally keep throw animation grip metadata.
    }
    syncBanditWeaponScale(c, c._banditToolHolder, c.def?.weaponKey);
    syncBanditWeaponScale(c, c._banditRangedToolHolder, c.def?.rangedWeaponKey, 'ranged');
    syncBanditWeaponScale(c, c._banditFlaskToolHolder, BANDIT_FLASK_TOOL_KEY, 'ranged');
    const holder = flaskActive ? c._banditFlaskToolHolder : c._banditToolHolder;
    if (!holder) return;
    if (flaskActive) {
      if (c._banditToolHolder) c._banditToolHolder.visible = false;
      if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;
      c._banditFlaskToolHolder.visible = true;
    } else if (c._rangedMode) {
      holder.visible = false;
      if (c._banditFlaskToolHolder) c._banditFlaskToolHolder.visible = false;
      window.RangedWeapons?.updateBanditVisual?.(c);
      return;
    } else {
      holder.visible = true;
      if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;
      if (c._banditFlaskToolHolder) c._banditFlaskToolHolder.visible = false;
    }
    const action = c._banditAction;
    // The player's swing clock, shared (SharedAttackPose.swingTimeline): windup, strike travel, an ability's
    // own post-strike hold, then an eased return to neutral. Elapsed time comes from the live staged action,
    // then from the tail finishBanditAction hands over once the action completes.
    const SAP = window.SharedAttackPose; // Same pose math the player's updateToolMesh samples (js/combat/shared-attack-pose.js).
    const nowMs = performance.now();
    let timelineLive = false;
    let resetAfterDraw = false;
    let elapsedS = 0;
    if (action) {
      c._banditToolTail = null;
      const durationS = Math.max(0.0001, action.windupS + action.strikeS + (Number(c._banditSwingReturnS) || 0));
      SAP.swingTimeline(banditTimeline, durationS, action.windupS / durationS, (action.windupS + action.strikeS) / durationS, c._banditSwingHoldS);
      elapsedS = action.t;
      timelineLive = true;
    } else if (c._banditToolTail) {
      const tail = c._banditToolTail;
      SAP.swingTimeline(banditTimeline, tail.durationS, tail.windupFrac, tail.strikeFrac, tail.holdS);
      elapsedS = tail.baseElapsedS + (nowMs - tail.startMs) / 1000;
      if (elapsedS >= banditTimeline.totalS) { // The eased return has finished: this frame still draws Neutral with the swing's own fields, then the rest stance is restored.
        c._banditToolTail = null;
        resetAfterDraw = true;
      } else timelineLive = true;
    }
    if (timelineLive) c._banditToolSettleUntil = nowMs + Math.max(0, banditTimeline.totalS - elapsedS) * 1000; // Keeps the idle-stance adapter, sleep gate and combat log aware the swing is still playing.
    if (!timelineLive && handDriverRoot?.userData) handDriverRoot.userData.proceduralHandAnimationGrip = restGripFor(c, handDriverRoot.userData.proceduralHandToolKey);
    const anim = c._banditSwingAnim || 'thrust';
    const pose = c._banditSwingPose;
    const dirSign = c._banditSwingDirSign || 1;
    const poseScale = Math.max(0, Math.min(1, Number(c._banditSwingPoseScale ?? 1) || 0)); // Used only for sampled partial-pose attacks such as bandit Charged Breaker.
    const power = (c._banditSwingPower || 1) * poseScale;

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
    const spinMesh = holder.children[0];
    const spinPlane = spinMesh?.userData?.toolPlane;
    if (spinPlane) {
      spinPlane.rotation.z = anim === 'sweep' ? -Math.PI / 2 : 0;
      // Backhand is a midline reflection of the whole tool (the Attack Editor's Flip Across Midline), so it
      // goes on the parent mesh, after the plane's spin; a child-plane flip leaves the blade facing Forehand.
      spinPlane.scale.x = 1;
      spinMesh.scale.x = Math.abs(spinMesh.scale.x) * (anim === 'sweep' && dirSign < 0 ? -1 : 1);
    }

    let progress = 0, wf = 0.16, sf = 0.16, hf = 1; // At rest the pose is plain Neutral whatever the fractions are.
    if (timelineLive) {
      progress = Math.min(1, elapsedS / banditTimeline.totalS);
      wf = banditTimeline.wf; sf = banditTimeline.sf; hf = banditTimeline.hf;
      // A held windup (Charged Breaker) decelerates like the player's: replay the first `span` of the shared curve
      // over this windup, renormalized so the windup still ends exactly on its (charge-scaled) Windup pose.
      const curve = c._banditSwingWindupCurve;
      const windupCurve = window.Combat?.windupCurve;
      if (curve && action && curve.action === action && windupCurve && wf > 0 && progress < wf) {
        const curveEnd = windupCurve(curve.span, curve.slowdown);
        if (curveEnd > 1e-6) progress = wf * windupCurve((progress / wf) * curve.span, curve.slowdown) / curveEnd;
      }
      if (handDriverRoot?.userData) {
        // Same timing AND weapon the player's hands get for the same swing: the tool key picks the hand mode, so a dual-wield
        // weapon swings with both hands and a thrown flask with one. poseScale is the partial-charge fraction (the player's
        // partial release), never the ability's power; progress is already eased above, and the player's own held-ability
        // speed-up must not reach an enemy's hands (heldTransforms: false).
        handDriverRoot.userData.proceduralHandAnimationGrip = window.HobunjiHandToolGrips?.animationGripAt?.(progress, { windupFrac: wf, strikeFrac: sf, holdFrac: hf, poseScale, heldTransforms: false }, pose || {}, 'attack', handDriverRoot.userData.proceduralHandToolKey || '') ?? null;
      }
    }
    const timelineState = c._banditToolTimeline || (c._banditToolTimeline = { live: false, progress: 0, wf: 0.16, hf: 1, poseScale: 1 }); // Read by EnemyWeaponStances for the sweep-plane twist fade; one object per enemy, updated in place.
    timelineState.live = timelineLive; timelineState.progress = progress; timelineState.wf = wf; timelineState.hf = hf;
    timelineState.poseScale = poseScale; // Partial Charged Breaker: the twist cancels by the same fraction as the player's partial release.

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

    if (!banditPoseSample) banditPoseSample = SAP.createSample();

    // The player's style selection (game.js updateToolMesh): an authored pose for ANY style, else the legacy chop
    // pose, sweep body turn or thrust jab -- all SharedAttackPose.sampleSwing. Every result is the same seven
    // channels, placed below exactly like the player's pose-driven branch.
    const sampled = SAP.sampleSwing(banditPoseSample, anim, pose, progress, wf, sf, hf, dirSign, power, 'attack');
    const x = sampled.x, y = sampled.y, z = sampled.z;
    const pitchRad = sampled.pitchRad;
    const yawRad = sampled.yawRad;
    const rollRad = sampled.rollRad;
    const bodyYawRad = sampled.bodyYawRad;
    // 1 unless the pose authors a midline-flip sequence (Heavy weapons) or is the legacy Backhand sweep, exactly like
    // the player's hand anchor.
    const handBaseX = base.x * sampled.mirrorBlend;
    // A true midline flip also reverses the sprite once the blend crosses the midpoint, as the player's does.
    const planeMirrorSign = sampled.hasMirrorSequence ? (sampled.mirrorBlend < 0 ? -1 : 1) : null;
    timelineState.planeMirrorSign = planeMirrorSign;
    if (planeMirrorSign != null && spinMesh && anim === 'sweep') spinMesh.scale.x = Math.abs(spinMesh.scale.x) * planeMirrorSign;
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
    const vRX = Math.cos(vθ), vRZ = -Math.sin(vθ), vFX = Math.sin(vθ), vFZ = Math.cos(vθ);
    deps.qFac.setFromAxisAngle(deps.tUp, vθ);
    deps.qToolYaw.setFromAxisAngle(deps.tUp, yawRad);
    deps.qAnim.setFromAxisAngle(deps.xAxis, pitchRad);
    deps.qRoll.setFromAxisAngle(deps.zAxis, rollRad);
    holder.quaternion.copy(deps.qFac).multiply(deps.qToolYaw).multiply(deps.qAnim).multiply(deps.qRoll);
    holder.position.set(
      c.x / deps.TILE + vRX * (handBaseX + x) + vFX * z,
      feetY + base.y + y,
      c.y / deps.TILE + vRZ * (handBaseX + x) + vFZ * z,
    );
    scaleBanditToolPositionAroundCentroid(c, holder, vθ); // Finished raw pose is orbited around this avatar's visual centroid (per-axis in the pose's own frame).
    if (c.avatarRef?.riderMount) { holder.scale.setScalar(1); applyRiderMount(c, holder); }
    if (resetAfterDraw) {
      resetBanditSwingToNatural(c);
      c._banditSwingResetDone = true; // Tells a wrapper that temporarily substituted the swing fields not to restore the finished swing over this reset.
    }
  }

  function scaleBanditToolPositionAroundCentroid(c, holder, poseYawRad = 0) {
    const avatarRef = c?.avatarRef; // Holds the portrait-derived hand anchor and species/gender pose metadata.
    const group = avatarRef?.group; // Center-anchored bandit avatar used to derive the character floor.
    if (!holder || !group) return holder;
    const armLength = Number(avatarRef?.armLength ?? group.userData?.armLength);
    const poseOrbitScale = avatarRef?.poseOrbitAxes ?? group.userData?.poseOrbitAxes ?? Number(avatarRef?.poseOrbitScale ?? group.userData?.poseOrbitScale); // Per-axis { x, y, z } when the species authored one.
    const modelHeight = Number(avatarRef?.modelHeight ?? group.userData?.portraitModelHeight) || 0.9;
    const rawHandAttachY = Number(avatarRef?.handAttachY ?? group.userData?.handAttachY); // Used below as the unscaled floor-relative weapon base.
    const floorY = group.position.y - modelHeight / 2; // Bandit group is center-anchored, unlike the player's floor-anchored body root.
    const baseY = floorY + (Number.isFinite(rawHandAttachY) ? rawHandAttachY : modelHeight / 2);
    const speciesId = avatarRef?.speciesId || group.userData?.speciesId || null; // Used by the shared portrait-height ratio.
    const gender = avatarRef?.gender || group.userData?.gender || 'male';
    const scaler = window.HobunjiSpeciesPoseScale; // Shared transform keeps player, bandit, and NPC interpretation identical.
    const height = scaler?.heightMetrics?.(speciesId, gender, modelHeight, 1) || null; // Bandit visuals are not parent-scaled by CharacterRigScale, so their hierarchy contributes 1.0 here.
    if (scaler?.transformPosePoint) {
      scaler.transformPosePoint(holder.position, {
        cx: group.position.x, cz: group.position.z, floorY, baseY,
        speciesId, gender, modelHeight, rigScaleY: 1,
        armLength, poseOrbitScale, yawRad: poseYawRad,
      });
    } else {
      scaler?.scalePointAroundCentroid?.(holder.position, group.position.x, group.position.y, group.position.z, armLength, poseOrbitScale, poseYawRad);
    }
    c._banditLastCentroidScale = scaler?.scaleForPose?.(poseOrbitScale, armLength) ?? 1; // Mobile/debug-readable authored orbit factor.
    c._banditLastPoseHeightScale = height?.heightRatio ?? 1; // Mobile/debug-readable vertical scale proving bandits use the same authored-Y contract.
    return holder;
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

  // Removes everything makeBanditEntity added to the scene for an entity
  // that never made it into hostileObjects (e.g. an async spawn that
  // resolved after the player left the area). Disposing avatarRef alone
  // left the ground shadow and weapon holders parked in the zone scene.
  function discardBanditEntity(entity) {
    if (!entity || entity._banditDisposed) return;
    entity._banditDisposed = true; // Late-build cancellation and data-only retirement can meet on the same actor.
    if (window.Combat?.deps?.despawnCreature) { window.Combat.deps.despawnCreature(entity); return; }
    entity.avatarRef?.group?.parent?.remove?.(entity.avatarRef.group);
    entity.avatarRef?.dispose?.();
    for (const root of [entity.groundShadow, entity._banditToolHolder, entity._banditRangedToolHolder, entity._banditFlaskToolHolder, entity._banditTrailMesh]) {
      root?.parent?.remove?.(root);
      root?.traverse?.(object => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) for (const material of object.material) material?.dispose?.();
        else object.material?.dispose?.();
      });
    }
    window.ResourceRings?.disposeRingHud?.(entity);
  }

  let characterBuildStatus = { stage: 'idle', speciesId: null, gender: null, error: null }; // Last serialized humanoid portrait stage persists in the mobile spawn report.
  let characterBuildTail = Promise.resolve(); // Serializes portrait builds shared by bandits and Porakaneki camps during zone-entry bursts.
  let characterBuildPending = 0, characterBuildActive = 0; // Scalar diagnostics included in the mobile memory checkpoint.
  async function buildQueuedBanditAvatar(roster, zoneId) {
    const previous = characterBuildTail; // Every caller waits for the prior portrait's temporary canvases to settle.
    let unlock; // Resolves the tail in finally, including cancellations and renderer errors.
    characterBuildTail = new Promise(resolve => { unlock = resolve; });
    characterBuildPending++;
    try {
      await previous;
      if (characterBuildPending > 1 && typeof setTimeout === 'function') await new Promise(resolve => setTimeout(resolve, 0)); // Give entry/combat rendering a turn between queued portrait builds.
      if (zoneId && zoneId !== deps.getCurrentArea()) return null; // Leaving a zone cancels queued work before any portrait allocations.
      characterBuildActive++;
      characterBuildStatus = { stage: 'starting', speciesId: roster?.appearance?.speciesId ?? null, gender: roster?.appearance?.gender ?? null, error: null };
      try {
        const avatar = await buildBanditAvatar(roster); // Shared factory used by bandits and skeletons.
        characterBuildStatus.stage = 'complete';
        return avatar;
      } catch (error) {
        characterBuildStatus.error = String(error?.stack || error); // Preserve the actual error and the last successful stage without retaining live objects.
        throw error;
      } finally { characterBuildActive--; }
    } finally { characterBuildPending--; unlock(); }
  }

  function applyAuthoredHostileRigScale(avatarRef, explicitScale) {
    if (!avatarRef?.group || !explicitScale) return false;
    const positive = value => Number.isFinite(Number(value)) && Number(value) > 0; // Validate caller-authored scale fields before mutating live meshes.
    const x = positive(explicitScale.x) ? Math.min(4, Math.max(0.1, Number(explicitScale.x))) : 1;
    const y = positive(explicitScale.y) ? Math.min(4, Math.max(0.1, Number(explicitScale.y))) : 1;
    const head = positive(explicitScale.head) ? Math.min(4, Math.max(0.1, Number(explicitScale.head))) : 1;
    const offsetY = Number.isFinite(Number(explicitScale.offsetY)) ? Math.max(-0.5, Math.min(0.5, Number(explicitScale.offsetY))) : 0;
    const originalHeight = avatarRef.modelHeight; // Head-neck offset is expressed against the unscaled local avatar height.
    // Both the skinned face and rear head track their independently rotated neck bones.
    // Counteract non-uniform whole-rig scaling so the skull stays undistorted.
    for (const joint of [avatarRef.neckJoint?.front, avatarRef.neckJoint?.back]) {
      if (!joint?.scale) continue;
      joint.scale.x *= head / x;
      joint.scale.y *= head / y;
      if (joint.position) joint.position.y += originalHeight * offsetY;
      joint.updateMatrix?.();
    }
    avatarRef.group.scale.set(avatarRef.group.scale.x * x, avatarRef.group.scale.y * y, avatarRef.group.scale.z * x);
    avatarRef.modelWidth *= x; // makeBanditDef, melee targeting and collision must see the same dimensions as the rendered enemy.
    avatarRef.modelHeight *= y;
    avatarRef.group.userData.portraitModelWidth = avatarRef.modelWidth; // Runtime hitbox and pose-height metadata read the same scaled box.
    avatarRef.group.userData.portraitModelHeight = avatarRef.modelHeight;
    avatarRef.rigScale = { x, y, head, offsetY }; // Mobile-readable proof of the actual values applied.
    return true;
  }

  async function makeBanditEntity(cfg, rank, tier, x, y, opts = {}) {
    const roster = opts.rosterOverride || await rollBanditRoster(cfg, rank, opts.nameOverride);
    if (opts.mountSpecies && roster) roster.mountSpecies = opts.mountSpecies; // Seats the rider on a full creature card (e.g. Porakaneki Avengers on Nazgraku).
    if (roster?.appearance?.speciesId === 'ghoul') styleGhoulRoster(roster); // Mine and any future ghoul BanditCombat spawns share this one wardrobe/dye authority before portrait and corpse loot are built.
    if (opts.bodyColorsOverride && roster?.appearance) {
      roster.appearance.bodyColors = opts.bodyColorsOverride; // Caller-owned explicit body tint applied before portrait generation without changing any other seeded appearance choices.
    }
    const avatarRef = await buildQueuedBanditAvatar(roster, opts.zoneId);
    if (avatarRef && opts.avatarRigScale) applyAuthoredHostileRigScale(avatarRef, opts.avatarRigScale); // Scale wood puppets before stats, hitboxes, ground offset and weapon mounts are constructed.
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
    if (def.rangedWeaponKey && !window.RangedWeapons?.config?.[def.rangedWeaponKey]) {
      // The Fishing Spear is registered by the existing dual-role projectile archetype, not the base crossbow table.
      // NPCs must have that real thrown definition before they try to fire rather than holding an inert spear.
      window.HobunjiRangedWeaponArchetypes?.patchGeneratedDefinitions?.();
    }
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
    const banditFlaskToolHolder = rank === 'flasker' ? makeBanditFlaskToolHolder(targetScene) : null; // Separate inventory-flask visual uses the same authored grip as the Attack Editor.
    const handDriverRoot = avatarRef.handRigAvatarRoot; // Original PNGPlaneAvatar root retained solely as the shared procedural-hand driver's identity/ownership record.
    if (handDriverRoot?.userData) {
      handDriverRoot.userData.proceduralHandToolHolder = banditToolHolder || null;
      handDriverRoot.userData.proceduralHandToolKey = def.weaponKey || null;
      handDriverRoot.userData.proceduralHandGripContext = 'melee';
    }

    const groundShadow = deps.makeCharacterGroundShadow('bandit_ground_shadow');
    const shadowRadii = deps.creatureGroundShadowRadii(def);
    groundShadow.scale.set(shadowRadii.radiusX, 1, shadowRadii.radiusZ);
    groundShadow.position.set(x / deps.TILE, surfY + deps.characterGroundShadowSurfaceOffset(), y / deps.TILE);
    targetScene.add(groundShadow);

    const enemyClass = opts.enemyClass || opts.extra?.enemyClass || (opts.extra?.tribeId ? `${opts.extra.tribeId}-hunter` : (opts.extra?.isPorakanekiHunter ? 'porakaneki-hunter' : 'bandit')); // Semantic hostile category layered over the shared humanoid combat implementation.
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
      isBandit: true, enemyClass, banditRank: rank, banditTier: tier, banditMastery: mastery,
      banditWeaponMeshAttached: !!banditToolHolder,
      _banditToolHolder: banditToolHolder,
      _banditRangedToolHolder: banditRangedToolHolder,
      _banditFlaskToolHolder: banditFlaskToolHolder,
      _rangedLoaded: true, _rangedMode: false, _rangedAction: null, _rangedCooldownT: 0,
      _banditFlaskIndex: 0, _banditFlaskCooldownT: 0, _banditFlaskActionActive: false, _banditFlaskPendingRecipeId: null, _banditFlaskAnimationKey: null, // Flasker staged throw + infinite-loadout state; inert on every other rank.
      // Idle/approach rest pose matches the weapon's own natural swing
      // style (see banditNaturalSwing) until an ability fire overwrites
      // these with its own (see fireBanditComboStep/fireBanditQuickAttack
      // /fireBanditChargedBreaker/fireBanditCounterRiposte) -- reset
      // back to this same natural style once the action completes (see
      // finishBanditAction) rather than staying stuck on whichever
      // ability last fired -- see updateBanditToolMesh.
      _banditSwingAnim: banditNaturalSwing(def).anim,
      _banditSwingPose: banditNaturalSwing(def).pose,
      _banditSwingDirSign: 1, _banditSwingPower: 1, _banditSwingPoseScale: 1, _banditToolSettleUntil: 0,
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
    applyRiderMount, // Shared by the ranged visual so thrown/held ranged weapons follow a mounted compound rider too.
    rollFlaskLoadout: rollBanditFlaskLoadout,
    availableFlaskRecipeIds: availableBanditFlaskRecipeIds,
    characterBuildSnapshot: () => ({ pending: characterBuildPending, active: characterBuildActive, ...characterBuildStatus }), // Existing debug report reads queue pressure without retaining roster objects.
    discardEntity: discardBanditEntity, // Scene teardown for a built-but-never-registered entity (late async spawns).
    setCombatExpression, // Synchronously swaps the live humanoid hostile portrait between its pre-baked resting and combat-frown canvases.
    applyRosterDyesToProfile, // Shared/testable world-avatar dye reconciliation used by Bandits, Minions, and Liches.
    ensureEnemyPants, // Shared hostile wardrobe fallback, including explicit skeleton/ghoul/lich/ghost rosters.
    // Rolls a name the same way a fresh gang member's roster does (see
    // rollBanditRoster) — used standalone by game.js's generateBountyTask
    // when no live camp exists yet to adopt a captain's real identity from.
    randomName: _banditName,
    // Rolls a full humanoid roster record (species/gender/clothing/dyes) from
    // a gang-shaped config without building an entity — used by
    // js/slagothim-traders.js to dress caravan walkers like other Tletingans.
    rollRoster: rollBanditRoster,
    updateCombatAI: updateBanditCombatAI,
    restNeckLook,
    updateMovementHeadLook,
    updateToolMesh: updateBanditToolMesh,
    updateTrailArc: () => {}, // Shared Combat.update owns ribbon lifetime; legacy API remains callable.
    fireCounterRiposte: fireBanditCounterRiposte,
    naturalSwing: banditNaturalSwing,
    cancelLunge: cancelBanditLunge, // Stagger/death/leash cleanup: stops the lunge AND lowers its hop.
    finishAction: finishBanditAction, // Ends a staged action; a completed melee swing hands its hold/return to c._banditToolTail.
    engagementReachPx: banditEngagementReachPx,
    RANK_LABEL: BANDIT_RANK_LABEL,
    TINT_SLOT_BY_SLOT: BANDIT_TINT_SLOT_BY_SLOT,
    GUARD_DAMAGE_ABSORB: BANDIT_GUARD_DAMAGE_ABSORB,
    MAX_ATTACK_SLOTS: BANDIT_MAX_ATTACK_SLOTS,
    get attackSlots() { return _banditAttackSlots; },
    get queueRings() { return _banditQueueRings; },
  };
})();
