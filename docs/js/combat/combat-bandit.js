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
        const r = await fetch('config/bandits/bandit-gang-config.json?v=20261122hWeakHP30');
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
        const species = await r.json();
        const parentId = String(species.parentSpecies || '').trim(); // Derived species must inherit their donor's clothing/portrait data without duplicated manifests.
        if (!parentId || parentId === speciesId) return species;
        const parent = await loadBanditSpeciesDef(parentId);
        return parent ? {
          ...parent, ...species,
          male: { ...(parent.male || {}), ...(species.male || {}) },
          female: { ...(parent.female || {}), ...(species.female || {}) },
        } : species;
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
  const BANDIT_TINT_SLOT_BY_SLOT = { torso: 'TORSO', overwear: 'CLOTH', hat: 'HAT', hood: 'HOOD', mask: 'MASK', pants: 'PANTS' };

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
    let gender = genderOverride === 'male' || genderOverride === 'female'
      ? genderOverride : (deps.rnd() < 0.5 ? 'male' : 'female'); // Only callers such as male Slagothim traders supply an override.
    const speciesDef = await loadBanditSpeciesDef(speciesId);
    const supportedGenders = speciesDef?.genders;
    if (supportedGenders?.length && !supportedGenders.includes(gender)) gender = supportedGenders[0];
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
    // A captain always wears overwear (BanditRankWardrobe patterns it): force-fill the slot when the independent rolls left it empty.
    if (rank === 'captain' && !Object.values(cosmeticSlots).includes('overwear')) fillSlot('overwear');
    // A flasker always wears a face mask against its own noxious fumes: the hood slot is a facewrap, replacing any other hood it rolled.
    if (rank === 'flasker' && candidatesBySlot.hood?.facewrap && !equippedCosmetics.includes('facewrap')) {
      for (const id of [...equippedCosmetics]) if (cosmeticSlots[id] === 'hood') { equippedCosmetics.splice(equippedCosmetics.indexOf(id), 1); delete cosmeticSlots[id]; }
      equippedCosmetics.push('facewrap');
      cosmeticSlots.facewrap = 'hood';
      const hoodDye = _banditRollDyeId(cfg);
      if (hoodDye) appliedDyes.HOOD = hoodDye;
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

  // Authored enemies (named liches) can force a woven pattern onto their pants, the same render-only seam NPC wardrobe uses for other slots.
  function pantsAppearanceWithForcedPattern(appearance, roster) {
    const forced = roster?.clothingPatterns?.forcedOverpassBySlot?.pants;
    if (!forced?.pattern) return appearance;
    const weaving = { ...(appearance.weaving || {}), forcedOverpassPattern: window.NpcWardrobe?.forcedPatternForRender?.(roster, 'pants', forced) || JSON.parse(JSON.stringify(forced.pattern)) }; // Same per-piece size, raw-size outline (500px pants vs 234x173 body sprites) and body-scale compensation as every other garment.
    if (Array.isArray(forced.roles) && forced.roles.length) weaving.forcedOverpassRoles = [...forced.roles];
    const patternHex = appearance.patternHex && appearance.patternHex !== '#ffffff' ? appearance.patternHex : (forced.fallbackColorC?.hex || appearance.patternHex);
    // Pattern color: the PANTS C dye if one exists, else the pattern fallback (Body Color 3). With baseUsesPatternColor the BASE layer (dye A) is
    // dyed that color as a whole and the DRAPE layer (dye B) takes the garment's main color, so the pattern (scoped to DRAPE) sits on the main color.
    return { ...appearance, weaving, patternHex, ...(forced.baseUsesPatternColor ? { primaryHex: patternHex, secondaryHex: appearance.primaryHex || appearance.secondaryHex } : {}) };
  }

  function ensureEnemyPants(roster) {
    const speciesId = String(roster?.appearance?.speciesId || '').trim().toLowerCase().replace(/_/g, '-'); // Both excluded lower-body anatomies bypass the hostile garment fallback.
    if (!roster || roster.enemyLoadoutAuthoredPants || speciesId === 'omgurku' || speciesId === 'porakaneki') return null;
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

  function rootledootLegLayout(opaqueHeightFraction, kenkariProfile) {
    const height = Math.max(0, Math.min(1, Number(opaqueHeightFraction) || 1)); // Cropped Heftroot art is bottom-aligned in the portrait canvas.
    const gap = .06; // Only 6% of the portrait height is exposed below the body; keep the entire sprite above the floor.
    const donor = Number(kenkariProfile?.posteriorRule?.heightPercentFromFloor);
    const gaitReach = Number.isFinite(donor) && donor > 0 ? Math.min(.15, donor / 100) : .13; // Male Kenkari's authored short-leg reach; not its feet, shoulders or torso.
    return { placementRatio: .5 + gap, posteriorFraction: gap + height / 2, gaitReach, gap };
  }

  async function buildBanditAvatar(roster) {
    if (!window.NpcAvatarPreview || !window.PNGPlaneAvatar) throw new Error('Humanoid portrait modules are unavailable.');
    characterBuildStatus.stage = 'cosmetics';
    await window.NpcAvatarPreview.ensurePortraitCosmetics({ assetBase: './assets/', configBase: './config/' });
    characterBuildStatus.garmentId = roster.rootledoot ? null : ensureEnemyPants(roster); // Existing mobile build diagnostics show the selected leg garment.
    characterBuildStatus.stage = 'profile';
    await window.ProceduralMaskPatterns?.ready; // Mask pattern library (config/patterns) must be loaded before the profile is built.
    const avatarData = window.MetalArmorSystem?.decorateAvatarDataWithMetalArmor?.(roster, roster.metalArmorItems || []) || roster; // Portrait colors retain the same alloy/Temper state as corpse loot.
    const profile = window.NpcAvatarPreview.buildProfileFromNpcExport(avatarData);
    if (!profile) throw new Error('Humanoid portrait profile could not be built.');
    window.SpecialHarlyaoLiches?.decoratePortraitProfile?.(profile,roster); // Named eye-glow appearance uses the canonical two-pass mask pixel dye; Imlao explicitly clears all face/headwear slots.
    if (roster.rootledoot) profile.bodyColors = roster.appearance.bodyColors; // Rootledoot hands and feet use the root's authored color.
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
    if (roster.clothingPatterns?.forcedOverpassBySlot) { // Woven pattern config and motif composites are cold on a first spawn and its retry can miss them, leaving the garment plain; one throwaway render warms them before the real portraits.
      const warmCanvas = document.createElement('canvas');
      warmCanvas.width = warmCanvas.height = PORTRAIT_SIZE;
      await window.NpcAvatarPreview.renderProfileToCanvas(warmCanvas, profile, { forceEyesOpen: true });
    }
    if (roster.rootledoot) await window.Rootledoots.paintPortrait(frontCanvas);
    else await window.NpcAvatarPreview.renderProfileToCanvas(frontCanvas, profile, { forceEyesOpen: true });
    const neutralFrontCanvas = document.createElement('canvas'); // Immutable neutral/resting source used to restore this enemy immediately when combat ends.
    neutralFrontCanvas.width = neutralFrontCanvas.height = PORTRAIT_SIZE;
    neutralFrontCanvas.getContext('2d').drawImage(frontCanvas, 0, 0);
    const combatFrownCanvas = document.createElement('canvas'); // Pre-baked frown source used for synchronous combat entry and therefore available before an afterimage snapshots the live texture.
    combatFrownCanvas.width = combatFrownCanvas.height = PORTRAIT_SIZE;
    characterBuildStatus.stage = 'combat-portrait';
    if (roster.rootledoot) combatFrownCanvas.getContext('2d').drawImage(frontCanvas,0,0);
    else await window.NpcAvatarPreview.renderProfileToCanvas(combatFrownCanvas, profile, {
      forceEyesOpen: true,
      breathingComposer: COMBAT_FROWN_COMPOSER,
      seatId: 'bandit-combat-frown',
    });
    const backCanvas = document.createElement('canvas');
    backCanvas.width = backCanvas.height = PORTRAIT_SIZE;
    characterBuildStatus.stage = 'back-portrait';
    if (roster.rootledoot) await window.Rootledoots.paintPortrait(backCanvas,true);
    else await window.NpcAvatarPreview.renderProfileToCanvas(backCanvas, profile, { portraitView: 'behind', forceEyesOpen: true });
    let ruinRearTorsoCanvas=null; // Unobstructed authored torso, including pixels hidden by skull/hair in the composite.
    if(['hronal','tothal'].includes(roster.ruinSkeletonTheme)){
      ruinRearTorsoCanvas=document.createElement('canvas');ruinRearTorsoCanvas.width=backCanvas.width;ruinRearTorsoCanvas.height=backCanvas.height;
      await window.NpcAvatarPreview.renderProfileToCanvas(ruinRearTorsoCanvas,profile,{portraitView:'behind',forceEyesOpen:true,onlyTorsoSprite:true});
    }
    const themedPantsOverlay=roster.ruinSkeletonTheme?await window.PantsGarmentRenderer?.buildOverlayMask?.(frontCanvas,profile,{forceEyesOpen:true})?.catch(error=>{window.__farmLog?.('[ruin skeleton pants mask] '+error.message,'warn','combat');return null;}):null; // Compare ORIGINAL art; frost/char/oil are not clothing occluders.
    if(roster.ruinSkeletonTheme)await window.MinionCombat?.paintRuinPortraits?.(roster,[frontCanvas,neutralFrontCanvas,combatFrownCanvas,backCanvas]);
    // Imlao keeps an articulated, normally sized head rig but has no skull: the portrait is re-rendered with the head sprite skipped,
    // so the torso, collar and rear cloth the skull normally hides show through (not an erased hole).
    // The untouched renders below stay as the rig canvases, so head bones and weights still come from the real skull.
    const transparentLichSkull = roster.specialLichId === 'imlao'; // Limits the headless render to this named boss.
    const headCanvas = document.createElement('canvas'); // Shared front head-only portrait also locates every humanoid's neck pivot.
    headCanvas.width = headCanvas.height = PORTRAIT_SIZE;
    if (!roster.rootledoot) await window.NpcAvatarPreview.renderProfileToCanvas(headCanvas, profile, { forceEyesOpen: true, onlyHeadSprite: true });
    const originalHeadRigFront = transparentLichSkull ? document.createElement('canvas') : frontCanvas; // Skull-bearing pixels retain correct head-skin weights.
    const originalHeadRigBack = transparentLichSkull ? document.createElement('canvas') : backCanvas; // The rear neck shares the same true head proportions.
    if (transparentLichSkull) {
      for (const [source, original] of [[frontCanvas, originalHeadRigFront], [backCanvas, originalHeadRigBack]]) {
        original.width = source.width; original.height = source.height;
        original.getContext('2d').drawImage(source, 0, 0);
      }
      const redraw = async (canvas, options) => {
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        await window.NpcAvatarPreview.renderProfileToCanvas(canvas, profile, { forceEyesOpen: true, skipHeadSprite: true, ...options });
      };
      await redraw(frontCanvas, {});
      const neutralContext = neutralFrontCanvas.getContext('2d');
      neutralContext.clearRect(0, 0, neutralFrontCanvas.width, neutralFrontCanvas.height);
      neutralContext.drawImage(frontCanvas, 0, 0);
      await redraw(combatFrownCanvas, { breathingComposer: COMBAT_FROWN_COMPOSER, seatId: 'bandit-combat-frown' });
      await redraw(backCanvas, { portraitView: 'behind' });
    }
    characterBuildStatus.stage = 'portrait-model';
    const rootLegLayout=roster.rootledoot?rootledootLegLayout(frontCanvas.rootledootOpaqueHeightFraction,window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.['kenkari::male']):null; // Shared live/Workshop anatomy, computed only at build time.
    const portrait = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(
      THREE, frontCanvas,
      {
        backCanvas, profile, modelWidth: MODEL_W, modelHeight: MODEL_W, anchorZ: 0,
        ...(rootLegLayout?{portraitPlacementRatioOverride:rootLegLayout.placementRatio,posteriorAtOpaqueCenter:true}:{}),
        alphaTest: avatarCfg.worldAlphaTest ?? 0.01, name: 'bandit_portrait', meshBudget: 'npc', // Enemies use the capped mesh budget.
        hatOverflow: false, // The front/back meshes are re-parented onto separate pivots below; HatOverflowPlane.attachToPlanes is called on those instead.
        mountSpecies: roster.mountSpecies || null, mountGenotype: roster.mountGenotype || null, // Ridden mount card (omgurku-species-runtime.js MOUNTS); returns a compound avatar.
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
    let headMaskCanvas = null; // Only the opt-in 'mask' gate needs a head + head-cosmetics alpha render.
    if (roster.headGate === 'mask') {
      headMaskCanvas = document.createElement('canvas');
      headMaskCanvas.width = headMaskCanvas.height = PORTRAIT_SIZE;
      await window.NpcAvatarPreview.renderProfileToCanvas(headMaskCanvas, profile, { forceEyesOpen: true, headCosmeticsOnly: true });
    }
    const headGate = window.PNGPlaneAvatar.npcHeadGateFor?.(roster.appearance?.speciesId, roster.headGate) ?? roster.headGate; // All non-Harlyao humanoid enemies default to legacy; authored workshop overrides and skeleton defaults remain intact.
    const neckPivotPx = roster.rootledoot ? null : (window.PNGPlaneAvatar.detectHeadRigPixels?.(headCanvas, originalHeadRigFront, 12)?.pivotPx
      || window.PNGPlaneAvatar.detectNeckPivotPx?.(originalHeadRigFront, 12)); // A Rootledoot is a single rigid root portrait, not an articulated head.
    const neckPivotNormalized = neckPivotPx
      ? { x: neckPivotPx.x / frontCanvas.width, y: neckPivotPx.y / frontCanvas.height }
      : null;
    // The back mesh's geometry is a clone without PlaneGeometry parameters, so the
    // skin upgrade falls back to these: they must include the species scale
    // multiplier, or the back view is drawn smaller than the front.
    const portraitPlaneW = portrait.userData?.portraitModelWidth || MODEL_W;
    const portraitPlaneH = portrait.userData?.portraitModelHeight || MODEL_W;
    const frontNeckSkin = neckPivotNormalized
      ? window.PNGPlaneAvatar.upgradePlaneToAutoNeckSkin?.(THREE, frontMesh, neckPivotNormalized, false, { width: portraitPlaneW, height: portraitPlaneH, sourceCanvas:originalHeadRigFront, headCanvas, headGate, headMaskCanvas, speciesId: roster.appearance?.speciesId, gender: roster.appearance?.gender, placementRatio: portrait.userData?.portraitVerticalPlacementRatio ?? 0.5, handAttachY: portrait.userData?.handAttachY, freezePortrait: true, cosmeticIds: roster.equippedCosmetics })
      : null;
    const backNeckSkin = neckPivotNormalized
      ? window.PNGPlaneAvatar.upgradePlaneToAutoNeckSkin?.(THREE, backMesh, neckPivotNormalized, true, { width: portraitPlaneW, height: portraitPlaneH, sourceCanvas:originalHeadRigBack, headCanvas, headGate, headMaskCanvas, speciesId: roster.appearance?.speciesId, gender: roster.appearance?.gender, placementRatio: portrait.userData?.portraitVerticalPlacementRatio ?? 0.5, handAttachY: portrait.userData?.handAttachY, freezePortrait: true, cosmeticIds: roster.equippedCosmetics })
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
    // Big hats: brim/crown pixels past the portrait square ride each plane's head bone (js/hat-overflow-plane.js).
    window.HatOverflowPlane?.attachToPlanes?.(THREE, {
      profile, sourceCanvas: frontCanvas,
      isCancelled:()=>!!(portrait.userData?.portraitDisposed||group.userData?.portraitDisposed), // Reject late bakes on retired bandits.
      modelWidth: portraitPlaneW, modelHeight: portraitPlaneH,
      planes: [
        { view: 'front', mesh: renderedFrontMesh, headBone: frontNeckSkin?.headScaleBone || null },
        { view: 'behind', mesh: renderedBackMesh, headBone: backNeckSkin?.headScaleBone || null },
      ],
    });
    // The normal PNG root becomes a hidden hand-driver identity below. Move
    // its authored mask light onto the visible hostile neck before discarding
    // that original hierarchy, so the real fake-light registry sees it.
    if (portrait.userData?.portraitGlowLight) {
      const neck = frontNeckSkin?.headScaleBone || frontNeckSkin?.neckBone;
      window.PNGPlaneAvatar.setPortraitGlowAttachment?.(portrait, neck || frontPivot, {
        x: frontNeckSkin?.neckLocal?.x || 0, y: frontPivot.position.y + (frontNeckSkin?.neckLocal?.y || 0), z: 0,
      });
    }

    // Procedural feet, mirroring the NPC walker's own ProceduralLegAnimation.attach
    // call (see makeNpcWalker) -- needs its own floor-anchored pivot rather than
    // reusing `group` directly, since (unlike playerMesh/the walker's root) `group`
    // here already IS the sprite's own transform, sitting at world Y = surfY +
    // halfHeight (see makeBanditEntity), not at floor level. A child positioned at
    // local Y = -halfHeight cancels that back out to true floor level -- attach()
    // itself assumes its parent's local Y=0 is the floor (see its own comment).
    const modelWidth = portrait.userData?.portraitModelWidth || MODEL_W;
    const modelHeight = portrait.userData?.portraitModelHeight || MODEL_W;
    const rootPosteriorY=rootLegLayout?(portrait.userData.posteriorYOverride??modelHeight*rootLegLayout.posteriorFraction):null; // Exact alpha midpoint from the same scan as the portrait; crop fraction is a fallback.
    if(rootLegLayout){
      portrait.userData.posteriorYOverride=rootPosteriorY;
      const rigProfile=window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.['mao-ao::male'];
      const space=window.HobunjiCharacterPortraitAnchorSpace,metrics=space?.metricsForAvatarRoot?.(portrait,rigProfile);
      const shoulders={}; // Resolve each authored shoulder exactly once; both wrapped and direct hand queries share it.
      const reaches={};
      const wristY=rootPosteriorY-modelHeight*(Number(rigProfile?.anatomy?.armLengthHeightPercentOffset)||0)/100;
      for(const side of ['left','right']){
        const key=side+'HandShoulder',p=metrics&&space.resolveAnchor(rigProfile,key,metrics);
        if(!p||![p.x,p.y,p.z].every(Number.isFinite))continue;
        shoulders[side]={x:p.x,y:p.y,z:p.z};reaches[side]=Math.max(.001,Math.hypot(p.y-wristY,p.z));
      }
      if(Object.keys(shoulders).length===2){
        portrait.userData.instanceHandShoulders=shoulders;
        portrait.userData.armLengthBySide=reaches;
        portrait.userData.armLength=portrait.userData.scaledArmLength=(reaches.left+reaches.right)/2;
        portrait.userData.armLengthSource='instance-shoulder-to-opaque-posterior';
      }
      group.userData.rootledootLegLayout={...rootLegLayout,posteriorY:rootPosteriorY};
    }
    // Preserve the portrait box recipe on the converted animal-style root:
    // authored width/height plus vertical placement, with runtime world scale
    // applied later by ranged-weapons' shared player/NPC 3D hitbox resolver.
    group.userData.portraitModelWidth = modelWidth;
    group.userData.portraitModelHeight = modelHeight;
    if (frontNeckSkin) {
      const headPixels = window.PNGPlaneAvatar.detectHeadRigPixels?.(headCanvas, originalHeadRigFront, 12);
      group.userData.sourceCanvas = originalHeadRigFront;
      group.userData.neckRig = {
        available:true, skinnedPlane:frontNeckSkin.mesh,
        neckJoint:frontNeckSkin.neckBone, headScaleJoint:frontNeckSkin.headScaleBone,
        neckLocal:{...frontNeckSkin.neckLocal}, // Plane-space neck pivot; the bone's own position is now relative to the spine bone.
        spinePosteriorY:frontNeckSkin.spinePosteriorY,
        spineBase:frontNeckSkin.spineBase,
        headCentroidPx:headPixels?.centroidPx || neckPivotPx,
        headBoundsPx:window.PNGPlaneAvatar.headGateBounds?.(headPixels?.boundsPx, headGate, roster.appearance?.speciesId, headMaskCanvas, false, roster.equippedCosmetics) || headPixels?.boundsPx || null,
      }; // Head-relative poses (including blowguns) now share the player's real mouth/head frame.
    }
    if (roster.specialLichId && window.SpecialHarlyaoLiches?.prepareHeadFire) { // Named guardians: hidden flame headband emitter pixels + circlet overlay (see combat-special-liches.js).
      group.userData.specialHeadFire = await window.SpecialHarlyaoLiches.prepareHeadFire(profile, roster, async (renderProfile, renderOptions) => {
        const fireCanvas = document.createElement('canvas');
        fireCanvas.width = fireCanvas.height = PORTRAIT_SIZE;
        await window.NpcAvatarPreview.renderProfileToCanvas(fireCanvas, renderProfile, renderOptions);
        return fireCanvas;
      }, PORTRAIT_SIZE).catch(error => { window.__farmLog?.('[special-lich] head fire setup failed: ' + (error?.message || error), 'warn'); return null; });
    }
    group.userData.skullPixelsTransparent = transparentLichSkull; // Mobile Pixel Probe/Workshop can verify that invisibility used a cutout rather than a scaled-away head.
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
    handsPivot.rotation.y = Math.PI / 2; // Same portrait-local -> enemy side-facing correction as legsFrame: free (ungripping) hands rest at the shoulders' lateral X, not the hostile's forward axis. Gripped hands follow the weapon in world space and are unaffected.
    group.add(handsPivot);
    portrait.position.set(0, -(modelHeight / 2), 0); // The original PNGPlaneAvatar root is now a metadata/hand-driver sentinel at the hostile's true floor origin.
    handsPivot.userData.hobunjiCharacterRigScaleInherited = true; // The whole hostile group carries the species body scale (applyAuthoredHostileRigScale); hands inherit it rather than being scaled again by the hand-attach hook.
    portrait.userData.proceduralHandParent = handsPivot; // ProceduralHandFrameDriver attaches rendered hands to this visible hostile hierarchy instead of the discarded portrait assembly.
    group.add(portrait); // Its front/back meshes were already extracted above, so parenting it enables hand discovery without double-rendering the portrait.
    // legsPivot's rotation.y is kept in sync with the same pngRot-derived
    // planeDelta the front/back planes use (see updateCreatureMesh), not
    // group's own free-tracking groupRot -- so the legs share whichever
    // dead-zone behavior currently governs the visible sprite (see
    // CREATURE_PLANE_ROT_MODE) instead of drifting out of sync with it,
    // same clipping fix applied to the mounted-rider case.
    characterBuildStatus.stage = 'leg-rig';
    const spine = window.HobunjiCharacterSpine?.bind(portrait, { speciesId: roster.appearance.speciesId, gender: roster.appearance.gender, spine: roster.spine }) || null; // Static hunch from the enemy loadout rule; shoulder aim reads it live off the portrait root.
    if (spine?.hunch > 0 && frontNeckSkin) { // Stoop the portrait itself: lower the spine bone of both the front and rear skins (they share the same weights).
      window.HobunjiCharacterSpine.applyToRig({ splineNodes: { front: frontNeckSkin.splineNodes, back: backNeckSkin?.splineNodes }, neckLocal: frontNeckSkin.neckLocal, spinePosteriorY: frontNeckSkin.spinePosteriorY, spineBase: frontNeckSkin.spineBase, blendHeight: frontNeckSkin.weightedGeometry?.userData?.blendHeight }, spine, modelHeight); // Hostile shoulder and attack orbit calculations sample the same short base-head neck band as the portrait.
    }
    const legs = window.ProceduralLegAnimation?.attach(THREE, legsFrame, {
      speciesId: roster.appearance.speciesId, gender: roster.appearance.gender,
      bodyColors: profile?.bodyColors || roster.appearance.bodyColors,
      modelWidth, modelHeight, handAttachY: portrait.userData?.handAttachY,
      name: roster.name || 'bandit', profile, portraitSize: PORTRAIT_SIZE,
      ...(rootLegLayout?{posteriorYOverride:rootPosteriorY,gaitReachLimit:modelHeight*rootLegLayout.gaitReach,stanceDropMax:modelHeight*rootLegLayout.gap*.8,legLengthRatioOverride:1}:{}), // Keep the real hip at center and limit stride to short exposed legs.
      gaitProfile: roster.maskboundGait || null, // Independent troop lurch walks in the shared procedural leg solver; ordinary NPCs stay on normal gait.
      spine: spine || undefined, // Wider stance and stride for a hunched enemy.
      portraitRig: frontNeckSkin ? { skinnedPlane: frontNeckSkin.mesh, splineNodes: frontNeckSkin.splineNodes, neckLocal: frontNeckSkin.neckLocal } : undefined, // "Show bones" also draws the portrait's spine and neck.
    }) || null;

    const enemyPants = window.PantsGarmentRenderer?.garmentForCosmetics(roster.equippedCosmetics); // Same rig, dyes, update and disposal owner as town NPCs.
    if (legs && enemyPants) {
      frontPivot.userData.portraitModelWidth = modelWidth;
      frontPivot.userData.portraitModelHeight = modelHeight;
      const pants = window.PantsGarmentRenderer.attachToLegs(THREE, legs, { // Finish creating the mesh before downstream ghost/ghoul material conversion.
        avatarGroup: frontPivot, speciesId: roster.appearance.speciesId, gender: roster.appearance.gender, // Follow the portrait's facing/death pivot while sampling the sibling leg rig in world space.
        spine, // The pants ride the portrait's spine curve like an extension of it (frontPivot is not the avatar root the profile is bound to).
        name: roster.name || 'enemy', garmentId: enemyPants, meshBudget: 'npc', // Enemies use the capped garment grid.
        appearance: pantsAppearanceWithForcedPattern(window.PantsGarmentRenderer.appearanceFromBodyColors(profile.bodyColors), roster),
        overlayMask: roster.ruinSkeletonTheme?themedPantsOverlay:window.PantsGarmentRenderer.buildOverlayMask(frontCanvas, profile, { forceEyesOpen: true }),
        transformCanvas:roster.ruinSkeletonTheme?canvas=>window.MinionCombat.paintRuinPants(roster,canvas):null, // Bakes themed art on every real garment appearance render, not the shared weaving cache.
      });
      characterBuildStatus.pantsAttached = !!pants && await pants.readyPromise;
    }

    return {
      group, frontPlane: frontPivot, backPlane: backPivot, legsPivot, legs,
      frontPortraitMesh: renderedFrontMesh, backPortraitMesh: renderedBackMesh, // Exact carriers used by frozen stance rendering.
      ruinRearTorsoCanvas, // Original torso alpha, prior to skull/cosmetic compositing.
      handsPivot, syncHandFrame() { handsPivot.rotation.y = (legsPivot.rotation.y || 0) + Math.PI / 2; }, // Keeps the hands frame turned exactly like the legs/planes (see game.js updateCreatureMesh, creature-death).
      handRigAvatarRoot: portrait, textureRoot: portrait, resolvedRosterDyes, spine,
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
      headOffsetJoint: (frontNeckSkin && backNeckSkin) ? { front: frontNeckSkin.headOffsetBone, back: backNeckSkin.headOffsetBone } : null, // Independently positions front/back heads without extending the short rotational neck bend.
      headScaleJoint: (frontNeckSkin && backNeckSkin) ? {front:frontNeckSkin.headScaleBone,back:backNeckSkin.headScaleBone} : null,
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
    if (upper?.userData?.sourceCanvas) window.HatOverflowPlane?.attach?.(THREE, upper, { profile, backCanvas }); // The rider keeps its own portrait hierarchy, so the ordinary overflow attach applies (the build itself opted out).
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
    const { upper, riderFrame } = mount;
    const scale = Number(upper.scale?.x) || 1;
    const floorY = group.position.y - (c.halfHeight || 0);
    const p = holder.position;
    const dx = p.x - group.position.x, dy = p.y - floorY, dz = p.z - group.position.z;
    riderFrame.getWorldPosition(p); // Includes the compound root's floor offset and any intervening pivots/scales.
    p.set(p.x + dx * scale, p.y + dy * scale, p.z + dz * scale);
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
    window.CombatVocalizations?.onHostileAlertState?.(entity, next); // The existing combat-state transition drives skeleton alarms independently of damage and of whether the portrait can show a frown.
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

  // Tier-0 CAPTAIN baseline. Ordinary bandit attacks and Stamina use the
  // existing rank/tier stat curve, while the optional Health-only curve gives
  // weak ranks more time to be staggered, flanked, and knocked into hazards.
  // Captain (90 HP at tier 0), mine Ghouls, and authored overrides are unchanged.
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
    const tierBonus = cfg?._preserveMineEnemyTiers ? tier : (window.EnemyTierProgression?.progressionStep(tier) ?? Math.floor(Math.max(0, tier) / 2)); // Ghoul mine-floor mastery remains unchanged.
    return deps.clamp(Math.round(base + tierBonus), 0, 5);
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
  // The rank/tier weapon material roll, shared by the weapon itself and by rank metal armor (which must match it before the portrait is baked).
  function rollBanditWeaponMetalKey(cfg, rank, tier) {
    const [minT, maxT] = cfg?.weaponMetalTierRangeByRank?.[rank] || [1, 2];
    const bonusT = cfg?._preserveMineEnemyTiers ? tier : (window.EnemyTierProgression?.progressionStep(tier) ?? Math.floor(Math.max(0, tier) / 2)); // One metal ceiling increase per TWO danger tiers, preserving the former upper bound.
    const maxMetalTier = Math.max(...deps.VERDIGRIS_METAL_KEYS.map(k => deps.METAL_DEFS[k].tier));
    const loT = deps.clamp(Math.round(minT), 1, maxMetalTier), hiT = deps.clamp(Math.round(maxT) + bonusT, loT, maxMetalTier);
    const tierPool = deps.VERDIGRIS_METAL_KEYS.filter(k => deps.METAL_DEFS[k].tier >= loT && deps.METAL_DEFS[k].tier <= hiT);
    return (tierPool.length ? tierPool : deps.VERDIGRIS_METAL_KEYS)[Math.floor(deps.rnd() * (tierPool.length || deps.VERDIGRIS_METAL_KEYS.length))]; // Existing rank/tier material roll retained for ordinary bandits.
  }
  const configuredWeaponMetalKey = cfg => typeof cfg?.weaponMetalKey === 'string' && deps.METAL_DEFS[cfg.weaponMetalKey] ? cfg.weaponMetalKey : null; // Optional fixed material used by special callers.

  function banditWeaponFor(cfg, rank, tier) {
    if(cfg?._rootledootWeaponPool){
      const metalKey=configuredWeaponMetalKey(cfg)||rollBanditWeaponMetalKey(cfg,rank,tier);
      const api=window.BanditCaptainArmaments,modular=window.ModularWeapons;
      const pairs=api?.rootledootPairs?.(modular)||[]; // Foundry compatibility, never a whole-weapon fallback.
      const keys=pairs.map(p=>modular.itemKey(p.shaft,p.head,metalKey)).filter(k=>deps.TOOL_ITEM_DEFS[k]?.modular);
      const saved=cfg._rootledootPreviewKey;
      const weaponKey=saved&&api.isRootledootWeapon(saved)&&deps.TOOL_ITEM_DEFS[saved]?.modular?saved:keys[Math.floor(deps.rnd()*keys.length)];
      const item=deps.TOOL_ITEM_DEFS[weaponKey];if(!item)throw Error('No compatible Rootledoot modular weapons for '+metalKey);
      const dmgMultiplier=window.EnemyTierProgression?.weaponMultiplier(item.metalKey,tier,deps.METAL_DEFS,deps.VERDIGRIS_METAL_KEYS)??deps.metalDmgMultiplier(item.metalKey);
      return {weaponKey,shapeKey:item.shapeKey,metalKey:item.metalKey,dmgType:item.dmgType||'sharp',dmgMultiplier,animStyle:item.animStyle};
    }
    const shapeKeys = banditWeaponShapeKeys(cfg); // Caller-specific pool when supplied; otherwise the unchanged full weapon-slot pool.
    const shapeKey = shapeKeys[Math.floor(deps.rnd() * shapeKeys.length)]; // Selected melee shape used for held rendering, attacks, and ability style.
    const shape = deps.HELD_SHAPE_DEFS[shapeKey]; // Canonical shape metadata supplies damage type and animation semantics.
    const configuredMetalKey = configuredWeaponMetalKey(cfg); // Null preserves rank/tier metal rolling.
    const rolledMetalKey = configuredMetalKey ? null : rollBanditWeaponMetalKey(cfg, rank, tier);
    const metalKey = configuredMetalKey || rolledMetalKey; // Final material passed to item-key generation and damage scaling.
    const weaponKey = deps.craftedToolItemKey(shapeKey, metalKey);
    const gradedMultiplier = cfg?._preserveMineEnemyTiers ? null : window.EnemyTierProgression?.weaponMultiplier(metalKey, tier, deps.METAL_DEFS, deps.VERDIGRIS_METAL_KEYS); // Humanoid weapon damage uses exactly the same I-IV power grades as smithing.
    return { weaponKey, shapeKey, metalKey, dmgType: shape.dmgType || 'sharp', dmgMultiplier: gradedMultiplier ?? deps.metalDmgMultiplier(metalKey) };
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
    const recipeWeights = cfg?.flasker?.recipeWeights;
    const pool = available.filter(id=>!recipeWeights || Number(recipeWeights[id])>0); // Per-bandit copy used for sampling without replacement.
    const picked = []; // Used by AI and corpse loot; exactly two entries with the current authored tuning when possible.
    while (picked.length < requested && pool.length) {
      const random = deps?.rnd?.() ?? Math.random();
      let index = Math.min(pool.length - 1, Math.floor(random * pool.length));
      if (recipeWeights) {
        let cursor = random * pool.reduce((sum, id) => sum + Number(recipeWeights[id]), 0);
        index = pool.findIndex(id => (cursor -= Number(recipeWeights[id])) < 0);
        if (index < 0) index = pool.length - 1;
      }
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
    // A staged NPC duel nobody can see (js/combat/npc-duel-staging.js): no throw
    // animation, projectile or splash query -- the recipe is applied straight
    // to the opponent on a hit roll, at the normal throw cadence. Visible staged
    // throws stay real; one flask every few seconds is already cheap.
    const staging = window.NpcDuelStaging;
    if (staging?.engage?.(c, targetPlayer) && staging.bothHidden(c, targetPlayer)) {
      c.facing = towardAngle;
      c._banditFlaskCooldownT = tuning.throwCooldownSeconds + durationS;
      if (staging.rollAbstractHit(targetPlayer)) {
        const alchemy = window.AlchemySystem;
        const tier = Math.max(0, Math.min(4, Math.floor(Number(c.def?.banditFlaskPotencyTier) || 0)));
        alchemy?.applyRecipeToEntity?.(recipeId, alchemy.potencyMultiplier?.(tier) ?? 1, targetPlayer, { splash: true, potencyTier: tier, skipEmpower: true });
      }
      return { handled: true, aimAngle: towardAngle, moving: false, flasker: true };
    }
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
    const tierRankMultipliers = (cfg?._preserveMineEnemyTiers ? cfg?.legacyMineRankMultipliersByRank?.[rank] : null) || cfg?.statMultiplierByRankAndTier?.[rank]; // Mine Ghouls use the original four rank curves instead of the expanded bandit ones.
    // Tier-indexed rank curves keep low-star camps weak while preserving
    // meaningful supporting ranks in higher-star camps.
    const weaken = Number(
      Array.isArray(tierRankMultipliers)
        ? tierRankMultipliers[Math.min(Math.max(0, tier), tierRankMultipliers.length - 1)]
        : (cfg?.statWeakenMultiplierByRank?.[rank] ?? 1),
    );
    const tierMul = 1 + tier * (cfg?._preserveMineEnemyTiers ? 0.12 : Number(cfg?.difficultyTiers?.tierStatBonusPerTier ?? 0)); // Mine Ghouls retain their authored ten-floor curve.
    const statMul = weaken * tierMul;
    const healthTierMultipliers = cfg?._preserveMineEnemyTiers ? null : cfg?.healthMultiplierByRankAndTier?.[rank]; // Separate wilderness humanoid HP from the attack/Stamina curve; Ghouls keep their historic mine curve.
    const healthRankMultiplier = Array.isArray(healthTierMultipliers) && healthTierMultipliers.length
      ? Number(healthTierMultipliers[Math.min(Math.max(0, tier), healthTierMultipliers.length - 1)]) : weaken; // Rank/tier HP only; missing or malformed curves preserve the original scaling.
    const healthStatMul = (Number.isFinite(healthRankMultiplier) && healthRankMultiplier > 0 ? healthRankMultiplier : weaken) * tierMul; // Used only for maxHealth so extra survivability never increases outgoing damage or Stamina.
    const weapon = banditWeaponFor(cfg, rank, tier);
    const isFlasker = rank === 'flasker'; // Used to reserve this rank's ranged role for its infinite two-flask loadout.
    const rangedWeaponKey = isFlasker||cfg._rootledootWeaponPool ? null : banditRangedWeaponFor(cfg, rank);
    const banditFlaskLoadout = isFlasker ? rollBanditFlaskLoadout(cfg) : []; // Per-entity definition; uses never decrement it.
    const flaskerTuning = isFlasker ? banditFlaskerTuning(cfg) : null; // Shared AI/loot tuning stored with this spawned hostile.
    const shapeStats = (cfg._rootledootWeaponPool?window.WeaponShapeStats?.forKey?.(weapon.weaponKey,deps.TOOL_ITEM_DEFS[weapon.weaponKey]):window.WeaponShapeStats?.forShape?.(weapon.shapeKey)) || { power: 1, speed: 1, range: 1, efficiency: 1 }; // NPCs use the same physical shape stats as player weapons.
    const weaponEfficiency = Number(shapeStats.efficiency); // Validate the shape's stamina efficiency before using it for both attack cost and capacity.
    const attackStaminaCost = BANDIT_ATTACK_STAMINA_COST / (Number.isFinite(weaponEfficiency) && weaponEfficiency > 0 ? weaponEfficiency : 1); // The opening-attack gate and capacity floor must use the same final cost.
    const minimumAttacks = cfg?._preserveMineEnemyTiers ? 1 : 2; // Keep the original mine stamina curve wherever viable; new danger-tier bandits need two affordable openings.
    const maxStamina = Math.max(1, Math.round(BANDIT_BASE_MAX_STAMINA * statMul), Math.ceil(attackStaminaCost * minimumAttacks)); // Do not scale a fighter's attack budget below the stamina cost of its own weapon.
    const dmgMul = statMul * (1 + mastery * BANDIT_MASTERY_DAMAGE_PER_LEVEL) * weapon.dmgMultiplier * shapeStats.power;
    const held = Number(cfg?.heldAbilitiesByRank?.[rank] ?? 0);
    const pursuit = cfg?.combatPursuit; // Normal-bandit-specific awareness and sprint pacing, supplied by the existing bandit config.
    const quickTuning = cfg?.quickAttackTuning; // Per-tier chance affects Exhaust Cutter and Mercy Spike; Backstab Flick uses positional tactics.
    const configuredChase = Number(pursuit?.baseChaseSpeedPxS);
    const configuredTierChase = Number(pursuit?.chaseBonusPerTierPxS);
    const chaseBase = Number.isFinite(configuredChase) && configuredChase > 0 ? configuredChase : 165;
    const chaseTierStep = Number.isFinite(configuredTierChase) && configuredTierChase >= 0 ? configuredTierChase : 2.5;
    const quickBase = Number(quickTuning?.baseChance);
    const quickStep = Number(quickTuning?.bonusPerTier);
    return {
      label: BANDIT_RANK_LABEL[rank] || 'Bandit',
      hostile: true, liveBirth: true,
      maxHealth: Math.max(1, Math.round(BANDIT_BASE_MAX_HEALTH * healthStatMul)),
      maxStamina,
      moveSpeed: 118 + tier * (cfg?._preserveMineEnemyTiers ? 4 : 2), // Existing ten-floor ghoul movement stays as before.
      chaseSpeed: (cfg?._preserveMineEnemyTiers ? 165 + tier * 5 : chaseBase + tier * chaseTierStep) + (rank === 'captain' ? 20 : rank === 'lieutenant' ? 10 : 0), // Fast direct pursuit; Ghoul mine keeps its prior chase curve.
      attackDamage: Math.max(1, Math.round(BANDIT_BASE_ATTACK_DAMAGE * dmgMul)),
      attackRangePx: deps.TILE * BANDIT_ATTACK_RANGE_TILES * shapeStats.range,
      attackHalfConeRad: Math.min(Math.PI, BANDIT_ATTACK_HALF_CONE_DEG * Math.PI / 180 * shapeStats.range),
      attackStaminaCost,
      attackCooldownS: (rank === 'captain' ? BANDIT_ATTACK_COOLDOWN_S_CAPTAIN : BANDIT_ATTACK_COOLDOWN_S_OTHER) / shapeStats.speed,
      attackTag: weapon.dmgType,
      weaponKey: weapon.weaponKey,
      ...(cfg._ruinCoffinWeapon||cfg._rootledootWeaponPool?{weaponShapeKey:weapon.shapeKey,weaponMetalKey:weapon.metalKey}:{}), // Preserve the exact rolled shape for bound relic loot even before generated item definitions settle.
      weaponMetalPowerMultiplier: weapon.dmgMultiplier, // Arena and combat diagnostics show the exact effective metal grade, not only the metal's name.
      weaponShapeStats: shapeStats, // Used below to keep NPC attack windups, lunges and affliction delivery in sync.
      rangedWeaponKey,
      banditFlaskLoadout,
      banditFlaskerTuning: flaskerTuning,
      banditFlaskPotencyTier: isFlasker ? (cfg?._preserveMineEnemyTiers ? Math.min(4, tier) : Math.floor(tier * 4 / (window.EnemyTierProgression?.MAX_TIER || 7))) : 0, // Eight danger tiers distribute the existing five potion potencies instead of maxing out halfway. // Used for both infinite AI throws and the matching corpse drops.
      banditAbilityLoadout: { ...banditAbilityLoadout(weapon.shapeKey, held), ...(weapon.animStyle?{tap1:weapon.animStyle==='thrust'?'pokeCombo':'swingCombo'}:{}) },
      quickAttackChance: quickTuning && Number.isFinite(quickBase) && Number.isFinite(quickStep)
        ? Math.max(0, Math.min(1, quickBase + tier * quickStep)) : BANDIT_QUICK_ATTACK_CHANCE, // Fixed at spawn; no tier/config lookups per attack.
      backstabFlankMaxSeconds: Math.max(0, Number(quickTuning?.backstabFlankMaxSeconds) || 2),
      backstabRetrySeconds: Math.max(0, Number(quickTuning?.backstabRetrySeconds) || 2.5),
      banditStandoffMaxTiles: pursuit ? Math.max(1.5, Number(pursuit.standoffMaxTiles) || 3.6) : null, // Null preserves the original large standoff rings for special humanoid encounters.
      banditStandoffTierStepTiles: pursuit ? Math.max(0, Number(pursuit.standoffTierStepTiles) || 0.2) : null,
      aiType: 'vigilantProtector',
      aggroRangePx: deps.TILE * ((Number(pursuit?.aggroRangeTiles) > 0 ? Number(pursuit.aggroRangeTiles) : 6.2) + (rank === 'captain' ? 1.1 : rank === 'lieutenant' ? 0.5 : 0)),
      leashRangePx: deps.TILE * ((Number(pursuit?.leashRangeTiles) > 0 ? Number(pursuit.leashRangeTiles) : 10) + (rank === 'captain' ? 2 : rank === 'lieutenant' ? 1 : 0)),
      canClimb: false, canSwim: false,
      modelWidth, tint: 0xffffff,
      // Quarter-turn correction for the portrait plane convention -- see
      // buildBanditAvatar's long comment.
      aimAngleOffset: Math.PI / 2,
      lootPool: 'bandit_' + rank,
    };
  }


  function applyEnemyCombatBuild(def, rank, tier, mineEnemy, opts = {}, authoredRule = null) {
    const perks = window.PerkSystem; // Live player tree also powers ordinary humanoid combat progression.
    const extra = opts.extra || {}; // Bespoke boss/caster choreography retains its authored tuning.
    if (!perks?.buildEnemyCombatProfile || def.combatPerkModifiers || opts.disableCombatClass || extra.combatTutorialTarget || extra.combatTutorialPreview || extra.isMaskboundTitan || extra.isHarlyaoDemolitionist || extra.lichType || opts.rosterOverride?.lichType || extra.maskboundTroop === 'headtaker' || extra.mineWyrmWitchType || !def.banditAbilityLoadout?.tap1) return def;
    const random = perks.enemyCombatRandom(opts.combatBuildSeed, deps.rnd); // Persistent abstract actors get the same class and loadout when their rig is rebuilt.
    const combatClass = perks.rollEnemyCombatClass(random); // Separate from enemyClass, which identifies faction/species elsewhere.
    const level = perks.enemyCombatLevel(rank, tier, mineEnemy);
    const loadout = { ...def.banditAbilityLoadout }; // Per-entity copy; never change a shared authored attack object.
    if (loadout.tap2 && !authoredRule?.attacks?.tap2 && !Object.hasOwn(opts.defOverride?.banditAbilityLoadout || {}, 'tap2')) {
      loadout.tap2 = perks.enemyQuickAttack(combatClass, random) || loadout.tap2;
    }
    // Keep the rank's held-ability count, but a one-hold fighter can specialize
    // in a counter rather than a charge. Fixed Workshop and caller slots win.
    const fixedSlots = opts.defOverride?.banditAbilityLoadout || {}; // Caller-authored abilities must never be overwritten.
    if (loadout.hold1 === 'chargedBreaker' && !loadout.hold2
        && !authoredRule?.attacks?.hold1 && !authoredRule?.attacks?.hold2
        && !Object.hasOwn(fixedSlots, 'hold1') && !Object.hasOwn(fixedSlots, 'hold2')
        && perks.enemyHeldAttack(combatClass, random) === 'counterShield') {
      loadout.hold1 = null;
      loadout.hold2 = 'counterShield';
    }
    def.banditAbilityLoadout = loadout;
    def.combatPerkMinimumAttacks = mineEnemy ? 1 : 2; // Preserve the factory's original opening stamina budget when equipment changes.
    return installEnemyCombatProfile(def, combatClass, level);
  }

  function installEnemyCombatProfile(def, combatClass, level) {
    const previous = def.combatPerkModifiers; // Equipment wrappers may rebuild a profile; remove its old multipliers before installing the new ones.
    const baseHealth = def.combatPerkBaseHealth ??= def.maxHealth; // Retain exact unscaled capacities across weapon swaps.
    const baseStamina = def.combatPerkBaseStamina ??= def.maxStamina;
    const baseCost = def.attackStaminaCost / (previous?.staminaCost ?? 1);
    const profile = window.PerkSystem.buildEnemyCombatProfile(combatClass, level, def.banditAbilityLoadout, def.attackTag, def.rangedWeaponKey);
    Object.assign(def, profile);
    def.combatPerkWeaponSignature = JSON.stringify([def.attackTag, def.rangedWeaponKey || null]); // Used only by spawn-time equipment reconciliation.
    const mods = profile.combatPerkModifiers; // Use the enemy's own existing lower base resources and stamina cost.
    def.maxHealth = Math.max(1, Math.round(baseHealth * mods.health));
    def.maxStamina = Math.max(1, Math.round(baseStamina * mods.stamina), Math.ceil(baseCost * mods.staminaCost * (def.combatPerkMinimumAttacks || 1)));
    def.attackStaminaCost = baseCost * mods.staminaCost; // AI affordability checks and actual spend share the same value.
    return def;
  }

  function refreshEnemyCombatBuild(entity) {
    const def = entity?.def; // Cultural and modular equipment wrappers run after the ordinary factory.
    if (!def?.combatPerkModifiers || def.combatPerkWeaponSignature === JSON.stringify([def.attackTag, def.rangedWeaponKey || null])) return entity;
    const resources = window.ResourceSystem;
    const fraction = key => {
      const maximum = resources?.getEffectiveMax?.(entity, key) ?? entity[key === 'health' ? 'maxHealth' : 'maxStamina'];
      return maximum > 0 ? Math.max(0, Math.min(1, entity[key] / maximum)) : 0;
    }; // Reconciliation is spawn-time, but preserves missing-resource fractions rather than granting a heal.
    const healthFraction = fraction('health'), staminaFraction = fraction('stamina');
    installEnemyCombatProfile(def, def.combatClass, def.combatLevel);
    entity.maxHealth = def.maxHealth;
    entity.maxStamina = def.maxStamina;
    entity.health = (resources?.getEffectiveMax?.(entity, 'health') ?? entity.maxHealth) * healthFraction;
    entity.stamina = (resources?.getEffectiveMax?.(entity, 'stamina') ?? entity.maxStamina) * staminaFraction;
    return entity;
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
  const BANDIT_QUICK_ATTACK_CHANCE = 0.45; // Fallback for callers without ordinary-bandit difficulty tuning.
  function banditQuickAttackChance(c, loadout, conditions) {
    const technique = loadout?.tap2; // Only the actual equipped Quick Attack can compete with the ordinary combo.
    if (technique === 'backstabFlick') return conditions?.behind ? 1 : 0; // A successful flank deserves its own positional payoff.
    if (technique !== 'exhaustCutter' && technique !== 'mercySpike') return 0;
    if (!(technique === 'exhaustCutter' ? conditions?.exhausted : conditions?.lowHealth)) return 0;
    const chance = Number(c?.def?.quickAttackChance); // Materialized from danger tier on the enemy definition.
    return Number.isFinite(chance) ? Math.max(0, Math.min(1, chance)) : BANDIT_QUICK_ATTACK_CHANCE;
  }
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

  function beginBanditMeleeStage(c, options, target) {
    window.FeyIllusions?.setActionDuration?.(c, (Number(options.windupS) || 0) + (Number(options.strikeS) || 0) + (Number(options.recoverS) || 0)); // A Demented NPC's perception rotates over its actual two-strike lifetime, not the default 220ms fallback.
    const originalStrike = options.onStrike, originalComplete = options.onComplete, originalCancel = options.onCancel; // The real hit-resolution callbacks stay the single source of truth for when the target can be attacked again.
    const guardedOptions = {
      ...options,
      onStrike: (...args) => {
        try { originalStrike?.(...args); }
        finally {
          const echo = c._feyHypedNpcSequence; // A Fey-paid strike has a second *physical* hit; keep the turn through its extra windup and release only after that resolves.
          if (!echo || echo.echo) releaseBanditAttackTurn(c, target);
        }
      },
      onComplete: (...args) => {
        try { originalComplete?.(...args); }
        finally { releaseBanditAttackTurn(c, target); } // Fallback for a stage that completes without a hit callback.
      },
      onCancel: (...args) => {
        try { originalCancel?.(...args); }
        finally { releaseBanditAttackTurn(c, target); } // Interrupted windups cannot strand the one-attacker token.
      },
    }; // Shared Combat.beginStagedAction and FeyHypedAttacks both use this same lifecycle.
    const hype = window.FeyHypedAttacks; // Shared enhanced-Stamina executor owns the two NPC stages, not a duplicate AI or render pose.
    const payment = hype?.claimNpcMelee?.(c); // Only actually spent, eligible Hyped Stamina is committed to this particular NPC melee attack.
    if (!payment) return window.Combat.beginStagedAction(guardedOptions);
    c._banditSwingHoldS = Math.max(0, Number(c._banditSwingHoldS) || 0) / payment.tempo; // Existing SharedAttackPose holder follows its own doubled-speed attack clock.
    c._banditSwingReturnS = Math.max(0, Number(c._banditSwingReturnS) || 0) / payment.tempo;
    const firstLunge = c._banditLunging && (Number(c._banditLungeDistancePx) || 0) > 0
      ? { distancePx: c._banditLungeDistancePx, hitTest: c._banditLungeHitTest } : null; // Captured once because the live lunge's hit-stop clears its cone metadata.
    if (c._banditLunging) {
      c._banditLungeDur /= payment.tempo; // The same swept lunge travels its authored distance within the accelerated first windup.
      c._banditLungeT /= payment.tempo;
    }
    const firstLungeDuration = Number(c._banditLungeDur) || 0; // Used only if the second authored strike also has a legal original lunge.
    return hype.beginNpcMelee(c, {
      ...guardedOptions,
      feyHypedNpcTarget: target, // Protects the second strike from a vanished or map-transitioned enemy.
      onFeyHypedNpcEchoStart: ratio => {
        if (!firstLunge || !(ratio > 0) || !target || !(Number(target.health) > 0)) return;
        if (c._banditLunging) cancelBanditLunge(c); // Finish the original movement budget before launching an independent second burst.
        beginBanditLunge(c, firstLunge.distancePx * ratio, firstLungeDuration, firstLunge.hitTest, firstLunge.hitTest ? target : null);
      }, // NPC echo movement has the same original obstacle sweeps but 2%-per-point scaled travel, as player Hyped echoes do.
    }, payment);
  }

  function resolvedBanditCombatTarget(c, fallbackTarget) {
    const target = c?._chunkCombatTarget; // Set only by the tribe camps' active-player-chunk ecology pass.
    if (!target) return fallbackTarget;
    const alive = Number(target.health) > 0;
    const sameArea = !target.areaId || !c?.areaId || target.areaId === c.areaId;
    if (alive && sameArea) return target;
    c._chunkCombatTarget = null;
    // The ecology fight is over. This clear happens before porakaneki-camps-runtime's
    // setHumanoidEcologyTarget(null) can see a `prior` target, so its "don't leave the
    // actor in 'chase' with no target" reset never ran. The actor was left in 'chase'
    // (then 'searching') for the player it never fought, which isPlayerInCombat reads
    // as the player being in combat and starts the combat music. Stand down instead;
    // the ordinary hostile loop re-aggros the player at once if they are really in
    // aggro range and visible.
    if (c.state === 'chase' || c.state === 'searching') c.state = 'return';
    return fallbackTarget;
  } // Keeps ordinary player combat unchanged whenever no local faction target is assigned.
  function damageBanditCombatTarget(c, target, amount, fromX, fromY, knockbackPxS, opts = {}) {
    const echo = window.FeyHypedAttacks?.npcDamagePayload?.(c, target, amount, knockbackPxS, opts); // Real hit owner, including NPC→player and offscreen NPC→NPC, scales one independently tested second contact.
    if (echo) { amount = echo.damage; knockbackPxS = echo.knockback; opts = echo.opts; }
    const trinketHit = window.TrinketSystem?.scaleEnemyHit?.(c, amount, opts); // Shared trinket authority keeps Health and Footing separate for NPC→player and NPC→NPC hits.
    if (trinketHit) { amount = trinketHit.amount; opts = trinketHit.options; }
    const actorTarget = target && (
      target.isBandit === true
      || target.isPorakanekiHunter === true
      || target.banditCompanion === true
      || typeof target.creatureKey === 'string'
    ); // Staged swings retain actor identity even if the 5 Hz ecology pass changes c._chunkCombatTarget before impact.
    const beforeHealth = Number(target?.health); // Enchantment events use the post-mitigation difference, not the telegraph's predicted damage.
    let outcome;
    if (actorTarget && typeof deps.damageCreature === 'function') {
      outcome = deps.damageCreature(target, amount, fromX, fromY, knockbackPxS, {
        ...opts,
        friendlyFire: true,
        factionCombat: true,
        attacker: c,
      });
    } else {
      const struckPlayer = window.ActorRegistry?.isPlayer(target) ? target : null; // Hit the player actually targeted; no target keeps the legacy local-player behaviour.
      outcome = struckPlayer && window.DamageAuthority
        ? window.DamageAuthority.hit(struckPlayer, amount, fromX, fromY, knockbackPxS, { ...opts, attacker: c })
        : deps.damagePlayer(amount, fromX, fromY, knockbackPxS, { ...opts, attacker: c });
    }
    if (c && Number(target?.health) < beforeHealth) window.Combat?.noteStrikeConnected?.(c); // A landed strike closes Opportunist Jab's counter window for this attack.
    if (c?._banditCaptainArmament || c?.ruinWallCoffin) {
      const afterHealth = Number(target?.health); // Uses the actual victim (player or NPC), so allied skirmishes can proc enchantments too.
      const actualDamage = Number.isFinite(beforeHealth) && Number.isFinite(afterHealth)
        ? Math.max(0, beforeHealth - afterHealth) : 0;
      if(c.ruinWallCoffin)window.MinionCombat?.emitRuinEnchantedHit?.(c,target,actualDamage,opts.enchantmentSlot||'tap1');
      if(c._banditCaptainArmament)window.BanditCaptainArmaments?.emitHit?.(c, target, actualDamage, opts.enchantmentSlot || 'tap1', {
        comboFinisher: opts.comboFinisher === true, quickBonusEffectProc: opts.quickBonusEffectProc === true,
      });
    }
    return outcome;
  } // Bandit ability code is shared by bandit-vs-player and chunk-local actor-vs-actor fights.

  // Mirrors combat-quickattacks.js's getConditions(), but for a bandit
  // attacking the player instead of the player attacking a creature --
  // "behind" is recomputed from the player's own facing (player.angle)
  // since the real version reads target.facing (a creature-only field);
  // "enemyStriking" has no equivalent (the player has no telegraphState)
  // and always reads false, which is exactly why opportunistJab (the
  // only technique keyed on it) is excluded from BANDIT_QUICK_ATTACK_IDS.
  function banditBehindTarget(c, targetPlayer) {
    const dx = c.x - targetPlayer.x, dy = c.y - targetPlayer.y;
    const distance = Math.max(0.001, Math.hypot(dx, dy)); // Evaluates the real behind bonus without checking expensive Health/Stamina-affliction bands during every flank frame.
    const facing = Number.isFinite(Number(targetPlayer.angle)) ? Number(targetPlayer.angle) : (Number(targetPlayer.facing) || 0);
    return (Math.cos(facing) * dx + Math.sin(facing) * dy) / distance < -0.35;
  }

  function banditQuickAttackConditions(c, targetPlayer) {
    const staminaForCondition = window.ResourceSystem?.getDepletionEquivalentCurrent?.(targetPlayer, 'stamina') ?? targetPlayer.stamina; // Mirrors the player's Exhaust Cutter semantics for enemy ability AI.
    const healthForCondition = window.ResourceSystem?.getDepletionEquivalentCurrent?.(targetPlayer, 'health') ?? targetPlayer.health; // Mirrors the player's Mercy Spike semantics for enemy ability AI.
    return {
      enemyStriking: false,
      exhausted: !!targetPlayer.exhaustion?.active || staminaForCondition <= targetPlayer.maxStamina * 0.20,
      behind: banditBehindTarget(c, targetPlayer),
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
    c._banditChargeReleaseAction = null; // A released held charge only holds its full windup pose until its own stage finishes.
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
    if(c.ruinSkeletonTheme==='hronal')c._ruinTrailRemaining=0; // Each committed lunge starts its own trail.
    c._banditLunging = true;
    c._banditLungeT = durationS;
    c._banditLungeDur = durationS;
    c._windBanditLungeIntegrated = false; // Preserve incremental wind displacement until the committed lunge finishes.
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
    c._banditLungeAirborne = lungeProfile.hopUnits > 0.01 || lungeProfile.directFlightStrength > 0.01; // Only genuine airborne enemy lunges rebound from walls.
    c._banditLungeImpactResolved = false; // Per-lunge wall-impact guard; the attacker can launch another lunge later.
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
    const priorProgress = 1 - Math.pow(c._banditLungeT / c._banditLungeDur, 3);
    const travelDt = Math.min(Math.max(0, dt), Math.max(0, c._banditLungeT)); // Only charge the committed remainder, not excess frame time.
    c._banditLungeT = Math.max(0, c._banditLungeT - travelDt);
    const t = 1 - c._banditLungeT / c._banditLungeDur;
    const eased = 1 - Math.pow(1 - t, 3);
    const lungeStep = c._banditLungeDistancePx * Math.max(0, eased - priorProgress);
    const motion = window.ResourceSystem?.composeMovement?.(c, c._banditLungeDirX * lungeStep, c._banditLungeDirY * lungeStep, { mode: 'lunge', scalarApplied: true, rotationApplied: true, reference: lungeStep, dt: travelDt }); // Cone-halted attacks no longer regain horizontal motion from a fallback wind speed.
    if (motion?.wind) c._windBanditLungeIntegrated = true;
    const desiredX = c._windBanditLungeIntegrated ? c.x + (motion?.x ?? c._banditLungeDirX * lungeStep) : c._banditLungeStartX + c._banditLungeDirX * c._banditLungeDistancePx * eased;
    const desiredY = c._windBanditLungeIntegrated ? c.y + (motion?.y ?? c._banditLungeDirY * lungeStep) : c._banditLungeStartY + c._banditLungeDirY * c._banditLungeDistancePx * eased;
    c._banditLungeHopCurrent = (c._banditLungeHopUnits || 0) * Math.sin(eased * Math.PI);
    const swept = deps.sweptMove(c.x, c.y, desiredX, desiredY, (x, y) => deps.canOccupyAt(x, y, deps.TILE * 0.32));
    const stepPx = Math.hypot(swept.x - c.x, swept.y - c.y);
    if(c.ruinSkeletonTheme==='hronal'||c.ruinSkeletonTheme==='kanthic')window.MinionCombat?.trailMovement?.(c,c.x,c.y,swept.x,swept.y,'lunge',deps.TILE);
    c.x = swept.x; c.y = swept.y;
    if (motion?.wind) window.ResourceSystem?.commitMovement?.(c, motion, Math.min(1, stepPx / Math.max(.00001, Math.hypot(motion.x, motion.y))), window.Combat?.deps?.movementFootingDepleted);
    if (c.prone) return true;
    if (swept.blockedAt && c._banditLungeAirborne && !c._banditLungeImpactResolved) {
      const state = {
        airborne: true, lungeMaxDistancePx: c._banditLungeDistancePx,
        lungeTraveledPx: Math.hypot(c.x - c._banditLungeStartX, c.y - c._banditLungeStartY),
      }; // Uses the committed budget rather than remaining time; glancing walls cannot erase the collision penalty.
      window.KnockbackCollisionImpact?.resolveAerialLunge?.(c, state,
        { kind: 'stone', label: 'Airborne enemy lunge impact' }, deps.TILE, {
          dealHealthDamage: (entity, amount) => {
            const before = Math.max(0, Number(entity.health) || 0);
            deps.damageCreature?.(entity, amount, entity.x, entity.y, 0,
              { tag: 'blunt', environmentalImpact: true, attacker: entity });
            return { applied: Math.max(0, before - Math.max(0, Number(entity.health) || 0)), lethal: entity.health <= 0 };
          },
        });
      c._banditLungeImpactResolved = true;
      c._banditLungeT = 0; // No pushing repeatedly into the same solid wall on subsequent frames.
    }
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
    if (c._banditPreparedCharge) releaseBanditCharge(c, c._banditPreparedCharge.target); // Leaving chase or being staggered cancels a readied charge along with ordinary lunge motion.
    c._banditLunging = false;
    c._banditLungeHopCurrent = 0;
  }

  // opts.staged: an NPC-vs-NPC duel the player is not part of (see
  // js/combat/npc-duel-staging.js). Same pose, lunge, trail and audio, but no
  // 3D aim solve, no per-frame lunge cone probe, a 2D strike test and no
  // afflictions -- and the defender may play a cosmetic dodge.
  function payBanditAttack(c, def, tempoActionKind) {
    const tempo = window.ResourceSystem?.attackTempoMultiplier?.(c, tempoActionKind) ?? 1; // Snapshot before expenditure; keep Fey's NPC sequence identity.
    window.ResourceSystem?.spendStamina(c, def.attackStaminaCost, 'bandit attack', { actionKind: 'combatNpcMelee', abilityId: 'npcMelee', tempoActionKind });
    return tempo;
  }

  function fireBanditComboStep(c, def, loadout, targetPlayer, opts = null) {
    const staged = opts?.staged === true && !!window.NpcDuelStaging;
    const comboData = window.Combat?.comboData;
    const steps = comboData?.[loadout.tap1];
    if (!steps || !steps.length) return false;
    // Preserve the selected index before advancing, matching the player
    // combo path. comboData's pitch array is updated in place by
    // applyComboConfig, so the loaded attack-values config remains the
    // authority for bandit mirrors of either combo family too.
    const comboStep = c._banditComboIndex % steps.length;
    const step = steps[comboStep];
    const baseShape = def.weaponShapeStats || window.WeaponShapeStats?.DEFAULT || { power: 1, speed: 1, range: 1, efficiency: 1 }; // Preserve authored reach/power; only the speed snapshot changes.
    const shapeStats = { ...baseShape, speed: baseShape.speed * payBanditAttack(c, def, 'combatCombo') };
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
    const halfConeRad = Math.min(Math.PI, step.halfConeDeg * Math.PI / 180 * shapeStats.range * (def.combatPerkModifiers?.aoe ?? 1));
    const knockbackPxS = base.knockbackPxS * step.knockbackMul * shapeStats.power;
    const aimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    c.facing = aimAngle;
    c._banditAimPitch = staged ? 0 : (window.Combat?.meleeAimSolution?.(c, targetPlayer, aimAngle, 0)?.pitch || 0); // Used by this enemy's leap, 3D hit cone, and pitched trail. // lunge direction locks off c.facing -- must be fresh, not last frame's
    c.telegraphState = 'windup';
    // The same authored pose the player's combo plays for this step (power already applied), or the step's own.
    const stepPose = window.Combat?.comboStepPose?.(loadout.tap1, step) || null;
    c._banditSwingAnim = step.anim; c._banditSwingPose = stepPose || step.pose || null;
    c._banditSwingDirSign = step.dirSign || 1; c._banditSwingPower = stepPose ? 1 : (step.power || 1);
    c._banditSwingPoseScale = 1; c._banditSwingWindupCurve = null;
    c._banditSwingHoldS = (step.holdS || 0) / shapeStats.speed; c._banditSwingReturnS = (step.returnS || 0) / shapeStats.speed; // Same pause / finisher tail combat-combo.js hands the player's swing visual.
    const lungeBudgetPx = deps.TILE * (step.lungeMul || 1) * (comboData?.LUNGE_SCALE || 1.5) * (def.combatPerkModifiers?.lunge ?? 1);
    const lungeDurationS = (step.windupS + step.strikeS) / shapeStats.speed;
    if (staged) {
      // Pre-capped instead of halted by a per-frame meleeHit probe (null hitTest skips it).
      const gapPx = Math.hypot(targetPlayer.x - c.x, targetPlayer.y - c.y) - rangePx * BANDIT_LUNGE_HALT_MARGIN;
      if (gapPx > 0) beginBanditLunge(c, Math.min(lungeBudgetPx, gapPx), lungeDurationS, null, null);
      window.NpcDuelStaging.maybeStageDodge(targetPlayer, c, step.windupS / shapeStats.speed);
    } else {
      beginBanditLunge(c, lungeBudgetPx, lungeDurationS, { rangePx, halfConeRad }, targetPlayer);
    }
    // Tracked so onComplete below can tell a whiff from a landed hit --
    // a bandit should only break off (retreat) on a miss or after
    // landing its 3rd/final step, never after landing steps 1-2, which
    // should chain straight into the next step instead.
    let comboStepHit = false;
    c._banditAction = beginBanditMeleeStage(c, {
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
      data: { isBandit: true, attacker: c, comboId: loadout.tap1, comboStep, isComboFinisher: isFinalStep, sfxPitch, voiceCategory: 'combo', voiceAbilityId: loadout.tap1 },
      onStrike: () => {
        c.telegraphState = 'strike';
        // The hit and trail use the facing frozen when pre-windup alignment completed.
        if (!staged || !window.NpcDuelStaging.isHidden(c)) spawnBanditTrailArc(c, rangePx, halfConeRad, c.facing);
        const landed = staged
          ? window.NpcDuelStaging.strikeLands(c, targetPlayer, rangePx, halfConeRad)
          : window.Combat?.meleeHit?.(c, targetPlayer, { rangePx, halfConeRad, yaw: c.facing, pitch: c._banditAimPitch || 0 });
        if (landed && staged) {
          if (!comboStepHit) c._banditComboLandCount = (c._banditComboLandCount || 0) + 1; // A Hyped second hit is still the same combo step, not a phantom extra chain point.
          comboStepHit = true;
          damageBanditCombatTarget(c, targetPlayer, damage, c.x, c.y, knockbackPxS, { tag: def.attackTag, stagedDuel: true, enchantmentSlot: 'tap1', comboFinisher: isFinalStep, perkHeavy: !!step.heavy });
          window.AudioSystem?.playWeaponHitSfx(def.attackTag, c.x, c.y, c.areaId, sfxPitch, ['small', 'medium', 'large'][comboStep]);
        } else if (landed) {
          if (!comboStepHit) c._banditComboLandCount = (c._banditComboLandCount || 0) + 1; // A Hyped second hit is still the same combo step, not a phantom extra chain point.
          comboStepHit = true;
          // def.attackTag (the bandit's actual rolled weapon material,
          // see weaponDamageTypeForTool/weapon.dmgType) determines both
          // the affliction dealt and the impact sound -- matches the
          // player's own combat-combo.js fix, which no longer tags a
          // swing by combo family (sweep=blunt/thrust=sharp) regardless
          // of the equipped weapon's real material.
          damageBanditCombatTarget(c, targetPlayer, damage, c.x, c.y, knockbackPxS, { tag: def.attackTag, enchantmentSlot: 'tap1', comboFinisher: isFinalStep, perkHeavy: !!step.heavy, afflictionBonuses: window.CombatAttackEvents?.scaleAfflictions?.(window.ResourceSystem?.afflictionBonusesForTag(def.attackTag), 1) || window.ResourceSystem?.afflictionBonusesForTag(def.attackTag) });
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
    }, targetPlayer);
    return true;
  }

  function fireBanditQuickAttack(c, def, loadout, targetPlayer) {
    const qa = window.Combat?.quickAttackData;
    const techDef = qa?.TECHNIQUES?.[loadout.tap2];
    if (!techDef) return false;
    payBanditAttack(c, def, 'combatQuickAttack'); // Quick attacks generate either tempo reserve but do not spend them.
    const cond = banditQuickAttackConditions(c, targetPlayer);
    const tech = window.Combat.buildQuickAttack(techDef, cond);
    const shapeStats = def.weaponShapeStats || window.WeaponShapeStats?.DEFAULT || { power: 1, speed: 1, range: 1, efficiency: 1 }; // Quick-attack timing follows the equipped bandit shape.
    const base = banditAttackBaseline(def);
    // combat-quickattacks.js's own RANGE_SCALE (0.6) shrinks the raw
    // rangeMul-scaled cone -- see the matching comment in
    // fireBanditComboStep, same "read as oversized" fix applies here.
    const rangePx = base.rangePx * tech.rangeMul * (qa.RANGE_SCALE ?? 1);
    const halfConeRad = Math.min(Math.PI, tech.halfConeDeg * Math.PI / 180 * shapeStats.range * (def.combatPerkModifiers?.aoe ?? 1));
    const aimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    c.facing = aimAngle;
    c._banditAimPitch = window.Combat?.meleeAimSolution?.(c, targetPlayer, aimAngle, 0)?.pitch || 0; // Used by this enemy's leap, 3D hit cone, and pitched trail.
    c.telegraphState = 'windup';
    c._banditSwingAnim = 'thrust'; c._banditSwingPose = qa.quickAttackPose?.() || null; // The player's Quick Attack jab.
    c._banditSwingDirSign = 1; c._banditSwingPower = 1;
    c._banditSwingPoseScale = 1; c._banditSwingWindupCurve = null;
    c._banditSwingHoldS = (qa.HOLD_S || 0) / shapeStats.speed; c._banditSwingReturnS = 0; // Same post-strike pause the player's quick attack swing visual gets.
    beginBanditLunge(c, deps.TILE * (qa.LUNGE_TILE_MUL || 5.5) * (def.combatPerkModifiers?.lunge ?? 1), (qa.WINDUP_S + qa.STRIKE_S) / shapeStats.speed, { rangePx, halfConeRad }, targetPlayer);
    let techHit = false;
    c._banditAction = beginBanditMeleeStage(c, {
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
          damageBanditCombatTarget(c, targetPlayer, impactDamage, c.x, c.y, impactKnockback, { tag: def.attackTag, enchantmentSlot: 'tap2', quickBonusEffectProc: impactTech.bonusActive, afflictionBonuses: window.CombatAttackEvents?.scaleAfflictions?.(window.ResourceSystem?.afflictionBonusesForTag(def.attackTag), 1) || window.ResourceSystem?.afflictionBonusesForTag(def.attackTag) });
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
    }, targetPlayer);
    return true;
  }

  function fireBanditChargedBreaker(c, def, targetPlayer, prepared = null) {
    const cb = window.Combat?.chargedBreakerData;
    if (!cb) return false;
    const baseShape = def.weaponShapeStats || window.WeaponShapeStats?.DEFAULT || { power: 1, speed: 1, range: 1, efficiency: 1 };
    const paidTempo = payBanditAttack(c, def, 'offensiveHeldCharge'); // Actual release owns the payment; preparation only snapshots.
    const shapeStats = { ...baseShape, speed: baseShape.speed * (prepared?.furiousTempo ?? paidTempo) };
    const chargeT = Number.isFinite(Number(prepared?.chargeT)) ? deps.clamp(Number(prepared.chargeT), 0.5, 1) : 0.5 + deps.rnd() * 0.5; // A precharged attack retains the exact strength displayed during preparation.
    const base = banditAttackBaseline(def);
    const damage = Math.max(1, Math.round(base.damage * (cb.DAMAGE_MUL_MIN + (cb.DAMAGE_MUL_MAX - cb.DAMAGE_MUL_MIN) * chargeT)));
    const rangePx = base.rangePx * (cb.RANGE_MUL_MIN + (cb.RANGE_MUL_MAX - cb.RANGE_MUL_MIN) * chargeT);
    const halfConeDeg = cb.HALF_CONE_DEG_MIN + (cb.HALF_CONE_DEG_MAX - cb.HALF_CONE_DEG_MIN) * chargeT;
    const halfConeRad = Math.min(Math.PI, halfConeDeg * Math.PI / 180 * shapeStats.range * (def.combatPerkModifiers?.aoe ?? 1));
    const knockbackPxS = base.knockbackPxS * (cb.KNOCKBACK_MUL_MIN + (cb.KNOCKBACK_MUL_MAX - cb.KNOCKBACK_MUL_MIN) * chargeT) * shapeStats.power;
    const lungeTileMul = cb.LUNGE_TILE_MUL_MIN + (cb.LUNGE_TILE_MUL_MAX - cb.LUNGE_TILE_MUL_MIN) * chargeT;
    const pitchDistanceResistance = cb.LUNGE_GRAVITY_RESIST_MIN
      + (cb.LUNGE_GRAVITY_RESIST_MAX - cb.LUNGE_GRAVITY_RESIST_MIN) * chargeT;
    const rawWindupS = (cb.holdSecondsForPoseCharge?.(chargeT) ?? (cb.WINDUP_S * chargeT)) / shapeStats.speed;
    const windupS = prepared ? Math.min(0.12, rawWindupS) : rawWindupS; // After the separate visible charge, a short committed release allows the original swept lunge to catch up before the hit.
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
    c._banditSwingWindupCurve = !prepared && fullChargeS > 0 && cb.WINDUP_SLOWDOWN > 0
      ? { slowdown: cb.WINDUP_SLOWDOWN, span: Math.min(1, windupS * shapeStats.speed / fullChargeS) }
      : null;
    c._banditSwingHoldS = (cb.HOLD_S || 0) / shapeStats.speed; c._banditSwingReturnS = 0; // Same post-strike pause the player's Charged Breaker release gets.
    // Bandit AI has no literal held input, so it samples a pose charge and
    // derives how long the shared nonlinear windup would need to reach it.
    beginBanditLunge(
      c,
      deps.TILE * lungeTileMul * (def.combatPerkModifiers?.lunge ?? 1),
      windupS + cb.STRIKE_S / shapeStats.speed,
      { rangePx, halfConeRad, pitchDistanceResistance },
      targetPlayer,
    );
    let techHit = false;
    c._banditAction = beginBanditMeleeStage(c, {
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
            heavy: true, enchantmentSlot: 'hold1',
            afflictionBonuses: window.CombatAttackEvents?.scaleAfflictions?.(window.ResourceSystem?.afflictionBonusesForTag(def.attackTag), 1) || window.ResourceSystem?.afflictionBonusesForTag(def.attackTag),
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
    }, targetPlayer);
    if (c._banditSwingWindupCurve) c._banditSwingWindupCurve.action = c._banditAction; // The curve belongs to this one windup only.
    c._banditChargeReleaseAction = prepared ? c._banditAction : null; // The charged preparatory pose remains at full windup until the committed strike starts.
    return true;
  }

  // Counter Shield, hold2. Not a held button either -- a periodic timed
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
    if (banditDirectional(c) && (c._banditAction || c._banditPreparedCharge || !claimBanditAttackTurn(c, targetPlayer))) return; // Reactive counters cannot bypass the one-committed-strike rule or interrupt this actor's held pose.
    const base = banditAttackBaseline(def);
    const damage = Math.max(1, Math.round(base.damage * cs.COUNTER_DAMAGE_MUL));
    const rangePx = base.rangePx * cs.COUNTER_RANGE_MUL;
    const halfConeRad = Math.min(Math.PI, cs.COUNTER_HALF_CONE_DEG * Math.PI / 180 * (def.weaponShapeStats?.range || 1) * (def.combatPerkModifiers?.aoe ?? 1));
    const knockbackPxS = base.knockbackPxS * cs.COUNTER_KNOCKBACK_MUL * (def.weaponShapeStats?.power || 1);
    const aimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    const aimPitch = window.Combat?.meleeAimSolution?.(c, targetPlayer, aimAngle, 0)?.pitch || 0; // Used by the counter's 3D cone and ribbon.
    // Deliberately doesn't touch c._banditAction (a captain can be
    // mid-combo when guarded damage triggers this) or c._banditSwing* --
    // the riposte's own 0.2s swing is brief enough that skipping its
    // dedicated weapon-pose animation (rather than adding a second
    // parallel progress channel just for this) is an acceptable gap.
    const riposteOptions = {
      windupS: 0.05 / (def.weaponShapeStats?.speed || 1), strikeS: 0.15 / (def.weaponShapeStats?.speed || 1), recoverS: 0, // NPC counterstrike duration follows its weapon shape instead of a fixed 0.2s.
      data: { isBandit: true, attacker: c, voiceCategory: 'quickAttack', voiceAbilityId: 'counterShield' }, // Counter ripostes are active NPC voice events too.
      onStrike: () => {
        // def.attackTag (bandit's real weapon material) drives both the
        // affliction and the impact sound -- matches
        // combat-counter-shield.js's own riposte fix (no longer
        // hardcodes 'sharp' regardless of weapon).
        spawnBanditTrailArc(c, rangePx, halfConeRad, aimAngle, aimPitch);
        if (window.Combat?.meleeHit?.(c, targetPlayer, { rangePx, halfConeRad, yaw: aimAngle, pitch: aimPitch })) {
          damageBanditCombatTarget(c, targetPlayer, damage, c.x, c.y, knockbackPxS, { tag: def.attackTag, enchantmentSlot: 'hold2', afflictionBonuses: window.CombatAttackEvents?.scaleAfflictions?.(window.ResourceSystem?.afflictionBonusesForTag(def.attackTag), 1) || window.ResourceSystem?.afflictionBonusesForTag(def.attackTag) });
          window.AudioSystem?.playWeaponHitSfx(def.attackTag, c.x, c.y, c.areaId, undefined, 'large');
        }
      },
    };
    const strike = riposteOptions.onStrike; // Keep the actual counter-hit and sound processing as the turn-release boundary.
    riposteOptions.onStrike = (...args) => {
      try { strike(...args); }
      finally { releaseBanditAttackTurn(c, targetPlayer); }
    };
    riposteOptions.onComplete = () => releaseBanditAttackTurn(c, targetPlayer);
    riposteOptions.onCancel = () => releaseBanditAttackTurn(c, targetPlayer);
    window.Combat.beginStagedAction(riposteOptions);
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
  // Safe reach of the current combo step alone (also what a staged NPC duel
  // uses, since it only ever swings combo steps).
  function banditComboReachPx(c, def, loadout) {
    const base = banditAttackBaseline(def);
    const combo = window.Combat?.comboData;
    const steps = combo?.[loadout?.tap1];
    if (!steps?.length) return base.rangePx;
    const step = steps[(c._banditComboIndex || 0) % steps.length];
    const comboRangePx = base.rangePx * step.rangeMul * (combo.RANGE_SCALE ?? 1);
    const comboLungePx = deps.TILE * (step.lungeMul || 1) * (combo.LUNGE_SCALE || 1.5) * (def.combatPerkModifiers?.lunge ?? 1);
    return banditAbilitySafeReachPx(comboRangePx, comboLungePx, step.windupS, step.strikeS);
  }
  function banditEngagementReachPx(c, def, loadout, targetPlayer) {
    const base = banditAttackBaseline(def);
    let reach = banditComboReachPx(c, def, loadout);
    // Quick attack (tap2) can fire on ANY cycle regardless of which
    // combo step is current (see updateBanditCombatAI's conditionFavorable
    // roll), so its own safe reach always constrains this gate too.
    const qa = window.Combat?.quickAttackData;
    const techDef = qa?.TECHNIQUES?.[loadout.tap2];
    if (techDef && targetPlayer) {
      const cond = banditQuickAttackConditions(c, targetPlayer);
      const tech = window.Combat.buildQuickAttack(techDef, cond);
      const qaRangePx = base.rangePx * tech.rangeMul * (qa.RANGE_SCALE ?? 1);
      const qaLungePx = deps.TILE * (qa.LUNGE_TILE_MUL || 5.5) * (def.combatPerkModifiers?.lunge ?? 1);
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
        const cbLungePx = deps.TILE * cbLungeMul * (def.combatPerkModifiers?.lunge ?? 1);
        const cbWindupS = (cb.holdSecondsForPoseCharge?.(chargeT) ?? (cb.WINDUP_S * chargeT)) / (def.weaponShapeStats?.speed || 1);
        reach = Math.min(reach, banditAbilitySafeReachPx(cbRangePx, cbLungePx, cbWindupS, cb.STRIKE_S));
      }
    }
    return reach;
  }

  // ── Multi-attacker coordination ─────────────────────────────────
  //
  // Ordinary bandits claim four stable DIRECTIONS relative to the target's
  // facing: front, left, right and rear. Only one may commit to a melee
  // attack at once; a DIFFERENT actor may prepare a Charged Breaker while
  // that strike is resolving. Target-relative angles update with facing
  // without repeatedly reallocating slots. Special humanoids keep their
  // historical two-angle choreography.
  const BANDIT_MAX_ATTACK_SLOTS = 4;
  const BANDIT_SPECIAL_ATTACK_SLOTS = 2;
  const BANDIT_SLOT_MIN_ANGLE_RAD = 60 * Math.PI / 180;
  const BANDIT_DIRECTION_SECTORS = Object.freeze([
    { name: 'front', offset: 0 },
    { name: 'left', offset: Math.PI / 2 },
    { name: 'right', offset: -Math.PI / 2 },
    { name: 'rear', offset: Math.PI },
  ]); // Static target-relative sectors; all bandits reuse this four-element definition.
  const BANDIT_STANDOFF_RANGE_MUL = 1.8;
  function banditPersonalSpacePx() { return deps.TILE * 0.85; } // Reuse the established world-scale body spacing; evaluated only after init supplies deps.
  const BANDIT_STRAFE_ANGLE_AMPLITUDE_RAD = 30 * Math.PI / 180; // Stable authored 30° idle sway for close-in and queued melee fighters.
  const BANDIT_STRAFE_HZ = 0.14; // Authored slow formation breathing cadence, reused by waiting-ring decisions.
  const BANDIT_STRAFE_SPEED_PX_S = 55; // Final positioning speed after pursuing the assigned sector; never replaces chase sprint.
  const _banditAttackSlots = []; // [{ bandit, target, sector, angle }] The existing mobile arena log reads the same array.
  const _banditSlotForActor = new WeakMap(); // Constant-time existing-sector lookup; the strong debug collection is still pruned of dead/unloaded actors.
  let _banditSlotsPrunedAt = -Infinity; // Shared once-per-frame cleanup rather than scanning every combatant's peers on every AI decision.
  const BANDIT_SLOT_PRUNE_INTERVAL_MS = 12;
  const _banditTargetTurns = new WeakMap(); // O(1) per-target committed attacker/held-charge owner; targets are weak keys so unloads do not leak encounters.
  function banditDirectional(c) { return Number.isFinite(c?.def?.banditStandoffMaxTiles); } // Only ordinary bandits opt into the four-position coordinator.
  function banditTargetFacing(target) {
    return Number.isFinite(Number(target?.angle)) ? Number(target.angle) : (Number(target?.facing) || 0);
  }
  function banditSectorAngle(target, sector) {
    return banditTargetFacing(target) + BANDIT_DIRECTION_SECTORS[sector]?.offset;
  }
  function banditTurnState(target) {
    let state = _banditTargetTurns.get(target);
    if (!state) {
      state = { attack: null, charge: null };
      _banditTargetTurns.set(target, state);
    }
    return state;
  }
  function banditTurnValid(holder, target) {
    return !!holder && holder.target === target && holder.actor?.health > 0
      && holder.actor.state === 'chase' && !holder.actor.tzatzulCapturedBy
      && (!target?.areaId || !holder.actor.areaId || holder.actor.areaId === target.areaId);
  }
  function banditAttackTurnOwner(target) {
    const state = _banditTargetTurns.get(target);
    if (!state) return null;
    if (state.attack && !banditTurnValid(state.attack, target)) state.attack = null;
    return state.attack?.actor || null;
  }
  function banditChargeOwner(target) {
    const state = _banditTargetTurns.get(target);
    if (!state) return null;
    if (state.charge && (!banditTurnValid(state.charge, target)
      || state.charge.actor._banditPreparedCharge?.target !== target)) state.charge = null;
    return state.charge?.actor || null;
  }
  function banditPreparedChargeHasPriority(preparer, target) {
    const charge = preparer?._banditPreparedCharge;
    if (!charge || charge.target !== target || charge.t < charge.duration) return false;
    const dx = preparer.x - target.x, dy = preparer.y - target.y;
    const releaseRange = Number.isFinite(charge.reachPx) && charge.reachPx > 0 ? charge.reachPx : deps.TILE * 2.5; // A drawn charge has no right to block fighters who can already hit while its own lunge cannot reach.
    if (dx * dx + dy * dy > releaseRange * releaseRange) return false;
    const slot = _banditSlotForActor.get(preparer); // The existing per-actor WeakMap avoids a global scan for every waiting attacker.
    if (!slot || slot.target !== target) return false;
    if (slot.sector == null) return true;
    const angle = Math.atan2(dy, dx);
    return Math.abs(deps.angleDiff(angle, banditFacingSlotAngle(slot, target))) <= Math.PI / 3; // A charging rear fighter needs to reach their assigned segment before cutting in.
  }
  function claimBanditAttackTurn(actor, target) {
    if (!banditDirectional(actor)) return true; // Special NPC combat uses the unchanged stage and attack pipeline.
    const state = banditTurnState(target);
    const owner = banditAttackTurnOwner(target);
    if (owner) return false; // An actor must not reacquire the same turn during its own Counter Shield riposte, which intentionally has no _banditAction pose owner.
    const preparer = banditChargeOwner(target);
    if (!owner && preparer && preparer !== actor && banditPreparedChargeHasPriority(preparer, target)) return false; // A ready, POSITIONED held attack takes the next free turn.
    state.attack = { actor, target }; // Released immediately after the final resolved hit, not after cosmetic weapon recovery.
    return true;
  }
  function releaseBanditAttackTurn(actor, target) {
    const state = target && _banditTargetTurns.get(target);
    if (state?.attack?.actor === actor) state.attack = null;
  }
  function releaseBanditCharge(actor, target, keepPose = false) {
    const state = target && _banditTargetTurns.get(target);
    if (state?.charge?.actor === actor) state.charge = null;
    if (actor?._banditPreparedCharge?.target === target) actor._banditPreparedCharge = null;
    if (!keepPose && actor && !actor._banditAction) {
      actor.telegraphState = null;
      actor._banditToolTail = null;
      actor._banditToolSettleUntil = 0; // A canceled, draw-only windup has no follow-through; restore authored idle stances immediately.
      resetBanditSwingToNatural(actor); // A canceled charge restores the true weapon stance, including the hand rig.
    }
  }
  function beginBanditPreparedCharge(c, target) {
    if (!banditDirectional(c) || banditChargeOwner(target)) return false; // At most one preview charge exists for each opponent.
    const cb = window.Combat?.chargedBreakerData;
    if (!cb || c._banditPreparedCharge || c._banditAction) return false;
    const chargeT = 0.5 + deps.rnd() * 0.5; // Once per charge, matching the existing Charged Breaker roll (not a random draw every frame).
    const furiousTempo = window.ResourceSystem?.attackTempoMultiplier?.(c, 'offensiveHeldCharge') ?? 1; // Preserve this snapshot through the actual release.
    const speed = (c.def?.weaponShapeStats?.speed || 1) * furiousTempo;
    const rawWindup = cb.holdSecondsForPoseCharge?.(chargeT) ?? (cb.WINDUP_S * chargeT);
    const duration = Math.max(0.25, Number(rawWindup) / speed || 0.5); // The visible preparatory windup runs even while a second bandit attacks.
    const preview = { windupS: duration, strikeS: 0.01, t: 0, phase: 'windup' }; // Draw-only stage: Combat.beginStagedAction is not called until attack permission becomes free.
    const releaseRange = banditEngagementReachPx(c, c.def, c.def.banditAbilityLoadout, target); // The same existing safe attack-commit reach used by the real Charged Breaker release.
    const charge = { target, t: 0, duration, chargeT, action: preview, reachPx: releaseRange, furiousTempo }; // One immutable reach snapshot plus one advancing preview stage; no range recalculation in other fighters' hot loop.
    banditTurnState(target).charge = { actor: c, target };
    c._banditPreparedCharge = charge;
    c._rangedMode = false; // The held melee weapon, not a stowed crossbow, represents the charge.
    c._banditToolTail = null;
    c.telegraphState = 'windup';
    c._banditSwingAnim = 'sweep'; c._banditSwingPose = window.Combat?.poses?.SWEEP_POSE || null;
    c._banditSwingDirSign = 1; c._banditSwingPower = cb.POWER || 1.7;
    c._banditSwingPoseScale = chargeT; // Uses the same partial-charge weapon and procedural-hand transformations as the real attack.
    const fullChargeS = Number(cb.MAX_CHARGE_S ?? cb.WINDUP_S) || 0;
    c._banditSwingWindupCurve = fullChargeS > 0 && cb.WINDUP_SLOWDOWN > 0
      ? { slowdown: cb.WINDUP_SLOWDOWN, span: Math.min(1, duration * speed / fullChargeS), action: preview } : null;
    c._banditSwingHoldS = 0; c._banditSwingReturnS = 0;
    c._banditTactic = 'charging';
    return true;
  }

  function banditFacingSlotAngle(slot, target) {
    return slot?.sector == null ? slot?.angle : banditSectorAngle(target, slot.sector);
  }
  function claimBanditAttackSlot(c, towardAngle, target) {
    const now = performance.now();
    if (now - _banditSlotsPrunedAt >= BANDIT_SLOT_PRUNE_INTERVAL_MS) {
      _banditSlotsPrunedAt = now;
      for (let i = _banditAttackSlots.length - 1; i >= 0; i--) {
        const s = _banditAttackSlots[i];
        if (s.bandit.health <= 0 || s.bandit.state !== 'chase' || !s.bandit.avatarRef?.group?.parent) {
          _banditSlotForActor.delete(s.bandit);
          _banditAttackSlots.splice(i, 1);
        }
      }
    }
    const existing = _banditSlotForActor.get(c);
    if (existing?.target === target) {
      existing.angle = banditFacingSlotAngle(existing, target); // Sector identity persists, but its world angle follows the opponent's facing.
      return existing;
    }
    if (existing) {
      const index = _banditAttackSlots.indexOf(existing);
      if (index >= 0) _banditAttackSlots.splice(index, 1); // A changed opponent releases the former direction.
      _banditSlotForActor.delete(c);
    }
    if (!banditDirectional(c)) {
      const competing = _banditAttackSlots.filter(s => s.bandit.areaId === c.areaId && s.target === target);
      if (competing.length >= BANDIT_SPECIAL_ATTACK_SLOTS) return null;
      let angle = towardAngle;
      for (const s of competing) if (Math.abs(deps.angleDiff(angle, s.angle)) < BANDIT_SLOT_MIN_ANGLE_RAD) angle = s.angle + Math.PI;
      const slot = { bandit: c, target, angle, sector: null };
      _banditAttackSlots.push(slot);
      _banditSlotForActor.set(c, slot);
      releaseBanditQueueRing(c); // A promoted attacker must not also consume an outer waiting-ring place.
      return slot;
    }
    const used = [false, false, false, false]; // Four cheap flags, no pathfind/scene query; decide only on first slot acquisition.
    let occupied = 0, rearOwner = null;
    for (const s of _banditAttackSlots) {
      if (s.bandit.areaId !== c.areaId || s.target !== target) continue;
      occupied++;
      if (s.sector != null) {
        used[s.sector] = true;
        if (s.sector === 3) rearOwner = s;
      }
    }
    const backstabber = c.def?.banditAbilityLoadout?.tap2 === 'backstabFlick';
    if (occupied >= BANDIT_MAX_ATTACK_SLOTS) {
      if (!backstabber || !rearOwner || rearOwner.bandit.def?.banditAbilityLoadout?.tap2 === 'backstabFlick') return null;
      if (rearOwner.bandit._banditAction || rearOwner.bandit._banditPreparedCharge
        || banditAttackTurnOwner(target) === rearOwner.bandit) return null; // Do not steal a slot during its visible attack or charged preparation; the backstabber can claim it once safe.
      _banditAttackSlots.splice(_banditAttackSlots.indexOf(rearOwner), 1); // Upgrade an idle rear holder when a real Backstab specialist joins.
      _banditSlotForActor.delete(rearOwner.bandit);
      used[3] = false;
    }
    let chosen = -1, best = Infinity;
    const fromTarget = Math.atan2(c.y - target.y, c.x - target.x);
    for (let i = 0; i < BANDIT_DIRECTION_SECTORS.length; i++) {
      if (used[i]) continue;
      const distance = Math.abs(deps.angleDiff(fromTarget, banditSectorAngle(target, i)));
      const priority = backstabber ? (i === 3 ? -4 : 0) : (i === 3 ? 1 : 0); // Backstab users prefer rear; otherwise leave it free when possible.
      const score = distance + priority;
      if (score < best) { best = score; chosen = i; }
    }
    if (chosen < 0) return null;
    const slot = { bandit: c, target, sector: chosen, angle: banditSectorAngle(target, chosen) };
    _banditAttackSlots.push(slot);
    _banditSlotForActor.set(c, slot);
    releaseBanditQueueRing(c); // Clear the former waiting-ring reservation immediately on promotion into one of four directions.
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
  const _banditQueueRings = []; // [{ bandit, ringIndex, angle }] Preserved for existing arena and queue diagnostics.
  const _banditQueueForActor = new WeakMap(); // O(1) waiting-ring retention avoids the old every-frame full-array lookup.
  let _banditQueuePrunedAt = -Infinity; // Shared once-per-frame dead/unloaded cleanup, not once per queued combatant.

  function releaseBanditQueueRing(c) {
    const ring = _banditQueueForActor.get(c); // Shared with melee promotion and combat-mode cleanup; a queued fighter owns at most one ring.
    if (!ring) return false;
    const index = _banditQueueRings.indexOf(ring);
    if (index >= 0) _banditQueueRings.splice(index, 1);
    _banditQueueForActor.delete(c);
    return true;
  }

  function claimBanditQueueRing(c, towardAngle, target) {
    const now = performance.now();
    if (now - _banditQueuePrunedAt >= BANDIT_SLOT_PRUNE_INTERVAL_MS) {
      _banditQueuePrunedAt = now;
      for (let i = _banditQueueRings.length - 1; i >= 0; i--) {
        const q = _banditQueueRings[i];
        if (q.bandit.health <= 0 || q.bandit.state !== 'chase' || !q.bandit.avatarRef?.group?.parent) {
          _banditQueueForActor.delete(q.bandit);
          _banditQueueRings.splice(i, 1);
        }
      }
    }
    const existing = _banditQueueForActor.get(c);
    if (existing?.target === target) return existing;
    if (existing) {
      const index = _banditQueueRings.indexOf(existing);
      if (index >= 0) _banditQueueRings.splice(index, 1); // Reassign the waiting ring when a creature changes combat target.
      _banditQueueForActor.delete(c);
    }
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
    _banditQueueForActor.set(c, rec);
    return rec;
  }

  function releaseBanditApproach(c) {
    const slot = _banditSlotForActor.get(c); // A fighter that switches to ranged/flask/staged combat must release its previous melee sector.
    if (slot) {
      const index = _banditAttackSlots.indexOf(slot);
      if (index >= 0) _banditAttackSlots.splice(index, 1);
      _banditSlotForActor.delete(c);
    }
    releaseBanditQueueRing(c); // Combat-mode switches share the same one-owner queue release as slot promotion.
  }

  // A point on a ring of the given radius around the target, at the
  // given world angle -- moving toward this (rather than straight at
  // the target) is what actually draws a bandit around to its assigned
  // flank/standoff side as it closes in, instead of just walking the
  // direct line and hoping the angle check above sorts itself out.
  function banditRingPoint(targetPlayer, angle, radiusPx, result) {
    // Reuses each combatant's movement scratch point instead of allocating once per queued frame.
    result.x = targetPlayer.x + Math.cos(angle) * radiusPx;
    result.y = targetPlayer.y + Math.sin(angle) * radiusPx;
    return result;
  }

  function banditBackstabFlankPoint(c, target, engageRangePx, result) {
    const targetFacing = Number.isFinite(Number(target.angle)) ? Number(target.angle) : (Number(target.facing) || 0); // Same facing as the existing behind condition.
    const currentAngle = Math.atan2(c.y - target.y, c.x - target.x);
    const rearAngle = targetFacing + Math.PI;
    let turn = deps.angleDiff(rearAngle, currentAngle); // Follow the SHORT arc around the enemy instead of walking through their center.
    if (Math.abs(Math.abs(turn) - Math.PI) < 0.12) {
      const side = c._banditBackstabSide || ((c._banditStrafePhase || 0) < Math.PI ? 1 : -1);
      turn = Math.abs(turn) * side; // Perfectly frontal encounters choose a consistent side, preventing a left/right wobble.
    } else if (Math.abs(turn) > 0.5) c._banditBackstabSide = Math.sign(turn);
    const nextAngle = currentAngle + Math.max(-0.65, Math.min(0.65, turn)); // Incremental target: circling rather than diagonally cutting through the victim.
    const radius = Math.max(deps.TILE * 1.25, Math.min(deps.TILE * 2.15, engageRangePx * 0.7)); // Close enough to exploit Backstab Flick after arriving.
    return banditRingPoint(target, nextAngle, radius, result);
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
  function banditPersonalSpaceAdjust(c, point, result = null, combatTarget = null) {
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
      if (o === c || o === combatTarget || o.health <= 0 || o.areaId !== c.areaId) continue; // Enemy contact is handled by the real hitbox/lunge collision, not ally-spacing. Other-bandit avoidance stays unchanged.
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
    if (result) {
      // Optional output keeps the hot AI path allocation-free; public/test callers still receive a fresh point.
      result.x = px;
      result.y = py;
      return result;
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
    if (c?._maskboundHeadtakerNeckControlled) return; // Preserve the scripted turn; the weapon pose publisher keeps its rig live.
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
    // The pose's body yaw (idle weapon stance, swing wind-up) turns the whole group; the head must keep looking where the
    // glance/forward target says, exactly like the player's neck (target world yaw minus body yaw) and the Attack Editor's
    // automatic counter-turn. Recorded each frame by updateBanditToolMesh from the same sampled pose that yaws the group.
    syncBanditForwardHead(c);
  }

  function syncBanditForwardHead(c) {
    const neck = c.avatarRef?.neckJoint; // The shared melee/ranged idle pose turns both sides against the authored body yaw.
    if (!neck?.front || !neck?.back) return;
    const state = c._banditNeckYaw;
    const counterYawRad = -(Number(c._banditBodyYawRad) || 0);
    const busy = c._banditAction || c._banditToolTail || c._rangedAction || c._banditFlaskActionActive || c._maskboundHeadtakerNeckControlled;
    const forwardYaw = busy ? null : counterYawRad; // Live actions and glances stay skinned even when briefly stationary.
    const portrait = c.avatarRef;
    if (portrait.frontPortraitMesh?.isSkinnedMesh) portrait.frontPortraitMesh.userData.hobunjiPortraitForwardYaw = forwardYaw;
    if (portrait.backPortraitMesh?.isSkinnedMesh) portrait.backPortraitMesh.userData.hobunjiPortraitForwardYaw = forwardYaw;
    if (c._maskboundHeadtakerNeckControlled) return;
    neck.front.rotation.y = (state?.currentDeg || 0) * BANDIT_NECK_LOOK_RAD + counterYawRad;
    neck.back.rotation.y = (state?.currentDeg || 0) * BANDIT_NECK_LOOK_RAD + counterYawRad;
  }

  function setBanditBodyYaw(c, radians) {
    c._banditBodyYawRad = radians;
    syncBanditForwardHead(c);
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

  let npcDuelStagingReady = false;
  let npcDuelStagingApi = null; // Stable callbacks handed to NpcDuelStaging; built once.
  function npcDuelStagingUpdate(c, dt, target, distPx, towardAngle) {
    const staging = window.NpcDuelStaging;
    if (!staging) return null;
    if (!npcDuelStagingReady) {
      staging.init({
        get TILE() { return deps.TILE; },
        get player() { return deps.player; },
        rnd: () => deps.rnd(),
      });
      npcDuelStagingApi = {
        comboReachPx: actor => banditComboReachPx(actor, actor.def, actor.def.banditAbilityLoadout),
        fireStagedSwing: (actor, foe, stepDt) => {
          // Same stamina cost and same-frame lunge catch-up as the full path's swing.
          const fired = fireBanditComboStep(actor, actor.def, actor.def.banditAbilityLoadout, foe, { staged: true });
          if (!fired) window.FeyHypedAttacks?.clearCredit?.(actor, 'npcMelee'); // No stale Hyped charge after a rejected staged duel.
          if (fired) updateBanditLunge(actor, stepDt, foe);
          return fired;
        },
        moveToward: (actor, x, y, speed, stepDt) => deps.moveCreatureToward(actor, x, y, speed, stepDt),
        damage: (actor, foe, amount, knockbackPxS) => damageBanditCombatTarget(actor, foe, amount, actor.x, actor.y, knockbackPxS, { tag: actor.def.attackTag, stagedDuel: true }),
      };
      npcDuelStagingReady = true;
    }
    return staging.update(c, dt, target, distPx, towardAngle, npcDuelStagingApi);
  }

  function updateBanditCombatAI(c, dt, targetPlayer, distToPlayer) {
    if (c?.tzatzulCapturedBy) {
      if (c._banditPreparedCharge) releaseBanditCharge(c, c._banditPreparedCharge.target); // Carried actors cannot hold a reservation while off the battlefield.
      releaseBanditApproach(c);
      return { aimAngle: c.facing || 0, moving: false };
    }
    targetPlayer = resolvedBanditCombatTarget(c, targetPlayer);
    if (!targetPlayer || Number(targetPlayer.health) <= 0 || targetPlayer.tzatzulCapturedBy) {
      if (c._banditPreparedCharge) releaseBanditCharge(c, c._banditPreparedCharge.target); // The previous target is no longer a valid charge recipient.
      releaseBanditApproach(c);
      return { aimAngle: c.facing || 0, moving: false };
    }
    if (c._banditPreparedCharge && (c._banditPreparedCharge.target !== targetPlayer || c.prone || c.state !== 'chase')) {
      releaseBanditCharge(c, c._banditPreparedCharge.target); // Target switches, knockdowns, and leash exits end a visual charge cleanly.
    }
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
      if (witchResult?.handled) { releaseBanditApproach(c); return witchResult; }
    }
    const flaskResult = c._banditPreparedCharge || c._banditAction ? null : updateBanditFlaskAI(c, dt, targetPlayer, distToPlayer); // Do not let a flask throw interrupt a held or committed melee windup.
    if (flaskResult?.handled) { releaseBanditApproach(c); return flaskResult; }
    const rangedResult = c._banditPreparedCharge || c._banditAction ? null : window.RangedWeapons?.updateBanditAI?.(c, dt, targetPlayer, distToPlayer);
    if (rangedResult?.handled) { releaseBanditApproach(c); return rangedResult; }
    if (c._banditHold1CdT > 0) c._banditHold1CdT = Math.max(0, c._banditHold1CdT - dt);
    if (c._banditChargeDecisionCdS > 0) c._banditChargeDecisionCdS = Math.max(0, c._banditChargeDecisionCdS - dt); // One random charge decision per short interval, never every frame.
    if (c._banditFlankRetryS > 0) c._banditFlankRetryS = Math.max(0, c._banditFlankRetryS - dt); // Backstab contenders may reattempt a flank after a short normal-combat fallback.
    if (loadout.hold2 === 'counterShield') updateBanditGuardWindow(c, dt);
    // For player targets, unconditional now (was only called from the engaged
    // branch below, skipped while lunging/mid-swing) -- see BANDIT_PLAYER_COLLISION_RADIUS_PX.
    // Covers the retreat/busy states below too: a stationary swinging
    // bandit should still get pushed off if the player walks into it,
    // even though it isn't the one closing the distance.
    const actorTarget = targetPlayer.isBandit === true
      || targetPlayer.isPorakanekiHunter === true
      || targetPlayer.banditCompanion === true
      || typeof targetPlayer.creatureKey === 'string';
    if (!actorTarget) enforceBanditPlayerCollision(c, targetPlayer);
    if (updateBanditLunge(c, dt, targetPlayer)) return { aimAngle: c.facing, moving: true };
    if (c.retreatT > 0) {
      c.retreatT = Math.max(0, c.retreatT - dt);
      const awayAng = towardAngle + Math.PI;
      const moving = deps.moveCreatureToward(c, c.x + Math.cos(awayAng) * deps.TILE, c.y + Math.sin(awayAng) * deps.TILE, deps.JUMP_BACK_SPEED * (c.hachutuTitanTuning?.speed || 1), dt);
      return { aimAngle: towardAngle, moving };
    }
    if (c._banditAction) {
      // The transient lock is already gone: committed windup/strike facing stays fixed.
      return { aimAngle: c.facing, moving: false };
    }
    if (c._banditPreparedCharge) {
      const prep = c._banditPreparedCharge; // The weapon is posed by the existing SharedAttackPose timeline, but no strike has been scheduled yet.
      prep.t = Math.min(prep.duration, prep.t + Math.max(0, dt));
      prep.action.t = prep.t;
      c.facing = towardAngle;
      prep.readyAgeS = prep.t >= prep.duration ? (prep.readyAgeS || 0) + Math.max(0, dt) : 0; // A blocked or forever-busy opponent cannot make an enemy hold one pose indefinitely.
      if (prep.readyAgeS > 2.5) {
        releaseBanditCharge(c, targetPlayer);
        c._banditChargeDecisionCdS = 1.25;
        return { aimAngle: towardAngle, moving: false };
      }
      const reach = banditEngagementReachPx(c, def, loadout, targetPlayer);
      const heldSlot = claimBanditAttackSlot(c, towardAngle, targetPlayer);
      if (heldSlot && prep.t >= prep.duration && distToPlayer <= reach
        && banditPreparedChargeHasPriority(c, targetPlayer) && claimBanditAttackTurn(c, targetPlayer)) {
        releaseBanditCharge(c, targetPlayer, true); // Keep the pose when converting preparation to a real Charged Breaker.
        const fired = fireBanditChargedBreaker(c, def, targetPlayer, prep);
        if (!fired) {
          releaseBanditAttackTurn(c, targetPlayer);
          resetBanditSwingToNatural(c);
          c.telegraphState = null;
        } else {
          c._banditTactic = 'charged-release';
          updateBanditLunge(c, dt, targetPlayer); // A new attack lunge starts in the same frame as its staged windup, matching ordinary combos.
        }
        return { aimAngle: towardAngle, moving: !!fired };
      }
      let moving = false;
      if (heldSlot && heldSlot.sector != null && !banditPreparedChargeHasPriority(c, targetPlayer)) {
        const direction = banditFacingSlotAngle(heldSlot, targetPlayer);
        const point = c._banditMovementPoint || (c._banditMovementPoint = { x: 0, y: 0 }); // Reuses the same movement scratch point as normal ring positioning.
        banditRingPoint(targetPlayer, direction, Math.min(deps.TILE * 2, reach * 0.7), point);
        banditPersonalSpaceAdjust(c, point, point, targetPlayer); // Do not have allied-spacing push an attacker's approach point away from the enemy itself.
        moving = deps.moveCreatureToward(c, point.x, point.y, def.chaseSpeed, dt); // Keep circling toward the assigned quadrant even while the weapon is charged.
      } else if (distToPlayer > Math.max(deps.TILE * 1.7, reach * 0.85)) {
        moving = deps.moveCreatureToward(c, targetPlayer.x, targetPlayer.y, def.chaseSpeed, dt); // A retreating opponent cannot strand a ready charge out of range.
      }
      c._banditTactic = prep.t >= prep.duration ? 'charged-ready' : 'charging';
      return { aimAngle: towardAngle, moving };
    }
    // A fight the player is not part of only has to look like combat:
    // js/combat/npc-duel-staging.js replaces the decision step below with a
    // cheap staged duel and hands back here (null) once the player gets involved.
    const stagedDuel = npcDuelStagingUpdate(c, dt, targetPlayer, distToPlayer, towardAngle);
    if (stagedDuel) { releaseBanditApproach(c); return stagedDuel; }

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
    const movementPoint = c._banditMovementPoint || (c._banditMovementPoint = { x: 0, y: 0 }); // Per-bandit scratch reused by both collision nudges and the queue-ring calculation.
    const unstack = banditPersonalSpaceAdjust(c, c, movementPoint, targetPlayer); // Only separate the bandit from other nearby allies, never its chosen opponent.
    if (Math.hypot(unstack.x - c.x, unstack.y - c.y) > 1) deps.moveCreatureToward(c, unstack.x, unstack.y, def.moveSpeed, dt);

    const engageRangePx = banditEngagementReachPx(c, def, loadout, targetPlayer);
    const slot = claimBanditAttackSlot(c, towardAngle, targetPlayer);
    const continuingCombo = c._banditComboIndex > 0; // Continue a successful flurry without letting the flanking behavior interrupt its next strike.
    const seekingBackstab = loadout.tap2 === 'backstabFlick' && !continuingCombo
      && Number.isFinite(def.banditStandoffMaxTiles) && (!slot || slot.sector == null || slot.sector === 3); // Only a rear-slot specialist actively circles into the backstab position.
    const backstabReady = seekingBackstab && banditBehindTarget(c, targetPlayer); // Reuse the real bonus predicate without redundant resource-affliction scans each frame.
    if (backstabReady) c._banditFlankElapsedS = 0;
    if (slot && seekingBackstab && !backstabReady && distToPlayer < deps.TILE * 6 && !(c._banditFlankRetryS > 0)) {
      c._banditFlankElapsedS = (c._banditFlankElapsedS || 0) + dt; // A hard time limit prevents an opponent who keeps turning from making the bandit refuse to fight.
      if (c._banditFlankElapsedS < (def.backstabFlankMaxSeconds || 2)) {
        const flank = banditBackstabFlankPoint(c, targetPlayer, engageRangePx, movementPoint); // The existing movement scratch is reused for an incremental rear-side ring target.
        const targetPoint = banditPersonalSpaceAdjust(c, flank, movementPoint, targetPlayer); // Keep ally avoidance but don't let it forcibly turn the attacker away from the duel target.
        const moving = deps.moveCreatureToward(c, targetPoint.x, targetPoint.y, def.chaseSpeed, dt);
        if (moving) {
          c._banditTactic = 'flanking';
          return { aimAngle: towardAngle, moving };
        }
      }
      c._banditFlankElapsedS = 0;
      c._banditFlankRetryS = def.backstabRetrySeconds || 2.5; // Blocked flank or timeout: fight normally, then look for another opening.
    }
    const committedOwner = banditDirectional(c) ? banditAttackTurnOwner(targetPlayer) : null; // O(1) per-target permission; unrelated targets have independent melee rhythms.
    const preparer = banditDirectional(c) ? banditChargeOwner(targetPlayer) : null;
    if (slot && banditDirectional(c) && !continuingCombo && (c._banditChargeDecisionCdS || 0) <= 0
      && loadout.hold1 === 'chargedBreaker' && (c._banditHold1CdT || 0) <= 0
      && c.attackCooldownT <= 0 && c.stamina >= def.attackStaminaCost && distToPlayer <= engageRangePx
      && committedOwner && committedOwner !== c && !preparer) {
      c._banditChargeDecisionCdS = 1.25; // Do not force a charge on every frame of a busy melee queue.
      if (deps.rnd() < (def.combatPerkModifiers?.chargeChance ?? BANDIT_HOLD1_CHANCE) && beginBanditPreparedCharge(c, targetPlayer)) {
        c._banditTactic = 'charging';
        return { aimAngle: towardAngle, moving: false };
      }
    }
    const priorityBlocked = preparer && preparer !== c && banditPreparedChargeHasPriority(preparer, targetPlayer); // Only a nearby, properly stationed readied charge gets priority.
    const attackPermission = !banditDirectional(c) || (!committedOwner && !priorityBlocked); // Even the current owner cannot start another swing before its counter's strike resolves.
    const sectorAngle = slot && slot.sector != null ? banditFacingSlotAngle(slot, targetPlayer) : null;
    const positionAngle = Math.atan2(c.y - targetPlayer.y, c.x - targetPlayer.x);
    const inSector = sectorAngle == null || Math.abs(deps.angleDiff(positionAngle, sectorAngle)) <= Math.PI / 3; // A bandit must reach roughly its assigned quadrant before committing a strike.
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
    const readyToStrike = distToPlayer <= engageRangePx && !!slot && inSector && attackPermission && c.attackCooldownT <= 0
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
      const rearAngle = (Number.isFinite(Number(targetPlayer.angle)) ? Number(targetPlayer.angle) : (Number(targetPlayer.facing) || 0)) + Math.PI; // Backstab-equipped spares converge on rear flanks, not an unrelated queue-ring bearing.
      const baseAngle = !slot && seekingBackstab
        ? rearAngle + ((c._banditStrafePhase || 0) < Math.PI ? -0.40 : 0.40)
        : (slot ? banditFacingSlotAngle(slot, targetPlayer) : (queueRing ? queueRing.angle : towardAngle));
      const ordinaryPursuit = Number.isFinite(def.banditStandoffMaxTiles); // Preserve mine/special-enemy ring choreography while ordinary bandits pursue aggressively.
      const maxStandoff = ordinaryPursuit
        ? deps.TILE * (def.banditStandoffMaxTiles + (queueRing?.ringIndex || 0) * def.banditStandoffTierStepTiles)
        : Infinity;
      const baseRadius = slot
        ? Math.max(deps.TILE * 0.25, Math.min(engageRangePx * 0.80, def.attackRangePx * (ordinaryPursuit ? 1.25 : 1.5))) // A slot holder must close INSIDE its real safe-commit reach; the old attackRange*1.25 floor could exceed reach and make striking impossible.
        : Math.max(def.attackRangePx * 1.5, Math.min(engageRangePx * BANDIT_STANDOFF_RANGE_MUL
          * (1 + (queueRing?.ringIndex || 0) * BANDIT_QUEUE_RING_STEP_MUL), maxStandoff));
      const strafeT = performance.now() / 1000 * BANDIT_STRAFE_HZ * Math.PI * 2 + (c._banditStrafePhase || 0);
      const swayAngle = Math.sin(strafeT) * BANDIT_STRAFE_ANGLE_AMPLITUDE_RAD;
      const ringPoint = banditRingPoint(targetPlayer, baseAngle + swayAngle, baseRadius, movementPoint);
      // Only pulls the bandit off the ring when actually crowding
      // another bandit -- the common case is a pure ring point, so
      // "back off when waiting" and "sway side to side" both fall out
      // of this same call instead of being two separate movements.
      const targetPoint = banditPersonalSpaceAdjust(c, ringPoint, movementPoint, slot ? targetPlayer : null); // Directional attackers can approach within hit reach; queued fighters still respect every hostile's space.
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
      const sprintThreshold = deps.TILE * (ordinaryPursuit ? 0.45 : 1.5); // Preserve special humanoids' earlier stance pacing, but make bandits sprint toward a retreating opponent.
      const travelSpeed = distToTarget > sprintThreshold ? def.chaseSpeed : BANDIT_STRAFE_SPEED_PX_S * (c.hachutuTitanTuning?.speed || 1);
      const moving = deps.moveCreatureToward(c, targetPoint.x, targetPoint.y, travelSpeed, dt);
      c._banditTactic = distToTarget > sprintThreshold ? 'pursuing' : 'standoff'; // Testing Arena exposes the actual combat movement choice on mobile.
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
    if (!claimBanditAttackTurn(c, targetPlayer)) return { aimAngle: towardAngle, moving: false }; // Another actor (or ready charge) got the turn after this frame's eligibility check.
    const openingFresh = c._banditComboIndex === 0;
    let fired = false;
    let attackChoice = 'combo'; // Mobile AI diagnostics distinguish the actual selected ability, not simply whether a swing fired.
    if (openingFresh && loadout.hold1 === 'chargedBreaker' && (c._banditHold1CdT || 0) <= 0 && deps.rnd() < (def.combatPerkModifiers?.chargeChance ?? BANDIT_HOLD1_CHANCE)) {
      fired = fireBanditChargedBreaker(c, def, targetPlayer);
      if (fired) attackChoice = 'charged-breaker';
    }
    if (!fired) {
      const cond = banditQuickAttackConditions(c, targetPlayer);
      const chance = banditQuickAttackChance(c, loadout, cond); // Tier changes the decision only when THIS equipped technique's bonus can trigger.
      if (chance > 0 && deps.rnd() < chance) {
        fired = fireBanditQuickAttack(c, def, loadout, targetPlayer);
        if (fired) attackChoice = loadout.tap2;
      }
    }
    if (!fired) fired = fireBanditComboStep(c, def, loadout, targetPlayer);
    c._banditTactic = fired ? attackChoice : 'attack-blocked';
    if (!fired) releaseBanditAttackTurn(c, targetPlayer); // A rejected ability must not monopolize this target's one committed attack.
    if (!fired) window.FeyHypedAttacks?.clearCredit?.(c, 'npcMelee'); // No authored attack started: its enhanced points cannot leak into an unrelated future action.
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
  let banditWeaponDimensionsSubscribed = false;
  function syncBanditWeaponScale(c, holder, weaponKey, gripContext = 'melee') {
    const visual = holder?.children?.[0]; // makeToolPlaneMesh group; pose/spin transforms live on the holder and toolPlane instead.
    const grips = window.HobunjiHandToolGrips;
    if (!visual || !weaponKey || !grips?.effectiveToolScaleForTool) return;
    if (!banditWeaponScaleSubscribed && grips.subscribe) {
      grips.subscribe(() => { banditWeaponScaleRevision += 1; });
      banditWeaponScaleSubscribed = true;
    }
    const dimensions = window.HobunjiCharacterDimensions; // Species heights are measured once, asynchronously; edits and late measurements bump the same revision.
    if (!banditWeaponDimensionsSubscribed && dimensions?.subscribe) {
      dimensions.subscribe(() => { banditWeaponScaleRevision += 1; });
      banditWeaponDimensionsSubscribed = true;
    }
    const data = visual.userData;
    if (data.banditWeaponScaleKey === weaponKey && data.banditWeaponScaleRevision === banditWeaponScaleRevision) return;
    const group = c?.avatarRef?.group;
    const speciesId = c?.avatarRef?.speciesId || group?.userData?.speciesId || '';
    const gender = c?.avatarRef?.gender || group?.userData?.gender || 'male';
    const rigScaleY = Number(c?.avatarRef?.rigScale?.y) || null; // Authored per-enemy body height (Maskbound troops) sizes the weapon, not just the species default.
    const placement = grips.heldItemPlacementForTool?.(weaponKey, gripContext, { speciesId, gender, rigScaleY }); // Base size about the origin, height about the grip.
    const heightReady = grips.characterHeightReady?.(speciesId, gender) !== false; // Until measured the height factor is a fallback 1, which the player and editor never show; retry instead of caching it.
    const scale = Number(placement?.scale ?? grips.effectiveToolScaleForTool(weaponKey, speciesId, gender));
    visual.scale.setScalar(Number.isFinite(scale) && scale > 0 ? scale : 1);
    if (placement?.offset) visual.position.set(placement.offset.x, placement.offset.y, placement.offset.z); // Grip stays fixed under the hand.
    data.banditWeaponScaleKey = heightReady ? weaponKey : null;
    data.banditWeaponScaleRevision = banditWeaponScaleRevision;
    data.banditWeaponScale = visual.scale.x; // Mobile/debug readout of the applied effective scale.
  }

  function makeBanditToolHolder(scene, weaponKey, entity = null) {
    const mesh = deps.makeToolPlaneMesh(weaponKey, entity ? { holder: entity } : undefined); // The wielder's own mastery/metal (js/character-held-tools.js).
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
    if (!toolKey) return null;
    const stanced = !!window.EnemyWeaponStances?.stanceClassFor?.(c); // A Light/Heavy stance weapon rests with its free hand on the invisible offhand tool (grip state: offhandIdleBlend).
    if (!grips?.isDualWieldWeapon?.(toolKey) && !stanced) return null;
    const cached = c._banditRestGrip;
    if (cached && cached.key === toolKey) return cached.grip;
    const grip = grips.animationGripAt?.(0, { windupFrac: 0.16, strikeFrac: 0.16, holdFrac: 1, poseScale: 1 }, {}, 'attack', toolKey) ?? null;
    c._banditRestGrip = { key: toolKey, grip };
    return grip;
  }

  // Body sink for a humanoid enemy (js/actor-body-sink.js): the sampled pose's `bodySink` lowers the plane/hand pivots while the legs keep the soles on
  // the floor and fold the knees. Returns the world-space sink so the weapon holder can follow. Enemies without a Light/Heavy stance author no sink (0).
  function releaseBanditBodySink(c) {
    const ref = c?.avatarRef;
    if (ref?.bodySinkActor) window.ActorBodySink?.release(ref.bodySinkActor);
  }
  function applyBanditBodySink(c, sampled, swinging) {
    const ref = c?.avatarRef;
    const sink = window.ActorBodySink;
    if (!sink?.enabled() || !ref?.legs || !ref.frontPlane || !ref.handsPivot || ref.riderMount) return 0; // Mounted riders and legless bodies keep standing.
    ref.bodySinkActor ||= { legs: ref.legs, lower: [{ obj: ref.frontPlane }, { obj: ref.backPlane }, { obj: ref.handsPivot }, { obj: ref.legsPivot }] }; // The leg handle raises its root by the sink; lower its parent too so soles remain planted and hips track the portrait.
    const standing = (Number(c.health) || 0) > 0 && !c.prone;
    let pct = 0;
    if (standing) pct = Number.isFinite(sampled.bodySink) ? sampled.bodySink : (c._enemyPreparedPose ? window.SharedAttackPose.idleBodySinkPct() : 0); // Legacy arcs author no sink: only a stance weapon rests at the idle sink.
    const applied = sink.apply(ref.bodySinkActor, pct, sampled.bodyYawRad * 180 / Math.PI, swinging);
    return applied * (ref.group?.scale?.y || 1);
  }

  function updateBanditToolMesh(c) {
    if (c?._banditPreparedCharge && (c.prone || c.health <= 0 || c.state !== 'chase' || c.tzatzulCapturedBy)) {
      releaseBanditCharge(c, c._banditPreparedCharge.target); // A prone/dead/carried fighter may skip its melee AI; its visible weapon renderer must not preserve a stale held pose.
    }
    window.GhoulSpecialVariants?.tick?.(c, deps?.TOOL_ITEM_DEFS); // Enchanted-weapon particles for the mine's Shadowknights.
    if (c?._banditCaptainArmament) window.BanditCaptainArmaments?.tick?.(c, deps?.TOOL_ITEM_DEFS); // Only enchanted captains emit the ordinary fixed-weapon planar particles.
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
    if (!holder) { setBanditBodyYaw(c, 0); releaseBanditBodySink(c); return; }
    if (flaskActive) {
      if (c._banditToolHolder) c._banditToolHolder.visible = false;
      if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;
      c._banditFlaskToolHolder.visible = true;
    } else if (c._rangedMode) {
      holder.visible = false;
      if (c._banditFlaskToolHolder) c._banditFlaskToolHolder.visible = false;
      releaseBanditBodySink(c);
      window.RangedWeapons?.updateBanditVisual?.(c);
      return;
    } else {
      holder.visible = true;
      if (c._banditRangedToolHolder) c._banditRangedToolHolder.visible = false;
      if (c._banditFlaskToolHolder) c._banditFlaskToolHolder.visible = false;
    }
    const action = c._banditAction || c._banditPreparedCharge?.action || null; // Draw-only held-charge windup uses the existing SharedAttackPose clock without registering an extra combat attack.
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
      if (c._banditChargeReleaseAction === action && progress < wf) progress = wf; // The held weapon stays fully drawn during the short release telegraph instead of snapping back to Neutral.
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
    const windupPitch = Number(pose?.windup?.pitch); // Authored enemy tool pitch controls chain straightening and held follow-through.
    const strikePitch = Number(pose?.strike?.pitch);
    window.HobunjiWeaponSpriteAssemblies?.setAction(holder.children?.[0], {
      attacking: timelineLive, progress, movementPosition: c.avatarRef?.group?.position, // Actual NPC-world locomotion excludes attack-pose hand translation.
      windupFrac: wf, strikeFrac: sf, holdFrac: hf,
      flailLengthScale: SAP.flailLengthScaleAt(pose, progress, wf, sf, hf, 'attack', power), // Uses the same authored scalar blend as sampleSwing without an extra full pose sample.
      yawTravelDeg: window.HobunjiWeaponSpriteAssemblies?.flailYawTravel(pose?.windup, pose?.strike, power, dirSign), // Same held sweep follow-through as the player.
      pitchTravelDeg: Number.isFinite(windupPitch) && Number.isFinite(strikePitch) ? (strikePitch - windupPitch) * power : undefined, // Match the enemy's actual partial-charge pose pitch.
    }); // Uses the same per-enemy timeline and final holder pose as players and editor.

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
    const base = banditToolBaseXY(c.avatarRef, c._banditToolBase || (c._banditToolBase = { x: 0, y: 0 })); // Per-bandit base point reused for every weapon pose frame.
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
    setBanditBodyYaw(c, bodyYawRad); // Finalize the face-forward counter-turn in the same frame as the weapon stance.
    if (handDriverRoot) window.HobunjiDualWieldWeaponVisuals?.setCarriedSample(sampled, c._banditHandRecordKey ||= { avatarRoot: handDriverRoot }); // The invisible idle offhand tool peels the pose this holder carries right now.
    const sinkWorld = applyBanditBodySink(c, sampled, timelineLive); // Authored per-pose body sink (percent of height): sinks the body and folds the knees; the weapon below follows.
    if (c.avatarRef?.riderMount) {
      c._banditMountedPoseY = sampled.y; // Used by mounted-rider browser parity checks and mobile diagnostics to distinguish authored lift from a detached weapon.
      c._banditMountedSinkWorld = sinkWorld; // Used alongside _banditMountedPoseY to reconstruct the finished world-space hand height.
    }
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
    holder.position.y -= sinkWorld; // The orbit above is measured from the unsunk floor; the whole weapon sinks with the body.
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
    const poseModelHeight = avatarRef.poseModelHeight || modelHeight;
    const rigScaleY = avatarRef.poseRigScaleY || 1;
    const height = scaler?.heightMetrics?.(speciesId, gender, poseModelHeight, rigScaleY) || null; // Keep raw PNG height and the full character-rig multiplier separate, as the player does.
    if (scaler?.transformPosePoint) {
      scaler.transformPosePoint(holder.position, {
        cx: group.position.x, cy: floorY + Number(avatarRef?.poseCentroidY ?? group.userData?.poseCentroidY ?? poseModelHeight / 2), cz: group.position.z, floorY, baseY,
        speciesId, gender, modelHeight:poseModelHeight, rigScaleY,
        armLength, poseOrbitScale, yawRad: poseYawRad,
        orbitOffset: window.HobunjiCharacterSpine?.orbitOffsetWorld(avatarRef.spine, avatarRef.rigScale?.x, rigScaleY) || null, // Hunched enemies swing about their curled shoulders: down, forward and sideways.
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
  function banditToolBaseXY(avatarRef, result) {
    const w = avatarRef?.modelWidth || 0.9, h = avatarRef?.modelHeight || 0.9;
    result.x = avatarRef?.handAttachX ?? (-w / 2);
    result.y = avatarRef?.handAttachY ?? (h / 2);
    return result;
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
      for (const child of root?.children || []) window.HobunjiWeaponSpriteAssemblies?.drop(child);
      root?.traverse?.(object => {
        if (!object.userData?.sharedToolGeometry) object.geometry?.dispose?.();
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

  // Multiplies a body scale ({ x, y, head, offsetY }) by { x, y, head } factors; missing fields are untouched and a missing scale counts as 1.
  function applyRigScaleMultiplier(scale, multiplier) {
    if (!multiplier) return scale;
    const base = value => (Number(value) > 0 ? Number(value) : 1);
    return { ...scale, x: base(scale?.x) * base(multiplier.x), y: base(scale?.y) * base(multiplier.y), head: base(scale?.head) * base(multiplier.head) };
  }

  function applyAuthoredHostileRigScale(avatarRef, explicitScale) {
    if (!avatarRef?.group || !explicitScale) return false;
    const positive = value => Number.isFinite(Number(value)) && Number(value) > 0; // Validate caller-authored scale fields before mutating live meshes.
    const x = positive(explicitScale.x) ? Math.min(4, Math.max(0.1, Number(explicitScale.x))) : 1;
    const y = positive(explicitScale.y) ? Math.min(4, Math.max(0.1, Number(explicitScale.y))) : 1;
    const head = positive(explicitScale.head) ? Math.min(4, Math.max(0.1, Number(explicitScale.head))) : 1;
    const offsetY = Number.isFinite(Number(explicitScale.offsetY)) ? Math.max(-0.5, Math.min(0.5, Number(explicitScale.offsetY))) : 0;
    const originalHeight = avatarRef.modelHeight;
    const originalWidth = avatarRef.modelWidth; // Head-neck offset is expressed against the unscaled local avatar height.
    // Both the skinned face and rear head track their independently rotated neck bones.
    // Counteract non-uniform whole-rig scaling so the skull stays undistorted.
    for (const joint of [avatarRef.headScaleJoint?.front || avatarRef.neckJoint?.front, avatarRef.headScaleJoint?.back || avatarRef.neckJoint?.back]) {
      if (!joint?.scale) continue;
      joint.scale.x *= head / x;
      joint.scale.y *= head / y;
      joint.scale.z = (Number(joint.scale.z) || 1) * head / x;
      joint.updateMatrix?.();
    }
    for (const joint of [avatarRef.headOffsetJoint?.front || avatarRef.headScaleJoint?.front || avatarRef.neckJoint?.front,
      avatarRef.headOffsetJoint?.back || avatarRef.headScaleJoint?.back || avatarRef.neckJoint?.back]) {
      if (!joint?.position) continue;
      joint.position.y += originalHeight * offsetY; // Hostile head placement lives on the nonrotating parent; huge offsets no longer invert the two-pixel neck strip.
      joint.updateMatrix?.();
    }
    avatarRef.group.scale.set(avatarRef.group.scale.x * x, avatarRef.group.scale.y * y, avatarRef.group.scale.z * x);
    avatarRef.modelWidth *= x; // makeBanditDef, melee targeting and collision must see the same dimensions as the rendered enemy.
    avatarRef.poseModelHeight = originalHeight;
    avatarRef.poseRigScaleY = y;
    avatarRef.modelHeight *= y;
    avatarRef.group.userData.portraitModelWidth = originalWidth; // Scene hitboxes apply matrixWorld scale themselves; metadata stays local.
    avatarRef.group.userData.portraitModelHeight = originalHeight;
    avatarRef.rigScale = { x, y, head, offsetY }; // Mobile-readable proof of the actual values applied.
    avatarRef.group.userData.hobunjiCharacterPartScaleFactors = { x, y }; // Later-built hostile metadata enables uniform hands/feet without second-scaling its parent.
    return true;
  }

  async function makeBanditEntity(cfg, rank, tier, x, y, opts = {}) {
    const mineEnemy = opts.extra?.isMineGhoul === true; // True only for the independently balanced ten-floor Ghoul hierarchy.
    tier = mineEnemy ? Math.max(1, Math.min(10, Math.floor(Number(tier) || 1))) : (window.EnemyTierProgression?.clampTier(tier) ?? Math.max(0, Math.min(7, Math.floor(Number(tier) || 0)))); // Validate before combat uses the tier.
    await window.EnemyLoadoutRules?.ready;
    const loadoutRules = window.EnemyLoadoutRules;
    const loadoutKind = loadoutRules?.kindFor(rank, opts, opts.rosterOverride, cfg);
    cfg = loadoutRules?.configFor(loadoutKind, cfg, rank, deps.rnd) || cfg;
    if(opts.extra?.ruinWallCoffin){
      const permitted=window.MinionCombat.coffinWeaponShapes; // Only authored choices that actually encode to bound relic shapes are legal.
      const authored=loadoutRules?.ruleFor(loadoutKind)?.weapons?cfg.weaponShapePool?.filter(shape=>permitted.includes(shape)):null;
      cfg={...cfg,_ruinCoffinWeapon:true,weaponShapePool:authored?.length?authored:[...permitted]};
    } // Match relic catalog.
    if(opts.extra?.rootledoot){
      const saved=opts.zoneId==='map_dev_arena'?opts.defOverride?.weaponKey:null;
      if(saved&&!window.BanditCaptainArmaments?.isRootledootWeapon(saved))throw Error('Saved Rootledoot weapon is outside the current compatible pool; roll a new preview.');
      cfg={...cfg,_rootledootWeaponPool:true,_rootledootPreviewKey:saved};
    }
    if (mineEnemy) cfg = { ...cfg, _preserveMineEnemyTiers: true }; // Local override is never written into the global gang configuration.
    if (!opts.extra?.rootledoot && !loadoutKind?.startsWith('bandit:') && (cfg?.combatPursuit || cfg?.quickAttackTuning))
      cfg = { ...cfg, combatPursuit: null, quickAttackTuning: null }; // Special humanoids and mine enemies retain their prior pace and Quick Attack probability.
    const wearsRankMetal = ['lieutenant', 'captain'].includes(rank) && loadoutKind?.startsWith('bandit:') && !opts.rosterOverride && !opts.preserveRoster; // Rank metal armor must match the weapon's metal, which is otherwise rolled after the portrait is baked.
    if (wearsRankMetal && !configuredWeaponMetalKey(cfg)) cfg = { ...cfg, weaponMetalKey: rollBanditWeaponMetalKey(cfg, rank, tier) };
    let roster = opts.rosterOverride || await rollBanditRoster(cfg, rank, opts.nameOverride, cfg._enemyLoadoutGender);
    const legacyMask = (roster.equippedCosmetics || []).find(id=>window.isPortraitMaskCosmeticId?.(id) && roster.cosmeticSlots?.[id] === 'hood');
    if (legacyMask) {
      roster={...roster,cosmeticSlots:{...roster.cosmeticSlots,[legacyMask]:'mask'},appliedDyes:{...roster.appliedDyes},appearance:{...roster.appearance,bodyColors:{...roster.appearance?.bodyColors}}};
      for (const suffix of ['', '_B', '_C']) {
        roster.appliedDyes['MASK'+suffix] ??= roster.appliedDyes['HOOD'+suffix];
        roster.appearance.bodyColors['MASK'+suffix] ??= roster.appearance.bodyColors['HOOD'+suffix];
      }
    }
    if (opts.mountSpecies && roster) roster.mountSpecies = opts.mountSpecies; // Seats the rider on a full creature card (e.g. Porakaneki Avengers on Nazgraku).
    if (roster?.mountSpecies && !roster.mountGenotype) roster.mountGenotype = window.CreatureGenetics?.makeDefaultGenotype?.(roster.mountSpecies) || null; // Same coat/pattern roll a wild specimen gets; kept on the roster so a rebuilt avatar keeps its mount.
    if (roster?.appearance?.speciesId === 'ghoul' && !opts.preserveRoster) styleGhoulRoster(roster);
    if (loadoutKind?.startsWith('bandit:') && !opts.rosterOverride && !opts.preserveRoster) { // Bandit rank is worn: pauldrons, circlets, patterned pants/overwear.
      window.BanditRankWardrobe?.style?.(roster, { rank, rnd: deps.rnd, rollDyeId: () => _banditRollDyeId(cfg), metalKey: wearsRankMetal ? configuredWeaponMetalKey(cfg) : null, mastery: banditMasteryFor(cfg, rank, tier) });
    }
    if (roster?.appearance?.speciesId === 'ghoul' && !opts.preserveRoster && (opts.extra?.isGhoulShadowknight || opts.extra?.mineWyrmWitchType)) { // Mine variants: own wardrobe, patterns, and (knights) an enchanted weapon.
      await window.GhoulSpecialVariants?.style?.(roster, { rnd: deps.rnd, tier, shadowknight: !!opts.extra.isGhoulShadowknight, witchType: opts.extra.mineWyrmWitchType || null, mastery: banditMasteryFor(cfg, rank, tier) });
    } // Mine and any future ghoul BanditCombat spawns share this one wardrobe/dye authority before portrait and corpse loot are built.
    if (opts.bodyColorsOverride && roster?.appearance) {
      roster.appearance.bodyColors = opts.bodyColorsOverride; // Caller-owned explicit body tint applied before portrait generation without changing any other seeded appearance choices.
    }
    roster = loadoutRules?.applyRoster(loadoutKind, roster, deps.rnd, cfg) || roster;
    if (opts.extra?.rootledoot && opts.rosterOverride) roster = {...opts.rosterOverride, rootledoot:true}; // Keep the bare root and matching limb colors instead of Workshop clothing.
    const spineRule = loadoutRules?.spineFor?.(loadoutKind);
    if (spineRule && !roster.spine) roster = { ...roster, spine: { hunch: spineRule.hunch, ...(spineRule.sway ? { sway: spineRule.sway } : {}), ...(spineRule.kyphosis != null ? { kyphosis: spineRule.kyphosis } : {}) } }; // Authored hunchback (old, skeletal, Maskbound): read by the portrait's legs, shoulders, neck and weapon orbit.
    if(roster.specialLichId)window.SpecialHarlyaoLiches?.applyBodyColor3ToRoster?.(roster,roster.lichType); // Deterministic body C after Workshop rules, so eyes and generated wall emissions cannot diverge.
    if (!roster?.mountSpecies) { // Patterns are baked into the portrait before the rig stretches it, so the final body scale must be known up front (rider mounts are exempt from rig scaling).
      const earlyScale = { ...(opts.avatarRigScale || window.HobunjiCharacterRigScale?.scaleFor?.(roster.appearance.speciesId, roster.appearance.gender, roster.appearance) || {}), ...(loadoutRules?.rigScaleFor?.(loadoutKind) || {}) };
      const multiplied = applyRigScaleMultiplier(earlyScale, loadoutRules?.rigScaleMultiplierFor?.(loadoutKind)); // Rank multipliers (e.g. captains 15% wider and taller) on top of the species/override scale.
      earlyScale.x = multiplied.x; earlyScale.y = multiplied.y; earlyScale.head = multiplied.head;
      roster.patternBodyScale = { x: Number(earlyScale.x) > 0 ? Number(earlyScale.x) : 1, y: Number(earlyScale.y) > 0 ? Number(earlyScale.y) : 1, head: Number(earlyScale.head) > 0 ? Number(earlyScale.head) : 1 };
    }
    const avatarRef = await buildQueuedBanditAvatar(roster, opts.zoneId);
    let characterScale = opts.avatarRigScale || (!avatarRef?.riderMount && window.HobunjiCharacterRigScale?.scaleFor?.(roster.appearance.speciesId, roster.appearance.gender, roster.appearance));
    const rigOverride = !avatarRef?.riderMount ? loadoutRules?.rigScaleFor?.(loadoutKind) : null; // Workshop-authored body proportions (x/y/head/offsetY, any subset) win over the troop/species values, in game too.
    if (rigOverride) characterScale = { ...(characterScale || window.HobunjiCharacterRigScale?.scaleFor?.(roster.appearance.speciesId, roster.appearance.gender, roster.appearance) || {}), ...rigOverride };
    const rigMultiplier = !avatarRef?.riderMount ? loadoutRules?.rigScaleMultiplierFor?.(loadoutKind) : null; // Multipliers apply last, on top of the species-derived scale and any absolute override.
    if (rigMultiplier) characterScale = applyRigScaleMultiplier(characterScale || window.HobunjiCharacterRigScale?.scaleFor?.(roster.appearance.speciesId, roster.appearance.gender, roster.appearance) || {}, rigMultiplier);
    if (avatarRef?.spine?.neckDrop > 0 && !avatarRef.riderMount) { // The spine bone carries the head down by the shoulders' share; the head bone supplies the rest so the total matches an aged NPC (HobunjiCharacterRigScale.ageHunchFraction).
      characterScale = { ...(characterScale || window.HobunjiCharacterRigScale?.scaleFor?.(roster.appearance.speciesId, roster.appearance.gender, roster.appearance) || {}) };
      characterScale.offsetY = (Number(characterScale.offsetY) || 0) - avatarRef.spine.neckDrop;
    }
    if (avatarRef && characterScale) applyAuthoredHostileRigScale(avatarRef, characterScale); // Scale wood puppets before stats, hitboxes, ground offset and weapon mounts are constructed.
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
    const authoredRule = loadoutRules?.ruleFor(loadoutKind);
    if (authoredRule?.metals && !authoredRule.weapons && opts.defOverride?.weaponKey) {
      const shape = deps.TOOL_ITEM_DEFS?.[opts.defOverride.weaponKey]?.shapeKey;
      if (shape) cfg = { ...cfg, weaponShapePool: [shape] };
    }
    const mastery = banditMasteryFor(cfg, rank, tier);
    let rolledDefinition;
    try{rolledDefinition=makeBanditDef(cfg, rank, tier, mastery, avatarRef.modelWidth);}catch(error){avatarRef.dispose();throw error;}
    const unarmedWitch = !!window.GhoulSpecialVariants?.isUnarmedWitch?.(opts.extra); // Shadow-wind Wyrm-witches cast bare-handed like liches: the lich casting pose weapon, no visible mesh.
    let def = Object.assign({ ...rolledDefinition }, unarmedWitch ? { weaponKey: window.GhoulSpecialVariants.castWeaponKey(), rangedWeaponKey: null } : {}, opts.defOverride || {});
    // Special enemies supply fixed weapons through defOverride. Explicit authored
    // weapon pools replace those fields too, using the same stats/ability factory.
    if (authoredRule?.weapons || authoredRule?.metals) {
      const authored = rolledDefinition;
      def.weaponShapeKey=deps.TOOL_ITEM_DEFS?.[authored.weaponKey]?.shapeKey;
      def.weaponMetalKey=deps.TOOL_ITEM_DEFS?.[authored.weaponKey]?.metalKey;
      for (const key of ['weaponKey','weaponShapeStats','attackTag','attackDamage','attackRangePx','attackStaminaCost','attackCooldownS','banditAbilityLoadout']) def[key] = authored[key];
    }
    if(authoredRule?.ranged || authoredRule?.rangedChance != null)def.rangedWeaponKey=rolledDefinition.rangedWeaponKey;
    def = loadoutRules?.applyDefinition(loadoutKind, def, deps.rnd) || def;
    if(opts.extra?.rootledoot){def.weaponKey=rolledDefinition.weaponKey;def.rangedWeaponKey=null;if(def.banditAbilityLoadout)def.banditAbilityLoadout.tap1=rolledDefinition.banditAbilityLoadout.tap1;} // Workshop rules cannot substitute a forbidden weapon or ranged item.
    if (def.rangedWeaponKey && !window.RangedWeapons?.config?.[def.rangedWeaponKey]) {
      // The Fishing Spear is registered by the existing dual-role projectile archetype, not the base crossbow table.
      // NPCs must have that real thrown definition before they try to fire rather than holding an inert spear.
      window.HobunjiRangedWeaponArchetypes?.patchGeneratedDefinitions?.({ npcOnly: true, keys: [def.rangedWeaponKey] });
    }
    if(opts.extra?.ruinSkeletonHealthMultiplier)def.maxHealth=Math.round(def.maxHealth*opts.extra.ruinSkeletonHealthMultiplier); // Before perks and resource initialization.
    if(opts.extra?.ruinWallCoffin)def.weaponShapeKey=deps.TOOL_ITEM_DEFS?.[def.weaponKey]?.shapeKey||def.weaponShapeKey;
    applyEnemyCombatBuild(def, rank, tier, mineEnemy, opts, authoredRule); // After authored weapon and projectile definitions exist; before resources initialize.
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
    if(roster.ruinSkeletonTheme && avatarRef.backPlane) {
      const disposeSpikes=window.MinionCombat?.attachRuinBackSpikes?.(THREE,avatarRef,roster); // Real geometry must not enter PNG depth replay.
      if(disposeSpikes){const disposeAvatar=avatarRef.dispose;avatarRef.dispose=function(){disposeSpikes();return disposeAvatar.call(this);};}
    }
    targetScene.add(avatarRef.group);
    // A lighting pass can prune a still-building avatar's off-scene light
    // while async portrait/limb work yields. Register again at scene adoption.
    for (const portraitGlowLight of avatarRef.handRigAvatarRoot?.userData?.portraitGlowLights || []) window.FurnitureLightRegistry?.register(portraitGlowLight); // One per glowing eye.
    const banditToolHolder = makeBanditToolHolder(targetScene, def.weaponKey, def); // def may author weaponMasteryLevel / weaponMetalOptions for its wielder.
    if (!banditToolHolder) window.__farmLog?.(`[bandits] tool holder failed to build for "${def.weaponKey}" -- toolTextures entry missing? (fallback: bandit renders unarmed)`, 'wildlife');
    const banditRangedToolHolder = def.rangedWeaponKey ? makeBanditToolHolder(targetScene, def.rangedWeaponKey, def) : null;
    if (banditRangedToolHolder) banditRangedToolHolder.visible = false;
    const banditFlaskToolHolder = rank === 'flasker' ? makeBanditFlaskToolHolder(targetScene) : null; // Separate inventory-flask visual uses the same authored grip as the Attack Editor.
    for (const holder of [banditToolHolder, banditRangedToolHolder, banditFlaskToolHolder]) {
      if (!holder) continue;
      holder.userData ||= {};
      holder.userData.hobunjiHeldPortraitOwner = avatarRef.group; // Scene-sibling hostile weapons match this character's front PNG mask, never another actor's.
    }
    const handDriverRoot = avatarRef.handRigAvatarRoot; // Original PNGPlaneAvatar root retained solely as the shared procedural-hand driver's identity/ownership record.
    if (handDriverRoot?.userData) {
      handDriverRoot.userData.proceduralHandToolHolder = banditToolHolder || null;
      handDriverRoot.userData.proceduralHandToolKey = def.weaponKey || null;
      handDriverRoot.userData.proceduralHandGripContext = 'melee';
      handDriverRoot.userData.proceduralHandRigScaleY = Number(avatarRef.rigScale?.y) || null; // Hand grip targets size the weapon from the same body height the visual does.
      handDriverRoot.userData.poseFrameYawOffsetRad = Number(def.aimAngleOffset) || 0; // The hostile group is turned aimAngleOffset away from the pose frame (+X lateral); dual-wield mirrors the offhand across THAT frame's midline.
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
      // updateCreatureMesh rewrites the group's scale from these every frame
      // (CreatureGenetics.applyCreatureBillboardScale), so the species/troop
      // body scale applied by applyAuthoredHostileRigScale only survives
      // gameplay if it is also the entity's visual scale. Depth tracks width,
      // like the player's parent scale.
      visualScaleX: avatarRef.rigScale?.x ?? 1, visualScaleY: avatarRef.rigScale?.y ?? 1, visualScaleZ: avatarRef.rigScale?.x ?? 1,
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
      _banditFlankElapsedS: 0, _banditFlankRetryS: 0, _banditBackstabSide: 0, _banditTactic: 'idle', // Per-actor Backstab circling timeout, preferred side, and mobile decision log.
      _banditChargeDecisionCdS: 0, _banditPreparedCharge: null, _banditChargeReleaseAction: null, // Charge roll cadence, draw-only windup pose, and the real released-stage identity.
      _banditHold1CdT: 0, _banditGuardUntil: 0, _banditGuardCdT: 0, _banditLastCounterAt: -99,
      // Per-bandit phase offset for the idle side-to-side strafe applied
      // while queued/waiting (see BANDIT_STRAFE_* below) -- randomized so
      // a gang doesn't all sway in unison.
      _banditStrafePhase: deps.rnd() * Math.PI * 2,
      rosterRecord: roster,
      enemyLoadoutKind: loadoutKind,
      ...opts.extra,
    };
    window.ResourceSystem?.initEntity(c);
    if (!mineEnemy && cfg?.trinketLoadout) {
      const rolled = window.TrinketSystem?.rollEnemyLoadout?.(cfg.trinketLoadout, rank, tier, deps.rnd) || []; // Rolled once for rank/tier alongside equipment, not in the hostile update loop.
      if (rolled.length) {
        window.TrinketSystem?.configureEnemy?.(c, rolled); // Materializes the same catalog modifiers on this particular enemy rather than editing its shared definition.
        const resources = window.ResourceSystem; // A fresh combatant starts at its trinket-modified capacity instead of spawning partially wounded.
        c.health = resources?.getEffectiveMax?.(c, 'health') ?? c.health;
        c.stamina = resources?.getEffectiveMax?.(c, 'stamina') ?? c.stamina;
        c.footing = resources?.getEffectiveMax?.(c, 'footing') ?? c.footing;
      }
    }
    if (unarmedWitch) window.GhoulSpecialVariants.unarm(c);
    const carriesHronalWitchBomb = c.carriesHronalWitchBomb === true
      || c.carriesBurdenKind === 'hronalWitchBomb'
      || opts.carriesHronalWitchBomb === true || opts.carriesBurdenKind === 'hronalWitchBomb'
      || def.carriesHronalWitchBomb === true || def.carriesBurdenKind === 'hronalWitchBomb';
    if (carriesHronalWitchBomb) {
      // Only explicitly authored enemy types may carry this ruin-specific Burden; unrelated mine Wyrm-witches do not.
      const fuseSeconds=c.witchBombFuseSeconds??opts.witchBombFuseSeconds
        ??opts.extra?.witchBombFuseSeconds??def.witchBombFuseSeconds;
      window.HronalWitchBombs?.spawnCarriedByEnemy?.(c,{fuseSeconds})
        ?.catch?.(error=>console.warn('[HronalWitchBombs] enemy-carried spawn failed',error));
    }
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

  const banditSwingPoseCpuStats = { lastMs: 0, peakMs: 0, samples: 0 }; // Pixel Probe diagnoses attack-frame pose spikes only when the existing profiler is enabled.
  function measuredBanditToolMesh(c) {
    const profiler = window.PerfProfiler; // Reuse existing opt-in instrumentation rather than adding a timer to every hostile animation frame.
    if ((!c?._banditAction && !c?._banditToolTail) || !profiler?.isEnabled?.()) return updateBanditToolMesh(c);
    const token = profiler.begin('Combat: bandit swing pose');
    try { return updateBanditToolMesh(c); }
    finally {
      if (token) {
        const elapsedMs = profiler.end(token);
        banditSwingPoseCpuStats.lastMs = elapsedMs;
        banditSwingPoseCpuStats.peakMs = Math.max(banditSwingPoseCpuStats.peakMs, elapsedMs);
        banditSwingPoseCpuStats.samples++;
      }
    }
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
    buildAvatar: buildBanditAvatar, // Debug/headless: builds one hostile humanoid avatar from a roster without spawning an entity.
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
    clothingCandidates: _banditClothingCandidates, // Shared effective-pool inspection for the enemy loadout workshop.
    updateCombatAI: updateBanditCombatAI,
    restNeckLook, setBanditBodyYaw,
    updateMovementHeadLook,
    updateToolMesh: measuredBanditToolMesh, // Unchanged gameplay/pose calculation, with optional per-bandit swing timing.
    get swingPoseCpuMs() { return { ...banditSwingPoseCpuStats }; }, // Cheap mobile diagnostics without a full performance snapshot.
    updateTrailArc: () => {}, // Shared Combat.update owns ribbon lifetime; legacy API remains callable.
    fireCounterRiposte: fireBanditCounterRiposte,
    naturalSwing: banditNaturalSwing,
    cancelLunge: cancelBanditLunge, // Stagger/death/leash cleanup: stops the lunge AND lowers its hop.
    finishAction: finishBanditAction, // Ends a staged action; a completed melee swing hands its hold/return to c._banditToolTail.
    engagementReachPx: banditEngagementReachPx,
    applyEnemyCombatBuild, // Shared spawn and regression-test entry point.
    refreshEnemyCombatBuild, // Reconcile actual equipment after the existing cultural/modular wrappers.
    RANK_LABEL: BANDIT_RANK_LABEL,
    TINT_SLOT_BY_SLOT: BANDIT_TINT_SLOT_BY_SLOT,
    GUARD_DAMAGE_ABSORB: BANDIT_GUARD_DAMAGE_ABSORB,
    MAX_ATTACK_SLOTS: BANDIT_MAX_ATTACK_SLOTS,
    DIRECTION_SECTORS: BANDIT_DIRECTION_SECTORS,
    attackTurnOwner: banditAttackTurnOwner, chargeOwner: banditChargeOwner, // Mobile testing tools inspect the per-target turn and preparation without mutating a reservation.
    get attackSlots() { return _banditAttackSlots; },
    get queueRings() { return _banditQueueRings; },
  };
})();
