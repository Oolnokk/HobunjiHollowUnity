#!/usr/bin/env node
'use strict';
// An ordinary conversation holds only the person talking (and the NPC they talk to).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const ctx = { window: {}, performance: { now: () => 0 }, console };
vm.createContext(ctx);
for (const f of ['actor-registry', 'npc-conversations']) vm.runInContext(read(`docs/js/${f}.js`), ctx);
const { ActorRegistry: reg, NpcConversations: conv } = ctx.window;

const host = { x: 0, y: 0, health: 100 }, mira = { x: 64, y: 0, health: 100 }, tov = { x: 128, y: 0, health: 100 };
reg.registerPlayer(host, { local: true }); reg.registerPlayer(mira, { playerId: 'mira' }); reg.registerPlayer(tov, { playerId: 'tov' });
const npc = (id, pause = 0) => ({ rec: { id }, pause });
const hunundi = npc('hunundi'), kzubug = npc('kzubug', 7);
const events = []; conv.onEvent(e => events.push(`${e.type}:${e.playerId}:${e.npcId}`));

// The local player's conversation: game.js owns the NPC pause, this only records who is talking.
const first = conv.begin(host, hunundi);
assert.equal(first.ok, true);
assert.equal(first.by, host);
assert.equal(conv.speakerOf(hunundi), host);
assert.equal(hunundi.pause, 0, 'local: game.js freezes its own NPC, not this module');
assert.equal(host._inDialogue, undefined, 'the local player is held by the dialogue UI, not flagged');

// A second player cannot take the same NPC; nothing changes for them or the NPC.
const busy = conv.begin(mira, hunundi, { ownsPause: true });
assert.equal(busy.ok, false);
assert.equal(busy.by, host, 'busy, and we know who is talking');
assert.equal(conv.isBusy(hunundi, mira), true);
assert.equal(conv.isBusy(hunundi, host), false, 'not busy for the person already talking');
assert.equal(mira._inDialogue, undefined, 'a refused player is not held');
assert.equal(conv.isTalking(mira), false);

// A remote player talking to a different NPC holds only that NPC and themself.
assert.equal(conv.begin(mira, kzubug, { ownsPause: true }).ok, true);
assert.equal(kzubug.pause, Infinity, 'the NPC listens (stands still)');
assert.equal(mira._inDialogue, true, 'the speaker is held host-side');
assert.equal(tov._inDialogue, undefined, 'everyone else keeps going');
assert.equal(host._inDialogue, undefined);
assert.equal(hunundi.pause, 0, 'other NPCs are unaffected');
assert.equal(conv.begin(mira, kzubug, { ownsPause: true }).ok, true, 'idempotent for the same pair');

// One NPC per player: starting another conversation ends the previous one and frees that NPC.
const kuma = npc('kuma');
assert.equal(conv.begin(mira, kuma, { ownsPause: true }).ok, true);
assert.equal(kzubug.pause, 7, 'the first NPC returns to what it was doing');
assert.equal(conv.speakerOf(kzubug), null);
assert.equal(conv.begin(tov, kzubug, { ownsPause: true }).ok, true, 'and is free for someone else');
conv.end(tov);

// Ending restores; a stale "frozen" is never restored.
conv.end(mira);
assert.equal(kuma.pause, 0);
assert.equal(mira._inDialogue, false);
const frozenBefore = npc('frozen', Infinity);
conv.begin(tov, frozenBefore, { ownsPause: true });
conv.end(tov);
assert.equal(frozenBefore.pause, 0, 'never restores an already-frozen pause');

// The local conversation ends -> the NPC is free for the others.
conv.end(host);
assert.equal(conv.begin(mira, hunundi, { ownsPause: true }).ok, true);

// A disconnect or leaving the session releases the NPC.
reg.unregisterPlayer(mira);
assert.equal(conv.speakerOf(hunundi), null);
assert.equal(hunundi.pause, 0, 'an NPC is never left frozen by a vanished player');
assert.ok(events.some(e => e.startsWith('end:') && e.includes('hunundi')));
console.log('npc conversation tests passed');
