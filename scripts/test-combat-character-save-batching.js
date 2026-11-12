'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let saved = JSON.stringify({ characters: [{ id: 'a' }, { id: 'b' }], worlds: [{ id: 'farm' }] }); // Shared metadata updated by the real writer.
let writes = 0; // Counts synchronous storage writes.
let failWrite = false; // Simulates a transient localStorage failure before the next flush.
const idle = []; // Queued callbacks are advanced explicitly.
const listeners = new Map(); // Allows a pagehide flush without a real browser.
const document = { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn) };
const window = {
  document, __hobunjiPlayerProfile: { characterId: 'a' },
  requestIdleCallback: fn => idle.push(fn),
  addEventListener: (name, fn) => listeners.set(name, fn),
};
const localStorage = {
  getItem() { return saved; },
  setItem(key, value) {
    assert.equal(key, 'hobunjiSaveMeta');
    if (failWrite) throw new Error('temporarily unavailable');
    saved = value;
    writes++;
  },
};
vm.runInNewContext(fs.readFileSync('docs/js/character-meta-save.js', 'utf8'), { window, localStorage });
const saves = window.CharacterMetaSave;
const gear = { motesOfProwess: 1 }; // The same live gear object is used by Motes, mastery and armor.
saves.schedule({ gearInventory: gear });
gear.motesOfProwess++;
saves.schedule({ gearInventory: gear });
saves.schedule({ skillLevels: { combat: 2 }, skillExperience: { combat: 40 } });
assert.equal(writes, 0, 'combat rewards are live before storage work runs');
assert.equal(idle.length, 1, 'gear and skill changes schedule one flush');
idle.shift()();
assert.equal(writes, 1, 'coalesced progression writes once');
assert.deepEqual(JSON.parse(saved).characters[0], {
  id: 'a', gearInventory: { motesOfProwess: 2 }, skillLevels: { combat: 2 }, skillExperience: { combat: 40 },
});

saves.schedule({ skillExperience: { combat: 50 } });
assert(saves.update(character => { character.skillExperience = { combat: 60 }; }));
idle.shift()();
assert.equal(writes, 2, 'an explicit save absorbs the pending write');
assert.equal(JSON.parse(saved).characters[0].skillExperience.combat, 60, 'the newer explicit update wins');

saves.schedule({ skillExperience: { combat: 70 } });
window.__hobunjiPlayerProfile = { characterId: 'b' };
saves.schedule({ skillExperience: { combat: 10 } });
failWrite = true;
idle.shift()();
assert.equal(writes, 2);
failWrite = false;
listeners.get('pagehide')();
assert.equal(writes, 4, 'pagehide retries pending writes after a failed idle flush');
const meta = JSON.parse(saved);
assert.equal(meta.characters[0].skillExperience.combat, 70);
assert.equal(meta.characters[1].skillExperience.combat, 10, 'deferred writes stay with the character who earned them');
assert.deepEqual(meta.worlds, [{ id: 'farm' }], 'character saves preserve world data');

saves.schedule({ skillExperience: { combat: 20 } });
saved = JSON.stringify({ characters: [{ id: 'b', skillExperience: { combat: 3 } }] }); // A recovery import replaced this tab's browser data.
window.HobunjiSessionPersistenceStartupGuard = { exitFlushSuppressed: () => 'recovery-restore' };
idle.shift()();
document.hidden = true;
listeners.get('visibilitychange')();
listeners.get('pagehide')();
assert.equal(writes, 4, 'the old tab cannot write queued rewards over the restored save');
assert.equal(JSON.parse(saved).characters[0].skillExperience.combat, 3);
