from pathlib import Path
import copy
import json


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing patch target: {label}')
    return text.replace(old, new, 1)

# Stretch the cave texture over the cave UV extent instead of repeating it.
renderer_path = Path('docs/js/zone-den-totem-features.js')
renderer = renderer_path.read_text(encoding='utf-8')
renderer = replace_once(renderer, "  const DEN_CAVE_TEXTURE_REPEAT = 0.35;\n", "", 'cave repeat constant')
renderer = replace_once(
    renderer,
    "    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;\n    tex.repeat.set(DEN_CAVE_TEXTURE_REPEAT, DEN_CAVE_TEXTURE_REPEAT);\n",
    "    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;\n    tex.repeat.set(1, 1);\n    tex.offset.set(0, 0);\n    tex.needsUpdate = true;\n",
    'cave texture wrapping',
)
old_uv = """  function assignCaveUv(geometry) {
    if (geometry.getAttribute('uv')) return;
    const pos = geometry.getAttribute('position');
    if (!pos) return;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i); uv[i * 2 + 1] = pos.getZ(i); }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
"""
new_uv = """  function fitCaveUvToTexture(geometry) {
    const pos = geometry.getAttribute('position');
    let sourceUv = geometry.getAttribute('uv');
    if (!sourceUv) {
      if (!pos) return;
      const generated = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) { generated[i * 2] = pos.getX(i); generated[i * 2 + 1] = pos.getZ(i); }
      sourceUv = new THREE.BufferAttribute(generated, 2);
    }
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (let i = 0; i < sourceUv.count; i++) {
      const u = sourceUv.getX(i), v = sourceUv.getY(i);
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const spanU = Math.max(1e-6, maxU - minU);
    const spanV = Math.max(1e-6, maxV - minV);
    const fitted = new Float32Array(sourceUv.count * 2);
    for (let i = 0; i < sourceUv.count; i++) {
      fitted[i * 2] = (sourceUv.getX(i) - minU) / spanU;
      fitted[i * 2 + 1] = (sourceUv.getY(i) - minV) / spanV;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(fitted, 2));
  }
"""
renderer = replace_once(renderer, old_uv, new_uv, 'cave uv fitter')
renderer = replace_once(renderer, '        assignCaveUv(mesh.geometry);', '        fitCaveUvToTexture(mesh.geometry);', 'cave uv call')
renderer_path.write_text(renderer, encoding='utf-8')

# Paint a one-tile-deep, cave-width free approach apron directly in front of
# Banubu's north-facing cave mouth. Relative height 0 keeps the approach on the
# cave floor rather than accepting an open plateau above or below it.
locale_path = Path('docs/config/locales/locale_banubu_shrine.json')
locale = json.loads(locale_path.read_text(encoding='utf-8'))
free_rule = {
    'terrain': 'free',
    'strength': 'required',
    'weight': 1,
    'facing': 'any',
    'height': {'mode': 'relativeRange', 'min': 0, 'max': 0},
}
for key in ('3,0', '4,0', '5,0'):
    locale.setdefault('terrainAnchors', {})[key] = copy.deepcopy(free_rule)
locale.setdefault('placement', {})['terrainAnchors'] = copy.deepcopy(locale['terrainAnchors'])
locale['placement']['notes'] = (
    "Northern Cliffs only. The cave mouth is pinned to the LOW side of a north-facing internal plateau cliff, "
    "the center rear cell is pinned to the HIGH side, and the rear row is embedded into plateau mass then carved "
    "down to the cave floor. Flanking cliff probes are preferred rather than required so irregular natural cliff "
    "edges can still host the cave. The three cells directly north/in front of the north-facing mouth must be free, "
    "open terrain on the cave floor. Boundary escarpments are rejected. The cave entrance prop renders at 2x its "
    "normal in-game cave scale."
)
locale['meta']['updatedAt'] = '2026-09-13T21:30:00.000Z'
locale_path.write_text(json.dumps(locale, indent=2) + '\n', encoding='utf-8')

# Keep the browser-local Banubu migration current. Existing users may already
# have the immediately-previous six-cliff/three-embedded canonical rule set in
# localStorage, so migrate that exact known shape to the new free-apron rules.
editor_path = Path('docs/tools/locale-editor/terrain-placement.js')
editor = editor_path.read_text(encoding='utf-8')
editor = replace_once(
    editor,
    "    terrainAnchors: {\n      '3,2': { terrain: 'plateauCliff', strength: 'preferred', weight: 2, facing: 'north', height: { mode: 'relativeRange', min: 0, max: 0 } },",
    "    terrainAnchors: {\n      '3,0': { terrain: 'free', strength: 'required', weight: 1, facing: 'any', height: { mode: 'relativeRange', min: 0, max: 0 } },\n      '4,0': { terrain: 'free', strength: 'required', weight: 1, facing: 'any', height: { mode: 'relativeRange', min: 0, max: 0 } },\n      '5,0': { terrain: 'free', strength: 'required', weight: 1, facing: 'any', height: { mode: 'relativeRange', min: 0, max: 0 } },\n      '3,2': { terrain: 'plateauCliff', strength: 'preferred', weight: 2, facing: 'north', height: { mode: 'relativeRange', min: 0, max: 0 } },",
    'canonical front clearance rules',
)
old_migration = """  function migrateKnownBrokenRules(locale, rules) {
    if (!isKnownBrokenBanubuRules(locale, rules)) return rules;
    return clone(BANUBU_CANONICAL_RULES);
  }
"""
new_migration = """  function isBanubuRulesMissingFrontClearance(locale, rules) {
    if (locale?.id !== 'locale_banubu_shrine' || locale?.placement?.floorMode !== 'nextLowerCliffTier') return false;
    const expected = clone(BANUBU_CANONICAL_RULES);
    delete expected.terrainAnchors['3,0'];
    delete expected.terrainAnchors['4,0'];
    delete expected.terrainAnchors['5,0'];
    return sameRules(rules, expected);
  }

  function migrateKnownBrokenRules(locale, rules) {
    if (!isKnownBrokenBanubuRules(locale, rules) && !isBanubuRulesMissingFrontClearance(locale, rules)) return rules;
    return clone(BANUBU_CANONICAL_RULES);
  }
"""
editor = replace_once(editor, old_migration, new_migration, 'pre-clearance browser migration')
editor = replace_once(
    editor,
    "      debug('repaired legacy Banubu south-cliff terrain rules to canonical north-facing cliff-base rules');",
    "      debug('updated Banubu browser terrain rules to the canonical north-facing cliff-base rules with a free approach apron');",
    'migration debug message',
)
editor_path.write_text(editor, encoding='utf-8')

# Update authored/runtime regression coverage.
test_path = Path('scripts/test-banubu-cave-locale.js')
test = test_path.read_text(encoding='utf-8')
test = replace_once(
    test,
    "const expectedAnchorKeys = ['3,2','4,2','5,2','3,3','4,3','5,3'];",
    "const expectedAnchorKeys = ['3,0','4,0','5,0','3,2','4,2','5,2','3,3','4,3','5,3'];",
    'expected Banubu anchors',
)
test = replace_once(
    test,
    "const anchors = locale.terrainAnchors || {};\nassert.deepStrictEqual(Object.keys(anchors).sort(), expectedAnchorKeys.slice().sort(), 'Banubu default must use the six paired cliff-base probes');\n",
    "const anchors = locale.terrainAnchors || {};\nassert.deepStrictEqual(Object.keys(anchors).sort(), expectedAnchorKeys.slice().sort(), 'Banubu default must use the six paired cliff-base probes plus three front-clearance probes');\nfor (const key of ['3,0','4,0','5,0']) {\n  const rule = anchors[key];\n  assert.strictEqual(rule?.terrain, 'free', `${key} must reserve open terrain in front of the north-facing cave mouth`);\n  assert.strictEqual(rule?.strength, 'required');\n  assert.strictEqual(rule?.facing, 'any');\n  assert.strictEqual(rule?.height?.mode, 'relativeRange');\n  assert.strictEqual(rule?.height?.min, 0);\n  assert.strictEqual(rule?.height?.max, 0, `${key} must remain on the cave floor tier`);\n}\n",
    'front clearance regression',
)
test = replace_once(test, "assert.strictEqual(compiled.probes.size, 6, 'compiled Banubu rules must include all six paired cliff probes');", "assert.strictEqual(compiled.probes.size, 9, 'compiled Banubu rules must include six cliff probes plus three front-clearance probes');", 'compiled probe count')
test = replace_once(
    test,
    "assert(zoneRenderer.includes('Number.isFinite(Number(cave.floorTier)) ? Number(cave.floorTier) : sampledTier'), 'locale cave renderer must anchor terrain-aware caves to their locale floor tier');\n",
    "assert(zoneRenderer.includes('Number.isFinite(Number(cave.floorTier)) ? Number(cave.floorTier) : sampledTier'), 'locale cave renderer must anchor terrain-aware caves to their locale floor tier');\nassert(zoneRenderer.includes('THREE.ClampToEdgeWrapping') && zoneRenderer.includes('tex.repeat.set(1, 1)'), 'cave material must stretch once across the fitted cave UVs instead of tiling');\nassert(zoneRenderer.includes('fitCaveUvToTexture') && zoneRenderer.includes('(sourceUv.getX(i) - minU) / spanU'), 'cave UVs must be normalized to the full 0–1 texture span');\nassert(!zoneRenderer.includes('THREE.RepeatWrapping'), 'cave renderer must not use repeating texture wrapping');\n",
    'cave stretch regression',
)
test = replace_once(
    test,
    "assert(localeTerrainEditor.includes('reconcileRulesFromLocale(locale)'), 'terrain sidecar must reconcile stale cache from the authoritative workspace locale');\n",
    "assert(localeTerrainEditor.includes('reconcileRulesFromLocale(locale)'), 'terrain sidecar must reconcile stale cache from the authoritative workspace locale');\nassert(localeTerrainEditor.includes('isBanubuRulesMissingFrontClearance'), 'terrain sidecar must migrate the immediately-previous Banubu browser rules to include the new front clearance apron');\n",
    'browser migration regression',
)
test_path.write_text(test, encoding='utf-8')

wild_path = Path('scripts/test-banubu-wilderness-lab-generation.js')
wild = wild_path.read_text(encoding='utf-8')
wild = replace_once(wild, "assert.strictEqual(compiled.probes.size, 12, 'six directional cliff probes must expand to one 2-cell face strip each at 2x density');", "assert.strictEqual(compiled.probes.size, 24, 'six directional cliff probes plus three 2x2 free-space probes must expand to 24 final-grid probes');", '2x probe count')
wild = replace_once(
    wild,
    "  const cliffProbes = (diagnostic.selected.probes || []).filter(probe => probe.rule?.terrain === 'plateauCliff');\n",
    "  const allProbes = diagnostic.selected.probes || [];\n  const freeProbes = allProbes.filter(probe => probe.rule?.terrain === 'free');\n  assert(freeProbes.length > 0 && freeProbes.every(probe => probe.rule?.strength === 'required' && probe.matched && Math.abs(probe.hostTier - diagnostic.selected.floorTier) <= 0.05), 'front-of-cave clearance probes must resolve to free/open terrain on the locale floor');\n  const cliffProbes = allProbes.filter(probe => probe.rule?.terrain === 'plateauCliff');\n",
    'placed free-space assertion',
)
wild_path.write_text(wild, encoding='utf-8')
