from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one patch target, found {count}')
    p.write_text(text.replace(old, new, 1))


replace_once(
    'docs/js/creature-genetics.js',
    """      const westernZone = injectedDeps?.EXTERIOR_ZONES?.[PUKTUK_WESTERN_ZONE_ID]; // Shared zone object read by both exterior and cavern den population selectors.
      const herbivores = westernZone?.herbivoreSpecies; // Den-only herd pool: emptied so Western Slope dens cannot resolve to prey species such as Uumkao'ii.
      let removedHerdSpecies = 0;
      if (Array.isArray(herbivores)) {
        removedHerdSpecies = herbivores.length;
        herbivores.splice(0, herbivores.length);
      }
      const packs = westernZone
        ? (Array.isArray(westernZone.packSpecies) ? westernZone.packSpecies : (westernZone.packSpecies = []))
        : null; // Den predator pool shared by exterior guards and cavern generation.
      if (Array.isArray(packs)) packs.splice(0, packs.length, PUKTUK_KIND);

      const denMotherDefs = injectedDeps?.DEN_MOTHER_DEFS; // CavernGenerator filters den species through this table before it will assign a Den-Mother.
""",
    """      const westernZone = injectedDeps?.EXTERIOR_ZONES?.[PUKTUK_WESTERN_ZONE_ID]; // Shared zone object read by both exterior and cavern den population selectors.
      const herbivores = westernZone?.herbivoreSpecies; // General herbivore ecology remains independent of den occupants.
      let legacyDrenkirraRemoved = 0;
      if (Array.isArray(herbivores)) {
        for (let i = herbivores.length - 1; i >= 0; i--) {
          if (herbivores[i] !== 'drenkirra') continue;
          herbivores.splice(i, 1);
          legacyDrenkirraRemoved++;
        }
      }
      const packs = westernZone
        ? (Array.isArray(westernZone.packSpecies) ? westernZone.packSpecies : (westernZone.packSpecies = []))
        : null; // General predator ecology; Puktuk remains available outside its explicit den assignment.
      if (Array.isArray(packs) && !packs.includes(PUKTUK_KIND)) packs.push(PUKTUK_KIND);
      const denSpecies = westernZone
        ? (Array.isArray(westernZone.denSpecies) ? westernZone.denSpecies : (westernZone.denSpecies = []))
        : null; // Explicit den-only occupants. Future Western Slope den species can be authored here without changing pack/herd ecology.
      if (Array.isArray(denSpecies) && !denSpecies.includes(PUKTUK_KIND)) denSpecies.push(PUKTUK_KIND);

      const denMotherDefs = injectedDeps?.DEN_MOTHER_DEFS; // CavernGenerator filters den species through this table before it will assign a Den-Mother.
""",
)

replace_once(
    'docs/js/creature-genetics.js',
    """      window.__farmLog?.(`[puktuk] registered predator species: default=medium sizeProfile=gar-wolf belly=always foxtail=${Math.round(PUKTUK_FOXTAIL_CHANCE * 100)}% livestock=puktukWool diet=predator; ${PUKTUK_WESTERN_ZONE_ID} herdDenSpeciesRemoved=${removedHerdSpecies} packs=[${Array.isArray(packs) ? packs.join(',') : 'missing'}] herbivores=[${Array.isArray(herbivores) ? herbivores.join(',') : 'missing'}] denMother=${denMotherDefs?.[PUKTUK_KIND]?.creatureKey || 'missing'}`, Array.isArray(packs) && packs.length === 1 && packs[0] === PUKTUK_KIND && Array.isArray(herbivores) && herbivores.length === 0 ? 'wildlife' : 'warn');
""",
    """      window.__farmLog?.(`[puktuk] registered predator species: default=medium sizeProfile=gar-wolf belly=always foxtail=${Math.round(PUKTUK_FOXTAIL_CHANCE * 100)}% livestock=puktukWool diet=predator; ${PUKTUK_WESTERN_ZONE_ID} legacyDrenkirraRemoved=${legacyDrenkirraRemoved} dens=[${Array.isArray(denSpecies) ? denSpecies.join(',') : 'missing'}] packs=[${Array.isArray(packs) ? packs.join(',') : 'missing'}] herbivores=[${Array.isArray(herbivores) ? herbivores.join(',') : 'missing'}] denMother=${denMotherDefs?.[PUKTUK_KIND]?.creatureKey || 'missing'}`, Array.isArray(denSpecies) && denSpecies.includes(PUKTUK_KIND) && Array.isArray(packs) && packs.includes(PUKTUK_KIND) ? 'wildlife' : 'warn');
""",
)

replace_once(
    'docs/js/wildlife-spawn.js',
    """    // Pack-vs-herd used to be re-rolled fresh every spawn cycle from the
    // general mutable RNG stream — independent of the den's cavern
    // interior, which picks its own Den-Mother/creature-spawn species from
    // a FIXED roll keyed to the den's own identity (see
    // cavern-generator.js's nativeSpeciesFor). When a zone configures both
    // a packSpecies and a herbivoreSpecies pool, that let the exterior and
    // interior of the same den independently land on different answers —
    // confirmed directly: a den with gar-wolves guarding the mouth turned
    // out to be full of drenkirra inside. Same formula, same deterministic
    // per-den seed (mapId + '_denpop') as nativeSpeciesFor, so a den's
    // population type is one fixed identity everywhere it's decided, not
    // two independent coin flips that happen to usually agree.
    const hasPack = zdef?.packSpecies?.length, hasHerd = zdef?.herbivoreSpecies?.length;
    const popRng = window.WildernessMapGenerator.makeRng(cavernMapId + '_denpop');
    const useHerd = hasHerd && (!hasPack || popRng() < 0.5);
    const pool = useHerd ? zdef.herbivoreSpecies : zdef?.packSpecies;
    if (!pool || !pool.length) {
      window.__farmLog?.(`[wildlife] ${denKey}: no packSpecies/herbivoreSpecies pool configured for zone \"${zoneId}\" — den stays empty (fallback: skipped spawn).`, 'wildlife');
      return;
    }
""",
    """    // Zones may author denSpecies when den occupants should be independent
    // of general pack/herd ecology. Legacy zones without denSpecies retain
    // the existing deterministic pack-vs-herd choice so this stays fully
    // backward-compatible.
    const explicitDenSpecies = zdef?.denSpecies || [];
    const hasPack = zdef?.packSpecies?.length, hasHerd = zdef?.herbivoreSpecies?.length;
    const popRng = window.WildernessMapGenerator.makeRng(cavernMapId + '_denpop');
    const useHerd = !explicitDenSpecies.length && hasHerd && (!hasPack || popRng() < 0.5);
    const pool = explicitDenSpecies.length ? explicitDenSpecies : (useHerd ? zdef.herbivoreSpecies : zdef?.packSpecies);
    if (!pool || !pool.length) {
      window.__farmLog?.(`[wildlife] ${denKey}: no denSpecies/packSpecies/herbivoreSpecies pool configured for zone \"${zoneId}\" — den stays empty (fallback: skipped spawn).`, 'wildlife');
      return;
    }
""",
)

replace_once(
    'docs/js/wildlife-spawn.js',
    """    const speciesKey = pool[Math.floor(deps.rnd() * pool.length)];
""",
    """    const speciesKey = pool[Math.floor(deps.rnd() * pool.length)];
    const speciesIsHerbivore = useHerd || !!zdef?.herbivoreSpecies?.includes(speciesKey); // Explicit den pools can still contain a species authored as part of the zone's herbivore ecology.
""",
)

replace_once(
    'docs/js/wildlife-spawn.js',
    """      assignWildlifeStation(opts, zoneData, memberHomeX, memberHomeY, useHerd);
""",
    """      assignWildlifeStation(opts, zoneData, memberHomeX, memberHomeY, speciesIsHerbivore);
""",
)

replace_once(
    'docs/js/wildlife-spawn.js',
    """      if ((zdef?.packSpecies?.length || zdef?.herbivoreSpecies?.length) && !_loggedMissingDenZones.has(currentArea)) {
        _loggedMissingDenZones.add(currentArea);
        window.__farmLog?.(`[wildlife] zone \"${currentArea}\" has a packSpecies/herbivoreSpecies pool but no den anchors in _zoneLayouts (fallback: no wild packs will spawn here this session).`, 'wildlife');
""",
    """      if ((zdef?.denSpecies?.length || zdef?.packSpecies?.length || zdef?.herbivoreSpecies?.length) && !_loggedMissingDenZones.has(currentArea)) {
        _loggedMissingDenZones.add(currentArea);
        window.__farmLog?.(`[wildlife] zone \"${currentArea}\" has a denSpecies/packSpecies/herbivoreSpecies pool but no den anchors in _zoneLayouts (fallback: no wild packs will spawn here this session).`, 'wildlife');
""",
)

replace_once(
    'docs/js/cavern-generator.js',
    """  // Mirrors spawnPackAtDen's own \"predator pack XOR herbivore herd, never
  // both\" design (wildlife-spawn.js) — that system rolls a den's exterior
  // population as EITHER a pack OR a herd, deciding fresh per den, falling
  // back to whichever pool the zone actually has if only one exists. This
  // used to combine packSpecies+herbivoreSpecies into one pool
  // unconditionally, so a zone with both (e.g. Northern Cliffs: grehlr +
  // uumkao'ii-wild) could put a herbivore in the SAME den as its predator
  // pack — both eligible as Den-Mother and as regular spawns at once,
  // reading as if they shared one den. Seeded off mapId (not the exterior
  // system's own rnd stream — a den's cavern is a separate, deterministic
  // roll) so repeated lookups for the same den (Den-Mother pick, then
  // creature-spawn pick) always agree with each other.
  function nativeSpeciesFor(mapId) {
    const zoneId = window.WildlifeSpawn.denCavernZoneOf(mapId);
    const zoneDef = deps.EXTERIOR_ZONES[zoneId];
    const packSpecies = zoneDef?.packSpecies || [];
    const herbivoreSpecies = zoneDef?.herbivoreSpecies || [];
    const hasPack = packSpecies.length, hasHerd = herbivoreSpecies.length;
    const rng = (typeof WildernessMapGenerator !== 'undefined' && WildernessMapGenerator.makeRng) ? WildernessMapGenerator.makeRng(mapId + '_denpop') : Math.random;
    const useHerd = hasHerd && (!hasPack || rng() < 0.5);
    return { zoneId, nativeSpecies: useHerd ? herbivoreSpecies : packSpecies };
  }
""",
    """  // Mirrors spawnPackAtDen's den population resolution. A zone-authored
  // denSpecies list overrides general pack/herd ecology; legacy zones without
  // one retain the deterministic predator-pack XOR herbivore-herd choice.
  function nativeSpeciesFor(mapId) {
    const zoneId = window.WildlifeSpawn.denCavernZoneOf(mapId);
    const zoneDef = deps.EXTERIOR_ZONES[zoneId];
    const denSpecies = zoneDef?.denSpecies || [];
    const packSpecies = zoneDef?.packSpecies || [];
    const herbivoreSpecies = zoneDef?.herbivoreSpecies || [];
    if (denSpecies.length) return { zoneId, nativeSpecies: denSpecies };
    const hasPack = packSpecies.length, hasHerd = herbivoreSpecies.length;
    const rng = (typeof WildernessMapGenerator !== 'undefined' && WildernessMapGenerator.makeRng) ? WildernessMapGenerator.makeRng(mapId + '_denpop') : Math.random;
    const useHerd = hasHerd && (!hasPack || rng() < 0.5);
    return { zoneId, nativeSpecies: useHerd ? herbivoreSpecies : packSpecies };
  }
""",
)

replace_once(
    'scripts/test-puktuk-species.js',
    """const cookingSource = read('docs/js/cooking-data.js'); // Confirms the existing Puktuk wool item is already categorized as Heavy.
""",
    """const cookingSource = read('docs/js/cooking-data.js'); // Confirms the existing Puktuk wool item is already categorized as Heavy.
const wildlifeSource = read('docs/js/wildlife-spawn.js'); // Confirms exterior den spawning prefers explicit den occupants without replacing general ecology.
const cavernSource = read('docs/js/cavern-generator.js'); // Confirms cavern residents and Den-Mothers consume that same explicit den pool.
""",
)

replace_once(
    'scripts/test-puktuk-species.js',
    """assert.match(cookingSource, /\"puktukWool\"\\s*:\\s*\\{[\\s\\S]*?\"name\"\\s*:\\s*\"Puktuk Wool\"[\\s\\S]*?\"Heavy\"/, 'Puktuk Wool remains tagged Heavy in authored cooking data');
""",
    """assert.match(cookingSource, /\"puktukWool\"\\s*:\\s*\\{[\\s\\S]*?\"name\"\\s*:\\s*\"Puktuk Wool\"[\\s\\S]*?\"Heavy\"/, 'Puktuk Wool remains tagged Heavy in authored cooking data');
assert.match(wildlifeSource, /const explicitDenSpecies = zdef\\?\\.denSpecies \\|\\| \\[\\][\\s\\S]*?const pool = explicitDenSpecies\\.length \\? explicitDenSpecies/, 'Exterior den spawning prefers an authored denSpecies pool');
assert.match(cavernSource, /const denSpecies = zoneDef\\?\\.denSpecies \\|\\| \\[\\][\\s\\S]*?if \\(denSpecies\\.length\\) return \\{ zoneId, nativeSpecies: denSpecies \\}/, 'Cavern den spawning prefers the same authored denSpecies pool');
""",
)

replace_once(
    'scripts/test-puktuk-species.js',
    """  EXTERIOR_ZONES: { map_western_slope: { packSpecies: ['gar-wolf'], herbivoreSpecies: ['drenkirra', 'uumkaoii-wild'] } },
""",
    """  EXTERIOR_ZONES: { map_western_slope: { denSpecies: ['future-western-den-species'], packSpecies: ['gar-wolf'], herbivoreSpecies: ['drenkirra', 'uumkaoii-wild'] } },
""",
)

replace_once(
    'scripts/test-puktuk-species.js',
    """assert.deepEqual(JSON.parse(JSON.stringify(wildlifeDeps.EXTERIOR_ZONES.map_western_slope.herbivoreSpecies)), [], 'Western Slope den herd pool is empty so prey species cannot occupy dens');
assert.deepEqual(JSON.parse(JSON.stringify(wildlifeDeps.EXTERIOR_ZONES.map_western_slope.packSpecies)), ['puktuk'], 'Western Slope den predator pool is Puktuk-only');
assert.deepEqual(JSON.parse(JSON.stringify(wildlifeDeps.DEN_MOTHER_DEFS.puktuk)), { creatureKey: 'puktuk', nestItemKey: null });
""",
    """assert.deepEqual(JSON.parse(JSON.stringify(wildlifeDeps.EXTERIOR_ZONES.map_western_slope.herbivoreSpecies)), ['uumkaoii-wild'], 'Puktuk registration does not erase unrelated Western Slope herbivore ecology');
assert.deepEqual(JSON.parse(JSON.stringify(wildlifeDeps.EXTERIOR_ZONES.map_western_slope.packSpecies)), ['gar-wolf', 'puktuk'], 'Puktuk is added to general predator ecology without erasing existing pack species');
assert.deepEqual(JSON.parse(JSON.stringify(wildlifeDeps.EXTERIOR_ZONES.map_western_slope.denSpecies)), ['future-western-den-species', 'puktuk'], 'Puktuk is appended to the explicit den pool without erasing future authored den species');
assert.deepEqual(JSON.parse(JSON.stringify(wildlifeDeps.DEN_MOTHER_DEFS.puktuk)), { creatureKey: 'puktuk', nestItemKey: null });
""",
)
