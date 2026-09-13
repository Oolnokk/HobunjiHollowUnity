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
const instance = (workspace.localeInstances || []).find(item => item.localeId === locale.id);

console.log(JSON.stringify({
  diagnostic,
  instance: instance ? {
    localeId: instance.localeId,
    x: instance.x,
    y: instance.y,
    floorTier: instance.floorTier,
    objects: instance.objects,
    npcAnchors: instance.npcAnchors,
  } : null,
}, null, 2));

assert(diagnostic, 'Banubu Cave must produce a terrain-placement diagnostic in the real Northern Cliffs generation.');
assert.strictEqual(diagnostic.status, 'placed', `Banubu Cave must place in the Wilderness Lab default Northern Cliffs seed; got ${diagnostic.reason || diagnostic.status}`);
assert(instance, 'Banubu Cave must produce a localeInstance in the real Northern Cliffs generation.');
const internalCliffProbes = (diagnostic.selected?.probes || []).filter(probe => probe.rule?.terrain === 'plateauCliff');
const highSideCliffProbes = internalCliffProbes.filter(probe => (probe.rule?.height?.min ?? -Infinity) >= 1);
assert(highSideCliffProbes.length === 2, 'Banubu authored high-side cliff cell must expand to a 2-tile cliff-face strip');
assert(highSideCliffProbes.every(probe => probe.hostTier >= diagnostic.selected.floorTier + 1), 'Banubu rear cliff must rise above the derived lower-side locale floor');

assert.strictEqual(internalCliffProbes.length, 2, "one high-side authored cliff cell must expand to exactly a 2-tile cliff-face strip at 2x density");
assert(internalCliffProbes.every(probe => probe.rule.facing === 'north' && probe.matched), 'Banubu Cave must match its explicit north-facing internal plateau cliff strip');
const root = (workspace.maps || []).find(map => map && !map.isSubmap);
const plateauTier = new Map((workspace.plateauGroups || []).map(group => [group.id, Number(group.elevation) || 0]));
const tierAt = (c, r) => { const tile = root?.tiles?.[`${c},${r}`]; if (!tile) return 0; if (Number.isFinite(Number(tile.rampElevation))) return Number(tile.rampElevation); return plateauTier.get(tile.plateau) || 0; };
assert(highSideCliffProbes.every(probe => Math.abs(tierAt(probe.c, probe.r - 1) - diagnostic.selected.floorTier) < 0.001), "the north-adjacent low side of Banubu's chosen cliff must exactly equal the derived locale floor tier");
for (const probe of internalCliffProbes) {
  const tile = root?.tiles?.[`${probe.c},${probe.r}`];
  assert(!tile?.borderEscarpment && !tile?.generatedBorderEscarpment && !tile?.distantBoundaryLandscape, 'Banubu internal cliff probe must never land on boundary-escarpment terrain');
}
assert((instance.objects || []).some(object => object.key === 'cave_small'), 'placed Banubu locale must carry its cave_small object into runtime data.');
assert(!(instance.npcAnchors || []).some(anchor => anchor.npcId === 'banubu'), 'Banubu exterior locale must not spawn Banubu; he belongs in the future interior.');

console.log('Banubu Cave real Wilderness Lab Northern Cliffs generation regression passed');
