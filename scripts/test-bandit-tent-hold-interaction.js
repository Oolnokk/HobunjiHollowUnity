#!/usr/bin/env node
'use strict';

const fs = require('fs');
const assert = require('assert');

const banditCamps = fs.readFileSync('docs/js/bandit-camps.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');

assert(
  banditCamps.includes("deps.getActiveAction() === 'bandit_tent_interact'"),
  'tent holds require the selected tent interaction, like nest holds',
);
assert(
  banditCamps.includes('&& deps.getActionHeldDown()'),
  'tent holds require a continuously held input',
);
assert(
  game.includes("if (act === 'nest_take' || act === 'bandit_tent_interact') activeAction = act;"),
  'touch presses select nest and tent hold actions immediately',
);
assert(
  game.includes("activeAction = 'bandit_tent_interact';\n              actionHeldDown = true;\n              useActiveAction();"),
  'desktop tent interaction enters the same selected-action hold path',
);
assert(
  game.includes('getActiveAction: () => activeAction'),
  'BanditCamps receives the selected action dependency',
);

console.log('bandit tent hold interaction contracts: 5 checks passed');
