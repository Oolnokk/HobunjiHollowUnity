'use strict';
// Contract tests for the same flail assembly runtime used by the player, NPCs,
// and the Attack Animation Editor. Run: node scripts/test-weapon-sprite-assemblies.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/weapon-sprite-assemblies.js', 'utf8'); // Evaluated in a DOM shim to exercise the real asset-anchor helpers.
const registry = fs.readFileSync('docs/config/weapon-sprite-assemblies.js', 'utf8'); // Shared committed artist recipe, loaded before the reusable runtime.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Confirms that all gameplay tool planes acquire the same decorator.
const editor = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8'); // Confirms the standalone preview uses the same visual logic.
const html = fs.readFileSync('docs/index.html', 'utf8'); // Confirms the game loads the assembly before its main script.
const bandits = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8'); // Enemy timeline must drive its own flail state.
const grips = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8'); // Haft grip must not follow the swinging head.

new Function(source); // Compile check for syntax errors without executing browser-dependent code.
assert.match(html, /src="js\/weapon-sprite-assemblies\.js/);
assert.match(game, /HobunjiWeaponSpriteAssemblies\?\.decorate\(g, itemKey, def, \{ THREE, metalOptions:/);
assert.match(game, /HobunjiWeaponSpriteAssemblies\?\.setAction\(toolMeshMap\[activeTool\]/);
assert.match(game, /hachutuTorchFlail: \{ label: 'Hachutu Torch-Flail'/);
assert.match(game, /spriteLayers: shape\.spriteLayers/);
assert.match(editor, /hachutuTorchFlail: \{ label: 'Hachutu Torch-Flail/);
assert.match(editor, /HobunjiWeaponSpriteAssemblies\?\.tick\(dt\)/);
assert.match(bandits, /HobunjiWeaponSpriteAssemblies\?\.setAction\(holder\.children\?\.\[0\]/);
assert.match(grips, /hachututorchflail: \{/);
assert(game.includes('windupFrac: WF, strikeFrac: SF, holdFrac:'), 'the player passes its live swing boundaries');
assert(game.includes('(swingStrikePitch - swingWindupPitch) * combatSwingPower'), 'the player applies the same pitch-power multiplier as its sampled pose');
assert(bandits.includes('(strikePitch - windupPitch) * power'), 'NPC partial-charge pose scaling also affects flail follow-through');
assert(bandits.includes('windupFrac: wf, strikeFrac: sf, holdFrac: hf'), 'NPCs pass their own live swing boundaries');
assert(editor.includes('windupFrac: anim.windupFrac, strikeFrac: anim.strikeFrac, holdFrac: anim.holdFrac'), 'editor preview passes authored stage timing');
assert(editor.includes("pitchTravelDeg: (Number(anim.poses?.strike?.pitch)"), 'editor passes strike-minus-windup pitch');
assert(source.includes('const shaftUp = q.shaftUp.set(0, 1, 0).applyQuaternion(baseQ)'), 'flails track the actual held tool instead of an artificial attack-up vector');
assert(source.includes('state.direction.copy(shaftUp).applyQuaternion'), 'hold follow-through rotates beyond the exact shaft heading');

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
vm.runInNewContext(registry, { window }); // The source of truth now comes from the shared editor + gameplay configuration.
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
assert.deepEqual(Array.from(api.definitionFor('hachutuTorchFlail', {}).flail.head.layers, part => part.id), ['back','handle','fuel','front']);
assert.equal(api.definitionFor('hachutuTorchFlail', {}).flail.chain.material, 'metal');
assert.equal(api.definitionFor('hachutuTorchFlail', {}).flail.chain.scaleX, 1);
assert.equal(api.definitionFor('hachutuTorchFlail', {}).flail.chain.scaleY, 0.35);
assert.equal(api.definitionFor('hachutuTorchFlail', {}).flail.head.scale, 2.5);
assert.equal(api.definitionFor('grappleFlail', {}).flail.chain.scaleX, 5.25);
assert.equal(api.definitionFor('grappleFlail', {}).flail.chain.scaleY, 5.25);
assert.equal(api.definitionFor('hachutuTorchFlail', {}).flail.head.layers[2].vfx.type, 'fire');
assert.equal(api.definitionFor('hachutuTorchFlail', {}).flail.head.layers[2].targetHex.toUpperCase(), '#E7DDC9');
assert.match(source, /enchantmentTargets/, 'the assembly exposes head-only enchantment masks');
assert.match(html, /js\/weapon-layer-effects\.js/, 'the shared effects implementation loads in gameplay');
assert.match(editor, /js\/weapon-layer-effects\.js/, 'the Attack Editor uses the same interleaved effects');
assert.match(fs.readFileSync('docs/tools/index.html', 'utf8'), /multi-sprite-weapon-editor/, 'the Tool Hub contains the new two-tab author');
assert.match(fs.readFileSync('docs/tools/multi-sprite-weapon-editor/index.html', 'utf8'), /1\. Flails[\s\S]*2\. Multi-layer Parts/, 'both requested tabs exist');
assert.equal(api.definitionFor('unknown', {}), null);
assert.equal(scheduler.id, 'weapon-sprite-assemblies');
assert.equal(scheduler.options.phase, 'pre-render');
const straighten = api.flailWindupStraightening; // Windup straightening is progress-based, continuous, and reaches exact shaft alignment early.
assert.equal(straighten(0, 0.16), 0, 'windup begins at the original hanging direction');
assert(straighten(0.04, 0.16) > 0 && straighten(0.04, 0.16) < straighten(0.08, 0.16), 'chain progressively straightens instead of snapping');
assert(straighten(0.12, 0.16) < 1, 'approach remains smooth just before the 80% windup threshold');
assert.equal(straighten(0.128, 0.16), 1, 'chain reaches exact shaft alignment by 80% of the windup');
assert.equal(straighten(0.16, 0.16), 1, 'the windup-to-strike lerp begins with an exactly straight chain');
const follow = api.flailPitchOvershoot; // Pure animation phase math shared by player, NPC and standalone editor.
const sf = 0.55, hf = 0.72, forward = Math.PI / 2, reverse = -Math.PI / 2;
assert.equal(follow(0.20, sf, hf, forward), 0, 'the chain stays straight during windup-to-strike pitch follow');
assert.equal(follow(sf, sf, hf, forward), 0, 'hold begins with zero discontinuity from straight shaft alignment');
assert(follow(0.60, sf, hf, forward) > 0, 'hold continues in the same positive pitch direction');
assert(follow(0.65, sf, hf, forward) > follow(0.60, sf, hf, forward), 'hold continues rotating after the tool stops');
assert(follow(hf, sf, hf, forward) > follow(0.65, sf, hf, forward), 'maximum follow-through is reached by the hold endpoint');
assert.equal(follow(hf, sf, hf, forward), -follow(hf, sf, hf, reverse), 'a negative pitch lerp reverses the chain follow-through');
assert.equal(follow(1, sf, hf, forward), 0, 'return eases the chain back onto its handle');
assert.equal(follow(0.65, sf, hf, 0), 0, 'a static pitch creates no artificial follow-through');
assert.equal(follow(0.75, 0.6, 0.6, forward), 0, 'a zero-duration hold never introduces a one-frame overshoot');
assert(Math.abs(follow(hf, sf, hf, 10)) <= Math.PI / 3, 'extreme pitch does not exceed a 60 degree overshoot');
assert.equal(follow(hf, sf, hf, NaN), 0, 'invalid pitch is safely ignored');
assert.deepEqual(Array.from(api.debugSnapshot()), []); // No active weapon instances on a new page.
console.log('weapon sprite assemblies: PASS (registry, alpha anchors, layers, editor, player, hostiles, scheduler)');
