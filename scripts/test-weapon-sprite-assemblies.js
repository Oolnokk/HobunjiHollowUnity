'use strict';
// Contract tests for the same flail assembly runtime used by the player, NPCs,
// and the Attack Animation Editor. Run: node scripts/test-weapon-sprite-assemblies.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/weapon-sprite-assemblies.js', 'utf8'); // Evaluated in a DOM shim to exercise the real asset-anchor helpers.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Confirms that all gameplay tool planes acquire the same decorator.
const editor = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8'); // Confirms the standalone preview uses the same visual logic.
const html = fs.readFileSync('docs/index.html', 'utf8'); // Confirms the game loads the assembly before its main script.
const bandits = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8'); // Enemy timeline must drive its own flail state.
const grips = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8'); // Haft grip must not follow the swinging head.

new Function(source); // Compile check for syntax errors without executing browser-dependent code.
assert.match(html, /src="js\/weapon-sprite-assemblies\.js/);
assert.match(game, /HobunjiWeaponSpriteAssemblies\?\.decorate\(g, itemKey, def, \{ THREE \}\)/);
assert.match(game, /HobunjiWeaponSpriteAssemblies\?\.setAction\(toolMeshMap\[activeTool\]/);
assert.match(game, /hachutuTorchFlail: \{ label: 'Hachutu Torch-Flail'/);
assert.match(game, /spriteLayers: shape\.spriteLayers/);
assert.match(editor, /hachutuTorchFlail: \{ label: 'Hachutu Torch-Flail/);
assert.match(editor, /HobunjiWeaponSpriteAssemblies\?\.tick\(dt\)/);
assert.match(bandits, /HobunjiWeaponSpriteAssemblies\?\.setAction\(holder\.children\?\.\[0\]/);
assert.match(grips, /hachututorchflail: \{/);

const pixels = new Uint8ClampedArray(6 * 6 * 4); // Synthetic transparent PNG alpha data with two top and two bottom edge pixels.
for (const [x, y] of [[1, 1], [3, 1], [2, 2], [4, 3], [3, 4], [5, 4]]) {
  pixels[(y * 6 + x) * 4 + 3] = 255;
}
let imageDrawn = null; // The fake canvas stores the last requested image to exercise its alpha scan.
const document = {
  currentScript: { src: 'https://example.test/js/weapon-sprite-assemblies.js' },
  createElement: type => {
    assert.equal(type, 'canvas');
    return {
      getContext: () => ({
        drawImage(image) { imageDrawn = image; },
        getImageData() { return { data: imageDrawn.pixels }; },
      }),
    };
  },
};
const scheduler = { register(id, callback, options) { this.id = id; this.callback = callback; this.options = options; } }; // Records the real module's pre-render registration.
const window = { RuntimeFrameScheduler: scheduler }; // Minimal host, no gameplay side effects.
vm.runInNewContext(source, {
  window, document, URL, setTimeout: () => {}, performance: { now: () => 100 },
  location: { href: 'https://example.test/game.html', pathname: '/game.html' },
});
const api = window.HobunjiWeaponSpriteAssemblies; // Public debug and authoring API.
assert.ok(api);
const image = { width: 6, height: 6, pixels }; // Scanned image with a deliberately sparse alpha silhouette.
const first = api.opaqueAt(image, 'top'); // Highest nontransparent row, horizontal center of the opaque pixels.
const last = api.opaqueAt(image, 'bottom'); // Lowest nontransparent row, horizontal center of the opaque pixels.
assert.equal(first.x, 2); assert.equal(first.y, 1);
assert.equal(last.x, 4); assert.equal(last.y, 4);
assert.equal(api.anchor(image, { x: 5, y: 2 }, 'top').x, 5); // Explicit artist coordinates override edge detection.
assert.equal(api.anchor(image, { x: -100, y: 99 }, 'top').y, 5); // Out-of-bounds authored anchors clamp safely.
assert.equal(api.definitionFor('plain', { spriteLayers: [{ sprite: 'assets/toolsprites/example.png' }] }).layers.length, 1);
assert.equal(api.definitionFor('hachutuTorchFlail', {}).flail.head.layers.length, 4);
assert.equal(api.definitionFor('unknown', {}).flail, undefined);
assert.equal(scheduler.id, 'weapon-sprite-assemblies');
assert.equal(scheduler.options.phase, 'pre-render');
assert.deepEqual(Array.from(api.debugSnapshot()), []); // No active weapon instances on a new page.
console.log('weapon sprite assemblies: PASS (registry, alpha anchors, layers, editor, player, hostiles, scheduler)');
