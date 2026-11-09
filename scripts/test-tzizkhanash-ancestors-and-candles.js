#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=path=>fs.readFileSync(path,'utf8'); // Production files are used directly by these regression assertions.
const map=JSON.parse(read('docs/config/maps/hobunji_hollow_town.map.json'));
const layout=map.layouts.find(value=>value.id==='festival_tzizkhanash');
assert(layout,'Tzizkhanash alternate layout exists');
assert(!layout.decor.some(value=>value.activity?.type==='welcome'),'retired event guide board must be absent');
const candles=layout.decor.filter(value=>value.key==='candleCluster');
const campfires=layout.decor.filter(value=>value.key==='campfire');
assert(candles.length>=20,'town has numerous 1x1 candle clusters');
assert(campfires.length>=10,'town has numerous outdoor campfires');
assert([...candles,...campfires].every(value=>value.festivalWeatherFire===true),'all festival flames carry a weather marker');
const ids=new Set(); // Reused below to ensure every new placement survives the editor's id-based persistence.
for(const piece of layout.decor){
  assert(piece.col>=0&&piece.col<map.cols&&piece.row>=0&&piece.row<map.rows,'every festival prop is in bounds');
  assert(piece.id&&!ids.has(piece.id),'festival prop ids are stable and unique');
  ids.add(piece.id);
}
const cluster=JSON.parse(read('docs/config/furniture-authored/candleCluster.json'));
const candleBodies=cluster.parts.filter(part=>part.id?.startsWith('cluster_wax_'));
const sockets=cluster.parts.filter(part=>part.id?.startsWith('cluster_socket_'));
assert.equal(cluster.footprint.w,1);
assert.equal(cluster.footprint.d,1);
assert.equal(candleBodies.length,16,'sixteen reused candle-table wax bodies in one cluster');
assert.equal(sockets.length,16,'each candle has its own candle-table socket');
assert.equal(cluster.particleEmitters.length,16,'individual authored wick flame anchors remain editable');
assert(candleBodies[0].transform.sy>Math.max(...candleBodies.slice(1).map(part=>part.transform.sy)),'highest candle is central');
const outer=candleBodies.slice(7);
assert(outer.every(part=>part.transform.sy<candleBodies[0].transform.sy*.65),'outer ring candles are shorter');
assert(new Set(candleBodies.map(part=>part.transform.sx)).size>3,'several authentic candle thicknesses');
assert(cluster.particleEmitters.every(emitter=>candleBodies.some(body=>body.id===emitter.attachedPartId)),'each flame follows a real candle body');
const index=JSON.parse(read('docs/config/furniture-authored/index.json'));
assert(index.furniture.some(record=>record.key==='candleCluster'),'cluster is available to the authored furniture runtime');
const mapEditor=read('docs/tools/map-editor/index.html');
assert(mapEditor.includes('candleCluster:{icon:'),'map editor can select and preview the cluster');
const fire=read('docs/js/interior-fire-floor-runtime.js');
assert(fire.includes('makeCandleClusterFlames(group, emitters, data.parts)'),'cluster uses one batched draw rather than sixteen');
assert(fire.includes('suppressedFestivalFlames'),'mobile fire diagnostics report rain suppression');
const festivals=read('docs/js/festival-system.js');
assert(festivals.includes("!claimed('remembrance') && festival()?.id === 'tzizkhanash'"),'once-per-year auto remembrance cannot restart and spam notifications');
assert(festivals.includes("activity.type !== 'remembrance' && atProp(p)"),'offering interaction still works next to mourners');
const host={window:{}};vm.runInNewContext(read('docs/js/festival-calendar.js'),host);
assert(!host.window.FestivalCalendar.get('tzizkhanash').activities.includes('welcome'),'guide is retired in rules as well as the map');

// Canvas stub tests the real browser-neutral texture painting algorithm without a GPU.
const originalPixels=new Uint8ClampedArray([
  255,0,0,255, // Visible red body -> stone
  0,0,0,255,   // Black outline -> black
  80,60,40,128,// Partially transparent visible pixel -> stone with original alpha
  0,0,0,0,     // Empty sprite area -> transparent
]);
const sourceCanvas={width:2,height:2,getContext(){return {getImageData(){return {data:originalPixels}}};}};
let draws=0;
const document={createElement(){
  const output={width:0,height:0,dataset:{},pixels:null};
  output.getContext=()=>({
    drawImage(_stone,x,y,w,h){
      draws++;
      if(!output.pixels)output.pixels=new Uint8ClampedArray(output.width*output.height*4);
      for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++){
        const at=(row*output.width+col)*4;
        output.pixels.set([185,155,125,255],at);
      }
    },
    getImageData(){return {data:output.pixels.slice()};},
    putImageData(image){output.pixels=image.data.slice();}
  });
  return output;
}};
const testWindow={};vm.runInNewContext(read('docs/js/festival-ancestor-figures.js'),{window:testWindow,document,Image:function(){}});
const stone=testWindow.FestivalAncestorFigures.carvedCanvas(sourceCanvas,{}).pixels;
assert.equal(draws,4,'stone PNG is stretched independently into each calculated source cell');
assert.deepEqual([...stone.slice(0,4)],[185,155,125,255],'visible color is replaced with stone texture');
assert.deepEqual([...stone.slice(4,8)],[0,0,0,255],'black outline is preserved');
assert.deepEqual([...stone.slice(8,12)],[185,155,125,128],'antialiased body pixels retain alpha');
assert.equal(stone[15],0,'transparent sprite background stays transparent');
console.log('Tzizkhanash autonomous layout, sixteen-candle clustering, weather wiring and ancestor statue stone mask passed.');
