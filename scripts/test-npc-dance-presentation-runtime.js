const fs = require('fs');
const assert = require('assert');

const runtime = fs.readFileSync('docs/js/npc-dance-presentation-runtime.js', 'utf8');
const handDriver = fs.readFileSync('docs/js/procedural-hand-frame-driver.js', 'utf8');
const loader = fs.readFileSync('docs/js/character-action-locks.js', 'utf8');

assert.match(handDriver, /sentinel\.renderOrder\s*=\s*-100000/, 'ordinary procedural hand sync must remain at -100000');
assert.match(runtime, /npcDanceHandSyncRenderOrder'\s*,\s*-99990/, 'NPC dance hand sentinel must run after the ordinary hand sync');
assert.match(runtime, /renderScene\?\.overrideMaterial/, 'late local hand animation must not be reapplied during outline override passes');
assert.match(runtime, /frameRestores\.push/, 'late hand pose must restore after each render call');
assert.match(runtime, /setExpression\?\.\(seatId, 'smile'/, 'dancing NPCs must use the authored smile mouth expression');
assert.match(runtime, /clearExpression\?\.\(seatId\)/, 'ending a dance must clear the temporary smile expression');
assert.match(runtime, /document\.createElement\('canvas'\)/, 'expression rebakes must use a scratch canvas rather than mutating the live avatar during async loads');
assert.match(runtime, /generation !== record\.generation/, 'stale async smile renders must never overwrite a newer dance state');
assert.match(runtime, /refreshSinglePlaneAvatarModel/, 'smile rebake must refresh the existing world avatar texture in place');
assert.ok(
  loader.indexOf('npc-social-inhibition-runtime.js') < loader.indexOf('npc-dance-presentation-runtime.js'),
  'presentation repair must load after the NPC social dance target producer'
);
assert.ok(
  loader.indexOf('social-action-camera-runtime.js') < loader.indexOf('npc-dance-presentation-runtime.js'),
  'presentation repair should be the final social render decorator in the parser-time stack'
);

console.log('npc dance presentation runtime checks passed');
