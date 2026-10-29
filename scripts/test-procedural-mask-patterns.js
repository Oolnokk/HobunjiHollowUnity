'use strict';
// Masks take woven patterns, generated per wearer: a random Hachutu glyph pattern whose frame is randomly rotated, scaled DOWN (to
// 25%) and slightly translated, plus an overpass randomized the same way, each in its own iridescent colour.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = p => fs.readFileSync(p, 'utf8');

(async () => {
  const mask = JSON.parse(read('docs/config/cosmetics/clothes/masks/hachutu_binding_mask_ii.json'));
  const index = JSON.parse(read('docs/config/patterns/index.json'));
  const cfg = mask.proceduralPatterns;
  assert.equal(cfg.layers, 2, 'primary + overpass');
  assert.equal(cfg.frameScaleMin, 0.25, 'scales down to 25%');
  assert.equal(cfg.frameScaleMax, 1, 'only ever downward');

  const files = new Map(index.patterns.map(p => [p.file, JSON.parse(read('docs/' + p.file))]));
  const win = { pixelDyeDefaultHex: (dye, seed, slot) => dye.defaultHexPool[seed.length % dye.defaultHexPool.length] };
  win.window = win;
  class FakeImage { set src(v) { this.naturalWidth = 230; this.naturalHeight = 230; setTimeout(() => this.onload?.(), 0); } }
  vm.runInNewContext(read('docs/js/procedural-mask-patterns.js'), {
    window: win, console, URL, Image: FakeImage, setTimeout,
    document: { currentScript: { src: 'https://game.test/docs/js/procedural-mask-patterns.js' }, baseURI: 'https://game.test/docs/' },
    fetch: async url => {
      const path = String(url).replace('https://game.test/docs/', '');
      const body = path === 'config/cosmetics/clothes/masks/hachutu_binding_mask_ii.json' ? mask : path === 'config/patterns/index.json' ? index : files.get(path);
      return body ? { ok: true, json: async () => body } : { ok: false, status: 404 };
    },
  });
  const api = win.ProceduralMaskPatterns;
  assert.equal(await api.ready, true, 'library loaded');
  assert.ok(api.enabled && api.library.length >= 1 && api.library.every(id => id.startsWith('hachutu_glyph')), 'only Hachutu glyph patterns: ' + api.library);

  const authored = files.get(index.patterns.find(p => p.id === 'hachutu_glyph_death').file).settings;
  const pool = new Set(cfg.inkColors.map(h => h.toLowerCase()));
  const seen = { rot: new Set(), scale: new Set(), ink: new Set() };
  for (let i = 0; i < 80; i++) {
    const weaving = api.weavingFor('wearer' + i, { eyeHex: '#8A2BFF' });
    assert.equal(weaving.patterns.length, 2, 'a primary and an overpass');
    const [a, b] = weaving.patterns;
    for (const layer of weaving.patterns) {
      assert.ok(layer.frameRotationDeg >= 0 && layer.frameRotationDeg <= 360, 'random rotation');
      const ratio = layer.frameScale / authored.frameScale;
      assert.ok(ratio >= 0.25 - 1e-3 && ratio <= 1 + 1e-3, 'frame scaled down to between 25% and 100%, got ' + ratio);
      assert.ok(Math.abs(layer.frameX) <= 0.08 * 230 + 1 && Math.abs(layer.frameY) <= 0.08 * 230 + 1, 'slight translation');
      assert.ok(pool.has(layer.inkColorHex.toLowerCase()), 'iridescent ink');
      assert.notEqual(layer.inkColorHex.toLowerCase(), '#8a2bff', 'never the eye colour');
      assert.match(layer.motifUrl, /motif_hachutu_glyph/, 'the glyph motif');
      assert.equal(layer.meshScale, authored.meshScale, 'the rest of the authored pattern is kept');
      seen.rot.add(Math.round(layer.frameRotationDeg / 30)); seen.scale.add(Math.round(ratio * 4)); seen.ink.add(layer.inkColorHex);
    }
    assert.notEqual(a.inkColorHex, b.inkColorHex, 'each layer has its own colour');
  }
  assert.ok(seen.rot.size >= 8 && seen.scale.size >= 3 && seen.ink.size >= 6, 'the randomization actually varies across wearers');
  assert.deepEqual(api.weavingFor('same'), api.weavingFor('same'), 'a wearer keeps its mask');
  assert.notDeepEqual(api.weavingFor('one'), api.weavingFor('two'), 'different wearers differ');
  assert.equal(api.descriptorFor('some_other_mask', 'x'), null, 'only the Hachutu mask declares procedural patterns');
  const descriptor = api.descriptorFor('hachutu_binding_mask_ii', 'seed');
  assert.equal(descriptor.slot, 'mask'); assert.equal(descriptor.baseCosmeticId, 'hachutu_binding_mask_ii');

  // Wiring in the real pipeline.
  const weaving = read('docs/js/clothing-weaving-system.js');
  assert.match(weaving, /const primaryInkHex = \/\^#\[0-9a-f\]\{6\}\$\/i\.test\(String\(active\[0\]\.pattern\.inkColorHex/, 'the primary pattern may carry its own ink colour');
  assert.match(weaving, /\\\|pixelDye\\\|false\\\|\[\^\|\]\*\$/, 'pixel-dye base partitions are found by the pattern lookup, the glowing eyes are not');
  assert.match(read('docs/js/npc-avatar-preview-utils.js'), /window\.ProceduralMaskPatterns\?\.enabled && profile\.mask\?\.id/, 'the profile builder attaches mask patterns');
  assert.match(read('docs/js/npc-avatar-preview-utils.js'), /npc\.maskPatterns !== false/, 'records can opt out');
  assert.match(read('docs/js/combat/combat-bandit.js'), /await window\.ProceduralMaskPatterns\?\.ready/, 'hostiles wait for the pattern library');
  assert.ok(read('docs/index.html').includes('js/procedural-mask-patterns.js'), 'the game loads it');
  const preview = read('docs/tools/enemy-loadout-editor/preview.js');
  assert.ok(preview.indexOf('js/procedural-mask-patterns.js') > 0, 'the Workshop loads it');
  assert.match(read('docs/tools/enemy-loadout-editor/app.js'), /Procedural mask patterns/, 'the Workshop can switch it off per enemy');

  // The opt-out validates and reaches the roster.
  const rules = {};
  vm.runInNewContext(read('docs/js/combat/enemy-loadout-rules.js'), { window: rules, console, URL, document: { currentScript: { src: 'https://game.test/docs/js/combat/enemy-loadout-rules.js' }, baseURI: 'https://game.test/docs/' }, fetch: async () => ({ ok: true, json: async () => ({ schema: 'hobunji_enemy_loadouts.v1', rules: {} }) }) });
  await rules.EnemyLoadoutRules.ready;
  assert.throws(() => rules.EnemyLoadoutRules.set({ schema: 'hobunji_enemy_loadouts.v1', rules: { 'maskbound:sentinel': { maskPatterns: 'no' } } }), /maskPatterns/);
  rules.EnemyLoadoutRules.set({ schema: 'hobunji_enemy_loadouts.v1', rules: { 'maskbound:sentinel': { maskPatterns: false } } });
  assert.equal(rules.EnemyLoadoutRules.applyRoster('maskbound:sentinel', { appearance: { speciesId: 'maskbound-guardian', gender: 'male' }, equippedCosmetics: [] }, Math.random, {}).maskPatterns, false);

  console.log('Procedural mask patterns: glyph frame rotation/downscale/translation, overpass, per-layer iridescent inks, deterministic per wearer, wired in game and Workshop');
})();
