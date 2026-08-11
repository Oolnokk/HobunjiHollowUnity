#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const hub = read('docs/tools/index.html');
const editor = read('docs/tools/ambient-dialogue-editor/index.html');
const runtime = read('docs/js/ambient-dialogue.js');
const config = JSON.parse(read('docs/config/dialogue/ambient-dialogue.json'));

assert(hub.includes('ambient-dialogue-editor/index.html'), 'tool hub links the Ambient Dialogue editor');
assert(editor.includes('Greeting pool'), 'editor exposes NPC greeting settings');
assert(editor.includes('Treasure announcements'), 'editor exposes animal treasure announcements');
assert(editor.includes('Audience reactions'), 'editor exposes cheers and jeers');
assert(editor.includes('ambient-dialogue.json'), 'editor imports and exports the runtime config');
assert(runtime.includes('npcGreetings'), 'runtime consumes per-NPC greeting pools');
assert(runtime.includes('companionTreasureLines'), 'runtime consumes per-species treasure pools');
assert(runtime.includes('targetName:'), 'runtime drops the intended target name into greetings');
assert(runtime.includes('getWeekDay'), 'runtime resolves {weekDay} through the game calendar');
assert(runtime.includes('getDayPart'), 'runtime resolves {dayPart} through the game clock');
assert(runtime.includes('SCRATCHBONES_CONFIG?.game?.npcDialogue?.text?.typewriter'), 'ambient text uses the ordinary NPC typewriter rules');
assert(runtime.includes("event.textPart.text.slice(0, visibleChars)"), 'revealed letters accumulate instead of replacing one another');
assert(runtime.includes('hasActiveGreetingFor(speakerId)'), 'an NPC cannot start another greeting until its active greeting has fully faded');
assert(runtime.includes('greeting: true'), 'proximity greetings are marked separately from companion and crowd speech');
assert(Object.keys(config.npcGreetings || {}).length, 'sample per-NPC greeting data is present');
assert(Object.keys(config.companionTreasureLines || {}).length, 'sample per-species treasure data is present');

console.log('Ambient Dialogue editor and runtime config checks passed.');
