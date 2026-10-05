'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const config = JSON.parse(fs.readFileSync('docs/config/combat/weapon-idle-stances.json', 'utf8'));
const runtime = fs.readFileSync('docs/js/weapon-tool-stances.js', 'utf8');
const editor = fs.readFileSync('docs/js/attack-idle-stance-editor.js', 'utf8');
const grips = fs.readFileSync('docs/js/hand-tool-grips.js', 'utf8');
const dual = fs.readFileSync('docs/js/dual-wield-weapon-visuals.js', 'utf8');

assert.equal(config.version, 2, 'dual idle authoring upgrades the stance schema');
assert.deepEqual(config.stances.dualWieldMain, config.stances.lightWeapon, 'default dual main is exactly the Light Weapon stance');
const main = config.stances.dualWieldMain;
const off = config.stances.dualWieldOffhand;
assert.equal(off.x, -main.x, 'default offhand mirrors X after the shared body yaw');
assert.equal(off.y, main.y, 'default offhand preserves Y');
assert.equal(off.z, main.z, 'default offhand preserves forward Z');
assert.equal(off.pitch, main.pitch, 'default offhand preserves pitch');
assert.equal(off.yaw, -main.yaw, 'default offhand mirrors yaw');
assert.equal(off.roll, -main.roll, 'default offhand mirrors roll');
assert.equal(off.bodyYaw, main.bodyYaw, 'both idle weapons share the normal body yaw');

assert.match(editor, /dualWieldMain: 'Dual Wield — Main hand'/, 'idle editor exposes a dedicated main-hand preset');
assert.match(editor, /dualWieldOffhand: 'Dual Wield — Offhand'/, 'idle editor exposes a dedicated offhand preset');
assert.match(editor, /Mirror Main → Offhand/, 'idle editor exposes an explicit Mirror Animation-style main-to-offhand authoring action');
assert.match(editor, /mirrorDualWieldMainToOffhand/, 'idle editor saves the mirrored result as a normal editable offhand pose');
assert.match(editor, /bodyYaw: Number\(main\.bodyYaw\) \|\| 0/, 'main-to-offhand mirror deliberately preserves body yaw');
assert.match(editor, /Preview Dual Wield Pair/, 'idle editor can preview both explicitly authored poses together');
assert.match(editor, /if \(dualPairPreviewActive\(\)\) setDualPairPreview\(false\)/, 'offhand gizmo editing isolates the explicit offhand weapon');
assert.match(editor, /previewDualWieldMain/, 'attack hand-mode UI can switch Neutral preview to the shared dual idle main pose');
assert.match(editor, /input\.disabled = selectedKey === 'dualWieldOffhand' && field\.key === 'bodyYaw'/, 'offhand pose shares main body yaw instead of inventing a second body rotation');

assert.match(runtime, /if \(dualWield !== false && window\.HobunjiHandToolGrips\?\.isDualWieldWeapon/, 'runtime holder uses authored dual main while dual wielding');
assert.match(runtime, /dualWieldIdleRequested/, 'runtime attacks select the dual idle from Neutral hand metadata');
assert.match(grips, /runtimeIdleDualWield/, 'hand-mode state persists dual idle after a dual attack ends');
assert.match(grips, /dualWieldIdleBlend/, 'Neutral-to-attack transitions expose a continuous idle-pose blend');
assert.match(grips, /const canDual = melee;/, 'Neutral Dual Wield is authorable beside the existing hand-mode controls');
assert.match(dual, /idleOffhandLocalTransform/, 'dual visuals convert the explicit body-relative offhand stance into the hidden-plane hierarchy');
assert.match(dual, /sideDistance = basePosition\.clone\(\)\.sub\(bodyPosition\)\.dot\(bodyRight\)/, 'idle offhand mirrors the actual hand-side anchor across the character midline');
assert.match(dual, /targetHolderPosition = mirroredBasePosition\.add\(offPoseOffset\)/, 'authored offhand pose is applied after the anchor has moved to the other hand');
assert.match(dual, /HALF_Z_SEPARATION = DUPLICATE_Z_GAP \* 0\.5/, 'the two sprite planes straddle the hidden original with a 0.30 total gap');

// This contract intentionally covers both the mirrored default and later non-mirrored authored offhand edits.
console.log('dual wield idle stance: Mirror Animation-style other-hand default without bodyYaw flip, editable offhand pose, pair preview, and runtime persistence PASS');
