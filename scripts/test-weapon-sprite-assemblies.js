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
assert.match(editor, /HobunjiWeaponSpriteAssemblies\?\.tick\(sampleDt\)/);
assert.match(bandits, /HobunjiWeaponSpriteAssemblies\?\.setAction\(holder\.children\?\.\[0\]/);
assert.match(grips, /hachututorchflail: \{/);
assert(game.includes('windupFrac: WF, strikeFrac: SF, holdFrac:'), 'the player passes its live swing boundaries');
assert(game.includes('movementPosition: playerMesh.position'), 'player flail uses game locomotion, not shaft-animation travel');
assert(bandits.includes('movementPosition: c.avatarRef?.group?.position'), 'NPC flail uses actual character locomotion');
assert(editor.includes('movementPosition: rig.position'), 'editor preview uses actor position, not hand offsets');
assert(source.includes('state.progress <= state.wf'), 'all of neutral-to-windup uses a gravity-and-locomotion target');
assert(source.includes('state.strikeStartDirection.copy(state.direction)'), 'transition starts from the real hanging-chain orientation');
assert(!source.includes('windupStartDirection'), 'windup cannot drag the connector toward the shaft');
assert(game.includes('(swingStrikePitch - swingWindupPitch) * combatSwingPower'), 'the player applies the same pitch-power multiplier as its sampled pose');
assert(bandits.includes('(strikePitch - windupPitch) * power'), 'NPC partial-charge pose scaling also affects flail follow-through');
assert(bandits.includes('windupFrac: wf, strikeFrac: sf, holdFrac: hf'), 'NPCs pass their own live swing boundaries');
assert(editor.includes('windupFrac: anim.windupFrac, strikeFrac: anim.strikeFrac, holdFrac: anim.holdFrac'), 'editor preview passes authored stage timing');
assert(editor.includes("pitchTravelDeg: (Number(anim.poses?.strike?.pitch)"), 'editor passes strike-minus-windup pitch');
assert(source.includes('const shaftUp = q.shaftUp.set(0, -1, 0).applyQuaternion(baseQ)'), 'flails extend outward from the bottom-end haft attachment, away from the grip');
assert(source.includes('stepPendulum(state, q.pivotAcceleration, state.physicsLength, dt, 9.81, flailDamping(motion))'), 'live assemblies integrate the same physical pendulum in Hold and Recovery');

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
assert.equal(api.definitionFor('hachutuTorchFlail', {}).flail.chain.scaleX, 0.35);
assert.equal(api.definitionFor('hachutuTorchFlail', {}).flail.chain.scaleY, 0.25);
assert.equal(api.definitionFor('hachutuTorchFlail', {}).flail.head.scale, 2.5);
assert.equal(api.definitionFor('grappleFlail', {}).flail.chain.scaleX, 5.25);
assert.equal(api.definitionFor('grappleFlail', {}).flail.chain.scaleY, 3.75);
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
const straighten = api.flailStrikeStraightening; // Neutral→Windup remains gravity-only; straightening starts only during Windup→Strike.
assert.equal(straighten(0, 0.16, 0.55), 0, 'neutral begins with a hanging chain');
assert.equal(straighten(0.08, 0.16, 0.55), 0, 'mid-windup does not rotate the chain toward the handle');
assert.equal(straighten(0.128, 0.16, 0.55), 0, 'the old 80%-of-windup snap no longer occurs');
assert.equal(straighten(0.16, 0.16, 0.55), 0, 'at the end of windup the chain is still hanging down');
assert(straighten(0.20, 0.16, 0.55) > 0 && straighten(0.20, 0.16, 0.55) < straighten(0.24, 0.16, 0.55), 'early strike begins smooth straightening');
assert.equal(straighten(0.30, 0.16, 0.55), 1, 'alignment completes early in windup-to-strike');
assert.equal(straighten(0.55, 0.16, 0.55), 1, 'connector stays collinear through strike');
assert.equal(straighten(0.55, 0.16, 0.16), 1, 'zero-length strike still reaches shaft alignment');
assert.equal(api.flailDamping(), 8, 'old recipes receive the stronger default drag');
assert.equal(api.flailDamping({angularDamping:0}), 0, 'explicit zero damping remains valid');
assert.equal(api.flailDamping({angularDamping:100}), 30, 'extreme drag is safely bounded');
assert.equal(api.flailDamping({angularDamping:NaN}), 8, 'invalid drag uses the default');
const pendulum = api.stepPendulum; // Execute the shared solver against analytic momentum, torque and energy expectations.
const still = { x: 0, y: 0, z: 0 }; // Stationary pivot for isolated pendulum tests.
function body(angle = 0, speed = 0) {
  return { direction: { x: Math.sin(angle), y: -Math.cos(angle), z: 0 }, angularVelocity: { x: 0, y: 0, z: speed } };
}
function simulate(value, length, seconds, fps = 60, gravity = 9.81, damping = 0) {
  for (let frame = 0; frame < Math.round(seconds * fps); frame++) pendulum(value, still, length, 1 / fps, gravity, damping);
  return value;
}
const free = simulate(body(0, 8), 1, 0.5, 60, 0); // With no gravity or damping, rotation follows omega * time with no 60-degree ceiling.
assert(Math.abs(free.direction.x - Math.sin(4)) < 1e-10);
assert(Math.abs(free.direction.y + Math.cos(4)) < 1e-10);
assert.equal(free.angularVelocity.z, 8, 'free angular momentum remains constant');
const faster = simulate(body(0, 16), 1, 0.1, 60, 0); // A twice-faster release travels twice as far in the same time.
assert(Math.abs(faster.direction.x - Math.sin(1.6)) < 1e-10);
const reverse = simulate(body(0, -8), 1, 0.5, 60, 0); // Mirrored attacks produce mirrored physical motion.
assert(Math.abs(reverse.direction.x + free.direction.x) < 1e-10);
const resting = simulate(body(), 1, 2); // Hanging motionless is a stable equilibrium.
assert.deepEqual(resting, body());
const short = body(0.4), long = body(0.4); // Torque/inertia produces acceleration proportional to 1 / lever length.
pendulum(short, still, 1, 1 / 240, 9.81, 0);
pendulum(long, still, 2, 1 / 240, 9.81, 0);
assert(Math.abs(short.angularVelocity.z / long.angularVelocity.z - 2) < 0.0001);
assert(short.angularVelocity.z < 0, 'gravity pulls a displaced head back toward vertical');
const accelerated = body(); // A moving handle transfers momentum even when the connector starts vertical.
pendulum(accelerated, { x: 12, y: 0, z: 0 }, 1, 1 / 240, 0, 0);
assert(accelerated.angularVelocity.z < 0, 'head trails positive pivot acceleration');
const spatial = body(); // Simultaneous axes remain independent; there is no dominant pitch/yaw selection.
spatial.angularVelocity.x = 3; spatial.angularVelocity.z = 4;
simulate(spatial, 1, 0.5, 60, 0);
assert(Math.abs(Math.hypot(spatial.direction.x, spatial.direction.y, spatial.direction.z) - 1) < 1e-10);
assert(Math.abs(spatial.direction.z) > 0.01);
const energyStart = body(0.6), energyEnd = simulate(body(0.6), 1.4, 10); // The undamped integrator approximately conserves mechanical energy over many swings.
const energy = value => 0.5 * 1.4 ** 2 * value.angularVelocity.z ** 2 + 9.81 * 1.4 * (1 + value.direction.y);
assert(Math.abs(energy(energyEnd) - energy(energyStart)) / energy(energyStart) < 0.001);
const lowFps = simulate(body(0.4, 2), 1, 1, 30), highFps = simulate(body(0.4, 2), 1, 1, 120); // Fixed internal substeps keep render-rate results consistent.
assert(Math.abs(lowFps.direction.x - highFps.direction.x) < 1e-10);
const frozen = body(0.3, 4), frozenBefore = JSON.stringify(frozen); // Paused editor draws do not advance physical time.
pendulum(frozen, still, 1, 0);
assert.equal(JSON.stringify(frozen), frozenBefore);
for (const length of [0, -1, NaN, Infinity]) pendulum(frozen, still, length, 0.01); // Invalid geometry cannot corrupt the simulation.
assert.equal(JSON.stringify(frozen), frozenBefore);
const damped = simulate(body(0, 8), 1, 1, 60, 0, 0.12); // Damping uses seconds rather than render frames.
assert(Math.abs(damped.angularVelocity.z - 8 * Math.exp(-0.12)) < 1e-10);
vm.runInNewContext(fs.readFileSync('docs/js/combat/shared-attack-pose.js', 'utf8'), { window });
for (const progress of [0.60, 0.65, 0.72]) assert.equal(window.SharedAttackPose.fourPhaseLerp(progress, 0.16, 0.55, 0.72, -20, 20), 20, 'strike pose stays fixed while momentum is integrated');
assert.deepEqual(Array.from(api.debugSnapshot()), []); // No active weapon instances on a new page.
console.log('weapon sprite assemblies: PASS (windup gravity and locomotion, early strike alignment, hold follow-through, editor/player/NPC, scheduler)');
