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
  banditCamps.includes('&& actionHeldDown'),
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
assert(
  banditCamps.includes("_tentActionHudEl ||= document.getElementById('tentActionHud')"),
  'tent HUD nodes are resolved lazily after body markup exists',
);
assert(
  banditCamps.includes('&& !_banditTentHoldInterrupted'),
  'a damaging hit latches the hold off until release',
);
assert(
  banditCamps.includes('if (!actionHeldDown) _banditTentHoldInterrupted = false;'),
  'releasing the input rearms tent interaction after an interruption',
);
assert(
  game.includes('window.BanditCamps?.interruptTentHold();'),
  'player damage interrupts a tent hold',
);

console.log('bandit tent hold interaction contracts: 9 checks passed');
