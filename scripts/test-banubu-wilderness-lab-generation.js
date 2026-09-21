const assert = require('assert');
const generator = require('../docs/js/wilderness-map-generator.js');
const terrainPlacement = require('../docs/js/locale-terrain-placement.js');
const locale = require('../docs/config/locales/locale_banubu_shrine.json');
const fs = require('fs');
const path = require('path');

terrainPlacement.install(generator);

const terrainEditorSource = fs.readFileSync(path.resolve(__dirname, '../docs/tools/locale-editor/terrain-placement.js'), 'utf8');
assert(terrainEditorSource.includes('isKnownBrokenBanubuRules'), 'Locale Editor must recognize the known stale Banubu south-cliff browser-workspace signature');
assert(terrainEditorSource.includes('BANUBU_CANONICAL_RULES'), 'Locale Editor must carry the canonical Banubu repair rule set');
assert(terrainEditorSource.includes("anchors.length < 20") && terrainEditorSource.includes("rule?.facing === 'south'"), 'Banubu migration must stay narrowly scoped to the obsolete large south-facing rule grid');

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
assert.strictEqual(compiled.probes.size, 24, 'six directional cliff probes plus three 2x2 free-space probes must expand to 24 final-grid probes');
assert.strictEqual(compiled.embedded.size, 12, 'the three rear embedded cells must expand to twelve final-grid cells at 2x density');
assert.strictEqual(diagnostic.status, 'placed', 'Banubu Cave must always find either its strict cliff fit or its authored center-cliff fallback');
assert(instance, 'Banubu Cave must always register a localeInstance so its cave and map waypoint exist');

const root = (workspace.maps || []).find(map => map && !map.isSubmap);
assert(root, 'real Northern Cliffs generation must expose a root map');

if (diagnostic.status === 'placed') {
  assert(instance, 'a placed Banubu diagnostic must have a localeInstance');
  assert(diagnostic.selected, 'a placed Banubu diagnostic must retain its selected candidate');
  const allProbes = diagnostic.selected.probes || [];
  const freeProbes = allProbes.filter(probe => probe.rule?.terrain === 'free');
  assert(freeProbes.length > 0 && freeProbes.every(probe => probe.rule?.strength === 'required' && probe.matched && Math.abs(probe.hostTier - diagnostic.selected.floorTier) <= 0.05), 'front-of-cave clearance probes must resolve to free/open terrain on the locale floor');
  const cliffProbes = allProbes.filter(probe => probe.rule?.terrain === 'plateauCliff');
  const required = cliffProbes.filter(probe => probe.rule?.strength === 'required');
  const lowRequired = required.filter(probe => probe.rule?.height?.max === 0);
  const highRequired = required.filter(probe => probe.rule?.height?.min >= 1);
  assert(lowRequired.length > 0 && highRequired.length > 0, 'placed Banubu candidate must preserve paired required low/high cliff probes');
  assert(lowRequired.every(probe => probe.rule.facing === 'north' && probe.matched && Math.abs(probe.hostTier - diagnostic.selected.floorTier) <= 0.05), 'required cave-mouth probes must sit on the local lower tier');
  assert(highRequired.every(probe => probe.rule.facing === 'north' && probe.matched && probe.hostTier >= diagnostic.selected.floorTier + 1), 'required rear probes must sit on the higher side of the same north-facing cliff');
  for (const probe of required) {
    const tile = root.tiles?.[`${probe.c},${probe.r}`];
    assert(!tile?.borderEscarpment && !tile?.generatedBorderEscarpment && !tile?.distantBoundaryLandscape, 'Banubu plateauCliff probes must never resolve to boundary-escarpment terrain');
  }
  const embedded = diagnostic.selected.embedded || [];
  assert(embedded.length > 0 && embedded.every(cell => cell.matched && cell.hostTier >= diagnostic.selected.floorTier + 1), 'rear embedded cells must originate in high plateau mass before carving');
  assert((instance.objects || []).some(object => object.key === 'cave_small'), 'placed Banubu locale must carry its cave_small object into runtime data');
  assert(!(instance.npcAnchors || []).some(anchor => anchor.npcId === 'banubu'), 'Banubu exterior locale must not spawn Banubu; he lives in the cavern interior');
  const banubuTransition = (root.transitions || []).find(transition => transition.generatedLocaleId === locale.id); // Used to verify the post-shift walkable entrance generated from the placed locale.
  assert(banubuTransition, 'a placed Banubu locale must export a runtime transition from its walkable path anchor');
  assert.strictEqual(banubuTransition.targetMapId, 'map_i_den_banubu', 'Banubu wilderness entrance must lead to his generated cavern');
  assert.strictEqual(banubuTransition.label, "Enter Banubu's Cave");
} else {
  assert.strictEqual(instance, null, 'a skipped Banubu diagnostic must not fabricate a localeInstance');
  assert.strictEqual(diagnostic.reason, 'no terrain-aware placement matched', 'a skipped Banubu locale should report an ordinary no-match');
  assert.strictEqual(diagnostic.valid, 0, 'a skipped seed should report zero valid candidates');
  assert((diagnostic.rejected || []).length > 0, 'a skipped seed must retain rejected candidates for Locale Editor near-miss diagnostics');
  assert((diagnostic.rejected || []).some(candidate => /cliff|embedded|probe|terrain-aware placement/i.test(String(candidate.reason || ''))), 'rejections should demonstrate that Banubu was evaluated against its cliff-base rules');
}

// Exact Locale Editor preview seeds supplied through Copy Preview Debug. They
// should place when evaluated against the canonical synchronized Banubu rules.
const previewSeeds = [
  'locale-preview|locale_banubu_shrine|map_northern_cliffs|mtzx7qkr|ckqwlqf',
  'locale-preview|locale_banubu_shrine|map_northern_cliffs|mtzztqpk|s0ho2n6',
  'locale-preview|locale_banubu_shrine|map_northern_cliffs|mu0bd5bo|khx6y2e',
];
const previewResults = [];
for (const seed of previewSeeds) {
  const previewWorkspace = generator.generateZoneWorkspace('map_northern_cliffs', seed, [locale]);
  const previewDiagnostic = (previewWorkspace.localeTerrainDiagnostics || []).find(item => item.localeId === locale.id);
  const previewInstance = (previewWorkspace.localeInstances || []).find(item => item.localeId === locale.id) || null;
  assert(previewDiagnostic, `known Locale Editor seed ${seed} must emit Banubu terrain diagnostics`);
  assert.strictEqual(previewDiagnostic.status, 'placed', `known former no-match preview seed ${seed} should find a cliff-base placement with synchronized rules`);
  assert((previewDiagnostic.valid || 0) > 0, `known former no-match preview seed ${seed} must expose at least one valid cliff-base candidate`);
  assert(previewInstance, `known former no-match preview seed ${seed} must create a runtime locale instance`);
  assert.strictEqual(previewInstance.floorTier, previewDiagnostic.selected?.floorTier, `preview runtime cave floor must match the selected lower cliff tier for ${seed}`);
  const previewRoot = (previewWorkspace.maps || []).find(map => map && !map.isSubmap); // Used to verify the transition survives the same exact preview seeds used by the editor.
  const previewTransition = (previewRoot?.transitions || []).find(transition => transition.generatedLocaleId === locale.id); // Used to locate the locale-derived cave entrance after random placement.
  assert(previewTransition && previewTransition.targetMapId === 'map_i_den_banubu', `known preview seed ${seed} must connect Banubu's placed cave to his cavern interior`);
  previewResults.push(`${previewDiagnostic.valid} valid`);
}

console.log(`Banubu real Northern Cliffs cliff-base regression passed (${diagnostic.status}); debug preview seeds place with ${previewResults.join(' / ')} candidates.`);
