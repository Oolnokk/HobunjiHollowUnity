#!/usr/bin/env node
'use strict';
// Temporary review-only probe: inspect exact production roots and frame order.
const fs=require('node:fs'),source=fs.readFileSync('docs/game.js','utf8'),lines=source.split('\n');
const out=[];
function add(tag,start,end){out.push('=='+tag+'==\\n'+lines.slice(start-1,end).map((v,i)=>(start+i)+': '+v.slice(0,390)).join('\\n'));}
const terms=['window.FestivalSystem?.init','window.FestivalSystem.init','FestivalSystem.init({','playerAvatarGroup =','playerAvatarGroup;','playerAvatarGroup.position','function updatePlayerMesh','window.FestivalWheelDanceRuntime?.update?.','window.FestivalWheelDanceRuntime?.init'];
for(const term of terms) {
  const hits=[];for(let i=0;i<lines.length;i++) if(lines[i].includes(term))hits.push(i+1);
  out.push(term+': '+JSON.stringify(hits.slice(0,15)));
  for(const n of hits.slice(0,3))add(term,n-12,n+32);
}
add('update-player-mesh',25816,25960);
add('paired-frame-render',27155,27228);
throw new Error('REVIEW GAME WIRING '+out.join('\\n').slice(0,52000));
