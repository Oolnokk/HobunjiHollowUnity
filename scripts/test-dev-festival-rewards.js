#!/usr/bin/env node
'use strict';

// Regression tests for Festival Test's opt-in reward merge. The actual
// snapshot-merge functions run unchanged from the shipped quick-save module.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8'); // Loads shipped code, not a rewritten test implementation.
const source = read('docs/js/quick-save.js');
const start = source.indexOf('  function festivalMember(');
const end = source.indexOf('  async function startFestivalTest()', start);
assert.ok(start > 0 && end > start, 'festival reward merge must remain within the quick-save module');

const context = vm.createContext({ window: { CalendarSystem: {
  aotYearNumber: () => 1154,
  dayOfYear: day => day,
} } });
vm.runInContext(source.slice(start, end), context, { filename: 'quick-save-festival-extract.js' });
const clone = value => JSON.parse(JSON.stringify(value)); // Makes explicit the immutable baseline/derived-copy contract.

function fixture() {
  return { meta: { worlds: [{ id: 'world1', calendar: { day: 110, time01: 0.3 }, lastDay: 110,
    members: { farmer: {
      nonGearInventory: { gold: 200, festivalSweet: 1 },
      npcRelationships: { pahu: { favor: 10, memory: [{ event: 'old', day: 100 }] } },
      cookingState: { qualityBuckets: { festivalSweet: { 3: 1 } } },
      packClothing: [{ cosmeticId: 'ordinary_hat' }],
      festivals: { claims: {} },
    } },
  }] }, farmLayouts: {} };
}

const baseline = fixture();
const tested = clone(baseline);
const after = tested.meta.worlds[0].members.farmer;
after.nonGearInventory.gold = 9999; // Not a festival reward; must NOT leak.
after.nonGearInventory.festivalSweet = 0; // Consumed ingredients must NOT leak.
after.npcRelationships.pahu.favor = 999;
after.npcRelationships.leaf = { favor: 200 };
after.packClothing.push({ cosmeticId: 'festivalmask_grehlr' }, { cosmeticId: 'ordinary_new_hat' });
after.festivals.claims['1154:hachutukara'] = { mask: true, sweets: true };

const session = {
  characterId: 'farmer', worldId: 'world1', eventKey: '1154:hachutukara', targetDay: 120,
  journal: { favor: { pahu: 5 }, items: [{ key: 'festivalSweet', count: 2, stars: 5 }],
    masks: ['festivalmask_grehlr'] },
};
const originalJson = JSON.stringify(baseline);
const restored = clone(baseline);
context.mergeFestivalRewards(restored, tested, session);
assert.equal(JSON.stringify(baseline), originalJson, 'pinned original snapshot must remain unchanged');
const member = restored.meta.worlds[0].members.farmer;
assert.equal(restored.meta.worlds[0].calendar.day, 110, 'date must be restored');
assert.equal(restored.meta.worlds[0].lastDay, 110, 'rollover pointer must be restored');
assert.equal(member.nonGearInventory.gold, 200, 'unrelated inventory must not transfer');
assert.equal(member.nonGearInventory.festivalSweet, 3, 'only two specifically granted sweets transfer');
assert.equal(member.cookingState.qualityBuckets.festivalSweet[5], 2, 'grant quality tier transfers');
assert.equal(member.npcRelationships.pahu.favor, 15, 'only journaled festival Favor transfers');
assert.equal(member.npcRelationships.leaf, undefined, 'unrelated NPC changes are discarded');
assert.equal(member.npcRelationships.pahu.memory.length, 1, 'unrelated dialogue memories are discarded');
assert.deepEqual(member.packClothing.map(item => item.cosmeticId), ['ordinary_hat', 'festivalmask_grehlr']);
assert.equal(member.festivals.claims['1154:hachutukara'].mask, true, 'festival claims persist with rewards');

const gearPrizeBaseline = fixture();
gearPrizeBaseline.meta.characters = [{ id: 'farmer', gearInventory: { clothingItems: [], knownMetalArmorBlueprints: [] } }];
const gearPrizeTest = clone(gearPrizeBaseline);
gearPrizeTest.meta.characters[0].gearInventory.clothingItems.push({
  uid: 'gcloth_prize1', cosmeticId: 'replica_bzabag_helm', slot: 'hat', metalKey: 'nativeCopper',
});
const helmSession = { ...session, journal: { favor: {}, items: [], masks: ['replica_bzabag_helm'] } };
context.mergeFestivalRewards(gearPrizeBaseline, gearPrizeTest, helmSession);
assert.equal(gearPrizeBaseline.meta.worlds[0].members.farmer.packClothing.at(-1).cosmeticId,
  'replica_bzabag_helm', 'Gorkunash prize granted in Gear is kept in restored Pack');
assert.equal(gearPrizeBaseline.meta.worlds[0].members.farmer.packClothing.at(-1).metalKey,
  'nativeCopper', 'Gorkunash prize keeps its rolled metal');
assert.ok(gearPrizeBaseline.meta.characters[0].gearInventory.knownMetalArmorBlueprints.includes('replica_bzabag_helm'),
  'carrying the helm also retains its smith unlock');

const repeatMaskOriginal = fixture();
repeatMaskOriginal.meta.worlds[0].members.farmer.packClothing.push({
  uid: 'old-mask', cosmeticId: 'festivalmask_grehlr', slot: 'mask',
});
const repeatMaskTest = clone(repeatMaskOriginal);
repeatMaskTest.meta.worlds[0].members.farmer.packClothing.push({
  uid: 'new-mask', cosmeticId: 'festivalmask_grehlr', slot: 'mask',
});
context.mergeFestivalRewards(repeatMaskOriginal, repeatMaskTest,
  { ...session, journal: { favor: {}, items: [], masks: ['festivalmask_grehlr'] } });
assert.equal(repeatMaskOriginal.meta.worlds[0].members.farmer.packClothing.length, 2,
  'a second annual mask prize must not be discarded because one was already owned');
assert.equal(repeatMaskOriginal.meta.worlds[0].members.farmer.packClothing.at(-1).uid, 'new-mask');

const overflowing = fixture();
overflowing.meta.worlds[0].members.farmer.nonGearInventory.festivalSweet = 998;
assert.throws(() => context.mergeFestivalRewards(overflowing, tested,
  { ...session, journal: { favor: {}, items: [{ key: 'festivalSweet', count: 2, stars: 5 }], masks: [] } }),
  /stack limit/, 'festival reward transfers must fail rather than overflow a stack');

const withoutRewards = clone(baseline); // Checkbox OFF means no call to the merge function.
assert.equal(JSON.stringify(withoutRewards), originalJson, 'unchecked reward option restores exactly');
const beforeMissing = clone(baseline);
assert.throws(() => context.mergeFestivalRewards(beforeMissing, tested,
  { ...session, characterId: 'different' }), /does not match/, 'different characters cannot receive rewards');

const blessed = clone(baseline);
const blessedTest = clone(tested);
blessedTest.meta.worlds[0].calendar.day = 130; // Buff was active for ten days of the disposable festival timeline.
blessedTest.meta.worlds[0].members.farmer.festivals.claims['1154:tzizkhanash'] = { offering: true };
blessedTest.meta.worlds[0].members.farmer.festivals.blessing = {
  stat: 'speed', level: 3, expiresDay: 1154 * 336 + 260,
};
context.mergeFestivalRewards(blessed, blessedTest, {
  ...session, eventKey: '1154:tzizkhanash', targetDay: 120, journal: { favor: {}, items: [], masks: [] },
});
assert.equal(blessed.meta.worlds[0].members.farmer.festivals.blessing.expiresDay,
  1154 * 336 + 240, 'ancestor blessing must lose the ten elapsed festival test days');

const companion = read('docs/tools/dev-companion/dev-companion.js');
assert.match(companion, /action\.checkbox/);
assert.match(companion, /checked: input\.checked/);
assert.match(source, /keepRewards: saved\.keepRewards === true/, 'reward carry must default to OFF');
assert.match(source, /if \(session\.keepRewards\)/, 'unchecked test must use the unmodified restore snapshot');
assert.match(read('docs/js/folder-save-primary.js'), /function festivalTestSaveGuard\(/, 'primary folder must be protected');
assert.match(read('docs/js/festival-system.js'), /recordFestivalFavor/, 'Favor should be journaled from actual festival grants');
assert.match(read('docs/js/festival-system.js'), /recordFestivalItem/, 'items should be journaled from actual festival grants');
assert.match(read('docs/js/festival-system.js'), /function settleTestRewards\(/, 'pending Fun settles at opt-in test exit');
assert.match(read('docs/js/festival-potluck-contest.js'), /recordFestivalMask\?\.\(HELM_ID\)/,
  'post-Gorkunash helm prize is journaled by its actual doorstep reward handler');
assert.match(read('docs/js/folder-save-primary.js'), /startupMode = 'festival-test-browser'/,
  'normal refresh cannot pull the primary folder over the active sandbox');
assert.match(read('docs/js/netlify-cloud-save.js'), /function festivalCloudWriteBlocked\(/,
  'Netlify sync must not upload temporary festival worlds');
assert.match(read('docs/js/save-checkpoint-manager.js'), /function festivalCheckpointBlocked\(/,
  'manual and recovery checkpoints must not overwrite canonical saves during a test');
assert.match(read('docs/js/folder-save-primary.js'), /const guarded = festivalTestSaveGuard\(\)/,
  'manual folder imports must not replace the sandbox unexpectedly');

console.log('test-dev-festival-rewards: ok');
