from pathlib import Path


def replace_once(path, old, new):
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one patch target, found {count}')
    file_path.write_text(text.replace(old, new, 1))


replace_once(
    'docs/js/creature-genetics.js',
    """      const westernZone = injectedDeps?.EXTERIOR_ZONES?.[PUKTUK_WESTERN_ZONE_ID]; // Shared zone object also read by cavern dens, keeping exterior/interior populations consistent.
      const herbivores = westernZone?.herbivoreSpecies; // Drenkirra is removed here because Puktuk replaces it as a carnivorous pack species, not as prey.
      let replacements = 0;
      if (Array.isArray(herbivores)) {
        for (let i = herbivores.length - 1; i >= 0; i--) {
          if (herbivores[i] !== 'drenkirra') continue;
          herbivores.splice(i, 1);
          replacements++;
        }
      }
      const packs = westernZone
        ? (Array.isArray(westernZone.packSpecies) ? westernZone.packSpecies : (westernZone.packSpecies = []))
        : null; // Used by exterior den packs and cavern-generator's deterministic den population choice.
      if (Array.isArray(packs) && !packs.includes(PUKTUK_KIND)) packs.push(PUKTUK_KIND);

      const denMotherDefs = injectedDeps?.DEN_MOTHER_DEFS; // CavernGenerator filters den species through this table before it will assign a Den-Mother.
""",
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
)

replace_once(
    'docs/js/creature-genetics.js',
    """      window.__farmLog?.(`[puktuk] registered predator species: default=medium sizeProfile=gar-wolf belly=always foxtail=${Math.round(PUKTUK_FOXTAIL_CHANCE * 100)}% livestock=puktukWool diet=predator; ${PUKTUK_WESTERN_ZONE_ID} Drenkirra removed=${replacements} packs=[${Array.isArray(packs) ? packs.join(',') : 'missing'}] herbivores=[${Array.isArray(herbivores) ? herbivores.join(',') : 'missing'}] denMother=${denMotherDefs?.[PUKTUK_KIND]?.creatureKey || 'missing'}`, replacements > 0 && Array.isArray(packs) ? 'wildlife' : 'warn');
""",
    """      window.__farmLog?.(`[puktuk] registered predator species: default=medium sizeProfile=gar-wolf belly=always foxtail=${Math.round(PUKTUK_FOXTAIL_CHANCE * 100)}% livestock=puktukWool diet=predator; ${PUKTUK_WESTERN_ZONE_ID} herdDenSpeciesRemoved=${removedHerdSpecies} packs=[${Array.isArray(packs) ? packs.join(',') : 'missing'}] herbivores=[${Array.isArray(herbivores) ? herbivores.join(',') : 'missing'}] denMother=${denMotherDefs?.[PUKTUK_KIND]?.creatureKey || 'missing'}`, Array.isArray(packs) && packs.length === 1 && packs[0] === PUKTUK_KIND && Array.isArray(herbivores) && herbivores.length === 0 ? 'wildlife' : 'warn');
""",
)

replace_once(
    'scripts/test-puktuk-species.js',
    """assert.deepEqual(JSON.parse(JSON.stringify(wildlifeDeps.EXTERIOR_ZONES.map_western_slope.herbivoreSpecies)), ['uumkaoii-wild']);
assert.deepEqual(JSON.parse(JSON.stringify(wildlifeDeps.EXTERIOR_ZONES.map_western_slope.packSpecies)), ['gar-wolf', 'puktuk']);
""",
    """assert.deepEqual(JSON.parse(JSON.stringify(wildlifeDeps.EXTERIOR_ZONES.map_western_slope.herbivoreSpecies)), [], 'Western Slope den herd pool is empty so prey species cannot occupy dens');
assert.deepEqual(JSON.parse(JSON.stringify(wildlifeDeps.EXTERIOR_ZONES.map_western_slope.packSpecies)), ['puktuk'], 'Western Slope den predator pool is Puktuk-only');
""",
)
