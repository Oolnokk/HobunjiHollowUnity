'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'farm-animals.js'), 'utf8');

assert.match(source, /function\s+makePuktukAnimal\s*\([^)]*\)\s*\{[\s\S]*?makePatternLivestockAnimal\('puktuk'/, 'Puktuk farm runtime uses the generic pattern-livestock factory');
assert.match(source, /function\s+makeVoorgAssAnimal\s*\([^)]*\)\s*\{[\s\S]*?makePatternLivestockAnimal\('voorg-ass'/, 'Voorg-Ass farm runtime uses the generic pattern-livestock factory');
assert.match(source, /\bpuktuk:\s*makePuktukAnimal\b/, 'Puktuk is registered in LIVESTOCK_FACTORIES');
assert.match(source, /'voorg-ass':\s*makeVoorgAssAnimal\b/, 'Voorg-Ass is registered in LIVESTOCK_FACTORIES');

console.log('Puktuk/Voorg-Ass farm runtime registration checks passed.');
