#!/usr/bin/env node
'use strict';
// The dialogue expression loop must never overwrite a newly rebaked NPC outfit.
// Exercises the production dialogue renderer with deferred overlapping promises.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/dialogue-content.js', 'utf8');
const start = source.indexOf('  const dialoguePortraitCanvasPools = new WeakMap()');
const end = source.indexOf('  let _npcDialoguePortraitRenderPending', start);
assert(start > 0 && end > start, 'production dialogue staging/commit helpers exist');
const canvas = () => {
  const obj = { width: 16, height: 16, ink: null };
  obj.getContext = () => ({ clearRect() {}, drawImage(from) { obj.ink = from.ink; } });
  return obj;
};
const live = canvas();
const walker = { profile: { outfit: 'old' }, avatarFrontCanvas: live, avatarGroup: { userData: {} } };
let currentWalker = walker, open = true, created = 0;
const queued = []; // Deferred async renders complete in an arbitrary order.
const uploaded = [];
const window = {
  NpcAvatarPreview: { renderProfileToCanvas(staging, profile) {
    return new Promise(resolve => queued.push({ staging, profile, resolve }));
  } },
  PNGPlaneAvatar: { refreshSinglePlaneAvatarModel(_group, front) { uploaded.push(front.ink); } },
};
const context = vm.createContext({
  window, document: { createElement(type) { assert.equal(type,'canvas'); created++; return canvas(); } },
  deps: { getDialogueOpen: () => open, getDialogueWalker: () => currentWalker },
  dialogueSeatId: () => 'npc-seating',
  WeakMap, console,
});
vm.runInContext(source.slice(start, end), context);
const paint = context._renderNpcDialoguePortrait;

// The original bug: a dialogue render starts on the old outfit and completes
// after the wardrobe has already uploaded a newly clothed profile.
(async () => {
  const stale = paint();
  assert.equal(queued.length, 1);
  assert.notEqual(queued[0].staging, live, 'speech renders into a private canvas, not the world portrait');
  live.ink = 'new-wardrobe-art';
  walker.profile = { outfit:'new' };
  queued[0].staging.ink = 'stale-yap';
  queued[0].resolve();
  assert.equal(await stale, false);
  assert.equal(live.ink, 'new-wardrobe-art', 'stale dialogue render cannot replace the outfit');
  assert.equal(uploaded.length, 0, 'stale dialogue result cannot upload');

  const current = paint();
  assert.equal(created, 1, 'sequential expressions reuse one private canvas');
  queued[1].staging.ink = 'new-yap';
  queued[1].resolve();
  assert.equal(await current, true);
  assert.equal(live.ink, 'new-yap', 'current expression updates the world avatar');
  assert.equal(uploaded.at(-1), 'new-yap');

  const older = paint(), newer = paint(); // Cutscene/openLine can overlap the regular expression poll.
  assert.equal(created, 2, 'overlapping requests use separate staging surfaces');
  queued[3].staging.ink = 'latest-expression'; queued[3].resolve();
  assert.equal(await newer, true);
  queued[2].staging.ink = 'old-expression'; queued[2].resolve();
  assert.equal(await older, false, 'a late older dialogue frame cannot overwrite a new one');
  assert.equal(live.ink, 'latest-expression');

  const dismissed = paint();
  open = false;
  queued[4].staging.ink = 'offscreen-yap'; queued[4].resolve();
  assert.equal(await dismissed, false, 'closing dialogue drops a still-pending frame');
  assert.equal(live.ink, 'latest-expression');
  open = true;
  const rejected = paint();
  queued[5].staging.ink = 'rejected-render'; queued[5].resolve(false);
  assert.equal(await rejected, false, 'renderer refusal does not submit an empty/stale staging canvas');
  assert.equal(live.ink, 'latest-expression', 'rejected dialogue draw preserves the live portrait');
  console.log('PASS dialogue/wardrobe portrait race: staging, stale cancellation, overlap and reuse');
})().catch(err => { console.error(err); process.exitCode = 1; });
