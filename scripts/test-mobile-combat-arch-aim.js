'use strict';

// Static regression guard for the mobile action-arch combat aim/release contract.
// Run with: node scripts/test-mobile-combat-arch-aim.js
const fs = require('fs');
const path = require('path');

const gamePath = path.join(__dirname, '..', 'docs', 'game.js');
const source = fs.readFileSync(gamePath, 'utf8');

function assertIncludes(fragment, message) {
  if (!source.includes(fragment)) throw new Error(message + ` (missing: ${fragment})`);
}
function assertExcludes(fragment, message) {
  if (source.includes(fragment)) throw new Error(message + ` (unexpected: ${fragment})`);
}

assertIncludes('let mobileArchCombatAim = null;', 'mobile combat aim state must exist');
assertIncludes("_combatAimRelease = Boolean(_pressSlot || (activeTool === 'ranged' && act === 'shoot'));", 'ranged shoot and melee slots must opt into release-owned aiming');
assertIncludes('setMobileArchCombatAim(ev.pointerId, ang, el.dataset.action, _pressSlot);', 'combat drags must feed the existing action-arch stick vector into shared aim');
assertIncludes('window.Combat.input.pressEnd(_pressSlot);', 'melee press/hold state must survive drag and release normally');
assertExcludes('window.Combat.input.cancelPress(_pressSlot);', 'combat arch drag must never cancel the live melee press/hold state');
assertIncludes('commitMeleeAttackFacing(mobileArchCombatAim.angle);', 'dragged melee release must latch the chosen direction through its strike');
assertIncludes('else if (!_drag || combatAimOwned)', 'dragged ranged input must fire on release instead of threshold-cross');
assertIncludes("clearMobileArchCombatAim(ev.pointerId, 'pointer-cancel');", 'pointer cancellation must not commit an attack');
assertIncludes('updateMobileArchCombatAimLifecycle();', 'released ranged aim must stay latched through the authored fire animation');
assertExcludes('With a weapon equipped, action buttons are tap/hold only', 'legacy weapon drag suppression must stay removed');

console.log('mobile combat arch aim/release regression checks passed');
