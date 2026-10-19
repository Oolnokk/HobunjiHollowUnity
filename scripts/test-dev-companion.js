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


    // The discovery channel only publishes candidate metadata, not commands.
    const replies = [];
    const scout = new FakeChannel('hobunji-dev-companion-discovery-v1');
    scout.onmessage = e => replies.push(e.data);
    scout.postMessage({ protocol: 1, type: 'find-games', requestId: 'd1' });
    await new Promise(resolve => setTimeout(resolve, 10));
    const announcement = replies.find(m => m.type === 'game-available');
    assert.equal(announcement?.requestId, 'd1');
    assert.equal(announcement?.session, bridge.sessionId);
    assert.equal(announcement?.gameHref, 'http://x/docs/index.html');
    assert.equal(announcement?.companionHref, 'http://x/docs/tools/dev-companion/index.html?session=' + bridge.sessionId);
    scout.postMessage({ protocol: 1, type: 'command', requestId: 'bad', name: 'echo' });
    scout.postMessage({ protocol: 1, type: 'find-games', requestId: '' });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(replies.length, 1, 'discovery cannot execute commands or respond to invalid scans');

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

    // Context panels: shown only while when() holds, actions routed back to the module.
    let visible = false;
    let acted = null;
    bridge.registerPanel({ id: 'ctx', title: 'Ctx', when: () => visible, render: () => ({ summary: 'hi', actions: [{ id: 'go', label: 'Go' }] }), onAction: (action, args) => { acted = [action, args.n]; return { ok: true }; } });
    const panelsNow = () => JSON.parse(JSON.stringify(bridge.collectState().panels));
    assert.deepEqual(panelsNow(), [], 'a panel is hidden while its context does not apply');
    visible = true;
    assert.equal(panelsNow()[0].summary, 'hi');
    received.length = 0;
    companion.postMessage(envelope({ type: 'command', requestId: 'r2', name: 'panel-action', args: { panel: 'ctx', action: 'go', args: { n: 3 } } }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(acted, ['go', 3]);
    const partial = received.find(m => m.type === 'state');
    assert.ok(partial?.partial, 'after a command only changed providers are sent');
    assert.ok('panels' in partial.state && !('probe' in partial.state), 'unchanged providers are not resent');

    const devBox = { checked: false }; // Simulates the game's existing Dev Mode checkbox.
    ctx.document.getElementById = id => id === 'settingDevMode' ? devBox : null;
    ctx.__hobunjiGameStarted = true;
    let grants = 0; // Verifies unavailable/stale companion clicks cannot mutate the game.
    bridge.registerCheatPanel({ id: 'grant', render: () => ({ actions: [] }), onAction: () => { grants++; return { ok: true }; } });
    const grant = () => bridge.runCommand('panel-action', { panel: 'grant', action: 'give' }); // Uses the same command route as BroadcastChannel.
    assert.ok(!panelsNow().some(panel => panel.id === 'grant'));
    await assert.rejects(grant, /not currently available/);
    devBox.checked = true;
    assert.ok(panelsNow().some(panel => panel.id === 'grant'));
    await grant();
    assert.equal(grants, 1);
    devBox.checked = false;
    await assert.rejects(grant, /not currently available/);
    assert.equal(grants, 1);
    devBox.checked = true;
    ctx.__hobunjiGameStarted = false;
    await assert.rejects(grant, /not currently available/);

  }


  // ── Discovering one game must never automatically switch ────────────
  {
    const source = read('tools/dev-companion/dev-companion.js');
    const html = read('tools/dev-companion/index.html');
    // The newly selected game should reuse this popup, not spawn another.
    const bootHeader = source.slice(source.indexOf('  const params ='), source.indexOf('  const CHANNEL_PREFIX ='));
    const popup = { name: 'hobunji-dev-companion-soldgame123' };
    const newBuild = vm.createContext({
      URLSearchParams, location: { search: '?session=snextgame123' }, window: popup,
    });
    vm.runInContext(bootHeader, newBuild);
    assert.equal(popup.name, 'hobunji-dev-companion-snextgame123', 'switched companion adopts the new session popup name');
    const invalidPopup = { name: 'existing-popup' };
    vm.runInContext(bootHeader, vm.createContext({
      URLSearchParams, location: { search: '?session=invalid-session' }, window: invalidPopup,
    }));
    assert.equal(invalidPopup.name, 'existing-popup', 'invalid session IDs cannot change the popup name');
    assert.match(html, /id="findGamesBtn"/);
    assert.match(html, /id="gameDiscovery"/);
    assert.match(source, /onclick: \(\) => switchToGame\(game\)/);
    const begin = source.indexOf('  function validGameAnnouncement(');
    const finish = source.indexOf('  function renderDiscovery()', begin);
    assert.ok(begin > 0 && finish > begin, 'session switch helpers are available for testing');
    const navigations = [];
    const domNode = () => ({ hidden: false, textContent: '', replaceChildren() {} });
    const context = {
      URL, Date, Map, Number, String,
      location: { origin: 'https://raw.githack.com', pathname: '/Oolnokk/HobunjiHollowUnity/abc/docs/tools/dev-companion/index.html', assign: href => navigations.push(href) },
      '$': () => domNode(), renderDiscovery() {}, toast: message => { throw Error(message); },
      clearTimeout() {}, setTimeout: () => 0,
      sessionId: 'sinitial123', state: { connected: false, activeTab: 'now' },
      discoveredGames: new Map(), conflictingSessions: new Set(), activeScanId: 'd2', scanSequence: 0,
      scanning: false, scanFinished: false, scanTimer: null,
      discoveryChannel: { postMessage() {} }, DISCOVERY_WAIT_MS: 1800,
    };
    vm.createContext(context);
    vm.runInContext(source.slice(begin, finish) + '\nthis.discoveryAPI = { validGameAnnouncement, acceptDiscovery, switchToGame, scanGames };', context);
    const url = 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/def/docs/tools/dev-companion/index.html?session=snextgame123';
    const game = {
      protocol: 1, type: 'game-available', requestId: 'd2', session: 'snextgame123',
      gameHref: 'https://raw.githack.com/Oolnokk/HobunjiHollowUnity/def/docs/index.html',
      companionHref: url, title: 'Hobunji Hollow',
    };
    context.discoveryAPI.acceptDiscovery(game);
    assert.equal(context.discoveredGames.size, 1);
    assert.equal(navigations.length, 0, 'even a single candidate does not cause a switch');
    context.discoveryAPI.switchToGame(context.discoveredGames.get('snextgame123'));
    assert.deepEqual(navigations, [url], 'Switch opens the target build and exact session');
    assert.equal(context.discoveryAPI.validGameAnnouncement({ ...game, requestId: 'old' }), null);
    assert.equal(context.discoveryAPI.validGameAnnouncement({ ...game, companionHref: url.replace('raw.githack.com', 'evil.example') }), null);
    assert.equal(context.discoveryAPI.validGameAnnouncement({ ...game, companionHref: url.replace('snextgame123', 'swrong123') }), null);
    assert.equal(context.discoveryAPI.validGameAnnouncement({ ...game, companionHref: url.replace('/tools/dev-companion/', '/other/') }), null);
    // Duplicating a tab can clone sessionStorage and therefore the session ID.
    // Two distinct pages on one command channel must never be selectable.
    context.discoveryAPI.acceptDiscovery({ ...game, pageLoadId: 'different-page-instance' });
    assert.equal(context.conflictingSessions.has('snextgame123'), true, 'duplicate-tab session IDs are flagged');
    assert.throws(
      () => context.discoveryAPI.switchToGame(context.discoveredGames.get('snextgame123')),
      /share this session ID/,
      'a duplicated session is never switched into'
    );
    assert.equal(navigations.length, 1, 'session conflict does not navigate');
    context.discoveryAPI.scanGames();
    assert.equal(context.conflictingSessions.size, 0, 'a new scan discards old collision reports');
    assert.equal(navigations.length, 1, 'Find Games cannot navigate');
  }

  // ── Calendar time skips use the same time-of-day bands as conditions ─
  {
    const fishing = read('js/fishing-minigame.js');
    assert.match(fishing, /function fishingTimeOfDay\(hour = deps\?\.getHour\?\.\(\)\)/);
    const calendar = read('js/calendar-system.js');
    assert.match(calendar, /registerPanel\(\{\s*id: 'time-weather'/);
    assert.match(read('js/dialogue-content.js'), /id: 'conversation'/);
  }

  console.log('test-dev-companion: ok');
})().catch(error => { console.error(error); process.exit(1); });
