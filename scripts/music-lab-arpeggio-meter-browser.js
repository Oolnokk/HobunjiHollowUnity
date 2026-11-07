'use strict';
// Mobile Chromium smoke: the Music Lab's actual user controls must operate the shared audio engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const docsRoot = path.resolve(__dirname, '../docs'); // Restricts the local test server to exactly the shipped game and Lab assets.
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.m4a':'audio/mp4','.mp3':'audio/mpeg','.png':'image/png','.svg':'image/svg+xml'}; // MIME mapping used by Chromium for imported sample and script loading.
const server = http.createServer((request,response) => {
  let requestPath;
  try { requestPath = decodeURIComponent((request.url || '/').split('?')[0]); }
  catch {response.writeHead(400).end();return;}
  const file = path.resolve(docsRoot,'.' + requestPath); // Resolves the URL against the same docs/ root that GitHub Pages serves.
  if (file !== docsRoot && !file.startsWith(docsRoot + path.sep)) {response.writeHead(403).end();return;}
  fs.readFile(file,(error,data) => {
    if (error) {response.writeHead(404).end();return;}
    response.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
    response.end(data);
  });
});
async function run() {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const errors = []; // Surfaced in CI output so debugging the instrument does not require desktop DevTools.
    page.on('pageerror',error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/tools/kurraya-music-lab/index.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => {
      const pattern = document.getElementById('auditionPatternSelect');
      const meter = document.getElementById('auditionMeterSelect');
      return pattern && meter && !pattern.disabled && !meter.disabled;
    },null,{timeout:30000});
    assert.equal(await page.locator('#auditionPatternSelect option').count(),20,
      'the picker must contain Single Note and all nineteen real rolls, tremolos and strums');
    assert.equal(await page.locator('#auditionMeterSelect option').count(),9,
      'the Lab must offer the original meter and eight alternatives');
    await page.locator('#auditionPatternSelect').selectOption('arp-forward-reverse-16');
    await page.locator('#auditionMeterSelect').selectOption('7/8');
    const selected = await page.evaluate(() => {
      const bridge = document.querySelector('#engine').contentWindow.HobunjiMusicControlBridge;
      const audition = bridge.autoPickAuditionState();
      const arrangement = bridge.scaleAuditionState().arrangement;
      const labels = [...document.querySelectorAll('.arrangement-bar-label')].map(node => node.textContent.trim());
      return {audition,arrangement,labels,description:document.querySelector('#auditionMeterDescription').textContent};
    });
    assert.equal(selected.audition.selectedMode,'arp-forward-reverse-16','pattern selector must update the real engine');
    assert.equal(selected.audition.selectedMeter,'7/8','meter selector must update the real engine');
    assert.equal(selected.arrangement.quarterBeatsPerBar,3.5,'7/8 must use three-and-a-half quarters per bar');
    assert.equal(selected.arrangement.melodyStartQuarterBeat,14,'the melody must begin after four real 7/8 bars');
    assert.equal(selected.arrangement.totalQuarterBeats,70,'the twenty-bar phrase must span seventy quarters');
    assert.match(selected.labels[0],/7\/8/,'intro timeline must show the selected meter');
    assert.match(selected.labels[4],/7\/8/,'melody timeline must show the selected meter');
    assert.match(selected.description,/accents 2\+2\+3/,'mobile explanation must expose the seven-eight accent grouping');
    await page.locator('#playBtn').click();
    await page.waitForFunction(() => {
      const bridge = document.querySelector('#engine').contentWindow.HobunjiMusicControlBridge;
      return bridge.getState().gameDemoActive;
    },null,{timeout:30000});
    const playing = await page.evaluate(() => {
      const bridge = document.querySelector('#engine').contentWindow.HobunjiMusicControlBridge;
      return {meter:bridge.scaleAuditionState().currentTimeSignature,pattern:bridge.ambientPerformanceState().pattern,status:document.querySelector('#status').textContent};
    });
    assert.equal(playing.meter,'7/8','real audition transport must run the selected meter');
    assert.equal(playing.pattern,'arp-forward-reverse-16','real audition must use selected continuous roll instead of direct notes');
    assert.match(playing.status,/7\/8/,'mobile playback status must report the meter');
    await page.locator('#stopBtn').click();
    await page.locator('#auditionMeterSelect').selectOption('original');
    const reset = await page.evaluate(() => ({
      meter:document.querySelector('#engine').contentWindow.HobunjiMusicControlBridge.autoPickAuditionState().selectedMeter,
      first:document.querySelectorAll('.arrangement-bar-label')[0].textContent,
      fifth:document.querySelectorAll('.arrangement-bar-label')[4].textContent
    }));
    assert.equal(reset.meter,'original','original time signature must remain selectable');
    assert.match(reset.first,/6\/8/,'original intro is still in six-eight');
    assert.match(reset.fifth,/3\/4/,'original melody is still in three-four');
    assert.equal(errors.length,0,'Music Lab should not emit unhandled JS errors: ' + errors.join('; '));
    console.log('Kurraya Music Lab mobile browser: arpeggio picker, 7/8 playback, timeline and original-meter reset passed.');
  } finally {
    await browser.close();
  }
}
run().catch(error => {console.error(error);process.exitCode=1;}).finally(() => server.close());
