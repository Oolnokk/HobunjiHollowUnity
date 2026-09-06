const fs = require('fs');
const assert = require('assert');

const neutral = fs.readFileSync('docs/js/procedural-neutral-arm-fix.js', 'utf8'); // Authoritative editor neutral-arm correction layer.
const legBones = fs.readFileSync('docs/js/leg-bones.js', 'utf8'); // Guaranteed procedural-editor bootstrap path.
const editor = fs.readFileSync('docs/tools/procedural-animation-editor/index.html', 'utf8'); // Historical duplicate marker bug retained here only as a regression target.
const dance = fs.readFileSync('docs/js/procedural-dance-mode-core.js', 'utf8'); // Historical guessed shoulder baseline corrected by the final layer.
const hands = fs.readFileSync('docs/js/procedural-hand-attachments.js', 'utf8'); // Runtime neutral-hand convention the editor must match.

assert(neutral.includes("leftHandShoulder") && neutral.includes("rightHandShoulder"), 'neutral arms must use authored per-side shoulder anchors');
assert(neutral.includes('portraitScaleMultiplier') && neutral.includes('portraitVerticalPlacementRatio'), 'neutral shoulder positions must follow actor portrait scale and vertical placement');
assert(neutral.includes('HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY'), 'neutral wrists must use the shared canonical posterior resolver');
assert(neutral.includes('armLengthHeightPercentOffset'), 'neutral wrists must include the authored arm-length offset');
assert(neutral.includes('shoulderFloor.x'), 'neutral free-hand X must come from the actual shoulder rather than handAttachX');
assert(!neutral.includes('Math.abs(handAttachX)'), 'the neutral correction must never force handAttachX through abs() and mirror the sides');
assert(neutral.includes('LEFT_IDLE_YAW_DEG = 90'), 'editor marker orientation must preserve the runtime 90-degree medial neutral yaw');
assert(neutral.includes('RIGHT_VISUAL_TWIST_DEG = 180'), 'editor right-hand marker must preserve the runtime extra 180-degree visual twist');
assert(neutral.includes('solveFixedTwoBoneChain'), 'moving Dance/Carry arms must use fixed-length anatomy rather than target-derived stretchy lengths');
assert(neutral.includes("solveSubdividedChain"), 'true neutral must subdivide the authored shoulder-to-wrist span without inventing an elbow bend');
assert(neutral.includes("`${side}ArmDebugLine`"), 'Dance arm guides must be corrected at final draw');
assert(neutral.includes("`${side}CarryArmGuide`"), 'Carry arm guides must be corrected at final draw');
assert(neutral.includes('scene.onBeforeRender'), 'neutral correction must run after renderer-wrapper animators and immediately before scene draw');
assert(legBones.includes('procedural-neutral-arm-fix.js?v=20260905neutralarm1'), 'the guaranteed procedural-editor bootstrap must load the neutral correction from the same pinned revision');
assert(hands.includes('left: new THREE.Vector3(-handAttachX, handAttachY, 0)'), 'runtime left neutral convention must remain -handAttachX');
assert(hands.includes('right: new THREE.Vector3(handAttachX, handAttachY, 0)'), 'runtime right neutral convention must remain +handAttachX');

// These two assertions intentionally document the obsolete assumptions the
// correction layer is overriding. If the underlying editor/Dance code is later
// fixed directly, update this test by removing the historical-presence checks;
// the authoritative assertions above should remain.
assert(editor.includes("side === 'left' ? -Math.abs(safeHandAttachX) : Math.abs(safeHandAttachX)"), 'expected historical editor hand-side bug is no longer present; remove compatibility correction/test when direct fix lands');
assert(dance.includes('SHOULDER_X_FRACTION = 0.62'), 'expected historical Dance shoulder approximation is no longer present; remove compatibility correction/test when direct fix lands');

console.log('procedural neutral arms: PASS');
