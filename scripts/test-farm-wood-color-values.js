'use strict';
const assert = require('node:assert/strict'); // Checks named palette values survive wood shader installation.
const fs = require('node:fs'); // Loads production modules without a browser.
const vm = require('node:vm'); // Exercises the real farm tint and compile callbacks.
class Color {
  constructor(hex) { this.isColor = true; this.hex = hex; }
  clone() { return new Color(this.hex); }
  copy(other) { this.hex = other.hex; return this; }
}
const context = { THREE: { Color }, console }; // Minimal Three color seam for shader compilation.
context.window = context;
vm.createContext(context);
for (const file of ['docs/config/farm-specializations.js', 'docs/js/surface-tint.js', 'docs/js/farm-world-settings.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}
function material() {
  return { map: {}, userData: {}, onBeforeCompile() {}, customProgramCacheKey() { return 'base'; }, clone: material };
}
function compile(value) {
  const shader = { uniforms: {}, fragmentShader: 'void main() {\n#include <map_fragment>\n}' }; // Real callback replaces Three's map chunk.
  value.onBeforeCompile(shader);
  return shader;
}
for (const [label, hex] of context.FARM_SPECIALIZATIONS_CONFIG.palettes.wood) {
  const source = material(); // Shared source must remain untouched by structure tinting.
  const mesh = { isMesh: true, userData: { farmMaterialRole: 'wood' }, material: source }; // Represents shingles and other wood surfaces.
  context.FarmWorldSettings.tintStructure({ traverse(fn) { fn(mesh); } }, { wood: hex });
  assert.notEqual(mesh.material, source);
  assert.deepEqual(source.userData, {});
  const shader = compile(mesh.material); // Verifies farm settings selects the bounded shader for every named wood finish.
  assert.equal(shader.uniforms.hobunjiSurfaceTint.value.hex, hex, label);
  assert.match(shader.fragmentShader, /min\(1\.0, 0\.7 \+ hobunjiLum \* 0\.8\)/);
  assert.match(mesh.material.customProgramCacheKey(), /bounded-value/);
  context.SurfaceTint.applyGrassLuminance(mesh.material, '#604632', true);
  assert.equal(compile(mesh.material).uniforms.hobunjiSurfaceTint.value.hex, '#604632');
}
const grass = material(); // Ordinary grass retains its existing shader and a separate program cache key.
context.SurfaceTint.applyGrassLuminance(grass, '#7d7355');
assert.doesNotMatch(compile(grass).fragmentShader, /min\(1\.0/);
assert.doesNotMatch(grass.customProgramCacheKey(), /bounded-value/);
console.log('Named farm wood values, material isolation, tint updates, and shader cache separation passed.');
