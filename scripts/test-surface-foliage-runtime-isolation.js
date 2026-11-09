'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function makeRuntime(modern) {
  // Distinct constructors expose accidental reuse across the editor and game runtimes.
  class Group {
    constructor() { this.children = []; this.userData = {}; this.matrixWorld = { clone: () => ({ invert() { return this; } }) }; }
    add(child) { this.children.push(child); child.parent = this; }
    remove(child) { this.children = this.children.filter(value => value !== child); }
    traverse(visit) { visit(this); this.children.forEach(child => child.traverse(visit)); }
    updateWorldMatrix() {}
  }
  class Color {
    constructor(value) { this.value = value; this.isColor = true; }
    getHexString() { return String(this.value).replace('#', ''); }
  }
  class Texture { constructor(image) { this.image = image; this.userData = {}; this.uuid = 'texture'; } }
  class MeshBasicMaterial {
    constructor(options) { Object.assign(this, options); this.userData = {}; if (modern) this.onBeforeRender = () => {}; }
  }
  return { Group, Color, Vector3: class {}, CanvasTexture: Texture, Texture, MeshBasicMaterial, FrontSide: 0, ClampToEdgeWrapping: 1001, SRGBColorSpace: modern ? 'srgb' : undefined };
}

const gameThree = makeRuntime(false), editorThree = makeRuntime(true); // Simulate the callback introduced after the game's r128 build.
const windowMock = { THREE: gameThree }; // Authoritative globals must remain bound to the game throughout editor use.
const context = vm.createContext({
  window: windowMock, URL, console: { debug() {} }, Image: class {},
  document: {
    currentScript: { src: 'https://example.test/docs/js/natural-surface-materials.js' },
    createElement() { return { getContext: () => ({ fillRect() {} }) }; },
  },
});
for (const name of ['natural-surface-materials', 'foliage-generator']) {
  vm.runInContext(fs.readFileSync(`docs/js/${name}.js`, 'utf8'), context);
}
const originalFoliage = windowMock.FoliageGenerator, originalMaterials = windowMock.NaturalSurfaceMaterials; // Compare identities after creating editor instances.
context.document.currentScript = null; // Module-side calls happen after the classic script finished loading.
const editorFoliage = originalFoliage.forThree(editorThree), editorMaterials = originalMaterials.forThree(editorThree); // Exercise both real factories, including their caches.
assert.equal(originalFoliage.forThree(editorThree), editorFoliage);
assert.equal(originalFoliage.forThree(gameThree), originalFoliage);
assert.equal(originalMaterials.forThree(editorThree), editorMaterials);
assert.equal(originalMaterials.forThree(gameThree), originalMaterials);
for (const [runtime, foliage, materials] of [[gameThree, originalFoliage, originalMaterials], [editorThree, editorFoliage, editorMaterials]]) {
  const parent = new runtime.Group(); // Empty sources still verify which runtime owns generated groups and regeneration.
  foliage.applySurfaceGrowth(parent, [{ kind: 'roots' }, { kind: 'vines' }]);
  assert.equal(parent.children.length, 2);
  assert(parent.children.every(child => child instanceof runtime.Group));
  foliage.applySurfaceGrowth(parent, []);
  assert.equal(parent.children.length, 0);
  for (const surface of ['trunks', 'vines']) {
    const mesh = { isMesh: true, geometry: {}, userData: {}, material: { color: new runtime.Color('#123456') } }; // Strand UVs are already authored; production naturalization owns material creation.
    materials.naturalizeMesh(mesh, surface, 'strand-stretch', { texture: 'assets/textures/test.png', tint: '#123456', tintTreatment: 'body-sprite-tint' });
    assert(mesh.material instanceof runtime.MeshBasicMaterial);
    assert(mesh.material.map instanceof runtime.Texture);
    assert.equal(mesh.material.map.userData.hobunjiAuthoredSurfacePath, 'https://example.test/docs/assets/textures/test.png');
    if (runtime === editorThree) assert.equal(typeof mesh.material.onBeforeRender, 'function');
  }
}
const editorSource = fs.readFileSync('docs/tools/house-piece-author/index.html', 'utf8'); // Execute the actual editor call site to catch a missing runtime selection.
const rebuildSource = editorSource.match(/function rebuildHouseSurfaceFoliage\(\)\{[\s\S]*?\n\}/)?.[0]; // Only this event-driven editor function is needed for the integration check.
assert(rebuildSource);
const editorRoot = new editorThree.Group(); // Verify importing recipes attaches native groups through the real editor path.
vm.runInNewContext(rebuildSource + '\nrebuildHouseSurfaceFoliage();', {
  window: windowMock, THREE: editorThree, root: editorRoot, state: { piece: { surfaceGrowth: [{ kind: 'roots' }] } },
});
assert.equal(editorRoot.children.length, 1);
assert(editorRoot.children[0] instanceof editorThree.Group);
assert.match(editorSource, /foliage-generator\.js\?v=[A-Za-z0-9_-]+/, 'Returning editor users must receive the runtime-aware generator');
assert.equal(windowMock.THREE, gameThree);
assert.equal(windowMock.FoliageGenerator, originalFoliage);
assert.equal(windowMock.NaturalSurfaceMaterials, originalMaterials);
assert.equal(originalMaterials.snapshot().cachedMaterials, 2);
assert.equal(editorMaterials.snapshot().cachedMaterials, 2);
console.log('Surface growth runtime constructors, native material callbacks, separate caches, asset paths and game globals passed.');
