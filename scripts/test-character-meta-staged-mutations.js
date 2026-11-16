'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const data = new Map(); // Simulated browser data so every full metadata rewrite is counted.
let writes = 0; // A staged lock penalty should not cause an immediate browser write.
data.set('hobunjiSaveMeta', JSON.stringify({
  characters: [{ id:'hero', nickname:'Farmer', chestLockProgress:{ farm:{ first:{ misses:1, stage:0 } } } }, { id:'other', nickname:'Other' }],
  worlds:[{ id:'farm' }],
}));
const localStorage = {
  getItem:key=>data.get(key) ?? null,
  setItem(key,value) { writes++; data.set(key,String(value)); },
};
const window = {
  __hobunjiPlayerProfile: { characterId:'hero', worldId:'farm' },
  addEventListener() {},
  document: { addEventListener() {} },
};
vm.runInNewContext(fs.readFileSync('docs/js/character-meta-save.js','utf8'), { window, localStorage });
const api = window.CharacterMetaSave;
assert.equal(typeof api.stageMutation,'function');

const stageLock = (misses) => api.stageMutation('lock:farm:second', character => {
  character.chestLockProgress ||= {};
  character.chestLockProgress.farm ||= {};
  character.chestLockProgress.farm.second = { version:2, stage:0, misses, folderUnsynced:false };
}); // Stable key collapses multiple in-flight states for the same lock.
assert.equal(stageLock(2), true);
assert.equal(stageLock(3), true);
assert.equal(writes, 0, 'folder-backed lock progress does not stringify browser meta synchronously');

const captured = JSON.parse(data.get('hobunjiSaveMeta')); // Live runtime capture begins with the existing browser save.
api.capturePending(captured);
assert.equal(captured.characters[0].chestLockProgress.farm.second.misses,3);
assert.equal(captured.characters[0].chestLockProgress.farm.first.misses,1,'unrelated locks survive narrow staged updates');
assert.equal(captured.characters[1].chestLockProgress,undefined,'other characters are not mutated');
assert.equal(writes,0,'capturePending modifies only the provided in-memory snapshot');

api.update(character => { character.nickname='Updated'; });
assert.equal(writes,1,'an unrelated immediate writer merges all staged progression in one browser write');
assert.equal(JSON.parse(data.get('hobunjiSaveMeta')).characters[0].chestLockProgress.farm.second.misses,3);

api.stageMutation('lock:farm:third', character => { character.chestLockProgress.farm.third={misses:5}; });
assert.equal(writes,1);
api.flush();
assert.equal(writes,2,'pagehide flush remains a browser durability fallback for staged changes');
assert.equal(JSON.parse(data.get('hobunjiSaveMeta')).characters[0].chestLockProgress.farm.third.misses,5);
api.flush();
assert.equal(writes,2,'already-flushed stage changes are not rewritten');

window.__hobunjiPlayerProfile={ characterId:'other', worldId:'farm' };
api.stageMutation('lock:farm:fourth', character => { character.chestLockProgress={ farm:{ fourth:{misses:1} } }; });
const isolated = JSON.parse(data.get('hobunjiSaveMeta'));
api.capturePending(isolated);
assert.equal(isolated.characters[0].chestLockProgress.farm.fourth,undefined);
assert.equal(isolated.characters[1].chestLockProgress.farm.fourth.misses,1);

console.log('PASS character-meta staged mutations: no immediate browser rewrite, correct merge, flush fallback and character isolation');
