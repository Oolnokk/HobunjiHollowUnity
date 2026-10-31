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
Object.assign(window, { SCRATCHBONES_CONFIG: { game: { dyes: { catalog: [{ id: 'dye:CLOTH:pure_orange', hex: '#ff8000' }, { id: 'dye:CLOTH:pale_blue', hex: '#a8d0f0' }, { id: 'dye:CLOTH:dark_muted_blue_indigo', hex: '#2b2f5c' }] } } }, PatternLibrary: { getById: (id) => lookup.get(id) || null }, RepoPatternLibrary: { getCachedById: () => null }, EnemyLoadoutRules: rules });
vm.runInContext(fs.readFileSync('docs/js/combat/combat-special-liches.js', 'utf8'), context);
const liches = window.SpecialHarlyaoLiches;
assert.ok(liches?.patternFor, 'patternFor is exported');
set({ weaponPattern: { pattern: { custom: true } }, clothingPattern: { patternLibraryId: 'repo:blessed_blossom' } });
assert.deepEqual(JSON.parse(JSON.stringify(liches.patternFor('hronal', 'weaponPattern'))), { custom: true }, 'inline weapon pattern wins');
assert.equal(liches.patternFor('hronal', 'clothingPattern').repoPatternId, 'blossom', 'library id resolves through PatternLibrary');
rules.set({ schema: rules.schema, rules: {} });
assert.equal(liches.patternFor('hronal', 'weaponPattern').repoPatternId, 'harlyao_glyph_entropy', 'unset falls back to the canonical entropy glyph');

// Body Color 3 defaults to the hue opposite the primary robe color (never the same family), still overridable.
const hue = (hex) => { const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, max = Math.max(r, g, b), d = max - Math.min(r, g, b); const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
const opposed = (a, b) => Math.abs(((hue(a) - hue(b) + 360) % 360) - 180);
for (const [type, robe] of [['hronal', '#ff8000'], ['tothal', '#a8d0f0'], ['kanthic', '#2b2f5c']]) {
  const c = liches.bodyColor3For(type);
  assert.match(c, /^#[0-9a-f]{6}$/, type + ' Body Color 3 is a hex color');
  assert.ok(opposed(c, robe) < 8, type + ' Body Color 3 is the opposite hue of its robe (' + c + ' vs ' + robe + ')');
}
set({ ink: '#123456' });
assert.equal(liches.bodyColor3For('hronal'), '#123456', 'a Workshop override still wins');
rules.set({ schema: rules.schema, rules: {} });

// Every named guardian's pants carry the woven pattern, not only the hammer wielder's.
for (const type of ['hronal', 'tothal', 'kanthic']) {
  const forced = liches.specialRoster(type).clothingPatterns.forcedOverpassBySlot;
  assert.ok(forced.overwear.pattern && forced.pants.pattern, type + ' robe and pants are both patterned');
  assert.equal(forced.pants.fallbackColorC.hex, liches.bodyColor3For(type), type + ' pants use Body Color 3 for the pattern');
}

// Wired into the Workshop: shared Pattern editor scripts and both editor entry points.
const preview = fs.readFileSync('docs/tools/enemy-loadout-editor/preview.js', 'utf8');
for (const file of ['pattern-authoring', 'pattern-library', 'repo-pattern-library', 'furniture-pattern-surfaces']) assert.match(preview, new RegExp(`js/${file}\\.js\\?v=`), file + ' loads in the Workshop');
const app = fs.readFileSync('docs/tools/enemy-loadout-editor/app.js', 'utf8');
assert.match(app, /openBossPatternEditor\(special, patternKind\)/);
assert.match(app, /PatternAuthoring\.openEditor/);
console.log('Boss patterns: rule validation, runtime lookup and Workshop wiring verified');
