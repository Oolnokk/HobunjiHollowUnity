#!/usr/bin/env node
'use strict';

// Companion AI (game.js updateCompanions) only chases and attacks when
// def.attackRangePx is a finite number. Voorg-Ass borrows its def from the
// Uumkao'ii-wild prey baseline, which has no attack reach, so the companion
// never closed in or used Rear Kick until the registration set one.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.HOBUNJI_TEST_ROOT || process.cwd();
const sandbox = vm.createContext({ window: {}, console });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/voorg-ass-registration.js'), 'utf8'), sandbox, { filename: 'voorg-ass-registration.js' });
const registration = sandbox.window.VoorgAssRegistration;

const TILE = 55;
const db = { 'uumkaoii-wild': { label: "Wild Uumkao'ii", hostile: false, moveSpeed: 110, chaseSpeed: 110, maxHealth: 30, maxStamina: 20 } }; // No attackRangePx, as in game.js.
registration.ensureCreatureDefs(db, TILE);
registration.ensureCreatureDefs(db, TILE); // Registration runs from several boot paths; it must stay idempotent.

for (const kind of [registration.KIND, registration.HERD_MOTHER_KIND]) {
  const def = db[kind];
  assert.ok(Number.isFinite(def.attackRangePx) && def.attackRangePx > 0, kind + ' has a finite attack reach for companion chase/attack gating');
  assert.ok(def.attackRangePx >= TILE, kind + ' reach is at least one tile');
  assert.ok(def.attackHalfConeRad > 0, kind + ' has an attack cone');
  assert.deepEqual([...def.attacks], ['rearKick']);
}

db[registration.KIND].attackRangePx = 99; // An authored/configured value (attack-values.json) must survive re-registration.
registration.ensureCreatureDefs(db, TILE);
assert.equal(db[registration.KIND].attackRangePx, 99);

console.log('voorg-ass companion attack range ok');
