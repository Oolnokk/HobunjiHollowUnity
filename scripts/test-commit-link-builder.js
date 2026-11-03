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
  dispatch(type) { this.handlers[type]?.({ preventDefault() {} }); }
  removeAttribute() {}
  setAttribute() {}
  focus() {}
  select() {}
}

function harness({ events = [], prs = [], failEvents = false, failPrs = false, deferMain = false } = {}) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)]
    .map(match => [match[1], new FakeElement(match[1] === 'recentBranches' ? 'select' : 'input')]));
  elements.branch.value = 'main';
  elements.gamePath.value = 'docs/index.html';
  elements.hubPath.value = 'docs/tools/index.html';
  const requests = []; // Exposes which GitHub API endpoints the page actually called.
  let releaseMain = null; // Lets the test deliver an obsolete main response after a branch switch.
  const fetchMock = async (requestUrl) => {
    const url = new URL(requestUrl);
    requests.push(url.toString());
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
    document: {
      getElementById: id => elements[id],
      createElement: tag => new FakeElement(tag),
    },
    window: { addEventListener() {}, open() {} },
    fetch: fetchMock,
    URL, Date, AbortController,
    setTimeout: () => 0,
    clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {} },
    navigator: {},
    location: { href: 'https://example.com/docs/commit-link-builder.html' },
  }, { filename: 'commit-link-builder.inline.js' });
  return { elements, requests, releaseMain: () => releaseMain?.() };
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

  elements.branch.value = 'feature/custom';
  elements.branch.dispatch('input');
  assert.equal(elements.commit.value, '', 'switching to a custom branch clears the stale SHA');
  assert.equal(elements.gameLink.value, '', 'invalidates stale pinned URL');
  assert.equal(elements.recentBranches.value, '', 'picker reflects the custom branch');

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
}

run().catch(error => { console.error(error); process.exitCode = 1; });
