'use strict';
// Execute the real pose modules so first-frame fallbacks, gameplay and the editor cannot drift.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const config = JSON.parse(fs.readFileSync('docs/config/combat/weapon-idle-stances.json', 'utf8'));
const sandbox = { window: {}, console };
vm.runInNewContext(fs.readFileSync('docs/js/combat/shared-attack-pose.js', 'utf8'), sandbox);
vm.runInNewContext(fs.readFileSync('docs/js/weapon-tool-stances.js', 'utf8'), sandbox);
const hosted = {
  window: { addEventListener() {} }, console, URL, Promise,
  location: { href: 'https://example.test/docs/index.html', pathname: '/docs/index.html' },
  document: { currentScript: { src: 'https://example.test/docs/js/held-action-animations.js' }, readyState: 'loading', write() {} },
}; // Executes the complete production held-action bootstrap with its ordinary parser-time document contract.
vm.runInNewContext(fs.readFileSync('docs/js/held-action-animations.js', 'utf8'), hosted);

const donor = config.stances.longHaftedTool; // Pick-Shovel's functioning standalone tool Neutral.
const toolCopy = config.stances.topHeavyTool; // Hoe, hatchet and fishing mace share a separately authored copy.
const foodCopy = hosted.window.HeldActionAnimations.heldItemSmall.poses.neutral; // Small inventory items, including jerky, use the tool-frame carry Neutral.
const fields = ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'bodyYaw'];
for (const field of fields) {
  assert.equal(toolCopy[field], donor[field], 'top-heavy ' + field);
  assert.equal(sandbox.window.WeaponToolStances.poses.topHeavyTool[field], donor[field], 'runtime top-heavy ' + field);
  assert.equal(foodCopy[field], donor[field], 'small held item ' + field);
}
assert.notStrictEqual(sandbox.window.WeaponToolStances.poses.topHeavyTool,
  sandbox.window.WeaponToolStances.poses.longHaftedTool,
  'copy may be tuned without changing the original Pick-Shovel stance');
assert.notEqual(foodCopy.headRelative, true, 'static item uses the tool-base frame instead of a mouth-offset pose');
const drink = hosted.window.HeldActionAnimations.drink;
assert.equal(drink.poses.neutral.headRelative, true, 'the real Drink neutral remains mouth-relative');
assert.equal(drink.poses.neutral.x, -0.45, 'the original Drink idle endpoint was not overwritten');
assert.equal(drink.poses.neutral.y, -0.42, 'the original Drink idle mouth offset was not overwritten');
assert.equal(drink.poses.windup.headRelative, true, 'drinking still approaches the mouth');
assert.equal(drink.poses.strike.headRelative, true, 'drinking still reaches its mouth target');
for (const phase of ['windup', 'strike']) {
  for (const field of fields) assert.equal(hosted.window.HeldActionAnimations.heldItemSmall.poses[phase][field], foodCopy[field], 'small carried item remains still in editor');
}
const game = fs.readFileSync('docs/game.js', 'utf8');
const start = game.indexOf('      function applyHeldSmallIdlePose() {');
const end = game.indexOf('      // Begins the shared drink-style windup animation on press.', start);
assert(start > 0 && end > start, 'the production renderer owns the static item pose');
const source = game.slice(start, end);
assert.match(game, /usesThrustHeldPose\(item\) && window\.HeldActionAnimations\?\.heldItemSmall\?\.poses\?\.neutral\)[\s\S]*?applyHeldSmallIdlePose\(\)/,
  'idle small items call the independent carrier, not the Drink animation');
const heldContext = {
  window: hosted.window,
  THREE: { MathUtils: { degToRad: v => v * Math.PI / 180 } },
  playerMesh: { rotation: { y: 0 } }, playerFacing: 0,
  playerToolBaseX: -0.45, playerToolBaseY: 0.45,
  heldItemHolder: {
    position: { set(x, y, z) { Object.assign(this, { x, y, z }); } },
    scale: { setScalar(value) { this.x = value; } },
    quaternion: { copy() { return this; }, multiply() { return this; } },
  },
  _qToolYaw: { setFromAxisAngle() {} }, _qAnim: { setFromAxisAngle() {} }, _qRoll: { setFromAxisAngle() {} },
  _tUp: {}, _xAxis: {}, _zAxis: {},
  _heldItemPlane: { rotation: { x: 0 } },
  _heldItemHandMode: null,
};
vm.runInNewContext(source + '\napplyHeldSmallIdlePose();', heldContext);
assert.equal(heldContext.heldItemHolder.position.x, -0.45 + foodCopy.x, 'tool-base X is used rather than mouth X');
assert.equal(heldContext.heldItemHolder.position.y, 0.45 + foodCopy.y, 'tool-base Y is used rather than mouth Y');
assert.equal(heldContext.heldItemHolder.position.z, foodCopy.z, 'tool-base forward placement is copied');
assert.equal(heldContext.heldItemHolder.scale.x, 0.5, 'normal small carried items retain the bottle/icon scale');
assert.equal(heldContext._heldItemPlane.rotation.x, Math.PI / 2, 'the small item plane retains its orientation');
assert.equal(heldContext._heldItemHandMode, 'bottle', 'the hand socket follows the visible small item');

const editorSource = fs.readFileSync('docs/js/attack-idle-stance-editor.js', 'utf8');
const match = editorSource.match(/const FALLBACK_CONFIG = (Object\.freeze\(\{[\s\S]*?\n  \}\));/);
assert.ok(match, 'the stance editor has a first-render fallback');
const editorFallback = vm.runInNewContext('(' + match[1] + ')', { Object });
for (const field of fields) assert.equal(editorFallback.stances.topHeavyTool[field], donor[field], 'editor top-heavy ' + field);
console.log('Pick-Shovel carried Neutral copy: food, tools, runtime and editor all agree.');
