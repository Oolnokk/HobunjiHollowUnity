'use strict';
// Browser-level regression harness for the standalone GitHack commit link builder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../docs/commit-link-builder.html'), 'utf8');
const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/);
assert(inline, 'standalone builder script exists');
const MAIN_SHA = 'a'.repeat(40);
const FEATURE_SHA = 'b'.repeat(40);
const REPO = 'Oolnokk/HobunjiHollowUnity';

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.handlers = {};
    this.value = '';
    this.textContent = '';
    this.style = {};
    this.disabled = false;
  }
  get options() { return this.children.flatMap(child => child.tag === 'optgroup' ? child.children : [child]); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  dispatch(type) { return this.handlers[type]?.({ preventDefault() {} }); }
  removeAttribute() {}
  setAttribute() {}
  focus() {}
  select() {}
}

function harness({ events = [], prs = [], failEvents = false, failPrs = false, deferMain = false, graphQL } = {}) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)]
    .map(match => [match[1], new FakeElement(match[1] === 'recentBranches' ? 'select' : 'input')]));
  elements.branch.value = 'main';
  elements.gamePath.value = 'docs/index.html';
  elements.hubPath.value = 'docs/tools/index.html';
  const requests = []; // Exposes which GitHub API endpoints the page actually called.
  let preferences = null; // Captures persisted defaults when the custom branch field is empty.
  let releaseMain = null; // Lets the test deliver an obsolete main response after a branch switch.
  let now = Date.parse('2026-11-13T12:00:00Z'); // Mock clock shared by poll timers and commit ages.
  let timerId = 0; // Identifies each registered timeout.
  let notes = 0; // Counts audio notes that were actually scheduled.
  const timers = new Map(); // Stores pending mock timeouts by ID.
  const document = {
    title: 'Link builder',
    hidden: true,
    hasFocus: () => false,
    addEventListener() {},
    getElementById: id => elements[id],
    createElement: tag => new FakeElement(tag),
    createTextNode: text => ({ textContent: text }),
  }; // Supplies the page state needed by the tab alert.
  const windowEvents = {}; // Lets the test simulate refocusing the tab.
  class AudioContext {
    state = 'running';
    currentTime = 0;
    async resume() {}
    createOscillator() {
      return { frequency: {}, connect() {}, start() { notes++; }, stop() {} };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
  }
  class MockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const fetchMock = async (requestUrl, options) => {
    const url = new URL(requestUrl);
    requests.push(url.toString());
    if (url.pathname === '/graphql' && graphQL) {
      const { query, variables } = JSON.parse(options.body); // Inspects which PRs were requested.
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      assert.equal(options.redirect, 'error');
      const repository = await graphQL(query, variables); // May return a simulated API error.
      if (repository instanceof Response) return repository;
      return new Response(JSON.stringify({ data: { repository } }), { status: 200 });
    }
    if (url.pathname.endsWith('/commits')) {
      const name = url.searchParams.get('sha');
      if (name === 'main' && deferMain) await new Promise(resolve => { releaseMain = resolve; });
      return { ok: true, json: async () => [{
        sha: name === 'main' ? MAIN_SHA : FEATURE_SHA,
        commit: { committer: { date: '2026-11-03T14:00:00Z' } },
      }] };
    }
    if (url.pathname.endsWith('/events')) {
      return failEvents
        ? { ok: false, status: 403 }
        : { ok: true, json: async () => events };
    }
    if (url.pathname.endsWith('/pulls')) {
      return failPrs
        ? { ok: false, status: 403 }
        : { ok: true, json: async () => prs };
    }
    throw Error('Unexpected GitHub request: ' + url);
  };
  vm.runInNewContext(inline[1], {
    document,
    window: { addEventListener(type, handler) { windowEvents[type] = handler; }, open() {}, AudioContext },
    fetch: fetchMock,
    URL, Date: MockDate, AbortController, DOMException,
    setTimeout(callback, delay) {
      const id = ++timerId; // Allows canceled callbacks to be removed.
      timers.set(id, { callback, at: now + Math.max(0, delay) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    localStorage: { getItem: () => preferences, setItem(_key, value) { preferences = value; } },
    navigator: {},
    location: { href: 'https://example.com/docs/commit-link-builder.html' },
  }, { filename: 'commit-link-builder.inline.js' });
  return {
    elements, requests, document, windowEvents,
    releaseMain: () => releaseMain?.(),
    stored: () => JSON.parse(preferences || 'null'),
    notes: () => notes,
    now: () => now,
    async advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers]) {
        if (timer.at > now || !timers.delete(id)) continue;
        await timer.callback();
      }
    },
  };
}

async function flush() {
  // Promise-based mocked fetches complete without sleeping or loading a real page.
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

async function run() {
  const app = harness({
    events: [
      { type: 'CreateEvent', payload: { ref: 'feature/recent', ref_type: 'branch' }, created_at: '2026-11-03T14:00:00Z' },
      { type: 'CreateEvent', payload: { ref: 'feature/old', ref_type: 'branch' }, created_at: '2026-11-02T14:00:00Z' },
      { type: 'DeleteEvent', payload: { ref: 'feature/deleted', ref_type: 'branch' }, created_at: '2026-11-02T12:00:00Z' },
      { type: 'CreateEvent', payload: { ref: 'feature/recreated', ref_type: 'branch' }, created_at: '2026-11-02T11:00:00Z' },
      { type: 'DeleteEvent', payload: { ref: 'feature/recreated', ref_type: 'branch' }, created_at: '2026-11-02T10:00:00Z' },
      { type: 'CreateEvent', payload: { ref: 'feature/deleted', ref_type: 'branch' }, created_at: '2026-11-01T15:00:00Z' },
      { type: 'CreateEvent', payload: { ref: 'feature/recent', ref_type: 'branch' }, created_at: '2026-11-01T14:00:00Z' },
      null,
      { type: 'CreateEvent' },
      { type: 'CreateEvent', payload: { ref: '<script>', ref_type: 'branch' }, created_at: '2026-11-01T14:00:00Z' },
      { type: 'PushEvent', payload: { ref: 'main' } },
    ],
    prs: [
      null,
      { head: { ref: 'feature/recent', repo: { full_name: REPO } }, created_at: '2026-11-03T15:00:00Z' },
      { head: { ref: 'feature/open-pr', repo: { full_name: REPO } }, created_at: '2026-11-02T15:00:00Z' },
      { head: { ref: 'outside-fork', repo: { full_name: 'other/repo' } }, created_at: '2026-11-02T15:00:00Z' },
    ],
  });
  await flush();
  const { elements } = app;
  assert.equal(elements.commit.value, MAIN_SHA, 'default main commit is resolved on load');
  const options = elements.recentBranches.options.map(option => option.value);
  assert.deepEqual(options, ['', 'main', 'feature/recent', 'feature/old', 'feature/recreated', 'feature/open-pr']);
  assert(!options.includes('feature/deleted'), 'deleted branches are not offered from historical CreateEvents');
  assert.equal(elements.recentBranches.value, 'main', 'main remains the default picker value');
  assert.match(elements.recentHelp.textContent, /3 recent creations; 1 other open PR branches/);

  elements.recentBranches.value = 'feature/recent';
  elements.recentBranches.dispatch('change');
  await flush();
  assert.equal(elements.branch.value, 'feature/recent', 'selecting a branch updates manual field');
  assert.equal(elements.commit.value, FEATURE_SHA, 'selection resolves the chosen branch HEAD');
  assert.match(elements.gameLink.value, new RegExp('/' + FEATURE_SHA + '/docs/index.html$'));
  assert.match(elements.hubLink.value, new RegExp('/' + FEATURE_SHA + '/docs/tools/index.html$'));
  assert(app.requests.some(url => url.includes('sha=feature%2Frecent')), 'lookup URL encodes slash in branch');

  elements.fetchLatest.dispatch('click');
  assert.equal(elements.commit.value, '', 'explicit refresh immediately clears the previously pinned SHA');
  assert.equal(elements.gameLink.value, '', 'old GitHack link is disabled while resolving a newer commit');
  await flush();
  assert.equal(elements.commit.value, FEATURE_SHA, 'refresh restores a confirmed branch HEAD');

  elements.recentBranches.value = '';
  elements.recentBranches.dispatch('change');
  assert.equal(elements.branch.value, '', 'selecting custom clears the prior branch, ready for manual entry');
  assert.equal(elements.commit.value, '', 'selecting custom invalidates the old pinned URL');
  assert.equal(app.stored().branch, 'main', 'unfinished custom entry cannot corrupt the next startup default');

  elements.branch.value = 'feature/custom';
  elements.branch.dispatch('input');
  assert.equal(elements.commit.value, '', 'switching to a custom branch clears the stale SHA');
  assert.equal(elements.gameLink.value, '', 'invalidates stale pinned URL');
  assert.equal(elements.recentBranches.value, '', 'picker reflects the custom branch');
  assert.equal(app.stored().branch, 'feature/custom', 'finished custom branch is persisted correctly');

  const partial = harness({
    failEvents: true,
    prs: [{ head: { ref: 'feature/pr-only', repo: { full_name: REPO } }, created_at: '2026-11-02T15:00:00Z' }],
  });
  await flush();
  assert(partial.elements.recentBranches.options.some(option => option.value === 'feature/pr-only'),
    'open PRs remain usable if creation events are unavailable');

  const unavailable = harness({ failEvents: true, failPrs: true });
  await flush();
  assert.equal(unavailable.elements.recentBranches.options.length, 2, 'manual/main choices survive API failures');
  assert.match(unavailable.elements.recentHelp.textContent, /Branch list unavailable/);
  assert.equal(unavailable.elements.commit.value, MAIN_SHA, 'failed discovery does not interrupt commit lookup');

  const raced = harness({
    deferMain: true,
    events: [{ type: 'CreateEvent', payload: { ref: 'feature/recent', ref_type: 'branch' }, created_at: '2026-11-03T14:00:00Z' }],
  });
  await flush();
  raced.elements.recentBranches.value = 'feature/recent';
  raced.elements.recentBranches.dispatch('change');
  await flush();
  raced.releaseMain();
  await flush();
  assert.equal(raced.elements.commit.value, FEATURE_SHA, 'obsolete main SHA cannot overwrite branch selection');
  console.log('GitHack link builder: recent-branch picker, PR fallback, custom entry, API failure and stale lookup passed');
  await runMonitor();
}

async function runMonitor() {
  const queried = []; // Records only PR status polls, so discovery cannot mask an unsolicited watch.
  let pr; // Mutable GitHub snapshot for PR #42.
  let rateLimited = false; // Simulates throttling during an active poll.
  const app = harness({ graphQL(query, variables) {
    if (query.includes('pullRequests(')) {
      return { pullRequests: variables.cursor
        ? { nodes: [{ number: 43, title: 'Unselected PR' }], pageInfo: { hasNextPage: false } }
        : { nodes: [{ number: 42, title: 'Selected PR' }], pageInfo: { hasNextPage: true, endCursor: 'next' } } };
    }
    queried.push(query);
    if (rateLimited) return new Response('{}', { status: 429, headers: { 'retry-after': '75' } });
    return { pr42: pr };
  } });
  const { elements } = app; // Lets the test drive the same UI handlers as a browser.
  function snapshot(sha, committedAt, checks, mergeable, mergeStateStatus, state = 'OPEN') {
    return { state, isDraft: false, mergeable, mergeStateStatus, headRefOid: sha, commits: {
      nodes: [{ commit: { oid: sha, committedDate: new Date(committedAt).toISOString(), statusCheckRollup: checks && { state: checks } } }],
    } };
  }
  const start = app.now(); // Sets exact threshold crossings relative to the fake clock.
  pr = snapshot(MAIN_SHA, start - 290000, 'PENDING', 'CONFLICTING', 'DIRTY');
  elements.prToken.value = 'test-token';
  await elements.prAccess.dispatch('submit');
  assert.equal(elements.prToken.value, '');
  assert.deepEqual(elements.prChoices.options.map(option => option.value), ['42', '43']);
  assert.equal(elements.prWatchList.children.length, 0, 'loading choices leaves the watch list empty');
  elements.prChoices.value = '42';
  elements.prPicker.dispatch('submit');
  await app.advance(0);
  assert.equal(queried.length, 0, 'adding a PR without conditions does not start polling');
  const boxes = elements.prWatchList.children[0].children.filter(child => child.tag === 'label')
    .map(label => label.children[0]); // Four checkboxes in display order.
  assert.equal(boxes.length, 4);
  for (const box of boxes) {
    box.checked = true;
    box.dispatch('change');
  }
  await app.advance(0);
  assert.match(queried[0], /pullRequest\(number: 42\)/);
  assert.doesNotMatch(queried[0], /number: 43/);
  assert.equal(app.notes(), 0, 'initial baseline is silent');
  await app.advance(9999);
  assert.equal(queried.length, 1, 'waits the full ten seconds');
  await app.advance(1);
  assert.match(elements.prAlertText.textContent, /reached 5 minutes/);
  assert.doesNotMatch(elements.prAlertText.textContent, /10 minutes/);
  assert.match(app.document.title, /PR ready/);
  assert.equal(app.notes(), 2, 'plays both notes of the chime');
  await app.advance(850);
  assert.equal(app.document.title, 'Link builder', 'background title alternates');
  app.windowEvents.focus();
  assert.equal(app.document.title, 'Link builder', 'focus stops flashing without dismissing the alert');
  elements.prAcknowledge.dispatch('click');
  assert.equal(elements.prAlert.hidden, true);
  pr = snapshot(MAIN_SHA, start - 290000, 'PENDING', 'UNKNOWN', 'UNKNOWN');
  await app.advance(9150);
  pr = snapshot(MAIN_SHA, start - 290000, 'SUCCESS', 'MERGEABLE', 'CLEAN');
  await app.advance(10000);
  assert.match(elements.prAlertText.textContent, /all checks passed, became mergeable/);
  assert.equal(app.notes(), 4, 'simultaneous transitions share one chime');
  await app.advance(280000);
  assert.match(elements.prAlertText.textContent, /reached 10 minutes/);
  await app.advance(10000);
  assert.equal(app.notes(), 6, 'already-ready conditions remain silent');
  elements.prAcknowledge.dispatch('click');
  pr = snapshot(FEATURE_SHA, app.now(), null, 'MERGEABLE', 'CLEAN');
  await app.advance(10000);
  boxes[3].checked = false;
  boxes[3].dispatch('change');
  await app.advance(590000);
  assert.equal(elements.prAlertText.textContent, '#42 latest commit reached 5 minutes', 'new heads rearm timers and unchecked conditions stay silent');
  rateLimited = true;
  await app.advance(10000);
  assert.match(elements.prStatus.textContent, /rate limit reached/i);
  const beforeRetry = queried.length; // Ensures backoff spans the rate limit window.
  await app.advance(74000);
  assert.equal(queried.length, beforeRetry);
  rateLimited = false;
  pr = snapshot(FEATURE_SHA, app.now(), 'SUCCESS', 'MERGEABLE', 'CLEAN', 'MERGED');
  await app.advance(1000);
  assert.match(elements.prStatus.textContent, /No open PRs/);
  await app.advance(10000);
  assert.equal(queried.length, beforeRetry + 1, 'merged PRs stop polling');
  assert.doesNotMatch(JSON.stringify(app.stored()), /test-token/);
  assert.doesNotMatch(elements.debugLog.textContent, /test-token/);
  console.log('GitHack link builder: manual PR selection, checks, merge, commit-age timers, chime, tab flash, and backoff passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
