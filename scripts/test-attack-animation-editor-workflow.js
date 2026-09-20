const assert = require('assert');
const fs = require('fs');

const editor = fs.readFileSync('docs/tools/attack-animation-editor/index.html', 'utf8');
const heldActions = fs.readFileSync('docs/js/held-action-animations.js', 'utf8');
const meleeSpacing = fs.readFileSync('docs/js/combat/melee-pose-spacing.js', 'utf8');

// Parse-check the browser module after stripping static ESM imports.
const moduleMatch = editor.match(/<script type="module">([\s\S]*?)<\/script>/);
assert(moduleMatch, 'editor module script must exist');
const parseSource = moduleMatch[1].replace(/^\s*import\s+.*?;\s*$/gm, '');
assert.doesNotThrow(() => new Function(parseSource), 'editor module must remain syntactically valid');

// One gameplay action selector owns both animation and practical context.
assert.match(editor, /id="actionSelect"/, 'unified Action selector must exist');
assert.match(editor, /const ACTION_DEFS = \[/, 'Action registry must drive editor state');
assert.match(editor, /applySelectedAction\(\)/, 'Action changes must apply animation and practical context together');
assert.doesNotMatch(editor, /id="presetSelect"|\$\('presetSelect'\)/, 'retired preset selector must not return');
assert.doesNotMatch(editor, /id="statSlotSelect"|\$\('statSlotSelect'\)/, 'retired independent stats selector must not return');

// Non-attacks are first-class actions with zero practical attack effects.
for (const id of ['crossbow_load', 'scatterbow_load', 'drink']) {
  assert.match(editor, new RegExp(`id: '${id}'[^\\n]*practical: false`), `${id} must be a non-attack Action`);
}
for (const id of ['weapon_throw', 'flask_throw']) {
  assert.match(editor, new RegExp(`id: '${id}'[^\\n]*heldAnimationKey:`), `${id} must be a first-class Action backed by HeldActionAnimations`);
}
assert.match(editor, /const ZERO_PRACTICAL_FIELDS = \[/, 'non-attacks must render explicit zero practical fields');
assert.match(editor, /value="0" disabled data-zero-practical/, 'zero practical fields must be locked rather than mutating shared combat config');
assert.match(editor, /Effective attack damage, range, hit cone, knockback, and attack stamina cost are all 0/, 'non-attack zero semantics must be visible');

// One editPhase owns tabs, sliders, and TransformControls.
assert.match(editor, /let editPhase = 'windup'/, 'single editPhase state must exist');
assert.match(editor, /id="activePosePanel"/, 'only one pose control panel should be rendered');
assert.match(editor, /selectEditPhase\(phase/, 'pose tabs must drive the unified edit state');
assert.match(editor, /const p = anim\.poses\[editPhase\]/, 'gizmo must edit the same selected pose');
assert.doesNotMatch(editor, /id="gizmoPhase"|\$\('gizmoPhase'\)/, 'separate gizmo phase selector must not return');
assert.doesNotMatch(editor, /id="panelNeutral"|id="panelWindup"|id="panelStrike"/, 'three always-open pose panels must not return');
assert.doesNotMatch(editor, /scrubNeutralBtn|scrubWindupBtn|scrubStrikeBtn/, 'separate scrub-to-pose buttons must not return');
assert.match(editor, /js\/combat\/melee-pose-spacing\.js/, 'Attack Editor must load the exact shared melee spacing math used by gameplay');
assert.match(editor, /actionUsesMeleeSpacing\(action\)[\s\S]*MeleePoseSpacing\?\.adjustEndpoint[\s\S]*if \(action\.mirror\)/, 'editor must apply shared spacing before Backhand mirroring so each attack keeps its own ray');
assert.match(meleeSpacing, /const Y_LIFT = 0\.17/, 'shared melee spacing must retain the uploaded +0.17 Y calibration');
assert.match(meleeSpacing, /targetRange = Math\.max\(0, original\.rangeXY \+ delta\)/, 'shared spacing must add the measured Forehand range delta instead of copying Forehand X');
assert.match(editor, /resetPosesBtn'[\s\S]*applySelectedAction\(\{ play: false \}\)/, 'Reset action must restore the selected Action source, not generic pose defaults');

// Action choice drives concrete runtime timing where attack-values owns it.
assert.match(editor, /function applyRuntimeTimingForAction\(/, 'runtime timing mapper must exist');
assert.match(editor, /entry\?\.reloadDurationS/, 'crossbow/scatterbow load must use reload timing');
assert.match(editor, /entry\?\.fireDurationS/, 'crossbow/scatterbow fire must use fire timing');
assert.match(editor, /runtimeSwingTiming\(entry\?\.windupS, entry\?\.strikeS/, 'combo Action timing must come from its combat record');
assert.match(editor, /id="strikeFrac"[^>]*max="1"/, 'exact 100% strike endpoints must be authorable');
assert.match(editor, /id="holdFrac"[^>]*max="1"/, 'exact 100% hold endpoints must be authorable');

// Shared held actions are consumed directly; old DOM injection bridge is retired.
assert.doesNotMatch(heldActions, /presetSelect|loadPresetBtn|statSlotSelect|installCounterShieldEditorPreset/, 'held-action library must not mutate Attack Editor DOM state');
assert.match(heldActions, /Attack Animation Editor now reads HeldActionAnimations directly/, 'shared held-action ownership should be explicit');

console.log('attack animation editor unified workflow regression: ok');
