(() => {
  'use strict';

  const KNOTS = 13; // Samples per editable axis; used by pointer interpolation and exported generator profiles.
  const NEUTRAL = Array(KNOTS).fill(0.5); // Unbiased baseline for either axis while the other controls the slope.
  const AXES = ['eastWest', 'northSouth']; // Keys match WildernessMapGenerator.heightCurves and exported settings.
  let profile = { enabled:false, eastWest:NEUTRAL.slice(), northSouth:NEUTRAL.slice(), upwardVariation:0, downwardVariation:0 }; // Working profile, returned without shared mutable references.
  let onChange = () => {}; // Main lab scheduler, called only in response to author interaction.
  const active = new Map(); // Each canvas's last pointer position, for filling skipped knots during fast finger drags.

  function clamp(value, lo, hi) { return Math.max(lo, Math.min(hi, value)); }

  function sample(knots, at) {
    const x = clamp(at, 0, 1) * (knots.length - 1); // Position in the current axis's source knot array.
    const i = Math.min(knots.length - 2, Math.floor(x)); // Segment immediately to the left of the current sample.
    const t = x - i; // Fraction along the current segment.
    const a = knots[Math.max(0, i-1)], b = knots[i]; // Previous point and segment start.
    const c = knots[i+1], d = knots[Math.min(knots.length-1, i+2)]; // Segment end and following point.
    const m0 = (c-a)*0.5, m1 = (d-b)*0.5; // Catmull–Rom tangents, identical to the generator's sampler.
    return clamp((2*t*t*t-3*t*t+1)*b + (t*t*t-2*t*t+t)*m0 + (-2*t*t*t+3*t*t)*c + (t*t*t-t*t)*m1, 0, 1);
  }

  function copyKnots(knots) {
    if (!Array.isArray(knots) || knots.length < 2 || knots.length > 65 || !knots.every(Number.isFinite)) return NEUTRAL.slice();
    return Array.from({ length:KNOTS }, (_, i) => sample(knots, i / (KNOTS-1))); // Imported arrays with differing resolutions remain editable.
  }

  function getProfile() {
    return { ...profile, eastWest:profile.eastWest.slice(), northSouth:profile.northSouth.slice() };
  }

  function setProfile(next) {
    profile = {
      enabled:next?.enabled === true,
      eastWest:copyKnots(next?.eastWest), northSouth:copyKnots(next?.northSouth),
      upwardVariation:clamp(Number(next?.upwardVariation) || 0, 0, 8),
      downwardVariation:clamp(Number(next?.downwardVariation) || 0, 0, 8)
    };
    const enabled = document.getElementById('heightCurvesEnabled');
    if (enabled) enabled.checked = profile.enabled;
    for (const key of ['upwardVariation','downwardVariation']) {
      const input = document.getElementById('heightCurve_' + key);
      const number = document.getElementById('heightCurve_' + key + '_num');
      if (input) input.value = String(profile[key]);
      if (number) number.value = String(profile[key]);
    }
    redraw();
  }

  function drawAxis(axis) {
    const canvas = document.getElementById('heightCurve_' + axis);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w=canvas.width,h=canvas.height; // Device-independent canvas coordinates for pointer mapping and lines.
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle='#091522';ctx.fillRect(0,0,w,h);
    ctx.strokeStyle='rgba(205,230,255,0.13)';ctx.lineWidth=1;
    for(let i=1;i<4;i++){
      const x=w*i/4,y=h*i/4;
      ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();
    }
    const knots=profile[axis]; // Curve being displayed and edited by this canvas.
    ctx.beginPath();ctx.strokeStyle=profile.enabled?'#60d5ff':'#8997b1';ctx.lineWidth=2.5;
    for(let px=0;px<=w;px++){
      const py=(1-sample(knots,px/w))*h;
      if(px===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    }
    ctx.stroke();
    ctx.fillStyle=profile.enabled?'#b5ebff':'#9fb4cf';
    for(let i=0;i<KNOTS;i++){
      ctx.beginPath();ctx.arc(i*w/(KNOTS-1),(1-knots[i])*h,2,0,Math.PI*2);ctx.fill();
    }
  }

  function redraw(){for(const axis of AXES)drawAxis(axis);}

  function pointerPosition(canvas, event) {
    const rect=canvas.getBoundingClientRect(); // Browser-space canvas bounds account for mobile scaling and panel size.
    return {
      x:clamp((event.clientX-rect.left)/Math.max(1,rect.width),0,1),
      y:clamp(1-(event.clientY-rect.top)/Math.max(1,rect.height),0,1)
    };
  }

  function paint(axis, from, to) {
    const points=profile[axis]; // Mutable author knots on the active drawn axis.
    const left=from||to;
    const start=Math.min(left.x,to.x),end=Math.max(left.x,to.x);
    for(let i=0;i<KNOTS;i++){
      const pos=i/(KNOTS-1);
      if(pos<start-1e-6 || pos>end+1e-6)continue;
      const t=Math.abs(to.x-left.x)<1e-6?0:(pos-left.x)/(to.x-left.x);
      points[i]=clamp(left.y+(to.y-left.y)*clamp(t,0,1),0,1);
    }
    const nearest=Math.round(to.x*(KNOTS-1)); // Guarantees a tiny tap edits its nearest knot even without an intervening segment.
    points[nearest]=to.y;
    redraw();
    onChange();
  }

  function bindCanvas(axis) {
    const canvas=document.getElementById('heightCurve_'+axis);
    if(!canvas)return;
    canvas.style.touchAction='none';
    canvas.addEventListener('pointerdown',event=>{
      if(event.pointerType==='mouse' && event.button!==0)return;
      profile.enabled=true;
      const enabled=document.getElementById('heightCurvesEnabled');
      if(enabled)enabled.checked=true;
      canvas.setPointerCapture?.(event.pointerId);
      const point=pointerPosition(canvas,event);
      active.set(axis,{ id:event.pointerId,point });
      paint(axis,point,point);
    });
    canvas.addEventListener('pointermove',event=>{
      const previous=active.get(axis);
      if(!previous||previous.id!==event.pointerId)return;
      const point=pointerPosition(canvas,event);
      paint(axis,previous.point,point);
      active.set(axis,{id:event.pointerId,point});
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,event=>{
      if(active.get(axis)?.id===event.pointerId)active.delete(axis);
    });
  }

  function init(options={}) {
    onChange=typeof options.onChange==='function'?options.onChange:(()=>{});
    for(const axis of AXES)bindCanvas(axis);
    const enabled=document.getElementById('heightCurvesEnabled');
    if(enabled)enabled.addEventListener('change',()=>{profile.enabled=enabled.checked;redraw();onChange();});
    for(const key of ['upwardVariation','downwardVariation']){
      const input=document.getElementById('heightCurve_'+key);
      const number=document.getElementById('heightCurve_'+key+'_num');
      if(!input||!number)continue;
      function update(from){
        profile[key]=clamp(Number(from.value)||0,0,8);
        input.value=number.value=String(profile[key]);
        onChange();
      }
      input.addEventListener('input',()=>update(input));
      number.addEventListener('change',()=>update(number));
    }
    redraw();
  }

  window.WildernessLabHeightCurveEditor={init,setProfile,getProfile,redraw}; // Read by the existing lab and settings exporter.
})();