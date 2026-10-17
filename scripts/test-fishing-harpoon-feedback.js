const assert = require('assert');
const fs = require('fs');
const read = path => fs.readFileSync(path, 'utf8');

const fishing = read('docs/js/fishing-minigame.js');
const events = read('docs/js/fishing-events.js');
const catalog = read('docs/js/fish-catalog.js');
const config = read('docs/config/scratchbones-config.js');
const music = read('docs/js/music-system.js');

assert.match(config, /"fishCaught"[^\n]*"duckBackground": true[^\n]*"duckOutMs": 90[^\n]*"duckInMs": 260/, 'fish catch cue authors a fast temporary BGM duck');
assert.match(config, /"harpoonHit"\s*:\s*\{\s*"url"\s*:\s*"assets\/audio\/sfx\/sfx_harpoon_hit_1\.mp3"/, 'harpoon hit uses the authored SFX asset');
assert(fs.existsSync('docs/assets/audio/sfx/sfx_harpoon_hit_1.mp3'), 'authored harpoon hit asset exists');
assert.match(music, /_gameplayCueDuckOwners/, 'music transport tracks temporary gameplay-cue duck ownership');
assert.match(music, /setGameplayCueBackgroundDuck\(true, duckOutMs\)/, 'gameplay cue ducks scheduler-owned background tracks');
assert.match(music, /setGameplayCueBackgroundDuck\(false, duckInMs\)/, 'gameplay cue restores background tracks after the sting');
assert.match(music, /addEventListener\('play', beginGameplayCueDuck/, 'gameplay cue begins ducking only when its media actually starts');
assert.match(music, /if \(errName === 'NotAllowedError'\) return;/, 'autoplay-blocked gameplay cues remain alive for the shared unlock retry');
assert.match(music, /shouldDuck \|\| _gameplayCueDuckOwners\.size > 0/, 'lyre state changes cannot release an active gameplay-cue duck');

assert.match(fishing, /CombatVocalizations\?\.playDodge\?\.\(\)/, 'harpoon launch reuses the species/gender-modulated dodge utterance');
assert.match(fishing, /playWeaponSlashSfx\?\.\(undefined, 0\)/, 'harpoon launch deterministically follows with swing 1');
assert.match(fishing, /HARPOON_THROW_SWING_DELAY_MS = 70/, 'harpoon throw vocal and swing remain in quick succession');
assert.match(fishing, /caughtFish = true;\s*window\.AudioSystem\?\.playCombatSfxKey\?\.\('harpoonHit'\)/, 'main fish collision plays harpoon hit immediately');
assert.doesNotMatch(fishing, /awardToolUseMasteryXp\('harpoon'\);\s*window\.AudioSystem\?\.playWeaponSlashSfx/, 'catch finalization no longer emits an unrelated random swing');
assert.match(fishing, /beginFishCatchView\(fm, stars\);\s*window\.Music\?\.playGameplayCue\?\.\('fishCaught'\)/, 'catch sting begins once the showoff stage starts');
assert.match(events, /distance <= GULLET_CONFIG\.hitRadius[\s\S]{0,120}playCombatSfxKey\?\.\('harpoonHit'\)/, 'Gullet collision uses the same harpoon hit cue');

assert.match(catalog, /caughtFishIsRetracting[\s\S]*retractTimer\)>0/, 'colored fish replacement begins on the first retraction movement frame');
assert.match(catalog, /getRecoloredCanvas\(spritePath,key\)/, 'retrieval sprite reuses FishCatalog authored recolor/pattern rendering');
assert.match(catalog, /caughtSpriteUrl[\s\S]*renderCurvedFishFrame/, 'colored retrieval sprite replaces the silhouette in the existing fish image');
assert.match(catalog, /image\.style\.transform=`scale\(\$\{sx\},\$\{sy\}\)`/, 'retrieval keeps the same authored minigame scale as the silhouette');

console.log('Fishing harpoon/catch feedback wiring tests passed.');
