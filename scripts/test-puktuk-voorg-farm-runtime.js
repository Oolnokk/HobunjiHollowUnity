'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const farmSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'farm-animals.js'), 'utf8');
const geneticsSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'creature-genetics.js'), 'utf8');

assert.match(farmSource, /function\s+makePuktukAnimal\s*\([^)]*\)\s*\{[\s\S]*?makePatternLivestockAnimal\('puktuk'/, 'Puktuk farm runtime uses the generic pattern-livestock factory');
assert.match(farmSource, /function\s+makeVoorgAssAnimal\s*\([^)]*\)\s*\{[\s\S]*?makePatternLivestockAnimal\('voorg-ass'/, 'Voorg-Ass farm runtime uses the generic pattern-livestock factory');
assert.match(farmSource, /\bpuktuk:\s*makePuktukAnimal\b/, 'Puktuk is registered in LIVESTOCK_FACTORIES');
assert.match(farmSource, /'voorg-ass':\s*makeVoorgAssAnimal\b/, 'Voorg-Ass is registered in LIVESTOCK_FACTORIES');

assert.match(geneticsSource, /resources\[PUKTUK_KIND\]\s*=\s*\{\s*itemKey:\s*'puktukWool',\s*cooldownDays:\s*1,\s*verb:\s*'Shear'\s*\}/, 'Puktuk shearing produces the save-compatible Heavy Wool key');
assert.match(geneticsSource, /const\s+LIGHT_WOOL_ITEM_KEY\s*=\s*'lightWool'/, 'Voorg-Ass Light Wool uses the canonical lightWool key');
assert.match(geneticsSource, /resources\[VOORG_ASS_KIND\]\s*=\s*\{\s*itemKey:\s*LIGHT_WOOL_ITEM_KEY,\s*cooldownDays:\s*1,\s*verb:\s*'Shear'\s*\}/, 'Voorg-Ass shearing produces Light Wool');
assert.match(geneticsSource, /if\s*\(puktukWool\)\s*puktukWool\.name\s*=\s*'Heavy Wool'/, 'Puktuk wool is presented to the player as Heavy Wool');
assert.match(geneticsSource, /name:\s*'Light Wool'/, 'Voorg-Ass wool is presented to the player as Light Wool');

assert.match(farmSource, /deps\.inventory\[resDef\.itemKey\]\s*=\s*Math\.min\(99,[\s\S]*?rec\.resourceReady\s*=\s*false;[\s\S]*?rec\.daysUntilResource\s*=\s*Math\.max\(1,\s*Math\.round\(resDef\.cooldownDays/, 'Generic harvest adds the configured wool item, clears readiness, and restarts its cooldown');
assert.match(farmSource, /const\s+offset\s*=\s*HARVEST_HANDLER_OFFSET\[animal\.animalKey\];[\s\S]*?if\s*\(!offset\)\s*\{\s*collectResource\(animal\.livestockId\);\s*return;\s*\}/, 'Species without an authored handler animation still harvest through the generic instant-collection fallback');

console.log('Puktuk/Voorg-Ass farm runtime and shearing registration checks passed.');