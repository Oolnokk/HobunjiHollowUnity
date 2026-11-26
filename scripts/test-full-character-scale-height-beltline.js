'use strict';
// Height/Beltline is a reversible editor view over legacy runtime Y and legLength scalars.
const assert = require('node:assert/strict'); // Verifies physical heights and preservation of authored dimensions.
const fs = require('node:fs'); // Reads actual production modules.
const vm = require('node:vm'); // Runs browser-owned math in a headless test.

const rig=fs.readFileSync('docs/js/character-rig-scale.js','utf8'); // Shared source of truth for height/beltline conversions.
const editor=fs.readFileSync('docs/js/character-scale-comparison.js','utf8'); // Full Character Scale panel and preview.
const guard=fs.readFileSync('docs/js/character-scale-comparison-body-input-guard.js','utf8'); // Guarded mobile input handler.
const start=rig.indexOf('  const beltlineGeometry =');
const end=rig.indexOf('  function installProfileDefaults()',start);
assert(start>=0 && end>start,'find actual production converter');
const ctx={ Math };
vm.runInNewContext('const MIN_SCALE=.1, MAX_SCALE=4;\nconst clampScale=v=>Math.max(MIN_SCALE,Math.min(MAX_SCALE,Number(v)||1));\n'
  + rig.slice(start,end)+'\nthis.math={heightBeltlineFor,scaleForHeightBeltline};',ctx);
const math=ctx.math;
const close=(a,b,where)=>assert(Math.abs(a-b)<1e-9, where+': '+a+' != '+b); // Tests unrounded geometry to subpixel precision.

for(const base of [.18,.3,.5,.7,.82]) for(const y of [.1,.32,.7,1,1.8,3.5,4])
  for(const leg of [.1,.4,.9,1.25,2.8,4]){
    const old={x:1.12,y,legLength:leg,head:.7,offsetY:-.04,handScale:.8,footScale:1.1};
    const physical=math.heightBeltlineFor(old,base);
    close(physical.height,(1-base)*y+base*leg,'total height formula');
    close(physical.beltline,base*leg/physical.height,'hip fraction');
    const roundtrip=math.scaleForHeightBeltline(old,physical.height,physical.beltline,base);
    close(roundtrip.y,y,'legacy portrait roundtrip');
    close(roundtrip.legLength,leg,'legacy leg reach roundtrip');
    for(const key of ['x','head','offsetY','handScale','footScale'])
      close(roundtrip[key],old[key],'unaltered '+key);
  }

for(const base of [.2,.43,.7]) for(const height of [.1,.5,1,2,4]){
  const old={x:1,y:1,legLength:1,head:1,offsetY:0};
  const same=math.scaleForHeightBeltline(old,height,base,base);
  close(same.y,height,'baseline portrait matches height');
  close(same.legLength,height,'baseline leg matches height');
  const changed=math.scaleForHeightBeltline(old,height,.85,base);
  const dimensions=math.heightBeltlineFor(changed,base);
  close(dimensions.height,height,'beltline edit preserves actual total stature');
  assert(changed.y>=.1 && changed.y<=4 && changed.legLength>=.1 && changed.legLength<=4,
    'beltline is constrained by the existing runtime scale envelope');
}
for(const hip of [.19,.43,.77]) for(const contact of [.01,.035,hip*.4])
  for(const y of [.1,.7,1.8,4]) for(const leg of [.1,.8,2.2,4]){
    const baseline={hip,contact}; // A real procedural foot's sole-contact center is above the floor.
    const old={x:1,y,legLength:leg,head:.8,offsetY:0};
    const physical=math.heightBeltlineFor(old,baseline);
    const reach=hip-contact, torso=1-hip+contact;
    close(physical.height,torso*y+reach*leg,'floor-to-head includes foot contact');
    close(physical.beltline,(contact*y+reach*leg)/physical.height,'physical hip height includes sole');
    const back=math.scaleForHeightBeltline(old,physical.height,physical.beltline,baseline);
    close(back.y,y,'contact-aware portrait legacy migration');
    close(back.legLength,leg,'contact-aware leg legacy migration');
  }
const contactGeometry={hip:.38,contact:.07};
const initialContact={y:1.6,legLength:.8,x:1,head:1};
const initialPhysical=math.heightBeltlineFor(initialContact,contactGeometry);
const raiseHip=math.scaleForHeightBeltline(initialContact,initialPhysical.height,.65,contactGeometry);
const raised=math.heightBeltlineFor(raiseHip,contactGeometry);
close(raised.height,initialPhysical.height,'contact-aware hip edit preserves overall stature');
close(raised.beltline,.65,'contact-aware hip edit reaches exact requested floor-to-hip %');
const grow=math.scaleForHeightBeltline(initialContact,initialPhysical.height*1.4,initialPhysical.beltline,contactGeometry);
close(math.heightBeltlineFor(grow,contactGeometry).height,initialPhysical.height*1.4,'contact-aware total Height edit');
close(math.heightBeltlineFor(grow,contactGeometry).beltline,initialPhysical.beltline,'contact-aware Height edit preserves beltline');
assert.match(rig,/heightBeltlineFor,\s+scaleForHeightBeltline,/,'pure math exported in shared scale API');
assert.match(editor,/beltlineBaseFraction: Number\.isFinite\(measuredBeltline\)/,'unscaled hip is measured using actual leg solver');
assert.match(editor,/get selectedBeltlineGeometry\(\)/,'guard uses original species hip plus live foot contact');
assert.match(editor,/standingFootContactY/,'contact height follows actual foot mesh sizing');
assert.match(guard,/selectedBeltlineGeometry/,'input guard passes the same measured geometry to the runtime converter');
assert.match(editor,/scaleRow\('Height', 'Height'/,'Height slider present');
assert.match(editor,/scaleRow\('Beltline', 'Beltline height'/,'Beltline slider present');
assert.doesNotMatch(editor,/scaleRow\('PortraitHeight'|scaleRow\('LegLength'/,'separate legacy controls removed');
assert.match(editor,/height: Math\.round\(dimensions\.height/,'export total physical stature');
assert.match(editor,/beltlineHeightPercent:/,'export floor-relative beltline percentage');
assert.match(editor,/legLength: Math\.round\(\(scale\.legLength \|\| scale\.y\)/,'keep old save field for gameplay');
const a=guard.indexOf('  function nextScale(current,');
const b=guard.indexOf('  function nextScalePreservingHead(',a);
assert(a>=0 && b>a,'guard converter is exercised');
const binder={window:{HobunjiCharacterRigScale:math},clamp:(v,lo,hi)=>Math.max(lo,Math.min(hi,v)),
  finitePositive:(v,f=1)=>Number(v)>0?Number(v):f};
vm.runInNewContext(guard.slice(a,b)+'\nthis.nextScale=nextScale;',binder);
const old={x:1.2,y:1.6,legLength:.8,head:.9,offsetY:.03,handScale:.7,footScale:1.2};
const original=math.heightBeltlineFor(old,.38);
const taller=binder.nextScale(old,'height',original.height*150,.9,.38);
const tall=math.heightBeltlineFor(taller,.38);
close(tall.height,original.height*1.5,'height slider total');
close(tall.beltline,original.beltline,'height slider preserves beltline');
const moved=binder.nextScale(old,'beltline',65,.9,.38);
const movedPhysical=math.heightBeltlineFor(moved,.38);
close(movedPhysical.height,original.height,'beltline slider preserves total');
close(movedPhysical.beltline,.65,'beltline slider controls floor/hip fraction');
for(const key of ['x','head','offsetY','handScale','footScale'])
  close(moved[key],old[key],'beltline preserves '+key);
close(binder.nextScale(old,'y',123,.9,.38).y,1.23,'legacy internal Y callers still accepted');
const age=.41; // Stage body scaling multiplies both saved dimensions equally.
const baby=math.heightBeltlineFor({y:old.y*age,legLength:old.legLength*age},.38);
close(baby.beltline,original.beltline,'baby/toddler/child stage keeps hip proportion');
close(baby.height,original.height*age,'age uniformly scales height');
console.log('PASS height/beltline: 210 baseline + 144 nonzero-contact migration roundtrips, floor-to-hip math, extreme bounds, limb preservation and age parity');
