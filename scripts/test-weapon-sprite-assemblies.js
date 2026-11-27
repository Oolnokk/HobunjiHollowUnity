'use strict';
// Contract tests for the same flail assembly runtime used by the player, NPCs,
// and the Attack Animation Editor. Run: node scripts/test-weapon-sprite-assemblies.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/weapon-sprite-assemblies.js', 'utf8'); // Evaluated in a DOM shim to exercise the real asset-anchor helpers.
const registry = fs.readFileSync('docs/config/weapon-sprite-assemblies.js', 'utf8'); // Shared committed artist recipe, loaded before the reusable runtime.
const sharedColorFill = fs.readFileSync('docs/js/color-fill.js', 'utf8'); // Same canonical shade-fill implementation used by Gar-wolf recoloring.
const game = fs.readFileSync('docs/game.js', 'utf8'); // Confirms that all gameplay tool planes acquire the same decorator.
const editor = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8'); // Confirms the standalone preview uses the same visual logic.
const html = fs.readFileSync('docs/index.html', 'utf8'); // Confirms the game loads the assembly before its main script.
const bandits = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8'); // Enemy timeline must drive its own flail state.
const grips = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8'); // Haft grip must not follow the swinging head.

new Function(source); // Compile check for syntax errors without executing browser-dependent code.
assert.match(html, /src="js\/weapon-sprite-assemblies\.js/);
assert.match(fs.readFileSync('docs/js/character-held-tools.js', 'utf8'), /HobunjiWeaponSpriteAssemblies\?\.decorate\(g, itemKey, def, \{ THREE: T, metalOptions,/); // Factory lives in js/character-held-tools.js for every holder.
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
assert(source.includes('updateOne(state, 0, performance.now())'), 'newly loaded flail rope is anchored before its first rendered frame');
assert.match(source, /if \(!state\.attacking\) \{[\s\S]*?stepPendulum\(state, q\.pivotAcceleration, state\.physicsLength, dt, 9\.81, flailDamping\(motion\)\)/, 'idle rope responds to real acceleration through the pendulum');
assert.match(source, /if \(dt > 0 && state\.attacking && !state\.fishingFlailHeadSpin && state\.progress < state\.sf\)/,
  'ordinary flail momentum is retained while a fishing-only head spin stays kinematic');
assert(source.includes('state.strikeStartDirection.copy(state.direction)'), 'transition starts from the real hanging-chain orientation');
assert(!source.includes('windupStartDirection'), 'windup cannot drag the connector toward the shaft');
assert(game.includes('(swingStrikePitch - swingWindupPitch) * combatSwingPower'), 'the player applies the same pitch-power multiplier as its sampled pose');
assert(bandits.includes('(strikePitch - windupPitch) * power'), 'NPC partial-charge pose scaling also affects flail follow-through');
assert(bandits.includes('windupFrac: wf, strikeFrac: sf, holdFrac: hf'), 'NPCs pass their own live swing boundaries');
assert(editor.includes('windupFrac: anim.windupFrac, strikeFrac: anim.strikeFrac, holdFrac: anim.holdFrac'), 'editor preview passes authored stage timing');
assert(editor.includes("pitchTravelDeg: (Number(anim.poses?.strike?.pitch)"), 'editor passes strike-minus-windup pitch');
assert(source.includes('const shaftUp = q.shaftUp.set(0, -1, 0).applyQuaternion(baseQ)'), 'flails extend outward from the bottom-end haft attachment, away from the grip');
assert(source.includes('fishingFlailHeadDirection(state.direction, shaftUp, normal, state.progress, state.fishingFlailSpinRevolutions, q.deltaQ)'),
  'fishing flail head orbits the haft attachment with no handle rotation or detachment');
assert(source.includes('return out.copy(shaftUp).applyQuaternion(workQ).normalize()'),
  'the head orbit preserves connector length using the shared world-space contact solver');
assert(source.includes('placeFlexiblePartWorld(state.chain'), 'head spin reuses the standard rope contact solver');
assert(game.includes("fishingFlailHeadSpin: activeTool === 'harpoon'"), 'player fishing routes the head-only spin to the shared flail runtime');
assert(game.includes('heldSpin: opts.heldSpin === true'), 'existing ordinary spinning throw still uses the authored weapon spin');

assert(source.includes('stepPendulum(state, q.pivotAcceleration, state.physicsLength, dt, 9.81, flailDamping(motion))'), 'live assemblies integrate the same physical pendulum in Hold and Recovery');

const pixels = new Uint8ClampedArray(6 * 6 * 4); // Synthetic transparent PNG alpha data with two top and two bottom edge pixels.
for (const [x, y] of [[1, 1], [3, 1], [2, 2], [4, 3], [3, 4], [5, 4]]) {
  pixels[(y * 6 + x) * 4 + 3] = 255;
}
let imageDrawn = null; // The fake canvas stores the last requested image to exercise its alpha scan.
let imageDraws = 0; // Count source-image copies so the opaque rope artwork is scanned only once per actor-shared image.
const document = {
  currentScript: { src: 'https://example.test/js/weapon-sprite-assemblies.js' },
  createElement: type => {
    assert.equal(type, 'canvas');
    return {
      getContext: () => ({
        drawImage(image) { imageDrawn = image; imageDraws++; },
        getImageData() { return { data: imageDrawn.pixels }; },
      }),
    };
  },
};
const scheduler = { register(id, callback, options) { this.id = id; this.callback = callback; this.options = options; } }; // Records the real module's pre-render registration.
const window = { RuntimeFrameScheduler: scheduler }; // Minimal host, no gameplay side effects.
vm.runInNewContext(sharedColorFill, { window }); // Load the real canonical animal/NPC color fill, not a simulated recolor helper.
vm.runInNewContext(registry, { window }); // The source of truth now comes from the shared editor + gameplay configuration.
vm.runInNewContext(source, {
  window, document, URL, setTimeout: () => {}, performance: { now: () => 100 },
  location: { href: 'https://example.test/game.html', pathname: '/game.html' },
});
const api = window.HobunjiWeaponSpriteAssemblies; // Public debug and authoring API.
assert.equal(api.easeIdleHeadYaw(0,1,0),0);
assert.ok(api.easeIdleHeadYaw(0,1,1/60)>0&&api.easeIdleHeadYaw(0,1,1/60)<.1);
assert.ok(api.easeIdleHeadYaw(Math.PI-.1,-Math.PI+.1,1/60)>Math.PI-.1);
assert.ok(Math.abs(api.bodyYawRate(.1,Math.PI-.1,-Math.PI+.1)-2)<1e-10,'turn speed crosses the yaw wrap without a kick');
assert.equal(api.bodyYawRate(.1,0,Math.PI),0,'a facing reset does not drag the flail');
assert.equal(api.bodyYawRate(0,0,.2),0,'a paused redraw does not drive turn drag');
assert.ok(api);
// Exercise the real head-only spin math: one fixed shaft pivot, constant rope length, and zero allocations.
const shaftDirection = { x: 0, y: -1, z: 0 }; // Unchanged source direction along the currently held shaft.
const spinNormal = { x: 0, y: 0, z: 1 }; // Face normal of the authored flat PNG.
const orbitQ = { setFromAxisAngle(axis, angle) { this.axis = axis; this.angle = angle; return this; } }; // One reused quaternion stand-in.
const headDirection = { x: 0, y: -1, z: 0,
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; },
  applyQuaternion(q) { const x = this.x, y = this.y; this.x = x * Math.cos(q.angle) - y * Math.sin(q.angle); this.y = x * Math.sin(q.angle) + y * Math.cos(q.angle); return this; },
  normalize() { const n = Math.hypot(this.x, this.y, this.z); this.x /= n; this.y /= n; this.z /= n; return this; },
}; // Reused mutable direction object, just like the production state.direction.
for (const t of [0, 0.16, 0.49, 0.55, 0.82, 1]) {
  assert.equal(api.fishingFlailHeadDirection(headDirection, shaftDirection, spinNormal, t, 2.5, orbitQ), headDirection,
    'head-only spin reuses its output rather than allocating a new vector');
  const angle = -Math.PI * 2 * 2.5 * t; // Same revolution clock as the existing spinning throw.
  assert(Math.abs(headDirection.x - Math.sin(angle)) < 1e-9 &&
    Math.abs(headDirection.y + Math.cos(angle)) < 1e-9, 'head follows the taut circular connector orbit at the correct throw phase');
  assert(Math.abs(Math.hypot(headDirection.x, headDirection.y, headDirection.z) - 1) < 1e-9,
    'connector length never changes while the head spins');
}
assert.deepEqual(shaftDirection, { x: 0, y: -1, z: 0 }, 'original held shaft direction is never modified');

const image = { width: 6, height: 6, pixels }; // Scanned image with a deliberately sparse alpha silhouette.
const first = api.opaqueAt(image, 'top'); // Highest nontransparent row, horizontal center of the opaque pixels.
const last = api.opaqueAt(image, 'bottom'); // Lowest nontransparent row, horizontal center of the opaque pixels.
assert.equal(first.x, 2); assert.equal(first.y, 1);
assert.equal(last.x, 4); assert.equal(last.y, 4);
const beforeRopeScan = imageDraws; // Transparent padding is present around the fake rope's 1..5 x and 1..4 y alpha bounds.
const visibleRope = JSON.parse(JSON.stringify(api.ropeOpaqueBounds(image)));
assert.deepEqual(visibleRope,{minX:1,minY:1,maxX:5,maxY:4},'visible alpha bounds exclude transparent padding at both rope ends');
assert.equal(imageDraws,beforeRopeScan+1,'first rope inspection scans the PNG');
api.ropeOpaqueBounds(image);
assert.equal(imageDraws,beforeRopeScan+1,'subsequent flails reuse cached sprite bounds without scanning again');
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
assert.equal(api.definitionFor('grappleFlail', {}).flail.chain.sprite,'assets/objectsprites/rope_long.png');
assert.equal(api.definitionFor('grappleFlail', {}).flail.chain.lengthPx,225,'apply the new exported grip-to-head rope length');
assert.equal(api.definitionFor('grappleFlail', {}).flail.chain.radiusPx,6.25,'apply the new exported rope radius');
assert.equal(api.definitionFor('grappleFlail', {}).flail.chain.color,'#6B4728','restore the original flail rope brown');
const sizes = api.ropeSpriteSizing(api.definitionFor('grappleFlail', {}).flail.chain, .5 / 450, 152 / 2164); // Nominal game units; actual rendering uses the cropped visible aspect.
const visibleAspect = (visibleRope.maxX-visibleRope.minX+1)/(visibleRope.maxY-visibleRope.minY+1); // Compare a trimmed PNG's art extent, not its padded canvas.
const visibleSizing = api.ropeSpriteSizing(api.definitionFor('grappleFlail', {}).flail.chain, .5 / 450, visibleAspect);
assert(Math.abs(visibleSizing.widthScale * visibleAspect * 3.75 - 65.625 * (.5 / 450)) < 1e-10,'trimmed rope keeps original world thickness');
assert(Math.abs(visibleSizing.length * 3.75 - 843.75 * (.5 / 450)) < 1e-10,'trimmed rope keeps both physical endpoints');
assert(Math.abs(sizes.lengthPx - 843.75) < 1e-10,'original 843.75-pixel chain reach survives the art swap');
assert(Math.abs(sizes.diameterPx - 65.625) < 1e-10,'original 65.625-pixel thickness survives the art swap');
assert(Math.abs(sizes.widthScale * (152 / 2164) * 3.75 - 65.625 * (.5 / 450)) < 1e-10,'billboard width compensates for uniform Y scaling');
assert(Math.abs(sizes.length * 3.75 - 843.75 * (.5 / 450)) < 1e-10,'sprite height reaches the same grapple contact');
assert(!source.includes('new THREE.CylinderGeometry'),'the generated cylinder was removed');
const ropePixels = Uint8ClampedArray.from([
  12, 10, 8, 255, // Near-black winding must stay appropriately dark.
  60, 55, 45, 255, // Authored darker rope section.
  120, 110, 90, 255, // Authored brighter rope section.
  250, 250, 250, 255, // Near-white decorative highlight must be left alone by the canonical fill.
  240, 210, 180, 0, // Transparent margin is not eligible for recoloring.
]); // Full opaque spectrum ensures direct parity with the shared Gar-wolf shade-fill routine.
const originalRopePixels = Uint8ClampedArray.from(ropePixels); // Independent original used to validate alpha, bright highlights and relative shading.
const expectedAnimalFill = Uint8ClampedArray.from(ropePixels); // Applies the real shared algorithm to the same source pixels.
window.ColorFill.shadeFillPixels(expectedAnimalFill, [107, 71, 40], { debugLabel: 'animal-parity-expected' });
assert.equal(api.tintRopePixels(ropePixels, '#6B4728'),ropePixels,'the rope fill must update its supplied pixels in place');
assert.deepEqual(Array.from(ropePixels),Array.from(expectedAnimalFill),'Grapple-Flail recoloring must be byte-for-byte identical to the shared animal shade-fill algorithm');
assert.deepEqual([3,7,11,15,19].map(i=>ropePixels[i]),[3,7,11,15,19].map(i=>originalRopePixels[i]),'the inherited animal fill retains all alpha values');
assert.deepEqual(Array.from(ropePixels.slice(12,16)),Array.from(originalRopePixels.slice(12,16)),'near-white artwork is excluded from animal shade-fill');
assert(ropePixels[0] < ropePixels[4] && ropePixels[4] < ropePixels[8],'dark outlines and intermediate shading retain their authored brightness order');
assert.equal(window.ColorFill.debugSnapshot().lastShadeFill.label,'weapon-rope:#6B4728','mobile diagnostics label the shared shade-fill pass');
const unchangedWhite = Uint8ClampedArray.from(originalRopePixels); // White is the original art/no-recolor option, not a brown paint.
api.tintRopePixels(unchangedWhite, '#FFFFFF');
assert.deepEqual(Array.from(unchangedWhite),Array.from(originalRopePixels),'default white rope retains the source image');

assert.equal(source.includes('tintedRopeTextures = new WeakMap()'),true,'recolored rope variants are cached per source image');
assert.match(source, /const ROPE_TINT_CACHE_LIMIT = 12/, 'large recolored rope canvases must have a finite cache budget');
assert.match(source, /while \(variants\.size > ROPE_TINT_CACHE_LIMIT\)/, 'discard old full-resolution tint templates after too many color edits');
assert.match(source, /stale\?\.dispose\?\.\(\)/, 'evicted canvas texture templates are disposed while rendered clones remain independent');
assert.match(source, /ropeTintMethod = tintedSource === sourceTexture/, 'the actual textured rope reports whether the shared color fill succeeded');
assert.match(source, /ropeTint: s\.chain\?\.userData/, 'mobile diagnostics expose the real rope tint path');
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
const sleeping=body(); sleeping.equilibriumSkips=0;
api.stepPendulum(sleeping,{x:0,y:0,z:0},1,1/60);
assert.deepEqual(sleeping.direction,body().direction);
assert.deepEqual(sleeping.angularVelocity,body().angularVelocity);
assert(sleeping.equilibriumSkips>0,'exact equilibrium avoids physical substeps');
const awake=body(); awake.equilibriumSkips=0;
api.stepPendulum(awake,{x:.000001,y:0,z:0},1,1/60);
assert.equal(awake.equilibriumSkips,0,'even the smallest nonzero lateral torque must integrate');
assert.notEqual(awake.angularVelocity.z,0);
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


async function checkEnemyWeaponCleanup() {
  // Run the game's ordinary corpse teardown with actual assembly records and
  // delay the overlay asset until after looting to exercise in-flight setup.
  const cleanup = { window, scene: { remove() {} } };
  vm.createContext(cleanup);
  vm.runInContext(game.slice(game.indexOf('      function disposeCreaturePresentation('),
    game.indexOf('      // ── Loot & Shop config')), cleanup);

  let finishTexture;
  const THREE = {
    Vector3: class { toArray() { return []; } },
    Quaternion: class {},
    Matrix4: class {},
    TextureLoader: class { load(_url, resolve) { finishTexture = resolve; } },
  };
  const baseline = api.debugSnapshot().length;
  const ownedDisposals = [];
  for (let fight = 0; fight < 20; fight++) {
    const holder = {
      parent: { remove(child) { child.parent = null; } },
      children: [],
      traverse(visit) {
        visit(this);
        for (const weapon of this.children) visit(weapon.userData.toolPlane);
      },
      userData: {},
    };
    const plane = {
      userData: { sharedToolGeometry: fight % 2 === 0 },
      geometry: { dispose() { ownedDisposals.push('geometry'); } },
      material: {
        map: { image, dispose() { assert.fail('the shared base texture must survive'); } },
        dispose() { ownedDisposals.push('material'); },
      },
    };
    const weapon = { parent: holder, userData: { toolPlane: plane } };
    holder.children.push(weapon);
    api.decorate(weapon, 'test-enemy-weapon', { spriteLayers: [{ sprite: 'assets/toolsprites/late-test.png' }] }, { THREE });
    assert.equal(api.debugSnapshot().length, baseline + 1);
    const corpse = { avatarRef: { group: {}, dispose() {} }, [fight % 2 ? '_banditToolHolder' : '_banditRangedToolHolder']: holder };
    cleanup.disposeCreaturePresentation(corpse);
    assert.equal(holder.parent, null);
    assert.equal(weapon.parent, holder, 'removing the holder leaves the assembly parented');
    assert.equal(api.debugSnapshot().length, baseline, 'each looted corpse releases its frame-update record');
  }
  assert.equal(ownedDisposals.filter(kind => kind === 'geometry').length, 10, 'only private geometries are disposed');
  assert.equal(ownedDisposals.filter(kind => kind === 'material').length, 20);
  assert.equal(typeof finishTexture, 'function', 'the asset load is pending during teardown');
  finishTexture({ image });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(api.debugSnapshot().length, baseline, 'late asset load cannot revive a looted weapon');
}

checkEnemyWeaponCleanup().catch(error => { console.error(error); process.exitCode = 1; });

// Idle head movement retains logical yaw through settling and camera re-clamps.
{
  const motion={yaw:null,leanX:0,leanZ:0,perp:null,side:0},dead=40*Math.PI/180;
  for(let i=0;i<60;i++)api.stepIdleHeadMotion(motion,4,0,1/60,0,dead);
  assert.ok(Math.abs(motion.yaw-Math.PI/2)<1e-10);
  assert.ok(motion.leanX>.5&&motion.leanX<=dead);assert.equal(motion.leanZ,0);
  const yaw=motion.yaw,rendered=api.clampIdleHeadYaw(motion,yaw,0,dead);
  assert.ok(Math.abs(Math.abs(rendered-Math.PI/2)-dead)<1e-9);
  for(let i=0;i<180;i++)api.stepIdleHeadMotion(motion,0,0,1/60,0,dead);
  assert.equal(motion.leanX,0);assert.equal(motion.leanZ,0);assert.equal(motion.yaw,yaw);
  assert.equal(api.clampIdleHeadYaw(motion,yaw,Math.PI/2,dead),yaw);
  api.stepIdleHeadMotion(motion,0,-100,1,0,dead);assert.ok(Math.abs(motion.leanZ)<=dead);assert.equal(motion.yaw,Math.PI);
  const before=motion.yaw;api.stepIdleHeadMotion(motion,100,0,0,0,dead);assert.equal(motion.yaw,before);
  const bounds={minX:-.3,maxX:.5,maxY:.1,drop:.7};
  assert.equal(api.tiltedHeadDrop(bounds,{x:0,y:0,z:0,w:1}),.7);
  const theta=.3,tilted=api.tiltedHeadDrop(bounds,{x:0,y:0,z:Math.sin(theta/2),w:Math.cos(theta/2)});
  assert.ok(Math.abs(tilted-(.3*Math.sin(theta)+.7*Math.cos(theta)))<1e-10);
}

// Strike-return tip motion is a one-shot fallback, never a competitor to locomotion.
{
  const dead=40*Math.PI/180,dt=.02;
  const make=()=>({yaw:null,leanX:0,leanZ:0,tipReady:false,tipX:0,tipY:0,tipZ:0,returnX:0,returnZ:0,previousAttack:false,previousProgress:0,sawStrike:false,source:'initial'});
  const advance=(m,attacking,p,x,z,bx=0,bz=0,time=dt)=>api.advanceIdleHeadMotion(m,attacking,p,.3,.7,{x,y:1,z},bx,bz,time,0,dead);
  const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10);
  const recovery=m=>{advance(m,false,0,0,0);advance(m,true,.4,0,0);advance(m,true,.8,.06,0);advance(m,true,.98,.12,0);};
  const a=make();recovery(a);advance(a,false,0,.12,0);
  near(a.yaw,Math.PI/2);assert.equal(a.source,'strike-return');assert.ok(a.leanX>.4&&a.leanX<=dead);
  for(let i=0;i<200;i++)advance(a,false,0,.12,0);
  assert.equal(a.leanX,0);near(a.yaw,Math.PI/2);
  advance(a,false,0,.12,.1);near(a.yaw,Math.PI/2);assert.equal(a.leanZ,0,'ordinary idle tip movement cannot retrigger');
  const b=make();recovery(b);advance(b,false,0,.12,.08,0,4);
  near(b.yaw,0);assert.equal(b.source,'locomotion');assert.ok(b.leanZ>0);assert.equal(b.leanX,0);
  const c=make();recovery(c);advance(c,false,0,.12,-.08);near(c.yaw,Math.PI);assert.equal(c.source,'strike-return');
  advance(c,false,0,.2,-.08,4,0);near(c.yaw,Math.PI/2);assert.equal(c.source,'locomotion');
  const d=make();advance(d,false,0,0,0);advance(d,true,.1,.02,0);advance(d,false,0,.08,0);assert.equal(d.leanX,0,'cancelled windup is not a strike');
  const e=make();recovery(e);advance(e,false,0,20,0);assert.equal(e.leanX,0,'teleport does not inject a strike impulse');
  const g=make();recovery(g);advance(g,false,0,.12,0,0,0,0);assert.equal(g.previousAttack,true);advance(g,false,0,.12,0);assert.equal(g.source,'strike-return');
  const h=make();recovery(h);advance(h,true,.05,.18,0);advance(h,false,0,.24,0);assert.equal(h.leanX,0,'new windup clears old recovery');
}

// Audit: true horizontal normal keeps the requested yaw even under maximal diagonal lean.
{
  const vec=()=>({set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}});
  for(const yaw of [-2,-.7,0,.9,2.8])for(const heading of [-2,-.2,1.1,3]){
    const u=vec(),n=vec(),lean=.69;
    api.leanHeadBasis(Math.sin(heading),Math.cos(heading),lean,yaw,u,n);
    assert.ok(Math.abs(u.x*n.x+u.y*n.y+u.z*n.z)<1e-10);
    assert.ok(Math.abs(Math.atan2(n.x,n.z)-yaw)<1e-10);
    assert.ok(Math.abs(Math.acos(u.y)-lean)<1e-10);
  }
  const m={yaw:2,leanX:.4,leanZ:.1,returnX:1,returnZ:2,previousAttack:true,sawStrike:true,tipReady:true,previousProgress:.9,renderedYaw:1,perp:0,side:1};
  api.resetIdleHeadMotion(m,true);
  assert.equal(m.yaw,null);assert.equal(m.leanX,0);assert.equal(m.returnX,0);assert.equal(m.previousAttack,false);
  api.advanceIdleHeadMotion(m,false,0,.3,.7,{x:4,y:1,z:2},0,0,0,.2,.7);
  assert.equal(m.tipReady,true);assert.equal(m.yaw,.2);assert.equal(m.tipX,4);
  api.advanceIdleHeadMotion(m,false,0,.3,.7,{x:4,y:1,z:2},0,0,.016,.2,.7);
  assert.equal(m.leanX,0);assert.equal(m.yaw,.2);
}

{ // A slack tether never pushes a grounded head.
  const t={grounded:false}, d={x:0,y:-1,z:0};
  const step=(x,z,available=.3,length=1,y=0)=>({...api.resolveGroundSlack(t,d,length,available,{x,y,z})});
  const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
  const first=step(0,0);close(first.y,-.3);close(first.x,0);
  assert.ok(api.canPinGroundHead(t,{x:.4,y:0,z:.2},1,.3),'a slack head must retain its prior visible orientation');
  assert.equal(api.canPinGroundHead(t,{x:1.4,y:0,z:.2},1,.3),false,'taut dragging can rotate the head');
  const slack=step(.4,.2);close(slack.x+.4,0);close(slack.z+.2,0);
  assert.ok(Math.hypot(slack.x,slack.y,slack.z)<1);
  const taut=step(1.4,.2);close(Math.hypot(taut.x,taut.y,taut.z),1);
  const back=step(1,.2);close(back.x+1,taut.x+1.4);close(back.z,taut.z);
  const rotated=step(1,.4);close(rotated.x,back.x);close(rotated.z+.4,back.z+.2);
  const lifted=step(1,.4,1.1);assert.equal(lifted.grounded,false);close(lifted.y,-1);
  const reset=step(10,10);close(reset.x,0);close(reset.z,0);
  const verticalReset=step(10.2,10,.3,1,4);close(verticalReset.x,0);close(verticalReset.z,0);
  const tangent={grounded:false};api.resolveGroundSlack(tangent,d,1,1,{x:0,y:0,z:0});
  assert.equal(tangent.grounded,true,'exact vertical floor contact is pinned, not treated as airborne');
  const rightHand={grounded:false};api.resolveGroundSlack(rightHand,d,1,.3,{x:2,y:0,z:0});
  const leftHand={grounded:false};api.resolveGroundSlack(leftHand,d,1,.3,{x:-2,y:0,z:0});
  api.resolveGroundSlack(rightHand,d,1,.3,{x:2.2,y:0,z:0});
  api.resolveGroundSlack(leftHand,d,1,.3,{x:-1.8,y:0,z:0});
  close(rightHand.x+2.2,2);close(leftHand.x-1.8,-2);
  const unreachable=step(10,10,-2,1,4);close(unreachable.y,1);close(Math.hypot(unreachable.x,unreachable.y,unreachable.z),1);
  for(const [x,y,target] of [[0,1,.3],[.2,1,.5],[.5,1,.1],[.5,0,.1],[0,1,0]]){
    const scale=api.slackConnectorScale(x,y,target,{});
    assert.ok(scale.x>0&&scale.x<=1&&scale.y>0&&scale.y<=1);
    assert.ok(Math.abs(Math.hypot(x*scale.x,y*scale.y)-target)<2e-6);
  }
}
