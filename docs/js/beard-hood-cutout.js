// 2D beard-to-hood cutout. Portrait-space masks preserve main's normal beard/hood draw order.
(() => {
  'use strict';
  if (window.PortraitBeardHoodCutout) return;

  const SIZE = 200; // The authored portrait and mask canvas share exactly 200 logical pixels.
  const PIXELS = SIZE * SIZE;
  const matteCache = new WeakMap(); // Reuses a stable cosmetic mask's stencil across dialogue/world portrait redraws.

  function normalizeMask(input) {
    if (!input || input.size !== SIZE || !Array.isArray(input.runs)) return null;
    const sorted = input.runs.filter(pair => Array.isArray(pair) && pair.length === 2
      && Number.isInteger(pair[0]) && Number.isInteger(pair[1])
      && pair[0] >= 0 && pair[1] > 0 && pair[0] < PIXELS)
      .map(([start, length]) => [start, Math.min(length, PIXELS - start)])
      .sort((a, b) => a[0] - b[0]);
    const runs = [];
    for (const [start, length] of sorted) {
      const last = runs[runs.length - 1];
      if (last && start <= last[0] + last[1]) last[1] = Math.max(last[1], start + length - last[0]);
      else runs.push([start, length]);
    }
    return {size: SIZE, runs};
  }

  function decodeMask(input) {
    const pixels = new Uint8Array(PIXELS); // Editor brush uses this bitmap; saved JSON remains compact RLE.
    for (const [start, length] of normalizeMask(input)?.runs || []) pixels.fill(1, start, start + length);
    return pixels;
  }

  function encodeMask(pixels) {
    if (!pixels || pixels.length !== PIXELS) return {size: SIZE, runs: []};
    const runs = [];
    for (let i = 0; i < PIXELS;) {
      if (!pixels[i]) { i++; continue; }
      const start = i;
      while (i < PIXELS && pixels[i]) i++;
      runs.push([start, i - start]);
    }
    return {size: SIZE, runs};
  }

  function countMask(input) {
    return (normalizeMask(input)?.runs || []).reduce((total, [, length]) => total + length, 0);
  }

  function alphaFloor(value, fallback = 8) {
    const n = Number(value); // Shared configurable paintability threshold; 128 is 50% of 8-bit alpha.
    return Number.isFinite(n) ? Math.max(1, Math.min(255, Math.round(n))) : fallback;
  }

  function paintMask(input, beardPixels, x, y, radius, erase = false, previous = null, minimumAlpha = 8) {
    const minimum = alphaFloor(minimumAlpha); // Applied only to newly painted pixels; erasing always works on saved mask pixels.
    const pixels = decodeMask(input);
    if (!beardPixels || beardPixels.length !== PIXELS * 4) return encodeMask(pixels);
    const toPoint = (px, py) => ({
      x: Math.max(0, Math.min(SIZE - 0.001, Number(px) || 0)),
      y: Math.max(0, Math.min(SIZE - 0.001, Number(py) || 0)),
    });
    const point = toPoint(x, y);
    const start = previous ? toPoint(previous.x, previous.y) : point;
    const dx = point.x - start.x, dy = point.y - start.y;
    const distance2 = dx * dx + dy * dy;
    const brush = Math.max(.5, Math.min(32, Number(radius) || 1));
    const minX = Math.max(0, Math.floor(Math.min(start.x, point.x) - brush));
    const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(start.x, point.x) + brush));
    const minY = Math.max(0, Math.floor(Math.min(start.y, point.y) - brush));
    const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(start.y, point.y) + brush));
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const vx = px + .5 - start.x, vy = py + .5 - start.y;
      const t = distance2 ? Math.max(0, Math.min(1, (vx * dx + vy * dy) / distance2)) : 0;
      if ((vx - t * dx) ** 2 + (vy - t * dy) ** 2 > brush * brush) continue;
      const i = py * SIZE + px;
      if (erase || beardPixels[i * 4 + 3] >= minimum) pixels[i] = erase ? 0 : 1;
    }
    return encodeMask(pixels);
  }

  function stencilFor(mask) {
    if (matteCache.has(mask)) return matteCache.get(mask);
    const canonical = normalizeMask(mask);
    if (!canonical?.runs.length) return null;
    const canvas = document.createElement('canvas'); // An alpha-only matte, never a recolored/repositioned beard sprite.
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const image = ctx.createImageData(SIZE, SIZE);
    for (const [start, length] of canonical.runs) {
      for (let i = start; i < start + length; i++) image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    matteCache.set(mask, canvas);
    return canvas;
  }

  function applyToHood(hoodCanvas, mask) {
    if (!hoodCanvas || !mask) return {cutPixels: 0, applied: false};
    const stencil = stencilFor(mask);
    const ctx = hoodCanvas.getContext?.('2d');
    if (!stencil || !ctx) return {cutPixels: 0, applied: false};
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out'; // Remove hood alpha only; never move or repaint the beard.
    ctx.drawImage(stencil, 0, 0, hoodCanvas.width, hoodCanvas.height);
    ctx.restore();
    return {cutPixels: countMask(mask), applied: true};
  }

  function normalizeRoots(input) {
    const result = []; // Compact authored tuft-corner pins, in the same portrait pixels as the mask.
    if (!Array.isArray(input)) return result;
    for (const raw of input.slice(0, 24)) {
      if (!raw || !Number.isFinite(Number(raw.x)) || !Number.isFinite(Number(raw.y))) continue;
      const point = {x: Math.max(0, Math.min(SIZE - .001, Number(raw.x))),
        y: Math.max(0, Math.min(SIZE - .001, Number(raw.y)))};
      if (result.some(other => Math.hypot(other.x - point.x, other.y - point.y) < 1)) continue;
      result.push(point);
      if (result.length >= 12) break; // Prevent accidental hundreds of deformers from paint-drag gestures.
    }
    return result;
  }

  function openingSeed(alpha, alphaLimit = 64) {
    // Search a central face region; never select the outer edge of the hood
    // as the "inner ring". Interior pixels must be transparent in the HOOD art.
    const cx = SIZE * .5, cy = SIZE * .47;
    let nearest = null, best = Infinity;
    for (let y = 42; y <= 132; y++) for (let x = 55; x <= 145; x++) {
      if (alpha[(y * SIZE + x) * 4 + 3] >= alphaLimit) continue;
      const dist2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (dist2 < best) {best = dist2; nearest = {x:x+.5,y:y+.5};}
    }
    return nearest;
  }

  function ringEdgeOnRay(alpha, center, root, alphaLimit = 64) {
    const dx = root.x - center.x, dy = root.y - center.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 2) return null;
    const stepX = dx / distance, stepY = dy / distance;
    // The FIRST transition from central transparency to opaque hood is the
    // inner edge. Searching outside-in would mistakenly stretch the outer rim.
    for (let d = .5; d < SIZE; d += .5) { // Check beyond an interior tuft too: the inner ring can lie farther out than the mark.
      const x = Math.floor(center.x + stepX * d), y = Math.floor(center.y + stepY * d);
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) break;
      if (alpha[(y * SIZE + x) * 4 + 3] >= alphaLimit)
        return {x:x+.5,y:y+.5,ringDistance:d};
    }
    return null;
  }

  function normalizeSubdivision(value) {
    // Affects only the LOCALITY of each tuft's 2D deformation, not mesh tessellation.
    // More subdivisions split the hood's visual influence into smaller neighborhoods.
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(1, Math.min(16, Math.round(n))) : 4;
  }

  function normalizeVerticalInfluence(value) {
    // Authored percentages 0–200; keeps baseline behavior at 100% in old cosmetics.
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(200, Math.round(n))) : 100;
  }

  function planTuftStretch(hoodPixels, inputRoots, options = {}) {
    const roots = normalizeRoots(inputRoots);
    const maxStretch = Math.max(2, Math.min(64, Number(options.maxStretch) || 36));
    const subdivision = normalizeSubdivision(options.subdivision); // 1=broad, 4=previous behavior, 16=concentrated local deformation.
    const aboveInfluence = normalizeVerticalInfluence(options.aboveInfluence);
    const belowInfluence = normalizeVerticalInfluence(options.belowInfluence);
    const alphaLimit = alphaFloor(options.hoodAlphaLimit, 64);
    const center = options.openingCenter && Number.isFinite(options.openingCenter.x)
      && Number.isFinite(options.openingCenter.y)
      ? options.openingCenter : openingSeed(hoodPixels, alphaLimit);
    const moves = [];
    const diagnostics = {requested:roots.length,stretched:0,insideRing:0,tooFar:0,
      missingRing:0,openingCenter:center,maxStretch,subdivision,
      aboveInfluence,belowInfluence,moves};
    if (!center) {diagnostics.missingRing=roots.length;return diagnostics;}
    for (const root of roots) {
      const edge = ringEdgeOnRay(hoodPixels, center, root, alphaLimit);
      if (!edge) {diagnostics.missingRing++;continue;}
      const fromCenter = Math.hypot(root.x-center.x,root.y-center.y);
      const delta = {x:root.x-edge.x,y:root.y-edge.y};
      const length = Math.hypot(delta.x,delta.y);
      if (fromCenter <= edge.ringDistance + .75 || length <= .75) {
        diagnostics.insideRing++;continue; // The tuft is already in the hood's opening.
      }
      if (length > maxStretch) {diagnostics.tooFar++;continue;} // Never create huge, implausible distortions.
      const normalRadius = Math.min(85, Math.max(20, length * 2.5 + 12));
      // Subdivision changes the influence region, NOT the target: even the
      // tightest setting still reaches the marked corner exactly.
      const radius = Math.max(8, Math.min(100, normalRadius * Math.sqrt(4 / subdivision)));
      moves.push({from:edge,to:root,delta,radius,aboveInfluence,belowInfluence});
      diagnostics.stretched++;
    }
    return diagnostics;
  }

  function deformationWeight(move, x, y) {
    const {to,radius} = move;
    const dist2=(x-to.x)**2+(y-to.y)**2;
    if(dist2>=radius*radius)return 0;
    const t=1-dist2/(radius*radius),baseWeight=t*t;
    const sideInfluence=((y<to.y ? move.aboveInfluence : move.belowInfluence) ?? 100)/100;
    // Exactly at the tuft marker, subdivision and side strengths must NOT
    // move the pin. The side adjustment rises continuously farther away.
    const sideDistance=Math.min(1,Math.abs(y-to.y)/Math.max(4,radius*.3));
    const smoothSide=sideDistance*sideDistance*(3-2*sideDistance);
    return Math.max(0,Math.min(1,baseWeight*(1+(sideInfluence-1)*smoothSide)));
  }

  function warpForRoot(image, move) {
    const {data,width,height} = image;
    const original = new Uint8ClampedArray(data); // Read-only source for this root; avoid sequential pixel feedback.
    const {to,delta,radius} = move;
    const minX=Math.max(0,Math.floor(to.x-radius)),maxX=Math.min(width-1,Math.ceil(to.x+radius));
    const minY=Math.max(0,Math.floor(to.y-radius)),maxY=Math.min(height-1,Math.ceil(to.y+radius));
    const r2=radius*radius;
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const dist2=(x+.5-to.x)**2+(y+.5-to.y)**2;
      if(dist2>=r2)continue;
      const weight=deformationWeight(move,x+.5,y+.5);
      const sx=Math.max(0,Math.min(width-1,Math.round(x-delta.x*weight)));
      const sy=Math.max(0,Math.min(height-1,Math.round(y-delta.y*weight)));
      const src=(sy*width+sx)*4,dst=(y*width+x)*4;
      data[dst]=original[src];data[dst+1]=original[src+1];
      data[dst+2]=original[src+2];data[dst+3]=original[src+3];
    }
  }

  function stretchHoodToRoots(hoodCanvas, inputRoots, options = {}) {
    const roots=normalizeRoots(inputRoots);
    const empty={requested:roots.length,stretched:0,insideRing:0,tooFar:0,
      missingRing:0,moves:[],applied:false};
    if (!hoodCanvas || !roots.length) return empty;
    try {
      const ctx=hoodCanvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)return empty;
      const image=ctx.getImageData(0,0,SIZE,SIZE);
      const plan=planTuftStretch(image.data,roots,options);
      if(!plan.moves.length)return {...plan,applied:false};
      for(const move of plan.moves)warpForRoot(image,move);
      ctx.putImageData(image,0,0);
      return {...plan,applied:true}; // Only front hood is modified; rear cloth and beard stay untouched.
    }catch(error){return {...empty,error:String(error?.message||error)};}
  }

  window.PortraitBeardHoodCutout = Object.freeze({
    SIZE, normalizeMask, decodeMask, encodeMask, countMask, alphaFloor, paintMask,
    normalizeRoots, normalizeSubdivision, normalizeVerticalInfluence, deformationWeight,
    planTuftStretch, stretchHoodToRoots, applyToHood,
  });
})();
