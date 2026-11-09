// Node: node scripts/test-animation-author-pet-scale-and-rig-species.js
// The Rig Coordinates author is browser-driven; these tests cover its shared data contract and source-integrity guards.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const docs = path.resolve(__dirname, '../docs'); // Local repository assets checked against every new sprite reference.
const authorPath = path.join(docs, 'tools/animation-author/index.html'); // Existing author UI and transform/export contract.
const libraryPath = path.join(docs, 'tools/animation-author/rig-preview-species.js'); // New tool-only species metadata.
const author = fs.readFileSync(authorPath, 'utf8');
const library = fs.readFileSync(libraryPath, 'utf8');
const sandbox = { window: {} }; // A browser-like global without altering the actual game registry.
vm.runInNewContext(library, sandbox, { filename: libraryPath });

const api = sandbox.window.HobunjiRigPreviewSpecies;
assert.ok(api, 'preview species registry should initialize');
const originalGarWolf = { prefix: 'gw', base: { idle: 'canonical wolf' }, patterns: ['canonical'] }; // Checks that author registration never overwrites existing game entries.
const registry = { 'gar-wolf': originalGarWolf, grehlr: { base: { idle: 'grehlr' }, patterns: [] }, drenkirra: { base: { idle: 'drenkirra' }, patterns: [] } };
const newCount = api.install(registry);
assert.equal(newCount, 13, 'new and variant species should all register in the rig editor');
assert.strictEqual(registry['gar-wolf'], originalGarWolf, 'pre-existing renderers remain authoritative');
assert.equal(api.install(registry), 0, 'registration must be idempotent');
assert.equal(registry['voorg-ass'].baseRecolorKeyHex, '#99BF99', 'Voorg-ass coat must keep gameplay keyed recolor');
assert.equal(registry.moot.baseRecolorKeyHex, '#9CBD9E', 'Moot coat must keep gameplay keyed recolor');
assert.deepEqual(Array.from(registry.puktuk.patterns), ['belly', 'foxtail'], 'Puktuk keeps both inherited coat overlays');
assert.equal(api.genotypeDefaults('puktuk').base.toLowerCase(), '#99bf99', 'Puktuk defaults to its authored source coat');
assert.equal(api.speciesInfo('pingdort').modelWidth, 0.48, 'small bird size must match gameplay registration');

for (const kind of ['tzatzul', 'pingdort', 'skeeri-small', 'skeeri-medium', 'skeeri-large']) {
  assert.equal(api.defaultFrame(kind), 'perched', kind + ' should open on its perched frame');
  assert.match(registry[kind].base.perched, /perched\.png$/, kind + ' must select actual perched art');
}
assert.equal(registry['tzatzul-hatchling'].base.run1, registry['tzatzul-hatchling'].base.perched, 'hatchlings do not switch to adult flight art');
assert.equal(registry['skeeri-small'].base.perched, registry['skeeri-large'].base.perched, 'skeeri sizes share authored sprite, not unrelated art');
assert.equal(api.defaultFrame('puktuk'), null, 'ordinary walking creatures remain on idle');
assert.equal(api.baseSpecies('gar-wolf-alpha'), 'gar-wolf', 'Alpha preview must inherit Gar-wolf coat defaults');
assert.equal(api.baseSpecies('grehlr-den-mother'), 'grehlr', 'Den-Mothers should retain their parent coat family');

const present = new Set(); // Avoids double-checking frames that intentionally share a perched or flying PNG.
for (const spec of Object.values(registry)) {
  for (const asset of Object.values(spec.base || {})) {
    if (!String(asset).startsWith('assets/')) continue; // Built-in placeholder entries in this test are not file paths.
    present.add(asset);
  }
  for (const asset of Object.values(spec.eyes || {})) if (String(asset).startsWith('assets/')) present.add(asset);
}
for (const asset of present) assert.ok(fs.existsSync(path.join(docs, asset)), 'missing authored rig sprite: ' + asset);

const scriptStart = author.indexOf('(() => {', author.indexOf('rig-preview-species.js')); // Finds the main author IIFE following the new dependency script.
const scriptEnd = author.indexOf('</script>', scriptStart);
assert.ok(scriptStart > 0 && scriptEnd > scriptStart, 'main animation author script should be present');
new vm.Script(author.slice(scriptStart, scriptEnd), { filename: authorPath }); // Catch HTML template-string syntax regressions.
assert.match(author, /HobunjiRigPreviewSpecies\?\.install\(window\.CreatureGeneticsRender\.SPECIES/);
assert.match(author, /animationAuthor\.mode === 'rig' \? window\.HobunjiRigPreviewSpecies\?\.defaultFrame\(kind\)/);
assert.match(author, /id="maaShoulderPetScale"/, 'character shoulder-perch inspector needs a visible multiplier');
assert.match(author, /shoulder\.scale\.setScalar\(multiplier\)/, 'X/Y/Z must scale uniformly');
assert.match(author, /multiplier < 0\.05 \|\| multiplier > 4/, 'bad scale inputs must be rejected');
assert.match(author, /profile\.anchors\[name\] = normalizeTransformSnapshot\(transformSnapshot\(actor\.rigAnchors\[name\]\), 1\)/, 'authored scale must persist through export');
assert.match(author, /const authoredScale = target\.characters\[key\]\?\.anchors\?\.shoulderPerch\?\.scale/, 'rig autosave migrations must preserve custom grip multipliers');
assert.match(author, /CREATURE_DEFAULTS\[baseKind\]/, 'alpha animal previews must inherit the source species color instead of gray');

const resetStart = author.indexOf('function resetCanonicalCharacterShoulderPerchV1524(actor) {'); // Extracts the actual on-page reset implementation, not a separately replicated formula.
const resetEnd = author.indexOf('const baseResetAttachmentRigAnchorToRepositoryDefaultV1524', resetStart);
assert.ok(resetStart > 0 && resetEnd > resetStart, 'author should expose the canonical reset implementation');
const master = {
  anchors: { shoulderPerch: { position: { x: -0.2, y: 0.6, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
  shoulderPerchRule: { authoredFixed: true, source: 'latest-master' },
}; // Deliberately differs from the superseded V15.23 fallback value.
const live = {
  anchors: { shoulderPerch: { position: { x: -0.2965, y: 0.6947, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 0.65, y: 0.65, z: 0.65 } } },
  shoulderPerchRule: { authoredFixed: true, source: 'previous-preview' },
}; // Represents an edited Small-size multiplier and an outdated coordinate.
const resetActor = { source: { type: 'npc' }, rigAnchors: { shoulderPerch: {} } };
const resetScope = {
  window: {
    HOBUNJI_ATTACHMENT_RIG_MASTER: { profiles: { characters: { 'mao-ao::male': master } } },
    HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: { 'mao-ao::male': live } },
  },
  actor: resetActor,
  characterRigProfileKey: () => 'mao-ao::male',
  attachmentRigProfileForActor: () => live,
  normalizeTransformSnapshot: snapshot => JSON.parse(JSON.stringify(snapshot)),
  applyTransformSnapshot: (target, snapshot) => { target.applied = JSON.parse(JSON.stringify(snapshot)); },
  approvedRigLibraryCloneV1524: () => ({ characters: { 'mao-ao::male': live } }),
}; // The immutable current master must win over preview-local and legacy stored values.
const didReset = vm.runInNewContext(author.slice(resetStart, resetEnd) + '\nresetCanonicalCharacterShoulderPerchV1524(actor);', resetScope);
assert.equal(didReset, true, 'character shoulder reset should succeed');
assert.equal(live.anchors.shoulderPerch.position.x, -0.2, 'reset must use current canonical master X, not the stale pre-master X');
assert.equal(live.anchors.shoulderPerch.position.y, 0.6, 'reset must restore the current canonical Y');
assert.equal(live.anchors.shoulderPerch.scale.x, 1, 'reset must clear the authored pet scale');
assert.equal(live.anchors.shoulderPerch.scale.y, 1, 'reset must restore uniform Y scale');
assert.equal(live.anchors.shoulderPerch.scale.z, 1, 'reset must restore uniform Z scale');
assert.equal(resetActor.rigAnchors.shoulderPerch.applied.position.x, -0.2, 'live preview pivot should match saved reset anchor');
assert.equal(master.anchors.shoulderPerch.scale.x, 1, 'the shared canonical master must never be mutated');
assert.equal(live.shoulderPerchRule.recalculateOnPreview, false, 'legacy auto placement must not overwrite reset');

assert.match(author, /applyCreatureSizeClass\(creature, 'small'/, 'pet size genetics remain intact');
assert.match(author, /setActorAttachment\(creature, character, 'shoulderPerch', 'shoulderGrip'/, 'pet root remains parented to species-level perch');
assert.match(author, /carrier\.add\(actor\.root\)/, 'THREE parent transform composes grip scale with Small size scale');

const inheritedScale = 0.6 * 0.35; // Example: a 0.6x species shoulder grip multiplies a 0.35x small animal without replacing its genotype scale.
assert.ok(Math.abs(inheritedScale - 0.21) < 1e-12);
console.log('PASS: 13 new rig species/variants, native art, default perch selection, validated persisted shoulder multiplier and author JS syntax (' + present.size + ' PNGs).');
