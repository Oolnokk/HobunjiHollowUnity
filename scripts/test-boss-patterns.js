// Executes the named-boss pattern authoring path: rule validation and the runtime lookup that the Workshop's Pattern editor feeds.
// Run with: node scripts/test-boss-patterns.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
const context = vm.createContext({
  window, console, URL, document: { currentScript: { src: 'https://game.test/docs/js/combat/enemy-loadout-rules.js' }, baseURI: 'https://game.test/docs/' },
  fetch: async () => ({ ok: true, json: async () => ({ schema: 'hobunji_enemy_loadouts.v1', rules: {} }) }),
});
vm.runInContext(fs.readFileSync('docs/js/combat/enemy-loadout-rules.js', 'utf8'), context);
const rules = window.EnemyLoadoutRules;
const kind = 'lich:hronal:azgarlu';
const set = (bossAppearance) => rules.set({ schema: rules.schema, rules: { [kind]: { bossAppearance } } });

set({ weaponPattern: { pattern: { motifScale: 1, tiling: true } }, clothingPattern: { patternLibraryId: 'repo:blessed_blossom' } });
assert.throws(() => set({ weaponPattern: {} }), /needs a pattern or a library id/);
assert.throws(() => set({ weaponPattern: { patternLibraryId: 'bad id!' } }), /library id/);
assert.throws(() => set({ weaponPattern: { pattern: [] } }), /pattern object/);
assert.throws(() => set({ weaponPattern: { pattern: {}, extra: 1 } }), /extra is unknown/);
assert.throws(() => set({ weaponPattern: { pattern: { blob: 'x'.repeat(950000) } } }), /under 900 KB/);

// Runtime lookup: an authored inline pattern, an authored library id, then the canonical glyph.
const lookup = new Map([['repo:blessed_blossom', { repoPatternId: 'blossom', motifScale: 2 }]]);
Object.assign(window, { PatternLibrary: { getById: (id) => lookup.get(id) || null }, RepoPatternLibrary: { getCachedById: () => null }, EnemyLoadoutRules: rules });
vm.runInContext(fs.readFileSync('docs/js/combat/combat-special-liches.js', 'utf8'), context);
const liches = window.SpecialHarlyaoLiches;
assert.ok(liches?.patternFor, 'patternFor is exported');
set({ weaponPattern: { pattern: { custom: true } }, clothingPattern: { patternLibraryId: 'repo:blessed_blossom' } });
assert.deepEqual(JSON.parse(JSON.stringify(liches.patternFor('hronal', 'weaponPattern'))), { custom: true }, 'inline weapon pattern wins');
assert.equal(liches.patternFor('hronal', 'clothingPattern').repoPatternId, 'blossom', 'library id resolves through PatternLibrary');
rules.set({ schema: rules.schema, rules: {} });
assert.equal(liches.patternFor('hronal', 'weaponPattern').repoPatternId, 'harlyao_glyph_entropy', 'unset falls back to the canonical entropy glyph');

// Wired into the Workshop: shared Pattern editor scripts and both editor entry points.
const preview = fs.readFileSync('docs/tools/enemy-loadout-editor/preview.js', 'utf8');
for (const file of ['pattern-authoring', 'pattern-library', 'repo-pattern-library', 'furniture-pattern-surfaces']) assert.match(preview, new RegExp(`js/${file}\\.js\\?v=`), file + ' loads in the Workshop');
const app = fs.readFileSync('docs/tools/enemy-loadout-editor/app.js', 'utf8');
assert.match(app, /openBossPatternEditor\(special, patternKind\)/);
assert.match(app, /PatternAuthoring\.openEditor/);
console.log('Boss patterns: rule validation, runtime lookup and Workshop wiring verified');
