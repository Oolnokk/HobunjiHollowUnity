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
const hostileStart = afterimages.indexOf('function updateEnemyCombatPresentation()'); // Keeps the frown-before-trail contract scoped to the runtime frame owner.
const hostileEnd = afterimages.indexOf('function updateMotionSmears(dt)', hostileStart); // Terminates the hostile presentation function.
assert(hostileStart >= 0 && hostileEnd > hostileStart, 'hostile portrait and motion smear presentation remain in one update seam');
const hostilePresentation = afterimages.slice(hostileStart, hostileEnd); // Compared below rather than pinning old frozen-snapshot syntax.
assert(
  hostilePresentation.indexOf('setCombatExpression?.(entity, inCombat)') <
  hostilePresentation.indexOf('spawnAfterimageForRoot(entity.avatarRef.group'),
  'enemy frown is applied before the shared-texture motion smear reads its source portrait'
);
assert.match(
  afterimages,
  /const material = sourceMaterial\.clone\(\);[\s\S]{0,950}material\.onBeforeCompile =/,
  'the motion smear clones only presentation material state and leaves the source portrait material untouched'
);
assert.match(
  afterimages,
  /sourceTextures: sourceMaterials\.map\(mat => \[mat\.map, mat\.alphaMap, mat\.emissiveMap\]\)/,
  'the smear observes the live current colored portrait maps without snapshotting stale frown pixels'
);
assert.doesNotMatch(
  afterimages,
  /document\.createElement\('canvas'\)|boneTransform\(/,
  'frown motion smears never CPU-bake geometry or clone the face canvas'
);
assert.match(
  afterimages,
  /if \(entry\.ownsGeometry\) entry\.mesh\.geometry\.dispose\?\.\(\)/,
  'smear cleanup releases only its own geometry, not the character portrait'
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
