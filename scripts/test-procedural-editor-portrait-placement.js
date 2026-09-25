'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const editorPath = path.join(root, 'docs/tools/procedural-animation-editor/index.html');
const snapshotPath = path.join(root, 'docs/js/attachment-rig-latest-authored-snapshot-core.js');
const defaultsPath = path.join(root, 'docs/config/character-rig-scale-defaults.js');
const maoaoAuthoredPath = path.join(root, 'docs/js/character-rig-maoao-authored-20260905.js');

const editor = fs.readFileSync(editorPath, 'utf8');
const snapshot = fs.readFileSync(snapshotPath, 'utf8');
const defaults = fs.readFileSync(defaultsPath, 'utf8');
const maoaoAuthored = fs.readFileSync(maoaoAuthoredPath, 'utf8');

const requiredRuntimeOrder = [
  "'config/scratchbones-config.js'",
  "'config/attachment-rig-profiles.js'",
  "'config/hand-model-profiles.js'",
  "'js/portrait-utils.js'",
  "'js/png-plane-avatar.js'",
  "'config/character-rig-scale-defaults.js'",
  "'js/attachment-rig-latest-authored-snapshot-core.js'",
  "'js/character-rig-maoao-authored-20260905.js'",
  "'js/harlyao-species-runtime.js'",
  "'js/porakaneki-species-runtime.js'",
];
let previous = -1;
for (const token of requiredRuntimeOrder) {
  const at = editor.indexOf(token);
  assert.ok(at > previous, `procedural editor must load gameplay portrait runtime in order; missing/out-of-order ${token}`);
  previous = at;
}

assert.match(editor, /HOBUNJI_ATTACHMENT_RIG_LATEST_SINGLE_APPLY\s*=\s*true/, 'lightweight preview must suppress the Animation Author retry loop');
assert.match(snapshot, /HOBUNJI_ATTACHMENT_RIG_LATEST_SINGLE_APPLY\s*===\s*true/, 'latest-authored snapshot core must support one-shot preview loading');
assert.match(maoaoAuthored, /HOBUNJI_ATTACHMENT_RIG_LATEST_SINGLE_APPLY\s*===\s*true/, 'Mao-ao authored overlay must also avoid its retry loop in the lightweight preview');
assert.match(editor, /window\.applyHobunjiAttachmentRigProfileCorrections\?\.\(\)/, 'latest authored anatomy must be projected back into PNG avatar config before preview build');

assert.match(editor, /function resolvedFullCharacterScaleForPreview\(/, 'preview must resolve Full Character Scale body factors');
assert.match(editor, /HobunjiCharacterRigScaleDefaults\?\.scaleFor\?\./, 'preview Full Character Scale must use canonical species+gender defaults');
assert.match(editor, /anatomy\.rigScaleY/, 'profile-authored body height must override defaults when present');
assert.match(editor, /const root = procedural\.locomotionRoot;/, 'whole-character scale must be applied at the floor-relative root');
assert.match(editor, /root\.scale\.set\(output\.x, output\.y, output\.z\)/, 'floor parent must receive resolved body width/height scale');
assert.match(editor, /coordinateSpace: 'character-floor-parent'/, 'diagnostic must preserve Full Character Scale coordinate contract');

const bindAt = editor.indexOf('bindProceduralModel(t.model, { gameGrounded: true });');
const scaleAt = editor.indexOf('applyFullCharacterScaleToPreview(npc, avatar);');
const feetAt = editor.indexOf('await buildExperimentalFeetForAvatar(avatar.front, t.model, avatar);');
assert.ok(bindAt >= 0 && scaleAt > bindAt && feetAt > scaleAt, 'Full Character Scale must be applied after floor-root construction and before generated extremities join it');

assert.match(editor, /combinedPlaneCenterAboveFloor: 'portraitVerticalPlacementRatio \* finalModelHeight \* fullCharacterScaleY'/, 'verification must include floor-relative body-height scaling');
assert.match(editor, /portraitPlaneCenterAboveFloorBeforeFullCharacterScale/, 'diagnostic must expose pre-Full-Scale center');
assert.match(editor, /portraitPlaneCenterAboveFloor: portraitCenterAfterFullScale/, 'diagnostic must expose final gameplay portrait center');
assert.match(editor, /fullCharacterScaleY:/, 'verification must reject a missing/wrong body-height factor');

// Guard the concrete case that made the visual error easy to misread as bad hips:
// Mao-ao female has both a later portrait placement/scale and a >1 body-height
// factor. Omitting the Full Character Scale layer leaves the portrait much lower.
assert.match(snapshot, /"mao-ao::female"[\s\S]*?"portraitVerticalPlacementRatio":1\.05,"portraitScale":0\.8/, 'latest authored Mao-ao female portrait anatomy must remain available');
assert.match(defaults, /'mao-ao::female': Object\.freeze\(\{ x: 1\.045, y: 1\.30625, head: 0\.9375, offsetY: 0 \}\)/, 'Mao-ao female Full Character Scale Y regression');

const baseHeight = 0.9;
const portraitScale = 0.8;
const placementRatio = 1.05;
const fullScaleY = 1.30625;
const preFullScaleCenter = baseHeight * portraitScale * placementRatio;
const finalCenter = preFullScaleCenter * fullScaleY;
assert.ok(finalCenter > preFullScaleCenter + 0.2, 'Full Character Scale Y must materially raise this portrait relative to the floor');

console.log('Procedural editor gameplay portrait placement parity checks passed.');
