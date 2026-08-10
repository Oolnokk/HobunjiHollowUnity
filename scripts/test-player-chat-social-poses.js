#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const page = read('docs/index.html');
const game = read('docs/game.js');
const chat = read('docs/js/player-chat.js');
const poses = read('docs/js/player-social-poses.js');
const manifest = JSON.parse(read('docs/config/animations/player-social-poses.json'));

for (const script of ['js/player-social-poses.js', 'js/player-chat.js']) {
  assert(page.includes(script), `${script} is loaded by the game page`);
  assert(page.indexOf(script) < page.indexOf('<script src="game.js'), `${script} loads before game.js`);
}

assert(chat.includes("event.key === 'Enter'"), 'Enter opens/submits chat');
assert(chat.includes("{ capture: true }"), 'chat captures Enter before gameplay input');
assert(chat.includes("hobunji-player-chat-send"), 'plain chat exposes a future multiplayer event boundary');
assert(game.includes("mode: 'overhead'"), 'player chat is rendered above the local avatar');
assert(game.includes('window.PlayerChat?.isOpen'), 'movement pauses while chat is open');
assert(game.includes("stop('movement')"), 'manual movement clears a held pose');
assert(game.includes('player.angle = facingAngle'), 'held poses retain their facing and ignore rotation input');

for (const command of ['sit', 'lie', 'kneel']) {
  assert(poses.includes(`'${command}'`), `/${command} is a supported held pose`);
  const definition = manifest.poses[command];
  assert(definition, `${command} has a manifest entry`);
  const animation = JSON.parse(read(`docs/${definition.sourcePath}`));
  assert(Number.isInteger(animation.gridCols) && animation.gridCols >= 2, `${command} has a native grid width`);
  assert(Number.isInteger(animation.gridRows) && animation.gridRows >= 2, `${command} has a native grid height`);
  assert(Array.isArray(animation.poses) && animation.poses.length >= 2, `${command} has two editable neutral poses`);
  assert(animation.poses.every(pose => pose.points.length === animation.gridCols * animation.gridRows), `${command} points match its native grid`);
  const first = JSON.stringify(animation.poses[0].points);
  assert(animation.poses.every(pose => JSON.stringify(pose.points) === first), `${command} intentionally starts visually neutral`);
}

console.log('Player chat and editable social-pose checks passed.');
