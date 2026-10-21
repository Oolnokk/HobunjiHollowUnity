#!/usr/bin/env node
'use strict';

// Regression check for authored NPC gift/date hint dialogue. Run: node scripts/test-npc-preference-dialogue.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..'); // Used to resolve shipped NPC data and runtime source without a browser.
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8'); // Shared source loader for config/runtime assertions.
const database = JSON.parse(read('docs/config/npcs/hobunji-starter-npc-database.json')); // The authored NPC dialogue surface under test.
const context = { window: { SCRATCHBONES_CONFIG: { game: {} } } }; // Minimal browser-global stub used to load the real romance configuration.
vm.runInNewContext(read('docs/config/romance-config.js'), context, { filename: 'romance-config.js' });
vm.runInNewContext(read('docs/js/condition-registry.js'), context, { filename: 'condition-registry.js' });
const likes = context.window.HobunjiRomanceConfig.likes; // Actual scored date activities; placeholders must stay aligned.
const selectPool = (npc, kind) => npc.phrasePools?.find(pool => pool.id === `pool_${npc.id}_${kind}_hints`); // Avoids name matching when NPC display names change.

let gifts = 0, dates = 0, giftLines = 0, dateLines = 0; // Used only for the test's final audit report.
for (const npc of database.npcs) {
  assert(npc.gifts, `${npc.id} must retain its mechanical gift preferences`);
  if (npc.id === 'banubu') continue; // His authored quest script supplants the starter record.
  const fallback = npc.dialogueTrees.find(tree => tree.id === `tree_${npc.id}_fallback`);
  assert(fallback, `${npc.id} has no general conversation tree`);
  const start = fallback.nodes.find(node => node.id === fallback.entryNode);
  assert.equal(start?.type, 'choice', `${npc.id} needs selectable hint topics`);
  assert.match(start.text, /^{{pool:.+ Greetings}}$/, `${npc.id} must retain its ordinary greeting`);
  assert.equal(start.choices.at(-1)?.next, null, `${npc.id} needs a Goodbye exit`);
  assert(start.choices.length <= 6, `${npc.id} exceeds the dialogue UI's six choices`);
  const nodes = new Map(fallback.nodes.map(node => [node.id, node]));
  for (const choice of start.choices) if (choice.next != null) assert(nodes.has(choice.next), `${npc.id}: broken choice target ${choice.next}`);
  const gift = selectPool(npc, 'gift');
  assert(gift?.entries?.length, `${npc.id} missing gift hint pool`);
  assert(start.choices.some(choice => choice.next === `n_${npc.id}_gift_hint`));
  const giftNode = nodes.get(`n_${npc.id}_gift_hint`);
  assert.equal(giftNode?.text, `{{pool:${gift.id}}}`);
  assert.equal(giftNode?.next, null);
  for (const entry of gift.entries) {
    assert.match(entry.text, /^<[^<>]+>$/, `${npc.id} gift hint must be an unmistakable placeholder`);
    assert(context.window.ConditionRegistry.entryEligible(entry, { weather: 'clear' }), `${npc.id}: hint not eligible`);
  }
  gifts++; giftLines += gift.entries.length;

  const date = selectPool(npc, 'date');
  if (!npc.relationship?.canDate) {
    assert(!date, `${npc.id}: non-romanceable NPC should have no date pool`);
    assert(!start.choices.some(choice => /date/i.test(choice.label)), `${npc.id}: undesired date option`);
    continue;
  }
  assert(date?.entries?.length, `${npc.id} is romanceable but has no date hints`);
  assert(start.choices.some(choice => choice.next === `n_${npc.id}_date_hint`));
  assert.equal(nodes.get(`n_${npc.id}_date_hint`)?.text, `{{pool:${date.id}}}`);
  const configured = likes[npc.id] || []; // Empty is intentionally left TODO instead of scoring a fictional activity.
  assert.equal(date.entries.length, Math.max(1, configured.length), `${npc.id} must have one hint per scored date like`);
  for (const entry of date.entries) assert.match(entry.text, /^<[^<>]+>$/);
  if (!configured.length) assert.match(date.entries[0].text, /TODO.*romance\.likes/);
  dates++; dateLines += date.entries.length;
}
assert.equal(gifts, database.npcs.length - 1);
assert.equal(dates, database.npcs.filter(npc => npc.relationship?.canDate).length);
const banubuContent = read('docs/js/banubu-quest-content.js'); // Quest-owned alternative gift hint source.
assert(banubuContent.includes('<Something that indicates that I like receiving fish as gifts.>'));
assert.match(banubuContent, /banubu_intro_8/);
assert.match(banubuContent, /banubu_q1_active_1/);
assert.match(banubuContent, /banubu_blocked_1/);
console.log(`NPC hint dialogue verified: ${gifts + 1} gift NPCs (${giftLines} regular hints + Banubu), ${dates} date NPCs (${dateLines} activity hints).`);
