'use strict';
// Browser regression: click/touch the ACTUAL editor canvas (not a stripped
// function mock) to author outside-floor exit tiles and preserve them in JSON.
const assert = require('node:assert/strict'); // Verifies live input -> serialization invariants.
const fs = require('node:fs'); // Serves checked-in editor assets without a deployed site.
const http = require('node:http'); // Creates a local test origin for relative scripts and JSON.
const path = require('node:path'); // Keeps the static test server inside the repo.
let chromium; // Chromium drives real pointer, touch, focus and DOM selection.
try { ({ chromium } = require('playwright')); }
catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip: playwright not installed (browser-only smoke test)');
  process.exit(0);
}
const root = path.resolve(__dirname, '..'); // Root directory used by editor asset URLs.
const contentTypes = { '.js':'text/javascript','.html':'text/html','.json':'application/json',
  '.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.glb':'model/gltf-binary','.css':'text/css' }; // MIME types for loaded preview resources.
const server = http.createServer((request,response)=>{
  const relative = decodeURIComponent((request.url || '/').split('?')[0]).replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  fs.readFile(file,(error,bytes)=>{
    if(error){response.writeHead(404);response.end('Missing '+relative);return;}
    response.setHeader('Content-Type',contentTypes[path.extname(file)] || 'application/octet-stream');
    response.end(bytes);
  });
});
const readExit = async page => page.evaluate(()=>{ // Reads the editor's actual exported JSON, not private state.
  const room=JSON.parse(document.getElementById('exportText').value);
  return { exits:room.exits, floor:room.floor, status:document.getElementById('exitPlacementHelp').textContent };
});
async function tapCell(page,col,row,touch=false) {
  const canvas=page.locator('#gridCanvas'); // Actual authoring canvas receiving pointer events.
  await canvas.scrollIntoViewIfNeeded();
  const rect=await canvas.boundingBox();
  assert(rect?.width>30 && rect?.height>30,'editor 2D floor plan must be visible');
  const grid=await page.evaluate(()=>({ cols:Number(document.getElementById('gridCols').value),
    rows:Number(document.getElementById('gridRows').value) }));
  const x=(col+0.5)*rect.width/grid.cols, y=(row+0.5)*rect.height/grid.rows;
  if (touch) await page.touchscreen.tap(rect.x+x,rect.y+y);
  else await canvas.click({position:{x,y}});
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const context=await browser.newContext({viewport:{width:1180,height:880},hasTouch:true});
    const page=await context.newPage();
    const errors=[]; // Mobile authors cannot inspect the console; surface errors in CI assertions.
    page.on('pageerror',error=>errors.push(error.stack||error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/docs/tools/building-interior-author/index.html',
      {waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>typeof window._biaBridge?.loadData==='function',
      null,{timeout:55000});
    await page.locator('#newBtn').click();
    let snapshot=await readExit(page);
    assert.equal(snapshot.exits.length,0);
    assert(snapshot.floor.length>0);
    const originalFloor=JSON.stringify(snapshot.floor); // Proves exit authoring never paints hidden floor tiles.
    await page.locator('#addExitBtn').click(); // A real UI click selects the new exit.
    await page.locator('#toolMoveExit').click();
    await tapCell(page,0,3); // Blank WEST border, adjacent to painted floor at (1,3).
    snapshot=await readExit(page);
    assert.deepEqual(snapshot.exits[0].tiles,[[0,3]],'mouse must place exit on blank cell, not on neighboring floor');
    assert.equal(snapshot.exits[0].direction,'east');
    assert.equal(JSON.stringify(snapshot.floor),originalFloor);
    assert.match(snapshot.status,/outside floor.*no floor tile added/i);
    assert(await page.locator('#exitCanvasStatus').isVisible(),'mobile user must see the exit result directly underneath the canvas');
    await page.locator('#toolPaintExit').click();
    await page.setViewportSize({width:430,height:880}); // Reproduce the stacked single-column mobile layout, not only a desktop touch simulation.
    await tapCell(page,0,4,true); // Real touch input, one adjacent marker for a wide exit.
    snapshot=await readExit(page);
    assert.deepEqual(snapshot.exits[0].tiles,[[0,3],[0,4]],'touch should paint an adjoining outside exit tile');
    assert.equal(JSON.stringify(snapshot.floor),originalFloor);
    await page.setViewportSize({width:1180,height:880}); // Return to desktop layout for the remaining pointer and coordinate checks.
    await page.locator('#toolMoveExit').click();
    await tapCell(page,4,0); // Move to NORTH wall, even when old direction was EAST.
    snapshot=await readExit(page);
    assert.deepEqual(snapshot.exits[0].tiles,[[4,0]]);
    assert.equal(snapshot.exits[0].direction,'south');
    await page.locator('#exitTileCol').fill('5');
    await page.locator('#exitTileRow').fill('0');
    await page.locator('#moveExitToCoords').click();
    snapshot=await readExit(page);
    assert.deepEqual(snapshot.exits[0].tiles,[[5,0]],'numeric control must move outside-floor exits');
    assert.equal(JSON.stringify(snapshot.floor),originalFloor);
    const exported=await page.evaluate(()=>JSON.parse(document.getElementById('exportText').value)); // Current save format.
    assert.equal(await page.evaluate(room=>window._biaBridge.loadData(room,'browser smoke'),exported),true);
    snapshot=await readExit(page);
    assert.deepEqual(snapshot.exits[0].tiles,[[5,0]],'reload must preserve the manually authored outside marker');
    await page.locator('#canvasExitSelect').selectOption(exported.exits[0].id);
    await page.locator('#toolMoveExit').click();
    await tapCell(page,0,0); // Blank outer corner with NO neighboring floor; must reject with visible feedback.
    snapshot=await readExit(page);
    assert.deepEqual(snapshot.exits[0].tiles,[[5,0]],'invalid click must not move the doorway');
    assert.match(snapshot.status,/Cannot place exit.*must touch one painted floor tile/i);
    await page.locator('#addExitBtn').click(); // Test a multi-exit interior instead of silently relying on the single-exit shortcut.
    await page.locator('#toolMoveExit').click();
    await page.locator('#canvasExitSelect').selectOption(exported.exits[0].id);
    assert.equal(await page.locator('#canvasExitSelect').inputValue(),exported.exits[0].id);
    await tapCell(page,6,0); // Moving the selected first exit must not alter the newly created second exit.
    snapshot=await readExit(page);
    assert.deepEqual(snapshot.exits[0].tiles,[[6,0]],'grid-side exit picker chooses the existing exit to move');
    assert.deepEqual(snapshot.exits[1].tiles,[]);
    assert(!errors.length,'editor startup / canvas interactions must not throw: '+errors.join('\n'));
    console.log('Building Interior Editor browser smoke: mouse, touch, blank-grid placement, direction, coordinates, export, reload and errors passed.');
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
