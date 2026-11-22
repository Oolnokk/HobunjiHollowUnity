#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function main() {
  const original = fs.readFileSync('docs/js/ambient-dialogue.js', 'utf8'); // Test the shipped bubble and proximity code, not a parallel reimplementation.
  const renderAnchor = '    const textPart = textPlane(message);';
  assert.ok(original.includes(renderAnchor), 'Only the canvas renderer is replaceable in the unit test');
  // The renderer needs browser canvas and WebGL; replacing those two draw sites retains the real greeting, age, and carry logic.
  const source = original.replace(renderAnchor,
    '    const textPart = { geometry: { parameters: { width: 1, height: 0.5 } }, plane: { scale: { setScalar() {} }, position: { x: 0 }, material: {} } };')
    .replace("    drawText(event, '');", '    /* canvas paint omitted in unit test */')
    .replace('      drawText(event, message);', '      /* canvas paint omitted in unit test */');

  let infant = true; // Emulates the authoritative saved family stage while verifying production age dispatch.
  let noisesAvailable = true; // Simulates optional missing/empty infant word configuration.
  let proxyActive = false; // Distinguishes a baby in its cup, held by a parent, or thrown.
  let carryAnchor = null; // The visible burden returned by the existing family baby burden owner.
  let day = 10; // Test-day used for the ordinary daily greeting ledger.
  let sceneAvailable = true; // Simulates a loading/unavailable world scene before the next greeting attempt.
  let completeConfigLoad; // Controls the asynchronous authored config load to expose registration races.
  const pendingConfig = new Promise(resolve => { completeConfigLoad = resolve; });
  const events = []; // Captures real DOM event payloads emitted by successfully rendered ambient bubbles.
  const window = {
    addEventListener() {},
    dispatchEvent(event) { events.push(event.detail); },
    RomanceFamily: {
      isBasketBaby: id => id === 'child_babble_test' && infant,
      babyAmbientSound: id => id === 'child_babble_test' && infant && noisesAvailable ? 'Agoo!' : null,
    },
    FamilyBabyBurdens: {
      isProxyActive: id => id === 'child_babble_test' && proxyActive,
      ambientAnchorFor: id => id === 'child_babble_test' ? carryAnchor : null,
    },
  };
  class Group {
    constructor() { this.name = ''; this.children = []; this.position = { x: 0, y: 0, z: 0 }; }
    add(child) { this.children.push(child); }
  }
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  }
  class FakeEvent { constructor(type, payload) { this.type = type; this.detail = payload.detail; } }
  const context = {
    window, CustomEvent: FakeEvent, performance: { now: () => 10000 },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout() { return 1; }, clearTimeout() {},
    fetch: async () => ({ ok: true, json: () => pendingConfig }),
  };
  vm.runInNewContext(source, context);
  const ambient = window.AmbientDialogue;
  const babyRoot = { name: 'hidden basket walker', position: { x: 100, y: 0, z: 100 } };
  const carriedGroup = { name: 'visible parent-carried baby', getWorldPosition(v) { v.x = 0; v.y = 0; v.z = 0; return v; } };
  const walker = { rec: { id: 'child_babble_test', name: 'Pip', isChild: true, ambientGreetings: true }, root: babyRoot, area: 'interior', profile: null };
  ambient.init({
    THREE: { Group, Vector3 },
    getActiveScene: () => sceneAvailable ? ({ add() {} }) : null,
    getCurrentArea: () => 'interior',
    getNpcWalkers: () => [walker],
    getPlayerPosition: () => ({ x: 0, z: 0 }),
    getDay: () => day,
    getPlayerName: () => 'Player',
    isDialogueOpen: () => false,
    isPaused: () => false,
  });

  const pool = { player: ['Agoo!', 'Guh-buh!'] };
  assert.equal(ambient.setNpcGreetings(walker.rec.id, pool), true, 'Registration works while authored settings are still loading');
  completeConfigLoad({ npcGreetings: { leaf: { player: ['Hello.'] } } });
  await Promise.resolve();
  await Promise.resolve();
  const loaded = await ambient.loadSettings();
  assert.deepEqual(Array.from(loaded.npcGreetings[walker.rec.id].player), pool.player, 'Async JSON load cannot discard baby-specific greetings');

  const basket = ambient.show(babyRoot, 'I want some tea.', { speakerId: walker.rec.id, vocabulary: false });
  assert.equal(basket.textPart.text, 'Agoo!', 'Even bypassed synonym text cannot make an infant say adult words');
  assert.equal(basket.root, babyRoot, 'A newborn resting in its basket uses the real visible NPC');

  noisesAvailable = false;
  assert.equal(ambient.show(babyRoot, 'I want some tea.', { speakerId: walker.rec.id }), null,
    'If baby syllables cannot be loaded, newborns must stay silent rather than falling back to adult wording');
  noisesAvailable = true;

  proxyActive = true;
  carryAnchor = { mapId: 'interior', group: carriedGroup };
  const carried = ambient.show(babyRoot, 'Yes, certainly.', { speakerId: walker.rec.id, babyAmbient: false });
  assert.equal(carried.root, carriedGroup, 'Held/spouse-stowed babble follows the visible burden');
  assert.equal(carried.textPart.text, 'Agoo!');
  assert.deepEqual(
    { text: ambient.getDebug().lastBabySpeech.text, carried: ambient.getDebug().lastBabySpeech.carried },
    { text: 'Agoo!', carried: true }, 'Mobile diagnostics report the true baby line and carry anchor');

  carryAnchor = null;
  const prior = events.length;
  assert.equal(ambient.show(babyRoot, 'Hello, friend.', { speakerId: walker.rec.id }), null,
    'Airborne/invisible infant proxies must not create ghost bubbles in the old basket');
  assert.equal(events.length, prior, 'Suppressed ghost speech must emit no dialogue event');

  // With the real walker far away, only the carried proxy can be close enough to trigger the player greeting.
  carryAnchor = { mapId: 'interior', group: carriedGroup };
  sceneAvailable = false;
  ambient.update(10000); // First normal 5 Hz scan starts the existing 300 ms dwell timer.
  ambient.update(10400); // Scene is unavailable; the baby's one daily greeting must not be spent.
  assert.ok(!ambient.getDebug().active.some(item => item.speakerId === walker.rec.id && item.greeting),
    'A missing scene should never count as a completed newborn greeting');
  sceneAvailable = true;
  ambient.update(10800); // Same calendar day: greeting retries successfully once rendering is possible.
  const greeting = ambient.getDebug().active.find(item => item.speakerId === walker.rec.id && item.greeting);
  assert.ok(greeting?.directedAtPlayer, 'The real proximity scheduler permits held babies to babble toward the player');
  assert.equal(ambient.getDebug().lastBabySpeech.root, carriedGroup.name);

  infant = false;
  proxyActive = false;
  carryAnchor = null;
  const toddler = ambient.show(babyRoot, 'Up! Up!', { speakerId: walker.rec.id });
  assert.equal(toddler.textPart.text, 'Up! Up!', 'At toddlerhood the normal speech system is restored');
  assert.equal(ambient.show(babyRoot, 'Hello, friend.', { speakerId: 'neighbor' }).textPart.text,
    'Hello, friend.', 'Unrelated adult NPCs never inherit babble');

  console.log('Infant ambient integration passed: source renderer, carry origin, ghost suppression, real proximity, scene-retry, toddler transition and JSON load.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
