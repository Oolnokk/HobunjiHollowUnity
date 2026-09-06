const fs = require('fs');
const assert = require('assert');

const neutral = fs.readFileSync('docs/js/procedural-neutral-arm-fix.js', 'utf8'); // Editor bridge that must defer ordinary neutral presentation to gameplay's hand runtime.
const legBones = fs.readFileSync('docs/js/leg-bones.js', 'utf8'); // Guaranteed procedural-editor bootstrap path.
const editor = fs.readFileSync('docs/tools/procedural-animation-editor/index.html', 'utf8'); // Historical duplicate editor hand markers intentionally bypassed in neutral.
const shoulderAim = fs.readFileSync('docs/js/procedural-hand-shoulder-aim.js', 'utf8'); // Gameplay shoulder positioning authority for free hands.
const frameDriver = fs.readFileSync('docs/js/procedural-hand-frame-driver.js', 'utf8'); // Gameplay idle/walk fallback authority.

assert(neutral.includes('const hands = global.ProceduralHandAttachments') && neutral.includes('hands.attach(state.THREE, handParent'), 'neutral editor parity must attach through the gameplay hand runtime, not construct its own neutral chain');
assert(neutral.includes('proceduralHandParent'), 'neutral editor parity must use the authoring-preview hand parent supported by the real frame driver');
assert(neutral.includes('model.userData.proceduralHandRig'), 'neutral editor parity must publish/reuse the same proceduralHandRig slot as gameplay');
assert(neutral.includes("procedural-hand-shoulder-aim.js"), 'neutral editor parity must load the runtime shoulder-aim wrapper');
assert(neutral.includes("procedural-hand-frame-driver.js"), 'neutral editor parity must load the runtime direct-hand frame driver');
assert(neutral.includes('painted PNG-plane arm sprites') || neutral.includes('painted sprite arms'), 'neutral parity must document that normal NPC arms are painted sprite content, not generated arm geometry');
assert(neutral.includes('timeSeconds * 2.15'), 'fallback adoption must use the exact runtime idle-breath frequency for the already-built preview avatar');
assert(neutral.includes('modelHeight * 0.0035'), 'fallback adoption must use the exact runtime idle-breath amplitude for the already-built preview avatar');
assert(neutral.includes('rig.setSideIdle?.(side'), 'already-built preview avatars must still feed idle through the real wrapped setSideIdle runtime path');
assert(neutral.includes('directEditorHandRoot'), 'neutral parity must identify the editor-only duplicate hand root separately from the runtime rig');
assert(neutral.includes('hideNode(duplicateHands)'), 'neutral mode must hide the editor duplicate GLB hands');
assert(neutral.includes('hideNode(danceArms)'), 'neutral mode must hide the virtual Dance arm chain');
assert(neutral.includes('hideNode(carryArms)'), 'neutral mode must hide the virtual Carry arm chain');
assert(neutral.includes("mode: 'runtime-unarmed-npc-parity'"), 'public diagnostics must identify exact unarmed-NPC runtime parity mode');
assert(!neutral.includes('solveFixedTwoBoneChain'), 'ordinary neutral parity must not own a fixed-length arm solver');
assert(!neutral.includes('solveSubdividedChain'), 'ordinary neutral parity must not manufacture an elbow/arm subdivision');
assert(!neutral.includes('resolvePortraitBoundAnchor'), 'neutral parity must not duplicate the runtime shoulder coordinate resolver');
assert(!neutral.includes('function posteriorY('), 'neutral parity must not locally reconstruct posterior/wrist placement');
assert(!neutral.includes('upperArmFraction'), 'neutral parity must not own a virtual elbow split');
assert(legBones.includes('procedural-neutral-arm-fix.js?v=20260905neutralarm1'), 'the guaranteed procedural-editor bootstrap must load the parity bridge from the same pinned revision');
assert(shoulderAim.includes('Painted arm sprites remain untouched.'), 'runtime shoulder aim must remain hand-only and preserve painted arm sprites');
assert(frameDriver.includes('No arm solver participates.'), 'runtime direct-hand driver must remain the explicit no-arm-solver reference implementation');
assert(editor.includes("side === 'left' ? -Math.abs(safeHandAttachX) : Math.abs(safeHandAttachX)"), 'historical editor duplicate hand placement changed; remove this compatibility assertion when the duplicate builder itself is retired');

console.log('procedural neutral arms runtime parity: PASS');
