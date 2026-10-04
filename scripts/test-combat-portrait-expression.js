const fs = require('fs');
const assert = require('assert');

const bandit = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
const portraitLife = fs.readFileSync('docs/js/world-portrait-life.js', 'utf8');
const afterimages = fs.readFileSync('docs/js/combat/combat-blink-dodge.js', 'utf8');

assert.match(
  bandit,
  /COMBAT_FROWN_COMPOSER[\s\S]{0,260}getExpression: \(\) => 'frown'/,
  'humanoid hostile avatars pre-bake the authored frown expression'
);
assert.match(
  bandit,
  /combatFrownCanvas[\s\S]{0,500}renderProfileToCanvas\(combatFrownCanvas, profile,[\s\S]{0,260}breathingComposer: COMBAT_FROWN_COMPOSER/,
  'hostile frown art is rendered once from the normal portrait renderer rather than approximated in combat code'
);
assert.match(
  bandit,
  /function setCombatExpression\([\s\S]{0,900}next \? avatarRef\.combatFrownCanvas : avatarRef\.neutralFrontCanvas[\s\S]{0,700}refreshSinglePlaneAvatarModel/,
  'hostile combat entry/exit synchronously swaps the live portrait texture between frown and its exact resting face'
);
assert.match(
  portraitLife,
  /COMBAT_FROWN_COMPOSER[\s\S]{0,260}getExpression: \(\) => 'frown'/,
  'player world portrait pre-bakes the authored frown with the normal portrait renderer'
);
assert.match(
  portraitLife,
  /ensurePlayerCombatFrownCache\(avatar\)[\s\S]{0,900}renderProfileToCanvas\(scratch, avatar\.profile,[\s\S]{0,260}breathingComposer: COMBAT_FROWN_COMPOSER/,
  'player combat frown cache is warmed per current avatar generation before combat'
);
assert.match(
  portraitLife,
  /function setPlayerCombatExpression\([\s\S]{0,900}setExpression\?\.\('player', 'frown'[\s\S]{0,700}applyCachedPlayerCombatFrown\(avatar\)/,
  'player combat state applies the prewarmed frown synchronously when the cache is ready'
);
assert.match(
  portraitLife,
  /expressionVersion !== playerCombatExpressionVersion/,
  'an async portrait render started under an older combat expression cannot upload over the current face'
);
assert.match(
  portraitLife,
  /isPlayerCombatExpressionApplied: \(\) => !playerCombatFrown \|\| playerCombatExpressionApplied/,
  'afterimage code can verify that the current player texture has actually received its combat frown'
);
assert.match(
  afterimages,
  /setCombatExpression\?\.\(entity, inCombat\)[\s\S]{0,1400}spawnAfterimageForRoot\(entity\.avatarRef\.group, 'enemy-dodge',/,
  'enemy frown is on the source portrait before a dodge afterimage snapshots it'
);
assert.match(
  afterimages,
  /ctx\.drawImage\(image,[\s\S]{0,900}texture\.image = canvas/,
  'afterimages deep-copy the currently visible portrait pixels instead of sharing the live texture image'
);
assert.match(
  afterimages,
  /for \(const texture of entry\.frozenTextures \|\| \[\]\) texture\?\.dispose\?\.\(\)/,
  'frozen afterimage textures are disposed with the transient ghost'
);
assert.match(
  afterimages,
  /isPlayerCombatExpressionApplied\?\.\(\) === false\) return false/,
  'player ghosts are withheld during the brief combat-entry handoff until the frown is actually on the live texture'
);
assert.match(
  afterimages,
  /updateEnemyCombatPresentation\(\);[\s\S]{0,160}updateForcedMovementAfterimages\(\);/,
  'combat-expression state updates before player dodge/lunge afterimage sampling'
);
assert.match(
  afterimages,
  /return state === 'chase' \|\| state === 'searching'/,
  'portrait combat state mirrors game.js isPlayerInCombat instead of treating wildlife patrol fights as player combat'
);

console.log('Combat portrait expression presentation regression tests passed');
