'use strict';
// Every gameplay attack the attack-animation editor lists must show a template
// from js/combat/attack-pose-templates.js, the same template the game plays for
// it, so an attack looks in-game the way it looks when selected in the editor.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'docs');
const window = {};
vm.runInContext(fs.readFileSync(path.join(root, 'js/combat/attack-pose-templates.js'), 'utf8'), vm.createContext({ window, JSON }));
const T = window.AttackPoseTemplates;
const editor = fs.readFileSync(path.join(root, 'tools/attack-animation-editor/index.html'), 'utf8');
const actions = new Map([...editor.matchAll(/\{ id: '([a-z_]+)', group: '[^']+', label: '[^']+',[^\n]*templateId: '([a-z_]+)'/g)].map(m => [m[1], m[2]]));

// Which template each game module plays (combat-combo.js registerCombo, quick
// attacks, charged breaker, flurry).
const GAME = {
  swing_forehand: 'hatchet_swing', swing_backhand: 'hatchet_swing', swing_cleave: 'hatchet_swing',
  poke_short: 'pickshovel_swing', poke_step: 'pickshovel_swing', poke_long: 'pickshovel_swing',
  quick_opportunist: 'pickshovel_swing', quick_exhaust: 'pickshovel_swing', quick_backstab: 'pickshovel_swing', quick_mercy: 'pickshovel_swing',
  charged_breaker: 'hatchet_swing', flurry: 'hatchet_swing',
};
for (const [actionId, templateId] of Object.entries(GAME)) {
  assert.strictEqual(actions.get(actionId), templateId, `${actionId}: editor shows ${actions.get(actionId)}, game plays ${templateId}`);
  assert.ok(T.TEMPLATES[templateId], `${templateId} is a shared template`);
}
for (const templateId of new Set(Object.values(GAME))) {
  assert.ok(editor.includes(`...sharedAttackPoses('${templateId}')`), `editor sources ${templateId} from the shared module`);
}

// The editor's power rule: power turns only a sweep's body further.
const cleave = T.poseFor('hatchet_swing', 1.3);
assert.ok(Math.abs(cleave.windup.bodyYaw - T.TEMPLATES.hatchet_swing.windup.bodyYaw * 1.3) < 1e-9);
assert.strictEqual(cleave.windup.yaw, T.TEMPLATES.hatchet_swing.windup.yaw);
assert.deepStrictEqual(T.poseFor('pickshovel_swing', 1.35), T.poseFor('pickshovel_swing'), 'thrust templates ignore power, like the editor');
assert.ok(Object.isFrozen(T.TEMPLATES.hatchet_swing.windup), 'templates cannot be mutated through poseFor callers');
console.log('attack pose templates: editor/game parity ok');
