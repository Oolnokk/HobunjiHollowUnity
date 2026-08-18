'use strict';
const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const config = read('docs/config/hand-model-profiles.js');
const attachments = read('docs/js/procedural-hand-attachments.js');
const driver = read('docs/js/procedural-hand-frame-driver.js');
const toolGrips = read('docs/js/hand-tool-grips.js');
const editor = read('docs/js/attack-editor-hand-inverse-configurator.js');
const directEditor = read('docs/js/attack-editor-hand-direct-attachments.js');
const gripModes = read('docs/js/hand-grip-modes.js');
const materialRoles = read('docs/js/procedural-hand-foot-material-roles.js');
const bootstrap = read('docs/js/held-action-animations.js');
const crossbowTrim = read('docs/js/crossbow-strike-audio-trim.js');
const ranged = read('docs/js/combat/ranged-weapons.js');

assert(config.includes('handFromTool'), 'hand model config must keep direct handFromTool authoring');
assert(config.includes("handedness: 'left'"), 'source basis must keep the authored left-hand convention');
assert(config.includes('model.toolGrip = identityTransform()'), 'legacy model toolGrip must stay neutral to avoid double transforms');

assert(attachments.includes('NO arm skeleton, IK, shoulder tracking, elbow, reach clamp'), 'direct attachment runtime must explicitly reject arm IK ownership');
assert(attachments.includes('authoredOriginPreserved = true'), 'GLB authored origin must be preserved');
assert(!attachments.includes('clone.position.sub(center)'), 'hand GLBs must never be bounding-box recentered');
assert(attachments.includes('side: THREE.DoubleSide'), 'hand materials must remain double-sided');
assert(attachments.includes("side === 'right'"), 'runtime must build distinct left/right mirror signs');
assert(!attachments.includes('solveTwoBoneArm'), 'direct attachment runtime must not solve arm bones');

assert(driver.includes("placeHandWorld?.('right'"), 'right hand must attach directly to the primary tool socket');
assert(driver.includes('secondaryGripForTool(toolKey)'), 'driver must resolve optional secondary tool grip');
assert(driver.includes("placeHandWorld?.('left'"), 'enabled secondary grip must drive the left hand');
assert(driver.includes("setSideIdle?.('left')"), 'left hand must return to idle when no secondary grip is enabled');
assert(driver.includes('noArmIK: true'), 'driver debug must visibly report no arm IK');
assert(!driver.includes('clampDeltaWorld'), 'hands must never move the tool through a reach clamp');
assert(!driver.includes('adjustedTool'), 'hands must never author an adjusted tool pose');

assert(toolGrips.includes('hatchet:'), 'hatchet must have a secondary-grip definition');
assert(toolGrips.includes('hoe:'), 'hoe must have a secondary-grip definition');
assert((toolGrips.match(/enabled: true/g) || []).length >= 2, 'hatchet and hoe secondary grips must default enabled');
assert(toolGrips.includes('secondaryGripForTool'), 'tool grip config must expose a reusable secondary socket lookup');

assert(directEditor.includes('Optional second hand grip'), 'Attack Editor must expose secondary grip authoring');
assert(directEditor.includes("$('handShowArmBones')?.closest('.field')?.remove()"), 'Attack Editor must strip the old arm-bone toggle');
assert(directEditor.includes('handSecondaryGripEnabled'), 'Attack Editor must provide a secondary grip enable toggle');
assert(directEditor.includes('NO ARM IK'), 'Attack Editor must visibly report the simplified attachment model');
assert(editor.includes('Hand position relative to tool grip'), 'fine hand-from-tool authoring must remain available as a direct grip transform');
assert(editor.includes('The tool is never moved by the hand system'), 'editor must state direct-hand authority clearly');

assert(gripModes.includes("'palm-parallel'"), 'palm-parallel grip mode must remain');
assert(gripModes.includes("'palm-perpendicular'"), 'palm-perpendicular grip mode must remain');
assert(gripModes.includes('multiplyQuat(modeQ, fineQ)'), 'grip mode and fine transform must compose as quaternions');

assert(materialRoles.includes("pachyderm: 'mashtzarr'"), 'pachyderm hand materials must inherit foot slot roles');
assert(materialRoles.includes("sloth: 'tletingan'"), 'sloth hand materials must inherit foot slot roles');
assert(materialRoles.includes("feline: 'mao-ao'"), 'feline hand materials must inherit foot slot roles');

for (const wanted of [
  'hand-tool-grips.js',
  'procedural-hand-attachments.js',
  'procedural-hand-frame-driver.js',
  'attack-editor-hand-direct-attachments.js',
]) assert(bootstrap.includes(wanted), `${wanted} must be loaded by the hand bootstrap`);
for (const removed of [
  'arm-bones.js',
  'procedural-arm-animation.js',
  'procedural-hand-portrait-shoulders.js',
  'procedural-arm-portrait-biceps.js',
  'procedural-hand-forearm-follow.js',
  'procedural-hand-arm-length.js',
]) assert(!bootstrap.includes(removed), `${removed} must stay out of the direct-hand bootstrap`);

assert(ranged.includes('fireAtFrac: 0.08'), 'crossbow strike/fire stage must remain at 8% of the attack');
assert(ranged.includes("strikeFrac: kind === 'fire' ? def.fireAtFrac"), 'visual strike stage must use the exact fireAtFrac value');
assert(ranged.includes("playRangedActionSfx(action.itemKey, 'fire')"), 'fire SFX must be emitted at the same fire/strike event, not hit resolution');
assert(crossbowTrim.includes('TRIM_START_S = 0.10'), 'crossbow clip must skip its leading dead air');
assert(crossbowTrim.includes('combatSfx?.rangedFire'), 'audio trim must read the real combat SFX config path');
assert(crossbowTrim.includes("key !== 'rangedFire'"), 'audio trim must be scoped to ranged fire only');

console.log('direct hands: primary/secondary sockets, authored GLB origins, no arm IK, and strike-timed crossbow audio PASS');
