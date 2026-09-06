const fs = require('fs');

const loader = fs.readFileSync('docs/js/procedural-impact-tabs.js', 'utf8');
const core = fs.readFileSync('docs/js/procedural-impact-tabs-core.js', 'utf8');
const ground = fs.readFileSync('docs/js/procedural-limb-pose-author.js', 'utf8');
const carry = fs.readFileSync('docs/js/procedural-carry-walk-mode.js', 'utf8');
const legs = fs.readFileSync('docs/js/leg-bones.js', 'utf8');

const checks = [
  ['loader preserves Impact/Dance core', loader.includes('procedural-impact-tabs-core.js')],
  ['loader includes ground input bridge', loader.includes('procedural-ground-rest-input-bridge.js')],
  ['core still loads Dance', core.includes('procedural-dance-mode.js')],
  ['ground has cross-legged', ground.includes('crossLegged')],
  ['ground has kneel', ground.includes('kneel')],
  ['ground has lie-back', ground.includes('lieBack')],
  ['ground excludes carry pose', !ground.includes('carryUpright')],
  ['ground reuses procedural feet', ground.includes('_procedural_feet') || ground.includes('ExperimentalFeet')],
  ['ground reuses authored hands', ground.includes('LeftHand') && ground.includes('RightHand')],
  ['ground pauses locomotion', ground.includes('setMovementPlayback(false)')],
  ['carry is locomotion overlay', carry.includes('regular-locomotion-upper-body-overlay')],
  ['carry derives from regular', carry.includes("applyMovementPreset('regular')") || carry.includes("originalApplyMovementPreset('regular')")],
  ['carry keeps movement playback active', carry.includes('setMovementPlayback(true)')],
  ['carry has movement UI button', carry.includes('animationCarryBtn')],
  ['carry leaves native feet untouched', carry.includes('nativeFeetUntouched')],
  ['carry uses fixed-length IK', carry.includes('solveFixedTwoBoneChain')],
  ['carry excludes Dance while active', carry.includes('ProceduralDanceMode')],
  ['carry resets ground/rest', carry.includes('HobunjiProceduralLimbPoseAuthor')],
  ['legacy gait solver preserved', legs.includes('solveTwoBoneLeg')],
  ['fixed-length solver added', legs.includes('solveFixedTwoBoneChain')],
  ['subdivided solver added', legs.includes('solveSubdividedChain')],
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(`procedural modern ground/carry: FAIL\n- ${failed.join('\n- ')}`);
  process.exit(1);
}
console.log('procedural modern ground/carry: PASS');
