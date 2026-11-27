#!/usr/bin/env node
'use strict';
// Pixel Probe reports snow GPU and inactive frame overhead directly on mobile.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
let snapshot={installed:true,version:7,active:false,mode:'none',snowMeshCount:0,
  compactTiles:0,detailedTiles:0,triangleCount:0,skippedInactiveTicks:1190,
  thickness:0,opacity:null,chunkCount:0,buildCount:0,textureState:'not-requested'};
const win={EnvironmentSurfaceRuntime:{debugSnapshot:()=>({mode:'disabled',pendingJobs:0,ownerSurfaces:0})},
  EnvironmentSurfaceMicroPlateau:{debugSnapshot:()=>snapshot}};
vm.runInNewContext(fs.readFileSync('docs/js/environment-surface-pixel-probe.js','utf8'),
  {window:win,document:{getElementById:()=>null},console},{filename:'environment-surface-pixel-probe.js'});
const before=win.EnvironmentSurfacePixelProbe.formatLine();
assert.match(before,/micro=none/,'no surface is labeled inactive instead of waiting');
assert.match(before,/snowMeshes0/,'normal Cloud Forest does not hide a snow draw');
assert.match(before,/triangles0/,'normal Cloud Forest allocates no snow triangles');
assert.match(before,/idleSkipped1190/,'mobile debug exposes skipped frames');
snapshot={...snapshot,active:true,mode:'snow',compactTiles:9,detailedTiles:16,
  triangleCount:306,snowMeshCount:1,builtTiles:25,snowDepthUpdates:2,
  lastSnowDepthUpdateMs:.14,textureState:'raw-canvas-png'};
const during=win.EnvironmentSurfacePixelProbe.formatLine();
assert.match(during,/micro=snow/);
assert.match(during,/compact9\/detailed16\/triangles306\/snowMeshes1/);
assert.match(during,/depthUpdates2\/lastDepthUpdate0\.14ms/);
assert.equal(win.EnvironmentSurfacePixelProbe.appendOrReplace('Pixel Probe report'),
  'Pixel Probe report\n'+during,'report remains copyable as ordinary Pixel Probe text');
console.log('Mobile snow GPU resource, triangle and skipped-frame diagnostics passed.');
