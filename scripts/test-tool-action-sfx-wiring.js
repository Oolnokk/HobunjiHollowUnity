const fs = require('fs');
const assert = require('assert');
const game = fs.readFileSync('docs/game.js', 'utf8');
const config = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8');
for (const file of ['sfx_dig.mp3', 'sfx_pick.mp3', 'sfx_chop.mp3', 'sfx_break_tree.mp3', 'sfx_break_rock.mp3']) {
  assert(config.includes(`assets/audio/sfx/${file}`), `missing configured ${file}`);
}
assert(!config.includes('assets/audio/sfx/farming/sfx_dig.mp3'), 'dig must not use the legacy farming path');
assert(game.includes("sfxKey: 'dig'"), 'shovel contact stages need dig SFX');
assert(game.includes("sfxKey: 'chop'"), 'axe chop stages need chop SFX');
assert(game.includes("sfxKey: 'pick'"), 'pick mine stages need pick SFX');
assert(game.includes("chargeAction && !strikeFired && progress >= SF"), 'held stages must fire at the shared strike fraction');
assert(game.includes("pendingAction.tool === 'shovel'"), 'single-strike shovel actions need dig SFX');
assert(game.includes("playConfiguredToolSfx('breakTree')"), 'tree terminal success needs break SFX');
assert(game.includes("playConfiguredToolSfx('breakRock')"), 'rock terminal success needs break SFX');
assert(!/refillTwist(?:Out|Back)'[^\n]*sfxKey/.test(game), 'shovel twist stages must stay silent');
assert(!/refillReset'[^\n]*sfxKey/.test(game), 'shovel reset stage must stay silent');
assert(!/anim: 'toss'[^\n]*sfxKey/.test(game), 'dirt toss stages must stay silent');
console.log('tool action SFX wiring: ok');
