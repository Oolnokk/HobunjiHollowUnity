'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm'); // Executes the shipped save handler, including unavailable download/clipboard APIs.
const source = fs.readFileSync('docs/tools/cutscene-director/index.html', 'utf8'); // The actual Director export owner, without starting its renderer.
const start = source.indexOf('  function exportProject()'), end = source.indexOf('  async function importProject(file)', start); // Isolates the real handler for deterministic browser-capability tests.
const handler = source.slice(start, end) + '\nexportProject();'; // Same synchronous click handler used by Save JSON.
const project = {title:'Hunundi room',cinematicCameras:[{id:'hunundi_office_wall',position:{x:8.5,y:1.4,z:6.6}}],stages:[{id:'hello',text:'Hello'}]}; // Includes authored camera edits that must survive every export route.
function setup({noDownload=false, noClipboard=false, canShare=true, shareError=null}={}) {
  const elements = new Map(), timers = [], events = []; // Connected DOM elements and delayed URL cleanup are inspected without browser-specific timing.
  let clipboardText, sharedFile; // Capture the exact exported bytes from both phone fallbacks.
  for (const id of ['sceneExportDialog','sceneExportText','sceneExportStatus','sceneExportDownload','sceneExportCopy','sceneExportShare','sceneExportClose']) elements.set(id,{isConnected:true,hidden:false,value:'',textContent:'',showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},focus(){this.focused=true;},select(){this.selected=true;},setSelectionRange(a,b){this.range=[a,b];},click(){assert(this.isConnected);assert(elements.get('sceneExportDialog').open,'download link must be visible in a connected save panel');events.push('download');}});
  const context = {state:{project},$:id=>elements.get(id),Blob,File,URL:{createObjectURL(){if(noDownload)throw Error('Downloads blocked');return 'blob:scene';},revokeObjectURL(url){events.push(url);}},navigator:{clipboard:{async writeText(text){if(noClipboard)throw Error('Clipboard blocked');clipboardText=text;}},canShare:()=>canShare,async share({files}){if(shareError)throw shareError;sharedFile=files[0];}},setTimeout(fn,ms){timers.push({fn,ms});},log(){}}; // Browser capabilities can fail independently without losing the JSON snapshot.
  vm.runInNewContext(handler,context);
  return {elements,timers,events,clipboard:()=>clipboardText,shared:()=>sharedFile};
}
(async()=>{
  const normal=setup(), get=id=>normal.elements.get('sceneExport'+id); // Normal download must be retryable throughout the panel lifetime.
  assert.deepStrictEqual(JSON.parse(get('Text').value),project);assert.equal(get('Download').download,'Hunundi_room.json');assert.deepStrictEqual(normal.events,['download']);assert.equal(normal.timers.length,0);
  await get('Copy').onclick();assert.deepStrictEqual(JSON.parse(normal.clipboard()),project);
  await get('Share').onclick();assert.equal(normal.shared().name,'Hunundi_room.json');assert.deepStrictEqual(JSON.parse(await normal.shared().text()),project);
  get('Download').click();get('Close').onclick();assert.equal(normal.timers[0].ms,60000);normal.timers[0].fn();assert(normal.events.includes('blob:scene'));
  const blocked=setup({noDownload:true,noClipboard:true,canShare:false}); // Sandboxed downloads and clipboard denial still leave complete selectable text.
  assert(blocked.elements.get('sceneExportDialog').open);assert(blocked.elements.get('sceneExportDownload').hidden);assert(blocked.elements.get('sceneExportShare').hidden);assert.deepStrictEqual(JSON.parse(blocked.elements.get('sceneExportText').value),project);
  await blocked.elements.get('sceneExportCopy').onclick();assert.deepStrictEqual(blocked.elements.get('sceneExportText').range,[0,blocked.elements.get('sceneExportText').value.length]);assert.match(blocked.elements.get('sceneExportStatus').textContent,/complete JSON is selected/);
  const cancelled=setup({shareError:Object.assign(Error('Cancel'),{name:'AbortError'})});await cancelled.elements.get('sceneExportShare').onclick();assert.match(cancelled.elements.get('sceneExportStatus').textContent,/cancelled/);assert.deepStrictEqual(JSON.parse(cancelled.elements.get('sceneExportText').value),project);
  console.log('Director downloads, clipboard/share fallbacks, cancelled sharing and retained JSON passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
