#!/usr/bin/env node
'use strict';
// Regression for the saved-state-only World Town Progress page and its menu integration.
const assert = require('node:assert/strict'); // Checks menu wiring and quest/value accounting without loading WebGL.
const fs = require('node:fs'); // Reads the real committed game files.
const path = require('node:path'); // Resolves fixture paths relative to the repository.
const vm = require('node:vm'); // Runs the browser module with a minimal in-memory DOM.
const root = path.resolve(__dirname, '..'); // Used for index, menu and module fixture paths.
const read = name => fs.readFileSync(path.join(root, name), 'utf8'); // Always test shipped code, not a replica.

const index = read('docs/index.html'); // Ensures the new page and stylesheet are actually served by the game.
const menu = read('docs/js/menu-tab-icon-only.js'); // The icon-only menu's destination order is authoritative.
assert.match(index, /data-mpanel="map"[\s\S]*data-mpanel="worldProgress"[\s\S]*data-mpanel="tasks"/);
assert.match(index, /id="mpWorldProgress"/);
assert.match(index, /js\/world-town-progress\.js/);
assert.match(index, /world-town-progress\.css/);
assert(index.indexOf('js/town-mine.js') < index.indexOf('js/world-town-progress.js'), 'mine authority loads before the view');
assert(index.indexOf('js/banubu-questline.js') < index.indexOf('js/world-town-progress.js'), 'quest controller loads before the view');
assert(menu.indexOf("map: ['World'") < menu.indexOf("worldProgress: ['World'"));
assert(menu.indexOf("worldProgress: ['World'") < menu.indexOf("tasks: ['World'"));

class FakeNode {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {};
    this.style = {}; this.dataset = {}; this.className = ''; this.textContent = '';
    this.listeners = {}; this.classes = new Set();
    this.classList = {
      contains: name => this.classes.has(name),
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
    };
  }
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.children.push(item); return item; }
  replaceChildren(...items) { this.children = [...items]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(event, callback) { (this.listeners[event] ||= []).push(callback); }
  click() { for (const callback of this.listeners.click || []) callback({ target: this }); }
}
const tab = new FakeNode('button'); // Existing main-menu destination whose click should activate the matching pane.
const pane = new FakeNode('div'); // Hosted under mp-body and therefore has the game's one native pane scrollbar.
const mapTab = new FakeNode('button');
const mapPane = new FakeNode('div');
mapTab.classList.add('active'); mapPane.classList.add('active');
const document = {
  readyState: 'complete',
  getElementById: id => id === 'mpWorldProgress' ? pane : id === 'menuPanel' ? null : null,
  querySelector: selector => selector.includes('worldProgress') ? tab : null,
  querySelectorAll: selector => selector.includes('.mp-tab') ? [mapTab, tab] : selector.includes('.mp-pane') ? [mapPane, pane] : [],
  createElement: tag => new FakeNode(tag),
};
const state = {
  mineValue: 1,
  tiers: [1],
  foundry: false,
  floor: 17,
  quest: { status: 'intro', stage: 0 },
};
const window = {
  document,
  __hobunjiPlayerProfile: { questProgress: { banubu_fish_pies: state.quest } },
  TownMine: {
    serialize: () => ({
      townValue: state.mineValue,
      deepestFloor: state.floor,
      unlockedShortcutTiers: state.tiers,
      improvements: state.foundry ? ['foundry'] : [],
    }),
    hasImprovement: id => id === 'foundry' && state.foundry,
    getTownValue: () => state.mineValue + (state.foundry ? 3 : 0),
  },
  BanubuQuestline: { ensureQuestState: () => state.quest },
  addEventListener: () => {},
};
const vmContext = vm.createContext({ window, document, MutationObserver: class { observe() {} }, console, Promise });
vm.runInContext(read('docs/js/world-town-progress.js'), vmContext, { filename: 'world-town-progress.js' });
const view = window.TownProgressPanel; // Public, read-only debugging and snapshot API tested against the real module.

function current() { return JSON.parse(JSON.stringify(view.snapshot())); }
function allText(item) { return [item.textContent || '', ...item.children.flatMap(child => [allText(child)])].join(' '); }

async function main() {
  assert.equal(view.version, 1);
  let snap = current();
  assert.equal(snap.townValue, 1);
  assert.equal(snap.mineValue, 1);
  assert.equal(snap.feyCount, 4);
  assert.equal(snap.specified, 5, 'the three unbuilt Fey must not manufacture quest counts');
  assert.equal(snap.playable, 2, 'only Banubu quests 1–2 are currently playable');
  assert.equal(snap.completed, 0);
  assert.equal(snap.unspecifiedFeyCount, 3);

  state.quest = { status: 'active', stage: 1 };
  assert.equal(current().completed, 0, 'starting the pie must not count as completing it');
  state.quest = { status: 'offer', stage: 2 };
  assert.equal(current().completed, 1, 'pie turn-in completes one quest');
  state.quest = { status: 'active', stage: 2 };
  assert.equal(current().completed, 1, 'active tea must not be counted as done');
  state.quest = { status: 'blocked', stage: 3 };
  assert.equal(current().completed, 2, 'after tea turn-in, only the two playable quests are done');

  state.tiers = [1, 2, 3];
  state.mineValue = 3;
  state.floor = 48;
  state.foundry = true;
  snap = current();
  assert.equal(snap.townValue, 6, 'canonical TownMine total includes the Foundry only when built');
  assert.equal(snap.mineValue, 3);
  assert.equal(snap.foundryValue, 3);
  assert.equal(snap.tiers.length, 3);
  assert.equal(snap.deepestFloor, 48);

  const rendered = view.render();
  assert.equal(rendered.townValue, 6);
  assert.match(allText(pane), /Town Value/);
  assert.match(allText(pane), /Quests 3–5/);
  assert.match(allText(pane), /Foundry upgrade/);
  assert.match(allText(pane), /Hiki-hiki/);

  tab.click(); // Exercises the compatibility fallback when a legacy main-menu switcher doesn't recognize the new destination.
  await Promise.resolve();
  assert(tab.classList.contains('active'));
  assert(pane.classList.contains('active'));
  assert(!mapTab.classList.contains('active'));
  assert(!mapPane.classList.contains('active'));

  state.quest = { status: 'active', stage: 2 };
  state.foundry = false;
  snap = current();
  assert.equal(snap.completed, 1);
  assert.equal(snap.foundryValue, 0);
  assert.equal(snap.townValue, 3);
  assert.equal(view.debugSnapshot().panePresent, true);
  console.log('World Town Progress tab: menu integration, rendering, saves, construction states and Town Value accounting passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
