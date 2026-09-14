from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one patch target, found {count}')
    p.write_text(text.replace(old, new, 1))


replace_once(
    'docs/js/wildlife-spawn.js',
    """  function spawnPackAtDen(zoneId, den, denKey) {
    const zdef = deps.EXTERIOR_ZONES[zoneId];
    const cavernMapId = denCavernMapId(zoneId, den.id);
""",
    """  function denSpeciesFor(zoneId, cavernMapId) {
    const pool = deps.EXTERIOR_ZONES[zoneId]?.denSpecies || [];
    if (!pool.length) return null;
    const rng = window.WildernessMapGenerator.makeRng(cavernMapId + '_denspecies'); // One stable exact species identity per den, shared by exterior and cavern generation.
    return pool[Math.floor(rng() * pool.length)] || null;
  }

  function spawnPackAtDen(zoneId, den, denKey) {
    const zdef = deps.EXTERIOR_ZONES[zoneId];
    const cavernMapId = denCavernMapId(zoneId, den.id);
""",
)

replace_once(
    'docs/js/wildlife-spawn.js',
    """    const explicitDenSpecies = zdef?.denSpecies || [];
    const hasPack = zdef?.packSpecies?.length, hasHerd = zdef?.herbivoreSpecies?.length;
    const popRng = window.WildernessMapGenerator.makeRng(cavernMapId + '_denpop');
    const useHerd = !explicitDenSpecies.length && hasHerd && (!hasPack || popRng() < 0.5);
    const pool = explicitDenSpecies.length ? explicitDenSpecies : (useHerd ? zdef.herbivoreSpecies : zdef?.packSpecies);
""",
    """    const explicitSpeciesKey = denSpeciesFor(zoneId, cavernMapId); // Exact authored den identity, stable for this den across respawns and shared with CavernGenerator.
    const hasPack = zdef?.packSpecies?.length, hasHerd = zdef?.herbivoreSpecies?.length;
    const popRng = window.WildernessMapGenerator.makeRng(cavernMapId + '_denpop');
    const useHerd = !explicitSpeciesKey && hasHerd && (!hasPack || popRng() < 0.5);
    const pool = explicitSpeciesKey ? [explicitSpeciesKey] : (useHerd ? zdef.herbivoreSpecies : zdef?.packSpecies);
""",
)

replace_once(
    'docs/js/wildlife-spawn.js',
    """    const speciesKey = pool[Math.floor(deps.rnd() * pool.length)];
""",
    """    const speciesKey = explicitSpeciesKey || pool[Math.floor(deps.rnd() * pool.length)];
""",
)

replace_once(
    'docs/js/wildlife-spawn.js',
    """    denCavernZoneOf: (mapId) => _denCavernZoneOf.get(mapId),
    denKeyForCavern,
""",
    """    denCavernZoneOf: (mapId) => _denCavernZoneOf.get(mapId),
    denSpeciesFor,
    denKeyForCavern,
""",
)

replace_once(
    'docs/js/cavern-generator.js',
    """    const zoneDef = deps.EXTERIOR_ZONES[zoneId];
    const denSpecies = zoneDef?.denSpecies || [];
    const packSpecies = zoneDef?.packSpecies || [];
    const herbivoreSpecies = zoneDef?.herbivoreSpecies || [];
    if (denSpecies.length) return { zoneId, nativeSpecies: denSpecies };
""",
    """    const zoneDef = deps.EXTERIOR_ZONES[zoneId];
    const exactDenSpecies = window.WildlifeSpawn.denSpeciesFor(zoneId, mapId); // Same per-den deterministic authored species used by exterior den guards.
    const packSpecies = zoneDef?.packSpecies || [];
    const herbivoreSpecies = zoneDef?.herbivoreSpecies || [];
    if (exactDenSpecies) return { zoneId, nativeSpecies: [exactDenSpecies] };
""",
)

replace_once(
    'scripts/test-puktuk-species.js',
    """assert.match(wildlifeSource, /const explicitDenSpecies = zdef\\?\\.denSpecies \\|\\| \\[\\][\\s\\S]*?const pool = explicitDenSpecies\\.length \\? explicitDenSpecies/, 'Exterior den spawning prefers an authored denSpecies pool');
assert.match(cavernSource, /const denSpecies = zoneDef\\?\\.denSpecies \\|\\| \\[\\][\\s\\S]*?if \\(denSpecies\\.length\\) return \\{ zoneId, nativeSpecies: denSpecies \\}/, 'Cavern den spawning prefers the same authored denSpecies pool');
""",
    """assert.match(wildlifeSource, /function denSpeciesFor\\(zoneId, cavernMapId\\)[\\s\\S]*?_denspecies[\\s\\S]*?return pool\\[Math\\.floor\\(rng\\(\\) \\* pool\\.length\\)\\]/, 'Explicit denSpecies resolves to one deterministic exact species per den');
assert.match(wildlifeSource, /const explicitSpeciesKey = denSpeciesFor\\(zoneId, cavernMapId\\)/, 'Exterior den guards use the shared exact per-den species resolver');
assert.match(cavernSource, /window\\.WildlifeSpawn\\.denSpeciesFor\\(zoneId, mapId\\)[\\s\\S]*?nativeSpecies: \\[exactDenSpecies\\]/, 'Cavern residents and Den-Mothers use the same exact per-den species resolver');
""",
)
