const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(repo, file), 'utf8');

// The registry module: add/list/clear lifecycle that game.js's cutscene cleanup relies on.
const window = {};
vm.runInContext(read('docs/js/cutscene-lantern-carriers.js'), vm.createContext({ window }), { filename: 'cutscene-lantern-carriers.js' });
const carriers = window.CutsceneLanternCarriers;
const a = { id: 'a' }, b = { id: 'b' };
assert.equal(carriers.active(), false);
carriers.add(a); carriers.add(b); carriers.add(null);
assert.equal(carriers.list().size, 2, 'null roots are ignored');
carriers.remove(a);
assert.deepEqual([...carriers.list()], [b]);
carriers.clear();
assert.equal(carriers.active(), false, 'cleanup leaves no carriers behind');

// The rescue scene marks exactly the player and the two rescuers as lantern carriers.
const rescue = read('docs/js/opening-story-cutscene.js');
const flagged = [...rescue.matchAll(/id: '([a-z0-9_]+)'[^\n]*?lantern: true/g)].map(m => m[1]).sort();
assert.deepEqual(flagged, ['jubmir', 'player', 'spearhead'], 'wolves, hounds and the Hunundi-room cast carry no lantern');

// Wiring: loaded before weather-fx, registered per actor, cleared in the cutscene cleanup path, drawn by the lantern mask.
const html = read('docs/index.html');
assert.ok(html.search(/cutscene-lantern-carriers\.js\?v=/) !== -1 && html.search(/cutscene-lantern-carriers\.js\?v=/) < html.search(/weather-fx\.js\?v=/), 'carrier registry loads before WeatherFX');
assert.match(read('docs/game.js'), /actor\.lantern\) window\.CutsceneLanternCarriers\?\.add\(entity\.root\)/);
assert.match(read('docs/game.js'), /entities\.clear\(\);\s*window\.CutsceneLanternCarriers\?\.clear\(\)/);
assert.match(read('docs/js/weather-fx.js'), /CutsceneLanternCarriers/);
console.log('cutscene lantern carriers ok');
