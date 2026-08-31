#!/usr/bin/env node
'use strict';

const fs = require('fs');
const assert = require('assert');

const read = path => fs.readFileSync(path, 'utf8'); // Used to inspect the shipped source without needing a browser runtime.
const game = read('docs/game.js'); // Used to verify semantic input selection and structured prompt wiring.
const popup = read('docs/js/world-popup-text.js'); // Used to verify the segmented world-space row renderer.
const slotColors = read('docs/js/action-arch-slot-colors.js'); // Used to verify the shared action/dodge palette.
const style = read('docs/style.css'); // Used to verify the touch dodge button shares its prompt color.

assert(slotColors.includes("dodge: '#A78BFA'"), 'dodge has a distinct electric-violet input color');
assert(slotColors.includes('inputColors: INPUT_COLORS'), 'semantic prompt colors are exposed by the action arch');
assert(style.includes('var(--dodge-input-color, #A78BFA)'), 'the touch dodge arch uses the shared dodge color');
assert(game.includes("button.action === 'climb_branch' ? 'dodge'"), 'climb prompts identify the actual dodge input');
assert(game.includes('promptInputs,'), 'world prompt synchronization receives structured input hints');
assert(popup.includes('makeInteractionPlane'), 'interaction rows use segmented canvas rendering');
assert(popup.includes('INTERACTION_VERB_COLOR'), 'interaction verbs have a dedicated uncoded emphasis color');
assert(popup.includes('const mainFontPx = 98'), 'interaction inputs, verbs, and object words share the larger font');
assert(popup.includes('const connectorFontPx = 78'), 'connector words retain the former prompt size');
assert(popup.includes('const gapPx = 34'), 'interaction inputs have an extra separating space');
assert(popup.includes('const wordGapPx = 22'), 'zone entrance words have a visible separating space');
assert(!popup.includes('detailFontPx') && !popup.includes('verbFontPx') && !popup.includes('inputFontPx'), 'interaction rows use exactly two font sizes');
assert(popup.includes('INTERACTION_LIST_SCALE = 0.25'), 'interaction rows preserve the former physical baseline');
assert(popup.includes('INTERACTION_OBJECT_COLOR'), 'interaction object words use a separate color');
assert(popup.includes('verbAfterToIndex'), 'labels such as Hold to Take Egg emphasize the actual action verb');
assert(popup.includes('inputActionId: promptInput?.actionId'), 'interaction debug data preserves the semantic input ID');

console.log('interaction prompt color contracts: 9 checks passed');
