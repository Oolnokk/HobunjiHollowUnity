'use strict';

// Dev Companion window support: condition explanations must agree with the
// real eligibility rule, the autosave pause survives reloads in its tab,
// quick-load auto-play/resume hand-offs are one-shot and save-scoped, exact
// placement restore drives the right area entry, and the bridge answers a
// session-scoped companion command over BroadcastChannel.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const docs = path.resolve(__dirname, '..', 'docs');
const read = rel => fs.readFileSync(path.join(docs, rel), 'utf8');

function makeStorage(store = new Map()) {
  return {
    store,
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: key => { store.delete(key); },
  };
}

function makeContext(extra = {}) {
  const window = { addEventListener() {}, removeEventListener() {}, ...extra };
  window.window = window;
  window.console = console;
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.setInterval = () => 0;
  window.clearInterval = () => {};
  window.JSON = JSON;
  window.Date = Date;
  window.Math = Math;
  window.Promise = Promise;
  window.Number = Number;
  window.String = String;
  window.Object = Object;
  window.Array = Array;
  return vm.createContext(window);
}

(async () => {
  // ── ConditionRegistry.explainEntry agrees with entryEligible ─────────
  {
    const ctx = makeContext();
    vm.runInContext(read('js/condition-registry.js'), ctx);
    const reg = ctx.ConditionRegistry;
    const axes = { weekdays: reg.WEEKDAYS, seasons: reg.SEASONS, weather: reg.WEATHERS, timesOfDay: reg.TIMES_OF_DAY, encounter: reg.ENCOUNTERS, maps: ['town', 'farm'], stations: ['carpentry work', 'bar'], playerSpecies: reg.PLAYER_SPECIES };
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const pick = list => list[Math.floor(rand() * list.length)];
    let eligibleSeen = 0;
    for (let i = 0; i < 2000; i++) {
      const entry = { id: `e${i}`, conditions: {}, excludeConditions: {} };
      const world = {};
      for (const [axis, values] of Object.entries(axes)) {
        if (rand() < 0.3) entry.conditions[axis] = [pick(values), ...(rand() < 0.5 ? [pick(values)] : [])];
        if (rand() < 0.15) entry.excludeConditions[axis] = [pick(values)];
        if (rand() < 0.85) world[axis] = pick(values);
      }
      if (rand() < 0.3) entry.conditions.relationship = { min: rand() < 0.5 ? Math.floor(rand() * 5) : null, max: rand() < 0.5 ? 3 + Math.floor(rand() * 5) : null };
      if (rand() < 0.15) entry.excludeConditions.relationship = { min: Math.floor(rand() * 4), max: null };
      if (rand() < 0.8) { world.relationship = Math.floor(rand() * 9); world.relationshipUnit = 'hearts'; }
      const explained = reg.explainEntry(entry, world);
      assert.equal(explained.eligible, reg.entryEligible(entry, world), `explainEntry disagrees with entryEligible for ${JSON.stringify({ entry, world })}`);
      assert.equal(explained.specificity, reg.entrySpecificity(entry));
      if (explained.eligible) eligibleSeen++;
    }
    assert.ok(eligibleSeen > 50 && eligibleSeen < 1950, 'random cases cover both outcomes');
    const failing = reg.explainEntry({ conditions: { seasons: ['Coldmuck'] } }, { seasons: 'Stormtide' });
    assert.deepEqual(JSON.parse(JSON.stringify(failing.checks.map(c => [c.axis, c.kind, c.pass, c.current]))), [['seasons', 'require', false, 'Stormtide']]);
  }

  // ── Autosave pause persists in its tab's sessionStorage ─────────────
  {
    const session = makeStorage();
    const load = () => {
      const ctx = makeContext({ sessionStorage: session });
      vm.runInContext(read('js/autosave-pause.js'), ctx);
      return ctx.HobunjiAutosavePause;
    };
    let pause = load();
    assert.equal(pause.isPaused(), false);
    pause.pause('test');
    assert.equal(pause.isPaused(), true);
    pause = load(); // Same tab reloaded (quick load).
    assert.equal(pause.isPaused(), true, 'pause survives a same-tab reload');
    assert.equal(pause.getState().reason, 'test');
    pause.noteBlocked('folder-autosync');
    assert.equal(pause.getState().blockedCount, 1);
    let synced = null;
    pause = (() => {
      const ctx = makeContext({ sessionStorage: session, LocalSaveFolder: { getStatus: () => ({ state: 'ready', autoSyncArmed: false }), syncNow: options => { synced = options; return Promise.resolve(); } } });
      vm.runInContext(read('js/autosave-pause.js'), ctx);
      return ctx.HobunjiAutosavePause;
    })();
    pause.resume('test');
    assert.equal(pause.isPaused(), false);
    assert.deepEqual({ ...synced }, { automatic: false }, 'resuming re-arms an unarmed folder with one explicit sync');
  }

  // ── Autosave pause gates the checkpoint manager's rolling autosave ──
  {
    const source = read('js/save-checkpoint-manager.js');
    const folderCore = read('js/local-save-folder-core.js');
    assert.match(source, /HobunjiAutosavePause\?\.isPaused\?\.\(\)/);
    assert.match(folderCore, /automatic && window\.HobunjiAutosavePause\?\.isPaused\?\.\(\)/);
  }

  // ── Quick save: one-shot hand-offs + exact placement ────────────────
  {
    const session = makeStorage();
    const ctx = makeContext({ sessionStorage: session, location: { reload() {} } });
    vm.runInContext(read('js/quick-save.js'), ctx);
    const qs = ctx.HobunjiQuickSave;

    assert.equal(qs.takeAutoPlay(), null);
    qs.requestAutoPlay({ characterId: 'c1', worldId: 'w1' });
    assert.equal(qs.takeAutoPlay().characterId, 'c1');
    assert.equal(qs.takeAutoPlay(), null, 'auto-play is consumed once');

    session.setItem('hobunjiQuickLoadPending.v1', JSON.stringify({ slotId: 'x', requestedAt: Date.now() - 10 * 60 * 1000 }));
    const expired = await qs.applyPendingBeforeOnboarding();
    assert.equal(expired.applied, false);
    assert.equal(session.getItem('hobunjiQuickLoadPending.v1'), null, 'a stale pending load is discarded, never retried');

    const calls = [];
    let area = 'farm';
    const player = { x: 0, y: 0, angle: 0 };
    let facing = null;
    let farmSave = null;
    qs.init({
      player, TILE: 2,
      getCurrentArea: () => area,
      isZoneArea: a => a.startsWith('map_zone'),
      isBuildingArea: a => a.startsWith('map_i_'),
      enterZone: async (a, c, r) => { calls.push(['zone', a, c, r]); area = a; },
      enterTown: (c, r) => { calls.push(['town', c, r]); area = 'town'; },
      enterBuilding: (a, c, r) => { calls.push(['building', a, c, r]); area = a; },
      waitForArea: async () => true,
      placeInFarmhouse: () => { calls.push(['farmhouse']); area = 'interior'; },
      setFacingAngle: a => { facing = a; },
      setFarmPlayerSave: v => { farmSave = v; },
      snapCameraTarget: () => calls.push(['snap']),
      showToast() {},
    });
    const exact = { area: 'map_i_tavern', x: 11.5, y: 7.25, angle: 1.2, facingAngle: 1.2, returnPoint: { x: 40, y: 40, angle: 0, area: 'town' } };
    session.setItem('hobunjiQuickResume.v1', JSON.stringify({ characterId: 'c1', worldId: 'w1', exact, label: 'Tavern' }));
    assert.equal(await qs.restoreResume({ characterId: 'other', worldId: 'w1' }), false, 'resume is scoped to the saved farmer/world');
    session.setItem('hobunjiQuickResume.v1', JSON.stringify({ characterId: 'c1', worldId: 'w1', exact, label: 'Tavern' }));
    assert.equal(await qs.restoreResume({ characterId: 'c1', worldId: 'w1' }), true);
    assert.deepEqual(calls[0], ['building', 'map_i_tavern', 5, 3]);
    assert.equal(player.x, 11.5); assert.equal(player.y, 7.25); assert.equal(facing, 1.2);
    assert.equal(farmSave.area, 'town', 'the doorway you walk back out of is restored too');
    assert.equal(session.getItem('hobunjiQuickResume.v1'), null);

    area = 'farm'; calls.length = 0;
    session.setItem('hobunjiQuickResume.v1', JSON.stringify({ characterId: 'c1', worldId: 'w1', exact: { area: 'nowhere', x: 1, y: 1, angle: 0 } }));
    assert.equal(await qs.restoreResume({ characterId: 'c1', worldId: 'w1' }), false, 'an unreachable area falls back to the normal login spawn');
  }

  // ── Wiring into boot/onboarding/game.js ─────────────────────────────
  {
    const loader = read('js/local-save-folder.js');
    assert.ok(loader.indexOf('autosave-pause.js') < loader.indexOf('local-save-folder-core.js'));
    assert.ok(loader.indexOf('quick-save.js') < loader.indexOf('folder-save-primary.js'));
    assert.match(read('js/folder-save-primary.js'), /applyPendingBeforeOnboarding/);
    assert.match(read('onboarding-core.js'), /HobunjiQuickSave\?\.takeAutoPlay/);
    const game = read('game.js');
    assert.match(game, /HobunjiQuickSave\?\.init\(/);
    assert.match(game, /HobunjiQuickSave\?\.restoreResume\?\.\(playerData\)/);
    const index = read('index.html');
    assert.ok(index.indexOf('dev-companion-bridge.js') < index.indexOf('local-db-overrides.js'), 'the bridge wraps fetch before any config loader');
    assert.match(index, /id="devCompanionOpenBtn"/);
  }

  // ── Bridge: session-scoped command round trip ───────────────────────
  {
    const channels = new Map();
    class FakeChannel {
      constructor(name) { this.name = name; (channels.get(name) || channels.set(name, new Set()).get(name)).add(this); }
      postMessage(data) { for (const peer of channels.get(this.name)) if (peer !== this) queueMicrotask(() => peer.onmessage?.({ data: structuredClone(data) })); }
      close() { channels.get(this.name).delete(this); }
    }
    const ctx = makeContext({
      sessionStorage: makeStorage(),
      BroadcastChannel: FakeChannel,
      document: { readyState: 'complete', visibilityState: 'visible', getElementById: () => null, addEventListener() {} },
      location: { href: 'http://x/docs/index.html', origin: 'http://x' },
      URL, performance: { now: () => 0, getEntriesByType: () => [] },
      fetch: async () => ({ status: 200, headers: { get: () => null } }),
      queueMicrotask, structuredClone,
    });
    vm.runInContext(read('js/dev-companion-bridge.js'), ctx);
    const bridge = ctx.DevCompanion;
    bridge.registerCommand('echo', args => ({ ok: true, echoed: args.value }));
    bridge.registerStateProvider('probe', () => ({ n: 1 }));
    await ctx.fetch('config/npcs/test.json');
    await ctx.fetch('assets/art.png');
    assert.deepEqual(JSON.parse(JSON.stringify(bridge.configLog().map(entry => entry.path))), ['config/npcs/test.json'], 'only config/JSON fetches are logged');

    const received = [];
    const companion = new FakeChannel('hobunji-dev-companion-v1:' + bridge.sessionId);
    const stranger = new FakeChannel('hobunji-dev-companion-v1:someone-else');
    stranger.onmessage = () => assert.fail('another session must never hear this game');
    companion.onmessage = event => received.push(event.data);
    const envelope = message => ({ protocol: 1, session: bridge.sessionId, from: 'companion', ...message });
    companion.postMessage(envelope({ type: 'companion-hello' }));
    companion.postMessage(envelope({ type: 'command', requestId: 'r1', name: 'echo', args: { value: 42 } }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(received.some(m => m.type === 'hello'));
    assert.equal(received.find(m => m.type === 'state')?.state?.probe?.n, 1);
    assert.ok(received.find(m => m.type === 'config-access' && m.full)?.entries.length === 1);
    const reply = received.find(m => m.type === 'reply' && m.requestId === 'r1');
    assert.equal(reply.ok, true);
    assert.equal(reply.result.echoed, 42);
    assert.equal(bridge.isConnected(), true);
    bridge.trace('dialogue', { event: 'node' });
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(received.some(m => m.type === 'trace' && m.record.channel === 'dialogue'));
  }

  console.log('test-dev-companion: ok');
})().catch(error => { console.error(error); process.exit(1); });
