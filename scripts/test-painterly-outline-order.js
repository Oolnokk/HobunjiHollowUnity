#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
function verify(load) {
  const check = (ok, msg) => { if (!ok) throw new Error(msg); };
  class Vec2 { constructor(x=0,y=0){this.set(x,y)} set(x,y){this.x=x;this.y=y;} }
  class Mat { constructor(props){Object.assign(this,props);this.userData={};this.isShaderMaterial=true;} }
  class Scene { constructor(){this.children=[];} add(mesh){this.children.push(mesh);} }
  class Mesh { constructor(geometry,material){this.material=material;} }
  class Target { constructor(w,h){this.texture={image:{width:w,height:h}};} setSize(w,h){this.texture.image={width:w,height:h};} }
  const THREE={Vector2:Vec2,ShaderMaterial:Mat,Scene,Mesh,WebGLRenderTarget:Target,PlaneGeometry:class{},OrthographicCamera:class{},LinearFilter:1};
  const originalColor={image:{width:64,height:32}}, calls=[];
  let target=null, failAt=-1, benchmarkRunning=true, activeQuery=null, queryStarts=0;
  const ext={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2};
  const gl={getExtension:()=>ext,createQuery:()=>({}),beginQuery(_kind,q){check(!activeQuery,'nested GPU timer');activeQuery=q;queryStarts++;},
    endQuery(){check(activeQuery,'ending inactive GPU timer');activeQuery=null;},getParameter:()=>false,
    getQueryParameter:()=>false,deleteQuery(){}};
  const renderer={autoClear:false,getContext:()=>gl,getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},clear(){},
    render(scene) {
      const u=scene.children[0].material.uniforms;
      const sampled=Object.values(u).map(v=>v.value);
      check(!target || !sampled.includes(target.texture),'render-target sampler feedback');
      calls.push({target,source:u.tSource?.value,paint:u.uHobunjiPaintMode?.value,depth:u.uDepthOutlinesOn?.value,seam:u.uSeamOutlinesOn?.value});
      if(calls.length===failAt) throw new Error('injected draw failure');
    }
  };
  const window={THREE,__hobunjiGameRenderer:renderer,RenderABBenchmark:{isRunning:()=>benchmarkRunning}};
  const localStorage={getItem:()=> 'medium',setItem(){}};
  load({window,THREE,localStorage,document:{getElementById:()=>null},performance:{now:()=>1},setInterval:()=>0,clearInterval(){}});
  const api=window.PainterlyPostprocess, scene=new Scene(), camera={};
  const u={tColor:{value:originalColor},tEdgeId:{value:{}},uTexel:{value:new Vec2()},uSeamOutlinesOn:{value:0},uDepthOutlinesOn:{value:1}};
  const mat=new Mat({uniforms:u,fragmentShader:'varying vec2 vUv;\nvoid main(){vec3 color = texture2D(tColor, vUv).rgb;\nfloat edge=0.0;\ngl_FragColor = vec4(mix(color, vec3(0.0), edge), 1.0);}'});
  scene.add(new Mesh(null,mat));
  renderer.render(scene,camera);
  check(calls.length===5,'outline + oil + wash + tone + present');
  check(calls[0].paint===0 && calls[0].depth===1 && calls[0].target,'precomposite has only depth ink');
  check(calls[1].source===calls[0].target.texture,'oil reads outlined image');
  check(calls[0].target===calls[3].target,'reuse dead tone target rather than allocate a fourth');
  check(calls[4].target===null && calls[4].paint===2 && calls[4].depth===0,'final draw paints without doubling outlines');
  check(u.uDepthOutlinesOn.value===1 && renderer.autoClear===false && target===null,'restore render state');
  check(api.snapshot().outlinedFrames===1,'report actual outline-first frames');
  check(queryStarts===0,'benchmark owns GPU queries on a sampled frame');
  check(!mat.fragmentShader.includes('sourcePeak'),'restore original painterly finish');
  calls.length=0; renderer.render(scene,camera);
  check(calls.length===5 && calls[1].source===calls[0].target.texture,'second frame does not sample stale tone target');
  calls.length=0; api.setOutlineFirst(false); renderer.render(scene,camera);
  check(calls.length===4 && calls[0].source===originalColor && calls[3].depth===1,'benchmark legacy order');
  calls.length=0; api.setOutlineFirst(true); u.uDepthOutlinesOn.value=0; renderer.render(scene,camera);
  check(calls.length===4 && calls[0].source===originalColor,'no extra draw in shell/none mode');
  calls.length=0; u.uDepthOutlinesOn.value=1; api.setMode('off'); renderer.render(scene,camera);
  check(calls.length===1 && calls[0].paint===0 && calls[0].depth===1,'paint off is direct');
  // Resume independent timing after the benchmark, including a resize and mode change.
  calls.length=0; benchmarkRunning=false; api.setMode('high'); originalColor.image={width:96,height:48};
  renderer.render(scene,camera);
  check(calls.length===5 && calls[0].target.texture.image.width===96 && calls[4].paint===3,'resized high-quality frame');
  check(queryStarts===3 && activeQuery===null,'standalone timer resumes on next sampled frame');
  calls.length=0; u.tColor.value=null; renderer.render(scene,camera);
  check(calls.length===1 && calls[0].paint===0 && calls[0].depth===1 && u.uHobunjiPaintMode.value===3,'missing source safely presents unfiltered');
  u.tColor.value=originalColor;
  calls.length=0; api.setMode('medium'); failAt=1;
  try { renderer.render(scene,camera); throw new Error('expected injected error'); } catch(e){check(e.message==='injected draw failure','prepass error propagates');}
  check(target===null && renderer.autoClear===false && u.uDepthOutlinesOn.value===1 && u.uHobunjiPaintMode.value===2,'prepass error restores target and uniforms');
  calls.length=0; failAt=5;
  try { renderer.render(scene,camera); throw new Error('expected injected error'); } catch(e){check(e.message==='injected draw failure','presentation error propagates');}
  check(target===null && renderer.autoClear===false && u.uDepthOutlinesOn.value===1,'presentation error restores outline flags');
}
const source = fs.readFileSync('docs/js/painterly-postprocess.js','utf8');
verify(context => vm.runInNewContext(source, context));
console.log('Painterly outline ordering, target reuse and state restoration passed');
