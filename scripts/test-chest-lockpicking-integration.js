#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = filename => fs.readFileSync(path.resolve(__dirname, '..', 'docs/js', filename), 'utf8');

// Minimal DOM stubs leave the production Ring Tumblers parser, timing model, input
// dispatcher, session ownership and cleanup untouched. No devtools are needed.
function makeElement() {
  return {
    style: { setProperty() {} }, children: [], dataset: {}, innerHTML: '', textContent: '',
    disabled: false, attributes: new Map(), listeners: new Map(), // Lets regression tests activate the mobile retry button.
    setAttribute(key, value) { this.attributes.set(key, String(value)); },
    getAttribute(key) { return this.attributes.get(key); },
    append(child) { this.children.push(child); },
    replaceChildren() { this.children.length = 0; },
    addEventListener(name, callback) { this.listeners.set(name, callback); }, focus() {}, blur() {},
    closest(selector) { return selector === '#chestLockOverlay' ? this : null; },
    querySelector() { return null; },
  };
}

(async () => {
  // The shipping wilderness-treasure manifest owns both scripts in their former order.
  const groupManifest = fs.readFileSync(path.resolve(__dirname, '..', 'docs/js/bootstrap/classic-groups/wilderness-treasure.js'), 'utf8');
  const manifestWrites = []; // Captures the parser-blocking child tags emitted by the actual manifest.
  vm.runInNewContext(groupManifest, {
    document: { readyState:'loading', write(html) { manifestWrites.push(html); } },
  });
  const actualUrls = [...manifestWrites.join('').matchAll(/src="([^"]+)"/g)].map(match => match[1].split('?')[0]);
  assert.deepEqual(actualUrls, ['js/chest-lockpicking.js', 'js/wild-treasure.js'], 'the lock loads before its buried-treasure consumer');
  const liveHtml = fs.readFileSync(path.resolve(__dirname, '..', 'docs/index.html'), 'utf8');
  assert(liveHtml.includes('data-classic-group="wilderness-treasure"'), 'the page uses the shared parser-time group loader');
  assert(!liveHtml.includes('src="js/chest-lockpicking.js?v='), 'feature script versions stay out of the shared index');
  assert(liveHtml.indexOf('data-classic-group="wilderness-treasure"') < liveHtml.indexOf('<script src="game.js'), 'the lock group precedes gameplay');

  const doc = {
    body: { append() {} }, head: { append() {} }, activeElement: null, pointerLockElement: null,
    createElement: () => makeElement(),
  };
  const section = makeElement(), svg = makeElement(), target = makeElement();
  const byId = new Map(['.cl-dial', '#chestLockDial', '#chestLockTitle', '#chestLockProgress',
    '#chestLockFeedback', '#chestLockDebug', '.cl-x', '#chestLockCopy',
    '#chestLockButtons', '#chestLockDiagnostics', '#chestLockRetry'].map(key => [key, makeElement()]));
  byId.set('.cl-dial', svg); svg.querySelector = selector => selector === '#chestLockDial' ? target : null;
  section.querySelector = selector => byId.get(selector) || null;
  doc.createElement = tag => tag === 'section' ? section : makeElement();

  const queuedFrames = new Map(); // Only test frames actively requested by the minigame, never an always-on loop.
  const microtasks = []; // Explicitly captures deferred controller restore for same-dispatch assertions.
  let nextFrame = 1;
  const owners = []; // Ownership transitions, including the held lock on a successful last press.
  const controller = {
    owner: 'gameplay',
    setOwner(owner) { this.owner = owner; owners.push(owner); },
    subscribe(_owner, handler) { this.handler = handler; return () => { this.handler = null; }; },
    frame: () => ({ pad: null }),
  };
  const lock = { acquired: 0, released: 0, acquire() {
    lock.acquired++;
    return { release() { lock.released++; } };
  } };
  const keyEvents = new Map(); // Keyboard capture handlers let the regression simulate Escape without browser devtools.
  const window = {
    ControllerInput: controller, CharacterActionLocks: lock,
    addEventListener(type, callback) { keyEvents.set(type, callback); },
    removeEventListener(type, callback) { if (keyEvents.get(type) === callback) keyEvents.delete(type); },
    __farmLog() {},
  };
  const math = Object.create(Math);
  math.random = () => 0.5; // Every newly generated ring starts exactly at its target for deterministic completion.
  const context = {
    window, document: doc, navigator: {}, console,
    Math: math, queueMicrotask(fn) { microtasks.push(fn); },
    requestAnimationFrame(fn) { const id = nextFrame++; queuedFrames.set(id, fn); return id; },
    cancelAnimationFrame(id) { queuedFrames.delete(id); },
  };
  vm.runInNewContext(read('chest-lockpicking.js'), vm.createContext(context), { filename: 'chest-lockpicking.js' });
  const api = window.ChestLockpicking;
  const flushMicrotasks = () => { while (microtasks.length) microtasks.shift()(); };
  const flushSavePromises = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }; // Drain chained VM-realm folder promises before reading session state.
  let now = 1000;
  context.performance = { now: () => now }; // Timestamp source shared with production keyboard, gamepad and RAF timing.
  const nextFrameTick = () => {
    const [id, fn] = queuedFrames.entries().next().value || [];
    assert(fn, 'the active lock must request the next animation frame');
    queuedFrames.delete(id);
    now += 50;
    fn(now);
  };
  const press = code => controller.handler?.({ focused: true, pressed: new Set([code]) });

  let wins = 0, cancels = 0;
  assert.equal(api.open({ id: 'first', tier: 1, valid: () => true, onSuccess() { wins++; }, onCancel() { cancels++; } }), true);
  assert.equal(controller.owner, 'chest-lockpicking');
  assert.equal(api.snapshot().rings.length, 2);
  press('Button4'); press('Button5'); // First lock set.
  assert.equal(api.snapshot().stage, 1);
  for (let i = 0; i < 14; i++) nextFrameTick(); // Complete the 650ms inter-set transition.
  assert.equal(api.snapshot().phase, 'playing');
  press('Button4'); press('Button5'); // Second set opens the chest.
  assert.equal(wins, 1);
  assert.equal(api.isActive(), false);
  assert.equal(controller.owner, 'chest-lockpicking', 'final shoulder press cannot leak to gameplay subscribers in the same poll');
  assert.equal(microtasks.length, 1, 'owner restoration is deferred until the shared poll unwinds');
  assert.equal(queuedFrames.size, 0, 'closing cancels the short-lived RAF loop');
  flushMicrotasks();
  assert.equal(controller.owner, 'gameplay');
  assert.equal(lock.acquired, 1);
  assert.equal(lock.released, 1);

  // Target removed after last tick, immediately before the winning shoulder press.
  let valid = true;
  assert.equal(api.open({ id: 'removed', tier: 1, valid: () => valid, onSuccess() { wins++; }, onCancel(reason) {
    assert.equal(reason, 'invalid'); cancels++;
  } }), true);
  press('Button4'); press('Button5');
  for (let i = 0; i < 14; i++) nextFrameTick();
  press('Button4');
  valid = false;
  press('Button5');
  assert.equal(api.isActive(), false);
  assert.equal(wins, 1, 'stale target cannot receive an asynchronous reward');
  assert.equal(cancels, 1);
  flushMicrotasks();
  assert.equal(controller.owner, 'gameplay');

  assert.equal(api.open({ id: 'cancel', tier: 4, valid: () => true, onSuccess() { wins++; }, onCancel() { cancels++; } }), true);
  assert.equal(api.snapshot().rings.length, 4);
  press('Button1');
  assert.equal(cancels, 2, 'B cancels without awarding treasure');
  assert.equal(wins, 1);
  assert.equal(api.isActive(), false);
  flushMicrotasks();
  assert.equal(controller.owner, 'gameplay');
  assert.equal(lock.acquired, 3);
  assert.equal(lock.released, 3);


  // Real character saves persist every secured set and the FIRST failure in
  // each set. Cancelling/reloading must never reset the clean-streak penalty.
  const storedMeta = { characters:[{ id:'char_a' },{ id:'char_b' }], worlds:[{ id:'world_a' }] };
  let saveWrites = 0; // Counts immediate character save commits, not slow recovery-checkpoint writes.
  context.localStorage = {
    getItem(key) { return key === 'hobunjiSaveMeta' ? JSON.stringify(storedMeta) : null; },
    setItem(key, value) {
      assert.equal(key, 'hobunjiSaveMeta');
      Object.assign(storedMeta, JSON.parse(value));
    },
  };
  window.__hobunjiPlayerProfile = { characterId:'char_a', worldId:'world_a' };
  window.CharacterMetaSave = { META_KEY:'hobunjiSaveMeta', update(fn) {
    fn(storedMeta.characters.find(character => character.id === window.__hobunjiPlayerProfile.characterId));
    saveWrites++;
    return true;
  } };
  const recordFor = id => storedMeta.characters[0].chestLockProgress?.world_a?.[id];
  const awards = []; // Captures best clean streak and exact bonus count supplied to the existing chest reward callback.

  assert.equal(api.open({ id:'flawless', tier:1, valid:()=>true, onSuccess(award) { awards.push(award); } }), true);
  press('Button4'); press('Button5');
  assert.equal(recordFor('flawless').stage, 1, 'a secured stage is saved before the next stage');
  for (let i=0;i<14;i++) nextFrameTick();
  press('Button4'); press('Button5');
  assert.equal(awards[0].bestStreak, 4);
  assert.equal(awards[0].bonusDrops, 1, 'four flawless low-tier ring catches guarantee one additional drop');
  flushMicrotasks();

  assert.equal(api.open({ id:'persistent', tier:1, valid:()=>true, onSuccess(award) { awards.push(award); } }), true);
  press('Button4'); press('Button5');
  assert.equal(recordFor('persistent').stage, 1);
  for (let i=0;i<14;i++) nextFrameTick();
  for (let i=0;i<6;i++) nextFrameTick(); // Rotate outside the catch window.
  const beforeFailureWrites = saveWrites;
  press('Button4'); // First miss on set two.
  assert.equal(api.snapshot().stage, 1, 'a failed catch never rolls back a secured stage');
  assert.equal(api.snapshot().bestStreak, 2);
  assert.equal(api.snapshot().streak, 0);
  assert.equal(recordFor('persistent').stage, 1);
  assert.equal(recordFor('persistent').failedStage, 1, 'first failure is committed immediately');
  assert.equal(saveWrites, beforeFailureWrites+1);
  for (let i=0;i<6;i++) nextFrameTick();
  press('Button4'); // Second miss on the same stage does not trigger another full metadata write.
  assert.equal(saveWrites, beforeFailureWrites+1);
  assert.equal(api.snapshot().stage, 1);
  press('Button1');
  assert.equal(recordFor('persistent').stage, 1, 'cancel keeps all completed stages');
  flushMicrotasks();

  window.__hobunjiPlayerProfile = { characterId:'char_b', worldId:'world_a' };
  assert.equal(api.open({ id:'persistent', tier:1, onSuccess() {} }), true);
  assert.equal(api.snapshot().stage, 0, 'another character never inherits this lock progress');
  press('Button1'); flushMicrotasks();

  window.__hobunjiPlayerProfile = { characterId:'char_a', worldId:'world_a' };
  assert.equal(api.open({ id:'persistent', tier:1, onSuccess(award) { awards.push(award); } }), true);
  assert.equal(api.snapshot().stage, 1, 'cancel/reentry resumes at the last secured set');
  assert.equal(api.snapshot().streak, 0, 'failure penalty survives cancellation and simulated reload');
  press('Button4'); press('Button5');
  assert.equal(awards[1].bestStreak, 2);
  assert.equal(awards[1].bonusDrops, 0, 'retries do not fabricate a clean streak');
  flushMicrotasks();

  assert.equal(api.open({ id:'difficult-flawless', tier:4, onSuccess(award) { awards.push(award); } }), true);
  const catchFour = () => {
    for (const button of ['Button4','Button5','LeftTrigger','RightTrigger']) press(button);
  };
  catchFour();
  for (let i=0;i<14;i++) nextFrameTick();
  catchFour();
  for (let i=0;i<14;i++) nextFrameTick();
  catchFour();
  assert.equal(awards[2].bestStreak, 12);
  assert.equal(awards[2].bonusDrops, 4, 'twelve flawless hard catches grant more drops than four easy catches');
  flushMicrotasks();

  assert.equal(api.open({ id:'abandon', tier:1, onSuccess() {} }), true);
  press('Button4');
  press('Button1'); // Leaving a partially caught set counts as a failed attempt.
  assert.equal(recordFor('abandon').misses, 1);
  assert.equal(recordFor('abandon').failedStage, 0);
  flushMicrotasks();

  assert.equal(api.open({ id:'stutter', tier:4, onSuccess() {} }), true);
  nextFrameTick();
  const beforeStutter = api.snapshot().rings.map(ring => ring.angle);
  const [stutterId, stutterFn] = queuedFrames.entries().next().value;
  queuedFrames.delete(stutterId);
  now += 1400; stutterFn(now); // A frozen browser frame must not run hidden ring motion.
  assert.equal(JSON.stringify(api.snapshot().rings.map(ring => ring.angle)), JSON.stringify(beforeStutter));
  assert.equal(api.snapshot().stutters, 1);
  assert.equal(api.snapshot().lastStallMs, 1400);
  press('Button1'); flushMicrotasks();

  // A browser frame stalled before controller dispatch should judge against
  // the last visible marker, with a small window for the delayed input.
  assert.equal(api.open({ id:'stutter-input', tier:4, onSuccess() {} }), true);
  nextFrameTick(); nextFrameTick(); // Outer ring passes the strict notch window by a few degrees.
  assert(api.snapshot().rings[0].angle > 190, 'outer ring moved beyond its narrow tier-four catch window');
  now += 1000; // The gamepad event fires while its normal RAF has been starved.
  press('Button4');
  assert.equal(api.snapshot().rings[0].frozen, true, 'stutter grace accepts a catch at the last visible marker');
  assert.equal(api.snapshot().misses, 0, 'the delayed controller input does not count as a failure');
  press('Button1'); flushMicrotasks();

  // Primary-folder users require an actual disk sync on the FIRST failure,
  // with rings paused while an asynchronous permission or disk write is pending.
  let folderResolve = null; // Test gate for the canonical folder's async write.
  let folderFlushes = 0; // Count commits; regular character metadata writes alone are not an armed folder autosave.
  window.HobunjiRuntimeSave = {
    captureSnapshot() {
      return {ok:true,snapshot:{meta:JSON.parse(JSON.stringify(storedMeta)),farmLayouts:{}}};
    }, // The real runtime snapshot carries the latest lock penalty when a concurrent autosave is still writing.
  };
  window.LocalSaveFolder = {
    getStatus() { return {state:'ready',autoSyncArmed:true,lastSyncedAt:100}; },
    syncNow(options) {
      folderFlushes++;
      assert.equal(options.automatic, true);
      assert(options.snapshot?.meta?.characters?.[0]?.chestLockProgress, 'folder commit pins a freshly captured character save');
      return new Promise(resolve => { folderResolve = resolve; });
    },
  };
  assert.equal(api.open({ id:'folder-pending', tier:1, onSuccess() {} }), true);
  press('Button4'); press('Button5');
  for (let i=0;i<20;i++) nextFrameTick();
  press('Button4'); // First failure on the second set triggers primary-folder sync.
  assert.equal(api.snapshot().phase, 'saving', 'lock timing freezes during folder persistence');
  const beforeEscapeMisses = api.snapshot().misses;
  const escape = { type:'keydown', code:'Escape', repeat:false, prevented:false, stopped:false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  keyEvents.get('keydown')(escape); // Player escapes while the folder save is unresolved.
  assert.equal(escape.prevented && escape.stopped, true);
  assert.equal(api.isActive(), false, 'Escape dismisses a saving modal immediately');
  assert.equal(api.snapshot().backgroundSaves, 1, 'the detached save continues after closing');
  assert.equal(lock.acquired, lock.released, 'movement and combat return without waiting for disk');
  assert.equal(api.open({id:'folder-pending',tier:1,onSuccess(){}}), false,
    'reentry to this lock is blocked until its pending write is acknowledged');
  flushMicrotasks();
  assert.equal(controller.owner, 'gameplay', 'controller ownership returns before disk resolves');
  await Promise.resolve();
  assert.equal(folderFlushes, 1);
  folderResolve({state:'ready',lastAction:'autosaved-browser-to-folder',lastSyncedAt:101,lastError:null});
  await flushSavePromises();
  assert.equal(api.snapshot().backgroundSaves, 0);
  assert.equal(api.isActive(), false, 'late acknowledgement never reopens the dismissed modal');
  assert.equal(recordFor('folder-pending').misses, beforeEscapeMisses);
  assert.equal(recordFor('folder-pending').folderUnsynced, false, 'the detached write clears the browser pending marker');
  assert.equal(api.open({id:'folder-pending',tier:1,onSuccess(){}}), true);
  assert.equal(api.snapshot().stage, 1, 'secured progress survives a mid-save cancel');
  press('Button1'); flushMicrotasks();

  assert.equal(api.open({ id:'folder-rejected', tier:1, onSuccess() {} }), true);
  press('Button4'); press('Button5');
  for (let i=0;i<20;i++) nextFrameTick();
  press('Button4');
  press('Button1'); // Controller B escapes during the write itself, even when it will ultimately fail.
  assert.equal(api.isActive(), false);
  assert.equal(lock.acquired, lock.released);
  flushMicrotasks();
  assert.equal(controller.owner, 'gameplay');
  await Promise.resolve();
  folderResolve({state:'ready',lastAction:'autosync-blocked-data-loss',lastSyncedAt:101,lastError:'Permission denied'});
  await flushSavePromises();
  assert.equal(api.isActive(), false, 'rejected background writes never reopen the modal');
  assert.equal(api.snapshot().backgroundSaves, 0);
  assert.equal(recordFor('folder-rejected').folderUnsynced, true, 'a rejected write retains the penalty');
  assert.equal(api.open({ id:'folder-rejected', tier:1, onSuccess() {} }), true);
  assert.equal(api.snapshot().phase, 'save-error', 'reopening cannot bypass the unsaved-folder penalty');
  assert.equal(byId.get('#chestLockRetry').style.display,'block','mobile UI exposes a retry button');
  window.LocalSaveFolder.syncNow = options => {
    assert.equal(options.snapshot.meta.characters[0].chestLockProgress.world_a['folder-rejected'].folderUnsynced, true,
      'retry snapshot carries the denied failure until a real folder commit');
    return Promise.resolve({state:'ready',lastAction:'autosaved-browser-to-folder',lastSyncedAt:102,lastError:null});
  };
  byId.get('#chestLockRetry').listeners.get('click')();
  await flushSavePromises();
  assert.equal(api.snapshot().phase, 'playing', 'touch retry resumes after a successful canonical folder write');
  assert.equal(recordFor('folder-rejected').folderUnsynced, false, 'touch retry acknowledges the committed primary save');
  press('Button1'); flushMicrotasks();

  // A verified folder baseline takes the fast route: one scoped character
  // patch instead of pinning a giant farm snapshot before the player can move.
  let fastLockWrites = 0; // Counts targeted first-failure writes without invoking the full snapshot API.
  const stagedMutations = new Map(); // Real CharacterMetaSave captures these fine-grained lock deltas on the next ordinary save.
  const browserWritesBeforeFast = saveWrites; // The fast path must not synchronously JSON-rewrite huge browser metadata.
  window.CharacterMetaSave.stageMutation = (key, mutate) => { stagedMutations.set(key, mutate); return true; };
  window.CharacterMetaSave.capturePending = meta => { for (const mutate of stagedMutations.values()) mutate(meta.characters[0]); };
  const oldFullSync = window.LocalSaveFolder.syncNow; // Restored after the fast-path integration assertion.
  const oldCapture = window.HobunjiRuntimeSave.captureSnapshot; // A fast write must not serialize the active farm.
  window.LocalSaveFolder.canSaveLockProgress = id => id === 'char_a';
  window.LocalSaveFolder.saveLockProgress = details => {
    fastLockWrites++;
    assert.equal(details.characterId, 'char_a');
    assert.equal(details.worldId, 'world_a');
    assert.equal(details.lockId, 'folder-fast');
    assert.equal(details.record.version, 2);
    assert.equal(details.record.folderUnsynced, true);
    assert.equal(details.record.misses, fastLockWrites === 1 ? 0 : 1, 'completed sets and subsequent failures use distinct durable records');
    return Promise.resolve({ state:'ready', lastAction:'autosaved-lock-progress', lastSyncedAt:120 + fastLockWrites, lastError:null });
  };
  window.LocalSaveFolder.syncNow = () => { throw new Error('fast first-failure save invoked full snapshot sync'); };
  window.HobunjiRuntimeSave.captureSnapshot = () => { throw new Error('fast first-failure save captured the world'); };
  assert.equal(api.open({ id:'folder-fast', tier:1, onSuccess() {} }), true);
  press('Button4'); press('Button5');
  assert.equal(api.snapshot().phase, 'saving', 'even a successful set uses the small folder progress writer');
  byId.get('.cl-x').listeners.get('click')(); // Touch close works during a secured-set save.
  assert.equal(api.isActive(), false);
  assert.equal(api.snapshot().backgroundSaves, 1);
  assert.equal(api.open({id:'folder-fast',tier:1,onSuccess(){}}), false,
    'reentry before a secured set reaches the folder cannot dupe stage or reward');
  flushMicrotasks();
  assert.equal(controller.owner, 'gameplay');
  await flushSavePromises();
  assert.equal(fastLockWrites, 1);
  assert.equal(api.snapshot().backgroundSaves, 0);
  assert.equal(api.open({id:'folder-fast',tier:1,onSuccess(){}}), true);
  assert.equal(api.snapshot().stage, 1, 'a cancelled modal retains its saved secured stage');
  assert.equal(api.snapshot().phase, 'playing');
  for (let i=0;i<20;i++) nextFrameTick(); // Move the resumed set outside the catch window before the intentional failure.
  press('Button4');
  assert.equal(api.snapshot().phase, 'saving');
  await flushSavePromises();
  assert.equal(fastLockWrites, 2, 'secured set and first failure each write one targeted progress update');
  assert.equal(api.snapshot().phase, 'playing');
  assert.equal(api.snapshot().lastFolderSaveAction, 'autosaved-lock-progress');
  assert.equal(saveWrites, browserWritesBeforeFast, 'first failed lock stage does not write the giant browser meta blob');
  assert.equal(recordFor('folder-fast'), undefined, 'browser metadata stays unchanged until a later ordinary mirror');
  const stagedSnapshot = JSON.parse(JSON.stringify(storedMeta)); // Simulate the next normal runtime capture, including in-memory lock changes.
  window.CharacterMetaSave.capturePending(stagedSnapshot);
  assert.equal(stagedSnapshot.characters[0].chestLockProgress.world_a['folder-fast'].folderUnsynced, false,
    'the later full snapshot contains the acknowledged disk lock penalty');
  assert.equal(stagedSnapshot.characters[0].chestLockProgress.world_a['persistent'].stage, recordFor('persistent').stage,
    'staging a new lock preserves other existing locks');
  press('Button1'); flushMicrotasks();
  window.LocalSaveFolder.syncNow = oldFullSync;
  window.HobunjiRuntimeSave.captureSnapshot = oldCapture;
  delete window.LocalSaveFolder.canSaveLockProgress;
  delete window.LocalSaveFolder.saveLockProgress;
  delete window.CharacterMetaSave.stageMutation;
  delete window.CharacterMetaSave.capturePending;

  // Primary-folder saves must keep working when browser storage is full.
  // CharacterMetaSave.schedule is also used by the real direct-snapshot writer.
  const writableMetaUpdate = window.CharacterMetaSave.update;
  const pendingCharacterPatch = {}; // Pending character fields captured by the real runtime save without localStorage writes.
  window.CharacterMetaSave.update = () => false;
  window.CharacterMetaSave.schedule = patch => Object.assign(pendingCharacterPatch, patch);
  window.HobunjiRuntimeSave.captureSnapshot = () => {
    const meta = JSON.parse(JSON.stringify(storedMeta));
    Object.assign(meta.characters[0], pendingCharacterPatch);
    return {ok:true,snapshot:{meta,farmLayouts:{}}};
  };
  let directFolderWrites = 0; // A separate pinned sync is required for each completed set while the browser cache cannot accept writes.
  window.LocalSaveFolder.syncNow = options => {
    directFolderWrites++;
    assert.equal(options.snapshot.meta.characters[0].chestLockProgress.world_a['folder-only'].folderUnsynced, true,
      'a folder-only progress capture must include the pending secured set');
    return Promise.resolve({state:'ready',lastAction:'autosaved-browser-to-folder',lastSyncedAt:120+directFolderWrites,lastError:null});
  };
  let directFolderWins = 0;
  assert.equal(api.open({id:'folder-only',tier:1,onSuccess() {directFolderWins++;}}), true);
  press('Button4'); press('Button5');
  assert.equal(api.snapshot().phase, 'saving', 'browser-full stage completion waits for the primary folder');
  await flushSavePromises();
  assert.equal(api.snapshot().phase, 'transition');
  assert.equal(api.snapshot().stage, 1);
  for (let i=0;i<14;i++) nextFrameTick();
  press('Button4'); press('Button5');
  assert.equal(api.snapshot().phase, 'saving', 'final set also waits for an actual folder commit');
  await flushSavePromises();
  assert.equal(directFolderWrites, 2);
  assert.equal(directFolderWins, 1, 'folder-only progression opens the chest exactly once');
  assert.equal(api.isActive(), false);
  flushMicrotasks();
  window.CharacterMetaSave.update = writableMetaUpdate;
  delete window.CharacterMetaSave.schedule;
  delete window.LocalSaveFolder;
  delete window.HobunjiRuntimeSave;

  const originalUpdate = window.CharacterMetaSave.update;
  window.CharacterMetaSave.update = () => false; // Full storage must never grant an unsaved streak bonus.
  let invalidReward = 0;
  assert.equal(api.open({ id:'unwritable', tier:1, onSuccess() { invalidReward++; } }), true);
  press('Button4'); press('Button5');
  assert.equal(api.snapshot().phase, 'save-error', 'a secured but unsaved set remains visible for retry');
  assert.equal(api.snapshot().pendingStageSave, true);
  assert.equal(api.snapshot().stage, 1, 'the completed set is not discarded due to failed storage');
  assert.equal(invalidReward, 0, 'unsaved completion cannot grant treasure');
  press('Button1');
  assert.equal(api.snapshot().lastOutcome.outcome, 'cancelled');
  flushMicrotasks();
  window.CharacterMetaSave.update = originalUpdate;

  let failNextStageWrite = true; // One-off storage failure should recover using the in-game retry button.
  window.CharacterMetaSave.update = fn => {
    if (failNextStageWrite) { failNextStageWrite = false; return false; }
    return originalUpdate(fn);
  };
  let recoveredWins = 0;
  assert.equal(api.open({ id:'retry-stage-write', tier:1, onSuccess() { recoveredWins++; } }), true);
  press('Button4'); press('Button5');
  assert.equal(api.snapshot().pendingStageSave, true);
  byId.get('#chestLockRetry').listeners.get('click')();
  assert.equal(api.snapshot().phase, 'transition', 'retry resumes at the next stage, not at the beginning');
  assert.equal(recordFor('retry-stage-write').stage, 1);
  for (let i=0;i<14;i++) nextFrameTick();
  press('Button4'); press('Button5');
  assert.equal(recoveredWins, 1, 'a recovered stage-save completes and pays exactly once');
  flushMicrotasks();
  window.CharacterMetaSave.update = originalUpdate;

  let finalStageWins = 0;
  assert.equal(api.open({ id:'retry-final-write', tier:1, onSuccess() { finalStageWins++; } }), true);
  press('Button4'); press('Button5');
  for (let i=0;i<14;i++) nextFrameTick();
  window.CharacterMetaSave.update = () => false;
  press('Button4'); press('Button5');
  assert.equal(api.snapshot().pendingStageSave, true, 'last secured set waits for persistence before reward');
  assert.equal(finalStageWins, 0);
  window.CharacterMetaSave.update = originalUpdate;
  byId.get('#chestLockRetry').listeners.get('click')();
  assert.equal(finalStageWins, 1, 'saving the final set through retry pays exactly once');
  assert.equal(api.isActive(), false);
  flushMicrotasks();

  // Buried chest exercises the actual world action and existing async reward
  // callback, rather than testing the UI without granting real inventory.
  const area = 'zone_test';
  const TileType = { TRENCH: 'trench' };
  const grid = [[{ type: TileType.TRENCH }]];
  const chestMesh = {};
  const placement = {
    col: 0, row: 0, found: false, _mesh: chestMesh,
    loot: { metalKeys: ['tin'], gold: 5 },
  };
  const objectMap = new Map(), persisted = { week: 0, placements: [placement] };
  const flushed = [], toasts = [], activity = [], started = [];
  const inventory = {};
  const treasureWindow = {
    ChestLockpicking: { open(options) { started.push(options); return true; } },
    HobunjiRuntimeSave: { flushNow(options) { flushed.push(options); return { ok: true, captured: true }; } },
    InventoryStacks: { MAX_TOTAL: 999 },
    HobunjiActivityEvents: { emit(name, detail) { activity.push([name, detail]); } },
  };
  const treasureContext = { window: treasureWindow, console };
  vm.runInNewContext(read('wild-treasure.js'), vm.createContext(treasureContext), { filename: 'wild-treasure.js' });
  treasureWindow.WildTreasure.init({
    calendar: { day: 1 },
    _zoneTreasurePersist: new Map([[area, persisted]]),
    _zoneTreasureObjects: new Map([[area, objectMap]]),
    _zoneTreasureMeshGroups: new Map([[area, [chestMesh]]]),
    _zoneScenes: new Map([[area, { grid, scene: { remove() {} } }]]),
    TileType, getCurrentArea: () => area, rnd: () => 0, VERDIGRIS_METAL_KEYS: ['tin'],
    metalBarItemKey: name => name + 'Bar', METAL_DEFS: { tin: { label: 'Tin' } },
    ITEM_DEFS: {}, inventory,
    refreshItemScroll() {}, buildInventoryGrid() {}, buildPackClothingSection() {},
    showToast(message) { toasts.push(message); },
  });
  treasureWindow.WildTreasure.syncZoneInteractivity(area);
  const chest = objectMap.get('0,0');
  assert(chest);
  placement.lockpickUnlocked = true; // Legacy persisted bit must never authorize bypassing a new chest's minigame.
  assert.equal(chest.onAction('obj_open_treasure_chest').ok, false);
  assert.equal(started.length, 1);
  assert.equal(started[0].valid(), true);
  persisted.placements = []; // Weekly re-scatter/removal invalidates a previously targeted buried chest.
  assert.equal(started[0].valid(), false, 'a replaced chest may not grant old loot');
  persisted.placements = [placement];
  assert.equal(started[0].valid(), true);
  assert.equal(flushed.length, 0);
  assert.equal(inventory.gold, undefined);
  started[0].onSuccess({ bonusDrops: 1 }); // The real decorated chest action must preserve earned bonus metadata.
  assert.equal(placement.found, true);
  assert.equal(inventory.gold, 5);
  assert.equal(inventory.tinBar, 2, 'earned bonus adds one more real town-gated metal bar');
  assert.equal(flushed.length, 1, 'asynchronous chest loot commits the canonical live game save');
  assert.equal(flushed[0].reason, 'buried-chest-lockpicked');
  assert.equal(placement.lockpickUnlocked, true, 'legacy save metadata is ignored and never used for new bypass authorization');
  assert.equal(activity.length, 1);
  assert.equal(chest.onAction('obj_open_treasure_chest').ok, false, 'stale world object cannot grant the same treasure twice');

  console.log('PASS chest-lockpicking integration: permanent stages, saved failure penalty, scored bonus loot, stalled frames, cancel, invalid targets and buried treasure.');
})().catch(error => { console.error(error); process.exitCode = 1; });
