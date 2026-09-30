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
  /function setPlayerCombatExpression\([\s\S]{0,520}setExpression\?\.\('player', 'frown'/,
  'player combat state uses the existing portrait expression composer for frown'
);
assert.match(
  portraitLife,
  /else composer\.clearExpression\?\.\('player'\)[\s\S]{0,240}playerLifeT = Infinity/,
  'leaving combat clears the temporary player frown and immediately schedules a portrait refresh'
);
assert.match(
  afterimages,
  /setCombatExpression\?\.\(entity, inCombat\)[\s\S]{0,1400}spawnAfterimageForRoot\(entity\.avatarRef\.group, 'enemy-dodge'\)/,
  'enemy frown is on the source portrait before a dodge afterimage snapshots it'
);
assert.match(
  afterimages,
  /cloneAfterimageMaterial\(material, opacityScale\)[\s\S]{0,220}combat frown already visible on the source is carried into the ghost/,
  'afterimage material snapshots intentionally retain the currently visible expression texture'
);
assert.match(
  afterimages,
  /updateEnemyCombatPresentation\(\);[\s\S]{0,160}updateForcedMovementAfterimages\(\);/,
  'combat-expression state updates before player dodge/lunge afterimage sampling'
);

console.log('Combat portrait expression presentation regression tests passed');
