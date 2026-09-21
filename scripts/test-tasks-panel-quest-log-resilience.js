#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

class FakeElement {
  constructor() {
    this.children = []; // Used to inspect rows appended by the Tasks panel renderer.
    this.className = '';
    this.dataset = {};
    this.style = {};
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = String(value); // Used by assertions that inspect the rendered quest copy.
    if (value === '') this.children = [];
  }

  get innerHTML() { return this._innerHTML; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  querySelector() { return null; }
  addEventListener() {}
  setAttribute() {}
}

const source = fs.readFileSync(path.join(__dirname, '..', 'docs/js/tasks-panel.js'), 'utf8');
const tasksList = new FakeElement(); // Used as the only mounted Tasks-panel DOM target needed by this regression test.
const elements = { tasksList }; // Used by the fake document to expose the Quest Log while omitting unrelated posting panes.
const document = {
  getElementById(id) { return elements[id] || null; },
  createElement() { return new FakeElement(); },
  createTextNode(text) { return { textContent: String(text) }; },
};

const questProgress = { // Used as the live quest state returned through the same getter the game injects into TasksPanel.
  request_test: {
    status: 'available',
    progress: {
      kind: 'request',
      npcId: 'hreesh',
      npcName: 'Hreesh',
      items: [{ itemKey: 'needlegrain', qty: 2 }],
      rewardGold: 12,
      rewardFriendship: 1,
      deadlineDay: null,
    },
  },
};
const debugMessages = []; // Used to verify refresh failures remain observable instead of being silently swallowed.
const context = vm.createContext({
  console,
  document,
  window: {
    ProceduralTasks: {
      maybeRefreshRequestPostings() {},
      pendingRequestCompassTargets() { return []; },
    },
    BountyBoard: {
      RANK_LABELS: ['Petty', 'Notorious', 'Ruthless', 'Infamous'],
      async maybeRefreshPosting() { throw new Error('forced bounty refresh failure'); },
      getCurrentPostings() { return []; },
    },
    BanubuQuestline: {
      menuStatus() { return { active: true, ready: true, objective: 'Cook a qualifying Three-Fish Pie.' }; },
    },
  },
});

vm.runInContext(source, context, { filename: 'tasks-panel.js' });
context.window.TasksPanel.init({
  ITEM_DEFS: { needlegrain: { label: 'Needlegrain' } },
  esc: value => String(value ?? ''),
  WMAP_ZONE_LABELS: { map_w_test: 'Test Wilds' },
  getQuestProgress: () => questProgress,
  inventory: { needlegrain: 1 },
  calendar: { day: 5 },
  debugLog(message, level) { debugMessages.push({ message, level }); },
});

(async () => {
  await context.window.TasksPanel.render();

  assert(
    tasksList.children.some(row => /Hreesh's request/.test(row.innerHTML)),
    'an accepted NPC request must still render when bounty-offer refresh rejects',
  );
  const firstDebug = context.window.TasksPanel.getDebug(); // Used to verify the failure is exposed through the in-game debug snapshot.
  assert.strictEqual(firstDebug.activeCount, 1, 'debug state must count the accepted request');
  assert(firstDebug.errors.some(error => error.scope === 'bounty-refresh'), 'bounty refresh failure must be recorded');
  assert(debugMessages.some(entry => /bounty-refresh/.test(entry.message)), 'refresh failure must reach the existing debug logger when available');

  delete questProgress.request_test;
  questProgress.bounty_test = {
    status: 'available',
    progress: {
      kind: 'bounty',
      captainName: 'Test Captain',
      captainGender: 'neutral',
      zoneId: 'map_w_test',
      tier: 1,
      rewardGold: 160,
    },
  };
  context.window.BountyBoard.maybeRefreshPosting = async () => {};
  delete context.window.BountyBoard.markers;

  await context.window.TasksPanel.render();

  assert(
    tasksList.children.some(row => /Bounty: Test Captain/.test(row.innerHTML)),
    'an accepted bounty must render even when the optional marker cache is unavailable',
  );
  const secondDebug = context.window.TasksPanel.getDebug(); // Used to verify the healthy bounty pass does not inherit prior render errors.
  assert.strictEqual(secondDebug.activeCount, 1, 'debug state must count the accepted bounty');
  assert.strictEqual(secondDebug.errors.length, 0, 'render diagnostics must reset between Tasks panel renders');

  delete questProgress.bounty_test;
  questProgress.banubu_fish_pies = {
    status: 'active',
    progress: {
      kind: 'story',
      provider: 'banubu',
      npcId: 'banubu',
      npcName: 'Banubu',
      title: 'Banubu — Three-Fish Pie',
      icon: '🥧',
      objective: 'Cook a Three-Fish Pie with three requested buffs.',
      detail: 'Use exactly three fish.',
      stage: 1,
    },
  };

  await context.window.TasksPanel.render();
  assert(tasksList.children.some(row => /Banubu — Three-Fish Pie/.test(row.innerHTML)), 'accepted Banubu story quest must appear in the shared Tasks log');
  assert(tasksList.children.some(row => /Cook a qualifying Three-Fish Pie/.test(row.innerHTML)), 'story quest row must use the live Banubu readiness/objective provider');
  assert(tasksList.children.some(row => /Ready — return to Banubu/.test(row.innerHTML)), 'story quest row must expose ready-to-turn-in state');
  const thirdDebug = context.window.TasksPanel.getDebug();
  assert.strictEqual(thirdDebug.activeCount, 1, 'debug state must count the active story quest');
  assert.strictEqual(thirdDebug.kindCounts.story, 1, 'debug state must classify authored story quests');

  console.log('Tasks panel quest-log resilience test passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
