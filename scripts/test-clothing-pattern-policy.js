// Executes the generic (any enemy) clothing-pattern path: rule validation/resolution, the shared render policy (per-piece scale,
// raw-size outline, body-scale pre-compensation) and the weaving renderer's outline math.
// Run with: node scripts/test-clothing-pattern-policy.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 1, end = open + 1;
  while (depth && end < source.length) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
  return source.slice(start, end);
}

// ── Rules: schema + roster resolution for an ordinary enemy kind ───────────────────────────────────────────────────────────────────────
const window = { PatternLibrary: { getById: (id) => (id === 'lib:glyph' ? { repoPatternId: 'glyph', motifScale: 2 } : null) }, SCRATCHBONES_CONFIG: { game: { dyes: { catalog: [{ id: 'dye:CLOTH:pure_orange', hex: '#ff8000' }] } } } };
vm.runInNewContext(fs.readFileSync('docs/js/combat/enemy-loadout-rules.js', 'utf8'), {
  window, console, URL, document: { currentScript: { src: 'https://game.test/docs/js/combat/enemy-loadout-rules.js' }, baseURI: 'https://game.test/docs/' },
  fetch: async () => ({ ok: true, json: async () => ({ schema: 'hobunji_enemy_loadouts.v1', rules: {} }) }),
});
const rules = window.EnemyLoadoutRules;
const set = (clothingPatterns) => rules.set({ schema: rules.schema, rules: { ghoul: { clothingPatterns } } });
assert.deepEqual([...rules.patternSlots], ['overwear', 'pants', 'torso', 'hat', 'hood', 'mask']);
set({ overwear: { patternLibraryId: 'lib:glyph', scale: 1.05, color: '#112233' }, pants: { pattern: { custom: true }, scale: 4, roles: ['DRAPE'], baseUsesPatternColor: true, color: 'dye:CLOTH:pure_orange' } });
assert.throws(() => set({ cape: { pattern: {} } }), /not a patternable clothing slot/);
assert.throws(() => set({ overwear: {} }), /needs a pattern, a library id or a slot to inherit from/);
assert.throws(() => set({ overwear: { pattern: {}, scale: 0 } }), /scale must be 0\.1-20/);
assert.throws(() => set({ overwear: { pattern: {}, scale: 99 } }), /scale must be 0\.1-20/);
assert.throws(() => set({ overwear: { pattern: {}, color: 'red' } }), /color needs/);
assert.throws(() => set({ pants: { pattern: {}, roles: ['bad role!'] } }), /roles must list/);
assert.throws(() => set({ pants: { pattern: {}, extra: 1 } }), /extra is unknown/);
set({ overwear: { patternLibraryId: 'lib:glyph', scale: 1.05, color: '#112233' }, pants: { pattern: { custom: true }, scale: 4, roles: ['DRAPE'], baseUsesPatternColor: true, color: 'dye:CLOTH:pure_orange' }, hat: { patternLibraryId: 'lib:missing' } });
const roster = rules.applyRoster('ghoul', { appearance: {} }, Math.random);
const forced = roster.clothingPatterns.forcedOverpassBySlot;
assert.equal(forced.overwear.pattern.repoPatternId, 'glyph', 'a library id resolves at spawn');
assert.equal(forced.overwear.scale, 1.05);
assert.equal(forced.overwear.fallbackColorC.hex, '#112233');
assert.equal(forced.pants.fallbackColorC.hex, '#ff8000', 'a dye id resolves to its hex');
assert.deepEqual([...forced.pants.roles], ['DRAPE']);
assert.equal(forced.pants.baseUsesPatternColor, true);
assert.equal(forced.hat, undefined, 'an unresolved library id leaves the garment alone');
// A built-in policy (the named liches') is merged over, not replaced.
const merged = rules.applyRoster('ghoul', { appearance: {}, clothingPatterns: { forcedOverpassBySlot: { overwear: { pattern: { builtin: true }, scale: 9, roles: ['X'] } } } }, Math.random).clothingPatterns.forcedOverpassBySlot.overwear;
assert.equal(merged.pattern.repoPatternId, 'glyph');
assert.equal(merged.scale, 1.05, 'the authored rule wins');
assert.deepEqual([...merged.roles], ['X'], 'built-in fields the rule leaves out survive');

// ── Inherit pattern & framing from another slot ───────────────────────────────────────────────────────────────────────────────────────
const inherit = (clothingPatterns) => rules.set({ schema: rules.schema, rules: { ghoul: { clothingPatterns } } });
assert.throws(() => inherit({ hood: { inheritFrom: 'hood' } }), /inheritFrom must be another patternable slot/);
assert.throws(() => inherit({ hood: { inheritFrom: 'cape' } }), /inheritFrom must be another patternable slot/);
assert.throws(() => inherit({ hood: {} }), /needs a pattern, a library id or a slot to inherit from/);
inherit({ overwear: { pattern: { frameShape: 'triangle', frameScale: 0.5, frameRotationDeg: 77 }, color: '#112233' }, hood: { inheritFrom: 'overwear', scale: 1.05, roles: ['base'] } });
const shared = rules.applyRoster('ghoul', { appearance: {} }, Math.random).clothingPatterns.forcedOverpassBySlot;
assert.deepEqual(JSON.parse(JSON.stringify(shared.hood.pattern)), JSON.parse(JSON.stringify(shared.overwear.pattern)), 'an inheriting slot shares the exact pattern and framing');
assert.equal(shared.hood.fallbackColorC.hex, '#112233', 'and its color unless it sets its own');
assert.equal(shared.hood.scale, 1.05); assert.deepEqual([...shared.hood.roles], ['base'], 'its own size and role scope still apply');
inherit({ overwear: { pattern: { frameScale: 0.5 }, color: '#112233' }, hood: { inheritFrom: 'overwear', color: '#445566' } });
assert.equal(rules.applyRoster('ghoul', { appearance: {} }, Math.random).clothingPatterns.forcedOverpassBySlot.hood.fallbackColorC.hex, '#445566', 'an inheriting slot may recolor');
inherit({ hood: { inheritFrom: 'overwear' } });
assert.equal(rules.applyRoster('ghoul', { appearance: {} }, Math.random).clothingPatterns?.forcedOverpassBySlot?.hood, undefined, 'inheriting from a slot with no pattern does nothing');
// A built-in policy's pattern (e.g. a bandit rank's overwear) can be inherited by a rule-authored slot.
inherit({ hood: { inheritFrom: 'overwear' } });
const builtIn = rules.applyRoster('ghoul', { appearance: {}, clothingPatterns: { forcedOverpassBySlot: { overwear: { pattern: { builtin: 1 }, fallbackColorC: { hex: '#abcdef' }, scale: 2 } } } }, Math.random).clothingPatterns.forcedOverpassBySlot;
assert.equal(builtIn.hood.pattern.builtin, 1); assert.equal(builtIn.hood.fallbackColorC.hex, '#abcdef'); assert.equal(builtIn.hood.scale, 2, 'it takes the source scale unless it has its own');

// ── Body-scale multipliers on top of the species scale ────────────────────────────────────────────────────────────────────────────────
const multiplier = (value) => rules.set({ schema: rules.schema, rules: { 'bandit:captain': { rigScaleMultiplier: value } } });
assert.throws(() => multiplier({ z: 1 }), /unknown field z/);
assert.throws(() => multiplier({ x: 0.01 }), /between 0\.1 and 4/);
assert.throws(() => multiplier({ y: 9 }), /between 0\.1 and 4/);
assert.throws(() => multiplier({ x: 'wide' }), /between 0\.1 and 4/);
multiplier({ x: 1.15, y: 1.15 });
assert.deepEqual({ ...rules.rigScaleMultiplierFor('bandit:captain') }, { x: 1.15, y: 1.15 });
assert.equal(rules.rigScaleMultiplierFor('bandit:grunt'), null, 'unruled enemies have no multiplier');
assert.equal(rules.rigScaleFor('bandit:captain'), null, 'a multiplier is not an absolute override');
const banditSource = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
const scaleContext = vm.createContext({});
vm.runInContext(extract(banditSource, 'applyRigScaleMultiplier') + 'this.mul = applyRigScaleMultiplier;', scaleContext);
const scaled = scaleContext.mul({ x: 0.9, y: 1, head: 0.8, offsetY: 0.02 }, { x: 1.15, y: 1.15 });
assert.deepEqual([scaled.x, scaled.y, scaled.head, scaled.offsetY].map(v => +v.toFixed(4)), [1.035, 1.15, 0.8, 0.02], 'multipliers apply on top of the species scale; untouched fields keep their value');
assert.deepEqual({ ...scaleContext.mul({}, { y: 1.1 }) }, { x: 1, y: 1.1, head: 1 }, 'a missing species scale counts as 1');
assert.equal(scaleContext.mul({ x: 2 }, null).x, 2);
assert.match(banditSource, /rigScaleMultiplierFor\?\.\(loadoutKind\)/, 'the enemy builder applies the multiplier');
const shipped = JSON.parse(fs.readFileSync('docs/config/combat/enemy-loadouts.json', 'utf8')).rules;
assert.deepEqual({ ...shipped['bandit:lieutenant'].rigScaleMultiplier }, { x: 1.05, y: 1.05 }, 'lieutenants: 5% wider and taller');
assert.deepEqual({ ...shipped['bandit:flasker'].rigScaleMultiplier }, { y: 1.1 }, 'flaskers: 10% taller');
assert.deepEqual({ ...shipped['bandit:captain'].rigScaleMultiplier }, { x: 1.15, y: 1.15 }, 'captains: 15% wider and taller');
assert.equal(shipped['bandit:grunt'], undefined, 'grunts keep the species scale');
rules.set({ schema: rules.schema, rules: shipped }); // The shipped file validates.

// ── Render policy: per-piece scale, raw-size outline, body-scale compensation ──────────────────────────────────────────────────────────
const wardrobe = fs.readFileSync('docs/js/npc-wardrobe.js', 'utf8');
const context = vm.createContext({ clone: (value) => JSON.parse(JSON.stringify(value)) });
vm.runInContext(wardrobe.slice(wardrobe.indexOf('  const HEAD_PATTERN_SLOTS'), wardrobe.indexOf('  function forcedPatternForRender(')) + extract(wardrobe, 'forcedPatternForRender'), context);
const policy = context.forcedPatternForRender;
const rec = { patternBodyScale: { x: 2, y: 1.6, head: 0.5 } };
const body = policy(rec, 'overwear', { pattern: { id: 'p' }, scale: 1.05 });
assert.equal(body.usageScaleMultiplier, 1.05, 'the piece keeps its own size multiplier');
assert.equal(body.outlineReferenceShortSide, 173, 'raw-size outline math is opted in');
assert.equal(body.usageStretchX, 0.5);
assert.equal(body.usageStretchY, 1 / 1.6, 'body clothing is pre-shrunk by the inverse body scale per axis');
const head = policy(rec, 'hood', { pattern: { id: 'p' } });
assert.equal(head.usageStretchX, 2); assert.equal(head.usageStretchY, 2); assert.equal(head.usageScaleMultiplier, undefined, 'head pieces follow Head scale instead');
const noBody = policy({}, 'pants', { pattern: { id: 'p' }, scale: 4 });
assert.equal(noBody.usageStretchX, undefined, 'no known body scale, no compensation');
assert.equal(noBody.usageScaleMultiplier, 4);
assert.equal(policy(rec, 'pants', {}), null);

// ── Weaving renderer: outline math ────────────────────────────────────────────────────────────────────────────────────────────────────
const weaving = fs.readFileSync('docs/js/clothing-weaving-system.js', 'utf8');
const w = vm.createContext({ Math, Number });
vm.runInContext(`const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, Number(value) || 0)); const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const ANIMAL_PATTERN_OUTLINE_REFERENCE_WIDTH = 6, ANIMAL_PATTERN_OUTLINE_REFERENCE_SHORT_SIDE = 2250, ANIMAL_PATTERN_OUTLINE_PER_SHORT_SIDE_PX = 6 / 2250;` + extract(weaving, 'scaledOutlineWidth'), w);
const outline = w.scaledOutlineWidth;
assert.equal(outline(1, {}, 'woven-motif', 500, 500), 1, 'ordinary clothing keeps its fixed width');
assert.equal(outline(1, { outlineReferenceShortSide: 173 }, 'woven-motif', 234, 173), 1, 'a standard garment sprite is the reference');
assert.ok(Math.abs(outline(1, { outlineReferenceShortSide: 173 }, 'woven-motif', 500, 500) - 500 / 173) < 1e-9, '500px pants keep the same apparent line weight');
assert.ok(Math.abs(outline(1, { outlineReferenceShortSide: 173 }, 'woven-motif', 519, 360) - 360 / 173) < 1e-9, 'the pants drape uses its own short side');
assert.ok(Math.abs(outline(1, { usageStretchX: 0.5, usageStretchY: 0.5 }, 'woven-motif', 234, 173) - 0.5) < 1e-9, 'the outline follows the body-scale pre-compensation');
assert.equal(outline(1, {}, 'animal-surface-pattern', 3000, 2250), 6, 'the animal path is unchanged');
assert.match(weaving, /meshScale \* stretchX \* \(patternDef\?\.usageFlipX/, 'the motif transform applies the per-axis stretch');
assert.match(weaving, /\/ \(meshScale \* Math\.min\(stretchX, stretchY\)\) \+ Math\.hypot\(cellW, cellH\)/, 'tiling reach covers the compensated lattice');

// ── Wiring ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const bandit = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
assert.match(bandit, /roster\.patternBodyScale = \{ x:/, 'the final body scale is known before the portrait is baked');
assert.match(bandit, /window\.NpcWardrobe\?\.forcedPatternForRender\?\.\(roster, 'pants', forced\)/, 'pants share the same policy owner');
assert.match(fs.readFileSync('docs/tools/enemy-loadout-editor/index.html', 'utf8'), /data-tab="patterns"/, 'the Workshop has its own Patterns tab');
assert.match(fs.readFileSync('docs/tools/enemy-loadout-editor/app.js', 'utf8'), /function renderClothingPatterns\(\)/);
console.log('Clothing pattern policy: rules, per-piece scale, raw-size outline and body-scale compensation verified');
