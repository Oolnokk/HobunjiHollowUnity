'use strict';

const assert = require('assert');
const fs = require('fs');

const read = path => fs.readFileSync(path, 'utf8');
const editor = read('docs/tools/attack-animation-editor/index.html');
const history = read('docs/js/attack-editor-history.js');
const grips = read('docs/js/hand-tool-grips.js');
const direct = read('docs/js/attack-editor-hand-direct-attachments.js');
const driver = read('docs/js/procedural-hand-frame-driver.js');
const calibration = read('docs/js/attack-editor-hand-inverse-configurator.js');
const configurator = read('docs/js/attack-editor-hand-configurator.js');
const attachments = read('docs/js/procedural-hand-attachments.js');
const gripMode = read('docs/js/attack-editor-hand-grip-mode.js');
const shoulder = read('docs/js/attack-editor-hand-shoulder-controls.js');
const shoulderAim = read('docs/js/procedural-hand-shoulder-aim.js');
const idle = read('docs/js/attack-idle-stance-editor.js');
const idleParity = read('docs/js/attack-editor-idle-hand-parity.js');
const npcHeld = read('docs/js/npc-held-equipment-v4.js');
const onboarding = read('docs/js/onboarding-character-creation-weapon-view-fix.js');
const held = read('docs/js/held-action-animations.js');
const panelUi = read('docs/js/panel-ui.js');

// Global history owns the whole editor, not one panel.
assert.match(editor, /id="editorUndoBtn"/, 'Undo button must be visible in the core editor');
assert.match(editor, /id="editorRedoBtn"/, 'Redo button must be visible in the core editor');
assert.match(editor, /window\.HobunjiAttackEditorState = Object\.freeze/, 'core animation/practical data must expose snapshot+restore state');
assert.match(editor, /attackValuesConfig: cloneEditorStateValue\(attackValuesConfig\)/, 'history must preserve hidden practical values from every Action');
assert.match(history, /const MAX_HISTORY = 160/, 'history must be bounded on mobile');
for (const eventName of ['focusin', 'pointerdown', 'pointerup', 'change', 'click', 'keydown']) {
  assert.match(history, new RegExp(`addEventListener\\('${eventName}'`), `history must delegate ${eventName} edits`);
}
assert.match(history, /document\.querySelectorAll\('input\[id\],select\[id\],textarea\[id\]'\)/, 'history must discover dynamic editable controls rather than hardcoding current panels');
for (const subsystem of [
  'HobunjiAttackEditorState',
  'HobunjiHandModelProfiles',
  'HobunjiHandToolGrips',
  'AttackIdleStanceEditor',
  'HobunjiAttackEditorHandShoulderControls',
  'HobunjiAttackEditorHandGripMode',
]) assert(history.includes(subsystem), `history snapshot/restore missing ${subsystem}`);
assert.match(history, /beginExternal/, 'async imports must be groupable into one Undo step');
assert.doesNotMatch(history, /profileSelect\.dispatchEvent\(new Event\('change'/, 'Undo/Redo must not synthesize a model-selector change after restoring the authoritative profile snapshot');
assert.doesNotMatch(history, /requestAnimationFrame\(\(\) => global\.ProceduralHandFrameDriver\?\.syncNow/, 'Undo/Redo must not run a delayed second hand sync that can race the restored rig');
assert.match(editor, /HobunjiAttackEditorHandGripMode\?\.loadFromAnimationObject/, 'core animation import must include Grip Mode in the same history transaction');
assert.match(editor, /HobunjiAttackEditorHandShoulderControls\?\.loadFromAnimationObject/, 'core animation import must include hand shoulder-follow state in the same history transaction');
assert.doesNotMatch(gripMode, /loadFile\?\.addEventListener\('change'/, 'Grip Mode must not race the core animation import with a second file listener');
assert.doesNotMatch(shoulder, /loadFile\?\.addEventListener\('change'/, 'hand shoulder-follow must not race the core animation import with a second file listener');
assert.match(history, /event\.key\.toLowerCase\(\)/, 'keyboard Undo/Redo shortcuts must be installed');
assert.match(held, /attack-editor-history\.js\?v=/, 'history must load with the Attack Editor hand/grip extension stack');

// Primary grip is now a hand target, never an inverse weapon correction.
assert.match(grips, /grip authoring moves the RIGHT HAND to that frame and never inverse-moves the weapon/, 'grip contract must be explicit');
assert.match(grips, /function primaryGripForTool\(value\)/, 'runtime must return the authored primary hand target');
assert.match(grips, /authored\.position\.x\) \* scale/, 'primary hand target must follow intrinsic weapon scale');
assert.match(grips, /function applyEditorGripPresentation/, 'editor visual path should be presentation-only');
assert.match(grips, /applyHeldItemScale\(visual, toolScaleForTool\(key\)\)/, 'grip presentation may scale the item but not translate/rotate it');
assert.doesNotMatch(grips, /function primaryGripForTool\(\) \{ return identityTransform\(\); \}/, 'old fixed-hand identity target must not return');
assert.doesNotMatch(grips, /function inverseTransform|function composePrimaryInverseWithPoint/, 'dead inverse-weapon grip math must not remain after hand-target migration');
assert.match(grips, /position: \{ x: 0, y: 0, z: itemZ \* itemScale \}/, 'secondary hand span must also resolve directly in item space');

assert.match(direct, /Right-hand target on weapon/, 'grip UI must name what is being authored');
assert.match(direct, /blue marker is where the right hand is being told to grip/i, 'blue marker semantics must be explained');
assert.match(direct, /weapon will not move/i, 'pick mode must say that it moves the hand target');
assert.match(direct, /0x60a5fa/, 'primary target marker must be visibly blue');
assert.match(direct, /X rotation°/, 'grip UI must use axis rotation names');
assert.match(calibration, /Hand Model Calibration · position correction/, 'handFromTool must be framed as per-model calibration');
assert.match(configurator, /Calibrate GLB/, 'hand model calibration must have its own dedicated editor tab');
assert.match(configurator, /No attack animation, tool transform, Grip Mode, shoulder targeting, character-facing rotation, or animation-derived hand transform/, 'calibration tab must declare its isolated transform contract');
assert.match(gripMode, /Grip mode · generic palm relationship/, 'grip mode must explain its middle layer');

// Live hand editing has one store-backed path. Calibration must never rely on
// Undo/Redo, repeated RAF retries, polling, or GLB reconstruction to become visible.
assert.match(configurator, /Current species hand model/, 'editor must expose one model selector for both rendered and edited hand model');
assert.doesNotMatch(configurator, /handSpeciesModelSelect/, 'duplicate species-model selector must not return');
assert.match(configurator, /kind: 'model-mapping'/, 'changing the one hand-model selector must update the current species mapping');
assert.match(calibration, /profiles\.updateModelHandTransform\?\.\(key, mutator\)/, 'calibration sliders must mutate through the profile store and notify subscribers');
assert.doesNotMatch(calibration, /requestAnimationFrame\(syncPreview\)|requestAnimationFrame\(\(\) => requestAnimationFrame\(syncPreview\)\)|setInterval\(syncPreview/, 'calibration preview must not depend on retry/poll wake-ups');
assert.match(driver, /change\?\.kind === 'hand-transform'/, 'frame driver must react directly to store-backed calibration notifications');
assert.match(attachments, /change\?\.kind === 'hand-transform'[\s\S]*syncPaperHandGuide\(profileValues\(\)\)[\s\S]*return;/, 'hand-transform notifications must not rebuild hand GLBs or run a second calibration resolver');
assert.match(driver, /modelCalibrationForRecord\(record\)[\s\S]*placeHandWorld\?\.\('right',[\s\S]*modelCalibration\)/, 'frame driver must pass the exact selected-model calibration to the rig every sync');
assert.match(attachments, /function applyToolCalibration\(side, authored = null\)/, 'attachment rig must expose a direct child-calibration application path');
assert.match(direct, /requestAnimationFrame\(\(\) => global\.ProceduralHandFrameDriver\?\.syncNow\?\.\(\)\)/, 'weapon grip target edits may still defer one matrix-settle sync');
assert.doesNotMatch(gripMode, /profiles\.handTransformForSpecies\s*=/, 'Grip Mode must not monkey-patch the profile resolver');

// Coordinate labels say whose transform is being edited.
for (const source of [editor, direct, calibration, idle]) {
  assert.doesNotMatch(source, /label:\s*'Pitch°'|label:\s*'Yaw°'|label:\s*'Roll°'|label:\s*'Tool Yaw°'|label:\s*'Tool Roll°'/, 'visible rotation fields must not use pitch/yaw/roll terminology');
}
assert.match(editor, /Tool X rotation°/, 'tool pose must label X rotation');
assert.match(editor, /Character Y rotation°/, 'character rotation must be distinguished from tool rotation');
assert.match(calibration, /GLB local X rotation correction°/, 'hand-model calibration must label user-facing rotation as GLB-local');
assert.match(calibration, /All rotation controls are local to <code>right_hand_calibration<\/code>/i, 'hand-model rotation UI must explicitly define the user-facing local coordinate space');
assert.match(calibration, /Snap local rotation to 90°/, 'calibration UI must expose exact local right-angle snapping');
assert.match(calibration, /rotationCorrectionDeg\[field\.key\]/, 'hand-model rotation controls must write explicit orthogonal quaternion XYZ correction coordinates');
assert.doesNotMatch(calibration, /rotationCorrectionVectorDeg|transform\.rotationDeg\[field\.key\]\s*=\s*value/, 'retired vector/Euler calibration paths must not remain');
assert.match(calibration, /id="handShowPaperHandGuide" checked disabled/, 'calibration tab must keep the neutral paper-hand reference permanently enabled');
assert.match(calibration, /folds never animate independently/i, 'paper-hand UI must explain that the reference shape is locked');
assert.match(calibration, /directing an LLM/i, 'paper-hand UI must document its descriptive-reference purpose');
assert.match(calibration, /HobunjiAttackEditorHandCalibrationMode\?\.active === true[\s\S]*setShowPaperHandGuide\?\.\(active\)/, 'paper-hand visibility must be driven exclusively by calibration-tab state');
assert.match(attachments, /function buildPaperHandReference\(THREE\)/, 'procedural hand preview must build the paper reference lazily');
for (const part of ['paperHandGripOrb','paperPalm','paperFinger1','paperFinger2','paperFinger3','paperThumb1','paperThumb2']) {
  assert(attachments.includes(part), `paper hand is missing ${part}`);
}
assert.match(attachments, /const gripOrb[\s\S]*color:\s*0x60a5fa[\s\S]*gripOrb\.name = 'paperHandGripOrb'/, 'paper-hand calibration rig must include its own blue origin orb');
assert.match(attachments, /paperHandCalibrationOrigin = true/, 'blue orb must mark the exact paper-hand calibration origin');
assert.match(calibration, /blue orb built into the paper rig at its exact local origin/i, 'calibration UI must explain that the blue orb belongs to the neutral paper rig');
assert.match(attachments, /wireframe:\s*true/, 'paper hand must render as wireframe planes');
assert.match(attachments, /depthTest:\s*false/, 'paper hand must x-ray through the hand model');
assert.match(attachments, /depthWrite:\s*false/, 'paper hand must not disturb scene depth');
assert.match(attachments, /if \(!showPaperHandGuide && !paperGuide\) return/, 'paper hand geometry must remain lazy/editor-only until enabled');
assert.match(attachments, /right_hand_paper_reference_socket/, 'paper hand must use a socket separate from the calibrated GLB hand socket');
assert.match(attachments, /\$\{side\}_hand_calibration/, 'hand model calibration must have a named child transform separate from the hand socket');
assert.match(attachments, /rec\.calibration\.add\(visual\)/, 'GLB visual must be parented beneath the calibration child');
assert.match(driver, /syncCalibrationWorkspace\(record,[\s\S]*neutralWorldQuaternion: true,[\s\S]*bypassesAnimation: true,[\s\S]*bypassesShoulderAim: true/, 'calibration tab must bypass the normal animation, tool and shoulder stack');
assert.match(attachments, /placeCalibrationPreviewWorld\(worldPosition, worldQuaternion, modelCalibration = null\)/, 'calibration tab must use a placement method outside wrapped gameplay hand placement');
assert.doesNotMatch(shoulderAim, /toolCalibrationLocal|hand_calibration/, 'shoulder-follow must remain completely independent of model calibration');
assert.match(attachments, /lockedReference = true/, 'paper hand must identify itself as a locked reference, not an animatable rig');
assert.match(attachments, /lockedTo: 'raw-primary-grip-frame-before-grip-mode-and-hand-model-calibration'/, 'paper hand must remain locked to the raw weapon target before downstream hand layers');
assert.match(driver, /placePaperHandGuideWorld\?\.\(primarySocket\.position, primarySocket\.quaternion\)[\s\S]*handSocketAfterGripMode\(record, primarySocket\)/, 'paper reference must be placed before Grip Mode moves the socket');
assert.match(shoulder, /This rotates the HAND, never the weapon/, 'shoulder-follow layer must declare its transform owner');
assert.match(shoulder, /\[\['pitch','X'\],\['yaw','Y'\],\['roll','Z'\]\]/, 'shoulder-follow controls must map legacy pitch/yaw/roll storage to X/Y/Z rotation labels');

// Old post-refactor stale paths must not remain.
assert.match(idle, /poseTabNeutral/, 'Idle Stance editor must use the unified single-pose panel');
assert.doesNotMatch(idle, /neutral_\$\{fieldKey\}/, 'Idle Stance editor must not look for retired neutral_* controls');
assert.match(idleParity, /STANCE_BY_ACTION/, 'idle-hand parity must key off unified Action ids');
assert.doesNotMatch(idleParity, /scrubNeutralBtn/, 'idle-hand parity must not wait on retired scrub buttons');
assert.match(panelUi, /attack-idle-stance-editor\.js\?v=20260919history1/, 'idle stance cache key must ship the unified-panel/history update');

// The same hand-target contract must hold in non-player preview/NPC paths.
assert.match(npcHeld, /Authored point\/orientation ON the weapon where the right hand must land/, 'NPC hands must consume the authored weapon target');
assert.match(npcHeld, /function applyGripScale/, 'NPC weapon visuals should only receive intrinsic scale from grip config');
assert.match(onboarding, /Grip target semantics: move hand target, not the weapon|Blue\/editor grip target semantics: move hand target, not the weapon/, 'onboarding preview must follow the same hand-target contract');
assert.match(onboarding, /socketPosition\.add\(new THREE\.Vector3/, 'onboarding hand socket must include authored grip position');

console.log('attack editor history + hand grip semantics regression: ok');
