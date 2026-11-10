#!/usr/bin/env node
'use strict';
// Real mobile-viewport Chromium smoke for the modular weapon editor's authoring/cleanup controls.
const assert = require('node:assert/strict'); // Assert data survives UI edits and same-origin reloads.
const fs = require('node:fs'); // Serve actual checked-out scripts, not a hosted page.
const http = require('node:http'); // Local origin provides persistent browser storage.
const path = require('node:path'); // Restrict static file paths to repository root.
let chromium; // CI installs the browser after node tests.
try { ({ chromium } = require('playwright')); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip: playwright not installed'); process.exit(0); }
const root = path.resolve(__dirname, '..'); // Repository root for all relative docs assets.
const mime = { '.js':'text/javascript','.html':'text/html','.json':'application/json',
  '.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.css':'text/css' };
const server = http.createServer((req, res) => {
  const route = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  const file = path.resolve(root, route);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, bytes) => {
    if (error) { res.writeHead(404); res.end('Missing '+route); return; }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(bytes);
  });
});
async function ready(page) {
  await page.waitForFunction(() => !!window.ModularWeapons && !!window.ModularWeaponRecipeProvenance
    && document.getElementById('assembly-summary')?.textContent.includes('matching head primitive'),
  null, { timeout: 30000 }); // The actual editor has rendered its new element inventory.
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser; // Browser and server always close, even if assertions fail.
  try {
    browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    const context = await browser.newContext({ viewport:{width:412,height:850},hasTouch:true,isMobile:true });
    const page = await context.newPage(); // Reused tab retains the locally authored draft.
    const errors = []; // Capture otherwise inaccessible mobile JavaScript exceptions.
    page.on('pageerror', error => errors.push(error.stack || error.message));
    const url = 'http://127.0.0.1:' + server.address().port + '/docs/tools/modular-weapon-editor/index.html';
    await page.goto(url, { waitUntil:'domcontentloaded',timeout:30000 });
    await ready(page);
    const original = await page.evaluate(() => {
      const api = window.ModularWeapons, shaft = api.getConfig().shafts.kylie;
      const authored = Object.entries(shaft.overrides).flatMap(([head, pair]) =>
        (pair.bridges?.strokes || []).filter(op => op.recipe).map(op => ({ head, recipe: op.recipe, box: op.box })));
      return { mounts: JSON.stringify(shaft.mounts), boxes: authored.length,
        authored: JSON.stringify(authored),
        daggerOperations: JSON.stringify(shaft.overrides.dagger?.bridges?.strokes || []),
        daggerOperationCount: shaft.overrides.dagger?.bridges?.strokes?.length || 0 }; // Retain authored hand-brush work when old recipe boxes are removed.
    });
    assert.equal(original.boxes, 1, 'Shipped Kylie retains its newly authored fuse placement, not the old bulk copies');
    assert.match(original.authored, /"recipe":"fuse"/, 'The authored Kylie fuse recipe is shipped');

    // Seed actual same-origin storage with precisely the two old October 29 boxes on each Kylie blade pair.
    await page.evaluate(() => {
      const api = window.ModularWeapons, draft = JSON.parse(JSON.stringify(api.getConfig()));
      const boxA = { x0:338.7881062280972,y0:908.9415575926496,x1:398.33130614420867,y1:1025.3933025613278 };
      const boxB = { x0:222.33636125941896,y0:729.7850268716061,x1:546.9258404481329,y1:1850.0402748508363 };
      for (const [key, head] of Object.entries(draft.heads)) if (head.mount.type === 'blade' && !api.isDisallowed('kylie', key)) {
        const pair = (draft.shafts.kylie.overrides[key] ||= {}); // Keep the newly authored fuse stroke while simulating old bulk copies.
        pair.bridges = { ...(pair.bridges || {}), outline:10, strokes:[ ...(pair.bridges?.strokes || []),
          { recipe:'recipe-1',box:{...boxA} }, { recipe:'tanged-head---sleeved-shaft',box:{...boxB} }
        ] };
      }
      api.replace(draft, true);
    });
    await page.reload({waitUntil:'domcontentloaded',timeout:30000}); await ready(page);
    await page.locator('#shaft').selectOption('kylie');
    await page.locator('#head').selectOption('dagger');
    await page.waitForFunction(() => document.querySelector('#assembly-legacy-summary')
      ?.textContent.includes('Found 18 unchanged copied'));
    assert.equal(await page.locator('#assembly-mount-elements .assembly-element-row').count(), 2);
    assert.equal(await page.locator('#assembly-operation-elements .assembly-element-row').count(), original.daggerOperationCount + 2,
      'Legacy draft adds two boxes without discarding hand-authored brush strokes');
    assert.equal(await page.locator('#assembly-operation-elements .assembly-element-row button').filter({hasText:'Edit box'}).count(), 2,
      'Only two accidental recipe boxes expose recipe editing');
    await page.locator('#assembly-elements > summary').click(); // Numbered advanced sections start collapsed; activate before touching their buttons.
    assert.match(await page.locator('#assembly-summary').innerText(), /1 matching head primitive/);

    // The new element list opens the correct existing recipe and haft line editors.
    const editRecipe = page.locator('#assembly-operation-elements .assembly-element-row')
      .filter({has:page.getByRole('button',{name:'Edit box'})}).first()
      .getByRole('button',{name:'Edit box'}); // Authored brush strokes appear before the imported boxes. // Real touch-sized control, never a forced DOM click.
    try { await editRecipe.click({ timeout: 10000 }); }
    catch (error) {
      const layout = await page.evaluate(() => {
        const button = document.querySelector('#assembly-operation-elements .assembly-element-row button');
        const row = button?.parentElement, box = button?.getBoundingClientRect();
        const para = document.querySelector('#assembly-elements > p');
        const text = row?.querySelector('.assembly-element-description');
        const rect = element => { const b = element?.getBoundingClientRect();
          return b && { x:b.x,y:b.y,width:b.width,height:b.height }; };
        const hit = box && document.elementFromPoint(box.x + box.width/2, box.y + box.height/2);
        return {
          viewport: [innerWidth,innerHeight], scroll:scrollY, button:rect(button),
          row:rect(row), description:rect(text), precedingHelp:rect(para),
          hit:hit?.outerHTML?.slice(0,280), display:row && getComputedStyle(row).display,
          previewPosition:getComputedStyle(document.querySelector('.float-panel')).position,
        };
      });
      console.error('Assembly touch target layout:', JSON.stringify(layout));
      throw error;
    }
    assert.equal(await page.locator('#pair-brush-mode').inputValue(), 'recipe');
    assert.equal(await page.locator('#pair-bridge-on').isChecked(), true);
    await page.locator('#assembly-mount-elements .assembly-element-row').nth(1)
      .getByRole('button',{name:'Select line'}).click();
    assert.equal(await page.locator('#socket').inputValue(), '1');

    // A confirmed draft cleanup is one Undo step and never touches original mounts.
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#assembly-prune-legacy').click();
    await page.waitForFunction(() => document.querySelector('#assembly-status')
      ?.textContent.includes('Removed 18 legacy bulk placements'));
    assert.equal(await page.locator('#assembly-operation-elements .assembly-element-row').count(), original.daggerOperationCount,
      'Cleaning two legacy boxes must not remove authored brush strokes');
    assert.equal(await page.evaluate(() => JSON.stringify(window.ModularWeapons.getConfig().shafts.kylie.overrides.dagger?.bridges?.strokes || [])),
      original.daggerOperations, 'Hand-authored Kylie strokes survive legacy recipe cleanup without modification');
    assert.equal(await page.evaluate(() => JSON.stringify(window.ModularWeapons.getConfig().shafts.kylie.mounts)),
      original.mounts);
    await page.locator('#pair-undo').click();
    await page.waitForFunction(() => document.querySelector('#assembly-legacy-summary')
      ?.textContent.includes('Found 18 unchanged copied'));
    await page.locator('#pair-redo').click();
    await page.waitForFunction(() => document.querySelector('#assembly-legacy-summary')
      ?.textContent.includes('No unchanged 29 October'));
    const saved = await page.evaluate(() => {
      const shaft = window.ModularWeapons.getConfig().shafts.kylie;
      return {
        mounts: JSON.stringify(shaft.mounts),
        boxes: Object.values(shaft.overrides).flatMap(pair => pair.bridges?.strokes || []).filter(op => op.recipe).length,
        authored: JSON.stringify(Object.entries(shaft.overrides).flatMap(([head, pair]) =>
          (pair.bridges?.strokes || []).filter(op => op.recipe).map(op => ({ head, recipe: op.recipe, box: op.box })))),
        stored: !!window.localStorage.getItem('hobunji.modularWeapons.v5'),
      };
    });
    assert.equal(saved.mounts, original.mounts);
    assert.equal(saved.boxes, 1, 'Redo removes old Kylie copies while preserving its authored fuse');
    assert.equal(saved.authored, original.authored, 'Legacy cleanup preserves the authored fuse geometry exactly');
    assert(saved.stored, 'Cleanup is persisted in localStorage');

    // Bulk placement must explain what it will touch, and cannot re-introduce Kylie copies.
    await page.locator('#pair-brush-mode').selectOption('recipe');
    await page.locator('#recipe-list').selectOption('recipe-1');
    let confirmation = ''; // Inspect the real browser dialog before dismissing it.
    page.once('dialog', dialog => { confirmation=dialog.message(); return dialog.dismiss(); });
    await page.locator('#recipe-place-all').click();
    assert.match(confirmation, /Single-ended/i);
    assert.match(confirmation, /Kylie/);
    assert.equal(await page.evaluate(() => Object.values(window.ModularWeapons.getConfig().shafts.kylie.overrides)
      .flatMap(pair => pair.bridges?.strokes || []).filter(op => op.recipe).length), 1, 'Bulk placement does not add Kylie recipes');
    // Bore tool is contextual: a flexible SHAFT alone does not show head-owned connector drilling.
    await page.locator('#shaft').selectOption('grapple-flail');
    await page.locator('#head').selectOption('fishing-mace'); // Allowed axial mace head; hammers are deliberately excluded by the authored matrix.
    assert.equal(await page.locator('#flail-preview-figure').isVisible(),true,
      'complete 2D rig is the primary preview, not hidden beneath source thumbnails');
    assert.equal(await page.locator('#source-preview-workflow').evaluate(element=>element.open),true,
      'selecting a mount line automatically opens the source workspace');
    await page.waitForFunction(()=>document.querySelector('#flail-preview')?.dataset?.rigKind==='flail',
      null,{timeout:30000});
    assert.match(await page.locator('#flail-preview-status').innerText(),/Complete rest-pose rig/,
      'full renderer includes actual flail geometry and annotated real contacts');
    assert.equal(await page.locator('#full-assembly-guides').isChecked(),true);
    await page.locator('#full-assembly-guides').uncheck();
    assert.equal(await page.locator('#full-assembly-guides').isChecked(),false,'hide guide does not modify part authoring');
    await page.locator('#full-assembly-guides').check();
    assert.equal(await page.locator('#shaft-bore-panel').isHidden(), true,
      'a shaft-owned flail with an ordinary rigid modular head cannot reveal connector bore tools');
    assert.equal(await page.evaluate(() => window.ModularWeapons.flailGuide('grapple-flail','fishing-mace')?.explicitMount), true,
      'the physical shaft rope mount still provides a visible connector guide');
    // A rigid head hanging from a flail shaft has a PAIR-LOCAL cyan contact, not an editable global rigid head mounting line.
    assert.equal(await page.locator('#head-rope-x').isEnabled(),true);
    assert.equal(await page.locator('#head-rope-y').isEnabled(),true);
    assert.equal(await page.locator('#head-kind').isDisabled(),true,'rigid mounting type is locked while hanging from a flail');
    assert.equal(await page.locator('#head-rope-x').inputValue(),'185','weight/sleeve contact defaults to the original head.mount END');
    assert.equal(await page.locator('#head-rope-y').inputValue(),'894');
    const originalRigidMount=await page.evaluate(() => JSON.stringify(window.ModularWeapons.getConfig().heads['fishing-mace'].mount));
    await page.locator('#head-rope-x').fill('199');
    await page.locator('#head-rope-x').dispatchEvent('change');
    await page.locator('#head-rope-y').fill('911');
    await page.locator('#head-rope-y').dispatchEvent('change');
    await page.locator('#head-rope-scale').fill('1.35');
    await page.locator('#head-rope-scale').dispatchEvent('change');
    assert.deepEqual(await page.evaluate(() => {
      const api=window.ModularWeapons, recipe=api.flailRecipe('grapple-flail','fishing-mace');
      return {anchor:recipe.flail.head.anchor,space:recipe.flail.head.anchorSpace,scale:recipe.flail.head.scale};
    }),{anchor:{x:199,y:911},space:'layer',scale:1.35},
    'pair-only numeric head contact and independent scale are applied by the ACTUAL runtime assembler');
    assert.equal(await page.evaluate(() => JSON.stringify(window.ModularWeapons.getConfig().heads['fishing-mace'].mount)),
      originalRigidMount,'head mounting line is never changed by the hanging rope controls');
    // The complete canvas must visually re-render when an existing pair-specific scale/flip value changes.
    await page.locator('#pair-workflow').evaluate(panel=>{ panel.open=true; }); // Keep section 05 open even if earlier tests already expanded it.
    const previewBefore=await page.locator('#flail-preview').evaluate(canvas=>canvas.toDataURL('image/png'));
    const scaleYField=page.locator('#fields [aria-label="Pair scaleY"]');
    await scaleYField.fill('0.45');
    await scaleYField.dispatchEvent('change');
    await page.waitForFunction(() => window.ModularWeapons.flailRecipe(
      'grapple-flail','fishing-mace')?.flail?.head?.visualTransform?.scaleY===0.45);
    await page.waitForFunction(previous => document.querySelector('#flail-preview')?.toDataURL('image/png')!==previous,
      previewBefore,{timeout:30000});
    assert.match(await page.locator('#pair-transform-status').innerText(),/scale 1 × 0.45/,
      'mobile diagnostics report the head-only visual correction actually used in the full rig');
    const flipYField=page.locator('#fields [aria-label="Pair flipY"]');
    await flipYField.check(); // Flipping a suspended head changes art only, not the authored rigid fitting line.
    await page.waitForFunction(()=>window.ModularWeapons.flailRecipe(
      'grapple-flail','fishing-mace')?.flail?.head?.visualTransform?.flipY===true);
    assert.equal(await page.evaluate(() => window.ModularWeapons.flailRecipe(
      'grapple-flail','fishing-mace').flail.chain.mountLengthPx),843.75,
      'pair-specific head scaling and reversal do not alter connector length');
    assert.equal(await page.evaluate(() => JSON.stringify(window.ModularWeapons.getConfig().heads['fishing-mace'].mount)),
      originalRigidMount,'pair scale and flip never alter original mace head mounting geometry');
    await page.locator('#head').selectOption('pick-shovel-pick'); // Exact new allowance and damage override from user export.
    assert.equal(await page.locator('#pair-damage-type').inputValue(),'blunt');
    assert.deepEqual(await page.evaluate(() => {
      const api=window.ModularWeapons,head=api.getConfig().heads['pick-shovel-pick'];
      const flail=api.flailRecipe('grapple-flail','pick-shovel-pick');
      return {allowed:!api.isDisallowed('grapple-flail','pick-shovel-pick'),
        flailDamage:api.weaponDamageType('grapple-flail','pick-shovel-pick'),
        normalDamage:api.weaponDamageType('fishing-spear','pick-shovel-pick'),
        headDamage:head.dmgType,flipY:flail.flail.head.visualTransform.flipY};
    }),{allowed:true,flailDamage:'blunt',normalDamage:'sharp',headDamage:'sharp',flipY:true},
    'Pick Head is blunt only on this flail shaft, while its original sharp geometry and ordinary weapons remain intact');
    assert.match(await page.locator('#pair-transform-status').innerText(),/blunt damage/);
    await page.locator('#head-contact-reset').click();
    assert.equal(await page.locator('#head-rope-x').inputValue(),'185','reset restores the original rigid sleeve endpoint');
    await page.locator('#head-contact-move').click(); // Open source canvas and activate pair-only point editing on mobile.
    assert.equal(await page.locator('#source-preview-workflow').evaluate(section=>section.open),true);
    const contactCanvas=page.locator('#head-canvas');
    await contactCanvas.click({position:{x:80,y:110}}); // Touch click moves cyan contact, not the stored rigid arrow.
    assert.notDeepEqual(await page.evaluate(() => window.ModularWeapons.flailRecipe('grapple-flail','fishing-mace').flail.head.anchor),
      {x:185,y:894},'tapping source head canvas creates an editable hanging contact');
    assert.equal(await page.evaluate(() => JSON.stringify(window.ModularWeapons.getConfig().heads['fishing-mace'].mount)),
      originalRigidMount,'cyan source editing leaves original head coordinates unchanged');
    await page.locator('#head').selectOption('dagger');
    assert.equal(await page.locator('#head-rope-x').inputValue(),'207','other head pairs retain their own tang START');
    assert.equal(await page.locator('#head-rope-y').inputValue(),'623');
    await page.locator('#shaft').selectOption('fishing-mace');
    await page.locator('#head').selectOption('grapple-flail');
    assert.equal(await page.locator('#flail-authoring-panel').evaluate(section=>section.open),true,
      'active flail controls are open while unrelated systems remain collapsible');
    assert.match(await page.locator('.rig-legend').innerText(),/Gold ring.*Cyan ring.*Purple dashed ruler/,
      'the visible full-rig legend explains the connector and both endpoints');
    assert.equal(await page.evaluate(() => window.ModularWeapons.flailGuide('fishing-mace','grapple-flail')?.explicitMount),
      true,'the hand-authored Fishing Mace has its own visible rope mount and preserved bore treatment');
    assert.equal(await page.evaluate(() => window.ModularWeapons.isDisallowed('grapple-flail','warhammer')),true,
      'authored flail shaft exclusions reject hammers even though mace heads are allowed');
    await page.waitForFunction(() => document.querySelector('#shaft-bore-panel')?.hidden === false,
      null,{timeout:30000});
    assert.equal(await page.locator('#bore-add').isEnabled(), true);
    assert.equal(await page.evaluate(() => window.ModularWeapons.getConfig().shafts['fishing-mace'].bores[0].offsetY),
      20,'the uploaded example remains 20px below the physical connector contact');
    await page.locator('#bore-add').click(); // The example already owns one 27px bore; add a separate default 20px bore.
    assert.equal(await page.locator('#bore-x').inputValue(), '0', 'new bore X offset is zero at the rope attachment');
    assert.equal(await page.locator('#bore-y').inputValue(), '0', 'new bore Y offset is zero at the rope attachment');
    assert.equal(await page.locator('#bore-rx').inputValue(), '20', 'new hole is 20px wide');
    assert.equal(await page.locator('#bore-ry').inputValue(), '20', 'new hole is 20px high');
    assert.equal(await page.locator('#bore-outline').inputValue(), '3', 'a black interior rim is automatically authored');
    assert.equal(await page.locator('#source-preview-workflow').evaluate(section=>section.open),true,
      'starting a bore drag reveals the touch-editable haft canvas automatically');
    assert.equal(await page.locator('#head-rope-x').isDisabled(), true,
      'the multi-sprite head author, not a modular fitting arrow, owns its attachment');
    assert.deepEqual(await page.evaluate(() => {
      const api=window.ModularWeapons, config=api.getConfig(), shaft=config.shafts['fishing-mace'];
      const hole=api.resolvedBores(shaft,config.heads['grapple-flail']).at(-1); // The newly added zero-offset bore is selected, not the preserved reference bore.
      const anchor=api.flailRecipe('fishing-mace','grapple-flail').flail.haftAnchor;
      return {hole:{x:hole.x,y:hole.y},anchor:{x:anchor.x,y:anchor.y}};
    }),{hole:{x:193,y:850},anchor:{x:193,y:850}},
    'the pixel compositor and rope attach to the exact same authored source point');
    await page.locator('#bore-x').fill('15');
    await page.locator('#bore-x').dispatchEvent('change');
    assert.equal(await page.evaluate(() => window.ModularWeapons.getConfig().shafts['fishing-mace'].bores.at(-1).offsetX),15);
    await page.locator('#head').selectOption('warhammer');
    assert.equal(await page.locator('#shaft-bore-panel').isHidden(),true,'switching to a normal head hides drilling');
    assert.equal(await page.evaluate(() => window.ModularWeapons.resolvedBores(
      window.ModularWeapons.getConfig().shafts['fishing-mace'],
      window.ModularWeapons.getConfig().heads.warhammer).length),0,'a normal weapon never receives the bore in gameplay');
    await page.locator('#head').selectOption('grapple-flail');
    assert.equal(await page.locator('#bore-x').inputValue(),'15','relative offsets survive switching heads');
    await page.waitForFunction(() => document.querySelector('#flail-preview-figure')?.hidden === false,
      null,{timeout:30000});
    // Test authored-head anchor is preserved even if the modular editor's stored head arrow is radically moved.
    assert.deepEqual(await page.evaluate(() => {
      const api=window.ModularWeapons, config=JSON.parse(JSON.stringify(api.getConfig()));
      const before=api.flailRecipe('fishing-mace','grapple-flail').flail.head.anchor;
      config.heads['grapple-flail'].mount={type:'weight',start:{x:5,y:7},end:{x:90,y:101}};
      api.replace(config);
      const after=api.flailRecipe('fishing-mace','grapple-flail').flail.head.anchor;
      return {before,after};
    }).then(value=>JSON.parse(JSON.stringify(value))),{before:{x:8,y:190},after:{x:8,y:190}},
    'moving the unused modular head arrow cannot move the real multi-sprite flail attachment');
    assert.deepEqual(errors, [], 'Actual mobile editor should not throw JS exceptions');
    console.log('Modular editor browser: PASS (old Kylie draft, primitive rows, recipe edit, cleanup, Undo/Redo, bulk scope)');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode=1; server.close(); });
