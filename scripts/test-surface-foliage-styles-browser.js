'use strict';
// Browser regression uses the shipped Three.js r128, actual growth code and
// the shared authoring panel. No mock geometry or source-text-only assertions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
let chromium; // Playwright runs the actual DOM, materials and BufferGeometry.
try { ({chromium}=require('playwright')); }
catch(error) {
  if(error.code!=='MODULE_NOT_FOUND')throw error;
  console.log('skip: playwright not installed (browser-only smoke test)');
  process.exit(0);
}
const root=path.resolve(__dirname,'..'); // Checked-in browser scripts are served without a deployment.
const server=http.createServer((request,response)=>{
  const route=(request.url||'/').split('?')[0];
  if(route==='/test-page'){
    response.setHeader('Content-Type','text/html');
    response.end('<!doctype html><html><head><script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script><script src="/docs/js/foliage-generator.js"></script><script src="/docs/js/surface-foliage-authoring.js"></script></head><body><div id="controls"></div></body></html>');
    return;
  }
  const file=path.resolve(root,decodeURIComponent(route).replace(/^\/+/,''));
  if(!file.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
  fs.readFile(file,(err,bytes)=>{
    if(err){response.writeHead(404);response.end(err.message);return;}
    response.setHeader('Content-Type','text/javascript');response.end(bytes);
  });
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser; // Browser is closed in finally even when an assertion fails.
  try {
    browser=await chromium.launch({args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage();
    const pageErrors=[]; // Captures browser exceptions for CI and mobile-only debugging.
    page.on('pageerror',error=>pageErrors.push(error.stack||error.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/test-page',{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>!!(window.THREE?.BoxGeometry&&window.FoliageGenerator?.buildSurfaceGrowth&&window.SurfaceFoliageAuthoring?.mount),null,{timeout:30000});
    const data=await page.evaluate(()=>{
      const T=window.THREE,growth=window.FoliageGenerator; // Actual production THREE and generator.
      function build(geometry,style,density,count=12){ // Consistent authored wall test with no helper meshes.
        const root=new T.Group(),mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({color:0xffffff}));
        mesh.userData.surfaceFoliageRole='walls';root.add(mesh);
        return growth.buildSurfaceGrowth(root,{style,density,count,kind:'roots',target:'walls',seed:'corner-wrap-browser',
          radius:.05,length:2,offset:.01,texture:''});
      }
      const flat=build(new T.PlaneGeometry(2,2),'cornerFill',.5,7);
      const corners=build(new T.BoxGeometry(4,3,2),'cornerFill',.5,7);
      const low=build(new T.BoxGeometry(4,3,2),'wrap',.5,1);
      const high=build(new T.BoxGeometry(4,3,2),'wrap',.5,24);
      const full=build(new T.BoxGeometry(4,3,2),'wrap',1,24);
      const partial=build(new T.BoxGeometry(4,3,2),'wrap',.95,24);
      const reused=build(new T.BoxGeometry(4,3,2),'wrap',1,24);
      const count=group=>group.children.filter(x=>x.isMesh&&!x.userData.surfaceGrowthCover)
        .reduce((sum,x)=>sum+x.geometry.attributes.position.count,0);
      const cover=group=>group.children.filter(x=>x.userData.surfaceGrowthCover);
      const digest=group=>group.children.map(x=>{
        const v=x.geometry.attributes.position.array;
        return Array.from(v.slice(0,Math.min(v.length,40))).map(x=>x.toFixed(5)).join(',');
      }).join('|');
      const segmentGeometry=new T.BufferGeometry(); // Independent wall planes slightly separated at their common corner.
      segmentGeometry.setAttribute('position',new T.Float32BufferAttribute([
        .02,0,0,2,0,0,.02,2,0,2,0,0,2,2,0,.02,2,0,
        0,0,.03,0,2,.03,0,0,2,0,2,.03,0,2,2,0,0,2
      ],3));
      const split=build(segmentGeometry,'cornerFill',.5,7);
      let recipes=[]; // Mimics every editor's read/write adapter to verify actual UI serialization.
      window.SurfaceFoliageAuthoring.mount(document.getElementById('controls'),{
        targets:[['all','All walls']],read:()=>recipes,selectedIds:()=>[],
        write:next=>{recipes=next;return 'regenerated';}
      });
      const field=name=>document.querySelector('[data-field="'+name+'"]');
      const densityRow=document.querySelector('[data-wrap-controls]');
      const hiddenBefore=getComputedStyle(densityRow).display==='none';
      field('style').value='wrap';field('style').dispatchEvent(new Event('change'));
      const visibleAfter=getComputedStyle(densityRow).display!=='none';
      const budgetLabel=document.querySelector('[data-count-label]').textContent;
      field('density').value='.75';field('count').value='9';
      document.querySelector('[data-action="apply"]').click();
      field('style').value='natural';field('style').dispatchEvent(new Event('change'));
      field('layer').value='0';field('layer').dispatchEvent(new Event('change'));
      return {
        flatTubes:count(flat),cornerTubes:count(corners),splitCornerTubes:count(split),
        lowTubes:count(low),highTubes:count(high),partialCover:cover(partial).length,
        fullCover:cover(full).length,fullTriangles:full.userData.surfaceGrowthStats.coverTriangles,
        coverHasUvs:!!cover(full)[0]?.geometry.attributes.uv,
        outline:full.children.find(x=>!x.userData.surfaceGrowthCover)?.layers.mask,
        deterministic:digest(full)===digest(reused),
        hiddenBefore,visibleAfter,budgetLabel,
        savedRecipe:recipes[0],restoredStyle:field('style').value,restoredDensity:field('density').value
      };
    });
    assert.equal(data.flatTubes,0,'A flat planar surface has no geometric corner');
    assert(data.cornerTubes>0,'Sharp box corners should grow actual tubes');
    assert(data.splitCornerTubes>0,'Slightly gapped wall panels must form a detected corner');
    assert(data.highTubes>data.lowTubes,'Strand budget must affect Wrap geometry');
    assert.equal(data.partialCover,0,'Partial densities must not cover the whole wall with a solid sheet');
    assert.equal(data.fullCover,1,'100% density must add exactly one conformal covering mesh');
    assert.equal(data.fullTriangles,12,'Covering mesh must follow the real 12-triangle box surface');
    assert(data.coverHasUvs,'Dense covering must keep texture coordinates');
    assert((data.outline&2)!==0,'Raised roots and vines must participate in shell outlines');
    assert(data.deterministic,'Identical saved seed/recipe must regenerate deterministic geometry');
    assert(data.hiddenBefore&&data.visibleAfter,'Wrap density must correctly hide/show in an actual browser DOM');
    assert.equal(data.budgetLabel,'Strand budget');
    assert.equal(data.savedRecipe?.style,'wrap');
    assert.equal(data.savedRecipe?.density,.75);
    assert.equal(data.savedRecipe?.count,9);
    assert.equal(data.restoredStyle,'wrap','Selecting a saved layer must restore its style');
    assert.equal(Number(data.restoredDensity),.75,'Selecting a saved layer must restore density');
    assert.deepEqual(pageErrors,[], 'Shared authoring or growth must not emit browser errors');
    console.log('Surface foliage browser regression passed: flat/corner/gapped meshes, Wrap budget/coverage/UVs/outline, seed determinism and shared editor controls.');
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
