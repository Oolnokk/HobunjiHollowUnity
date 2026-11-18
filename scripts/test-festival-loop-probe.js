#!/usr/bin/env node
'use strict';
// Temporary review-only probe: print production game-loop ownership call sites in CI.
const fs=require('node:fs');
const lines=fs.readFileSync('docs/game.js','utf8').split('\n');
const probes=[];
const patterns=[
  /FestivalWheelDanceRuntime/,
  /FestivalSystem\\?\\.update|FestivalSystem\\.update/,
  /playerAvatarGroup\\.position|playerAvatarGroup\\.quaternion/,
  /playerLegs\\.update/,
  /function updateGameFrame/,
  /updatePlayerAvatar/,
  /CharacterActionLocks.*pose/,
];
for(let i=0;i<lines.length;i++) if(patterns.some(re=>re.test(lines[i]))) probes.push({line:i+1,text:lines.slice(Math.max(0,i-2),Math.min(lines.length,i+3)).map((v,j)=>`${Math.max(0,i-2)+j+1}: ${v.slice(0,350)}`).join(' | ')});
throw new Error('REVIEW-ONLY GAME LOOP CALL SITES '+JSON.stringify(probes).slice(0,27000));
