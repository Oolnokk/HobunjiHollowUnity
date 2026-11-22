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

  function paintMask(input, beardPixels, x, y, radius, erase = false, previous = null, minimumAlpha = 8, eraseRequiresOpaque = false) {
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
      if (beardPixels[i * 4 + 3] >= minimum || (erase && !eraseRequiresOpaque)) pixels[i] = erase ? 0 : 1;
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
    const requestedLimit = options.maxStretch == null ? 36 : Number(options.maxStretch);
    const maxStretch = Number.isFinite(requestedLimit)
      ? Math.max(0, Math.min(64, requestedLimit)) : 36; // Actual displacement budget, including 0 and fractional pixels.
    const subdivision = normalizeSubdivision(options.subdivision); // 1=broad, 4=previous behavior, 16=concentrated local deformation.
    const aboveInfluence = normalizeVerticalInfluence(options.aboveInfluence);
    const belowInfluence = normalizeVerticalInfluence(options.belowInfluence);
    const alphaLimit = alphaFloor(options.hoodAlphaLimit, 64);
    const center = options.openingCenter && Number.isFinite(options.openingCenter.x)
      && Number.isFinite(options.openingCenter.y)
      ? options.openingCenter : openingSeed(hoodPixels, alphaLimit);
    const moves = [];
    const diagnostics = {requested:roots.length,stretched:0,insideRing:0,tooFar:0,limited:0,
      missingRing:0,openingCenter:center,maxStretch,subdivision,
      aboveInfluence,belowInfluence,moves};
    if (!center) {diagnostics.missingRing=roots.length;return diagnostics;}
    for (const root of roots) {
      const edge = ringEdgeOnRay(hoodPixels, center, root, alphaLimit);
      if (!edge) {diagnostics.missingRing++;continue;}
      const fromCenter = Math.hypot(root.x-center.x,root.y-center.y);
      const delta = {x:root.x-edge.x,y:root.y-edge.y};
      const length = Math.hypot(delta.x,delta.y);
      if (fromCenter <= edge.ringDistance + .01 || length <= .01) {
        diagnostics.insideRing++;continue; // Corner is already in the opening, or coincides with the inner edge.
      }
      // The slider used to reject the ENTIRE root until maxStretch >= length,
      // then jump directly to the target. Instead move continuously along
      // the edge-to-root vector up to the requested displacement budget.
      // At the maximum needed distance the fitted edge reaches the root.
      const appliedLength = Math.min(length,maxStretch);
      if (length > maxStretch) diagnostics.limited++;
      if (appliedLength <= 0) continue; // Explicit zero means disabled, with no origin/canvas changes.
      const progress = appliedLength / length;
      const appliedDelta = {x:delta.x * progress,y:delta.y * progress};
      const to = {x:edge.x+appliedDelta.x,y:edge.y+appliedDelta.y};
      const normalRadius = Math.min(85, Math.max(20, appliedLength * 2.5 + 12));
      // Subdivision changes influence locality; the displaced edge itself
      // always reaches the current *partial* target precisely.
      const radius = Math.max(8, Math.min(100, normalRadius * Math.sqrt(4 / subdivision)));
      moves.push({from:edge,to,requestedTo:root,delta:appliedDelta,
        requestedLength:length,appliedLength,limited:progress<1,
        radius,aboveInfluence,belowInfluence});
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
    const original = new Uint8ClampedArray(data); // Keep each pin's source fixed so interpolation doesn't read already-moved pixels.
    const {to,delta,radius} = move;
    const minX=Math.max(0,Math.floor(to.x-radius)),maxX=Math.min(width-1,Math.ceil(to.x+radius));
    const minY=Math.max(0,Math.floor(to.y-radius)),maxY=Math.min(height-1,Math.ceil(to.y+radius));
    const r2=radius*radius;
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const dist2=(x+.5-to.x)**2+(y+.5-to.y)**2;
      if(dist2>=r2)continue;
      const weight=deformationWeight(move,x+.5,y+.5);
      if(weight<=0)continue;
      // Nearest-neighbour rounding previously made every displacement under
      // roughly half a pixel invisible. Subpixel, premultiplied-alpha sampling
      // makes 0.25px adjustments visibly move the hood's inner silhouette.
      const sampleX=Math.max(0,Math.min(width-1,x-delta.x*weight));
      const sampleY=Math.max(0,Math.min(height-1,y-delta.y*weight));
      const x0=Math.floor(sampleX),y0=Math.floor(sampleY);
      const x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1);
      const fx=sampleX-x0,fy=sampleY-y0;
      const i00=(y0*width+x0)*4,i10=(y0*width+x1)*4;
      const i01=(y1*width+x0)*4,i11=(y1*width+x1)*4;
      // Pre-multiplied alpha avoids dark/colored halos at transparent edges.
      // Scalar weights avoid four temporary arrays for every destination pixel.
      const a00=original[i00+3]*(1-fx)*(1-fy);
      const a10=original[i10+3]*fx*(1-fy);
      const a01=original[i01+3]*(1-fx)*fy;
      const a11=original[i11+3]*fx*fy;
      const a=a00+a10+a01+a11,dst=(y*width+x)*4;
      data[dst]=a>0?(original[i00]*a00+original[i10]*a10+original[i01]*a01+original[i11]*a11)/a:0;
      data[dst+1]=a>0?(original[i00+1]*a00+original[i10+1]*a10+original[i01+1]*a01+original[i11+1]*a11)/a:0;
      data[dst+2]=a>0?(original[i00+2]*a00+original[i10+2]*a10+original[i01+2]*a01+original[i11+2]*a11)/a:0;
      data[dst+3]=a;
    }
  }

  function stretchHoodToRoots(hoodCanvas, inputRoots, options = {}) {
    const roots=normalizeRoots(inputRoots);
    const empty={requested:roots.length,stretched:0,insideRing:0,tooFar:0,
      missingRing:0,limited:0,moves:[],applied:false};
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

  function deformHoodPermissionMask(allowanceMask, hoodMoves) {
    if (allowanceMask == null || !Array.isArray(hoodMoves) || !hoodMoves.length)
      return allowanceMask; // Null remains the legacy fully-removable policy.
    const canonical=normalizeMask(allowanceMask);
    if (!canonical?.runs.length
      || (canonical.runs.length===1&&canonical.runs[0][0]===0&&canonical.runs[0][1]===PIXELS))
      return allowanceMask; // Both protect-all and allow-all require no extra per-frame warp.
    const bits = decodeMask(canonical);
    const image = {width:SIZE,height:SIZE,data:new Uint8ClampedArray(PIXELS*4)}; // The same transform as visible hood cloth, never an unrelated sprite.
    for (let i=0;i<PIXELS;i++) if (bits[i]) image.data[i*4+3]=255;
    for (const move of hoodMoves) warpForRoot(image,move);
    const warped=new Uint8Array(PIXELS);
    for(let i=0;i<PIXELS;i++)if(image.data[i*4+3]>=128)warped[i]=1;
    return encodeMask(warped);
  }

  function normalizeConeSpread(value) {
    const n = Number(value); // Cone widening in horizontal pixels per pixel below the lower opening edge.
    return value == null || !Number.isFinite(n) ? 0 : Math.max(0,Math.min(2,n));
  }

  function lowerHoodOpeningSegment(hoodRGBA, options = {}) {
    // Sample the FIRST opaque pixel on radial rays from the face opening.
    // Using the final lower hit in each column isolates the lower inner rim;
    // scanning the hood's bottom silhouette instead would pick outer cloth.
    const alphaLimit=alphaFloor(options.alphaLimit,64);
    if(!hoodRGBA || hoodRGBA.length!==PIXELS*4) return {points:[],seed:null};
    const seed=openingSeed(hoodRGBA,alphaLimit);
    if(!seed)return {points:[],seed:null};
    const bottom=new Int16Array(SIZE);
    bottom.fill(-1);
    const samples=512,maxRadius=Math.min(SIZE,Math.max(20,Number(options.maxRadius)||85));
    for(let ray=0;ray<samples;ray++){
      const angle=2*Math.PI*ray/samples;
      const stepX=Math.cos(angle),stepY=Math.sin(angle);
      let prior=-1;
      for(let d=.5;d<=maxRadius;d+=.5){
        const x=Math.floor(seed.x+stepX*d),y=Math.floor(seed.y+stepY*d);
        if(x<0||x>=SIZE||y<0||y>=SIZE)break;
        const i=y*SIZE+x;
        if(i===prior)continue;
        prior=i;
        if(hoodRGBA[i*4+3]<alphaLimit)continue;
        // Ignore the upper ring arc; permission starts on the lower opening.
        if(y+1>=seed.y && y>bottom[x])bottom[x]=y;
        break;
      }
    }
    const points=[];
    for(let x=0;x<SIZE;x++)if(bottom[x]>=0)points.push({x,y:bottom[x]});
    return {points,seed};
  }

  function autoHoodAllowanceMask(hoodRGBA, coneSpread = 0, options = {}) {
    // At zero widening, paint all columns vertically beneath the detected
    // bottom opening segment; positive widening grows the area like a cone.
    const spread=normalizeConeSpread(coneSpread),rim=lowerHoodOpeningSegment(hoodRGBA,options);
    const bits=new Uint8Array(PIXELS);
    if(!rim.points.length)return {mask:encodeMask(bits),bottomPoints:[],openingSeed:rim.seed,
      coneSpread:spread,allowedPixels:0};
    let allowedPixels=0;
    for(let y=0;y<SIZE;y++){
      let left=SIZE,right=-1;
      for(const point of rim.points){
        if(point.y>y)continue;
        const expansion=(y-point.y)*spread;
        left=Math.min(left,Math.floor(point.x-expansion));
        right=Math.max(right,Math.ceil(point.x+expansion));
      }
      if(right<left)continue;
      const first=Math.max(0,left),last=Math.min(SIZE-1,right);
      if(last<first)continue;
      bits.fill(1,y*SIZE+first,y*SIZE+last+1);
      allowedPixels+=last-first+1;
    }
    return {mask:encodeMask(bits),bottomPoints:rim.points,
      openingSeed:rim.seed,coneSpread:spread,allowedPixels};
  }

  function partitionBeardHood(requestMask, allowanceMask, beardRGBA, hoodRGBA, whiskerMask = null) {
    // No authored hood permission mask means legacy permissive behavior.
    // An explicit EMPTY mask means no hood pixel may be removed.
    const request = decodeMask(requestMask);
    const whiskers = decodeMask(whiskerMask); // Explicit beard override defeats otherwise protected hood areas.
    const allowed = allowanceMask == null ? null : decodeMask(allowanceMask);
    const approved = new Uint8Array(PIXELS);
    const refused = new Uint8Array(PIXELS);
    let requested = 0, approvedPixels = 0, refusedPixels = 0, whiskerWins = 0;
    if (!beardRGBA || !hoodRGBA || beardRGBA.length !== PIXELS * 4 || hoodRGBA.length !== PIXELS * 4)
      return {approved, refused, requested, approvedPixels, refusedPixels, whiskerWins};
    for (let i = 0; i < PIXELS; i++) {
      if ((!request[i]&&!whiskers[i]) || beardRGBA[i * 4 + 3] < 8 || hoodRGBA[i * 4 + 3] < 8) continue;
      requested++;
      if (!allowed || allowed[i] || whiskers[i]) {
        approved[i] = 1;approvedPixels++;
        if (whiskers[i] && allowed && !allowed[i]) whiskerWins++;
      }
      else {refused[i] = 1;refusedPixels++;}
    }
    return {approved, refused, requested, approvedPixels, refusedPixels, whiskerWins};
  }

  function applyRefusedBeardOutline(beardRGBA, refused) {
    // Generate an inward, one-pixel black outline on surviving dyed beard
    // pixels adjacent to freshly refused pixels. An exterior outline inside
    // erased pixels would be hidden by the intact hood, so stay on beard art.
    const remaining = new Uint8ClampedArray(beardRGBA); // Read-only source is never mutated during adjacency discovery.
    const edge = new Uint8Array(PIXELS); // Marks only neighbors of NEW erasures, not all authored silhouette edges.
    let erasedPixels = 0, outlinedPixels = 0;
    for (let i=0; i<PIXELS; i++) {
      if (!refused[i]) continue;
      const offset=i*4;
      if (beardRGBA[offset+3]) erasedPixels++;
      remaining[offset]=remaining[offset+1]=remaining[offset+2]=remaining[offset+3]=0;
      const x=i%SIZE,y=(i/SIZE)|0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
        if(!dx&&!dy)continue;
        const nx=x+dx,ny=y+dy;
        if(nx<0||ny<0||nx>=SIZE||ny>=SIZE)continue;
        const index=ny*SIZE+nx,o=index*4;
        if(refused[index]||beardRGBA[o+3]<64)continue;
        if(beardRGBA[o]<=30&&beardRGBA[o+1]<=30&&beardRGBA[o+2]<=30)continue;
        edge[index]=1;
      }
    }
    for(let i=0;i<PIXELS;i++)if(edge[i]){
      const offset=i*4;
      remaining[offset]=remaining[offset+1]=remaining[offset+2]=0;
      outlinedPixels++;
    }
    return {pixels:remaining,erasedPixels,outlinedPixels};
  }

  function negotiateBeardHood(beardCanvas, hoodCanvas, requestMask, allowanceMask = null, options = {}) {
    // Both scratch canvases have exactly 200x200 portrait coordinates. Mutate
    // only the two supplied layers; never punch holes into a full portrait.
    const empty = {applied:false,requested:0,approvedPixels:0,refusedPixels:0,
      erasedPixels:0,outlinedPixels:0,whiskerWins:0,automaticOpeningPixels:null,bottomRingPoints:null};
    if (!beardCanvas || !hoodCanvas ||
        (!normalizeMask(requestMask)?.runs.length && !normalizeMask(options.whiskerMask)?.runs.length)) return empty;
    try {
      const beardCtx = beardCanvas.getContext('2d',{willReadFrequently:true});
      const hoodCtx = hoodCanvas.getContext('2d',{willReadFrequently:true});
      const beard = beardCtx.getImageData(0,0,SIZE,SIZE);
      const hood = hoodCtx.getImageData(0,0,SIZE,SIZE);
      const automatic=options.permissionMode==='auto'
        ? (options.autoPermission || autoHoodAllowanceMask(hood.data,options.coneSpread)) : null;
      const fittedAllowance=automatic?.mask ??
        (options.permissionMode==='all' ? null : deformHoodPermissionMask(allowanceMask,options.hoodMoves));
      const partition=partitionBeardHood(requestMask,fittedAllowance,beard.data,hood.data,options.whiskerMask);
      const {approved,refused,requested,approvedPixels,refusedPixels,whiskerWins} = partition;
      // Permission applies ONLY where the transformed front hood actually has
      // pixels. No hood at that coordinate means nothing to erase from beard.
      for (let i = 0; i < PIXELS; i++) if (approved[i]) {
        const offset = i * 4;
        hood.data[offset] = hood.data[offset+1] = hood.data[offset+2] = hood.data[offset+3] = 0;
      }
      if (approvedPixels) hoodCtx.putImageData(hood,0,0);
      let erasedPixels = 0, outlinedPixels = 0;
      if (refusedPixels) {
        const outlined = applyRefusedBeardOutline(beard.data,refused);
        beard.data.set(outlined.pixels);
        beardCtx.putImageData(beard,0,0);
        erasedPixels = outlined.erasedPixels;
        outlinedPixels = outlined.outlinedPixels;
      }
      const stats = {applied:approvedPixels>0||refusedPixels>0,
        requested,approvedPixels,refusedPixels,erasedPixels,outlinedPixels,whiskerWins,
        automaticOpeningPixels:automatic?.allowedPixels??null,
        bottomRingPoints:automatic?.bottomPoints.length??null};
      if (options.includeMasks) {
        stats.approvedMask = encodeMask(approved);
        stats.refusedMask = encodeMask(refused);
      }
      return stats;
    } catch(error) {
      return {...empty,error:String(error?.message||error)};
    }
  }

  window.PortraitBeardHoodCutout = Object.freeze({
    SIZE, normalizeMask, decodeMask, encodeMask, countMask, alphaFloor, paintMask,
    normalizeRoots, normalizeSubdivision, normalizeVerticalInfluence, deformationWeight,
    normalizeConeSpread, lowerHoodOpeningSegment, autoHoodAllowanceMask,
    planTuftStretch, stretchHoodToRoots, applyToHood,
    partitionBeardHood, deformHoodPermissionMask, applyRefusedBeardOutline, negotiateBeardHood,
  });
})();
