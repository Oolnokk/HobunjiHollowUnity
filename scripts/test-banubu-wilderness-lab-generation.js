const assert = require('assert');
const generator = require('../docs/js/wilderness-map-generator.js');
const terrainPlacement = require('../docs/js/locale-terrain-placement.js');
const locale = require('../docs/config/locales/locale_banubu_shrine.json');

terrainPlacement.install(generator);

const settings = {
  ...generator.defaultSettings(),
  preset: 'cliffs',
  stepCurve: 'northernCliffs',
  boundaryMode: 'followMapHeight',
  boundaryCliffBoost: 5,
  plateaus: 92,
  maxTier: 12,
  ramps: 18,
  locales: [locale],
}; // Mirrors the Wilderness Lab's ordinary Northern Cliffs recipe plus Banubu injection.

const workspace = generator.generateWorkspace('wild-lab-2', settings);
const diagnostic = (workspace.localeTerrainDiagnostics || []).find(item => item.localeId === locale.id);
const instance = (workspace.localeInstances || []).find(item => item.localeId === locale.id) || null;
const scale = terrainPlacement.inferGenerationScale(workspace);
const compiled = terrainPlacement.compileLocale(locale, scale);

console.log(JSON.stringify({
  diagnostic: diagnostic ? {
    localeId: diagnostic.localeId,
    status: diagnostic.status,
    reason: diagnostic.reason,
    scale: diagnostic.scale,
    tested: diagnostic.tested,
    valid: diagnostic.valid,
    selected: diagnostic.selected,
    rejectedCount: diagnostic.rejected?.length || 0,
  } : null,
  instance: instance ? {
    localeId: instance.localeId,
    x: instance.x,
    y: instance.y,
    floorTier: instance.floorTier,
    objects: instance.objects,
    npcAnchors: instance.npcAnchors,
  } : null,
}, null, 2));

assert(diagnostic, 'Banubu Cave must produce a terrain-placement diagnostic in real Northern Cliffs generation.');
assert(compiled, 'the authored Banubu default must compile through the terrain-aware placement path');
assert.strictEqual(diagnostic.scale, 2, 'real Wilderness Lab Northern Cliffs generation must evaluate Banubu at the normal 2x tile density');
assert((diagnostic.tested || 0) > 0, 'real generation must actually scan candidate anchors for Banubu');
assert.strictEqual(compiled.tiles.size, 36, 'the authored 3x3 Banubu footprint must expand to 36 final-grid cells at 2x density');
assert.strictEqual(compiled.probes.size, 24, 'the six authored facing-any cliff probes must expand to 24 final-grid probes at 2x density');
assert(['placed', 'skipped'].includes(diagnostic.status), `unexpected Banubu diagnostic status: ${diagnostic.status}`);

const root = (workspace.maps || []).find(map => map && !map.isSubmap);
assert(root, 'real Northern Cliffs generation must expose a root map');

if (diagnostic.status === 'placed') {
  assert(instance, 'a placed Banubu diagnostic must have a localeInstance');
  assert(diagnostic.selected, 'a placed Banubu diagnostic must retain its selected candidate');
  const cliffProbes = (diagnostic.selected.probes || []).filter(probe => probe.rule?.terrain === 'plateauCliff');
  assert(cliffProbes.length > 0, 'a placed Banubu candidate must include its authored internal-cliff probes');
  assert(cliffProbes.every(probe => probe.rule.facing === 'any' && probe.matched), 'all evaluated Banubu cliff probes must match the authored facing-any rule');
  assert(cliffProbes.every(probe => probe.hostTier >= diagnostic.selected.floorTier + 1), 'Banubu cliff probes must remain above the derived next-lower locale floor');
  for (const probe of cliffProbes) {
    const tile = root.tiles?.[`${probe.c},${probe.r}`];
    assert(!tile?.borderEscarpment && !tile?.generatedBorderEscarpment && !tile?.distantBoundaryLandscape, 'Banubu plateauCliff probes must never resolve to boundary-escarpment terrain');
  }
  assert((instance.objects || []).some(object => object.key === 'cave_small'), 'placed Banubu locale must carry its cave_small object into runtime data');
  assert(!(instance.npcAnchors || []).some(anchor => anchor.npcId === 'banubu'), 'Banubu exterior locale must not spawn Banubu; he belongs in the future interior');
} else {
  // This user-authored six-cliff formation is intentionally restrictive. A particular wilderness seed may simply contain no legal host; that is a valid generator outcome, not a regression.
  assert.strictEqual(instance, null, 'a skipped Banubu diagnostic must not fabricate a localeInstance');
  assert.strictEqual(diagnostic.reason, 'no terrain-aware placement matched', 'a skipped authored Banubu locale should report an ordinary no-match');
  assert.strictEqual(diagnostic.valid, 0, 'a skipped seed should report zero valid candidates');
  assert((diagnostic.rejected || []).length > 0, 'a skipped seed must retain rejected candidates for Locale Editor near-miss diagnostics');
  assert((diagnostic.rejected || []).some(candidate => /cliff|probe|terrain-aware placement/i.test(String(candidate.reason || ''))), 'rejections should demonstrate that Banubu was evaluated against its cliff rules');
}

console.log(`Banubu real Northern Cliffs terrain-awareness regression passed (${diagnostic.status}).`);
