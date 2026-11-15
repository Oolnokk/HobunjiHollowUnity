'use strict';
// Each named lich-heart must remain aligned with the Enemy Loadout Workshop's actual lich definitions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..'); // Resolve checked-in workshop config, motif PNGs, and furniture fixtures.
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8'); // Load the production definitions, never retype their colors.
const window = {}; // The two browser scripts attach their exported catalogs to this isolated object.
const context = vm.createContext({ window });
vm.runInContext(read('docs/config/scratchbones-config.js'), context, { filename:'scratchbones-config.js' });
const authoredRules = JSON.parse(read('docs/config/combat/enemy-loadouts.json')).rules; // Workshop overrides win over shipped defaults.
window.EnemyLoadoutRules = { ruleFor: kind => authoredRules[kind] || {} };
vm.runInContext(read('docs/js/combat/combat-special-liches.js'), context, { filename:'combat-special-liches.js' });
const workshop = window.SpecialHarlyaoLiches; // Single gameplay/Workshop authority for dye, ink, and glyph.
const dyes = window.SCRATCHBONES_CONFIG.game.dyes.catalog; // Real cloth hex swatches (not approximate RGB values).
const index = JSON.parse(read('docs/config/furniture-authored/index.json')).furniture; // Runtime furniture catalog registration.

const fixtures = [
  { key:'flamingLichHeart', name:'Flaming Lich-heart', type:'hronal', boss:'azgarlu' },
  { key:'unsleepingLichHeart', name:'Unsleeping Lich-heart', type:'tothal', boss:'nanahi' },
  { key:'sightlessLichHeart', name:'Sightless Lich-heart', type:'kanthic', boss:'imlao' },
]; // Test each named guardian independently, including the intended Imlao spelling.

for (const fixture of fixtures) {
  const record = JSON.parse(read('docs/config/furniture-authored/' + fixture.key + '.json'));
  const def = workshop.defFor(fixture.type); // Includes any Workshop bossAppearance overrides.
  const robe = dyes.find(entry => entry.id === def.dye)?.hex; // Primary garment color used by the named lich.
  const inverseInk = workshop.bodyColor3For(fixture.type); // Workshop Body C: wall/eye/motif color, inverse-robed by default.
  const motif = 'motif_' + def.glyph + '.png'; // Exactly the named glyph asset shared with the ruins.
  assert.ok(/^#[0-9a-f]{6}$/i.test(robe || ''), fixture.key + ' robe dye resolves');
  assert.ok(/^#[0-9a-f]{6}$/i.test(inverseInk || ''), fixture.key + ' inverse Body C resolves');
  assert.equal(def.id, fixture.boss, fixture.key + ' belongs to the correct named lich');
  assert.equal(record.schema, 'hobunji_furniture_authored_runtime.v1');
  assert.equal(record.key, fixture.key);
  assert.equal(record.name, fixture.name);
  assert.ok(index.some(entry => entry.key === fixture.key && entry.file === 'config/furniture-authored/' + fixture.key + '.json'), 'catalog includes ' + fixture.key);
  assert.equal(record.parts.length, 1);
  const part = record.parts[0]; // Transparent, camera-facing piece supports an existing recognized decal surface.
  assert.equal(part.kind, 'transparentBillboardSurface');
  assert.equal(part.surfaceOpacity, 0);
  assert.equal(part.transform.sx, .325, 'half-sized billboard width');
  assert.equal(part.transform.sy, .325, 'half-sized billboard height');
  assert.equal(record.recognizedSurfaces.length, 1);
  const surface = record.recognizedSurfaces[0]; // Surface ID must agree with the saved decal attachment.
  assert.equal(surface.partId, part.id);
  assert.equal(surface.area, .325 * .325, 'recognized billboard area reflects the smaller geometry');
  assert.equal(surface.bounds.minU, -.1625);
  assert.equal(surface.bounds.maxV, .1625);
  assert.equal(record.decals.length, 1);
  const decal = record.decals[0]; // The glyph's alpha PNG and emissive inverse color.
  assert.equal(decal.surfacePartId, part.id);
  assert.equal(decal.surfaceId, surface.id);
  assert.equal(decal.imageName, motif);
  assert.equal(decal.imageSource, '../../../docs/assets/patterns/' + motif);
  assert.ok(fs.existsSync(path.join(repoRoot, 'docs/assets/patterns', motif)), 'motif PNG actually exists: ' + motif);
  assert.equal(decal.glow, undefined, 'static glyph does not depend on puzzle glow state');
  assert.equal(decal.glyphInk?.enabled, true, 'standalone recolor is enabled');
  assert.equal(decal.glyphInk.color.toLowerCase(), inverseInk.toLowerCase(), fixture.key + ' standalone glyph ink matches Body C');
  assert.ok(decal.glyphInk.glowStrength > 0 && decal.glyphInk.glowRadius > 0, 'visible spread and glow');
  assert.equal(record.particleEmitters.length, 1);
  const glow = record.particleEmitters[0]; // One stationary, part-attached radial emitter; no particle motion or physical light.
  assert.equal(glow.type, 'glowingSphere');
  assert.equal(glow.attachedPartId, part.id);
  assert.equal(glow.rate, 0);
  assert.equal(glow.speed, 0);
  assert.equal(glow.colorA.toLowerCase(), robe.toLowerCase(), fixture.key + ' inner glow matches clothing');
  assert.equal(glow.colorB.toLowerCase(), robe.toLowerCase(), fixture.key + ' halo glow matches clothing');
}
console.log('PASS all three lich-heart furniture variants match Workshop dyes, Body C colors, and motif assets');
